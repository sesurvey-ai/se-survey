import { Request, Response } from 'express';
import { attendanceService } from '../services/attendance.service';
import { sendSuccess, sendError } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';
import { clearSurveyorLocation } from '../utils/clearSurveyorLocation';
import { broadcastSurveyorLocation } from '../utils/broadcastSurveyorLocation';
import { storage } from '../config/storage';

// แปลงค่าจาก multipart (เป็น string) -> number | null
const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const attendanceController = {
  // ลงเวลาเข้างาน — รับ multipart: photo (ไฟล์) + lat/lng (string)
  // เปิดรอบใหม่ได้ก็ต่อเมื่อไม่มีรอบที่ยังไม่ลงเวลาออกค้างอยู่
  checkIn: asyncHandler(async (req: Request, res: Response) => {
    const lat = toNum(req.body?.lat);
    const lng = toNum(req.body?.lng);
    // ต้องเปิด GPS ถึงจะลงเวลาเข้างานได้ — ไม่มีพิกัด = ไม่ให้เข้างาน
    if (lat === null || lng === null) {
      sendError(res, 'ต้องเปิด GPS เพื่อลงเวลาเข้างาน กรุณาเปิดการเข้าถึงตำแหน่งแล้วลองใหม่', 400);
      return;
    }
    // ต้องถ่ายรูปเซลฟี่ถึงจะลงเวลาเข้างานได้ — กันกรณี multipart รูปหลุดกลางทาง
    // (เน็ตอ่อน/proxy) แล้วเข้างานสำเร็จโดยไม่มีรูปแบบเงียบ ๆ ซึ่งเสียหลักฐานการลงเวลา
    const file = req.file as Express.Multer.File | undefined;
    if (!file) {
      sendError(res, 'ต้องถ่ายรูปเพื่อลงเวลาเข้างาน กรุณาถ่ายรูปแล้วลองใหม่', 400);
      return;
    }
    // ย้ายรูปจากไฟล์ชั่วคราวของ multer เข้าที่เก็บจริง (โหมด s3 = อัปขึ้น bucket) — ต้องสำเร็จก่อนบันทึกแถว
    // ไม่งั้นแถวลงเวลาชี้ไปไฟล์ที่ไม่มีใครเสิร์ฟได้ (โหมด local = ไฟล์อยู่ที่รากถูกที่แล้ว ไม่ทำอะไร)
    await storage.putFromFile(file.path, file.filename, file.mimetype);
    const row = await attendanceService.checkIn(req.user!.id, lat, lng, file.filename);
    if (!row) {
      sendError(res, 'คุณยังมีรอบที่ยังไม่ได้ลงเวลาออก กรุณาลงเวลาออกก่อนจึงจะลงเวลาเข้าใหม่ได้', 400);
      return;
    }
    // ลงเวลาเข้างานสำเร็จ (มีพิกัดแน่นอน) → ขึ้นหมุดบนแผนที่ Call Center ทันที (ไม่ต้องรอ FCM)
    // หมุดเป็นผลข้างเคียง — ถ้าพลาด (socket/db) ก็ไม่ควรทำให้การลงเวลาที่ commit แล้ว 500
    try {
      await broadcastSurveyorLocation(req.user!.id, lat, lng, 'check_in');
    } catch (err) {
      console.error('broadcastSurveyorLocation failed (check-in committed):', err);
    }
    sendSuccess(res, row);
  }),

  // ลงเวลาออกงาน
  checkOut: asyncHandler(async (req: Request, res: Response) => {
    const lat = typeof req.body?.lat === 'number' ? req.body.lat : null;
    const lng = typeof req.body?.lng === 'number' ? req.body.lng : null;
    const row = await attendanceService.checkOut(req.user!.id, lat, lng);
    if (!row) {
      sendError(res, 'ยังไม่มีรอบที่ลงเวลาเข้าค้างอยู่', 400);
      return;
    }
    // ลงเวลาออกงานแล้ว → เอาหมุดพิกัดออกจากแผนที่ Call Center
    // ลบหมุดเป็นผลข้างเคียง — ถ้าพลาดก็ไม่ควรทำให้การลงเวลาออกที่ commit แล้ว 500
    try {
      await clearSurveyorLocation(req.user!.id);
    } catch (err) {
      console.error('clearSurveyorLocation failed (check-out committed):', err);
    }
    sendSuccess(res, row);
  }),

  // สถานะวันนี้ — { sessions: [...รอบของวันนี้], open: รอบที่เปิดค้าง|null }
  today: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await attendanceService.today(req.user!.id));
  }),

  // ประวัติของฉัน
  mine: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, { records: await attendanceService.listMine(req.user!.id) });
  }),

  // รายงาน (admin/callcenter)
  report: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await attendanceService.report(req.query as Record<string, unknown>));
  }),

  // เวลา server (เวลาไทย) — บอร์ดใช้ตั้ง "วันนี้" + "ตอนนี้" แทนนาฬิกาเครื่อง
  now: asyncHandler(async (_req: Request, res: Response) => {
    sendSuccess(res, await attendanceService.now());
  }),
};
