/**
 * ท่อ se-survey → se-billing (`billing.sesurvey.cloud/captures`)
 *
 * เดิม captures บน se-billing มาจากทางเดียว: Chrome extension ตอนหัวหน้ากรอกค่าบริการบนหน้า
 * ISURVEY — งานที่ตรวจบน se-survey จึงไม่เคยไปโผล่ที่นั่น (user สั่งต่อท่อ 03/09/69)
 *
 * กติกา
 *  - ยิงตอน **อนุมัติ** เท่านั้น (ยอดถูกล็อกแล้ว) · ปลดล็อก = ถอนแถวออก · อนุมัติใหม่ = แทนที่แถวเดิม
 *    (se-billing ไม่กันซ้ำด้วยเลขเคลม — ถ้าไม่ถอน/แทนที่ อนุมัติซ้ำจะได้แถวซ้ำในบัญชี)
 *  - **ห้ามทำให้การอนุมัติล้ม** — se-billing ล่ม/ไม่ได้ตั้งค่า ก็แค่จดผลไว้ที่ cases.billing_error
 *    แล้วหน้าตรวจโชว์ปุ่ม "ส่งเข้า se-billing" ให้กดซ้ำ
 *  - ไม่ตั้ง SEBILLING_URL = ปิดท่อ · SEBILLING_TOKEN = API_TOKEN ของ se-billing server
 *
 * การแปลงยอด — ให้สูตรสรุปของ se-billing คืนยอดเดียวกับ "รวมพนักงาน" ของเรา
 *  (08/09/69 user ขอเก็บ ค่าเรียกร้อง / ค่าคัดประจำวัน / ค่าใช้จ่ายอื่นๆ แยกคอลัมน์ — แถวละช่องเหมือนตารางของ ISURVEY)
 *  se-billing สรุปแถว mode "sesurvey": รวมพนักงาน = sur_invest + นอกพื้นที่/นอกเวลา(อยู่ใน sur แล้ว) − deduct_amt
 *                                                    + other_expense_amt + sur_claim + sur_daily
 *  จึงส่ง sur_invest = ฐาน (ค่าบริการ/เดินทาง/รูป/โทรศัพท์/ประกันตัว) + นอกพื้นที่ + นอกเวลา (ยังไม่หัก)
 *       sur_claim = ค่าเรียกร้อง · sur_daily = ค่าคัดประจำวัน · daily_check = ผลคัด · recv_claim_amt = "รับเงินจำนวน"
 *       other_expense_amt = ค่าใช้จ่ายอื่นๆ (รายจ่ายจริง บวก) · deduct_amt = หักเงิน (se-billing ยกเว้นกฎ
 *       "ต้องติ๊กส่งช้า/เอกสาร" ให้ mode sesurvey เพราะเหตุผลอยู่ในเว็บเรา — ส่งไปใน raw.deduct_reason)
 *  ฝั่งเรียกเก็บประกัน: ins_invest/ins_trans/ins_photo/ins_claim/ins_daily/ins_other(+other_detail) = survey_expenses
 *  ⛔ se-billing รุ่นก่อน 09/2569 ปฏิเสธ deduct_amt ที่ไม่มีเหตุผลมาตรฐาน — ต้อง deploy se-billing ก่อน backend
 *  ใบเบิกเงิน (payExport) ใช้คู่คอลัมน์เดียวกัน — แก้ที่หนึ่งต้องดูอีกที่
 */
import { db } from '../config/database';
import { env } from '../config/env';
import { TH_AMPHURS, TH_PROVINCES, TH_TUMBONS } from '../data/thaiAreaCodes';
import { amphurCode, provinceCode, tumbonCode } from './areaCode.service';
import { PAY_MONEY_FIELDS, rateLocationOf } from './pay.service';

export type BillingResult =
  | { ok: true; id: number }
  | { ok: false; skipped?: true; error: string };

export const billingEnabled = (): boolean => Boolean(env.SEBILLING_URL);

