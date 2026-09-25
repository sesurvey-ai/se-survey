/**
 * ส่วนคำนวณล้วนของหน้า "งานแก้ไข/ต่อเนื่อง (EMCS)" — ไม่แตะ db/env เพื่อให้เทสเรียกตรงได้ (user สั่ง 25/09/69)
 *
 * ต้นทางคือ snapshot "งานค้างรายหัวหน้า" ที่ scraper ของ se-billing (extenBoard, se-billing/scraper/pull_data.py)
 * ดึงจากกล่อง INBOX ของ EMCS ทุกวัน ~06:00 แล้วอัปไว้ที่ se-billing `GET /api/dashboard`
 *   supervisors[].emcs_edit_items        = กล่อง "รายงานแก้ไข"
 *   supervisors[].emcs_continuous_items  = กล่อง "งานต่อเนื่อง"
 *   แต่ละรายการ = { claim_no, date ("01/ส.ค./2569 12:21" ตามหน้า EMCS), aging_days }
 *   หัวหน้า = ผู้ปิดงานของเคลมนั้นบน ISURVEY (ดัชนีย้อน 2 ปี) · หาไม่เจอ = "sesurvey"
 */

export type BacklogKind = 'edit' | 'continuous';
export type BacklogItem = { claim_no: string; date: string; aging_days: number | null; supervisor: string };
export type DashboardPayload = {
  generated_at?: string;
  date?: string;
  supervisors?: Array<{ name?: string; emcs_edit_items?: unknown[]; emcs_continuous_items?: unknown[] } | null>;
};

/** ชื่อกลุ่มที่ scraper ใช้กับเคลมที่หาผู้ปิดงานไม่เจอ (fallback_label ใน config ของ scraper) */
export const UNKNOWN_SUPERVISOR = 'sesurvey';

const TITLE_PREFIX = /^(?:นางสาว|นาง|นาย|น\.ส\.|mrs\.?|mr\.?|ms\.?|miss)\s*/iu;

/** ชื่อคนสำหรับเทียบ: ตัดคำนำหน้า + ช่องว่างทั้งหมด ("นาย ศุภชัย  เศรษฐชัยชาญ" = "ศุภชัย เศรษฐชัยชาญ" = "นายศุภชัย เศรษฐชัยชาญ") */
export function normPersonName(s: unknown): string {
  return String(s ?? '').trim().replace(TITLE_PREFIX, '').replace(/\s+/g, '').toLowerCase();
}

/** แตก snapshot รายหัวหน้าเป็น 2 รายการ (เรื่องละแถว) เรียงค้างนานสุดก่อน */
export function flattenBacklog(p: DashboardPayload | null | undefined): Record<BacklogKind, BacklogItem[]> {
  const out: Record<BacklogKind, BacklogItem[]> = { edit: [], continuous: [] };
  for (const s of p?.supervisors ?? []) {
    const supervisor = String(s?.name ?? '').trim() || UNKNOWN_SUPERVISOR;
    const lists: [BacklogKind, unknown][] = [['edit', s?.emcs_edit_items], ['continuous', s?.emcs_continuous_items]];
    for (const [kind, list] of lists) {
      for (const it of Array.isArray(list) ? list : []) {
        const o = (it ?? {}) as Record<string, unknown>;
        const claim = String(o.claim_no ?? '').trim();
        if (!claim) continue;
        const aging = o.aging_days === null || o.aging_days === undefined || o.aging_days === '' ? NaN : Number(o.aging_days);
        out[kind].push({ claim_no: claim, date: String(o.date ?? '').trim(), aging_days: Number.isFinite(aging) ? aging : null, supervisor });
      }
    }
  }
  for (const k of ['edit', 'continuous'] as const) {
    out[k].sort((a, b) => (b.aging_days ?? -1) - (a.aging_days ?? -1) || a.claim_no.localeCompare(b.claim_no));
  }
  return out;
}

/** ชื่อหัวหน้าใน snapshot ที่ตรงกับบัญชีที่ล็อกอิน — ไม่เจอ = null (หน้าเว็บเปิดที่ "ทั้งหมด") */
export function matchSupervisor(names: string[], person: string): string | null {
  const key = normPersonName(person);
  if (!key) return null;
  return names.find((n) => normPersonName(n) === key) ?? null;
}
