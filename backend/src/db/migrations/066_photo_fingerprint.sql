-- 066: ลายนิ้วมือรูป (sha1 ของไฟล์ต้นฉบับ) + รายการรูปที่ตั้งใจลบ — ให้ "ดึงรูปเพิ่มจาก ISURVEY" ไม่เอารูปซ้ำ (user สั่ง 22/09/69)
--
-- ปุ่มดึงรูปเพิ่ม/ดึงรูปซ้ำ เทียบเนื้อไฟล์ (sha1) กับรูปที่เคสมี · เดิมต้องโหลดรูปเดิมทุกใบจาก storage มาคำนวณทุกครั้งที่กด (30 ใบ ≈ 12 MB)
-- และพลาด 2 กรณี: รูปที่หมุนบนเว็บ (ไฟล์ถูกเขียนทับ ไบต์ไม่ตรงต้นฉบับอีก → ต้นฉบับกลับมาเป็นอีกใบ)
--              กับรูปที่ตั้งใจลบ (ไม่มีแถว = "ยังไม่มี" → กลับมาอีก)
-- → จำ sha1 ของ **ต้นฉบับ** ตอนนำเข้า/อัปโหลดไว้ในแถวรูป (หมุนแล้วก็ไม่เปลี่ยน) + จำใบที่ลบไว้เป็นแถวเล็ก ๆ (40 ไบต์/ใบ)
-- แถวเก่าที่ src_sha1 ว่าง: backend คำนวณจากไฟล์ปัจจุบันครั้งแรกที่ต้องใช้แล้วเติมให้ (lazy backfill — ใบที่เคยหมุนไปแล้วช่วยไม่ได้ ยอมรับ)
-- รันด้วยมือบน production **ก่อน** deploy backend (เพิ่มคอลัมน์/ตารางอย่างเดียว ไม่แตะข้อมูลเดิม)
ALTER TABLE survey_photos ADD COLUMN IF NOT EXISTS src_sha1 CHAR(40);
CREATE INDEX IF NOT EXISTS idx_survey_photos_report_sha1 ON survey_photos (report_id, src_sha1);

CREATE TABLE IF NOT EXISTS survey_photo_tombstones (
  id          SERIAL PRIMARY KEY,
  report_id   INTEGER NOT NULL REFERENCES survey_reports(id) ON DELETE CASCADE,
  src_sha1    CHAR(40) NOT NULL,
  file_name   VARCHAR(500),
  deleted_by  INTEGER,
  deleted_at  TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_photo_tombstones_report_sha1 ON survey_photo_tombstones (report_id, src_sha1);
