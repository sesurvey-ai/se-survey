/**
 * Contract test — หน้า "งานแก้ไข/ต่อเนื่อง (EMCS)" (user สั่ง 25/09/69)
 *
 * ข้อมูลมาจาก snapshot ของ se-billing (`GET /api/dashboard` ที่ scraper ดึงจากกล่อง INBOX ของ EMCS วันละครั้ง)
 * ล็อก: แตกรายการถูก (เรื่องละแถว เรียงค้างนานสุดก่อน) · จับชื่อหัวหน้ากับบัญชีที่ล็อกอิน (ตัดคำนำหน้า/ช่องว่าง)
 *      · API เฉพาะ checker/admin อ่านอย่างเดียว · ไม่เข้า EMCS เอง · เมนูมีทั้งหัวหน้าและแอดมิน
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import { flattenBacklog, matchSupervisor, normPersonName, UNKNOWN_SUPERVISOR } from '../src/services/emcsBacklogCore';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}
const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

// ── ชื่อหัวหน้า: ตัดคำนำหน้า + ช่องว่าง ──
check('ชื่อเทียบได้ไม่สนคำนำหน้า/ช่องว่าง ("นาย ศุภชัย …" = "ศุภชัย …" · "นายภูริ …" = "ภูริ …")',
  normPersonName('นาย ศุภชัย  เศรษฐชัยชาญ') === normPersonName('ศุภชัย เศรษฐชัยชาญ')
  && normPersonName('นายภูริ ภัทรภิรัก') === normPersonName('ภูริ ภัทรภิรัก')
  && normPersonName('นางสาว จารุมน มิ่งขุนทด') === normPersonName('จารุมน มิ่งขุนทด')
  && normPersonName('ภูริ ภัทรภิรัก') !== normPersonName('ภูรี ชูลาภโชคทวี'));
const names = ['นาย ศุภชัย เศรษฐชัยชาญ', 'นายวุฒิชัย ต้นจันทร์', UNKNOWN_SUPERVISOR];
check('จับบัญชีที่ล็อกอินกับหัวหน้าใน snapshot ได้ · ไม่เจอ/ชื่อว่าง = null (หน้าเปิดที่ "ทั้งหมด")',
  matchSupervisor(names, 'วุฒิชัย ต้นจันทร์') === 'นายวุฒิชัย ต้นจันทร์'
  && matchSupervisor(names, 'ศุภชัย เศรษฐชัยชาญ') === 'นาย ศุภชัย เศรษฐชัยชาญ'
  && matchSupervisor(names, 'ประเสริฐ ตรวจงาน') === null
  && matchSupervisor(names, ' ') === null);

// ── แตก snapshot เป็น 2 รายการ ──
const snap = {
  generated_at: '2026-09-25T06:01:53+07:00',
  supervisors: [
    { name: 'นาย ศุภชัย เศรษฐชัยชาญ',
      emcs_edit_items: [{ claim_no: '2026013058321', date: '01/ส.ค./2569 12:21', aging_days: 55 }, { claim_no: '  ', date: 'x', aging_days: 1 }],
      emcs_continuous_items: [{ claim_no: '2026013101438', date: '26/มี.ค./2569 18:04', aging_days: 183 }] },
    { name: 'นายวุฒิชัย ต้นจันทร์',
      emcs_edit_items: [{ claim_no: '20250131A4503', date: '14/ม.ค./2569 13:56', aging_days: 254 }, { claim_no: '2026013000001', date: '', aging_days: null }],
      emcs_continuous_items: [] },
    { name: '', emcs_edit_items: [{ claim_no: '2026013000002', date: '20/ก.ย./2569 10:00', aging_days: 5 }] },
    null,
  ],
};
const f = flattenBacklog(snap);
check('แตกรายการ: เรื่องละแถว ข้ามแถวไม่มีเลขเคลม', f.edit.length === 4 && f.continuous.length === 1,
  `edit=${f.edit.length} continuous=${f.continuous.length}`);
check('เรียงค้างนานสุดก่อน · อายุว่าง = null อยู่ท้าย',
  f.edit.map((x) => x.aging_days).join(',') === '254,55,5,' && f.edit[3].aging_days === null);
check('หัวหน้าติดไปกับแต่ละแถว · ชื่อว่าง = "sesurvey" (ไม่พบหัวหน้า)',
  f.edit[0].supervisor === 'นายวุฒิชัย ต้นจันทร์' && f.edit[2].supervisor === UNKNOWN_SUPERVISOR
  && f.continuous[0].supervisor === 'นาย ศุภชัย เศรษฐชัยชาญ' && f.continuous[0].date === '26/มี.ค./2569 18:04');
check('snapshot ว่าง/null ไม่ล้ม', flattenBacklog(null).edit.length === 0 && flattenBacklog({}).continuous.length === 0);

// ── API: เฉพาะ checker/admin · อ่านอย่างเดียว · ต้นทางคือ se-billing ไม่ใช่ EMCS ──
const index = read('backend', 'src', 'routes', 'index.ts');
const route = read('backend', 'src', 'routes', 'emcsBacklog.routes.ts');
const svc = read('backend', 'src', 'services', 'emcsBacklog.service.ts');
check('ลงทะเบียน /api/emcs-backlog', index.includes("router.use('/emcs-backlog', emcsBacklogRoutes);"));
check('API เฉพาะ checker/admin และมีแค่ GET',
  route.includes("router.get('/', auth, requireRole('checker', 'admin'),") && !/router\.(post|put|patch|delete)\(/.test(route));
check('อ่านจาก se-billing /api/dashboard (ท่อเดียวกับ captures) ไม่เข้า EMCS เอง · cache 5 นาที',
  svc.includes("billingFetch('/api/dashboard', { method: 'GET' })") && !/eclaim|esurvey\//i.test(svc)
  && svc.includes('const CACHE_MS = 5 * 60 * 1000;'));
check('จับคู่เคสในเว็บเราด้วยเลขเคลม (เคสที่ยังไม่ลบ)',
  svc.includes('FROM cases c JOIN survey_reports sr ON sr.case_id = c.id') && svc.includes('WHERE sr.claim_no = ANY($1::text[])'));

// ── หน้าเว็บ + เมนู ──
const side = read('web', 'src', 'components', 'layout', 'Sidebar.tsx');
const page = read('web', 'src', 'app', 'inspector', 'emcs', 'page.tsx');
check('เมนู "งานแก้ไข/ต่อเนื่อง (EMCS)" มีทั้งหัวหน้าผู้ตรวจและแอดมิน',
  (side.match(/\{ label: 'งานแก้ไข\/ต่อเนื่อง \(EMCS\)', href: '\/inspector\/emcs' \}/g) ?? []).length === 2);
check('หน้าเว็บเรียก /api/emcs-backlog · 2 แท็บ รายงานแก้ไข/งานต่อเนื่อง · บอกเวลาข้อมูล',
  page.includes("api.get('/api/emcs-backlog')") && page.includes("edit: 'รายงานแก้ไข', continuous: 'งานต่อเนื่อง'")
  && page.includes('fmtBkk(data.generated_at)'));

console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
