import fs from 'fs';
import path from 'path';
import { env } from '../config/env';
import { storage, contentTypeOf } from '../config/storage';

/**
 * ย้ายไฟล์ที่ค้างบนดิสก์ (uploads/) ขึ้น object storage — ใช้ครั้งเดียวตอนเปิดโหมด s3 (14/09/69)
 *
 * ทำงานซ้ำได้ไม่มีผลข้างเคียง: ไฟล์ที่อยู่บน S3 แล้ว (ขนาดเท่ากัน) ข้าม · อัปโหลดแล้วอ่านกลับเช็กขนาดก่อนถือว่าสำเร็จ
 *   copy (ค่าเริ่มต้น) = คัดลอกขึ้นไป ดิสก์ยังอยู่ (ปลอดภัย — ยังถอยกลับโหมด local ได้)
 *   move               = คัดลอกแล้วลบบนดิสก์ เฉพาะไฟล์ที่ยืนยันบน S3 แล้ว + เก็บโฟลเดอร์ว่างทิ้ง
 * ข้าม: up_* ที่ราก (ไฟล์ OCR ชั่วคราว — sweeper ดูแล) · dotfile · ไฟล์ .tmp
 *
 * เรียกได้ 2 ทาง: ตอนบูต (env S3_MIGRATE_LOCAL=copy|move) หรือสคริปต์ scripts/migrateUploadsToS3
 */
export type MigrateStats = { scanned: number; uploaded: number; skipped: number; deleted: number; failed: number; bytes: number };

type Item = { key: string; full: string; size: number };

function walk(dir: string, rel: string, out: Item[]): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    const key = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { walk(full, key, out); continue; }
    if (!e.isFile()) continue;
    if (!rel && e.name.startsWith('up_')) continue;          // OCR temp ที่ราก
    if (/\.(tmp|rotating)$/i.test(e.name)) continue;
    let size = 0;
    try { size = fs.statSync(full).size; } catch { continue; }
    out.push({ key, full, size });
  }
}

function removeEmptyDirs(dir: string, isRoot: boolean): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) if (e.isDirectory()) removeEmptyDirs(path.join(dir, e.name), false);
  if (isRoot) return;
  try { if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch { /* skip */ }
}

export async function migrateLocalToS3(
  opts: { move?: boolean; dryRun?: boolean; concurrency?: number; log?: (s: string) => void } = {},
): Promise<MigrateStats> {
  const log = opts.log ?? ((s: string) => console.log(`[uploads→s3] ${s}`));
  const stats: MigrateStats = { scanned: 0, uploaded: 0, skipped: 0, deleted: 0, failed: 0, bytes: 0 };
  if (storage.driver !== 's3') { log('โหมดเก็บไฟล์ไม่ใช่ s3 — ไม่ต้องย้าย'); return stats; }

  const items: Item[] = [];
  walk(storage.localRoot, '', items);
  stats.scanned = items.length;
  log(`พบ ${items.length} ไฟล์บนดิสก์ (${(items.reduce((a, b) => a + b.size, 0) / 1e6).toFixed(1)} MB)`
    + `${opts.dryRun ? ' — dry-run ไม่อัปโหลดจริง' : ''}${opts.move ? ' — โหมด move (ลบบนดิสก์หลังยืนยัน)' : ''}`);

  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const it = items[cursor++];
      try {
        const head = await storage.head(it.key, { s3Only: true });
        if (head && head.size === it.size) {
          stats.skipped++;
        } else if (opts.dryRun) {
          stats.uploaded++; stats.bytes += it.size;
        } else {
          const buf = fs.readFileSync(it.full);
          await storage.put(it.key, buf, contentTypeOf(it.key), { keepLocal: true });
          const check = await storage.head(it.key, { s3Only: true });
          if (!check || check.size !== buf.length) throw new Error(`อัปโหลดแล้วอ่านกลับขนาดไม่ตรง (${check?.size} ≠ ${buf.length})`);
          stats.uploaded++; stats.bytes += buf.length;
        }
        if (opts.move && !opts.dryRun) {
          try { fs.unlinkSync(it.full); stats.deleted++; } catch { /* skip */ }
        }
      } catch (e) {
        stats.failed++;
        log(`✗ ${it.key}: ${e instanceof Error ? e.message : String(e)}`);
      }
      done++;
      if (done % 200 === 0) log(`${done}/${items.length} · อัป ${stats.uploaded} ข้าม ${stats.skipped} พลาด ${stats.failed}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 6) }, worker));

  if (opts.move && !opts.dryRun) removeEmptyDirs(storage.localRoot, true);
  log(`เสร็จ: อัป ${stats.uploaded} (${(stats.bytes / 1e6).toFixed(1)} MB) ข้าม ${stats.skipped} ลบดิสก์ ${stats.deleted} พลาด ${stats.failed}`);
  return stats;
}

let running = false;

/** ตอนบูต: S3_MIGRATE_LOCAL=copy|move (โหมด s3 เท่านั้น) → ย้ายหลังขึ้น 30 วิ แล้วซ้ำทุก 24 ชม. (รอบหลังข้ามหมด) */
export function startUploadMigrator(): void {
  const mode = (env.S3_MIGRATE_LOCAL || '').toLowerCase();
  if (storage.driver !== 's3' || !['1', 'copy', 'move'].includes(mode)) return;
  const run = async () => {
    if (running) return;
    running = true;
    try { await migrateLocalToS3({ move: mode === 'move' }); }
    catch (e) { console.error('[uploads→s3] ล้ม:', e); }
    finally { running = false; }
  };
  console.log(`[uploads→s3] S3_MIGRATE_LOCAL=${mode} — จะย้ายไฟล์บนดิสก์ขึ้น S3 ใน 30 วินาที (เอา env นี้ออกเมื่อย้ายครบ)`);
  setTimeout(() => { void run(); }, 30_000).unref?.();
  setInterval(() => { void run(); }, 24 * 60 * 60 * 1000).unref?.();
}
