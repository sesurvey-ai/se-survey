import { Request } from 'express';
import { db } from '../config/database';

// บันทึกเวอร์ชันแอปของผู้ใช้จาก header X-App-Version — **ไม่บล็อกอะไรทั้งสิ้น**
//
// ตั้งใจเป็น soft mode (user ตัดสิน 2026-08-11): แอปเก่ายังใช้งานได้ครบ แค่ขาด
// ฟีเจอร์ใหม่ ระบบแค่ต้อง "มองเห็น" ว่าใครยังไม่อัป จะได้ไล่แจก APK ถูกเครื่อง
//
// ทำไมถึงจำเป็น: APK แจกด้วยมือ ไม่มีใครรู้ว่าเครื่องไหนอยู่เวอร์ชันไหน แล้วของที่
// เปลี่ยนฝั่งเซิร์ฟเวอร์ทำให้แอปเก่าพังเงียบ — log prod วันที่ตรวจ (2026-08-11) มี
// GET /uploads/att_*.jpg ตอบ 401 จำนวน 191 ครั้ง สำเร็จ 0 ครั้ง เพราะ APK เก่าไม่แนบ token
//
// เรียกจาก middleware/auth.ts หลังตั้ง req.user (auth ถูกใส่รายเส้นทาง ไม่ใช่ก้อนเดียว
// การแขวนตรงนั้นจึงครอบคลุมทุก endpoint ที่ต้องล็อกอินโดยไม่ต้องไล่แก้ทีละ route)
//
// กติกา: ห้ามถ่วง/ห้ามทำให้ request พัง
//   - เขียนเมื่อค่าเปลี่ยนเท่านั้น (cache ในหน่วยความจำ) ไม่ใช่ทุก request
//   - ไม่ await — ปล่อยเป็น fire-and-forget
//   - error ทุกชนิดกลืนทิ้ง (แล้วลบ cache เพื่อให้ลองใหม่รอบหน้า)
const lastSeen = new Map<number, string>();

// แอป Flutter ที่ "ไม่ส่ง" X-App-Version = APK ก่อน 1.0.40 (11/08/69) — users.app_version ไม่ถูกแตะ
// จึงค้างเป็นเวอร์ชันของการติดตั้ง/เครื่องก่อนหน้าได้ (25/09/69: ฐานบอก SE259 = 1.0.53 แต่เครื่องโหลดรูปลงเวลา
// ไม่แนบ token = อาการของ APK ก่อน 1.0.11 · 11/07/69) → log ครั้งเดียวต่อคนต่อรอบเปิดเซิร์ฟเวอร์ ให้เห็นว่าใครยังใช้ APK เก่า
// เฉพาะ UA "Dart/…" (แอป Flutter) — ตัวตอบพิกัด native (LocationHelper.kt, UA Dalvik) ไม่ส่ง header นี้อยู่แล้ว
const noVersionLogged = new Set<number>();

export function recordAppVersion(req: Request, userId: number): void {
  const raw = req.headers['x-app-version'];
  const version = (Array.isArray(raw) ? raw[0] : raw || '').toString().trim().slice(0, 30);
  if (!version) {
    const ua = String(req.headers['user-agent'] || '');
    if (ua.startsWith('Dart/') && !noVersionLogged.has(userId)) {
      noVersionLogged.add(userId);
      if (noVersionLogged.size > 5000) noVersionLogged.clear();
      console.log(`[appVersion] แอปไม่ส่งเวอร์ชัน (APK ก่อน 1.0.40): ${req.user?.username ?? `id ${userId}`} · ${ua} · ${req.method} ${req.baseUrl}${req.path}`);
    }
    return;
  }
  if (lastSeen.get(userId) === version) return;

  lastSeen.set(userId, version);
  if (lastSeen.size > 5000) lastSeen.clear();
  void db.query(
    `UPDATE users SET app_version = $2, app_version_at = NOW() AT TIME ZONE 'Asia/Bangkok'
      WHERE id = $1 AND app_version IS DISTINCT FROM $2`, [userId, version]
  ).catch(() => { lastSeen.delete(userId); });
}
