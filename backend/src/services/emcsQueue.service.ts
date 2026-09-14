/**
 * คิวนำเข้า EMCS สำหรับ "สถานีนำเข้า" (migration 052) — user ตัดสิน 04/09/69
 *
 * ทางเดิม: ปุ่ม "นำเข้า EMCS" คุยกับบอทบนเครื่องที่กด (127.0.0.1:8765) — ต้องติดตั้งบอท + ตั้ง token
 * + Chrome ขออนุญาตเครือข่ายภายใน ทุกเครื่อง · ทางใหม่: กดจากเครื่องไหนก็ได้ → งานเข้าคิวที่นี่ →
 * บอทบนเครื่องสถานี (`main.py --station`) มารับทีละเรื่อง (ล็อกอิน EMCS ครั้งเดียวต่อกะ) แล้วรายงานผลกลับ
 *
 * กติกา
 *  - เข้าคิวได้เฉพาะเคสที่อนุมัติแล้ว (status = reviewed) และยังไม่เคยนำเข้า (emcs_imported_at IS NULL)
 *  - 1 เคสมีงานค้าง (queued/running) ได้งานเดียว — กดซ้ำ = ได้งานเดิมกลับไป ไม่สร้างใบใหม่
 *  - ยกเลิกได้เฉพาะตอน queued (running = บอทกำลังแตะ EMCS อยู่ หยุดกลางคันไม่ได้)
 *  - "สำเร็จ" ของงานจริง = บอท mark cases.emcs_imported_at ผ่านท่อเดิม (/integrations/cases/:id/emcs-imported)
 *    คิวเก็บแค่ประวัติ/สาเหตุพัง/ภาพหน้าจอ — กันซ้ำ 3 ชั้นเดิมยังเป็นคนตัดสิน
 *  - สถานีตาย/เน็ตหลุดระหว่างทำ: งานที่ running แล้วไม่มี heartbeat เกิน STALE_MIN นาที → กลับเข้าคิว
 *    (ไม่เกิน MAX_ATTEMPTS ครั้ง แล้วถือว่า failed ให้คนดู)
 */
import { db } from '../config/database';
import { storage } from '../config/storage';
import { AppError, NotFoundError } from '../middleware/errorHandler';
import { notifyCaseChanged } from './caseEvents';

const STALE_MIN = 40;      // งานหนึ่งปกติ 2–10 นาที (รูปเยอะ) — เกินนี้ = สถานีหายไปแล้ว
const MAX_ATTEMPTS = 3;

export interface EmcsJob {
  id: number; case_id: number; status: string; dry_run: boolean;
  requested_by: number | null; requested_at: string; started_at: string | null;
  finished_at: string | null; station: string | null; attempts: number;
  esurvey_no: string | null; error: string | null; log_tail: string | null; screenshot_path: string | null;
}

const JOB_COLS = `
  j.id, j.case_id, j.status, j.dry_run, j.requested_by, j.attempts, j.station, j.esurvey_no, j.error,
  j.log_tail, j.screenshot_path,
  to_char(j.requested_at, 'YYYY-MM-DD HH24:MI') AS requested_at,
  to_char(j.started_at,   'YYYY-MM-DD HH24:MI') AS started_at,
  to_char(j.finished_at,  'YYYY-MM-DD HH24:MI') AS finished_at`;

