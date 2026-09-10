/**
 * การ์ดของหน้าตรวจเคส — ตรวจ "ดอกจันต้องผูกกับช่องของตัวเอง"
 *
 * ทำไมต้องมี: กติกากดอนุมัติทั้งหมดถูกคำนวณจากดอกจัน (`.req-mark`) → ช่องที่มันคุม
 * ถ้าผูกผิด ผลคือ **กดอนุมัติไม่ได้ทั้งที่ข้อมูลครบ** (เจอจริง 15/08/69 เคส #141)
 *
 * เดิมหาช่องด้วยการเดาจากตำแหน่งใน DOM (ไต่ td ข้าง ๆ / ไต่ parent ขึ้นไป 5 ชั้น)
 * ซึ่งใช้ได้เฉพาะกับเลย์เอาต์ตาราง 4 คอลัมน์แบบเดิม — วินาทีที่เปลี่ยนเป็นการ์ด
 * ดอกจันจะคว้า input **ทุกช่องในการ์ด** แล้วทาแดง+นับช่องที่ไม่บังคับเข้าไปด้วย
 *
 * ตอนนี้ผูกด้วยชื่อช่อง (`<Req of="..." />`) เทสนี้กันไม่ให้มีดอกจันที่ลืมผูก
 * และกันชื่อช่องพิมพ์ผิด (ผูกไปยังช่องที่ไม่มีอยู่จริง = ดอกจันนั้นไม่คุมอะไรเลยแบบเงียบ ๆ)
 */
import * as fs from 'fs';
import * as path from 'path';

