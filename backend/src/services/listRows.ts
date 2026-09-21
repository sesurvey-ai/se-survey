/**
 * ตัดคอลัมน์หนักออกจาก "แถวเคส" ก่อนส่งให้หน้ารายการ (เว็บ/แอป) — user สั่ง 22/09/69
 *
 * ⛔ คิวรีรายการใช้ `SELECT c.*` จึงลาก isurvey_close_payload (JSON ที่เขียนกลับ ISURVEY ตอนอนุมัติ ~2.7 KB/เคส)
 *    ติดไปทุกแถว — รายการงานหัวหน้า 309 เคส = 1.4 MB ต่อการเปิดหน้า 1 ครั้ง (payload อย่างเดียว 650 KB)
 *    ไม่มีหน้าไหนอ่านคอลัมน์นี้ (เก็บไว้ดูย้อนหลังในฐานข้อมูลเท่านั้น) และมันโตขึ้นทุกครั้งที่อนุมัติงาน ISURVEY
 * ใช้กับ "รายการ" เท่านั้น — หน้าเคสเดี่ยว (getById/getDetail/admin getCaseById) ไม่ต้องตัด
 * เพิ่มคอลัมน์หนักตัวใหม่ = เพิ่มที่นี่ที่เดียว
 */
export const HEAVY_CASE_COLUMNS = ['isurvey_close_payload'] as const;

export function omitHeavy<T extends object>(rows: T[]): T[] {
  for (const row of rows) {
    for (const col of HEAVY_CASE_COLUMNS) delete (row as Record<string, unknown>)[col];
  }
  return rows;
}
