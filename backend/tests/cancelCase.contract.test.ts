/**
 * Contract test — สถานะ "ยกเลิก" ของเคส (user สั่ง 22/09/69: ลูกค้าไม่ติดใจ เลยไม่เคลม / ISURVEY ยกเลิกเคลม)
 *
 * กติกา: ยกเลิกได้ทุกสถานะที่ยังไม่อนุมัติ (อนุมัติแล้วให้แอดมินปลดล็อกก่อน) · ต้องมีเหตุผล · จำสถานะเดิมไว้ให้แอดมิน "เลิกยกเลิก"
 *        ยกเลิกแล้ว = อ่านอย่างเดียว (423) · ไม่โผล่บนแอปช่าง (getMyCases) · งานที่อยู่กับช่างถูกถอนการ์ด (push) · ป้าย "ยกเลิก" ทุกรายการ
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const mig = read('src', 'db', 'migrations', '067_cancel_status.sql');
check('migration 067: คอลัมน์ยกเลิกบน cases_all + สร้าง VIEW cases ซ้ำ (กติกา CLAUDE.md)',
  mig.includes("ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'cancelled';")   // status เป็น ENUM — ลืมแล้ว 500 (เจอ 22/09/69)
  && mig.includes('ALTER TABLE cases_all ADD COLUMN IF NOT EXISTS cancelled_at') && mig.includes('status_before_cancel')
  && mig.includes('CREATE OR REPLACE VIEW cases AS SELECT * FROM cases_all WHERE deleted_at IS NULL;'));

const svc = read('src', 'services', 'case.service.ts');
check('cancelCase: ต้องมีเหตุผล · อนุมัติแล้วห้าม · ยกเลิกซ้ำห้าม · จำสถานะเดิม · UPDATE แบบ guard สถานะ (กัน race)',
  /async cancelCase\(caseId: number, byUserId: number, reason: string\)/.test(svc)
  && svc.includes("if (!text) throw new AppError(400, 'ต้องบอกเหตุผลที่ยกเลิก")
  && svc.includes("if (status === 'reviewed') throw new ForbiddenError('เคสนี้อนุมัติแล้ว — ให้แอดมินปลดล็อกก่อนจึงจะยกเลิกได้')")
  && svc.includes("if (status === 'cancelled') throw new ForbiddenError('เคสนี้ยกเลิกไปแล้ว')")
  && /SET status = 'cancelled', status_before_cancel = status, cancelled_at = NOW\(\), cancelled_by = \$2, cancel_reason = \$3\s+WHERE id = \$1 AND status = \$4/.test(svc));
check('cancelCase: งานที่อยู่กับช่าง (assigned/finished) ถอนการ์ดบนเครื่อง reason cancelled · แจ้ง socket',
  /\(status === 'assigned' \|\| status === 'finished'\) && assigned_to\s*\? await pushSurveyWithdrawn\(caseId, Number\(assigned_to\), 'cancelled'\)/.test(svc)
  && svc.includes("notifyCaseChanged(caseId, 'cancelled', byUserId)"));
check('uncancelCase (แอดมิน): คืนสถานะเดิม (ไม่รู้ = pending) · ล้างช่องยกเลิก · กลับไปอยู่กับช่าง = ส่งการ์ดใหม่',
  /async uncancelCase\(caseId: number, byUserId: number\)/.test(svc) && svc.includes("const back = String(c.rows[0].status_before_cancel || 'pending');")
  && /SET status = \$2, status_before_cancel = NULL, cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL\s+WHERE id = \$1 AND status = 'cancelled'/.test(svc)
  && svc.includes("back === 'assigned' && c.rows[0].assigned_to ? await pushNewSurveyById(caseId, Number(c.rows[0].assigned_to))"));
check('ยกเลิกแล้ว = อ่านอย่างเดียว (assertNotApproved 423) · ไม่โผล่บนแอปช่าง (getMyCases) · แดชบอร์ดนับแยก',
  svc.includes("if (r.rows[0].status === 'cancelled') throw new AppError(423, 'เคสนี้ยกเลิกแล้ว")
  && /WHERE c\.assigned_to = \$1 AND c\.status <> 'cancelled'/.test(svc)
  && svc.includes("COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled"));
check('หน้าเคสรู้ชื่อคนยกเลิก (getDetail join users ด้วย cancelled_by)', svc.includes('AS cancelled_by_name'));

const routes = read('src', 'routes', 'case.routes.ts');
const ctrl = read('src', 'controllers', 'case.controller.ts');
check('เส้นทาง: POST /:id/cancel (checker/admin/callcenter) · POST /:id/uncancel (admin เท่านั้น)',
  /router\.post\('\/:id\/cancel', auth, requireRole\('checker', 'admin', 'callcenter'\), caseController\.cancelCase\)/.test(routes)
  && /router\.post\('\/:id\/uncancel', auth, requireRole\('admin'\), caseController\.uncancelCase\)/.test(routes)
  && ctrl.includes('caseService.cancelCase(caseId, req.user!.id, String(req.body?.reason ?? \'\'))') && ctrl.includes('caseService.uncancelCase(caseId, req.user!.id)'));
check('เหตุการณ์ socket มี cancelled', read('src', 'services', 'caseEvents.ts').includes("| 'cancelled'"));

// ── เว็บ ──
const web = (...p: string[]) => read('..', 'web', 'src', ...p);
const cd = web('components', 'cases', 'CaseDetail.tsx');
check('หน้าเคส: ยกเลิกแล้ว = ล็อกเหมือนอนุมัติ · แถบปุ่มเปลี่ยนเป็นป้าย "ยกเลิกแล้ว" + แอดมิน "เลิกยกเลิก" · แบนเนอร์เหตุผล/คน/เวลา',
  cd.includes("const cancelled = caseData?.status === 'cancelled';") && cd.includes('const locked = (approved && !isReference) || cancelled;')
  && cd.includes('{cancelled ? cancelBar : actionBar}') && cd.includes("api.post(`/api/cases/${caseData.id}/uncancel`, {})")
  && cd.includes('ยกเลิกงานแล้ว') && cd.includes('caseData?.cancel_reason'));
check('หน้าเคส: ปุ่ม "ยกเลิกงาน" กางช่องเหตุผล + ยืนยันก่อน · ยิง /cancel',
  cd.includes("api.post(`/api/cases/${caseData.id}/cancel`, { reason })") && cd.includes('ยืนยันยกเลิกงาน') && cd.includes('window.confirm(`ยกเลิกงานนี้?'));
const maps = [
  ['components/cases/CaseList.tsx', web('components', 'cases', 'CaseList.tsx')],
  ['app/callcenter/cases/page.tsx', web('app', 'callcenter', 'cases', 'page.tsx')],
  ['app/callcenter/page.tsx', web('app', 'callcenter', 'page.tsx')],
  ['app/admin/cases/page.tsx', web('app', 'admin', 'cases', 'page.tsx')],
  ['app/admin/page.tsx', web('app', 'admin', 'page.tsx')],
  ['app/admin/cases/trash/page.tsx', web('app', 'admin', 'cases', 'trash', 'page.tsx')],
  ['app/inspector/isurvey/page.tsx', web('app', 'inspector', 'isurvey', 'page.tsx')],
] as const;
for (const [name, src] of maps) check(`ป้ายสถานะ "ยกเลิก" ใน ${name}`, /cancelled:\s*(\{ label: 'ยกเลิก'|'ยกเลิก')/.test(src));
check('ตัวกรองสถานะคอลเซ็นเตอร์/แอดมิน มีตัวเลือก ยกเลิก',
  web('app', 'callcenter', 'cases', 'page.tsx').includes('<option value="cancelled">ยกเลิก</option>')
  && web('app', 'admin', 'cases', 'page.tsx').includes('<option value="cancelled">ยกเลิก</option>'));

// ── มือถือ (native): ข้อความตอนการ์ดถูกถอนเพราะยกเลิก — APK ถัดไป (เครื่องเก่าได้ข้อความกลาง "งานถูกถอนแล้ว")
const kt = fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', 'android', 'app', 'src', 'main', 'kotlin', 'com', 'sesurvey', 'se_survey', 'NotificationHelper.kt'), 'utf8');
check('native: reason "cancelled" มีข้อความไทย', kt.includes('"cancelled" -> "งานถูกยกเลิกแล้ว'));

console.log(failed ? `\n${failed} FAILED ❌` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
