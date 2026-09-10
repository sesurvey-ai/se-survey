import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { asyncHandler } from '../utils/asyncHandler';
import { UnauthorizedError } from '../middleware/errorHandler';
import { env } from '../config/env';
import { caseService } from '../services/case.service';
import { uploadZipOnly } from '../config/multer';
import { notifyCaseChanged } from '../services/caseEvents';
import { emcsQueueService } from '../services/emcsQueue.service';

// ── routes สำหรับเครื่องมือภายใน (se-autokey) — auth ด้วย service token ไม่ผูกบัญชีพนักงาน ──
// เปิดใช้โดยตั้ง env INTEGRATION_TOKEN (ยาว ≥24 ตัว); ไม่ตั้ง = ทุก route ตอบ 401
//
// ขอบเขตของ token นี้ (อัปเดต 16/08/69 — เดิมเป็น "อ่านอย่างเดียว"):
//   อ่าน   — XML / รายงาน / รูป ของเคสที่ **อนุมัติแล้ว** เท่านั้น (assertApproved)
//   เขียน  — ปักธงสถานะ EMCS (emcs-imported, emcs-status)
//          — **สร้างเคสจากงาน ISURVEY ที่ยัง "รอตรวจข้อมูล"** (POST /cases/import + photos-zip)
//
// เคสที่สร้างทางนี้เกิดเป็น status='surveyed' เสมอ — **เข้าประตูอนุมัติเหมือนงานอื่นทุกอย่าง**
// token นี้สร้างงานให้คนตรวจได้ แต่ไม่มีทางทำให้งานผ่านการอนุมัติเองได้

const router = Router();

const integrationAuth = (req: Request, _res: Response, next: NextFunction): void => {
  const expected = env.INTEGRATION_TOKEN;
  if (!expected) throw new UnauthorizedError('Integration disabled (INTEGRATION_TOKEN not set)');
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  // timingSafeEqual ต้อง length เท่ากัน — เทียบ length ก่อน (length ไม่ใช่ความลับ)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new UnauthorizedError('Invalid integration token');
  }
  next();
};

/**
 * ประตูอนุมัติฝั่งบอท — บอทดึง "ข้อมูลไปกรอก EMCS" ได้เฉพาะเคสที่หัวหน้าอนุมัติแล้ว
 *
 * เดิมบอทหยิบทั้ง 'surveyed' และ 'reviewed' = อนุมัติหรือไม่ก็เข้า EMCS ได้เท่ากัน
 * ปุ่ม "อนุมัติ" จึงไม่ได้กั้นอะไรเลย · ตั้งแต่เฟส 3 บอทจะกดส่งงานเองซึ่งถอยไม่ได้
 * ประตูนี้คือสิ่งเดียวที่กั้นระหว่าง "คนรับรองแล้ว" กับ "งานเข้าคิวบริษัทประกัน"
 *
 * กั้นที่ endpoint ข้อมูล (xml/report/photos) ไม่ใช่แค่ที่ list — ถึงบอทจะรู้เลขเคสจากทางอื่น
 * ก็ยังดึงข้อมูลไปกรอกไม่ได้
 */
const assertApproved = async (caseId: number, res: Response): Promise<boolean> => {
  const { db } = await import('../config/database');
  const r = await db.query('SELECT status FROM cases WHERE id = $1', [caseId]);
  if (r.rows.length === 0) {
    res.status(404).json({ success: false, message: 'case not found' });
    return false;
  }
  if (r.rows[0].status !== 'reviewed') {
    res.status(403).json({
      success: false,
      code: 'NOT_APPROVED',
      message: `เคส #${caseId} ยังไม่ได้อนุมัติ (สถานะ: ${r.rows[0].status}) — ให้หัวหน้ากดอนุมัติบนเว็บ se-survey ก่อน`,
    });
    return false;
  }
  return true;
};

/**
 * คีย์ที่ยอมรับใน `expenses` — ต้องตรงกับ `bill` ที่ `parseIsurveyXml` สร้าง
 *
 * ⛔ **ห้ามเอาออก** — `importFromXml` เอาคีย์ของ object นี้ไปต่อเป็นชื่อคอลัมน์ใน
 * `INSERT INTO survey_expenses (${keys})` ตรง ๆ · ตอนที่มีแต่ทาง XML คีย์มาจากโค้ดเราเอง
 * จึงปลอดภัย แต่ทางนี้คีย์มาจากข้างนอก = ช่องทาง SQL injection ถ้าไม่กรอง
 */
