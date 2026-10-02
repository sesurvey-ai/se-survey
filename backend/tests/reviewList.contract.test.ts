/**
 * Contract test — หน้า "รายการงาน" ของหัวหน้า โหลดเท่าที่ต้องใช้ (user สั่ง 03/10/69 ก่อนเริ่มใช้งานจริง)
 *
 * ที่มา: เดิมทุกครั้งที่เปิด/รีเฟรช (ทุก 60 วิ + ทุกครั้งที่เคสเปลี่ยน × หัวหน้าทุกคน) ดึงงานทุกทีมตั้งแต่เริ่มระบบ
 * แล้วค่อยคัดทีมใน JS — 905 เรื่อง = 1.6 MB · งานเข้าเดือนละ 10,000 เรื่อง ครบปี = แสนแถวต่อครั้ง
 * วันที่ทำ เทียบวิธีเดิม/ใหม่บนข้อมูลจริงครบ 26 บัญชี (หัวหน้า 24 + แอดมิน) — งานทุกแท็บ ตัวเลข ค่าทุกช่อง ผลค้น ตรงกันหมด
 *
 * ล็อกไว้:
 *  1) คัดทีมในฐานข้อมูล — รายชื่อลูกทีม → id ผู้ใช้ (ตัวจับคู่เดิม) → WHERE assigned_to = ANY(...) · ไม่คัดใน JS แล้ว
 *  2) view=active โหลดเต็มเฉพาะ รอตรวจ/เสร็จงาน/ตีกลับ + ตัวเลขแท็บอื่น/draft/คิว EMCS/รายชื่อช่าง
 *  3) แท็บอนุมัติแล้ว/ส่งประกันแล้วทีละหน้า 50 · ค้นหาทุกสถานะที่ server สูงสุด 200 · POST (คำค้นไม่อยู่ใน URL)
 *  4) แบ่งแท็บฝั่ง server ตรงกับหน้าเว็บ · ป้ายช่างตรงกับ surveyorLabel ของเว็บ
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import { likeContains, REVIEW_PAGE_SIZE, REVIEW_SEARCH_LIMIT } from '../src/services/reviewList';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const svc = read('src', 'services', 'reviewList.ts');
const caseSvc = read('src', 'services', 'case.service.ts');
const ctl = read('src', 'controllers', 'case.controller.ts');
const routes = read('src', 'routes', 'case.routes.ts');
const page = read('..', 'web', 'src', 'app', 'inspector', 'page.tsx');
const caseList = read('..', 'web', 'src', 'components', 'cases', 'CaseList.tsx');
const mig = read('src', 'db', 'migrations', '070_survey_reports_claim_no_index.sql');

// ── 1) คัดทีมในฐานข้อมูล ──
check('ขอบเขตทีมมาจากตัวกรองทีมเดิม (filterFor) + ผู้ใช้ที่ตัวจับคู่เดิมบอกว่าอยู่ทีม',
  svc.includes('staffGroupService.filterFor(user.id, user.role)')
  && /for \(const m of team\.group\.members \?\? \[\]\) if \(m\.surveyor_id\) ids\.add\(m\.surveyor_id\);/.test(svc)
  && svc.includes("team.match(`${u.code ?? ''} ${u.first_name ?? ''} ${u.last_name ?? ''}`.trim())"));
check('กรองใน SQL: งานที่ตัวเองดึง/สร้าง หรือช่างอยู่ในทีม (ใช้ดัชนี)',
  svc.includes('c.created_by = ${$(scope.me)} OR c.assigned_to = ANY(${$(scope.userIds)}::int[])'));
check('ไม่ดึงทุกทีมมาคัดใน JS แล้ว', !/rows\.filter\(\(r\) =>[\s\S]{0,80}team\.match/.test(svc) && !caseSvc.includes('team.match(`${r.surveyor_code'));
check('แอดมิน/หัวหน้าที่ยังไม่ผูกทีม = ไม่กรอง (scope null)', /if \(!team\) return null;/.test(svc) && /if \(scope\) parts\.push/.test(svc));

// ── 2) โหลดเต็มเฉพาะงานที่ยังต้องทำ ──
check('active = รอตรวจ/เสร็จงาน/ตีกลับ ที่ยังไม่ส่งประกัน (ไม่มีอนุมัติแล้ว)',
  svc.includes("active: `c.emcs_submitted_at IS NULL AND (c.status IN ('surveyed', 'finished') OR (c.status = 'assigned' AND c.sent_back_at IS NOT NULL))`"));
check('active คืนตัวเลขแท็บอื่น + draft + คิว EMCS + รายชื่อช่าง',
  /counts: \{ approved: [^}]+, sent: [^}]+\}/.test(svc) && svc.includes('drafts: Number(') && svc.includes("emcs: { queued: q('queued'), running: q('running'), failed: q('failed') }") && svc.includes('surveyors,'));
check('คิว EMCS นับจากงานล่าสุดต่อเคส (เหมือนแถว) + นำเข้าไม่สำเร็จนับเฉพาะที่ยังไม่มี draft',
  svc.includes('NOT EXISTS (SELECT 1 FROM emcs_import_jobs j2 WHERE j2.case_id = j.case_id AND j2.id > j.id)')
  && svc.includes("(j.status <> 'failed' OR c.emcs_imported_at IS NULL)"));
check('รายชื่อช่างจำไว้ 2 นาทีต่อทีม (ไม่ไล่ทุกเรื่องทุกรอบรีเฟรช)', svc.includes('SURVEYOR_TTL_MS = 120_000') && svc.includes('surveyorLabels(scope)'));

// ── 3) งานเก่าทีละหน้า · ค้นที่ server ──
check('หน้าละ 50 · ค้นได้สูงสุด 200', REVIEW_PAGE_SIZE === 50 && REVIEW_SEARCH_LIMIT === 200);
check('แท็บงานเก่าใช้ LIMIT/OFFSET + นับทั้งหมดแยก', svc.includes('LIMIT ${p.$(REVIEW_PAGE_SIZE)} OFFSET ${p.$((page - 1) * REVIEW_PAGE_SIZE)}') && svc.includes('SELECT COUNT(*)::int AS n ${BASE_FROM}'));
check('หา id ของหน้าก่อน แล้วค่อยดึงรายละเอียด (นับรูป/ยอดเงิน/คิว เฉพาะแถวที่โชว์)', /async function rowsByIds\(ids: number\[\]\)/.test(svc) && svc.includes('ORDER BY array_position($1::int[], c.id)'));
check('เรียง: อนุมัติล่าสุดก่อน / ส่งล่าสุดก่อน / รอตรวจสร้างล่าสุดก่อนแบบเดิม',
  svc.includes("approved: 'rv.reviewed_at DESC NULLS LAST") && svc.includes("sent: 'c.emcs_submitted_at DESC") && svc.includes("active: 'c.created_at DESC"));
check('ค้น 5 ช่องเดิมของหน้าเว็บ (เลขเคลม/เซอร์เวย์/รับแจ้ง/ทะเบียน/ชื่อ)',
  svc.includes('sr.claim_no ILIKE ${p} OR sr.survey_job_no ILIKE ${p} OR sr.claim_ref_no ILIKE ${p} OR sr.license_plate ILIKE ${p} OR c.customer_name ILIKE ${p}'));
check('% _ \\ ที่พิมพ์ค้นเป็นตัวอักษรธรรมดา',
  likeContains('50%') === '%50\\%%' && likeContains('a_b') === '%a\\_b%' && likeContains('x\\y') === '%x\\\\y%' && likeContains('กข 123') === '%กข 123%');
check('"ครั้งที่" ไม่พึ่ง ROW_NUMBER ทั้งก้อนแล้ว (โหลดทีละส่วน) · ไม่มีเลขเคลม = 1',
  !/ROW_NUMBER\(\)\s*OVER/.test(svc) && svc.includes("COALESCE(c.visit_no, CASE WHEN COALESCE(sr.claim_no, '') = '' THEN 1 ELSE ("));
check('มีดัชนีเลขเคลมให้การนับ "ครั้งที่" ทีละแถว', mig.includes('CREATE INDEX IF NOT EXISTS idx_survey_reports_claim_no ON survey_reports (claim_no);'));

// ── controller / route ──
check('GET /review?view=active → reviewList.active · ไม่ส่ง view = ทุกสถานะแบบเดิม (เว็บรุ่นเก่าระหว่าง deploy)',
  /if \(req\.query\.view === 'active'\) \{\s*sendSuccess\(res, await reviewList\.active\(user\)\);/.test(ctl) && ctl.includes('sendSuccess(res, await caseService.getForReview(user));'));
check('POST /review/query รับเฉพาะ view approved/sent/search + ตัดความยาวคำค้น',
  ctl.includes("b.view === 'approved' || b.view === 'sent' || b.view === 'search'") && ctl.includes('q: text(b.q, 100)'));
check('route POST /review/query (หัวหน้า) อยู่ก่อนเส้นทาง /:id',
  routes.includes("router.post('/review/query', auth, requireRole('checker'), caseController.queryReview);")
  && routes.indexOf("router.post('/review/query'") < routes.indexOf("router.get('/:id'"));

// ── 4) server ↔ เว็บ ตรงกัน ──
check('แบ่งแท็บ: ส่งประกันแล้วมาก่อน → อนุมัติแล้ว → ตีกลับ → เสร็จงาน → รอตรวจ (ทั้งสองฝั่ง)',
  svc.includes("CASE WHEN c.emcs_submitted_at IS NOT NULL THEN 'sent'") && svc.includes("WHEN c.status = 'reviewed' THEN 'approved'")
  && svc.includes("WHEN c.status = 'assigned' AND c.sent_back_at IS NOT NULL THEN 'sentBack'") && svc.includes("WHEN c.status = 'finished' THEN 'finished' ELSE 'pending' END")
  && /if \(c\.emcs_submitted_at\) sent\.push\(c\);\s*else if \(c\.status === 'reviewed'\) approved\.push\(c\);/.test(page));
check('ป้ายช่างฝั่ง SQL = surveyorLabel ของเว็บ (รหัส + ชื่อ นามสกุล · ไม่มีบัญชี = ชื่อตามรายงาน)',
  caseList.includes("return `${c.surveyor_code ? c.surveyor_code + ' ' : ''}${c.surveyor_first_name} ${c.surveyor_last_name || ''}`.trim();")
  && caseList.includes("return (c.report_surveyor_name || '').trim();")
  && svc.includes("THEN BTRIM(CASE WHEN COALESCE(u.code, '') <> '' THEN u.code || ' ' ELSE '' END || u.first_name || ' ' || COALESCE(u.last_name, ''))")
  && svc.includes("ELSE BTRIM(COALESCE(sr.surveyor_name, '')) END"));

// ── หน้าเว็บ ──
check('เว็บ: รายการหลักขอ view=active', page.includes("api.get('/api/cases/review', { params: { view: 'active' }, timeout: 45_000 })"));
check('เว็บ: แท็บงานเก่า/ค้นหา ถามผ่าน POST (คำค้น/ชื่อช่างไม่อยู่ใน URL)',
  (page.match(/api\.post\('\/api\/cases\/review\/query'/g) ?? []).length === 2 && !/params: \{[^}]*\bq\b/.test(page) && !/params: \{[^}]*who/.test(page));
check('เว็บ: ค้นหารอพิมพ์เสร็จก่อนถาม server', /setTimeout\(\(\) => loadSearch\(needle, src, who\), 300\)/.test(page));
check('เว็บ: คำตอบเก่าทับคำตอบใหม่ไม่ได้', page.includes('if (seq !== histSeq.current) return;') && page.includes('if (seq !== searchSeq.current) return;'));
check('เว็บ: มีปุ่มก่อนหน้า/ถัดไป + บอกแถวที่เท่าไหร่ของทั้งหมด', page.includes('‹ ก่อนหน้า') && page.includes('ถัดไป ›') && page.includes('จาก {hist.total} เรื่อง'));
check('เว็บ: ตัวเลขแท็บงานเก่า/draft/คิว EMCS มาจาก server', page.includes('approved: meta ? meta.counts.approved') && page.includes('const pendingDrafts = meta ? meta.drafts') && page.includes('const emcsQ = meta ? meta.emcs'));
check('เว็บ: backend รุ่นเก่า (คืน array) ยังใช้ได้ระหว่าง deploy', page.includes('if (Array.isArray(d)) { setCases(d); setMeta(null); }'));
check('เว็บ: socket/ทุก 60 วิ รีเฟรชทั้งรายการหลักและหน้าที่เปิดอยู่', (page.match(/refreshRef\.current\(\)/g) ?? []).length >= 3);

if (failed) {
  console.error(`\n${failed} ข้อไม่ผ่าน`);
  process.exit(1);
}
console.log('\nรายการงานหัวหน้า (โหลดเท่าที่ต้องใช้): ผ่านทุกข้อ');
process.exit(0);
