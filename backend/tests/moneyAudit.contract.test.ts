/**
 * การ์ดของ "ประวัติการแก้ยอดเงิน"
 *
 * ทำไมต้องมี: ยอดเงินไหลไปทั้งใบเบิกเงินพนักงานและใบเรียกเก็บบริษัทประกัน
 * แต่ประโยชน์หลักไม่ใช่ "จับคนโกง" — คือ **แยกให้ออกว่า "คนแก้" หรือ "บั๊กกลืนข้อมูล"**
 * (ส.ค. 69 เดือนเดียวเจอบั๊กยอดหายเงียบ ๆ 2 ตัว: 22311fb, c827596)
 *
 * ครึ่งแรกเรียกฟังก์ชันเทียบค่าจริง (ไม่แตะฐานข้อมูล) ครึ่งหลังตรวจการต่อสาย
 */
import * as fs from 'fs';
import * as path from 'path';
import { MONEY_LABELS } from '../src/services/moneyAudit';

let failed = 0;
const check = (label: string, ok: boolean, note = '') => {
  if (!ok) failed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${note ? `  (${note})` : ''}`);
};
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

console.log('\n── ประวัติการแก้ยอดเงิน ──');

const mig = read('src', 'db', 'migrations', '043_money_audit.sql');
check('มีตาราง money_audit', /CREATE TABLE IF NOT EXISTS money_audit/.test(mig));
/** ลบเคสแล้วประวัติต้องหายตาม ไม่ค้างเป็นขยะที่ชี้ไปเคสที่ไม่มีแล้ว */
check('ลบเคส → ประวัติหายตาม', /REFERENCES cases\(id\) ON DELETE CASCADE/.test(mig));
check('แยกฝั่งเงิน 2 ฝั่ง (จ่ายพนักงาน/เรียกเก็บประกัน)', /CHECK \(kind IN \('pay', 'expense'\)\)/.test(mig));
check('มี index สำหรับอ่านประวัติของเคส', /ix_money_audit_case/.test(mig));

/** kind ที่ 3 "ยอดความเสียหาย" (migration 063, เคส #343 15/09/69) — รถประกัน + คู่กรณีรายคัน */
const mig063 = read('src', 'db', 'migrations', '063_money_audit_damage.sql');
check('063: ขยาย CHECK ให้รับ kind damage', /CHECK \(kind IN \('pay', 'expense', 'damage'\)\)/.test(mig063));
check('ป้ายไทยฝั่งยอดความเสียหาย: รถประกัน + คู่กรณี 9 คัน',
  MONEY_LABELS.damage.estimated_cost === 'ค่าเสียหายรถประกัน' && MONEY_LABELS.damage.opponent_1_cost === 'ค่าเสียหายคู่กรณีคันที่ 1'
  && !!MONEY_LABELS.damage.opponent_9_cost);
{
  const { damageSnapshot } = require('../src/services/moneyAudit') as typeof import('../src/services/moneyAudit');
  const snap = damageSnapshot({ estimated_cost: '4000.00', opposing_parties: JSON.stringify([{ estimated_cost: '8000' }, { estimated_cost: '' }]) });
  check('damageSnapshot อ่านได้ทั้ง JSON string และ array · คู่กรณีตามลำดับคัน',
    snap.estimated_cost === '4000.00' && snap.opponent_1_cost === '8000' && snap.opponent_2_cost === '' && !('opponent_3_cost' in snap));
  const cs = read('src', 'services', 'case.service.ts');
  check('updateReport จดประวัติยอดความเสียหาย (ก่อน-หลัง UPDATE ใน transaction เดียวกัน)',
    /const damageBefore = damageSubmitted[\s\S]{0,400}?kind: 'damage'/.test(cs));
}

/** ป้ายไทยครบทุกช่องที่เก็บ — ไม่มีป้าย = โชว์ชื่อคอลัมน์ดิบให้ผู้ตรวจอ่าน */
const payFields = Object.keys(MONEY_LABELS.pay);
const expFields = Object.keys(MONEY_LABELS.expense);
check('ป้ายไทยฝั่งจ่ายพนักงานครบ', payFields.length >= 20, `${payFields.length} ช่อง`);
check('ป้ายไทยฝั่งเรียกเก็บประกันครบ', expFields.length >= 13, `${expFields.length} ช่อง`);
check('ไม่มีป้ายซ้ำในฝั่งเดียวกัน',
      new Set(Object.values(MONEY_LABELS.expense)).size === expFields.length);
/** ⛔ ช่องพวกนี้เปลี่ยนทุกครั้งที่บันทึก ถ้าเก็บด้วยประวัติจะเต็มไปด้วยขยะ */
for (const noisy of ['updated_at', 'priced_at', 'rate_snapshot', 'priced_by', 'created_at', 'id', 'report_id', 'case_id']) {
  check(`ไม่เก็บช่องระบบ: ${noisy}`, !payFields.includes(noisy) && !expFields.includes(noisy));
}

const svc = read('src', 'services', 'moneyAudit.ts');
/**
 * ⛔ numeric จาก Postgres คืน "400.00" แต่ฟอร์มส่ง "400" — เทียบเป็นข้อความ
 *    จะนับเป็นการเปลี่ยนแปลงทุกครั้งที่กดบันทึก ประวัติเต็มไปด้วยรายการปลอม
 */
check('เทียบตัวเลขด้วยค่า ไม่ใช่ข้อความ', /Number\.isFinite\(fa\) && Number\.isFinite\(fb\)\) return fa === fb/.test(svc));
check('บูลีนเก็บเป็นคำอ่านออก', svc.includes("? 'ใช่' : 'ไม่'"));
/**
 * ⛔ ตอนกรอกยอดครั้งแรกยังไม่มีแถวในตาราง ช่องติ๊กที่ไม่ได้ติ๊กจะเป็น null → false
 *    ถ้านับเป็นการเปลี่ยน ประวัติครั้งแรกจะมี "นอกเวลา: (ว่าง) → ไม่" ทุกช่องติ๊ก = ขยะล้วน
 *    (เจอจริงตอนทดสอบบน production 24/08/69) · ติ๊กแล้วเอาออก (true → false) ยังบันทึกอยู่
 */
check('ช่องติ๊กที่ไม่ได้ติ๊ก ไม่นับเป็นการเปลี่ยน',
      /v === '' \|\| v === false/.test(svc));
check('เขียนทีเดียวหลายแถว ไม่วิ่งทีละช่อง', /INSERT INTO money_audit[\s\S]{0,120}VALUES \$\{tuples\.join/.test(svc));

const pay = read('src', 'services', 'pay.service.ts');
/** ประวัติที่ขาดเป็นช่วง ๆ แย่กว่าไม่มีเลย เพราะเชื่อสิ่งที่เห็นไม่ได้ */
check('บันทึกยอดพนักงานอยู่ใน transaction เดียวกับประวัติ',
      /await client\.query\('BEGIN'\)/.test(pay) && /recordMoneyChanges\(client, \{/.test(pay));
check('เทียบกับยอดเดิมที่อ่านมาก่อนเขียน', /SELECT \* FROM survey_pay WHERE case_id = \$1/.test(pay));

const cs = read('src', 'services', 'case.service.ts');
/**
 * ⛔ survey_expenses เขียนด้วยท่า DELETE-แล้ว-INSERT ทุกครั้ง — ต้องจำค่าเดิมไว้ "ก่อนลบ"
 *    ไม่งั้นแยกไม่ออกระหว่าง "แก้ 400 → 600" กับ "ลบทิ้งแล้วใส่ 600"
 */
check('จำยอดเรียกเก็บเดิมไว้ก่อน DELETE',
      /const expenseBefore = expenseSubmitted/.test(cs)
      && cs.indexOf('const expenseBefore') < cs.indexOf("DELETE FROM survey_expenses WHERE report_id = $1"));
check('บันทึกประวัติฝั่งเรียกเก็บประกัน', /kind: 'expense', userId: opts\.userId/.test(cs));

const routes = read('src', 'routes', 'case.routes.ts');
check('มี endpoint อ่านประวัติ (เฉพาะผู้ตรวจ/แอดมิน)',
      /router\.get\('\/:id\/money-audit', auth, requireRole\('checker', 'admin'\)/.test(routes));

const web = read('..', 'web', 'src', 'components', 'cases', 'CaseDetail.tsx');
check('หน้าตรวจมีแผงประวัติ', web.includes('ประวัติการแก้ยอดเงิน'));
/** ส่วนใหญ่ไม่มีใครเปิดดู — ดึงมาพร้อมหน้าทุกครั้งคือยิงเปล่า */
check('โหลดตอนกางเท่านั้น', /if \(next && audit === null\)/.test(web));
/** ยอดที่หายไปเฉย ๆ คือสัญญาณที่ตามหา ต้องเห็นเด่นกว่าการแก้ปกติ */
check('ยอดที่หายไปขึ้นสีแดง', /a2\.new_value \? 'text-gray-800' : 'text-red-600/.test(web));
check('บอกด้วยว่าเก็บย้อนหลังไม่ได้', web.includes('การแก้ก่อนหน้านั้นไม่ได้บันทึกไว้'));
/**
 * ⛔ บันทึกแล้วประวัติเปลี่ยนแน่นอน — ถ้าไม่ล้างของที่โหลดไว้ จะกางดูแล้วเห็นภาพ
 *    ก่อนบันทึก แล้วนึกว่าระบบไม่ได้เก็บ (เจอจริงตอนกดใช้บน production 24/08/69)
 */
check('บันทึกแล้วแผงต้องโหลดใหม่ ไม่โชว์ของเก่า',
      web.includes('if (auditOpen) loadAudit(); else setAudit(null);'));

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด\n' : `\n❌ ไม่ผ่าน ${failed} ข้อ\n`);
process.exit(failed === 0 ? 0 : 1);
