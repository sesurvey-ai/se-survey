/**
 * Contract test — log ชี้ตัวแอป APK เก่า (25/09/69 ตามเรื่อง SE259 โหลดรูปลงเวลาไม่ขึ้น)
 *
 * ล็อกกติกา:
 *  1) แอป Flutter (UA "Dart/…") ที่ไม่ส่ง X-App-Version (= APK ก่อน 1.0.40) → log [appVersion] ครั้งเดียวต่อคน · ไม่แตะ DB
 *  2) คำขอที่ไม่ใช่แอป Flutter (ตัวตอบพิกัด native UA Dalvik) ไม่ log — มันไม่ส่ง header นี้อยู่แล้ว
 *  3) /uploads ที่ไม่แนบ token เลย → ยังตอบ 401 เหมือนเดิม + log [uploadsAuth] ชั่วโมงละครั้งต่อ UA
 *
 * รัน: npm test   (backend/)
 */
let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}

async function main() {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost/z';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'contract-test-secret-0123456789';
  const { recordAppVersion } = await import('../src/middleware/appVersion');
  const { uploadsAuth } = await import('../src/middleware/uploadsAuth');

  const logs: string[] = [];
  const origLog = console.log;
  const capture = (fn: () => void | Promise<void>) => async () => {
    console.log = (...a: unknown[]) => { logs.push(a.map(String).join(' ')); };
    try { await fn(); } finally { console.log = origLog; }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mkReq = (ua: string, extra: Record<string, unknown> = {}): any => ({
    headers: { 'user-agent': ua }, method: 'GET', baseUrl: '/api/attendance', path: '/mine', query: {},
    user: { id: 37, username: 'se259', role: 'surveyor' }, ...extra,
  });

  await capture(() => {
    recordAppVersion(mkReq('Dart/3.4 (dart:io)'), 37);
    recordAppVersion(mkReq('Dart/3.4 (dart:io)'), 37);
    recordAppVersion(mkReq('Dalvik/2.1.0 (Linux; U; Android 13)'), 38);
  })();
  const appLogs = logs.filter((l) => l.startsWith('[appVersion]'));
  check('แอป Flutter ไม่ส่งเวอร์ชัน → log ครั้งเดียวต่อคน พร้อมชื่อผู้ใช้ + UA + path เต็ม',
    appLogs.length === 1 && appLogs[0].includes('se259') && appLogs[0].includes('Dart/3.4') && appLogs[0].includes('GET /api/attendance/mine'),
    JSON.stringify(appLogs));
  check('คำขอจากตัวตอบพิกัด native (Dalvik) ไม่ log', !appLogs.some((l) => l.includes('Dalvik')));

  logs.length = 0;
  let status = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = { status(s: number) { status = s; return this; }, json() { return this; } };
  let nextCalled = false;
  await capture(async () => {
    await uploadsAuth(mkReq('Dart/2.19 (dart:io)', { path: '/att_1790206441699_8700bb2d.jpg', user: undefined }), res, () => { nextCalled = true; });
    await uploadsAuth(mkReq('Dart/2.19 (dart:io)', { path: '/att_1789688196072_800ec609.jpg', user: undefined }), res, () => { nextCalled = true; });
  })();
  const upLogs = logs.filter((l) => l.startsWith('[uploadsAuth]'));
  check('/uploads ไม่แนบ token → ยังตอบ 401 และไม่ปล่อยผ่าน', status === 401 && !nextCalled);
  check('/uploads ไม่แนบ token → log ชั่วโมงละครั้งต่อ UA ระบุว่าเป็นรูปลงเวลา',
    upLogs.length === 1 && upLogs[0].includes('รูปลงเวลา') && upLogs[0].includes('Dart/2.19'), JSON.stringify(upLogs));
}

main().then(() => {
  console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
  process.exit(failed ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
