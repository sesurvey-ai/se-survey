/**
 * รายการงานของหน้า "ตรวจสอบ" (หน้า "รายการงาน" ของหัวหน้า) — แยกจาก case.service.ts 03/10/69
 *
 * ── ทำไมไม่ดึงทั้งก้อนแบบเดิม (user สั่ง 03/10/69 ก่อนเริ่มใช้งานจริง) ──
 * เดิมทุกครั้งที่เปิด/รีเฟรช (ทุก 60 วิ + ทุกครั้งที่เคสเปลี่ยน × หัวหน้าทุกคน) ดึงงาน**ทุกทีมตั้งแต่เริ่มระบบ**
 * พร้อมนับรูป/ยอดเงิน/คิว EMCS ทีละเรื่อง แล้วค่อยคัดทีมใน JS ทิ้ง ~90% — 905 เรื่อง = 1.6 MB ต่อครั้ง
 * ถ้างานเข้าเดือนละ 10,000 เรื่อง ครบปีเป็นแสนแถวต่อครั้ง → ช้าจนเซิร์ฟเวอร์ไม่ไหว
 *  1) คัดทีมในฐานข้อมูล — แปลงรายชื่อลูกทีมเป็นรายการ id ผู้ใช้ก่อน (กติกาเดิมทุกข้อ) แล้ว WHERE assigned_to = ANY(...) ใช้ดัชนี
 *  2) view 'active' โหลดเต็มเฉพาะงานที่ยังต้องทำ: รอตรวจ · เสร็จงานรอส่งรายงาน · ตีกลับ (+ ตัวเลขของแท็บที่เหลือ)
 *  3) แท็บอนุมัติแล้ว/ส่งประกันแล้ว ทีละหน้า · ค้นหาทุกสถานะที่เซิร์ฟเวอร์ (POST — เลขทะเบียน/ชื่อไม่ไปติดใน URL/log)
 *
 * คืนของที่หน้าลิสต์ต้องใช้ **คัดงานได้โดยไม่ต้องเปิดทีละเคส**:
 *  - `import_warnings` เรื่องที่ต้องเติมก่อนอนุมัติ (เก็บตอนนำเข้า — migration 040)
 *  - `photo_count` รูปน้อยผิดปกติ = ต้องไปตามรูปก่อน (งานจากระบบเก่าทยอยอัปรูป)
 *  - `pay_total` / `has_insurer_bill` ยอด 2 ฝั่งกรอกครบหรือยัง
 *  - `review_status` / `approved_by` / `unlocked_count` แยก "รอตรวจ" กับ "อนุมัติแล้ว" และเห็นเคสที่ถูกปลดล็อกซ้ำ ๆ
 *
 * ⛔ แบ่งแท็บต้องตรงกับ groups ของหน้าเว็บ (web/src/app/inspector/page.tsx) และ reviewQueue.ts
 * ⛔ ระบุคอลัมน์ ห้าม `SELECT c.*` — ลาก isurvey_close_payload (~2.7 KB/เคส) และคอลัมน์ที่หน้าลิสต์ไม่ใช้ไปทุกแถว
 * ⛔ นับรูปด้วย subquery ไม่ใช่ JOIN — join แล้วแถวเคสจะซ้ำตามจำนวนรูป
 */
import { db } from '../config/database';
import { staffGroupService } from './staffGroup.service';
import { thStamp } from './listRows';

export type ReviewUser = { id: number; role: string };
export type ReviewTab = 'pending' | 'finished' | 'sentBack' | 'approved' | 'sent';
export type ReviewQueryView = 'approved' | 'sent' | 'search';
export interface ReviewQuery { view: ReviewQueryView; page?: number; q?: string; src?: string; who?: string }

/** แถวต่อหน้า ของแท็บอนุมัติแล้ว/ส่งประกันแล้ว */
export const REVIEW_PAGE_SIZE = 50;
/** ผลค้นหาสูงสุดต่อครั้ง (ล่าสุดก่อน) — เกินนี้หน้าเว็บบอกให้พิมพ์ละเอียดขึ้น */
export const REVIEW_SEARCH_LIMIT = 200;

