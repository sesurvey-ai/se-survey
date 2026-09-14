/**
 * Contract test — ชั้นเก็บไฟล์อัปโหลด local/S3 (config/storage.ts, 14/09/69)
 *
 * ล็อกกติกา:
 *  1) ทุกจุดที่เขียน/ลบ/ลิสต์ไฟล์รูปถาวร ต้องผ่าน storage — ห้ามแตะ fs ตรง ๆ ใน case/admin/emcsQueue service
 *     (ยกเว้นไฟล์ชั่วคราวของ multer ที่รากดิสก์ ซึ่งอยู่บนดิสก์เสมอ)
 *  2) /uploads: uploadsAuth → serveUploads (S3) → express.static (ดิสก์) ตามลำดับนี้เท่านั้น
 *  3) รูปลงเวลาเข้างานต้องถูกย้ายเข้าที่เก็บจริง (putFromFile) ก่อนบันทึกแถว
 *  4) โหมด local (ค่าเริ่มต้น) ทำงานเหมือนเดิม: put/get/list/del/folderExists/putFromFile/deleteFolder บนดิสก์จริง
 *  5) normalizeKey ปัด path traversal ทุกรูปแบบ
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ── 1) ไม่มีใครแตะดิสก์ตรง ๆ นอกชั้น storage ──
{
  const cs = read('src/services/case.service.ts');
  const disk = cs.match(/fs\.default\.(writeFileSync|unlinkSync|readdirSync|renameSync|mkdirSync|readFileSync|rmSync)/g) ?? [];
  // ที่อนุญาต: ลบไฟล์ชั่วคราวที่รากดิสก์ใน uploadCaseFolder (1 จุด) — นอกนั้นต้องผ่าน storage
  check('case.service ไม่เขียน/ลบ/ลิสต์ไฟล์รูปด้วย fs ตรง ๆ (เหลือเฉพาะไฟล์ชั่วคราวที่ราก)', disk.length <= 1, disk.join(', '));
  check('case.service ไม่ resolve path รูปจาก env.UPLOAD_DIR เอง (ยกเว้นไฟล์ชั่วคราวที่ราก)', (cs.match(/env\.UPLOAD_DIR/g) ?? []).length <= 1);
  for (const fn of ['uploadCaseFolder', 'listCaseFolder', 'addCasePhotos', 'deleteCasePhoto', 'rotateCasePhoto', 'importPhotoZip']) {
    const i = cs.indexOf(`async ${fn}(`);
    const body = cs.slice(i, cs.indexOf('\n  },', i));
    check(`${fn} ใช้ storage.*`, i > 0 && /storage\.(put|putFromFile|list|del|getBuffer|ensureFolder)\(/.test(body));
  }
  const submit = cs.slice(cs.indexOf('async submitSurvey('), cs.indexOf('async reviewCase(') > 0 ? cs.indexOf('async reviewCase(') : undefined);
  check('submitSurvey สแกนโฟลเดอร์รูปผ่าน storage.folderExists + storage.list', /storage\.folderExists\(rel\)/.test(submit) && /storage\.list\(rel\)/.test(submit));

  const admin = read('src/services/admin.service.ts');
  check('admin.service ไม่ import fs/path (purge ลบไฟล์ผ่าน storage)', !/from 'fs'/.test(admin) && !/from 'path'/.test(admin));
  const purge = admin.slice(admin.indexOf('async purgeCase('), admin.indexOf('// ==================== Reviews CRUD'));
  check('purgeCase ลบไฟล์ผ่าน storage.deleteMany + ทิ้งโฟลเดอร์ case_<id> ทั้งก้อน',
    /storage\.deleteMany\(keys\)/.test(purge) && /storage\.deleteFolder\(`case_\$\{id\}`\)/.test(purge));

  const q = read('src/services/emcsQueue.service.ts');
  check('ภาพหน้าจอคิว EMCS เขียนผ่าน storage.put', /storage\.put\(rel, buf, 'image\/png'\)/.test(q) && !/writeFileSync/.test(q));

  const integ = read('src/routes/integration.routes.ts');
  check('/integrations/files อ่านผ่าน storage.get + normalizeKey (ไม่ sendFile จากดิสก์)',
    /normalizeKey\(String\(req\.query\.path/.test(integ) && /storage\.get\(key\)/.test(integ) && !/res\.sendFile\(/.test(integ));
}

// ── 2) ลำดับ middleware /uploads ──
{
  const app = read('src/app.ts');
  const a = app.indexOf('uploadsAuth,'); const b = app.indexOf('serveUploads,'); const c = app.indexOf('express.static(');
  check('/uploads = uploadsAuth → serveUploads → express.static', a > 0 && b > a && c > b);
  const sv = read('src/middleware/serveUploads.ts');
  check('serveUploads โหมด local ผ่านเฉย ๆ · S3 ไม่เจอ → next() ให้ดิสก์', /storage\.driver !== 's3'\) \{ next\(\)/.test(sv) && /if \(!r\) \{ next\(\); return; \}/.test(sv));
  check('serveUploads ไม่เสิร์ฟ dotfile และส่ง header PII เหมือน static เดิม',
    /seg\.startsWith\('\.'\)/.test(sv) && /private, max-age=300/.test(sv) && /nosniff/.test(sv) && /no-referrer/.test(sv));
}

// ── 3) รูปลงเวลา ──
{
  const att = read('src/controllers/attendance.controller.ts');
  const i = att.indexOf('storage.putFromFile(file.path, file.filename');
  const j = att.indexOf('attendanceService.checkIn(');
  check('check-in ย้ายรูปเข้าที่เก็บจริงก่อนบันทึกแถว', i > 0 && j > i);
}

// ── env / package / script ──
{
  const envSrc = read('src/config/env.ts');
  for (const k of ['STORAGE_DRIVER', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_MIGRATE_LOCAL']) {
    check(`env มี ${k}`, new RegExp(`^\\s+${k}:`, 'm').test(envSrc));
  }
  const pkg = JSON.parse(read('package.json'));
  check('มี dependency @aws-sdk/client-s3', !!pkg.dependencies['@aws-sdk/client-s3']);
  check('มีสคริปต์ย้ายไฟล์ + ตรวจที่เก็บ', fs.existsSync(path.join(__dirname, '..', 'src/scripts/migrateUploadsToS3.ts'))
    && fs.existsSync(path.join(__dirname, '..', 'src/scripts/storageCheck.ts')));
  const idx = read('src/index.ts');
  check('index.ts log โหมดที่เก็บตอนบูต + สตาร์ตตัวย้ายไฟล์', /storage\.describe\(\)/.test(idx) && /startUploadMigrator\(\)/.test(idx));
}

// ── 4)+5) โหมด local ทำงานจริงบนดิสก์ชั่วคราว ──
async function functional(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'se-storage-'));
  process.env.UPLOAD_DIR = tmp;
  process.env.STORAGE_DRIVER = 'local';
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost/z';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'contract-test-secret-0123456789';
  const { storage, normalizeKey } = await import('../src/config/storage');

  check('driver=local เมื่อไม่ตั้ง S3_*', storage.driver === 'local');
  check('normalizeKey ปัด traversal', normalizeKey('../x') === null && normalizeKey('a/../b') === null
    && normalizeKey('/case_1//job_1/a.jpg') === 'case_1/job_1/a.jpg' && normalizeKey('C:/x') === null
    && normalizeKey('case_1\\job_1\\a.jpg') === 'case_1/job_1/a.jpg');

  await storage.put('case_9/job_9/a.jpg', Buffer.from('AAA'), 'image/jpeg');
  check('put เขียนไฟล์จริงบนดิสก์', fs.readFileSync(path.join(tmp, 'case_9', 'job_9', 'a.jpg'), 'utf8') === 'AAA');
  check('put ไม่ทิ้งไฟล์ชั่วคราว', !fs.readdirSync(path.join(tmp, 'case_9', 'job_9')).some((f) => f.startsWith('.')));
  const g = await storage.get('case_9/job_9/a.jpg');
  check('get คืน stream + content-type', !!g && g.kind === 'ok' && g.contentType === 'image/jpeg' && g.size === 3);
  if (g && g.kind === 'ok') g.body.destroy();
  check('getBuffer อ่านกลับตรง', (await storage.getBuffer('case_9/job_9/a.jpg'))?.toString() === 'AAA');
  check('exists/folderExists', (await storage.exists('case_9/job_9/a.jpg')) && (await storage.folderExists('case_9/job_9')) && !(await storage.folderExists('case_8/job_8')));

  fs.writeFileSync(path.join(tmp, 'up_tmp1.jpg'), 'BBB');
  await storage.putFromFile(path.join(tmp, 'up_tmp1.jpg'), 'case_9/job_9/b.jpg');
  check('putFromFile ย้ายไฟล์ชั่วคราวเข้าโฟลเดอร์ (ต้นทางหาย)', !fs.existsSync(path.join(tmp, 'up_tmp1.jpg')) && fs.existsSync(path.join(tmp, 'case_9', 'job_9', 'b.jpg')));
  fs.writeFileSync(path.join(tmp, 'att_1.jpg'), 'CCC');
  await storage.putFromFile(path.join(tmp, 'att_1.jpg'), 'att_1.jpg');
  check('putFromFile ที่เดียวกัน = ไม่ทำอะไร (รูปลงเวลาที่ราก)', fs.readFileSync(path.join(tmp, 'att_1.jpg'), 'utf8') === 'CCC');

  check('list คืนชื่อไฟล์เรียงแล้ว ไม่รวม dotfile', JSON.stringify(await storage.list('case_9/job_9')) === '["a.jpg","b.jpg"]'
    && JSON.stringify(await storage.list('none/none')) === '[]');
  await storage.del('case_9/job_9/a.jpg');
  await storage.del('case_9/job_9/missing.jpg');   // ไม่มี = ไม่ error
  check('del ลบไฟล์ (และไม่ error เมื่อไม่มี)', !fs.existsSync(path.join(tmp, 'case_9', 'job_9', 'a.jpg')));
  check('deleteMany คืนรายการที่พลาด (key ไม่ปลอดภัยถูกข้ามเงียบ)', JSON.stringify(await storage.deleteMany(['case_9/job_9/b.jpg', '../evil'])) === '[]');
  await storage.ensureFolder('legacy_claim/legacy_job');
  fs.writeFileSync(path.join(tmp, 'legacy_claim', 'legacy_job', 'x.jpg'), 'X');
  await storage.del('legacy_claim/legacy_job/x.jpg');
  storage.cleanupEmptyFolders(['legacy_claim/legacy_job/x.jpg']);
  check('cleanupEmptyFolders ลบโฟลเดอร์ว่าง 2 ชั้น', !fs.existsSync(path.join(tmp, 'legacy_claim')));
  await storage.deleteFolder('case_9');
  check('deleteFolder ทิ้งโฟลเดอร์เคสทั้งก้อน', !fs.existsSync(path.join(tmp, 'case_9')));
  let threw = false;
  try { await storage.deleteFolder('../x'); } catch { threw = true; }
  check('deleteFolder ปฏิเสธ key ไม่ปลอดภัย', threw);

  fs.rmSync(tmp, { recursive: true, force: true });
}

functional().then(() => {
  console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
  process.exit(failed ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
