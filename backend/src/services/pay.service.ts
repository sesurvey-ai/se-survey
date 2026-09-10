import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { assertReportRev } from './reportRev';
import { recordMoneyChanges } from './moneyAudit';

/**
 * คิดค่าตอบแทนผู้สำรวจ (ฝั่งจ่ายพนักงาน) — พอร์ตจาก se-billing `content.js`
 *
 * ⚠️ **โค้ดคิดเงิน** — แก้แล้วต้องรัน `pay.replay.test.ts` ให้ผ่านทุกแถวก่อนเสมอ
 * เทสนั้นเล่นซ้ำ capture จริง 32 แถวจากระบบเดิม ถ้าผลต่างแม้บาทเดียวคือพอร์ตพลาด
 *
 * กติกาที่ยืนยันจาก capture จริงแล้ว:
 *   sur_invest = เรทฐาน + นอกพื้นที่ + นอกเวลา − หักเงิน
 *   ins_invest = mtype 1,2 → ins_invest_12 · mtype 3,4 → ins_invest_34
 *   ins_photo  = คิดเฉพาะ mtype 1,2 (3,4 ไม่มีค่ารูป)
 *
 * ⚠️ ยอด "นอกพื้นที่/นอกเวลา" **แก้เป็นตัวเลขอื่นได้** ไม่ใช่ค่าคงที่จาก settings เสมอ
 *    (capture id 18 ใส่ 80 แทน default 50) — ค่าใน settings เป็นแค่ค่าตั้งต้นให้ผู้ตรวจ
 */

export type MType = '1' | '2' | '3' | '4';

export interface PayInput {
  provinceId?: string | null;
  amphurId?: string | null;
  /** ตำบล — มีผลเฉพาะ 2 ตำบลที่จ่ายไม่เท่าอำเภอแม่ (บ่อวิน · พลูตาหลวง) */
  tumbonId?: string | null;
  mtypeId?: MType | string | null;
  /** ทีมของผู้สำรวจ (มาจากรหัส SEC) — บางอำเภอจ่ายไม่เท่ากันตามทีม */
  team?: string | null;
  /** false = OSS/outsource → ไม่คิดค่าตอบแทนให้ ปล่อยผู้ตรวจกรอกเอง */
  isSE?: boolean;
  outOfArea?: number | null;
  outOfHours?: number | null;
  /** หักเงิน (ส่งค่าบวก ระบบลบให้เอง) */
  deduct?: number | null;
}

export interface PayResult {
  surInvest: number | null;
  insInvest: number | null;
  insTrans: number | null;
  insPhoto: number | null;
  /** เก็บลง survey_pay.rate_snapshot — ตารางเรทไม่มีประวัติ ตัวนี้คือหลักฐานเดียว */
  snapshot: Record<string, unknown>;
}

export interface RateRow {
  sur_invest?: number | null;
  ins_invest_12?: number | null;
  ins_invest_34?: number | null;
  ins_trans?: number | null;
  ins_photo_12?: number | null;
  sur_invest_by_team?: Record<string, number> | null;
  ins_trans_by_team?: Record<string, number> | null;
}

