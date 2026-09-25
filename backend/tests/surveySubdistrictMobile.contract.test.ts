/**
 * Contract test — ตำบลที่เกิดเหตุ + ตำบลที่ตรวจสอบบนแอปมือถือ (user ขอ 25/09/69 · APK 1.0.124 → 1.0.125)
 *
 * เว็บ/ISURVEY มีตำบลของทั้ง 2 สถานที่ (acc_subdistrict migration 007 · survey_subdistrict migration 058) แต่แอปไม่มี
 * ล็อกกติกา:
 *  1) แอปมีดรอปดาวน์ "ตำบล/แขวง" ที่เกิดเหตุ และ "ตำบลที่ตรวจสอบ" ตามจังหวัด+อำเภอของแต่ละชุด (ข้อมูลตำบลชุดเดียวกับผู้ขับขี่)
 *  2) ติ๊ก "สถานที่เดียวกับที่เกิดเหตุ" = คัดลอกครบ 4 ช่อง (สถานที่/จังหวัด/อำเภอ/ตำบล) — ตำบลที่ตรวจสอบอยู่ในส่วนที่ล็อกตอนติ๊ก
 *     (user ชี้ 25/09/69: ที่เกิดเหตุไม่มีตำบล ติ๊กแล้วข้อมูลไม่ครบ)
 *  3) บังคับเมื่ออำเภอนั้นมีรายชื่อตำบล · เปลี่ยนจังหวัด/อำเภอ = ล้างตำบลของชุดนั้น · ส่งงานส่งทั้ง acc_subdistrict/survey_subdistrict
 *  4) backend ไม่ทิ้ง 2 ช่องนี้ (zod ตัดคีย์ที่ไม่ประกาศเงียบ ๆ + รายชื่อช่องของสร้างเคส/บันทึกร่าง/ส่งงาน)
 *  5) หน้าเว็บ: ตำบลทั้ง 2 ชุดเป็นดรอปดาวน์เต็มรายชื่อ (user เคาะ 25/09/69 แทนช่องติ๊กตำบลพิเศษของ 01/09/69) ตำบลพิเศษติดป้าย
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
check('แอป: ตำบลทั้ง 2 ชุด บันทึก/โหลดคู่กับคอลัมน์ และส่งไปกับงาน',
  form.includes("_accSubdistrictCtl: 'acc_subdistrict'") && form.includes("_survSubdistrictCtl: 'survey_subdistrict'")
  && form.includes("'acc_subdistrict': _accSubdistrictCtl.text.trim(),") && form.includes("'survey_subdistrict': _survSubdistrictCtl.text.trim(),")
  && /_accProvinceCtl, _accDistrictCtl, _accSubdistrictCtl,/.test(form) && /_survPlaceCtl, _survProvinceCtl, _survDistrictCtl, _survSubdistrictCtl,/.test(form));
check('แอป: รายชื่อตำบลตามจังหวัด+อำเภอของแต่ละชุด (ข้อมูลเดียวกับผู้ขับขี่)',
  /List<String> _accTumbons\(\) => _tumbonsData\[_accProvinceCtl\.text\]\?\[_accDistrictCtl\.text\] \?\? const <String>\[\];/.test(form)
  && /List<String> _survTumbons\(\) => _tumbonsData\[_survProvinceCtl\.text\]\?\[_survDistrictCtl\.text\] \?\? const <String>\[\];/.test(form));
check('แอป: ตำบลที่เกิดเหตุอยู่ต่อจากแถวจังหวัด/อำเภอที่เกิดเหตุ',
  /_row2\(_accProvinceDropdown\(\), _accDistrictDropdown\(\)\),\s*_accTumbonDropdown\(\),/.test(form));
check('แอป: ตำบลที่ตรวจสอบอยู่ในส่วนที่ล็อกตอนติ๊ก (ถูกคัดลอกจากที่เกิดเหตุ)',
  /IgnorePointer\(\s*ignoring: _survSameAsAcc,[\s\S]{0,600}?_row2\(_survProvinceDropdown\(\), _survDistrictDropdown\(\)\),\s*const SizedBox\(height: 14\),\s*_survTumbonDropdown\(\),/.test(form));
check('แอป: ติ๊กเดียวกับที่เกิดเหตุ = คัดลอกครบ 4 ช่อง · อนุมานติ๊กตอนโหลดจาก 4 ช่อง',
  /_survDistrictCtl\.text = _accDistrictCtl\.text;\s*_survSubdistrictCtl\.text = _accSubdistrictCtl\.text;/.test(form)
  && /&& _survSubdistrictCtl\.text\.trim\(\) == _accSubdistrictCtl\.text\.trim\(\)[;\s]/.test(form)   // หมู่ต่อท้ายได้ (25/09/69 รอบ 2 — placeMoo.contract)
  && /_accSubdistrictCtl\.text = v \?\? ''; _syncSurveyFromAcc\(\);/.test(form));
check('แอป: บังคับเมื่ออำเภอนั้นมีรายชื่อตำบล (ไม่มีรายชื่อ = ไม่ขวางการส่งงาน)',
  form.includes("['ตำบลที่เกิดเหตุ', has(_accSubdistrictCtl) || _accTumbons().isEmpty],")
  && form.includes("['ตำบลที่ตรวจสอบ', has(_survSubdistrictCtl) || _survTumbons().isEmpty],")
  && (form.match(/req: tumbons\.isNotEmpty,/g) || []).length === 2);
check('แอป: เปลี่ยนจังหวัด/อำเภอ = ล้างตำบลของชุดนั้น',
  /_accProvinceCtl\.text = v \?\? ''; _accDistrictCtl\.text = ''; _accSubdistrictCtl\.text = '';/.test(form)
  && /_accDistrictCtl\.text = v \?\? ''; _accSubdistrictCtl\.text = '';/.test(form)
  && /_survProvinceCtl\.text = v \?\? ''; _survDistrictCtl\.text = ''; _survSubdistrictCtl\.text = '';/.test(form)
  && /_survDistrictCtl\.text = v \?\? ''; _survSubdistrictCtl\.text = '';/.test(form));

const routes = read('backend', 'src', 'routes', 'case.routes.ts');
check('backend: zod ส่งงานประกาศ acc_subdistrict + survey_subdistrict (ไม่งั้นถูกตัดทิ้งเงียบ ๆ)',
  /acc_subdistrict: optStr,/.test(routes) && /survey_district: optStr,\s*survey_subdistrict: optStr,/.test(routes));
const svc = read('backend', 'src', 'services', 'case.service.ts');
const surv = svc.split("'survey_place','survey_province','survey_district','survey_subdistrict',").length - 1;
const acc = svc.split("'acc_date','acc_time','acc_place','acc_subdistrict','acc_province','acc_district',").length - 1;
check('backend: รายชื่อช่องของสร้างเคส/บันทึกร่าง/ส่งงาน มีตำบลทั้ง 2 ชุดครบ 3 จุด', surv === 3 && acc === 3, `survey ${surv} · acc ${acc}`);

const web = read('web', 'src', 'components', 'cases', 'CaseDetail.tsx');
check('เว็บ: ตำบลที่เกิดเหตุ/ที่ตรวจสอบเป็นดรอปดาวน์เต็มรายชื่อ (user เคาะ 25/09/69) · ไม่มีช่องซ่อนชื่อซ้ำ · ตำบลพิเศษติดป้าย',
  web.includes('<select disabled={d} name="acc_subdistrict" value={accTumbon}') && web.includes('<select disabled={d} name="survey_subdistrict" value={survTumbon}')
  && web.includes('tumbonSelectOptions(survTumbons, survTumbon, survTumbonChoices)') && web.includes('const survTumbons = useTumbonNames(survProv, survDist);')
  && !web.includes('name="acc_subdistrict" value={accTumbon} />') && !web.includes('name="survey_subdistrict" value={survTumbon} />')
  && web.includes('`${t} (เรทพิเศษ)`'));

console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
