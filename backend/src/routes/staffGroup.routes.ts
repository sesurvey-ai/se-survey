/**
 * /api/staff-groups — ทีมของหัวหน้าผู้ตรวจ (04/09/69)
 *
 *   GET    /mine                      ทีมของฉัน (checker/admin)
 *   POST   /mine/members              {staff_name} หัวหน้าเพิ่มลูกทีมเอง (checker/admin) — user เคาะ 09/09/69
 *   DELETE /mine/members/:memberId    หัวหน้าเอาลูกทีมออกเอง (เฉพาะสมาชิกของทีมตัวเอง)
 *   GET    /                          ทุกทีม (admin)
 *   POST   /                          {name, checker_id?} สร้างทีม (admin)
 *   PUT    /:id                       {name?, checker_id?} แก้ชื่อ/ผูกบัญชีผู้ตรวจ (admin)
 *   DELETE /:id                       ลบทีม (admin)
 *   POST   /:id/members               {staff_name} เพิ่มสมาชิก (admin)
 *   DELETE /:id/members/:memberId     ลบสมาชิก (admin)
 */
import { Router, Request, Response } from 'express';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { staffGroupService } from '../services/staffGroup.service';
import { AppError } from '../middleware/errorHandler';

const router = Router();
const num = (v: unknown) => parseInt(String(v), 10);

router.get('/mine', auth, requireRole('checker', 'admin'), asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await staffGroupService.mine(req.user!.id));
}));

/**
 * ทีมของฉัน — หัวหน้าเพิ่ม/เอาสมาชิกออกเองได้ (user เคาะ 09/09/69 · เดิม 04/09/69 ให้แก้ได้แค่แอดมิน)
 * ขอบเขต: ทำได้เฉพาะทีมที่ผูกกับบัญชีตัวเอง · ผูก/สร้าง/ลบทีมยังเป็นของแอดมิน ·
 * รายชื่อที่อยู่ทีมอื่นอยู่แล้วเพิ่มไม่ได้ (409 จาก addMember) — ต้องให้ทีมเดิม/แอดมินเอาออกก่อน
 */
const NO_TEAM = 'บัญชีของคุณยังไม่ได้ผูกกับทีม — แจ้งแอดมินผูกทีมก่อนที่ "จัดการทีมผู้ตรวจ"';
router.post('/mine/members', auth, requireRole('checker', 'admin'), asyncHandler(async (req: Request, res: Response) => {
  const g = await staffGroupService.mine(req.user!.id);
  if (!g) throw new AppError(400, NO_TEAM);
  const b = (req.body ?? {}) as { staff_name?: string };
  sendSuccess(res, await staffGroupService.addMember(g.id, String(b.staff_name ?? '')), 201);
}));
router.delete('/mine/members/:memberId', auth, requireRole('checker', 'admin'), asyncHandler(async (req: Request, res: Response) => {
  const g = await staffGroupService.mine(req.user!.id);
  if (!g) throw new AppError(400, NO_TEAM);
  // removeMember ลบด้วย (id, group_id) → แตะได้เฉพาะสมาชิกของทีมตัวเอง
  sendSuccess(res, await staffGroupService.removeMember(g.id, num(req.params.memberId)));
}));

router.use(auth, requireRole('admin'));

router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  sendSuccess(res, await staffGroupService.list());
}));
router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as { name?: string; checker_id?: number | null };
  sendSuccess(res, await staffGroupService.create(String(b.name ?? ''), b.checker_id ? num(b.checker_id) : null), 201);
}));
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await staffGroupService.get(num(req.params.id)));
}));
router.put('/:id', asyncHandler(async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as { name?: string; checker_id?: number | null; sees_thaipaiboon?: unknown };
  const patch: { name?: string; checker_id?: number | null; sees_thaipaiboon?: boolean } = {};
  if (b.name !== undefined) patch.name = String(b.name);
  if (b.checker_id !== undefined) patch.checker_id = b.checker_id === null || b.checker_id === 0 ? null : num(b.checker_id);
  // ทีมที่เห็นงานไทยไพบูลย์ทั้งหมดในหน้ารายการงาน (migration 071 · ทีมสราวุธ 03/10/69)
  if (typeof b.sees_thaipaiboon === 'boolean') patch.sees_thaipaiboon = b.sees_thaipaiboon;
  sendSuccess(res, await staffGroupService.update(num(req.params.id), patch));
}));
router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  await staffGroupService.remove(num(req.params.id));
  sendSuccess(res, { removed: true });
}));
router.post('/:id/members', asyncHandler(async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as { staff_name?: string };
  sendSuccess(res, await staffGroupService.addMember(num(req.params.id), String(b.staff_name ?? '')), 201);
}));
router.delete('/:id/members/:memberId', asyncHandler(async (req: Request, res: Response) => {
  sendSuccess(res, await staffGroupService.removeMember(num(req.params.id), num(req.params.memberId)));
}));

export default router;
