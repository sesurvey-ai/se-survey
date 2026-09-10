import { Router } from 'express';
import { z } from 'zod';
import { caseController } from '../controllers/case.controller';
import { reviewController } from '../controllers/review.controller';
import { auth } from '../middleware/auth';
import { requireRole } from '../middleware/role';
import { validate } from '../middleware/validate';
import { upload, uploadXmlZip, uploadCasePhotos } from '../config/multer';
import { numericOrBlank } from '../utils/numericField';

const router = Router();

const createCaseSchema = z.object({
  customer_name: z.string().optional().default(''),        // ไม่บังคับแล้ว (TPB อ่านจากรูป) — DB NOT NULL รับ '' ได้
  insurance_company: z.string().optional(),
  incident_location: z.string().optional().default(''),    // ไม่บังคับแล้ว (อ่านจากรูป)
  /**
   * พิกัดที่เกิดเหตุ — รับได้ทั้งตัวเลขและข้อความตัวเลข
   * ฟอร์มเว็บเก็บทุกช่องเป็นข้อความ (ค่าที่อ่านจากการ์ดไอโออิก็มาเป็นข้อความ)
   * ⛔ อย่าใช้ z.coerce.number() เฉย ๆ — ค่าว่างจะกลายเป็น 0 แล้วเคสไปโผล่กลางอ่าวกินี
   */
  incident_lat: numericOrBlank,
  incident_lng: numericOrBlank,
  // ข้อมูลเบื้องต้นจากใบเคลม (optional ทั้งหมด)
  survey_company: z.string().optional(),
  survey_company_address: z.string().optional(),
  claim_type: z.string().optional(),
  claim_no: z.string().optional(),
  claim_ref_no: z.string().optional(),
  insurance_branch: z.string().optional(),
  survey_job_no: z.string().optional(),
  car_lost: z.boolean().optional(),
  policy_no: z.string().optional(),
  policy_type: z.string().optional(),
  policy_start: z.string().optional(),
  policy_end: z.string().optional(),
  assured_name: z.string().optional(),
  prb_number: z.string().optional(),
  deductible: z.number().optional(),
  car_brand: z.string().optional(),
  car_model: z.string().optional(),
  car_type: z.string().optional(),
  car_color: z.string().optional(),
  license_plate: z.string().optional(),
  car_province: z.string().optional(),
  chassis_no: z.string().optional(),
  engine_no: z.string().optional(),
  car_reg_year: z.string().optional(),
  driver_first_name: z.string().optional(),
  driver_last_name: z.string().optional(),
  driver_phone: z.string().optional(),
  acc_date: z.string().optional(),
  acc_time: z.string().optional(),
  acc_place: z.string().optional(),
  acc_subdistrict: z.string().optional(),
  acc_province: z.string().optional(),
  acc_district: z.string().optional(),
  acc_cause: z.string().optional(),
  acc_damage_type: z.string().optional(),
  acc_detail: z.string().optional(),
  acc_fault: z.string().optional(),
  acc_reporter: z.string().optional(),
  reporter_phone: z.string().optional(),
  acc_customer_report_date: z.string().optional(),   // "ลูกค้าแจ้ง" — วันที่รับแจ้งจาก OCR หน้าการ์ด (dd/mm/พ.ศ.|HH:mm)
  acc_insurance_notify_date: z.string().optional(),
  acc_insurance_notify_time: z.string().optional(),
  receiver_name: z.string().optional(),
  surveyor_name: z.string().optional(),
  surveyor_phone: z.string().optional(),
  counterparty_plate: z.string().optional(),
  counterparty_brand: z.string().optional(),
  counterparty_insurance: z.string().optional(),
  counterparty_detail: z.string().optional(),
  notes: z.string().optional(),
  ocr_image_paths: z.array(z.string()).optional(),
});

