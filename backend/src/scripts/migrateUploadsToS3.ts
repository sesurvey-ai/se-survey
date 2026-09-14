/**
 * ย้ายไฟล์ที่ค้างบนดิสก์ (UPLOAD_DIR) ขึ้น object storage — รันจากในคอนเทนเนอร์ backend (14/09/69)
 *
 *   node dist/scripts/migrateUploadsToS3.js            คัดลอกขึ้น S3 (ดิสก์ยังอยู่)
 *   node dist/scripts/migrateUploadsToS3.js --dry-run  นับอย่างเดียว ไม่อัปโหลด
 *   node dist/scripts/migrateUploadsToS3.js --move     คัดลอกแล้วลบบนดิสก์ เฉพาะไฟล์ที่ยืนยันบน S3 แล้ว
 *   --concurrency=N (ค่าเริ่มต้น 6)
 *
 * ต้องมี env S3_* ครบ (โหมด s3) · ทำซ้ำได้ ไฟล์ที่มีอยู่แล้วขนาดเท่ากันจะข้าม
 * ทางเลือกที่ไม่ต้องเปิดเทอร์มินัล: ตั้ง env S3_MIGRATE_LOCAL=copy|move แล้ว redeploy (utils/uploadMigrator)
 */
import { migrateLocalToS3 } from '../utils/uploadMigrator';
import { storage } from '../config/storage';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const move = args.includes('--move');
  const dryRun = args.includes('--dry-run');
  const conc = Number((args.find((a) => a.startsWith('--concurrency=')) ?? '').split('=')[1] || 6);
  console.log(`[storage] ${storage.describe()}`);
  if (storage.driver !== 's3') {
    console.error('ไม่ได้อยู่โหมด s3 — ตั้ง S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY ก่อน');
    process.exit(2);
  }
  const stats = await migrateLocalToS3({ move, dryRun, concurrency: conc });
  process.exit(stats.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