/** เรทที่หามาแล้ว — แยกจากการ query เพื่อให้ทดสอบส่วนคำนวณได้โดยไม่ต้องต่อฐานข้อมูล */
export interface ResolvedRates {
  amphur?: RateRow | null;
  tumbon?: RateRow | null;
  province?: { sur_invest: number } | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** เรทรายทีมเก็บเป็น JSON {"ชื่อทีม": เรท} — ไม่มีทีม/ทีมไม่อยู่ในนั้น = ใช้ค่า flat แทน */
const byTeam = (map: Record<string, number> | null, team?: string | null): number | null => {
  if (!map || !team) return null;
  return pos(num(map[team]));
};

/**
 * เรทฐานฝั่งพนักงาน **0 = ไม่มีเรท** ไม่ใช่ "ศูนย์บาท" — เรทสำรองระดับจังหวัด 21/25 ตั้งไว้ 0 (audit 01/09/69)
 * เดิมระบบตอบ "แนะนำค่าบริการ 0 บาท" อย่างมั่นใจ แล้วช่องค่าบริการก็ว่างเงียบ ๆ (user เจอ #267 10/09/69:
 * ศรีราชาจ่ายแยกตามทีม ช่างไม่มีทีม → ตกไปเรทจังหวัดชลบุรี = 0) · ตอนนี้ 0 = null ให้หน้าเว็บบอกสาเหตุแทน
 */
const pos = (v: number | null): number | null => (v !== null && v > 0 ? v : null);

/** รหัสผู้สำรวจ → ทีม · รับได้ทั้ง "SEC125" และ "SEC125 นายสมภพ ปั้นเปรื่อง" */
export async function teamOfSurveyor(codeOrName: string): Promise<string | null> {
  const m = /\b(SEC\d+)\b/i.exec(codeOrName || '');
  if (!m) return null;
  const r = await db.query(
    'SELECT team FROM billing_surveyor_teams WHERE sec_code = $1', [m[1].toUpperCase()]);
  return (r.rows[0] as { team?: string } | undefined)?.team ?? null;
}

/**
 * คิดยอด — ลำดับการหาเรท: ตำบลพิเศษ → อำเภอ → จังหวัด
 *
 * ตำบลพิเศษไม่มีคอลัมน์ `sur_invest` แบบ flat มีแต่รายทีม — ถ้าทีมไม่ตรงจะตกไปใช้ของอำเภอแม่
 */
export async function calcPay(input: PayInput): Promise<PayResult> {
  return computePay(await loadRates(input), input);
}

/** ดึงเรทที่เกี่ยวข้องกับงานนี้จากฐานข้อมูล */
export async function loadRates(input: PayInput): Promise<ResolvedRates> {
  const [amphur, tumbon, province] = await Promise.all([
    input.amphurId
      ? db.query('SELECT * FROM billing_amphur_rates WHERE amphur_id = $1', [input.amphurId])
      : null,
    input.tumbonId
      ? db.query('SELECT * FROM billing_tumbon_rates WHERE tumbon_id = $1', [input.tumbonId])
      : null,
    input.provinceId
      ? db.query(
          'SELECT sur_invest FROM billing_province_rates WHERE province_id = $1', [input.provinceId])
      : null,
  ]);
  return {
    amphur: (amphur?.rows[0] as RateRow | undefined) ?? null,
    tumbon: (tumbon?.rows[0] as RateRow | undefined) ?? null,
    province: (province?.rows[0] as { sur_invest: number } | undefined) ?? null,
  };
}

/**
 * ส่วนคำนวณล้วน ไม่แตะฐานข้อมูล — `pay.replay.test.ts` เรียกตัวนี้โดยตรง
 * จึงเล่นซ้ำ capture เก่า 32 แถวได้โดยไม่ต้องต่อ production
 */
export function computePay(rates: ResolvedRates, input: PayInput): PayResult {
  const mtype = String(input.mtypeId ?? '');
  const is12 = mtype === '1' || mtype === '2';
  const team = input.team ?? null;
  const { amphur, tumbon, province } = rates;

  // เรทฐานฝั่งพนักงาน — ไล่จากเจาะจงที่สุดไปกว้างที่สุด (0 ทุกชั้น = ไม่มีเรท ดู pos())
  const base =
    byTeam(tumbon?.sur_invest_by_team ?? null, team) ??
    byTeam(amphur?.sur_invest_by_team ?? null, team) ??
    pos(num(amphur?.sur_invest)) ??
    pos(num(province?.sur_invest));
  /**
   * พื้นที่นี้จ่ายพนักงาน "แยกตามทีม" แต่หาเรทไม่ได้ = ช่างคนนี้ไม่ได้อยู่ในทีมไหนเลย (ตาราง billing_surveyor_teams
   * มีแค่ 13 รหัสจากช่าง SEC 150+ คน) — ส่งชื่อทีมที่พื้นที่นี้รู้จักไปให้หน้าเว็บบอกแอดมินว่าต้องไปกำหนดทีมที่
   * "เรทค่าตอบแทน › ทีมผู้สำรวจ" ไม่ใช่ปล่อยช่องว่างเฉย ๆ ให้เดาสาเหตุ (user เจอ #267 10/09/69)
   */
  const teamMap = tumbon?.sur_invest_by_team ?? amphur?.sur_invest_by_team ?? null;
  const teamRates = teamMap ? Object.keys(teamMap).filter((k) => pos(num(teamMap[k])) !== null) : [];
  const teamNeeded = base === null && teamRates.length > 0;

  // ฝั่งเรียกเก็บประกัน — ตำบลพิเศษทับของอำเภอแม่ได้ทุกช่อง
  const src = tumbon ?? amphur;
  const insInvest = is12 ? num(src?.ins_invest_12) : num(src?.ins_invest_34);
  const insTrans = byTeam(src?.ins_trans_by_team ?? null, team) ?? num(src?.ins_trans);
  const insPhoto = is12 ? num(src?.ins_photo_12) : null;

  const outArea = num(input.outOfArea) ?? 0;
  const outHours = num(input.outOfHours) ?? 0;
  const deduct = num(input.deduct) ?? 0;

  // OSS/outsource คิดเรทคนละกติกา ระบบไม่รู้ → ไม่เดา ปล่อยผู้ตรวจกรอกเอง
  const surInvest =
    input.isSE === false || base === null ? null : base + outArea + outHours - deduct;

  return {
    surInvest,
    insInvest,
    insTrans,
    insPhoto,
    snapshot: {
      amphur_id: input.amphurId ?? null,
      tumbon_id: input.tumbonId ?? null,
      province_id: input.provinceId ?? null,
      mtype_id: mtype || null,
      team,
      is_se: input.isSE !== false,
      base_rate: base,
      out_of_area: outArea || null,
      out_of_hours: outHours || null,
      deduct: deduct || null,
      // ที่มาของเรทฐาน — ไว้อธิบายตอนถูกถามว่าทำไมได้ยอดนี้
      rate_from: byTeam(tumbon?.sur_invest_by_team ?? null, team) !== null ? 'tumbon_by_team'
        : byTeam(amphur?.sur_invest_by_team ?? null, team) !== null ? 'amphur_by_team'
        : pos(num(amphur?.sur_invest)) !== null ? 'amphur_flat'
        : pos(num(province?.sur_invest)) !== null ? 'province' : 'ไม่พบเรท',
      // หาเรทไม่ได้เพราะช่างไม่มีทีม (พื้นที่จ่ายแยกทีม) — ทีมที่พื้นที่นี้รู้จัก ไว้บอกแอดมิน
      team_needed: teamNeeded,
      team_rates: teamRates,
    },
  };
}

// ────────────────── ผูกกับเคสจริง ──────────────────

import { amphurCode, provinceCode, tumbonCode } from './areaCode.service';

/** ช่องรายรับฝั่งพนักงาน (บวกเข้ายอดรวม) — ชื่อคีย์ตรงกับคอลัมน์ใน survey_pay */
export const PAY_MONEY_FIELDS = [
  'service_fee', 'travel_fee', 'photo_fee', 'phone_fee',
  'bail_fee', 'claim_fee', 'daily_fee', 'other_fee',
] as const;

/**
 * หักเงิน — **แยกช่องกับ "ค่าใช้จ่ายอื่นๆ" แล้ว**
 *
 * ระบบเดิมยัดสองเรื่องนี้ไว้ช่องเดียวเพราะส่วนขยายแทรกช่องใหม่ลงฟอร์มระบบเก่าไม่ได้
 * ผลคือกรอกรายจ่ายอื่นจริง ๆ ไม่ได้เลย · เว็บนี้เราคุมเอง จึงแยกให้ถูกความหมาย
 * เก็บเป็นค่าบวก แล้วลบตอนรวมยอด
 */
export const PAY_DEDUCT_FIELD = 'deduct_fee';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * ยอดที่ระบบแนะนำสำหรับเคสนี้ + ยอดที่บันทึกไว้แล้ว
 *
 * แยก "แนะนำ" ออกจาก "บันทึกแล้ว" เพราะผู้ตรวจต้องเห็นว่าตัวเองแก้จากค่าที่ระบบคิดไปเท่าไหร่
 * — ถ้ากลืนเป็นค่าเดียวกันจะไม่มีใครรู้ว่ายอดถูกปรับมือหรือเปล่า
 */
/**
 * พื้นที่/ประเภทเคลม "ที่กำลังเลือกบนหน้า" ใช้แทนค่าที่บันทึกไว้ — หน้าเคสส่งมาตอนหัวหน้าเปลี่ยนจังหวัด/อำเภอ/ตำบล
 * (user เจอ #252 09/09/69: เลือกตำบลบ่อวินแล้วเรทแนะนำยังเป็นของอำเภอ เพราะคิดจากรายงานที่บันทึกไว้ก่อนหน้า
 * → ต้องพิมพ์ 500/600 เอง) · ค่าว่าง = ใช้ที่บันทึกไว้
 */
export interface PayLocationOverride {
  province?: string | null; district?: string | null; subdistrict?: string | null; claim_type?: string | null;
  /** ชุดที่ส่งมาคือ 'survey' (สถานที่ออกตรวจสอบ) หรือ 'accident' (สถานที่เกิดเหตุ) — ใช้บอกในบรรทัดเรทเท่านั้น */
  location?: string | null;
}

export type RateLocation = 'survey' | 'accident';

/** ค่าจาก select ที่ยังไม่เลือก ('-- ระบุ --' / '-- เขต --' / '0') ถือเป็นว่าง */
const cleanArea = (v?: string | null): string | undefined => {
  const s = String(v ?? '').trim();
  return !s || s === '0' || s.startsWith('--') ? undefined : s;
};

/**
 * พื้นที่ที่ใช้หาเรท = **สถานที่ออกตรวจสอบ** ก่อน (survey_province/district/subdistrict — ISURVEY "จังหวัด/เขต-อำเภอ/ตำบล
 * ที่ตรวจสอบ" ชุดเดียวกับที่ extension se-billing ใช้หาเรทบน ISURVEY) ไม่มีค่อยถอยไปใช้สถานที่เกิดเหตุ
 * (งานมือถือ/XML ไม่มีสถานที่ออกตรวจสอบ) — ใช้ทั้งชุด ไม่ผสมจังหวัดชุดหนึ่งกับอำเภออีกชุด
 * (user เคาะ 09/09/69 กับเคลม 2026013072661: เกิดเหตุ กทม./สวนหลวง แต่ช่างออกตรวจที่ ชลบุรี/บางละมุง → เรทต้องเป็นของบางละมุง)
 */
export function rateLocationOf(r: {
  survey_province?: string | null; survey_district?: string | null; survey_subdistrict?: string | null;
  acc_province?: string | null; acc_district?: string | null; acc_subdistrict?: string | null;
}): { province?: string; district?: string; subdistrict?: string; from: RateLocation } {
  if (cleanArea(r.survey_province)) {
    return { province: cleanArea(r.survey_province), district: cleanArea(r.survey_district),
             subdistrict: cleanArea(r.survey_subdistrict), from: 'survey' };
  }
  return { province: cleanArea(r.acc_province), district: cleanArea(r.acc_district),
           subdistrict: cleanArea(r.acc_subdistrict), from: 'accident' };
}

export async function getCasePay(caseId: number, override: PayLocationOverride = {}) {
  const saved = (await db.query('SELECT * FROM survey_pay WHERE case_id = $1', [caseId])).rows[0] ?? null;

  const r = (await db.query(
    `SELECT sr.acc_province, sr.acc_district, sr.acc_subdistrict,
            sr.survey_province, sr.survey_district, sr.survey_subdistrict,
            sr.acc_surveyor, sr.claim_type, c.source,
            (SELECT count(*) FROM survey_photos sp WHERE sp.report_id = sr.id) AS photo_count
       FROM survey_reports sr
       JOIN cases c ON c.id = sr.case_id
      WHERE sr.case_id = $1`, [caseId])).rows[0] as
    | { acc_province?: string; acc_district?: string; acc_subdistrict?: string;
        survey_province?: string; survey_district?: string; survey_subdistrict?: string; acc_surveyor?: string;
        claim_type?: string; photo_count?: string; source?: string }
    | undefined;

  if (!r) return { saved, suggest: null, area: null };

  const pick = (o?: string | null, fallback?: string | null): string | undefined => {
    const v = String(o ?? '').trim();
    return v ? v : (fallback ?? undefined);
  };
  /**
   * ชุดพื้นที่ที่ใช้หาเรท — หน้าเว็บส่งจังหวัดมา = ใช้ชุดที่ส่งมา**ทั้งชุด** (อำเภอ/ตำบลว่างได้) ไม่ผสมกับที่บันทึกไว้
   * (เดิมเติมทีละช่อง → เอาติ๊กตำบลออกบนหน้าแล้วเรทยังเป็นตำบลเดิมจนกว่าจะบันทึก) · ไม่ส่งมา = ที่บันทึกไว้
   * โดยเอาสถานที่ออกตรวจสอบก่อน สถานที่เกิดเหตุรอง (rateLocationOf — user เคาะ 09/09/69)
   */
  const fromPage = Boolean(cleanArea(override.province));
  const savedLoc = rateLocationOf(r);
  const rateProvince = fromPage ? cleanArea(override.province) : savedLoc.province;
  const rateDistrict = fromPage ? cleanArea(override.district) : savedLoc.district;
  const rateSubdistrict = fromPage ? cleanArea(override.subdistrict) : savedLoc.subdistrict;
  const rateLocation: RateLocation = fromPage ? (override.location === 'survey' ? 'survey' : 'accident') : savedLoc.from;
  const claimType = pick(override.claim_type, r.claim_type);

  const province = provinceCode(rateProvince);
  const amphur = amphurCode(rateProvince, rateDistrict);
  /**
   * ตำบลพิเศษ (บ่อวิน / พลูตาหลวง — เรทรายทีมสูงกว่าอำเภอแม่) — เดิมไม่เคยส่ง tumbonId ให้ calcPay
   * แม้ตารางเรทมีข้อมูลและ computePay รองรับ → ระบบแนะนำเรทอำเภอ 400 ทั้งที่บ่อวินทีมศรีราชาต้อง 500
   * (user เจอเคส #252 09/09/69 หลังเลือกตำบลบ่อวินแล้วเรทไม่เปลี่ยน) · จับคู่จากชื่อตำบลในรายงาน
   */
  const tumbon = tumbonCode(rateProvince, rateDistrict, rateSubdistrict);
  const team = r.acc_surveyor ? await teamOfSurveyor(r.acc_surveyor) : null;

  // ประเภทเคลมในระบบเราเป็นตัวอักษร (F/D/A/C) แต่ตารางเรทคิดตามเลข 1-4 ของระบบเดิม
  // F = เคลมสด · D = เคลมแห้ง · ที่เหลือถือเป็นกลุ่มติดตาม/อื่น ๆ
  const mtypeId = ({ F: '1', D: '2', A: '3', C: '4' } as Record<string, string>)[claimType ?? ''] ?? '1';

  const pay = await calcPay({
    provinceId: province, amphurId: amphur, tumbonId: tumbon, mtypeId, team,
    isSE: true,
    outOfArea: saved?.out_of_area ? Number(saved.out_of_area_amt ?? 50) : null,
    outOfHours: saved?.out_of_hours ? Number(saved.out_of_hours_amt ?? 100) : null,
  });

  /**
   * ⛔ ยอดที่แนะนำต้องเป็น **เรทฐานล้วน** ไม่รวมตัวปรับ (user เคาะ 19/08/69)
   *
   * เดิมส่ง `pay.surInvest` ซึ่งเป็นยอดรวมทั้งงาน (ฐาน + นอกพื้นที่ + นอกเวลา − หัก)
   * แต่หน้าเว็บเอาไปแปะข้างช่อง "ค่าบริการ" ว่า "ระบบแนะนำค่าบริการ N บาท"
   * → หัวหน้าพิมพ์ N ลงช่องค่าบริการ → saveCasePay บวกนอกพื้นที่/นอกเวลาเข้าไป**อีกรอบ**
   * → ใบเบิกเงินเกินจริง 50-150 บาท/งาน
   * เรทฐานล้วนตรงกับทั้งสูตรรวมยอดและคอลัมน์แยกของใบเบิกเงิน (payExport)
   */
  const baseRate = pay.snapshot?.base_rate;
  /**
   * ── เรทฝั่งเรียกเก็บประกัน ──
   *
   * ตารางเรทมีข้อมูลฝั่งนี้ครบ 337/337 อำเภอ แต่เดิมคำนวณแล้วทิ้ง ไม่เคยส่งให้หน้าเว็บ
   * → หัวหน้าพิมพ์มือทุกช่องทุกเคส ทั้งที่ระบบรู้คำตอบอยู่แล้ว (user สั่งเปิดใช้ 01/09/69)
   *
   * ⛔ **ไม่เสนอกับงานที่นำเข้าจากไฟล์ ISURVEY** — ยอดกรอกจบที่ต้นทางแล้วและติดมากับไฟล์
   *    เติมทับ = เขียนทับของจริง (กติกาเดียวกับค่ารูปเหมา ดู case.service.ts)
   * ⛔ ค่ารูปไม่อยู่ในนี้ — มีกติกาเหมาของตัวเองที่ user เคาะไว้แล้ว (photoFee.service)
   *    ins_photo_12 ในตารางเป็นคนละฐานกัน อย่าเอามาปนโดยไม่ได้ตรวจสอบก่อน
   */
  const fromIsurveyFile = r.source === 'isurvey_xml';
  return {
    saved,
    suggest: {
      service_fee: pay.surInvest === null ? null : (typeof baseRate === 'number' ? baseRate : null),
      ins_service_fee: fromIsurveyFile ? null : pay.insInvest,
      ins_travel_fee: fromIsurveyFile ? null : pay.insTrans,
      snapshot: pay.snapshot,
    },
    area: {
      province_code: province, amphur_code: amphur, tumbon_code: tumbon, team,
      province_name: rateProvince ?? null, district_name: rateDistrict ?? null,
      subdistrict_name: rateSubdistrict ?? null,
      // พื้นที่นี้มาจากไหน — 'survey' = สถานที่ออกตรวจสอบ · 'accident' = สถานที่เกิดเหตุ (เคสไม่มีสถานที่ออกตรวจสอบ)
      rate_location: rateLocation,
      // รหัสช่างที่ใช้หาทีม (SEC…) — หน้าเว็บใช้บอกว่า "ช่างรหัสนี้ยังไม่ได้กำหนดทีม"
      surveyor_code: /\b(SEC\d+)\b/i.exec(r.acc_surveyor ?? '')?.[1]?.toUpperCase() ?? null,
      // แปลงพื้นที่ไม่ได้ = หาเรทไม่เจอ → หน้าเว็บต้องบอกให้ไปแก้ชื่อจังหวัด/อำเภอก่อน
      resolved: Boolean(amphur || province),
      photo_count: Number(r.photo_count ?? 0),
    },
  };
}

export interface SavePayInput {
  out_of_area?: boolean; out_of_area_amt?: number | null;
  out_of_hours?: boolean; out_of_hours_amt?: number | null;
  special_tumbon?: boolean;
  daily_check?: string | null;
  deduct_late?: boolean; deduct_docs?: boolean; deduct_reason?: string | null;
  other_reason?: string | null;
  [k: string]: unknown;
}

/**
 * ยอดจ่ายพนักงานกรอกได้ทุกที่มาของงาน (user เคาะ 18/08/69)
 *
 * เดิมเป็น allowlist `PAY_EDITABLE_SOURCES = ['mobile','isurvey_live']` ด้วยเหตุผลว่า
 * งานจากระบบเดิมกรอกยอดไปแล้วที่ต้นทางและเก็บไว้ที่ se-billing → กรอกซ้ำที่นี่จะได้ยอด 2 ชุด
 *
 * เอาเข้าจริงหัวหน้าต้องกรอกยอดที่นี่ได้ทุกงาน — **EMCS ไม่มีช่องเก็บเรทพนักงานเลย**
 * ยอดที่จะไปโผล่หน้าค่าใช้จ่ายของ EMCS ต้องออกจากระบบเราเท่านั้น · การล็อกตามที่มา
 * จึงเป็นการล็อกผิดแกน แบบเดียวกับที่เคยล็อก "หักเงิน" ผิดมาแล้วเมื่อ 17/08/69
 * (user เจอจริง 18/08/69: คอลัมน์ "ราคาพนักงาน" ทั้งคอลัมน์พิมพ์ไม่ได้ในงานจากไฟล์ XML)
 *
 * เหลือด่านเดียวคือ **อนุมัติแล้วห้ามแก้** — ประตูเดียวกับการแก้ข้อมูลส่วนอื่นของเคส
 */
async function assertPayNotLocked(caseId: number): Promise<void> {
  const r = await db.query('SELECT status FROM cases WHERE id = $1', [caseId]);
  if (r.rows.length === 0) throw new AppError(404, 'ไม่พบเคสนี้');
  if (r.rows[0].status === 'reviewed') {
    throw new AppError(423, 'เคสนี้อนุมัติแล้ว — แก้ยอดไม่ได้จนกว่าแอดมินจะปลดล็อก');
  }
}

/**
 * บันทึกยอดจ่ายพนักงาน — 1 เคส 1 แถว
 *
 * ยอดรวม = รายรับทั้งหมด − หักเงิน
 */
export async function saveCasePay(
  caseId: number, input: SavePayInput, userId?: number, baseRev?: unknown,
) {
  await assertPayNotLocked(caseId);
  /**
   * ด่านเดียวกับตอนบันทึกรายงาน — ยอดเงินก็ถูกทับเงียบ ๆ ได้เหมือนกัน
   * ⛔ **ตรวจอย่างเดียว ไม่บวก rev** — ปุ่มบันทึกหนึ่งครั้งยิง 2 คำขอ (ยอดก่อน แล้วรายงาน)
   *    ทั้งคู่ถือ rev ตัวเดียวกัน ถ้าตัวแรกบวกด้วย ตัวที่สองจะเด้งชนตัวเอง
   *    (rev บวกโดย trigger ตอน UPDATE survey_reports เท่านั้น — survey_pay คนละตาราง)
   */
  await assertReportRev(caseId, baseRev);
  const money: Record<string, number | null> = {};
  for (const f of PAY_MONEY_FIELDS) money[f] = num(input[f]);
  // หักเงินเก็บเป็นค่าบวกเสมอ — กรอกติดลบมาก็แปลงให้ ไม่งั้นลบซ้อนลบกลายเป็นบวก
  const deduct = num(input[PAY_DEDUCT_FIELD]);
  money[PAY_DEDUCT_FIELD] = deduct === null ? null : Math.abs(deduct);

  // ยอดตัวปรับ — เก็บแยกเพื่อให้ใบเบิกเงินแยกออกว่าจ่ายค่าอะไรไปเท่าไหร่
  // ติ๊กแต่ไม่ใส่เลข = ใช้ค่าตั้งต้น (นอกพื้นที่ 50 · นอกเวลา 100) ตามระบบเดิม
  const areaAmt = input.out_of_area ? (num(input.out_of_area_amt) ?? 50) : null;
  const hoursAmt = input.out_of_hours ? (num(input.out_of_hours_amt) ?? 100) : null;
  /**
   * ยอดรวม = รายรับทั้งหมด + ตัวปรับ − หักเงิน
   *
   * ⛔ ไม่มีฝั่งรายรับเลย = ยังไม่รู้ฐาน → total ต้องเป็น **ว่าง** ไม่ใช่ 0 หรือติดลบ
   *    เคสที่หัวหน้าหักเงินอย่างเดียว (งานระบบเดิมที่ยอดรายรับอยู่ที่ se-billing) จะได้
   *    total = -หักเงิน แล้วเลขติดลบนั้นจะไหลไปโผล่ในใบเบิกเงินเป็นยอดจ่ายจริง
   */
  const anyEarning = PAY_MONEY_FIELDS.some((f) => money[f] !== null)
    || areaAmt !== null || hoursAmt !== null;
  const total = anyEarning
    ? round2(
        PAY_MONEY_FIELDS.reduce((s, f) => s + (money[f] ?? 0), 0)
        + (areaAmt ?? 0) + (hoursAmt ?? 0) - (money[PAY_DEDUCT_FIELD] ?? 0))
    : null;

  // snapshot ต้องสะท้อน "สิ่งที่กรอกรอบนี้" ไม่ใช่แถวเก่าที่ยังไม่ทันอัปเดต —
  // getCasePay อ่านตัวปรับจากแถวที่บันทึกไว้ก่อนหน้า จึงได้ค่าเก่า/ว่างเสมอในครั้งแรก
  // ตัว snapshot มีหน้าที่อธิบายว่ายอดนี้มาจากอะไร ถ้าบอกตัวปรับผิดก็หมดประโยชน์
  // snapshot คิดจากพื้นที่ที่กำลังบันทึกรอบนี้ (หน้าเว็บส่ง acc_* มาใน body) — ยอดเงินถูกยิงก่อนรายงาน
  // ถ้าอ่านจากรายงานที่บันทึกไว้จะได้พื้นที่เก่าไป 1 รอบ (เช่น เพิ่งเปลี่ยนเป็นบ่อวิน แต่ snapshot ยังเป็นเรทอำเภอ)
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : null);
  // ชุดเดียวกับตอนเปิดหน้า: สถานที่ออกตรวจสอบก่อน ไม่มีค่อยสถานที่เกิดเหตุ (หน้าเว็บส่งทั้งสองชุดมาใน body)
  const loc = rateLocationOf({
    survey_province: str('survey_province'), survey_district: str('survey_district'),
    survey_subdistrict: str('survey_subdistrict'),
    acc_province: str('acc_province'), acc_district: str('acc_district'), acc_subdistrict: str('acc_subdistrict'),
  });
  const { suggest } = await getCasePay(caseId, {
    province: loc.province, district: loc.district, subdistrict: loc.subdistrict,
    location: loc.from, claim_type: str('claim_type'),
  });
  const snapshot = {
    ...(suggest?.snapshot ?? {}),
    // จดไว้ว่าเรทรอบนี้คิดจากสถานที่ออกตรวจสอบหรือสถานที่เกิดเหตุ
    rate_location: loc.from,
    out_of_area: areaAmt,
    out_of_hours: hoursAmt,
    special_tumbon: input.special_tumbon ? true : null,
    daily_check: input.daily_check ?? null,
    deduct: money[PAY_DEDUCT_FIELD],
    deduct_reasons: [
      input.deduct_late ? 'ส่งช้า' : null,
      input.deduct_docs ? 'งานไม่เรียบร้อย' : null,
      input.deduct_reason || null,
    ].filter(Boolean),
  };