const assignCaseSchema = z.object({
  surveyor_id: z.number().int().positive(),
  /**
   * ประเภทเคลมที่คนจ่ายงานเลือก — รหัสเดียวกับที่แอป/หน้าตรวจ/EMCS ใช้
   * F เคลมสด · D เคลมแห้ง · A งานนัดหมาย · C งานติดตาม
   * ⛔ อย่าเพิ่ม 'เจรจาสินไหม' — EMCS ไม่มีตัวเลือกนั้น (บอทติ๊กให้ไม่ได้)
   *    งานเจรจา/ติดตามเป็น "งานครั้งถัดไป" ของเคลมเดิม ไม่ใช่ประเภทบนหน้าแรก
   * optional: จ่ายงานโดยไม่เลือกก็ได้ (ช่างเลือกเองบนแอปได้อยู่แล้ว)
   */
  claim_type: z.enum(['F', 'D', 'A', 'C']).optional(),
});

const optStr = z.string().nullish();
const optNum = z.number().nullish();
const optInt = z.number().int().nullish();
const optBool = z.boolean().nullish();
// ช่องที่ "เก็บเป็นข้อความ แต่แอปส่งมาเป็นตัวเลข" — รับทั้งสองแบบแล้วแปลงเป็นข้อความ
//
// เจอจริง 2026-08-07: acc_fault_opponent_no (คู่กรณีคันที่) คอลัมน์เป็น VARCHAR(50)
// แต่แอปส่ง double มาตลอด → **ส่งรายงานไม่ผ่านทุกครั้งที่ผลคดี = คู่กรณีผิด**
// ตอบแค่ "Validation error" ไม่บอกช่อง เลยไม่มีใครรู้ว่าติดตรงไหน
// แอปเก่าที่พนักงานถือยังส่งแบบเดิม จึงต้องรับให้ได้ ไม่ใช่บังคับให้อัปแอปก่อน
// แปลงเป็นจำนวนเต็ม ('1' ไม่ใช่ '1.0') เพราะ EMCS รับเลขคันที่เป็นจำนวนเต็ม
const optStrOrNum = z.union([z.string(), z.number()]).nullish().transform((v) => {
  if (v === null || v === undefined) return v;
  return typeof v === 'number' ? String(Math.trunc(v)) : v;
});
// ข้อมูล 1:N เก็บเป็น JSONB array (คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน/ชิ้นส่วนความเสียหาย)
// element เป็น object อิสระ — ยืดหยุ่นระหว่างพัฒนา, app คุมรูปทรง, ค่อย tighten ภายหลัง
const optJsonArr = z.array(z.record(z.string(), z.any())).nullish();

