# กติกาการทำงานกับโปรเจกต์นี้

## อัปเดต CHANGELOG ทุกครั้ง

**ทุกครั้งที่แก้ไขอะไรในโปรเจกต์ ต้องเขียนเพิ่มใน [CHANGELOG.md](CHANGELOG.md)**

ลำดับ: แก้โค้ด → เทสให้ผ่าน → **เขียน CHANGELOG** → commit (โค้ด + CHANGELOG อยู่ใน commit เดียวกัน)

วิธีเขียน:
- เข้าใต้หัวข้อ **เดือนปัจจุบัน** (พ.ศ.) ถ้ายังไม่มีหัวข้อเดือนนั้น สร้างใหม่ไว้บนสุด
- แยก "เพิ่ม/ปรับ" กับ "แก้บั๊ก" — งานมือถือให้ระบุเวอร์ชัน APK ด้วย
- เขียนเป็น**ผลลัพธ์ที่ผู้ใช้เห็น** ไม่ใช่ชื่อไฟล์/ฟังก์ชัน
  เช่น "แบนเนอร์เคลมคู่ขึ้นมั่ว — เลขเคลมสั้นไปจับคู่กับเลขบัตรประชาชนของเคสอื่น"
  ไม่ใช่ "แก้ regex ใน case.service.ts"
- ของเดิมไล่จากใหม่→เก่า อ่านหัวไฟล์ก่อนเขียนให้รูปแบบตรงกัน

## กับดักที่เจอบ่อย

- **migration ต้องรันด้วยมือบน production** — เขียนไฟล์ไว้ใน `backend/src/db/migrations/` แล้วรันเอง ไม่มีตัวรันอัตโนมัติ
- **`DATABASE_URL` ในเครื่องพัฒนาชี้ฐานข้อมูลเดียวกับ production** — เคสทดสอบที่สร้างจะไปโผล่ของจริง ลบให้เรียบร้อยทุกครั้ง
- **push ขึ้น `main` = deploy อัตโนมัติ** ผ่าน Dokploy (backend กับ web เป็นคนละ service ใช้เวลาไม่เท่ากัน)
- **แอปมือถือไม่ได้อัปเดตตาม push** — ต้อง `flutter build apk --release` แล้วติดตั้งทับทุกเครื่อง
- **EMCS เป็นระบบของบริษัทประกัน** ห้ามแตะโดยไม่ได้รับอนุญาตชัดเจน — บอท `se-autokey` default เป็น dry-run เสมอ
- **`cases` เป็น VIEW ตั้งแต่ migration 062 — ตารางจริงคือ `cases_all`** (ลบแบบพักไว้: VIEW ซ่อนแถวที่ `deleted_at` ไม่ว่าง)
  เพิ่ม/แก้คอลัมน์ต้อง `ALTER TABLE cases_all ...` แล้ว `CREATE OR REPLACE VIEW cases AS SELECT * FROM cases_all WHERE deleted_at IS NULL;` ซ้ำทุกครั้ง
  ไม่งั้นคอลัมน์ใหม่มองไม่เห็นผ่าน `cases` · อ่าน/กู้เคสในถังขยะต้องอ่านจาก `cases_all` · `INSERT INTO cases` ห้ามใช้ `ON CONFLICT` (VIEW ไม่รองรับ)
- **ไฟล์รูปต้องผ่าน `backend/src/config/storage.ts` เท่านั้น** (ตั้งแต่ 14/09/69) — prod อาจเก็บบน object storage (S3/R2) ไม่ใช่ดิสก์ `UPLOAD_DIR`
  ห้าม `fs.writeFile/unlink/readdir` กับรูปเคส/รูปลงเวลา/ภาพคิว EMCS เอง (ยกเว้นไฟล์ชั่วคราวของ multer ที่รากดิสก์ `up_*`/`att_*` ซึ่งต้อง `storage.putFromFile()` เข้าที่)
  key = path สัมพัทธ์ใต้ uploads ใช้ `/` (ตรงกับ `file_path` ใน DB) · โหมด s3 ไม่มี "โฟลเดอร์" จริง ใช้ `storage.list/folderExists` แทน `readdirSync/existsSync` · เทส `backend/tests/storage.contract.test.ts` จับอยู่
