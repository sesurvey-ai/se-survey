import { db } from '../config/database';
import { env } from '../config/env';
import { AppError, NotFoundError, ForbiddenError } from '../middleware/errorHandler';
import { fcmService } from './fcm.service';
import { generateSurveyXml, emcsNameWarnings } from './xmlExport.service';
import { invalidateCaseOwner } from '../middleware/uploadsAuth';
import { isFirebaseReady } from '../config/firebase';
import type { XmlImportResult } from './xmlImport.service';
import { assertReportRev } from './reportRev';
import { notifyCaseChanged } from './caseEvents';
import { provinceOf } from './geoProvince';
import { standardPhotoFee } from './photoFee.service';
import { tumbonOptions } from './billingRates.service';
import { districtCentroid } from './geoDistrict';
import { recordMoneyChanges } from './moneyAudit';
import { getIO } from '../socket';
import { staffGroupService } from './staffGroup.service';

// คอลัมน์ JSONB บน survey_reports (ข้อมูล 1:N) — node-pg ไม่ serialize array ให้เอง
// ต้อง JSON.stringify ก่อน bind ไม่งั้นถูกตีความเป็น Postgres array literal แล้ว error
/**
 * timestamptz → 'DD/MM/พ.ศ. HH:MM' เวลาไทย — ใช้แสดง "ส่งงาน" / "ตรวจรายงาน" (10/09/69)
 * ส่ง expression ที่เป็น timestamptz เข้ามา (คอลัมน์ timestamp ไม่มีโซน เช่น reviews.reviewed_at เก็บเป็น UTC
 * ต้องห่อ `AT TIME ZONE 'UTC'` ก่อน) · null = ยังไม่มีเหตุการณ์นั้น
 */
const thStamp = (expr: string) =>
  `CASE WHEN ${expr} IS NULL THEN NULL ELSE ` +
  `to_char((${expr}) AT TIME ZONE 'Asia/Bangkok', 'DD/MM/') || ` +
  `(EXTRACT(YEAR FROM (${expr}) AT TIME ZONE 'Asia/Bangkok')::int + 543) || ' ' || ` +
  `to_char((${expr}) AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') END`;

const JSONB_FIELDS = new Set([
  'opposing_parties', 'injured_persons', 'damaged_property', 'insured_damage',
  'policy_info',   // ข้อมูลกรมธรรม์ทั้งชุดจาก ISURVEY แท็บ 7 (migration 053) — แสดงอย่างเดียว
  'checklist',     // รายการตรวจสอบของหัวหน้า (migration 057) — ส่งกลับ ISURVEY เป็น chk_* + วาดเป็นรูปตอนอนุมัติ
]);
// ข้อความ placeholder ของ dropdown ในแอป — ต้องไม่ถูกบันทึกเป็นค่าจริง (เคยหลุดเข้า acc_province/
// car_color → รหัสจังหวัดใน XML ที่ส่งเข้า EMCS ว่าง) → normalize เป็นค่าว่างที่ชั้น bind (กันทุกฟิลด์)
const PLACEHOLDER_SENTINELS = new Set(['-- ระบุ --', '-- เลือก --', '-- เขต --']);
/**
 * ⛔ ต้องเดินลงใน array/object ด้วย — คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน เก็บเป็น JSONB
 *    ค่า placeholder ที่หลุดเข้าไปในนั้นไม่เคยถูกล้างเลย (เดิมเช็คแค่ typeof v === 'string')
 *    แล้วไหลต่อไปเป็นรหัสจังหวัดว่างใน XML และทำให้ตัวนับช่องบังคับคิดว่า "กรอกแล้ว"
 *    ⛔ ไม่ใส่ '0' ในลิสต์นี้ — บางช่องมีเลข 0 เป็นค่าจริง (จะล้างของที่ถูกต้องทิ้ง)
 */
const stripSentinel = (v: unknown): unknown => {
  if (typeof v === 'string') return PLACEHOLDER_SENTINELS.has(v.trim()) ? '' : v;
  if (Array.isArray(v)) return v.map(stripSentinel);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => [k, stripSentinel(x)]));
  }
  return v;
};

// รูป "ยืนยันถึงที่เกิดเหตุ" (แอปถ่ายให้ตอนกดปุ่มถึงที่เกิดเหตุ) ไม่ได้อยู่ในหมวดที่
// มือถือส่งมา (photo_categories) เลยเคยลงเป็น category = NULL แล้วไปกองรวมใน
// "ไม่ระบุหมวด" บนหน้าเคส — ติดป้ายให้ตั้งแต่ตอนบันทึก จะได้ไม่ต้องตามใส่ทีหลัง
// (ไม่กระทบการนำเข้า EMCS: se-autokey กรองรูปนี้ทิ้งด้วย "ชื่อไฟล์" ไม่ได้ดูหมวด)
const ARRIVAL_CATEGORY = 'รูปยืนยันถึงที่เกิดเหตุ';
const arrivalCategory = (fileName: string): string | null =>
  (/^arrival(_\d+)?\.(jpe?g|png)$/i.test(fileName) ? ARRIVAL_CATEGORY : null);

// แปลงค่า field ให้พร้อม bind: JSONB → stringify (ยกเว้นเป็น string อยู่แล้ว), อื่นๆ → ตามเดิม
const bindVal = (f: string, v: unknown): unknown => {
  if (JSONB_FIELDS.has(f)) {
    if (v === undefined || v === null) return null;
    // ⛔ JSONB ก็ต้องผ่านตัวล้าง placeholder — เดิมข้ามไปเลย ค่า '-- ระบุ --' ในตาราง
    //    คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน จึงถูกเก็บเป็นข้อมูลจริงมาตลอด
    //    (มาเป็นสตริง JSON ได้ด้วยจากแอปมือถือ → แกะก่อนล้างแล้วประกอบกลับ)
    if (typeof v === 'string') {
      try {
        const parsed: unknown = JSON.parse(v);
        if (parsed && typeof parsed === 'object') return JSON.stringify(stripSentinel(parsed));
      } catch { /* ไม่ใช่ JSON — ปล่อยผ่านตามเดิม */ }
      return v;
    }
    return JSON.stringify(stripSentinel(v));
  }
  return stripSentinel(v) ?? null;
};

export type CaseUser = { id: number; role: string };

// เลขเซอร์เวย์ (SETP-xxx ทั้งเลขหลักและเลขครั้งที่ 2) เป็นเลขอ้างอิงการเบิกเงิน — ห้ามซ้ำข้ามเคสเด็ดขาด
// excludeCaseId: ตอน submit เคสเดิมย่อมเจอเลขของตัวเอง ต้องยกเว้น
const assertSurveyJobNoUnique = async (jobNos: unknown[], excludeCaseId?: number): Promise<void> => {
  for (const raw of jobNos) {
    const jobNo = String(raw ?? '').trim();
    if (!jobNo) continue;
    const dup = await db.query(
      `SELECT c.id FROM cases c JOIN survey_reports sr ON sr.case_id = c.id
        WHERE (sr.survey_job_no = $1 OR sr.survey_job_no_2 = $1) AND c.id != $2 LIMIT 1`,
      [jobNo, excludeCaseId ?? -1]);
    if (dup.rows.length > 0) {
      throw new AppError(409,
        `เลขเซอร์เวย์ ${jobNo} ถูกใช้แล้วในเคส #${dup.rows[0].id} — เลขเซอร์เวย์ใช้อ้างอิงเบิกเงิน ห้ามซ้ำ`);
    }
  }
};

/**
 * ประตูอนุมัติ: เคสที่อนุมัติแล้ว (status='reviewed') ห้ามแก้ข้อมูลอีก
 *
 * เหตุผล: บอทหยิบเฉพาะเคสที่อนุมัติแล้วไปเข้า EMCS และ (ตั้งแต่เฟส 3) จะกดส่งงานเอง
 * ซึ่งถอยไม่ได้ · ถ้าแก้ข้อมูลได้หลังอนุมัติ สิ่งที่บอทส่งจะไม่ใช่สิ่งที่คนรับรอง
 * ปลดล็อกได้ทางเดียวคือให้แอดมินเรียก POST /api/cases/:id/unlock แล้วอนุมัติใหม่
 */
const assertNotApproved = async (caseId: number): Promise<void> => {
  const r = await db.query('SELECT status FROM cases WHERE id = $1', [caseId]);
  if (r.rows.length === 0) throw new NotFoundError('Case not found');
  if (r.rows[0].status === 'reviewed') {
    throw new AppError(423, 'เคสนี้อนุมัติแล้ว — แก้ไม่ได้จนกว่าแอดมินจะปลดล็อก');
  }
};

// surveyor เข้าถึงได้เฉพาะเคสที่มอบหมายให้ตัวเอง (กัน IDOR ไล่เลข id อ่าน/ทับเคสคนอื่น)
// checker/admin/callcenter เข้าถึงได้ทุกเคส (ตรวจงาน/จัดการ)
const assertCaseAccess = (caseData: { assigned_to: number | null }, user?: CaseUser): void => {
  if (user?.role === 'surveyor' && caseData.assigned_to !== user.id) {
    throw new ForbiddenError('Case is not assigned to you');
  }
};

/**
 * เติมยอด **ฝั่งเรียกเก็บบริษัทประกัน** (ตาราง `survey_expenses`) ลงในแถวที่จะไปทำ XML
 *
 * ── ทำไมเมื่อก่อนกรองด้วย `source === 'isurvey_xml'` อย่างเดียว ──────────────
 * ตอนนั้นเคส mobile **ไม่มีทางมียอดที่ถูกต้องได้เลย** เพราะแอปไม่มีหน้า "ค่าใช้จ่าย"
 * และหัวหน้าไปกรอกที่หน้าค่าใช้จ่ายของ EMCS เอง → ถ้าเคส mobile มีแถว survey_expenses
 * ขึ้นมา แปลว่าผู้ตรวจ**เผลอ**กรอกช่องบนเว็บ ส่งต่อไปก็ทับของหัวหน้าใน EMCS
 *
 * ── ทำไมกติกานั้นใช้ไม่ได้แล้ว (อย่าเอา `=== 'isurvey_xml'` กลับมา) ───────────
 * EMCS **ไม่มีช่องเก็บเรทของเรา** → แผนที่ตกลงกันคือ *หัวหน้ากรอกราคาบนเว็บเรา → XML*
 * ช่อง "ราคา/หน่วย · เรียกเก็บประกัน" บนหน้าตรวจงานจึงกลายเป็น**ที่กรอกราคาอย่างเป็นทางการ**
 * ของงานมือถือ ไม่ใช่ "ช่องที่เผลอกรอก" อีกต่อไป · เอากติกาเก่ากลับมา = ยอดที่หัวหน้ากรอก
 * หายเงียบ ๆ (XML ยังออก `<TXN_SURV_BILL>` ครบทุกครั้ง แต่เป็น 0.00 ทั้งบล็อก ไม่มีอะไรฟ้อง)
 *
 * ── ทำไมยัง**ต้องมี** gate อยู่ (ห้ามลบทิ้งเฉย ๆ) ────────────────────────────
 * `emcs_extract` = ไฟล์ที่ `se-autokey/tools/emcs_dump.py` สกัดกลับมาจากหน้าเว็บ EMCS
 * (ข้อมูลทดสอบ) และ `importFromXml` **เขียนแถว survey_expenses ให้ด้วย** → ตัวเลขรออยู่จริง
 * ส่งกลับเข้าไปเท่ากับเอาเลขของบริษัทประกันเองยัดกลับไปเป็นบิลใบใหม่ ซึ่งดูสมเหตุสมผล
 * จนจับไม่ได้ตอนตรวจ
 *
 * ── ทำไมเป็น allow-list ไม่ใช่ `!== 'emcs_extract'` ─────────────────────────
 * `cases.source` เป็น VARCHAR(20) **ไม่มี CHECK constraint** (028_case_source.sql)
 * deny-list จะ fail **เปิด**: ทางนำเข้าใหม่ที่ใครเพิ่มวันหลัง (หรือ NULL / เคสหาย)
 * จะกลายเป็น "ส่งเงินจริง" เองเงียบ ๆ · allow-list fail **ปิด** = ได้ 0.00 เหมือนเดิม
 *
 * `isurvey_live` (16/08/69) = งานที่ดึงจาก ISURVEY ตอนยังเป็น "รอตรวจข้อมูล" แล้วหัวหน้า
 * ตรวจ+กรอกยอดบนเว็บเรา → ยอดที่กรอกต้องไหลเข้า EMCS เหมือนงานมือถือ **ต้องอยู่ในลิสต์นี้**
 */
const BILLABLE_SOURCES = new Set(['isurvey_xml', 'mobile', 'isurvey_live']);

/**
 * 13 คอลัมน์เงินฝั่งเรียกเก็บประกันที่ `xmlExport.service.ts` อ่านไปทำ `<TXN_SURV_BILL>`
 *
 * ⛔ **ระบุชื่อคอลัมน์ ห้าม `SELECT *`** — `survey_expenses` (เรียกเก็บประกัน) กับ
 *    `survey_pay` (จ่ายพนักงาน) มีคอลัมน์ชื่อซ้ำกันเป๊ะชนิดเดียวกัน 2 ตัว:
 *    **`phone_fee` · `bail_fee`** ซึ่งเป็นตัวที่ไปเป็น `SUR_TEL` / `SUR_INSURE` พอดี
 *    ถ้าวันหน้ามีใคร spread แถวค่าจ้างพนักงานเข้ามา มันจะกลายเป็นบิลเรียกเก็บประกัน
 *    **โดยไม่มี error อะไรเลย** · ระบุชื่อไว้ยังกันคอลัมน์ใหม่ใน migration หน้าหลุดเข้ามาเอง
 *    และกัน `id`/`created_at` ของ survey_expenses ไปทับของ survey_reports (เดิมต้อง re-pin id)
 */
const BILL_COLS = [
  'service_fee_count', 'service_fee_price',
  'travel_fee_count', 'travel_fee_price',
  'photo_fee_count', 'photo_fee_price',
  'phone_fee', 'bail_fee',
  'claim_fee_percent', 'claim_fee_price',
  'daily_record_fee', 'other_fee_detail', 'other_fee_price',
] as const;

async function withInsurerBill(caseId: number, report: Record<string, unknown>) {
  const src = await db.query('SELECT source FROM cases WHERE id = $1', [caseId]);
  if (!BILLABLE_SOURCES.has(String(src.rows[0]?.source ?? ''))) return report;
  const exp = await db.query(
    `SELECT ${BILL_COLS.join(', ')} FROM survey_expenses WHERE report_id = $1`, [report.id]);
  return exp.rows.length ? { ...report, ...exp.rows[0] } : report;
}

/** เพศผู้ขับขี่ให้เป็น 'M'/'F' เสมอ (รับ 'ชาย'/'หญิง'/'W'/ตัวพิมพ์เล็กด้วย) — ดูหมายเหตุใน importFromXml */
const driverGenderMF = (v: unknown): string => {
  const t = String(v ?? '').trim();
  const u = t.toUpperCase();
  if (u === 'M' || t === 'ชาย') return 'M';
  if (u === 'F' || u === 'W' || t === 'หญิง') return 'F';
  return t;
};

