/**
 * Contract test — รูปลงเวลาใช้แสดงวันต่อวัน ไม่เก็บย้อนหลัง (utils/photoRetention.ts, user เคาะ 25/09/69)
 *
 * ล็อกกติกา:
 *  1) ค่าเริ่มต้น = รายงานอย่างเดียว · ลบจริงเมื่อ PHOTO_RETENTION_ENABLED === '1' เท่านั้น (ลบถาวร กู้ไม่ได้ — user เปิดเอง)
 *  2) ลบเมื่อพ้นวันที่ลงเวลา (วันไทย) และลงเวลาออกแล้ว — เวรดึกที่ยังเปิดอยู่ไม่เกิน STALE_OPEN_HOURS ห้ามแตะ · รันทุกชั่วโมง
 *  3) ลบไฟล์ผ่าน storage.del แล้วล้าง check_in_photo = NULL เฉพาะแถวที่ยังชี้ไฟล์เดิม · ไม่แตะ fs ตรง ๆ
 *  4) ไฟล์ att_* ที่ไม่มีแถวอ้างถึง ลบตามเวลาในชื่อไฟล์ — ไฟล์ที่ยังมีแถวอ้างถึง/ยังไม่ถึงอายุ/ชื่อแปลก ห้ามแตะ
 *  5) เริ่มทำงานตอนเปิดเซิร์ฟเวอร์ (index.ts)
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

const src = read('src/utils/photoRetention.ts');
check('วันต่อวัน: ลบเมื่อพ้นวันที่ลงเวลา (วันไทย) + ลงเวลาออกแล้ว หรือรอบค้างเกิน STALE_OPEN_HOURS',
  /AND work_date < \$\{BKK_DATE\}/.test(src)
  && /AND \(check_out_at IS NOT NULL OR check_in_at < \$\{BKK\} - INTERVAL '\$\{STALE_OPEN_HOURS\} hours'\)/.test(src)
  && /import \{ STALE_OPEN_HOURS \} from '\.\.\/services\/attendance\.service'/.test(src)
  && !/ATTENDANCE_PHOTO_(DAYS|YEARS)/.test(src));
check('รันทุกชั่วโมง (พ้นเที่ยงคืน/ลงเวลาออกแล้วลบภายใน 1 ชม.)', /const RUN_EVERY_MS = 60 \* 60 \* 1000;/.test(src));
check('เปิดลบจริงได้ทางเดียว: PHOTO_RETENTION_ENABLED === \'1\'', /process\.env\.PHOTO_RETENTION_ENABLED === '1'/.test(src)
  && /const apply = retentionEnabled\(\);/.test(src) && /purgeAttendancePhotos\(\{ apply \}\)/.test(src));
check('โหมดรายงาน: นับเสร็จแล้ว return ก่อนถึงคำสั่งลบ', src.indexOf('if (!opts.apply) return stats;') > 0
  && src.indexOf('if (!opts.apply) return stats;') < src.indexOf('storage.del('));
check('เทียบอายุกับเวลาไทย (ไม่ใช้ NOW() ดิบ)', /check_in_at < \$\{BKK\} - INTERVAL/.test(src) && /NOW\(\) AT TIME ZONE 'Asia\/Bangkok'/.test(src));
check('ลบไฟล์ผ่าน storage.del · ไม่ import fs', /storage\.del\(r\.check_in_photo\)/.test(src) && !/from 'fs'/.test(src));
check('ล้าง check_in_photo = NULL เฉพาะแถวที่ยังชี้ไฟล์เดิม',
  /SET check_in_photo = NULL WHERE id = \$1 AND check_in_photo = \$2/.test(src));
check('ไฟล์ไม่มีแถวอ้างถึง ลิสต์จาก storage.listRootFiles(\'att_\')', /storage\.listRootFiles\('att_'\)/.test(src));
const idx = read('src/index.ts');
check('index.ts เริ่มตัวลบตามอายุตอนเปิดเซิร์ฟเวอร์', /import \{ startPhotoRetention \} from '\.\/utils\/photoRetention'/.test(idx)
  && /\nstartPhotoRetention\(\);/.test(idx));

async function functional() {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost/z';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'contract-test-secret-0123456789';
  const { expiredOrphans, retentionEnabled, orphanCutoffMs } = await import('../src/utils/photoRetention');
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  check('ไฟล์ไม่มีแถวอ้างถึง: เส้นตัด 24 ชม.', orphanCutoffMs(now) === now - 24 * hour);
  const old = `att_${now - 30 * hour}_aaaa1111.jpg`;
  const oldRef = `att_${now - 30 * hour}_bbbb2222.jpg`;
  const fresh = `att_${now - 2 * hour}_cccc3333.jpg`;
  const got = expiredOrphans([old, oldRef, fresh, 'att_x.jpg', 'up_1.jpg', `att_${now - 30 * hour}_dd/ee.jpg`],
    new Set([oldRef]), orphanCutoffMs(now));
  check('ไฟล์ไม่มีแถวอ้างถึง: ลบเฉพาะที่เกิน 24 ชม. · ไฟล์ 2 ชม. (อาจกำลังลงเวลา) ไม่แตะ · ไม่แตะไฟล์ที่ยังมีแถว/ชื่อไม่ตรงแบบ',
    JSON.stringify(got) === JSON.stringify([old]), JSON.stringify(got));
  const keep = process.env.PHOTO_RETENTION_ENABLED;
  delete process.env.PHOTO_RETENTION_ENABLED;
  const off = retentionEnabled();
  process.env.PHOTO_RETENTION_ENABLED = 'true';
  const wordTrue = retentionEnabled();
  process.env.PHOTO_RETENTION_ENABLED = '1';
  const on = retentionEnabled();
  if (keep === undefined) delete process.env.PHOTO_RETENTION_ENABLED; else process.env.PHOTO_RETENTION_ENABLED = keep;
  check('ไม่ตั้งค่า = ปิด · "true" ก็ยังปิด · "1" = เปิด', off === false && wordTrue === false && on === true);
}

functional().then(() => {
  console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
  process.exit(failed ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
