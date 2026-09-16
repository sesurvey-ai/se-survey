-- 064: ที่อยู่ปัจจุบันผู้ขับขี่รถประกัน — เพิ่ม "หมู่" และ "ตำบล" แยกช่อง (user สั่ง 16/09/69)
--
-- เดิมมีแค่ driver_address (ข้อความ) + driver_province + driver_district → หมู่/ตำบลไม่มีที่เก็บ
-- EMCS/XML มีช่องที่อยู่เป็นข้อความเดียว (+ dropdown จังหวัด/อำเภอ) → ตอนออก EMCS ระบบประกอบเป็น
--   "46/23 ม.7 ต.ท้ายบ้าน" (services/driverAddress.ts) · จังหวัด/อำเภอยังไปช่อง dropdown เหมือนเดิม
-- ตัวดึงงาน ISURVEY แมป drv_tumbonID → driver_subdistrict · หมู่จาก ISURVEY ปนอยู่ในบ้านเลขที่อยู่แล้ว (ไม่แยก)
--
-- survey_reports เป็นตารางจริง (ไม่ใช่ VIEW) → ALTER ตรงได้ · รันด้วยมือบน production ก่อน deploy backend
ALTER TABLE survey_reports ADD COLUMN IF NOT EXISTS driver_moo         VARCHAR(20);
ALTER TABLE survey_reports ADD COLUMN IF NOT EXISTS driver_subdistrict VARCHAR(100);
COMMENT ON COLUMN survey_reports.driver_moo         IS 'หมู่ที่ ของที่อยู่ปัจจุบันผู้ขับขี่รถประกัน (พิมพ์ ไม่บังคับ) — ออก EMCS เป็น "ม.<หมู่>" ต่อท้ายที่อยู่';
COMMENT ON COLUMN survey_reports.driver_subdistrict IS 'ตำบล/แขวง ของที่อยู่ปัจจุบันผู้ขับขี่รถประกัน (ชื่อ เลือกจากรายการตามอำเภอ) — ออก EMCS เป็น "ต.<ตำบล>"';
