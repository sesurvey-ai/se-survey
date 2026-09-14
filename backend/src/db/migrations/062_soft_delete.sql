-- 062: ลบเคสแบบพักไว้ (soft delete) + ถังขยะ กู้คืนได้ · ลบจริงเองหลัง 30 วัน (user สั่ง 14/09/69)
--
-- ที่มา: 04/09/69 ลบเคสอนุมัติ #226 แล้วกู้ไม่ได้ (ลบจริง + ไฟล์รูปหาย ไม่มี backup)
--
-- วิธี: ตารางจริงเปลี่ยนชื่อเป็น `cases_all` แล้วสร้าง VIEW ชื่อ `cases` ที่เห็นเฉพาะแถวที่ยังไม่ถูกลบ
-- → โค้ดทุกจุดที่ SELECT/INSERT/UPDATE ตาราง cases (50+ จุด) มองไม่เห็นเคสในถังขยะโดยไม่ต้องแก้ทีละ query
--   (VIEW แบบตารางเดียว + WHERE ธรรมดา เป็น auto-updatable: INSERT/UPDATE/DELETE ... RETURNING ผ่านได้ · FK/ลำดับเลข/ดัชนี
--    ผูกกับตารางจริงอยู่แล้ว ไม่ต้องแตะ) · ถังขยะ/กู้คืน/ลบจริง อ่าน-เขียน `cases_all` ตรง ๆ
--
-- ⛔ กับดักหลังจากนี้ (ดู CLAUDE.md): เพิ่ม/แก้คอลัมน์ต้อง ALTER TABLE **cases_all** แล้ว CREATE OR REPLACE VIEW cases ซ้ำ
--    เพราะ SELECT * ของ VIEW ถูกตรึงคอลัมน์ไว้ตอนสร้าง คอลัมน์ใหม่จะมองไม่เห็นจนกว่าจะสร้าง VIEW ใหม่
--
-- รันด้วยมือบน production: psql "$DATABASE_URL" -f 062_soft_delete.sql

BEGIN;

ALTER TABLE cases ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE cases RENAME TO cases_all;

CREATE VIEW cases AS
  SELECT * FROM cases_all WHERE deleted_at IS NULL;

COMMENT ON VIEW cases IS
  'เคสที่ยังไม่ถูกลบ (deleted_at IS NULL) — ตารางจริงคือ cases_all · เพิ่มคอลัมน์ต้อง ALTER cases_all แล้ว CREATE OR REPLACE VIEW ใหม่ (migration 062)';
COMMENT ON COLUMN cases_all.deleted_at IS 'ลบแบบพักไว้ (ถังขยะ) — NULL = ปกติ · ลบจริงเองเมื่อเกิน 30 วัน (trashPurge)';

CREATE INDEX IF NOT EXISTS idx_cases_all_deleted_at
  ON cases_all (deleted_at) WHERE deleted_at IS NOT NULL;

COMMIT;
