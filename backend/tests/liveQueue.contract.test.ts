/**
 * การ์ดของ "คิวงานตรวจอัปเดตเองโดยไม่ต้องกด F5"
 *
 * ทำไมต้องมี: หน้าคิวเคยโหลดครั้งเดียวตอนเปิด พอมีหัวหน้าหลายคน (แผนคือ 8 คน)
 * ต่างคนต่างเห็นภาพคนละเวลา — เปิดเรื่องที่คนอื่นตรวจจบไปแล้ว หรือไม่เห็นงานใหม่
 * จนกว่าจะบังเอิญกดรีเฟรช
 *
 * สายนี้ขาดตรงไหนก็เงียบทั้งเส้น ไม่มี error ให้เห็นสักที่:
 *   เซิร์ฟเวอร์ไม่ส่งสัญญาณ · layout ไม่มี SocketProvider (useSocket คืน null) ·
 *   หน้าไม่ได้ฟัง · ไม่มีตาข่ายรองตอน socket หลุด
 */
import * as fs from 'fs';
import * as path from 'path';

let failed = 0;
const check = (label: string, ok: boolean, note = '') => {
  if (!ok) failed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${note ? `  (${note})` : ''}`);
};
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

console.log('\n── คิวงานตรวจอัปเดตเอง ──');

// ── ฝั่งเซิร์ฟเวอร์: ส่งสัญญาณครบทุกทางที่ทำให้คิวเปลี่ยน ──────────────────
const ev = read('src', 'services', 'caseEvents.ts');
check('ส่งถึงห้องของผู้ตรวจ', /io\.to\('role:checker'\)/.test(ev));
/** ส่ง id คนทำมาด้วย — หน้ารายละเอียดใช้ข้ามสัญญาณที่เกิดจากตัวเอง (ไม่เตือนตัวเอง) */
check('บอกด้วยว่าใครเป็นคนทำ', /by: by \?\? null/.test(ev));
/** ไม่มี socket = รันเทส/สคริปต์ ต้องไม่ล้ม ไม่ใช่เรื่องผิดปกติ */
check('ไม่มี socket ก็ไม่ล้ม', /if \(!io\) return/.test(ev));

const svc = read('src', 'services', 'case.service.ts');
const rev = read('src', 'services', 'review.service.ts');
const integ = read('src', 'routes', 'integration.routes.ts');
const paths: [string, boolean][] = [
  ['ผู้สำรวจส่งงานเข้ามา', /notifyCaseChanged\(caseId, 'submitted'/.test(svc)],
  ['ผู้ตรวจกดบันทึก', /notifyCaseChanged\(caseId, 'saved'/.test(svc)],
  ['ตีกลับให้ผู้สำรวจ', /notifyCaseChanged\(caseId, 'sent_back'/.test(svc)],
  ['นำเข้าจากไฟล์/ระบบเก่า', /notifyCaseChanged\(caseId, 'imported'/.test(svc)],
  ['อนุมัติ', /notifyCaseChanged\(caseId, 'approved'/.test(rev)],
  ['แอดมินปลดล็อก', /notifyCaseChanged\(caseId, 'unlocked'/.test(rev)],
];
for (const [label, ok] of paths) check(`ส่งสัญญาณเมื่อ: ${label}`, ok);
/** บอทรายงาน 2 จังหวะ: สร้าง draft แล้ว · ประกันรับงานแล้ว — คนละความหมาย ต้องมีทั้งคู่ */
check('ส่งสัญญาณเมื่อ: บอทรายงานสถานะฝั่งประกัน (2 จุด)',
      (integ.match(/notifyCaseChanged\(caseId, 'emcs'/g) ?? []).length === 2);

// ── layout: ไม่มี provider = ไม่มี socket ──────────────────────────────────
for (const who of ['inspector', 'admin']) {
  const lay = read('..', 'web', 'src', 'app', who, 'layout.tsx');
  check(`${who} อยู่ใน SocketProvider`,
        lay.includes('<SocketProvider>') && lay.includes("from '@/providers/SocketProvider'"));
}

// ── หน้าคิว ───────────────────────────────────────────────────────────────
const page = read('..', 'web', 'src', 'app', 'inspector', 'page.tsx');
check('ฟังสัญญาณ case_changed', /socket\.on\('case_changed'/.test(page));
check('เลิกฟังตอนออกจากหน้า (กันฟังซ้อนกันหลายชั้น)', /socket\.off\('case_changed'/.test(page));
/** หลายสัญญาณมาติด ๆ กัน (บันทึกแล้วอนุมัติ) ต้องโหลดครั้งเดียว ไม่ใช่ยิงรัว */
check('รวบสัญญาณที่มาติดกันเป็นครั้งเดียว', /setTimeout\(\(\) => load\(true\), 400\)/.test(page));
/** socket หลุดเงียบได้ — ไม่มีตาข่ายรองแล้วจอจะค้างตลอดไปโดยไม่มีใครรู้ */
check('มีตาข่ายรองโหลดตามเวลา', /setInterval\(/.test(page) && page.includes('60_000'));
check('ไม่ยิงจากแท็บที่ถูกพับไว้', /document\.visibilityState === 'visible'/.test(page));
check('กลับมาที่แท็บแล้วโหลดทันที', /visibilitychange/.test(page));
/** โหลดเบื้องหลังพลาด (เน็ตวืบ) ห้ามล้างรายการทิ้งแล้วขึ้นหน้าจอ error ทับของที่อ่านอยู่ */
check('โหลดเบื้องหลังพลาดแล้วไม่ล้างของเดิม', /if \(!quiet\) setError/.test(page));
/** ถ้าไม่โชว์เวลา คนก็ยังกด F5 เผื่อไว้ และไม่มีทางรู้ว่าการอัปเดตเงียบไปแล้ว */
check('บอกเวลาที่ข้อมูลสดล่าสุด + มีปุ่มอัปเดตเอง',
      page.includes('อัปเดตเมื่อ') && page.includes('อัปเดตเดี๋ยวนี้'));

// ── หน้ารายละเอียดเคส ─────────────────────────────────────────────────────
const detail = read('..', 'web', 'src', 'components', 'cases', 'CaseDetail.tsx');
check('เตือนเมื่อมีคนอื่นบันทึกเคสที่เปิดค้างอยู่',
      /socket\.on\('case_changed'/.test(detail) && detail.includes('มีคนอื่นเพิ่งบันทึกเคสนี้'));
check('ไม่เตือนตัวเองตอนบันทึกเอง', /Number\(p\.by\) === Number\(user\.id\)\) return/.test(detail));
/**
 * ⛔ ห้ามโหลดข้อมูลใหม่ให้เองบนหน้านี้ — ผู้ตรวจอาจพิมพ์ค้างอยู่ ของที่พิมพ์จะหายโดยไม่ได้ถาม
 *    ทำได้แค่ขึ้นแถบให้คนกดเอง (ใช้แถบเดียวกับตอนบันทึกชน ซึ่งถามยืนยันอยู่แล้ว)
 */
check('เตือนอย่างเดียว ไม่โหลดทับสิ่งที่พิมพ์ค้างไว้',
      !/case_changed'[\s\S]{0,400}onReviewSubmitted\(\)/.test(detail));

// ตัวดึงงาน ISURVEY (user สั่ง 19/09/69): ครั้งก่อนหน้าเป็นเคสอ้างอิงเฉพาะที่จบงาน — ใบที่ยังรอตรวจต้องมีในเว็บแล้ว ตัวดึงถามผ่าน lookup นี้
{
  const ir = read('src', 'routes', 'integration.routes.ts');
  check('integration: GET /cases/lookup?survey_no= คืนเคสที่มีเลขเซอร์เวย์นั้น (ทุกสถานะ) และประกาศก่อน /cases/:id',
        /router\.get\('\/cases\/lookup', integrationAuth/.test(ir) && ir.includes('WHERE sr.survey_job_no = $1')
        && ir.indexOf("router.get('/cases/lookup'") < ir.indexOf("router.get('/cases/:id'"));
}

// 22/09/69: หน้างานรอตรวจซ่อนงานครั้งถัดไป (เคลม 2026013077649 ครั้งที่ 2) เพราะ importedStatus จับคู่สำรองด้วยเลขเคลมกับทุกเคส
{
  const svc = read('src', 'services', 'isurveyPull.service.ts');
  check('importedStatus: คีย์สำรองเลขเคลมอย่างเดียว ใส่เฉพาะเคสที่ไม่มีเลขเซอร์เวย์ (งานครั้งถัดไปเลขใหม่ต้องเป็น "ยังไม่มี" ไม่ใช่ใบครั้งที่ 1 ที่อนุมัติแล้ว)',
        svc.includes("if (!String(x.survey_job_no ?? '').trim() && !byKey.has(`${x.claim_no}|`)) byKey.set(`${x.claim_no}|`")
        && !svc.includes("if (!byKey.has(`${x.claim_no}|`)) byKey.set(`${x.claim_no}|`"));
}

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด\n' : `\n❌ ไม่ผ่าน ${failed} ข้อ\n`);
process.exit(failed === 0 ? 0 : 1);
