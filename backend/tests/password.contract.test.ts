/**
 * การ์ดของ "เปลี่ยนรหัสผ่าน / รีเซ็ตรหัสผ่าน"
 *
 * ครึ่งแรกเรียกฟังก์ชันจริง (`assertStrongPassword` ไม่แตะฐานข้อมูล จึงเทสตรง ๆ ได้)
 * ครึ่งหลังตรวจ "การต่อสาย" ที่พังได้เงียบ ๆ — กติกามีอยู่แต่ไม่มีใครเรียกใช้
 * ก็เท่ากับไม่มีกติกา และไม่มี error ให้เห็นเลยสักที่
 */
import * as fs from 'fs';
import * as path from 'path';
import { assertStrongPassword, PASSWORD_MIN } from '../src/services/password';

let failed = 0;
const check = (label: string, ok: boolean, note = '') => {
  if (!ok) failed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${note ? `  (${note})` : ''}`);
};
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

/** คืนข้อความที่ถูกปฏิเสธ หรือ null ถ้าผ่าน */
const reason = (pw: unknown, user?: string): string | null => {
  try { assertStrongPassword(pw, user); return null; }
  catch (e) { return (e as { message: string }).message; }
};

console.log('\n── กติการหัสผ่าน ──');
check(`ขั้นต่ำ ${PASSWORD_MIN} ตัวอักษร`, PASSWORD_MIN >= 8, String(PASSWORD_MIN));

const mustReject: [string, unknown, string?][] = [
  ['สั้นเกินไป', 'abc123'],
  ['ว่างเปล่า', ''],
  ['ช่องว่างล้วน', '        '],
  ['ไม่ใช่สตริง', 12345678],
  // รหัส = ชื่อผู้ใช้ คือรูปแบบที่เจอบ่อยที่สุดตอนแจกบัญชีทีละหลายคน
  ['เป็นชื่อผู้ใช้', 'checker01', 'checker01'],
  ['มีชื่อผู้ใช้อยู่ในนั้น', 'se408xyz1', 'se408'],
  ['มีคำว่า password', 'password01'],
  ['Password ตัวใหญ่ก็ไม่ผ่าน', 'MyPassword9'],
  ['อยู่ในลิสต์ที่เดาบ่อย', '12345678'],
  ['เลขเรียงลง', '87654321'],
  ['ตัวเดียวซ้ำทั้งหมด', 'aaaaaaaa'],
];
for (const [label, pw, user] of mustReject) {
  check(`ปฏิเสธ: ${label}`, reason(pw, user) !== null);
}

/**
 * ต้องปล่อยผ่านของที่ใช้ได้จริงด้วย — กฎที่เข้มเกินจะถูกเลี่ยงด้วยการจดใส่กระดาษ
 * (ไม่บังคับตัวใหญ่/อักขระพิเศษ โดยตั้งใจ — คนใช้คือช่างที่พิมพ์บนมือถือกลางแดด)
 */
const mustPass: [string, string][] = [
  ['suriya-2569', 'checker01'],
  ['กรุงเทพ1234', 'se408'],
  ['Zx9!kdlm', 'admin01'],
];
for (const [pw, user] of mustPass) {
  check(`ผ่าน: ${pw}`, reason(pw, user) === null, reason(pw, user) ?? '');
}

console.log('\n── การต่อสาย ──');
const routes = read('src', 'routes', 'auth.routes.ts');
check('มี endpoint เปลี่ยนรหัสผ่านของตัวเอง', routes.includes("post('/change-password'"));
check('ต้องล็อกอินก่อน', /post\('\/change-password',\s*auth\b/.test(routes));
/** ช่องนี้เฉลยว่า "รหัสเดิมถูกไหม" — ไม่กั้นความถี่ = เดารหัสเดิมรัวได้จากจอที่เปิดค้าง */
check('จำกัดความถี่', /post\('\/change-password',[\s\S]{0,80}changePwLimiter/.test(routes));

const svc = read('src', 'services', 'auth.service.ts');
/** ⛔ จอที่เปิดค้างไว้ ≠ เจ้าของบัญชี — ไม่ขอรหัสเดิม = ใครเดินมาก็ยึดบัญชีได้ */
check('ต้องยืนยันด้วยรหัสเดิมเสมอ',
      /bcrypt\.compare\(currentPassword, user\.password_hash\)/.test(svc)
      && svc.includes('รหัสผ่านเดิมไม่ถูกต้อง'));
check('รหัสใหม่ต้องผ่านกติกา', /assertStrongPassword\(newPassword, user\.username\)/.test(svc));
check('ห้ามตั้งรหัสเดิมซ้ำ', svc.includes('รหัสผ่านใหม่ซ้ำกับรหัสเดิม'));

/**
 * แอดมินตั้งรหัสอ่อนให้ตั้งแต่แรกได้ = กติกาฝั่งผู้ใช้ไม่มีความหมาย
 * (คนส่วนใหญ่ไม่เคยเปลี่ยนรหัสที่แอดมินตั้งให้)
 */
const admin = read('src', 'services', 'admin.service.ts');
check('แอดมินสร้างผู้ใช้ก็ต้องผ่านกติกา',
      /assertStrongPassword\(data\.password, data\.username\)/.test(admin));
/** ⛔ ต้องเทียบกับ username ของ "บัญชีที่ถูกรีเซ็ต" ไม่ใช่ของแอดมินที่กดปุ่ม */
check('แอดมินรีเซ็ตรหัสให้คนอื่นก็ต้องผ่านกติกา (เทียบชื่อผู้ใช้ของเจ้าของบัญชี)',
      /assertStrongPassword\(data\.password, target\.rows\[0\]\.username\)/.test(admin));

const adminRoutes = read('src', 'routes', 'admin.routes.ts');
check('zod ของแอดมินไม่ต่ำกว่ากติกากลาง',
      !/password: z\.string\(\)\.min\([0-7][,)]/.test(adminRoutes));

console.log('\n── หน้าเว็บ ──');
// 22/09/69 user ย้าย "เปลี่ยนรหัสผ่าน" จากแถบหัวไปไว้ในเมนูตั้งค่า (รูปเฟืองท้ายเมนูข้าง) — ทุก role ยังเห็น
const header = read('..', 'web', 'src', 'components', 'layout', 'Header.tsx');
const settings = read('..', 'web', 'src', 'components', 'layout', 'SettingsMenu.tsx');
check('มีรายการเปลี่ยนรหัสผ่านในเมนูตั้งค่า (ทุก role ที่เข้าเว็บเห็น) และไม่อยู่บนแถบหัวแล้ว',
      settings.includes('เปลี่ยนรหัสผ่าน') && settings.includes('ChangePasswordDialog') && !header.includes('ChangePasswordDialog'));

const dlg = read('..', 'web', 'src', 'components', 'layout', 'ChangePasswordDialog.tsx');
check('ให้พิมพ์รหัสใหม่ 2 ครั้งกันพิมพ์ผิด', dlg.includes('พิมพ์รหัสผ่านใหม่อีกครั้ง'));
/** พิมพ์ผิดตัวเดียวแล้วล็อกอินไม่ได้อีกเลย = ต้องรบกวนแอดมินรีเซ็ตให้ */
check('เตือนว่าเครื่องอื่นยังล็อกอินค้างอยู่', dlg.includes('เครื่องอื่นที่ล็อกอินค้างไว้'));

const users = read('..', 'web', 'src', 'app', 'admin', 'users', 'page.tsx');
check('ตารางผู้ใช้มีปุ่มตั้งรหัสใหม่', users.includes('ResetPasswordDialog') && users.includes('setPwUser'));
const reset = read('..', 'web', 'src', 'app', 'admin', 'users', 'ResetPasswordDialog.tsx');
/** แอดมินต้องอ่านรหัสไปบอกเจ้าตัว — ปิดดาวไว้ยิ่งพิมพ์ผิดแล้วไม่รู้ตัว */
check('ช่องของแอดมินโชว์รหัสให้อ่านได้',
      reset.includes('<input type="text"') && !reset.includes('<input type="password"'));

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด\n' : `\n❌ ไม่ผ่าน ${failed} ข้อ\n`);
process.exit(failed === 0 ? 0 : 1);
