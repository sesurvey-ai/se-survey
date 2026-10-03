/**
 * Contract test — ช่างทุกคนต้องมีทีมตั้งแต่ถูกสร้าง (user สั่ง 03/10/69)
 *
 * ที่มา: หน้า "รายการงาน" ของหัวหน้าเห็นเฉพาะงานของช่างในทีมตัวเอง (+ งานที่ดึง/สร้างเอง)
 * ช่างที่ไม่อยู่ทีมไหน = งานที่เขาส่งจากแอปไม่ขึ้นให้หัวหน้าทีมคนไหนเห็นเลย
 * ทางสร้างช่างที่ไม่บังคับทีมมีทางเดียวคือ "นำเข้าทะเบียนจากไฟล์ Excel ของฝ่ายบุคคล" → user สั่งปิด
 * (ช่างส่วนใหญ่อยู่ในระบบแล้ว · สร้างคนใหม่ที่ "เพิ่มผู้ใช้ใหม่" ต้องเลือกหัวหน้าอยู่แล้ว)
 *
 * ล็อกไว้:
 *  1) สร้างช่างได้ทางเดียว (POST /api/admin/users) และ backend ปฏิเสธถ้าไม่ระบุทีม · หน้าเว็บบังคับเลือก
 *  2) ทางนำเข้า Excel ไม่มีแล้วทั้ง API / ตัวอ่านไฟล์ / ปุ่มบนหน้าเว็บ — อย่าเอากลับมา
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';

let failed = 0;
function check(name: string, cond: boolean) {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}`);
  if (!cond) failed++;
}
const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
const exists = (...p: string[]) => fs.existsSync(path.join(root, ...p));
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []);

// ── 1) สร้างช่างต้องมีทีม ──
const adminSvc = read('backend', 'src', 'services', 'admin.service.ts');
check('backend: สร้างช่างโดยไม่ระบุทีม → 400',
  /if \(data\.role === 'surveyor' && !data\.staff_group_id\) \{\s*throw new AppError\(400, 'ช่างสำรวจต้องระบุหัวหน้า\/ทีมที่สังกัด'\);/.test(adminSvc));
check('backend: สร้างเสร็จแล้วใส่เข้าทีมทันที', adminSvc.includes("if (data.role === 'surveyor') await staffGroupService.setSurveyorGroup(user.id, data.staff_group_id ?? null);"));
const newUser = read('web', 'src', 'app', 'admin', 'users', 'new', 'page.tsx');
check('เว็บ: ช่องหัวหน้า/ทีมบังคับเลือกเมื่อสร้างช่าง',
  /\{form\.role === 'surveyor' && \([\s\S]{0,800}<select value=\{form\.staff_group_id\} onChange=\{[^\n]*\} required/.test(newUser));

// ── 2) ทางนำเข้า Excel ปิดแล้ว ──
const routes = read('backend', 'src', 'routes', 'admin.routes.ts');
check('ไม่มีเส้นทาง POST /api/admin/staff/import', !/router\.post\('\/staff\/import'/.test(routes));
check('ไม่มีตัวอ่าน/นำเข้าไฟล์ทะเบียน (staffImport.service.ts)', !exists('backend', 'src', 'services', 'staffImport.service.ts'));
check('ไม่มีปุ่มนำเข้าบนหน้าเว็บ (StaffImportPanel)', !exists('web', 'src', 'components', 'admin', 'StaffImportPanel.tsx'));
const backendSrc = walk(path.join(root, 'backend', 'src')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const webSrc = walk(path.join(root, 'web', 'src')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
check('ไม่มีที่ไหนเรียก /staff/import หรือ StaffImportPanel แล้ว', !webSrc.includes("'/api/admin/staff/import'") && !webSrc.includes('StaffImportPanel'));
// โหมด "รหัสผ่าน = เลข 3 ตัวท้ายรหัสพนักงาน" อยู่กับตัวนำเข้าเท่านั้น — หายไปพร้อมกัน
check('ไม่มีโหมดรหัสผ่าน 3 หลักท้ายรหัสพนักงาน (code3) เหลือใน backend', !/passwordMode|'code3'/.test(backendSrc));

if (failed) {
  console.error(`\n${failed} ข้อไม่ผ่าน`);
  process.exit(1);
}
console.log('\nช่างทุกคนต้องมีทีม · ทางนำเข้า Excel ปิดแล้ว: ผ่านทุกข้อ');
process.exit(0);