const EXPENSE_KEYS = new Set([
  'service_fee_count', 'service_fee_price',
  'travel_fee_count', 'travel_fee_price',
  'photo_fee_count', 'photo_fee_price',
  'phone_fee', 'bail_fee',
  'claim_fee_percent', 'claim_fee_price',
  'daily_record_fee', 'other_fee_price',
]);

/** เจ้าของเคสที่สร้างผ่าน integration — cases.created_by เป็น NOT NULL จึงต้องมีคนจริง */
const resolveIntegrationUser = async (): Promise<number> => {
  if (env.INTEGRATION_CREATED_BY) return env.INTEGRATION_CREATED_BY;
  const { db } = await import('../config/database');
  const r = await db.query(
    "SELECT id FROM users WHERE role = 'admin' AND is_active = true ORDER BY id LIMIT 1");
  if (r.rows.length === 0) {
    throw new Error('ไม่มีบัญชีแอดมินที่เปิดใช้งาน — ตั้ง env INTEGRATION_CREATED_BY เป็น id ของผู้ใช้ที่จะเป็นเจ้าของเคส');
  }
  return r.rows[0].id;
};

/**
 * สร้างเคสจากงาน ISURVEY ที่ยังเป็นสถานะ "รอตรวจข้อมูล" (se-autokey เป็นคนดึงมา)
 *
 * รับโครง `XmlImportResult` มาเป็น JSON แล้วส่งเข้า `importFromXml` **ตัวเดียวกับ**
 * ที่หน้าอัปโหลด XML ใช้ — เส้นทางสร้างเคสจึงมีเส้นเดียว ไม่ต้องดูแล 2 ทาง
 * ตัวแปลง ISURVEY → โครงนี้ อยู่ฝั่ง Python (`autokey/isurvey_to_sesurvey.py`)
 * เพราะความรู้เรื่องรหัส/แท็บของ ISURVEY ทั้งหมดอยู่ที่นั่นอยู่แล้ว
 *
 * เลขเซอร์เวย์ซ้ำ → 409 จาก assertSurveyJobNoUnique (กันดึงงานเดิมซ้ำอัตโนมัติ)
 */