/**
 * ทุกสถานะที่หน้ารายการงานเห็น
 * - ตีกลับแล้วสถานะเป็น 'assigned' (+ sent_back_at) — ต้องยังอยู่ ไม่งั้นหัวหน้าตามงาน/แก้เองไม่ได้
 * - 'finished' เสร็จงานหน้างานแล้ว ยังไม่ส่งรายงาน (07/09/69) — หัวหน้าต้องเห็นว่างานภาคสนามจบแล้ว
 */
const listed = (a = 'c') =>
  `(${a}.status IN ('surveyed', 'reviewed', 'finished') OR (${a}.status = 'assigned' AND ${a}.sent_back_at IS NOT NULL))`;

/** แท็บของแถว — กติกาเดียวกับหน้าเว็บ: ส่งประกันแล้ว (emcs_submitted_at) มาก่อนทุกสถานะ */
const TAB_SQL = `CASE WHEN c.emcs_submitted_at IS NOT NULL THEN 'sent'
  WHEN c.status = 'reviewed' THEN 'approved'
  WHEN c.status = 'assigned' AND c.sent_back_at IS NOT NULL THEN 'sentBack'
  WHEN c.status = 'finished' THEN 'finished' ELSE 'pending' END`;

const VIEW_WHERE = {
  /** งานที่ยังต้องทำ = แท็บรอตรวจ · เสร็จงานรอส่งรายงาน · ตีกลับแล้ว */
  active: `c.emcs_submitted_at IS NULL AND (c.status IN ('surveyed', 'finished') OR (c.status = 'assigned' AND c.sent_back_at IS NOT NULL))`,
  approved: `c.emcs_submitted_at IS NULL AND c.status = 'reviewed'`,
  sent: `c.emcs_submitted_at IS NOT NULL AND ${listed()}`,
  search: listed(),
};

/** อนุมัติแล้ว = อนุมัติล่าสุดก่อน · ส่งประกันแล้ว = ส่งล่าสุดก่อน (หน้าแรกคือสิ่งที่เพิ่งทำ) · ที่เหลือ = สร้างล่าสุดก่อนแบบเดิม */
const VIEW_ORDER = {
  active: 'c.created_at DESC, c.id DESC',
  approved: 'rv.reviewed_at DESC NULLS LAST, c.created_at DESC, c.id DESC',
  sent: 'c.emcs_submitted_at DESC, c.id DESC',
  search: 'c.created_at DESC, c.id DESC',
};

/**
 * ป้ายช่างสำรวจ — ⛔ ต้องตรงกับ surveyorLabel() ใน web/src/components/cases/CaseList.tsx ทุกตัวอักษร
 * (ตัวเลือกช่างบนหน้ารายการมาจากชุดนี้ แล้วกรองแท็บที่โหลดเต็มด้วยป้ายที่เว็บคิดเอง)
 * มีบัญชีในระบบ = "รหัส ชื่อ นามสกุล" · งาน OSS จาก ISURVEY (ไม่มีบัญชี) = ชื่อ/บริษัทตามรายงาน
 */
const SURVEYOR_LABEL_SQL = `CASE WHEN COALESCE(u.first_name, '') <> ''
  THEN BTRIM(CASE WHEN COALESCE(u.code, '') <> '' THEN u.code || ' ' ELSE '' END || u.first_name || ' ' || COALESCE(u.last_name, ''))
  ELSE BTRIM(COALESCE(sr.surveyor_name, '')) END`;

/** ต่อตารางที่ใช้กรอง/เรียง — ไม่มี subquery ราคาแพง (ใช้หา id ของหน้า/ผลค้นก่อน แล้วค่อยดึงรายละเอียดเฉพาะแถวนั้น) */
const BASE_FROM = `FROM cases c
  LEFT JOIN users u ON u.id = c.assigned_to
  LEFT JOIN survey_reports sr ON sr.case_id = c.id
  LEFT JOIN reviews rv ON rv.case_id = c.id`;

