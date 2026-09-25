/**
 * หน้า "งานแก้ไข/ต่อเนื่อง (EMCS)" — เรื่องที่ค้างในกล่อง "รายงานแก้ไข" และ "งานต่อเนื่อง" ของ INBOX บน EMCS (user สั่ง 25/09/69)
 *
 * ⛔ ไม่เข้า EMCS เอง — ใช้ snapshot ที่ scraper ของ se-billing ดึงอยู่แล้วทุกวัน ~06:00 (user ชี้ให้ใช้ 25/09/69)
 *    อ่านจาก se-billing `GET /api/dashboard` ด้วย SEBILLING_URL/SEBILLING_TOKEN ชุดเดียวกับท่อ captures
 *  - scraper รุ่น 25/09/69 ส่ง `emcs_inbox` = ทุกแถวของ 2 กล่อง (เกิน 2 ปีติดธง ไม่ตัด) — รุ่นก่อนหน้าตัดเกิน 2 ปี/ไม่มีเลขเคลม
 *  - หัวหน้า = ผู้ปิดงานเคลมนั้นบน ISURVEY (ดัชนีของ scraper) · "sesurvey" = หาไม่เจอ
 *  - **กรองฝั่ง server**: หัวหน้าผู้ตรวจได้เฉพาะแถวของตัวเอง (จับชื่อบัญชีกับชื่อหัวหน้าในข้อมูล) · แอดมินได้ทุกแถว
 *  - จับคู่เคสในเว็บเราด้วยเลขเคลม (ส่วนใหญ่ไม่มี — เป็นงานที่คีย์บน EMCS มาก่อนมีเว็บนี้)
 * cache 5 นาที (ข้อมูลเปลี่ยนวันละครั้ง) · se-billing ล่ม = บอกเหตุผล ไม่ล้มทั้งหน้า
 */
import { db } from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { billingEnabled, billingFetch } from './sebilling.service';
import {
  matchSupervisor, snapshotBacklog, visibleRows, UNKNOWN_SUPERVISOR, type BacklogItem, type DashboardPayload,
} from './emcsBacklogCore';

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

export async function getEmcsBacklog(viewer: { id: number; role: string }) {
  const snap = await loadSnapshot();
  const b = snapshotBacklog(snap);
  const all = [...b.lists.edit, ...b.lists.continuous];

  // ชื่อหัวหน้าทั้งหมดในข้อมูล (รวมคนที่วันนี้ไม่มีงาน — ชื่ออยู่ใน supervisors[] ของ snapshot)
  const names: string[] = [];
  for (const n of [...(snap.supervisors ?? []).map((s) => String(s?.name ?? '').trim()), ...all.map((x) => x.supervisor)]) {
    if (n && !names.includes(n)) names.push(n);
  }
  const me = (await db.query(`SELECT first_name, last_name FROM users WHERE id = $1`, [viewer.id])).rows[0] as
    { first_name?: string; last_name?: string } | undefined;
  const myName = `${me?.first_name ?? ''} ${me?.last_name ?? ''}`.trim();
  const mySupervisor = matchSupervisor(names.filter((n) => n !== UNKNOWN_SUPERVISOR), myName);
  const seeAll = viewer.role === 'admin';
  const edit = visibleRows(b.lists.edit, seeAll, mySupervisor);
  const continuous = visibleRows(b.lists.continuous, seeAll, mySupervisor);

  const claims = [...new Set([...edit, ...continuous].map((x) => x.claim_no).filter(Boolean))];
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
    const m = x.claim_no ? byClaim.get(x.claim_no) : undefined;
    return { ...x, case_id: m?.id ?? null, case_status: m?.status ?? null, case_count: m?.n ?? 0 };
  };

  // จำนวนต่อหัวหน้า — แอดมินได้ทุกคน (ปุ่มเลือกดู) · หัวหน้าได้เฉพาะของตัวเอง
  const counts = new Map<string, { edit: number; continuous: number }>();
  if (seeAll) for (const n of names) counts.set(n, { edit: 0, continuous: 0 });
  else if (mySupervisor) counts.set(mySupervisor, { edit: 0, continuous: 0 });
  for (const x of edit) counts.get(x.supervisor)!.edit++;
  for (const x of continuous) counts.get(x.supervisor)!.continuous++;

  return {
    generated_at: snap.generated_at ?? null,
    date: snap.date ?? null,
    complete: b.complete,
    inbox_ok: b.ok,
    max_age_years: b.max_age_years,
    scope: seeAll ? 'all' : 'mine',
    my_name: myName,
    my_supervisor: mySupervisor,
    edit: edit.map(enrich),
    continuous: continuous.map(enrich),
    supervisors: [...counts.entries()].map(([name, c]) => ({ name, ...c })),
    unknown_supervisor: UNKNOWN_SUPERVISOR,
  };
}
