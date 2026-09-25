/**
 * หน้า "งานแก้ไข/ต่อเนื่อง (EMCS)" — เรื่องที่ค้างในกล่อง "รายงานแก้ไข" และ "งานต่อเนื่อง" ของ INBOX บน EMCS (user สั่ง 25/09/69)
 *
 * ⛔ ไม่เข้า EMCS เอง — ใช้ snapshot ที่ scraper ของ se-billing ดึงอยู่แล้วทุกวัน ~06:00 (user ชี้ให้ใช้ 25/09/69)
 *    อ่านจาก se-billing `GET /api/dashboard` ด้วย SEBILLING_URL/SEBILLING_TOKEN ชุดเดียวกับท่อ captures
 *  - se-billing เก็บเฉพาะเรื่องที่มีเลขเคลม + อายุไม่เกิน 2 ปี → จำนวนน้อยกว่าตัวเลขกล่องบนหน้า EMCS ได้
 *    (25/09/69: EMCS 114/469 แถว · snapshot 58/234 เรื่อง)
 *  - หัวหน้า = ผู้ปิดงานเคลมนั้นบน ISURVEY (ดัชนีของ scraper) · "sesurvey" = หาไม่เจอ
 *  - จับคู่เคสในเว็บเราด้วยเลขเคลม (ส่วนใหญ่ไม่มี — เป็นงานที่คีย์บน EMCS มาก่อนมีเว็บนี้)
 * cache 5 นาที (ข้อมูลเปลี่ยนวันละครั้ง) · se-billing ล่ม = บอกเหตุผล ไม่ล้มทั้งหน้า
 */
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { billingEnabled, billingFetch } from './sebilling.service';
import { flattenBacklog, matchSupervisor, UNKNOWN_SUPERVISOR, type BacklogItem, type DashboardPayload } from './emcsBacklogCore';

const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; data: DashboardPayload } | null = null;

async function loadSnapshot(): Promise<DashboardPayload> {
  if (!billingEnabled()) {
    throw new AppError(503, 'ยังไม่ได้ตั้งค่าเชื่อม se-billing (SEBILLING_URL) — ดึงรายการงานค้างบน EMCS ไม่ได้');
  }
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  let r: Awaited<ReturnType<typeof billingFetch>>;
  try {
    r = await billingFetch('/api/dashboard', { method: 'GET' });
  } catch (e) {
    const why = e instanceof Error && e.name === 'AbortError' ? 'ไม่ตอบในเวลาที่กำหนด' : (e instanceof Error ? e.message : String(e));
    throw new AppError(502, `ติดต่อ se-billing ไม่ได้ (${why})`);
  }
  if (r.status === 404) throw new AppError(404, 'se-billing ยังไม่มีข้อมูลงานค้าง — ตัวดึงรายวัน (06:00) ยังไม่เคยอัปขึ้น');
  if (!r.ok) throw new AppError(502, `se-billing ตอบกลับ ${r.status}`);
  const data = (await r.json()) as DashboardPayload;
  cache = { at: Date.now(), data };
  return data;
}

export type BacklogRow = BacklogItem & {
  /** เคสล่าสุดของเลขเคลมนี้ในเว็บเรา (ไม่มี = null) */
  case_id: number | null;
  case_status: string | null;
  /** จำนวนเคส (ครั้ง) ของเลขเคลมนี้ในเว็บเรา */
  case_count: number;
};

export async function getEmcsBacklog(userId: number) {
  const snap = await loadSnapshot();
  const lists = flattenBacklog(snap);

  const claims = [...new Set([...lists.edit, ...lists.continuous].map((x) => x.claim_no))];
  const byClaim = new Map<string, { id: number; status: string; n: number }>();
  if (claims.length) {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (sr.claim_no) sr.claim_no, c.id, c.status::text AS status,
              COUNT(*) OVER (PARTITION BY sr.claim_no)::int AS n
         FROM cases c JOIN survey_reports sr ON sr.case_id = c.id
        WHERE sr.claim_no = ANY($1::text[])
        ORDER BY sr.claim_no, c.created_at DESC, c.id DESC`,
      [claims],
    );
    for (const r of rows as { claim_no: string; id: number; status: string; n: number }[]) byClaim.set(r.claim_no, r);
  }
  const enrich = (x: BacklogItem): BacklogRow => {
    const m = byClaim.get(x.claim_no);
    return { ...x, case_id: m?.id ?? null, case_status: m?.status ?? null, case_count: m?.n ?? 0 };
  };

  // รายชื่อหัวหน้าตามลำดับใน snapshot + จำนวนต่อกล่อง
  const counts = new Map<string, { edit: number; continuous: number }>();
  for (const s of snap.supervisors ?? []) {
    const name = String(s?.name ?? '').trim() || UNKNOWN_SUPERVISOR;
    if (!counts.has(name)) counts.set(name, { edit: 0, continuous: 0 });
  }
  for (const x of lists.edit) counts.get(x.supervisor)!.edit++;
  for (const x of lists.continuous) counts.get(x.supervisor)!.continuous++;

  const me = (await db.query(`SELECT first_name, last_name FROM users WHERE id = $1`, [userId])).rows[0] as
    { first_name?: string; last_name?: string } | undefined;
  const mySupervisor = me ? matchSupervisor([...counts.keys()], `${me.first_name ?? ''} ${me.last_name ?? ''}`) : null;

  return {
    generated_at: snap.generated_at ?? null,
    date: snap.date ?? null,
    edit: lists.edit.map(enrich),
    continuous: lists.continuous.map(enrich),
    supervisors: [...counts.entries()].map(([name, c]) => ({ name, ...c })),
    my_supervisor: mySupervisor,
    unknown_supervisor: UNKNOWN_SUPERVISOR,
  };
}
