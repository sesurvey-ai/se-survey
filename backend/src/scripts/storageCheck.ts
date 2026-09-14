/**
 * ตรวจว่าที่เก็บไฟล์ใช้ได้จริง — เขียน/อ่าน/ลิสต์/ลบ ไฟล์ทดสอบ 1 ไฟล์ แล้วรายงาน (14/09/69)
 *   node dist/scripts/storageCheck.js        (ในคอนเทนเนอร์)   ·   npx ts-node --transpile-only src/scripts/storageCheck.ts (เครื่องพัฒนา)
 * ใช้หลังตั้ง env S3_* ครั้งแรก — ถ้าคีย์/endpoint/bucket ผิด จะเห็นข้อความจาก S3 ตรง ๆ ที่นี่ ไม่ต้องรอผู้ใช้อัปรูปแล้วพัง
 */
import { randomUUID } from 'crypto';
import { storage } from '../config/storage';

async function main(): Promise<void> {
  console.log(`[storage] ${storage.describe()}`);
  const folder = '_probe';
  const key = `${folder}/check_${Date.now()}_${randomUUID().slice(0, 8)}.txt`;
  const body = Buffer.from(`se-survey storage check ${new Date().toISOString()}\n`, 'utf8');
  const t0 = Date.now();

  await storage.put(key, body, 'text/plain; charset=utf-8');
  console.log(`✓ put     ${key} (${body.length} bytes)`);

  const head = await storage.head(key);
  if (!head || head.size !== body.length) throw new Error(`head ไม่ตรง: ${JSON.stringify(head)}`);
  console.log(`✓ head    size=${head.size}${head.etag ? ` etag=${head.etag}` : ''}`);

  const back = await storage.getBuffer(key);
  if (!back || !back.equals(body)) throw new Error('อ่านกลับแล้วเนื้อหาไม่ตรง');
  console.log('✓ get     เนื้อหาตรงกัน');

  const names = await storage.list(folder);
  if (!names.includes(key.split('/')[1])) throw new Error(`list ไม่เห็นไฟล์: ${names.join(', ')}`);
  console.log(`✓ list    ${folder}/ มี ${names.length} ไฟล์`);

  await storage.del(key);
  if (await storage.exists(key)) throw new Error('ลบแล้วยังอยู่');
  console.log('✓ delete  ลบแล้วไม่เหลือ');

  console.log(`ผ่านทั้งหมด (${Date.now() - t0} ms)`);
}

main().catch((e) => {
  console.error('✗ ตรวจที่เก็บไฟล์ไม่ผ่าน:', e instanceof Error ? e.message : e);
  process.exit(1);
});
