/**
 * ดึงงาน "รอตรวจข้อมูล" จาก ISURVEY เข้าเว็บ — ผ่าน service `pull_service.py` ของ se-autokey ที่รันบนเซิร์ฟเวอร์
 *
 * backend ไม่คุยกับ ISURVEY เอง (ตัวแปลง ISURVEY→se-survey เป็น Python ตัวเดียวกับบอท ดู
 * se-autokey/autokey/isurvey_to_sesurvey.py + audit 03/09/69) — ส่งบัญชีของ "คนที่กด" ไปต่อคำขอ
 * service ไม่เก็บอะไร · ISURVEY ถูกอ่านอย่างเดียว · EMCS ไม่ถูกแตะ
 *
 * env: ISURVEY_SERVICE_URL (ไม่ตั้ง = ฟีเจอร์ปิด 503) · ISURVEY_SERVICE_TOKEN (= PULL_SERVICE_TOKEN ของ service)
 */
import { db } from '../config/database';
import { env } from '../config/env';
import { AppError } from '../middleware/errorHandler';
import { isurveyCredService } from './isurveyCred.service';
import { notifyCaseChanged } from './caseEvents';

export interface PendingRow {
  claim_no: string; survey_no: string; surveyor_name: string; acc_province: string;
  plate_no: string; finish_dt: string; status: string; emcs_sent: boolean;
  /** เวลาจ่ายงาน / ส่งรายงาน จากรายงาน ISURVEY (dispatch_dt / sendReport_dt) — หน้าเว็บโชว์ 2 คอลัมน์แรก (07/09/69) */
  dispatch_dt?: string; send_report_dt?: string;
  /** เคสที่มีอยู่แล้วในระบบเรา (เลขเคลม+เซอร์เวย์เดียวกัน) — กันดึงซ้ำ */
  imported_case_id?: number | null; imported_status?: string | null;
}

async function callService<T>(path: string, body: Record<string, unknown>, timeoutMs: number): Promise<T> {
  const base = String(env.ISURVEY_SERVICE_URL ?? '').replace(/\/+$/, '');
  if (!base) throw new AppError(503, 'เซิร์ฟเวอร์ยังไม่ได้ตั้ง ISURVEY_SERVICE_URL — ดึงงานจาก ISURVEY ยังใช้ไม่ได้');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Service-Token': String(env.ISURVEY_SERVICE_TOKEN ?? '') },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    const msg = e instanceof Error && e.name === 'AbortError'
      ? `service ดึงงานไม่ตอบใน ${Math.round(timeoutMs / 1000)} วินาที` : `ติดต่อ service ดึงงานไม่ได้: ${String(e)}`;
    throw new AppError(502, msg);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let j: { ok?: boolean; error?: string } & Record<string, unknown> = {};
  try { j = JSON.parse(text); } catch { /* ไม่ใช่ JSON — ใช้ text ล่าง */ }
  if (!res.ok || !j.ok) {
    throw new AppError(res.status === 401 ? 502 : 502, String(j.error || `service ตอบ ${res.status}: ${text.slice(0, 200)}`));
  }
  return j as T;
}

/**
 * ตารางค่าสำรวจที่จะเขียนลง ISURVEY แท็บ 1 — ยอดรวมของแต่ละแถว (ไม่ใช่ราคาต่อหน่วย)
 *   sur (ฝั่งพนักงาน) ← survey_pay.total **ยอดเดียว** ลงช่อง "ค่าบริการ" — แถวอื่นทุกแถว 0 และ "หักเงิน" ของ ISURVEY = 0
 *     (user เคาะ 16/09/69 รอบ 3 หลังเคส #337: เดิมส่งรายแถว + ยุบนอกเวลา/นอกพื้นที่เข้า "อื่น ๆ" → ยอดบน ISURVEY เพี้ยนจากเว็บ)
 *     total ของเว็บ = รายรับทุกแถว + นอกพื้นที่/นอกเวลา − หักเงิน (pay.service) จึงต้องไม่ส่งหักเงินซ้ำ · ยอดรวมเซอร์เวย์บน ISURVEY = ยอดเว็บเสมอ
 *     ISURVEY ไม่มีแถวนอกเวลา/นอกพื้นที่ (รู้แค่ธง ซึ่งคงค่าเดิมไว้) · รายละเอียดแยกรายการอยู่บนเว็บ + se-billing (สูตรเดิม ไม่เปลี่ยน)
 *     ยังไม่มียอด (total ว่าง = ยังไม่กรอกเรท) = ไม่แตะฝั่งเสนอ · ติดลบ (หักเกินรายรับ) = 0 เพราะ ISURVEY รับติดลบไม่ได้
 *   ins (ฝั่งประกัน) ← survey_expenses · ราคาต่อหน่วย × จำนวน (ค่ารูป 5 × 10 = 50 ตรงกับที่ ISURVEY เก็บเป็นยอดรวม)
 * ไม่มีข้อมูลฝั่งไหน = ไม่ส่งฝั่งนั้น (service คงค่าเดิมของ ISURVEY ไว้) · ไม่มีทั้งคู่ = undefined
 */