const ROW_SELECT = `
  SELECT c.id, c.customer_name, c.status, c.source, c.created_at, c.import_warnings,
         c.sent_back_at, c.sent_back_reason, c.sent_back_count, c.finished_at,
         c.emcs_imported_at, c.emcs_submitted_at, c.emcs_status_text,
         u.first_name AS surveyor_first_name, u.last_name AS surveyor_last_name, u.code AS surveyor_code,
         -- ชื่อช่าง/บริษัทตามรายงาน — งาน OSS (บริษัทนอก) จาก ISURVEY ไม่มีบัญชีในระบบเรา (assigned_to ว่าง)
         -- เดิมหน้ารายการโชว์ "ยังไม่ได้มอบหมาย" ทั้งที่รู้ว่าใคร/บริษัทไหนออกสำรวจ (user แจ้ง 22/09/69)
         sr.surveyor_name AS report_surveyor_name,
         sr.claim_no, sr.survey_job_no, sr.claim_ref_no, sr.license_plate,
         rv.status AS review_status, rv.unlocked_count,
         to_char(rv.reviewed_at, 'YYYY-MM-DD HH24:MI') AS approved_at,
         -- คอลัมน์ "ส่งงาน / ตรวจรายงาน" ในรายการ (10/09/69) เวลาไทย พ.ศ. — รอตรวจโชว์ส่งงาน อนุมัติแล้วโชว์ตรวจรายงาน
         ${thStamp("(rv.reviewed_at AT TIME ZONE 'UTC')")} AS reviewed_at_th,
         ${thStamp('c.submitted_at')} AS submitted_at_th,
         COALESCE(NULLIF(rv.inspector_name, ''), ck.first_name || ' ' || ck.last_name) AS approved_by,
         (SELECT COUNT(*) FROM survey_photos sp WHERE sp.report_id = sr.id) AS photo_count,
         (SELECT sp2.total FROM survey_pay sp2 WHERE sp2.case_id = c.id) AS pay_total,
         (SELECT se.service_fee_price IS NOT NULL
            FROM survey_expenses se WHERE se.report_id = sr.id) AS has_insurer_bill,
         -- ครั้งที่: ใช้เลขที่ตัวดึงงานเก็บไว้ (visit_no, migration 060) ก่อน ไม่มีค่อยนับลำดับสร้างในเลขเคลมเดียวกัน
         -- (เดิม ROW_NUMBER() ทับทั้งก้อน — ใช้ไม่ได้แล้วเมื่อโหลดทีละแท็บ/หน้า ใบก่อนหน้าอาจไม่อยู่ในชุดเดียวกัน)
         -- ไม่มีเลขเคลม = 1 (เดิมเอาทุกใบที่ไม่มีเลขเคลมมานับรวมกันเป็น "ครั้งที่ N" มั่ว)
         COALESCE(c.visit_no, CASE WHEN COALESCE(sr.claim_no, '') = '' THEN 1 ELSE (
           SELECT COUNT(*) FROM cases c2 JOIN survey_reports s2 ON s2.case_id = c2.id
            WHERE s2.claim_no = sr.claim_no AND ${listed('c2')}
              AND (c2.created_at, c2.id) <= (c.created_at, c.id)) END)::int AS visit_count,
         -- คิวนำเข้า EMCS (สถานีนำเข้า, migration 052): งานล่าสุดของเคส + ลำดับถ้ายังรอ
         ej.id AS emcs_job_id, ej.status AS emcs_job_status, ej.dry_run AS emcs_job_dry_run,
         ej.station AS emcs_job_station, ej.error AS emcs_job_error, ej.screenshot_path AS emcs_job_screenshot,
         to_char(ej.requested_at, 'HH24:MI') AS emcs_job_requested_at,
         CASE WHEN ej.status = 'queued'
              THEN (SELECT COUNT(*) FROM emcs_import_jobs q2 WHERE q2.status = 'queued' AND q2.id <= ej.id)
         END AS emcs_job_position
    FROM cases c
    LEFT JOIN users u ON c.assigned_to = u.id
    LEFT JOIN survey_reports sr ON sr.case_id = c.id
    LEFT JOIN reviews rv ON rv.case_id = c.id
    LEFT JOIN users ck ON ck.id = rv.checker_id
    LEFT JOIN LATERAL (
      SELECT j.* FROM emcs_import_jobs j WHERE j.case_id = c.id ORDER BY j.id DESC LIMIT 1
    ) ej ON TRUE`;

