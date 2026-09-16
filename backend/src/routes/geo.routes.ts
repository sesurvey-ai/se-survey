/**
 * ข้อมูลพื้นที่ (รหัสมาตรฐานไทย จาก data/thaiAreaCodes.ts) — 16/09/69
 *   GET /api/geo/tumbons?province=<ชื่อจังหวัด>&district=<ชื่ออำเภอตามแอป>  → รายชื่อตำบลในอำเภอนั้น
 * ใช้เติม dropdown "ตำบล" ของที่อยู่ผู้ขับขี่บนเว็บ (มือถือใช้ไฟล์ assets/thai_tumbons.json ที่ generate จากชุดเดียวกัน)
 */
import { Router, Request, Response } from 'express';
import { auth } from '../middleware/auth';
import { tumbonNames } from '../services/areaCode.service';

const router = Router();

router.get('/tumbons', auth, (req: Request, res: Response) => {
  const province = String(req.query.province ?? '').trim();
  const district = String(req.query.district ?? '').trim();
  if (!province || !district) { res.status(400).json({ success: false, message: 'ต้องระบุ province และ district' }); return; }
  res.set('Cache-Control', 'private, max-age=86400');
  res.json({ success: true, data: tumbonNames(province, district) });
});

export default router;
