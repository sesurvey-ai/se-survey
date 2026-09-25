import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { db } from '../config/database';

// ป้องกันการเข้าถึงรูปใน /uploads โดยไม่ผ่าน auth (บัตร ปชช./ใบขับขี่/รูปลงเวลา = PII)
// รับ token ได้ 2 ทาง:
//   1. Authorization: Bearer <token>  — มือถือ (Image.network ส่ง header ได้ → token ไม่โผล่ใน URL)
//   2. ?token=<token>                 — เว็บ <img>/<a> ที่แนบ header ไม่ได้
//
// ── ตรวจสิทธิ์รายไฟล์ (เพิ่ม 2026-08-11) ────────────────────────────────────
// เดิมตรวจแค่ "ลายเซ็น JWT ถูกไหม" → ใครล็อกอินได้ (ช่างคนไหนก็ได้) เปิดรูปบัตร
// ประชาชนของทุกเคสได้ถ้ารู้ path
//
// กติกา (อิงรูปแบบ path จริงบน prod: survey_photos 193 แถวเป็น case_<id>/... ทั้งหมด,
// attendance 602 แถวเป็น att_* ทั้งหมด — ไม่มี legacy path เหลือแล้ว):
//   admin/callcenter → ทุกไฟล์ (ดูรายงานลงเวลา + จัดการเคสทั้งระบบ)
//   checker          → เฉพาะไฟล์ของเคส (case_<id>/…) ไม่รวมรูปลงเวลา ให้ตรงกับ API
//                      รายงานลงเวลาที่จำกัด admin/callcenter อยู่แล้ว
//   surveyor         → เฉพาะเคสที่มอบหมายให้ตัวเอง + รูปลงเวลาของตัวเอง
//   นอกนั้น deny
//
// ⚠️ ห้ามใช้ case_images.file_path ตัดสินความเป็นเจ้าของ — arrival ส่ง photo_path มาจาก
//    client ดิบ ๆ ไม่ validate (และเก็บเป็น 'arrival.jpg' ซ้ำกันทุกเคส) ถ้าเอามาเป็น
//    แหล่งความจริงจะกลายเป็นช่องยกระดับสิทธิ์ใหม่ — ใช้ prefix case_<id>/ ที่ backend
//    สร้างเองเท่านั้น (createCaseFolder) ส่วนรูป arrival จริงถูกเสิร์ฟผ่าน survey_photos
//    ที่ path เต็ม case_<id>/job_<id>/arrival.jpg อยู่แล้ว
//
// ⚠️ ห้ามอ่าน role จาก JWT payload — middleware/auth.ts เลิกเชื่อ role ในโทเคนไปแล้ว
//    โดยตั้งใจ (ปิดบัญชี/ลดสิทธิ์แล้วโทเคนเดิมต้องใช้ไม่ได้ทันที) ที่นี่จึงอ่านจาก DB
//    เหมือนกัน แต่ cache สั้น ๆ เพราะหน้าเดียวโหลดรูปทีละหลายสิบใบ

const CACHE_TTL_MS = 60_000;
const CACHE_MAX = 5000;

type Cached<T> = { value: T; expires: number };

function makeCache<T>() {
  const store = new Map<string, Cached<T>>();
  return {
    get(key: string): T | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires < Date.now()) { store.delete(key); return undefined; }
      return hit.value;
    },
    set(key: string, value: T): void {
      if (store.size >= CACHE_MAX) store.clear();   // กันบวมไม่จำกัด — ง่ายกว่าและพอสำหรับงานนี้
      store.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    },
    del(key: string): void { store.delete(key); },
  };
}

const userCache = makeCache<{ role: string; active: boolean } | null>();
const caseOwnerCache = makeCache<number | null>();
const attendanceOwnerCache = makeCache<number | null>();

async function getUser(id: number) {
  const key = String(id);
  const hit = userCache.get(key);
  if (hit !== undefined) return hit;
  const r = await db.query('SELECT role, is_active FROM users WHERE id = $1 LIMIT 1', [id]);
  const val = r.rows.length ? { role: r.rows[0].role as string, active: !!r.rows[0].is_active } : null;
  userCache.set(key, val);
  return val;
}

async function getCaseOwner(caseId: number) {
  const key = String(caseId);
  const hit = caseOwnerCache.get(key);
  if (hit !== undefined) return hit;
  const r = await db.query('SELECT assigned_to FROM cases WHERE id = $1 LIMIT 1', [caseId]);
  const val = r.rows.length ? (r.rows[0].assigned_to as number | null) : null;
  caseOwnerCache.set(key, val);
  return val;
}

