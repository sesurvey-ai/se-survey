import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { uploadsAuth } from './middleware/uploadsAuth';
import { serveUploads } from './middleware/serveUploads';
import { isFirebaseReady } from './config/firebase';
import routes from './routes';

const app = express();

// อยู่หลัง Traefik (reverse proxy) — trust first hop เพื่อให้ req.ip = client จริง (ใช้กับ rate limit)
app.set('trust proxy', 1);

// Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: env.CORS_ORIGIN.split(',') }));
app.use(morgan('dev'));
app.use(express.json());

// Static files (uploaded photos) — ต้องผ่าน auth (รูปเป็น PII: บัตร ปชช./ใบขับขี่/รูปลงเวลา)
// โหมด s3 (config/storage.ts): serveUploads เสิร์ฟจาก object storage ก่อน ไม่เจอค่อยตกมา express.static
// (ไฟล์เก่าบนดิสก์ที่ยังไม่ย้าย) · โหมด local: serveUploads ผ่านเฉย ๆ = พฤติกรรมเดิมทุกประการ
app.use(
  '/uploads',
  uploadsAuth,
  serveUploads,
  express.static(path.resolve(env.UPLOAD_DIR), {
    dotfiles: 'deny',       // กันเข้าถึงไฟล์ซ่อน (.env ฯลฯ) ที่อาจถูกย้ายเข้ามา
    index: false,           // ไม่ list ไดเรกทอรี
    setHeaders: (res) => {
      res.set('Cache-Control', 'private, max-age=300'); // เป็นข้อมูลส่วนตัว — ห้าม shared cache
      res.set('X-Content-Type-Options', 'nosniff');
      res.set('Referrer-Policy', 'no-referrer');
    },
  })
);

// API responses ต้องไม่ถูก cache — กัน browser เสิร์ฟข้อมูลเก่า (304) หลัง create/update/delete
app.use('/api', (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// API routes
app.use('/api', routes);

// Health check — เปิดสาธารณะ จึงบอกแค่ boolean ห้ามใส่รายละเอียด (projectId/error)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', firebase: isFirebaseReady(), timestamp: new Date().toISOString() });
});

// Error handler (must be last)
app.use(errorHandler);

export default app;
