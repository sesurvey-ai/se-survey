import morgan from 'morgan';

// log คำขอ (morgan 'dev') ที่ปิดรหัสล็อกอินใน URL — 27/09/69
// เว็บเปิดรูปเคส/รูปลงเวลาด้วย <img src="…/uploads/…?token=<JWT>"> เพราะ <img> แนบ header ไม่ได้ (web/src/lib/api.ts getPhotoUrl)
// morgan('dev') เดิมจด URL ทั้งเส้นลง log ของ container → ใครเปิด log ใน Dokploy ได้ก็คัด JWT ไปใช้แทนเจ้าของได้จนหมดอายุ (15 วัน)
// ⛔ อย่ากลับไปใช้ morgan ตรง ๆ ใน app.ts — ใช้ requestLogger จากไฟล์นี้ (การ์ด tests/requestLog.contract.test.ts)

const SECRET_QUERY = /([?&](?:token|access_token|api_key|apikey|password|secret)=)[^&#]*/gi;

/** ค่าของพารามิเตอร์ลับใน query → *** (ชื่อพารามิเตอร์คงไว้ ยังรู้ว่าคำขอแนบ token มา) */
export function redactUrl(url: string): string {
  return url.replace(SECRET_QUERY, '$1***');
}

// แทน token ':url' ของ morgan (ใช้ร่วมทั้งโปรเซส) — format 'dev' เรียก tokens.url ตอนเขียนแต่ละบรรทัด
// จึงได้ URL ที่ปิดรหัสแล้วโดยหน้าตาเดิมทุกอย่าง (method · url · สถานะมีสี · เวลา · ขนาด)
morgan.token('url', (req) => redactUrl((req as { originalUrl?: string }).originalUrl || req.url || ''));

export function createRequestLogger(stream?: morgan.StreamOptions) {
  return morgan('dev', stream ? { stream } : undefined);
}

export const requestLogger = createRequestLogger();
