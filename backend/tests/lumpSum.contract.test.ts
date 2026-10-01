/**
 * Contract test — เรทเหมาฝั่งเรียกเก็บประกัน 2 แบบ
 *   ① "ตามลำดับเรื่องในเดือน" (ราชบุรี · user เคาะ 01/10/69)
 *   ② "ตามเรทรายอำเภอ" (กระบี่ · user เคาะ 02/10/69) — ค่าบริการในตารางอำเภอเป็นยอดเหมาอยู่แล้ว ไม่มีค่าเดินทาง/ค่ารูปแยก
 *
 * กติกา: ลำดับ = 5 หลักท้ายของเลขเซอร์เวย์ SEABI · เรื่องที่ 1–25 = 1,200 · 26 ขึ้นไป = 1,000 · ทุกประเภทเคลม
 *        ยอดเหมารวมทุกอย่าง → ไม่มีค่าเดินทาง/ค่ารูปแยก · นับลำดับไม่ได้ = ไม่เสนอ ให้หัวหน้ากรอกเอง (ห้ามเดา)
 * ตัวอย่างจริงที่ยืนยันบน EMCS: SEABI-170260400024 / 25 = 1,200 · SEABI-270260400026 = 1,000
 *
 * ล็อกไว้:
 *  1) parseSurveySeq ถอดเลขถูก (มี/ไม่มีขีด) · เลขไม่ครบ = null
 *  2) lumpSumFee ตามเส้น 25 · ทุกประเภทเคลม · จังหวัดอื่น/ไม่ใช่ SEABI/ตั้งค่าเสีย = ไม่ใช่เหมา · ไม่มีเลข/เลขจังหวัดอื่น = fee null
 *  3) standardPhotoFee: งานจังหวัดเหมา = ไม่มีค่ารูป · งานต่างจังหวัดปกติยังได้ 50 เหมือนเดิม
 *  4) ต่อสายครบ: getCasePay อ่านเลขเซอร์เวย์ + ใช้ยอดเหมาแทนเรทรายอำเภอ + ไม่เสนอค่าเดินทาง · หน้าเคสส่ง lump_sum_label ให้ค่ารูป ·
 *     หน้าตรวจโชว์ที่มาของยอด · หน้าตั้งค่ามีชื่อไทยของคีย์
 *  5) เหมารายอำเภอ (กระบี่): amphurLump เฉพาะจังหวัดในตั้งค่า · ข้อความบอกยอด/อำเภอไม่มีเรท · ค่ารูป 0 ·
 *     getCasePay ใช้ค่าบริการจากตารางเหมือนเดิมแต่ไม่เสนอค่าเดินทาง · หน้าเคสส่งป้ายให้กติกาค่ารูป · หน้าตั้งค่ามีชื่อไทย
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import {
  parseSurveySeq, lumpSumFee, LUMP_SETTING_KEY, LumpRules, amphurLump, AMPHUR_LUMP_SETTING_KEY, AmphurLumpRules,
} from '../src/services/lumpSum';
import { standardPhotoFee } from '../src/services/photoFee.service';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}

const RULES: LumpRules = { '70': { first_n: 25, first: 1200, rest: 1000, label: 'เหมาราชบุรี' } };

// ── 1) ถอดเลขเซอร์เวย์ ──
const p = parseSurveySeq('SEABI-170260400024');
check('ถอด SEABI-170260400024 = จังหวัด 70 · ปี 26 · เดือน 04 · เรื่องที่ 24 · เคลมสด',
  !!p && p.province === '70' && p.yy === '26' && p.mm === '04' && p.seq === 24 && p.type === '1', JSON.stringify(p));
check('ไม่มีขีด/ตัวเล็ก/มีวรรค ก็ถอดได้', parseSurveySeq(' seabi170260400025 ')?.seq === 25);
check('เลขไม่ครบ = null', parseSurveySeq('SEABI-1702604') === null && parseSurveySeq('') === null && parseSurveySeq(null) === null);

// ── 2) ยอดเหมา ──
check('เรื่องที่ 24 = 1,200', lumpSumFee(RULES, '70', 'SEABI-170260400024')?.fee === 1200);
check('เรื่องที่ 25 = 1,200 (ขอบบน)', lumpSumFee(RULES, '70', 'SEABI-170260400025')?.fee === 1200);
check('เรื่องที่ 26 = 1,000 (เคลมแห้งก็นับต่อเลขเดียวกัน)', lumpSumFee(RULES, '70', 'SEABI-270260400026')?.fee === 1000);
check('เรื่องที่ 1 = 1,200', lumpSumFee(RULES, '70', 'SEABI-170260900001')?.fee === 1200);
check('ติดตาม/เจรจาสินไหมได้เหมาเท่ากัน (ไม่ลด 100)',
  lumpSumFee(RULES, '70', 'SEABI-370260400003')?.fee === 1200 && lumpSumFee(RULES, '70', 'SEABI-470260400090')?.fee === 1000);
const note = lumpSumFee(RULES, '70', 'SEABI-170260400024')?.note ?? '';
check('ข้อความบอกลำดับเรื่อง + ยอด + เส้น 25', note.includes('เรื่องที่ 24') && note.includes('1,200') && note.includes('1–25'), note);
check('จังหวัดที่ไม่อยู่ในตั้งค่า = ไม่ใช่เหมา (null → กติกาเดิม)', lumpSumFee(RULES, '73', 'SEABI-173260400003') === null);
check('ไม่ใช่เลขไอโออิ (SETP) = ไม่ใช่เหมานี้', lumpSumFee(RULES, '70', 'SETP-170260400003') === null);
const noJob = lumpSumFee(RULES, '70', '');
check('ยังไม่มีเลขเซอร์เวย์ = จังหวัดเหมาแต่ไม่เสนอยอด (ห้ามเดา)', !!noJob && noJob.fee === null && noJob.note.includes('ยังไม่มีเลขเซอร์เวย์'));
const other = lumpSumFee(RULES, '70', 'SEABI-173260400003');
check('เลขเป็นของจังหวัดอื่น = ไม่เสนอยอด', !!other && other.fee === null);
check('ตั้งค่าเสีย (0/ว่าง) = ไม่ใช่เหมา',
  lumpSumFee({ '70': { first_n: 0, first: 1200, rest: 1000 } }, '70', 'SEABI-170260400001') === null
  && lumpSumFee(null, '70', 'SEABI-170260400001') === null && lumpSumFee({}, '70', 'SEABI-170260400001') === null);

// ── 3) ค่ารูป ──
const lumpPhoto = standardPhotoFee({ survey_job_no: 'SEABI-170260400024', lump_sum_label: 'เหมาราชบุรี' });
check('งานจังหวัดเหมา = ไม่มีค่ารูป', !!lumpPhoto && lumpPhoto.count === 0 && lumpPhoto.price === 0 && lumpPhoto.reason.includes('เหมา'), lumpPhoto?.reason);
const normal = standardPhotoFee({ survey_job_no: 'SEABI-173260400024' });
check('งานต่างจังหวัดปกติยังได้ค่ารูปเหมา 10 × 5 เหมือนเดิม', !!normal && normal.count === 10 && normal.price === 5);

// ── 4) ต่อสาย ──
const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const pay = read('backend/src/services/pay.service.ts');
check('getCasePay อ่านเลขเซอร์เวย์', /sr\.survey_job_no/.test(pay));
check('getCasePay ใช้ยอดเหมาแทนเรทรายอำเภอ', /lumpSumFee\(await loadLumpRules\(\), province, r\.survey_job_no\)/.test(pay)
  && /ins_service_fee:[^\n]*lump \? lump\.fee : pay\.insInvest/.test(pay));
check('จังหวัดเหมาไม่เสนอค่าเดินทาง', /ins_travel_fee:[^\n]*lump \|\| amphurLumpRule \? null : pay\.insTrans/.test(pay));
check('งานจากไฟล์ ISURVEY ยังไม่ถูกเติม (กติกาเดิม)', /ins_service_fee: fromIsurveyFile \? null/.test(pay));
const cs = read('backend/src/services/case.service.ts');
check('หน้าเคสส่ง lump_sum_label ให้กติกาค่ารูป', /standardPhotoFee\(\{[^}]*lump_sum_label: lumpLabel/.test(cs));
const web = read('web/src/components/cases/CaseDetail.tsx');
check('หน้าตรวจโชว์ที่มาของยอดเหมา', /pay\.suggest\?\.ins_note/.test(web));
const admin = read('web/src/app/admin/billing-rates/page.tsx');
check('หน้าตั้งค่ามีชื่อไทยของคีย์เหมา', admin.includes(`${LUMP_SETTING_KEY}:`));

// ── 5) เหมาตามเรทรายอำเภอ (กระบี่) ──
const A_RULES: AmphurLumpRules = { '81': { label: 'เหมากระบี่' } };
const kb = amphurLump(A_RULES, '81', 1200);
check('กระบี่ = เหมารายอำเภอ · ข้อความบอกยอด + ไม่มีค่าเดินทาง/ค่ารูปแยก',
  !!kb && kb.label === 'เหมากระบี่' && kb.note.includes('1,200') && kb.note.includes('ไม่มีค่าเดินทาง/ค่ารูปแยก'), kb?.note);
const kbNoRate = amphurLump(A_RULES, '81', null);
check('อำเภอที่ไม่มีเรทในตาราง = ยังเป็นเหมา แต่บอกให้กรอกเอง', !!kbNoRate && kbNoRate.note.includes('กรอกค่าบริการเอง'), kbNoRate?.note);
check('จังหวัดอื่น/ไม่มีตั้งค่า = ไม่ใช่เหมา (กติกาเดิม)',
  amphurLump(A_RULES, '70', 1200) === null && amphurLump(A_RULES, null, 1200) === null
  && amphurLump(null, '81', 1200) === null && amphurLump({}, '81', 1200) === null);
check('ไม่มีชื่อป้าย ก็ยังรู้ว่าเหมา', amphurLump({ '81': {} }, '81', 1300)?.label.includes('81') === true);
const kbPhoto = standardPhotoFee({ survey_job_no: 'SEABI-181260900026', lump_sum_label: 'เหมากระบี่' });
check('งานกระบี่ = ไม่มีค่ารูป', !!kbPhoto && kbPhoto.count === 0 && kbPhoto.price === 0 && kbPhoto.reason.includes('เหมากระบี่'), kbPhoto?.reason);
check('getCasePay เช็กเหมารายอำเภอด้วยค่าบริการจากตาราง (เฉพาะเมื่อไม่ใช่เหมาตามลำดับเรื่อง)',
  /amphurLumpRule = lump \? null : amphurLump\(await loadAmphurLumpRules\(\), province, pay\.insInvest\)/.test(pay));
check('เหมารายอำเภอยังเสนอค่าบริการจากตารางตามปกติ + บอกที่มา',
  /ins_service_fee: fromIsurveyFile \? null : \(lump \? lump\.fee : pay\.insInvest\)/.test(pay)
  && /ins_note:[^\n]*amphurLumpRule\?\.note/.test(pay));
check('หน้าเคสส่งป้ายเหมารายอำเภอให้กติกาค่ารูป', /amphurLump\(await loadAmphurLumpRules\(\), lumpProvince\)\?\.label/.test(cs));
check('หน้าตั้งค่ามีชื่อไทยของคีย์เหมารายอำเภอ', admin.includes(`${AMPHUR_LUMP_SETTING_KEY}:`));

if (failed) {
  console.error(`\n${failed} ข้อไม่ผ่าน`);
  process.exit(1);
}
console.log('\nเรทเหมา (ลำดับเรื่อง + รายอำเภอ): ผ่านทุกข้อ');
process.exit(0);
