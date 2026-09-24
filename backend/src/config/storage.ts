/**
 * ชั้นเก็บไฟล์อัปโหลด (รูปเคส / รูปลงเวลา / ภาพหน้าจอคิว EMCS) — สลับได้ 2 แบบด้วย env (14/09/69)
 *
 *   local (ค่าเริ่มต้น) = ดิสก์ UPLOAD_DIR เหมือนเดิมทุกประการ
 *   s3                  = object storage แบบ S3 (Cloudflare R2 / Wasabi / AWS) — ตั้ง S3_ENDPOINT/S3_BUCKET/
 *                         S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY ครบ (หรือบังคับด้วย STORAGE_DRIVER)
 *
 * ทำไมต้องมี: ดิสก์ VPS 400 GB ขยายไม่ได้ แต่รูป 8,000 เคส/เดือน ≈ 150 GB/เดือน — เก็บบนดิสก์ไม่ไหว
 *
 * key = path สัมพัทธ์ใต้ uploads ใช้ '/' เสมอ (ตรงกับ survey_photos.file_path / case_images.file_path /
 * attendance_records.check_in_photo) เช่น case_12/job_12/a.jpg · att_x.jpg · emcs_jobs/job_1.png
 *
 * กติกาโหมด s3 ช่วงเปลี่ยนผ่าน (ไฟล์เก่ายังอยู่บนดิสก์จนกว่าตัวย้าย utils/uploadMigrator จะย้ายครบ):
 *   อ่าน  = S3 ก่อน ไม่เจอค่อยถอยไปดิสก์
 *   เขียน = S3 อย่างเดียว แล้วลบสำเนาเก่าบนดิสก์ทิ้ง (ไม่งั้นถ้าอ่าน S3 พลาด ตัวถอยจะเสิร์ฟรูปก่อนหมุน)
 *   ลบ    = ทั้ง S3 และดิสก์ (กันรูปที่ลบแล้วฟื้นคืนจากดิสก์)
 *   ลิสต์ = รวม S3 + ดิสก์ (โฟลเดอร์เคสเก่าที่ยังไม่ย้าย ต้องยังมองเห็นตอนช่างส่งงานซ้ำ)
 *
 * ⛔ ไฟล์ชั่วคราวของ multer (up_* / att_* ที่ราก uploads) ยังลงดิสก์ก่อนเสมอ — โค้ดที่รับไฟล์ต้องเรียก
 *    putFromFile() ย้ายเข้าที่ (ไม่งั้นโหมด s3 จะเสิร์ฟไม่เจอ) · ไฟล์ OCR ชั่วคราวเป็นของดิสก์ล้วน (มี sweeper กวาด)
 */
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { randomUUID } from 'crypto';
import {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand,
  DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { env } from './env';

export type StorageDriver = 'local' | 's3';

export type GetResult =
  | { kind: 'ok'; body: Readable; contentType: string; size?: number; etag?: string; lastModified?: Date }
  | { kind: 'not-modified'; etag?: string };

export type HeadResult = { size?: number; etag?: string; lastModified?: Date; contentType?: string };

const ROOT = path.resolve(env.UPLOAD_DIR);

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.json': 'application/json', '.zip': 'application/zip',
};

/** content-type จากนามสกุลไฟล์ (ไม่พึ่ง lib mime — มีไม่กี่ชนิด) */
export function contentTypeOf(key: string): string {
  return MIME[path.extname(key).toLowerCase()] ?? 'application/octet-stream';
}

/** key ที่ขอมา → รูปแบบมาตรฐาน ('/' · ไม่มี '..' · ไม่ขึ้นต้น '/'); null = น่าสงสัย (path traversal) */
export function normalizeKey(raw: string): string | null {
  let p = String(raw ?? '');
  try { p = decodeURIComponent(p); } catch { return null; }
  p = p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/\/+$/, '');
  if (!p || p.includes('\0') || /^[A-Za-z]:/.test(p)) return null;
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) return null;
  return p;
}