/** ขอบเขตทีม — null = ไม่กรอง (แอดมิน / หัวหน้าที่ยังไม่ผูกทีม เห็นทั้งหมดตามเดิม) */
export type ReviewScope = { me: number; userIds: number[] } | null;

/**
 * แปลงทีมของหัวหน้า → รายการ id ผู้ใช้ที่ถือเป็นลูกทีม (คัดทีมในฐานข้อมูลได้ ไม่ต้องดึงทุกทีมมาคัดใน JS)
 * กติกาเดิมทุกข้อ (user 07/09/69 — ให้เห็นชุดเดียวกับหน้า "งานรอตรวจ (ISURVEY)"):
 *  - ช่างที่ผูกบัญชีไว้ในรายชื่อลูกทีม (surveyor_id)
 *  - ผู้ใช้ที่ "รหัส ชื่อ นามสกุล" เข้าเงื่อนไขทีม (รหัส SE/SEC ตรง หรือชื่อบริษัท OSS ตรง) — ใช้ตัวจับคู่ตัวเดียวกับ ISURVEY
 *  - งานที่หัวหน้าคนนี้ดึง/สร้างเอง (created_by) เห็นเสมอ แม้ช่างอยู่นอกทีม → ใส่ใน WHERE
 * ตารางผู้ใช้มีหลักร้อยแถว เทียบใน JS ด้วยฟังก์ชันเดิมได้ผลตรงกันทุกคน
 */
export async function reviewScope(user?: ReviewUser): Promise<ReviewScope> {
  if (!user) return null;
  const team = await staffGroupService.filterFor(user.id, user.role);
  if (!team) return null;
  const ids = new Set<number>();
  for (const m of team.group.members ?? []) if (m.surveyor_id) ids.add(m.surveyor_id);
  const users = await db.query('SELECT id, code, first_name, last_name FROM users');
  for (const u of users.rows as Array<{ id: number; code: string | null; first_name: string | null; last_name: string | null }>) {
    if (team.match(`${u.code ?? ''} ${u.first_name ?? ''} ${u.last_name ?? ''}`.trim())) ids.add(u.id);
  }
  return { me: user.id, userIds: [...ids] };
}

/** คำค้นแบบ "มีคำนี้อยู่ตรงไหนก็ได้" สำหรับ ILIKE — % _ \ ที่พิมพ์มาเป็นตัวอักษรธรรมดา ไม่ใช่ wildcard */
export const likeContains = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

/** WHERE + พารามิเตอร์ ($1, $2, … ตามลำดับที่ใช้) · ต่อพารามิเตอร์เพิ่มได้ด้วย $ (เช่น LIMIT) */
function whereOf(base: string, scope: ReviewScope, f: { q?: string; src?: string; who?: string } = {}) {
  const values: unknown[] = [];
  const $ = (v: unknown) => { values.push(v); return `$${values.length}`; };
  const parts = [base];
  if (scope) parts.push(`c.created_by = ${$(scope.me)} OR c.assigned_to = ANY(${$(scope.userIds)}::int[])`);
  if (f.src) parts.push(`COALESCE(c.source, 'mobile') = ${$(f.src)}`);
  if (f.who) parts.push(`${SURVEYOR_LABEL_SQL} = ${$(f.who)}`);
  const q = (f.q ?? '').trim();
  if (q) {
    // ช่องเดียวกับที่หน้าเว็บเคยค้นเอง: เลขเคลม / เลขเซอร์เวย์ / เลขรับแจ้ง / ทะเบียน / ชื่อผู้เอาประกัน (มีคำนี้อยู่ตรงไหนก็ได้)
    const p = $(likeContains(q));
    parts.push(`sr.claim_no ILIKE ${p} OR sr.survey_job_no ILIKE ${p} OR sr.claim_ref_no ILIKE ${p} OR sr.license_plate ILIKE ${p} OR c.customer_name ILIKE ${p}`);
  }
  return { sql: parts.map((p) => `(${p})`).join(' AND '), values, $ };
}