let failed = 0;
const BSD = String.fromCharCode(92) + 'd';
const check = (label: string, ok: boolean, note = '') => {
  if (!ok) failed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${note ? `  (${note})` : ''}`);
};

console.log('\n── หน้าตรวจเคส: ดอกจันต้องผูกกับช่องของตัวเอง ──');

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'web', 'src', 'components', 'cases', 'CaseDetail.tsx'), 'utf8');

const reqs = src.match(/<Req\b[^/>]*/g) ?? [];
check('พบดอกจันในฟอร์ม', reqs.length > 0, `${reqs.length} ตัว`);

/**
 * การ์ด "ลำดับเวลา" วาด 5 จังหวะจากตาราง `tl(...)` แทนที่จะเขียน JSX ซ้ำ 5 ชุด
 * ดอกจันของมันจึงเป็น `of={n.keys.join(',')}` ไม่ใช่สตริงตรง ๆ — ตรวจแยกตรงนี้
 * เพื่อไม่ต้องผ่อนกฎ "ดอกจันต้องผูกช่อง" ให้หลวมลงทั้งไฟล์
 */
const tlRows = Array.from(src.matchAll(/\btl\('([a-z_0-9]+)',\s*'([a-z_0-9]+)',\s*'([a-z_0-9]+)'/g));
const tlNames = tlRows.flatMap((m) => [m[1], m[2], m[3]]);
check('การ์ดลำดับเวลามีครบ 5 จังหวะ', tlRows.length === 5, `${tlRows.length} จังหวะ · ${tlNames.length} ช่อง`);
check('ช่องในการ์ดลำดับเวลาผูกชื่อจากตารางเดียวกัน',
      /name=\{n\.date\}/.test(src) && /name=\{n\.hour\}/.test(src) && /name=\{n\.min\}/.test(src));
check('ดอกจันของลำดับเวลาคุมทั้ง 3 ช่องของจังหวะนั้น', /<Req of=\{n\.keys\.join\(','\)\} \/>/.test(src));
// จังหวะ 6 "ส่งงาน" อ่านอย่างเดียว (10/09/69) — ไม่ผ่าน tl() ไม่มีช่องกรอก ไม่มีดอกจัน · กริดขยายเป็น 6 ช่อง
check('จังหวะ 6 "ส่งงาน" อ่านอย่างเดียวจาก submitted_at_th', src.includes('submitted_at_th') && src.includes('xl:grid-cols-6') && !/name="submitted_at/.test(src));

// ผ่อนให้เฉพาะดอกจันของลำดับเวลาเท่านั้น — ตัวอื่นยังต้องเป็นสตริงตรง ๆ
const TL_REQ = /\bof=\{n\.keys\.join\(','\)\}/;
const unbound = reqs.filter((r) => !/\bof="/.test(r) && !TL_REQ.test(r));
check('ดอกจันทุกตัวประกาศช่องที่ตัวเองคุม (of=)',
      unbound.length === 0,
      unbound.length ? `ยังไม่ผูก ${unbound.length} ตัว` : `${reqs.length} ตัว`);

const namesInFile = new Set([
  ...Array.from(src.matchAll(/name="([a-zA-Z_0-9]+)"/g), (m) => m[1]),
  ...tlNames,
]);
const targets = new Set<string>();
for (const r of reqs) {
  const m = /\bof="([^"]+)"/.exec(r);
  if (m) for (const n of m[1].split(',')) targets.add(n.trim());
}
const ghost = Array.from(targets).filter((n) => n && !namesInFile.has(n));
check('ไม่มีดอกจันชี้ไปช่องที่ไม่มีอยู่จริง (พิมพ์ผิด = ไม่คุมอะไรเลย)',
      ghost.length === 0, ghost.length ? ghost.join(', ') : `คุม ${targets.size} ช่อง`);

// ตัว resolve ต้องอ่าน data-req-of เป็นทางหลัก ไม่ใช่เดาตำแหน่ง
check('ตัวหาช่องอ่าน data-req-of เป็นทางหลัก',
      /data-req-of/.test(src) && /getAttribute\('data-req-of'\)/.test(src));
check('ตัวหาช่องรับ form เข้ามาเพื่อค้นด้วยชื่อช่อง',
      /function fieldsOfMark\(mark: Element, form\?: HTMLFormElement \| null\)/.test(src));

// ── ไม่มีช่องไหนถูกล็อกด้วย "ที่มาของงาน" อีกแล้ว ──
// เดิม `d = !isEditing || !payEditable` ผูกอยู่กับ 116 ช่องที่ไม่เกี่ยวกับเงิน
// ผลคือ **งานจากระบบเก่าแก้อะไรไม่ได้เลยทั้งหน้า** (เจอจริง 17/08/69 เคส #149)
console.log('\n── หน้าตรวจเคส: ล็อกเฉพาะช่องยอดเงิน ไม่ใช่ทั้งฟอร์ม ──');
check('ช่องทั่วไปไม่ถูกล็อกด้วยกติกาเรื่องเงิน', /const d = false;/.test(src));
// dPay ล็อกได้เฉพาะ "กำลังดูครั้งอื่น" (อ่านอย่างเดียว) — ห้ามผูกกับที่มาของงานอีก
check('ยอดจ่ายพนักงานไม่ถูกล็อกตามที่มาของงาน',
      /const dPay = previewing;/.test(src) && !/const dPay = [^;]*payRequired/.test(src));
// แก้มา 3 จังหวะ: ช่องทั่วไป (17/08) -> หักเงิน (17/08) -> ยอดรายรับ (18/08)
// ทุกครั้งคือ **ล็อกผิดแกน** — การล็อกที่ถูกมีอันเดียวคือ "อนุมัติแล้ว" ซึ่งทำที่ <fieldset disabled>
check('ไม่มีธงล็อกช่องตัวไหนผูกกับที่มาของงานอีก',
      !/const d[A-Za-z]* = !/.test(src));

// หักเงินแยกออกจากยอดรายรับ: เป็นกติกาของ se-survey เอง ระบบเดิมไม่มีช่องนี้และ
// se-billing ไม่มีที่เก็บ → ล็อกตามที่มาของงานคือล็อกผิดฝั่ง (user เคาะ 17/08/69 เคส #149)
const DEDUCT_NAME = /name="(?:pay_deduct_fee|deduct_late|deduct_docs|deduct_reason)"/;
const PAY_NAME = /name="(?:pay_[a-z_]+|out_of_area(?:_amt)?|out_of_hours(?:_amt)?|special_tumbon|daily_check|other_reason)"/;

const payLines = src.split('\n')
  .filter((l) => PAY_NAME.test(l) && !DEDUCT_NAME.test(l) && /disabled=\{/.test(l));
const payWrong = payLines.filter((l) => !/disabled=\{dPay\}/.test(l));
check('ช่องยอดรายรับทุกช่องใช้ธง dPay',
      payLines.length >= 10 && payWrong.length === 0,
      `${payLines.length} ช่อง${payWrong.length ? ` · ผิด ${payWrong.length}` : ''}`);

const deductLines = src.split('\n').filter((l) => DEDUCT_NAME.test(l) && /disabled=\{/.test(l));
const deductWrong = deductLines.filter((l) => !/disabled=\{dDeduct\}/.test(l));
check('ช่องหักเงินกรอกได้ทุกที่มาของงาน (ใช้ธง dDeduct)',
      deductLines.length === 4 && deductWrong.length === 0,
      `${deductLines.length} ช่อง${deductWrong.length ? ` · ยังล็อกอยู่ ${deductWrong.length}` : ''}`);

const generalWrong = src.split('\n')
  .filter((l) => /disabled=\{dPay\}/.test(l) && !PAY_NAME.test(l));
check('ไม่มีช่องทั่วไปหลุดไปใช้ธงเงิน', generalWrong.length === 0,
      generalWrong.length ? `${generalWrong.length} บรรทัด` : '');

/**
 * ── ตัวทาสีกรอบแดงต้องไม่ setState กลางทางที่ event กำลังไหล ──
 *
 * `<form>` เป็น ancestor ของทุกช่อง ส่วน React ดัก event ไว้ที่ `document` (เหนือ form)
 * ผูก paint กับ 'input' ตรง ๆ = re-render ก่อน React ได้เห็น event → React เขียนค่าเดิม
 * ทับช่อง controlled → พอถึงคิว React ค่าไม่เปลี่ยน จึง**ไม่ยิง onChange เลย**
 * ผลคือคู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน/ความเสียหาย + 5 dropdown cascade พิมพ์ไม่เข้าถาวร
 * (เจอจริง 17/08/69 เคส #149 — ช่อง uncontrolled ไม่โดน เลยดูเหมือนพังแค่บางช่อง)
 */
console.log('\n── หน้าตรวจเคส: ตัวทาสีกรอบแดงต้องไม่ทับค่าที่กำลังพิมพ์ ──');
check('ไม่ผูก paint กับ event ตรง ๆ',
      !/addEventListener\('(?:input|change)',\s*paint\)/.test(src));
check('หน่วง paint ออกไปหลัง event ไหลจบ (requestAnimationFrame)',
      /requestAnimationFrame\(paint\)/.test(src) && /cancelAnimationFrame\(raf\)/.test(src));
check('เลิก re-render ทิ้งเปล่าเมื่อรายการเท่าเดิม', /const setList = /.test(src));

/**
 * ── หน้าตรวจต้องกางทุกหมวดเสมอ ห้ามยุบ/ซ่อน ──
 *
 * เคยทำเป็น "โหมดสรุป" (หมวดที่กรอกครบยุบเหลือสรุป) แล้ว **ถอดออก 18/08/69**
 * เหตุผลของ user: หมวดที่ถูกยุบไว้คือหมวดที่ผู้ตรวจจะไม่เปิดดู แล้วปล่อยข้อมูลผิดผ่านไป
 * หน้านี้มีหน้าที่ "ตรวจ" ไม่ใช่ "อ่านสรุป" — เห็นน้อยลง = พลาดง่ายขึ้น
 *
 * และถ้าใครจะเอากลับมาจริง ๆ ห้ามถอด input ออกจาก DOM เด็ดขาด:
 * หน้านี้บันทึกด้วย `new FormData(form)` และ **survey_pay เป็น upsert ทั้งแถว**
 * ยอดที่ไม่ได้ส่งจะกลายเป็น NULL เงียบ ๆ
 */
console.log('\n── หน้าตรวจเคส: กางทุกหมวดเสมอ ──');
const secIds = Array.from(src.matchAll(/data-section="([a-z_]+)"/g), (m) => m[1]);
check('ยังมีหัวหมวดครบ (ไว้หาที่ + ติดป้ายยังกรอกไม่ครบ)', secIds.length >= 10, `${secIds.length} หมวด`);
check('ไม่มีสวิตช์ยุบหมวดหลงเหลือ', !/secOpen|secToggle|openSec/.test(src));
/**
 * ⛔ ห้ามซ่อน "หมวด" — ตรวจเฉพาะ element ที่มี data-section ไม่ใช่ทั้งไฟล์
 *
 * ข้อยกเว้นที่ user สั่งเอง 01/09/69: 3 ช่องเงินในการ์ดค่าใช้จ่าย (ค่าโทรศัพท์ /
 * ค่าประกันตัว / ค่าใช้จ่ายอื่นๆ) พับเก็บได้ เพราะเป็นช่องที่แทบไม่ได้ใช้ ไม่ใช่หมวดข้อมูล
 * ที่ต้องตรวจ — กติกาการซ่อนของมัน (ซ่อนด้วย CSS เท่านั้น + กางเองเมื่อมีค่า)
 * มีการ์ดคุมไว้ที่ expenseCard.contract.test.ts
 */
check('ไม่มีหมวดไหนถูกซ่อนด้วย class hidden', !/data-section="[a-z_]+"[^>]*hidden/.test(src));
check('ไม่มีหมวดไหนถูกถอดออกจาก DOM ตามเงื่อนไข',
      !/data-section[\s\S]{0,400}?\{\s*\w+\s*&&\s*\(\s*<div className="bg-white rounded-lg shadow/.test(src));

// ชื่อช่องซ้ำ = FormData หยิบไปแค่ตัวเดียว อีกตัวหายเงียบ ๆ ตอนบันทึก
// (เจอตอนย้าย "ความเห็นผู้ตรวจสอบ" ไปการ์ดตัดสินใจท้ายหน้า — ต้องย้าย ไม่ใช่ก๊อป)
// `(?<!\[)` ตัดสตริง selector ทิ้ง — `querySelector('input[name="x"]')` ไม่ใช่ช่องในฟอร์ม
// (ไม่ตัดแล้วจะฟ้องผิด 4 ชื่อที่ paint() ใช้อ่านค่า ทั้งที่ในฟอร์มมีช่องเดียว)
const RADIO_GROUPS =
  /^(acc_fault|acc_claim_opponent|claim_type|damage_level|acc_alcohol_test|acc_followup|driver_gender)$/;
const dupNames = Array.from(
  Array.from(src.matchAll(/(?<!\[)name="([a-zA-Z_0-9]+)"/g), (m) => m[1])
    .filter((n) => !RADIO_GROUPS.test(n))
    .reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<string, number>()))
  .filter(([, n]) => n > 1);
check('ไม่มีช่องชื่อซ้ำ (ยกเว้นกลุ่ม radio/checkbox ที่ต้องชื่อเดียวกัน)',
      dupNames.length === 0, dupNames.map(([k, n]) => `${k}×${n}`).join(', '));

/**
 * ── ป้าย "ยังกรอกไม่ครบ" ต้องอ่าน DOM หลัง React วาดเสร็จ ──
 *
 * ไฮไลต์แบบมีเงื่อนไข (claimHl / oppNoHl / payHl) เป็นคลาสที่ **React** คุม ไม่ใช่ paint()
 * ถ้านับป้ายอยู่ใน paint() จะอ่านคลาสของรอบก่อน → ป้ายช้าไป 1 จังหวะ:
 * ติ๊ก "การเรียกร้องค่าเสียหายจากคู่กรณี" แล้วกรอบแดงหายทันที แต่ป้ายยังค้างว่ายังไม่ครบ
 * (เจอจริง 18/08/69 ตอน user ทดลองใช้)
 */
console.log('\n── หน้าตรวจเคส: ป้าย "ยังกรอกไม่ครบ" ต้องไม่ช้าไป 1 จังหวะ ──');
const gapBlock = /useEffect\(\(\) => \{[\s\S]*?setGapSec\([\s\S]*?\}, \[([^\]]*)\]\);/.exec(src);
// เทียบด้วย "ตำแหน่ง" ไม่ใช่ regex คร่อม — `[\s\S]*?` ลากข้ามขอบเขตฟังก์ชันได้
// (เขียนแบบ regex ครั้งแรกแล้วมันไปเจอ setGapSec ของ effect ตัวถัดไป = ฟ้องผิด)
const paintEnd = src.indexOf('}, [report, isEditing, saveMsg, pay, payRequired, recalcSums]);');   // 08/09/69 เพิ่ม recalcSums (ค่าเรียกร้องเติมเอง)
check('นับป้ายอยู่นอก effect ของ paint',
      paintEnd > 0 && src.indexOf('setGapSec(') > paintEnd
      && src.split('setGapSec(').length - 1 === 1);
const gapDeps = gapBlock ? gapBlock[1].replace(/\s+/g, ' ') : '';
check('deps ครบทุกสถานะไฮไลต์ที่ React คุม',
      ['missing', 'claimHl', 'oppNoHl', 'payHl'].every((k) => gapDeps.includes(k)),
      gapDeps.slice(0, 80));

/**
 * ── แผงแก้ของแอดมินต้องไม่มี name ──
 *
 * แผงนี้อยู่ใน <form> เดียวกับฟอร์มหลัก ถ้าช่องในแผงมี name จะโดน `new FormData(form)`
 * เก็บไปด้วยตอนกดบันทึก → เขียนทับตัวระบุตัวเคสที่ตั้งใจล็อกไว้ (และซ้ำชื่อกับที่อื่นด้วย)
 */
console.log('\n── หน้าตรวจเคส: แผงแก้ของแอดมินต้องไม่หลุดเข้าฟอร์มหลัก ──');
const panel = /\{keyEdit && \(([\s\S]*?)\n              \)\}/.exec(src);
check('มีแผงแก้ของแอดมิน', Boolean(panel));
check('ช่องในแผงไม่มี name เลย', Boolean(panel) && !/\bname=/.test(panel![1]));
check('ปุ่มเปิดแผงขึ้นเฉพาะแอดมิน และเฉพาะตอนยังไม่อนุมัติ',
      /isAdmin && !approved && !keyEdit \? \(/.test(src));

/**
 * -- ค่าใช้จ่ายย้ายไปคอลัมน์ขวา (เฉพาะจอกว้าง) --
 *
 * `survey_pay` บันทึกแบบ "ทั้งแถว" — ช่องไหนไม่ถูกส่งไปด้วยจะกลายเป็น NULL
 * ห้ามซ่อน/ถอดช่องยอดเงินตามขนาดจอเด็ดขาด ต้องอยู่ครบใน DOM ทุกความกว้าง
 * แล้วค่อยใช้ CSS จัดตำแหน่งเอา · และต้องยังอยู่ใน <fieldset disabled> ตัวเดิม
 * ไม่งั้นเคสที่อนุมัติแล้วจะกลับมากรอกยอดทับได้
 */
console.log('\n-- หน้าตรวจเคส: ค่าใช้จ่ายอยู่คอลัมน์ขวาเฉพาะจอกว้าง --');
const payStart = src.indexOf('{/* ── ค่าใช้จ่าย (คอลัมน์ขวาบนจอกว้าง) ──');
const fsEnd = src.indexOf('</fieldset>');
const payBlock = payStart > 0 && fsEnd > payStart ? src.slice(payStart, fsEnd) : '';
check('ค่าใช้จ่ายยังอยู่ใน fieldset ที่ล็อกตอนอนุมัติแล้ว', payBlock.length > 0);
check('จอแคบกลับไปเรียงลงล่างเอง (คอลัมน์เดียว)',
      /className="grid grid-cols-1 min-\[1500px\]:grid-cols-\[/.test(src));
const payFields = Array.from(
  src.matchAll(/name="(pay_[a-z_]+|deduct_[a-z]+|out_of_[a-z]+|special_tumbon|daily_check)"/g),
  (m) => m[1]);
/**
 * ⛔ ตำบลพิเศษไม่อยู่ในรายการนี้แล้ว — ถอดช่องออกจากการ์ด 01/09/69 (user จะย้ายไป
 *    หมวดสถานที่เกิดเหตุ) คอลัมน์ยังอยู่ และ handleSave ส่งค่าเดิมกลับไปแทน fd.has()
 */
check('ช่องยอดเงินอยู่ครบ (ขาดช่องเดียว = ยอดช่องนั้นถูกล้างตอนบันทึก)',
      payFields.length === 15, `${payFields.length} ช่อง`);
check('⛔ ถอดช่องแล้วต้องส่งค่าเดิมกลับ ไม่ใช่ false',
      !/name="special_tumbon"/.test(src)
      && src.includes("payBody.special_tumbon = fd.has('special_tumbon') || Boolean(pay?.saved?.special_tumbon)"));
/**
 * ช่อง "ราคาต่อรูป" (photo_fee_price) ซ่อน**ถาวร**ไม่ใช่ตามจอ — ค่าที่เห็น/แก้คือช่องยอดรวม
 * photo_fee_total แล้ว syncPhotoFee คัดลอกกลับมาให้ทุกครั้ง จึงยังถูกส่งครบทุกความกว้าง (07/09/69)
 * ตัดช่องนี้ออกก่อนตรวจ — ช่องยอดเงินอื่นห้ามซ่อนเหมือนเดิม
 */
const payBlockShown = payBlock.replace(/<input[^>]*name="photo_fee_price"[^>]*>/g, '');
check('ไม่มีช่องยอดเงินช่องไหนถูกซ่อนตามขนาดจอ',
      payBlock.length > 0 && !/:hidden|className="hidden/.test(payBlockShown));

/**
 * -- ตีกลับให้ผู้สำรวจ --
 *
 * กติกาที่ user เคาะ 18/08/69: สถานะกลับเป็น "กำลังสำรวจ" · ไม่มีแจ้งเตือนเข้าเครื่อง ·
 * หัวหน้ายังแก้เองได้ · เหตุผลบังคับกรอก (ไม่บอกว่าให้แก้อะไร ช่างก็ส่งของเดิมกลับมา)
 *
 * 2 กับดักที่เทสนี้กันไว้:
 *   1. ช่องเหตุผลอยู่ใน <form> เดียวกับฟอร์มหลัก — มี name เมื่อไหร่โดน FormData เก็บไปด้วย
 *   2. ต้องบันทึกก่อนตีกลับ ไม่งั้นสิ่งที่หัวหน้าเพิ่งแก้ไม่ไปถึงเครื่องช่าง
 *      แล้วช่างส่งข้อมูลชุดเก่ากลับมาทับ
 */
console.log('\n-- หน้าตรวจเคส: ตีกลับให้ผู้สำรวจ --');
const sbStart = src.indexOf('const doSendBack');
const sbEnd = src.indexOf('const [keyEdit', sbStart);
const sbFn = sbStart > 0 && sbEnd > sbStart ? src.slice(sbStart, sbEnd) : '';
check('มีปุ่มตีกลับผู้สำรวจบนแถบหัวเคส', /ตีกลับผู้สำรวจ/.test(src));
check('บันทึกก่อนตีกลับเสมอ', /if \(!\(await handleSave\(\)\)\) return;/.test(sbFn));
check('ยิงไปที่ /send-back พร้อมเหตุผล', /send-back`, \{ reason \}/.test(sbFn));
// เทียบทั้งบรรทัดของช่องเหตุผล — สลับเป็น input/textarea หรือย้ายที่ก็ยังจับได้
const sbLine = src.split('\n').find((l) => l.includes('value={sbReason}'));
check('ช่องเหตุผลไม่มี name', Boolean(sbLine) && !/\bname=/.test(sbLine!));
// 07/09/69: ซ่อนตอนช่างกด "เสร็จงาน" แล้วยังไม่ส่ง (finishedWaiting) ด้วย — งานยังอยู่กับช่างเหมือนกัน
check('ตีกลับแล้วซ่อนปุ่ม (กันตีกลับซ้ำระหว่างรอช่าง)', /!waitingSurveyor && !finishedWaiting && \(/.test(src));

/**
 * -- รูป "รายการตรวจสอบ" ตอนอนุมัติ (08/09/69) --
 * api instance ตั้ง Content-Type: application/json เป็นค่าเริ่มต้น → อัป FormData ต้องบอก multipart เองทุกครั้ง
 * ไม่งั้น server ไม่เห็นไฟล์ แล้วอนุมัติไม่ผ่านด้วย "กรุณาเลือกรูปอย่างน้อย 1 ไฟล์" (เจอจริงเคลม 2026013074059)
 */
console.log('\n-- หน้าตรวจเคส: รูปรายการตรวจสอบตอนอนุมัติ --');
const chkFn = src.slice(src.indexOf('const prepareChecklistImage'), src.indexOf('const actionBar = approved'));
check('มีตัววาด/อัปรูปรายการตรวจสอบ', chkFn.length > 100 && chkFn.includes("fd.append('category', 'รูปรถประกัน')"));
check('อัปรูปบอก multipart เอง (ไม่ใช้ค่าเริ่มต้น JSON ของ api)', /'Content-Type':\s*'multipart\/form-data'/.test(chkFn));
check('วาดรูปก่อนบันทึก แล้วส่ง id รูปไปกับการบันทึกครั้งเดียว (ไม่บันทึก 2 รอบ)',
      /const chk = await prepareChecklistImage\(\);[\s\S]{0,200}saveWith\(chk \? \{ checklist: chk \} : \{\}\)/.test(src));

const svc = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'case.service.ts'), 'utf8');
const sbSvcStart = svc.indexOf('async sendBackToSurveyor');
const sbSvc = sbSvcStart > 0 ? svc.slice(sbSvcStart, svc.indexOf('\n  },', sbSvcStart)) : '';
check('เซอร์วิสตีกลับมีอยู่จริง', sbSvc.length > 0);
check('เหตุผลบังคับกรอก', /if \(!text\) throw new AppError\(400/.test(sbSvc));
check('อนุมัติแล้วตีกลับไม่ได้ (ต้องปลดล็อกก่อน)', /status === 'reviewed'/.test(sbSvc));
check('เคสที่ไม่มีผู้สำรวจตีกลับไม่ได้ (ไม่งั้นเคสหายเงียบ)', /if \(!assigned_to\)/.test(sbSvc));
check('เปลี่ยนสถานะแบบมี guard กันชนกับการอนุมัติ/ส่งซ้ำ',
      /WHERE id = \$1 AND status = 'surveyed'/.test(sbSvc));
check('หน้าตรวจสอบยังเห็นเคสที่ตีกลับแล้ว (หัวหน้าแก้เองได้)',
      /OR \(c\.status = 'assigned' AND c\.sent_back_at IS NOT NULL\)/.test(svc));
check('ส่งงานใหม่แล้วหมวดรูปที่ผู้ตรวจตั้งไว้ไม่หาย', /prevCats\.get\(/.test(svc));

/**
 * -- หน้าต่าง "ข้อมูลความเสียหาย" (ลอกหน้าจอ EMCS) --
 *
 * 2 กับดัก:
 *   1. หน้าต่างอยู่ใน <form> เดียวกับฟอร์มหลัก — ช่องไหนมี name จะโดน FormData เก็บไปด้วย
 *   2. ชื่อชิ้นส่วนใน checklist ต้องมาจากลิสต์เดียวกับที่ DamageEditor ใช้
 *      พิมพ์ชื่อใหม่เองเมื่อไหร่ บอทจับคู่ checklist ของ EMCS ไม่ได้ ของจะไหลลงช่องอิสระ
 *      พร้อมชื่อเพี้ยน (ดู se-autokey/autokey/emcs.py _match_damage_checklist)
 */
console.log(String.fromCharCode(10) + '-- หน้าตรวจเคส: หน้าต่างข้อมูลความเสียหาย --');
const dlg = fs.readFileSync(
  path.join(__dirname, '..', '..', 'web', 'src', 'components', 'cases', 'DamageDialog.tsx'), 'utf8');
const ed = fs.readFileSync(
  path.join(__dirname, '..', '..', 'web', 'src', 'components', 'cases', 'DamageEditor.tsx'), 'utf8');
const gal = fs.readFileSync(
  path.join(__dirname, '..', '..', 'web', 'src', 'components', 'cases', 'PhotoGallery.tsx'), 'utf8');
check('ไม่มีช่องไหนมี name (ไม่หลุดเข้าฟอร์มหลัก)', !/name=/.test(dlg));
check('ปุ่มเปิดหน้าต่างเป็น type="button" (กันฟอร์ม submit)',
      /type="button" disabled=\{d\} onClick=\{\(\) => setDmgOpen\(true\)\}/.test(src));
check('หน้าต่างอยู่นอก <fieldset> (อนุมัติแล้วยังกดปิดได้)',
      src.indexOf('<DamageDialog') > src.indexOf('</fieldset>'));

/** ตัดเนื้อในวงเล็บก้าม [...] ของ const ตัวนั้น — ใช้ indexOf ล้วน ไม่พึ่ง regex escape */
const between = (text: string, marker: string) => {
  const a = text.indexOf(marker);
  if (a < 0) return '';
  const b = text.indexOf('[', a), c = text.indexOf('];', b);
  return b < 0 || c < 0 ? '' : text.slice(b, c);
};
const quoted = (text: string) => Array.from(text.matchAll(/'([^']+)'/g), (x) => x[1]);
const parts = new Set([
  ...quoted(between(ed, 'export const PARTS_NO_SIDE')),
  ...quoted(between(ed, 'export const PARTS_WITH_SIDE')),
]);
const rowParts = quoted(between(dlg, 'const ROWS'));
check('checklist มีครบ 22 ชิ้นเท่าลิสต์ของ EMCS',
      parts.size === 22 && rowParts.length === 22, `${rowParts.length}/${parts.size}`);
check('ชื่อชิ้นส่วนทุกตัวมาจากลิสต์เดียวกับ DamageEditor (บอทถึงจะจับคู่ได้)',
      rowParts.length > 0 && rowParts.every((p2) => parts.has(p2)),
      rowParts.filter((p2) => !parts.has(p2)).join(', '));
check('เตือนเมื่อช่องอิสระเกิน 8 ช่อง (ฟอร์มสร้างเรื่องใหม่ของ EMCS มีแค่ 8)',
      /FREE_SAFE = 8/.test(dlg) && /freeUsed > FREE_SAFE/.test(dlg));

/**
 * -- ดู "ครั้งที่" อื่นของเลขเคลมเดียวกัน --
 *
 * EMCS เก็บทุกครั้งในเรื่องเดียว (ddlAdd_No) ฝั่งเรา 1 ครั้ง = 1 เคส
 * จึงให้ "ดูได้ทุกครั้ง แก้ได้เฉพาะเคสที่เปิดอยู่"
 *
 * ⛔ กับดัก: ช่องในรางขวาที่ disabled จะ **ไม่ถูกส่ง** ตอนกดบันทึก และ survey_pay
 *    บันทึกทั้งแถว → ยอดของเคสที่เปิดอยู่หายยกแถว ถ้าเผลอบันทึกระหว่างดูครั้งอื่น
 */
console.log(String.fromCharCode(10) + '-- หน้าตรวจเคส: ดูครั้งที่อื่นได้ แต่แก้ไม่ได้ --');
check('ครั้งอื่น = อ่านอย่างเดียว (ล็อกช่องยอดเงิน)', /const dPay = previewing;/.test(src));
check('บันทึกไม่ได้ระหว่างดูครั้งอื่น (กันเขียนข้ามเคส)',
      /if \(previewing\) \{[\s\S]{0,200}?return false;/.test(src));
check('ปุ่มบันทึก/อนุมัติ/ตีกลับ ปิดตอนดูครั้งอื่น',
      (src.match(/disabled=\{saving \|\| previewing/g) || []).length >= 2
      && /disabled=\{saving \|\| previewing \|\| approvalBlockers/.test(src));
check('สลับครั้งแล้วสร้างรางใหม่ (ไม่ให้ค่าเก่าค้างในช่อง uncontrolled)',
      /key=\{viewVisit \?\? 'self'\}/.test(src));
check('มียอดสะสมทั้งเคลม', /ยอดสะสมทั้งเคลม/.test(src) && /claimTotals/.test(src));

/**
 * -- กันงานที่พิมพ์ค้างไว้หาย --
 *
 * หน้านี้ไม่มี autosave/localStorage เลย ค่าที่ยังไม่กดบันทึกอยู่ใน DOM ล้วน ๆ
 * อะไรก็ตามที่ทำให้ component ถูกสร้างใหม่ = งานหายทั้งหน้าโดยไม่มีอะไรถาม
 */
console.log(String.fromCharCode(10) + '-- หน้าตรวจเคส: งานที่พิมพ์ค้างต้องไม่หาย --');
const pageSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'web', 'src', 'app', 'inspector', 'cases', '[id]', 'page.tsx'), 'utf8');
check('โหลดใหม่แล้วไม่ถอดทั้งหน้าทิ้ง (โชว์ตัวโหลดเฉพาะครั้งแรก)',
      /if \(firstLoad\.current\) setLoading\(true\)/.test(pageSrc));
check('สลับครั้งที่แล้วเก็บค่าที่พิมพ์ไว้ก่อน', /railDraft\.current = readRail\(\)/.test(src));
check('กลับมาครั้งเดิมแล้วเขียนค่าคืน', /railDraft\.current\[el\.name\]/.test(src));
check('เลือกครั้งของเคสตัวเอง = กลับเป็น self (ไม่สร้างรางใหม่ซ้ำซ้อน)',
      /to === Number\(caseData\?\.id\) \? null : to/.test(src));
check('ช่อง "ค่าคัดประจำวัน" รับค่าที่โหลดมาทีหลังได้', /key=\{`dc-\$\{String\(payV/.test(src));

/**
 * -- ดอกจันต้องบังคับจริง --
 * radio ไม่ถูกตัวไล่หาช่องว่างมองเห็น ต้องอยู่ใน REQ_RADIO_GROUPS เท่านั้นถึงจะนับ
 * ช่องพวกนี้ EMCS บังคับทุกบริษัท — ปล่อยผ่านหน้าเว็บ = บอทไปตายที่ปลายทาง
 */
console.log(String.fromCharCode(10) + '-- หน้าตรวจเคส: ดอกจันของ radio ต้องบังคับจริง --');
const radioLine = src.split(String.fromCharCode(10)).find((l) => l.includes('const REQ_RADIO_GROUPS')) || '';
for (const g of ['claim_type', 'damage_level', 'acc_fault', 'driver_gender']) {
  check(`นับ radio "${g}" เป็นช่องบังคับ`, radioLine.includes(`'${g}'`));
}
check('ยี่ห้อรถมีดอกจัน (EMCS บังคับ)', /label="ยี่ห้อ" req=\{<Req of="car_brand" \/>\}/.test(src));
// ดอกจันของ radio ทุกตัวต้องมีชื่ออยู่ในลิสต์ ไม่งั้นเป็นดอกจันหลอก
const radioReqs = ['acc_fault', 'claim_type', 'damage_level', 'driver_gender', 'acc_alcohol_test', 'acc_followup'];
const marked = radioReqs.filter((g) => src.includes(`<Req of="${g}"`));
const unenforced = marked.filter((g) => !radioLine.includes(`'${g}'`));
check('ไม่มีดอกจันของ radio ที่ไม่ถูกนับ', unenforced.length === 0, unenforced.join(', '));

/**
 * -- เวลาที่ส่งเข้าระบบประกันต้องเป็น 2 หลักเสมอ --
 * "16:5" ทำให้ตัวอ่านตอนสร้าง XML ทิ้งเวลาเป็น 00:00 ทั้งก้อน โดยหน้าเว็บไม่ฟ้องอะไร
 */
console.log(String.fromCharCode(10) + '-- เวลา: ต้องเติมศูนย์ทุกทาง --');
const svc2 = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'case.service.ts'), 'utf8');
const xml2 = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'xmlExport.service.ts'), 'utf8');
check('backend เติมศูนย์ก่อนเก็บลงคอลัมน์', /const pad2 = /.test(svc2)
      && /pad2\(g\(f\.hourKey\)\), m = pad2\(g\(f\.minKey\)\)/.test(svc2));
check('ตัวอ่านตอนสร้าง XML รับนาทีหลักเดียวได้ (แถวเก่าใน DB)',
      xml2.includes('const tm = /^(' + BSD + '{1,2}):(' + BSD + '{1,2})/'));
check('ลบวันที่ในการ์ดลำดับเวลาแล้วล้างคอลัมน์จริง',
      /if \(f\.dateKey in rd\) rd\[f\.dbCol\]/.test(svc2));
check('ช่อง ชม./นาที บนเว็บเติมศูนย์ให้ครบทุกช่อง',
      (src.match(/onBlur=\{padTimeOnBlur\}/g) || []).length === 6);

console.log(String.fromCharCode(10) + '-- ประตูอนุมัติ: ต้องครอบของที่ EMCS บังคับ --');
check('นับช่องบังคับของคู่กรณี/ผู้บาดเจ็บ/ทรัพย์สินเข้าประตูอนุมัติ',
      /recordGaps > 0 \? \[/.test(src) && /OPPONENT_REQUIRED, INJURED_REQUIRED, PROPERTY_REQUIRED/.test(src));
check('บังคับให้มีรายการความเสียหายอย่างน้อย 1 ชิ้น',
      /damageRows === 0 \? \[/.test(src));
check('เลิกผูกดอกจันกับ damage_description (ค่าไม่เคยถึง EMCS)',
      !/<Req of="damage_description"/.test(src));
check('ตรวจลำดับเวลาครบ 7 คู่ + ห้ามเวลาเท่ากัน',
      (src.match(/te\.push\(\{ at:/g) || []).length >= 7 && /a <= b;/.test(src));
const xml3 = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'xmlExport.service.ts'), 'utf8');
check('ไม่ส่งชื่อสาขาไทยลง INSURERBRID (EMCS ต้องการรหัสตัวเลข)',
      xml3.includes("el('INSURERBRID', /^") && xml3.includes("? r.insurance_branch : '')"));

console.log(String.fromCharCode(10) + '-- ค่า placeholder ต้องไม่กลายเป็นข้อมูลจริง --');
const rec = fs.readFileSync(
  path.join(__dirname, '..', '..', 'web', 'src', 'components', 'cases', 'RecordEditors.tsx'), 'utf8');
const svc3 = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'case.service.ts'), 'utf8');
const xml4 = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'xmlExport.service.ts'), 'utf8');
check('ตารางย่อยตัด placeholder ออกจากลิสต์ตัวเลือก',
      /def\.options\.filter\(\(o\) => !PLACEHOLDERS\.has/.test(rec));
check('ตัวล้าง placeholder เดินลง array/object ของ JSONB',
      /if \(Array\.isArray\(v\)\) return v\.map\(stripSentinel\)/.test(svc3));
check('JSONB ผ่านตัวล้างก่อนเก็บ (เดิมข้ามไปเลย)',
      /JSON\.stringify\(stripSentinel\(/.test(svc3));
check('รวม "-- เขต --" เป็น placeholder ด้วย', /'-- เขต --'/.test(svc3) && /'-- เขต --'/.test(rec));
check('เวลา "บ.ประกันแจ้งสำรวจภัย" ไม่ถูกคอลัมน์เก่าทับ',
      xml4.includes("el('INS_CALLING_SURV_DATE', toXmlCE(r.acc_insurance_notify_date))"));

/**
 * -- ค่าที่โหลดมาทีหลังต้องขึ้นบนหน้าจอ --
 * React ไม่เอา defaultValue ของ <select> และ defaultChecked ของ checkbox มาใส่ซ้ำ
 * เมื่อ props เปลี่ยน (ต่างจาก <input type=text>) ยอดเงินโหลด async จึงต้องมี key
 * ⛔ ไม่มี key = ช่องว่าง/ไม่ติ๊ก ทั้งที่ DB มีค่า แล้วกดบันทึกทีเดียวล้างของเดิมทิ้ง
 */
console.log(String.fromCharCode(10) + '-- ยอดเงินที่โหลดทีหลังต้องขึ้นครบ --');
for (const f of ['deduct_late', 'deduct_docs', 'out_of_area', 'out_of_hours']) {
  check(`ช่องติ๊ก "${f}" มี key ผูกกับค่าที่โหลดมา`,
        src.includes('key={`' + f + '-${String(payV?.saved?.' + f));
}
check('ช่อง "ค่าคัดประจำวัน" มี key เช่นกัน', src.includes('key={`dc-${String(payV'));

/**
 * -- กติกาที่ EMCS ฟ้องจริง (เก็บจากการทดสอบสด 19/08/69) --
 * ปล่อยผ่านที่นี่ = อนุมัติได้ แต่บอทกดบันทึกบน EMCS ไม่ผ่าน เสียเที่ยวทั้งรอบ
 */
console.log(String.fromCharCode(10) + '-- กติกาที่ระบบประกันฟ้องจริง --');
check('เตือนเมื่อ "สำรวจภัยเสร็จ" ล้ำเวลาปัจจุบัน (EMCS เทียบระดับนาที)',
      src.includes('tFin > Date.now()'));
// เคลมสด: 5 จังหวะเวลาต้องอยู่ในกรอบ 24 ชม. — เจอจริง 22/08/69 ตอนเทสกรอกจริงบนมือถือ
// (เวลาที่แอปบันทึกคือเวลาในสนาม แต่หัวหน้าตรวจข้ามวัน → EMCS ปัดตกทั้งหน้า)
check('เตือนกฎ 24 ชม. ของเคลมสด (5 จังหวะเวลาต้องอยู่ในกรอบเดียวกัน)',
      src.includes("24 * 60 * 60 * 1000")
      && src.includes('claim_type"]:checked')
      && src.includes('เคลมสด: 5 จังหวะเวลาต้องอยู่ในกรอบ 24 ชม.'));
check('กฎ 24 ชม. ตรวจเฉพาะเคลมสด ไม่ไปรบกวนเคลมแห้ง/นัดหมาย/ติดตาม',
      src.includes("=== 'F'") && src.includes('if (isFresh)'));
const opt = fs.readFileSync(
  path.join(__dirname, '..', '..', 'web', 'src', 'components', 'cases', 'caseOptions.ts'), 'utf8');
check('ลิสต์ยี่ห้อรับได้ทั้งรหัสและป้ายไทย (คู่กรณีเก็บประเภทรถเป็นป้ายไทย)',
      opt.includes('CAR_TYPE_LABEL_TO_CODE')
      && opt.includes('CAR_BRANDS_BY_TYPE[CAR_TYPE_LABEL_TO_CODE[raw] ?? raw]'));
check('ช่อง "ราคาพนักงาน" ของค่ารูปถ่ายถูกล็อก (พนักงานไม่มีค่ารูป)',
      src.includes('disabled name="pay_photo_fee"'));
const xml5 = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'services', 'xmlExport.service.ts'), 'utf8');
check('ตัดความยาวตามโควตาของ EMCS ก่อนส่ง (เกินช่องเดียว = ตีกลับทั้งไฟล์)',
      xml5.includes('EMCS_MAXLEN') && xml5.includes('ACC_PLACE: 100')
      && xml5.includes('if (lim && s.length > lim)'));
check('เตือนคนตรวจเมื่อช่องยาวเกินโควตา', xml5.includes("lenWarn(out, 'ACC_PLACE'"));
check('การ์ดคู่กรณีเปิดหน้าต่างความเสียหายได้ (ไม่ใช่ป้ายอ่านอย่างเดียว)',
      rec.includes('<DamageDialog') && rec.includes('setDmgFor')
      && !rec.includes('(แก้ในแอป)'));
check('ติ๊กชิ้นส่วนแล้วไม่เลือกด้าน/ระดับให้เอง (ผู้ตรวจสอบเลือกเอง)',
      dlg.includes("{ part, pos: '', level: '' }") && !dlg.includes("pos: 'A', level: 'L'"));
check('ช่องอิสระเก็บเป็นอาเรย์คงที่ 30 ช่อง (ไม่ให้แถวขยับตอนพิมพ์)',
      dlg.includes('Array.from({ length: FREE_SLOTS }') && dlg.includes('setFree_'));
check('เว็บตรวจ checksum เลขบัตรประชาชนของคู่กรณี/ผู้บาดเจ็บ (มือถือตรวจอยู่แล้ว)',
      rec.includes('const cidChecksum') && rec.includes("def.k === 'cid'"));

/**
 * ── แบบใหม่ 02/09/69: เส้นใต้บอกว่าช่องไหนกรอกแล้ว ──
 *
 * เป็นของ 2 ชิ้นที่ต้องตรงกัน ถ้าฝั่งไหนเปลี่ยนชื่อ ระบบทั้งชุดตายเงียบ ๆ
 * ไม่มี error ให้เห็น (หน้าเว็บแค่กลับไปหน้าตาเดิม):
 *   TSX  เขียน `data-filled` ให้ทุกช่อง + คลาส `md-fields` บน <form>
 *   CSS  จับ `.md-fields ... [data-filled]` แล้วทาเส้นใต้/พื้น/น้ำหนักตัวอักษร
 */
const css = fs.readFileSync(
  path.join(__dirname, '..', '..', 'web', 'src', 'app', 'globals.css'), 'utf8');
// [^>]* ใช้ไม่ได้ — ในแท็ก <form> มีลูกศร => ของ onSubmit ซึ่งนับเป็น '>'
check('ฟอร์มมีคลาส md-fields ให้ CSS เกาะ', /<form[\s\S]{0,200}?className="md-fields/.test(src));
check('เขียน data-filled ให้ทุกช่องหลัง render',
      src.includes('dataset.filled = isBlank(')
      && src.includes("querySelectorAll('input,select,textarea')"));
check('ข้าม radio/checkbox/hidden (isBlank ตอบ false เสมอ ทาแล้วผิด)',
      /t === 'radio' \|\| t === 'checkbox' \|\| t === 'hidden'/.test(src));
check('CSS มีทั้งสถานะว่างและสถานะกรอกแล้ว',
      css.includes('.md-fields') && css.includes("[data-filled='0']") && css.includes("[data-filled='1']"));
check('⛔ CSS ต้องไม่ทับช่องที่ทากรอบแดง (บังคับแล้วยังไม่กรอก) และช่องที่ถูกล็อก',
      css.includes(':not(.border-red-400)') && css.includes(':not(.bg-gray-100)'));
check('⛔ ตัวทาเส้นใต้แยกจาก paint() (paint เรียก setState — รวมกันแล้วเป็นวงวน render)',
      !/dataset\.filled[\s\S]{0,400}?setList\(/.test(src));

/** หัวหมวดกับตารางต้องเป็นการ์ดใบเดียวกัน — กรอบอยู่ที่ตัวหมวด ไม่ใช่ที่ตารางข้างใน */
check('กรอบการ์ดอยู่ที่ตัวหมวด (หัวหมวดไม่ลอยห่างจากตารางของตัวเอง)',
      /<div data-section="[a-z_]+" className="border border-\[var\(--md-line\)\] bg-white">/.test(src)
      && !src.includes('data-section="biz" className="space-y-2"'));

/**
 * ── ดอกจันในการ์ดคู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน ต้องมีสี (user ทัก 02/09/69) ──
 *
 * เดิมพิมพ์ทั้งป้ายเป็นข้อความเดียว ดอกจันจึงเทาเหมือนชื่อช่อง มองไม่ออกว่าบังคับ
 * ต้องเป็นชุดสีเดียวกับฟอร์มหลัก: แดง = บังคับเสมอ · เหลือง = บังคับบางบริษัท
 *
 * ⛔ ตัวทากรอบแดง (isRequiredLabel) ยังอ่าน "ป้ายลงท้ายด้วย *" จากข้อความ
 *    ถ้าใครไปตัดดอกจันออกจาก FieldDef เพื่อจัดหน้า กรอบแดงจะหายไปเงียบ ๆ ด้วย
 */
check('ดอกจันในการ์ดคู่กรณีมีสี ไม่ใช่ข้อความเปล่า',
      rec.includes('function ReqLabel') && rec.includes('<ReqLabel label={def.label} />'));
check('แดง = บังคับเสมอ · เหลือง = บังคับบางบริษัท',
      rec.includes("'text-amber-500 ml-0.5' : 'text-red-500 ml-0.5'"));
check('⛔ ตัวทากรอบแดงยังอ่านจากข้อความป้ายเหมือนเดิม',
      rec.includes('isRequiredLabel') && rec.includes("label: 'ทะเบียน *'"));
/** หน้านี้ไม่มีมุมมนทั้งหน้า — การ์ดพวกนี้อยู่คนละไฟล์ เลยตกสำรวจตอนทำแบบใหม่รอบแรก */
check('การ์ดคู่กรณี/ความเสียหาย/รูป ไม่มีมุมมนหลงเหลือ',
      [rec, dlg, ed, gal].every((f) => !/rounded(-(sm|md|lg|xl)\b|-t-\[|-\[)/.test(f)));

console.log(`\n${failed === 0 ? '✅ ผ่านทั้งหมด' : `❌ ล้มเหลว ${failed} รายการ`}`);
process.exit(failed ? 1 : 0);
