import { db } from '../config/database';
import { normalizeKey, storage } from '../config/storage';
import { STALE_OPEN_HOURS } from '../services/attendance.service';

/**
 * รูปลงเวลาเข้างาน (att_*) **ใช้แสดงวันต่อวัน ไม่เก็บย้อนหลัง** (user เคาะ 25/09/69 "ไม่ต้องเก็บ ใช้แสดงแค่วันต่อวันพอ")
 *  (ก่อนหน้า 24/09/69: เคาะ 1 เดือน → ผมตั้ง 2 ปีเองจากการตีความ → user ถามกลับแล้วเคาะวันต่อวัน)
 *  - ลบรูปของรอบที่พ้นวันที่ลงเวลาแล้ว **และ** ลงเวลาออกแล้ว — รูปวันนี้ยังขึ้นครบบนบอร์ด/ตาราง/แอป
 *  - เวรดึกที่ยังทำงานข้ามคืน (รอบเปิดไม่เกิน STALE_OPEN_HOURS ชม.) เก็บไว้จนลงเวลาออก — บอร์ดวันนี้โชว์รูปรอบข้ามคืน
 *    ส่วนรอบที่เปิดค้างเกิน STALE_OPEN_HOURS (ลืมลงเวลาออก = รอบทิ้งร้าง) ลบได้
 *  - ไฟล์ att_* ที่ไม่มีแถวไหนอ้างถึง (อัปรูปแล้วลงเวลาไม่สำเร็จ) ไม่เคยแสดงที่ไหน → ลบเมื่อเกิน 24 ชม. (เวลาจากชื่อ att_<epoch ms>_…)
 *  - แถวที่ลบรูปแล้ว → check_in_photo = NULL (ตาราง "—" · บอร์ดอักษรย่อชื่อ · แอปไอคอนปฏิทิน) เวลาเข้า-ออก/พิกัดอยู่ครบ
 *  - ลบถาวร กู้ไม่ได้ (R2 ไม่เก็บเวอร์ชันเก่า · ไฟล์สำรองฐานข้อมูลไม่มีรูป)
 *    → ค่าเริ่มต้น = **รายงานอย่างเดียว** · ลบจริงเมื่อตั้ง env PHOTO_RETENTION_ENABLED=1 (user เปิดเอง)
 *  - รูปเคสเก็บ 2 ปี (คนละเรื่อง) — ยังไม่มีใบไหนถึงอายุ (เก่าสุด มิ.ย. 69) ตัวลบยังไม่ทำ ⚠️ ต้องทำก่อน มิ.ย. 71
 *
 * รันทุกชั่วโมง (รอบแรก 10 นาทีหลังเปิดเซิร์ฟเวอร์) · พังทีละไฟล์ไม่ล้มทั้งรอบ · ไม่กันโปรเซสปิด
 */
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 10 * 60 * 1000;
const RUN_EVERY_MS = 60 * 60 * 1000;
// check_in_at/work_date เก็บเป็นเวลาไทยแบบ naive — เทียบกับเวลาไทยเสมอ (ห้าม NOW() ดิบ = UTC คลาด 7 ชม.)
const BKK = "(NOW() AT TIME ZONE 'Asia/Bangkok')";
const BKK_DATE = `${BKK}::date`;

/** เปิดลบจริงหรือยัง — ต้องตั้งใจเปิดเท่านั้น ค่าอื่นทุกค่า = รายงานอย่างเดียว */
export const retentionEnabled = (): boolean => process.env.PHOTO_RETENTION_ENABLED === '1';

/** เส้นตัดอายุของไฟล์ att_* ที่ไม่มีแถวอ้างถึง = 24 ชม. ก่อน now */
export function orphanCutoffMs(now = Date.now()): number {
  return now - ORPHAN_MAX_AGE_MS;
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
        AND work_date < ${BKK_DATE}
        AND (check_out_at IS NOT NULL OR check_in_at < ${BKK} - INTERVAL '${STALE_OPEN_HOURS} hours')
      ORDER BY check_in_at`,
  );
  const ref = await db.query(`SELECT check_in_photo FROM attendance_records WHERE check_in_photo IS NOT NULL`);
  const referenced = new Set<string>(ref.rows.map((r: { check_in_photo: string }) => normalizeKey(r.check_in_photo) ?? ''));
  const orphans = expiredOrphans(await storage.listRootFiles('att_'), referenced, orphanCutoffMs());
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

// โหมดรายงานรันทุกชั่วโมง — พิมพ์ log เฉพาะตอนตัวเลขเปลี่ยน ไม่ให้ log ท่วม
let lastReport = '';

async function runOnce(): Promise<void> {
  const apply = retentionEnabled();
  try {
    const s = await purgeAttendancePhotos({ apply });
    if (!apply) {
      const report = `${s.expired}|${s.orphans}`;
      if (s.expired + s.orphans > 0 && report !== lastReport) {
        console.log(`[photoRetention] ปิดอยู่ (รายงานอย่างเดียว): รูปลงเวลาที่พ้นวันแล้ว ${s.expired} รูป`
          + ` + ไฟล์ไม่มีแถวอ้างถึง ${s.orphans} ไฟล์ — ตั้ง PHOTO_RETENTION_ENABLED=1 เพื่อลบจริง`);
      }
      lastReport = report;
      return;
    }
    if (s.deleted + s.failed > 0) {
      console.log(`[photoRetention] ลบรูปลงเวลาที่พ้นวันแล้ว: ${s.deleted} ไฟล์`
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
