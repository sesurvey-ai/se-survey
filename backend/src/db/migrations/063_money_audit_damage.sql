-- 063: ประวัติการแก้ "ยอดความเสียหาย" (รถประกัน + คู่กรณีรายคัน) เพิ่มเป็น kind ที่ 3 ของ money_audit
--
-- ที่มา (15/09/69 เคส #343 เคลม 2026013171521): ยอดความเสียหายคู่กรณีบนเว็บเป็น 8,000 แล้วบอทพาเข้า EMCS
-- แต่ ISURVEY มีแค่ค่าแรง 2,500 (ตรวจจาก API แล้ว ไม่มีค่าอะไหล่/อื่น ๆ) → ต้องมีคนแก้บนเว็บก่อนอนุมัติ
-- แต่ตอบไม่ได้ว่าใคร/เมื่อไหร่ เพราะประวัติเก็บเฉพาะยอดจ่ายพนักงาน/ยอดเรียกเก็บประกัน
--
-- ⚠️ รันด้วยมือบน production ตาม convention เดิม · เริ่มนับจากวันที่เปิดใช้ (ย้อนหลังไม่ได้)
BEGIN;
ALTER TABLE money_audit DROP CONSTRAINT IF EXISTS money_audit_kind_check;
ALTER TABLE money_audit ADD CONSTRAINT money_audit_kind_check CHECK (kind IN ('pay', 'expense', 'damage'));
COMMIT;