export const caseService = {
  async create(data: Record<string, unknown> & { customer_name: string; incident_location: string }, createdBy: number) {
    // เลขเซอร์เวย์ (SETP-xxx) ห้ามซ้ำ — เป็นเลขอ้างอิงเบิกเงิน
    // (เลขเคลมซ้ำได้โดยตั้งใจ: 1 เคลมออกงานหลายครั้ง — ระบบนับ "ครั้งที่" จาก claim_no เดิมอยู่แล้ว)
    await assertSurveyJobNoUnique([data.survey_job_no, data.survey_job_no_2]);
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // หมายเหตุ: ตาราง cases ไม่มีคอลัมน์ insurance_company — ค่านี้ถูกเก็บใน survey_reports แทน (ดู reportFields)
      const caseResult = await client.query(
        `INSERT INTO cases (customer_name, incident_location, incident_lat, incident_lng, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [data.customer_name, data.incident_location, data.incident_lat || null, data.incident_lng || null, createdBy]
      );
      const newCase = caseResult.rows[0];

      // สร้าง survey_report เบื้องต้น ถ้ามีข้อมูลจากใบเคลม
      const reportFields = [
        'survey_company','survey_company_address',
        'claim_type','claim_no','claim_ref_no','insurance_company','insurance_branch',
        'survey_job_no','survey_job_no_2','car_lost',
        'policy_no','policy_type','policy_start','policy_end','assured_name','prb_number','deductible',
        'car_brand','car_model','car_type','car_color','license_plate','car_province',
        'chassis_no','engine_no','car_reg_year',
        'driver_first_name','driver_last_name','driver_phone',
        'acc_date','acc_time','acc_place','acc_subdistrict','acc_province','acc_district',
      'survey_place','survey_province','survey_district',   // สถานที่ออกตรวจสอบ (มือถือส่งตั้งแต่ APK 1.0.105, 10/09/69)
        'acc_cause','acc_damage_type','acc_detail','acc_fault',
        'acc_reporter','reporter_phone','acc_customer_report_date','acc_insurance_notify_date',
        'acc_insurance_notify_time','receiver_name','surveyor_name','surveyor_phone',
        'counterparty_plate','counterparty_brand','counterparty_insurance','counterparty_detail',
        'notes',
      ];
      const providedFields: string[] = [];
      const providedValues: unknown[] = [];
      for (const f of reportFields) {
        const val = stripSentinel(data[f]); // กัน placeholder "-- ระบุ --" หลุดเข้าเป็นค่าจริง
        if (val !== undefined && val !== '') {
          providedFields.push(f);
          providedValues.push(val);
        }
      }

      if (providedFields.length > 0) {
        const cols = ['case_id', ...providedFields].join(', ');
        const placeholders = [newCase.id, ...providedValues].map((_, i) => `$${i + 1}`).join(', ');
        await client.query(
          `INSERT INTO survey_reports (${cols}) VALUES (${placeholders})`,
          [newCase.id, ...providedValues]
        );
      }

      // ย้ายรูป OCR เข้าโฟลเดอร์ประจำเคส — ผูกกับ case id (immutable) เท่านั้น
      // (เดิมตั้งชื่อตามเลขเคลมที่แก้ไขได้ → เลขเปลี่ยนแล้วโฟลเดอร์ upload/submit ไม่ตรงกัน รูปหลุดเงียบ)
      const ocrImagePaths = data.ocr_image_paths as string[] | undefined;
      const claimFolder = `case_${newCase.id}`;
      const jobFolder = `job_${newCase.id}`;

      if (ocrImagePaths && Array.isArray(ocrImagePaths) && ocrImagePaths.length > 0) {
        const fs = await import('fs');
        const pathMod = await import('path');
        const folderPath = pathMod.default.resolve(env.UPLOAD_DIR, claimFolder, jobFolder);
        if (!fs.default.existsSync(folderPath)) {
          fs.default.mkdirSync(folderPath, { recursive: true });
        }

        for (const rawFilePath of ocrImagePaths) {
          // กัน path traversal: ใช้เฉพาะชื่อไฟล์ (basename) — client ส่ง '../../.env' มาย้าย/ลบไฟล์ระบบไม่ได้
          const filePath = pathMod.default.basename(String(rawFilePath));
          if (!filePath || filePath === '.' || filePath === '..') continue;

          const srcPath = pathMod.default.resolve(env.UPLOAD_DIR, filePath);
          const uploadRoot = pathMod.default.resolve(env.UPLOAD_DIR);
          // ยืนยันว่า src อยู่ใน UPLOAD_DIR จริง (กันหลุดกรอบแม้ basename แล้ว)
          if (srcPath !== uploadRoot && !srcPath.startsWith(uploadRoot + pathMod.default.sep)) continue;

          const destPath = pathMod.default.join(folderPath, filePath);
          try {
            if (fs.default.existsSync(srcPath) && !fs.default.existsSync(destPath)) {
              fs.default.renameSync(srcPath, destPath);
            }
          } catch { /* skip */ }

          await client.query(
            'INSERT INTO case_images (case_id, file_path, image_type) VALUES ($1, $2, $3)',
            [newCase.id, `${claimFolder}/${jobFolder}/${filePath}`, 'ocr']
          );
        }
      }

      await client.query('COMMIT');
      return newCase;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getMyCases(surveyorId: number) {
    const result = await db.query(
      `SELECT c.*, sr.claim_no, sr.survey_job_no, sr.claim_ref_no
       FROM cases c
       LEFT JOIN survey_reports sr ON sr.case_id = c.id
       WHERE c.assigned_to = $1
       ORDER BY c.created_at DESC`,
      [surveyorId]
    );
    return result.rows;
  },

  /**
   * เปิด "งานครั้งถัดไป" ของเคลมเดิม (งานติดตาม/นัดหมาย/เจรจา)
   *
   * กติกาที่ user อธิบาย 30/08/69: งานครั้งแรกเป็นเคลมสด/เคลมแห้ง · พอยังไม่ได้ข้อสรุป
   * ก็นัดครั้งที่ 2 **บนเลขเคลมเดิม** → ระบบนับ "ครั้งที่" จาก claim_no ที่ซ้ำกันอยู่แล้ว
   * (ROW_NUMBER OVER PARTITION BY claim_no) จึงไม่ต้องมีคอลัมน์เก็บรอบ
   *
   * ⛔ **ก๊อปเฉพาะ "ตัวตนของเคลม"** — เลขเคลม/กรมธรรม์/รถ/ผู้เอาประกัน/สถานที่เกิดเหตุ
   *    ไม่ก๊อปสิ่งที่ช่างไปสำรวจมา (ความเสียหาย · คู่กรณี · ผู้บาดเจ็บ · ทรัพย์สิน · รูป ·
   *    ยอดเงิน · ความเห็น) เพราะครั้งใหม่ต้องสำรวจใหม่ ไม่ใช่ลอกของเก่ามาส่งซ้ำ
   * ⛔ **ไม่ก๊อปเลขเซอร์เวย์** — เป็นเลขใบวางบิล ห้ามซ้ำ ครั้งใหม่ต้องได้เลขใหม่
   * ⛔ **ไม่ก๊อปประเภทเคลม** — ครั้งถัดไปมักเป็นงานติดตาม/นัดหมาย ให้คนจ่ายงานเลือกเอง
   *    ที่หน้าจ่ายงาน (ปล่อยว่างดีกว่าใส่ค่าเดิมผิด ๆ แล้วไม่มีใครสังเกต)
   */
  async createFollowup(caseId: number, createdBy: number) {
    const src = await db.query(
      `SELECT c.*, sr.* FROM cases c LEFT JOIN survey_reports sr ON sr.case_id = c.id WHERE c.id = $1`,
      [caseId]
    );
    if (src.rows.length === 0) throw new NotFoundError('Case not found');
    const row = src.rows[0];

    // ต้องเป็นงานที่ช่างส่งแล้ว — เปิดครั้งถัดไปทั้งที่ครั้งนี้ยังไม่เสร็จ = งานซ้อนกันเปล่า ๆ
    if (!['surveyed', 'reviewed'].includes(String(row.status))) {
      throw new ForbiddenError('เปิดงานครั้งถัดไปได้เมื่องานครั้งนี้ส่งแล้วเท่านั้น');
    }
    const claimNo = String(row.claim_no ?? '').trim();
    if (!claimNo) throw new ForbiddenError('เคสนี้ไม่มีเลขเคลม จึงผูกงานครั้งถัดไปไม่ได้');

    // กันกดซ้ำ/กดพร้อมกัน — ถ้ามีงานของเคลมนี้ที่ยังไม่เริ่มค้างอยู่ ให้ใช้ใบนั้นแทน
    const pendingDup = await db.query(
      `SELECT c.id FROM cases c JOIN survey_reports sr ON sr.case_id = c.id
        WHERE sr.claim_no = $1 AND c.status IN ('pending','assigned','finished') LIMIT 1`,
      [claimNo]
    );
    if (pendingDup.rows.length > 0) {
      throw new ForbiddenError(
        `เคลมนี้มีงานที่ยังไม่เสร็จอยู่แล้ว (เคส #${pendingDup.rows[0].id}) — ใช้ใบนั้นต่อได้เลย`
      );
    }

    /** ตัวตนของเคลม/รถ/กรมธรรม์ — ก๊อปได้ เพราะไม่เปลี่ยนระหว่างครั้ง */
    const CARRY = [
      'survey_company', 'survey_company_address',
      'claim_no', 'claim_ref_no', 'insurance_company', 'insurance_branch', 'car_lost',
      'policy_no', 'policy_type', 'policy_start', 'policy_end', 'assured_name', 'prb_number', 'deductible',
      'car_brand', 'car_model', 'car_type', 'car_color', 'license_plate', 'car_province',
      'chassis_no', 'engine_no', 'car_reg_year',
      'driver_first_name', 'driver_last_name', 'driver_phone',
      'acc_date', 'acc_time', 'acc_place', 'acc_subdistrict', 'acc_province', 'acc_district',
      'survey_place', 'survey_province', 'survey_district', 'survey_subdistrict',
      'acc_cause', 'acc_detail', 'acc_reporter', 'reporter_phone',
    ];
    const payload: Record<string, unknown> = {
      customer_name: row.customer_name ?? '',
      incident_location: row.incident_location ?? '',
      incident_lat: row.incident_lat ?? null,
      incident_lng: row.incident_lng ?? null,
    };
    for (const f of CARRY) if (row[f] !== null && row[f] !== undefined && row[f] !== '') payload[f] = row[f];

    const created = await this.create(payload as never, createdBy);
    return { ...created, from_case_id: caseId, claim_no: claimNo };
  },

  async assign(caseId: number, surveyorId: number, claimType?: string) {
    // ดึง claim_no + insurance_company จาก survey_reports มาด้วย (โชว์บนการ์ดงานมือถือ)
    const caseResult = await db.query(
      `SELECT c.*, sr.claim_no AS sr_claim_no, sr.insurance_company AS sr_insurance_company
         FROM cases c LEFT JOIN survey_reports sr ON sr.case_id = c.id WHERE c.id = $1`,
      [caseId]
    );
    if (caseResult.rows.length === 0) throw new NotFoundError('Case not found');

    const caseData = caseResult.rows[0];

    const surveyorResult = await db.query(
      "SELECT id, fcm_token, first_name, last_name FROM users WHERE id = $1 AND role = 'surveyor' AND is_active = true",
      [surveyorId]
    );
    if (surveyorResult.rows.length === 0) throw new NotFoundError('Surveyor not found');

    // มอบหมายแบบ atomic — กัน race (callcenter 2 คนกดพร้อมกัน จ่ายคนละคน) ด้วย guard status ใน UPDATE
    // และรองรับ reassign เคสที่ถูกปฏิเสธ ('declined') ไม่ใช่แค่ 'pending'
    const updated = await db.query(
      `UPDATE cases SET assigned_to = $1, status = 'assigned', assigned_at = NOW()
         WHERE id = $2 AND status IN ('pending','declined') RETURNING *`,
      [surveyorId, caseId]
    );
    if (updated.rowCount === 0) {
      throw new ForbiddenError('ไม่สามารถมอบหมายงานนี้ได้ (อาจถูกมอบหมายไปแล้ว)');
    }
    // ย้ายเจ้าของเคสแล้ว — ล้าง cache สิทธิ์ดูรูป ไม่งั้นคนเดิมยังเปิดรูปเคสนี้ได้อีกพักหนึ่ง
    invalidateCaseOwner(caseId);

    // "แจ้งเซอร์เวย์" (ไทม์ไลน์งานบนมือถือ) = เวลาที่ callcenter กดมอบหมายงาน → บันทึกลง acc_insurance_notify_date
    // ต้องเป็นเวลาไทย (Asia/Bangkok) ไม่ใช่เวลา server (prod = UTC); รูปแบบ D/M/พ.ศ.|HH:MM ตรงกับที่มือถืออ่าน (splitDT)
    // reassign หลัง 'declined' จะเขียนทับเป็นเวลาแจ้งครั้งล่าสุด (= เวลาที่ surveyor คนใหม่ถูกแจ้งจริง)
    try {
      const tRes = await db.query(
        `SELECT to_char(n, 'FMDD/FMMM/') || (EXTRACT(YEAR FROM n)::int + 543) || '|' || to_char(n, 'HH24:MI') AS ts
           FROM (SELECT NOW() AT TIME ZONE 'Asia/Bangkok' AS n) s`
      );
      const notifyTime = tRes.rows[0].ts as string;
      // ประเภทเคลมที่คนจ่ายงานเลือก — เขียนพร้อมกันในบล็อกเดียว (แถวเดียวกัน)
      // ⛔ ไม่เลือก = ไม่แตะของเดิม (COALESCE) — reassign หลังช่างปฏิเสธจะได้ไม่ล้าง
      //    ค่าที่ช่างคนก่อนกรอกไว้ทิ้ง · ช่างยังเลือกเองบนแอปได้เหมือนเดิม
      const ct = ['F', 'D', 'A', 'C'].includes(String(claimType ?? '')) ? claimType : null;
      const existingReport = await db.query('SELECT id FROM survey_reports WHERE case_id = $1', [caseId]);
      if (existingReport.rows.length > 0) {
        await db.query(
          'UPDATE survey_reports SET acc_insurance_notify_date = $1, claim_type = COALESCE($2, claim_type) WHERE case_id = $3',
          [notifyTime, ct, caseId]
        );
      } else {
        await db.query(
          'INSERT INTO survey_reports (case_id, acc_insurance_notify_date, claim_type) VALUES ($1, $2, $3)',
          [caseId, notifyTime, ct]
        );
      }
    } catch (err) {
      console.error('[assign] เขียน acc_insurance_notify_date ไม่สำเร็จ (ไม่บล็อกการมอบหมาย):', err);
    }

    // Send push notification via FCM
    //
    // ⚠️ ผลการส่งต้อง "ไหลกลับไปถึงคนกดมอบหมาย" — เดิมสำเร็จก็ log พังก็ log แล้วไปต่อ
    // เงียบ ๆ หน้าเว็บขึ้นว่ามอบหมายสำเร็จเหมือนกันหมด ทั้งที่ช่างอาจไม่ได้รับอะไรเลย
    // (ตรวจ prod 2026-08-11: ผู้สำรวจ active 144 คน มี fcm_token แค่ 84 — อีก 60 คน
    //  จ่ายงานไปก็ไม่มีทางได้รับแจ้งเตือน และไม่มีสัญญาณอะไรบอกคนจ่ายเลย)
    const surveyor = surveyorResult.rows[0];
    let push: { status: 'sent' | 'no_token' | 'failed' | 'no_fcm'; reason?: string };
    if (!isFirebaseReady()) {
      push = { status: 'no_fcm', reason: 'ระบบแจ้งเตือนยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์' };
      console.error('[FCM] Firebase not configured — assign without push');
    } else if (!surveyor.fcm_token) {
      push = { status: 'no_token', reason: 'เครื่องของผู้สำรวจยังไม่เคยลงทะเบียนรับแจ้งเตือน' };
      console.warn(`[FCM] Surveyor ${surveyor.id} has no token — skip push`);
    } else {
      try {
        const fcmResult = await fcmService.sendUrgentSurvey(
          surveyor.fcm_token,
          caseId,
          caseData.incident_location || '',
          caseData.sr_claim_no || '',
          caseData.sr_insurance_company || ''
        );
        console.log('[FCM] Send success:', fcmResult);
        push = { status: 'sent' };
      } catch (err) {
        const code = (err as { code?: string })?.code || '';
        console.error('[FCM] Send failed:', err);
        // token ตายแล้ว (ถอนแอป/ล้างข้อมูล) → ล้างทิ้ง ไม่งั้นค้างหลอกว่ามี token
        if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
          await db.query('UPDATE users SET fcm_token = NULL WHERE id = $1', [surveyor.id])
            .catch(() => {});
          push = { status: 'no_token', reason: 'เครื่องของผู้สำรวจถอนการลงทะเบียนแจ้งเตือนไปแล้ว' };
        } else {
          push = { status: 'failed', reason: 'ส่งแจ้งเตือนไม่สำเร็จ' };
        }
      }
    }

    // บันทึกผลการส่ง เพื่อให้ "แจ้งเตือนไม่ถึง" กลายเป็นเรื่องที่ระบบรู้ตัวเองได้
    //
    // ⚠️ push.status === 'sent' แปลว่า **FCM รับเรื่องไว้** เท่านั้น ไม่ได้แปลว่าเครื่องได้รับ
    //    ตัวที่บอกว่าถึงจริงคือ push_delivered_at ซึ่งเครื่องช่างเป็นคนยิงกลับมาเอง (ackPush)
    // ⛔ ต้องล้าง push_delivered_at ทุกครั้ง — reassign หลังช่างคนก่อนปฏิเสธ ถ้าไม่ล้าง
    //    เวลาตอบรับของคนเก่าจะค้างมาหลอกว่างานรอบใหม่ถึงเครื่องคนใหม่แล้ว
    await db.query(
      'UPDATE cases SET push_sent_at = $1, push_delivered_at = NULL WHERE id = $2',
      [push.status === 'sent' ? new Date() : null, caseId]
    ).catch((err) => console.error('[assign] บันทึกสถานะ push ไม่สำเร็จ (ไม่บล็อกการมอบหมาย):', err));

    // Send real-time notification via Socket.io
    const io = getIO();
    if (io) {
      io.to(`user:${surveyorId}`).emit('case_assigned', {
        case_id: caseId,
        customer_name: caseData.customer_name,
        incident_location: caseData.incident_location,
        message: `คุณได้รับมอบหมายงานสำรวจ: ${caseData.customer_name}`,
      });
    }

    // แนบผลการส่งแจ้งเตือนไปกับแถวเคส — หน้าเว็บใช้ตัดสินว่าจะเตือนคนจ่ายงานไหม
    // (เพิ่มฟิลด์ ไม่เปลี่ยนรูปทรงเดิม ที่อ่าน res.data.data อยู่แล้วจึงไม่พัง)
    return { ...updated.rows[0], push };
  },

  /**
   * เครื่องช่างยืนยันว่าได้รับแจ้งเตือนงานแล้ว — ยิงจาก native ทันทีที่ FCM เข้าเครื่อง
   * (ก่อนช่างจะกดอะไรทั้งสิ้น — นี่คือ "ถึงเครื่อง" ไม่ใช่ "ช่างเห็นแล้ว")
   *
   * ⛔ ห้าม throw ถ้าไม่เข้าเงื่อนไข: เครื่องยิงซ้ำได้ (FCM ส่งซ้ำเองได้) และงานอาจถูก
   *    reassign ไปคนอื่นแล้วระหว่างทาง — ตอบ 200 เสมอ ไม่งั้น native จะ retry รัวเปล่า ๆ
   */
  async ackPush(caseId: number, surveyorId: number) {
    const r = await db.query(
      `UPDATE cases SET push_delivered_at = NOW()
         WHERE id = $1 AND assigned_to = $2 AND push_delivered_at IS NULL
       RETURNING push_sent_at, push_delivered_at`,
      [caseId, surveyorId]
    );
    if (r.rowCount === 0) return { acked: false };
    return { acked: true, ...r.rows[0] };
  },

  /** สถานะแจ้งเตือนของเคสเดียว — คิวรีเบาสุดเท่าที่พอใช้ เพราะหน้าจ่ายงาน poll ถี่ */
  async getPushStatus(caseId: number) {
    const r = await db.query(
      `SELECT c.push_sent_at, c.push_delivered_at, c.assigned_to,
              u.first_name, u.last_name, (u.fcm_token IS NOT NULL) AS has_token
         FROM cases c LEFT JOIN users u ON u.id = c.assigned_to
        WHERE c.id = $1`,
      [caseId]
    );
    if (r.rows.length === 0) throw new NotFoundError('Case not found');
    return r.rows[0];
  },

  async declineCase(caseId: number, surveyorId: number, reason?: string) {
    const caseResult = await db.query('SELECT * FROM cases WHERE id = $1', [caseId]);
    if (caseResult.rows.length === 0) throw new NotFoundError('Case not found');
    const caseData = caseResult.rows[0];
    if (caseData.assigned_to !== surveyorId) throw new ForbiddenError('Case is not assigned to you');
    // ปฏิเสธได้เฉพาะงานที่ยังไม่ได้ลงมือ — กด "เสร็จงาน"/ส่งงานไปแล้ว ปฏิเสธ = ข้อมูลหน้างานหายไปกับเจ้าของงาน
    // (เดิมไม่มี guard เลย เพิ่งมีสถานะ finished 07/09/69 จึงต้องกัน)
    if (caseData.status !== 'assigned') {
      throw new ForbiddenError('งานนี้เสร็จงาน/ส่งงานไปแล้ว ปฏิเสธไม่ได้');
    }

    /**
     * เหตุผลที่ปฏิเสธ — ไม่ล็อกไว้แค่ 4 ข้อที่แอปมีวันนี้ (เพิ่มตัวเลือกทีหลังจะได้ไม่ต้องแก้ 2 ที่)
     * แค่ตัดความยาวกันข้อความยาวผิดปกติ · APK เก่าไม่ส่งมา = null (ไม่ใช่ error)
     */
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : null;

    // เคลียร์ assigned_to ด้วย — งานที่ถูกปฏิเสธจะได้ไม่ค้างในรายการของคนที่ปฏิเสธ (getMyCases กรองด้วย assigned_to)
    //
    // ⛔ declined_by ต้องเก็บแยกจาก assigned_to เพราะบรรทัดนี้ล้าง assigned_to ทิ้ง —
    //    ไม่เก็บ = ผู้จ่ายงานไม่มีทางรู้ว่าใครไม่รับ แล้วจ่ายให้คนเดิมซ้ำโดยไม่รู้ตัว
    const result = await db.query(
      `UPDATE cases
          SET status = 'declined', assigned_to = NULL,
              declined_reason = $2, declined_by = $3, declined_at = NOW()
        WHERE id = $1 RETURNING *`,
      [caseId, cleanReason, surveyorId]
    );
    // ปฏิเสธงาน = เลิกเป็นเจ้าของ → ล้าง cache สิทธิ์ดูรูป (ไม่งั้นยังเปิดรูปเคสนี้ได้อีกพักหนึ่ง)
    invalidateCaseOwner(caseId);
    return result.rows[0];
  },

  /**
   * "เสร็จงาน" — ช่างกดในแอปตอนเสร็จหน้างาน ก่อนออกจากที่เกิดเหตุ (user สั่งทำ 07/09/69)
   *
   * ⛔ ไม่ใช่ "ส่งงาน": ฟอร์มยังแก้ต่อได้ (ที่บ้าน/ที่สะดวก) จนกว่าจะกดส่งให้หัวหน้าตรวจ
   *    updateSurvey/submitSurvey จึงรับทั้ง 'assigned' และ 'finished'
   *
   * สิ่งที่สถานะนี้ให้:
   *   - บอร์ดจ่ายงานรู้ว่าช่างว่างแล้ว (activeWorkload นับ finished แยกจาก assigned → isFree ไม่นับ)
   *   - หัวหน้าเห็นในรายการงานว่า "เสร็จงานแล้ว รอส่งรายงาน" (getForReview รวม finished)
   *   - เวลา "สำรวจเสร็จ" ในไทม์ไลน์ = เวลาที่กดจริง ไม่ใช่เวลากดส่งงานอีกหลายชั่วโมงถัดมา
   *     (submitSurvey ยังเติมให้เองถ้าช่างไม่เคยกดเสร็จงาน — ของเดิม ไม่แตะ)
   *
   * idempotent: กดซ้ำ/แอป retry ตอนเป็น finished อยู่แล้ว = คืนค่าเดิม ไม่ error ไม่ขยับเวลา
   * งานที่ถูกตีกลับ (sent_back_at) ไม่ต้องกด — หน้างานเสร็จไปตั้งแต่ครั้งก่อน แก้แล้วส่งได้เลย
   */
  async finishCase(caseId: number, surveyorId: number) {
    const caseResult = await db.query('SELECT * FROM cases WHERE id = $1', [caseId]);
    if (caseResult.rows.length === 0) throw new NotFoundError('Case not found');
    const caseData = caseResult.rows[0];
    if (caseData.assigned_to !== surveyorId) throw new ForbiddenError('Case is not assigned to you');

    if (caseData.status === 'finished') {
      const t = await db.query('SELECT acc_survey_complete_date FROM survey_reports WHERE case_id = $1', [caseId]);
      return { ...caseData, already: true, survey_complete_date: t.rows[0]?.acc_survey_complete_date ?? null };
    }
    if (caseData.status !== 'assigned') {
      throw new AppError(409, 'งานนี้ส่งไปแล้ว กดเสร็จงานไม่ได้');
    }
    if (caseData.sent_back_at) {
      throw new AppError(409, 'งานที่ถูกตีกลับ แก้แล้วกดส่งงานได้เลย ไม่ต้องกดเสร็จงาน');
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      // guard สถานะใน UPDATE — กดพร้อมกัน 2 เครื่อง/ส่งงานคั่นกลาง → 0 แถว → ไม่ตอบว่าสำเร็จ
      const st = await client.query(
        `UPDATE cases SET status = 'finished', finished_at = NOW()
          WHERE id = $1 AND status = 'assigned' RETURNING *`,
        [caseId]
      );
      if (st.rowCount === 0) throw new AppError(409, 'สถานะงานเพิ่งเปลี่ยน — โหลดใหม่แล้วลองอีกครั้ง');

      // "สำรวจเสร็จ" (acc_survey_complete_date) = ตอนนี้ — รูปแบบ/เวลาไทยชุดเดียวกับ submitSurvey
      // เขียนเฉพาะตอนยังว่าง (ช่างอาจพิมพ์เองไว้แล้ว) · คืนค่าให้แอปเอาไปใส่ช่องไทม์ไลน์ในฟอร์ม
      // ไม่งั้นตอนส่งงาน ค่าว่างจากฟอร์มจะทับ แล้ว submitSurvey เติมเป็นเวลาส่งงานแทน (ผิดความจริง)
      const t = await client.query(
        `UPDATE survey_reports
            SET acc_survey_complete_date =
                  to_char(n, 'FMDD/FMMM/') || (EXTRACT(YEAR FROM n)::int + 543)
                  || '|' || to_char(n, 'HH24:MI')
           FROM (SELECT NOW() AT TIME ZONE 'Asia/Bangkok' AS n) s
          WHERE case_id = $1
            AND COALESCE(TRIM(acc_survey_complete_date), '') = ''
          RETURNING acc_survey_complete_date`,
        [caseId]
      );
      await client.query('COMMIT');
      // บอร์ดจ่ายงาน/คิวตรวจต้องเห็นว่าช่างว่างแล้วทันที
      notifyCaseChanged(caseId, 'finished', surveyorId);
      return { ...st.rows[0], already: false, survey_complete_date: t.rows[0]?.acc_survey_complete_date ?? null };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async updateSurvey(caseId: number, surveyorId: number, data: Record<string, unknown>) {
    const caseResult = await db.query('SELECT * FROM cases WHERE id = $1', [caseId]);
    if (caseResult.rows.length === 0) throw new NotFoundError('Case not found');

    const caseData = caseResult.rows[0];
    if (caseData.assigned_to !== surveyorId) throw new ForbiddenError('Case is not assigned to you');

    // ── guard สถานะ (เพิ่ม 2026-08-11) ────────────────────────────────────────
    // เดิมตรวจแค่ assigned_to → แอปที่เปิดฟอร์มค้างไว้เขียนทับงานที่ส่งไปแล้ว /
    // ที่ผู้ตรวจแก้บนเว็บแล้ว / ที่นำเข้าระบบประกันไปแล้ว ได้เงียบ ๆ ไม่มีสัญญาณเลย
    // (submitSurvey กับ confirmArrival มี guard นี้อยู่แล้ว ตกหล่นเฉพาะ endpoint นี้)
    // 'finished' (เสร็จงานหน้างาน 07/09/69) ยังอยู่กับช่าง — กรอกต่อ/บันทึกได้จนกว่าจะกดส่งงาน
    if (!['assigned', 'finished'].includes(String(caseData.status))) {
      throw new AppError(409, 'งานนี้ส่งไปแล้ว แก้ไขจากแอปไม่ได้ — ให้ผู้ตรวจแก้บนเว็บแทน');
    }
    if (caseData.emcs_imported_at) {
      throw new AppError(409, 'งานนี้นำเข้าระบบประกันไปแล้ว แก้ไขจากแอปไม่ได้');
    }

    // เลขเซอร์เวย์อยู่ใน whitelist ของ endpoint นี้ (แก้ได้) แต่เดิมไม่เคยตรวจซ้ำ
    // — ตรวจเฉพาะ survey_job_no; survey_job_no_2 เขียนผ่าน endpoint นี้ไม่ได้
    if (data.survey_job_no !== undefined) {
      await assertSurveyJobNoUnique([data.survey_job_no], caseId);
    }

    const reportResult = await db.query('SELECT id FROM survey_reports WHERE case_id = $1', [caseId]);
    if (reportResult.rows.length === 0) throw new NotFoundError('Survey report not found');

    const fields = [
      'car_model','car_color','license_plate','notes',
      'survey_company','survey_company_address','survey_company_phone',
      'claim_type','damage_level','car_lost','insurance_company','insurance_branch',
      'survey_job_no','claim_ref_no','claim_no',
      'prb_number','policy_no','driver_by_policy','policy_start','policy_end',
      'assured_name','policy_type','assured_email','risk_code','deductible',
      'car_brand','car_type','car_province','chassis_no','engine_no','mileage',
      'car_reg_year','ev_type','ev_battery_no','ev_battery_start','ev_charger_no','model_no',
      'driver_gender','driver_title','driver_name','driver_first_name','driver_last_name',
      'driver_age','driver_birthdate',
      'driver_phone','driver_address','driver_province','driver_district',
      'driver_id_card','driver_id_type','driver_license_no',
      'driver_license_type','driver_license_place','driver_license_start','driver_license_end',
      'driver_relation','driver_ticket','damage_description','repair_shop','estimated_cost','insured_damage',
      'acc_date','acc_time','acc_place','acc_subdistrict','acc_province','acc_district',
      'survey_place','survey_province','survey_district',   // สถานที่ออกตรวจสอบ (มือถือส่งตั้งแต่ APK 1.0.105, 10/09/69)
      'acc_cause','acc_damage_type','acc_detail','acc_fault','acc_fault_opponent_no',
      'acc_reporter','reporter_phone','acc_surveyor','acc_surveyor_branch','acc_surveyor_phone',
      'acc_customer_report_date','customer_reported_at','acc_insurance_notify_date',
      'acc_survey_arrive_date','acc_survey_complete_date',
      'acc_claim_opponent','acc_claim_amount','acc_claim_total_amount','opposing_parties',
      'injured_persons','damaged_property','has_opponents','has_injured','has_property',
      'acc_police_name','acc_police_station','acc_police_comment','acc_police_date','acc_police_book_no',
      'acc_alcohol_test','acc_alcohol_result',
      'acc_followup','acc_followup_count','acc_followup_detail','acc_followup_date',
    ];

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let idx = 1;
    for (const f of fields) {
      if (data[f] !== undefined) {
        setClauses.push(`${f} = $${idx}`);
        values.push(bindVal(f, data[f]));
        idx++;
      }
    }
    if (setClauses.length === 0) throw new Error('No fields to update');

    values.push(caseId);
    const result = await db.query(
      `UPDATE survey_reports SET ${setClauses.join(', ')} WHERE case_id = $${idx} RETURNING *`,
      values
    );
    return result.rows[0];
  },

  // keepRaw = JSON array ของชื่อไฟล์ทั้งชุดที่ client ตั้งใจให้เหลืออยู่ (แอปใหม่ส่งทีละไฟล์ + keep ทุกคำขอ)
  // ไม่ส่ง keep = แอปเก่าส่งทุกไฟล์ในคำขอเดียว → ใช้พฤติกรรมเดิม (ล้าง non-OCR ทั้งหมดก่อนเขียนใหม่)
  async uploadCaseFolder(caseId: number, _folderName: string, files: Express.Multer.File[], user?: CaseUser, keepRaw?: unknown) {
    // กัน IDOR: uploadCaseFolder ลบรูปเดิมของเคสก่อนเขียนใหม่ — surveyor ต้องเป็นเจ้าของเคสเท่านั้น
    const own = await db.query('SELECT assigned_to FROM cases WHERE id = $1', [caseId]);
    if (own.rows.length === 0) throw new NotFoundError('Case not found');
    assertCaseAccess(own.rows[0], user);
    // ⛔ รูปคือส่วนหนึ่งของสิ่งที่บอทส่งเข้า EMCS — endpoint นี้ "ลบรูปเดิมแล้วเขียนใหม่"
    // ถ้าแอปที่ค้างฟอร์มไว้ยิงเข้ามาหลังหัวหน้าอนุมัติ ชุดรูปที่บอทส่งจะไม่ใช่ชุดที่ถูกรับรอง
    await assertNotApproved(caseId);

    // โฟลเดอร์เก็บรูปผูกกับ case id (immutable) เท่านั้น — เดิมใช้เลขเคลมจาก DB ซึ่งแก้ไขได้
    // → เลขเปลี่ยนระหว่าง upload กับ submit แล้วรูปหลุดจากรายงานทั้งชุดแบบเงียบ (folderName จาก client ไม่ใช้แล้ว)
    const claimNo = `case_${caseId}`;
    const surveyJobNo = `job_${caseId}`;

    const fs = await import('fs');
    const pathMod = await import('path');

    // โครงสร้าง: uploads/{เลขเคลม}/{เลขเรื่องเซอร์เวย์}/
    const subFolderPath = pathMod.default.resolve(env.UPLOAD_DIR, claimNo, surveyJobNo);
    if (!fs.default.existsSync(subFolderPath)) {
      fs.default.mkdirSync(subFolderPath, { recursive: true });
    }

    // ลบรูปที่อยู่นอกโฟลเดอร์เคลม (uploads/ root) ของเคสนี้
    const surveyPhotos = await db.query(
      `SELECT sp.file_path FROM survey_photos sp JOIN survey_reports sr ON sp.report_id = sr.id WHERE sr.case_id = $1`, [caseId]
    );
    const caseImages = await db.query(
      'SELECT file_path FROM case_images WHERE case_id = $1', [caseId]
    );
    for (const row of [...surveyPhotos.rows, ...caseImages.rows]) {
      const fp = row.file_path as string;
      if (!fp.includes('/')) {
        const fullPath = pathMod.default.resolve(env.UPLOAD_DIR, fp);
        try { if (fs.default.existsSync(fullPath)) fs.default.unlinkSync(fullPath); } catch { /* skip */ }
      }
    }

    // ดึงชื่อไฟล์ OCR ที่ต้องเก็บไว้
    const ocrFiles = new Set<string>();
    const ocrResult = await db.query(
      "SELECT file_path FROM case_images WHERE case_id = $1 AND image_type = 'ocr'", [caseId]
    );
    for (const row of ocrResult.rows) {
      const fp = row.file_path as string;
      ocrFiles.add(pathMod.default.basename(fp));
    }

    // keep set (ชื่อไฟล์ base เท่านั้น — กัน path traversal)
    let keep: Set<string> | null = null;
    if (typeof keepRaw === 'string' && keepRaw) {
      try {
        const arr = JSON.parse(keepRaw);
        if (Array.isArray(arr)) keep = new Set(arr.map((x) => pathMod.default.basename(String(x))));
      } catch { /* keep พัง → ปฏิบัติเหมือนไม่ส่ง */ }
    }

    // ลบรูปเก่าในโฟลเดอร์ย่อย ยกเว้นรูป OCR
    // มี keep → ลบเฉพาะไฟล์ที่หลุดจากชุดปัจจุบันของ client (ผู้ใช้ลบรูปในแอป) — ไฟล์ที่อัปโหลดไว้แล้ว
    // จากคำขอก่อนหน้า (per-file + retry) ต้องคงอยู่; ไม่มี keep → ล้าง non-OCR ทั้งหมด (แอปเก่า)
    try {
      const existing = fs.default.readdirSync(subFolderPath);
      for (const f of existing) {
        if (ocrFiles.has(f)) continue; // ข้ามรูป OCR
        if (keep !== null && keep.has(f)) continue; // ยังอยู่ในชุดของ client → เก็บไว้
        try { fs.default.unlinkSync(pathMod.default.join(subFolderPath, f)); } catch { /* skip */ }
      }
    } catch { /* folder may not exist */ }

    // ใส่รูปใหม่จากมือถือ
    const movedFiles: string[] = [];
    for (const file of files) {
      const safeName = file.originalname.replace(/[/\\?%*:|"<>]/g, '_');
      const destPath = pathMod.default.join(subFolderPath, safeName);
      try {
        fs.default.renameSync(file.path, destPath);
        movedFiles.push(`${claimNo}/${surveyJobNo}/${safeName}`);
      } catch { movedFiles.push(safeName); }
    }

    return { folder: `${claimNo}/${surveyJobNo}`, files: movedFiles };
  },

  // รายชื่อไฟล์ที่อยู่ในโฟลเดอร์เคสบน server แล้ว — แอปใช้ข้ามไฟล์ที่อัปโหลดสำเร็จไปก่อนหน้า
  // (per-file upload: เน็ตหลุดกลางทางแล้ว retry ไม่ต้องเริ่มจากศูนย์)
  async listCaseFolder(caseId: number, user?: CaseUser) {
    const own = await db.query('SELECT assigned_to FROM cases WHERE id = $1', [caseId]);
    if (own.rows.length === 0) throw new NotFoundError('Case not found');
    assertCaseAccess(own.rows[0], user);

    const fs = await import('fs');
    const pathMod = await import('path');
    const folderPath = pathMod.default.resolve(env.UPLOAD_DIR, `case_${caseId}`, `job_${caseId}`);
    let files: string[] = [];
    try { files = fs.default.readdirSync(folderPath); } catch { /* ยังไม่มีโฟลเดอร์ = ยังไม่มีไฟล์ */ }
    return { files };
  },

  async createCaseFolder(caseId: number, user?: CaseUser) {
    const own = await db.query('SELECT assigned_to FROM cases WHERE id = $1', [caseId]);
    if (own.rows.length === 0) throw new NotFoundError('Case not found');
    assertCaseAccess(own.rows[0], user);

    // โฟลเดอร์ผูกกับ case id (immutable) — สอดคล้องกับ uploadCaseFolder/submitSurvey
    const folderName = `case_${caseId}`;

    const fs = await import('fs');
    const path = await import('path');
    const folderPath = path.default.resolve(env.UPLOAD_DIR, folderName);
    if (!fs.default.existsSync(folderPath)) {
      fs.default.mkdirSync(folderPath, { recursive: true });
    }
    return { folder: folderName, path: folderPath };
  },

  /**
   * ยืนยันถึงที่เกิดเหตุ — รูป + **พิกัด** + จังหวัด/อำเภอที่ผู้สำรวจยืนยันบนหน้าจอ
   *
   * ⛔ `province`/`district` คือค่าที่ **คนกดยืนยัน** ไม่ใช่ค่าที่ GPS เดา — เก็บแยกจาก
   *    พิกัดดิบเสมอ (ดูคอมเมนต์ใน migration 045) · GPS จับไม่ได้ก็ยังยืนยันได้
   *    ห้ามบล็อกการทำงานเพราะไม่มีพิกัด (ในอาคาร/ห้างจับไม่ติดเป็นเรื่องปกติ)
   */
  async confirmArrival(
    caseId: number, surveyorId: number, photoPath: string,
    loc?: { lat?: number | null; lng?: number | null; province?: string | null; district?: string | null },
  ) {
    const caseResult = await db.query('SELECT * FROM cases WHERE id = $1', [caseId]);
    if (caseResult.rows.length === 0) throw new NotFoundError('Case not found');
    const caseData = caseResult.rows[0];
    if (caseData.assigned_to !== surveyorId) throw new ForbiddenError('Case is not assigned to you');

    // ถ้ามี arrival อยู่แล้ว → อัพเดท, ถ้าไม่มี → insert ใหม่
    const existing = await db.query(
      "SELECT id FROM case_images WHERE case_id = $1 AND image_type = 'arrival'", [caseId]
    );
    if (existing.rows.length > 0) {
      await db.query(
        'UPDATE case_images SET file_path = $1, uploaded_at = NOW() WHERE id = $2',
        [photoPath, existing.rows[0].id]
      );
    } else {
      await db.query(
        'INSERT INTO case_images (case_id, file_path, image_type) VALUES ($1, $2, $3)',
        [caseId, photoPath, 'arrival']
      );
    }

    // พิกัด + พื้นที่ที่ยืนยัน — เขียนเฉพาะค่าที่ส่งมา (COALESCE) กันการกดยืนยันซ้ำ
    // แบบไม่มีพิกัด (เช่นถ่ายรูปใหม่ในอาคาร) ไปล้างพิกัดที่เคยจับได้ทิ้ง
    if (loc && (loc.lat != null || loc.province || loc.district)) {
      await db.query(
        `UPDATE cases SET arrival_lat = COALESCE($1, arrival_lat),
                          arrival_lng = COALESCE($2, arrival_lng),
                          arrival_province = COALESCE($3, arrival_province),
                          arrival_district = COALESCE($4, arrival_district),
                          arrival_at = NOW()
           WHERE id = $5`,
        [loc.lat ?? null, loc.lng ?? null,
         (loc.province ?? '').trim() || null, (loc.district ?? '').trim() || null, caseId]
      );
    }

    // บันทึกเวลาถึงที่เกิดเหตุใน survey_reports — ต้องเป็นเวลาไทย (Asia/Bangkok) ไม่ใช่เวลา server (prod = UTC)
    // รูปแบบ: D/M/พ.ศ.|HH:MM (วัน/เดือนไม่เติม 0 นำ, ปี พ.ศ. = ค.ศ.+543, เวลาเติม 0 นำ) — ตรงกับที่มือถืออ่าน (splitDT)
    const tRes = await db.query(
      `SELECT to_char(n, 'FMDD/FMMM/') || (EXTRACT(YEAR FROM n)::int + 543) || '|' || to_char(n, 'HH24:MI') AS ts
         FROM (SELECT NOW() AT TIME ZONE 'Asia/Bangkok' AS n) s`
    );
    const arrivalTime = tRes.rows[0].ts as string;
    const existingReport = await db.query('SELECT id FROM survey_reports WHERE case_id = $1', [caseId]);
    if (existingReport.rows.length > 0) {
      await db.query('UPDATE survey_reports SET acc_survey_arrive_date = $1 WHERE case_id = $2', [arrivalTime, caseId]);
    }

    return { success: true, arrival_time: arrivalTime };
  },

  async getArrivalPhotos(caseId: number, user?: CaseUser) {
    if (user?.role === 'surveyor') {
      const c = await db.query('SELECT assigned_to FROM cases WHERE id = $1', [caseId]);
      if (c.rows.length === 0) throw new NotFoundError('Case not found');
      assertCaseAccess(c.rows[0], user);
    }
    const result = await db.query(
      "SELECT * FROM case_images WHERE case_id = $1 AND image_type = 'arrival' ORDER BY uploaded_at",
      [caseId]
    );
    return result.rows;
  },

  async submitSurvey(caseId: number, surveyorId: number, data: Record<string, unknown> & { photo_paths: string[] }) {
    const caseResult = await db.query('SELECT * FROM cases WHERE id = $1', [caseId]);
    if (caseResult.rows.length === 0) throw new NotFoundError('Case not found');

    const caseData = caseResult.rows[0];
    // ส่งได้จากทั้ง 'assigned' และ 'finished' (เสร็จงานหน้างานแล้ว กรอกต่อที่บ้านแล้วค่อยส่ง — 07/09/69)
    if (!['assigned', 'finished'].includes(String(caseData.status))) {
      throw new ForbiddenError('Case is not in assigned status');
    }
    if (caseData.assigned_to !== surveyorId) throw new ForbiddenError('Case is not assigned to you');

    // เลขเซอร์เวย์ห้ามซ้ำข้ามเคส (อ้างอิงเบิกเงิน) — เช็คก่อนเขียน กันแก้เลขในฟอร์มไปชนเคสอื่น
    await assertSurveyJobNoUnique([data.survey_job_no, data.survey_job_no_2], caseId);

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      const fields = [
        'car_model','car_color','license_plate','notes',
        'survey_company','survey_company_address','survey_company_phone',
        'claim_type','damage_level','car_lost','insurance_company','insurance_branch',
        'survey_job_no','claim_ref_no','claim_no',
        'prb_number','policy_no','driver_by_policy','policy_start','policy_end',
        'assured_name','policy_type','assured_email','risk_code','deductible',
        'car_brand','car_type','car_province','chassis_no','engine_no','mileage',
        'car_reg_year','ev_type','ev_battery_no','ev_battery_start','ev_charger_no','model_no',
        'driver_gender','driver_title','driver_name','driver_first_name','driver_last_name',
        'driver_age','driver_birthdate',
        'driver_phone','driver_address','driver_province','driver_district',
        'driver_id_card','driver_id_type','driver_license_no',
        'driver_license_type','driver_license_place','driver_license_start','driver_license_end',
        'driver_relation','driver_ticket','damage_description','repair_shop','estimated_cost','insured_damage',
        'acc_date','acc_time','acc_place','acc_subdistrict','acc_province','acc_district',
      'survey_place','survey_province','survey_district',   // สถานที่ออกตรวจสอบ (มือถือส่งตั้งแต่ APK 1.0.105, 10/09/69)
        'acc_cause','acc_damage_type','acc_detail','acc_fault','acc_fault_opponent_no',
        'acc_reporter','reporter_phone','acc_surveyor','acc_surveyor_branch','acc_surveyor_phone',
        'acc_customer_report_date','customer_reported_at','acc_insurance_notify_date',
        'acc_survey_arrive_date','acc_survey_complete_date',
        'acc_claim_opponent','acc_claim_amount','acc_claim_total_amount','opposing_parties',
        'injured_persons','damaged_property','has_opponents','has_injured','has_property',
        'acc_police_name','acc_police_station','acc_police_comment','acc_police_date','acc_police_book_no',
        'acc_alcohol_test','acc_alcohol_result',
        'acc_followup','acc_followup_count','acc_followup_detail','acc_followup_date',
        'survey_result','review_comment','surveyor_comment',
      ];
      // ส่งเฉพาะคอลัมน์ที่แอปส่งมาจริง (data[f] !== undefined) — กันการเขียนทับข้อมูล intake จาก callcenter
      // (เดิม map ทุกฟิลด์ → คอลัมน์ที่แอปไม่ส่ง เช่น acc_subdistrict/reporter_phone ถูกทับเป็น NULL)
      const provided = fields.filter(f => data[f] !== undefined);
      const values = provided.map(f => bindVal(f, data[f]));

      // ตรวจสอบว่ามี report อยู่แล้วหรือไม่ (สร้างจาก callcenter)
      // เก็บเลขเคลม/เลขเซอร์เวย์ "ก่อน UPDATE" ไว้ด้วย — ใช้ตามหาโฟลเดอร์รูประบบเก่า (legacy) ตอน re-link
      const existingReport = await client.query(
        'SELECT id, claim_no, survey_job_no FROM survey_reports WHERE case_id = $1', [caseId]
      );
      const oldClaimNo = existingReport.rows[0]?.claim_no as string | undefined;
      const oldSurveyJobNo = existingReport.rows[0]?.survey_job_no as string | undefined;
      let report;
      if (existingReport.rows.length > 0) {
        if (provided.length > 0) {
          const setClauses = provided.map((f, i) => `${f} = $${i + 1}`);
          const updateResult = await client.query(
            `UPDATE survey_reports SET ${setClauses.join(', ')} WHERE case_id = $${provided.length + 1} RETURNING *`,
            [...values, caseId]
          );
          report = updateResult.rows[0];
        } else {
          report = existingReport.rows[0];
        }
      } else {
        // INSERT report ใหม่ (เฉพาะคอลัมน์ที่ส่งมา)
        const placeholders = provided.map((_, i) => `$${i + 2}`).join(',');
        const insertResult = await client.query(
          `INSERT INTO survey_reports (case_id${provided.length ? ', ' + provided.join(',') : ''})
           VALUES ($1${placeholders ? ', ' + placeholders : ''}) RETURNING *`,
          [caseId, ...values]
        );
        report = insertResult.rows[0];
      }

      // บันทึก survey_photos จากโฟลเดอร์ที่อัปโหลดมาจากมือถือ (ข้ามรูป OCR)
      // โฟลเดอร์หลักผูกกับ case id (immutable) — เดิมใช้เลขเคลมจาก payload ซึ่งอาจไม่ตรงกับโฟลเดอร์
      // ที่ upload เขียนไว้ (เลขถูกแก้ระหว่างทาง) → รูปหลุดจากรายงานทั้งชุดแบบเงียบ
      // ยังกวาดโฟลเดอร์ระบบเก่า (ตามเลขเคลม payload/DB ก่อน UPDATE) เผื่อไฟล์จากแอป/การอัปโหลดรุ่นเก่า
      const san = (s: unknown) => {
        const v = String(s ?? '').replace(/[/\\?%*:|"<>]/g, '_');
        return (v === '.' || v === '..') ? '_' : v; // กัน path traversal ('..' หลุด resolve ออกนอก uploads)
      };
      const candidateFolders = [...new Set([
        `case_${caseId}/job_${caseId}`,
        `${san(data.claim_no) || `case_${caseId}`}/${san(data.survey_job_no) || `job_${caseId}`}`,
        `${san(oldClaimNo) || `case_${caseId}`}/${san(oldSurveyJobNo) || `job_${caseId}`}`,
      ])];
      const fs = await import('fs');
      const pathMod = await import('path');

      // จำหมวดเดิมของแต่ละไฟล์ไว้ก่อนลบ — รูปที่ผู้ตรวจอัปเองบนเว็บ (web_*.jpg) อยู่โฟลเดอร์
      // เดียวกับรูปจากแอป แต่แอปไม่ได้ส่งหมวดของมันมาด้วย ถ้าไม่จำไว้ พอช่างส่งงานใหม่
      // (เช่นหลังถูกตีกลับ) หมวดที่ผู้ตรวจตั้งไว้จะกลายเป็นว่างทั้งชุด
      const prevCats = new Map<string, string>();
      for (const row of (await client.query(
        'SELECT file_path, category FROM survey_photos WHERE report_id = $1', [report.id])).rows) {
        if (row.category) prevCats.set(String(row.file_path), String(row.category));
      }

      // ลบ survey_photos เดิมของ report ก่อน re-insert — กันรูปซ้ำเมื่อ submit ซ้ำ (idempotent)
      await client.query('DELETE FROM survey_photos WHERE report_id = $1', [report.id]);

      // ดึงชื่อไฟล์ OCR เพื่อข้าม
      const ocrResult = await client.query(
        "SELECT file_path FROM case_images WHERE case_id = $1 AND image_type = 'ocr'", [caseId]
      );
      const ocrFileNames = new Set(ocrResult.rows.map((r: any) => pathMod.default.basename(r.file_path)));

      // หมวดของรูป — มือถือส่ง photo_categories (local-path → หมวด); จับคู่ด้วย basename
      const catByName: Record<string, string> = {};
      const rawCats = data.photo_categories;
      if (rawCats && typeof rawCats === 'object') {
        for (const [k, v] of Object.entries(rawCats as Record<string, unknown>)) {
          if (typeof v === 'string' && v) catByName[pathMod.default.basename(k)] = v;
        }
      }

      // ใช้ "โฟลเดอร์แรกที่มีอยู่จริง" เพียงโฟลเดอร์เดียว — ห้าม merge ข้ามโฟลเดอร์ และห้าม
      // fall-through เมื่อโฟลเดอร์มีอยู่แต่ว่าง: โฟลเดอร์ที่มีอยู่ = upload ระบบใหม่เขียน/prune แล้ว
      // เนื้อในคือชุดปัจจุบันของผู้ใช้ (0 รูป = ตั้งใจลบทั้งหมด) — ถ้าไปสแกนโฟลเดอร์เก่าต่อ
      // รูป stale ก่อน migrate จะฟื้นคืนเข้ารายงาน
      const uploadRoot = pathMod.default.resolve(env.UPLOAD_DIR);
      for (const rel of candidateFolders) {
        const folderPath = pathMod.default.resolve(env.UPLOAD_DIR, rel);
        // containment: เลขเคลมมาจาก payload/DB — ห้ามชี้ออกนอก uploads
        if (folderPath !== uploadRoot && !folderPath.startsWith(uploadRoot + pathMod.default.sep)) continue;
        if (!fs.default.existsSync(folderPath)) continue; // ไม่เคยสร้าง → ลองโฟลเดอร์ระบบเก่า
        const photoFiles = fs.default.readdirSync(folderPath).filter((f) => !ocrFileNames.has(f));
        for (const fileName of photoFiles) {
          await client.query(
            'INSERT INTO survey_photos (report_id, file_path, category) VALUES ($1, $2, $3)',
            [report.id, `${rel}/${fileName}`,
             catByName[fileName] || prevCats.get(`${rel}/${fileName}`) || arrivalCategory(fileName)]
          );
        }
        break; // โฟลเดอร์แรกที่มีอยู่จริง = แหล่งความจริง แม้ว่าง
      }

      // เวลา "สำรวจเสร็จ" (acc_survey_complete_date) — **ระบบเติมให้ ไม่ใช่ให้คนพิมพ์**
      //
      // EMCS บังคับช่องนี้ (+ ชั่วโมง/นาที) ทุกบริษัท แต่ไม่มีใครในระบบเราเติมเลย → บอทเขียน
      // ค่าว่างลงฟอร์มแล้ว btnUpdate ตีกลับ = draft เกิดแล้วแต่หน้าหลักบันทึกไม่ผ่าน (import ค้าง)
      //
      // จังหวะที่ถูกที่สุดคือตอนกดส่งงาน = งานสำรวจเสร็จจริง ณ เวลานั้น
      // รูปแบบ + เวลาไทย ยกจากบล็อก acc_survey_arrive_date ให้ตรงกัน (prod เป็น UTC)
      // เขียนเฉพาะตอนยังว่าง — ส่งซ้ำ/แก้ทีหลังต้องไม่ขยับเวลาเดิม
      await client.query(
        `UPDATE survey_reports
            SET acc_survey_complete_date =
                  to_char(n, 'FMDD/FMMM/') || (EXTRACT(YEAR FROM n)::int + 543)
                  || '|' || to_char(n, 'HH24:MI')
           FROM (SELECT NOW() AT TIME ZONE 'Asia/Bangkok' AS n) s
          WHERE case_id = $1
            AND COALESCE(TRIM(acc_survey_complete_date), '') = ''`,
        [caseId]
      );

      // guard status ใน UPDATE (idempotent) — ถ้าถูก submit คู่ขนานจน status เปลี่ยนไปแล้ว → 0 rows → rollback
      const st = await client.query(
        `UPDATE cases SET status = 'surveyed', submitted_at = NOW() WHERE id = $1 AND status IN ('assigned','finished') RETURNING id`,
        [caseId]
      );
      if (st.rowCount === 0) throw new ForbiddenError('Case is not in assigned status');

      await client.query('COMMIT');
      // งานใหม่เข้าคิวตรวจ — หน้าคิวของหัวหน้าทุกคนต้องเห็นทันทีโดยไม่ต้องกดรีเฟรช
      notifyCaseChanged(caseId, 'submitted', surveyorId);
      return report;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  async getById(caseId: number) {
    // ดึงจังหวัด/อำเภอที่เกิดเหตุมาด้วย — หน้าจ่ายงานใช้จัดกลุ่มช่างที่อยู่จังหวัดเดียวกัน
    // (อยู่คนละตารางกับ cases จึงต้อง join ไม่ใช่ SELECT * เฉย ๆ)
    // ชื่อคนที่ปฏิเสธ join แยก — assigned_to ถูกล้างตอนปฏิเสธ จึงหาจากตรงนั้นไม่ได้
    const result = await db.query(
      `SELECT c.*, sr.acc_province, sr.acc_district, sr.claim_type,
              d.first_name AS declined_first_name, d.last_name AS declined_last_name, d.code AS declined_code
         FROM cases c
         LEFT JOIN survey_reports sr ON sr.case_id = c.id
         LEFT JOIN users d ON d.id = c.declined_by
        WHERE c.id = $1`, [caseId]);
    if (result.rows.length === 0) throw new NotFoundError('Case not found');
    const row = result.rows[0];
    /**
     * ไม่มีชื่อจังหวัดแต่มีพิกัด → แปลงเอา (การ์ดไอโออิมีพิกัดติดมา บางใบไม่มีชื่ออำเภอ)
     * ไม่ใช่การเดา — พิกัดตกในขอบเขตจังหวัดไหนก็คือจังหวัดนั้นจริง ๆ
     */
    if (!row.acc_province && row.incident_lat && row.incident_lng) {
      row.acc_province = provinceOf(row.incident_lat, row.incident_lng);
    }
    /**
     * พิกัดที่เกิดเหตุสำหรับหน้าจ่ายงาน — **รู้อำเภอเมื่อไหร่ ใช้จุดกลางอำเภอเสมอ**
     * ถึงจะมีพิกัดเก็บไว้ในเคสอยู่แล้วก็ตาม
     *
     * ทำไมถึงทับของเดิม (user ยืนยัน 25/08/69): **พิกัดบนการ์ดของบริษัทประกัน
     * เป็นพิกัดสมมติอยู่แล้ว** — ระบบเขาสร้างจาก "อำเภอเมือง จังหวัดสมุทรปราการ"
     * แล้วแปะไว้บนการ์ด ไม่ใช่จุดเกิดเหตุที่วัดมาจริง → ไม่มีความแม่นยำอะไรให้เสีย
     *
     * ⛔ **อย่ากลับไปให้พิกัดในเคสชนะ** — พิกัดที่เก็บไว้มี 2 พันธุ์ปนกัน (สมมติจากการ์ด
     *    กับที่คนกรอกเองซึ่งบางใบละเอียดถึงปากซอย) และ**แยกจากกันไม่ได้**หลังบันทึกแล้ว
     *    ปนกันเมื่อไหร่ = เขียนป้ายบอกความแม่นยำบนหน้าจอให้ตรงไม่ได้เลยสักแบบ
     *    เอาแบบเดียวสม่ำเสมอแล้วบอกตามจริงว่า "ระดับอำเภอ" ตรงกว่า
     *    (ยังใช้พิกัดในเคสอยู่ ถ้าจับคู่ชื่ออำเภอไม่ได้ — ดีกว่าไม่มีอะไรเลย)
     *
     * วัดระยะกับ**พิกัดสดจากมือถือช่าง** ซึ่งเป็นของจริง — ความหยาบจึงอยู่ฝั่งเดียว
     * ไม่เขียนลง DB เพราะคำนวณใหม่ได้เสมอ และเขียนแล้วจะแยกไม่ออกว่าอันไหนของจริง
     */
    const centroid = districtCentroid(row.acc_province, row.acc_district);
    if (centroid) {
      row.incident_lat = centroid.lat;
      row.incident_lng = centroid.lng;
      row.incident_coord_source = 'district';
    } else {
      row.incident_coord_source = row.incident_lat && row.incident_lng ? 'case' : null;
    }
    return row;
  },

  /**
   * รายการงานของหน้า "ตรวจสอบ"
   *
   * คืนของที่หน้าลิสต์ต้องใช้ **คัดงานได้โดยไม่ต้องเปิดทีละเคส**:
   *  - `import_warnings` เรื่องที่ต้องเติมก่อนอนุมัติ (เก็บตอนนำเข้า — migration 040)
   *  - `photo_count` รูปน้อยผิดปกติ = ต้องไปตามรูปก่อน (งานจากระบบเก่าทยอยอัปรูป)
   *  - `pay_total` / `has_insurer_bill` ยอด 2 ฝั่งกรอกครบหรือยัง
   *  - `review_status` / `approved_by` / `unlocked_count` แยก "รอตรวจ" กับ "อนุมัติแล้ว"
   *    ออกจากกันได้จริง (เดิม 2 สถานะปนกันมาในลิสต์เดียว) และเห็นเคสที่ถูกปลดล็อกซ้ำ ๆ
   *
   * ⛔ นับรูปด้วย subquery ไม่ใช่ JOIN — join แล้วแถวเคสจะซ้ำตามจำนวนรูป
   */
  async getForReview(user?: { id: number; role: string }) {
    const result = await db.query(
      `SELECT c.*, u.first_name AS surveyor_first_name, u.last_name AS surveyor_last_name,
              u.code AS surveyor_code,
              sr.claim_no, sr.survey_job_no, sr.claim_ref_no, sr.license_plate,
              rv.status AS review_status, rv.unlocked_count,
              to_char(rv.reviewed_at, 'YYYY-MM-DD HH24:MI') AS approved_at,
              -- คอลัมน์ "ส่งงาน / ตรวจรายงาน" ในรายการ (10/09/69) เวลาไทย พ.ศ. — รอตรวจโชว์ส่งงาน อนุมัติแล้วโชว์ตรวจรายงาน
              ${thStamp("(rv.reviewed_at AT TIME ZONE 'UTC')")} AS reviewed_at_th,
              ${thStamp('c.submitted_at')} AS submitted_at_th,
              COALESCE(NULLIF(rv.inspector_name, ''), ck.first_name || ' ' || ck.last_name) AS approved_by,
              (SELECT COUNT(*) FROM survey_photos sp WHERE sp.report_id = sr.id) AS photo_count,
              (SELECT sp2.total FROM survey_pay sp2 WHERE sp2.case_id = c.id) AS pay_total,
              (SELECT se.service_fee_price IS NOT NULL
                 FROM survey_expenses se WHERE se.report_id = sr.id) AS has_insurer_bill,
              ROW_NUMBER() OVER (PARTITION BY sr.claim_no ORDER BY c.created_at) AS visit_count,
              -- คิวนำเข้า EMCS (สถานีนำเข้า, migration 052): งานล่าสุดของเคส + ลำดับถ้ายังรอ
              ej.id AS emcs_job_id, ej.status AS emcs_job_status, ej.dry_run AS emcs_job_dry_run,
              ej.station AS emcs_job_station, ej.error AS emcs_job_error, ej.screenshot_path AS emcs_job_screenshot,
              to_char(ej.requested_at, 'HH24:MI') AS emcs_job_requested_at,
              CASE WHEN ej.status = 'queued'
                   THEN (SELECT COUNT(*) FROM emcs_import_jobs q2 WHERE q2.status = 'queued' AND q2.id <= ej.id)
              END AS emcs_job_position
       FROM cases c
       LEFT JOIN users u ON c.assigned_to = u.id
       LEFT JOIN survey_reports sr ON sr.case_id = c.id
       LEFT JOIN reviews rv ON rv.case_id = c.id
       LEFT JOIN users ck ON ck.id = rv.checker_id
       LEFT JOIN LATERAL (
         SELECT j.* FROM emcs_import_jobs j WHERE j.case_id = c.id ORDER BY j.id DESC LIMIT 1
       ) ej ON TRUE
       -- เคสที่ตีกลับไปแล้วสถานะเป็น 'assigned' — ต้องยังอยู่ในลิสต์นี้
       -- ไม่งั้นหัวหน้าตีกลับแล้วตามงานตัวเองต่อไม่ได้ และ "หัวหน้ายังแก้เองได้" ก็ทำไม่ได้จริง
       WHERE c.status IN ('surveyed', 'reviewed')
          OR (c.status = 'assigned' AND c.sent_back_at IS NOT NULL)
          -- เสร็จงานหน้างานแล้ว ยังไม่ส่งรายงาน (07/09/69) — หัวหน้าต้องเห็นว่างานภาคสนามจบแล้ว เหลือแค่รายงาน
          OR c.status = 'finished'
       ORDER BY c.created_at DESC`
    );
    // กรองตามทีมของหัวหน้า (staff_groups) ให้เห็นชุดเดียวกับหน้า "งานรอตรวจ (ISURVEY)" — user 07/09/69
    // admin / หัวหน้าที่ยังไม่ผูกทีม = เห็นทั้งหมด · งานที่ตัวเองดึง/สร้าง เห็นเสมอ (แม้ช่างอยู่นอกทีม)
    if (!user) return result.rows;
    const team = await staffGroupService.filterFor(user.id, user.role);
    if (!team) return result.rows;
    const memberIds = new Set((team.group.members ?? []).map((m) => m.surveyor_id).filter((x): x is number => Boolean(x)));
    return result.rows.filter((r) =>
      r.created_by === user.id
      || (r.assigned_to && memberIds.has(r.assigned_to))
      || team.match(`${r.surveyor_code ?? ''} ${r.surveyor_first_name ?? ''} ${r.surveyor_last_name ?? ''}`.trim()));
  },

  async getDetail(caseId: number, user?: CaseUser) {
    const caseResult = await db.query(
      `SELECT c.*, u.first_name AS surveyor_first_name, u.last_name AS surveyor_last_name,
              ${thStamp('c.submitted_at')} AS submitted_at_th
       FROM cases c
       LEFT JOIN users u ON c.assigned_to = u.id
       WHERE c.id = $1`,
      [caseId]
    );
    if (caseResult.rows.length === 0) throw new NotFoundError('Case not found');
    assertCaseAccess(caseResult.rows[0], user);

    const reportResult = await db.query(
      'SELECT * FROM survey_reports WHERE case_id = $1',
      [caseId]
    );

    let photos: unknown[] = [];
    if (reportResult.rows.length > 0) {
      const photoResult = await db.query(
        'SELECT * FROM survey_photos WHERE report_id = $1',
        [reportResult.rows[0].id]
      );
      photos = photoResult.rows;
    }

    const reviewResult = await db.query(
      'SELECT * FROM reviews WHERE case_id = $1',
      [caseId]
    );

    // รูป OCR/capture จาก call center
    const caseImagesResult = await db.query(
      'SELECT * FROM case_images WHERE case_id = $1 ORDER BY uploaded_at',
      [caseId]
    );

    // คำนวณ visit_count จาก claim_no เดียวกัน
    let visitCount = 1;
    const report = reportResult.rows[0] || null;
    if (report?.claim_no) {
      const vcResult = await db.query(
        `SELECT COUNT(*) AS cnt FROM survey_reports sr
         JOIN cases c ON c.id = sr.case_id
         WHERE sr.claim_no = $1 AND c.created_at <= (SELECT created_at FROM cases WHERE id = $2)`,
        [report.claim_no, caseId]
      );
      visitCount = parseInt(vcResult.rows[0]?.cnt || '1', 10);
    }

    // ค่าใช้จ่าย
    let expenses = null;
    if (report) {
      const expResult = await db.query(
        'SELECT * FROM survey_expenses WHERE report_id = $1',
        [report.id]
      );
      expenses = expResult.rows[0] || null;
    }

    // เคลมคู่ (อุบัติเหตุเดียวกัน คนละกรมธรรม์/คนละมุมมอง) — ให้แอปโชว์คำเตือน กันข้อมูลสองเคลมปนกัน:
    // (1) เคสที่เลขเคลม = เลขเคลมคู่กรณีของเรา (2) เคสอื่นที่อ้างเลขเคลมเราเป็นคู่กรณี
    let linkedCases: Array<Record<string, unknown>> = [];
    if (report) {
      const oppClaims = new Set<string>();
      const addClaims = (s: unknown): void => {
        for (const t of String(s ?? '').split(/[\s,]+/)) {
          if (/^[0-9A-Za-z-]{10,}$/.test(t)) oppClaims.add(t);
        }
      };
      addClaims(report.acc_claim_opponent);
      if (Array.isArray(report.opposing_parties)) {
        for (const p of report.opposing_parties) {
          if (p && typeof p === 'object') addClaims((p as Record<string, unknown>).claim_no);
        }
      }
      const conds: string[] = [];
      const params: unknown[] = [caseId];
      // ⚠️ เงื่อนไขล่างเป็น "ค้นข้อความในก้อน JSON ของคู่กรณี" → เลขสั้นจับมั่วได้ทันที
      // (เคสจริง 2026-08-01: เลขเคลมทดสอบ '11' ไปแมตช์เลขบัตร ปชช. '1139800001520'
      //  ของอีกเคส แล้วขึ้นแบนเนอร์ "เคลมคู่" ผิด ๆ บนมือถือ)
      // ใช้เกณฑ์เดียวกับ addClaims: ต้องยาวพอที่จะเป็นเลขเคลมจริง (จริง ๆ 21 ตัว เช่น
      // 21BR10AVD-6906-001619) — สั้นกว่านั้นถือว่าเป็นข้อมูลทดสอบ/ยังไม่ได้เลขจริง ข้ามไป
      if (report.claim_no && /^[0-9A-Za-z-]{10,}$/.test(String(report.claim_no).trim())) {
        params.push(String(report.claim_no).trim());
        conds.push(`sr.acc_claim_opponent ILIKE '%' || $${params.length} || '%'`);
        conds.push(`sr.opposing_parties::text ILIKE '%' || $${params.length} || '%'`);
      }
      if (oppClaims.size > 0) {
        params.push([...oppClaims]);
        conds.push(`sr.claim_no = ANY($${params.length}::text[])`);
      }
      if (conds.length > 0) {
        const lr = await db.query(
          `SELECT c.id, sr.claim_no, c.status FROM cases c JOIN survey_reports sr ON sr.case_id = c.id
            WHERE c.id != $1 AND (${conds.join(' OR ')}) ORDER BY c.id DESC LIMIT 5`, params);
        linkedCases = lr.rows;
      }
    }

    /**
     * "ครั้งที่" ทั้งหมดของเลขเคลมนี้ — 1 เคลมมีได้หลายงาน (งานต่อเนื่อง)
     *
     * ⛔ แต่ละครั้งคือ **คนละเคส** ในระบบเรา (คนละแถว cases/survey_reports/survey_pay)
     *    ไม่ใช่หลายรอบในเคสเดียว — เลขเรื่องเซอร์เวย์ห้ามซ้ำจึงต่างกันทุกครั้ง
     *    ดังนั้นการ "เปลี่ยนครั้งที่" = เปลี่ยนไปดูอีกเคส ไม่ใช่สลับข้อมูลในหน้าเดิม
     */
    let visits: unknown[] = [];
    if (report?.claim_no) {
      /**
       * ⛔ ไล่ชื่อคอลัมน์เอง ห้าม SELECT * จาก survey_expenses —
       *    phone_fee / bail_fee มีอยู่ทั้ง 2 ตาราง (ฝั่งเรียกเก็บประกัน vs ฝั่งจ่ายพนักงาน)
       *    ถ้าดึงรวมกันแบบ * ตัวหลังจะทับตัวแรกเงียบ ๆ แล้วยอด 2 ฝั่งกลายเป็นตัวเดียวกัน
       *    (มีการ์ดเทสห้ามไว้ที่ xmlExport.contract.test.ts ด้วยเหตุผลเดียวกัน)
       */
      visits = (await db.query(
        `SELECT c.id, c.status, sr.survey_job_no,
                to_char(c.created_at, 'YYYY-MM-DD') AS created_on,
                ROW_NUMBER() OVER (ORDER BY c.created_at) AS visit_no,
                sr.survey_result, sr.review_comment, sr.surveyor_comment,
                se.service_fee_count, se.service_fee_price,
                se.travel_fee_count, se.travel_fee_price,
                se.photo_fee_count, se.photo_fee_price,
                se.phone_fee, se.bail_fee,
                se.claim_fee_percent, se.claim_fee_price,
                se.daily_record_fee, se.other_fee_detail, se.other_fee_price,
                sp.service_fee AS pay_service_fee, sp.travel_fee AS pay_travel_fee,
                sp.photo_fee AS pay_photo_fee, sp.phone_fee AS pay_phone_fee,
                sp.bail_fee AS pay_bail_fee, sp.claim_fee AS pay_claim_fee,
                sp.daily_fee AS pay_daily_fee, sp.other_fee AS pay_other_fee,
                sp.deduct_fee AS pay_deduct_fee, sp.deduct_late, sp.deduct_docs,
                sp.deduct_reason, sp.out_of_area, sp.out_of_hours,
                sp.out_of_area_amt, sp.out_of_hours_amt,
                sp.special_tumbon, sp.daily_check, sp.total AS pay_total
           FROM cases c
           JOIN survey_reports sr ON sr.case_id = c.id
           LEFT JOIN survey_expenses se ON se.report_id = sr.id
           LEFT JOIN survey_pay sp ON sp.case_id = c.id
          WHERE sr.claim_no = $1 ORDER BY c.created_at`, [report.claim_no])).rows;
    }

    /**
     * ใครบันทึกเคสนี้ล่าสุด — หน้าเว็บเอาไปขึ้นแถบ "คนอื่นกำลังแก้อยู่" เมื่อไม่ใช่ตัวเอง
     * (report.rev / report.updated_at ติดมากับ SELECT * อยู่แล้ว)
     */
    let updatedBy: string | null = null;
    if (report?.updated_by) {
      const ub = await db.query(
        `SELECT (first_name || ' ' || COALESCE(last_name, '')) AS name FROM users WHERE id = $1`,
        [report.updated_by],
      );
      updatedBy = String(ub.rows[0]?.name ?? '').trim() || null;
    }

    return {
      case: caseResult.rows[0],
      report,
      report_updated_by: updatedBy,
      photos,
      review: reviewResult.rows[0] || null,
      case_images: caseImagesResult.rows,
      visit_count: visitCount,
      visits,
      expenses,
      linked_cases: linkedCases,
      /**
       * ค่ารูปตามกติกาเหมา — ให้หน้าตรวจเติมให้อัตโนมัติ (หัวหน้าแก้ทับได้)
       *
       * ⛔ **ไม่เสนอกับงานที่นำเข้าจากไฟล์ ISURVEY** (`isurvey_xml`) — งานพวกนั้นหัวหน้า
       *    กรอกยอดจบที่ ISURVEY แล้ว ยอดติดมากับไฟล์ การเติมทับ = เขียนทับของจริง
       * null = ตัดสินไม่ได้ (ยังไม่รู้จังหวัดออกสำรวจ) → ปล่อยให้คนกรอกเอง ห้ามเดา
       */
      photo_fee_suggest:
        report && caseResult.rows[0]?.source !== 'isurvey_xml'
          ? standardPhotoFee(report)
          : null,
      // ชื่อคนที่มีอักขระซึ่ง EMCS จะล้างค่าทั้งช่องทิ้ง — เตือนคนตรวจก่อนส่งเข้า EMCS
      emcs_name_warnings: report ? emcsNameWarnings(report) : [],
      /**
       * ตำบลที่มีเรทของตัวเอง — หน้าตรวจเอาไปทำตัวเลือก "ตำบล" ใต้เขต/อำเภอ
       * ⛔ มาจากตารางเรทเสมอ ไม่ใช่รายชื่อที่เขียนไว้ในหน้าเว็บ (เพิ่มเรทแล้วต้องโผล่เอง)
       */
      tumbon_options: await tumbonOptions(),
    };
  },

  // สร้าง INSERT_SURV_REPORT_XML (สัญญาข้อมูลพอร์ทัลประกัน) จาก survey_report ของเคส
  async getSurveyXml(caseId: number, user?: CaseUser): Promise<string> {
    const caseResult = await db.query('SELECT id, assigned_to FROM cases WHERE id = $1', [caseId]);
    if (caseResult.rows.length === 0) throw new NotFoundError('Case not found');
    assertCaseAccess(caseResult.rows[0], user);
    const reportResult = await db.query('SELECT * FROM survey_reports WHERE case_id = $1', [caseId]);
    if (reportResult.rows.length === 0) throw new NotFoundError('ยังไม่มีข้อมูลรายงานสำรวจของเคสนี้');
    const row = await withInsurerBill(caseId, reportResult.rows[0]);
    // เตือนซ้ำในล็อกฝั่งเซิร์ฟเวอร์ด้วย เพราะบอทดึง XML ผ่านทางนี้ ไม่ได้เห็นแบนเนอร์บนเว็บ
    for (const w of emcsNameWarnings(row)) {
      console.warn(`[EMCS] เคส ${caseId}: ${w.label} มีอักขระ ${w.bad} ที่ EMCS จะล้างค่าทิ้ง — ${w.value}`);
    }
    return generateSurveyXml(row);
  },

  /**
   * แตก zip รูปของ ISURVEY/EMCS ("ดาวน์โหลดรูปภาพ") ลงโฟลเดอร์เคส + ลง survey_photos
   * โครงสร้างใน zip: PICTURES/<หมวด>/... — หมวดตรงกับที่ se-autokey ใช้ (autokey/images.py)
   * เก็บลง path เดียวกับรูปจากมือถือ (uploads/case_<id>/job_<id>/) บอทจึงดึงผ่าน API เดิมได้
   */
  /**
   * ผู้ตรวจสอบเพิ่มรูปเองจากหน้าเคส — **เพิ่มอย่างเดียว ไม่ลบของเดิม**
   *
   * ทำไมไม่ใช้ `uploadCaseFolder` ซ้ำ: ตัวนั้นเป็น "ล้างแล้วเขียนใหม่" ตามโมเดล sync
   * ของแอปมือถือ (client ส่งชุดไฟล์ปัจจุบันมาทั้งชุด) — เอามาใช้กับปุ่มบนเว็บที่ส่งมา
   * ทีละ 2-3 ใบ = รูปทั้งเคสหายเกลี้ยงเหลือเฉพาะที่เพิ่งเลือก
   *
   * เกิดจากงานเส้น ISURVEY: ต้นทางทยอยอัปรูป และบางรูปหัวหน้าได้มาทางอื่น (LINE/อีเมล)
   * ซึ่งไม่มีวันไปโผล่ที่ระบบต้นทาง
   */
  async addCasePhotos(caseId: number, files: Express.Multer.File[], category: string) {
    const fs = await import('fs');
    const pathMod = await import('path');
    await assertNotApproved(caseId);            // อนุมัติแล้ว = ชุดรูปถูกรับรองไปแล้ว ห้ามเติม
    const rid = await db.query('SELECT id FROM survey_reports WHERE case_id = $1', [caseId]);
    if (rid.rows.length === 0) throw new NotFoundError('Report not found');
    const reportId = rid.rows[0].id;

    const dir = pathMod.default.resolve(env.UPLOAD_DIR, `case_${caseId}`, `job_${caseId}`);
    fs.default.mkdirSync(dir, { recursive: true });

    let added = 0;
    const ids: number[] = [];   // id ของรูปที่เพิ่ม — หน้าเว็บจำรูป "รายการตรวจสอบ" ไว้แทนที่ตอนอนุมัติซ้ำ (08/09/69)
    for (const f of files || []) {
      // ชื่อไฟล์ตั้งเองทั้งหมด — ห้ามเชื่อ originalname (path traversal + ชนกับรูปที่มีอยู่)
      const ext = (pathMod.default.extname(f.originalname || '').toLowerCase()
                   .replace(/[^.a-z0-9]/g, '')) || '.jpg';
      const name = `web_${Date.now()}_${added}${ext}`;
      fs.default.writeFileSync(pathMod.default.join(dir, name), f.buffer);
      const ins = await db.query(
        'INSERT INTO survey_photos (report_id, file_path, category) VALUES ($1, $2, $3) RETURNING id',
        [reportId, `case_${caseId}/job_${caseId}/${name}`, category]);
      ids.push(Number(ins.rows[0].id));
      added++;
    }
    return { added, category, ids };
  },

  /**
   * ผู้ตรวจสอบลบรูปออกจากเคส — ลบทั้งแถวใน DB และไฟล์บนดิสก์
   *
   * ลบได้ทุกรูปของเคส (ไม่ใช่เฉพาะที่อัปจากเว็บ) เพราะคนที่รับผิดชอบว่า "อะไรจะถูกส่ง
   * เข้าระบบประกัน" คือผู้ตรวจสอบ — รูปเบลอ/รูปซ้ำ/รูปผิดเคส ต้องเอาออกได้
   * แต่ลบได้ **ก่อนอนุมัติ** เท่านั้น หลังอนุมัติชุดรูปถือว่าถูกรับรองไปแล้ว
   */
  async deleteCasePhoto(caseId: number, photoId: number) {
    const fs = await import('fs');
    const pathMod = await import('path');
    await assertNotApproved(caseId);
    // ผูก photo กับ case ใน query เดียว — กันลบรูปของเคสอื่นด้วยการเดา id
    const r = await db.query(
      `SELECT sp.id, sp.file_path FROM survey_photos sp
         JOIN survey_reports sr ON sp.report_id = sr.id
        WHERE sp.id = $1 AND sr.case_id = $2`, [photoId, caseId]);
    if (r.rows.length === 0) throw new NotFoundError('ไม่พบรูปนี้ในเคส');

    await db.query('DELETE FROM survey_photos WHERE id = $1', [photoId]);
    // ไฟล์ลบไม่ได้ก็ไม่ล้มทั้งงาน — แถวหายแล้วรูปก็ไม่โผล่ที่ไหนอีก (ไฟล์ค้างดีกว่าลบพลาด)
    try {
      const full = pathMod.default.resolve(env.UPLOAD_DIR, String(r.rows[0].file_path));
      const root = pathMod.default.resolve(env.UPLOAD_DIR);
      if (full.startsWith(root + pathMod.default.sep) && fs.default.existsSync(full)) {
        fs.default.unlinkSync(full);
      }
    } catch { /* ไฟล์หายอยู่แล้ว/ลบไม่ได้ — ข้าม */ }
    return { deleted: photoId };
  },

  /**
   * หมุนรูปแล้ว**เขียนทับไฟล์เดิม** — user สั่ง 04/09/69 "หมุนแล้วให้เป็นแบบนั้นเลย"
   *
   * เขียนทับไฟล์ (ไม่ใช่เก็บมุมไว้ใน DB) เพราะทุกทางที่ใช้รูปต่อ — หน้าเว็บ, บอทที่โหลดรูปไป
   * ขึ้น EMCS, XML สำรอง — จะได้รูปที่หมุนแล้วโดยไม่ต้องรู้เรื่องมุมเลย · ชื่อไฟล์เดิมทำให้
   * ตัวกันรูปซ้ำของบอท (ดูจากชื่อไฟล์) ไม่นับเป็นรูปใหม่ · กติกาล็อกเหมือนลบรูป: ก่อนอนุมัติเท่านั้น
   * · sharp: .rotate() ไม่มีอาร์กิวเมนต์ = จัดตาม EXIF ก่อน แล้วค่อยหมุนตามที่สั่ง ไม่งั้นรูปมือถือ
   *   ที่พึ่ง EXIF จะหมุนเพี้ยน · เขียนไฟล์ชั่วคราวแล้ว rename ทับ — ไม่มีจังหวะที่ไฟล์เขียนครึ่งเดียว
   */
  async rotateCasePhoto(caseId: number, photoId: number, deg: number) {
    const fs = await import('fs');
    const pathMod = await import('path');
    if (![90, -90, 180].includes(deg)) throw new AppError(400, 'หมุนได้เฉพาะ 90 / -90 / 180 องศา');
    await assertNotApproved(caseId);
    const r = await db.query(
      `SELECT sp.id, sp.file_path FROM survey_photos sp
         JOIN survey_reports sr ON sp.report_id = sr.id
        WHERE sp.id = $1 AND sr.case_id = $2`, [photoId, caseId]);
    if (r.rows.length === 0) throw new NotFoundError('ไม่พบรูปนี้ในเคส');
    const full = pathMod.default.resolve(env.UPLOAD_DIR, String(r.rows[0].file_path));
    const root = pathMod.default.resolve(env.UPLOAD_DIR);
    if (!full.startsWith(root + pathMod.default.sep) || !fs.default.existsSync(full)) {
      throw new NotFoundError('ไม่พบไฟล์รูปบนเซิร์ฟเวอร์');
    }
    const sharp = (await import('sharp')).default;
    const input = fs.default.readFileSync(full);
    const meta = await sharp(input).metadata();
    // ⛔ sharp หมุนได้ครั้งเดียวต่อ pipeline — `.rotate().rotate(deg)` จะทิ้งอันหนึ่งเงียบ ๆ (พิสูจน์แล้ว 04/09/69)
    //    จึงจัดตาม EXIF ให้เสร็จเป็นรูปจริงก่อน (pass 1) แล้วค่อยหมุนตามที่สั่ง (pass 2)
    const oriented = await sharp(input).rotate().toBuffer();
    let pipe = sharp(oriented).rotate(deg).withMetadata();
    // คงชนิดไฟล์เดิม · JPEG บีบใหม่ที่คุณภาพสูง — ค่าเริ่มต้นของ sharp (80) จะทำรูปหลักฐานหยาบลงทุกครั้งที่หมุน
    if (meta.format === 'jpeg') pipe = pipe.jpeg({ quality: 92 });
    else if (meta.format === 'png') pipe = pipe.png();
    else if (meta.format === 'webp') pipe = pipe.webp({ quality: 92 });
    else throw new AppError(400, `หมุนไฟล์ชนิด ${meta.format ?? 'ไม่ทราบ'} ไม่ได้`);
    const out = await pipe.toBuffer();
    const tmp = `${full}.rotating`;
    fs.default.writeFileSync(tmp, out);
    fs.default.renameSync(tmp, full);
    const after = await sharp(out).metadata();
    return { rotated: photoId, deg, width: after.width, height: after.height };
  },

  /**
   * แตก zip รูปเข้าเคส
   *
   * `skipExisting` — สำหรับ **ดึงรูปซ้ำจากต้นทางเดิม** (ISURVEY ทยอยอัปรูปหลังช่างส่งงาน:
   * ตอนสถานะ "รอตรวจข้อมูล" มักมี 1–5 รูป พอ "จบงาน" กลายเป็น 20–40 — วัดจริง 16/08/69)
   * โหมดปกติเจอชื่อซ้ำจะเปลี่ยนเป็น `_2` ซึ่งถูกสำหรับ zip ที่คนอัปเอง (ชื่อชนข้ามหมวดได้)
   * แต่ผิดสำหรับการดึงซ้ำ — จะได้รูปเดิมซ้ำทุกรอบ · โหมดนี้ข้ามชื่อที่มีอยู่แล้วไปเลย
   */
  async importPhotoZip(caseId: number, zipBuffer: Buffer, opts: { skipExisting?: boolean } = {}) {
    const AdmZip = (await import('adm-zip')).default;
    const fs = await import('fs');
    const pathMod = await import('path');
    const rid = await db.query('SELECT id FROM survey_reports WHERE case_id = $1', [caseId]);
    if (rid.rows.length === 0) throw new NotFoundError('Report not found');
    const reportId = rid.rows[0].id;

    // ชื่อไฟล์ที่เคสนี้มีอยู่แล้ว — ใช้เฉพาะโหมดดึงซ้ำ (อ่านจาก DB ไม่ใช่ดิสก์
    // เพราะไฟล์ที่ไม่มีแถวใน survey_photos จะไม่มีใครเห็นอยู่แล้ว ถือว่ายังไม่มี)
    const existing = new Set<string>();
    if (opts.skipExisting) {
      const cur = await db.query(
        'SELECT file_path FROM survey_photos WHERE report_id = $1', [reportId]);
      for (const r of cur.rows) existing.add(String(r.file_path).split('/').pop() ?? '');
    }
    let skipped = 0;

    // หมวดใน zip → ป้ายประเภทรูปของ EMCS (ชุดเดียวกับ autokey/images.py ZIP_CAT_TO_EMCS)
    const CAT: Record<string, string> = {
      INS: 'รูปรถประกัน', ACC_MAP: 'รูปแผนที่เกิดเหตุ',
      OTHERS: 'รูปประกอบ', REPORTS: 'รูปประกอบ',
      TP_VEH: 'รูปรถคู่กรณี', TP_PERSON: 'รูปผู้บาดเจ็บ', TP_PROP: 'รูปทรัพย์สิน',
    };
    const IMG = /\.(jpe?g|png|webp|gif|bmp)$/i;
    const dir = pathMod.default.resolve(env.UPLOAD_DIR, `case_${caseId}`, `job_${caseId}`);
    fs.default.mkdirSync(dir, { recursive: true });

    let added = 0;
    const perCat: Record<string, number> = {};
    for (const e of new AdmZip(zipBuffer).getEntries()) {
      if (e.isDirectory) continue;
      const parts = e.entryName.split('/');
      const base = parts[parts.length - 1];
      if (!base || !IMG.test(base)) continue;             // ข้าม PDF/ไฟล์อื่น
      if (opts.skipExisting && existing.has(base)) { skipped++; continue; }
      const cat = CAT[(parts[1] || '').toUpperCase()] ?? 'รูปประกอบ';
      // กันชื่อชนกันข้ามหมวด (zip ของพอร์ทัลตั้งชื่อซ้ำได้) — ไม่ทับไฟล์เดิม
      let name = base;
      for (let i = 2; fs.default.existsSync(pathMod.default.join(dir, name)); i++) {
        const dot = base.lastIndexOf('.');
        name = `${base.slice(0, dot)}_${i}${base.slice(dot)}`;
      }
      fs.default.writeFileSync(pathMod.default.join(dir, name), e.getData());
      await db.query(
        'INSERT INTO survey_photos (report_id, file_path, category) VALUES ($1, $2, $3)',
        [reportId, `case_${caseId}/job_${caseId}/${name}`, cat]);
      added++;
      perCat[cat] = (perCat[cat] ?? 0) + 1;
    }
    return { added, perCat, skipped };
  },

  /**
   * สร้างเคสจากไฟล์ XML ของ ISURVEY (flow ระบบเก่าที่กำลังเลิกใช้)
   *
   * ต่างจาก create(): รับได้ทุกคอลัมน์รวม JSONB (คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน)
   * และตั้ง status='surveyed' ทันที เพราะงานสำรวจ "ทำเสร็จบน ISURVEY แล้ว" —
   * เว็บนี้เป็นแค่จุดตรวจก่อนส่งบอทเข้า EMCS (ผู้ตรวจกด "ปิดงาน" → review → 'reviewed')
   *
   * กันอัปไฟล์เดิมซ้ำด้วย assertSurveyJobNoUnique (เลขเซอร์เวย์ห้ามซ้ำอยู่แล้ว → 409)
   */
  // ใช้ type กลางจาก xmlImport.service — เดิมประกาศโครงซ้ำไว้ตรงนี้แบบ inline
  // พอฝั่งโน้นเพิ่มฟิลด์ (source/warnings) ตรงนี้ไม่รู้เรื่อง แล้วหลุดเงียบ
  async importFromXml(
    parsed: XmlImportResult,
    opts: { insuranceCompany: string; createdBy: number },
  ) {
    const report: Record<string, unknown> = { ...parsed.report, insurance_company: opts.insuranceCompany };
    // เพศผู้ขับขี่: มือถือ/เว็บเก็บ 'M'/'F' — XML ให้ 'W' (รหัสหญิงอีกแบบ) และเส้นดึงสดเคยส่ง 'หญิง'
    // → radio หน้าตรวจไม่ติ๊กทั้งที่ข้อมูลมี หัวหน้าเห็น "ยังขาด 1 ช่อง" แต่หาไม่เจอ (เคส #221, 03/09/69)
    if (report.driver_gender !== undefined) report.driver_gender = driverGenderMF(report.driver_gender);
    await assertSurveyJobNoUnique([report.survey_job_no]);

    // ผู้สำรวจ: จับจากรหัสใน ACC_SURV ('SE272 นาย ...') — หาไม่เจอก็ปล่อยว่าง ไม่ล้มทั้งงาน
    let assignedTo: number | null = null;
    if (parsed.surveyorCode) {
      const u = await db.query('SELECT id, phone FROM users WHERE UPPER(code) = $1 LIMIT 1',
        [parsed.surveyorCode.toUpperCase()]);
      if (u.rows.length > 0) {
        assignedTo = u.rows[0].id;
        // เบอร์ผู้สำรวจภัยเป็นช่องบังคับของ EMCS แต่ไฟล์ ISURVEY ไม่มี tag นี้เลย
        // เรารู้ว่าเป็นใครแล้ว (จับจากรหัส) จึงหยิบเบอร์จากทะเบียนพนักงานมาเติมให้
        // ⚠️ ทะเบียนพนักงานยังไม่มีเบอร์เกือบทั้งหมด — ตราบใดที่ยังว่าง บรรทัดนี้ก็ไม่ได้ช่วยอะไร
        if (!String(report.acc_surveyor_phone ?? '').trim() && u.rows[0].phone) {
          report.acc_surveyor_phone = String(u.rows[0].phone).trim();
        }
      }
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const c = await client.query(
        // ที่มาต้องมาจากไฟล์ ห้าม hardcode — ไฟล์ที่สกัดกลับจากหน้าเว็บ EMCS
        // (source='emcs_extract') เป็นข้อมูลทดสอบ กติกาต่างกับงานจริงจากระบบเก่า
        // โดยเฉพาะเรื่องยอดเงิน: withInsurerBill ส่งบิลต่อเข้า EMCS เฉพาะ source ที่อยู่ใน
        // BILLABLE_SOURCES (isurvey_xml + mobile + isurvey_live) — 'emcs_extract' ยังถูกกันไว้
        // เคสทดสอบจึงไม่ดันยอดเงินของประกันเองกลับเข้าระบบประกันโดยไม่ตั้งใจ
        `INSERT INTO cases (customer_name, incident_location, created_by, assigned_to, status, source,
                            import_warnings, submitted_at)
         VALUES ($1, $2, $3, $4, 'surveyed', $5, $6, $7) RETURNING *`,
        [parsed.caseFields.customer_name || '(ไม่ระบุชื่อผู้เอาประกัน)',
         parsed.caseFields.incident_location || '(ไม่ระบุสถานที่)',
         opts.createdBy, assignedTo, parsed.source,
         // เก็บคำเตือนไว้กับเคส — เดิมส่งกลับให้หน้าจอที่กดนำเข้าครั้งเดียวแล้วหายไป
         // คนที่มาเปิดรายการงานทีหลังจึงไม่รู้เลยว่าเคสไหนข้อมูลไม่ครบ
         parsed.warnings?.length ? JSON.stringify(parsed.warnings) : null,
         // "ส่งงาน" ของงานจาก ISURVEY = เวลาที่ช่างส่งรายงานบนระบบเดิม (จังหวะ 6 ของเส้นเวลา, 10/09/69) · ไฟล์ XML ไม่มี = null
         parsed.caseFields.submitted_at ?? null]);
      const caseId = c.rows[0].id;

      // เขียนเฉพาะคอลัมน์ที่มีจริง (ใช้ allowlist ชุดเดียวกับ updateReport) — กัน SQL พัง
      // เมื่อ mapper ผลิตคีย์ที่ยังไม่มีคอลัมน์รองรับ
      const cols = await client.query(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_name = 'survey_reports'`);
      const valid = new Set<string>(cols.rows.map((r: { column_name: string }) => r.column_name));
      // คอลัมน์ของระบบกันบันทึกทับ — ให้ trigger ดูแลเอง ห้ามให้ข้อมูลนำเข้าเขียนทับ
      for (const sys of ['rev', 'updated_at', 'updated_by']) valid.delete(sys);
      // คอลัมน์ตัวเลข/วันที่/บูลีน รับสตริงว่างไม่ได้ (Postgres: invalid input syntax for type numeric)
      // XML ให้ค่าว่างมาเยอะ (OPO_PAY, COST_DAMAGE ฯลฯ) → บังคับเป็น NULL
      const nonText = new Set<string>(
        cols.rows
          .filter((r: { data_type: string }) => !/char|text|json/.test(r.data_type))
          .map((r: { column_name: string }) => r.column_name));
      const fields = Object.keys(report).filter((f) => valid.has(f) && report[f] !== undefined);
      const values = fields.map((f) => {
        const v = bindVal(f, report[f]);
        return nonText.has(f) && (v === '' || v === undefined) ? null : v;
      });
      await client.query(
        `INSERT INTO survey_reports (case_id${fields.length ? ', ' + fields.join(', ') : ''})
         VALUES ($1${fields.map((_, i) => `, $${i + 2}`).join('')})`,
        [caseId, ...values]);

      // ยอดเงินที่ติดมากับไฟล์ (ฝั่งเรียกเก็บประกัน) — เขียนให้ทุกไฟล์ที่ import
      // แต่จะถูกส่งต่อเข้า EMCS หรือไม่ ตัดสินที่ withInsurerBill ตอน gen XML:
      // isurvey_xml / isurvey_live = ส่งต่อ · emcs_extract = ไม่ส่ง (เลขของประกันเอง ข้อมูลทดสอบ)
      if (parsed.expenses) {
        const rid = await client.query('SELECT id FROM survey_reports WHERE case_id = $1', [caseId]);
        const exp = parsed.expenses;
        const ef = Object.keys(exp);
        await client.query(
          `INSERT INTO survey_expenses (report_id, ${ef.join(', ')})
           VALUES ($1${ef.map((_, i) => `, $${i + 2}`).join('')})`,
          [rid.rows[0].id, ...ef.map((k) => exp[k])]);
      }

      await client.query('COMMIT');
      notifyCaseChanged(caseId, 'imported', null);
      return { caseId, assignedTo, surveyorCode: parsed.surveyorCode };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  },

  /**
   * แอดมินแก้ "ตัวระบุตัวเคส" — บริษัทประกัน/สาขา/เลขเซอร์เวย์/เลขรับแจ้ง/เลขเคลม
   *
   * 5 ช่องนี้ถูกล็อกไม่ให้แก้จากหน้าตรวจ (user เคาะ 18/08/69) เพราะแก้ผิดแล้วเคสไปผูก
   * กับงานผิดใบ — แต่ถ้าเลขผิดมาตั้งแต่ต้นทางก็ต้องมีทางแก้ จึงเปิดทางนี้ให้แอดมินเท่านั้น
   *
   * ⛔ ต้องปลดล็อกก่อนถ้าเคสอนุมัติแล้ว — ใช้ประตูเดียวกับการแก้ข้อมูลอื่น
   *    (อนุมัติแล้วบอทหยิบไปเข้า EMCS แล้ว แก้เลขที่นี่ไม่ตามไปแก้ให้ที่นั่น)
   */
  async updateCaseIdentity(caseId: number, data: Record<string, unknown>) {
    await assertNotApproved(caseId);

    const r = await db.query('SELECT id FROM survey_reports WHERE case_id = $1', [caseId]);
    if (r.rows.length === 0) throw new NotFoundError('Report not found');

    // เลขเซอร์เวย์ห้ามซ้ำข้ามเคส (เลขอ้างอิงเบิกเงิน) — เลขเคลมซ้ำได้โดยตั้งใจ
    if (data.survey_job_no !== undefined) {
      await assertSurveyJobNoUnique([data.survey_job_no], caseId);
    }

    const ALLOWED = ['insurance_company', 'insurance_branch', 'survey_job_no', 'claim_ref_no', 'claim_no'];
    const sets: string[] = [];
    const vals: unknown[] = [];
    for (const k of ALLOWED) {
      if (data[k] === undefined) continue;
      sets.push(`${k} = $${sets.length + 1}`);
      vals.push(String(data[k] ?? '').trim() || null);
    }
    if (sets.length === 0) throw new AppError(400, 'ไม่มีช่องที่จะแก้');

    vals.push(caseId);
    const out = await db.query(
      `UPDATE survey_reports SET ${sets.join(', ')} WHERE case_id = $${vals.length} RETURNING *`, vals);
    return out.rows[0];
  },

  /**
   * ตีกลับให้ผู้สำรวจไปแก้เอง — สถานะกลับเป็น 'assigned' (กำลังสำรวจ)
   *
   * ใช้กับเรื่องที่หัวหน้าแก้บนเว็บแทนไม่ได้ เพราะต้องถามคนที่ไปหน้างานจริง
   * (ทะเบียนไม่ตรงกับรูป · รูปไม่ครบ · เวลาที่จดมาผิด) — งานจะโผล่ในรายการของช่างอีกครั้ง
   * แก้ในแอปแล้วกดส่งใหม่ได้ตามปกติ · **หัวหน้ายังแก้เองได้ด้วย** (กติกา user 18/08/69)
   *
   * ไม่มีการแจ้งเตือนเข้าเครื่อง — ตกลงกันแล้วว่าแค่ให้เห็นในรายการงานพอ
   *
   * ⛔ ต้องมีผู้สำรวจอยู่จริงถึงจะตีกลับได้ — งานที่นำเข้าจากระบบเก่า/XML ไม่มีคนรับผิดชอบ
   *    ในระบบเรา ตีกลับไปแล้วจะไม่โผล่ในรายการของใครเลย = เคสหายเงียบ
   * ⛔ เหตุผลบังคับกรอก — ตีกลับโดยไม่บอกว่าให้แก้อะไร ช่างก็ส่งของเดิมกลับมา
   */
  async sendBackToSurveyor(caseId: number, checkerId: number, reason: string) {
    const text = String(reason ?? '').trim();
    if (!text) throw new AppError(400, 'ต้องบอกเหตุผลที่ตีกลับ — ช่างต้องรู้ว่าให้แก้อะไร');

    const c = await db.query('SELECT status, assigned_to FROM cases WHERE id = $1', [caseId]);
    if (c.rows.length === 0) throw new NotFoundError('Case not found');
    const { status, assigned_to } = c.rows[0];

    if (status === 'reviewed') {
      throw new ForbiddenError('เคสนี้อนุมัติแล้ว — ต้องให้แอดมินปลดล็อกก่อนจึงจะตีกลับได้');
    }
    if (status === 'assigned' || status === 'finished') throw new ForbiddenError('เคสนี้อยู่กับผู้สำรวจอยู่แล้ว');
    if (status !== 'surveyed') throw new ForbiddenError('ตีกลับได้เฉพาะงานที่ส่งเข้ามาให้ตรวจแล้ว');
    if (!assigned_to) {
      throw new ForbiddenError(
        'เคสนี้ไม่มีผู้สำรวจในระบบ (งานนำเข้าจากระบบเก่า) — ตีกลับแล้วจะไม่โผล่ในรายการของใคร');
    }

    const out = await db.query(
      `UPDATE cases
          SET status = 'assigned',
              sent_back_at = NOW(),
              sent_back_by = $2,
              sent_back_reason = $3,
              sent_back_count = sent_back_count + 1
        WHERE id = $1 AND status = 'surveyed'
        RETURNING id, status, sent_back_at, sent_back_reason, sent_back_count`,
      [caseId, checkerId, text]
    );
    // 0 แถว = สถานะเปลี่ยนไประหว่างทาง (อนุมัติ/ส่งซ้ำพร้อมกัน) — ห้ามตอบว่าสำเร็จ
    if (out.rowCount === 0) throw new ForbiddenError('สถานะเคสเพิ่งเปลี่ยนไป — โหลดหน้าใหม่แล้วลองอีกครั้ง');
    notifyCaseChanged(caseId, 'sent_back', checkerId);
    return out.rows[0];
  },

  /**
   * ผู้ตรวจบันทึกเคสจากหน้าเว็บ
   *
   * `baseRev` = เลขรุ่นที่หน้าเว็บจำไว้ตอนเปิดเคส — ไม่ตรงกับของจริง = มีคนบันทึกคั่น
   * แล้วต้องไม่เขียนอะไรเลย (ดู reportRev.ts) · `userId` เก็บไว้บอกว่าใครบันทึกล่าสุด
   */
  async updateReport(
    caseId: number,
    data: Record<string, unknown>,
    opts: { userId?: number; baseRev?: unknown } = {},
  ) {
    // ⛔ อนุมัติแล้ว = ล็อก — แก้ต่อไม่ได้จนกว่าแอดมินจะปลดล็อก (POST /api/cases/:id/unlock)
    // ถ้าปล่อยให้แก้หลังอนุมัติ ลายเซ็นผู้อนุมัติจะไม่ได้รับรองข้อมูลชุดที่บอทหยิบไปจริง
    await assertNotApproved(caseId);

    const reportResult = await db.query('SELECT id FROM survey_reports WHERE case_id = $1', [caseId]);
    if (reportResult.rows.length === 0) throw new NotFoundError('Report not found');
    const reportId = reportResult.rows[0].id;

    const rd = (data.report_data || data) as Record<string, string>;

    // เส้นทางผู้ตรวจแก้บนเว็บ — เดิมไม่เคยตรวจเลขซ้ำเลย ทั้งที่แก้เลขเซอร์เวย์ได้
    // (ตรวจก่อนเข้า transaction; DB มี unique index กันชั้นสุดท้ายอีกที — migration 030)
    if (rd.survey_job_no !== undefined || rd.survey_job_no_2 !== undefined) {
      await assertSurveyJobNoUnique([rd.survey_job_no, rd.survey_job_no_2], caseId);
    }

    // === 1. Combine time fields ===
    const g = (k: string) => rd[k] || '';
    /**
     * ⛔ เติมศูนย์หน้าเสมอ — ช่อง ชม./นาที บนเว็บเป็น input ข้อความเปล่า พิมพ์ "5" ได้
     *    ได้เวลา "16:5" ซึ่งตัวอ่านตอนสร้าง XML ต้องการนาที 2 หลักเป๊ะ → อ่านไม่ผ่าน
     *    แล้ว **ทิ้งทั้งชั่วโมงและนาทีเป็น 00:00** ส่งเข้าระบบประกันเป็นเที่ยงคืน
     *    ตัวตรวจลำดับเวลาบนหน้าเว็บอ่าน "5" เป็นนาที 5 จึงไม่ฟ้อง = อนุมัติผ่านไปเงียบ ๆ
     *    (แอปมือถือเติมศูนย์ให้อยู่แล้ว เว็บเป็นทางเดียวที่ผลิตค่าเพี้ยน)
     */
    const pad2 = (v: string) => (v === '' ? '' : String(v).trim().padStart(2, '0'));
    // acc_time = hour:minute
    if (g('acc_time_hour') || g('acc_time_minute')) {
      rd.acc_time = `${pad2(g('acc_time_hour'))}:${pad2(g('acc_time_minute'))}`;
    }
    // Date|HH:MM fields
    const dateTimeFields = [
      { dateKey: 'acc_customer_report_date_val', hourKey: 'acc_customer_report_hour', minKey: 'acc_customer_report_minute', dbCol: 'acc_customer_report_date' },
      { dateKey: 'acc_insurance_notify_date_val', hourKey: 'acc_insurance_notify_hour', minKey: 'acc_insurance_notify_minute', dbCol: 'acc_insurance_notify_date' },
      { dateKey: 'acc_survey_arrive_date_val', hourKey: 'acc_survey_arrive_hour', minKey: 'acc_survey_arrive_minute', dbCol: 'acc_survey_arrive_date' },
      { dateKey: 'acc_survey_complete_date_val', hourKey: 'acc_survey_complete_hour', minKey: 'acc_survey_complete_minute', dbCol: 'acc_survey_complete_date' },
    ];
    for (const f of dateTimeFields) {
      const d = g(f.dateKey), h = pad2(g(f.hourKey)), m = pad2(g(f.minKey));
      /**
       * ⛔ ต้องมี else ล้างคอลัมน์ด้วย — ชื่อช่องบนฟอร์มคือ `*_date_val` ซึ่งไม่ใช่ชื่อคอลัมน์
       *    ถ้าไม่เขียนตรงนี้ คอลัมน์จริงจะไม่ถูกแตะเลย → ลบวันที่ทิ้งแล้วกดบันทึก API ตอบ
       *    "สำเร็จ" แต่ค่าเก่ายังอยู่และไหลเข้าระบบประกันต่อ (ต่างจาก acc_police_date
       *    ที่ส่งชื่อคอลัมน์ตรง ๆ จึงลบได้ — พฤติกรรมสวนทางกันเองบนหน้าเดียวกัน)
       */
      if (f.dateKey in rd) rd[f.dbCol] = d ? (h || m ? `${d}|${h}:${m}` : d) : '';
    }
    // Police date + time
    if (g('acc_police_date') || g('acc_police_hour')) {
      const pd = g('acc_police_date'), ph = g('acc_police_hour'), pm = g('acc_police_minute');
      if (pd && (ph || pm)) rd.acc_police_date = `${pd}|${ph}:${pm}`;
    }
    // Followup date + time
    if (g('acc_followup_date') || g('acc_followup_hour')) {
      const fd = g('acc_followup_date'), fh = g('acc_followup_hour'), fm = g('acc_followup_minute');
      if (fd && (fh || fm)) rd.acc_followup_date = `${fd}|${fh}:${fm}`;
    }

    // === 2. Update survey_reports ===
    const colResult = await db.query(
      // rev/updated_at/updated_by = คอลัมน์ของระบบกันบันทึกทับ (migration 042)
      // ⛔ ห้ามให้ค่าจากฟอร์มเขียนทับได้ ไม่งั้นส่ง rev มาเองแล้วเดินข้ามด่านไปเลย
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'survey_reports' AND table_schema = 'public' AND column_name NOT IN ('id', 'case_id', 'created_at', 'rev', 'updated_at', 'updated_by')"
    );
    const validCols = new Set(colResult.rows.map((r: { column_name: string }) => r.column_name));

    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    for (const [key, val] of Object.entries(rd)) {
      if (validCols.has(key) && val !== undefined) {
        fields.push(`${key} = $${idx++}`);
        // กัน placeholder "-- ระบุ --" จากฟอร์มเว็บ inspector (select ที่ยังไม่เลือก ส่ง label มาเป็นค่า)
        const sv = stripSentinel(val);
        // JSONB คอลัมน์ต้อง stringify (และถือ '' เป็น null) กัน error type mismatch
        params.push(JSONB_FIELDS.has(key) ? (sv === '' ? null : bindVal(key, sv)) : (sv === '' ? null : sv));
      }
    }

    // === 3. Update survey_expenses ===
    const expenseFields = ['service_fee_count','service_fee_price','travel_fee_count','travel_fee_price','photo_fee_count','photo_fee_price','phone_fee','bail_fee','claim_fee_percent','claim_fee_price','daily_record_fee','other_fee_detail','other_fee_price'];
    // "ส่งช่องค่าใช้จ่ายมาไหม" ≠ "กรอกค่าอะไรมาไหม" — ต้องแยกกัน
    //   ไม่ส่งมาเลย (ทุกช่อง undefined)  = คนละฟอร์ม เช่นมือถือส่งงาน/หน้ารีวิว → **ห้ามแตะแถวเดิม**
    //   ส่งมาแต่ว่างหมด                  = ผู้ตรวจ**ล้างบิลทิ้ง** → ต้องลบแถวจริง
    // เดิมใช้เงื่อนไขเดียวคุมทั้ง DELETE และ INSERT → ล้างทุกช่องแล้ว "ไม่มีอะไรเกิดขึ้น"
    // แถวเก่ารอดมา และตั้งแต่เคส mobile ส่งบิลได้ (withInsurerBill) ยอดที่ผู้ตรวจคิดว่าลบไปแล้ว
    // จะไหลเข้า XML ต่อ — ล้างบิลเป็นท่าเดียวที่ UI มีให้ทำ จึงห้ามเป็นท่าที่ระบบเมิน
    const expenseSubmitted = expenseFields.some(f => rd[f] !== undefined);
    const hasExpense = expenseFields.some(f => rd[f] !== undefined && rd[f] !== '');

    // ห่อ UPDATE report + DELETE/INSERT expenses ไว้ใน transaction เดียว —
    // เดิมถ้า INSERT expense พัง (เช่นพิมพ์ '1,200' มี comma ลงคอลัมน์ numeric) DELETE จะ commit ไปแล้ว = ข้อมูลค่าบริการหายถาวร
    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      /**
       * ด่านกันบันทึกทับ — ต้องอยู่ **ใน** transaction และล็อกแถวไว้ (FOR UPDATE)
       * ถ้าเช็คนอก transaction สองคนที่กดพร้อมกันเป๊ะ ๆ จะอ่าน rev เดิมได้เท่ากันทั้งคู่
       * แล้วผ่านด่านไปทั้งคู่ = กันไม่ได้จริงในกรณีที่ควรกันที่สุด
       */
      await assertReportRev(caseId, opts.baseRev, { client, lock: true });

      /**
       * เขียน updated_by เสมอ แม้ไม่มีช่องไหนเปลี่ยน — เพื่อให้ trigger บวก rev ทุกครั้งที่
       * มีคนกดบันทึก · ถ้าข้ามตอน fields ว่าง (เช่นแก้แต่ตารางค่าใช้จ่าย) rev จะไม่เดิน
       * แล้วสองคนที่แก้เฉพาะค่าใช้จ่ายจะทับกันได้เหมือนเดิม
       */
      fields.push(`updated_by = $${idx++}`);
      params.push(opts.userId ?? null);

      let reportUpdated = 0;
      {
        params.push(reportId);
        await client.query(`UPDATE survey_reports SET ${fields.join(', ')} WHERE id = $${idx}`, params);
        reportUpdated = fields.length - 1;   // ไม่นับ updated_by ที่ระบบเติมให้เอง
      }

      /**
       * จำยอดเดิมไว้ก่อนลบ — ตารางนี้เขียนด้วยท่า "ลบทิ้งแล้วใส่ใหม่" ทุกครั้ง
       * ถ้าไม่จำไว้ก่อน จะแยกไม่ออกว่า "ผู้ตรวจแก้ 400 → 600" กับ "ลบทิ้งแล้วใส่ 600"
       */
      const expenseBefore = expenseSubmitted
        ? (await client.query('SELECT * FROM survey_expenses WHERE report_id = $1', [reportId])).rows[0] ?? null
        : null;
      const expenseAfter: Record<string, unknown> = {};

      if (expenseSubmitted) {
        // ล้างก่อนเสมอเมื่อฟอร์มค่าใช้จ่ายถูกส่งมา — ถ้าไม่มีค่าเหลือเลยก็จบแค่ลบ (= ล้างบิล)
        await client.query('DELETE FROM survey_expenses WHERE report_id = $1', [reportId]);
      }
      if (hasExpense) {
        const eCols: string[] = ['report_id'];
        const eVals: unknown[] = [reportId];
        for (const f of expenseFields) {
          if (rd[f] !== undefined) {
            eCols.push(f);
            // ตัด comma ออกจากคอลัมน์ตัวเลข (other_fee_detail เป็น text — เว้นไว้) กัน '1,200' ทำ INSERT พัง
            const raw = rd[f];
            const clean = raw === '' ? null : (f === 'other_fee_detail' ? raw : String(raw).replace(/,/g, ''));
            eVals.push(clean);
            expenseAfter[f] = clean;
          }
        }
        const ePlaceholders = eVals.map((_, i) => `$${i + 1}`).join(', ');
        await client.query(`INSERT INTO survey_expenses (${eCols.join(', ')}) VALUES (${ePlaceholders})`, eVals);
      }

      // ประวัติยอดเรียกเก็บประกัน — เขียนใน transaction เดียวกับยอด ไม่งั้นประวัติขาดเป็นช่วง ๆ
      if (expenseSubmitted) {
        await recordMoneyChanges(client, {
          caseId, kind: 'expense', userId: opts.userId ?? null,
          before: expenseBefore, after: expenseAfter,
        });
      }

      // rev ใหม่หลังบันทึก — หน้าเว็บต้องเก็บไว้ใช้กับการบันทึกครั้งถัดไป
      // ไม่ส่งกลับ = กดบันทึกสองครั้งติดจะเด้ง "มีคนบันทึกคั่น" ใส่ตัวเอง
      const after = await client.query('SELECT rev FROM survey_reports WHERE id = $1', [reportId]);

      await client.query('COMMIT');
      // ยอดเงิน/ช่องที่ยังขาด เปลี่ยนแล้ว → ป้ายในคิว ("ต้องเติมก่อนอนุมัติ") ต้องตามด้วย
      notifyCaseChanged(caseId, 'saved', opts.userId ?? null);
      return {
        message: 'Report updated', report_fields: reportUpdated, expense_saved: hasExpense,
        // ผู้ตรวจล้างบิลทิ้ง — แยกจาก "ไม่ได้ยุ่งกับบิล" เพื่อให้เห็นได้จากคำตอบของ API
        expense_cleared: expenseSubmitted && !hasExpense,
        rev: Number(after.rows[0]?.rev ?? 0),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  // จำนวนงานที่ "ถืออยู่" ของแต่ละพนักงานสำรวจ — ใช้ 2 ที่คนละนิยาม จึงคืนมาทั้งคู่
  //
  //   active   = assigned + finished + surveyed (ยังไม่ปิดเรื่อง) — บอร์ดเข้างานใช้ตัวนี้ ห้ามเปลี่ยนความหมาย
  //   assigned = **ยังไม่เสร็จหน้างาน** — หน้าจ่ายงานใช้ตัวนี้ตัดสินว่า "ว่าง" หรือไม่
  //   finished = เสร็จงานหน้างานแล้ว ยังไม่ส่งรายงาน (07/09/69) — **รับงานใหม่ได้** โชว์เป็นข้อมูล
  //   surveyed = ส่งงานแล้วรอหัวหน้าตรวจ — งานในมือที่ช่างทำจบแล้ว
  //
  // นิยาม "ว่าง" ที่ user เคาะไว้ 24/08/69 = **ยังไม่ได้รับมอบหมายงาน** ·
  // เคสที่ส่งงานแล้วรอตรวจ = แสดงเป็นข้อมูล **ไม่นับว่าไม่ว่าง** (ช่างรับงานใหม่ได้)
  // 07/09/69 เพิ่ม: กด "เสร็จงาน" แล้ว = ว่างเหมือนกัน (นี่คือเหตุผลหลักที่มีสถานะนี้)
  async activeWorkload() {
    const { rows } = await db.query(
      `SELECT u.id AS user_id, u.code,
              COUNT(c.id)::int                                          AS active,
              COUNT(c.id) FILTER (WHERE c.status = 'assigned')::int     AS assigned,
              COUNT(c.id) FILTER (WHERE c.status = 'finished')::int     AS finished,
              COUNT(c.id) FILTER (WHERE c.status = 'surveyed')::int     AS surveyed
         FROM users u
         LEFT JOIN cases c ON c.assigned_to = u.id AND c.status IN ('assigned','finished','surveyed')
        WHERE u.role = 'surveyor'
        GROUP BY u.id, u.code`
    );
    return rows;
  },

  async getStats() {
    const result = await db.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'assigned') AS assigned,
        COUNT(*) FILTER (WHERE status = 'finished') AS finished,
        COUNT(*) FILTER (WHERE status = 'surveyed') AS surveyed,
        COUNT(*) FILTER (WHERE status = 'reviewed') AS reviewed,
        COUNT(*) AS total
      FROM cases
    `);
    const recentResult = await db.query(
      // ⛔ "เคสล่าสุด" บนแดชบอร์ดใช้คิวรีตัวนี้ **คนละตัวกับ list()** — แก้ list อย่างเดียว
      //    หน้าแดชบอร์ดจะยังโชว์ "-" เหมือนเดิมโดยไม่มีอะไรฟ้อง (เจอจากการเปิดหน้าจริงดู)
      `SELECT c.*, u.first_name AS surveyor_first_name, u.last_name AS surveyor_last_name,
              d.first_name AS declined_first_name, d.last_name AS declined_last_name, d.code AS declined_code,
              sr.claim_no, sr.survey_job_no, sr.claim_ref_no,
              ROW_NUMBER() OVER (PARTITION BY sr.claim_no ORDER BY c.created_at) AS visit_count
       FROM cases c LEFT JOIN users u ON c.assigned_to = u.id
       LEFT JOIN users d ON c.declined_by = d.id
       LEFT JOIN survey_reports sr ON sr.case_id = c.id
       ORDER BY c.created_at DESC LIMIT 10`
    );
    return { counts: result.rows[0], recent: recentResult.rows };
  },

  // รายการเคสทั้งหมด (callcenter) — มี filter สถานะ + ค้นหา + แบ่งหน้า
  async list(filters: { status?: string; search?: string; page?: number; limit?: number } = {}) {
    const { status, search, page = 1, limit = 20 } = filters;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`c.status = $${idx++}`);
      params.push(status);
    }
    if (search) {
      conditions.push(`(c.customer_name ILIKE $${idx} OR c.incident_location ILIKE $${idx} OR sr.claim_no ILIKE $${idx} OR sr.survey_job_no ILIKE $${idx} OR sr.claim_ref_no ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      db.query(
        // ⛔ ต้อง join ชื่อคนที่ปฏิเสธแยกอีกครั้ง — declineCase ล้าง assigned_to ทิ้ง
        //    join เดิม (u) จึงว่างเสมอสำหรับงานที่ถูกปฏิเสธ ผู้จ่ายงานเห็นแค่สถานะลอย ๆ
        `SELECT c.*, u.first_name AS surveyor_first_name, u.last_name AS surveyor_last_name,
                d.first_name AS declined_first_name, d.last_name AS declined_last_name, d.code AS declined_code,
                sr.claim_no, sr.survey_job_no, sr.claim_ref_no,
                ROW_NUMBER() OVER (PARTITION BY sr.claim_no ORDER BY c.created_at) AS visit_count
         FROM cases c
         LEFT JOIN users u ON c.assigned_to = u.id
         LEFT JOIN users d ON c.declined_by = d.id
         LEFT JOIN survey_reports sr ON sr.case_id = c.id
         ${where}
         ORDER BY c.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total FROM cases c LEFT JOIN survey_reports sr ON sr.case_id = c.id ${where}`,
        params
      ),
    ]);

    return {
      cases: dataResult.rows,
      total: countResult.rows[0].total,
      page,
      limit,
      totalPages: Math.ceil(countResult.rows[0].total / limit),
    };
  },
};
