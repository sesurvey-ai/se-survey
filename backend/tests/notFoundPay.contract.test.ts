/**
 * Contract test — ผลคดี "ไปถึงแล้วไม่พบ" → ระบบไม่เติมเรททั้ง 2 ฝั่ง ให้หัวหน้ากรอกเอง (user เคาะ 02/10/69)
 *
 * ที่มา: งานจริง 2567–69 (99 งาน) มี 2 แบบที่ผลคดีแยกไม่ออก
 *   ไม่ได้ออกตรวจ = จ่ายลด (เบิกแค่ค่าพาหนะ · ช่างได้ลดลง เช่น กทม. 300/100 · ใบ EMCS จริงเคลม 2026013032772 มีแค่แถวค่าเดินทาง)
 *   ได้ไปตรวจที่อื่น เช่น อู่ (เคลม 2026013115959) = จ่ายเต็มตามเรทปกติ
 * เดิมระบบเติมเรทเต็มเงียบ ๆ (กทม. เบิก 700 / ช่าง 300) — ลืมแก้ = เบิกเกิน
 *
 * ล็อกไว้:
 *  1) isNotFoundFault จับทั้งแบบมี/ไม่มีเว้นวรรค · ค่ารูปยังไม่เติม (ข้อ 2 ของกติกาค่ารูป)
 *  2) getCasePay อ่านผลคดี (ที่บันทึก + ที่ส่งมาจากหน้า) → ค่าแนะนำ 3 ช่องเป็น null · ส่ง full_rate ไว้โชว์ · ติดธง not_found
 *  3) หน้าตรวจ: ส่งผลคดีที่กำลังเลือกไปขอเรท · ล้างเลขที่ระบบเติมไว้ (ไม่แตะที่บันทึก) · ไม่เติมค่ารูป · บอกเหตุผล ·
 *     อนุมัติได้เมื่อมีค่าพาหนะแทนค่าบริการ
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import { isNotFoundFault, standardPhotoFee } from '../src/services/photoFee.service';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}

// ── 1) ตัวจับผลคดี + ค่ารูป ──
check('จับ "ไปถึงแล้วไม่พบ" ทั้งมี/ไม่มีเว้นวรรค',
  isNotFoundFault('ไปถึงแล้วไม่พบ') && isNotFoundFault('ไปถึง แล้วไม่พบ') && isNotFoundFault(' ไปถึงแล้วไม่พบ '));
check('ผลคดีอื่น/ว่าง = ไม่ใช่', !isNotFoundFault('ผิด') && !isNotFoundFault('คู่กรณีผิด') && !isNotFoundFault('') && !isNotFoundFault(null));
const ph = standardPhotoFee({ survey_job_no: 'SEABI-120260400529', acc_fault: 'ไปถึงแล้วไม่พบ', visit_no: 1 });
check('ค่ารูปยังไม่เติม', !!ph && ph.count === 0 && ph.price === 0, ph?.reason);

// ── 2) backend ──
const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const pay = read('backend/src/services/pay.service.ts');
check('getCasePay อ่านผลคดีที่บันทึกไว้', /sr\.acc_fault/.test(pay));
check('ใช้ผลคดีที่หน้าส่งมาก่อน (ยังไม่บันทึก/ครั้งที่ 2+)', /isNotFoundFault\(pick\(override\.acc_fault, r\.acc_fault\)\)/.test(pay));
const nfBlock = pay.slice(pay.indexOf('if (isNotFoundFault(pick('), pay.indexOf('if (isNotFoundFault(pick(') + 600);
check('ไม่เติม 3 ช่อง (ค่าบริการพนักงาน · ค่าบริการประกัน · ค่าพาหนะ)',
  /suggest\.service_fee = null/.test(nfBlock) && /suggest\.ins_service_fee = null/.test(nfBlock) && /suggest\.ins_travel_fee = null/.test(nfBlock));
check('ส่งเรทเต็มไว้โชว์ + ติดธง', /suggest\.full_rate = \{/.test(nfBlock) && /suggest\.not_found = true/.test(nfBlock));
const ctl = read('backend/src/controllers/case.controller.ts');
check('API รับผลคดีจากหน้า', /acc_fault: q\('acc_fault'\)/.test(ctl));

// ── 3) หน้าตรวจ ──
const web = read('web/src/components/cases/CaseDetail.tsx');
check('ขอเรทพร้อมผลคดี (โหลดแรก + ตอนเปลี่ยน)',
  /params: \{ acc_fault: String\(report\.acc_fault \?\? ''\) \}/.test(web) && /params\.acc_fault = faultNow/.test(web)
  && /survTumbon, faultNow, caseData\.id, previewing\]/.test(web));
check('ฟังการเปลี่ยนผลคดีจากฟอร์ม', /t\?\.name === 'acc_fault' && t\.checked\) setFaultNow\(t\.value\)/.test(web));
check('ล้างเลขที่ระบบเติมไว้เมื่อเรทแนะนำหาย (ไม่แตะยอดที่บันทึก)',
  /else if \(!\(typeof v === 'number' && v > 0\) && cur !== '' && !\(Number\(String\(savedVal/.test(web));
check('ไม่เติมค่ารูปเมื่อเลือกไปถึงแล้วไม่พบบนหน้า', /photoFeeUnset && !notFoundNow\) \? photoFeeSuggest : null/.test(web));
check('บอกเหตุผล + เรทเต็มไว้ประกอบ', /pay\.suggest\?\.not_found && \(/.test(web) && /pay\.suggest\.full_rate\.ins_travel/.test(web));
check('อนุมัติได้เมื่อมีค่าพาหนะแทนค่าบริการ', /const insMissing = payRequired && !val\('input\[name="service_fee_price"\]'\) && !travelOnly/.test(web));

if (failed) {
  console.error(`\n${failed} ข้อไม่ผ่าน`);
  process.exit(1);
}
console.log('\nไปถึงแล้วไม่พบ (ไม่เติมเรท): ผ่านทุกข้อ');
process.exit(0);