router.post('/cases/import', integrationAuth, asyncHandler(async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const insuranceCompany = String(b.insurance_company ?? '').trim();
  if (!insuranceCompany) {
    res.status(400).json({ success: false, message: 'ต้องระบุ insurance_company — บอทใช้เลือกบริษัทตอนนำเข้า EMCS' });
    return;
  }
  const report = b.report;
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    res.status(400).json({ success: false, message: 'ต้องมี report เป็น object (คีย์ = ชื่อคอลัมน์ survey_reports)' });
    return;
  }
  // ทางนี้เปิดไว้ให้เส้น "ดึงสด" เท่านั้น — ไม่ให้ผู้เรียกอ้างที่มาอื่นเพื่อเปลี่ยนกติกาเงิน
  // (isurvey_xml/mobile/emcs_extract คนละกติกาเรื่องยอดเรียกเก็บ ดู BILLABLE_SOURCES)
  const source = String(b.source ?? 'isurvey_live');
  if (source !== 'isurvey_live') {
    res.status(400).json({ success: false, message: `ทางนี้รับเฉพาะ source='isurvey_live' (ได้รับ '${source}')` });
    return;
  }

  const rawExp = (b.expenses ?? null) as Record<string, unknown> | null;
  let expenses: Record<string, number | null> | null = null;
  if (rawExp && typeof rawExp === 'object' && !Array.isArray(rawExp)) {
    const bad = Object.keys(rawExp).filter((k) => !EXPENSE_KEYS.has(k));
    if (bad.length) {
      res.status(400).json({ success: false, message: `expenses มีคีย์ที่ไม่รู้จัก: ${bad.join(', ')}` });
      return;
    }
    const clean: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(rawExp)) {
      const n = v === null || v === '' ? null : Number(v);
      if (n !== null && !Number.isFinite(n)) {
        res.status(400).json({ success: false, message: `expenses.${k} ไม่ใช่ตัวเลข` });
        return;
      }
      clean[k] = n;
    }
    // ว่างทั้งก้อน = ถือว่าไม่มียอด (ตรงกับ hasMoney ของฝั่ง XML) ไม่ต้องเขียนแถวเปล่า
    expenses = Object.values(clean).some((v) => (v ?? 0) > 0) ? clean : null;
  }

  const cf = (b.caseFields ?? {}) as Record<string, unknown>;
  const warnings = Array.isArray(b.warnings) ? b.warnings.map(String) : [];
  // เจ้าของเคส: เส้นดึงจากเว็บ (04/09/69) ส่ง created_by = หัวหน้าที่กดดึงมาด้วย — รับเฉพาะ checker/admin
  // ที่ยังเปิดใช้ ไม่งั้นถอยไปใช้บัญชี integration ตามเดิม (เส้นบอทบนเครื่องผู้ใช้ไม่ส่งช่องนี้)
  let createdBy = await resolveIntegrationUser();
  const requested = Number(b.created_by);
  if (Number.isInteger(requested) && requested > 0) {
    const { db } = await import('../config/database');
    const u = await db.query(
      "SELECT id FROM users WHERE id = $1 AND is_active = true AND role IN ('checker', 'admin')", [requested]);
    if (u.rows.length === 0) {
      res.status(400).json({ success: false, message: `created_by ${requested} ไม่ใช่ผู้ตรวจ/แอดมินที่ใช้งานอยู่` });
      return;
    }
    createdBy = requested;
  }
  const result = await caseService.importFromXml({
    caseFields: {
      customer_name: String(cf.customer_name ?? ''),
      incident_location: String(cf.incident_location ?? ''),
      // "ส่งงาน" จาก ISURVEY (Dispatch.sendReportDate/Time) — รับเฉพาะที่ parse เป็นเวลาได้ (10/09/69)
      submitted_at: (() => {
        const v = String(cf.submitted_at ?? '').trim();
        return v && Number.isFinite(Date.parse(v)) ? v : null;
      })(),
    },
    report: report as Record<string, unknown>,
    expenses,
    surveyorCode: String(b.surveyorCode ?? '').toUpperCase(),
    warnings,
    source: 'isurvey_live',
  }, { insuranceCompany, createdBy });

  res.json({ success: true, data: { ...result, warnings, hasMoney: expenses !== null } });
}));

/**
 * อัปรูปเข้าเคสที่สร้างทาง /cases/import — เรียกซ้ำได้ (รูปที่มีแล้วถูกข้าม)
 *
 * ⛔ ห้ามแตะเคสที่อนุมัติแล้ว — ถ้าเปลี่ยนรูปหลังอนุมัติได้ ประตูอนุมัติก็ไม่มีความหมาย
 *    (สิ่งที่บอทส่งเข้า EMCS จะไม่ใช่สิ่งที่หัวหน้ารับรอง)
 * ⛔ เฉพาะเคส source='isurvey_live' — งานมือถือรูปมาจากแอป ห้ามทางนี้ไปเติม
 */
router.post('/cases/:id/photos-zip', integrationAuth, uploadZipOnly,
  asyncHandler(async (req: Request, res: Response) => {
    const caseId = parseInt(req.params.id as string);
    const { db } = await import('../config/database');
    const c = await db.query('SELECT status, source FROM cases WHERE id = $1', [caseId]);
    if (c.rows.length === 0) { res.status(404).json({ success: false, message: 'case not found' }); return; }
    if (c.rows[0].status === 'reviewed') {
      res.status(423).json({ success: false, message: `เคส #${caseId} อนุมัติแล้ว — เพิ่มรูปไม่ได้จนกว่าแอดมินจะปลดล็อก` });
      return;
    }
    if (c.rows[0].source !== 'isurvey_live') {
      res.status(403).json({ success: false, message: `ทางนี้ใช้ได้เฉพาะเคสที่ดึงจาก ISURVEY (source='${c.rows[0].source}')` });
      return;
    }
    if (!req.file) { res.status(400).json({ success: false, message: 'ต้องแนบไฟล์ zip ในฟิลด์ชื่อ zip' }); return; }
    const photos = await caseService.importPhotoZip(caseId, req.file.buffer, { skipExisting: true });
    res.json({ success: true, data: photos });
  }));

