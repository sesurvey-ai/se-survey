/**
 * Contract test — ตำบลที่ตรวจสอบบนแอปมือถือ (user ขอ 25/09/69 · APK 1.0.124)
 *
 * เว็บ/ISURVEY มี "ตำบลที่ตรวจสอบ" (survey_subdistrict, migration 058) แต่แอปมีแค่ สถานที่/จังหวัด/อำเภอ
 * ล็อกกติกา:
 *  1) แอปมีดรอปดาวน์ตำบลที่ตรวจสอบ ตามจังหวัด+อำเภอที่ตรวจสอบ (ข้อมูลตำบลชุดเดียวกับที่อยู่ผู้ขับขี่)
 *     อยู่นอกส่วนที่ล็อกตอนติ๊ก "สถานที่เดียวกับที่เกิดเหตุ" (ที่เกิดเหตุไม่มีตำบลให้คัดลอก)
 *  2) บังคับเมื่ออำเภอนั้นมีรายชื่อตำบล · เปลี่ยนจังหวัด/อำเภอ = ล้างตำบล · บันทึก/ส่งงานส่ง survey_subdistrict
 *  3) backend ไม่ทิ้งช่องนี้: zod ของส่งงาน (ตัดคีย์ที่ไม่ประกาศเงียบ ๆ) + รายชื่อช่องของบันทึกร่าง/ส่งงาน
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
const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

const form = read('mobile', 'lib', 'screens', 'survey_form_screen.dart');
check('แอป: ช่องตำบลที่ตรวจสอบ บันทึก/โหลดคู่กับ survey_subdistrict และส่งไปกับงาน',
  form.includes("_survSubdistrictCtl: 'survey_subdistrict'") && form.includes("'survey_subdistrict': _survSubdistrictCtl.text.trim(),")
  && /_survPlaceCtl, _survProvinceCtl, _survDistrictCtl, _survSubdistrictCtl,/.test(form));
check('แอป: ดรอปดาวน์ตามจังหวัด+อำเภอที่ตรวจสอบ จากข้อมูลตำบลชุดเดียวกับผู้ขับขี่',
  /List<String> _survTumbons\(\) => _tumbonsData\[_survProvinceCtl\.text\]\?\[_survDistrictCtl\.text\] \?\? const <String>\[\];/.test(form)
  && /_dd\('ตำบลที่ตรวจสอบ', cur, items,/.test(form));
const lockedEnd = form.indexOf('_row2(_survProvinceDropdown(), _survDistrictDropdown()),');
const tumbonUse = form.indexOf('_survTumbonDropdown(),');
check('แอป: ดรอปดาวน์ตำบลอยู่นอกส่วนที่ล็อกตอนติ๊ก "สถานที่เดียวกับที่เกิดเหตุ"',
  lockedEnd > 0 && tumbonUse > lockedEnd && /\]\),\s*\),\s*\),\s*\/\/ ตำบลที่ตรวจสอบ[^\n]*\n\s*_survTumbonDropdown\(\),/.test(form.slice(lockedEnd)));
check('แอป: บังคับเมื่ออำเภอนั้นมีรายชื่อตำบล (ไม่มีรายชื่อ = ไม่ขวางการส่งงาน)',
  form.includes("['ตำบลที่ตรวจสอบ', has(_survSubdistrictCtl) || _survTumbons().isEmpty],") && /req: tumbons\.isNotEmpty,/.test(form));
check('แอป: เปลี่ยนจังหวัด/อำเภอที่ตรวจสอบ (รวมตอนคัดลอกจากที่เกิดเหตุ) = ล้างตำบล',
  /_survProvinceCtl\.text = v \?\? ''; _survDistrictCtl\.text = ''; _survSubdistrictCtl\.text = '';/.test(form)
  && /_survDistrictCtl\.text = v \?\? ''; _survSubdistrictCtl\.text = '';/.test(form)
  && /if \(_survProvinceCtl\.text != _accProvinceCtl\.text \|\| _survDistrictCtl\.text != _accDistrictCtl\.text\) \{\s*_survSubdistrictCtl\.text = '';/.test(form));

const routes = read('backend', 'src', 'routes', 'case.routes.ts');
check('backend: zod ส่งงานประกาศ survey_subdistrict (ไม่งั้นถูกตัดทิ้งเงียบ ๆ)', /survey_district: optStr,\s*survey_subdistrict: optStr,/.test(routes));
const svc = read('backend', 'src', 'services', 'case.service.ts');
const lists = svc.split("'survey_place','survey_province','survey_district','survey_subdistrict',").length - 1;
check('backend: รายชื่อช่องของสร้างเคส/บันทึกร่าง/ส่งงาน มี survey_subdistrict ครบ 3 จุด', lists === 3, `${lists} จุด`);

console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
