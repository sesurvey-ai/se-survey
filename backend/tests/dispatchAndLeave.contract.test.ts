/**
 * การ์ดของ 2 เรื่องที่ทำพร้อมกัน 28/08/69
 *
 *   1. หน้าจ่ายงาน "แสดงเฉพาะช่างที่ว่าง"
 *   2. แจ้งเตือนเรื่องลา (ผลอนุมัติ → เครื่องพนักงาน · ใบลาใหม่ → หน้าแอดมิน)
 *
 * ทั้งคู่เป็น **การต่อสายข้ามไฟล์** ที่พังแบบเงียบได้: ลืมต่อสายแล้วหน้าจอยังทำงานปกติ
 * แค่ไม่มีใครได้รับแจ้งเตือน / รายชื่อกรองผิดคน — ไม่มี error ให้เห็นเลย
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
const assign = read('..', 'web', 'src', 'components', 'cases', 'AssignSurveyor.tsx');
const board = read('..', 'web', 'src', 'app', 'callcenter', 'checkin-board', 'page.tsx');

console.log('\n── งานในมือ: 2 นิยาม 2 ที่ใช้ ──');
/**
 * ⛔ `active` (assigned+surveyed) เป็นของ **บอร์ดเข้างาน** ห้ามเปลี่ยนความหมาย
 *    ถ้าเผลอแก้ให้เหลือ assigned อย่างเดียว ป้าย "N งาน" บนบอร์ดจะลดลงเงียบ ๆ
 *    โดยไม่มีอะไรฟ้อง — คนดูบอร์ดจะเข้าใจว่าคนว่างกว่าความจริง
 */
// 07/09/69: เพิ่มสถานะ 'finished' (เสร็จงานหน้างาน) — active ของบอร์ดเข้างานยังนับรวม (งานยังไม่ปิด)
// แต่หน้าจ่ายงานถือว่า "ว่าง" (นับแยกใน finished ไม่ปนกับ assigned)
check('ยังคืน active = assigned + finished + surveyed ไว้ให้บอร์ดเข้างาน',
      /COUNT\(c\.id\)\)?::int\s+AS active/.test(caseSvc)
      && /c\.status IN \('assigned','finished','surveyed'\)/.test(caseSvc)
      && /FILTER \(WHERE c\.status = 'finished'\)::int\s+AS finished/.test(caseSvc));
check('บอร์ดเข้างานยังอ่าน active ตัวเดิม', board.includes('Number(w.active)'));
/** นิยาม "ว่าง" ที่ user เคาะ = ยังไม่ได้รับมอบหมาย → ต้องแยก assigned ออกมาต่างหาก */
check('แยก assigned (ยังไม่ส่งงาน) ออกมาให้หน้าจ่ายงาน',
      /FILTER \(WHERE c\.status = 'assigned'\)::int\s+AS assigned/.test(caseSvc));
check('แยก surveyed (ส่งแล้วรอตรวจ) ออกมาเป็นข้อมูล',
      /FILTER \(WHERE c\.status = 'surveyed'\)::int\s+AS surveyed/.test(caseSvc));

console.log('\n── หน้าจ่ายงาน: ว่าง / ถืองาน ──');
check('ดึงงานในมือมาใช้จริง', assign.includes("api.get('/api/cases/workload')"));
/** ⛔ "ว่าง" ต้องดูเฉพาะ assigned — ถ้าเผลอเอา active มาใช้ คนที่ส่งงานแล้วจะถูกซ่อนผิด */
check('ว่าง = assigned เป็น 0 (ไม่นับงานที่ส่งแล้ว)',
      /const isFree = .*assigned \?\? 0\) === 0/.test(assign));
check('งานที่ส่งแล้วโชว์เป็นข้อมูล ไม่ใช่เหตุผลที่ซ่อน', assign.includes('ส่งแล้วรอตรวจ'));
/**
 * ⛔ **ห้ามตัดคนที่ถืองานทิ้งจากรายการ** — บางวันช่างในพื้นที่ถืองานกันหมด
 *    ตัดออกจริง = รายชื่อว่างเปล่า จ่ายงานไม่ได้เลยทั้งที่ยังมีคน (เหตุผลเดียวกับที่
 *    ห้ามกรองด้วยพิกัด) · ต้องยุบเก็บให้กดดูได้เท่านั้น
 */