/** path จริงบนดิสก์ของ key — โยนถ้าหลุดกรอบ UPLOAD_DIR */
export function localPathOf(key: string): string {
  const norm = normalizeKey(key);
  if (norm === null) throw new Error(`unsafe storage key: ${key}`);
  const full = path.resolve(ROOT, norm);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) throw new Error(`unsafe storage key: ${key}`);
  return full;
}

function resolveDriver(): StorageDriver {
  const want = (env.STORAGE_DRIVER || '').toLowerCase();
  const complete = !!(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY);
  if (want === 's3') {
    if (!complete) throw new Error('STORAGE_DRIVER=s3 แต่ S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY ไม่ครบ');
    return 's3';
  }
  if (want === 'local') return 'local';
  return complete ? 's3' : 'local';
}

const driver: StorageDriver = resolveDriver();
const BUCKET = env.S3_BUCKET ?? '';
const PREFIX = (env.S3_PREFIX ?? '').replace(/^\/+/, '').replace(/\/+$/, '');
const objKey = (key: string) => (PREFIX ? `${PREFIX}/${key}` : key);

let s3: S3Client | null = null;
function client(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: env.S3_REGION || 'auto',
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== '0',
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '' },
      // R2 ไม่รับ checksum CRC32 ที่ SDK รุ่นใหม่แนบมาเองทุกคำขอ — ใส่เฉพาะที่ API บังคับ (ตามคู่มือ R2)
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return s3;
}

const httpStatus = (e: unknown): number | undefined =>
  (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const isNotFound = (e: unknown): boolean => {
  const n = (e as { name?: string })?.name;
  return n === 'NoSuchKey' || n === 'NotFound' || httpStatus(e) === 404;
};

// ───────────── S3 ─────────────

async function s3Head(key: string): Promise<HeadResult | null> {
  try {
    const h = await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: objKey(key) }));
    return { size: h.ContentLength, etag: h.ETag, lastModified: h.LastModified, contentType: h.ContentType };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

async function s3Get(key: string, ifNoneMatch?: string): Promise<GetResult | null> {
  try {
    const out = await client().send(new GetObjectCommand({
      Bucket: BUCKET, Key: objKey(key), ...(ifNoneMatch ? { IfNoneMatch: ifNoneMatch } : {}),
    }));
    if (!out.Body) return null;
    return {
      kind: 'ok', body: out.Body as unknown as Readable,
      contentType: out.ContentType || contentTypeOf(key),
      size: out.ContentLength, etag: out.ETag, lastModified: out.LastModified,
    };
  } catch (e) {
    if (httpStatus(e) === 304) return { kind: 'not-modified' };
    if (isNotFound(e)) return null;
    throw e;
  }
}

async function s3GetBuffer(key: string): Promise<Buffer | null> {
  try {
    const out = await client().send(new GetObjectCommand({ Bucket: BUCKET, Key: objKey(key) }));
    if (!out.Body) return null;
    const bytes = await (out.Body as unknown as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

async function s3Put(key: string, body: Buffer, contentType: string): Promise<void> {
  await client().send(new PutObjectCommand({
    Bucket: BUCKET, Key: objKey(key), Body: body, ContentType: contentType, ContentLength: body.length,
  }));
}

async function s3Delete(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: objKey(key) }));
}

/** ชื่อไฟล์ที่อยู่ใต้ prefix โดยตรง (ไม่ลงลึก) */
async function s3ListNames(prefix: string): Promise<string[]> {
  const base = objKey(prefix) + '/';
  const names: string[] = [];
  let token: string | undefined;
  do {
    const out = await client().send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: base, Delimiter: '/', ContinuationToken: token,
    }));
    for (const o of out.Contents ?? []) {
      const name = (o.Key ?? '').slice(base.length);
      if (name && !name.includes('/')) names.push(name);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return names;
}

