/**
 * /api/emcs-backlog — งานค้างบน EMCS กล่อง "รายงานแก้ไข" + "งานต่อเนื่อง" (user สั่ง 25/09/69)
 *
 *   GET /    snapshot ล่าสุดจาก se-billing (ดึงจาก EMCS วันละครั้ง ~06:00) + เคสที่ตรงกันในเว็บเรา
 *            checker ได้เฉพาะงานของตัวเอง · admin (+ แอดมินของ se-billing) ได้ทุกคน (กรองใน service ไม่ใช่ที่หน้าเว็บ)
 *
 * เฉพาะ checker/admin · อ่านอย่างเดียว · ไม่เข้า EMCS เอง (ดู services/emcsBacklog.service.ts)
 */
import { Router, Request, Response } from 'express';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { getEmcsBacklog } from '../services/emcsBacklog.service';

const router = Router();

router.get('/', auth, requireRole('checker', 'admin'), asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await getEmcsBacklog({ id: req.user!.id, role: req.user!.role, username: req.user!.username }));
}));

export default router;