// XML สำหรับ import เข้า EMCS — เนื้อหาเดียวกับ GET /api/cases/:id/export-xml (ฝั่ง user)
router.get('/cases/:id/export-xml', integrationAuth, asyncHandler(async (req: Request, res: Response) => {
  const caseId = parseInt(req.params.id as string);
  if (!(await assertApproved(caseId, res))) return;
  const xml = await caseService.getSurveyXml(caseId); // ไม่ส่ง user = ไม่จำกัดเจ้าของ (เทียบเท่า admin)
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="survey_${caseId}.xml"`);
  res.send(xml);
}));

// รายการเคสที่พร้อมนำเข้า EMCS — webui ของ SE-AutoKey ใช้โชว์ลิสต์ให้เลือก
// ⛔ เฉพาะ 'reviewed' (หัวหน้าอนุมัติแล้ว) — เดิมรวม 'surveyed' ด้วย ทำให้อนุมัติหรือไม่ก็เข้า EMCS ได้
router.get('/cases', integrationAuth, asyncHandler(async (_req: Request, res: Response) => {
  const { db } = await import('../config/database');
  const r = await db.query(
    `SELECT c.id, c.status, sr.claim_no, sr.survey_job_no, sr.insurance_company,
            (u.first_name || ' ' || u.last_name) AS surveyor_name,
            to_char(c.emcs_imported_at, 'YYYY-MM-DD HH24:MI') AS emcs_imported_at,
            -- ต้องมีคู่กับ imported เสมอ — SE-AutoKey ใช้หา "นำเข้าแล้วแต่ยังไม่รู้ว่าส่งหรือยัง"
            -- (โหมด --emcs-sync-status กวาดอ่านสถานะจริงจาก EMCS มาอัปเดต)
            to_char(c.emcs_submitted_at, 'YYYY-MM-DD HH24:MI') AS emcs_submitted_at,
            c.emcs_esurvey_no, c.emcs_status_text,
            to_char(rv.reviewed_at, 'YYYY-MM-DD HH24:MI') AS approved_at,
            COALESCE(NULLIF(rv.inspector_name, ''), ck.first_name || ' ' || ck.last_name) AS approved_by,
            c.created_at
       FROM cases c
       LEFT JOIN survey_reports sr ON sr.case_id = c.id
       LEFT JOIN users u ON u.id = c.assigned_to
       LEFT JOIN reviews rv ON rv.case_id = c.id
       LEFT JOIN users ck ON ck.id = rv.checker_id
      WHERE c.status = 'reviewed'
      ORDER BY c.created_at DESC
      LIMIT 100`
  );
  res.json({ success: true, data: { cases: r.rows } });
}));

// meta ของเคสเดียว (บริษัทประกัน/เลขต่าง ๆ + สถานะนำเข้า) — SE-AutoKey ใช้ resolve รหัสบริษัท
// และ "เช็คกันซ้ำก่อนเริ่ม" (emcs_imported_at ไม่ null = ห้าม import อีก — EMCS สร้างเรื่องซ้ำ)
router.get('/cases/:id', integrationAuth, asyncHandler(async (req: Request, res: Response) => {
  const caseId = parseInt(req.params.id as string);
  const { db } = await import('../config/database');
  // meta ไม่กั้นด้วยการอนุมัติ (บอทใช้เช็คกันซ้ำ/หาเหตุผลก่อนเริ่ม) แต่บอก approved มาด้วย
  // source (mobile / isurvey_xml / isurvey_live / emcs_extract) — บอทโหมด "นำเข้า + ส่งงานใหม่" ใช้ตัดสิน
  // ว่าหลังส่ง EMCS ต้องแจ้ง ISURVEY ว่าคีย์แล้วไหม (เฉพาะเคสที่มาจาก ISURVEY; งานมือถือไม่มีในนั้น)
  // เพื่อให้ webui ขึ้นเหตุผลได้ตรง ๆ ว่า "ยังไม่อนุมัติ" แทนที่จะไปเจอ 403 ตอนดึงข้อมูล
  const r = await db.query(
    `SELECT c.id, c.status, c.source, sr.claim_no, sr.survey_job_no, sr.insurance_company, sr.insurance_branch,
            to_char(c.emcs_imported_at, 'YYYY-MM-DD HH24:MI') AS emcs_imported_at, c.emcs_esurvey_no,
            (c.status = 'reviewed') AS approved,
            to_char(rv.reviewed_at, 'YYYY-MM-DD HH24:MI') AS approved_at,
            COALESCE(NULLIF(rv.inspector_name, ''), ck.first_name || ' ' || ck.last_name) AS approved_by
       FROM cases c
       LEFT JOIN survey_reports sr ON sr.case_id = c.id
       LEFT JOIN reviews rv ON rv.case_id = c.id
       LEFT JOIN users ck ON ck.id = rv.checker_id
      WHERE c.id = $1`, [caseId]
  );
  if (r.rows.length === 0) { res.status(404).json({ success: false, message: 'case not found' }); return; }
  res.json({ success: true, data: r.rows[0] });
}));

// SE-AutoKey แจ้งว่า import เข้า EMCS สำเร็จแล้ว → mark ถาวร (กันกดซ้ำทุกช่องทาง)
// atomic: WHERE emcs_imported_at IS NULL — สองงานแข่งกัน คนที่สองได้ already=true
router.post('/cases/:id/emcs-imported', integrationAuth, asyncHandler(async (req: Request, res: Response) => {
  const caseId = parseInt(req.params.id as string);
  const esurveyNo = String((req.body?.esurvey_no ?? '')).slice(0, 50) || null;
  const { db } = await import('../config/database');
  const r = await db.query(
    `UPDATE cases SET emcs_imported_at = NOW() AT TIME ZONE 'Asia/Bangkok', emcs_esurvey_no = COALESCE($2, emcs_esurvey_no)
      WHERE id = $1 AND emcs_imported_at IS NULL
      RETURNING id`, [caseId, esurveyNo]
  );
  if (r.rowCount === 0) {
    const cur = await db.query(
      `SELECT to_char(emcs_imported_at, 'YYYY-MM-DD HH24:MI') AS at, emcs_esurvey_no FROM cases WHERE id = $1`, [caseId]);
    if (cur.rows.length === 0) { res.status(404).json({ success: false, message: 'case not found' }); return; }
    res.json({ success: true, data: { already: true, ...cur.rows[0] } });
    return;
  }
  notifyCaseChanged(caseId, 'emcs', null);
  res.json({ success: true, data: { already: false } });
}));

// SE-AutoKey รายงานสถานะที่อ่านได้จากหน้ารายการ EMCS กลับมา
// แยกจาก emcs-imported โดยตั้งใจ: "สร้าง draft แล้ว" ≠ "ส่งงานให้ประกันแล้ว"
// (บอทไม่กดปุ่มส่งเอง คนกด แล้วค่อยสั่งบอทมาตรวจสถานะ)
//
// body: { status_text: string, submitted: boolean|null, esurvey_no?: string }
//   submitted=true  → บันทึกเวลาส่ง (ครั้งแรกเท่านั้น ไม่ทับของเดิม)
//   submitted=false → ยังเป็น draft
//   submitted=null  → อ่านสถานะไม่ได้/แยกเรื่องไม่ออก → เก็บแค่ข้อความ ไม่สรุปอะไร
router.post('/cases/:id/emcs-status', integrationAuth, asyncHandler(async (req: Request, res: Response) => {
  const caseId = parseInt(req.params.id as string);
  const statusText = String(req.body?.status_text ?? '').slice(0, 100) || null;
  const submitted = req.body?.submitted === true ? true : req.body?.submitted === false ? false : null;
  const esurveyNo = String(req.body?.esurvey_no ?? '').slice(0, 50) || null;
  const { db } = await import('../config/database');
  const r = await db.query(
    `UPDATE cases
        SET emcs_status_text = COALESCE($2, emcs_status_text),
            emcs_status_checked_at = NOW() AT TIME ZONE 'Asia/Bangkok',
            emcs_esurvey_no = COALESCE($4, emcs_esurvey_no),
            -- ครั้งแรกที่ยืนยันว่าส่งแล้วเท่านั้น — ตรวจซ้ำทีหลังห้ามเลื่อนเวลา
            emcs_submitted_at = CASE WHEN $3::boolean IS TRUE AND emcs_submitted_at IS NULL
                                     THEN NOW() AT TIME ZONE 'Asia/Bangkok'
                                     ELSE emcs_submitted_at END
      WHERE id = $1
      RETURNING to_char(emcs_submitted_at, 'YYYY-MM-DD HH24:MI') AS submitted_at, emcs_status_text`,
    [caseId, statusText, submitted, esurveyNo]
  );
  if (r.rowCount === 0) { res.status(404).json({ success: false, message: 'case not found' }); return; }
  // "ส่งประกันแล้ว" ย้ายแท็บในคิวตรวจ + ลดตัวเลข "draft ค้างที่ประกัน" — ต้องเห็นเองไม่ต้องรีเฟรช
  notifyCaseChanged(caseId, 'emcs', null);
  res.json({ success: true, data: r.rows[0] });
}));

// ข้อมูลรายงานสำรวจ (ค่าไทย) ของเคส — SE-AutoKey ใช้เติม ClaimData ให้ fill_* กรอกหน้าหลัก EMCS
// (fuzzy_select ต้องการชื่อไทย เช่น จังหวัด/ยี่ห้อ/ประเภทรถ — ต่างจาก XML ที่เป็นรหัส EMCS)
router.get('/cases/:id/report', integrationAuth, asyncHandler(async (req: Request, res: Response) => {
  const caseId = parseInt(req.params.id as string);
  if (!(await assertApproved(caseId, res))) return;
  const { db } = await import('../config/database');
  const r = await db.query('SELECT * FROM survey_reports WHERE case_id = $1', [caseId]);
  if (r.rows.length === 0) { res.status(404).json({ success: false, message: 'report not found' }); return; }
  res.json({ success: true, data: r.rows[0] });
}));

// รายการรูปของเคส (survey_photos ที่ผูกกับ report) — SE-AutoKey ใช้โหลดไปอัปเข้า EMCS
router.get('/cases/:id/photos', integrationAuth, asyncHandler(async (req: Request, res: Response) => {
  const caseId = parseInt(req.params.id as string);
  if (!(await assertApproved(caseId, res))) return;
  const { db } = await import('../config/database');
  const r = await db.query(
    `SELECT sp.file_path, sp.category FROM survey_photos sp
       JOIN survey_reports sr ON sp.report_id = sr.id
      WHERE sr.case_id = $1 ORDER BY sp.id`, [caseId]
  );
  res.json({ success: true, data: { photos: r.rows } });
}));

// stream ไฟล์รูปตาม file_path จากรายการข้างบน — containment ใน UPLOAD_DIR เท่านั้น
router.get('/files', integrationAuth, asyncHandler(async (req: Request, res: Response) => {
  const rel = String(req.query.path ?? '');
  const pathMod = await import('path');
  const fs = await import('fs');
  const uploadRoot = pathMod.default.resolve(env.UPLOAD_DIR);
  const full = pathMod.default.resolve(uploadRoot, rel);
  // กัน path traversal — path จาก query ต้องอยู่ใต้ uploads เสมอ
  if (full !== uploadRoot && !full.startsWith(uploadRoot + pathMod.default.sep)) {
    res.status(400).json({ success: false, message: 'invalid path' });
    return;
  }
  if (!fs.default.existsSync(full) || !fs.default.statSync(full).isFile()) {
    res.status(404).json({ success: false, message: 'file not found' });
    return;
  }
  res.sendFile(full);
}));

// ───────────── คิวนำเข้า EMCS — ฝั่งสถานี (main.py --station) ─────────────
// สถานีวนขอรับงาน → ทำ → รายงานผล · heartbeat ระหว่างทำ (ไม่มีเกิน 40 นาที = ถือว่าสถานีหาย งานกลับเข้าคิว)
router.post('/emcs-queue/claim', integrationAuth, asyncHandler(async (req: Request, res: Response) => {
  const station = String(req.body?.station ?? '').trim() || 'station';
  const job = await emcsQueueService.claim(station);
  res.json({ success: true, data: { job } });
}));

router.post('/emcs-queue/:jobId/heartbeat', integrationAuth, asyncHandler(async (req: Request, res: Response) => {
  const jobId = parseInt(req.params.jobId as string);
  const station = String(req.body?.station ?? '').trim() || 'station';
  const ok = await emcsQueueService.heartbeat(jobId, station);
  res.json({ success: true, data: { ok } });
}));

router.post('/emcs-queue/:jobId/result', integrationAuth, asyncHandler(async (req: Request, res: Response) => {
  const jobId = parseInt(req.params.jobId as string);
  const b = req.body ?? {};
  const job = await emcsQueueService.report(jobId, {
    ok: b.ok === true, error: b.error, esurvey_no: b.esurvey_no, log_tail: b.log_tail, screenshot_b64: b.screenshot_b64,
  });
  res.json({ success: true, data: job });
}));

export default router;
