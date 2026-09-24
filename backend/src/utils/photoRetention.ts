import { db } from '../config/database';
import { normalizeKey, storage } from '../config/storage';

/**
 * อายุเก็บรูป: **รูปลงเวลาเข้า-ออกงาน (att_*) เก็บ 2 ปี เท่ารูปเคส**
 *  (24/09/69 user เคาะ 1 เดือนก่อน แล้วเปลี่ยนเป็น 2 ปีวันเดียวกัน — ต้องการให้รูปพนักงานตอนลงเวลายังแสดงย้อนหลัง
 *   ในตารางลงเวลา/บอร์ดเข้างาน/ประวัติในแอป) ⛔ อย่าลดกลับเป็น 1 เดือนเองโดย user ไม่สั่ง
 *  - รูปเคส (รวมรูปถึงที่เกิดเหตุซึ่งอยู่ในโฟลเดอร์เคส) ยังไม่มีใบไหนถึง 2 ปี — เก่าสุด มิ.ย. 69
 *    → ตัวลบรูปเคสยังไม่ทำ ⚠️ ต้องทำก่อน มิ.ย. 71 · รูปลงเวลาเก่าสุด ก.ค. 69 ถึงอายุ ก.ค. 71
 *  - ลบถาวร กู้ไม่ได้ (R2 ไม่เก็บเวอร์ชันเก่า · ไฟล์สำรองฐานข้อมูลไม่มีรูป)
 *    → ค่าเริ่มต้น = **รายงานอย่างเดียว** · ลบจริงเมื่อตั้ง env PHOTO_RETENTION_ENABLED=1 (user เปิดเอง)
 *  - แถวที่ลบรูปแล้ว → check_in_photo = NULL (ตารางลงเวลาขึ้น "—" · บอร์ดเข้างานขึ้นอักษรย่อชื่อ · แอปขึ้นไอคอนปฏิทิน)
 *  - ไฟล์ att_* ที่ไม่มีแถวไหนอ้างถึง (อัปรูปแล้วลงเวลาไม่สำเร็จ) ดูอายุจากเวลาในชื่อ att_<epoch ms>_…
 *
 * รันวันละครั้ง (รอบแรก 10 นาทีหลังเปิดเซิร์ฟเวอร์) · พังทีละไฟล์ไม่ล้มทั้งรอบ · ไม่กันโปรเซสปิด
 */
export const ATTENDANCE_PHOTO_YEARS = 2;
const FIRST_RUN_DELAY_MS = 10 * 60 * 1000;
const RUN_EVERY_MS = 24 * 60 * 60 * 1000;
// check_in_at เก็บเป็นเวลาไทยแบบ naive — เทียบกับเวลาไทยเสมอ (ห้าม NOW() ดิบ = UTC คลาด 7 ชม.)
const BKK = "(NOW() AT TIME ZONE 'Asia/Bangkok')";

/** เปิดลบจริงหรือยัง — ต้องตั้งใจเปิดเท่านั้น ค่าอื่นทุกค่า = รายงานอย่างเดียว */
export const retentionEnabled = (): boolean => process.env.PHOTO_RETENTION_ENABLED === '1';

/** เส้นตัดอายุของไฟล์ att_* ที่ไม่มีแถวอ้างถึง = ย้อนหลัง ATTENDANCE_PHOTO_YEARS ปีจาก now */
export function attendanceCutoffMs(now = Date.now()): number {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() - ATTENDANCE_PHOTO_YEARS);
  return d.getTime();
}

/** ไฟล์ att_* ที่ไม่มีแถวไหนอ้างถึงและเก่ากว่า cutoff (เวลาจากชื่อไฟล์ att_<epoch ms>_<id>.<ext>) */
export function expiredOrphans(names: string[], referenced: Set<string>, cutoffMs: number): string[] {
  return names.filter((n) => {
    const m = /^att_(\d{13})_[\w-]+\.\w+$/.exec(n);
    return !!m && Number(m[1]) < cutoffMs && !referenced.has(n);
  });
}

export type RetentionStats = { expired: number; orphans: number; deleted: number; failed: number };

/** apply=false = นับอย่างเดียว ไม่ลบอะไร */
export async function purgeAttendancePhotos(opts: { apply: boolean }): Promise<RetentionStats> {
  const { rows } = await db.query(
    `SELECT id, check_in_photo FROM attendance_records
      WHERE check_in_photo IS NOT NULL
        AND check_in_at < ${BKK} - INTERVAL '${ATTENDANCE_PHOTO_YEARS} years'
      ORDER BY check_in_at`,
  );
  const ref = await db.query(`SELECT check_in_photo FROM attendance_records WHERE check_in_photo IS NOT NULL`);
  const referenced = new Set<string>(ref.rows.map((r: { check_in_photo: string }) => normalizeKey(r.check_in_photo) ?? ''));
  const orphans = expiredOrphans(await storage.listRootFiles('att_'), referenced, attendanceCutoffMs());
  const stats: RetentionStats = { expired: rows.length, orphans: orphans.length, deleted: 0, failed: 0 };
  if (!opts.apply) return stats;

  for (const r of rows as { id: number; check_in_photo: string }[]) {
    try {
      await storage.del(r.check_in_photo);
      // ล้างค่าเฉพาะแถวที่ยังชี้ไฟล์เดิม (กันชนกับการแก้แถวระหว่างรอบ)
      await db.query(
        `UPDATE attendance_records SET check_in_photo = NULL WHERE id = $1 AND check_in_photo = $2`,
        [r.id, r.check_in_photo],
      );
      stats.deleted++;
    } catch {
      stats.failed++;
    }
  }
  for (const name of orphans) {
    try { await storage.del(name); stats.deleted++; } catch { stats.failed++; }
  }
  return stats;
}

async function runOnce(): Promise<void> {
  const apply = retentionEnabled();
  try {
    const s = await purgeAttendancePhotos({ apply });
    if (!apply) {
      if (s.expired + s.orphans > 0) {
        console.log(`[photoRetention] ปิดอยู่ (รายงานอย่างเดียว): รูปลงเวลาเกิน ${ATTENDANCE_PHOTO_YEARS} ปี ${s.expired} รูป`
          + ` + ไฟล์ไม่มีแถวอ้างถึง ${s.orphans} ไฟล์ — ตั้ง PHOTO_RETENTION_ENABLED=1 เพื่อลบจริง`);
      }
      return;
    }
    if (s.deleted + s.failed > 0) {
      console.log(`[photoRetention] ลบรูปลงเวลาเกิน ${ATTENDANCE_PHOTO_YEARS} ปี: ${s.deleted} ไฟล์`
        + ` (มีแถว ${s.expired} · ไม่มีแถว ${s.orphans})` + (s.failed ? ` · พลาด ${s.failed}` : ''));
    }
  } catch (e) {
    console.error('[photoRetention] รอบนี้ล้มเหลว:', (e as Error).message);
  }
}

export function startPhotoRetention(): void {
  const first = setTimeout(() => {
    void runOnce();
    const t = setInterval(() => { void runOnce(); }, RUN_EVERY_MS);
    t.unref?.();
  }, FIRST_RUN_DELAY_MS);
  first.unref?.();
}
