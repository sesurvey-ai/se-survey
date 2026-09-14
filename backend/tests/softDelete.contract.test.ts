/**
 * Contract test — ลบเคสแบบพักไว้ (soft delete) + ถังขยะ (migration 062, 14/09/69)
 *
 * ล็อกกติกา:
 *  1) `cases` เป็น VIEW ของ `cases_all` (เห็นเฉพาะ deleted_at IS NULL) — โค้ดเดิม 50+ จุดจึงมองไม่เห็นเคสในถังขยะเอง
 *  2) ปุ่มลบของแอดมิน = พักไว้ (UPDATE cases_all SET deleted_at) ไม่ใช่ DELETE · ลบจริงมีแค่ purgeCase (เฉพาะแถวในถังขยะ)
 *  3) ตัวลบอัตโนมัติหลัง TRASH_DAYS ถูกสตาร์ตตอนเปิดเซิร์ฟเวอร์
 *  4) ⛔ migration หลัง 062 ห้าม `ALTER TABLE cases` ตรง ๆ (ต้องแก้ cases_all แล้ว CREATE OR REPLACE VIEW) — VIEW ตรึงคอลัมน์ไว้ตอนสร้าง
 *  5) INSERT INTO cases ห้ามใช้ ON CONFLICT (VIEW ไม่รองรับ)
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
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const mig = read('src/db/migrations/062_soft_delete.sql');
check('062: เปลี่ยนชื่อตารางจริงเป็น cases_all และสร้าง VIEW cases ที่กรอง deleted_at IS NULL',
  /ALTER TABLE cases RENAME TO cases_all/.test(mig) && /CREATE VIEW cases AS\s+SELECT \* FROM cases_all WHERE deleted_at IS NULL/.test(mig));
check('062: เพิ่ม deleted_at/deleted_by ก่อนเปลี่ยนชื่อ (VIEW ต้องเห็นคอลัมน์นี้)',
  mig.indexOf('ADD COLUMN IF NOT EXISTS deleted_at') < mig.indexOf('RENAME TO cases_all')
  && mig.indexOf('ADD COLUMN IF NOT EXISTS deleted_by') < mig.indexOf('RENAME TO cases_all'));

const admin = read('src/services/admin.service.ts');
check('deleteCase = พักไว้ (UPDATE cases_all SET deleted_at = now()) ไม่ใช่ DELETE',
  /async deleteCase\([\s\S]*?UPDATE cases_all SET deleted_at = now\(\)/.test(admin)
  && !/async deleteCase\([\s\S]{0,1500}?DELETE FROM cases/.test(admin.slice(admin.indexOf('async deleteCase('), admin.indexOf('async purgeCase('))));
check('purgeCase ลบจริงเฉพาะแถวที่อยู่ในถังขยะ (cases_all ... deleted_at IS NOT NULL)',
  /DELETE FROM cases_all WHERE id = \$1 AND deleted_at IS NOT NULL RETURNING id/.test(admin));
check('restoreCase ล้าง deleted_at และส่งยอดกลับ se-billing ถ้าเคสอนุมัติแล้ว',
  /async restoreCase\([\s\S]*?SET deleted_at = NULL, deleted_by = NULL[\s\S]*?sendCapture\(/.test(admin));
check('purgeExpired ใช้ TRASH_DAYS = 30', /export const TRASH_DAYS = 30/.test(admin) && /async purgeExpired\(/.test(admin));
{
  const body = admin.slice(admin.indexOf('async listTrash('), admin.indexOf('async restoreCase('));
  check('listTrash อ่านจาก cases_all และคืนจำนวนวันที่เหลือ', /FROM cases_all ca/.test(body) && /AS days_left/.test(body) && /deleted_at IS NOT NULL/.test(body));
}

const routes = read('src/routes/admin.routes.ts');
check('เส้นทาง /cases/trash ประกาศก่อน /cases/:id (ไม่งั้นโดนจับเป็น id="trash")',
  routes.indexOf("router.get('/cases/trash'") > 0 && routes.indexOf("router.get('/cases/trash'") < routes.indexOf("router.get('/cases/:id'"));
check('มีเส้นทาง กู้คืน + ลบถาวร',
  /router\.post\('\/cases\/:id\/restore'/.test(routes) && /router\.delete\('\/cases\/:id\/purge'/.test(routes));

const index = read('src/index.ts');
check('ตัวลบอัตโนมัติ (trashPurge) ถูกสตาร์ตตอนเปิดเซิร์ฟเวอร์', /startTrashPurge\(\)/.test(index));

// 4) กับดัก VIEW: migration หลัง 062 ต้องแก้ cases_all ไม่ใช่ cases
const migDir = path.join(__dirname, '..', 'src/db/migrations');
const later = fs.readdirSync(migDir).filter((f) => /^\d{3}_/.test(f) && Number(f.slice(0, 3)) > 62);
const offenders = later.filter((f) => /ALTER TABLE\s+cases\b(?!_all)/.test(fs.readFileSync(path.join(migDir, f), 'utf8')));
check('migration หลัง 062 ไม่มี ALTER TABLE cases ตรง ๆ (ต้องเป็น cases_all + CREATE OR REPLACE VIEW)',
  offenders.length === 0, offenders.join(', '));

// 5) VIEW ไม่รองรับ ON CONFLICT
const svcDir = path.join(__dirname, '..', 'src');
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const bad = walk(svcDir).filter((f) => f.endsWith('.ts')).filter((f) => {
  const s = fs.readFileSync(f, 'utf8');
  return /INSERT INTO cases\b(?!_all)[\s\S]{0,800}?ON CONFLICT/.test(s);
});
check('ไม่มี INSERT INTO cases ... ON CONFLICT (VIEW ไม่รองรับ)', bad.length === 0, bad.join(', '));

console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
