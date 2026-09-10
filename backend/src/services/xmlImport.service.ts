/**
 * นำเข้าไฟล์ XML (SURV_REPORT) ของ ISURVEY → โครงข้อมูลของ se-survey
 *
 * flow ที่รองรับ (ระบบเก่าที่กำลังเลิกใช้):
 *   พนักงานทำงานบน ISURVEY → หัวหน้าปิดงานบนเว็บ ISURVEY ได้ไฟล์ XML
 *   → อัปโหลดเข้าเว็บนี้ → สร้างเคสจริง → คนตรวจ/แก้ → ปิดงาน
 *   → บอท se-autokey นำเข้า EMCS ตาม flow เดิม (ไม่ต้องแก้บอท)
 *
 * นี่คือ "ตัวกลับด้าน" ของ xmlExport.service.ts — แก้ตรงนั้นแล้วต้องดูตรงนี้ด้วย
 *
 * ⚠️ กับดักที่ยืนยันจากไฟล์จริง 6 ไฟล์ (อย่าแก้ให้ง่ายลงโดยไม่ตรวจไฟล์ก่อน):
 *  1. ค่าว่างใน XML เป็น " " (เว้นวรรค) ไม่ใช่สตริงว่าง → Number(' ')=0 ดูเหมือนข้อมูลจริง
 *  2. ศักราชไม่คงเส้นคงวา: POLICY_START เป็น พ.ศ. ในบางไฟล์ ทั้งที่ ACC_DATE ไฟล์เดียวกันเป็น ค.ศ.
 *     → ต้อง auto-detect รายค่า ห้าม +543 ตายตัว
 *  3. CMFG มี prefix ประเภทรถ ('VTOYOTA' = V+TOYOTA) → ตัดด้วย CTYPECODE ไม่ใช่ตัดตัว 'A'
 *  4. รหัสอำเภอถูกตัดศูนย์นำตอน export ('0227'→'227') → ต้อง padStart(4,'0') ก่อน reverse
 *  5. HAVE_INSURANCE มี 2 ความหมาย: ISURVEY ใส่ "ชื่อบริษัท" ส่วน se-survey ใส่ flag '1'
 *  6. DAMAGE_LIST ว่างเสมอในไฟล์ ISURVEY (6/6) → ความเสียหายต้องให้คนกรอกบนเว็บ
 *  7. ตาราง lookup ของ xmlExport เป็น many-to-one (มี alias) → invert อัตโนมัติไม่ได้
 *     ต้องเลือกป้าย canonical เอง ให้ตรงกับ dropdown ของแอป/เว็บ ไม่งั้นกดบันทึกแล้วค่าหาย
 *  8. ช่องความเห็นของ ISURVEY ชื่อไม่ตรงความหมาย (กติกา user 07/09/69 — ยึดปุ่ม "นำเข้า ISURVEY"
 *     ของบอทเป็นแม่แบบ ให้ทุกทางลง EMCS เหมือนกัน): ACC_DETAIL ของ ISURVEY เป็นข้อความแม่แบบบริษัท
 *     (ติดต่อสาขา/ห้ามแนะนำอู่) + ข้อมูลกรมธรรม์ ไม่ใช่รายละเอียดเหตุ → ไม่ใช้; "รายละเอียดการเกิดเหตุ"
 *     เอาจาก SURV_COMMENT (ความคิดเห็นพนักงาน = รายงานเซอร์เวย์ฉบับเต็ม) แล้วปล่อยความเห็นของ
 *     เซอร์เวย์ว่าง (ย้าย ไม่ก๊อปซ้ำ 2 ช่อง) · "ผลการดำเนินงาน" ควรเป็น "บันทึกความเห็นหัวหน้างาน"
 *     แท็บ 1 แต่ XML ของ ISURVEY ไม่ส่งมา (ACC_RESULT ว่างทุกไฟล์) → หัวหน้ากรอกบนเว็บ
 *     ⚠️ ใช้กับ source 'isurvey_xml' เท่านั้น — ไฟล์ emcs_extract สกัดจาก EMCS ที่กรอกตามกติกานี้
 *     อยู่แล้ว จับคู่ตรงชื่อเหมือนเดิม (ต้องตรงกับ se-autokey: isurvey_to_sesurvey.build_case)
 */
import { EMCS_DISTRICTS } from '../data/emcsDistricts';
import { CAUSE, RELATION, LICENSE_TYPE } from './xmlExport.service';
import { EMCS_REQUIRED } from '../data/emcsRequired';

