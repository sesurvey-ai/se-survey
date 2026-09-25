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

// log ว่าใครใช้แอปเวอร์ชันไหนจริง (25/09/69 ตามเรื่อง SE259: ฐานบอก 1.0.53 แต่เครื่องโหลดรูปลงเวลาไม่แนบ token)
// users.app_version เขียนเฉพาะคำขอที่มี X-App-Version (แอป 1.0.40+ · 11/08/69) — เครื่องที่กลับไปใช้ APK เก่า
// หรือใช้หลายเครื่อง ค่าในฐานจึงค้างได้ → log คนละครั้งต่อรอบเปิดเซิร์ฟเวอร์:
//   - ส่งเวอร์ชันมา: ครั้งแรกที่เห็นเวอร์ชันนั้นของคนนั้น
//   - ไม่ส่ง: ครั้งแรกต่อหมวด API (/api/consult, /api/attendance …) — แยกงานเบื้องหลังออกจากหน้าจอที่ใช้อยู่
//     เฉพาะ UA "Dart/…" (แอป Flutter) — ตัวตอบพิกัด native (LocationHelper.kt, UA Dalvik) ไม่ส่ง header นี้อยู่แล้ว
const diagLogged = new Set<string>();
function logOnce(key: string, line: string): void {
  if (diagLogged.has(key)) return;
  if (diagLogged.size > 5000) diagLogged.clear();
  diagLogged.add(key);
  console.log(line);
}

export function recordAppVersion(req: Request, userId: number): void {
  const raw = req.headers['x-app-version'];
  const version = (Array.isArray(raw) ? raw[0] : raw || '').toString().trim().slice(0, 30);
  const ua = String(req.headers['user-agent'] || '');
  const who = req.user?.username ?? `id ${userId}`;
  const where = `${req.method} ${req.baseUrl}${req.path}`;
  if (!version) {
    if (ua.startsWith('Dart/')) {
      logOnce(`${userId}|-|${req.baseUrl}`, `[appVersion] แอปไม่ส่งเวอร์ชัน (APK ก่อน 1.0.40 หรืองานเบื้องหลัง): ${who} · ${ua} · ${where}`);
    }
    return;
  }
  logOnce(`${userId}|${version}`, `[appVersion] ${who} ใช้แอป ${version} · ${ua} · ${where}`);
  if (lastSeen.get(userId) === version) return;

  lastSeen.set(userId, version);
  if (lastSeen.size > 5000) lastSeen.clear();
  void db.query(
    `UPDATE users SET app_version = $2, app_version_at = NOW() AT TIME ZONE 'Asia/Bangkok'
      WHERE id = $1 AND app_version IS DISTINCT FROM $2`, [userId, version]
  ).catch(() => { lastSeen.delete(userId); });
}
