/**
 * Contract test — บีบอัด gzip คำตอบของ API (03/10/69)
 *
 * ที่มา: หน้า "รายการงาน" ของหัวหน้าโหลดช้า/ขึ้น "ไม่สามารถโหลดรายการงานได้" — เซิร์ฟเวอร์ตอบใน ~100 ms
 * แต่ /api/cases/review ส่ง JSON ดิบ 1.6 MB (งานทั้งทีมตั้งแต่เริ่มระบบ) และโหลดซ้ำทุก 60 วิ/ทุกครั้งที่เคสเปลี่ยน
 * เน็ตช้าดาวน์โหลดเกิน 15 วิ (timeout ของหน้าเว็บ) → ตัดทิ้ง · gzip กับข้อมูลจริง 1,698 KB → 150 KB
 *
 * ล็อกไว้:
 *  1) app.ts ใช้ compression() ก่อนเส้นทาง /api และ /uploads
 *  2) ต่อ express จริง: JSON ใหญ่ + Accept-Encoding gzip → ได้ gzip และคลายแล้วตรงของเดิม · ไม่ขอ gzip → ได้ดิบ
 *  3) หน้า "รายการงาน" รอ /api/cases/review นานกว่าค่าปกติ (45 วิ)
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import zlib from 'zlib';
import type { AddressInfo } from 'net';
import express from 'express';
import compression from 'compression';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}

function get(port: number, headers: Record<string, string>): Promise<{ enc: string | undefined; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http.get({ port, path: '/api/big', headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ enc: res.headers['content-encoding'] as string | undefined, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function main() {
  // ── 1) ต่อสาย ──
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.ts'), 'utf8');
  const at = (s: string) => appSrc.indexOf(s);
  check('app.ts ใช้ compression()', /import compression from 'compression'/.test(appSrc) && at('app.use(compression())') > 0);
  check('บีบก่อนเส้นทาง /uploads และ /api',
    at('app.use(compression())') < at("'/uploads',") && at('app.use(compression())') < at("app.use('/api', routes)"));

  // ── 2) express จริง ──
  const data = { success: true, data: Array.from({ length: 800 }, (_, i) => ({ id: i, claim_no: `2026013${String(i).padStart(6, '0')}`, status: 'reviewed', note: 'ข้อความภาษาไทยซ้ำ ๆ '.repeat(3) })) };
  const app = express();
  app.use(compression());
  app.get('/api/big', (_req, res) => { res.json(data); });
  const server = await new Promise<http.Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const port = (server.address() as AddressInfo).port;
  try {
    const gz = await get(port, { 'Accept-Encoding': 'gzip' });
    const raw = await get(port, {});
    const unzipped = gz.enc === 'gzip' ? zlib.gunzipSync(gz.body).toString('utf8') : '';
    check('ขอ gzip → ได้ gzip', gz.enc === 'gzip', String(gz.enc));
    check('คลายแล้วได้ JSON เดิมครบ', unzipped === JSON.stringify(data));
    check('ขนาดเล็กลงมาก', gz.body.length * 5 < raw.body.length, `${(raw.body.length / 1024).toFixed(0)} KB → ${(gz.body.length / 1024).toFixed(0)} KB`);
    check('ไม่ขอ gzip → ได้ดิบ (ไคลเอนต์เก่าไม่พัง)', raw.enc === undefined && raw.body.toString('utf8') === JSON.stringify(data));
  } finally {
    server.close();
  }

  // ── 3) หน้ารายการงาน ──
  const page = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'src', 'app', 'inspector', 'page.tsx'), 'utf8');
  check('หน้ารายการงานรอนานกว่าค่าปกติ', /api\.get\('\/api\/cases\/review', \{ timeout: 45_000 \}\)/.test(page));

  if (failed) {
    console.error(`\n${failed} ข้อไม่ผ่าน`);
    process.exit(1);
  }
  console.log('\nบีบอัดคำตอบ API: ผ่านทุกข้อ');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