/** รายละเอียดแถวตามลำดับ id ที่ให้มา (หน้าที่เลือก/ผลค้น) */
async function rowsByIds(ids: number[]): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  const r = await db.query(`${ROW_SELECT} WHERE c.id = ANY($1::int[]) ORDER BY array_position($1::int[], c.id)`, [ids]);
  return r.rows;
}

const idsOf = (rows: Array<{ id: number }>) => rows.map((r) => Number(r.id));

/**
 * รายชื่อช่างของตัวกรอง "ช่างสำรวจ" — ต้องไล่ทุกเรื่องในรายการ (งานเก่ารวมด้วย ถ้างานเยอะคือแสนแถว)
 * แต่เปลี่ยนนาน ๆ ครั้ง → จำไว้ 2 นาทีต่อขอบเขตทีม ไม่ต้องคิดใหม่ทุกรอบรีเฟรช 60 วิ × หัวหน้าทุกคน
 */
const SURVEYOR_TTL_MS = 120_000;
const surveyorCache = new Map<string, { at: number; list: string[] }>();
async function surveyorLabels(scope: ReviewScope): Promise<string[]> {
  const key = scope ? `${scope.me}:${scope.userIds.join(',')}` : '*';
  const now = Date.now();
  const hit = surveyorCache.get(key);
  if (hit && now - hit.at < SURVEYOR_TTL_MS) return hit.list;
  const s = whereOf(listed(), scope);
  const r = await db.query(`SELECT DISTINCT ${SURVEYOR_LABEL_SQL} AS label ${BASE_FROM} WHERE ${s.sql}`, s.values);
  const list = (r.rows as Array<{ label: string | null }>).map((x) => String(x.label ?? '').trim()).filter(Boolean)
    .sort((x, y) => x.localeCompare(y, 'th'));
  for (const [k, v] of surveyorCache) if (now - v.at >= SURVEYOR_TTL_MS) surveyorCache.delete(k);
  surveyorCache.set(key, { at: now, list });
  return list;
}