function buildIsurveyRates(r: Record<string, unknown>): Record<string, Record<string, unknown>> | undefined {
  const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const out: Record<string, Record<string, unknown>> = {};
  if (r.pay_case_id && r.pay_total != null) {
    out.sur = {
      invest: Math.max(0, num(r.pay_total)), trans: 0, photo: 0, tel: 0, insure: 0, claim: 0, daily: 0, other: 0, deduct: 0,
    };
  }
  if (r.exp_id) {
    const cnt = (c: unknown, price: number) => { const n = num(c); return n > 0 ? n : (price > 0 ? 1 : 0); };
    const svcP = num(r.service_fee_price), trvP = num(r.travel_fee_price), phoP = num(r.photo_fee_price);
    const svcN = cnt(r.service_fee_count, svcP), trvN = cnt(r.travel_fee_count, trvP), phoN = cnt(r.photo_fee_count, phoP);
    const daily = num(r.daily_record_fee);
    out.ins = {
      invest: svcP * svcN, invest_num: svcN, trans: trvP * trvN, trans_num: trvN,
      photo: phoP * phoN, photo_num: phoN, tel: num(r.ins_phone_fee), insure: num(r.ins_bail_fee),
      claim: num(r.claim_fee_price), daily, daily_num: daily > 0 ? 1 : 0,
      other: num(r.other_fee_price), other_desc: String(r.other_fee_detail ?? ''),
    };
  }
  return Object.keys(out).length ? out : undefined;
}