const submitSurveySchema = z.object({
  // ข้อมูลรถเดิม
  car_model: optStr,
  car_color: optStr,
  license_plate: optStr,
  notes: optStr,
  photo_paths: z.array(z.string()).default([]),
  photo_categories: z.record(z.string(), z.string()).nullish(),  // local-path → หมวดรูป
  // ข้อมูลบริษัทสำรวจ
  survey_company: optStr,
  survey_company_address: optStr,
  survey_company_phone: optStr,
  // ข้อมูลเคลม
  claim_type: optStr,
  damage_level: optStr,
  car_lost: optBool,
  insurance_company: optStr,
  insurance_branch: optStr,
  survey_job_no: optStr,
  claim_ref_no: optStr,
  claim_no: optStr,
  // ข้อมูลกรมธรรม์
  prb_number: optStr,
  policy_no: optStr,
  driver_by_policy: optStr,
  policy_start: optStr,
  policy_end: optStr,
  assured_name: optStr,
  policy_type: optStr,
  assured_email: optStr,
  risk_code: optStr,
  deductible: optNum,
  // ข้อมูลรถ
  car_brand: optStr,
  car_type: optStr,
  car_province: optStr,
  chassis_no: optStr,
  engine_no: optStr,
  mileage: optInt,
  car_reg_year: optStr,
  ev_type: optStr,
  ev_battery_no: optStr,
  ev_battery_start: optStr,
  ev_charger_no: optStr,
  model_no: optStr,
  // ข้อมูลผู้ขับขี่
  driver_gender: optStr,
  driver_title: optStr,
  driver_name: optStr,
  driver_first_name: optStr,
  driver_last_name: optStr,
  driver_age: optInt,
  driver_birthdate: optStr,
  driver_phone: optStr,
  driver_address: optStr,
  driver_province: optStr,
  driver_district: optStr,
  driver_id_card: optStr,
  driver_id_type: optStr,   // 'thai' | 'foreign' — คุมการตรวจ 13 หลักฝั่งแอป
  driver_license_no: optStr,
  driver_license_type: optStr,
  driver_license_place: optStr,
  driver_license_start: optStr,
  driver_license_end: optStr,
  driver_relation: optStr,
  driver_ticket: optStr,
  // ความเสียหาย
  damage_description: optStr,
  estimated_cost: optNum,
  // "ซ่อมที่" ชื่ออู่/ศูนย์ที่นำรถเข้าซ่อม — อยู่หมวดกรมธรรม์บนหน้าจอ (ทั้งมือถือและเว็บ)
  // ต้องประกาศตรงนี้ด้วย ไม่งั้น zod ตัดคีย์ทิ้งเงียบตั้งแต่ก่อนถึง service
  repair_shop: optStr,
  // รายละเอียดอุบัติเหตุ
  acc_date: optStr,
  acc_time: optStr,
  acc_place: optStr,
  acc_subdistrict: optStr,
  acc_province: optStr,
  acc_district: optStr,
  // สถานที่ออกตรวจสอบ (มือถือ APK 1.0.105, 10/09/69) — z.object ตัดคีย์ที่ไม่ประกาศทิ้งเงียบ ๆ ต้องมีที่นี่
  survey_place: optStr,
  survey_province: optStr,
  survey_district: optStr,
  acc_cause: optStr,
  acc_damage_type: optStr,
  acc_detail: optStr,
  acc_fault: optStr,
  acc_fault_opponent_no: optStrOrNum,   // แอปเก่าส่งมาเป็นตัวเลข — ดูหมายเหตุที่ optStrOrNum
  // การสำรวจ
  acc_reporter: optStr,
  reporter_phone: optStr,
  acc_surveyor: optStr,
  acc_surveyor_branch: optStr,
  acc_surveyor_phone: optStr,
  acc_customer_report_date: optStr,
  customer_reported_at: optStr,   // ISO timestamp — ฐานเวลา SLA 24 ชม.
  acc_insurance_notify_date: optStr,
  acc_survey_arrive_date: optStr,
  acc_survey_complete_date: optStr,
  // คู่กรณี (single legacy + list)
  acc_claim_opponent: optStr,
  acc_claim_amount: optNum,
  acc_claim_total_amount: optNum,
  opposing_parties: optJsonArr,   // คู่กรณีหลายคัน (≤20)
  // ผู้บาดเจ็บ / ทรัพย์สิน / แผนภาพความเสียหายรถประกัน
  injured_persons: optJsonArr,
  damaged_property: optJsonArr,
  insured_damage: optJsonArr,
  // toggle "มี/ไม่มี" (เก็บเจตนา เผื่อเปิด "มี" แต่ยังไม่กรอกรายการ)
  has_opponents: optBool,
  has_injured: optBool,
  has_property: optBool,
  // ตำรวจ
  acc_police_name: optStr,
  acc_police_station: optStr,
  acc_police_comment: optStr,
  acc_police_date: optStr,
  acc_police_book_no: optStr,
  acc_alcohol_test: optStr,
  acc_alcohol_result: optStr,
  // ติดตามงาน
  acc_followup: optStr,
  acc_followup_count: optStr,
  acc_followup_detail: optStr,
  acc_followup_date: optStr,
  // การตรวจสอบ
  survey_result: optStr,
  review_comment: optStr,
  surveyor_comment: optStr,
});

const submitReviewSchema = z.object({
  comment: z.string().optional(),
  proposed_fee: z.number().optional(),
  approved_fee: z.number().optional(),
});

router.get('/stats', auth, requireRole('callcenter'), caseController.getStats);
router.get('/workload', auth, requireRole('callcenter', 'admin'), caseController.getWorkload);
// รายการเคสทั้งหมด (มี filter/ค้นหา/แบ่งหน้า) — ต้องมาก่อน '/:id' ไม่งั้น "list" ถูกจับเป็น id
router.get('/list', auth, requireRole('callcenter', 'admin'), caseController.list);
router.post('/', auth, requireRole('callcenter'), validate(createCaseSchema), caseController.create);
// นำเข้าเคสจากไฟล์ XML ของ ISURVEY (+ zip รูป) — flow ระบบเก่าที่กำลังเลิกใช้
// สร้างเคสสถานะ 'surveyed' ทันที (งานสำรวจทำเสร็จบน ISURVEY แล้ว) → ผู้ตรวจแก้/ปิดงานต่อ
router.post('/import-xml', auth, requireRole('callcenter', 'checker', 'admin'),
  uploadXmlZip, caseController.importXml);
