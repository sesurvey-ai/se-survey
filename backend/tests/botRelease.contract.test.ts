/**
 * Contract test — อัปเดตบอท se-autokey ผ่านเน็ต (services/botRelease.ts, routes /bot-release/*, scripts/publishBotRelease.ts · 15/09/69)
 *
 * ล็อกกติกา:
 *  1) latest.json ต้องครบ (version x.y.z · file = se-autokey-<ver>.zip · sha256 64 hex · size > 0) ไม่งั้นไม่ปล่อย
 *  2) route อ่าน/โหลดต้องผ่าน token บอท (integrationAuth) · ตอบ no-store · เวอร์ชันใน URL ต้องเป็น x.y.z เท่านั้น (กัน path แปลก)
 *     · zip stream ผ่านชั้น storage เหมือน /files (ไม่แตะดิสก์เอง)
 *  3) ตัวอัป: ตรวจ sha256/size ของ zip กับ latest.json ก่อน · อัป zip ก่อน latest.json · โหมด local ต้อง --allow-local
 *     · เวอร์ชันเดิมแต่ไฟล์ต่างต้อง --force
 *  4) ฝั่งบอท (ถ้ามี repo se-autokey ข้าง ๆ): path ที่บอทเรียกตรงกับ route ที่นี่ · ห้ามทับ .env/runtime/runs
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import { botReleaseKeys, parseReleaseMeta, BOT_VERSION_RE } from '../src/services/botRelease';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const throwsWith = (fn: () => unknown, needle: string): boolean => {
  try { fn(); return false; } catch (e) { return String((e as Error).message).includes(needle); }
};

// ── 1) latest.json ──
{
  const good = { version: '1.1.0', file: 'se-autokey-1.1.0.zip', sha256: 'A'.repeat(64), size: 1234, built_at: '2026-09-15T10:00:00+00:00', notes: 'x' };
  const m = parseReleaseMeta(good);
  check('latest.json ที่ถูกต้องผ่าน + sha256 เป็นตัวพิมพ์เล็ก', m.version === '1.1.0' && m.sha256 === 'a'.repeat(64) && m.size === 1234 && m.notes === 'x');
  check('version ต้อง x.y.z', throwsWith(() => parseReleaseMeta({ ...good, version: '1.1' }), 'version') && throwsWith(() => parseReleaseMeta({ ...good, version: 'v1.1.0' }), 'version'));
  check('file ต้องตรงกับเวอร์ชัน', throwsWith(() => parseReleaseMeta({ ...good, file: 'se-autokey-1.0.9.zip' }), 'file'));
  check('sha256 ต้อง 64 hex', throwsWith(() => parseReleaseMeta({ ...good, sha256: 'abc' }), 'sha256'));
  check('size ต้องเป็นจำนวนเต็มบวก', throwsWith(() => parseReleaseMeta({ ...good, size: 0 }), 'size') && throwsWith(() => parseReleaseMeta({ ...good, size: '12.5' }), 'size'));
  check('key บนที่เก็บไฟล์อยู่ใต้ releases/se-autokey/ แยกจากรูปเคส',
    botReleaseKeys.latest() === 'releases/se-autokey/latest.json' && botReleaseKeys.zip('1.1.0') === 'releases/se-autokey/se-autokey-1.1.0.zip');
  check('BOT_VERSION_RE รับเฉพาะ x.y.z', BOT_VERSION_RE.test('10.2.33') && !BOT_VERSION_RE.test('1.1') && !BOT_VERSION_RE.test('1.1.0/../x') && !BOT_VERSION_RE.test('latest'));
}

// ── 2) routes ──
{
  const r = read('src/routes/integration.routes.ts');
  const latest = r.slice(r.indexOf("router.get('/bot-release/latest'"), r.indexOf("router.get('/bot-release/:version/zip'"));
  const zip = r.slice(r.indexOf("router.get('/bot-release/:version/zip'"), r.indexOf('// ───────────── คิวนำเข้า EMCS'));
  check('มี route /bot-release/latest + /bot-release/:version/zip และทั้งคู่ผ่าน integrationAuth',
    latest.includes('integrationAuth') && zip.includes('integrationAuth') && latest.length > 0 && zip.length > 0);
  check('latest อ่านจาก storage.getBuffer(botReleaseKeys.latest()) ตอบ {success, data} + no-store · ไม่มี = 404',
    latest.includes('storage.getBuffer(botReleaseKeys.latest())') && latest.includes("'Cache-Control', 'no-store'") && latest.includes('res.status(404)') && latest.includes('data: meta'));
  check('zip: ตรวจ BOT_VERSION_RE ก่อน (400) แล้ว stream ผ่าน storage.get แบบเดียวกับ /files',
    zip.includes('BOT_VERSION_RE.test(version)') && zip.includes('res.status(400)') && zip.includes('storage.get(botReleaseKeys.zip(version))')
    && zip.includes('r.body.pipe(res)') && zip.includes("r.kind !== 'ok'") && !/fs\./.test(zip));
  check('zip ตอบ application/zip + Content-Disposition + no-store',
    zip.includes("'Content-Type', 'application/zip'") && zip.includes('Content-Disposition') && zip.includes("'Cache-Control', 'no-store'"));
  check('เทสอยู่ใน npm test', read('package.json').includes('tests/botRelease.contract.test.ts'));
}

// ── 3) ตัวอัป ──
{
  const s = read('src/scripts/publishBotRelease.ts');
  const iSha = s.indexOf("createHash('sha256')"), iZipPut = s.indexOf('storage.put(botReleaseKeys.zip('), iLatestPut = s.indexOf('storage.put(botReleaseKeys.latest()');
  check('ตรวจ sha256 + size ก่อนอัป', iSha > 0 && iSha < iZipPut && s.includes('sha !== meta.sha256') && s.includes('zip.length !== meta.size'));
  check('อัป zip ก่อน latest.json (ล้มกลางคันแล้วเครื่องปลายทางไม่ชี้ไป zip ที่ยังไม่มี)', iZipPut > 0 && iZipPut < iLatestPut);
  check('อ่าน head กลับหลังอัป zip', s.indexOf('storage.head(botReleaseKeys.zip(') > iZipPut && s.indexOf('storage.head(botReleaseKeys.zip(') < iLatestPut);
  check('โหมด local ต้อง --allow-local · เวอร์ชันเดิมแต่ไฟล์ต่างต้อง --force', s.includes("storage.driver !== 's3' && !allowLocal") && s.includes('prev.sha256 !== meta.sha256 && !force'));
  check('ไม่เขียนดิสก์ uploads เอง (ผ่าน storage เท่านั้น)', !/fs\.(writeFileSync|mkdirSync|copyFileSync)/.test(s));
}

// ── 4) ฝั่งบอท (se-autokey ข้าง ๆ — ข้ามถ้าไม่มี) ──
{
  const bot = path.join(__dirname, '..', '..', '..', 'se-autokey');
  if (fs.existsSync(path.join(bot, 'autokey', 'updater.py'))) {
    const u = fs.readFileSync(path.join(bot, 'autokey', 'updater.py'), 'utf8');
    check('บอท: path ที่เรียกตรงกับ route ที่นี่',
      u.includes('RELEASE_LATEST = "/api/integrations/bot-release/latest"') && u.includes('RELEASE_ZIP = "/api/integrations/bot-release/{version}/zip"'));
    check('บอท: ตรวจ sha256 ก่อนติดตั้ง + ไม่ทับ .env/runtime/runs + ต้องมี webui.py/main.py ใน zip',
      u.includes('sha256_file(dest)') && /"runtime", "runs"/.test(u) && u.includes('name.startswith(".env.")') && u.includes('REQUIRED_IN_ZIP'));
    const w = fs.readFileSync(path.join(bot, 'webui.py'), 'utf8');
    check('บอท: หน้าเว็บมีปุ่มตรวจอัปเดต + /update/apply กันอัปกลางงาน (409) และรับเฉพาะหน้าในเครื่อง (403)',
      w.includes('id="updcheck"') && w.includes('"/update/apply"') && w.includes('_active_count()') && w.includes('updater.restart(port=_SERVER_PORT'));
    const mk = fs.readFileSync(path.join(bot, 'tools', 'make_release.py'), 'utf8');
    check('บอท: make_release.py เขียน latest.json ครบช่องที่ parseReleaseMeta ต้องการ',
      ['"version"', '"file"', '"sha256"', '"size"', '"built_at"', '"notes"'].every((k) => mk.includes(k)));
  } else {
    console.log('[SKIP] ไม่มี repo se-autokey ข้าง ๆ — ข้ามเทสฝั่งบอท');
  }
}

console.log(failed ? `\n${failed} FAILED ❌` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
