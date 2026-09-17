/**
 * Contract test — ที่อยู่ปัจจุบันผู้ขับขี่รถประกัน: หมู่ + ตำบล แยกช่อง (16/09/69)
 *              + คู่กรณี: คำนำหน้าเจ้าของรถ · ที่อยู่ผู้ขับขี่คู่กรณี หมู่/ตำบล/อำเภอ/จังหวัด (16/09/69 รอบคู่กรณี)
 *
 * ล็อกกติกา:
 *  1) EMCS/XML รับข้อความช่องเดียว "46/23 ม.7 ต.ท้ายบ้าน" (services/driverAddress.ts) — จังหวัด/อำเภอไป dropdown
 *     · ว่างข้าม · ไม่ต่อหมู่/ตำบลซ้ำถ้ามีอยู่แล้ว · "ม.<เลข>" แทรกถัดจากบ้านเลขที่ · บอท (se-autokey claim_data.driver_address_line) สูตรเดียวกัน
 *  2) เก็บแยก driver_moo / driver_subdistrict: migration 064 · schema รับ · column lists อ่าน/เขียน · XML DRI_ADDRESS ประกอบ
 *     · integration /report ส่ง driver_address_emcs ให้บอท
 *  3) รายชื่อตำบลตามอำเภอ: GET /api/geo/tumbons (เว็บ) + assets/thai_tumbons.json (มือถือ) จากชุดรหัสมาตรฐานเดียวกัน
 *     · 'อำเภอเมือง' ต้องได้รหัสหลัก ไม่ใช่สาขาอำเภอ (ชัยภูมิ 3601 ไม่ใช่ 3651)
 *  4) เว็บ CaseDetail มีช่อง driver_moo + driver_subdistrict · มือถือมี controller/ช่อง/asset ครบ
 *  5) คู่กรณี: opponentAddressLine "46/23 ม.7 ต.ท้ายบ้าน อ.เมือง จ.สมุทรปราการ" (กรุงเทพ = แขวง/เขต/กรุงเทพฯ) · withTitle "นาย บุญเลี้ยง ชงสุวรรณ"
 *     · XML OPO_NAME/DRI_ADDRESS · integration /report ส่ง owner_name_emcs/address_emcs ต่อคัน · เว็บ/มือถือ/บอท มีช่องและสูตรครบ
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import { driverAddressLine, opponentAddressLine, withTitle, splitMoo, normalizeDriverAddressFields, normalizeOpponentsAddress } from '../src/services/driverAddress';
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
    ['46/23 หมู่ 7', '7', 'ท้ายบ้าน', '46/23 ม.7 ต.ท้ายบ้าน'],
    ['46/23 หมู่ที่ 7', '', 'ท้ายบ้าน', '46/23 ม.7 ต.ท้ายบ้าน'],          // ISURVEY: หมู่ปนในบ้านเลขที่ → แยกเอง
    ['46/23 ม.7 ต.ท้ายบ้าน', '7', 'ท้ายบ้าน', '46/23 ม.7 ต.ท้ายบ้าน'],
    ['46/23 ต.ท้ายบ้าน หมู่ 7', '', 'ท้ายบ้าน', '46/23 ม.7 ต.ท้ายบ้าน'],   // เรียงใหม่ให้เป็นรูปแบบเดียว
    ['12 ซ.5', 'หมู่ 4', 'ต.บางพลี', '12 ม.4 ซ.5 ต.บางพลี'],              // ม. แทรกถัดจากบ้านเลขที่ (ธรรมเนียม บ้านเลขที่ หมู่ ซอย ถนน)
    ['46/23 หมู่ 17', '7', 'ท้ายบ้าน', '46/23 ม.7 ต.ท้ายบ้าน'],           // ช่องหมู่ที่กรอกมาชนะ
    ['หมู่บ้านสวนสน 12/3', '', '', 'หมู่บ้านสวนสน 12/3'],                 // "หมู่บ้าน" ไม่ใช่หมู่ที่
    ['หมู่บ้านสวนสน 12/3 หมู่ 4', '', '', 'หมู่บ้านสวนสน 12/3 ม.4'],      // แทรกหลังก้อนที่มีตัวเลข ไม่ใช่ก้อนแรก
    ['261ม.2', '', '', '261 ม.2'],                                        // ช่างพิมพ์ติดกัน (ข้อมูลจริง)
    ['450 ซ.เจริญศิลป์ 32 ถ.คำภูแสน', '2', '', '450 ม.2 ซ.เจริญศิลป์ 32 ถ.คำภูแสน'],
    ['60 ม.3 ต.สองพี่น้อง อ.ท่าใหม่ จันทบุรี', '', '', '60 ม.3 ต.สองพี่น้อง อ.ท่าใหม่ จันทบุรี'],   // ที่อยู่เต็มแบบเก่าไม่เพี้ยน
    ['99/1', '', '', '99/1'],
    ['', '', '', ''],
  ];
  for (const [a, m, t, want] of cases) check(`ประกอบ ${JSON.stringify([a, m, t])} → ${JSON.stringify(want)}`, driverAddressLine(a, m, t) === want, JSON.stringify(driverAddressLine(a, m, t)));
  check('รับ null/undefined ได้', driverAddressLine(null, undefined, null) === '' && driverAddressLine('1', null, undefined) === '1');
  check('splitMoo แยกหมู่ทุกรูปแบบ', JSON.stringify(splitMoo('46/23 หมู่ที่ 7')) === '{"address":"46/23","moo":"7"}'
    && splitMoo('ม.12 บ้านโคก').moo === '12' && splitMoo('46/23 หมู่7,ท้ายบ้าน').address === '46/23,ท้ายบ้าน' && splitMoo('46/23').moo === '' && splitMoo('หมู่บ้านสวนสน').moo === ''
    && splitMoo('261ม.2').moo === '2' && splitMoo('261ม.2').address === '261');
  check('normalizeDriverAddressFields: ย้ายหมู่ไปช่องหมู่เฉพาะตอนช่องหมู่ว่าง', (() => {
    const a: Record<string, unknown> = { driver_address: '46/23 หมู่ที่ 7' }; normalizeDriverAddressFields(a);
    const b: Record<string, unknown> = { driver_address: '46/23 หมู่ 7', driver_moo: '9' }; normalizeDriverAddressFields(b);
    const c: Record<string, unknown> = { driver_moo: '' }; normalizeDriverAddressFields(c);
    return a.driver_address === '46/23' && a.driver_moo === '7' && b.driver_address === '46/23 หมู่ 7' && b.driver_moo === '9' && c.driver_address === undefined;
  })());
  const cs = read('backend/src/services/case.service.ts');
  check('case.service เรียก normalizeDriverAddressFields ก่อนเขียนทั้งตอนบันทึก (เว็บ) และส่งงาน (แอป)', (cs.match(/normalizeDriverAddressFields\(data\)/g) ?? []).length === 2);
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
  check('XML: DRI_ADDRESS ผู้ขับขี่รถประกันประกอบผ่าน driverAddressLine · คู่กรณีผ่าน opponentAddressLine',
    xml.includes("el('DRI_ADDRESS', insured ? driverAddressLine(c.driver_address, c.driver_moo, c.driver_subdistrict) : opponentAddressLine(c.address, c.moo, c.subdistrict, c.district, c.home_province))")
    && xml.includes("import { driverAddressLine, opponentAddressLine, withTitle } from './driverAddress'"));
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
  check('เว็บ: หมู่อยู่ในช่องเดียวกับที่อยู่ (แบบบัตรประชาชน+คนไทย) ไม่มี placeholder · มีคำว่า "หมู่" คั่นหน้าช่อง · ไม่มี F แยกของหมู่',
    !/name="driver_moo"[^>]*placeholder=/.test(web) && web.includes('shrink-0 pl-1">หมู่</span>') && !web.includes('<F label="หมู่">')
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

// ── 5) คู่กรณี: คำนำหน้าเจ้าของรถ + ที่อยู่ผู้ขับขี่คู่กรณี 5 ส่วน (16/09/69) ──
{
  const cases: Array<[string, string, string, string, string, string]> = [
    ['46/23', '7', 'ท้ายบ้าน', 'อำเภอเมือง', 'สมุทรปราการ', '46/23 ม.7 ต.ท้ายบ้าน อ.เมือง จ.สมุทรปราการ'],
    ['49/51 หมู่ที่ 3', '', '', 'อำเภอเมือง', 'ชลบุรี', '49/51 ม.3 อ.เมือง จ.ชลบุรี'],                       // ISURVEY: ไม่มีตำบล
    ['12 ซ.5 ถ.สุขุมวิท', '4', 'บางพลี', 'อ.บางพลี', 'จ.สมุทรปราการ', '12 ม.4 ซ.5 ถ.สุขุมวิท ต.บางพลี อ.บางพลี จ.สมุทรปราการ'],   // คำนำหน้าที่พิมพ์มาไม่ซ้ำ
    ['60 ม.3 ต.สองพี่น้อง อ.ท่าใหม่ จันทบุรี', '', '', 'อำเภอท่าใหม่', 'จันทบุรี', '60 ม.3 ต.สองพี่น้อง อ.ท่าใหม่ จันทบุรี'],   // ที่อยู่เต็มแบบเก่า (ข้อมูลจริง) ไม่ต่อซ้ำ
    ['28/1 หมู่ 12', '', 'บางด้วน', 'เขตภาษีเจริญ', 'กรุงเทพ ฯ', '28/1 ม.12 แขวงบางด้วน เขตภาษีเจริญ กรุงเทพฯ'],   // กรุงเทพ: แขวง/เขต ไม่มี จ.
    ['28/1 หมู่ 12 บางด้วน เขตภาษีเจริญ กรุงเทพฯ', '', 'บางด้วน', 'เขตภาษีเจริญ', 'กรุงเทพมหานคร', '28/1 ม.12 บางด้วน เขตภาษีเจริญ กรุงเทพฯ'],
    ['99/1', '', '', '', 'ชลบุรี', '99/1 จ.ชลบุรี'],
    ['', '', '', '', '', ''],
  ];
  for (const [a, m, t, d, p, want] of cases) check(`คู่กรณี ${JSON.stringify([a, m, t, d, p])} → ${JSON.stringify(want)}`, opponentAddressLine(a, m, t, d, p) === want, JSON.stringify(opponentAddressLine(a, m, t, d, p)));
  check('คู่กรณี: รับ null/undefined ได้', opponentAddressLine(null, undefined, null, undefined, null) === '' && opponentAddressLine('1', null, null, null, 'ระยอง') === '1 จ.ระยอง');

  const titles: Array<[string, string, string]> = [
    ['นาย', 'บุญเลี้ยง ชงสุวรรณ', 'นาย บุญเลี้ยง ชงสุวรรณ'],
    ['นาย', 'นายบุญเลี้ยง ชงสุวรรณ', 'นาย บุญเลี้ยง ชงสุวรรณ'],      // พิมพ์คำนำหน้าติดในชื่อมาแล้ว
    ['นาย', 'นาย  บุญเลี้ยง ชงสุวรรณ', 'นาย บุญเลี้ยง ชงสุวรรณ'],
    ['นางสาว', 'น.ส.สมใจ ดี', 'นางสาว สมใจ ดี'],                         // ตัวย่อ = คำเดียวกัน
    ['นาย', 'นายิกา สุข', 'นาย นายิกา สุข'],                             // ชื่อจริงขึ้นต้น "นาย" (สระตาม) ไม่ตัด
    ['', 'นางอุษณีย์ ชงสุวรรณ', 'นางอุษณีย์ ชงสุวรรณ'],                  // เคสเก่าไม่มีคำนำหน้าแยก = ตามเดิม
    ['', 'บริษัท เอ จำกัด', 'บริษัท เอ จำกัด'],
    ['นาย', '', ''],                                                     // มีแต่คำนำหน้า = ไม่มีข้อมูล (บอทใส่ "-")
  ];
  for (const [t, n, want] of titles) check(`withTitle ${JSON.stringify([t, n])} → ${JSON.stringify(want)}`, withTitle(t, n) === want, JSON.stringify(withTitle(t, n)));
  check('normalizeOpponentsAddress: แยกหมู่ทุกคัน เฉพาะคันที่ช่องหมู่ว่าง · ไม่มี opposing_parties ไม่พัง', (() => {
    const d: Record<string, unknown> = { opposing_parties: [{ address: '46/23 หมู่ที่ 7' }, { address: '74 ม.1', moo: '9' }, null, 'x'] };
    normalizeOpponentsAddress(d);
    const o = d.opposing_parties as Array<Record<string, unknown>>;
    const e: Record<string, unknown> = { driver_address: '1' }; normalizeOpponentsAddress(e);
    return o[0].address === '46/23' && o[0].moo === '7' && o[1].address === '74 ม.1' && o[1].moo === '9' && e.opposing_parties === undefined;
  })());
  const cs = read('backend/src/services/case.service.ts');
  check('case.service เรียก normalizeOpponentsAddress คู่กับ normalizeDriverAddressFields (2 จุด)', (cs.match(/normalizeOpponentsAddress\(data\)/g) ?? []).length === 2);
  const xml = read('backend/src/services/xmlExport.service.ts');
  check('XML: OPO_NAME = withTitle(owner_title, owner_name)', xml.includes("el('OPO_NAME', insured ? '' : withTitle(c.owner_title, c.owner_name))"));
  const integ = read('backend/src/routes/integration.routes.ts');
  check('integration /report ส่ง owner_name_emcs + address_emcs ต่อคันคู่กรณี',
    integ.includes('owner_name_emcs: withTitle(o.owner_title, o.owner_name)') && integ.includes('address_emcs: opponentAddressLine(o.address, o.moo, o.subdistrict, o.district, o.home_province)'));
  const xi = read('backend/src/services/xmlImport.service.ts');
  check('นำเข้า XML: คู่กรณีได้ owner_title + moo/subdistrict', xi.includes('owner_title: ownerTitle') && xi.includes('moo: driAddr.moo') && xi.includes("subdistrict: ''"));

  const web = read('web/src/components/cases/RecordEditors.tsx');
  check('เว็บ: คู่กรณีมีช่อง owner_title (select คำนำหน้า) ในช่องเดียวกับชื่อ · ป้าย "เจ้าของรถคู่กรณี *"',
    web.includes("{ k: 'owner_title', label: 'คำนำหน้า', options: TITLES }") && web.includes("label: 'เจ้าของรถคู่กรณี *'") && web.includes('function OwnerNameCell'));
  check('เว็บ: ที่อยู่ผู้ขับขี่คู่กรณี บ้านเลขที่+หมู่ (ช่องเดียว) · จังหวัด · เขต/อำเภอ · ตำบล/แขวง จาก /api/geo/tumbons · เปลี่ยนจังหวัด/อำเภอแล้วล้างตำบล',
    web.includes("{ k: 'moo', label: 'หมู่' }") && web.includes("{ k: 'subdistrict', label: 'ตำบล/แขวง (ที่อยู่)', reqWhen: opponentHasAddress }") && web.includes('function AddressMooCell')
    && web.includes("api.get('/api/geo/tumbons'") && (web.match(/next\.subdistrict = ''/g) ?? []).length >= 2);
  const opp = read('mobile/lib/screens/survey/opponent_editor.dart');
  check('มือถือ: เจ้าของรถคู่กรณี (ชื่อช่องใหม่) + คำนำหน้า · ที่อยู่ผู้ขับขี่ หมู่/จังหวัด/อำเภอ/ตำบล ส่งครบ',
    opp.includes("'owner_title': _ownerTitle") && opp.includes("'เจ้าของรถคู่กรณี'") && !opp.includes("'เจ้าของคู่กรณี'")
    && opp.includes("'moo': _ctl('moo').text.trim()") && opp.includes("'subdistrict': _subdistrict") && opp.includes('tumbonsData'));
  const form = read('mobile/lib/screens/survey_form_screen.dart');
  check('มือถือ: ฟอร์มหลักส่งรายการตำบลให้ editor คู่กรณี (2 จุด) · รายการช่องบังคับใช้ชื่อ "เจ้าของรถคู่กรณี"',
    (form.match(/tumbonsData: _tumbonsData/g) ?? []).length === 2 && form.includes("'owner_name': 'เจ้าของรถคู่กรณี'"));
  check('เว็บ+มือถือ: จังหวัด/อำเภอ/ตำบล ของที่อยู่ผู้ขับขี่คู่กรณี บังคับเมื่อมีข้อมูลที่อยู่ (opponentHasAddress / addrHasData) · "รอตรวจสอบ"/ว่างทั้งหมด ยกเว้น (user เคาะ 16/09/69)',
    (web.match(/reqWhen: opponentHasAddress/g) ?? []).length === 3 && web.includes("a !== 'รอตรวจสอบ'") && web.includes('if (r.pending === true) return false')
    && opp.includes('static bool addrHasData(') && opp.includes("if (_hasAddr && _subdistrict.isEmpty) 'ตำบล/แขวง (ที่อยู่ผู้ขับขี่)'") && (opp.match(/req: _hasAddr/g) ?? []).length === 3
    && form.includes("OpponentEditor.addrHasData(s('address'), s('moo'), s('home_province'), s('district'), s('subdistrict'))") && form.includes("if (it['pending'] == true) return const <String>[];"));
  check('เว็บ: ติ๊ก "รอตรวจสอบ" + ป้ายที่หัวการ์ดคู่กรณี (pending เดียวกับแอป) · เลขบัตร "รอตรวจสอบ" (ชุดเก่า) ไม่เตือน (user สั่ง 16/09/69)',
    web.includes('setPending(i, e.target.checked)') && web.includes('{it.pending === true && (') && web.includes("v.trim() !== PENDING_TEXT && !cidChecksum(v)"));
  // ชุดค่าที่เติมเมื่อติ๊ก — user เคาะ 17/09/69: เจ้าของ "-" · ทะเบียน "00" · รถอื่นๆ (ยี่ห้อว่าง) · จังหวัด อื่นๆ · ชาย + "ไม่ทราบชื่อ" (ไม่ใส่คำนำหน้า/นามสกุล)
  // · 01/01/2500 · ไม่มีบริษัทประกันภัย · กรมธรรม์ "-" — ต้องตรงกันเว็บ/แอป และห้ามกลับไปชุด 16/09 ("รอตรวจสอบ"/เก๋งเอเชีย/-ALL-/อื่นๆ/2525)
  check('เว็บ+มือถือ: ชุดค่า "รอตรวจสอบ" ตรงกัน (user เคาะ 17/09/69) · ไม่เติมคำนำหน้า/นามสกุล/ที่อยู่/เลขบัตร · ยี่ห้อไม่บังคับเมื่อ pending',
    web.includes("fill('owner_name', '-'); fill('plate', '00'); fill('first_name', 'ไม่ทราบชื่อ');") && web.includes("fill('car_type', 'รถอื่นๆ');")
    && web.includes("fill('province', 'อื่นๆ'); fill('gender', 'ชาย'); fill('insurer', NO_INSURER); fill('policy_no', '-');") && web.includes("fill('birthdate', '01/01/2500');")
    && web.includes("if (!chosen(next.car_brand) && carTypeCode(next.car_type) !== 'O') next.car_brand = ALL_BRAND;")
    && !web.includes("fill('title', 'นาย')") && !web.includes('fill(k, PENDING_TEXT)') && !web.includes('01/01/2525')
    && web.includes("reqWhen: (r) => chosen(r.car_type) && r.pending !== true")
    && opp.includes("fill('owner_name', '-');") && opp.includes("fill('plate', '00');") && opp.includes("fill('first_name', 'ไม่ทราบชื่อ');")
    && opp.includes("if (_carType.isEmpty) _carType = 'รถอื่นๆ';") && opp.includes("if (_carBrand.isEmpty && _carType != 'รถอื่นๆ') _carBrand = kAllBrand;")
    && opp.includes("if (_province.isEmpty) _province = 'อื่นๆ';") && opp.includes("if (_gender.isEmpty) _gender = 'ชาย';")
    && opp.includes("if (_insurer.isEmpty) _insurer = 'ไม่มีบริษัทประกันภัย';") && opp.includes("fill('policy_no', '-');") && opp.includes("fill('birthdate', '01/01/2500');")
    && !opp.includes("_title = 'นาย'") && !opp.includes('_pendingText') && !opp.includes('01/01/2525') && !opp.includes("'last_name', 'address', 'cid']"));
  check('มือถือ: สแกนบัตรประชาชนคู่กรณีแล้วเลือกจังหวัด/อำเภอ/ตำบลให้เอง', opp.includes("_matchProvince(f('province'))") && opp.includes("_matchTumbonInText(prov, dist, f('address'))"));
}

// ── ฝั่งบอท (se-autokey ข้าง ๆ — ข้ามถ้าไม่มี) ──
{
  const bot = path.join(ROOT, '..', 'se-autokey');
  if (fs.existsSync(path.join(bot, 'autokey', 'claim_data.py'))) {
    const cd = fs.readFileSync(path.join(bot, 'autokey', 'claim_data.py'), 'utf8');
    const main = fs.readFileSync(path.join(bot, 'main.py'), 'utf8');
    const api = fs.readFileSync(path.join(bot, 'autokey', 'isurvey_api.py'), 'utf8');
    const conv = fs.readFileSync(path.join(bot, 'autokey', 'isurvey_to_sesurvey.py'), 'utf8');
    check('บอท: driver_address_line (สูตรเดียวกัน) · เส้นเว็บใช้ driver_address_emcs ก่อน · เส้น ISURVEY ตรงต่อ ต.<ตำบล> จาก drv_tumbonID',
      cd.includes('def driver_address_line(') && cd.includes('def _insert_moo(') && cd.includes('parts.append(f"ต.{t}")')
      && main.includes("gv('driver_address_emcs') or driver_address_line(") && api.includes('self._tumbon(drv.get("drv_tumbonID"))'));
    check('บอท: คู่กรณี opponent_address_line + with_title · เส้นเว็บใช้ owner_name_emcs/address_emcs ก่อน · เส้น ISURVEY ตรง @address_opp · ตัวดึงงานแยก owner_title/moo/subdistrict',
      cd.includes('def opponent_address_line(') && cd.includes('def with_title(')
      && main.includes('o.get("owner_name_emcs")') && main.includes('o.get("address_emcs")') && main.includes('with_title(o.get("title")')
      && api.includes('"address": ("@address_opp", None)') && conv.includes('"owner_title": otitle') && conv.includes('"subdistrict": api._tumbon(_s(d.get("drv_tumbonID")))'));
  } else {
    console.log('[SKIP] ไม่มี repo se-autokey ข้าง ๆ — ข้ามเทสฝั่งบอท');
  }
}

console.log(failed ? `\n${failed} FAILED ❌` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
