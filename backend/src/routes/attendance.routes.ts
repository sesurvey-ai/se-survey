import { Router } from 'express';
import { z } from 'zod';
import { attendanceController } from '../controllers/attendance.controller';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { validate } from '../middleware/validate';
import { uploadUnique } from '../config/multer';

const router = Router();

// พิกัด GPS ตอนลงเวลา (ไม่บังคับ — ถ้าไม่มี/ปฏิเสธสิทธิ์ ก็ลงเวลาได้)
const geoSchema = z.object({
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
});

// พนักงาน (ทุก role ที่ล็อกอิน)
// เข้างาน = multipart (รูปถ่าย + lat/lng เป็น field string) — รับรูปด้วย multer
router.post('/check-in', auth, uploadUnique.single('photo'), attendanceController.checkIn);
router.post('/check-out', auth, validate(geoSchema), attendanceController.checkOut);
router.get('/today', auth, attendanceController.today);
router.get('/now', auth, attendanceController.now);
router.get('/mine', auth, attendanceController.mine);

// รายงานสำหรับผู้จัดการ
router.get('/report', auth, requireRole('admin', 'callcenter'), attendanceController.report);
router.get('/latest-photos', auth, requireRole('admin', 'callcenter'), attendanceController.latestPhotos);

export default router;
