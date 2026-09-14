import { Router } from 'express';
import { z } from 'zod';
import { adminController } from '../controllers/admin.controller';
import { billingRatesController } from '../controllers/billingRates.controller';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { validate } from '../middleware/validate';
import { uploadXlsx } from '../config/multer';

const router = Router();

// All admin routes require admin role
router.use(auth, requireRole('admin'));

// Dashboard
router.get('/dashboard', adminController.getDashboardStats);

// Users CRUD
const createUserSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(8, 'รหัสผ่านต้องอย่างน้อย 8 ตัวอักษร'),
  first_name: z.string().min(1, 'First name is required'),
  last_name: z.string().min(1, 'Last name is required'),
  role: z.enum(['admin', 'surveyor', 'callcenter', 'checker']),
  supervisor_id: z.number().int().positive().optional(),
  code: z.string().max(16).optional(),
  // เบอร์โทรพนักงาน — EMCS บังคับช่อง "โทรศัพท์ผู้สำรวจภัย" (txtAcc_Tel) และเคสที่นำเข้า
  // จากไฟล์ระบบเก่าไม่มีเบอร์มาด้วย ระบบจึงหยิบจากทะเบียนนี้ไปเติมให้ (case.service)
  phone: z.string().max(20).optional(),
  // ทีม/หัวหน้าของช่าง (staff_groups) — บังคับตอนสร้างช่างใหม่ (ตรวจใน service) ไม่ให้มีช่างที่ไม่มีหัวหน้ากำกับ
  staff_group_id: z.number().int().positive().nullable().optional(),
});

const updateUserSchema = z.object({
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  role: z.enum(['admin', 'surveyor', 'callcenter', 'checker']).optional(),
  supervisor_id: z.number().int().positive().nullable().optional(),
  is_active: z.boolean().optional(),
  password: z.string().min(8, 'รหัสผ่านต้องอย่างน้อย 8 ตัวอักษร').optional(),
  code: z.string().max(16).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  staff_group_id: z.number().int().positive().nullable().optional(),
});

router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUserById);
router.post('/users', validate(createUserSchema), adminController.createUser);
router.put('/users/:id', validate(updateUserSchema), adminController.updateUser);
router.delete('/users/:id', adminController.deleteUser);
// นำเข้าทะเบียนพนักงานจาก Excel — ไม่ส่ง apply=1 = แค่ดูแผน ไม่แก้ข้อมูล
router.post('/staff/import', uploadXlsx, adminController.importStaff);

// Cases CRUD
const updateCaseSchema = z.object({
  customer_name: z.string().min(1).optional(),
  incident_location: z.string().min(1).optional(),
  status: z.enum(['pending', 'assigned', 'finished', 'surveyed', 'reviewed', 'declined']).optional(),
  assigned_to: z.number().int().positive().nullable().optional(),
});

router.get('/cases', adminController.getCases);
// ถังขยะ (14/09/69) — ต้องมาก่อน /cases/:id ไม่งั้น "trash" ถูกจับเป็น id
router.get('/cases/trash', adminController.listTrash);
router.get('/cases/:id', adminController.getCaseById);
router.put('/cases/:id', validate(updateCaseSchema), adminController.updateCase);
router.delete('/cases/:id', adminController.deleteCase);            // = พักไว้ในถังขยะ
router.post('/cases/:id/restore', adminController.restoreCase);     // กู้คืน
router.delete('/cases/:id/purge', adminController.purgeCase);       // ลบถาวร (เฉพาะที่อยู่ในถังขยะ)

// Reviews CRUD
const updateReviewSchema = z.object({
  comment: z.string().optional(),
  proposed_fee: z.number().optional(),
  approved_fee: z.number().optional(),
  status: z.enum(['pending', 'approved']).optional(),
});

router.get('/reviews', adminController.getReviews);
router.get('/reviews/:id', adminController.getReviewById);
router.put('/reviews/:id', validate(updateReviewSchema), adminController.updateReview);
router.delete('/reviews/:id', adminController.deleteReview);

// ── เรทค่าตอบแทน/เรียกเก็บ ──
// จงใจไม่ผ่าน validate() แบบ zod: ตัวแก้เรทรับคีย์ไม่คงที่ (เรทรายทีมเป็นแมป ชื่อทีมอิสระ)
// และ zod ในโปรเจกต์นี้ strip คีย์ที่ไม่รู้จักทิ้งเงียบ ๆ — กับตารางเงินคือแก้แล้วไม่เข้าโดยไม่ฟ้อง
// ฝั่ง service คัดชื่อคอลัมน์จาก whitelist อยู่แล้ว ค่าที่ไม่รู้จักตกไปเอง
router.get('/billing/overview', billingRatesController.overview);
router.get('/billing/amphurs', billingRatesController.amphurs);
router.put('/billing/amphurs/:id', billingRatesController.saveAmphur);
router.put('/billing/provinces/:id', billingRatesController.saveProvince);
router.put('/billing/tumbons/:id', billingRatesController.saveTumbon);
router.post('/billing/teams', billingRatesController.saveTeam);
router.delete('/billing/teams/:code', billingRatesController.deleteTeam);
router.put('/billing/settings/:key', billingRatesController.saveSetting);
router.get('/billing/changes', billingRatesController.changes);

export default router;
