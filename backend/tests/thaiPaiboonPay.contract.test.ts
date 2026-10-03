/**
 * Contract test — งานไทยไพบูลย์: ระบบยังไม่เติมเรททั้ง 2 ฝั่ง ให้หัวหน้ากรอกเองทั้งหมด (user เคาะ 03/10/69)
 *
 * ที่มา: ตารางเรทในระบบมาจากงานไอโออิ · เดิมงานไทยไพบูลย์ (เลขเซอร์เวย์ SETP) ได้เรทไอโออิเติมให้เงียบ ๆ ทั้งฝั่งเบิกประกัน
 * และฝั่งพนักงาน (มีแค่ค่ารูปที่ไม่เติม) · ตรวจเรทไทยไพบูลย์กับงานจริงแล้ว แต่ user ให้ "เป็นค่าว่างไว้ก่อน" จนกว่าจะสั่งตั้งเรท
 *
 * ล็อกไว้:
 *  1) แยกงานไทยไพบูลย์จากเลขเซอร์เวย์ SETP ก่อน ไม่มีเลขค่อยดูชื่อบริษัท (ตัวเดียวกับกติกาค่ารูป)
 *  2) getCasePay ล้างเรทแนะนำทุกช่อง (ค่าบริการพนักงาน · ค่าบริการ/ค่าพาหนะฝั่งประกัน · ที่มา · เรทเต็ม) + ติดธง thai_paiboon
 *  3) หน้าตรวจบอกเหตุผล และไม่ขึ้นกล่อง "บริษัทนอก/ไม่พบเรท" ปน
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import { isThaiPaiboon } from '../src/services/photoFee.service';

let failed = 0;
function check(name: string, cond: boolean) {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}`);
  if (!cond) failed++;
}
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

// ── 1) แยกงานไทยไพบูลย์ ──
check('เลขเซอร์เวย์ SETP = ไทยไพบูลย์', isThaiPaiboon({ survey_job_no: 'SETP-226091000123' }) && isThaiPaiboon({ survey_job_no: 'setp226091000123' }));
check('เลขเซอร์เวย์ SEABI = ไม่ใช่ (ถึงชื่อบริษัทจะพิมพ์ผิดมา)', !isThaiPaiboon({ survey_job_no: 'SEABI-120261000032', insurance_company: 'ไทยไพบูลย์' }));
check('ไม่มีเลขเซอร์เวย์ → ดูชื่อบริษัท', isThaiPaiboon({ survey_job_no: '', insurance_company: 'บริษัท ไทยไพบูลย์ประกันภัย จำกัด (มหาชน)' })
  && !isThaiPaiboon({ survey_job_no: '', insurance_company: 'บริษัท ไอโออิ กรุงเทพ ประกันภัย จำกัด (มหาชน)' }));

// ── 2) backend ไม่เติมเรท ──
const pay = read('src', 'services', 'pay.service.ts');
const fn = pay.slice(pay.indexOf('export async function getCasePay'), pay.indexOf('export interface SavePayInput'));
check('getCasePay อ่านชื่อบริษัทด้วย (งานที่ยังไม่มีเลขเซอร์เวย์)', fn.includes('sr.insurance_company'));
const block = fn.slice(fn.indexOf('if (isThaiPaiboon('), fn.indexOf('return {', fn.indexOf('if (isThaiPaiboon(')));
check('งานไทยไพบูลย์ล้างเรทแนะนำทุกช่อง + ติดธง',
  block.length > 0
  && ['suggest.service_fee = null;', 'suggest.ins_service_fee = null;', 'suggest.ins_travel_fee = null;', 'suggest.ins_note = null;', 'suggest.full_rate = null;', 'suggest.thai_paiboon = true;']
    .every((s) => block.includes(s)));
check('ล้างหลังกติกา "ไปถึงแล้วไม่พบ" (เรทเต็มของไอโออิต้องไม่หลุดไปโชว์)', fn.indexOf('if (isNotFoundFault(') < fn.indexOf('if (isThaiPaiboon('));
check('ใช้ตัวแยกตัวเดียวกับกติกาค่ารูป', /import \{[^}]*isThaiPaiboon[^}]*\} from '\.\/photoFee\.service'/.test(pay));

// ── 3) หน้าตรวจ ──
const ui = read('..', 'web', 'src', 'components', 'cases', 'CaseDetail.tsx');
check('หน้าตรวจบอกว่าเป็นงานไทยไพบูลย์ ระบบไม่เติมเรท', ui.includes('{pay.suggest?.thai_paiboon && (') && ui.includes('งานไทยไพบูลย์ — ระบบยังไม่เติมเรททั้งฝั่งเบิกประกันและฝั่งพนักงาน กรอกเองทั้งหมด'));
check('ไม่ขึ้นกล่องบริษัทนอก/ไม่พบเรทปน', (ui.match(/!pay\.suggest\.not_found && !pay\.suggest\.thai_paiboon/g) ?? []).length === 2);

if (failed) {
  console.error(`\n${failed} ข้อไม่ผ่าน`);
  process.exit(1);
}
console.log('\nงานไทยไพบูลย์ไม่เติมเรท: ผ่านทุกข้อ');
process.exit(0);