router.get('/my', auth, requireRole('surveyor'), caseController.getMyCases);
// พิกัด → จังหวัด/อำเภอ ไว้ "เสนอ" บนหน้ายืนยันถึงที่เกิดเหตุ (อำเภอเป็นการเดา ต้องให้คนยืนยัน)
router.get('/resolve-area', auth, requireRole('surveyor', 'callcenter', 'admin'), caseController.resolveArea);
router.get('/review', auth, requireRole('checker'), caseController.getForReview);
// ใบเบิกเงิน (.xlsx) — ต้องอยู่ก่อน '/:id/...' ไม่งั้น 'pay' จะถูกจับเป็น id
router.get('/pay/export.xlsx', auth, requireRole('checker', 'admin'), caseController.exportPayXlsx);
router.get('/:id', auth, requireRole('callcenter', 'checker'), caseController.getCase);
router.get('/:id/detail', auth, requireRole('checker', 'surveyor'), caseController.getDetail);
router.get('/:id/export-xml', auth, requireRole('surveyor', 'checker', 'admin', 'callcenter'), caseController.exportXml);
router.post('/:id/assign', auth, requireRole('callcenter'), validate(assignCaseSchema), caseController.assign);
// เปิดงานครั้งถัดไปของเคลมเดิม (ติดตาม/นัดหมาย/เจรจา) — ก๊อปเฉพาะตัวตนของเคลม ไม่ก๊อปผลสำรวจ
router.post('/:id/followup', auth, requireRole('callcenter', 'admin'), caseController.createFollowup);
router.post('/:id/folder', auth, requireRole('surveyor'), caseController.createCaseFolder);
// เพดาน 500 ต่อคำขอ (เดิม 100 — เคสรูปเยอะจากแอปเก่าที่ส่งทีเดียวทั้งชุดชนเพดานแล้วส่งงานไม่ได้เลย)
router.post('/:id/upload-folder', auth, requireRole('surveyor'), upload.array('photos', 500), caseController.uploadCaseFolder);
// v2: แอปใหม่ส่งทีละไฟล์ + field keep (ชุดชื่อไฟล์ปัจจุบัน — server prune ไฟล์ที่ผู้ใช้ลบ)
// แยก route จาก v1 โดยตั้งใจ: ถ้าแอปใหม่เจอ backend เก่า (ไม่มี v2) จะ 404 ดัง ๆ แทนที่จะโดน
// พฤติกรรม v1 (wipe ทั้งโฟลเดอร์ต่อคำขอ) ลบรูปที่เพิ่งอัปโหลดไปเงียบ ๆ
router.post('/:id/upload-folder-v2', auth, requireRole('surveyor'), upload.array('photos', 500), caseController.uploadCaseFolder);
// รายชื่อไฟล์ที่มีแล้ว — แอปใหม่ใช้ skip ไฟล์ที่อัปโหลดสำเร็จก่อนหน้า (resume เมื่อเน็ตหลุดกลางทาง)
router.get('/:id/upload-folder', auth, requireRole('surveyor'), caseController.listCaseFolder);
router.post('/:id/arrival', auth, requireRole('surveyor'), caseController.confirmArrival);
router.post('/:id/decline', auth, requireRole('surveyor'), caseController.declineCase);
// "เสร็จงาน" หน้างาน (07/09/69) — assigned → finished; ยังไม่ใช่ส่งงาน ฟอร์มยังแก้/ส่งได้ · ช่างรับงานถัดไปได้
router.post('/:id/finish', auth, requireRole('surveyor'), caseController.finishCase);
// เครื่องช่างยืนยันว่าแจ้งเตือนถึงแล้ว (native ยิงทันทีที่ FCM เข้า ก่อนช่างกดอะไร)
router.post('/:id/push-ack', auth, requireRole('surveyor'), caseController.ackPush);
// หน้าจ่ายงาน poll ถามว่าถึงเครื่องหรือยัง — callcenter/admin เท่านั้น
router.get('/:id/push-status', auth, requireRole('callcenter', 'admin'), caseController.getPushStatus);
router.get('/:id/arrival', auth, requireRole('surveyor', 'checker'), caseController.getArrivalPhotos);
router.post('/:id/survey', auth, requireRole('surveyor'), validate(submitSurveySchema), caseController.submitSurvey);
router.put('/:id/survey', auth, requireRole('surveyor'), caseController.updateSurvey);
router.post('/:id/review', auth, requireRole('checker'), validate(submitReviewSchema), reviewController.submitReview);
// ปลดล็อกเคสที่อนุมัติแล้ว — **แอดมินเท่านั้น** ผู้ตรวจปลดเองไม่ได้ ไม่งั้นการล็อกก็ไม่มีความหมาย
router.post('/:id/unlock', auth, requireRole('admin'), reviewController.unlock);
// ส่ง/ส่งซ้ำเข้า se-billing (/captures) — เคสที่อนุมัติแล้วเท่านั้น (ตรวจใน controller)
router.post('/:id/billing-capture', auth, requireRole('checker', 'admin'), reviewController.resendBilling);
// ปิดงานบน ISURVEY แทนหัวหน้า (ยืนยันการตรวจสอบ → จบงาน) เอง/ลองใหม่ — เคสจาก ISURVEY ที่อนุมัติแล้ว (08/09/69)
router.post('/:id/isurvey-close', auth, requireRole('checker', 'admin'), reviewController.closeIsurvey);
router.put('/:id/report', auth, requireRole('checker'), caseController.updateReport);
// แก้ตัวระบุตัวเคส — **แอดมินเท่านั้น** ผู้ตรวจแก้ไม่ได้ (หน้าเว็บก็ล็อกไว้อีกชั้น)
// เลขพวกนี้ผูกเคสกับงานจริง แก้ผิดแล้วเคสไปโผล่ผิดใบ/ผิดบริษัท
router.patch('/:id/identity', auth, requireRole('admin'), caseController.updateIdentity);

