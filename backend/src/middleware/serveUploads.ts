import { Request, Response, NextFunction } from 'express';
import { storage, normalizeKey, HeadResult } from '../config/storage';

/**
 * เสิร์ฟ /uploads จาก object storage (โหมด s3) — วางหลัง uploadsAuth และ **ก่อน** express.static (14/09/69)
 *
 * ไม่เจอบน S3 → next() ให้ express.static ลองดิสก์ (ไฟล์เก่าที่ยังไม่ย้าย) · โหมด local = ผ่านเฉย ๆ
 * ส่ง ETag ของ S3 กลับ และรับ If-None-Match → 304 (เบราว์เซอร์ไม่ต้องโหลดรูปซ้ำ)
 * header ชุดเดียวกับ express.static เดิม: private cache 5 นาที · nosniff · no-referrer (รูปเป็น PII)
 */
export async function serveUploads(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (storage.driver !== 's3') { next(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }

  const key = normalizeKey(req.path);
  // dotfile ทุกชั้น = ไม่เสิร์ฟ (เหมือน dotfiles:'deny' ของ express.static)
  if (!key || key.split('/').some((seg) => seg.startsWith('.'))) {
    res.status(404).json({ success: false, message: 'Not found' });
    return;
  }

  const setHeaders = (h: HeadResult) => {
    res.set('Content-Type', h.contentType || 'application/octet-stream');
    if (typeof h.size === 'number') res.set('Content-Length', String(h.size));
    if (h.etag) res.set('ETag', h.etag);
    if (h.lastModified) res.set('Last-Modified', h.lastModified.toUTCString());
    res.set('Cache-Control', 'private, max-age=300');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');
  };

  try {
    if (req.method === 'HEAD') {
      const h = await storage.head(key, { s3Only: true });
      if (!h) { next(); return; }
      setHeaders(h);
      res.status(200).end();
      return;
    }

    const inm = req.headers['if-none-match'];
    const r = await storage.get(key, { ifNoneMatch: typeof inm === 'string' ? inm : undefined, s3Only: true });
    if (!r) { next(); return; }
    if (r.kind === 'not-modified') {
      res.set('Cache-Control', 'private, max-age=300');
      res.status(304).end();
      return;
    }
    setHeaders(r);
    res.status(200);
    // client ตัดสาย → ปิด stream จาก S3 ด้วย ไม่งั้นค้าง
    res.on('close', () => { try { r.body.destroy(); } catch { /* skip */ } });
    r.body.on('error', (err: Error) => {
      if (!res.headersSent) next(err); else res.destroy(err);
    });
    r.body.pipe(res);
  } catch (err) {
    next(err);
  }
}
