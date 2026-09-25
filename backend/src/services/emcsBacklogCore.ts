/**
 * ส่วนคำนวณล้วนของหน้า "งานแก้ไข/ต่อเนื่อง (EMCS)" — ไม่แตะ db/env เพื่อให้เทสเรียกตรงได้ (user สั่ง 25/09/69)
 *
 * ต้นทางคือ snapshot ที่ scraper ของ se-billing (extenBoard, se-billing/scraper/pull_data.py)
 * ดึงจากกล่อง INBOX ของ EMCS ทุกวัน ~06:00 แล้วอัปไว้ที่ se-billing `GET /api/dashboard`
 *  - `emcs_inbox` (scraper รุ่น 25/09/69) = **ทุกแถว** ของ 2 กล่อง + เลข e-Survey/เลขเซอร์เวย์/บริษัท/ประเภทงานติดตาม/ผู้ล็อก
 *    เกิน 2 ปีไม่ตัด ติดธง over_age (หน้าเว็บขึ้นป้ายเล็ก) · แถวไม่มีเลขเคลมก็อยู่
 *  - snapshot รุ่นเก่า (ไม่มี emcs_inbox) → ใช้ supervisors[].emcs_*_items แบบเดิม (ตัดเกิน 2 ปี/ไม่มีเลขเคลมไปแล้ว)
 *  - หัวหน้า = ผู้ปิดงานของเคลมนั้นบน ISURVEY · "sesurvey" = หาไม่เจอ
 * ใครเห็นอะไร (user สั่ง 25/09/69): หัวหน้าผู้ตรวจเห็นเฉพาะงานของตัวเอง (จับจากชื่อบัญชี) · แอดมินเห็นทุกคน
 */

export type BacklogKind = 'edit' | 'continuous';
export type BacklogItem = {
  claim_no: string; date: string; aging_days: number | null; supervisor: string;
  /** เกินอายุที่ se-billing ใช้ตัดในแดชบอร์ดเดิม (2 ปี) — หน้าเว็บขึ้นป้ายเล็ก */
  over_age: boolean;
  esurvey_no: string; survey_no: string; company: string; car_role: string; follow_type: string;
  keyer: string; lock_by: string;
};
type ItemsSupervisor = { name?: string; emcs_edit_items?: unknown[]; emcs_continuous_items?: unknown[] } | null;
export type DashboardPayload = {
  generated_at?: string;
  date?: string;
  supervisors?: ItemsSupervisor[];
  emcs_inbox?: {
    ok?: boolean; max_age_years?: number; totals?: Partial<Record<BacklogKind, number>>;
    edit?: unknown[]; continuous?: unknown[];
  } | null;
};
export type SnapshotBacklog = {
  /** true = รายการเต็มจาก emcs_inbox · false = snapshot รุ่นเก่า (ตัดเกิน 2 ปี/ไม่มีเลขเคลมไปแล้ว) */
  complete: boolean;
  /** false = รอบล่าสุดตัวดึงเข้า EMCS ไม่ได้ (รายการว่างไม่ได้แปลว่าไม่มีงาน) */
  ok: boolean;
  max_age_years: number;
  lists: Record<BacklogKind, BacklogItem[]>;
};

/** ชื่อกลุ่มที่ scraper ใช้กับเคลมที่หาผู้ปิดงานไม่เจอ (fallback_label ใน config ของ scraper) */
export const UNKNOWN_SUPERVISOR = 'sesurvey';
const DEFAULT_MAX_AGE_YEARS = 2;

const TITLE_PREFIX = /^(?:นางสาว|นาง|นาย|น\.ส\.|mrs\.?|mr\.?|ms\.?|miss)\s*/iu;

/** ชื่อคนสำหรับเทียบ: ตัดคำนำหน้า + ช่องว่างทั้งหมด ("นาย ศุภชัย  เศรษฐชัยชาญ" = "ศุภชัย เศรษฐชัยชาญ" = "นายศุภชัย เศรษฐชัยชาญ") */
export function normPersonName(s: unknown): string {
  return String(s ?? '').trim().replace(TITLE_PREFIX, '').replace(/\s+/g, '').toLowerCase();
}