/** ประเภทเคลมของเรา (ตัวอักษร) → mtype_id ของ ISURVEY/se-billing — ชุดเดียวกับ pay.service */
const MTYPE_ID: Record<string, string> = { F: '1', D: '2', A: '3', C: '4' };
const TIMEOUT_MS = 8000;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "DD/MM/YYYY HH:mm" (ค.ศ. เวลาไทย) — รูปแบบเดียวกับช่อง "วันจ่ายงาน" ที่ extension อ่านจาก ISURVEY */
function bkkStamp(v: unknown): string | null {
  if (!v) return null;
  const t = new Date(String(v));
  if (Number.isNaN(t.getTime())) return null;
  const b = new Date(t.getTime() + 7 * 3600 * 1000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(b.getUTCDate())}/${p(b.getUTCMonth() + 1)}/${b.getUTCFullYear()} `
    + `${p(b.getUTCHours())}:${p(b.getUTCMinutes())}`;
}

/** เรียก se-billing ด้วย URL/โทเค็นชุดเดียวกับท่อ captures — หน้า "งานแก้ไข/ต่อเนื่อง (EMCS)" ใช้อ่าน /api/dashboard ด้วย */
export async function billingFetch(path: string, init: { method: string; body?: string }) {
  const base = String(env.SEBILLING_URL).replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (env.SEBILLING_TOKEN) headers.Authorization = `Bearer ${env.SEBILLING_TOKEN}`;
    return await fetch(base + path, { ...init, headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const errMsg = (e: unknown): string => {
  if (e instanceof Error) return e.name === 'AbortError' ? `se-billing ไม่ตอบใน ${TIMEOUT_MS / 1000} วินาที` : e.message;
  return String(e);
};

type Row = Record<string, unknown>;

/** ประกอบแถว capture จากข้อมูลเคส — export ไว้ให้เทส/ดูก่อนส่งได้ */
export async function buildCapture(caseId: number): Promise<{ payload: Record<string, unknown>; prevId: number | null }> {
  const r = (await db.query(
    `SELECT c.id, c.billing_capture_id,
            /* วันจ่ายงาน = มอบหมาย (tstz) หรือถ้าไม่มีก็ตอนสร้างเคส
               ⛔ cases.created_at เป็น timestamp ไม่มีโซน เก็บ "เวลาไทยบนหน้าปัด" (แถวที่ backend prod สร้าง
                  = 11:45 ตรงกับเวลาจริง 11:45 น.) → ห้ามให้ node แปลงเอง: prod รัน UTC จะอ่านเป็น 11:45Z
                  แล้วบวก 7 อีกรอบ = 18:45 (เจอจริงแถวแรกที่ส่งเข้า se-billing 03/09/69)
                  จึงประกอบเป็น ISO ที่มี +07:00 ตั้งแต่ใน SQL ให้ผลเท่ากันทุกเครื่อง */
            COALESCE(to_char(c.assigned_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD"T"HH24:MI:SS'),
                     to_char(c.created_at, 'YYYY-MM-DD"T"HH24:MI:SS')) || '+07:00' AS dispatch_iso,
            sr.claim_no, sr.survey_job_no, sr.acc_province, sr.acc_district, sr.acc_subdistrict,
            sr.survey_province, sr.survey_district, sr.survey_subdistrict,
            sr.acc_surveyor, sr.claim_type, sr.acc_claim_amount,
            se.service_fee_price AS ins_service, se.travel_fee_price AS ins_travel,
            se.claim_fee_price AS ins_claim, se.daily_record_fee AS ins_daily,
            se.other_fee_price AS ins_other, se.other_fee_detail,
            -- photo_fee_price = ราคาต่อรูป → ยอดรวม = × จำนวนรูป (se-billing/ISURVEY เก็บค่ารูปเป็นยอดรวม)
            se.photo_fee_price * COALESCE(NULLIF(se.photo_fee_count, 0), 1) AS ins_photo,
            sp.service_fee, sp.travel_fee, sp.photo_fee, sp.phone_fee, sp.bail_fee, sp.claim_fee,
            sp.daily_fee, sp.daily_check, sp.other_fee, sp.other_reason,
            sp.out_of_area, sp.out_of_area_amt, sp.out_of_hours, sp.out_of_hours_amt,
            sp.deduct_fee, sp.deduct_late, sp.deduct_docs, sp.deduct_reason, sp.total,
            sp.rate_snapshot, sp.priced_at,
            rv.reviewed_at,
            /* เจ้าหน้าที่ตรวจ = ชื่อที่ตั้งทับไว้ที่ใบอนุมัติ (reviews.inspector_name — กรณีกดอนุมัติด้วยบัญชีกลาง)
               ไม่มีค่อยใช้ชื่อบัญชีที่กดอนุมัติ */
            COALESCE(NULLIF(rv.inspector_name, ''),
                     TRIM(COALESCE(ck.first_name, '') || ' ' || COALESCE(ck.last_name, ''))) AS approver
       FROM cases c
       LEFT JOIN survey_reports sr ON sr.case_id = c.id
       LEFT JOIN survey_expenses se ON se.report_id = sr.id
       LEFT JOIN survey_pay sp ON sp.case_id = c.id
       LEFT JOIN reviews rv ON rv.case_id = c.id
       LEFT JOIN users ck ON ck.id = rv.checker_id
      WHERE c.id = $1
      LIMIT 1`, [caseId])).rows[0] as Row | undefined;
  if (!r) throw new Error(`ไม่พบเคส #${caseId}`);

  const s = (k: string): string | null => {
    const v = r[k];
    return v === null || v === undefined ? null : String(v).trim() || null;
  };
  // พื้นที่ → รหัสมาตรฐานไทย (ชุดเดียวกับตารางเรทและ se-billing) — แปลงจากชื่อในรายงานก่อน
  // ถ้าแปลงไม่ได้ค่อยใช้รหัสที่ตอนคิดเงินเคยหาไว้ (rate_snapshot)
  const snap = (r.rate_snapshot ?? {}) as Row;
  const snapId = (k: string) => (typeof snap[k] === 'string' && snap[k] ? String(snap[k]) : null);
  // พื้นที่ของแถว captures = พื้นที่ที่ใช้หาเรท: สถานที่ออกตรวจสอบก่อน ไม่มีค่อยสถานที่เกิดเหตุ
  // (ชุดเดียวกับที่ extension ส่งจาก ISURVEY "จังหวัด/อำเภอที่ตรวจสอบ" — 09/09/69)
  const loc = rateLocationOf({
    survey_province: s('survey_province'), survey_district: s('survey_district'), survey_subdistrict: s('survey_subdistrict'),
    acc_province: s('acc_province'), acc_district: s('acc_district'), acc_subdistrict: s('acc_subdistrict'),
  });
  const pid = provinceCode(loc.province) ?? snapId('province_id');
  const aid = amphurCode(loc.province, loc.district) ?? snapId('amphur_id');
  const tid = tumbonCode(loc.province, loc.district, loc.subdistrict) ?? snapId('tumbon_id');

  // ฝั่งจ่ายพนักงาน — สูตรเดียวกับ saveCasePay: รวม = รายรับทุกช่อง + ตัวปรับ − หักเงิน
  // แต่ส่งแยกช่อง: ฐาน (sur_invest) · ค่าเรียกร้อง · ค่าคัดประจำวัน · ค่าใช้จ่ายอื่นๆ — se-billing บวกกลับให้เท่ากัน
  const SPLIT_FIELDS = ['claim_fee', 'daily_fee', 'other_fee'];
  const earn = PAY_MONEY_FIELDS.filter((f) => !SPLIT_FIELDS.includes(f))
    .reduce((sum, f) => sum + (num(r[f]) ?? 0), 0);
  const anyEarning = PAY_MONEY_FIELDS.some((f) => num(r[f]) !== null)
    || Boolean(r.out_of_area) || Boolean(r.out_of_hours);
  const otherFee = num(r.other_fee);
  const oaAmt = r.out_of_area ? (num(r.out_of_area_amt) ?? 50) : null;
  const ohAmt = r.out_of_hours ? (num(r.out_of_hours_amt) ?? 100) : null;
  const ded = Math.abs(num(r.deduct_fee) ?? 0);
  const stdReason = Boolean(r.deduct_late || r.deduct_docs);
  const surveyor = s('acc_surveyor');

  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    dispatch_date: bkkStamp(r.dispatch_iso),
    province_id: pid,
    province_name: (pid && TH_PROVINCES[pid]) || loc.province || null,
    amphur_id: aid,
    amphur_name: (aid && TH_AMPHURS[aid]) || loc.district || null,
    tumbon_id: tid,
    tumbon_name: (tid && TH_TUMBONS[tid]) || loc.subdistrict || null,
    mtype_id: MTYPE_ID[s('claim_type') ?? ''] ?? null,
    claim_no: s('claim_no'),
    survey_no: s('survey_job_no'),
    case_status: 'close',                       // อนุมัติ = งานปิดแล้ว (ISURVEY ติ๊ก "ปิดเคส")
    surveyor_name: surveyor,
    oss_company: null,
    is_se: /^se/i.test(surveyor ?? ''),         // กติกาเดียวกับ extension: รหัสขึ้นต้น SE = พนักงานเรา
    inspector_name: s('approver'),
    sur_invest: anyEarning ? round2(earn + (oaAmt ?? 0) + (ohAmt ?? 0)) : null,
    ins_invest: num(r.ins_service),
    ins_trans: num(r.ins_travel),
    ins_photo: num(r.ins_photo),
    out_of_area: Boolean(r.out_of_area),
    out_of_area_amt: oaAmt,
    out_of_hours: Boolean(r.out_of_hours),
    out_of_hours_amt: ohAmt,
    deduct_amt: ded > 0 ? ded : null,
    other_expense_amt: otherFee ? round2(otherFee) : null,
    late_submit: Boolean(r.deduct_late),
    incomplete_docs: Boolean(r.deduct_docs),
    mode: 'sesurvey',
    // แถวแยกตามตาราง ISURVEY (09/2569) — ฝั่งพนักงาน (survey_pay) / ฝั่งบริษัท (survey_expenses)
    recv_claim_amt: num(r.acc_claim_amount),
    sur_claim: num(r.claim_fee),
    ins_claim: num(r.ins_claim),
    daily_check: s('daily_check'),
    sur_daily: num(r.daily_fee),
    ins_daily: num(r.ins_daily),
    ins_other: num(r.ins_other),
    other_detail: s('other_fee_detail'),
    // ของดิบไว้ตรวจย้อนหลัง — หน้า captures ไม่โชว์ แต่ export/DB มี
    raw: {
      source: 'se-survey', case_id: caseId,
      approved_at: r.reviewed_at ?? null, approved_by: s('approver'),
      priced_at: r.priced_at ?? null,
      pay: Object.fromEntries(PAY_MONEY_FIELDS.map((f) => [f, num(r[f])])),
      total: num(r.total), deduct: ded || null,
      deduct_reason: s('deduct_reason'), deduct_std_reason: stdReason, other_reason: s('other_reason'),
      area_text: { province: s('acc_province'), district: s('acc_district'), subdistrict: s('acc_subdistrict') },
    },
  };
  const prevId = num(r.billing_capture_id);
  return { payload, prevId: prevId && prevId > 0 ? prevId : null };
}

