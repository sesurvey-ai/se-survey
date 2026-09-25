/**
 * Contract test — หน้า "รอตรวจ ISURVEY" แยกจังหวัดที่เกิดเหตุ / จังหวัดที่ออกตรวจสอบ (user ขอ 25/09/69)
 *
 * ล็อกกติกา:
 *  1) หัวตาราง "จังหวัดที่เกิดเหตุ" ตามด้วย "จังหวัดที่ออกตรวจสอบ" ทันที · แถวโชว์ acc_province แล้ว survey_province
 *     (รายงาน enquiry ของ ISURVEY มีทั้ง 2 ชุด — ตัวดึงงาน se-autokey autokey/pull_core.py list_pending ส่งมา)
 *  2) จำนวนคอลัมน์ของแถวว่างตรงกับหัวตาราง · ค้นหาด้วยจังหวัดที่ออกตรวจสอบได้ · cache ขึ้นเวอร์ชันใหม่ (แถวเก่าไม่มีช่องนี้)
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

const page = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'app', 'inspector', 'isurvey', 'page.tsx'), 'utf8');
const svc = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'isurveyPull.service.ts'), 'utf8');

const headers = [...page.matchAll(/<th className="[^"]*">([^<]*)<\/th>/g)].map((m) => m[1]);
const iAcc = headers.indexOf('จังหวัดที่เกิดเหตุ');
check('หัวตาราง: "จังหวัดที่เกิดเหตุ" ตามด้วย "จังหวัดที่ออกตรวจสอบ"', iAcc >= 0 && headers[iAcc + 1] === 'จังหวัดที่ออกตรวจสอบ', JSON.stringify(headers));
check('แถว: acc_province แล้ว survey_province (ว่าง = "-" · ชี้ดูอำเภอที่ออกตรวจสอบ)',
  /\{r\.acc_province\}<\/td>\s*<td[^>]*title=\{r\.survey_amphur \? `อำเภอที่ออกตรวจสอบ: \$\{r\.survey_amphur\}` : undefined\}>\{r\.survey_province \|\| '-'\}<\/td>/.test(page));
const colSpan = Number((/<td colSpan=\{(\d+)\}/.exec(page) || [])[1]);
check('แถว "ไม่มีงาน" กินเต็มความกว้างตาราง (colSpan = จำนวนหัวตาราง)', colSpan === headers.length, `colSpan ${colSpan} · หัว ${headers.length}`);
check('ค้นหาด้วยจังหวัดที่ออกตรวจสอบได้', /r\.acc_province, r\.survey_province\]\.some/.test(page));
check('cache หน้าเว็บขึ้นเวอร์ชันใหม่ (แถวเก่าไม่มีจังหวัดที่ออกตรวจสอบ)', /const CACHE_KEY = 'isurvey-pending-cache-v6'/.test(page));
check('backend ส่งช่องจากตัวดึงงานต่อทั้งแถว + ประกาศชนิด survey_province',
  /survey_province\?: string; survey_amphur\?: string;/.test(svc) && /rows\.map\(\(r\) => \(\{ \.\.\.r, in_team/.test(svc));

console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
