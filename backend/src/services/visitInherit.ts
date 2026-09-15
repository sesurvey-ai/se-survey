/**
 * งานครั้งที่ 2+ ของเคลมเดียวกัน (งานติดตาม / เจรจาสินไหม) — สืบทอดข้อมูลหลักจากครั้งที่ 1
 *
 * ทำไมต้องมี (user สั่ง 15/09/69 เคลม 2026013057520 ครั้งที่ 1–4): ISURVEY เก็บข้อมูลหลักของเคลม
 * (ผู้ขับขี่ · ตำรวจ · รายการความเสียหาย · คู่กรณี · ประเภทรถ · พรบ. · รหัสภัย ฯลฯ) ไว้ที่ **ครั้งที่ 1 เท่านั้น**
 * ใบครั้งถัดไปบน ISURVEY โชว์ข้อมูลของครั้งที่ 1 ให้ดู แต่ตัวใบเองมีแค่ของประจำครั้ง (ผลการดำเนินงาน · รูป ·
 * เวลา/สถานที่ออกตรวจ · ช่าง) → ตัวดึงงานเอามาเฉพาะที่ใบนั้นมี หน้าตรวจจึงขึ้น "ช่องบังคับยังว่าง 20+ ช่อง"
 * และตัวตรวจก่อนนำเข้าของบอทกั้น ทั้งที่งานต่อเนื่องไม่ต้องกรอกช่องพวกนั้นเลย
 *
 * กติกา: เติม **เฉพาะช่องที่ใบนี้ว่าง** ด้วยค่าจากครั้งที่ 1 · ห้ามแตะของประจำครั้ง (VISIT_OWN_FIELDS)
 * ⛔ ไม่ใช่กติกาเดียวกับ createFollowup (งานครั้งถัดไปที่เปิดจากเว็บเอง ก๊อปแค่ตัวตนของเคลม เพราะช่างต้องไปสำรวจใหม่)
 *    — ทางนี้ใช้กับใบที่ดึงจาก ISURVEY ซึ่งงานสำรวจจบแล้วและระบบต้นทางแสดงข้อมูลครั้งที่ 1 อยู่แล้ว
 */

/** ของประจำครั้ง — เป็นของครั้งนั้น ๆ ห้ามเอาของครั้งที่ 1 มาทับ (ว่างก็ปล่อยว่าง) */
export const VISIT_OWN_FIELDS: ReadonlySet<string> = new Set([
  // ระบบ / ตัวชี้
  'id', 'case_id', 'created_at', 'updated_at', 'updated_by', 'rev',
  // ตัวตนของครั้งนี้ — เลขเซอร์เวย์ห้ามซ้ำ · ประเภทเคลมเป็นของครั้งนั้น (ติดตาม/เจรจา ≠ เคลมสดของครั้งที่ 1)
  'survey_job_no', 'survey_job_no_2', 'claim_type',
  // สิ่งที่ครั้งนี้ทำ — user ย้ำ: ผลการดำเนินงานต้องเป็นของครั้งนั้น ๆ
  'survey_result', 'review_comment', 'surveyor_comment', 'notes', 'source_remark', 'checklist',
  // เวลา/สถานที่ออกตรวจของครั้งนี้ (ไทม์ไลน์จ่ายงาน→ถึง→เสร็จ เป็นรายครั้ง · ที่เกิดเหตุ acc_* เป็นของเคลม สืบทอดได้)
  'acc_insurance_notify_date', 'acc_insurance_notify_time', 'acc_survey_arrive_date', 'acc_survey_complete_date',
  'survey_place', 'survey_province', 'survey_district', 'survey_subdistrict',
  // ช่างที่ออกครั้งนี้
  'acc_surveyor', 'acc_surveyor_branch', 'acc_surveyor_phone', 'surveyor_name', 'surveyor_phone',
]);

/** รายการ 1:N กับธง "มี/ไม่มี" ที่ต้องไปด้วยกัน — สืบทอดรายการแล้วธงต้องตาม ไม่งั้นหน้าจอบอก "ไม่มีคู่กรณี" ทั้งที่มีรายการ */
export const LIST_FLAGS: Readonly<Record<string, string>> = {
  opposing_parties: 'has_opponents',
  injured_persons: 'has_injured',
  damaged_property: 'has_property',
};

/** ว่าง = null/undefined/สตริงว่าง/'[]'/'{}'/array-object เปล่า · ⛔ 0 กับ false ไม่ใช่ว่าง (เป็นค่าจริงได้) */
export const isBlank = (v: unknown): boolean => {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') { const s = v.trim(); return s === '' || s === '[]' || s === '{}'; }
  if (Array.isArray(v)) return v.length === 0;
  if (v instanceof Date) return false;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
};

/**
 * เติมช่องว่างของ `report` (ใบครั้งที่ 2+) ด้วยค่าจาก `first` (แถว survey_reports ของครั้งที่ 1)
 * แก้ `report` ตรง ๆ · คืนชื่อช่องที่เติม (ไว้จดเตือนให้หัวหน้ารู้ว่าช่องไหนมาจากครั้งที่ 1)
 */
export function inheritFromFirstVisit(
  report: Record<string, unknown>,
  first: Record<string, unknown>,
): string[] {
  const filled: string[] = [];
  const flagNames = new Set(Object.values(LIST_FLAGS));
  for (const [k, v] of Object.entries(first)) {
    if (VISIT_OWN_FIELDS.has(k) || flagNames.has(k)) continue;   // ธงตามรายการของมัน ไม่สืบทอดเดี่ยว ๆ
    if (isBlank(v) || !isBlank(report[k])) continue;
    report[k] = v instanceof Date ? v.toISOString() : v;         // TIMESTAMP จาก pg มาเป็น Date — bind กลับเป็น ISO
    filled.push(k);
    const flag = LIST_FLAGS[k];
    if (flag && first[flag] !== null && first[flag] !== undefined) {
      report[flag] = first[flag];
      filled.push(flag);
    }
  }
  return filled;
}