export const isurveyPullService = {
  enabled(): boolean {
    return Boolean(String(env.ISURVEY_SERVICE_URL ?? '').trim()) && isurveyCredService.enabled();
  },

  /** ลองล็อกอิน ISURVEY ด้วยบัญชีที่เก็บไว้ — จดผลลง last_ok_at/last_error */
  async testLogin(userId: number): Promise<{ ok: true; name: string }> {
    const creds = await isurveyCredService.getPlain(userId);
    try {
      const r = await callService<{ name?: string }>('/login-test', creds, 30000);
      await isurveyCredService.markResult(userId, true, undefined, String(r.name ?? ''));
      return { ok: true, name: String(r.name ?? '') };
    } catch (e) {
      await isurveyCredService.markResult(userId, false, e instanceof Error ? e.message : String(e));
      throw e;
    }
  },

  /**
   * งานสถานะ "รอตรวจข้อมูล" ในช่วงวันที่ + ธงว่าดึงเข้าระบบแล้วหรือยัง
   * รายงานของ ISURVEY ให้งานทั้งบริษัท → กรองให้เหลือเฉพาะลูกทีมของหัวหน้าคนนี้ (staff_groups)
   * แอดมิน / บัญชีที่ยังไม่ผูกทีม = เห็นทั้งหมด (บอกไว้ใน filter เพื่อให้หน้าจอแจ้งผู้ใช้)
   */
  async listPending(userId: number, role: string, dateFrom?: string, dateTo?: string):
    Promise<{ cases: PendingRow[]; filter: { applied: boolean; group_name: string | null; members: number; hidden: number } }> {
    const creds = await isurveyCredService.getPlain(userId);
    let rows: PendingRow[];
    try {
      // status '' = ขอทุกสถานะ — หน้าเว็บให้ผู้ใช้เลือกสถานะเอง (ค่าเริ่มต้นบนหน้า = รอตรวจข้อมูล) user ขอ 04/09/69
      const r = await callService<{ cases: PendingRow[] }>('/pending',
        { ...creds, date_from: dateFrom ?? '', date_to: dateTo ?? '', status: '' }, 150000);
      rows = r.cases ?? [];
      // รายงาน ISURVEY บางทีคืนงานเดียวกันซ้ำ 2 แถว (ทุกช่องเหมือนกัน) → ตัดเหลือแถวเดียว
      // ไม่งั้นหน้าเว็บได้ key ซ้ำ แถวค้างในตารางตอนเปลี่ยนตัวกรองสถานะ (เจอจริง 04/09/69)
      const seen = new Set<string>();
      rows = rows.filter((x) => {
        const k = [x.claim_no, x.survey_no, x.finish_dt, x.status, x.surveyor_name].map((v) => String(v ?? '')).join('|');
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      await isurveyCredService.markResult(userId, true);
    } catch (e) {
      await isurveyCredService.markResult(userId, false, e instanceof Error ? e.message : String(e));
      throw e;
    }
    // 22/09/69 user: **เลิกกรองตามทีม** บนหน้านี้ — ช่างที่ยังไม่ถูกใส่ชื่อในทีม หรือทีมอื่นทำงานครั้งถัดไปของเคลมเดียวกัน
    // ทำให้งานตกหล่น (เคลม 2026013150636 มี 7 ครั้ง 2 ครั้งเป็นของช่างทีมอื่น หัวหน้ามองไม่เห็น) → เห็นทั้งบริษัท
    // แล้วกรองเองด้วยจังหวัด/สถานะ/ค้นหาบนหน้าเว็บ · หน้า "รายการงาน" (getForReview) ยังกรองตามทีมเหมือนเดิม
    // รูปทรง filter คงไว้ให้หน้าเว็บเก่า/cache อ่านได้ (applied=false ตลอด)
    void role;
    const filter = { applied: false, group_name: null as string | null, members: 0, hidden: 0 };
    if (rows.length === 0) return { cases: rows, filter };
    const hits = await this.importedStatus(rows);
    const cases = rows.map((r) => {
      const hit = hits[`${r.claim_no}|${r.survey_no}`];
      return { ...r, imported_case_id: hit?.id ?? null, imported_status: hit?.status ?? null };
    });
    return { cases, filter };
  },
  /**
   * งานเหล่านี้ "มีในระบบเราแล้วหรือยัง / สถานะอะไร" — อ่านจาก DB เราอย่างเดียว ไม่แตะ ISURVEY (เร็ว)
   * จับด้วยเลขเคลม + เลขเซอร์เวย์ (เลขเคลมซ้ำได้ข้ามครั้ง แต่คู่กับเซอร์เวย์ไม่ซ้ำ) · ไม่ตรงเซอร์เวย์ = ถอยไปเลขเคลมอย่างเดียว
   * หน้างานรอตรวจเรียกซ้ำเมื่อมีสัญญาณเคสเปลี่ยน — งานที่อนุมัติแล้วจะได้หายจากรายการโดยไม่ต้องกด "โหลดรายการ" (user ขอ 08/09/69)
   */
  async importedStatus(rows: { claim_no: string; survey_no?: string }[]):
    Promise<Record<string, { id: number; status: string }>> {
    const claims = [...new Set(rows.map((r) => String(r.claim_no ?? '').trim()).filter(Boolean))];
    if (claims.length === 0) return {};
    const ex = await db.query(
      `SELECT sr.claim_no, sr.survey_job_no, c.id, c.status
         FROM survey_reports sr JOIN cases c ON c.id = sr.case_id
        WHERE sr.claim_no = ANY($1)`, [claims]);
    const byKey = new Map<string, { id: number; status: string }>();
    for (const x of ex.rows as { claim_no: string; survey_job_no: string | null; id: number; status: string }[]) {
      byKey.set(`${x.claim_no}|${x.survey_job_no ?? ''}`, { id: x.id, status: x.status });
      // สำรองด้วยเลขเคลมอย่างเดียว **เฉพาะเคสที่ไม่มีเลขเซอร์เวย์ในระบบ** (ข้อมูลเก่า) — เดิมใส่ให้ทุกเคส ทำให้งานครั้งถัดไป
      // (เลขเซอร์เวย์ใหม่ เคลมเดิม) ถูกจับคู่กับใบครั้งที่ 1 ที่อนุมัติแล้ว → หน้างานรอตรวจซ่อนไป (เคลม 2026013077649 user พบ 22/09/69)
      if (!String(x.survey_job_no ?? '').trim() && !byKey.has(`${x.claim_no}|`)) byKey.set(`${x.claim_no}|`, { id: x.id, status: x.status });
    }
    const out: Record<string, { id: number; status: string }> = {};
    for (const r of rows) {
      const hit = byKey.get(`${r.claim_no}|${r.survey_no ?? ''}`) ?? byKey.get(`${r.claim_no}|`);
      if (hit) out[`${r.claim_no}|${r.survey_no ?? ''}`] = hit;
    }
    return out;
  },

  /**
   * "ครั้งที่" ของงานในรายการ (user ขอ 22/09/69): ให้ service เรียงทุกใบของแต่ละเคลมจาก ISURVEY (survey_order — กติกาเดียวกับตอนดึง)
   * แล้วเทียบกับ DB เราว่าครั้งก่อนหน้าใบไหนยังไม่มี → หน้าเว็บโชว์ "ครั้งที่ 2 จาก 3" + เตือนให้ดึงตามลำดับ
   * (ดึงใบหลังก่อน ครั้งก่อนหน้าจะกลายเป็นเคสอ้างอิงอ่านอย่างเดียว ตรวจ/อนุมัติไม่ได้อีก)
   * ⛔ เรียกแยกจาก listPending ทีละชุดของแถวที่มองเห็น — service ถาม ISURVEY 1 ครั้งต่อเคลม ทำตอนโหลดรายการทั้ง 14 วันจะช้าไปหลายสิบวินาที
   */
  async rounds(userId: number, rows: { claim_no: string; survey_no: string }[]):
    Promise<Record<string, { visit_no: number | null; visit_total: number; earlier_missing: string[]; error?: string }>> {
    const claims = [...new Set(rows.map((r) => String(r.claim_no ?? '').trim()).filter(Boolean))].slice(0, 200);
    if (claims.length === 0) return {};
    const creds = await isurveyCredService.getPlain(userId);
    type RoundRow = { survey_no: string; round: number; status_name?: string };
    const r = await callService<{ rounds: Record<string, RoundRow[] | { error: string }> }>('/rounds', { ...creds, claims }, 150000);
    const ex = await db.query(
      `SELECT sr.claim_no, sr.survey_job_no FROM survey_reports sr JOIN cases c ON c.id = sr.case_id WHERE sr.claim_no = ANY($1)`,
      [claims]);
    const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();
    const have = new Set((ex.rows as { claim_no: string; survey_job_no: string | null }[]).map((x) => `${x.claim_no}|${norm(x.survey_job_no)}`));
    const out: Record<string, { visit_no: number | null; visit_total: number; earlier_missing: string[]; error?: string }> = {};
    for (const row of rows) {
      const claim = String(row.claim_no ?? '').trim();
      const info = r.rounds?.[claim];
      if (!info) continue;
      const key = `${claim}|${row.survey_no}`;
      if (!Array.isArray(info)) { out[key] = { visit_no: null, visit_total: 0, earlier_missing: [], error: info.error }; continue; }
      const mine = info.find((x) => norm(x.survey_no) === norm(row.survey_no));
      const visitNo = mine ? Number(mine.round) : null;
      const earlierMissing = visitNo
        ? info.filter((x) => Number(x.round) < visitNo && !have.has(`${claim}|${norm(x.survey_no)}`)).map((x) => String(x.survey_no))
        : [];
      out[key] = { visit_no: visitNo, visit_total: info.length, earlier_missing: earlierMissing };
    }
    return out;
  },

  /**
   * ปิดงานบน ISURVEY แทนหัวหน้า — "ยืนยันการตรวจสอบ" (รอตรวจข้อมูล → จบงาน) หลังอนุมัติบนเว็บ (user เคาะ 08/09/69)
   *
   * ส่งไปกับคำสั่ง: "ผลการดำเนินงาน" (survey_result) → ช่องความเห็นหัวหน้าแท็บ 1 · ตารางค่าสำรวจ 2 ฝั่ง
   * (survey_pay = ฝั่งพนักงาน, survey_expenses = ฝั่งประกัน — แทน extension se-billing ที่ user ถอด) · "ปิดการตรวจสอบ"
   * ทำด้วยบัญชี ISURVEY ของ **คนที่อนุมัติ** → ISURVEY ลงชื่อหัวหน้าตรวจถูกคน
   *
   * โหมด: ENV ISURVEY_CLOSE_LIVE='1' = ยิงจริง · ไม่ตั้ง/opts.dryRun = ทดลอง (service ประกอบคำสั่งคืนมา จดไว้ ไม่ยิง)
   * ผลจดที่ cases.isurvey_* (migration 055) — ไม่ throw ตอนเรียกอัตโนมัติ (closeAfterApprove) แต่ throw ตอนกดเอง
   * ครั้งเดียวต่อเคส: ปิดแล้ว (isurvey_closed_at) ไม่ยิงซ้ำ เว้นแต่ force (ปุ่มลองใหม่ — ISURVEY เองก็ปฏิเสธถ้าปิดไปแล้ว)
   */
  async closeCase(caseId: number, userId: number, opts: { dryRun?: boolean; force?: boolean } = {}):
    Promise<Record<string, unknown>> {
    const q = await db.query(
      `SELECT c.id, c.source, c.status, c.isurvey_closed_at,
              sr.claim_no, sr.survey_job_no, sr.survey_result, sr.checklist,
              sp.case_id AS pay_case_id, sp.total AS pay_total,
              se.id AS exp_id, se.service_fee_count, se.service_fee_price, se.travel_fee_count, se.travel_fee_price,
              se.photo_fee_count, se.photo_fee_price, se.phone_fee AS ins_phone_fee, se.bail_fee AS ins_bail_fee,
              se.claim_fee_price, se.daily_record_fee, se.other_fee_detail, se.other_fee_price
         FROM cases c
         LEFT JOIN survey_reports sr ON sr.case_id = c.id
         LEFT JOIN survey_pay sp ON sp.case_id = c.id
         LEFT JOIN LATERAL (
           SELECT * FROM survey_expenses x WHERE x.report_id = sr.id ORDER BY x.id DESC LIMIT 1
         ) se ON TRUE
        WHERE c.id = $1`, [caseId]);
    if (q.rows.length === 0) throw new AppError(404, 'Case not found');
    const row = q.rows[0];
    if (!String(row.source ?? '').startsWith('isurvey')) throw new AppError(400, 'เคสนี้ไม่ได้มาจาก ISURVEY — ไม่มีงานต้นทางให้ปิด');
    if (row.status !== 'reviewed') throw new AppError(403, 'ปิดงานบน ISURVEY ได้เฉพาะเคสที่อนุมัติแล้ว');
    const claim = String(row.claim_no ?? '').trim();
    if (!claim) throw new AppError(400, 'เคสนี้ไม่มีเลขเคลม จึงหางานบน ISURVEY ไม่ได้');
    if (row.isurvey_closed_at && !opts.force) {
      return { ok: true, skipped: 'already', closed_at: row.isurvey_closed_at };
    }
    const live = String(env.ISURVEY_CLOSE_LIVE ?? '').trim() === '1' && !opts.dryRun;

    const fail = async (msg: string) => {
      await db.query('UPDATE cases SET isurvey_close_error = $2 WHERE id = $1', [caseId, msg.slice(0, 500)]);
      notifyCaseChanged(caseId, 'isurvey', userId);
    };
    let creds: { username: string; password: string };
    try {
      creds = await isurveyCredService.getPlain(userId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await fail(`หัวหน้าที่อนุมัติยังไม่ได้ตั้งบัญชี ISURVEY — ${msg}`);
      throw e;
    }
    const rates = buildIsurveyRates(row);
    try {
      const r = await callService<{ result: Record<string, unknown> }>('/close', {
        ...creds, claim, survey_no: String(row.survey_job_no ?? '').trim(),
        comment: String(row.survey_result ?? ''), rates, dry_run: !live,
        // รายการตรวจสอบที่หัวหน้าติ๊กบนหน้าเคส → chk_* ของ ISURVEY (รหัสเดียวกัน, migration 057)
        checklist: row.checklist && typeof row.checklist === 'object' ? row.checklist : null,
      }, 240000);
      const result = r.result ?? {};
      const payload = (result.payload ?? null) as Record<string, string> | null;
      if (result.skipped === 'already_closed') {
        // หัวหน้าปิดมือไปก่อน / ยิงซ้ำ — จดว่าปิดแล้วตามเวลาของ ISURVEY (เวลาไทย) ไม่ใช่ error
        await db.query(
          `UPDATE cases SET isurvey_closed_at = COALESCE(($2::text)::timestamp AT TIME ZONE 'Asia/Bangkok', NOW()),
                            isurvey_close_payload = $3, isurvey_close_error = NULL WHERE id = $1`,
          [caseId, String(result.close_datetime ?? '').trim() || null,
           JSON.stringify({ skipped: 'already_closed', close_datetime: result.close_datetime ?? null, case: result.case ?? null })]);
        await isurveyCredService.markResult(userId, true);
        notifyCaseChanged(caseId, 'isurvey', userId);
        return { ok: true, live: false, dry_run: false, skipped: 'already_closed', message: result.message, case: result.case };
      }
      if (result.dry_run) {
        await db.query(
          `UPDATE cases SET isurvey_close_dry_at = NOW(), isurvey_close_payload = $2, isurvey_close_error = NULL WHERE id = $1`,
          [caseId, payload ? JSON.stringify(payload) : null]);
      } else {
        await db.query(
          `UPDATE cases SET isurvey_closed_at = NOW(), isurvey_close_by = $2, isurvey_close_payload = $3,
                            isurvey_close_error = NULL WHERE id = $1`,
          [caseId, userId, payload ? JSON.stringify(payload) : null]);
      }
      await isurveyCredService.markResult(userId, true);
      notifyCaseChanged(caseId, 'isurvey', userId);
      const p = payload ?? {};
      return {
        ok: true, live: !result.dry_run, dry_run: Boolean(result.dry_run), message: result.message,
        case: result.case, rates_sent: rates ? Object.keys(rates) : [],
        summary: { fields: Object.keys(p).length, comment_len: String(p.accident_summary ?? '').length,
                   sur_total: p['tab1_SUR_TOTAL-inputEl'], ins_total: p['tab1_INS_TOTAL-inputEl'],
                   ins_net: p['tab1_INS_TOTAL_NET-inputEl'] },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await fail(msg);
      throw e;
    }
  },
  /** เรียกตอนอนุมัติ — เฉพาะเคสจาก ISURVEY · ไม่ throw ไม่รอ (ผลไปโผล่ที่ป้ายบนหน้าเคส) */
  async closeAfterApprove(caseId: number, checkerId: number): Promise<void> {
    try {
      if (!this.enabled()) return;
      const c = await db.query('SELECT source FROM cases WHERE id = $1', [caseId]);
      if (!String(c.rows[0]?.source ?? '').startsWith('isurvey')) return;
      await this.closeCase(caseId, checkerId);
    } catch (e) {
      console.warn(`[isurvey-close] เคส #${caseId}:`, e instanceof Error ? e.message : e);
    }
  },
  /** ดึง 1 งานเข้าเป็นเคส (+รูป) — เจ้าของเคส = คนที่กด */
  async pull(userId: number, claim: string, surveyNo: string): Promise<Record<string, unknown>> {
    const c = String(claim ?? '').trim();
    if (!c) throw new AppError(400, 'ต้องมีเลขเคลม');
    const creds = await isurveyCredService.getPlain(userId);
    const r = await callService<{ result: Record<string, unknown> }>('/pull',
      { ...creds, claim: c, survey_no: String(surveyNo ?? '').trim(), created_by: userId, with_photos: true }, 300000);
    await isurveyCredService.markResult(userId, true);
    return r.result ?? {};
  },
};