// ตีกลับให้ผู้สำรวจไปแก้เอง — หัวหน้า (และแอดมิน) เท่านั้น · เหตุผลบังคับ (เช็คในเซอร์วิส)
router.post('/:id/send-back', auth, requireRole('checker', 'admin'), caseController.sendBack);
// ผู้ตรวจสอบเพิ่มรูปเองจากหน้าเคส — **เพิ่มอย่างเดียว** (คนละ endpoint กับ upload-folder
// ของแอปมือถือที่เป็น "ล้างแล้วเขียนใหม่" ตามโมเดล sync — ใช้ผิดตัวคือรูปทั้งเคสหาย)
router.post('/:id/photos', auth, requireRole('checker', 'admin'),
  uploadCasePhotos, caseController.addPhotos);
router.delete('/:id/photos/:photoId', auth, requireRole('checker', 'admin'),
  caseController.deletePhoto);
// หมุนรูปแล้วเขียนทับไฟล์เดิม (หน้าต่างดูรูป) — กติกาล็อกเดียวกับลบรูป
router.post('/:id/photos/:photoId/rotate', auth, requireRole('checker', 'admin'),
  caseController.rotatePhoto);

// ค่าตอบแทนผู้สำรวจ (ฝั่งจ่ายพนักงาน) — เฉพาะผู้ตรวจ ผู้สำรวจไม่เกี่ยวกับการตั้งยอดจ่ายตัวเอง
router.get('/:id/pay', auth, requireRole('checker', 'admin'), caseController.getPay);
router.put('/:id/pay', auth, requireRole('checker', 'admin'), caseController.savePay);
// ประวัติการแก้ยอดเงินของเคส — ไว้ตามย้อนหลังว่า "คนแก้" หรือ "บั๊กกลืนข้อมูล"
router.get('/:id/money-audit', auth, requireRole('checker', 'admin'), caseController.moneyAudit);

export default router;