async function getAttendanceOwner(file: string) {
  const hit = attendanceOwnerCache.get(file);
  if (hit !== undefined) return hit;
  const r = await db.query(
    'SELECT user_id FROM attendance_records WHERE check_in_photo = $1 LIMIT 1', [file]);
  const val = r.rows.length ? (r.rows[0].user_id as number) : null;
  attendanceOwnerCache.set(file, val);
  return val;
}

/** เคลียร์ cache เจ้าของเคส — เรียกตอนย้ายงานให้คนอื่น ไม่งั้นคนเดิมยังเปิดรูปได้อีก 1 นาที */
export function invalidateCaseOwner(caseId: number): void {
  caseOwnerCache.del(String(caseId));
}

// ขอรูปโดยไม่แนบ token เลย = ส่วนใหญ่คือแอป APK ก่อน 1.0.11 (11/07/69) ที่โหลดรูปลงเวลาไม่ขึ้น
// log UA (บอกเวอร์ชัน Dart ของแอปที่ build) ชั่วโมงละครั้งต่อ UA — ไว้จับคู่กับ log [appVersion] (25/09/69)
const noTokenLoggedAt = new Map<string, number>();
function logNoToken(req: Request): void {
  const ua = String(req.headers['user-agent'] || '-').slice(0, 120);
  const now = Date.now();
  if ((noTokenLoggedAt.get(ua) ?? 0) > now - 60 * 60 * 1000) return;
  if (noTokenLoggedAt.size > 500) noTokenLoggedAt.clear();
  noTokenLoggedAt.set(ua, now);
  const kind = /^\/?att_/.test(req.path) ? 'รูปลงเวลา' : /^\/?case_/.test(req.path) ? 'รูปเคส' : 'ไฟล์อื่น';
  console.log(`[uploadsAuth] ขอ${kind}โดยไม่แนบ token (แอปเก่า?): ${ua}`);
}

/** ชื่อไฟล์ที่ขอมา → รูปแบบมาตรฐาน; คืน null ถ้าน่าสงสัย (path traversal) */
function normalizePath(raw: string): string | null {
  let p: string;
  try { p = decodeURIComponent(raw); } catch { return null; }
  p = p.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!p || p.includes('..') || p.includes('\0')) return null;
  return p;
}

export const uploadsAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const header = req.headers.authorization;
  const headerToken = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const token = headerToken || queryToken;

  if (!token) {
    logNoToken(req);
    res.status(401).json({ success: false, message: 'No token provided' });
    return;
  }

  let userId: number;
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as { id: number };
    userId = decoded.id;
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
    return;
  }

  try {
    const user = await getUser(userId);
    // บัญชีถูกปิด/ถูกลบ = 401 (โทเคนใช้ไม่ได้แล้ว) ต่างจาก "มีสิทธิ์ไม่พอ" ที่เป็น 403
    if (!user || !user.active) {
      res.status(401).json({ success: false, message: 'Account is deactivated' });
      return;
    }

    if (user.role === 'admin' || user.role === 'callcenter') { next(); return; }

    const filePath = normalizePath(req.path);
    if (!filePath) { res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ดูไฟล์นี้' }); return; }

    const deny = () => res.status(403).json({ success: false, message: 'ไม่มีสิทธิ์ดูไฟล์นี้' });

    // ไฟล์ของเคส: case_<id>/job_<id>/<ชื่อไฟล์> — เลข <id> มาจาก backend ปลอมไม่ได้
    const caseMatch = /^case_(\d+)\//.exec(filePath);
    if (caseMatch) {
      if (user.role === 'checker') { next(); return; }
      if (user.role === 'surveyor') {
        const owner = await getCaseOwner(Number(caseMatch[1]));
        if (owner === userId) { next(); return; }
      }
      deny();
      return;
    }

    // รูปลงเวลาเข้า-ออกงาน: att_<ts>_<uuid>.jpg (ไฟล์เดี่ยว ไม่มีโฟลเดอร์)
    if (/^att_[\w.-]+$/.test(filePath) && user.role === 'surveyor') {
      const owner = await getAttendanceOwner(filePath);
      if (owner === userId) { next(); return; }
    }

    // ที่เหลือ (ไฟล์เดี่ยวอย่าง up_*/arrival.jpg ที่ไม่มีใครเสิร์ฟจริง) = ไม่ให้
    deny();
  } catch (err) {
    next(err);
  }
};
