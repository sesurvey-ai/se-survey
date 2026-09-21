/**
 * /api/isurvey — ดึงงาน "รอตรวจข้อมูล" จาก ISURVEY เข้าเว็บด้วยบัญชีของหัวหน้าแต่ละคน (04/09/69)
 *
 *   GET    /credentials         สถานะบัญชี ISURVEY ของฉัน (ไม่มีรหัสผ่านในคำตอบ)
 *   PUT    /credentials         {username, password} บันทึก (เข้ารหัส) แล้วลองล็อกอินให้ทันที
 *   DELETE /credentials         ลบบัญชีของฉัน
 *   POST   /credentials/test    ลองล็อกอินด้วยบัญชีที่เก็บไว้
 *   GET    /pending?from&to     งานรอตรวจของบัญชีฉัน + ธงว่ามีในระบบแล้วหรือยัง
 *   POST   /pull                {claim_no, survey_no} ดึง 1 งานเข้าเป็นเคส (+รูป)
 *
 * เฉพาะ checker/admin · ทุกอย่างผูกกับ req.user (คนละบัญชี คนละงาน) · ISURVEY อ่านอย่างเดียว
 */
import { Router, Request, Response } from 'express';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { asyncHandler } from '../utils/asyncHandler';
import { sendSuccess } from '../utils/response';
import { isurveyCredService } from '../services/isurveyCred.service';
import { isurveyPullService } from '../services/isurveyPull.service';

const router = Router();
const guard = [auth, requireRole('checker', 'admin')];

router.get('/credentials', ...guard, asyncHandler(async (req: Request, res: Response) => {
  const status = await isurveyCredService.getStatus(req.user!.id);
  sendSuccess(res, { enabled: isurveyPullService.enabled(), credentials: status });
}));

router.put('/credentials', ...guard, asyncHandler(async (req: Request, res: Response) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  await isurveyCredService.save(req.user!.id, String(username ?? ''), String(password ?? ''));
  // ลองล็อกอินให้เลย — ผิดรหัสจะได้รู้ตอนนี้ ไม่ใช่ตอนกดดึงงาน (ผลจดไว้ที่ last_ok_at/last_error)
  let test: { ok: boolean; name?: string; error?: string };
  try {
    test = await isurveyPullService.testLogin(req.user!.id);
  } catch (e) {
    test = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  sendSuccess(res, { credentials: await isurveyCredService.getStatus(req.user!.id), test });
}));

router.delete('/credentials', ...guard, asyncHandler(async (req: Request, res: Response) => {
  await isurveyCredService.remove(req.user!.id);
  sendSuccess(res, { removed: true });
}));

router.post('/credentials/test', ...guard, asyncHandler(async (req: Request, res: Response) => {
  const test = await isurveyPullService.testLogin(req.user!.id);
  sendSuccess(res, { credentials: await isurveyCredService.getStatus(req.user!.id), test });
}));

router.get('/pending', ...guard, asyncHandler(async (req: Request, res: Response) => {
  const iso = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : '');
  const out = await isurveyPullService.listPending(req.user!.id, req.user!.role, iso(req.query.from), iso(req.query.to));
  sendSuccess(res, out);
}));

// สถานะ "ในระบบเรา" ของงานที่โหลดไว้ในหน้า — อ่าน DB เราอย่างเดียว ไม่แตะ ISURVEY (ไว้ให้รายการอัปเดตเองหลังอนุมัติ, 08/09/69)
router.post('/imported-status', ...guard, asyncHandler(async (req: Request, res: Response) => {
  const rows = Array.isArray(req.body?.rows) ? (req.body.rows as { claim_no?: string; survey_no?: string }[]) : [];
  const clean = rows.slice(0, 2000).map((x) => ({ claim_no: String(x.claim_no ?? ''), survey_no: String(x.survey_no ?? '') }));
  sendSuccess(res, { statuses: await isurveyPullService.importedStatus(clean) });
}));

// "ครั้งที่" ของงานที่มองเห็นในหน้า (22/09/69) — ถาม ISURVEY ผ่าน service 1 ครั้ง/เคลม + เทียบ DB เราว่าครั้งก่อนหน้ายังไม่มีใบไหน
router.post('/rounds', ...guard, asyncHandler(async (req: Request, res: Response) => {
  const rows = Array.isArray(req.body?.rows) ? (req.body.rows as { claim_no?: string; survey_no?: string }[]) : [];
  const clean = rows.slice(0, 200).map((x) => ({ claim_no: String(x.claim_no ?? ''), survey_no: String(x.survey_no ?? '') }));
  sendSuccess(res, { rounds: await isurveyPullService.rounds(req.user!.id, clean) });
}));

router.post('/pull', ...guard, asyncHandler(async (req: Request, res: Response) => {
  const { claim_no, survey_no } = (req.body ?? {}) as { claim_no?: string; survey_no?: string };
  const result = await isurveyPullService.pull(req.user!.id, String(claim_no ?? ''), String(survey_no ?? ''));
  sendSuccess(res, result);
}));

export default router;
