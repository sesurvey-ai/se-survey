/**
 * Contract test — ตัวนำเข้า XML ของ ISURVEY (parseIsurveyXml): ช่องความเห็น 4 ช่อง
 *
 * กติกา user 07/09/69 — ยึดปุ่ม "นำเข้า ISURVEY" ของบอท se-autokey เป็นแม่แบบ ให้ทุกทาง
 * (ดึงงานสด / อัปโหลด XML / บอทนำเข้าตรง) ลง EMCS เหมือนกัน:
 *   รายละเอียดการเกิดเหตุ ← ความคิดเห็นพนักงาน (SURV_COMMENT ในบล็อก TXN_SURV_REPORT)
 *   ความเห็นของเซอร์เวย์  ← ว่าง (ย้าย ไม่ก๊อป — ข้อความเดียวกันต้องไม่โผล่ 2 ช่องบน EMCS)
 *   ACC_DETAIL ของ ISURVEY (ข้อความแม่แบบบริษัท + ข้อมูลกรมธรรม์) ต้องไม่รั่วไปช่องไหนเลย
 *   ผลการดำเนินงาน / ความเห็นผู้ตรวจสอบ ← TXN_SURV_BILL (ไฟล์ ISURVEY จริงว่างเสมอ → หัวหน้ากรอกบนเว็บ)
 * ไฟล์ emcs_extract (สกัดจาก EMCS ที่กรอกตามกติกานี้อยู่แล้ว) จับคู่ตรงชื่อเหมือนเดิม
 * ⚠️ ต้องตรงกับ se-autokey: autokey/isurvey_to_sesurvey.py (build_case) + test_smoke.py
 *
 * รัน: npm test   (backend/)
 */
import { parseIsurveyXml, zeroDash } from '../src/services/xmlImport.service';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}

// ค่าจริงย่อจากเคลม 2026013071573: ACC_DETAIL = สรุปสั้น + ข้อความแม่แบบ · SURV_COMMENT = รายงานพนักงาน
const TEMPLATE = 'ค.ชนท้าย ป&#13;\n&#13;\nกรณีที่ลูกค้าเกิดอุบัติเหตุในพื้นที่จังหวัดที่มีสาขารับผิดชอบ ให้ติดต่อสาขาก่อนจัดซ่อม (ข้อความแม่แบบบริษัท)';
const STAFF = 'เรียน ผู้จัดการฝ่ายสินไหม ทราบ&#13;\n- เมื่อวันที่ 31 สิงหาคม 2569 ได้รับแจ้ง (ความคิดเห็นพนักงาน)';
const xml = (prefix = '') => `${prefix}<INSERT_SURV_REPORT_XML>
<TXN_SURV_REPORT>
<SURV_JOBNO>SEABI-113260800575</SURV_JOBNO>
<REF_CLAIM_NO>2026013071573</REF_CLAIM_NO>
<ACC_DETAIL>${TEMPLATE}</ACC_DETAIL>
<SURV_COMMENT>${STAFF}</SURV_COMMENT>
</TXN_SURV_REPORT>
<TXN_SURV_BILL>
<ACC_RESULT> </ACC_RESULT>
<ACC_COMMENT> </ACC_COMMENT>
<SURV_COMMENT> </SURV_COMMENT>
</TXN_SURV_BILL>
</INSERT_SURV_REPORT_XML>`;

const isv = parseIsurveyXml(xml());
const r = isv.report as Record<string, string>;
check('ไฟล์ ISURVEY: source = isurvey_xml', isv.source === 'isurvey_xml', String(isv.source));
check('ไฟล์ ISURVEY: รายละเอียดการเกิดเหตุ = ความคิดเห็นพนักงาน (SURV_COMMENT) คงบรรทัดใหม่',
  r.acc_detail === 'เรียน ผู้จัดการฝ่ายสินไหม ทราบ\n- เมื่อวันที่ 31 สิงหาคม 2569 ได้รับแจ้ง (ความคิดเห็นพนักงาน)',
  JSON.stringify(r.acc_detail));
check('ไฟล์ ISURVEY: ความเห็นของเซอร์เวย์ว่าง (ย้าย ไม่ก๊อปซ้ำ 2 ช่อง)',
  r.surveyor_comment === '', JSON.stringify(r.surveyor_comment));
check('ไฟล์ ISURVEY: ข้อความแม่แบบบริษัท (ACC_DETAIL) ไม่รั่วไปช่องไหนเลย',
  !JSON.stringify(isv.report).includes('ข้อความแม่แบบบริษัท'));
check('ไฟล์ ISURVEY: ผลการดำเนินงาน/ความเห็นผู้ตรวจสอบ ว่าง (XML ไม่ส่งบันทึกหัวหน้างานมา — กรอกบนเว็บ)',
  r.survey_result === '' && r.review_comment === '',
  JSON.stringify([r.survey_result, r.review_comment]));

// กรมธรรม์/เลขเคลมคู่กรณี "ศูนย์ล้วน" = ช่างไม่ทราบ → '-' (user เคาะ 16/09/69 — ชุดเดียวกับตัวแปลง ISURVEY และบอท)
{
  const car = (type: string, pol: string, clm: string) =>
    `<TXN_SURV_CAR><TYPE>${type}</TYPE><POLICYNO>${pol}</POLICYNO><CLAIMNO>${clm}</CLAIMNO></TXN_SURV_CAR>`;
  const withCars = xml().replace('</INSERT_SURV_REPORT_XML>',
    car('0', '525013111407', '2026013071573') + car('1', '00', '000000') + car('1', '-0', 'K123') + '</INSERT_SURV_REPORT_XML>');
  const opp = (parseIsurveyXml(withCars).report as { opposing_parties: Array<Record<string, string>> }).opposing_parties;
  check('นำเข้า XML: คู่กรณี POLICYNO 00 / CLAIMNO 000000 → "-"', opp?.[0]?.policy_no === '-' && opp?.[0]?.claim_no === '-', JSON.stringify(opp?.[0] && [opp[0].policy_no, opp[0].claim_no]));
  check('นำเข้า XML: -0 → "-" แต่ค่าจริงคงเดิม', opp?.[1]?.policy_no === '-' && opp?.[1]?.claim_no === 'K123', JSON.stringify(opp?.[1] && [opp[1].policy_no, opp[1].claim_no]));
  check('นำเข้า XML: zeroDash ไม่แตะค่าที่มีตัวอื่นปน/ว่าง', zeroDash('0A') === '0A' && zeroDash('') === '' && zeroDash('100') === '100' && zeroDash(' 00 ') === '-');
}

// ไฟล์ที่ emcs_dump.py สกัดจาก EMCS — ข้อมูลอยู่ในกติกาเดิมของ EMCS แล้ว → จับคู่ตรงชื่อ
const ext = parseIsurveyXml(xml('<!-- SOURCE=EMCS_EXTRACT -->\n'));
const e = ext.report as Record<string, string>;
check('ไฟล์ EMCS extract: source = emcs_extract', ext.source === 'emcs_extract', String(ext.source));
check('ไฟล์ EMCS extract: ACC_DETAIL → รายละเอียดการเกิดเหตุ (ตรงชื่อ)',
  e.acc_detail.startsWith('ค.ชนท้าย ป'), JSON.stringify(e.acc_detail).slice(0, 60));
check('ไฟล์ EMCS extract: SURV_COMMENT → ความเห็นของเซอร์เวย์ (ตรงชื่อ)',
  e.surveyor_comment.startsWith('เรียน ผู้จัดการฝ่ายสินไหม'), JSON.stringify(e.surveyor_comment).slice(0, 60));

console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
