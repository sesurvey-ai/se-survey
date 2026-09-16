/**
 * ไฟล์ปล่อยเวอร์ชันของบอท se-autokey บนที่เก็บไฟล์ (R2) — อัปเดตบอทข้ามเครื่องไม่ต้องขน USB (user เคาะ 15/09/69 แผนข้อ 1)
 *
 * เครื่อง dev: se-autokey/make-release.bat → dist/se-autokey-<ver>.zip + dist/latest.json → scripts/publishBotRelease.ts อัปขึ้นที่นี่
 * เครื่องพนักงาน: หน้าบอทกด "ตรวจอัปเดต" → GET /api/integrations/bot-release/latest (token บอทตัวเดิม) → เทียบเวอร์ชัน
 *                → GET /bot-release/<ver>/zip → ตรวจ sha256 เอง → แตกทับ → รีสตาร์ต
 * key อยู่ใต้ uploads เหมือนรูป (ผ่านชั้น storage เท่านั้น) แต่คนละ prefix — ไม่ปนกับรูปเคส
 */
export const BOT_RELEASE_PREFIX = 'releases/se-autokey';
export const BOT_VERSION_RE = /^\d+\.\d+\.\d+$/;

export const botReleaseKeys = {
  latest: (): string => `${BOT_RELEASE_PREFIX}/latest.json`,
  zip: (version: string): string => `${BOT_RELEASE_PREFIX}/se-autokey-${version}.zip`,
};

export type BotReleaseMeta = {
  version: string;   // x.y.z = autokey.__version__ ตอน build
  file: string;      // se-autokey-<version>.zip
  sha256: string;    // ของ zip — เครื่องปลายทางตรวจก่อนติดตั้ง
  size: number;
  built_at: string;  // ISO UTC
  notes: string;     // ข้อความสั้น ๆ โชว์ให้คนกดอัปเดตเห็น
};

/** ตรวจรูป latest.json (จาก make_release.py) — โยนถ้าไม่ครบ/ไม่ตรงกติกา จะได้ไม่ปล่อยไฟล์ที่เครื่องปลายทางโหลดไม่ได้ */
export function parseReleaseMeta(raw: unknown): BotReleaseMeta {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const version = String(o.version ?? '').trim();
  if (!BOT_VERSION_RE.test(version)) throw new Error(`version ผิดรูปแบบ (ต้อง x.y.z): ${JSON.stringify(o.version)}`);
  const file = String(o.file ?? '').trim();
  if (file !== `se-autokey-${version}.zip`) throw new Error(`file ต้องชื่อ se-autokey-${version}.zip แต่เป็น ${JSON.stringify(o.file)}`);
  const sha256 = String(o.sha256 ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('sha256 ผิดรูปแบบ');
  const size = Number(o.size);
  if (!Number.isInteger(size) || size <= 0) throw new Error('size ต้องเป็นจำนวนเต็มบวก');
  return {
    version, file, sha256, size,
    built_at: String(o.built_at ?? ''),
    notes: String(o.notes ?? ''),
  };
}
