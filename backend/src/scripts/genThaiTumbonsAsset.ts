/**
 * สร้างไฟล์ตำบลสำหรับแอปมือถือ: mobile/assets/thai_tumbons.json = { จังหวัด: { อำเภอ(ชื่อตามแอป): [ตำบล...] } } (16/09/69)
 *
 *   npx ts-node --transpile-only src/scripts/genThaiTumbonsAsset.ts        (รันใน backend/ — เขียนทับไฟล์ใน ../mobile/assets)
 *
 * คีย์จังหวัด/อำเภอ = ชื่อชุดเดียวกับ mobile/assets/thai_provinces.json (ที่แอปใช้ใน dropdown อยู่แล้ว)
 * ตำบล = ชื่อจาก data/thaiAreaCodes.ts (รหัสมาตรฐานไทย ชุดเดียวกับตารางเรทและ API /api/geo/tumbons)
 * อำเภอที่จับคู่รหัสไม่ได้จะพิมพ์เตือนและได้รายการว่าง (แอปยังพิมพ์/ข้ามได้ ไม่พัง)
 */
import fs from 'fs';
import path from 'path';
import { tumbonNames } from '../services/areaCode.service';

const MOBILE_ASSETS = path.resolve(__dirname, '..', '..', '..', 'mobile', 'assets');
const provinces = JSON.parse(fs.readFileSync(path.join(MOBILE_ASSETS, 'thai_provinces.json'), 'utf8')) as Record<string, string[]>;

const out: Record<string, Record<string, string[]>> = {};
let districts = 0; let tumbons = 0; const missing: string[] = [];
for (const [prov, dists] of Object.entries(provinces)) {
  out[prov] = {};
  for (const d of dists) {
    const names = tumbonNames(prov, d);
    out[prov][d] = names;
    districts += 1; tumbons += names.length;
    if (!names.length) missing.push(`${prov}/${d}`);
  }
}
const dest = path.join(MOBILE_ASSETS, 'thai_tumbons.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 0) + '\n', 'utf8');
console.log(`เขียน ${dest}: ${Object.keys(out).length} จังหวัด · ${districts} อำเภอ · ${tumbons} ตำบล · ${(fs.statSync(dest).size / 1024).toFixed(0)} KB`);
if (missing.length) console.log(`⚠️ อำเภอที่หาตำบลไม่ได้ ${missing.length}: ${missing.slice(0, 15).join(', ')}${missing.length > 15 ? ' …' : ''}`);
