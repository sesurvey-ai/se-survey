-- 067: สถานะ "ยกเลิก" ของเคส (user สั่ง 22/09/69) — เช่น ลูกค้าไม่ติดใจ เลยไม่เคลม / ISURVEY ยกเลิกเคลม / แจ้งซ้ำ
--
-- เดิมมีแค่ อนุมัติ/ตีกลับ งานที่ไม่ได้เคลมต้องค้างเป็น "รอตรวจ" หรือถูกลบทิ้ง → เพิ่ม status = 'cancelled' พร้อมเหตุผล/คนยกเลิก/เวลา
-- และจำสถานะก่อนยกเลิกไว้ให้แอดมิน "เลิกยกเลิก" คืนได้ · ยกเลิกแล้ว = อ่านอย่างเดียว ไม่เข้าคิวตรวจ/EMCS/se-billing ไม่โผล่บนแอปช่าง
-- ⛔ cases เป็น VIEW ตั้งแต่ 062 — ALTER ที่ cases_all แล้ว CREATE OR REPLACE VIEW ซ้ำ ไม่งั้นคอลัมน์ใหม่มองไม่เห็นผ่าน cases
-- รันด้วยมือบน production **ก่อน** deploy backend (เพิ่มคอลัมน์อย่างเดียว ไม่แตะข้อมูลเดิม)
-- ⛔ status เป็น ENUM case_status — ต้องเพิ่มค่าก่อน (ADD VALUE ห้ามอยู่ใน transaction เดียวกับที่ใช้ค่าใหม่ · รันบรรทัดนี้แยก autocommit)
--    เจอจริงตอน deploy 22/09/69: ลืมบรรทัดนี้ → ยกเลิกงานได้ 500 "invalid input value for enum case_status"
ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'cancelled';
ALTER TABLE cases_all ADD COLUMN IF NOT EXISTS cancelled_at         TIMESTAMP;
ALTER TABLE cases_all ADD COLUMN IF NOT EXISTS cancelled_by         INTEGER;
ALTER TABLE cases_all ADD COLUMN IF NOT EXISTS cancel_reason        TEXT;
ALTER TABLE cases_all ADD COLUMN IF NOT EXISTS status_before_cancel VARCHAR(20);
CREATE OR REPLACE VIEW cases AS SELECT * FROM cases_all WHERE deleted_at IS NULL;