const str = (v: unknown): string => String(v ?? '').trim();
const agingOf = (v: unknown): number | null => {
  const n = v === null || v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};
const overAgeDays = (years: number) => years * 365.25;
const byAgingDesc = (a: BacklogItem, b: BacklogItem) =>
  (b.aging_days ?? -1) - (a.aging_days ?? -1) || a.claim_no.localeCompare(b.claim_no) || a.esurvey_no.localeCompare(b.esurvey_no);

/** snapshot รุ่นเก่า: แตกรายหัวหน้าเป็น 2 รายการ (เรื่องละแถว) เรียงค้างนานสุดก่อน */
export function flattenBacklog(p: DashboardPayload | null | undefined): Record<BacklogKind, BacklogItem[]> {
  const out: Record<BacklogKind, BacklogItem[]> = { edit: [], continuous: [] };
  for (const s of p?.supervisors ?? []) {
    const supervisor = str(s?.name) || UNKNOWN_SUPERVISOR;
    const lists: [BacklogKind, unknown][] = [['edit', s?.emcs_edit_items], ['continuous', s?.emcs_continuous_items]];
    for (const [kind, list] of lists) {
      for (const it of Array.isArray(list) ? list : []) {
        const o = (it ?? {}) as Record<string, unknown>;
        const claim = str(o.claim_no);
        if (!claim) continue;
        const aging = agingOf(o.aging_days);
        out[kind].push({
          claim_no: claim, date: str(o.date), aging_days: aging, supervisor,
          over_age: aging !== null && aging > overAgeDays(DEFAULT_MAX_AGE_YEARS),
          esurvey_no: '', survey_no: '', company: '', car_role: '', follow_type: '', keyer: '', lock_by: '',
        });
      }
    }
  }
  for (const k of ['edit', 'continuous'] as const) out[k].sort(byAgingDesc);
  return out;
}

/** อ่าน snapshot: มี emcs_inbox = ใช้รายการเต็ม · ไม่มี = รุ่นเก่า */
export function snapshotBacklog(p: DashboardPayload | null | undefined): SnapshotBacklog {
  const inbox = p?.emcs_inbox;
  if (!inbox || !Array.isArray(inbox.edit) || !Array.isArray(inbox.continuous)) {
    return { complete: false, ok: true, max_age_years: DEFAULT_MAX_AGE_YEARS, lists: flattenBacklog(p) };
  }
  const years = Number(inbox.max_age_years) > 0 ? Number(inbox.max_age_years) : DEFAULT_MAX_AGE_YEARS;
  const map = (list: unknown[]): BacklogItem[] => list.map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    const aging = agingOf(o.aging_days);
    return {
      claim_no: str(o.claim_no), date: str(o.date), aging_days: aging,
      supervisor: str(o.supervisor) || UNKNOWN_SUPERVISOR,
      over_age: o.over_age === true || (o.over_age === undefined && aging !== null && aging > overAgeDays(years)),
      esurvey_no: str(o.esurvey_no), survey_no: str(o.survey_no), company: str(o.company), car_role: str(o.car_role),
      follow_type: str(o.follow_type) === '-' ? '' : str(o.follow_type), keyer: str(o.keyer), lock_by: str(o.lock_by),
    };
  }).sort(byAgingDesc);
  return { complete: true, ok: inbox.ok !== false, max_age_years: years, lists: { edit: map(inbox.edit), continuous: map(inbox.continuous) } };
}

/** ชื่อหัวหน้าในข้อมูลที่ตรงกับบัญชีที่ล็อกอิน — ไม่เจอ = null */
export function matchSupervisor(names: string[], person: string): string | null {
  const key = normPersonName(person);
  if (!key) return null;
  return names.find((n) => normPersonName(n) === key) ?? null;
}

/** แอดมินเห็นทุกแถว · หัวหน้าผู้ตรวจเห็นเฉพาะแถวของตัวเอง · จับชื่อไม่ได้ = ไม่เห็นเลย (ไม่ใช่ทั้งหมด) */
export function visibleRows(rows: BacklogItem[], seeAll: boolean, mySupervisor: string | null): BacklogItem[] {
  if (seeAll) return rows;
  if (!mySupervisor) return [];
  return rows.filter((r) => r.supervisor === mySupervisor);
}