  /**
   * ห่อ transaction เดียวกับการเขียนประวัติ — ประวัติยอดเงินที่ขาดหายเป็นช่วง ๆ
   * แย่กว่าไม่มีเลย เพราะทำให้เชื่อสิ่งที่เห็นไม่ได้
   */
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const prev = await client.query('SELECT * FROM survey_pay WHERE case_id = $1', [caseId]);

  const r = await client.query(
    `INSERT INTO survey_pay (case_id, service_fee, travel_fee, photo_fee, phone_fee, bail_fee,
        claim_fee, daily_fee, other_fee, other_reason, out_of_area, out_of_hours,
        special_tumbon, daily_check, total, rate_snapshot, priced_by,
        deduct_fee, deduct_late, deduct_docs, deduct_reason,
        out_of_area_amt, out_of_hours_amt, priced_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW(),NOW())
     ON CONFLICT (case_id) DO UPDATE SET
       service_fee=EXCLUDED.service_fee, travel_fee=EXCLUDED.travel_fee, photo_fee=EXCLUDED.photo_fee,
       phone_fee=EXCLUDED.phone_fee, bail_fee=EXCLUDED.bail_fee, claim_fee=EXCLUDED.claim_fee,
       daily_fee=EXCLUDED.daily_fee, other_fee=EXCLUDED.other_fee, other_reason=EXCLUDED.other_reason,
       out_of_area=EXCLUDED.out_of_area, out_of_hours=EXCLUDED.out_of_hours,
       special_tumbon=EXCLUDED.special_tumbon, daily_check=EXCLUDED.daily_check,
       total=EXCLUDED.total, rate_snapshot=EXCLUDED.rate_snapshot,
       deduct_fee=EXCLUDED.deduct_fee, deduct_late=EXCLUDED.deduct_late,
       deduct_docs=EXCLUDED.deduct_docs, deduct_reason=EXCLUDED.deduct_reason,
       out_of_area_amt=EXCLUDED.out_of_area_amt, out_of_hours_amt=EXCLUDED.out_of_hours_amt,
       priced_by=EXCLUDED.priced_by, priced_at=NOW(), updated_at=NOW()
     RETURNING *`,
    [caseId, money.service_fee, money.travel_fee, money.photo_fee, money.phone_fee,
     money.bail_fee, money.claim_fee, money.daily_fee, money.other_fee,
     input.other_reason ?? null, Boolean(input.out_of_area), Boolean(input.out_of_hours),
     Boolean(input.special_tumbon), input.daily_check ?? null, total,
     JSON.stringify(snapshot), userId ?? null,
     money[PAY_DEDUCT_FIELD], Boolean(input.deduct_late), Boolean(input.deduct_docs),
     input.deduct_reason ?? null, areaAmt, hoursAmt]);

    await recordMoneyChanges(client, {
      caseId, kind: 'pay', userId: userId ?? null,
      before: prev.rows[0], after: r.rows[0],
    });
    await client.query('COMMIT');
    return r.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
