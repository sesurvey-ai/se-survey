import http from 'http';
import app from './app';
import { env } from './config/env';
import { initFirebase } from './config/firebase';
import { setupSocket } from './socket';
import { startUploadSweeper } from './utils/uploadSweeper';
import { startTrashPurge } from './utils/trashPurge';
import { startPhotoRetention } from './utils/photoRetention';
import { startUploadMigrator } from './utils/uploadMigrator';
import { storage } from './config/storage';

const server = http.createServer(app);

// ที่เก็บไฟล์อัปโหลด — บอกให้ชัดตั้งแต่บูตว่าใช้ดิสก์หรือ object storage (14/09/69)
console.log(`[storage] ${storage.describe()}`);

// Firebase — ไม่มี credential ก็ยัง boot ได้ (พฤติกรรมเดิม) แต่ log ดังแล้ว
// ตั้ง FCM_REQUIRED=1 เมื่ออยากให้ "ไม่มี push = ไม่ต้องขึ้นเลย" (ต้องตั้งใจเปิดเอง)
if (!initFirebase() && process.env.FCM_REQUIRED === '1') {
  console.error('[FCM] FCM_REQUIRED=1 แต่ Firebase ไม่พร้อม — ปิดตัวเอง');
  process.exit(1);
}

// Initialize Socket.io
setupSocket(server);

// กวาดไฟล์ OCR temp ที่ค้าง (orphan) ใน uploads root เป็นระยะ
startUploadSweeper();
// ลบจริงเคสในถังขยะที่พักครบ 30 วัน (migration 062, 14/09/69)
startTrashPurge();
// รูปลงเวลาแสดงวันต่อวัน + เก็บรูปล่าสุดคนละ 1 รูปให้บอร์ด (user เคาะ 25/09/69) — รายงานอย่างเดียวจนกว่าจะตั้ง PHOTO_RETENTION_ENABLED=1
startPhotoRetention();
// ย้ายไฟล์ที่ค้างบนดิสก์ขึ้น S3 (เฉพาะเมื่อตั้ง S3_MIGRATE_LOCAL — ครั้งเดียวตอนเปิดโหมด s3)
startUploadMigrator();

server.listen(env.PORT, () => {
  console.log(`Server running on port ${env.PORT} (${env.NODE_ENV})`);
});

export { server };
