/**
 * การ์ดของ "งานครั้งที่ 2+ สืบทอดข้อมูลครั้งที่ 1" (user สั่ง 15/09/69 เคลม 2026013057520 ครั้งที่ 1–4)
 *
 * ทำไมต้องมี: ISURVEY เก็บข้อมูลหลักไว้ที่ครั้งที่ 1 ใบครั้งถัดไปมีแค่ของประจำครั้ง → ดึงเข้าเว็บแล้ว
 * หน้าตรวจขึ้น "ช่องบังคับยังว่าง 20+ ช่อง" ทั้งที่งานต่อเนื่องไม่ต้องกรอกช่องพวกนั้น
 * และรูปของครั้งก่อนหน้าต้องเข้าเว็บด้วย (กติกา 13/09 "ข้ามรูป" ถูกยกเลิก)
 *
 * ครึ่งแรกเรียกฟังก์ชันจริง (ไม่แตะฐานข้อมูล) ครึ่งหลังตรวจการต่อสาย
 */
import * as fs from 'fs';
import * as path from 'path';
import { inheritFromFirstVisit, VISIT_OWN_FIELDS, LIST_FLAGS, isBlank } from '../src/services/visitInherit';

let failed = 0;
const check = (label: string, ok: boolean, note = '') => {
  if (!ok) failed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${note ? `  (${note})` : ''}`);
};
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

console.log('\n── งานครั้งที่ 2+ สืบทอดข้อมูลครั้งที่ 1 ──');

/** ครั้งที่ 1 ตามโครงจริง (สรุปจากเคส #359) · ครั้งที่ 3 ตามโครงจริง (เคส #361: มีของประจำครั้ง ไม่มีของครั้งที่ 1) */
const first: Record<string, unknown> = {
  id: 339, case_id: 359, rev: 1, updated_at: null, created_at: new Date('2026-09-15T00:27:01Z'),
  claim_no: '2026013057520', survey_job_no: 'SEABI-121260700125', claim_type: 'F',
  car_type: 'เก๋งเอเชีย', car_province: 'ระยอง', driver_id_card: '1234567890123', driver_birthdate: '01/01/2530',
  acc_police_station: 'สภ.ปลวกแดง', estimated_cost: '4000.00', prb_number: 'PRB1', risk_code: '110',
  driver_by_policy: true, insured_damage: [{ part: 'กันชนหน้า', level: 'M' }],
  opposing_parties: [{ plate: 'กข 1234', estimated_cost: '2500' }], has_opponents: true,
  injured_persons: [], has_injured: false,
  survey_result: 'ผลครั้งที่ 1', acc_survey_arrive_date: '16/07/2569|21:17', survey_place: 'นิคมอมตะซิตี้',
  acc_surveyor: 'SE272 นาย ก', surveyor_name: 'นาย ก', customer_reported_at: new Date('2026-07-16T10:00:00Z'),
  policy_no: 'POL-1', driver_first_name: 'สมชาย', acc_date: '16/07/2569',
};
const third: Record<string, unknown> = {
  claim_no: '2026013057520', survey_job_no: 'SEABI-421260800193', claim_type: '',
  car_type: '', car_province: null, driver_id_card: '', estimated_cost: '', insured_damage: '[]',
  opposing_parties: [], has_opponents: false, injured_persons: [{ name: 'ผู้บาดเจ็บของครั้งนี้' }], has_injured: true,
  survey_result: 'ผลครั้งที่ 3', acc_survey_arrive_date: '21/08/2569|13:13', survey_place: 'ว.4 สภ.ปลวกแดง',
  acc_surveyor: 'SE300 นาย ข', surveyor_name: 'นาย ข', policy_no: 'POL-1', driver_first_name: 'สมชาย', acc_date: '16/07/2569',
};
const rep = { ...third };
const filled = inheritFromFirstVisit(rep, first);

check('ช่องว่างของครั้งที่ 3 ถูกเติมจากครั้งที่ 1 (ประเภทรถ/จังหวัดทะเบียน/บัตร/ตำรวจ/ยอด/พรบ./รหัสภัย/ผู้ขับขี่ตามกรมธรรม์)',
  rep.car_type === 'เก๋งเอเชีย' && rep.car_province === 'ระยอง' && rep.driver_id_card === '1234567890123'
  && rep.acc_police_station === 'สภ.ปลวกแดง' && rep.estimated_cost === '4000.00' && rep.prb_number === 'PRB1'
  && rep.risk_code === '110' && rep.driver_by_policy === true && rep.driver_birthdate === '01/01/2530');
check('รายการความเสียหาย "[]" (สตริง) ถือว่าว่าง → เติมรายการของครั้งที่ 1',
  Array.isArray(rep.insured_damage) && (rep.insured_damage as unknown[]).length === 1);
check('คู่กรณีว่าง → เติม + ธง has_opponents ตามมาด้วย',
  Array.isArray(rep.opposing_parties) && (rep.opposing_parties as unknown[]).length === 1 && rep.has_opponents === true
  && filled.includes('opposing_parties') && filled.includes('has_opponents'));
check('ผู้บาดเจ็บของครั้งนี้มีอยู่แล้ว → ไม่ทับ และธง has_injured ไม่ถูกแตะ',
  (rep.injured_persons as { name: string }[])[0].name === 'ผู้บาดเจ็บของครั้งนี้' && rep.has_injured === true);
check('ของประจำครั้งไม่ถูกทับ: ผลการดำเนินงาน · เลขเซอร์เวย์ · ประเภทเคลม · เวลาถึง · สถานที่ออกตรวจ · ช่าง',
  rep.survey_result === 'ผลครั้งที่ 3' && rep.survey_job_no === 'SEABI-421260800193' && rep.claim_type === ''
  && rep.acc_survey_arrive_date === '21/08/2569|13:13' && rep.survey_place === 'ว.4 สภ.ปลวกแดง'
  && rep.acc_surveyor === 'SE300 นาย ข' && rep.surveyor_name === 'นาย ข');
check('ค่าที่ครั้งนี้มีอยู่แล้ว (กรมธรรม์/ชื่อผู้ขับขี่/วันเกิดเหตุ) ไม่นับเป็นการเติม',
  !filled.includes('policy_no') && !filled.includes('driver_first_name') && !filled.includes('acc_date'));
check('คอลัมน์ระบบของครั้งที่ 1 (id/case_id/rev/created_at) ไม่หลุดมา',
  !('id' in rep) && !('case_id' in rep) && !('rev' in rep) && !('created_at' in rep));
check('TIMESTAMP จาก pg (Date) ถูกแปลงเป็น ISO string ก่อน bind',
  rep.customer_reported_at === '2026-07-16T10:00:00.000Z');
check('คืนรายชื่อช่องที่เติม (ไว้จดเตือนให้หัวหน้า)', filled.length >= 12 && filled.includes('car_type'), `${filled.length} ช่อง`);
check('ไม่มีครั้งที่ 1 ให้สืบทอด (แถวว่าง) → ไม่แตะอะไร',
  inheritFromFirstVisit({ car_type: '' }, {}).length === 0);
check('isBlank: 0/false เป็นค่าจริง · null/""/"[]"/[]/{} ว่าง',
  !isBlank(0) && !isBlank(false) && isBlank(null) && isBlank('  ') && isBlank('[]') && isBlank([]) && isBlank({}));
check('VISIT_OWN_FIELDS ครอบทั้งชุด: ผลการดำเนินงาน · รูปไม่อยู่ในตารางนี้อยู่แล้ว · เวลา/สถานที่ออกตรวจ · ช่าง · เลขเซอร์เวย์',
  ['survey_result', 'survey_job_no', 'survey_job_no_2', 'claim_type', 'acc_survey_arrive_date', 'acc_survey_complete_date',
   'survey_place', 'survey_province', 'acc_surveyor', 'surveyor_name', 'checklist', 'source_remark', 'review_comment']
    .every((k) => VISIT_OWN_FIELDS.has(k)));
check('ธง has_* ผูกกับรายการของมันครบ 3 คู่', Object.keys(LIST_FLAGS).length === 3 && LIST_FLAGS.opposing_parties === 'has_opponents');

/* ── การต่อสาย ── */
const svc = read('src', 'services', 'case.service.ts');
check('importFromXml สืบทอดเมื่อ visitNo > 1 โดยหาครั้งที่ 1 ของเคลมเดียวกันจาก DB (ครั้งที่น้อยกว่าเท่านั้น)',
  /\(parsed\.visitNo \?\? 0\) > 1 && claimNoForVisit[\s\S]{0,400}?c\.visit_no < \$2[\s\S]{0,300}?inheritFromFirstVisit\(report, firstReport\)/.test(svc));
check('สืบทอดก่อน INSERT (อยู่ก่อนเปิด transaction)',
  svc.indexOf('inheritFromFirstVisit(report, firstReport)') < svc.indexOf("await client.query('BEGIN')", svc.indexOf('async importFromXml')));
check('จดเตือนไว้กับเคสว่าเติมกี่ช่องจากครั้งไหน', svc.includes('ที่ใบนี้ไม่มีบน ISURVEY — รูปและผลการดำเนินงานเป็นของครั้งนี้'));

const routes = read('src', 'routes', 'integration.routes.ts');
/** รูปของครั้งก่อนหน้า: เคสอ้างอิงถูก reviewed ตั้งแต่สร้าง — ต้องไม่ติดล็อก 423 และไม่ติด 403 source */
check('photos-zip รับเคสอ้างอิง (isurvey_reference) ทั้งที่ reviewed', /const isReference = c\.rows\[0\]\.source === 'isurvey_reference'/.test(routes)
  && /status === 'reviewed' && !isReference/.test(routes) && /source !== 'isurvey_live' && !isReference/.test(routes));
check('เคสที่คนอนุมัติจริง (ไม่ใช่อ้างอิง) ยังถูกล็อกเหมือนเดิม', routes.includes('อนุมัติแล้ว — เพิ่มรูปไม่ได้จนกว่าแอดมินจะปลดล็อก'));

const web = read('..', 'web', 'src', 'app', 'inspector', 'isurvey', 'page.tsx');
check('หน้าดึงงานบอกจำนวนรูปของแต่ละครั้งก่อนหน้า', web.includes('refPhotos(x)') && web.includes('photos?: { added?: number; error?: string; note?: string } | null }[]'));

/* ── เคสอ้างอิงแก้ข้อมูลตั้งต้นได้โดยไม่ต้องปลดล็อก (user สั่ง 15/09/69 ครั้งที่ 1 ของเคลม 2026013057520) ── */
console.log('\n── เคสอ้างอิงแก้ได้ ──');
check('ตัวล็อกอนุมัติมีช่องยกเว้นเคสอ้างอิง (ดู source ด้วย)',
  /const assertNotApproved = async \(caseId: number, opts: \{ allowReference\?: boolean \} = \{\}\)/.test(svc)
  && /SELECT status, source FROM cases WHERE id = \$1/.test(svc) && /opts\.allowReference && r\.rows\[0\]\.source === 'isurvey_reference'\) return;/.test(svc));
check('แก้รายงาน + รูป (เพิ่ม/ลบ/หมุน/โฟลเดอร์) ยอมเคสอ้างอิง',
  (svc.match(/assertNotApproved\(caseId, \{ allowReference: true \}\)/g) ?? []).length === 5);
/** เลขเคลม/เลขเซอร์เวย์ของเคสอ้างอิงผูกครั้งที่ไว้ — ยังล็อกเหมือนเดิม (แอดมินแก้ตัวระบุตัวเคสไม่ได้จนกว่าจะปลดล็อก ซึ่งเคสอ้างอิงปลดไม่ได้) */
check('ตัวระบุตัวเคส (updateCaseIdentity) ยังล็อกเคสอ้างอิง',
  /async updateCaseIdentity[\s\S]{0,600}?await assertNotApproved\(caseId\);/.test(svc));
/** ปุ่มบันทึกหน้าเคสยิง /pay ก่อน /report — ถ้าฝั่งยอดเงินยังล็อกเคสอ้างอิง ทั้งหน้าบันทึกไม่ผ่าน (เจอตอนเทส UI 15/09/69) */
const psvc = read('src', 'services', 'pay.service.ts');
check('ยอดพนักงาน (/pay) ไม่ล็อกเคสอ้างอิง',
  /SELECT status, source FROM cases WHERE id = \$1/.test(psvc) && /status === 'reviewed' && r\.rows\[0\]\.source !== 'isurvey_reference'/.test(psvc));
const rsvc = read('src', 'services', 'review.service.ts');
check('ปลดล็อกเคสอ้างอิงไม่ได้ (จะพาเข้าคิวอนุมัติ → ส่ง se-billing/ปิด ISURVEY ซ้ำ)',
  /source === 'isurvey_reference'\) \{\s*throw new ForbiddenError\('เคสอ้างอิงจาก ISURVEY แก้ข้อมูลได้เลย/.test(rsvc)
  && /SELECT status, source, emcs_imported_at, emcs_submitted_at FROM cases/.test(rsvc));
const cd = read('..', 'web', 'src', 'components', 'cases', 'CaseDetail.tsx');
check('หน้าเคส: ล็อกช่องเฉพาะเคสที่คนอนุมัติจริง (locked = approved && !isReference)',
  cd.includes("const isReference = String(caseData?.source ?? '') === 'isurvey_reference';") && cd.includes('const locked = approved && !isReference;')
  && cd.includes('<fieldset disabled={locked}') && cd.includes('caseId={locked ? undefined : caseData?.id}') && cd.includes('items={damage} disabled={locked}'));
check('หน้าเคส: เคสอ้างอิงมีแถบ "แก้ข้อมูลตั้งต้นได้" + ปุ่มบันทึก ไม่มีอนุมัติ/ตีกลับ/ปลดล็อก',
  /const actionBar = approved && isReference \? \([\s\S]{0,900}?onClick=\{handleSave\}[\s\S]{0,600}?\) : approved \? \(/.test(cd)
  && cd.includes('อ้างอิง ISURVEY · แก้ข้อมูลตั้งต้นได้'));
check('ป้ายเคสอ้างอิงบอกว่าแก้ได้ + ครั้งถัดไปที่ดึงใหม่ใช้ข้อมูลนี้', cd.includes('แก้ข้อมูลตั้งต้นได้ที่นี่แล้วกด "บันทึก"'));

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด\n' : `\n❌ ไม่ผ่าน ${failed} ข้อ\n`);
process.exit(failed === 0 ? 0 : 1);
