import { Request, Response } from 'express';
import { adminService } from '../services/admin.service';
import { sendSuccess } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';
import { planImport, applyImport } from '../services/staffImport.service';
import { AppError } from '../middleware/errorHandler';

export const adminController = {
  getDashboardStats: asyncHandler(async (_req: Request, res: Response) => {
    const stats = await adminService.getDashboardStats();
    sendSuccess(res, stats);
  }),

  // Users
  getUsers: asyncHandler(async (req: Request, res: Response) => {
    const { role, is_active, search, page, limit } = req.query;
    const result = await adminService.getUsers({
      role: role as string,
      is_active: is_active === 'true' ? true : is_active === 'false' ? false : undefined,
      search: search as string,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    sendSuccess(res, result);
  }),

  getUserById: asyncHandler(async (req: Request, res: Response) => {
    const user = await adminService.getUserById(Number(req.params.id));
    sendSuccess(res, user);
  }),

  createUser: asyncHandler(async (req: Request, res: Response) => {
    const user = await adminService.createUser(req.body);
    sendSuccess(res, user, 201);
  }),

  updateUser: asyncHandler(async (req: Request, res: Response) => {
    const user = await adminService.updateUser(Number(req.params.id), req.body);
    sendSuccess(res, user);
  }),

  deleteUser: asyncHandler(async (req: Request, res: Response) => {
    await adminService.deleteUser(Number(req.params.id), req.user!.id);
    sendSuccess(res, { message: 'User deactivated' });
  }),

  // Cases
  getCases: asyncHandler(async (req: Request, res: Response) => {
    const { status, search, page, limit } = req.query;
    const result = await adminService.getCases({
      status: status as string,
      search: search as string,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    sendSuccess(res, result);
  }),

  getCaseById: asyncHandler(async (req: Request, res: Response) => {
    const detail = await adminService.getCaseById(Number(req.params.id));
    sendSuccess(res, detail);
  }),

  updateCase: asyncHandler(async (req: Request, res: Response) => {
    const caseData = await adminService.updateCase(Number(req.params.id), req.body, req.user?.id ?? null);
    sendSuccess(res, caseData);
  }),

  // ลบ = พักไว้ในถังขยะ (กู้คืนได้ · ลบจริงเองหลัง TRASH_DAYS) — user สั่ง 14/09/69
  deleteCase: asyncHandler(async (req: Request, res: Response) => {
    const r = await adminService.deleteCase(Number(req.params.id), req.user?.id ?? null);
    sendSuccess(res, { message: 'Case moved to trash', ...r });
  }),
  listTrash: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await adminService.listTrash());
  }),
  restoreCase: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await adminService.restoreCase(Number(req.params.id), req.user?.id ?? null));
  }),
  purgeCase: asyncHandler(async (req: Request, res: Response) => {
    await adminService.purgeCase(Number(req.params.id));
    sendSuccess(res, { message: 'Case purged' });
  }),

  // Reviews
  getReviews: asyncHandler(async (req: Request, res: Response) => {
    const { status, page, limit } = req.query;
    const result = await adminService.getReviews({
      status: status as string,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    sendSuccess(res, result);
  }),

  getReviewById: asyncHandler(async (req: Request, res: Response) => {
    const review = await adminService.getReviewById(Number(req.params.id));
    sendSuccess(res, review);
  }),

  updateReview: asyncHandler(async (req: Request, res: Response) => {
    const review = await adminService.updateReview(Number(req.params.id), req.body);
    sendSuccess(res, review);
  }),

  deleteReview: asyncHandler(async (req: Request, res: Response) => {
    await adminService.deleteReview(Number(req.params.id));
    sendSuccess(res, { message: 'Review deleted' });
  }),

  // ── นำเข้าทะเบียนพนักงานจากไฟล์ Excel ของฝ่ายบุคคล ──
  // ค่าเริ่มต้นคือ "ดูแผนก่อน" เสมอ — ต้องส่ง apply=1 มาถึงจะแก้ข้อมูลจริง
  importStaff: asyncHandler(async (req: Request, res: Response) => {
    const file = (req.file as Express.Multer.File | undefined);
    if (!file) throw new AppError(400, 'กรุณาแนบไฟล์ Excel (.xlsx)');
    const on = (k: string) => String(req.body?.[k] ?? '') === '1';
    if (String(req.body?.apply ?? '') !== '1') {
      sendSuccess(res, { mode: 'plan', ...(await planImport(file.buffer)) });
      return;
    }
    const result = await applyImport(file.buffer, {
      passwordMode: String(req.body?.password_mode ?? '') === 'code3' ? 'code3' as const : 'fixed' as const,
      newPassword: String(req.body?.new_password ?? ''),
      doCreate: on('do_create'), doPhone: on('do_phone'), doName: on('do_name'),
      doSupervisor: on('do_supervisor'), doDeactivate: on('do_deactivate'),
    });
    sendSuccess(res, { mode: 'apply', ...result });
  }),
};
