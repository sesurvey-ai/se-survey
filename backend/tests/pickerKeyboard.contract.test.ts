/**
 * Contract test — เปิดรายการเลือก/ตัวเลือกวันที่ในแอป = ปิดคีย์บอร์ดก่อนเสมอ (user สั่ง 25/09/69 · APK 1.0.128)
 *
 * อาการเดิม: พิมพ์ช่อง (เช่น หมู่) แล้วเปิดรายการเลือก พอเลือกเสร็จ แอปคืน focus ให้ช่องเดิม
 * → คีย์บอร์ดเด้งกลับมาบังแถวถัดไป/ปุ่มบันทึก (เจอตอนทดสอบที่อยู่ 6 จุด ในหน้าคู่กรณี/ทรัพย์สิน)
 * ทางแก้: ปล่อย focus (FocusManager.instance.primaryFocus?.unfocus()) ก่อนเปิดทุกตัว
 * ล็อกทุกจุดที่เปิดรายการ/วันที่ในฟอร์ม ไม่ให้จุดใดจุดหนึ่งหลุดกลับเป็นแบบเดิม
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
const UNFOCUS = 'FocusManager.instance.primaryFocus?.unfocus();';
/** โค้ดตั้งแต่หัวฟังก์ชันจนถึงบรรทัดเปิด bottom sheet ตัวแรก ต้องมี unfocus */
const unfocusBeforeSheet = (src: string, head: string): boolean => {
  const i = src.indexOf(head);
  if (i < 0) return false;
  const j = src.indexOf('showModalBottomSheet', i);
  return j > i && src.slice(i, j).includes(UNFOCUS);
};

const kit = read('mobile', 'lib', 'widgets', 'form_kit.dart');
check('รายการเลือกกลาง showKPicker (หน้าคู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน) ปิดคีย์บอร์ดก่อนเปิด',
  unfocusBeforeSheet(kit, 'Future<String?> showKPicker('));
check('ตัวเลือกวันที่กลาง showKDate ปิดคีย์บอร์ดก่อนเปิด', unfocusBeforeSheet(kit, 'Future<String?> showKDate('));
check('KPickerField / KDateField เปิดผ่าน showKPicker / showKDate เท่านั้น (ได้การปิดคีย์บอร์ดตามไปด้วย)',
  kit.includes('final r = await showKPicker(context, label, options, current: value);')
  && kit.includes('final r = await showKDate(context, title: label, current: controller.text'));

const form = read('mobile', 'lib', 'screens', 'survey_form_screen.dart');
check('ฟอร์มหลัก: ตัวเลือก _dd ปล่อย focus ตอนแตะ · วันที่ _showBuddhistDatePicker ปิดคีย์บอร์ดก่อนเปิด',
  /Widget _dd\([\s\S]{0,1500}?onTap: \(\) => FocusManager\.instance\.primaryFocus\?\.unfocus\(\),/.test(form)
  && unfocusBeforeSheet(form, 'void _showBuddhistDatePicker('));

const editors = ['opponent_editor.dart', 'injured_editor.dart', 'property_editor.dart'].map((f) => read('mobile', 'lib', 'screens', 'survey', f));
check('หน้าคู่กรณี/ผู้บาดเจ็บ/ทรัพย์สินไม่เปิด bottom sheet เอง (ใช้ KPickerField/KDateField ทั้งหมด)',
  editors.every((s) => !s.includes('showModalBottomSheet')));

console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
