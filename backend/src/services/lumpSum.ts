import { db } from '../config/database';

/**
 * เรทเหมาฝั่งเรียกเก็บประกัน "ตามลำดับเรื่องในเดือน" — ราชบุรี (user เคาะ 01/10/69)
 *
 * กติกา (ตารางเรทราชบุรีของ user):
 *   ลำดับเรื่อง = **5 หลักท้ายของเลขเซอร์เวย์** SEABI-[ประเภท 1][จังหวัด 2][ปี 2][เดือน 2][ลำดับ 5]
 *   (นับต่อจังหวัดต่อเดือน รวมทุกประเภทเคลม — user เคาะ "นับตามเลขเซอร์เวย์" ไม่ใช่นับงานที่เบิกจริง)
 *   เรื่องที่ 1..first_n → first · ถัดไป → rest · **ใช้กับทุกประเภทเคลม** (ติดตาม/เจรจาไม่ลด 100 แบบจังหวัดอื่น)
 *   ยอดเหมารวมทุกอย่างแล้ว → **ไม่มีค่าเดินทาง/ค่ารูปแยก** · ค่าคัดประจำวันยังบวกได้ตามปกติ
 *
 * ยืนยันก่อนทำ: รีพอท ISURVEY 2024–2026 (2,858 งาน: เลข 1–25 ได้ 1,200 ~90% · 26+ ได้ 1,000 ~90%)
 *   + เปิดดูใบค่าใช้จ่ายบน EMCS จริง 3 เรื่อง (SEABI-170260400024/25 = 1,200 · SEABI-270260400026 = 1,000)
 *
 * ตัวเลขอยู่ใน `billing_settings.ins_lump_by_survey_seq` = { "<รหัสจังหวัด 2 หลัก>": { first_n, first, rest, label } }
 * แก้ได้ที่หน้า "เรทค่าตอบแทน › ค่าคงที่" ไม่ต้องแก้โค้ด · ไม่มีแถว/จังหวัดไม่อยู่ในนั้น = ไม่มีเหมา (กติกาเดิมทุกอย่าง)
 */
export interface LumpRule { first_n: number; first: number; rest: number; label?: string }
export type LumpRules = Record<string, LumpRule>;

export const LUMP_SETTING_KEY = 'ins_lump_by_survey_seq';

export interface SurveySeq { prefix: string; type: string; province: string; yy: string; mm: string; seq: number }

const SEQ_RE = /^(SEABI|SETP|SEMS)-?(\d)(\d{2})(\d{2})(\d{2})(\d{5})$/;

/** ถอดเลขเซอร์เวย์ — รูปแบบไม่ครบ = null (ห้ามเดาลำดับจากเลขที่ไม่ครบ) */
export function parseSurveySeq(jobNo: unknown): SurveySeq | null {
  const m = SEQ_RE.exec(String(jobNo ?? '').replace(/\s/g, '').toUpperCase());
  if (!m) return null;
  return { prefix: m[1], type: m[2], province: m[3], yy: m[4], mm: m[5], seq: Number(m[6]) };
}

const validRule = (r: unknown): r is LumpRule => {
  const o = r as LumpRule | null;
  return Boolean(o) && [o!.first_n, o!.first, o!.rest].every((n) => Number.isFinite(Number(n)) && Number(n) > 0);
};

export interface LumpResult {
  label: string;
  /** null = จังหวัดเหมาแต่นับลำดับไม่ได้ (ยังไม่มีเลข/เลขของจังหวัดอื่น) → หัวหน้ากรอกเอง */
  fee: number | null;
  seq: number | null;
  /** ข้อความบอกที่มาของยอด โชว์บนหน้าตรวจ */
  note: string;
}

const baht = (n: number) => n.toLocaleString('en-US');

/**
 * ยอดเหมาของงานนี้ — คืน null = จังหวัดนี้ไม่ใช่จังหวัดเหมา (ใช้กติกาเดิม)
 *
 * ⛔ เฉพาะเลข SEABI (ไอโออิ) — ตารางเหมามาจากงานไอโออิ · ไทยไพบูลย์ (SETP) มีกติกาของตัวเอง (company2_rules) ไม่ใช่เหมานี้
 * ⛔ เลขเป็นของจังหวัดอื่น = นับลำดับของจังหวัดนี้ไม่ได้ → ไม่เดา ให้คนกรอก
 */
export function lumpSumFee(
  rules: LumpRules | null | undefined, provinceCode: string | null | undefined, jobNo: unknown,
): LumpResult | null {
  const rule = provinceCode ? rules?.[provinceCode] : undefined;
  if (!validRule(rule)) return null;
  const label = String(rule.label || `เหมาจังหวัดรหัส ${provinceCode}`);
  const n = Number(rule.first_n), first = Number(rule.first), rest = Number(rule.rest);
  const range = `เรื่องที่ 1–${n} = ${baht(first)} · ${n + 1} ขึ้นไป = ${baht(rest)}`;
  const s = parseSurveySeq(jobNo);
  if (!s) {
    return { label, fee: null, seq: null, note: `${label}: ยังไม่มีเลขเซอร์เวย์ นับลำดับเรื่องไม่ได้ — กรอกค่าบริการเอง (${range})` };
  }
  if (s.prefix !== 'SEABI') return null;
  if (s.province !== provinceCode) {
    return { label, fee: null, seq: s.seq, note: `${label}: เลขเซอร์เวย์เป็นของจังหวัดอื่น นับลำดับเรื่องไม่ได้ — กรอกค่าบริการเอง (${range})` };
  }
  const fee = s.seq <= n ? first : rest;
  return { label, fee, seq: s.seq, note: `${label}: เรื่องที่ ${s.seq} ของเดือน → ${baht(fee)} บาท ไม่มีค่าเดินทาง/ค่ารูปแยก (${range})` };
}

/** อ่านกติกาเหมาจากตั้งค่า — ไม่มีแถว/อ่านพัง = {} (ไม่มีเหมา) ไม่ให้หน้าเคสพังเพราะตั้งค่า */
export async function loadLumpRules(): Promise<LumpRules> {
  try {
    const r = await db.query('SELECT value FROM billing_settings WHERE key = $1', [LUMP_SETTING_KEY]);
    const v = r.rows[0]?.value;
    return v && typeof v === 'object' ? (v as LumpRules) : {};
  } catch {
    return {};
  }
}
