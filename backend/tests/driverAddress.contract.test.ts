/**
 * Contract test — ที่อยู่ปัจจุบันผู้ขับขี่รถประกัน: หมู่ + ตำบล แยกช่อง (16/09/69)
 *
 * ล็อกกติกา:
 *  1) EMCS/XML รับข้อความช่องเดียว "46/23 ม.7 ต.ท้ายบ้าน" (services/driverAddress.ts) — จังหวัด/อำเภอไป dropdown
 *     · ว่างข้าม · ไม่ต่อหมู่/ตำบลซ้ำถ้ามีอยู่แล้ว · บอท (se-autokey claim_data.driver_address_line) สูตรเดียวกัน
 *  2) เก็บแยก driver_moo / driver_subdistrict: migration 064 · schema รับ · column lists อ่าน/เขียน · XML DRI_ADDRESS ประกอบ
 *     · integration /report ส่ง driver_address_emcs ให้บอท
 *  3) รายชื่อตำบลตามอำเภอ: GET /api/geo/tumbons (เว็บ) + assets/thai_tumbons.json (มือถือ) จากชุดรหัสมาตรฐานเดียวกัน
 *     · 'อำเภอเมือง' ต้องได้รหัสหลัก ไม่ใช่สาขาอำเภอ (ชัยภูมิ 3601 ไม่ใช่ 3651)
 *  4) เว็บ CaseDetail มีช่อง driver_moo + driver_subdistrict · มือถือมี controller/ช่อง/asset ครบ
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import { driverAddressLine } from '../src/services/driverAddress';
import { tumbonNames, amphurCode } from '../src/services/areaCode.service';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}
const ROOT = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ── 1) ข้อความช่องเดียว ──
{
  const cases: Array<[string, string, string, string]> = [
    ['46/23', '7', 'ท้ายบ้าน', '46/23 ม.7 ต.ท้ายบ้าน'],
    ['25 ม.3', '', 'บ่อวิน', '25 ม.3 ต.บ่อวิน'],
    ['46/23 หมู่ 7', '7', 'ท้ายบ้าน', '46/23 หมู่ 7 ต.ท้ายบ้าน'],
    ['46/23 ม.7 ต.ท้ายบ้าน', '7', 'ท้ายบ้าน', '46/23 ม.7 ต.ท้ายบ้าน'],
    ['12 ซ.5', 'หมู่ 4', 'ต.บางพลี', '12 ซ.5 ม.4 ต.บางพลี'],
    ['46/23 หมู่ 17', '7', 'ท้ายบ้าน', '46/23 หมู่ 17 ม.7 ต.ท้ายบ้าน'],
    ['99/1', '', '', '99/1'],
    ['', '', '', ''],
  ];
  for (const [a, m, t, want] of cases) check(`ประกอบ ${JSON.stringify([a, m, t])} → ${JSON.stringify(want)}`, driverAddressLine(a, m, t) === want, JSON.stringify(driverAddressLine(a, m, t)));
  check('รับ null/undefined ได้', driverAddressLine(null, undefined, null) === '' && driverAddressLine('1', null, undefined) === '1');
}

// ── 2) เก็บแยก + ทุกชั้นรู้จัก ──
{
  const mig = read('backend/src/db/migrations/064_driver_moo_subdistrict.sql');
  check('migration 064 เพิ่ม driver_moo + driver_subdistrict บน survey_reports', mig.includes('ADD COLUMN IF NOT EXISTS driver_moo') && mig.includes('ADD COLUMN IF NOT EXISTS driver_subdistrict'));
  const routes = read('backend/src/routes/case.routes.ts');
  check('schema รับ driver_moo / driver_subdistrict', routes.includes('driver_moo: optStr') && routes.includes('driver_subdistrict: optStr'));
  const svc = read('backend/src/services/case.service.ts');
  check('column lists อ่าน/เขียนรายงานมีทั้ง 2 ช่อง (2 จุด)', (svc.match(/'driver_address','driver_moo','driver_subdistrict','driver_province'/g) ?? []).length === 2);
  const xml = read('backend/src/services/xmlExport.service.ts');
  check('XML: DRI_ADDRESS ผู้ขับขี่รถประกันประกอบผ่าน driverAddressLine (คู่กรณีไม่เปลี่ยน)',
    xml.includes("el('DRI_ADDRESS', insured ? driverAddressLine(c.driver_address, c.driver_moo, c.driver_subdistrict) : c.address)") && xml.includes("import { driverAddressLine } from './driverAddress'"));
  const integ = read('backend/src/routes/integration.routes.ts');
  check('integration /report ส่ง driver_address_emcs', integ.includes('driver_address_emcs: driverAddressLine(r.driver_address, r.driver_moo, r.driver_subdistrict)'));
}

// ── 3) ตำบลตามอำเภอ ──
{
  const n = tumbonNames('สมุทรปราการ', 'อำเภอเมือง');
  check('tumbonNames สมุทรปราการ/อำเภอเมือง มี ท้ายบ้าน และไม่มีชื่อขึ้นต้น *', n.includes('ท้ายบ้าน') && n.every((x) => !x.startsWith('*')) && n.length > 10, String(n.length));
  check('อำเภอเมือง = รหัสหลัก ไม่ใช่สาขา (ชัยภูมิ 3601 · ตรัง 9201)', amphurCode('ชัยภูมิ', 'อำเภอเมือง') === '3601' && amphurCode('ตรัง', 'อำเภอเมือง') === '9201'
    && tumbonNames('ชัยภูมิ', 'อำเภอเมือง').length > 0);
  check('อำเภอไม่รู้จัก = []', tumbonNames('ชลบุรี', 'xx').length === 0 && tumbonNames('', '').length === 0);
  const idx = read('backend/src/routes/index.ts');
  const geo = read('backend/src/routes/geo.routes.ts');
  check('route /api/geo/tumbons (auth) ใช้ tumbonNames', idx.includes("router.use('/geo', geoRoutes)") && geo.includes("router.get('/tumbons', auth") && geo.includes('tumbonNames(province, district)'));
  const assetPath = path.join(ROOT, 'mobile', 'assets', 'thai_tumbons.json');
  check('มือถือ: assets/thai_tumbons.json มีอยู่และครอบคลุมทุกอำเภอของ thai_provinces.json', (() => {
    if (!fs.existsSync(assetPath)) return false;
    const t = JSON.parse(fs.readFileSync(assetPath, 'utf8')) as Record<string, Record<string, string[]>>;
    const p = JSON.parse(read('mobile/assets/thai_provinces.json')) as Record<string, string[]>;
    return Object.entries(p).every(([prov, ds]) => ds.every((d) => Array.isArray(t[prov]?.[d]) && t[prov][d].length > 0)) && t['สมุทรปราการ']['อำเภอเมือง'].includes('ท้ายบ้าน');
  })());
  check('มือถือ: pubspec ลงทะเบียน asset', read('mobile/pubspec.yaml').includes('- assets/thai_tumbons.json'));
}

// ── 4) หน้าจอ ──
{
  const web = read('web/src/components/cases/CaseDetail.tsx');
  check('เว็บ: ตำบลบังคับ (จุดแดง Req of=driver_subdistrict) · หมู่ไม่บังคับ', web.includes('<F label="ตำบล / แขวง" req={<Req of="driver_subdistrict" />}>') && !/Req of="[^"]*driver_moo/.test(web));
  check('เว็บ: หมู่อยู่ในช่องเดียวกับที่อยู่ (แบบบัตรประชาชน+คนไทย) ไม่มี placeholder ม. · โชว์ "ม." เมื่อมีค่า · ไม่มี F แยกของหมู่',
    !/name="driver_moo"[^>]*placeholder=/.test(web) && web.includes("{driverMoo ? <span") && !web.includes('<F label="หมู่">')
    && /<F label="ที่อยู่ปัจจุบัน \(บ้านเลขที่ \/ ถนน\)" req=\{<Req of="driver_address" \/>\}>[\s\S]{0,900}?name="driver_moo"/.test(web));
  check('เว็บ: ช่อง driver_moo + select driver_subdistrict โหลดจาก /api/geo/tumbons · เปลี่ยนจังหวัด/อำเภอแล้วล้างตำบล',
    web.includes('name="driver_moo"') && web.includes('name="driver_subdistrict"') && web.includes("api.get('/api/geo/tumbons'")
    && (web.match(/setDriverTumbon\(''\)/g) ?? []).length >= 2);
  const dart = read('mobile/lib/screens/survey_form_screen.dart');
  check('มือถือ: controller หมู่/ตำบล + ส่ง/autosave ทั้ง 2 ช่อง + dropdown ตำบลตามอำเภอ + ล้างตำบลเมื่อเปลี่ยนจังหวัด/อำเภอ',
    dart.includes('_driverMooCtl') && dart.includes("_driverMooCtl: 'driver_moo'") && dart.includes("'driver_subdistrict': _driverSubdistrictCtl.text.trim()")
    && dart.includes('Widget _tumbonDropdown()') && dart.includes("loadString('assets/thai_tumbons.json')")
    && (dart.match(/_driverSubdistrictCtl\.text = ''/g) ?? []).length >= 2);
  check('มือถือ: ตำบลบังคับ (req + อยู่ในรายการช่องบังคับหมวด 3) · หมู่ไม่บังคับ',
    dart.includes("hint: 'เลือกตำบล/แขวง', req: true") && dart.includes("['ตำบล/แขวงผู้ขับขี่', has(_driverSubdistrictCtl)]") && !dart.includes("has(_driverMooCtl)"));
}

// ── ฝั่งบอท (se-autokey ข้าง ๆ — ข้ามถ้าไม่มี) ──
{
  const bot = path.join(ROOT, '..', 'se-autokey');
  if (fs.existsSync(path.join(bot, 'autokey', 'claim_data.py'))) {
    const cd = fs.readFileSync(path.join(bot, 'autokey', 'claim_data.py'), 'utf8');
    const main = fs.readFileSync(path.join(bot, 'main.py'), 'utf8');
    const api = fs.readFileSync(path.join(bot, 'autokey', 'isurvey_api.py'), 'utf8');
    check('บอท: driver_address_line (สูตรเดียวกัน) · เส้นเว็บใช้ driver_address_emcs ก่อน · เส้น ISURVEY ตรงต่อ ต.<ตำบล> จาก drv_tumbonID',
      cd.includes('def driver_address_line(') && cd.includes('parts.append(f"ม.{m}")') && cd.includes('parts.append(f"ต.{t}")')
      && main.includes("gv('driver_address_emcs') or driver_address_line(") && api.includes('self._tumbon(drv.get("drv_tumbonID"))'));
  } else {
    console.log('[SKIP] ไม่มี repo se-autokey ข้าง ๆ — ข้ามเทสฝั่งบอท');
  }
}

console.log(failed ? `\n${failed} FAILED ❌` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