export const emcsQueueService = {
  /** ส่งเคสเข้าคิว — idempotent: มีงานค้างอยู่แล้วคืนงานเดิม */
  async enqueue(caseId: number, userId: number | null, opts: { dryRun?: boolean } = {}): Promise<EmcsJob & { existing?: boolean }> {
    const c = await db.query(
      `SELECT c.id, c.status, c.emcs_imported_at, c.emcs_esurvey_no FROM cases c WHERE c.id = $1`, [caseId]);
    if (c.rows.length === 0) throw new NotFoundError('ไม่พบเคส');
    if (c.rows[0].status !== 'reviewed') {
      throw new AppError(409, 'เคสยังไม่ได้อนุมัติ — อนุมัติก่อนจึงส่งเข้าคิวนำเข้า EMCS ได้');
    }
    if (c.rows[0].emcs_imported_at && !opts.dryRun) {
      throw new AppError(409, `เคสนี้นำเข้า EMCS แล้ว${c.rows[0].emcs_esurvey_no ? ` (e-Survey ${c.rows[0].emcs_esurvey_no})` : ''} — ไม่ส่งซ้ำ (EMCS จะสร้างเรื่องซ้ำที่เลขเคลมเดิม)`);
    }
    const active = await db.query(
      `SELECT ${JOB_COLS} FROM emcs_import_jobs j WHERE j.case_id = $1 AND j.status IN ('queued','running') ORDER BY j.id DESC LIMIT 1`,
      [caseId]);
    if (active.rows.length > 0) return { ...(active.rows[0] as EmcsJob), existing: true };
    const ins = await db.query(
      `INSERT INTO emcs_import_jobs (case_id, requested_by, dry_run) VALUES ($1, $2, $3) RETURNING id`,
      [caseId, userId, Boolean(opts.dryRun)]);
    notifyCaseChanged(caseId, 'emcs_queue', userId);
    return this.get(ins.rows[0].id);
  },

  async get(jobId: number): Promise<EmcsJob> {
    const r = await db.query(`SELECT ${JOB_COLS} FROM emcs_import_jobs j WHERE j.id = $1`, [jobId]);
    if (r.rows.length === 0) throw new NotFoundError('ไม่พบงานในคิว');
    return r.rows[0] as EmcsJob;
  },

  /** งานล่าสุดของเคส (ทุกสถานะ) — หน้าเคสใช้โชว์ผล/สาเหตุพัง */
  async latestForCase(caseId: number): Promise<EmcsJob | null> {
    const r = await db.query(
      `SELECT ${JOB_COLS} FROM emcs_import_jobs j WHERE j.case_id = $1 ORDER BY j.id DESC LIMIT 1`, [caseId]);
    return (r.rows[0] as EmcsJob) ?? null;
  },

  /** ยกเลิกงานที่ยังไม่ถูกรับ (queued เท่านั้น) */
  async cancel(caseId: number, userId: number | null): Promise<{ cancelled: boolean; reason?: string }> {
    const r = await db.query(
      `UPDATE emcs_import_jobs SET status = 'cancelled', finished_at = NOW() AT TIME ZONE 'Asia/Bangkok',
              error = 'ยกเลิกโดยผู้ใช้'
        WHERE case_id = $1 AND status = 'queued' RETURNING id`, [caseId]);
    if (r.rowCount === 0) {
      const running = await db.query(
        `SELECT station FROM emcs_import_jobs WHERE case_id = $1 AND status = 'running' LIMIT 1`, [caseId]);
      if (running.rows.length > 0) {
        return { cancelled: false, reason: `สถานี ${running.rows[0].station ?? ''} กำลังทำเคสนี้อยู่ — หยุดกลางคันไม่ได้ รอให้จบก่อน` };
      }
      return { cancelled: false, reason: 'ไม่มีงานที่รอในคิวของเคสนี้' };
    }
    notifyCaseChanged(caseId, 'emcs_queue', userId);
    return { cancelled: true };
  },

  /** ภาพรวมคิว (แถบบนหน้ารายการงาน) */
  async summary(): Promise<{ queued: number; running: number; failed_today: number; stations: { station: string; last_seen: string }[] }> {
    const r = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::int  AS queued,
        COUNT(*) FILTER (WHERE status = 'running')::int AS running,
        COUNT(*) FILTER (WHERE status = 'failed' AND finished_at > (NOW() AT TIME ZONE 'Asia/Bangkok') - INTERVAL '1 day')::int AS failed_today
      FROM emcs_import_jobs`);
    const st = await db.query(`
      SELECT station, to_char(MAX(COALESCE(heartbeat_at, started_at)), 'YYYY-MM-DD HH24:MI') AS last_seen
        FROM emcs_import_jobs WHERE station IS NOT NULL
       GROUP BY station ORDER BY MAX(COALESCE(heartbeat_at, started_at)) DESC LIMIT 5`);
    return { ...r.rows[0], stations: st.rows };
  },

  // ───────────── ฝั่งสถานี (integration token) ─────────────

  /**
   * สถานีขอรับงานถัดไป — atomic ด้วย FOR UPDATE SKIP LOCKED (2 สถานีไม่ชนกัน)
   * ก่อนรับ: กวาดงานที่ running ค้าง (สถานีตาย) กลับเข้าคิว
   */
  async claim(station: string): Promise<(EmcsJob & { claim_no: string | null; survey_job_no: string | null; insurance_company: string | null }) | null> {
    await this.requeueStale();
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const pick = await client.query(
        `SELECT id FROM emcs_import_jobs WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`);
      if (pick.rows.length === 0) { await client.query('COMMIT'); return null; }
      const jobId = pick.rows[0].id as number;
      await client.query(
        `UPDATE emcs_import_jobs
            SET status = 'running', station = $2, attempts = attempts + 1,
                started_at = NOW() AT TIME ZONE 'Asia/Bangkok', heartbeat_at = NOW() AT TIME ZONE 'Asia/Bangkok',
                error = NULL, log_tail = NULL, screenshot_path = NULL
          WHERE id = $1`, [jobId, station.slice(0, 80)]);
      await client.query('COMMIT');
      const r = await db.query(
        `SELECT ${JOB_COLS}, sr.claim_no, sr.survey_job_no, sr.insurance_company
           FROM emcs_import_jobs j
           LEFT JOIN survey_reports sr ON sr.case_id = j.case_id
          WHERE j.id = $1`, [jobId]);
      notifyCaseChanged(r.rows[0].case_id, 'emcs_queue', null);
      return r.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  async heartbeat(jobId: number, station: string): Promise<boolean> {
    const r = await db.query(
      `UPDATE emcs_import_jobs SET heartbeat_at = NOW() AT TIME ZONE 'Asia/Bangkok'
        WHERE id = $1 AND status = 'running' AND station = $2 RETURNING id`, [jobId, station.slice(0, 80)]);
    return (r.rowCount ?? 0) > 0;
  },

  /** สถานีรายงานผล — done/failed (+ภาพหน้าจอตอนพังเป็น base64 PNG) */
  async report(jobId: number, body: {
    ok: boolean; error?: string; esurvey_no?: string; log_tail?: string; screenshot_b64?: string;
  }): Promise<EmcsJob> {
    const job = await this.get(jobId);
    if (job.status !== 'running') throw new AppError(409, `งาน #${jobId} ไม่ได้อยู่ในสถานะ running (ตอนนี้ ${job.status})`);
    let shot: string | null = null;
    if (body.screenshot_b64) {
      try {
        const buf = Buffer.from(body.screenshot_b64, 'base64');
        if (buf.length > 0 && buf.length <= 6 * 1024 * 1024) {
          const rel = `emcs_jobs/job_${jobId}.png`;
          await storage.put(rel, buf, 'image/png');   // ดิสก์หรือ S3 ตามโหมด (config/storage.ts)
          shot = rel;
        }
      } catch { /* ภาพเป็นของแถม — เก็บไม่ได้ก็ไม่ล้มงาน */ }
    }
    await db.query(
      `UPDATE emcs_import_jobs
          SET status = $2, finished_at = NOW() AT TIME ZONE 'Asia/Bangkok',
              esurvey_no = COALESCE($3, esurvey_no), error = $4, log_tail = $5, screenshot_path = COALESCE($6, screenshot_path)
        WHERE id = $1`,
      [jobId, body.ok ? 'done' : 'failed', body.esurvey_no?.slice(0, 50) || null,
       body.ok ? null : String(body.error ?? 'ไม่ทราบสาเหตุ').slice(0, 2000),
       body.log_tail ? String(body.log_tail).slice(-6000) : null, shot]);
    notifyCaseChanged(job.case_id, 'emcs_queue', null);
    return this.get(jobId);
  },

  /** งาน running ที่ไม่มี heartbeat เกิน STALE_MIN นาที → กลับเข้าคิว (หรือ failed เมื่อครบ MAX_ATTEMPTS) */
  async requeueStale(): Promise<void> {
    const stale = await db.query(
      `SELECT id, case_id, attempts, station FROM emcs_import_jobs
        WHERE status = 'running'
          AND COALESCE(heartbeat_at, started_at) < (NOW() AT TIME ZONE 'Asia/Bangkok') - ($1 || ' minutes')::interval`,
      [String(STALE_MIN)]);
    for (const j of stale.rows as { id: number; case_id: number; attempts: number; station: string | null }[]) {
      const msg = `สถานี ${j.station ?? ''} ไม่ตอบกลับเกิน ${STALE_MIN} นาที`;
      if (j.attempts >= MAX_ATTEMPTS) {
        await db.query(
          `UPDATE emcs_import_jobs SET status = 'failed', finished_at = NOW() AT TIME ZONE 'Asia/Bangkok',
                  error = $2 WHERE id = $1`, [j.id, `${msg} — ลองมาแล้ว ${j.attempts} ครั้ง ต้องตรวจสถานี/EMCS (draft อาจถูกสร้างค้างไว้แล้ว)`]);
      } else {
        await db.query(
          `UPDATE emcs_import_jobs SET status = 'queued', station = NULL, started_at = NULL, heartbeat_at = NULL,
                  error = $2 WHERE id = $1`, [j.id, `${msg} — เข้าคิวใหม่อัตโนมัติ`]);
      }
      notifyCaseChanged(j.case_id, 'emcs_queue', null);
    }
  },
};
