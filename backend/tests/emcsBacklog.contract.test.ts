/**
 * Contract test — หน้า "งานแก้ไข/ต่อเนื่อง (EMCS)" (user สั่ง 25/09/69)
 *
 * ข้อมูลมาจาก snapshot ของ se-billing (`GET /api/dashboard` ที่ scraper ดึงจากกล่อง INBOX ของ EMCS วันละครั้ง)
 * ล็อก: รายการเต็มจาก emcs_inbox (เกิน 2 ปีติดป้าย ไม่ตัด · แถวไม่มีเลขเคลมก็อยู่) · snapshot รุ่นเก่ายังอ่านได้
 *      · หัวหน้าผู้ตรวจเห็นเฉพาะงานของตัวเอง แอดมินเห็นทุกคน (กรองที่ server) · ไม่เข้า EMCS เอง
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import {
  flattenBacklog, matchSupervisor, normPersonName, snapshotBacklog, visibleRows, UNKNOWN_SUPERVISOR,
} from '../src/services/emcsBacklogCore';

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
const names = ['นาย ศุภชัย เศรษฐชัยชาญ', 'นายวุฒิชัย ต้นจันทร์'];
check('จับบัญชีที่ล็อกอินกับหัวหน้าในข้อมูลได้ · ไม่เจอ/ชื่อว่าง = null',
  matchSupervisor(names, 'วุฒิชัย ต้นจันทร์') === 'นายวุฒิชัย ต้นจันทร์'
  && matchSupervisor(names, 'ศุภชัย เศรษฐชัยชาญ') === 'นาย ศุภชัย เศรษฐชัยชาญ'
  && matchSupervisor(names, 'ประเสริฐ ตรวจงาน') === null
  && matchSupervisor(names, ' ') === null);

// ── snapshot รุ่นเก่า (ไม่มี emcs_inbox) ยังอ่านได้ ──
const oldSnap = {
  generated_at: '2026-09-25T06:01:53+07:00',
  supervisors: [
    { name: 'นาย ศุภชัย เศรษฐชัยชาญ',
      emcs_edit_items: [{ claim_no: '2026013058321', date: '01/ส.ค./2569 12:21', aging_days: 55 }, { claim_no: '  ', date: 'x', aging_days: 1 }],
      emcs_continuous_items: [{ claim_no: '2026013101438', date: '26/มี.ค./2569 18:04', aging_days: 183 }] },
    { name: 'นายวุฒิชัย ต้นจันทร์',
      emcs_edit_items: [{ claim_no: '20250131A4503', date: '14/ม.ค./2569 13:56', aging_days: 254 }, { claim_no: '2026013000001', date: '', aging_days: null }] },
    { name: '', emcs_edit_items: [{ claim_no: '2026013000002', date: '20/ก.ย./2569 10:00', aging_days: 5 }] },
    null,
  ],
};
const f = flattenBacklog(oldSnap);
check('รุ่นเก่า: เรื่องละแถว ข้ามแถวไม่มีเลขเคลม · เรียงค้างนานสุดก่อน อายุว่างอยู่ท้าย',
  f.edit.length === 4 && f.continuous.length === 1 && f.edit.map((x) => x.aging_days).join(',') === '254,55,5,');
check('รุ่นเก่า: หัวหน้าติดไปกับแถว · ชื่อว่าง = "sesurvey"',
  f.edit[0].supervisor === 'นายวุฒิชัย ต้นจันทร์' && f.edit[2].supervisor === UNKNOWN_SUPERVISOR);
const sOld = snapshotBacklog(oldSnap);
check('snapshot ไม่มี emcs_inbox = complete false (หน้าเว็บบอกว่ารอบหน้าจะครบ)', sOld.complete === false && sOld.lists.edit.length === 4);
check('snapshot ว่าง/null ไม่ล้ม', snapshotBacklog(null).lists.edit.length === 0 && flattenBacklog({}).continuous.length === 0);

// ── รายการเต็มจาก emcs_inbox (scraper รุ่น 25/09/69) ──
const newSnap = {
  ...oldSnap,
  emcs_inbox: {
    ok: true, max_age_years: 2, totals: { edit: 2, continuous: 3 },
    edit: [
      { date: '09/เม.ย./2566 13:26', aging_days: 900, over_age: true, claim_no: '2023013026342', esurvey_no: 'S66', survey_no: 'SEABI-1', supervisor: 'นาย ศุภชัย เศรษฐชัยชาญ', follow_type: '' },
      { date: '01/ส.ค./2569 12:21', aging_days: 55, over_age: false, claim_no: '2026013058321', esurvey_no: 'S684', supervisor: 'นายวุฒิชัย ต้นจันทร์', lock_by: 'สุทิษา พงษ์แขก' },
    ],
    continuous: [
      { date: '20/ก.ย./2569 10:00', aging_days: 5, over_age: false, claim_no: '', esurvey_no: 'S685', survey_no: 'SETP-6909-1', supervisor: 'นายสราวุธ บุญคุ้ม', follow_type: 'งานติดตาม - รถหาย' },
      { date: '26/มี.ค./2569 18:04', aging_days: 183, over_age: false, claim_no: '2026013101438', supervisor: 'sesurvey', follow_type: '-' },
      { date: '01/ม.ค./2566 09:00', aging_days: 1000, claim_no: '2022013000009', supervisor: 'นาย ศุภชัย เศรษฐชัยชาญ' },
    ],
  },
};
const sNew = snapshotBacklog(newSnap);
check('มี emcs_inbox = ใช้รายการเต็ม (complete) ไม่ใช่ items เดิม', sNew.complete === true && sNew.ok === true
  && sNew.lists.edit.length === 2 && sNew.lists.continuous.length === 3);
check('เกิน 2 ปี ไม่ถูกตัด · ติดธง over_age (มีธงจาก scraper หรือคิดจากอายุเมื่อไม่มีธง)',
  sNew.lists.edit[0].over_age === true && sNew.lists.continuous[0].aging_days === 1000 && sNew.lists.continuous[0].over_age === true
  && sNew.lists.edit[1].over_age === false);
check('แถวไม่มีเลขเคลมอยู่ด้วย · ประเภทงานติดตาม "-" = ว่าง · เลข e-Survey/ผู้ล็อกติดมา',
  sNew.lists.continuous.some((x) => x.claim_no === '' && x.esurvey_no === 'S685' && x.follow_type === 'งานติดตาม - รถหาย')
  && sNew.lists.continuous.find((x) => x.claim_no === '2026013101438')!.follow_type === ''
  && sNew.lists.edit[1].lock_by === 'สุทิษา พงษ์แขก');
check('รอบที่ตัวดึงเข้า EMCS ไม่ได้ (ok=false) ส่งต่อให้หน้าเว็บเตือน',
  snapshotBacklog({ emcs_inbox: { ok: false, edit: [], continuous: [] } }).ok === false);

// ── ใครเห็นอะไร: หัวหน้าเห็นเฉพาะของตัวเอง · แอดมินเห็นทุกคน ──
const allRows = [...sNew.lists.edit, ...sNew.lists.continuous];
check('แอดมินเห็นทุกแถว (รวม "ไม่พบหัวหน้า")', visibleRows(allRows, true, null).length === 5);
check('ศุภชัยเห็นแค่งานของศุภชัย', visibleRows(allRows, false, 'นาย ศุภชัย เศรษฐชัยชาญ').length === 2
  && visibleRows(allRows, false, 'นาย ศุภชัย เศรษฐชัยชาญ').every((x) => x.supervisor === 'นาย ศุภชัย เศรษฐชัยชาญ'));
check('หัวหน้าที่จับชื่อไม่ได้ ไม่เห็นอะไรเลย (ไม่ใช่เห็นทั้งหมด)', visibleRows(allRows, false, null).length === 0);

// ── API: เฉพาะ checker/admin · กรองที่ server · ต้นทางคือ se-billing ไม่ใช่ EMCS ──
const index = read('backend', 'src', 'routes', 'index.ts');
const route = read('backend', 'src', 'routes', 'emcsBacklog.routes.ts');
const svc = read('backend', 'src', 'services', 'emcsBacklog.service.ts');
check('ลงทะเบียน /api/emcs-backlog', index.includes("router.use('/emcs-backlog', emcsBacklogRoutes);"));
check('API เฉพาะ checker/admin มีแค่ GET และส่ง role ของคนเรียกให้ service กรอง',
  route.includes("router.get('/', auth, requireRole('checker', 'admin'),") && !/router\.(post|put|patch|delete)\(/.test(route)
  && route.includes('getEmcsBacklog({ id: req.user!.id, role: req.user!.role })'));
check('service กรองก่อนส่ง: แอดมิน = ทุกแถว · อื่น ๆ = เฉพาะหัวหน้าที่ชื่อตรงบัญชี (ไม่จับกับ "ไม่พบหัวหน้า")',
  svc.includes("const seeAll = viewer.role === 'admin';")
  && svc.includes('visibleRows(b.lists.edit, seeAll, mySupervisor)') && svc.includes('visibleRows(b.lists.continuous, seeAll, mySupervisor)')
  && svc.includes('names.filter((n) => n !== UNKNOWN_SUPERVISOR)'));
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
check('หน้าเว็บ: 2 แท็บ · บอกเวลาข้อมูล · ป้ายเล็ก "เกิน N ปี" · ปุ่มเลือกหัวหน้า/คอลัมน์หัวหน้าเฉพาะแอดมิน',
  page.includes("api.get('/api/emcs-backlog')") && page.includes("edit: 'รายงานแก้ไข', continuous: 'งานต่อเนื่อง'")
  && page.includes('fmtBkk(data.generated_at)') && page.includes('{r.over_age && (') && page.includes('เกิน {data.max_age_years} ปี')
  && page.includes('{isAll && (') && page.includes("{isAll && <th className=\"px-3 py-2 text-left\">หัวหน้า</th>}"));

console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
