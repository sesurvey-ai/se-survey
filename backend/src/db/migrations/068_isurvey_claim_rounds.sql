-- 068: จำ "ครั้งที่" ของแต่ละเคลมจาก ISURVEY (user สั่ง 25/09/69)
-- หน้า "รอตรวจ ISURVEY" ต้องถาม ISURVEY ทีละเคลม (1 คำขอ/เคลม) ถึงจะรู้ครั้งที่ → เคยถามแล้วจำไว้ที่นี่
-- โหลดรายการครั้งถัดไปจะใส่ครั้งที่ให้พร้อมตาราง · เคลมที่มีเลขเซอร์เวย์ใหม่ที่ไม่อยู่ในรายการที่จำไว้ = ถามใหม่
-- rounds = คำตอบของตัวดึงงาน (se-autokey pull_core.claim_rounds): [{survey_no, round, status_name}]
-- additive อย่างเดียว · รันมือบน production (ไม่มีตัวรันอัตโนมัติ)
CREATE TABLE IF NOT EXISTS isurvey_claim_rounds (
  claim_no    TEXT PRIMARY KEY,
  rounds      JSONB NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