check('คนที่ถืองานยังกดดูและมอบหมายได้ ไม่ได้หายไป',
      // pool = sorted ที่ผ่านช่องค้นหา (15/09/69) — ยังเป็นทุกคน ไม่ได้ตัดคนถืองานทิ้ง
      /const busy = pool\.filter\(\(s\) => !isFree\(s\)\)/.test(assign)
      && /showBusy && busy\.map\(row\)/.test(assign));
check('ไม่มีใครว่างเลย → บอกทางออก ไม่ปล่อยหน้าว่าง', assign.includes('ตอนนี้ไม่มีช่างที่ว่างเลย'));
/** โหลด workload ไม่สำเร็จ = ไม่รู้ว่าใครถืองาน → ต้องโชว์ทุกคน ไม่ใช่ซ่อนทุกคน */
check('ยังไม่รู้งานในมือ = ถือว่าว่างไว้ก่อน',
      /workload\?\.\[String\(s\.user_id\)\] \?\? null/.test(assign)
      && /\.catch\(\(\) => setWorkload\(null\)\)/.test(assign));
check('มอบหมายเสร็จแล้วรายชื่อ "ว่าง" อัปเดตตาม', /loadWorkload\(\);\s+\/\//.test(assign));

console.log('\n── แจ้งเตือนใบลา ──');
const leaveSvc = read('src', 'services', 'leave.service.ts');
const leaveEvents = read('src', 'services', 'leaveEvents.ts');
const leavePage = read('..', 'web', 'src', 'app', 'admin', 'leave', 'page.tsx');

check('อนุมัติ/ไม่อนุมัติแล้วส่งแจ้งเตือนเข้าเครื่องพนักงาน',
      /await fcmService\.sendNotification\(/.test(leaveSvc));
/**
 * ⛔ ใช้ `notification` (ไม่ใช่ data-only) — แอนดรอยด์แสดงเองตอนแอปอยู่เบื้องหลัง
 *    จึงไม่ต้องแก้แอปมือถือ/แจก APK ใหม่ · ถ้าเปลี่ยนเป็น sendSilentPush เมื่อไหร่
 *    แจ้งเตือนจะเงียบสนิทบนทุกเครื่องที่ยังไม่ได้อัปแอป
 */
check('ใช้แบบที่มือถือเดิมแสดงได้เอง ไม่ต้องแจก APK ใหม่',
      !/sendSilentPush/.test(leaveSvc));
/** ⛔ ส่งแจ้งเตือนล้ม ≠ อนุมัติล้ม — ใบลาบันทึกไปแล้ว ห้ามโยน error ทับ */
check('ส่งแจ้งเตือนล้มแล้วยังอนุมัติสำเร็จ',
      /return \{ status: 'failed'/.test(leaveSvc) && /return \{ \.\.\.row, push: await pushLeaveResult\(row\) \}/.test(leaveSvc));
/** เงียบแบบจ่ายงานเคยเป็น = หัวหน้าคิดว่าพนักงานรู้แล้ว ทั้งที่ไม่มีอะไรไปถึงเลย */
check('ผลการส่งไหลกลับไปถึงคนกดอนุมัติ',
      /push\.status !== 'sent'/.test(leavePage) && leavePage.includes('โทรแจ้งพนักงานด้วย'));
check('token ตายแล้วล้างทิ้ง ไม่ค้างหลอกว่ามี',
      /registration-token-not-registered/.test(leaveSvc));
check('ไม่ได้ตั้งค่า Firebase = บอกเหตุผล ไม่ใช่ล้มเงียบ',
      /isFirebaseReady\(\)/.test(leaveSvc));

check('ยื่นใบลาใหม่แล้วหน้าแอดมินรู้เอง', /notifyLeaveChanged\('created'/.test(leaveSvc));
check('อนุมัติแล้วแท็บแอดมินอื่นรู้ด้วย', /notifyLeaveChanged\('reviewed'/.test(leaveSvc));
/** ⛔ สัญญาณ commit แล้วค่อยส่ง — ไม่งั้นเตือนเรื่องที่ rollback ทิ้งไปแล้ว */
check('ส่งสัญญาณหลัง COMMIT เท่านั้น',
      /await client\.query\('COMMIT'\);[\s\S]{0,200}notifyLeaveChanged\('created'/.test(leaveSvc));
/** เหตุผลการลาเป็นเรื่องส่วนตัว — สัญญาณห้ามพ่วงข้อมูลใบลาไปด้วย */
check('สัญญาณไม่พ่วงข้อมูลใบลา (เหตุผลการลาเป็นเรื่องส่วนตัว)',
      !/reason: row/.test(leaveEvents) && /emit\('leave_changed', \{ reason, by/.test(leaveEvents));
check('ส่งเฉพาะห้องแอดมิน (คนอื่นไม่มีสิทธิ์ดูใบลา)',
      /io\.to\('role:admin'\)\.emit/.test(leaveEvents));
check('หน้าแอดมินฟังสัญญาณแล้วโหลดใหม่',
      /socket\.on\('leave_changed'/.test(leavePage) && /socket\.off\('leave_changed'/.test(leavePage));

// ── ประเภทเคลมจากหน้าจ่ายงาน (30/08/69) ───────────────────────────────────────
// คนรับแจ้งรู้ประเภทเคลมตั้งแต่ต้นสาย แต่เดิมมีที่ให้กรอกแค่บนแอปกับหน้าตรวจ
{
  const routes = read('src', 'routes', 'case.routes.ts');
  const svc = read('src', 'services', 'case.service.ts');
  const ctl = read('src', 'controllers', 'case.controller.ts');
  const opts = read('..', 'web', 'src', 'components', 'cases', 'caseOptions.ts');

  // ⛔ ชุดต้องตรงกับ radio 4 ตัวบน EMCS เป๊ะ — โดยเฉพาะห้ามมี 'เจรจาสินไหม'
  //    (EMCS ไม่มีตัวเลือกนั้น บอทติ๊กให้ไม่ได้ → CLAIM_TYPE_TO_EMCS['4'] = None)
  check('assign รับ claim_type เฉพาะ 4 รหัสของ EMCS (บังคับส่งตั้งแต่ 15/09/69)',
        routes.includes("claim_type: z.enum(['F', 'D', 'A', 'C'], { errorMap:") && !routes.includes("claim_type: z.enum(['F', 'D', 'A', 'C']).optional()"));
  const ctBlock = (opts.match(/export const CLAIM_TYPE_OPTIONS[\s\S]*?\];/) || [''])[0];
  const ctCodes = [...ctBlock.matchAll(/\{ code: '([A-Z])'/g)].map((m) => m[1]);
  check('ลิสต์ประเภทเคลมบนเว็บ = 4 รหัสของ EMCS ไม่มีเจรจาสินไหม',
        JSON.stringify(ctCodes) === JSON.stringify(['F', 'D', 'A', 'C'])
        && !ctBlock.includes('เจรจาสินไหม'), ctCodes.join(','));
  check('หน้าจ่ายงานกับหน้าตรวจใช้ลิสต์เดียวกัน (กันสองหน้าเพี้ยนจากกัน)',
        read('..', 'web', 'src', 'components', 'cases', 'AssignSurveyor.tsx').includes('CLAIM_TYPE_OPTIONS')
        && read('..', 'web', 'src', 'components', 'cases', 'CaseDetail.tsx').includes('CLAIM_TYPE_OPTIONS'));
  check('controller ส่ง claim_type ต่อเข้า service', ctl.includes('caseService.assign(caseId, surveyor_id, claim_type)'));
  // ⛔ ไม่เลือก = ต้องไม่ล้างค่าเดิม (reassign หลังช่างปฏิเสธ จะได้ไม่ลบของที่กรอกไว้)
  check('ไม่เลือกประเภทเคลม = ไม่ทับของเดิม (COALESCE)',
        svc.includes('claim_type = COALESCE($2, claim_type)'));
  check('ค่าที่ไม่อยู่ใน 4 รหัส ถูกปัดเป็น null ก่อนเขียน',
        svc.includes("['F', 'D', 'A', 'C'].includes(String(claimType ?? '')) ? claimType : null"));
  // หน้าจ่ายงานต้องเห็นค่าเดิม ไม่งั้นกดจ่ายซ้ำแล้วเผลอทับ
  check('getById คืน claim_type ให้หน้าจ่ายงานโชว์ค่าเดิม',
        svc.includes('sr.acc_province, sr.acc_district, sr.claim_type'));
}

// ── งานครั้งถัดไปของเคลมเดิม (1.9 · 30/08/69) ────────────────────────────────
// เดิมต้องสร้างเคสใหม่แล้วพิมพ์เลขเคลมเดิมเอง — พิมพ์ผิดตัวเดียวสายงานขาดเงียบ ๆ
// ("ครั้งที่" นับจาก claim_no ที่ซ้ำกัน ไม่มีคอลัมน์เก็บรอบ)
{
  const svc = read('src', 'services', 'case.service.ts');
  const routes = read('src', 'routes', 'case.routes.ts');
  const fn = (svc.match(/async createFollowup[\s\S]*?\n  \},/) || [''])[0];
  const carry = (fn.match(/const CARRY = \[[\s\S]*?\];/) || [''])[0];

  check('มี endpoint เปิดงานครั้งถัดไป (callcenter/admin)',
        routes.includes("router.post('/:id/followup', auth, requireRole('callcenter', 'admin')"));
  // ⛔ เลขเซอร์เวย์ = เลขใบวางบิล ห้ามซ้ำ — ครั้งใหม่ต้องได้เลขใหม่
  check('⛔ ไม่ก๊อปเลขเซอร์เวย์ไปงานครั้งถัดไป',
        !carry.includes('survey_job_no'));
  // ⛔ ครั้งถัดไปมักเป็นติดตาม/นัดหมาย — ปล่อยว่างให้คนจ่ายงานเลือกที่หน้าจ่ายงาน
  check('⛔ ไม่ก๊อปประเภทเคลม (ให้เลือกใหม่ตอนจ่ายงาน)',
        !carry.includes('claim_type'));
  // ⛔ ครั้งใหม่ต้องสำรวจใหม่ ไม่ใช่ลอกผลเก่ามาส่งซ้ำ
  check('⛔ ไม่ก๊อปผลสำรวจ (ความเสียหาย/คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน/เงิน/ความเห็น)',
        !/damage|opposing|injured|damaged_property|_fee|comment|survey_result/.test(carry));
  check('ก๊อปตัวตนของเคลมมาให้ (เลขเคลม/กรมธรรม์/รถ)',
        ["'claim_no'", "'policy_no'", "'license_plate'", "'car_brand'"].every(k => carry.includes(k)));
  check('เปิดได้เฉพาะงานที่ส่งแล้ว (surveyed/reviewed)',
        fn.includes("['surveyed', 'reviewed'].includes(String(row.status))"));
  check('ไม่มีเลขเคลม = เปิดไม่ได้ (ผูกงานเข้ากับเคลมเดิมไม่ได้)',
        fn.includes('เคสนี้ไม่มีเลขเคลม'));
  // 07/09/69: งานที่กด "เสร็จงาน" แล้วแต่ยังไม่ส่ง (finished) ก็ยังค้างอยู่ — ห้ามเปิดครั้งถัดไปซ้อน
  check('กันกดซ้ำ: มีงานของเคลมนี้ค้างอยู่ = ไม่สร้างใบใหม่',
        fn.includes("c.status IN ('pending','assigned','finished')"));
  check('หน้ารายการเคสมีปุ่มเปิดงานครั้งถัดไป',
        read('..', 'web', 'src', 'app', 'callcenter', 'cases', 'page.tsx').includes('handleFollowup'));
}

// ── KPI 24 ชม. นับจากเวลาจ่ายงาน (1.7 · 31/08/69) ────────────────────────────
// user เคาะ: นับจาก "เวลาจ่ายงาน" · เป็น KPI ภายใน **ไม่มีค่าปรับ** → เตือนให้เห็น ไม่ขวางงาน
{
  const svc = read('src', 'services', 'case.service.ts');
  const list = read('..', 'web', 'src', 'app', 'callcenter', 'cases', 'page.tsx');
  const mig = read('src', 'db', 'migrations', '044_assigned_at.sql');

  // ⛔ TIMESTAMPTZ เท่านั้น — TIMESTAMP ธรรมดา node-postgres อ่านเป็น "เวลาเครื่องที่รัน"
  //    รันบนเครื่องไทยจะเพี้ยน 7 ชม. เงียบ ๆ (เจอจริงตอนเทส: ตั้ง 26 ชม. โชว์ 33)
  check('เวลาจ่ายงานเป็น TIMESTAMPTZ (ผูกโซนเวลา ไม่ขึ้นกับเครื่องที่รัน)',
        /assigned_at TIMESTAMPTZ/.test(mig) && !/assigned_at TIMESTAMP;/.test(mig));
  check('จ่ายงานแล้วบันทึกเวลาลง assigned_at',
        svc.includes("status = 'assigned', assigned_at = NOW()"));
  // ⛔ ห้ามคำนวณ KPI จาก acc_insurance_notify_date — เป็นข้อความ D/M/พ.ศ. เวลาไทย
  //    ระดับนาที ไม่มีโซนเวลา (ทำไว้ให้มือถือแสดง) เอามาลบเวลา = พังเงียบวันรูปแบบเปลี่ยน
  check('หน้าเว็บไม่คำนวณอายุงานจากข้อความไทม์ไลน์',
        !list.includes('acc_insurance_notify_date'));
  // นาฬิกาเดินเฉพาะช่วงที่ยังทำอะไรได้ — ส่งงานแล้วไม่ต้องเตือนอีก
  check('นับเฉพาะงานที่จ่ายแล้วช่างยังไม่ส่ง (assigned)',
        /if \(c\.status !== 'assigned'\) return null;/.test(list));
  check('เกิน 24 ชม. = แดง · ใกล้ครบ 18 ชม. = เหลือง',
        /hrs >= 24/.test(list) && /hrs >= 18/.test(list));
  // ⛔ แถบที่ขึ้นทุกวันจนคนชิน = เตือนไม่ได้อีก
  check('ไม่มีงานเกิน = ไม่ขึ้นแถบเตือน', /\{overdue > 0 && \(/.test(list));
  check('ป้ายเวลาเดินต่อเองแม้เปิดหน้าค้างไว้ (ticker)', /setInterval\(\(\) => setTick/.test(list));
  // งานเก่าไม่มี assigned_at → ถอยไป created_at แต่ต้องบอกว่าเป็นค่าประมาณ
  check('งานเก่าที่ยังไม่มีเวลาจ่ายงาน = บอกว่าเป็นค่าประมาณ',
        list.includes('c.assigned_at || c.created_at') && list.includes('ค่าประมาณ'));
}

// ── พิกัด + ยืนยันพื้นที่ตอนถึงที่เกิดเหตุ (2.2 · 31/08/69) ───────────────────
// เดิมส่งมาแค่ path รูป — ถ่ายจากที่ไหนก็ได้ ไม่มีอะไรผูกกับสถานที่จริง
// จังหวัดที่ยืนยันตรงนี้จะถูกใช้ต่อในเรื่องออกเลขเซอร์เวย์ (หลักแรกของ SEABI = พื้นที่)
{
  const svc = read('src', 'services', 'case.service.ts');
  const ctl = read('src', 'controllers', 'case.controller.ts');
  const routes = read('src', 'routes', 'case.routes.ts');
  const mig = read('src', 'db', 'migrations', '045_arrival_location.sql');
  const app = read('..', 'mobile', 'lib', 'screens', 'case_detail_screen.dart');
  const api = read('..', 'mobile', 'lib', 'services', 'api_service.dart');
  const geo = read('src', 'services', 'geoDistrict.ts');

  check('เก็บพิกัดดิบ + พื้นที่ที่คนยืนยัน แยกคอลัมน์กัน',
        /arrival_lat/.test(mig) && /arrival_province/.test(mig) && /arrival_district/.test(mig));
  check('เวลาถึงที่เกิดเหตุเป็น TIMESTAMPTZ', /arrival_at\s+TIMESTAMPTZ/.test(mig));
  check('backend รับพิกัด+พื้นที่จากแอป',
        ctl.includes('const { photo_path, lat, lng, province, district } = req.body;'));
  // ⛔ ยืนยันซ้ำโดยไม่มีพิกัด (ถ่ายใหม่ในอาคาร) ต้องไม่ล้างพิกัดที่เคยจับได้
  check('ยืนยันซ้ำแบบไม่มีพิกัด = ไม่ล้างของเดิม (COALESCE)',
        svc.includes('arrival_lat = COALESCE($1, arrival_lat)'));
  check('มี endpoint เสนอจังหวัด/อำเภอจากพิกัด',
        routes.includes("router.get('/resolve-area'") && ctl.includes('district_guess'));
  // ⛔ อำเภอมาจากจุดกลาง = การเดา ชื่อฟิลด์ต้องบอกให้รู้ ห้ามเรียกเฉย ๆ ว่า district
  check('ชื่อฟิลด์บอกว่าอำเภอเป็นการเดา (district_guess)',
        !/district:\s*nearestDistrict/.test(ctl));
  check('หาอำเภอเฉพาะในจังหวัดที่ขอบเขตจริงบอก (ไม่ข้ามจังหวัด)',
        /code\.startsWith\(pcode\)/.test(geo));
  // ⛔ GPS เสนอ คนยืนยัน — ห้ามส่งค่าที่ GPS เดาเข้าไปตรง ๆ
  check('แอปมีหน้าจอให้คนยืนยันพื้นที่ก่อนบันทึก',
        app.includes('_confirmArrivalArea') && app.includes('ยืนยันพื้นที่ที่ออกสำรวจ'));
  check('เลือกไม่ครบ = กดยืนยันไม่ได้',
        /prov\.isEmpty \|\| dist\.isEmpty\) \? null/.test(app));
  // ⛔ GPS จับไม่ได้ (ในอาคาร) ต้องเลือกเองแล้วไปต่อได้ ห้ามค้าง
  check('GPS จับไม่ได้ = ยังยืนยันได้ ไม่ค้าง',
        /timeout\(const Duration\(seconds: 10\)\)/.test(app) && app.includes('จับพิกัดไม่ได้'));
  // ⛔ เจอจริงบนเครื่อง: ปุ่มยืนยันไปอยู่ใต้แถบนำทาง Android กดไม่โดน
  check('หน้าจอยืนยันเผื่อแถบนำทาง Android (ไม่ใช่แค่คีย์บอร์ด)',
        /viewInsets\.bottom \+ MediaQuery\.of\(ctx\)\.padding\.bottom/.test(app));
  check('แอปส่งพิกัด+พื้นที่ไปกับการยืนยัน',
        /'lat': lat/.test(api) && /'province': province/.test(api));
}

// ── ทำงานตอนไม่มีเน็ต (2.9 · 31/08/69) ───────────────────────────────────────
// คิวส่งงานออฟไลน์มีอยู่แล้ว (survey_queue.dart) แต่ทำงาน **เงียบสนิท** ไม่มีอะไรบนหน้าจอ
// ช่างกดส่งแล้วเห็นว่าส่งแล้ว ทั้งที่งานยังค้างในเครื่อง — ติด 400/409 = ค้างถาวรแบบไม่มีใครรู้
{
  const list = read('..', 'mobile', 'lib', 'screens', 'case_list_screen.dart');
  const prov = read('..', 'mobile', 'lib', 'providers', 'case_provider.dart');

  check('หน้ารายการงานบอกว่ามีงานค้างคิว/ส่งไม่ผ่าน',
        list.includes('queuedSurveyCount()') && list.includes('blockedSurveys()')
        && list.includes('_queueBanner'));
  check('งานที่ส่งไม่ผ่านบอกเหตุผลจากเซิร์ฟเวอร์ ไม่ใช่แค่ว่าล้ม',
        /เคลม #\$\{e\.key\}: \$\{e\.value\}/.test(list));
  // ⛔ รายการงานว่าง ≠ ไม่มีงานค้าง — ต้องโชว์แถบในหน้าว่างด้วย ไม่งั้นไม่มีวันเห็น
  check('หน้าว่างก็ยังโชว์แถบงานค้าง', /return ListView\(children: \[\s*_offlineBanner/.test(list));
  check('ดึงรีเฟรช = ลองส่งคิวด้วย', /flushSurveyQueue\(\);/.test(list));

  check('โหลดสำเร็จแล้วเก็บรายการงานไว้ในเครื่อง', prov.includes("_kCacheKey"));
  check('โหลดไม่ผ่าน = ถอยไปใช้ของที่เก็บไว้ ไม่ปล่อยหน้าว่าง',
        /_loadCachedCases\(\)/.test(prov));
  // ⛔ ต้องบอกว่ากำลังดูของเก่า — ช่างที่ไม่รู้จะทำงานบนข้อมูลที่หัวหน้าแก้ไปแล้ว
  check('บอกผู้ใช้ว่ากำลังดูข้อมูลเก่า + เก่าแค่ไหน',
        prov.includes('bool get fromCache') && list.includes('กำลังดูข้อมูลที่เก็บไว้ในเครื่อง')
        && list.includes('อัปเดตล่าสุด'));
}

/**
 * -- ผังหน้ามอบหมาย (user ออกแบบ 15/09/69) --
 * ซ้าย = รายละเอียดงาน + ประเภทเคลม · ขวา = รายชื่อช่าง (portal จาก AssignSurveyor) · ไม่มีแผนที่ (ซ้ำกับเมนู "พนักงานทั้งหมด")
 * ปุ่ม "เรียกพิกัด" ยังต้องอยู่ เพราะรายชื่อเรียงตามพิกัดล่าสุด/จังหวัดที่เกิดเหตุ
 */
{
  console.log('\n-- ผังหน้ามอบหมาย: ซ้ายรายละเอียด ขวารายชื่อ ไม่มีแผนที่ --');
  const assignSrc = read('..', 'web', 'src', 'components', 'cases', 'AssignSurveyor.tsx');
  check('ไม่มีแผนที่ในส่วนมอบหมายแล้ว', !assignSrc.includes('SurveyorMap') && !assignSrc.includes('แผนที่ตำแหน่งช่างสำรวจ'));
  check('รายชื่อไป render ในคอลัมน์ขวาที่หน้าส่งมา (portal) · ไม่ส่ง = ต่อท้ายตามเดิม',
        assignSrc.includes('listContainer?: HTMLElement | null;') && assignSrc.includes('return listContainer ? createPortal(list, listContainer) : list;'));
  check('ปุ่มเรียกพิกัดยังอยู่ (หัวรายชื่อ) และเรียงตามระยะทางยังทำงาน',
        /onClick=\{handleRequestLocation\}/.test(assignSrc) && assignSrc.includes("'เรียกพิกัดใหม่' : 'เรียกพิกัด'") && assignSrc.includes('haversineDistance('));
  const newPage = read('..', 'web', 'src', 'app', 'callcenter', 'cases', 'new', 'page.tsx');
  check('หน้าสร้างเคส: ขั้นมอบหมายกางเต็มจอ 2 คอลัมน์ · ขั้นกรอกยังกลางจอ 4xl',
        newPage.includes("createdCaseId !== null ? 'max-w-screen-2xl mx-auto' : 'max-w-4xl mx-auto'")
        && /createdCaseId !== null \? 'grid grid-cols-1 xl:grid-cols-\[minmax\(0,52rem\)_minmax\(0,1fr\)\] gap-8 items-start' : ''/.test(newPage)
        && newPage.includes('listContainer={listEl}') && /<div ref=\{setListEl\} className="min-w-0 xl:sticky xl:top-4" \/>/.test(newPage));
  const assignPage = read('..', 'web', 'src', 'app', 'callcenter', 'cases', '[id]', 'assign', 'page.tsx');
  check('หน้ามอบหมายงานเคสเดิมใช้ผังเดียวกัน', assignPage.includes('listContainer={listEl}') && assignPage.includes('xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)]'));

  /** user สั่ง 15/09/69 (รอบ 2): บังคับประเภทเคลมทุกครั้ง (เว็บ + backend) · ค้นหารหัส/ชื่อพนักงานในรายชื่อ */
  check('ประเภทเคลมบังคับ: ปุ่มมอบหมายกดไม่ได้ + handleAssign กัน + backend ปฏิเสธ',
        assignSrc.includes('disabled={assigning === String(s.user_id) || !claimType}')
        && /if \(!claimType\) \{\s*setError\('ต้องเลือก "ประเภทเคลม" ก่อนมอบหมายงาน'\);/.test(assignSrc)
        && assignSrc.includes('claim_type: claimType,') && !assignSrc.includes('...(claimType ? { claim_type: claimType } : {})')
        && /claim_type: z\.enum\(\['F', 'D', 'A', 'C'\], \{ errorMap: \(\) => \(\{ message: 'ต้องเลือกประเภทเคลมก่อนมอบหมายงาน' \}\) \}\),/.test(
          read('src', 'routes', 'case.routes.ts')));
  check('ค้นหารหัส/ชื่อพนักงาน กรองก่อนแบ่งกลุ่ม (ว่าง/ถืองาน/ในจังหวัด)',
        assignSrc.includes('placeholder="ค้นหา รหัส หรือ ชื่อพนักงาน"') && /const pool = sorted\.filter\(matchQ\);\s*const free = pool\.filter\(isFree\);\s*const busy = pool\.filter/.test(assignSrc)
        && /\[s\.code, s\.first_name, s\.last_name, s\.username, `\$\{s\.first_name \?\? ''\} \$\{s\.last_name \?\? ''\}`\]/.test(assignSrc));
}

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด\n' : `\n❌ ไม่ผ่าน ${failed} ข้อ\n`);
process.exit(failed === 0 ? 0 : 1);
