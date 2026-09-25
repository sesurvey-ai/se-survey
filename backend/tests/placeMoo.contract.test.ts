/**
 * Contract test — "หมู่" ของสถานที่เกิดเหตุ + สถานที่ออกตรวจสอบ (user สั่ง 25/09/69 · migration 069 · APK 1.0.126)
 *
 * ที่อยู่ผู้ขับขี่มีหมู่แยกช่องแล้ว (16/09/69) แต่ 2 สถานที่ยังต้องพิมพ์หมู่ปนในข้อความสถานที่ · ISURVEY/EMCS ก็ไม่มีช่องหมู่ของ 2 สถานที่นี้
 * ล็อกกติกา:
 *  1) คอลัมน์ acc_moo / survey_moo (VARCHAR 20) · ช่องบนแอป/เว็บจำกัด 20 ตัว (รวมหมู่ผู้ขับขี่ — เกินคอลัมน์ = ส่งงาน/บันทึกพัง)
 *  2) แอป: หมู่ไม่บังคับ ใต้ตำบลของแต่ละชุด · หมู่ที่ตรวจสอบอยู่ในส่วนที่ล็อกตอนติ๊ก · ติ๊ก "สถานที่เดียวกับที่เกิดเหตุ" คัดลอกหมู่ด้วย (ครบ 5 ช่อง)
 *     · อนุมานติ๊กตอนโหลดรวมหมู่ · บันทึกร่าง/ส่งงานส่งทั้ง 2 ช่อง
 *  3) backend ไม่ทิ้ง 2 ช่องนี้ (zod ตัดคีย์ที่ไม่ประกาศเงียบ ๆ + รายชื่อช่องของสร้างเคส/งานครั้งถัดไป/บันทึกร่าง/ส่งงาน)
 *  4) งานหลายครั้ง: หมู่ที่ตรวจสอบเป็นของประจำครั้ง · หมู่ที่เกิดเหตุเป็นข้อมูลหลักของเคลม (ครั้งที่ 2+ ใช้ของครั้งที่ 1)
 *  5) เว็บ: ช่อง "หมู่" เล็กท้ายช่องสถานที่ทั้ง 2 ชุด แบบเดียวกับที่อยู่ผู้ขับขี่
 *  (สูตรข้อความ EMCS "หน้าเซเว่น ม.7 ต.หนองปรือ" ล็อกใน driverAddress.contract.test.ts)
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import { VISIT_OWN_FIELDS } from '../src/services/visitInherit';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}
const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const mig = read('backend', 'src', 'db', 'migrations', '069_place_moo.sql');
check('migration 069: acc_moo + survey_moo VARCHAR(20) บน survey_reports (ตารางจริง)',
  mig.includes('ALTER TABLE survey_reports ADD COLUMN IF NOT EXISTS acc_moo    VARCHAR(20);')
  && mig.includes('ALTER TABLE survey_reports ADD COLUMN IF NOT EXISTS survey_moo VARCHAR(20);'));

const form = read('mobile', 'lib', 'screens', 'survey_form_screen.dart');
check('แอป: หมู่ทั้ง 2 ชุด บันทึก/โหลดคู่กับคอลัมน์ · ส่งไปกับงาน · อยู่ในรายการ dispose',
  form.includes('final _accMooCtl = TextEditingController();') && form.includes('final _survMooCtl = TextEditingController();')
  && form.includes("_accMooCtl: 'acc_moo',") && form.includes("_survMooCtl: 'survey_moo',")
  && form.includes("'acc_moo': _accMooCtl.text.trim(),") && form.includes("'survey_moo': _survMooCtl.text.trim(),")
  && form.includes('_accSubdistrictCtl, _accMooCtl,') && form.includes('_survSubdistrictCtl, _survMooCtl,'));
check('แอป: หมู่ที่เกิดเหตุอยู่ใต้ตำบลที่เกิดเหตุ · ไม่บังคับ · จำกัด 20 ตัว · แก้แล้วตามไปชุดตรวจสอบถ้าติ๊ก',
  /_accTumbonDropdown\(\),[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*_txt\(_accMooCtl, 'หมู่ที่ \(ม\.\) — ไม่บังคับ', keyboardType: TextInputType\.text,\s*formatters: \[LengthLimitingTextInputFormatter\(20\)\], onChanged: \(_\) => _syncSurveyFromAcc\(\)\),/.test(form));
check('แอป: หมู่ที่ตรวจสอบอยู่ใต้ตำบลที่ตรวจสอบ ในส่วนที่ล็อกตอนติ๊ก · ไม่บังคับ · จำกัด 20 ตัว',
  /IgnorePointer\(\s*ignoring: _survSameAsAcc,[\s\S]{0,900}?_survTumbonDropdown\(\),[^\n]*\n\s*const SizedBox\(height: 14\),\s*(?:\/\/[^\n]*\n\s*)*_txt\(_survMooCtl, 'หมู่ที่ตรวจสอบ \(ม\.\) — ไม่บังคับ', keyboardType: TextInputType\.text,\s*formatters: \[LengthLimitingTextInputFormatter\(20\)\]\),\s*\]\),/.test(form));
check('แอป: หมู่ผู้ขับขี่จำกัด 20 ตัวด้วย (คอลัมน์ driver_moo VARCHAR 20)',
  /_txt\(_driverMooCtl, 'หมู่ที่ \(ม\.\) — ไม่บังคับ', keyboardType: TextInputType\.text,\s*formatters: \[LengthLimitingTextInputFormatter\(20\)\]\),/.test(form));
check('แอป: ติ๊กเดียวกับที่เกิดเหตุ = คัดลอกหมู่ด้วย · อนุมานติ๊กตอนโหลดรวมหมู่ (ครบ 5 ช่อง)',
  /_survSubdistrictCtl\.text = _accSubdistrictCtl\.text;[^\n]*\n\s*_survMooCtl\.text = _accMooCtl\.text;/.test(form)
  && /&& _survSubdistrictCtl\.text\.trim\(\) == _accSubdistrictCtl\.text\.trim\(\)\s*&& _survMooCtl\.text\.trim\(\) == _accMooCtl\.text\.trim\(\);/.test(form));
check('แอป: หมู่ไม่อยู่ในรายการช่องบังคับ',
  !/\['หมู่/.test(form) && !/_txt\(_(acc|surv)MooCtl,[^)]*req: true/.test(form));

const routes = read('backend', 'src', 'routes', 'case.routes.ts');
check('backend: zod ส่งงานประกาศ acc_moo + survey_moo (ไม่งั้นถูกตัดทิ้งเงียบ ๆ)',
  /acc_district: optStr,\s*acc_moo: optStr,/.test(routes) && /survey_subdistrict: optStr,[^\n]*\n\s*survey_moo: optStr,/.test(routes));
const svc = read('backend', 'src', 'services', 'case.service.ts');
const accN = count(svc, "'acc_district','acc_moo',") + count(svc, "'acc_district', 'acc_moo',");
const survN = count(svc, "'survey_subdistrict','survey_moo',") + count(svc, "'survey_subdistrict', 'survey_moo',");
check('backend: รายชื่อช่องของสร้างเคส/งานครั้งถัดไป/บันทึกร่าง/ส่งงาน มีหมู่ทั้ง 2 ชุดครบ 4 จุด', accN === 4 && survN === 4, `acc ${accN} · survey ${survN}`);
check('งานหลายครั้ง: หมู่ที่ตรวจสอบ = ของประจำครั้ง · หมู่ที่เกิดเหตุ = ข้อมูลหลัก (ครั้งที่ 2+ ใช้ของครั้งที่ 1)',
  VISIT_OWN_FIELDS.has('survey_moo') && !VISIT_OWN_FIELDS.has('acc_moo'));

const web = read('web', 'src', 'components', 'cases', 'CaseDetail.tsx');
check('เว็บ: ช่องหมู่ท้ายสถานที่เกิดเหตุ/สถานที่ออกตรวจสอบ (มีคำว่า "หมู่" คั่น) · จำกัด 20 ตัวทั้ง 3 ช่องหมู่',
  /name="acc_place"[\s\S]{0,300}?<span className="text-sm text-gray-600 shrink-0 pl-1">หมู่<\/span>\s*<input type="text" disabled=\{d\} name="acc_moo" defaultValue=\{report\.acc_moo \|\| ''\} maxLength=\{20\}/.test(web)
  && /name="survey_place"[\s\S]{0,300}?<span className="text-sm text-gray-600 shrink-0 pl-1">หมู่<\/span>\s*<input type="text" disabled=\{d\} name="survey_moo" defaultValue=\{report\.survey_moo \|\| ''\} maxLength=\{20\}/.test(web)
  && web.includes('name="driver_moo" value={driverMoo} onChange={e => setDriverMoo(e.target.value)} maxLength={20}'));

console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
