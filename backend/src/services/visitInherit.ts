/**
 * เคลมเดียวหลายครั้ง (งานติดตาม / เจรจาสินไหม / งานครั้งถัดไป) — "รายงานที่มีผล" แบบ EMCS
 *
 * user เคาะ 15/09/69 (เคลม 2026013057520 ครั้งที่ 1–4): รายการงานแยกใบตามเลขเซอร์เวย์แบบ ISURVEY (1 ครั้ง = 1 เคส
 * อนุมัติ/ปิด ISURVEY/ส่ง se-billing/เข้า EMCS ทีละใบ) แต่**ข้อมูลหลักของเคลมมีชุดเดียวที่ครั้งที่ 1** เหมือน EMCS
 * (งานต่อเนื่องบน EMCS กรอกแค่หน้าค่าใช้จ่าย + รูป ข้อมูลหลักใช้ของครั้งที่ 1 เสมอ)
 *
 * ครั้งที่ 2+ จึงไม่เก็บสำเนาข้อมูลหลัก (เคยก๊อปตอนดึงงานเมื่อเช้า 15/09 — แก้ครั้งที่ 1 ทีหลังแล้วครั้งอื่นไม่ตาม
 * และผู้ตรวจอาจแก้ข้อมูลหลักบนใบครั้งที่ 4 ทั้งที่ EMCS ไม่รับ) → ประกอบตอนอ่าน: ข้อมูลหลักจากครั้งที่ 1 สด + ของครั้งนั้น
 * ใช้ชุดเดียวกันทั้งหน้าเคส (/detail) · บอท (/integrations/cases/:id/report) · XML export
 * ใช้กับทุกต้นทาง (ดึงจาก ISURVEY และงานครั้งถัดไปที่เปิดจากเว็บเอง)
 */

/** ของประจำครั้ง — เป็นของครั้งนั้น ๆ (แก้ได้บนใบนั้น) · ที่เหลือทั้งหมด = ข้อมูลหลักของเคลม อ่านจากครั้งที่ 1 */
export const VISIT_OWN_FIELDS: ReadonlySet<string> = new Set([
  // ระบบ / ตัวชี้ของใบนี้ (rev ใช้กันบันทึกทับของใบนี้เอง)
  'id', 'case_id', 'created_at', 'updated_at', 'updated_by', 'rev',
  // ตัวตนของครั้งนี้ — เลขเซอร์เวย์ห้ามซ้ำ · ประเภทเคลมเป็นของครั้งนั้น (ติดตาม/เจรจา ≠ เคลมสดของครั้งที่ 1)
  'survey_job_no', 'survey_job_no_2', 'claim_type',
  // สิ่งที่ครั้งนี้ทำ — ผลการดำเนินงาน/ความเห็น/รายการตรวจสอบ/หมายเหตุต้นทาง
  'survey_result', 'review_comment', 'surveyor_comment', 'notes', 'source_remark', 'checklist',
  // เวลา/สถานที่ออกตรวจของครั้งนี้ (จ่ายงาน→ถึง→เสร็จ เป็นรายครั้ง · ที่เกิดเหตุ acc_* เป็นของเคลม)
  'acc_insurance_notify_date', 'acc_insurance_notify_time', 'acc_survey_arrive_date', 'acc_survey_complete_date',
  'survey_place', 'survey_province', 'survey_district', 'survey_subdistrict',
  // ช่างที่ออกครั้งนี้
  'acc_surveyor', 'acc_surveyor_branch', 'acc_surveyor_phone', 'surveyor_name', 'surveyor_phone',
]);

/**
 * ชิ้นส่วนบนฟอร์มหน้าเคสที่ไม่ใช่ชื่อคอลัมน์แต่ประกอบเป็นช่องหลัก (updateReport รวมเป็น "วันที่|ชม:นาที")
 * — หน้าเว็บต้องล็อกด้วยเมื่อข้อมูลหลักมาจากครั้งที่ 1 · ชิ้นส่วนของช่องประจำครั้ง (arrive/complete/notify/submitted) ไม่อยู่ในนี้
 */
export const MAIN_FORM_PARTS: readonly string[] = [
  'acc_time_hour', 'acc_time_minute',
  'acc_customer_report_date_val', 'acc_customer_report_hour', 'acc_customer_report_minute',
  'acc_police_hour', 'acc_police_minute',
  'acc_followup_hour', 'acc_followup_minute',
];

/** ช่องที่หน้าเว็บต้องล็อกบนใบครั้งที่ 2+ = คอลัมน์จริงที่ไม่ใช่ของประจำครั้ง + ชิ้นส่วนบนฟอร์มของช่องหลัก */
export function mainLockedFields(columns: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const c of columns) if (!VISIT_OWN_FIELDS.has(c)) out.add(c);
  for (const p of MAIN_FORM_PARTS) out.add(p);
  return [...out];
}

/**
 * รายงานที่มีผลของใบครั้งที่ 2+: เริ่มจากรายงานของใบนั้น แล้วทับทุกช่องที่ไม่ใช่ของประจำครั้งด้วยค่าของครั้งที่ 1 (สด)
 * ไม่แก้ object ที่รับมา · ช่องที่ครั้งที่ 1 ไม่มีคีย์ (ไม่น่าเกิด — ตารางเดียวกัน) คงของใบนั้นไว้
 */
export function effectiveReport(
  own: Record<string, unknown>,
  first: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...own };
  for (const [k, v] of Object.entries(first)) if (!VISIT_OWN_FIELDS.has(k)) out[k] = v;
  return out;
}
