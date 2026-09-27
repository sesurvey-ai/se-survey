/**
 * Contract test — log คำขอของ backend ต้องไม่มีรหัสล็อกอิน (27/09/69)
 *
 * เว็บเปิดรูปด้วย /uploads/…?token=<JWT> (แนบ header ไม่ได้) — morgan('dev') เดิมจด URL ทั้งเส้นลง log ของ container
 * ใครเปิด log ใน Dokploy ได้ก็คัด JWT ไปใช้แทนเจ้าของได้จนหมดอายุ
 *
 * ล็อกกติกา:
 *  1) redactUrl ปิดเฉพาะค่าของพารามิเตอร์ลับ (token/access_token/…) · ชื่อพารามิเตอร์และพารามิเตอร์อื่นคงเดิม
 *  2) ต่อ express จริง: บรรทัด log ของ /uploads/…?token=… เป็น token=*** ไม่มีค่ารหัสเลย · หน้าตา dev เดิม (สถานะ + เวลา)
 *  3) app.ts ใช้ requestLogger ไม่ใช่ morgan ตรง ๆ
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import type { AddressInfo } from 'net';
import express from 'express';
import { createRequestLogger, redactUrl } from '../src/middleware/requestLogger';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}

async function main() {
  // ── 1) ตัวปิดรหัส ──
  check('ค่าของ token ถูกปิด ชื่อพารามิเตอร์คงไว้',
    redactUrl('/uploads/case_1/a.jpg?token=eyJ.abc.def') === '/uploads/case_1/a.jpg?token=***');
  check('token อยู่กลาง query — พารามิเตอร์อื่นไม่ถูกแตะ',
    redactUrl('/x?a=1&token=abc&b=2') === '/x?a=1&token=***&b=2');
  check('ตัวพิมพ์ใหญ่ + access_token ก็ปิด',
    redactUrl('/x?TOKEN=abc&access_token=def') === '/x?TOKEN=***&access_token=***');
  check('ชื่อที่แค่ลงท้ายด้วย token (mytoken) ไม่ถูกแตะ', redactUrl('/x?mytoken=abc') === '/x?mytoken=abc');
  check('URL ไม่มี query ไม่เปลี่ยน', redactUrl('/api/cases/12') === '/api/cases/12');

  // ── 2) ต่อ express จริง (mount /uploads แบบ app.ts — req.url ถูกตัด mount ต้องยังจด URL เต็ม) ──
  const lines: string[] = [];
  const app = express();
  app.use(createRequestLogger({ write: (s: string) => { lines.push(s); } }));
  app.use('/uploads', (_req, res) => { res.status(401).json({ success: false }); });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  const SECRET = 'eyJhbGciOiJIUzI1NiJ9.contract-test.not-a-real-token';
  await new Promise<void>((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/uploads/att_1_x.jpg?token=${SECRET}&v=2`, (res) => {
      res.resume();
      res.on('end', () => resolve());
    }).on('error', reject);
  });
  // morgan เขียนตอนคำตอบจบ (on-finished) — รอให้ถึงคิวก่อนอ่าน
  for (let i = 0; i < 50 && lines.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  server.close();
  const line = (lines[0] || '').replace(/\x1b\[[0-9;]*m/g, '').trim();
  check('บรรทัด log มี URL เต็มพร้อม token=***', line.includes('GET /uploads/att_1_x.jpg?token=***&v=2'), line);
  check('ค่ารหัสไม่อยู่ในบรรทัด log เลย', lines.length === 1 && !lines[0].includes('contract-test'));
  check('หน้าตา dev เดิม: สถานะ + เวลา ms', / 401 [\d.]+ ms/.test(line), line);

  // ── 3) app.ts ต่อสายจริง ──
  const appSrc = fs.readFileSync(path.join(__dirname, '../src/app.ts'), 'utf8');
  check('app.ts ใช้ requestLogger (ไม่ใช่ morgan ตรง ๆ ที่จด URL เต็ม)',
    /app\.use\(requestLogger\)/.test(appSrc) && !/from ['"]morgan['"]/.test(appSrc));
}

main().then(() => {
  console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
  process.exit(failed ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