/** ชื่อไฟล์ที่รากของที่เก็บ (ไม่ลงโฟลเดอร์) ที่ขึ้นต้นด้วย namePrefix เช่น 'att_' */
async function s3ListRootNames(namePrefix: string): Promise<string[]> {
  const base = PREFIX ? `${PREFIX}/` : '';
  const names: string[] = [];
  let token: string | undefined;
  do {
    const out = await client().send(new ListObjectsV2Command({
      Bucket: BUCKET, Prefix: base + namePrefix, Delimiter: '/', ContinuationToken: token,
    }));
    for (const o of out.Contents ?? []) {
      const name = (o.Key ?? '').slice(base.length);
      if (name && !name.includes('/')) names.push(name);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return names;
}

/** key ทั้งหมดใต้ prefix (ทุกชั้น) — ใช้ตอนลบโฟลเดอร์เคสทิ้งทั้งก้อน */
async function s3ListAllKeys(prefix: string): Promise<string[]> {
  const base = objKey(prefix) + '/';
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const out = await client().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: base, ContinuationToken: token }));
    for (const o of out.Contents ?? []) if (o.Key) keys.push(o.Key);
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

// ───────────── ดิสก์ ─────────────

function localUnlink(key: string): void {
  try { fs.unlinkSync(localPathOf(key)); } catch { /* ไม่มีอยู่แล้ว */ }
}

function localExists(key: string): boolean {
  try { return fs.statSync(localPathOf(key)).isFile(); } catch { return false; }
}

function localGet(key: string): GetResult | null {
  const full = localPathOf(key);
  let st: fs.Stats;
  try { st = fs.statSync(full); } catch { return null; }
  if (!st.isFile()) return null;
  return { kind: 'ok', body: fs.createReadStream(full), contentType: contentTypeOf(key), size: st.size, lastModified: st.mtime };
}

/** เขียนแบบ atomic: ลงไฟล์ชั่วคราว (dotfile — express.static ไม่เสิร์ฟ) แล้ว rename ทับ */
function localPut(key: string, body: Buffer): void {
  const full = localPathOf(key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  const tmp = path.join(path.dirname(full), `.~${path.basename(full)}.${randomUUID().slice(0, 8)}.tmp`);
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, full);
}

function localListNames(prefix: string): string[] {
  let dir: string;
  try { dir = localPathOf(prefix); } catch { return []; }
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch { return []; }
}

/** ไฟล์ที่รากดิสก์ (UPLOAD_DIR) ที่ขึ้นต้นด้วย namePrefix — normalizeKey ไม่รับ key ว่าง จึงอ่าน ROOT ตรง ๆ */
function localListRootNames(namePrefix: string): string[] {
  try {
    return fs.readdirSync(ROOT, { withFileTypes: true })
      .filter((e) => e.isFile() && !e.name.startsWith('.') && e.name.startsWith(namePrefix))
      .map((e) => e.name);
  } catch { return []; }
}

function localDirExists(prefix: string): boolean {
  try { return fs.statSync(localPathOf(prefix)).isDirectory(); } catch { return false; }
}

// ───────────── API กลาง ─────────────

