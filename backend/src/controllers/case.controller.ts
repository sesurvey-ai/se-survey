import { Request, Response } from 'express';
import { getDispatchLog } from '../services/dispatchLog.service';
import { provinceOf } from '../services/geoProvince';
import { nearestDistrict } from '../services/geoDistrict';
import { caseService } from '../services/case.service';
import * as payService from '../services/pay.service';
import { buildPayWorkbook } from '../services/payExport.service';
import { sendSuccess } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';
import { parseIsurveyXml } from '../services/xmlImport.service';
import { AppError } from '../middleware/errorHandler';
import { getMoneyAudit } from '../services/moneyAudit';

export const caseController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const result = await caseService.create(req.body, req.user!.id);
    sendSuccess(res, result, 201);
  }),

  getMyCases: asyncHandler(async (req: Request, res: Response) => {
    const cases = await caseService.getMyCases(req.user!.id);
    sendSuccess(res, cases);
  }),

  /**
   * พิกัด → จังหวัด/อำเภอ **สำหรับเสนอให้คนยืนยัน** บนหน้าจอมือถือ
   *
   * ⛔ จังหวัดมาจากขอบเขตจริง (เชื่อได้) แต่ **อำเภอเป็นการเดาจากจุดกลาง** —
   *    คืน `district_guess` ชื่อนี้โดยตั้งใจ ให้คนเรียกรู้ว่าต้องให้คนยืนยันก่อนใช้
   */
  resolveArea: asyncHandler(async (req: Request, res: Response) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    // GPS จับไม่ได้ (ในอาคาร/ห้าง) = คืนค่าว่าง ให้คนเลือกเอง — ห้ามล้มให้แอปค้าง
    const ok = Number.isFinite(lat) && Number.isFinite(lng);
    const province = ok ? provinceOf(lat, lng) : null;
    sendSuccess(res, {
      province,
      district_guess: province ? nearestDistrict(lat, lng, province) : null,
    });
  }),

  createFollowup: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const result = await caseService.createFollowup(caseId, req.user!.id);
    sendSuccess(res, result);
  }),

  assign: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const { surveyor_id, claim_type } = req.body;
    const result = await caseService.assign(caseId, surveyor_id, claim_type, req.user!.id);
    sendSuccess(res, result);
  }),

  /** ประวัติการจ่ายงาน (มอบหมาย/ดึงกลับ/ปฏิเสธ) ใหม่ → เก่า — หน้าจ่ายงานคอลเซ็นเตอร์ (migration 065) */
  dispatchLog: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await getDispatchLog(parseInt(req.params.id as string)));
  }),

  /** คอลเซ็นเตอร์ "ดึงงานกลับ" — งานกลับไปรอมอบหมาย + ถอนการ์ดบนเครื่องช่าง ดู caseService.recall */
  recall: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const result = await caseService.recall(caseId, req.user!.id);
    sendSuccess(res, result);
  }),

  submitSurvey: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const result = await caseService.submitSurvey(caseId, req.user!.id, req.body);
    sendSuccess(res, result);
  }),

  updateSurvey: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const result = await caseService.updateSurvey(caseId, req.user!.id, req.body);
    sendSuccess(res, result);
  }),

  getCase: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const result = await caseService.getById(caseId);
    sendSuccess(res, result);
  }),

  getForReview: asyncHandler(async (req: Request, res: Response) => {
    const cases = await caseService.getForReview(req.user ? { id: req.user.id, role: req.user.role } : undefined);
    sendSuccess(res, cases);
  }),

  /** ผู้ตรวจสอบเพิ่มรูปเองจากหน้าเคส (เพิ่มอย่างเดียว ไม่ลบของเดิม) */
  addPhotos: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) throw new AppError(400, 'กรุณาเลือกรูปอย่างน้อย 1 ไฟล์');
    // หมวดต้องอยู่ในชุดเดียวกับที่ระบบใช้อยู่ — พิมพ์อิสระแล้วแกลเลอรีจะแตกกลุ่มใหม่
    // และฝั่งบอทจะจับหมวดไม่ได้ตอนอัปเข้าระบบประกัน
    const CATS = ['รูปรถประกัน', 'รูปรถคู่กรณี', 'รูปผู้บาดเจ็บ', 'รูปทรัพย์สิน',
                  'รูปแผนที่เกิดเหตุ', 'รูปประกอบ'];
    const category = String(req.body?.category ?? '').trim();
    if (!CATS.includes(category)) {
      throw new AppError(400, `หมวดรูปไม่ถูกต้อง — ต้องเป็นหนึ่งใน: ${CATS.join(' / ')}`);
    }
    const result = await caseService.addCasePhotos(caseId, files, category);
    sendSuccess(res, result);
  }),

  /** ผู้ตรวจสอบลบรูปออกจากเคส (ก่อนอนุมัติเท่านั้น) */
  deletePhoto: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const photoId = parseInt(req.params.photoId as string);
    if (!Number.isFinite(photoId)) throw new AppError(400, 'photoId ไม่ถูกต้อง');
    const result = await caseService.deleteCasePhoto(caseId, photoId, req.user?.id);
    sendSuccess(res, result);
  }),

  /** ผู้ตรวจสอบหมุนรูป (เขียนทับไฟล์ — ก่อนอนุมัติเท่านั้น) */
  rotatePhoto: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const photoId = parseInt(req.params.photoId as string);
    if (!Number.isFinite(photoId)) throw new AppError(400, 'photoId ไม่ถูกต้อง');
    const deg = Number(req.body?.deg);
    const result = await caseService.rotateCasePhoto(caseId, photoId, deg);
    sendSuccess(res, result);
  }),

  getDetail: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const detail = await caseService.getDetail(caseId, req.user);
    sendSuccess(res, detail);
  }),

  // ดาวน์โหลด INSERT_SURV_REPORT_XML (สำหรับ import เข้าพอร์ทัลประกัน)
  /** นำเข้าเคสจากไฟล์ XML ของ ISURVEY (+ zip รูป) — flow ระบบเก่าที่กำลังเลิกใช้ */
  importXml: asyncHandler(async (req: Request, res: Response) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const xmlFile = files?.xml?.[0];
    if (!xmlFile) throw new AppError(400, 'กรุณาแนบไฟล์ XML ของรายงานสำรวจ');
    const insuranceCompany = String((req.body?.insurance_company ?? '')).trim();
    if (!insuranceCompany) throw new AppError(400, 'กรุณาเลือกบริษัทประกัน — XML ของ ISURVEY ไม่มีข้อมูลนี้ และบอทต้องใช้เลือกบริษัทก่อนนำเข้า EMCS');

    const parsed = parseIsurveyXml(xmlFile.buffer.toString('utf8'));
    const result = await caseService.importFromXml(parsed, {
      insuranceCompany,
      createdBy: req.user!.id,
    });

    let photos = { added: 0, perCat: {} as Record<string, number> };
    const zipFile = files?.zip?.[0];
    if (zipFile) photos = await caseService.importPhotoZip(result.caseId, zipFile.buffer);

    res.json({
      success: true,
      data: {
        ...result,
        photos,
        warnings: parsed.warnings,
        hasMoney: parsed.expenses !== null,
      },
    });
  }),

  exportXml: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const xml = await caseService.getSurveyXml(caseId, req.user);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="survey_${caseId}.xml"`);
    res.send(xml);
  }),

  updateReport: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    // base_rev = เลขรุ่นที่หน้าเว็บจำไว้ตอนเปิดเคส (กันหัวหน้า 2 คนบันทึกทับกัน)
    // แยกออกจาก body ก่อนเสมอ ไม่ให้หลุดไปปนกับช่องข้อมูลของรายงาน
    const { base_rev: baseRev, ...body } = (req.body ?? {}) as Record<string, unknown>;
    const result = await caseService.updateReport(caseId, body, { userId: req.user?.id, baseRev });
    sendSuccess(res, result);
  }),

  /** แอดมินแก้ตัวระบุตัวเคส (บริษัทประกัน/สาขา/เลขเซอร์เวย์/เลขรับแจ้ง/เลขเคลม) */
  updateIdentity: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    sendSuccess(res, await caseService.updateCaseIdentity(caseId, req.body));
  }),

  /** ตีกลับให้ผู้สำรวจไปแก้ในแอป — สถานะกลับเป็น "กำลังสำรวจ" (เหตุผลบังคับกรอก) */
  sendBack: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const result = await caseService.sendBackToSurveyor(caseId, req.user!.id, String(req.body?.reason ?? ''));
    sendSuccess(res, result);
  }),

  /** ยกเลิกงาน / เลิกยกเลิก (22/09/69) */
  cancelCase: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    sendSuccess(res, await caseService.cancelCase(caseId, req.user!.id, String(req.body?.reason ?? '')));
  }),
  uncancelCase: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    sendSuccess(res, await caseService.uncancelCase(caseId, req.user!.id));
  }),

  /** ค่าตอบแทนผู้สำรวจของเคสนี้ — ยอดที่บันทึกไว้ + ยอดที่ระบบแนะนำจากตารางเรท */
  getPay: asyncHandler(async (req: Request, res: Response) => {
    // ?province=&district=&subdistrict=&claim_type= = พื้นที่ที่กำลังเลือกบนหน้า (ยังไม่บันทึก) — เรทแนะนำต้องตามทัน
    // &location=survey|accident = ชุดที่ส่งมาคือสถานที่ออกตรวจสอบหรือสถานที่เกิดเหตุ (บอกในบรรทัดเรท)
    const q = (k: string) => (typeof req.query[k] === 'string' ? String(req.query[k]) : null);
    sendSuccess(res, await payService.getCasePay(parseInt(req.params.id as string), {
      province: q('province'), district: q('district'), subdistrict: q('subdistrict'), claim_type: q('claim_type'),
      location: q('location'),
    }));
  }),

  savePay: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const body = (req.body ?? {}) as Record<string, unknown>;
    sendSuccess(res, await payService.saveCasePay(caseId, body, req.user?.id, body.base_rev));
  }),

  /** ประวัติการแก้ยอดเงินของเคส (ใหม่→เก่า) */
  moneyAudit: asyncHandler(async (req: Request, res: Response) => {
    sendSuccess(res, await getMoneyAudit(parseInt(req.params.id as string)));
  }),

  /** ใบเบิกเงินค่าตอบแทนผู้สำรวจ (.xlsx) — กรองตามช่วงวันที่คิดเงิน */
  exportPayXlsx: asyncHandler(async (req: Request, res: Response) => {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const wb = await buildPayWorkbook({ from, to });
    const stamp = [from, to].filter(Boolean).join('_') || 'all';
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="surveyor_pay_${stamp}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  }),

  uploadCaseFolder: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const folder = req.body?.folder || '';
    const files = req.files as Express.Multer.File[];
    const result = await caseService.uploadCaseFolder(caseId, folder, files || [], req.user, req.body?.keep);
    sendSuccess(res, result);
  }),

  listCaseFolder: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const result = await caseService.listCaseFolder(caseId, req.user);
    sendSuccess(res, result);
  }),

  createCaseFolder: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const result = await caseService.createCaseFolder(caseId, req.user);
    sendSuccess(res, result);
  }),

  declineCase: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    // reason ไม่บังคับ — APK เก่ายังยิง body ว่างมา ต้องไม่พังทั้งที่ปฏิเสธได้ตามปกติ
    const result = await caseService.declineCase(caseId, req.user!.id, req.body?.reason);
    sendSuccess(res, result);
  }),

  /** ช่างกด "เสร็จงาน" หน้างาน — สถานะ finished (ยังไม่ส่ง ยังแก้ได้ รับงานใหม่ได้) ดู caseService.finishCase */
  finishCase: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const result = await caseService.finishCase(caseId, req.user!.id);
    sendSuccess(res, result);
  }),

  /** เครื่องช่างยืนยันว่าแจ้งเตือนถึงเครื่องแล้ว (ยิงจาก native ทันทีที่ FCM เข้า) */
  ackPush: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const result = await caseService.ackPush(caseId, req.user!.id);
    sendSuccess(res, result);
  }),

  /** หน้าจ่ายงานถามว่าแจ้งเตือนถึงเครื่องหรือยัง — ตอบเบา ๆ เพราะถูก poll ทุก 2 วินาที */
  getPushStatus: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const result = await caseService.getPushStatus(caseId);
    sendSuccess(res, result);
  }),

  confirmArrival: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const { photo_path, lat, lng, province, district } = req.body;
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
    const result = await caseService.confirmArrival(caseId, req.user!.id, photo_path, {
      lat: num(lat), lng: num(lng), province, district,
    });
    sendSuccess(res, result);
  }),

  getArrivalPhotos: asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const photos = await caseService.getArrivalPhotos(caseId, req.user);
    sendSuccess(res, photos);
  }),

  getStats: asyncHandler(async (_req: Request, res: Response) => {
    const stats = await caseService.getStats();
    sendSuccess(res, stats);
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const page = req.query.page ? parseInt(req.query.page as string) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const status = (req.query.status as string) || undefined;
    const search = (req.query.search as string) || undefined;
    const result = await caseService.list({ page, limit, status, search });
    sendSuccess(res, result);
  }),

  getWorkload: asyncHandler(async (_req: Request, res: Response) => {
    const data = await caseService.activeWorkload();
    sendSuccess(res, data);
  }),
};
