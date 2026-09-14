import { adminService, TRASH_DAYS } from '../services/admin.service';

/**
 * ลบจริงเคสในถังขยะที่พักครบกำหนด (TRASH_DAYS = 30 วัน) — ตัวเดียวกับปุ่ม "ลบถาวร" ในถังขยะ
 * (ลบไฟล์รูป/รายงาน/ใบอนุมัติครบ ไม่ใช่ลบแถวเปล่า ๆ) · user สั่ง 14/09/69
 *
 * รันตอนเปิดเซิร์ฟเวอร์ (หน่วง 1 นาที ให้ DB พร้อม) แล้วทุก 6 ชม. · พังทีละเคสไม่ล้มทั้งรอบ · ไม่กันโปรเซสปิด
 */
const FIRST_RUN_DELAY_MS = 60 * 1000;
const RUN_EVERY_MS = 6 * 60 * 60 * 1000;

async function purgeOnce(): Promise<void> {
  try {
    const r = await adminService.purgeExpired();
    if (r.purged > 0 || r.failed.length > 0) {
      console.log(`[trashPurge] ลบถาวรเคสที่พักในถังขยะเกิน ${TRASH_DAYS} วัน: ${r.purged} เคส`
        + (r.failed.length ? ` · ล้มเหลว ${r.failed.length} (#${r.failed.join(', #')})` : ''));
    }
  } catch (e) {
    console.error('[trashPurge] รอบนี้ล้มเหลว:', (e as Error).message);
  }
}

export function startTrashPurge(): void {
  const first = setTimeout(() => {
    void purgeOnce();
    const t = setInterval(() => { void purgeOnce(); }, RUN_EVERY_MS);
    t.unref?.();
  }, FIRST_RUN_DELAY_MS);
  first.unref?.();
}