/**
 * ส่ง (หรือส่งซ้ำ) เคสเข้า captures — ไม่ throw: ผลทุกแบบคืนเป็น BillingResult
 * มีแถวเดิมอยู่ → ถอนก่อนแล้วส่งใหม่ (แทนที่) ถอนไม่ได้ก็ยังส่ง — มีแถวใหม่สำคัญกว่า
 */
export async function sendCapture(caseId: number): Promise<BillingResult> {
  if (!billingEnabled()) return { ok: false, skipped: true, error: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า SEBILLING_URL' };
  try {
    const { payload, prevId } = await buildCapture(caseId);
    if (prevId) {
      try { await billingFetch(`/api/captures/${prevId}`, { method: 'DELETE' }); }
      catch (e) { console.warn(`[sebilling] เคส #${caseId} ถอนแถวเดิม #${prevId} ไม่ได้ (${errMsg(e)}) — ส่งใหม่ต่อ`); }
    }
    const res = await billingFetch('/api/captures', { method: 'POST', body: JSON.stringify(payload) });
    const text = await res.text();
    if (!res.ok) throw new Error(`se-billing ตอบ ${res.status}: ${text.slice(0, 200)}`);
    const id = Number((JSON.parse(text) as { id?: unknown }).id);
    if (!Number.isFinite(id) || id <= 0) throw new Error('se-billing รับแล้วแต่ไม่คืน id');
    await db.query(
      'UPDATE cases SET billing_capture_id = $2, billing_sent_at = NOW(), billing_error = NULL WHERE id = $1',
      [caseId, id]);
    console.log(`[sebilling] เคส #${caseId} → capture #${id}${prevId ? ` (แทนที่ #${prevId})` : ''}`);
    return { ok: true, id };
  } catch (e) {
    const msg = errMsg(e);
    console.error(`[sebilling] เคส #${caseId} ส่งไม่สำเร็จ: ${msg}`);
    await db.query('UPDATE cases SET billing_error = $2 WHERE id = $1', [caseId, msg.slice(0, 500)])
      .catch(() => { /* จดผลไม่ได้ก็ไม่ต้องล้มซ้ำ — log ไว้แล้ว */ });
    return { ok: false, error: msg };
  }
}

/** ปลดล็อก = ยอดจะเปลี่ยน → ถอนแถวออกจากบัญชี (อนุมัติใหม่ค่อยส่งใหม่) — best effort, ไม่ throw */
export async function removeCapture(caseId: number): Promise<void> {
  if (!billingEnabled()) return;
  const id = num((await db.query('SELECT billing_capture_id FROM cases WHERE id = $1', [caseId])).rows[0]?.billing_capture_id);
  if (!id) return;
  try {
    const res = await billingFetch(`/api/captures/${id}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`se-billing ตอบ ${res.status}`);
    await db.query(
      'UPDATE cases SET billing_capture_id = NULL, billing_sent_at = NULL, billing_error = NULL WHERE id = $1', [caseId]);
    console.log(`[sebilling] เคส #${caseId} ปลดล็อก → ถอน capture #${id}`);
  } catch (e) {
    const msg = `ถอนแถว #${id} ตอนปลดล็อกไม่สำเร็จ: ${errMsg(e)}`;
    console.error(`[sebilling] เคส #${caseId} ${msg}`);
    await db.query('UPDATE cases SET billing_error = $2 WHERE id = $1', [caseId, msg.slice(0, 500)]).catch(() => {});
  }
}
