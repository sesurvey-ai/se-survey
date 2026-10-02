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

/**
 * timestamptz → 'DD/MM/พ.ศ. HH:MM' เวลาไทย — ใช้แสดง "ส่งงาน" / "ตรวจรายงาน" (10/09/69)
 * ส่ง expression ที่เป็น timestamptz เข้ามา (คอลัมน์ timestamp ไม่มีโซน เช่น reviews.reviewed_at เก็บเป็น UTC
 * ต้องห่อ `AT TIME ZONE 'UTC'` ก่อน) · null = ยังไม่มีเหตุการณ์นั้น
 * (ย้ายมาจาก case.service.ts 03/10/69 — รายการงานหัวหน้าแยกไปอยู่ reviewList.ts ใช้ร่วมกัน)
 */
export const thStamp = (expr: string) =>
  `CASE WHEN ${expr} IS NULL THEN NULL ELSE ` +
  `to_char((${expr}) AT TIME ZONE 'Asia/Bangkok', 'DD/MM/') || ` +
  `(EXTRACT(YEAR FROM (${expr}) AT TIME ZONE 'Asia/Bangkok')::int + 543) || ' ' || ` +
  `to_char((${expr}) AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') END`;
