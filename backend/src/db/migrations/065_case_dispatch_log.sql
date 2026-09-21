-- 065: ประวัติการจ่ายงาน — ใครมอบหมาย / ดึงงานกลับ / ช่างปฏิเสธ เมื่อไร (user สั่ง 22/09/69 ต่อจากปุ่ม "ดึงงานกลับ")
--
-- เดิม cases เก็บได้แค่ "ครั้งล่าสุด" ของการปฏิเสธ (declined_by/declined_reason/declined_at) ส่วนการดึงงานกลับไม่มีที่เก็บเลย
-- → ตารางเหตุการณ์ 1 แถว/ครั้ง ไม่ทับกัน อ่านย้อนหลังได้ทั้งสาย (จ่ายให้ A → ดึงกลับโดย B → จ่ายให้ C → C ปฏิเสธ)
--   หน้ารายการคอลเซ็นเตอร์ใช้เหตุการณ์ล่าสุดโชว์ "ดึงกลับจากใคร โดยใคร" ก่อนจ่ายซ้ำ · หน้าจ่ายงานโชว์ทั้งสาย
-- ⛔ FK ต้องชี้ cases_all — `cases` เป็น VIEW ตั้งแต่ 062 (FK ไป VIEW ไม่ได้) · ลบถาวรแล้วประวัติหายตาม (CASCADE) · ถังขยะยังอยู่
-- ⛔ เหตุการณ์ก่อนวันที่รัน migration นี้ไม่มีย้อนหลัง (เก็บได้เฉพาะที่เกิดหลังจากนี้)
-- รันด้วยมือบน production **ก่อน** deploy backend — โค้ดเขียนลงตารางนี้ทันทีที่จ่าย/ดึงกลับ/ปฏิเสธ (เขียนไม่ได้แค่ log ไม่ล้ม แต่ประวัติจะหาย)
CREATE TABLE IF NOT EXISTS case_dispatch_log (
  id          SERIAL PRIMARY KEY,
  case_id     INTEGER NOT NULL REFERENCES cases_all(id) ON DELETE CASCADE,
  action      VARCHAR(20) NOT NULL CHECK (action IN ('assigned', 'recalled', 'declined')),
  surveyor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- ช่างที่เกี่ยว: ถูกจ่ายให้ / ถูกดึงงานคืน / คนที่ปฏิเสธ
  by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- คนกด: คอลเซ็นเตอร์/แอดมิน (ปฏิเสธ = ตัวช่างเอง)
  reason      VARCHAR(200),                                       -- เหตุผลปฏิเสธ (ถ้ามี) — ดึงกลับ/จ่ายไม่มีเหตุผล
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_case_dispatch_log_case ON case_dispatch_log (case_id, created_at DESC, id DESC);
COMMENT ON TABLE case_dispatch_log IS 'ประวัติการจ่ายงาน 1 แถว/เหตุการณ์ (assigned/recalled/declined) — ดู services/dispatchLog.service.ts (migration 065)';
COMMENT ON COLUMN case_dispatch_log.surveyor_id IS 'ช่างที่เกี่ยวกับเหตุการณ์ — assigned: คนที่ได้งาน · recalled: คนที่ถูกดึงงานคืน · declined: คนที่ปฏิเสธ';
COMMENT ON COLUMN case_dispatch_log.by_user_id  IS 'คนที่ทำ — assigned/recalled: คอลเซ็นเตอร์หรือแอดมิน · declined: ตัวช่างเอง';