// ───────────────────────── parser ขนาดเล็ก ─────────────────────────
// XML ของ SURV_REPORT เป็น flat มาก (ไม่มี attribute/namespace/nested ซ้อนลึก)
// จึง parse ด้วย regex ได้ปลอดภัยกว่าการเพิ่ม dependency ใหม่เข้าโปรเจกต์
const decode = (s: string): string =>
  s
    // ขึ้นบรรทัดใน XML มาเป็น CRLF ที่เข้ารหัสครึ่งเดียว: '&#13;' (CR) แล้วตามด้วย LF ตัวจริง
    // แปลง &#13; เป็น \n ตรง ๆ จะได้ 2 บรรทัดต่อ 1 การขึ้นบรรทัด → ความเห็นยืดเป็นสองเท่า
    .replace(/&#13;\r?\n/g, '\n')
    .replace(/&#13;/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\r\n/g, '\n');

/** ดึงบล็อก <NAME>...</NAME> ทั้งหมด (ไม่ซ้อนกันเอง) */
function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** ค่าของ tag ในบล็อก — " " (ค่าว่างของ el()) และ "-" คืนเป็น '' */
function txt(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!m) return '';
  const v = decode(m[1]).trim();
  return v === '-' ? '' : v;
}

const numOrNull = (v: string): number | null => {
  const s = String(v ?? '').replace(/[,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ───────────────────────── วันที่ ─────────────────────────
/**
 * 'yyyy-mm-dd hh:mm:ss' → { date: 'dd/mm/yyyy(พ.ศ.)', time: 'HH:MM' }
 * auto-detect ศักราชรายค่า: ปี >= 2400 ถือว่าเป็น พ.ศ. อยู่แล้ว (ไม่ +543 ซ้ำ)
 * เวลา 00:00:00 = ไม่ทราบเวลา → คืน time = ''
 */
export function splitXmlDate(raw: string): { date: string; time: string } {
  const s = String(raw ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return { date: '', time: '' };
  const y = parseInt(m[1], 10);
  const be = y >= 2400 ? y : y + 543;
  const time = m[4] && !(m[4] === '00' && m[5] === '00') ? `${m[4]}:${m[5]}` : '';
  return { date: `${m[3]}/${m[2]}/${be}`, time };
}

/** วันที่อย่างเดียว (ทิ้งเวลา) */
const dateOnly = (raw: string): string => splitXmlDate(raw).date;
/** รูปแบบที่ se-survey ใช้เก็บวัน+เวลาคู่กัน: 'dd/mm/yyyy|HH:MM' */
const dateTime = (raw: string): string => {
  const { date, time } = splitXmlDate(raw);
  if (!date) return '';
  return time ? `${date}|${time}` : date;
};

// ───────────────────────── ตาราง reverse ─────────────────────────
// เลือก "ป้าย canonical" เองทีละตัว เพราะตารางฝั่ง export มี alias หลายชื่อต่อรหัส
// ป้ายต้องตรงกับ dropdown ของแอป/เว็บเป๊ะ ไม่งั้นผู้ตรวจกดบันทึกแล้วค่าจะถูกล้างเป็น NULL
const PROVINCE_BY_CODE: Record<string, string> = {
  '1': 'กระบี่', '2': 'กรุงเทพ ฯ', '3': 'กาญจนบุรี', '4': 'กาฬสินธุ์', '5': 'กำแพงเพชร',
  '6': 'ขอนแก่น', '7': 'จันทบุรี', '8': 'ฉะเชิงเทรา', '9': 'ชลบุรี', '10': 'ชัยนาท',
  '11': 'ชัยภูมิ', '12': 'ชุมพร', '13': 'เชียงราย', '14': 'เชียงใหม่', '15': 'ตรัง',
  '16': 'ตราด', '17': 'ตาก', '18': 'นครนายก', '19': 'นครปฐม', '20': 'นครพนม',
  '21': 'นครราชสีมา', '22': 'นครศรีธรรมราช', '23': 'นครสวรรค์', '24': 'นนทบุรี',
  '25': 'นราธิวาส', '26': 'น่าน', '27': 'บุรีรัมย์', '28': 'ปทุมธานี', '29': 'ประจวบคีรีขันธ์',
  '30': 'ปราจีนบุรี', '31': 'ปัตตานี', '32': 'พะเยา', '33': 'พังงา', '34': 'พัทลุง',
  '35': 'พิจิตร', '36': 'พิษณุโลก', '37': 'เพชรบุรี', '38': 'เพชรบูรณ์', '39': 'แพร่',
  '40': 'ภูเก็ต', '41': 'มหาสารคาม', '42': 'มุกดาหาร', '43': 'แม่ฮ่องสอน', '44': 'ยโสธร',
  '45': 'ยะลา', '46': 'ร้อยเอ็ด', '47': 'ระนอง', '48': 'ระยอง', '49': 'ราชบุรี',
  '50': 'ลพบุรี', '51': 'ลำปาง', '52': 'ลำพูน', '53': 'เลย', '54': 'ศรีสะเกษ',
  '55': 'สกลนคร', '56': 'สงขลา', '57': 'สตูล', '58': 'สมุทรปราการ', '59': 'สมุทรสงคราม',
  '60': 'สมุทรสาคร', '61': 'สระแก้ว', '62': 'สระบุรี', '63': 'สิงห์บุรี', '64': 'สุโขทัย',
  '65': 'สุพรรณบุรี', '66': 'สุราษฎร์ธานี', '67': 'สุรินทร์', '68': 'หนองคาย',
  '69': 'หนองบัวลำภู', '70': 'พระนครศรีอยุธยา', '71': 'อ่างทอง', '72': 'อำนาจเจริญ',
  '73': 'อุดรธานี', '74': 'อุตรดิตถ์', '75': 'อุทัยธานี', '76': 'อุบลราชธานี',
  '77': 'บึงกาฬ', '79': 'อื่นๆ',
};

const COLOR_BY_CODE: Record<string, string> = {
  '1': 'ขาว', '2': 'เทา', '3': 'เงิน', '4': 'ทอง', '5': 'เหลือง', '6': 'เขียว', '7': 'ฟ้า',
  '8': 'น้ำเงิน', '9': 'ม่วง', '10': 'แดง', '11': 'ส้ม', '12': 'เลือดหมู', '13': 'ดำ',
  '14': 'ขาว / ทอง', '15': 'เทา / เงิน', '16': 'เหลือง / เงิน', '17': 'เขียว / เงิน',
  '18': 'น้ำเงิน / เทา', '19': 'น้ำเงิน / เงิน', '20': 'แดง / เทา', '21': 'ดำ / เทา',
  '22': 'น้ำตาล', '23': 'เขียว / เทา', '24': 'ชมพู', '25': 'แดง/ทอง', '26': 'เขียว / เหลือง',
  '27': 'ขาวมุก', '28': 'ขาว / เขียว / เหลือง', '29': 'น้ำตาล / เทา', '30': 'บรอน',
  '31': 'เทา/น้ำเงิน/เหลือง', '32': 'ฟ้า/แดง', '33': 'ทอง / น้ำตาล', '34': 'น้ำตาล / เขียว',
  '35': 'ขาว / น้ำเงิน', '36': 'บรอนทอง', '37': 'ขาว / น้ำตาล', '38': 'บรอนฟ้า', '39': 'ครีม',
  '40': 'ขาว / เหลือง / ส้ม', '41': 'ดำ / น้ำตาล', '42': 'น้ำเงิน / น้ำตาล', '43': 'ขาว / เทา',
  '44': 'เหลือง/ทอง', '45': 'ม่วง/เทา', '46': 'บรอน/ทอง', '47': 'ขาว/ดำ', '48': 'ขาว/แดง',
  '49': 'แดง/ดำ', '50': 'ขาว/ส้ม/เขียว', '51': 'ดำ/ขาว/เหลือง', '52': 'ขาว/แดง/หลายสี',
  '54': 'อื่นๆ',
};

/** รหัสประเภทรถ (CTYPECODE) → ป้ายที่แอปใช้ */
const CAR_TYPE_BY_CODE: Record<string, string> = {
  A: 'เก๋งเอเชีย', E: 'เก๋งยุโรป', T: 'กระบะ', V: 'รถตู้',
  W: 'รถบรรทุก', M: 'รถจักรยานยนต์', O: 'รถอื่นๆ',
};

/** ผลคดี (ACC_CAUSE 1-7) → ป้ายเดียวกับ radio ของเว็บ/แอป */
const FAULT_BY_CODE: Record<string, string> = {
  '1': 'รถประกันเป็นฝ่ายผิด', '2': 'รถคู่กรณีเป็นฝ่ายผิด', '3': 'ประมาทร่วม',
  '4': 'รอสรุปผลคดี', '5': 'รถประกันเป็นฝ่ายถูกและผิด', '6': 'ยกเลิกการเคลม',
  '7': 'ไปถึงแล้วไม่พบ',
};

/** เพศ */
const GENDER_BY_CODE: Record<string, string> = { M: 'ชาย', F: 'หญิง', W: 'หญิง' };

/** ยอดรวมค่ารูป + จำนวนรูป → ราคาต่อรูป (2 ตำแหน่ง) — จำนวน 0/ว่าง = คืนยอดเดิม */
function photoUnitPrice(total: string, count: string): number | null {
  const t = Number(String(total ?? '').replace(/,/g, ''));
  const n = Number(String(count ?? '').replace(/,/g, ''));
  if (!Number.isFinite(t) || String(total ?? '').trim() === '') return null;
  if (!Number.isFinite(n) || n <= 0 || t === 0) return t;
  return Math.round((t / n) * 100) / 100;
}

/**
 * ประเภทผู้บาดเจ็บ — ⚠️ export ยุบ 5 ป้ายเหลือ 3 รหัส (DV/PV/ON)
 * reverse ได้แค่ค่าที่ปลอดภัยที่สุด; ฝั่งคู่กรณี (02/04) กู้ไม่ได้จาก XML
 * → ปล่อยให้คนตรวจแก้บนเว็บ (คืน warning ให้ผู้ใช้รู้)
 */
const PERSON_TYPE_BY_CODE: Record<string, string> = {
  DV: 'ผู้ขับขี่ - รถประกัน', PV: 'ผู้โดยสาร - รถประกัน', ON: 'บุคคลภายนอกรถ',
};

// ป้าย verbatim ของ ddlWounded_Type (6 ระดับ) — ต้องตรง master ไม่งั้น dropdown ไม่ match
const WOUND_BY_CODE: Record<string, string> = {
  '01': 'บาดเจ็บ - เล็กน้อย', '02': 'บาดเจ็บ - ปานกลาง', '03': 'บาดเจ็บ - สาหัส',
  '04': 'ทุพพลภาพ', '05': 'เสียชีวิตก่อนรักษา', '06': 'เสียชีวิตหลังรักษา',
};

const FLU_BY_CODE: Record<string, string> = {
  N: 'ไม่มีการนัดหมาย', W: 'รอการนัดหมาย', Y: 'มีการนัดหมาย',
};

/**
 * ตารางรหัสของ CAUSE_CODE / DRI_RELATION / DRI_DRVTYPE ถอดกลับจากตารางจริงของ xmlExport
 * แทนที่จะพิมพ์ซ้ำ — รหัสพวกนี้ไม่เรียงตามลำดับป้าย ('ประมาทร่วม' = 9191 ไม่ใช่ 9126,
 * 'ใบขับขี่รถยนต์ส่วนบุคคลชั่วคราว' = 4 ไม่ใช่ 3) เขียนมือแล้วเพี้ยนแน่
 *
 * ตาราง export เป็น many-to-one (กับดักข้อ 7) — 3 รหัสนี้มี 2 ป้าย และ **เดาไม่ได้**:
 * ตัวที่ถูกไม่ใช่ตัวแรกเสมอ ('เฉี่ยวชนวัสดุ' มาก่อน) และไม่ใช่ตัวที่ยาวกว่าเสมอ
 * ('ใบขับขี่รถยนต์ส่วนบุคคคล' พิมพ์ตก ค เกิน ยาวกว่าตัวจริง 1 ตัว) → ระบุตรงๆ
 */
const CANONICAL_LABEL: Record<string, string> = {
  '9114': 'ชนวัสดุ/สิ่งของ เช่น เสา,กำแพง,ประตู ฯลฯ',
  '16': 'ใบขับขี่รถยนต์ส่วนบุคคลหนึ่งปีต่ออายุ',
  '19': 'ใบขับขี่รถยนต์ส่วนบุคคล',
};
const reverseOf = (table: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [label, code] of Object.entries(table)) {
    if (!code) continue;
    out[code] = CANONICAL_LABEL[code] ?? (out[code] ?? label);
  }
  return out;
};
const CAUSE_BY_CODE = reverseOf(CAUSE);
const RELATION_BY_CODE = reverseOf(RELATION);
const LICENSE_BY_CODE = reverseOf(LICENSE_TYPE);

/** อำเภอ: รหัส (อาจถูกตัดศูนย์นำ) + รหัสจังหวัด → ชื่อไทย */
function districtName(provinceCode: string, districtCode: string): string {
  const table = EMCS_DISTRICTS[String(provinceCode || '').trim()];
  const raw = String(districtCode || '').trim();
  if (!table || !raw) return '';
  const want = parseInt(raw, 10);
  if (!Number.isFinite(want)) return '';
  for (const [name, code] of Object.entries(table)) {
    if (parseInt(code, 10) === want) return name;
  }
  return '';
}

/**
 * ยี่ห้อรถ: XML ใส่ prefix ประเภทรถไว้หน้าชื่อ ('VTOYOTA' = V + TOYOTA)
 * ตัดด้วย CTYPECODE ของบล็อกเดียวกัน — ห้ามตัดตัวแรกเสมอ และห้ามตัดเฉพาะ 'A'
 * (ยี่ห้อจริงบางตัวขึ้นต้นด้วยอักษรที่เป็นรหัสประเภทรถพอดี)
 */
function cleanBrand(cmfg: string, ctypecode: string): string {
  const v = String(cmfg || '').trim();
  const t = String(ctypecode || '').trim().toUpperCase();
  if (!v) return '';
  if (t && v.length > 1 && v[0].toUpperCase() === t) return v.slice(1).trim();
  return v;
}

// ───────────────────────── ผลลัพธ์ ─────────────────────────
export interface XmlImportResult {
  /** ค่าที่ต้องลงตาราง cases */
  caseFields: { customer_name: string; incident_location: string;
    /** เวลาส่งงาน (ISO) — งานที่ดึงสดจาก ISURVEY ส่ง "ส่งรายงานเวลา" มาให้ (10/09/69) · ไม่มี = null */
    submitted_at?: string | null };
  /** ค่าที่ต้องลงตาราง survey_reports (คีย์ = ชื่อคอลัมน์) */
  report: Record<string, unknown>;
  /** ค่าที่ต้องลง survey_expenses (null = XML ไม่มียอดเงิน เช่นไฟล์ที่ se-survey ออกเอง) */
  expenses: Record<string, number | null> | null;
  /** รหัสพนักงานสำรวจที่อ่านได้จาก ACC_SURV (เช่น 'SE272') — ใช้ resolve assigned_to */
  surveyorCode: string;
  /** เรื่องที่ผู้ใช้ต้องรู้ก่อนกดสร้างเคส */
  warnings: string[];
  /**
   * ที่มาของไฟล์ — กติกาต่างกันคนละเรื่อง ห้ามปนกัน
   *   'isurvey_xml'  ระบบเก่า: ไม่มีหนัก/เบา · ลักษณะความเสียหาย ฯลฯ → ต้องเตือนให้หัวหน้ากรอกเอง
   *                  และมียอดเงินที่หัวหน้ากรอกไว้แล้ว ต้องส่งต่อเข้า EMCS
   *   'emcs_extract' สกัดกลับจากหน้าเว็บ EMCS ด้วย tools/emcs_dump.py → **ข้อมูลทดสอบเท่านั้น**
   *                  ข้อมูลครบเพราะผู้ใช้กรอกและตรวจแล้ว แต่ไม่ใช่งานใหม่ ห้ามนับเป็นงาน ISURVEY
   *   'isurvey_live' ดึงสดจาก ISURVEY ตอนสถานะยังเป็น "รอตรวจข้อมูล" (ก่อนหัวหน้าตรวจ)
   *                  → **การตรวจและกรอกยอดเกิดขึ้นที่นี่** ยอดจึงแก้ได้ ต่างจาก isurvey_xml
   *                  ที่ปิดงานบน ISURVEY ไปแล้วและยอดอยู่ที่ se-billing (ดูอย่างเดียว)
   */
  source: 'isurvey_xml' | 'emcs_extract' | 'isurvey_live';
}

/** ไฟล์ที่ emcs_dump.py สร้าง จะประทับตรานี้ไว้บรรทัดบนสุด */
const EMCS_EXTRACT_MARK = /<!--\s*SOURCE=EMCS_EXTRACT/i;

/** อ่านไฟล์ XML ของ ISURVEY → โครงข้อมูลของ se-survey */
export function parseIsurveyXml(xml: string): XmlImportResult {
  const warnings: string[] = [];
  const rep = blocks(xml, 'TXN_SURV_REPORT')[0];
  if (!rep) throw new Error('ไฟล์นี้ไม่ใช่ XML ของรายงานสำรวจ (ไม่พบบล็อก TXN_SURV_REPORT)');

  const source: XmlImportResult['source'] =
    EMCS_EXTRACT_MARK.test(xml) ? 'emcs_extract' : 'isurvey_xml';
  if (source === 'emcs_extract') {
    warnings.push(
      'ไฟล์นี้สกัดกลับมาจากหน้าเว็บ EMCS (ไม่ใช่ไฟล์จากระบบ ISURVEY) — ' +
      'ใช้เป็นข้อมูลทดสอบเท่านั้น เคสที่สร้างจะถูกทำเครื่องหมายแยกไว้ ไม่นับเป็นงานจากระบบเก่า');
  }

  const cars = blocks(xml, 'TXN_SURV_CAR');
  const insuredCar = cars.find((c) => txt(c, 'TYPE') === '0') ?? '';
  const opponentCars = cars.filter((c) => txt(c, 'TYPE') !== '0');
  const injBlocks = blocks(xml, 'TXN_SURV_INJ');
  const assetBlocks = blocks(xml, 'TXN_SURV_ASSET');
  const billBlock = blocks(xml, 'TXN_SURV_BILL')[0] ?? '';

  // ── หัวเรื่อง ──
  const accProvCode = txt(rep, 'ACC_PROVINCEID');
  const accDate = splitXmlDate(txt(rep, 'ACC_DATE'));

  const report: Record<string, unknown> = {
    survey_job_no: txt(rep, 'SURV_JOBNO'),
    claim_no: txt(rep, 'REF_CLAIM_NO'),
    claim_ref_no: txt(rep, 'ACC_CLAIMREF_NO'),
    policy_no: txt(rep, 'ACC_POLICY_NO'),
    assured_name: txt(rep, 'ASSURED_NAME'),
    policy_type: txt(rep, 'POLICY_TYPE'),
    policy_start: dateOnly(txt(rep, 'POLICY_START')),
    policy_end: dateOnly(txt(rep, 'POLICY_END')),
    insurance_branch: txt(rep, 'INSURERBRID'),
    acc_date: accDate.date,
    acc_time: accDate.time,
    acc_place: txt(rep, 'ACC_PLACE').slice(0, 200),
    acc_province: PROVINCE_BY_CODE[accProvCode] ?? '',
    acc_district: districtName(accProvCode, txt(rep, 'ACC_DISTRICTID')),
    // รายละเอียดการเกิดเหตุ — ไฟล์ ISURVEY จริง: ความคิดเห็นพนักงาน (SURV_COMMENT) ไม่ใช่ ACC_DETAIL
    // ที่เป็นข้อความแม่แบบบริษัท (ดูกับดักข้อ 8) · emcs_extract จับคู่ตรงชื่อ
    acc_detail: source === 'isurvey_xml' ? txt(rep, 'SURV_COMMENT') : txt(rep, 'ACC_DETAIL'),
    acc_fault: FAULT_BY_CODE[txt(rep, 'ACC_CAUSE')] ?? '',
    // ⚠️ ACC_CAUSE = "ผลคดี/ฝ่ายผิด" ส่วน CAUSE_CODE = "ลักษณะการเกิดเหตุ" — คนละช่องกัน
    acc_cause: CAUSE_BY_CODE[txt(rep, 'CAUSE_CODE')] ?? '',
    acc_fault_opponent_no: txt(rep, 'ACC_CAUSE_NO'),
    // ประเภทเคลม (F/D/A/C) — radio หัวหน้าฟอร์ม; ไม่มีก็ต้องให้คนตรวจเลือกเอง
    claim_type: txt(rep, 'SURV_CLAIM_TYPE').toUpperCase(),
    acc_reporter: txt(rep, 'ACC_CALL'),
    acc_surveyor: txt(rep, 'ACC_SURV'),
    surveyor_name: txt(rep, 'ACC_SURV'),
    // โทรศัพท์ผู้สำรวจภัย — เราส่งออกเป็น ACC_TEL อยู่แล้วแต่เดิมไม่ได้อ่านกลับ
    // ทำให้ round-trip (EMCS → XML → ระบบเรา) ทิ้งเบอร์นี้ทุกครั้ง ทั้งที่ EMCS บังคับช่องนี้
    acc_surveyor_phone: txt(rep, 'ACC_TEL'),
    // ไทม์สแตมป์ 4 จุด — se-survey เก็บ 'dd/mm/yyyy|HH:MM'
    acc_customer_report_date: dateTime(txt(rep, 'ACC_CALL_DATE')),
    acc_insurance_notify_date: dateTime(txt(rep, 'INS_CALLING_SURV_DATE')),
    acc_survey_arrive_date: dateTime(txt(rep, 'ACC_REACH')),
    acc_survey_complete_date: dateTime(txt(rep, 'ACC_FINISH')),
    // ตำรวจ
    acc_police_name: txt(rep, 'POLICE_NAME'),
    acc_police_station: txt(rep, 'POLICE_STATION'),
    acc_police_comment: txt(rep, 'POLICE_COMMENT'),
    acc_police_date: dateTime(txt(rep, 'POLICE_DATE')),
    acc_police_book_no: txt(rep, 'BOOK_NUMBER'),
    // แอลกอฮอล์ — ALC_CHK '1' = มีการตรวจ (ป้ายต้องตรง dropdown ของแอป)
    acc_alcohol_test:
      txt(rep, 'ALC_CHK') === '1'
        ? 'มีการตรวจแอลกอฮอล์'
        : txt(rep, 'ALC_CHK') === '0'
          ? 'ไม่มีการตรวจแอลกอฮอล์'
          : '',
    acc_alcohol_result: txt(rep, 'ALC_RESULT'),
    // ติดตามงาน
    acc_followup: FLU_BY_CODE[txt(rep, 'FLU_TYPE')] ?? '',
    acc_followup_count: txt(rep, 'FLU_NO'),
    acc_followup_detail: txt(rep, 'FLU_DETAIL'),
    acc_followup_date: dateTime(txt(rep, 'FLU_DATE')),
    // การเรียกร้องค่าเสียหายจากคู่กรณี
    acc_claim_opponent: txt(rep, 'OPO_RESULT'),
    acc_claim_amount: txt(rep, 'OPO_PAY'),
    acc_claim_total_amount: txt(rep, 'OPO_RECOVERY_AMOUNT'),
    prb_number: txt(rep, 'PRB_NUMBER'),
    risk_code: txt(rep, 'RISK_CODE'),
    // ความเห็นของเซอร์เวย์ — ไฟล์ ISURVEY จริง: ว่าง เพราะย้าย SURV_COMMENT ไปเป็นรายละเอียดการเกิดเหตุ
    // แล้ว (กติกา 07/09/69 — ข้อความเดียวกันต้องไม่โผล่ 2 ช่องบน EMCS) · emcs_extract จับคู่ตรงชื่อ
    surveyor_comment: source === 'isurvey_xml' ? '' : txt(rep, 'SURV_COMMENT'),
    // ⛔ ห้ามก๊อป SURV_COMMENT ลง notes อีก — เคยเขียนซ้ำคำต่อคำ (1,281 ตัวอักษรเท่ากันเป๊ะ)
    // "หมายเหตุ" เป็นช่องที่คนของเราเขียนเอง ไม่ใช่สำเนาความเห็นที่ติดมากับไฟล์ของประกัน
    // และฝั่งส่งออกเลิกใช้ notes เป็น fallback ของ SURV_COMMENT ไปแล้ว
    //
    // ── อีก 2 ช่องความเห็น อยู่ใน <TXN_SURV_BILL> ไม่ใช่ <TXN_SURV_REPORT> ──
    // ฝั่งส่งออกเขียนไว้ครบ 3 ช่องแล้ว (ACC_RESULT / ACC_COMMENT / SURV_COMMENT)
    // แต่ฝั่งนำเข้าอ่านกลับแค่ตัวเดียว → ไฟล์ที่เรา gen เองแล้วนำกลับเข้าระบบ (round-trip
    // ของ se-autokey โหมดกู้/ซ่อม) ทำ 2 ช่องนี้หายทุกครั้ง
    // ⚠️ ไฟล์ของ ISURVEY จริงทั้ง 8 ใบที่มี ปล่อย 2 tag นี้ว่างหมด — เติม mapper แล้ว
    //    ช่องก็ยังว่างอยู่ดี ไม่ใช่บั๊กของเรา ต้นทางเขาไม่ส่งมา (ผู้ตรวจกรอกเองบนเว็บ)
    survey_result: txt(billBlock, 'ACC_RESULT'),
    review_comment: txt(billBlock, 'ACC_COMMENT'),
  };

  // ── รถประกัน + ผู้ขับขี่ ──
  if (insuredCar) {
    const ctype = txt(insuredCar, 'CTYPECODE');
    const driProv = txt(insuredCar, 'DRI_PROVINCEID');
    Object.assign(report, {
      license_plate: txt(insuredCar, 'CAR_REGNO'),
      car_province: PROVINCE_BY_CODE[txt(insuredCar, 'CAR_PROVINCE')] ?? '',
      car_type: ctype,
      car_brand: cleanBrand(txt(insuredCar, 'CMFG'), ctype),
      car_model: txt(insuredCar, 'CMODEL'),
      car_color: COLOR_BY_CODE[txt(insuredCar, 'CCL_ID')] ?? '',
      chassis_no: txt(insuredCar, 'CHASSISNO'),
      engine_no: txt(insuredCar, 'ENGINENO'),
      model_no: txt(insuredCar, 'MODELNO'),
      car_reg_year: txt(insuredCar, 'CAR_REGNO_YEAR'),
      mileage: numOrNull(txt(insuredCar, 'KM_NO')),
      estimated_cost: numOrNull(txt(insuredCar, 'COST_DAMAGE')),
      driver_name: txt(insuredCar, 'DRI_NAME'),
      driver_age: numOrNull(txt(insuredCar, 'DRI_AGE')),
      driver_gender: txt(insuredCar, 'DRI_GENDER'),
      driver_address: txt(insuredCar, 'DRI_ADDRESS'),
      driver_province: PROVINCE_BY_CODE[driProv] ?? '',
      driver_district: districtName(driProv, txt(insuredCar, 'DRI_DISTRICTID')),
      driver_phone: txt(insuredCar, 'DRI_TELNO'),
      driver_id_card: txt(insuredCar, 'DRI_CARDID'),
      driver_license_no: txt(insuredCar, 'DRI_DRVID'),
      driver_license_place: txt(insuredCar, 'DRI_DRVPLACE'),
      driver_license_start: dateOnly(txt(insuredCar, 'DRI_DRVDATE_START')),
      driver_license_end: dateOnly(txt(insuredCar, 'DRI_DRVDATE_END')),
      driver_birthdate: dateOnly(txt(insuredCar, 'DRI_BIRTHDAY')),
      driver_by_policy: txt(insuredCar, 'DRIVER_BY_POLICY'),
      driver_license_type: LICENSE_BY_CODE[txt(insuredCar, 'DRI_DRVTYPE')] ?? '',
      driver_relation: RELATION_BY_CODE[txt(insuredCar, 'DRI_RELATION')] ?? '',
    });
    // คำนำหน้า: XML ไม่เคยส่ง DRI_TITLE_ID (ว่าง 3/3 ไฟล์) และชื่ออาจพ่วงคำนำหน้ามา
    // 'คุณ' ปลอดภัยกับทั้ง 2 เพศ (เดาจากเพศเสี่ยงผิด นาง/นางสาว)
    const name = String(report.driver_name || '');
    const t = ['นาย', 'นางสาว', 'นาง', 'ด.ช.', 'ด.ญ.', 'คุณ'].find((x) => name.startsWith(x));
    report.driver_title = t ?? (name ? 'คุณ' : '');
    // แยกชื่อ-นามสกุลเหมือนที่ทำกับคู่กรณี — มือถือเก็บแยก 2 ช่อง เว็บก็บังคับ 2 ช่องนี้
    // ถ้าไม่แยก เคสนำเข้าจะขึ้นดอกจันแดงค้างทั้งที่ชื่ออยู่ครบในช่องชื่อเต็ม
    const bare = (t ? name.slice(t.length) : name).trim().split(/\s+/).filter(Boolean);
    report.driver_first_name = bare[0] ?? '';
    report.driver_last_name = bare.slice(1).join(' ');
  } else {
    warnings.push('ไม่พบบล็อกรถประกัน (TYPE=0) ในไฟล์ — ข้อมูลรถ/ผู้ขับขี่จะว่าง');
  }

  // ── คู่กรณี ──
  report.opposing_parties = opponentCars.map((c) => {
    const ctype = txt(c, 'CTYPECODE');
    const full = txt(c, 'DRI_NAME');
    const parts = full.split(/\s+/).filter(Boolean);
    const title = ['นาย', 'นางสาว', 'นาง', 'ด.ช.', 'ด.ญ.', 'คุณ'].find((x) => full.startsWith(x)) ?? '';
    const rest = title ? full.slice(title.length).trim().split(/\s+/).filter(Boolean) : parts;
    // HAVE_INSURANCE: ISURVEY ใส่ชื่อบริษัท / se-survey ใส่ flag '1' → ตัวเลขล้วน = flag
    const haveIns = txt(c, 'HAVE_INSURANCE');
    const insurer = /^\d+$/.test(haveIns) ? '' : haveIns;
    const carProv = txt(c, 'CAR_PROVINCE');
    const driProv = txt(c, 'DRI_PROVINCEID');
    return {
      title,
      first_name: rest[0] ?? '',
      last_name: rest.slice(1).join(' '),
      gender: GENDER_BY_CODE[txt(c, 'DRI_GENDER')] ?? '',
      age: txt(c, 'DRI_AGE'),
      birthdate: dateOnly(txt(c, 'DRI_BIRTHDAY')),
      cid: txt(c, 'DRI_CARDID'),
      phone: txt(c, 'DRI_TELNO'),
      address: txt(c, 'DRI_ADDRESS'),
      // ⚠️ 2 จังหวัดคนละความหมาย — EMCS ก็แยก dropdown จริง:
      //   province      = จังหวัดป้ายทะเบียน (→ ddlCar_Province)
      //   home_province = ภูมิลำเนาจากบัตรประชาชน/ทะเบียนบ้าน (→ ddlDri_ProvinceID)
      // district cascade จาก home_province (ไม่ใช่ป้ายทะเบียน) ไม่งั้น xmlExport หา code ไม่เจอ
      province: PROVINCE_BY_CODE[carProv] ?? '',
      home_province: PROVINCE_BY_CODE[driProv] ?? '',
      district: districtName(driProv, txt(c, 'DRI_DISTRICTID')),
      plate: txt(c, 'CAR_REGNO'),
      car_type: CAR_TYPE_BY_CODE[ctype] ?? '',
      car_brand: cleanBrand(txt(c, 'CMFG'), ctype),
      car_model: txt(c, 'CMODEL'),
      car_color: COLOR_BY_CODE[txt(c, 'CCL_ID')] ?? '',
      reg_year: txt(c, 'CAR_REGNO_YEAR'),
      mileage: txt(c, 'KM_NO'),
      vin: txt(c, 'CHASSISNO'),
      owner_name: txt(c, 'OPO_NAME'),
      owner_address: txt(c, 'DRI_ADDRESS'),
      insurer,
      policy_no: txt(c, 'POLICYNO'),
      claim_no: txt(c, 'CLAIMNO'),
      policy_type: txt(c, 'INSURE_TYPE'),
      license_no: txt(c, 'DRI_DRVID'),
      license_type: LICENSE_BY_CODE[txt(c, 'DRI_DRVTYPE')] ?? '',
      relation: RELATION_BY_CODE[txt(c, 'DRI_RELATION')] ?? '',
      license_place: txt(c, 'DRI_DRVPLACE'),
      license_start: dateOnly(txt(c, 'DRI_DRVDATE_START')),
      license_end: dateOnly(txt(c, 'DRI_DRVDATE_END')),
      estimated_cost: txt(c, 'COST_DAMAGE'),
      damage: [], // XML ไม่เคยมีรายการความเสียหาย — คนกรอกบนเว็บ
      kfk: false,
    };
  });
  report.has_opponents = opponentCars.length > 0;

  // "คู่กรณีคันที่" — EMCS บังคับเมื่อผลคดี = คู่กรณีผิด แต่ไฟล์ ISURVEY แทบไม่เคยส่ง ACC_CAUSE_NO
  // เติมให้เองได้เฉพาะตอนมีคู่กรณี **คันเดียว** เพราะคำตอบมีทางเดียวคือคันที่ 1
  // ⛔ มากกว่า 1 คัน ห้ามเดา — ไฟล์ไม่มีอะไรบอกว่าคันไหนผิด ต้องให้ผู้ตรวจเลือกเอง
  // (เทียบกับ FAULT_BY_CODE['2'] ไม่ใช่สตริงเปล่า — ผลคดีมี 2 สำเนียงใน DB
  //  'รถคู่กรณีเป็นฝ่ายผิด' กับ 'คู่กรณีผิด' เขียนตรง ๆ แล้วเงื่อนไขจะไม่เคยเป็นจริง)
  if (!String(report.acc_fault_opponent_no ?? '').trim()
      && report.acc_fault === FAULT_BY_CODE['2']
      && opponentCars.length === 1) {
    report.acc_fault_opponent_no = '1';
  }

  // ── ผู้บาดเจ็บ ──
  report.injured_persons = injBlocks.map((p) => ({
    person_type: PERSON_TYPE_BY_CODE[txt(p, 'PERSON_TYPE')] ?? '',
    name: txt(p, 'NAME'),
    age: txt(p, 'AGE'),
    cid: txt(p, 'CITIZEN_ID'),
    gender: GENDER_BY_CODE[txt(p, 'GENDER')] ?? '',
    occupation: txt(p, 'JOB'),
    car_reg: txt(p, 'CAR_REGNO'),
    address: txt(p, 'ADDRESS'),
    phone: txt(p, 'TEL_NO'),
    work_place: txt(p, 'WORK_PLACE'),
    position: txt(p, 'POSITION'),
    income: txt(p, 'INCOME'),
    hospital: txt(p, 'HOS_NAME'),
    treat_from: dateOnly(txt(p, 'FROM_DATE')),
    treat_to: dateOnly(txt(p, 'TO_DATE')),
    treat_cost: txt(p, 'COST'),
    symptom: txt(p, 'INJURE'),
    wound_level: WOUND_BY_CODE[txt(p, 'WOUNDED_TYPE')] ?? '',
  }));
  report.has_injured = injBlocks.length > 0;

  // ── ทรัพย์สิน ──
  report.damaged_property = assetBlocks.map((a) => ({
    item: txt(a, 'ASSET_DESC'),
    cause: txt(a, 'ASSET_DAMAGE_CAUSE'),
    detail: txt(a, 'ASSET_DAMAGE'),
    estimated_cost: txt(a, 'COST_DAMAGE'),
    owner_name: txt(a, 'OWNER'),
    owner_address: txt(a, 'ADDRESS'),
    owner_phone: txt(a, 'TEL_NO'),
  }));
  report.has_property = assetBlocks.length > 0;

  // ── ความเสียหายรถประกัน: ISURVEY ไม่เคยส่งมา (ยืนยัน 6/6 ไฟล์) ──
  report.insured_damage = [];

  // ── ยอดเงิน (มีเฉพาะไฟล์จาก ISURVEY) ──
  const bill = {
    service_fee_count: numOrNull(txt(billBlock, 'INVEST_NUM')),
    service_fee_price: numOrNull(txt(billBlock, 'SUR_INVEST')),
    travel_fee_count: numOrNull(txt(billBlock, 'TRANS_NUM')),
    travel_fee_price: numOrNull(txt(billBlock, 'SUR_TRANS')),
    photo_fee_count: numOrNull(txt(billBlock, 'PHOTO_NUM')),
    // SUR_PHOTO ในไฟล์ = ยอดรวมค่ารูป · photo_fee_price ของเรา = ราคาต่อรูป (export คูณจำนวนกลับเอง
    // ดู xmlExport.contract "SUR_PHOTO = ยอดรวม") → หารด้วยจำนวนรูป ไม่งั้น round-trip ยอดพอง ×จำนวนรูป
    photo_fee_price: photoUnitPrice(txt(billBlock, 'SUR_PHOTO'), txt(billBlock, 'PHOTO_NUM')),
    phone_fee: numOrNull(txt(billBlock, 'SUR_TEL')),
    bail_fee: numOrNull(txt(billBlock, 'SUR_INSURE')),
    claim_fee_percent: numOrNull(txt(billBlock, 'SUR_PERCENT_CLAIM')),
    claim_fee_price: numOrNull(txt(billBlock, 'SUR_CLAIM')),
    daily_record_fee: numOrNull(txt(billBlock, 'SUR_DAILY')),
    other_fee_price: numOrNull(txt(billBlock, 'SUR_OTHER')),
  };
  const hasMoney = Object.values(bill).some((v) => (v ?? 0) > 0);

  // ── คำเตือนที่ผู้ใช้ต้องเห็นก่อนกดสร้าง ──
  if (!report.claim_ref_no) warnings.push('ไม่มี "เลขที่รับแจ้ง" (ACC_CLAIMREF_NO) — EMCS บังคับช่องนี้ ต้องกรอกก่อนนำเข้า');
  if (!report.survey_job_no) warnings.push('ไม่มีเลขเซอร์เวย์ (SURV_JOBNO) — ใช้กันเคสซ้ำไม่ได้');
  // ⚠️ ถ้อยคำต้องตรงกับที่มาของไฟล์ — ไฟล์ที่สกัดจาก EMCS ไม่ใช่ของ ISURVEY
  // ขึ้นข้อความว่า "ไฟล์ ISURVEY ไม่มี..." กับไฟล์ EMCS จะทำให้คนตรวจเข้าใจผิด
  const src = source === 'emcs_extract' ? 'ไฟล์ที่สกัดจาก EMCS ' : 'ไฟล์ ISURVEY ';
  warnings.push(`${src}ไม่มี "รายการความเสียหาย" (DAMAGE_LIST ว่างเสมอ) — ต้องกรอกความเสียหายเองบนเว็บก่อนนำเข้า EMCS`);
  if (injBlocks.some((p) => txt(p, 'PERSON_TYPE') === 'ON')) {
    warnings.push('ผู้บาดเจ็บบางรายมีรหัส ON — XML แยก "บุคคลภายนอก/ผู้ขับขี่คู่กรณี/ผู้โดยสารคู่กรณี" ไม่ได้ ตรวจประเภทผู้บาดเจ็บอีกครั้ง');
  }
  if (!report.acc_province) warnings.push('อ่านจังหวัดที่เกิดเหตุจากรหัสไม่ได้ — เลือกเองบนหน้าเว็บ');
  if (!report.claim_type) warnings.push('ไม่มี "ประเภทเคลม" (SURV_CLAIM_TYPE) — เลือกเองบนหน้าเว็บ');

  // ── ช่องบังคับของ EMCS ที่ไฟล์ไม่มีค่ามา — เตือนจากลิสต์ที่สกัดอัตโนมัติ ──
  //
  // เดิมเขียนข้อความเตือนทีละบรรทัดด้วยมือ ปัญหาคือถ้า EMCS เพิ่มช่องบังคับใหม่
  // ระบบจะไม่รู้เรื่องเลย เงียบไปจนกว่าคนจะไปเจอว่าบันทึก draft ไม่ผ่าน
  // ตอนนี้ลิสต์มาจาก se-autokey/tools/emcs_spec.py --emit-ts ซึ่งอ่านฟังก์ชัน vlid*
  // ในหน้า EMCS จริง → EMCS เปลี่ยนเมื่อไหร่ รันเครื่องมือใหม่แล้ว commit ไฟล์เดียวจบ
  //
  // ในลิสต์มีเฉพาะช่องที่ **บังคับทุกบริษัทแบบไม่มีเงื่อนไข** — ช่องที่บังคับเฉพาะบางบริษัท
  // (99 ช่อง) หรือมีเงื่อนไข (25 ช่อง) ไม่รวม เพราะตอน parse ยังไม่รู้ว่าเป็นบริษัทไหน
  for (const f of EMCS_REQUIRED) {
    const block = f.block === 'CAR' ? insuredCar : rep;
    if (txt(block, f.tag)) continue;
    warnings.push(`${src}ไม่มี "${f.label}" (${f.tag}) — EMCS บังคับช่องนี้ทุกบริษัท ต้องกรอกเองบนเว็บก่อนนำเข้า`);
  }

  return {
    caseFields: {
      customer_name: String(report.assured_name || ''),
      incident_location: txt(rep, 'ACC_PLACE'),
    },
    report,
    expenses: hasMoney ? bill : null,
    surveyorCode: (txt(rep, 'ACC_SURV').match(/^(SE\d+)/i)?.[1] ?? '').toUpperCase(),
    warnings,
    source,
  };
}
