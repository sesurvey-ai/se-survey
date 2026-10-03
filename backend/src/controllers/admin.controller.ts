import { Request, Response } from 'express';
import { adminService } from '../services/admin.service';
import { sendSuccess } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';

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
};
