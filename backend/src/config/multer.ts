import multer from 'multer';
import path from 'path';
import { randomUUID } from 'crypto';
import { env } from './env';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.resolve(env.UPLOAD_DIR));
  },
  filename: (_req, file, cb) => {
    // ชื่อไฟล์ที่เซฟต้องไม่ซ้ำ — กันไฟล์ทับกันข้ามเคสเมื่อ client ส่งชื่อคงที่
    // (เช่น 'arrival.jpg' จากมือถือ, 'capture.png' จากเว็บ) ที่อัปโหลดพร้อมกัน
    // ปลายทาง (โฟลเดอร์เคส) ยังตั้งชื่อจาก file.originalname ตามเดิม — ไม่กระทบ logic
    const ext = (path.extname(file.originalname || '').toLowerCase() || '.jpg').replace(/[^.a-z0-9]/g, '');
    cb(null, `up_${Date.now()}_${randomUUID().slice(0, 8)}${ext || '.jpg'}`);
  },
});

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP images are allowed'));
  }
};

export const upload = multer({
  storage,
  limits: { fileSize: env.MAX_FILE_SIZE },
  fileFilter,
});

// ชื่อไฟล์ไม่ซ้ำ (ใช้กับรูปลงเวลาเข้างาน ฯลฯ ที่ผู้ใช้หลายคนถ่ายพร้อมกัน) — กันไฟล์ทับกัน
const uniqueStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, path.resolve(env.UPLOAD_DIR));
  },
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '').toLowerCase() || '.jpg').replace(/[^.a-z0-9]/g, '');
    cb(null, `att_${Date.now()}_${randomUUID().slice(0, 8)}${ext || '.jpg'}`);
  },
});

export const uploadUnique = multer({
  storage: uniqueStorage,
  limits: { fileSize: env.MAX_FILE_SIZE },
  fileFilter,
});

// ผู้ตรวจสอบเพิ่มรูปเองบนหน้าเคส — เก็บใน memory แล้ว service เขียนลงโฟลเดอร์ของเคสโดยตรง
// (ต่างจาก `upload` ด้านบนที่เขียนลง uploads/ ราก แล้วต้องย้ายทีหลัง)
export const uploadCasePhotos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_FILE_SIZE, files: 50 },
  fileFilter,
}).array('photos', 50);

// อัปโหลดไฟล์ XML (SURV_REPORT) + zip รูป ของ ISURVEY — เก็บใน memory แล้ว service จัดการต่อ
// (แยกจาก upload ด้านบนที่รับเฉพาะรูป และเขียนลงดิสก์ทันที)
export const uploadXmlZip = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },   // zip รูปทั้งเคสอาจใหญ่หลายสิบ MB
  fileFilter: (_req, file, cb) => {
    const ok = /\.(xml|txt|zip)$/i.test(file.originalname || '');
    if (ok) { cb(null, true); return; }
    cb(new Error('รับเฉพาะไฟล์ .xml/.txt (รายงาน) และ .zip (รูป)'));
  },
}).fields([{ name: 'xml', maxCount: 1 }, { name: 'zip', maxCount: 1 }]);

// zip รูปอย่างเดียว — se-autokey ส่งรูปที่ดึงจาก ISURVEY ตามหลังการสร้างเคส
// (แยก request จากตัวสร้างเคสโดยตั้งใจ: เคสสร้างสำเร็จแล้วรูปพลาด ยังตามอัปซ้ำได้
//  ไม่ต้องสร้างเคสใหม่ทั้งใบ — และรูปทั้งเคสหลายสิบ MB ไม่ควรถ่วง request ที่สร้างเคส)
export const uploadZipOnly = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.zip$/i.test(file.originalname || '')) { cb(null, true); return; }
    cb(new Error('รับเฉพาะไฟล์ .zip (รูป)'));
  },
}).single('zip');
