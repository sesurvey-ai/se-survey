/**
 * Contract test — งานบริษัทนอก/OSS ไม่เสนอค่าบริการฝั่งพนักงาน (user เคาะ 02/10/69)
 *
 * กติกา: ช่องผู้สำรวจ (acc_surveyor) ขึ้นต้นด้วยรหัส SE/SEC ตามด้วยตัวเลข = ช่าง SE · นอกนั้นทั้งหมด = บริษัทนอก/OSS
 *        บริษัทนอก/OSS → ระบบไม่เติมค่าบริการฝั่งพนักงาน (หัวหน้ากรอกเอง) · ฝั่งเรียกเก็บประกันเติมตามปกติ — ทุกจังหวัด
 * ที่มา: เดิม getCasePay ส่ง isSE: true ตายตัว → จังหวัดเรทไม่แยกทีม (สระแก้ว · ภูเก็ต ฯลฯ) เติมเลขของช่าง SE
 *        ให้งานบริษัทนอก ซึ่งได้จริงสูงกว่า ~300 บาท (โคราช สระแก้ว 1,100 vs 800 · PNS ภูเก็ต)
 *
 * ล็อกไว้:
 *  1) isSeSurveyor แยกถูก ตามรูปแบบจริงจาก ISURVEY/แอป
 *  2) computePay: OSS ได้ค่าบริการพนักงาน null แต่ฝั่งเบิกครบเหมือนช่าง SE · snapshot.is_se = false · พื้นที่แยกทีมก็เหมือนกัน
 *  3) ต่อสาย: getCasePay ส่ง isSE จาก isSeSurveyor(acc_surveyor) (ไม่ใช่ true ตายตัว) · หน้าตรวจขึ้นข้อความงานบริษัทนอก
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import { isSeSurveyor, computePay, ResolvedRates } from '../src/services/pay.service';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}

// ── 1) แยกช่าง SE / บริษัทนอก ──
check('รหัส SEC นำหน้า = ช่าง SE', isSeSurveyor('SEC125 นาย ก ข') && isSeSurveyor('SEC435'));
check('รหัส SE นำหน้า (กทม.) = ช่าง SE', isSeSurveyor('SE121 นาย ก ข') && isSeSurveyor('SE169นาย ก'));
check('ตัวเล็ก/มีวรรค ก็นับเป็นช่าง SE', isSeSurveyor(' sec435 ก') && isSeSurveyor('SEC 435 ก'));
check('ชื่อบริษัท/หจก. = บริษัทนอก',
  !isSeSurveyor('บริษัท พีเอ็นเอส เซ็นเตอร์เคลม') && !isSeSurveyor('ห้างหุ้นส่วนจำกัดอีเว้นท์เคลม') && !isSeSurveyor('หจก. กรกฎสำรวจภัย'));
check('ชื่อคนไม่มีรหัส / ว่าง = บริษัทนอก', !isSeSurveyor('นาย ก ข') && !isSeSurveyor('') && !isSeSurveyor(null) && !isSeSurveyor(undefined));
check('รหัสไม่ได้อยู่หน้า = บริษัทนอก (กติกา "ขึ้นต้นด้วย")', !isSeSurveyor('นาย ก SEC125'));
check('คำนำหน้าเลขเซอร์เวย์/รหัสอื่นไม่ใช่รหัสช่าง', !isSeSurveyor('SETP บริษัท') && !isSeSurveyor('SEMS') && !isSeSurveyor('OSS12 นาย ก'));

// ── 2) คิดยอด ──
const FLAT: ResolvedRates = { amphur: { sur_invest: 800, ins_invest_12: 1200, ins_invest_34: 1200, ins_trans: 350, ins_photo_12: 50 } };
const se = computePay(FLAT, { mtypeId: '1', isSE: true });
const oss = computePay(FLAT, { mtypeId: '1', isSE: false });
check('ช่าง SE ได้เรทฐาน', se.surInvest === 800 && se.snapshot.is_se === true);
check('บริษัทนอก: ค่าบริการพนักงาน null', oss.surInvest === null && oss.snapshot.is_se === false);
check('บริษัทนอก: ฝั่งเบิกครบเหมือนช่าง SE',
  oss.insInvest === se.insInvest && oss.insTrans === se.insTrans && oss.insPhoto === se.insPhoto && oss.insInvest === 1200);
const TEAM: ResolvedRates = { amphur: { sur_invest_by_team: { 'กระบี่': 700 }, ins_invest_12: 1200, ins_invest_34: 1200 } };
const ossTeam = computePay(TEAM, { mtypeId: '3', team: null, isSE: false });
check('พื้นที่แยกทีม: บริษัทนอกก็ null + ฝั่งเบิกยังได้', ossTeam.surInvest === null && ossTeam.insInvest === 1200);

// ── 3) ต่อสาย ──
const root = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const pay = read('backend/src/services/pay.service.ts');
check('getCasePay ส่ง isSE จากช่องผู้สำรวจ', /isSE: isSeSurveyor\(r\.acc_surveyor\)/.test(pay));
check('ไม่มี isSE: true ตายตัวเหลืออยู่', !/isSE: true/.test(pay));
const web = read('web/src/components/cases/CaseDetail.tsx');
check('หน้าตรวจบอกว่าเป็นงานบริษัทนอก (ไม่ใช่หาเรทไม่เจอ)',
  /snapshot\?\.is_se === false/.test(web) && web.includes('งานบริษัทนอก/OSS'));

if (failed) {
  console.error(`\n${failed} ข้อไม่ผ่าน`);
  process.exit(1);
}
console.log('\nงานบริษัทนอก/OSS ไม่เสนอฝั่งพนักงาน: ผ่านทุกข้อ');
process.exit(0);
