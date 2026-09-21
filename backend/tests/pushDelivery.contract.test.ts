/**
 * การ์ดของ "แจ้งเตือนงานใหม่ต้องรู้ว่าถึงเครื่องหรือไม่" (31/08/69)
 *
 * ⛔ ปัญหาที่แก้: FCM ตอบ success = **Google รับเรื่องไว้** ไม่ได้แปลว่าเครื่องได้รับ
 *    ถ้า push หายกลางทาง ไม่มีใครในระบบรู้เลย ทั้งช่างและคนจ่ายงาน กว่าจะรู้คือลูกค้าโทรมาถาม
 *
 * สายนี้พาดข้าม 4 ชั้น (Kotlin → API → DB → เว็บ) และ **พังแบบเงียบได้ทุกข้อต่อ**:
 * ลืมต่อสายตรงไหนก็ตาม หน้าจอยังทำงานปกติทุกอย่าง แค่กลับไปเป็น "ยิงแล้วไม่รู้ว่าถึงไหม"
 * เหมือนเดิมโดยไม่มี error ให้เห็น — จึงต้องมีการ์ดไล่ทีละข้อต่อ
 */
import * as fs from 'fs';
import * as path from 'path';

let failed = 0;
const check = (label: string, ok: boolean, note = '') => {
  if (!ok) failed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${note ? `  (${note})` : ''}`);
};
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const caseSvc = read('src', 'services', 'case.service.ts');
const pushSvc = read('src', 'services', 'surveyPush.service.ts');   // บล็อก push ย้ายมาที่นี่ 22/09/69 (ทางแอดมินใช้ร่วม)
const adminSvc = read('src', 'services', 'admin.service.ts');
const fcmApi = read('src', 'services', 'fcm.service.ts');
const caseRoutes = read('src', 'routes', 'case.routes.ts');
const userSvc = read('src', 'services', 'user.service.ts');
const userRoutes = read('src', 'routes', 'user.routes.ts');
const migration = read('src', 'db', 'migrations', '046_push_delivery.sql');
const assignUi = read('..', 'web', 'src', 'components', 'cases', 'AssignSurveyor.tsx');
const readyUi = read('..', 'web', 'src', 'app', 'callcenter', 'notification-readiness', 'page.tsx');
const kt = (f: string) => read('..', 'mobile', 'android', 'app', 'src', 'main', 'kotlin', 'com', 'sesurvey', 'se_survey', f);
const locHelper = kt('LocationHelper.kt');
const fcmSvc = kt('MyFirebaseMessagingService.kt');
const mainAct = kt('MainActivity.kt');
const notifHelper = kt('NotificationHelper.kt');
const incomingAct = kt('IncomingCallActivity.kt');
const incomingLayout = read('..', 'mobile', 'android', 'app', 'src', 'main', 'res', 'layout', 'activity_incoming_call.xml');
const fcmDart = read('..', 'mobile', 'lib', 'services', 'fcm_service.dart');
const authDart = read('..', 'mobile', 'lib', 'providers', 'auth_provider.dart');
const recallBtn = read('..', 'web', 'src', 'components', 'cases', 'RecallJobButton.tsx');
const ccDash = read('..', 'web', 'src', 'app', 'callcenter', 'page.tsx');
const ccList = read('..', 'web', 'src', 'app', 'callcenter', 'cases', 'page.tsx');
const ccAssign = read('..', 'web', 'src', 'app', 'callcenter', 'cases', '[id]', 'assign', 'page.tsx');
const dispatchSvc = read('src', 'services', 'dispatchLog.service.ts');
const migration065 = read('src', 'db', 'migrations', '065_case_dispatch_log.sql');
const manifest = read('..', 'mobile', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const notifDart = read('..', 'mobile', 'lib', 'services', 'notification_service.dart');
const homeDart = read('..', 'mobile', 'lib', 'screens', 'home_screen.dart');

console.log('\n── ที่เก็บข้อมูล ──');
/**
 * ⛔ TIMESTAMPTZ เท่านั้น — prod เป็น UTC เครื่องพัฒนาเป็นเวลาไทย
 *    node-postgres อ่าน TIMESTAMP (ไม่มีโซน) เป็นเวลาท้องถิ่นของ process → เพี้ยน 7 ชม.
 *    เคยโดนมาแล้วตอนทำ assigned_at (migration 044)
 */
check('push_sent_at / push_delivered_at เป็น TIMESTAMPTZ',
      /push_sent_at\s+TIMESTAMPTZ/.test(migration) && /push_delivered_at\s+TIMESTAMPTZ/.test(migration));

console.log('\n── ฝั่งเซิร์ฟเวอร์: บันทึกผลตอนจ่ายงาน ──');
check('จ่ายงานแล้วบันทึกสถานะ push ลงเคส',
      /UPDATE cases SET push_sent_at = \$1, push_delivered_at = NULL/.test(pushSvc));
// บล็อก push ย้ายออกจาก assign ไป surveyPush.service (22/09/69) — assign ต้องยังเรียกผ่านชุดเดียวกัน ไม่ใช่ก๊อปกลับมา
check('assign ส่งการ์ดผ่าน pushNewSurvey ชุดกลาง',
      /const push = await pushNewSurvey\(caseId, surveyorResult\.rows\[0\]/.test(caseSvc)
      && !caseSvc.includes('fcmService.sendUrgentSurvey('));
/**
 * ⛔ ต้องล้าง push_delivered_at ทุกครั้งที่จ่ายงาน — reassign หลังช่างคนก่อนปฏิเสธ
 *    ถ้าไม่ล้าง เวลาตอบรับของคนเก่าจะค้างมาหลอกว่างานรอบใหม่ถึงเครื่องคนใหม่แล้ว
 */
check('ล้าง push_delivered_at เสมอ (กัน reassign เห็นค่าค้างของคนก่อน)',
      pushSvc.includes('push_delivered_at = NULL'));
/** ส่งไม่ออก (no_token/failed/no_fcm) ต้องไม่ตั้ง push_sent_at ไม่งั้นดูเหมือนส่งแล้ว */
check('ตั้ง push_sent_at เฉพาะตอนส่งออกจริง',
      /push\.status === 'sent' \? new Date\(\) : null/.test(pushSvc));

console.log('\n── ฝั่งเซิร์ฟเวอร์: รับคำตอบรับจากเครื่อง ──');
check('มี ackPush ในเซอร์วิส', caseSvc.includes('async ackPush('));
/** ⛔ ช่างคนอื่นตอบรับแทนกันไม่ได้ — ไม่มี guard นี้ = ใครก็ปิดสัญญาณเตือนของงานคนอื่นได้ */
check('ตอบรับได้เฉพาะเจ้าของงาน (assigned_to)',
      /UPDATE cases SET push_delivered_at = NOW\(\)[\s\S]{0,120}assigned_to = \$2/.test(caseSvc));
/** FCM ส่งซ้ำเองได้ + native retry 3 ครั้ง → ยิงซ้ำต้องไม่ทับเวลาที่บันทึกครั้งแรก */
check('ยิงซ้ำไม่ทับเวลาเดิม (idempotent)',
      /push_delivered_at IS NULL/.test(caseSvc));
check('มี getPushStatus ให้หน้าจ่ายงานถาม', caseSvc.includes('async getPushStatus('));

console.log('\n── เส้นทาง API + สิทธิ์ ──');
check('POST /:id/push-ack เป็นของ surveyor',
      /push-ack.*requireRole\('surveyor'\)/.test(caseRoutes));
/** ⛔ สถานะแจ้งเตือนคือข้อมูลภายใน ห้ามเปิดให้ surveyor ดูของคนอื่น */
check('GET /:id/push-status จำกัด callcenter/admin',
      /push-status.*requireRole\('callcenter', 'admin'\)/.test(caseRoutes));
check('GET /notification-readiness จำกัด callcenter/admin',
      /notification-readiness.*requireRole\('callcenter', 'admin'\)/.test(userRoutes));

console.log('\n── ฝั่งเครื่อง (Kotlin) ──');
check('มีตัวยิงคำตอบรับกลับ', locHelper.includes('fun postPushAck('));
check('ยิงไปที่ /push-ack', locHelper.includes('/push-ack'));
check('ยิงตอนได้รับงานใหม่', fcmSvc.includes('LocationHelper.postPushAck('));
/**
 * ⛔ ต้องมี wakelock คร่อม: onMessageReceived คืนแล้ว process โดน freeze ใน Doze
 *    ก่อน POST เสร็จ = ออฟฟิศเห็น "ยังไม่ถึง" ทั้งที่ถึงแล้ว (false alarm ที่ทำให้คนเลิกเชื่อ)
 */
check('ถือ wakelock คร่อมการยิง', fcmSvc.includes('se_survey:push_ack'));
/** caseId ที่ generate จากนาฬิกา (push ไม่มี case_id) ไม่มีอยู่บนเซิร์ฟเวอร์ — ยิงไปก็ 404 เปล่า ๆ */
check('ยิงเฉพาะเคสจริง ไม่ยิงด้วย id ที่ generate เอง',
      /caseIdStr\.toIntOrNull\(\) != null\) LocationHelper\.postPushAck/.test(fcmSvc));

console.log('\n── หน้าจ่ายงาน: รอคำตอบรับ ──');
check('poll ถามสถานะจริง', assignUi.includes('/push-status'));
check('รอตอบรับก่อนเด้งออกจากหน้า', /await waitForAck\(/.test(assignUi));
check('มีสถานะครบ 3 แบบ (รอ/ถึงแล้ว/ไม่ตอบ)',
      /'waiting' \| 'ok' \| 'timeout'/.test(assignUi));
/**
 * ⛔ poll ล้ม (เน็ตออฟฟิศสะดุด) ห้ามสรุปว่า "ไม่ถึง" — เตือนผิดบ่อย ๆ คนจะเลิกเชื่อคำเตือน
 *    แล้วคำเตือนก็หมดค่า ตอนที่มันถูกจริงก็ไม่มีใครสนใจ
 */
check('poll ล้มแล้วข้ามรอบ ไม่ตีเป็น "ไม่ถึง"',
      /catch \{ \/\* อ่านสถานะไม่ได้รอบนี้/.test(assignUi));
check('ไม่ตอบรับ → บอกให้โทรตาม', assignUi.includes('โทรแจ้งช่างด้วย'));
/** ออกจากหน้าไปแล้วต้องหยุด poll ไม่งั้น setState หลัง unmount + เด้งหน้าทับสิ่งที่ผู้ใช้ทำอยู่ */
check('ออกจากหน้าแล้วหยุด poll', /return \(\) => \{ ackAbort\.current = true; \};/.test(assignUi));
/**
 * ⛔ ต้องรีเซ็ตธงเป็น false ตอน mount ด้วย — StrictMode (dev) รัน effect สองรอบ
 *    mount → unmount → mount ทำให้ cleanup ตั้งธงค้างตั้งแต่ยังไม่ได้ใช้ แล้ว poll
 *    return ทิ้งทุกครั้ง = แบนเนอร์ค้าง "กำลังรอ" ตลอดกาล ไม่ขึ้นทั้งเขียวและเหลือง
 *    (เจอจากการเทสจริง 31/08/69 — ไม่มี error ที่ไหนเลย)
 */
check('รีเซ็ตธงตอน mount (กัน StrictMode/รีมาวต์ทำ poll ตายค้าง)',
      /ackAbort\.current = false;/.test(assignUi));

console.log('\n── ตัวประหยัดแบต (สาเหตุอันดับ 1 ที่ push ไม่เข้า) ──');
check('ประกาศ permission ขอยกเว้น',
      manifest.includes('android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'));
check('native เช็ค + ขอยกเว้นได้',
      mainAct.includes('"isIgnoringBatteryOptimizations"') && mainAct.includes('"requestIgnoreBatteryOptimizations"'));
check('Dart เรียกผ่าน channel ได้',
      notifDart.includes('isBatteryOptimizationIgnored') && notifDart.includes('requestIgnoreBatteryOptimization'));
check('หน้าหลักเตือนช่างเมื่อยังไม่ยกเว้น', homeDart.includes('_BatteryWarningBanner'));
/** อ่านค่าไม่ได้ = อย่าเดาว่าแย่ ไม่งั้นแบนเนอร์ขึ้นค้างบนเครื่องที่ปกติดี แล้วคนจะเมิน */
check('อ่านสถานะไม่ได้ → ถือว่าปกติ (ไม่เตือนมั่ว)',
      /catch \(e\) \{[\s\S]{0,120}return true;/.test(notifDart));
/** กลับจากหน้าตั้งค่าระบบต้องเช็คใหม่ ไม่งั้นแบนเนอร์ค้างทั้งที่ผู้ใช้กดยกเว้นให้แล้ว */
check('กลับเข้าแอปแล้วเช็คใหม่',
      /AppLifecycleState\.resumed\) _check\(\)/.test(homeDart));

console.log('\n── รายชื่อคนที่ยังรับแจ้งเตือนไม่ได้ ──');
check('มี notificationReadiness ในเซอร์วิส', userSvc.includes('async notificationReadiness('));
check('นับเฉพาะผู้สำรวจที่ยังใช้งานอยู่',
      /role = 'surveyor' AND u\.is_active = true/.test(userSvc));
/**
 * ⛔ อย่าใช้ surveyor_locations.recorded_at เป็น "เห็นล่าสุด": เป็น TIMESTAMP ไม่มีโซน
 *    (เพี้ยน 7 ชม.) และถูกบันทึกเฉพาะตอนแอดมินกดขอพิกัด ไม่ใช่สัญญาณว่าเครื่องตื่น
 */
check('ใช้ push_delivered_at เป็นสัญญาณ "ถึงเครื่องล่าสุด"',
      /max\(push_delivered_at\) AS last_push_ok/.test(userSvc));
// เช็คที่ตัวคิวรี ไม่ใช่ทั้งไฟล์ — ในคอมเมนต์เตือนมีชื่อตารางนี้อยู่โดยตั้งใจ
check('ไม่ดึงเวลาจาก surveyor_locations', !/FROM surveyor_locations/.test(userSvc));
check('หน้าเว็บบอกว่าคนที่ไม่พร้อมคือ "จ่ายงานไปก็ไม่ขึ้นบนเครื่อง"',
      readyUi.includes('จ่ายงานไปก็ไม่มีอะไรขึ้นบนเครื่องเลย'));

/**
 * ── ถอนงาน (22/09/69) ──
 * ⛔ ปัญหาที่แก้: การ์ด "รับงาน" เป็นจอฝั่งเครื่องล้วน ๆ ลบ/ย้าย/ถอนเคสบนเว็บไม่มีอะไรวิ่งไปปิด
 *    → การ์ดค้างจนช่างกดรับแล้ววิ่งไปหน้างานซ้ำกับคนใหม่ (เจอจากเทส 22/09/69 หลังลบเคสทดสอบ)
 * สายนี้ก็พาดข้ามหลายชั้นเหมือนสายตอบรับ: backend ยิง → native ปิดจอ/แถบ/เสียง → Flutter รีเฟรชรายการ
 */
console.log('\n── ถอนงาน: push วิ่งสวนทางกับงานใหม่ ──');
check('มี push ชนิด cancel_survey พร้อมเลขเคสและเหตุผล',
      fcmApi.includes("type: 'cancel_survey'") && /async sendSurveyWithdrawn\(/.test(fcmApi)
      && fcmApi.includes('case_id: String(caseId)') && fcmApi.includes('reason,'));
check('ยิงถอนงานเมื่อแอดมินย้าย/ถอนใบที่ยังค้าง "มอบหมาย" (เฉพาะสถานะ assigned)',
      /before\.status === 'assigned'/.test(adminSvc) && /pushSurveyWithdrawn\(id, prevSurveyor/.test(adminSvc));
check('เปลี่ยนสถานะเดินหน้าโดยช่างคนเดิมไม่ถอน (ตรวจเฉพาะ pending/declined)',
      /\['pending', 'declined'\]\.includes\(String\(after\.status\)\)/.test(adminSvc));
check('ย้ายงานแล้วช่างคนใหม่ได้การ์ดงานด้วย',
      /push = await pushNewSurveyById\(id, nextSurveyor\)/.test(adminSvc));
check('ลบเคสลงถังขยะที่ยังค้าง "มอบหมาย" ก็ถอน',
      /RETURNING id, status, assigned_to`,\s*\[id, deletedBy/.test(adminSvc)
      && /pushSurveyWithdrawn\(id, Number\(r\.rows\[0\]\.assigned_to\), 'deleted'\)/.test(adminSvc));
check('กู้เคสจากถังขยะที่ยังค้าง "มอบหมาย" ส่งการ์ดกลับไปใหม่',
      /pushNewSurveyById\(id, Number\(r\.rows\[0\]\.assigned_to\)\)/.test(adminSvc));
check('ถอนงานไม่บล็อกการกระทำหลัก (จับ error คืนสถานะ ไม่ throw)',
      /catch \(err\) \{\s*console\.error\(`\[FCM\] cancel_survey failed/.test(pushSvc) && pushSvc.includes("return 'failed';"));

console.log('\n── ถอนงาน: เครื่องช่างปิดการ์ด/แถบ/เสียง ──');
check('native รับชนิด cancel_survey', fcmSvc.includes('"cancel_survey" -> handleCancelSurvey(data)'));
check('ไม่มี case_id = เมิน ไม่เดาไปปิดใบอื่น',
      /val caseId = data\["case_id"\]\?\.toIntOrNull\(\)\s*if \(caseId == null\)/.test(fcmSvc));
check('ปิดแถบเฉพาะเคสนั้น และหยุดเสียงเฉพาะเมื่อไม่มีใบอื่นรออยู่',
      notifHelper.includes('fun withdrawIncoming(') && notifHelper.includes('nm.cancel(caseId)')
      && notifHelper.includes('if (!othersWaiting) stopAlarm()'));
check('การ์ดเต็มจอปิดเฉพาะเมื่อเป็นเคสเดียวกันและยังไม่ได้กดอะไร',
      /if \(a\.isFinishing \|\| a\.caseId != caseId \|\| a\.actionTaken\) return false/.test(incomingAct));
check('ขึ้นจอสรุป "งานถูกถอนแล้ว" ก่อนปิด ไม่หายเงียบ',
      incomingLayout.includes('android:id="@+id/withdrawn_screen"') && incomingLayout.includes('งานถูกถอนแล้ว')
      && incomingAct.includes('R.id.withdrawn_screen') && /ticker\.postDelayed\(r, WITHDRAWN_MS\)/.test(incomingAct));
check('ถอนแล้วไม่โพสต์แถบสำรองคืน (actionTaken = true ก่อน finish)',
      /private fun showWithdrawn\([^)]*\) \{\s*actionTaken = true/.test(incomingAct));
check('ใบใหม่เข้ามาระหว่างจอสรุปถอน → ยกเลิกการปิดแล้วเริ่มใบใหม่',
      /pendingFinish\?\.let \{\s*ticker\.removeCallbacks\(it\)/.test(incomingAct));
check('ทิ้งแจ้งเตือนเงียบบอกเหตุผล (ไม่มีเสียง/ไม่สั่น) แตะแล้วเปิดแอป',
      notifHelper.includes('WITHDRAWN_CHANNEL_ID') && notifHelper.includes('.setSilent(true)')
      && notifHelper.includes('enableVibration(false)'));
check('ข้อความเหตุผลครบ 3 แบบ + ค่ากลาง',
      ['"reassigned" ->', '"unassigned" ->', '"deleted" ->', 'else -> "งานถูกถอนแล้ว"'].every((k) => notifHelper.includes(k)));
check('จอสรุปถอนงานเว้นแถบนำทาง (ไม่งั้นบรรทัดเหตุผลมุดใต้แถบ — เจอตอนเทส 22/09/69)',
      /withdrawn\.setPadding\(dp\(24\), bars\.top, dp\(24\), dp\(28\) \+ bars\.bottom\)/.test(incomingAct));
check('ใบเดิมกลับมา (กู้/ย้ายกลับ) ลบแจ้งเตือน "งานถูกถอน" ที่ค้างของใบนั้น',
      /\.cancel\(WITHDRAWN_ID_BASE \+ caseId\)/.test(notifHelper.split('fun showIncomingNotification')[1] || ''));
check('คอลเซ็นเตอร์มีเส้นทาง "ดึงงานกลับ" (POST /:id/recall)',
      /router\.post\('\/:id\/recall', auth, requireRole\('callcenter', 'admin'\), caseController\.recall\)/.test(caseRoutes));
check('ดึงกลับได้เฉพาะสถานะ assigned และ guard เจ้าของใน UPDATE',
      /async recall\(caseId: number, byUserId: number\)/.test(caseSvc)
      && /WHERE id = \$1 AND status = 'assigned' AND assigned_to = \$2 RETURNING \*/.test(caseSvc));
check('ดึงกลับแล้วถอนการ์ดบนเครื่องช่างคนเดิม + คืนผลให้หน้าเว็บ',
      /pushSurveyWithdrawn\(caseId, Number\(assigned_to\), 'unassigned'\)/.test(caseSvc)
      && /return \{ \.\.\.upd\.rows\[0\], recalled_from: assigned_to, withdrawn \}/.test(caseSvc));
check('ปุ่ม "ดึงงานกลับ" บนหน้าคอลเซ็นเตอร์ทั้ง 2 หน้า ยืนยันก่อนเสมอ และบอกผลการถอนการ์ด',
      recallBtn.includes('window.confirm(') && recallBtn.includes('/recall`') && recallBtn.includes('โทรแจ้งช่างด้วย')
      && ccDash.includes('<RecallJobButton') && ccList.includes('<RecallJobButton'));
/**
 * ── ประวัติการจ่ายงาน (22/09/69) ──
 * ⛔ cases เก็บได้แค่การปฏิเสธครั้งล่าสุด ส่วน "ดึงงานกลับ" ไม่มีที่เก็บเลย → ตาราง case_dispatch_log 1 แถว/เหตุการณ์
 */
console.log('\n── ประวัติการจ่ายงาน: ใครมอบหมาย/ดึงกลับ/ปฏิเสธ เมื่อไร ──');
check('migration 065 สร้างตารางผูกกับ cases_all (VIEW ผูก FK ไม่ได้) ลบถาวรแล้วหายตาม',
      migration065.includes('CREATE TABLE IF NOT EXISTS case_dispatch_log')
      && migration065.includes('REFERENCES cases_all(id) ON DELETE CASCADE')
      && /CHECK \(action IN \('assigned', 'recalled', 'declined'\)\)/.test(migration065));
check('บันทึกประวัติไม่ทำให้งานหลักล้ม (จับ error ใน logDispatch)',
      /export async function logDispatch\(/.test(dispatchSvc) && /catch \(err\) \{\s*console\.error\(`\[dispatch-log\]/.test(dispatchSvc));
check('ลงประวัติครบ 3 ทางของคอลเซ็นเตอร์/ช่าง: มอบหมาย · ดึงกลับ · ปฏิเสธ',
      /logDispatch\(caseId, 'assigned', \{ surveyorId, byUserId/.test(caseSvc)
      && /logDispatch\(caseId, 'recalled', \{ surveyorId: Number\(assigned_to\), byUserId \}\)/.test(caseSvc)
      && /logDispatch\(caseId, 'declined', \{ surveyorId, byUserId: surveyorId, reason: cleanReason \}\)/.test(caseSvc));
check('แอดมินย้าย/ถอนผู้สำรวจก็ลงประวัติ (ดึงกลับจากคนเดิม + มอบหมายคนใหม่)',
      /logDispatch\(id, 'recalled', \{ surveyorId: prevSurveyor, byUserId: by \?\? null \}\)/.test(adminSvc)
      && /logDispatch\(id, 'assigned', \{ surveyorId: nextSurveyor, byUserId: by \?\? null \}\)/.test(adminSvc));
check('คนกดมอบหมาย/แก้เคส ถูกส่งจาก controller ลงประวัติ',
      read('src', 'controllers', 'case.controller.ts').includes('caseService.assign(caseId, surveyor_id, claim_type, req.user!.id)')
      && read('src', 'controllers', 'admin.controller.ts').includes('adminService.updateCase(Number(req.params.id), req.body, req.user?.id ?? null)'));
check('มีเส้นทางอ่านประวัติ (GET /:id/dispatch-log)',
      /router\.get\('\/:id\/dispatch-log', auth, requireRole\('callcenter', 'admin', 'checker'\), caseController\.dispatchLog\)/.test(caseRoutes));
check('หน้ารายการคอลเซ็นเตอร์ทั้ง 2 หน้าเห็น "ดึงกลับจากใคร โดยใคร" (คิวรี recent + list ใช้ชิ้น SQL เดียวกัน)',
      (caseSvc.match(/\$\{LAST_RECALL_SELECT\}/g) || []).length === 2 && (caseSvc.match(/\$\{LAST_RECALL_JOIN\}/g) || []).length === 2
      && ccDash.includes('c.recalled_first_name ?') && ccList.includes('c.recalled_first_name ?'));
check('หน้าจ่ายงานโชว์ประวัติทั้งสาย และบอกว่าเคสก่อน 22/09/69 ไม่มีย้อนหลัง',
      ccAssign.includes('<DispatchHistory caseId={caseId}')
      && read('..', 'web', 'src', 'components', 'cases', 'DispatchHistory.tsx').includes('เริ่มเก็บ 22/09/69'));

check('Flutter รีเฟรชรายการงานเมื่อถูกถอน',
      fcmDart.includes("data['type'] == 'cancel_survey'") && authDart.includes('_fcmService.onSurveyWithdrawn = '));

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด' : `\n❌ ไม่ผ่าน ${failed} ข้อ`);
process.exit(failed === 0 ? 0 : 1);
