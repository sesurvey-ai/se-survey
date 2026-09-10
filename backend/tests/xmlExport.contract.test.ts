/**
 * Contract test — สัญญา XML ระหว่าง producer (se-survey) กับ consumer (se-autokey)
 *
 * ล็อกไว้ว่า generateSurveyXml() ต้อง emit "ทุก tag ที่ se-autokey/autokey/surv_xml.py
 * (parse_surv_report) อ่าน" — ครบทั้ง 5 บล็อก: REPORT · รถประกัน(TYPE=0) · คู่กรณี(TYPE=20)
 * · ผู้บาดเจ็บ(TXN_SURV_INJ) · ทรัพย์สิน(TXN_SURV_ASSET)
 *
 * ถ้าฝั่งใดแก้ชื่อ tag/format สัญญานี้จะพัง → เทสฟ้อง (แทนที่จะพังเงียบตอน import จริง)
 * ⚠️ ต้อง sync กับ se-autokey/test_surv_contract.py (ใช้ค่าชุดเดียวกัน)
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import { generateSurveyXml } from '../src/services/xmlExport.service';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}

// ── fixture: รถประกัน + คู่กรณี 1 + ผู้บาดเจ็บ 1 + ทรัพย์สิน 1 (ค่าชุดเดียวกับฝั่ง py) ──
const row: Record<string, unknown> = {
  survey_job_no: 'SETP-CONTRACT-001', claim_no: 'CLAIM-CONTRACT-001', claim_ref_no: 'REF-CONTRACT-001',
  policy_no: 'POL-CONTRACT-001', assured_name: 'บริษัท ทดสอบสัญญา จำกัด', policy_type: '2+',
  policy_start: '23/06/2026', policy_end: '23/06/2027',
  acc_date: '27/06/2026', acc_time: '19:00', acc_place: 'ซอยทดสอบสัญญา',
  acc_province: 'กรุงเทพฯ', acc_district: 'เขตตลิ่งชัน', acc_detail: 'รายละเอียดทดสอบสัญญา',
  acc_fault: 'คู่กรณีผิด', acc_reporter: 'ผู้แจ้งทดสอบ', acc_surveyor: 'SE250 ผู้สำรวจ',
  prb_number: 'PRB-1', claim_type: 'F',
  // รถประกัน
  car_brand: 'TOYOTA', car_type: 'A', car_color: 'น้ำเงิน', car_model: 'VIOS',
  license_plate: 'ษข9066', car_province: 'กรุงเทพ', chassis_no: 'CHASSIS123', engine_no: 'ENGINE123',
  car_reg_year: '2567',
  acc_followup: 'มีการนัดหมาย', acc_followup_count: '2',
  acc_followup_detail: 'นัดดูรถที่อู่', acc_followup_date: '2026-07-01', model_no: 'MDL-123', mileage: 45000, risk_code: 'RISK-01',
  driver_name: 'ผู้ขับ ทดสอบ', driver_title: 'นาย', driver_age: 32,
  driver_relation: 'ลูกจ้าง', driver_address: '37 บุรีรัมย์', driver_province: 'บุรีรัมย์',
  driver_district: 'เมืองบุรีรัมย์', driver_phone: '0999999999', driver_id_card: '1234567890123',
  driver_license_no: 'LIC123', driver_license_type: 'ใบขับขี่รถยนต์ส่วนบุคคล', driver_license_place: 'กรุงเทพ',
  driver_license_start: '01/01/2020', driver_license_end: '01/01/2030', driver_birthdate: '16/05/1994',
  driver_gender: 'ชาย', estimated_cost: 3500,
  // 1:N JSONB
  opposing_parties: [{
    plate: '7ชน807', province: 'กรุงเทพ ฯ', district: 'เขตตลิ่งชัน', vin: 'OPPVIN1', car_type: 'A', car_brand: 'HONDA',
    car_model: 'CITY', reg_year: '2566', car_color: 'ขาว', title: 'นาย', first_name: 'คู่กรณี',
    last_name: 'ทดสอบ', age: 40, gender: 'ชาย', relation: 'เจ้าของรถ', address: 'ที่อยู่คู่กรณี', phone: '0888888888',
    cid: '9876543210987', license_no: 'OPPLIC', license_type: 'ใบขับขี่รถจักรยานยนต์ส่วนบุคคล',
    insurer: 'ไอโออิกรุงเทพประกันภัย',
    policy_no: 'OPPPOL', claim_no: 'OPPCLAIM', policy_type: '1',
  }],
  injured_persons: [{
    name: 'ผู้บาดเจ็บ ทดสอบ', age: 25, cid: '1111111111111', occupation: 'พนักงาน', car_reg: 'ษข9066',
    address: 'ที่อยู่ผู้บาดเจ็บ', phone: '077-777-7777', hospital: 'รพ.ทดสอบ', treat_cost: 5000,
    symptom: 'ฟกช้ำ', gender: 'ชาย', person_type: 'ผู้ขับขี่รถประกัน', wound_level: 'เล็กน้อย',
    // form-carried (bot กรอกฟอร์มเอง — 2026-07-23)
    work_place: 'บริษัท ก จำกัด', position: 'พนักงานขาย', income: 15000,
    treat_from: '27/06/2569', treat_to: '30/06/2569', relation: 'ญาติ',
  }, {
    // คนที่ 2 = ผู้โดยสารรถประกัน → PERSON_TYPE ต้องเป็น PV (ยืนยันจากฟอร์ม EMCS จริง ddlPerson_Type=03)
    name: 'ผู้โดยสาร ทดสอบ', age: 30, cid: '2222222222222', hospital: 'รพ.ทดสอบ', treat_cost: 3000,
    symptom: 'ถลอก', gender: 'หญิง', person_type: 'ผู้โดยสารรถประกัน', wound_level: 'ปานกลาง',
  }],
  damaged_property: [{
    item: 'รั้วบ้าน', detail: 'รั้วหัก', cause: 'ถูกชน', estimated_cost: '2000.00',
    owner_name: 'เจ้าของทรัพย์', owner_address: 'ที่อยู่ทรัพย์', owner_phone: '0666666666',
  }],
};

const xml = generateSurveyXml(row as never);
const has = (tag: string, val: string) => xml.includes(`<${tag}>${val}</${tag}>`);
const tag = (t: string) => new RegExp(`<${t}>`).test(xml);

// โครงหลัก
check('root INSERT_SURV_REPORT_XML', xml.startsWith('<?xml') && xml.includes('<INSERT_SURV_REPORT_XML>'));
check('มี TXN_SURV_CAR 2 บล็อก (รถประกัน + คู่กรณี)', (xml.match(/<TXN_SURV_CAR>/g) || []).length === 2);
check('มี TXN_SURV_INJ 2 บล็อก', (xml.match(/<TXN_SURV_INJ>/g) || []).length === 2);
check('มี TXN_SURV_ASSET 1 บล็อก', (xml.match(/<TXN_SURV_ASSET>/g) || []).length === 1);

// REPORT — tag ที่ consumer/EMCS ต้องใช้
check('REPORT: SURV_JOBNO', has('SURV_JOBNO', 'SETP-CONTRACT-001'));
check('REPORT: REF_CLAIM_NO', has('REF_CLAIM_NO', 'CLAIM-CONTRACT-001'));
check('REPORT: ACC_CLAIMREF_NO', has('ACC_CLAIMREF_NO', 'REF-CONTRACT-001'));
check('REPORT: ACC_POLICY_NO', has('ACC_POLICY_NO', 'POL-CONTRACT-001'));
check('REPORT: ASSURED_NAME', has('ASSURED_NAME', 'บริษัท ทดสอบสัญญา จำกัด'));
check('REPORT: ACC_DETAIL', has('ACC_DETAIL', 'รายละเอียดทดสอบสัญญา'));

// รถประกัน (TYPE=0) — consumer อ่าน gender/title_id/idcard
check('รถประกัน: TYPE=0', has('TYPE', '0'));
check('รถประกัน: CAR_REGNO=ษข9066', has('CAR_REGNO', 'ษข9066'));
check('รถประกัน: CMFG=ATOYOTA (car_type A + brand)', has('CMFG', 'ATOYOTA'));
check('รถประกัน: DRI_CARDID', has('DRI_CARDID', '1234567890123'));
// เพศ → รหัส 1 ตัว (EMCS XML importer บังคับขนาด 1 — ชาย→M, หญิง→F; live import 2026-07-23)
check('รถประกัน/คู่กรณี: DRI_GENDER=M (ชาย→รหัส)', has('DRI_GENDER', 'M'));
check('บาดเจ็บ: GENDER=M (ชาย→รหัส)', has('GENDER', 'M'));
check('บาดเจ็บ: GENDER=F (หญิง→รหัส)', has('GENDER', 'F'));
check('ไม่มีเพศไทยหลุดใน DRI_GENDER/GENDER', !xml.includes('<DRI_GENDER>ชาย') && !xml.includes('<GENDER>ชาย'));
check('รถประกัน: COST_DAMAGE=3500', has('COST_DAMAGE', '3500'));
// tag ที่เพิ่งต่อสาย (gap audit 2026-07-22) — ล็อกไว้ไม่ให้หลุดกลับเป็นว่าง
check('รถประกัน: MODELNO ← model_no', has('MODELNO', 'MDL-123'));
check('รถประกัน: KM_NO ← mileage', has('KM_NO', '45000'));
check('REPORT: RISK_CODE ← risk_code', has('RISK_CODE', 'RISK-01'));

// คู่กรณี (TYPE=20)
check('คู่กรณี: TYPE=20', has('TYPE', '20'));
check('คู่กรณี: CAR_REGNO=7ชน807', has('CAR_REGNO', '7ชน807'));
check('คู่กรณี: CMFG=AHONDA', has('CMFG', 'AHONDA'));
check('คู่กรณี: CTYPECODE=A', has('CTYPECODE', 'A'));
check('คู่กรณี: DRI_NAME', has('DRI_NAME', 'คู่กรณี ทดสอบ'));
check('คู่กรณี: HAVE_INSURANCE=1 (มีประกัน)', has('HAVE_INSURANCE', '1'));
check('คู่กรณี: POLICYNO/CLAIMNO', has('POLICYNO', 'OPPPOL') && has('CLAIMNO', 'OPPCLAIM'));
// อำเภอคู่กรณี (wired ใหม่ 2026-07-22): เขตตลิ่งชัน กรุงเทพ → DRI_DISTRICTID=219 (เดิม hardcode ว่าง)
check('คู่กรณี: DRI_DISTRICTID=219 (เขตตลิ่งชัน)', has('DRI_DISTRICTID', '219'));
// ประเภทใบขับขี่คู่กรณี (bot select_by_value 2026-07-23): จยย.ส่วนบุคคล=20 (≠ insured รถยนต์=19)
check('คู่กรณี: DRI_DRVTYPE=20 (ประเภทใบขับขี่)', has('DRI_DRVTYPE', '20'));

// ผู้บาดเจ็บ (TXN_SURV_INJ) — ข้อ 3: PERSON_TYPE/WOUNDED_TYPE
check('บาดเจ็บ: NAME', has('NAME', 'ผู้บาดเจ็บ ทดสอบ'));
check('บาดเจ็บ: CITIZEN_ID', has('CITIZEN_ID', '1111111111111'));
check('บาดเจ็บ: COST', has('COST', '5000'));
check('บาดเจ็บ: INJURE=ฟกช้ำ', has('INJURE', 'ฟกช้ำ'));
// ⚠️ ค่าล็อกสัญญา — PERSON_TYPE DV/ON + WOUNDED_TYPE 01-06 ยังไม่ได้ยืนยันกับ EMCS export จริงที่มีผู้บาดเจ็บ
check('บาดเจ็บ: PERSON_TYPE=DV (ผู้ขับขี่รถประกัน)', has('PERSON_TYPE', 'DV'));
check('บาดเจ็บ: PERSON_TYPE=PV (ผู้โดยสารรถประกัน) — ยืนยันจากฟอร์มจริง', has('PERSON_TYPE', 'PV'));
check('บาดเจ็บ: WOUNDED_TYPE=01 (เล็กน้อย)', has('WOUNDED_TYPE', '01'));
check('บาดเจ็บ: WOUNDED_TYPE=02 (ปานกลาง)', has('WOUNDED_TYPE', '02'));
// ผู้บาดเจ็บ tag EMCS canonical (ยืนยัน gold reference 2026-07-23): FROM_DATE/TO_DATE/DRI_RELATION_ID
check('บาดเจ็บ: WORK_PLACE ← work_place', has('WORK_PLACE', 'บริษัท ก จำกัด'));
check('บาดเจ็บ: POSITION ← position', has('POSITION', 'พนักงานขาย'));
check('บาดเจ็บ: INCOME ← income', has('INCOME', '15000'));
check('บาดเจ็บ: FROM_DATE ← treat_from (พ.ศ.→ค.ศ.)', has('FROM_DATE', '2026-06-27 00:00:00'));
check('บาดเจ็บ: TO_DATE ← treat_to', has('TO_DATE', '2026-06-30 00:00:00'));
check('บาดเจ็บ: DRI_RELATION_ID=19 (ญาติ, lookup)', has('DRI_RELATION_ID', '19'));

// ทรัพย์สิน (TXN_SURV_ASSET)
check('ทรัพย์สิน: ASSET_DESC=รั้วบ้าน', has('ASSET_DESC', 'รั้วบ้าน'));
check('ทรัพย์สิน: ASSET_DAMAGE=รั้วหัก', has('ASSET_DAMAGE', 'รั้วหัก'));
check('ทรัพย์สิน: COST_DAMAGE=2000', has('COST_DAMAGE', '2000'));
check('ทรัพย์สิน: OWNER', has('OWNER', 'เจ้าของทรัพย์'));

// ── หน่วย/รูปแบบที่ EMCS บังคับ (แก้ 2026-07-25) ──
check('ปีจดทะเบียนรถประกัน: พ.ศ.2567 -> ค.ศ.2024', has('CAR_REGNO_YEAR', '2024'));
check('ปีจดทะเบียนคู่กรณี: พ.ศ.2566 -> ค.ศ.2023',
      xml.includes('<CAR_REGNO_YEAR>2023</CAR_REGNO_YEAR>'));
check('เบอร์ผู้บาดเจ็บ: ตัดขีดเหลือ 10 หลัก (EMCS maxlength=10)', has('TEL_NO', '0777777777'));
check('ค่าเสียหายทรัพย์สิน: 2000.00 -> 2000 (EMCS num() ไม่รับศูนย์ท้าย)',
      has('COST_DAMAGE', '2000'));

// ── การติดตามงาน (เดิม hardcode ว่างทั้งบล็อก) ──
check('ติดตามงาน: FLU_TYPE=Y (มีการนัดหมาย)', has('FLU_TYPE', 'Y'));
check('ติดตามงาน: FLU_NO <- acc_followup_count', has('FLU_NO', '2'));
check('ติดตามงาน: FLU_DETAIL <- acc_followup_detail', has('FLU_DETAIL', 'นัดดูรถที่อู่'));

// ── ตารางค่าใช้จ่าย <TXN_SURV_BILL> (ฝั่งเรียกเก็บบริษัทประกัน) ────────────────
//
// เดิมบล็อกนี้**ไม่มีเทสคุมเลยแม้แต่ตัวเดียว** ทั้งที่เป็นตัวเลขเงินที่วิ่งเข้าระบบประกัน
// (ฝั่งจ่ายพนักงานมี pay.replay.test.ts คุมอยู่แล้ว — ฝั่งเรียกเก็บกลับหลวมกว่า)
//
// สองเคสที่ต้องล็อก:
//   1. ไม่มีแถว survey_expenses (หรือ source ถูกกันไว้) → ต้องได้ **0.00 ทุกช่อง**
//      ไม่ใช่ "ไม่มีบล็อก" — ถ้าวันหน้ามีใครทำให้บล็อกหายไป EMCS importer จะเจอสัญญาคนละแบบ
//   2. มีครบทั้ง 13 ช่อง → ค่าต้องออกตรงทุก tag
console.log('\n── ตารางค่าใช้จ่าย (เรียกเก็บประกัน) ──');

const ZERO_MONEY_TAGS = ['SUR_INVEST', 'SUR_TRANS', 'SUR_PHOTO', 'SUR_OTHER',
  'SUR_TEL', 'SUR_INSURE', 'SUR_CLAIM', 'SUR_DAILY', 'SUR_PERCENT_CLAIM',
  'FUL_INVEST', 'FUL_TRANS', 'FUL_PHOTO'];

// `row` ด้านบนไม่มีคีย์ค่าใช้จ่ายเลย = เคสที่ถูก withInsurerBill กันไว้ / ยังไม่มีใครกรอกราคา
check('บิล: บล็อก <TXN_SURV_BILL> ต้องออกเสมอ แม้ไม่มียอด', xml.includes('<TXN_SURV_BILL>'));
for (const tag of ZERO_MONEY_TAGS) {
  check(`บิลศูนย์: ${tag} = 0.00`, has(tag, '0.00'));
}
for (const tag of ['INVEST_NUM', 'TRANS_NUM', 'PHOTO_NUM']) {
  check(`บิลศูนย์: ${tag} = 0`, has(tag, '0'));
}

// เคสมียอดครบ — ค่าชุดนี้เลียนแบบใบจริง (ค่าบริการ 800 · เดินทาง 300 · รูป 5 บาท × 20)
const billRow: Record<string, unknown> = {
  ...row,
  service_fee_count: 1, service_fee_price: 800,
  travel_fee_count: 1, travel_fee_price: 300,
  photo_fee_count: 20, photo_fee_price: 5,
  phone_fee: 50, bail_fee: 0,
  claim_fee_percent: 0, claim_fee_price: 0,
  daily_record_fee: 200,
  other_fee_detail: 'ค่าทางด่วน', other_fee_price: 60,
};
const billXml = generateSurveyXml(billRow as never);
const billHas = (tag: string, val: string) => billXml.includes(`<${tag}>${val}</${tag}>`);

check('บิลเต็ม: SUR_INVEST = 800.00 (ค่าบริการ)', billHas('SUR_INVEST', '800.00'));
check('บิลเต็ม: SUR_TRANS = 300.00 (ค่าเดินทาง)', billHas('SUR_TRANS', '300.00'));
check('บิลเต็ม: INVEST_NUM = 1', billHas('INVEST_NUM', '1'));
check('บิลเต็ม: TRANS_NUM = 1', billHas('TRANS_NUM', '1'));
check('บิลเต็ม: PHOTO_NUM = 20', billHas('PHOTO_NUM', '20'));
// สัญญากับฝั่งบอท: SUR_PHOTO = **ยอดรวม** (บอทหารด้วย PHOTO_NUM เอง) ไม่ใช่ราคาต่อรูป
check('บิลเต็ม: SUR_PHOTO = 100.00 (ยอดรวม 5 × 20 ไม่ใช่ราคาต่อรูป)',
      billHas('SUR_PHOTO', '100.00'));
check('บิลเต็ม: SUR_TEL = 50.00 ← phone_fee', billHas('SUR_TEL', '50.00'));
check('บิลเต็ม: SUR_INSURE = 0.00 ← bail_fee', billHas('SUR_INSURE', '0.00'));
check('บิลเต็ม: SUR_DAILY = 200.00 ← daily_record_fee', billHas('SUR_DAILY', '200.00'));
check('บิลเต็ม: SUR_OTHER = 60.00 ← other_fee_price', billHas('SUR_OTHER', '60.00'));
check('บิลเต็ม: OTHER_DESC ← other_fee_detail', billHas('OTHER_DESC', 'ค่าทางด่วน'));
// ── 3 ช่องความเห็นบนหน้าค่าใช้จ่าย EMCS ──────────────────────────────────────
// กติกา user 2026-08-12: "ถ้าบน se-survey มีข้อมูล บอทก็จะกรอกบน emcs ด้วย"
// (เดิมส่งค่าว่างทั้ง 3 เพราะหัวหน้ากรอกเองใน EMCS — เปลี่ยนตอนย้ายมาทำงานบนเว็บเราทั้งหมด)
// el() แทนค่าว่างด้วย "ช่องว่าง 1 ตัว" โดยตั้งใจ (ไม่ใช่ tag เปล่า) → เช็คตามรูปแบบนั้น
console.log('\n── 3 ช่องความเห็น (หน้าค่าใช้จ่าย EMCS) ──');
{
  const commentRow: Record<string, unknown> = {
    ...row,
    survey_result: 'สรุปผล:\n- ตรวจสอบแล้ว\n- คู่กรณียอมรับผิด',
    review_comment: 'ความเห็นผู้ตรวจสอบ: เอกสารครบ',
    surveyor_comment: 'ความเห็นเซอร์เวย์: ถ่ายรูปครบทุกมุม',
    notes: 'หมายเหตุที่ไม่ควรถูกใช้เมื่อมี surveyor_comment',
  };
  const cx = generateSurveyXml(commentRow as never);
  const cHas = (t: string, v: string) => cx.includes(`<${t}>${v}</${t}>`);

  check('ACC_RESULT ← survey_result (คงขึ้นบรรทัดใหม่)',
        cHas('ACC_RESULT', 'สรุปผล:\n- ตรวจสอบแล้ว\n- คู่กรณียอมรับผิด'));
  check('ACC_COMMENT ← review_comment', cHas('ACC_COMMENT', 'ความเห็นผู้ตรวจสอบ: เอกสารครบ'));
  check('SURV_COMMENT ← surveyor_comment (ไม่ใช่ notes)',
        cHas('SURV_COMMENT', 'ความเห็นเซอร์เวย์: ถ่ายรูปครบทุกมุม'));

  // SURV_COMMENT ออก 2 ที่ตามสัญญาไฟล์ (ไฟล์จริงของ ISURVEY ก็ 2 ที่) — **ค่าต้องตรงกัน**
  // เดิมบล็อกบนมีค่า บล็อกล่างว่าง → ผลขึ้นกับว่า EMCS อ่านบล็อกไหน
  const survTags = cx.match(/<SURV_COMMENT>[\s\S]*?<\/SURV_COMMENT>/g) ?? [];
  check('SURV_COMMENT ออก 2 ที่ (ตามสัญญาไฟล์เดิม)', survTags.length === 2,
        `พบ ${survTags.length}`);
  check('SURV_COMMENT ทั้ง 2 ที่ค่าตรงกัน', survTags.length === 2 && survTags[0] === survTags[1]);

  // ไม่มีข้อมูล = ส่งว่าง เพื่อให้บอทข้าม ไม่ไปลบของเดิมที่หัวหน้ากรอกไว้ใน EMCS
  for (const tag of ['ACC_RESULT', 'ACC_COMMENT', 'SURV_COMMENT']) {
    check(`ไม่มีข้อมูล: ${tag} ส่งว่าง (บอทจะข้าม ไม่ล้างของเดิมใน EMCS)`,
          billXml.includes(`<${tag}> </${tag}>`));
  }

  // ⛔ notes ("หมายเหตุเพิ่มเติม" ในแอป) ต้อง **ไม่** ไหลไปเป็นความเห็นเซอร์เวย์ —
  //    คนละเรื่องกัน (กติกา user 2026-08-12) · เคยมี fallback นี้ ถูกตัดออกแล้ว ห้ามใส่กลับ
  const nx = generateSurveyXml({ ...row, notes: 'หมายเหตุเพิ่มเติมจากแอป' } as never);
  check('notes ต้องไม่กลายเป็น SURV_COMMENT (ไม่มี fallback แล้ว)',
        !nx.includes('หมายเหตุเพิ่มเติมจากแอป'));
  check('ไม่มี surveyor_comment → SURV_COMMENT ว่าง แม้จะมี notes',
        (nx.match(/<SURV_COMMENT> <\/SURV_COMMENT>/g) ?? []).length === 2);
}

// ── การ์ดกันเงิน 2 ฝั่งปนกัน ────────────────────────────────────────────────
//
// `survey_expenses` (เรียกเก็บประกัน) กับ `survey_pay` (จ่ายพนักงาน) มีคอลัมน์ชื่อซ้ำกัน
// เป๊ะ 2 ตัว: phone_fee · bail_fee ซึ่งไปเป็น SUR_TEL / SUR_INSURE พอดี
// ถ้าวันหน้ามีใครเปลี่ยน withInsurerBill กลับไป `SELECT *` หรือ join ตารางค่าจ้างพนักงาน
// เข้ามา ค่าจ้างจะกลายเป็นบิลเรียกเก็บประกันโดยไม่มี error ใด ๆ — เทสรันไทม์จับไม่ได้
// เพราะ withInsurerBill ต้องต่อฐานข้อมูล → ตรวจที่ตัวซอร์สแทน (สไตล์เดียวกับ
// se-autokey/test_smoke.py) และ**จำกัดขอบเขตเฉพาะตัวฟังก์ชัน** ไม่ใช่ทั้งไฟล์
// เพื่อไม่ให้พังมั่วเวลามีคนเพิ่มโค้ดที่ไม่เกี่ยวในไฟล์เดียวกัน
console.log('\n── การ์ด: เงินฝั่งพนักงานต้องไม่หลุดเข้าบิลประกัน ──');
{
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'case.service.ts'), 'utf8');
  const start = src.indexOf('const BILLABLE_SOURCES');
  const end = src.indexOf('export const caseService');
  const block = start >= 0 && end > start ? src.slice(start, end) : '';
  // ตัดคอมเมนต์ออกก่อนตรวจ — คอมเมนต์ของบล็อกนี้**อธิบายเรื่อง survey_pay อยู่แล้ว**
  // ถ้าไม่ตัด การ์ดจะจับคำอธิบายของตัวเองแล้วแดงตลอด
  const fn = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  check('พบบล็อก withInsurerBill ในซอร์ส', block.length > 0,
        'ถ้าล้มแปลว่าเปลี่ยนชื่อ/ย้ายฟังก์ชัน — อัปเดตเทสนี้ด้วย');
  check("allow-list มี 'isurvey_xml'", fn.includes("'isurvey_xml'"));
  check("allow-list มี 'mobile'", fn.includes("'mobile'"));
  // ดึงสดจาก ISURVEY ตอน "รอตรวจข้อมูล" — หัวหน้ากรอกยอดบนเว็บเรา ยอดต้องไหลเข้า EMCS
  // ตกลิสต์นี้เมื่อไหร่ = บิลกลายเป็น 0.00 ทั้งบล็อกโดยไม่มี error อะไรฟ้อง
  check("allow-list มี 'isurvey_live'", fn.includes("'isurvey_live'"));
  check("allow-list ต้อง**ไม่**มี 'emcs_extract' (ข้อมูลทดสอบ เลขของประกันเอง)",
        !fn.includes("'emcs_extract'"));
  check('⛔ ห้ามแตะ survey_pay ในเส้นทางบิลประกัน (คนละฝั่งเงิน)',
        !fn.includes('survey_pay'));
  check('⛔ ห้าม SELECT * จาก survey_expenses (phone_fee/bail_fee ชนกับ survey_pay)',
        !/SELECT\s+\*\s+FROM\s+survey_expenses/i.test(fn));
}

// ── ประเภทกรมธรรม์ → รหัส (ครบ 8 ค่าตามตาราง masterPolicyType ของ ISURVEY) ─────
// EMCS เก็บช่องนี้เป็น "รหัส" (เคสจริง 000098 = '01') และ XML ที่ ISURVEY ส่งเข้า EMCS
// มาตลอดก็เป็นรหัส (ตรวจไฟล์จริง 7 ใบ เจอ 01/02/03/52) — คำที่แปลงไม่ออกจะหลุดดิบเข้าไป
{
  const codeOf = (v: string) => {
    const x = generateSurveyXml({ ...row, policy_type: v, opposing_parties: [], injured_persons: [], damaged_property: [] } as never);
    return (x.match(/<POLICY_TYPE>([^<]*)<\/POLICY_TYPE>/) || [])[1] ?? '';
  };
  const TABLE: Array<[string, string]> = [
    ['ประเภท 1', '01'], ['ประเภท 2', '02'], ['ประเภท 3', '03'], ['พรบ.', '04'],
    ['ประเภท 5', '05'], ['ไม่พบความคุ้มครอง', '10'], ['ประเภท 2+', '52'], ['ประเภท 3+', '53'],
  ];
  for (const [label, code] of TABLE)
    check(`ประเภทกรมธรรม์: '${label}' → ${code}`, codeOf(label) === code, codeOf(label));
  // คำเก่าที่ยังค้างใน DB (ก่อนเปลี่ยนเป็น dropdown 30/08/69) ต้องแปลงได้ด้วย
  const OLD: Array<[string, string]> = [['ชั้น 1', '01'], ['ชั้น 2+', '52'], ['ชั้น 3+', '53'], ['2+', '52']];
  for (const [label, code] of OLD)
    check(`ประเภทกรมธรรม์ (คำเก่า): '${label}' → ${code}`, codeOf(label) === code, codeOf(label));
  // ⛔ คำนอกลิสต์ห้ามถูกเดา — ส่งดิบไปให้คนเห็นดีกว่าส่งรหัสผิดเงียบ ๆ
  check('ประเภทกรมธรรม์: คำนอกลิสต์ส่งดิบ ไม่เดารหัส', codeOf('2EXTRA') === '2EXTRA', codeOf('2EXTRA'));
  // ⚠️ tag ว่างของไฟล์นี้เป็น "เว้นวรรค 1 ตัว" ไม่ใช่ค่าว่างจริง (แบบเดียวกับทุก tag
  //    และตรงกับ XML จริงของ ISURVEY) — บอทจะข้ามช่องนี้ ไม่ไปล้างของเดิมใน EMCS
  check('ประเภทกรมธรรม์: ว่าง → ไม่เดารหัสให้ (tag ว่าง)', codeOf('').trim() === '', JSON.stringify(codeOf('')));
}

// ⛔ ลิสต์บนเว็บต้องตรงกับ key ในตารางแปลง — ไม่ตรง = เลือกจาก dropdown แล้วได้ข้อความดิบ
{
  const opts = fs.readFileSync('../web/src/components/cases/caseOptions.ts', 'utf8');
  const listBlock = (opts.match(/export const POLICY_TYPE_OPTIONS = \[([\s\S]*?)\];/) || [])[1] ?? '';
  const list = [...listBlock.matchAll(/'([^']+)'/g)].map(m => m[1]).filter(v => !v.startsWith('--'));
  const src = fs.readFileSync('src/services/xmlExport.service.ts', 'utf8');
  const map = (src.match(/const POLICY_TYPE_CODE[^{]*\{([\s\S]*?)\n\};/) || [])[1] ?? '';
  check('ลิสต์เว็บมี 8 ค่า', list.length === 8, String(list.length));
  for (const v of list)
    check(`ลิสต์เว็บ '${v}' มีในตารางแปลง`, map.includes(`'${v}':`));

  // ⛔ ลิสต์มือถือต้องเป็นชุดเดียวกับเว็บเป๊ะ — ต่างกันเมื่อไหร่ ช่างเลือกค่าที่หัวหน้า
  //    เลือกไม่ได้ (หรือกลับกัน) แล้วค่าที่แปลงไม่ออกจะหลุดดิบเข้า EMCS
  const dart = fs.readFileSync('../mobile/lib/data/survey_master.dart', 'utf8');
  const dartBlock = (dart.match(/const List<String> kPolicyTypes = \[([\s\S]*?)\];/) || [])[1] ?? '';
  const mobileList = [...dartBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
  check('ลิสต์มือถือ = ลิสต์เว็บ (ไม่นับ placeholder)',
        JSON.stringify(mobileList) === JSON.stringify(list),
        `มือถือ ${mobileList.length} / เว็บ ${list.length}`);
}

// ── DRI_AGE ต้องเป็นตัวเลขล้วน — "-" ทำ EMCS ปัดตกทั้งไฟล์ (เคส #282 10/09/69 "รถคู่กรณีคันที่ 20" = TYPE 20) ──
{
  const opp = (age: unknown, birthdate: unknown) => {
    const x = generateSurveyXml({ ...row, opposing_parties: [{ ...(row.opposing_parties as any[])[0], age, birthdate }] } as never);
    const cars = [...x.matchAll(/<TXN_SURV_CAR>([\s\S]*?)<\/TXN_SURV_CAR>/g)].map((m) => m[1]);
    const o = cars.find((c) => c.includes('<TYPE>20</TYPE>')) ?? '';
    return (o.match(/<DRI_AGE>(.*?)<\/DRI_AGE>/) || [])[1] ?? null;
  };
  check('อายุ "-" + วันเกิดจริง → คิดอายุจากวันเกิดเป็นตัวเลข', /^\d{1,3}$/.test(String(opp('-', '20/02/2527'))), `ได้ ${opp('-', '20/02/2527')}`);
  // user เคาะ 10/09/69: วันเกิด "-" → วันนี้ · อายุ → 0 (EMCS บังคับทั้งคู่ คู่กรณี "รอตรวจสอบ" ไม่มีข้อมูลจริง)
  check('อายุ "-" + วันเกิด "-" → อายุ 1 (EMCS ไม่รับ 0 และไม่รับ "-")', String(opp('-', '-')).trim() === '1', `ได้ ${JSON.stringify(opp('-', '-'))}`);
  {
    const x = generateSurveyXml({ ...row, opposing_parties: [{ ...(row.opposing_parties as any[])[0], age: '-', birthdate: '-' }] } as never);
    const o = [...x.matchAll(/<TXN_SURV_CAR>([\s\S]*?)<\/TXN_SURV_CAR>/g)].map((m) => m[1]).find((c) => c.includes('<TYPE>20</TYPE>')) ?? '';
    const bd = (o.match(/<DRI_BIRTHDAY>(.*?)<\/DRI_BIRTHDAY>/) || [])[1] ?? '';
    const t = new Date(); const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} 00:00:00`;
    check('วันเกิด "-" → DRI_BIRTHDAY = วันนี้ (ค.ศ.)', bd === today, `ได้ ${bd}`);
  }
  check('อายุตัวเลขปกติยังส่งตรง ๆ', opp(40, '') === '40');
}

console.log(`\n${failed === 0 ? '✅ ผ่านทั้งหมด' : `❌ ล้มเหลว ${failed} รายการ`}`);
process.exit(failed === 0 ? 0 : 1);
