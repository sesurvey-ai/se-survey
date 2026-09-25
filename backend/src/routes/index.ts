import { Router } from 'express';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import caseRoutes from './case.routes';
import locationRoutes from './location.routes';
import uploadRoutes from './upload.routes';
import adminRoutes from './admin.routes';
import ocrRoutes from './ocr.routes';
import consultRoutes from './consult.routes';
import leaveRoutes from './leave.routes';
import attendanceRoutes from './attendance.routes';
import dutyRoutes from './duty.routes';
import integrationRoutes from './integration.routes';
import isurveyRoutes from './isurvey.routes';
import staffGroupRoutes from './staffGroup.routes';
import emcsQueueRoutes from './emcsQueue.routes';
import emcsBacklogRoutes from './emcsBacklog.routes';
import geoRoutes from './geo.routes';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/cases', caseRoutes);
router.use('/locations', locationRoutes);
router.use('/upload', uploadRoutes);
router.use('/admin', adminRoutes);
router.use('/ocr', ocrRoutes);
router.use('/consult', consultRoutes);
router.use('/leave', leaveRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/duty', dutyRoutes);
router.use('/isurvey', isurveyRoutes);
router.use('/staff-groups', staffGroupRoutes);
router.use('/emcs-queue', emcsQueueRoutes);        // คิวนำเข้า EMCS (สถานีนำเข้า) — checker/admin
router.use('/emcs-backlog', emcsBacklogRoutes);    // งานแก้ไข/ต่อเนื่องบน EMCS (snapshot จาก se-billing) — checker/admin
router.use('/geo', geoRoutes);                     // รายชื่อตำบลตามอำเภอ (dropdown ที่อยู่ผู้ขับขี่, 16/09/69)
router.use('/integrations', integrationRoutes); // เครื่องมือภายใน (se-autokey) — service token

export default router;
