/**
 * การ์ดของ "เคลมเดียวหลายครั้ง — หน้าเคสแบบ EMCS" (user เคาะ 15/09/69 เคลม 2026013057520 ครั้งที่ 1–4)
 *
 * รายการงานแยกใบตามเลขเซอร์เวย์ (แบบ ISURVEY: 1 ครั้ง = 1 เคส อนุมัติ/ปิด ISURVEY/ส่ง se-billing/เข้า EMCS ทีละใบ)
 * แต่ข้อมูลหลักของเคลมมีชุดเดียวที่ครั้งที่ 1 (แบบ EMCS) → ครั้งที่ 2+ "รายงานที่มีผล" = ครั้งที่ 1 สด + ของครั้งนั้น
 * หน้าเคส/บอท/XML ใช้ชุดเดียวกัน · ไม่ก๊อปตอนดึงงานอีก (เคยทำเช้า 15/09 แล้วแก้ครั้งที่ 1 ทีหลังไม่ตาม)
 * + เคสอ้างอิง (ครั้งก่อนหน้าที่ปิดจบบน ISURVEY) แก้ข้อมูลตั้งต้นได้โดยไม่ต้องปลดล็อก · รูปของทุกครั้งเข้าเว็บ
 *
 * ครึ่งแรกเรียกฟังก์ชันจริง (ไม่แตะฐานข้อมูล) ครึ่งหลังตรวจการต่อสาย
 */
import * as fs from 'fs';
import * as path from 'path';
import { effectiveReport, mainLockedFields, VISIT_OWN_FIELDS, MAIN_FORM_PARTS } from '../src/services/visitInherit';