export const storage = {
  driver,
  /** ราก uploads บนดิสก์ (ไฟล์ชั่วคราวของ multer / sweeper ยังใช้) */
  localRoot: ROOT,

  /** สรุปสำหรับ log ตอนบูต — ไม่มีคีย์ */
  describe(): string {
    return driver === 's3'
      ? `driver=s3 bucket=${BUCKET} endpoint=${env.S3_ENDPOINT} region=${env.S3_REGION || 'auto'}`
        + `${PREFIX ? ` prefix=${PREFIX}/` : ''} (ดิสก์ ${ROOT} = ตัวถอยสำหรับไฟล์ที่ยังไม่ย้าย)`
      : `driver=local dir=${ROOT}`;
  },

  /** เขียนไฟล์จาก buffer — `keepLocal` = โหมด s3 ไม่ลบสำเนาบนดิสก์ (ตัวย้ายไฟล์แบบคัดลอกใช้) */
  async put(key: string, body: Buffer, contentType?: string, opts: { keepLocal?: boolean } = {}): Promise<void> {
    const k = normalizeKey(key);
    if (k === null) throw new Error(`unsafe storage key: ${key}`);
    if (driver === 's3') {
      await s3Put(k, body, contentType || contentTypeOf(k));
      if (!opts.keepLocal) localUnlink(k);   // สำเนาเก่าบนดิสก์ (ถ้ามี) ต้องไม่ค้าง — ตัวถอยจะเสิร์ฟของเก่า
      return;
    }
    localPut(k, body);
  },

  /** ย้ายไฟล์ชั่วคราวของ multer (บนดิสก์) เข้าที่ตาม key — ไฟล์ต้นทางถูกลบ/ย้ายเสมอ */
  async putFromFile(tmpPath: string, key: string, contentType?: string): Promise<void> {
    const k = normalizeKey(key);
    if (k === null) throw new Error(`unsafe storage key: ${key}`);
    const src = path.resolve(tmpPath);
    if (driver === 's3') {
      const body = fs.readFileSync(src);
      await s3Put(k, body, contentType || contentTypeOf(k));
      try { fs.unlinkSync(src); } catch { /* skip */ }
      const stale = localPathOf(k);
      if (stale !== src) { try { fs.unlinkSync(stale); } catch { /* skip */ } }
      return;
    }
    const dest = localPathOf(k);
    if (dest === src) return;              // multer วางไว้ตรงที่แล้ว (เช่น att_* ที่ราก)
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.renameSync(src, dest);
    } catch {
      fs.copyFileSync(src, dest);          // ข้าม device (EXDEV) → คัดลอกแล้วลบ
      try { fs.unlinkSync(src); } catch { /* skip */ }
    }
  },

  /**
   * อ่านเป็น stream — s3: S3 ก่อน ไม่เจอถอยไปดิสก์ · `ifNoneMatch` (ETag จากเบราว์เซอร์) → 'not-modified'
   * `s3Only` = ไม่ถอยไปดิสก์ (ตัวเสิร์ฟ /uploads ปล่อยให้ express.static เสิร์ฟดิสก์เองแทน)
   */
  async get(key: string, opts: { ifNoneMatch?: string; s3Only?: boolean } = {}): Promise<GetResult | null> {
    const k = normalizeKey(key);
    if (k === null) return null;
    if (driver === 's3') {
      const r = await s3Get(k, opts.ifNoneMatch);
      if (r || opts.s3Only) return r;
    }
    return localGet(k);
  },

  async head(key: string, opts: { s3Only?: boolean } = {}): Promise<HeadResult | null> {
    const k = normalizeKey(key);
    if (k === null) return null;
    if (driver === 's3') {
      const h = await s3Head(k);
      if (h || opts.s3Only) return h;
    }
    try {
      const st = fs.statSync(localPathOf(k));
      return st.isFile() ? { size: st.size, lastModified: st.mtime, contentType: contentTypeOf(k) } : null;
    } catch { return null; }
  },

  /** อ่านทั้งไฟล์เป็น buffer (หมุนรูป) — null = ไม่มี */
  async getBuffer(key: string): Promise<Buffer | null> {
    const k = normalizeKey(key);
    if (k === null) return null;
    if (driver === 's3') {
      const b = await s3GetBuffer(k);
      if (b) return b;
    }
    try { return fs.readFileSync(localPathOf(k)); } catch { return null; }
  },

  async exists(key: string): Promise<boolean> {
    const k = normalizeKey(key);
    if (k === null) return false;
    if (driver === 's3' && (await s3Head(k))) return true;
    return localExists(k);
  },

  /** ลบไฟล์ — s3: ลบทั้ง S3 และสำเนาบนดิสก์ · ไม่มีอยู่แล้วก็ไม่ error */
  async del(key: string): Promise<void> {
    const k = normalizeKey(key);
    if (k === null) return;
    if (driver === 's3') await s3Delete(k);
    localUnlink(k);
  },

  /** ลบหลายไฟล์แบบไม่ล้มทั้งชุด — คืนรายการที่ลบไม่สำเร็จ */
  async deleteMany(keys: string[]): Promise<string[]> {
    const failed: string[] = [];
    for (const key of keys) {
      try { await this.del(key); } catch { failed.push(key); }
    }
    return failed;
  },

  /** ชื่อไฟล์ใต้โฟลเดอร์ (ไม่ลงลึก · ไม่รวม dotfile) — s3: รวมของบนดิสก์ที่ยังไม่ย้ายด้วย */
  async list(prefix: string): Promise<string[]> {
    const p = normalizeKey(prefix);
    if (p === null) return [];
    const names = new Set<string>(localListNames(p));
    if (driver === 's3') for (const n of await s3ListNames(p)) names.add(n);
    return [...names].sort();
  },

  /** ชื่อไฟล์ที่รากของที่เก็บ (ไม่ลงโฟลเดอร์ · ไม่รวม dotfile) ที่ขึ้นต้นด้วย namePrefix เช่น 'att_' (รูปลงเวลา)
   *  — list(prefix) ใช้กับรากไม่ได้ เพราะต่อ '/' ท้าย prefix เสมอ · s3: รวมของบนดิสก์ที่ยังไม่ย้ายด้วย */
  async listRootFiles(namePrefix: string): Promise<string[]> {
    if (!/^[\w.-]+$/.test(namePrefix)) return [];
    const names = new Set<string>(localListRootNames(namePrefix));
    if (driver === 's3') for (const n of await s3ListRootNames(namePrefix)) names.add(n);
    return [...names].sort();
  },

  /** "โฟลเดอร์มีอยู่" — ดิสก์: มีไดเรกทอรี · s3: มีไฟล์อย่างน้อย 1 (S3 ไม่มีโฟลเดอร์จริง) หรือมีไดเรกทอรีบนดิสก์ */
  async folderExists(prefix: string): Promise<boolean> {
    const p = normalizeKey(prefix);
    if (p === null) return false;
    if (localDirExists(p)) return true;
    if (driver === 's3') return (await s3ListNames(p)).length > 0;
    return false;
  },

  /** สร้างโฟลเดอร์บนดิสก์ (โหมด local เท่านั้น — S3 ไม่มีโฟลเดอร์ ไฟล์แรกที่เขียนคือการสร้าง) */
  async ensureFolder(prefix: string): Promise<void> {
    if (driver !== 'local') return;
    fs.mkdirSync(localPathOf(prefix), { recursive: true });
  },

  /** ลบทั้งโฟลเดอร์ (ทุกไฟล์ทุกชั้น) — ใช้ตอนลบเคสถาวร: โฟลเดอร์ case_<id> ผูกกับเคสที่ไม่มีแล้ว */
  async deleteFolder(prefix: string): Promise<number> {
    const p = normalizeKey(prefix);
    if (p === null) throw new Error(`unsafe storage key: ${prefix}`);
    let n = 0;
    if (driver === 's3') {
      const keys = await s3ListAllKeys(p);
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        await client().send(new DeleteObjectsCommand({
          Bucket: BUCKET, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }));
        n += chunk.length;
      }
    }
    try {
      const dir = localPathOf(p);
      if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); n++; }
    } catch { /* skip */ }
    return n;
  },

  /** ลบโฟลเดอร์ว่างบนดิสก์ที่ไฟล์เหล่านี้เคยอยู่ (โฟลเดอร์เลขเคลมระบบเก่า) — ไม่แตะโฟลเดอร์ที่ยังมีของ */
  cleanupEmptyFolders(keys: string[]): void {
    const dirs = new Set<string>();
    for (const key of keys) {
      try {
        const dir = path.dirname(localPathOf(key));
        if (dir !== ROOT) dirs.add(dir);
      } catch { /* key ไม่ปลอดภัย — ข้าม */ }
    }
    for (const dir of dirs) {
      try {
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
          const parent = path.dirname(dir);
          if (parent !== ROOT && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) fs.rmdirSync(parent);
        }
      } catch { /* skip */ }
    }
  },
};
