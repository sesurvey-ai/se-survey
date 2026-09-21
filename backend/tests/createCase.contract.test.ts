/**
 * การ์ดของหน้า "สร้างเคสใหม่" (22/09/69)
 *
 * ⛔ "ลูกค้าแจ้ง" (วันเวลารับแจ้ง) ต้องบังคับทั้งฟอร์มและเซิร์ฟเวอร์ — เคสที่กรอกเองไม่ผ่าน OCR เคยว่างได้
 *    → ไทม์ไลน์งานของช่าง (จุดแรก "ลูกค้าแจ้ง") ว่างเปล่า (เคลม 777 ที่ user เจอ) และ EMCS ไม่มีวันเวลารับแจ้ง
 * ⛔ รูปแบบต้องเป็น "dd/mm/พ.ศ.|HH:mm" ชุดเดียวกับ OCR — แอปแยกด้วย '|' (splitDT) ถ้าเก็บอีกแบบ ไทม์ไลน์อ่านไม่ออกเงียบ ๆ
 * + โลโก้ไอโออิ (ตราตัวจริง aioilogo.png ของ user) ต้องมีทั้งการ์ดมือถือและตัวเลือกบริษัทบนเว็บ — เดิมเว็บอ้างไฟล์ที่ไม่มีเลยโชว์ตัวย่อ "AIOI"
 *   ⛔ 22/09/69 เคยเข้าใจผิดว่า user ต้องการป้าย "AIOI" (ที่จริงคือภาพของอาการบั๊ก) → อย่าวาดป้ายแทนตรา
 */
import * as fs from 'fs';
import * as path from 'path';

let failed = 0;
const check = (label: string, ok: boolean, note = '') => {
  if (!ok) failed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${note ? `  (${note})` : ''}`);
};
const root = (...p: string[]) => path.join(__dirname, '..', ...p);
const read = (...p: string[]) => fs.readFileSync(root(...p), 'utf8');
/** ขนาด PNG จาก IHDR (ไม่ต้องพึ่ง lib) */
const pngSize = (p: string): [number, number] => {
  const b = fs.readFileSync(p);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};

const routes = read('src', 'routes', 'case.routes.ts');
const page = read('..', 'web', 'src', 'app', 'callcenter', 'cases', 'new', 'page.tsx');

console.log('\n── ลูกค้าแจ้ง (วันเวลารับแจ้ง) บังคับกรอก ──');
check('เซิร์ฟเวอร์: createCaseSchema บังคับรูปแบบ dd/mm/พ.ศ.|HH:mm (ไม่ optional แล้ว)',
      /acc_customer_report_date: z\.string\(\)\.regex\(\/\^\\d\{2\}\\\/\\d\{2\}\\\/2\[5-7\]\\d\{2\}\\\|\\d\{2\}:\\d\{2\}\$\//.test(routes)
      && !/acc_customer_report_date: z\.string\(\)\.optional\(\)/.test(routes));
check('ฟอร์ม: กันส่งถ้าไม่ครบ/ไม่ใช่ พ.ศ. ก่อนยิง API (normalizeReportDT) และโฟกัสช่อง',
      page.includes('const reportDT = normalizeReportDT(f(\'acc_customer_report_date\'));')
      && /if \(!reportDT\) \{[\s\S]*?document\.getElementById\('acc_customer_report_date'\)\?\.focus\(\);[\s\S]*?return;/.test(page));
check('ฟอร์ม: ส่งค่าที่จัดรูปแล้ว (เติม 0) และปีต้องเป็น พ.ศ. 2500–2700',
      page.includes('payload.acc_customer_report_date = reportDT;') && page.includes('yyyy < 2500 || yyyy > 2700'));
check('ฟอร์ม: แยกช่องวัน/เวลา รวมกลับด้วย | (รูปแบบเดียวกับ OCR) + ปุ่ม "ตอนนี้"',
      page.includes('id="acc_customer_report_date"') && page.includes("joinReportDT") && page.includes('ตอนนี้')
      && page.includes("`${d.trim()}|${t.trim()}`"));
check('ฟอร์ม: ป้ายมีดอกจันบังคับ', /ลูกค้าแจ้ง <span className="text-red-500">\*<\/span>/.test(page));

console.log('\n── โลโก้ไอโออิ (ตราตัวจริง) ──');
const webLogo = root('..', 'web', 'public', 'insurance', 'aioi.png');
const cardLogo = root('..', 'mobile', 'android', 'app', 'src', 'main', 'res', 'drawable-nodpi', 'logo_aioi.png');
check('เว็บ: ไฟล์โลโก้ที่ตัวเลือกบริษัทอ้างถึงมีจริง (เดิมอ้าง /insurance/aioi.png แต่ไม่มีไฟล์)',
      page.includes("logo: '/insurance/aioi.png'") && fs.existsSync(webLogo));
check('เว็บและการ์ดมือถือใช้ไฟล์เดียวกัน (ตราตัวจริง 144×137) — ไม่ใช่ป้าย "AIOI" ที่วาดเอง',
      fs.existsSync(cardLogo) && pngSize(cardLogo)[0] === 144 && pngSize(cardLogo)[1] === 137
      && fs.readFileSync(cardLogo).equals(fs.readFileSync(webLogo)));

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด' : `\n❌ ไม่ผ่าน ${failed} ข้อ`);
process.exit(failed === 0 ? 0 : 1);
