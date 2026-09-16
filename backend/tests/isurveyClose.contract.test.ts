/**
 * Contract test — ตารางค่าสำรวจที่เขียนกลับ ISURVEY ตอนอนุมัติ (services/isurveyPull.service.ts buildIsurveyRates)
 *
 * ล็อกกติกา (user เคาะ 16/09/69 รอบ 3 หลังเห็นเคส #337: นอกเวลา 200 โผล่เป็น "ค่าใช้จ่ายอื่นๆ" บน ISURVEY):
 *  1) ฝั่งพนักงาน (sur) = **ยอดรวมที่บันทึกไว้ (survey_pay.total) ยอดเดียว ลงช่อง "ค่าบริการ"** — แถวอื่นทุกแถว 0 · "หักเงิน" ของ ISURVEY = 0
 *     (total ของเว็บหักเงินออกแล้ว ส่งซ้ำจะโดนหักสองรอบ) · total ว่าง = ไม่แตะฝั่งเสนอ · ติดลบ = 0
 *     ISURVEY ไม่มีแถวนอกเวลา/นอกพื้นที่ รู้แค่ธง ซึ่ง service คงค่าเดิมไว้ · ยอดรวมเซอร์เวย์บน ISURVEY = ยอดเว็บเสมอ (400 + นอกเวลา 200 → 600)
 *  2) se-billing ยังได้แยกรายการ + นอกพื้นที่/นอกเวลาตามสูตรเดิม (คนละท่อ ห้ามเปลี่ยนตามข้อ 1)
 *  3) ฝั่งประกัน (ins) = ราคาต่อหน่วย × จำนวน · "อื่น ๆ" = other_fee_price + คำอธิบาย
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

{
  const svc = read('src/services/isurveyPull.service.ts');
  const i = svc.indexOf('function buildIsurveyRates(');
  const fn = svc.slice(i, svc.indexOf('\n}\n', i));
  check('มี buildIsurveyRates', i > 0 && fn.length > 100);
  const sur = fn.slice(fn.indexOf('out.sur = {'), fn.indexOf('};', fn.indexOf('out.sur = {')));
  check('sur.invest = survey_pay.total ยอดเดียว (ไม่ติดลบ) — ไม่คำนวณจากรายแถว/นอกเวลา/นอกพื้นที่เอง',
    /invest:\s*Math\.max\(0,\s*num\(r\.pay_total\)\)/.test(sur) && !/r\.(service_fee|travel_fee|photo_fee|other_fee|deduct_fee|out_of_area|out_of_hours)\b/.test(fn));
  check('sur แถวอื่นทุกแถว = 0 และหักเงิน = 0 (total หักไปแล้ว ห้ามหักซ้ำ)',
    ['trans: 0', 'photo: 0', 'tel: 0', 'insure: 0', 'claim: 0', 'daily: 0', 'other: 0', 'deduct: 0'].every((k) => sur.includes(k)));
  check('total ว่าง (ยังไม่กรอกเรท) = ไม่แตะฝั่งเสนอ', fn.includes('if (r.pay_case_id && r.pay_total != null)'));
  check('closeCase ดึง survey_pay.total มาเป็น pay_total', svc.includes('sp.total AS pay_total'));
  const pay = read('src/services/pay.service.ts');
  check('total ของเว็บ = รายรับทุกแถว + นอกพื้นที่/นอกเวลา − หักเงิน (ที่มาของยอดเดียวที่ส่ง)',
    pay.includes('+ (areaAmt ?? 0) + (hoursAmt ?? 0) - (money[PAY_DEDUCT_FIELD] ?? 0))'));
  const ins = fn.slice(fn.indexOf('out.ins = {'), fn.indexOf('};', fn.indexOf('out.ins = {')));
  check('ins = ราคา × จำนวน + other_fee_price/other_desc',
    ins.includes('invest: svcP * svcN') && ins.includes('photo: phoP * phoN') && ins.includes('other: num(r.other_fee_price)') && ins.includes('other_desc:'));
  check('ไม่มีข้อมูลฝั่งไหน = ไม่ส่งฝั่งนั้น', fn.includes('if (r.pay_case_id && r.pay_total != null)') && fn.includes('if (r.exp_id)') && fn.includes('Object.keys(out).length ? out : undefined'));

  const bill = read('src/services/sebilling.service.ts');
  check('se-billing ยังรวมนอกพื้นที่/นอกเวลาเข้าเงินพนักงาน (คนละท่อกับ ISURVEY)',
    /out_of_area_amt\)\s*\?\?\s*50/.test(bill) && /out_of_hours_amt\)\s*\?\?\s*100/.test(bill));
}

// ฝั่งบอท (se-autokey ข้าง ๆ — ข้ามถ้าไม่มี): ช่อง OTHER ของ ISURVEY มาจาก rates.sur.other / rates.ins.other ตรง ๆ ไม่มีสูตรเพิ่ม
{
  const bot = path.join(__dirname, '..', '..', '..', 'se-autokey', 'autokey', 'isurvey_close.py');
  if (fs.existsSync(bot)) {
    const c = fs.readFileSync(bot, 'utf8');
    check('บอท: SUR_OTHER/INS_OTHER = ค่าที่ backend ส่ง (money("OTHER", sur_val/ins_val)) ไม่บวกอะไรเพิ่ม',
      c.includes('p["tab1_SUR_OTHER-inputEl"] = money("OTHER", sur_val("OTHER"), use_sur)')
      && c.includes('p["tab1_INS_OTHER-inputEl"] = money("OTHER", ins_val("OTHER"), use_ins)')
      && !/out_of_hours|out_of_area|นอกเวลา|นอกพื้นที่/.test(c));
    check('บอท: ธง ใน/นอกเวลา + นอกพื้นที่ คงค่าเดิมของ ISURVEY',
      c.includes('"tab1_rd-in_out": (_s(claim.get("wrkTime"))') && c.includes('"tab1_chk_co_area": (_s(claim.get("COArea"))'));
  } else {
    console.log('[SKIP] ไม่มี repo se-autokey ข้าง ๆ — ข้ามเทสฝั่งบอท');
  }
}

console.log(failed ? `\n${failed} FAILED ❌` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
