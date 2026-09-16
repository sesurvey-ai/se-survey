/**
 * อัปไฟล์ปล่อยเวอร์ชันของบอท se-autokey ขึ้นที่เก็บไฟล์ (R2) — ขั้นที่ 2 ของ make-release.bat (15/09/69)
 *
 *   npx ts-node --transpile-only src/scripts/publishBotRelease.ts <dist-dir> [--force] [--allow-local]
 *
 * <dist-dir> = โฟลเดอร์ที่ tools/make_release.py สร้าง (มี latest.json + se-autokey-<ver>.zip)
 * ตรวจก่อนอัป: latest.json ครบ · zip มีจริง · sha256/size ตรงกับ latest.json
 * กันพลาด: เวอร์ชันเดิมที่ปล่อยไปแล้วแต่ไฟล์ต่างกัน → ต้อง --force (เครื่องที่อัปไปแล้วจะไม่รู้ว่ามีของใหม่ — ควรขยับเลขแทน)
 *          โหมด local (ไม่มี S3_*) = ไฟล์ลงดิสก์เครื่องนี้ prod ไม่เห็น → ต้อง --allow-local
 * ลำดับอัป: zip ก่อน latest.json — ถ้าล้มกลางคัน เครื่องปลายทางยังเห็นเวอร์ชันเก่า ไม่ชี้ไป zip ที่ยังไม่มี
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { storage } from '../config/storage';
import { botReleaseKeys, parseReleaseMeta } from '../services/botRelease';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const force = args.includes('--force');
  const allowLocal = args.includes('--allow-local');
  if (!dir) {
    console.error('ใช้: publishBotRelease.ts <dist-dir> [--force] [--allow-local]');
    process.exit(2);
  }
  console.log(`[storage] ${storage.describe()}`);
  if (storage.driver !== 's3' && !allowLocal) {
    console.error('ไม่ได้อยู่โหมด s3 — ไฟล์จะลงดิสก์เครื่องนี้ เครื่องพนักงานโหลดไม่ได้ (ตั้ง S3_* ใน backend/.env หรือใส่ --allow-local ถ้าตั้งใจ)');
    process.exit(2);
  }

  const metaPath = path.join(dir, 'latest.json');
  const meta = parseReleaseMeta(JSON.parse(fs.readFileSync(metaPath, 'utf8')));
  const zipPath = path.join(dir, meta.file);
  const zip = fs.readFileSync(zipPath);
  const sha = createHash('sha256').update(zip).digest('hex');
  if (sha !== meta.sha256) throw new Error(`sha256 ของ ${meta.file} ไม่ตรง latest.json (ได้ ${sha.slice(0, 12)}… คาด ${meta.sha256.slice(0, 12)}…) — build ใหม่`);
  if (zip.length !== meta.size) throw new Error(`size ของ ${meta.file} ไม่ตรง latest.json (${zip.length} ≠ ${meta.size})`);
  console.log(`  release v${meta.version}: ${(zip.length / 1048576).toFixed(2)} MB · sha256 ${sha.slice(0, 12)}… · ${meta.notes || '(ไม่มีหมายเหตุ)'}`);

  const prevBuf = await storage.getBuffer(botReleaseKeys.latest());
  if (prevBuf) {
    let prev: ReturnType<typeof parseReleaseMeta> | null = null;
    try { prev = parseReleaseMeta(JSON.parse(prevBuf.toString('utf8'))); } catch (e) {
      console.log(`  (latest.json เดิมอ่านไม่ได้ — ทับได้เลย: ${(e as Error).message})`);
    }
    if (prev) {
      console.log(`  ที่ปล่อยอยู่ตอนนี้: v${prev.version} (${prev.built_at})`);
      if (prev.version === meta.version && prev.sha256 !== meta.sha256 && !force) {
        throw new Error(`v${meta.version} ปล่อยไปแล้วแต่ไฟล์ต่างกัน — ขยับ __version__ ใน autokey/__init__.py แล้ว build ใหม่ (หรือ --force ถ้าตั้งใจทับ)`);
      }
    }
  }

  await storage.put(botReleaseKeys.zip(meta.version), zip, 'application/zip');
  console.log(`✓ อัป ${botReleaseKeys.zip(meta.version)}`);
  const head = await storage.head(botReleaseKeys.zip(meta.version));
  if (!head || head.size !== zip.length) throw new Error(`อ่านกลับแล้วขนาดไม่ตรง: ${JSON.stringify(head)}`);
  await storage.put(botReleaseKeys.latest(), Buffer.from(JSON.stringify(meta, null, 1), 'utf8'), 'application/json');
  console.log(`✓ อัป ${botReleaseKeys.latest()} → เครื่องพนักงานกด "ตรวจอัปเดต" จะเห็น v${meta.version}`);
}

main().catch((e) => { console.error(`[ERROR] ${(e as Error).message}`); process.exit(1); });