let failed = 0;
const check = (label: string, ok: boolean, note = '') => {
  if (!ok) failed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${note ? `  (${note})` : ''}`);
};
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

console.log('\n── รายงานที่มีผลของครั้งที่ 2+ (ข้อมูลหลักจากครั้งที่ 1) ──');

/** ครั้งที่ 1 (โครงจริงจากเคส #359) · ครั้งที่ 3 (จากเคส #378: มีแค่ของประจำครั้ง + ค่าตั้งต้นของตัวดึงงาน) */
const first: Record<string, unknown> = {
  id: 339, case_id: 359, rev: 2, updated_by: 168, created_at: new Date('2026-09-15T00:27:01Z'),
  claim_no: '2026013057520', survey_job_no: 'SEABI-121260700125', claim_type: 'F',
  car_type: 'T', car_brand: 'TOYOTA', driver_id_card: 'EQ0097565', driver_id_type: 'foreign', driver_birthdate: '01/08/2528',
  acc_police_station: 'ปลวกแดง จ.ระยอง(สภอ.)', estimated_cost: '19000.00', prb_number: '125013353460',
  insured_damage: [{ part: 'กันชนหน้า', level: 'L' }], opposing_parties: [{ plate: 'กข 1234' }], has_opponents: true,
  survey_result: 'ผลครั้งที่ 1', review_comment: 'ความเห็นครั้งที่ 1', acc_survey_arrive_date: '16/07/2569|21:17',
  survey_place: 'นิคมอมตะซิตี้', acc_surveyor: 'SE272 นาย ก', checklist: { a: 1 }, acc_date: '16/07/2569',
};
const third: Record<string, unknown> = {
  id: 358, case_id: 378, rev: 3, updated_by: 168, created_at: new Date('2026-09-15T09:32:00Z'),
  claim_no: '2026013057520', survey_job_no: 'SEABI-421260800193', claim_type: 'C',
  car_type: '', car_brand: 'TOYOTA', driver_id_card: '', driver_id_type: 'thai', driver_birthdate: '',
  acc_police_station: '', estimated_cost: null, prb_number: '',
  insured_damage: [], opposing_parties: [], has_opponents: false,
  survey_result: 'ผลครั้งที่ 3', review_comment: '', acc_survey_arrive_date: '21/08/2569|13:13',
  survey_place: 'ว.4 สภ.ปลวกแดง', acc_surveyor: 'SE300 นาย ข', checklist: null, acc_date: '16/07/2569',
};
const eff = effectiveReport(third, first);
check('ข้อมูลหลักทุกช่องมาจากครั้งที่ 1 (ทับแม้ครั้งนี้มีค่าตั้งต้น เช่น ชนิดบัตร thai → foreign · ยี่ห้อ)',
  eff.car_type === 'T' && eff.driver_id_card === 'EQ0097565' && eff.driver_id_type === 'foreign' && eff.driver_birthdate === '01/08/2528'
  && eff.acc_police_station === 'ปลวกแดง จ.ระยอง(สภอ.)' && eff.estimated_cost === '19000.00' && eff.prb_number === '125013353460'
  && (eff.insured_damage as unknown[]).length === 1 && (eff.opposing_parties as unknown[]).length === 1 && eff.has_opponents === true);
check('ของครั้งนี้คงไว้: เลขเซอร์เวย์ · ประเภทเคลม · ผลการดำเนินงาน · ความเห็น · เวลาถึง · สถานที่ออกตรวจ · ช่าง · checklist',
  eff.survey_job_no === 'SEABI-421260800193' && eff.claim_type === 'C' && eff.survey_result === 'ผลครั้งที่ 3' && eff.review_comment === ''
  && eff.acc_survey_arrive_date === '21/08/2569|13:13' && eff.survey_place === 'ว.4 สภ.ปลวกแดง' && eff.acc_surveyor === 'SE300 นาย ข' && eff.checklist === null);
check('ตัวชี้ของใบนี้คงไว้ (id/case_id/rev/updated_by) — rev ใช้กันบันทึกทับของใบนี้เอง',
  eff.id === 358 && eff.case_id === 378 && eff.rev === 3 && eff.updated_by === 168);
check('ไม่แก้ object ที่รับมา', third.car_type === '' && first.survey_result === 'ผลครั้งที่ 1');
check('ครั้งที่ 1 หรือเคลมเดี่ยว: ไม่มีอะไรทับ (effectiveReport ไม่ถูกเรียก — ดูการต่อสายด้านล่าง)', true);

const locked = mainLockedFields(Object.keys(third));
check('ช่องที่หน้าเว็บต้องล็อก = คอลัมน์หลัก + ชิ้นส่วนบนฟอร์มของช่องหลัก (ไม่มีของประจำครั้ง)',
  locked.includes('car_type') && locked.includes('driver_id_card') && locked.includes('opposing_parties') && locked.includes('acc_customer_report_date_val')
  && locked.includes('acc_time_hour') && !locked.includes('survey_result') && !locked.includes('acc_survey_arrive_date') && !locked.includes('claim_type')
  && !locked.includes('rev') && !locked.includes('survey_job_no'));
check('ชิ้นส่วนบนฟอร์มของช่องประจำครั้ง (arrive/complete/notify) ไม่อยู่ใน MAIN_FORM_PARTS',
  !MAIN_FORM_PARTS.some((p) => /arrive|complete|notify|submitted/.test(p)));
check('VISIT_OWN_FIELDS ครอบ: ผล/ความเห็น/checklist · เวลา-สถานที่ออกตรวจ · ช่าง · เลขเซอร์เวย์ · ประเภทเคลม · ตัวชี้ใบ',
  ['survey_result', 'review_comment', 'surveyor_comment', 'checklist', 'source_remark', 'notes', 'acc_survey_arrive_date', 'acc_survey_complete_date',
   'acc_insurance_notify_date', 'survey_place', 'survey_province', 'survey_district', 'survey_subdistrict', 'acc_surveyor', 'acc_surveyor_phone',
   'surveyor_name', 'surveyor_phone', 'survey_job_no', 'survey_job_no_2', 'claim_type', 'id', 'case_id', 'rev', 'updated_at', 'updated_by']
    .every((k) => VISIT_OWN_FIELDS.has(k)) && !VISIT_OWN_FIELDS.has('car_type') && !VISIT_OWN_FIELDS.has('opposing_parties'));

/* ── การต่อสาย ── */
console.log('\n── การต่อสาย ──');
const svc = read('src', 'services', 'case.service.ts');
check('หาครั้งที่ 1 ด้วยสูตรเดียวกับ visit_count (COALESCE(visit_no, ROW_NUMBER)) และคืน null เมื่อเคสนี้คือใบแรกเอง',
  /const findFirstVisit = async \(claimNo: unknown, caseId: number\)/.test(svc)
  && /COALESCE\(c\.visit_no, ROW_NUMBER\(\) OVER \(PARTITION BY sr\.claim_no ORDER BY c\.created_at\)\)::int AS fv_visit_no/.test(svc)
  && /Number\(r\.rows\[0\]\.fv_case_id\) === Number\(caseId\)\) return null/.test(svc));
check('getEffectiveReport มีให้บอท/XML ใช้ และคืน main_from + main_locked_fields',
  /async getEffectiveReport\(caseId: number\)[\s\S]{0,700}?effectiveReport\(own, first\.report\)[\s\S]{0,300}?main_locked_fields: mainLockedFields\(Object\.keys\(own\)\)/.test(svc));
check('หน้าเคส (getDetail) ได้รายงานที่ประกอบแล้ว + main_from + main_locked_fields',
  /const reportOut = firstVisit && report \? effectiveReport\(report, firstVisit\.report\) : report;/.test(svc)
  && /report: reportOut,\s*main_from: mainFrom,\s*main_locked_fields:/.test(svc));
check('XML export ของครั้งที่ 2+ ใช้ข้อมูลหลักครั้งที่ 1 สด (ก่อน withInsurerBill)',
  /const firstVisit = await findFirstVisit\(reportResult\.rows\[0\]\.claim_no, caseId\);\s*const base = firstVisit \? effectiveReport\(reportResult\.rows\[0\], firstVisit\.report\) : reportResult\.rows\[0\];\s*const row = await withInsurerBill\(caseId, base\);/.test(svc));
check('บันทึกใบครั้งที่ 2+ ทิ้งช่องข้อมูลหลักที่หลุดมากับฟอร์ม (เขียนเฉพาะของครั้งนั้น)',
  /if \(firstVisit\) \{\s*for \(const k of Object\.keys\(rd\)\) if \(validCols\.has\(k\) && !VISIT_OWN_FIELDS\.has\(k\)\) delete rd\[k\];/.test(svc));
check('เลิกก๊อปข้อมูลครั้งที่ 1 ตอนดึงงาน (ไม่มี inheritFromFirstVisit อีก)',
  !svc.includes('inheritFromFirstVisit') && svc.includes('**ไม่ก๊อป** ข้อมูลหลักของครั้งที่ 1'));
const routes = read('src', 'routes', 'integration.routes.ts');
check('บอทอ่าน report ผ่าน getEffectiveReport (ชุดเดียวกับหน้าเคส)',
  /const eff = await caseService\.getEffectiveReport\(caseId\);[\s\S]{0,900}?data: \{ \.\.\.eff\.report, main_from: eff\.main_from[,\s}]/.test(routes));   // 16/09/69 มี driver_address_emcs ต่อท้ายได้
/** การ์ดบอทโชว์ "ครั้งที่ N/M" (user ขอ 15/09/69) — รายการนำเข้าต้องส่ง visit_no (สูตรเดียวกับหน้าเคส) + visit_total ของเคลม */
check('รายการเคสสำหรับบอทส่ง visit_no + visit_total',
  /COALESCE\(c\.visit_no,\s*\(SELECT COUNT\(\*\)::int FROM cases c2 JOIN survey_reports s2 ON s2\.case_id = c2\.id\s*WHERE s2\.claim_no = sr\.claim_no AND c2\.created_at <= c\.created_at\)\)::int AS visit_no/.test(routes)
  && /WHERE s3\.claim_no = sr\.claim_no\) AS visit_total/.test(routes));
check('photos-zip รับเคสอ้างอิง (isurvey_reference) ทั้งที่ reviewed · เคสที่คนอนุมัติจริงยังล็อก',
  /const isReference = c\.rows\[0\]\.source === 'isurvey_reference'/.test(routes) && /status === 'reviewed' && !isReference/.test(routes)
  && routes.includes('อนุมัติแล้ว — เพิ่มรูปไม่ได้จนกว่าแอดมินจะปลดล็อก'));
/**
 * ── รูปชื่อซ้ำข้ามหมวด (22/09/69, เคลม 2026013173663 หาย 13/26 ใบ) ──
 * ⛔ OSS ตั้งชื่อรูป _1_.jpg ซ้ำทุกหมวด — ตัวดึงงาน (se-autokey download_images) ต้องกันซ้ำด้วย path ไม่ใช่ชื่อ
 *    และฝั่ง backend โหมดดึงซ้ำ/เติมรูปต้องเทียบเนื้อไฟล์ ไม่ใช่ชื่อ ไม่งั้นเติมรูปที่หายไม่ได้
 */
check('importPhotoZip โหมด skipExisting เทียบ sha1 ของเนื้อไฟล์ (อ่านไฟล์เดิมจาก storage) ไม่ใช่ชื่อไฟล์',
  /const sha1 = \(b: Buffer\) => createHash\('sha1'\)\.update\(b\)\.digest\('hex'\);/.test(svc)
  && /const buf = await storage\.getBuffer\(String\(r\.file_path\)\);\s*if \(buf\) existing\.add\(sha1\(buf\)\);/.test(svc)
  && /if \(existing\.has\(h\)\) \{ skipped\+\+; continue; \}/.test(svc) && !/existing\.has\(base\)/.test(svc));
check('photos-zip ?topup=1 เติมรูปเคสที่อนุมัติแล้วได้เฉพาะยังไม่เข้า EMCS (emcs_imported_at ว่าง) · ไม่ส่ง topup ยังล็อกเหมือนเดิม',
  /const topup = String\(req\.query\.topup \?\? ''\) === '1';/.test(routes) && routes.includes('SELECT status, source, emcs_imported_at FROM cases WHERE id = $1')
  && /if \(!topup\) \{[\s\S]{0,200}อนุมัติแล้ว — เพิ่มรูปไม่ได้จนกว่าแอดมินจะปลดล็อก/.test(routes)
  && /if \(c\.rows\[0\]\.emcs_imported_at\) \{[\s\S]{0,200}เข้า EMCS แล้ว — เติมรูปทางนี้ไม่ได้/.test(routes));
{
  const botApi = path.join(__dirname, '..', '..', '..', 'se-autokey', 'autokey', 'isurvey_api.py');
  if (fs.existsSync(botApi)) {
    const a = fs.readFileSync(botApi, 'utf8');
    check('ตัวดึงงาน (se-autokey) โหลดรูปแยกโฟลเดอร์ตามหมวด + กันซ้ำด้วย path ไม่ใช่ชื่อไฟล์',
      a.includes('path_key = str(url).split("?")[0].lstrip("/")') && a.includes('target = dest_dir / cat.lower() / (f"{grp}_{name}" if grp else name)')
      && !a.includes('if not name or not url or name in seen:'));
  } else {
    console.log('[SKIP] ไม่มี repo se-autokey ข้าง ๆ — ข้ามเทสตัวดึงงาน');
  }
}

/* ── เคสอ้างอิงแก้ข้อมูลตั้งต้นได้โดยไม่ต้องปลดล็อก ── */
check('ตัวล็อกอนุมัติมีช่องยกเว้นเคสอ้างอิง · แก้รายงาน + รูป 4 ฟังก์ชันยอม · ตัวระบุตัวเคสยังล็อก',
  /const assertNotApproved = async \(caseId: number, opts: \{ allowReference\?: boolean \} = \{\}\)/.test(svc)
  && (svc.match(/assertNotApproved\(caseId, \{ allowReference: true \}\)/g) ?? []).length === 5
  && /async updateCaseIdentity[\s\S]{0,600}?await assertNotApproved\(caseId\);/.test(svc));
const psvc = read('src', 'services', 'pay.service.ts');
check('ยอดพนักงาน (/pay) ไม่ล็อกเคสอ้างอิง (ปุ่มบันทึกยิง /pay ก่อน /report)',
  /status === 'reviewed' && r\.rows\[0\]\.source !== 'isurvey_reference'/.test(psvc));
const rsvc = read('src', 'services', 'review.service.ts');
check('ปลดล็อกเคสอ้างอิงไม่ได้ (จะพาเข้าคิวอนุมัติ → ส่ง se-billing/ปิด ISURVEY ซ้ำ)',
  /source === 'isurvey_reference'\) \{\s*throw new ForbiddenError\('เคสอ้างอิงจาก ISURVEY แก้ข้อมูลได้เลย/.test(rsvc));

/* ── หน้าเว็บ ── */
console.log('\n── หน้าเว็บ ──');
const page = read('..', 'web', 'src', 'app', 'inspector', 'cases', '[id]', 'page.tsx');
check('หน้า wrapper รับ main_from/main_locked_fields จาก /detail แล้วส่งให้ CaseDetail',
  page.includes('setMainFrom(res.data.data.main_from || null)') && page.includes('setMainLockedFields(res.data.data.main_locked_fields || [])')
  && page.includes('mainFrom={mainFrom} mainLockedFields={mainLockedFields}'));
const cd = read('..', 'web', 'src', 'components', 'cases', 'CaseDetail.tsx');
check('ครั้งที่ 2+: ล็อกช่องข้อมูลหลักตามรายชื่อจาก backend ทุก render + คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน/ความเสียหายล็อกด้วย',
  cd.includes('const mainFromFirst = Boolean(mainFrom);') && /mainLockedRef\.current\.has\(el\.name\)/.test(cd)
  && (cd.match(/<fieldset disabled=\{mainFromFirst\} className="contents/g) ?? []).length === 3 && cd.includes('disabled={locked || mainFromFirst}'));
check('แถบบอกว่าข้อมูลหลักมาจากครั้งที่ 1 + ปุ่ม "แก้ที่ครั้งที่ 1" พาไปหน้าครั้งที่ 1',
  cd.includes('แสดงจากครั้งที่ {String(mainFrom.visit_no ?? 1)}') && /onClick=\{\(\) => switchVisit\(String\(mainFrom\.case_id\)\)\}/.test(cd)
  && cd.includes('แก้ที่ครั้งที่ {String(mainFrom.visit_no ?? 1)} →'));
check('ตัวเลือก "ครั้งที่" พาไปหน้าของครั้งนั้น (ไม่ใช่ดูอย่างเดียว)', /onChange=\{\(e\) => switchVisit\(e\.target\.value\)\}/.test(cd));
check('ด่านอนุมัติครั้งที่ 2+ = เฉพาะของครั้งนี้ (+ ผลการดำเนินงานต้องมี) · ด่านข้อมูลหลักไม่กั้นแต่บอกให้แก้ที่ครั้งที่ 1',
  cd.includes('const approvalBlockers = mainFromFirst ? visitBlockers : [...visitBlockers, ...mainBlockers];')
  && cd.includes("...(mainFromFirst && resultEmpty ? ['ยังไม่มี \"ผลการดำเนินงาน\" ของครั้งนี้'] : [])")
  && cd.includes('ข้อมูลหลักยังมี {mainBlockers.length} ข้อที่ต้องแก้ที่ครั้งที่'));
check('ตัวไล่ช่องบังคับข้ามช่องข้อมูลหลักของครั้งที่ 2+ และอ่านผลการดำเนินงานสด',
  /if \(mainFromFirstRef\.current && mainLockedRef\.current\.has\(\(el as HTMLInputElement\)\.name\)\) return;/.test(cd)
  && cd.includes("form.querySelector('[name=\"survey_result\"]') as HTMLTextAreaElement | null") && cd.includes('setResultEmpty('));
check('เคสอ้างอิง: locked = approved && !isReference · แถบ "แก้ข้อมูลตั้งต้นได้" + ปุ่มบันทึก',
  cd.includes('const locked = approved && !isReference;') && cd.includes('อ้างอิง ISURVEY · แก้ข้อมูลตั้งต้นได้')
  && /const actionBar = approved && isReference \? \(/.test(cd));
const pull = read('..', 'web', 'src', 'app', 'inspector', 'isurvey', 'page.tsx');
check('หน้าดึงงานบอกจำนวนรูปของแต่ละครั้งก่อนหน้า', pull.includes('refPhotos(x)'));
/** ค้นหาข้ามสถานะ (user ขอ 15/09/69): เลขเคลม/เลขเซอร์เวย์/ผู้สำรวจ/จังหวัด · พิมพ์แล้วตัวกรองสถานะพักไว้ */
check('หน้าดึงงาน: ค้นหาจากรายการที่โหลดมาทุกสถานะ (4 ช่อง ไม่สนตัวพิมพ์) และพักตัวกรองสถานะระหว่างค้น',
  /if \(!searching\) return afterHide;\s*return \(rows \?\? \[\]\)\.filter\(\(r\) =>\s*\[r\.claim_no, r\.survey_no, r\.surveyor_name, r\.acc_province\]\.some\(\(v\) => String\(v \?\? ''\)\.toLowerCase\(\)\.includes\(needle\)\)\);/.test(pull)
  && pull.includes('placeholder="เลขเคลม / เลขเซอร์เวย์ / ผู้สำรวจ / จังหวัด"') && /onClick=\{\(\) => setStatusOpen\(\(o\) => !o\)\} disabled=\{searching\}/.test(pull)
  && pull.includes('ตัวกรองสถานะพักไว้ระหว่างค้นหา'));

/** การ์ดบอทโชว์ "คู่กรณี N · ผู้บาดเจ็บ N · ทรัพย์สิน N" (user ขอ 20/09/69) — นับจากใบครั้งที่ 1 ของเคลม (รายงานที่มีผล) · ไม่ใช่ array = 0 */
check('รายการเคสสำหรับบอทส่ง opponent_count/injured_count/property_count นับจากใบครั้งที่ 1 (กติกา findFirstVisit)',
  /\$\{jsonCount\('opposing_parties'\)\} AS opponent_count,\s*\$\{jsonCount\('injured_persons'\)\} AS injured_count,\s*\$\{jsonCount\('damaged_property'\)\} AS property_count/.test(routes)
  && routes.includes("`(CASE WHEN jsonb_typeof(COALESCE(fv.${col}, sr.${col})) = 'array' THEN jsonb_array_length(COALESCE(fv.${col}, sr.${col})) ELSE 0 END)::int`")
  && /LEFT JOIN LATERAL \(\s*SELECT t\.opposing_parties, t\.injured_persons, t\.damaged_property[\s\S]{0,700}?COALESCE\(c1\.visit_no, ROW_NUMBER\(\) OVER \(PARTITION BY s1\.claim_no ORDER BY c1\.created_at\)\)::int AS fv_visit_no[\s\S]{0,300}?WHERE s1\.claim_no = sr\.claim_no AND sr\.claim_no <> ''\) t\s*ORDER BY t\.fv_visit_no, t\.fv_created LIMIT 1\s*\) fv ON TRUE/.test(routes));

/**
 * ── "ครั้งที่" บนหน้างานรอตรวจ (22/09/69) ──
 * ⛔ ดึงใบหลังก่อนใบก่อน = ครั้งก่อนหน้ากลายเป็นเคสอ้างอิง (อนุมัติไม่ได้อีก) — หน้ารายการต้องบอกครั้งที่และเตือนก่อนกด
 */
{
  const pullSvc = read('src', 'services', 'isurveyPull.service.ts');
  const pullRoutes = read('src', 'routes', 'isurvey.routes.ts');
  check('backend: มีเส้นทาง /rounds ที่ถาม service แล้วเทียบ DB ว่าครั้งก่อนหน้ายังไม่มีใบไหน',
    /router\.post\('\/rounds', \.\.\.guard/.test(pullRoutes) && /async rounds\(userId: number/.test(pullSvc)
    && pullSvc.includes("callService<{ rounds:") && pullSvc.includes('earlier_missing: earlierMissing'));
  check('เว็บ: ถามครั้งที่ทีหลังเฉพาะแถวที่มองเห็น ไม่ถ่วงตอนโหลดรายการ',
    pull.includes("api.post('/api/isurvey/rounds'") && pull.includes('roundsAsked'));
  check('เว็บ: โชว์ "ครั้งที่ N จาก M" ใต้เลขเซอร์เวย์ + เตือนครั้งก่อนหน้าที่ยังไม่ได้ดึง',
    pull.includes('ครั้งที่ {r.visit_no}') && pull.includes('ครั้งก่อนหน้ายังไม่ได้ดึง'));
  // 22/09/69 user: หน้างานรอตรวจไม่กรองตามทีม (งานตกหล่น เคลม 2026013150636) — กรองด้วยจังหวัดแทน · หน้ารายการงานยังกรองตามทีม
  check('backend: หน้างานรอตรวจไม่กรองตามทีมแล้ว (ยังกรองที่ getForReview เท่านั้น)',
    !/rows = rows\.filter\(\(r\) => team\.match/.test(pullSvc) && pullSvc.includes('applied: false')
    && read('src', 'services', 'case.service.ts').includes('staffGroupService.filterFor(user.id, user.role)'));
  check('เว็บ: ตัวกรองจังหวัดติ๊กได้หลายค่า จากจังหวัดในรายการ · ตัวกรองสถานะยังอยู่',
    pull.includes('provinceCounts') && pull.includes('toggleProvince') && pull.includes('ไม่ติ๊กเลย = ทุกจังหวัด') && pull.includes('toggleStatus'));
  // 22/09/69 (รอบ 2) user: checkbox "ทีมพนักงาน" — server ติดธง in_team ทุกแถว (ไม่ตัดแถว) · เว็บกรองเองเมื่อติ๊ก · บัญชีไม่ผูกทีมติ๊กไม่ได้
  check('backend: listPending ติดธง in_team ให้ทุกแถวจากรายชื่อลูกทีม แต่ไม่ตัดแถวทิ้ง (applied ยัง false)',
    /const team = await staffGroupService\.filterFor\(userId, role\);/.test(pullSvc) && pullSvc.includes('in_team: inTeam(r)')
    && !/rows = rows\.filter\(\(r\) => team\.match/.test(pullSvc) && pullSvc.includes('in_team?: boolean | null;') && pullSvc.includes('applied: false, group_name: team?.group.name'));
  check('เว็บ: checkbox "ทีมพนักงาน" = ขอบเขต in_team === true ก่อนตัวกรองสถานะ/จังหวัด · ติ๊กไม่ได้ถ้าไม่ผูกทีม · จำไว้ในแท็บ (cache v5)',
    pull.includes('(rows ?? []).filter((r) => r.in_team === true)') && pull.includes('const base = useMemo(() => (teamScoped ? teamRows : (rows ?? [])), [teamScoped, teamRows, rows]);')
    && pull.includes('disabled={!hasTeam || searching}') && pull.includes('team_only: teamOnly') && pull.includes("'isurvey-pending-cache-v5'")
    && pull.includes('เฉพาะลูกทีม') && pull.includes('>นอกทีม</span>'));
}

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด\n' : `\n❌ ไม่ผ่าน ${failed} ข้อ\n`);
process.exit(failed === 0 ? 0 : 1);