export const reviewList = {
  /** ทุกสถานะในก้อนเดียว (แบบเดิม) — เหลือไว้ให้เว็บรุ่นเก่าระหว่าง deploy เท่านั้น */
  async all(user?: ReviewUser) {
    const w = whereOf(listed(), await reviewScope(user));
    return (await db.query(`${ROW_SELECT} WHERE ${w.sql} ORDER BY ${VIEW_ORDER.active}`, w.values)).rows;
  },

  /**
   * งานที่ยังต้องทำทั้งหมด (โหลดเต็ม — ปกติหลักสิบถึงร้อยเรื่องต่อทีม) + ตัวเลขที่หน้ารายการต้องใช้จากแท็บที่ไม่ได้โหลดมา
   * (จำนวนอนุมัติแล้ว/ส่งประกันแล้ว · draft ค้าง · คิวสถานี EMCS · รายชื่อช่างของตัวกรอง)
   */
  async active(user?: ReviewUser) {
    const scope = await reviewScope(user);
    const a = whereOf(VIEW_WHERE.active, scope);
    const n = whereOf(listed(), scope);
    const e = whereOf(listed(), scope);
    const [rows, counts, emcs, surveyors] = await Promise.all([
      db.query(`${ROW_SELECT} WHERE ${a.sql} ORDER BY ${VIEW_ORDER.active}`, a.values),
      db.query(
        `SELECT COUNT(*) FILTER (WHERE ${VIEW_WHERE.approved})::int AS approved,
                COUNT(*) FILTER (WHERE c.emcs_submitted_at IS NOT NULL)::int AS sent,
                -- draft ค้าง = สร้างเรื่องใน EMCS แล้วแต่ยังไม่มีใครกด "ส่งงานใหม่"
                COUNT(*) FILTER (WHERE c.emcs_imported_at IS NOT NULL AND c.emcs_submitted_at IS NULL)::int AS drafts
           FROM cases c WHERE ${n.sql}`, n.values),
      // คิวสถานีนำเข้า EMCS ดูจากงานล่าสุดของแต่ละเคส (เหมือน ej ในแถว) — เริ่มจากตารางคิวซึ่งเล็กกว่ารายการมาก
      db.query(
        `SELECT j.status, COUNT(*)::int AS n
           FROM emcs_import_jobs j JOIN cases c ON c.id = j.case_id
          WHERE j.status IN ('queued', 'running', 'failed')
            AND NOT EXISTS (SELECT 1 FROM emcs_import_jobs j2 WHERE j2.case_id = j.case_id AND j2.id > j.id)
            AND (j.status <> 'failed' OR c.emcs_imported_at IS NULL)
            AND ${e.sql}
          GROUP BY j.status`, e.values),
      surveyorLabels(scope),
    ]);
    const q = (st: string) => Number((emcs.rows as Array<{ status: string; n: number }>).find((r) => r.status === st)?.n ?? 0);
    return {
      rows: rows.rows,
      meta: {
        counts: { approved: Number(counts.rows[0]?.approved ?? 0), sent: Number(counts.rows[0]?.sent ?? 0) },
        drafts: Number(counts.rows[0]?.drafts ?? 0),
        emcs: { queued: q('queued'), running: q('running'), failed: q('failed') },
        surveyors,
      },
    };
  },

  /**
   * แท็บอนุมัติแล้ว/ส่งประกันแล้ว ทีละหน้า (กรองที่มา/ช่างได้) · หรือค้นหาทุกสถานะ (view 'search')
   * ผลค้นบอกจำนวนที่พบแยกตามแท็บด้วย — หน้าเว็บโชว์ "พบ/ทั้งหมด" บนแต่ละแท็บเหมือนเดิม
   */
  async query(user: ReviewUser | undefined, q: ReviewQuery) {
    const scope = await reviewScope(user);
    const f = { src: q.src, who: q.who };
    if (q.view === 'search') {
      const needle = String(q.q ?? '').trim();
      const hits: Record<ReviewTab, number> = { pending: 0, finished: 0, sentBack: 0, approved: 0, sent: 0 };
      if (!needle) return { rows: [], hits, total: 0, limit: REVIEW_SEARCH_LIMIT };
      const h = whereOf(VIEW_WHERE.search, scope, { ...f, q: needle });
      const p = whereOf(VIEW_WHERE.search, scope, { ...f, q: needle });
      const [hitRes, idRes] = await Promise.all([
        db.query(`SELECT ${TAB_SQL} AS tab, COUNT(*)::int AS n ${BASE_FROM} WHERE ${h.sql} GROUP BY 1`, h.values),
        db.query(`SELECT c.id ${BASE_FROM} WHERE ${p.sql} ORDER BY ${VIEW_ORDER.search} LIMIT ${p.$(REVIEW_SEARCH_LIMIT)}`, p.values),
      ]);
      for (const r of hitRes.rows as Array<{ tab: ReviewTab; n: number }>) hits[r.tab] = Number(r.n);
      const total = Object.values(hits).reduce((x, y) => x + y, 0);
      return { rows: await rowsByIds(idsOf(idRes.rows)), hits, total, limit: REVIEW_SEARCH_LIMIT };
    }
    const view = q.view === 'sent' ? 'sent' : 'approved';
    const page = Math.min(Math.max(1, Math.floor(Number(q.page) || 1)), 100_000);
    const c = whereOf(VIEW_WHERE[view], scope, f);
    const p = whereOf(VIEW_WHERE[view], scope, f);
    const [countRes, idRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS n ${BASE_FROM} WHERE ${c.sql}`, c.values),
      db.query(`SELECT c.id ${BASE_FROM} WHERE ${p.sql} ORDER BY ${VIEW_ORDER[view]}
                 LIMIT ${p.$(REVIEW_PAGE_SIZE)} OFFSET ${p.$((page - 1) * REVIEW_PAGE_SIZE)}`, p.values),
    ]);
    return {
      rows: await rowsByIds(idsOf(idRes.rows)),
      total: Number(countRes.rows[0]?.n ?? 0), page, page_size: REVIEW_PAGE_SIZE,
    };
  },
};
