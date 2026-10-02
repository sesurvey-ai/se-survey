/**
 * กติกาค่ารูปเหมา — เป็น **ตัวเงินที่เรียกเก็บบริษัทประกัน** ผิดแล้วไม่มีอะไรฟ้อง
 *
 * user เคาะ 20/08/69 (กติกา) + 31/08/69 (ลงมือ): เหมา 10 รูป × 5 = 50 ไม่อิงจำนวนรูปจริง
 * ไล่ทีละชั้นตามลำดับ หยุดที่ชั้นแรกที่เข้าเงื่อนไข
 * 02/10/69: งานบริษัทนอก/OSS + จังหวัดที่ไม่มีเรทในระบบ → ระบบไม่เติม ให้หัวหน้ากรอกเอง (manual)
 */
import { standardPhotoFee, PHOTO_FEE_COUNT, PHOTO_FEE_PRICE } from '../src/services/photoFee.service';

let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? `  (${detail})` : ''}`);
  if (!cond) failed++;
};
const fee = (r: Record<string, unknown>) => standardPhotoFee(r);
const total = (r: Record<string, unknown>) => {
  const f = fee(r);
  return f ? f.count * f.price : null;
};

check('เหมาคือ 10 × 5 = 50 (ไม่อิงจำนวนรูปจริง)', PHOTO_FEE_COUNT * PHOTO_FEE_PRICE === 50,
      `${PHOTO_FEE_COUNT}×${PHOTO_FEE_PRICE}`);

// ── ชั้น 1: ไทยไพบูลย์ ไม่มีค่ารูปทุกกรณี (จบตั้งแต่ข้อนี้) ──
check('SETP → ไม่มีค่ารูป', total({ survey_job_no: 'SETP-69080003' }) === 0);
check('SETP ต่างจังหวัด ก็ยังไม่มี', total({ survey_job_no: 'SETP-69080003', arrival_province: 'ชลบุรี' }) === 0);
check('ไม่มีเลขเซอร์เวย์ แต่ชื่อบริษัทเป็นไทยไพบูลย์ → ไม่มีค่ารูป',
      total({ insurance_company: 'บริษัท ไทยไพบูลย์ประกันภัย จำกัด (มหาชน)', arrival_province: 'ชลบุรี' }) === 0);

// ── ชั้น 2: ไปถึงแล้วไม่พบ ไม่เบิกทุกกรณี แม้ต่างจังหวัด ──
check('ไปถึงแล้วไม่พบ (ต่างจังหวัด) → ไม่มีค่ารูป',
      total({ survey_job_no: 'SEABI-120260800001', acc_fault: 'ไปถึงแล้วไม่พบ' }) === 0);
// ค่าที่เก็บมี 2 แบบ มี/ไม่มีเว้นวรรค (หน้าเว็บกับแอปรับไว้ทั้งคู่)
check('รูปแบบ "ไปถึง แล้วไม่พบ" (มีเว้นวรรค) ก็ต้องจับได้',
      total({ survey_job_no: 'SEABI-120260800001', acc_fault: 'ไปถึง แล้วไม่พบ' }) === 0);

// ── ชั้น 3: งานกรุงเทพ ไม่มีค่ารูป ──
check('SEABI กรุงเทพ (หลัก 2-3 = 10) → ไม่มีค่ารูป',
      total({ survey_job_no: 'SEABI-110260803840' }) === 0);
check('ยังไม่มีเลข แต่ผู้สำรวจยืนยันว่ากรุงเทพ → ไม่มีค่ารูป',
      total({ arrival_province: 'กรุงเทพ ฯ' }) === 0);
check('เขียน "กรุงเทพมหานคร" ก็ต้องจับได้', total({ arrival_province: 'กรุงเทพมหานคร' }) === 0);

// ── ชั้น 4: นอกนั้น = เหมา 50 ──
check('SEABI ต่างจังหวัด (ชลบุรี = 20) → 50', total({ survey_job_no: 'SEABI-120260800001' }) === 50);
check('ยังไม่มีเลข แต่ยืนยันว่าต่างจังหวัด → 50', total({ arrival_province: 'ชลบุรี' }) === 50);

// ── ⛔ ตัดสินไม่ได้ ต้องคืน null ห้ามเดา ──
// เดาเป็น 0 = ไม่เรียกเก็บทั้งที่ควรเรียก · เดาเป็น 50 = เรียกเก็บทั้งที่ไม่ควร
// ทั้งสองทางคือตัวเงินที่ผิดโดยไม่มีใครรู้ → ปล่อยให้คนกรอกเองดีกว่า
check('ไม่มีเลขเซอร์เวย์ + ไม่รู้จังหวัดออกสำรวจ → null (ให้คนกรอกเอง)', fee({}) === null);
check('รู้แค่จังหวัดที่เกิดเหตุ ไม่ใช่จังหวัดออกสำรวจ → ยัง null',
      fee({ acc_province: 'ชลบุรี' }) === null);
// ⛔ เลขเซอร์เวย์มาก่อนเสมอ — เป็นตัวจริงตามเอกสาร
check('มีเลขเซอร์เวย์แล้ว ใช้เลขเป็นหลัก ไม่ใช่จังหวัดที่ยืนยัน',
      total({ survey_job_no: 'SEABI-110260803840', arrival_province: 'ชลบุรี' }) === 0);

// ── ต่อสายถึงหน้าตรวจ ──
{
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const svc = read('src', 'services', 'case.service.ts');
  const ui = read('..', 'web', 'src', 'components', 'cases', 'CaseDetail.tsx');

  check('หน้าตรวจได้รับข้อเสนอค่ารูปจาก backend', svc.includes('photo_fee_suggest'));
  // ⛔ งานที่นำเข้าจากไฟล์ ISURVEY ยอดกรอกจบที่นั่นแล้ว — เติมทับ = เขียนทับของจริง
  check('⛔ ไม่เสนอกับงานที่นำเข้าจากไฟล์ ISURVEY', svc.includes("source !== 'isurvey_xml'"));
  // ⛔ เติมทับค่าที่บันทึกไว้แล้ว = การแก้ของหัวหน้าหายเงียบ (แก้ได้ก็เท่ากับแก้ไม่ได้)
  check('เติมเฉพาะตอนยังไม่เคยกรอก ไม่ทับของที่บันทึกไว้', ui.includes('photoFeeUnset'));
  // บรรทัดกรณี "ไม่มีค่ารูป" ถอดออก 02/09/69 (ขึ้นแทบทุกเคสโดยไม่บอกอะไรใหม่)
  // เหลือเฉพาะตอนเติมเลขให้จริง ซึ่งจำเป็น — เลขโผล่มาเองต้องบอกที่มาเสมอ
  check('บอกที่มาของตัวเลขที่เติมให้', ui.includes('ค่ารูปเติมให้ตามกติกาเหมา')
        && ui.includes('photoFee.count > 0'));
}

// ── ครั้งที่ 2 ขึ้นไป ไม่มีค่ารูป (user เคาะ 22/09/69 หลังตรวจเคลม 2026013136010 4 ครั้ง: รูป 50 เฉพาะครั้งที่ 1) ──
check('SEABI ต่างจังหวัด ครั้งที่ 2 → 0', total({ survey_job_no: 'SEABI-321260500066', visit_no: 2 }) === 0);
check('ครั้งที่ 4 (ส่งเป็นข้อความ "4") → 0 พร้อมเหตุผลบอกครั้งที่', (() => {
  const f = fee({ survey_job_no: 'SEABI-320260900417', visit_no: '4' });
  return !!f && f.count === 0 && f.price === 0 && f.reason.includes('ครั้งที่ 4');
})());
check('ครั้งที่ 1 / ไม่ส่งครั้งที่มา → กติกาเดิม (ต่างจังหวัด 50)',
      total({ survey_job_no: 'SEABI-120260500221', visit_no: 1 }) === 50 && total({ survey_job_no: 'SEABI-120260500221' }) === 50);
check('ครั้งที่ 2 กรุงเทพ/ไทยไพบูลย์ ก็ 0 (ไม่ขัดกัน)', total({ survey_job_no: 'SEABI-110260900001', visit_no: 2 }) === 0 && total({ survey_job_no: 'SETP-69090001', visit_no: 3 }) === 0);
check('case.service ส่ง visit_no ของใบนี้ให้ standardPhotoFee',
      (require('fs') as typeof import('fs')).readFileSync((require('path') as typeof import('path')).join(__dirname, '..', 'src', 'services', 'case.service.ts'), 'utf8')
        // ต่อท้ายด้วย lump_sum_label ได้ (จังหวัดเรทเหมา 01/10/69 — ล็อกใน lumpSum.contract.test.ts)
        .includes("standardPhotoFee({ ...report, visit_no: Number(caseResult.rows[0]?.visit_no) || visitCount"));

// ── ชั้น 3.5/3.6: ระบบไม่เติม ให้หัวหน้ากรอกเอง (user เคาะ 02/10/69) ──
const ossFee = fee({ survey_job_no: 'SEABI-174261000001', is_outsource: true });
check('งานบริษัทนอก/OSS ต่างจังหวัด → ไม่เติม (manual) พร้อมเหตุผล',
      !!ossFee && ossFee.count === 0 && ossFee.price === 0 && ossFee.manual === true && ossFee.reason.includes('บริษัทนอก'));
const noRate = fee({ survey_job_no: 'SEABI-174261000001', area_has_rates: false });
check('จังหวัดที่ไม่มีเรทในระบบ → ไม่เติม (manual) พร้อมเหตุผล',
      !!noRate && noRate.count === 0 && noRate.manual === true && noRate.reason.includes('ไม่มีเรท'));
check('ช่าง SE ในจังหวัดที่มีเรท → 50 เหมือนเดิม',
      total({ survey_job_no: 'SEABI-120261000001', is_outsource: false, area_has_rates: true }) === 50);
check('ไม่ส่งธงมา (ผู้เรียกอื่น) → กติกาเดิม 50', total({ survey_job_no: 'SEABI-120261000001' }) === 50);
check('บริษัทนอกในกรุงเทพ → "ไม่มีค่ารูป" ตามข้อกรุงเทพ (ไม่ใช่กรอกเอง)', (() => {
  const f = fee({ survey_job_no: 'SEABI-110261000001', is_outsource: true });
  return !!f && f.count === 0 && !f.manual && f.reason.includes('กรุงเทพ');
})());
check('บริษัทนอกงานครั้งที่ 2 / ไทยไพบูลย์ → ไม่มีค่ารูปตามข้อเดิม (ไม่ใช่กรอกเอง)',
      !fee({ survey_job_no: 'SEABI-174261000001', is_outsource: true, visit_no: 2 })?.manual
      && !fee({ survey_job_no: 'SETP-69100001', is_outsource: true })?.manual);
const cs = (require('fs') as typeof import('fs')).readFileSync((require('path') as typeof import('path')).join(__dirname, '..', 'src', 'services', 'case.service.ts'), 'utf8');
check('case.service ส่งธงบริษัทนอก (จากช่องผู้สำรวจ) + จังหวัดมีเรทไหม ให้กติกาค่ารูป',
      cs.includes('is_outsource: !isSeSurveyor(report.acc_surveyor)') && cs.includes('area_has_rates: areaHasRates'));
const web = (require('fs') as typeof import('fs')).readFileSync((require('path') as typeof import('path')).join(__dirname, '..', '..', 'web', 'src', 'components', 'cases', 'CaseDetail.tsx'), 'utf8');
check('หน้าตรวจบอกเหตุผลเมื่อระบบตั้งใจไม่เติมค่ารูป', /photoFee\.count === 0 && photoFee\.manual/.test(web));

console.log(`\n${failed === 0 ? '✅ ผ่านทั้งหมด' : `❌ ล้มเหลว ${failed} รายการ`}`);
process.exit(failed === 0 ? 0 : 1);
