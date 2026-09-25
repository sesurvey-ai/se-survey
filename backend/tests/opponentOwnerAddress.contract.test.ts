/**
 * Contract test — ที่อยู่เจ้าของรถคู่กรณีแยก 5 ช่อง + ติ๊ก "ที่อยู่เดียวกับเจ้าของรถคู่กรณี" (user สั่ง 25/09/69 · APK 1.0.127 · บอท v1.1.40)
 *
 * เดิม "ที่อยู่เจ้าของรถ" เป็นข้อความช่องเดียว ส่วนที่อยู่ผู้ขับขี่คู่กรณีแยก 5 ช่อง → ติ๊กคัดลอกไม่ได้ข้อมูลตรงกัน
 * ล็อกกติกา:
 *  1) คีย์ใน opposing_parties[]: owner_address (บ้านเลขที่/ถนน) · owner_moo · owner_province · owner_district · owner_subdistrict
 *     (ชุดเดียวกับเจ้าของทรัพย์สิน) · ไม่บังคับ (งานจาก ISURVEY มีเป็นข้อความเดียว)
 *  2) EMCS มีช่องข้อความเดียว (txtOpo_Address · dropdown ซ่อน) → XML OPO_ADDRESS + บอท (owner_address_emcs) ใช้ข้อความประกอบ
 *     "46/23 ม.7 ต.ท้ายบ้าน อ.เมือง จ.สมุทรปราการ" สูตรเดียวกับที่อยู่ผู้ขับขี่คู่กรณี · เคสเก่า (ข้อความเดียว) = ข้อความเดิม
 *  3) บันทึก/ส่งงาน: หมู่ที่พิมพ์ปนในที่อยู่เจ้าของรถย้ายไปช่องหมู่ (normalizeOpponentAddressFields)
 *  4) แอป: ติ๊กแล้วคัดลอก 5 ช่องไปที่อยู่ผู้ขับขี่ + ล็อก + ตามไปตลอด · อนุมานติ๊กตอนเปิด · สแกนบัตรผู้ขับขี่ = เอาติ๊กออก
 *  5) เว็บ: 5 ช่อง (บ้านเลขที่+หมู่ · จังหวัด · เขต/อำเภอ · ตำบล) แถวเดียวกัน · เปลี่ยนจังหวัด/อำเภอ = ล้างชั้นล่าง
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import { normalizeOpponentAddressFields, addressLineOrDash } from '../src/services/driverAddress';
import { generateSurveyXml } from '../src/services/xmlExport.service';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}
const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

// ── 2) สูตรข้อความ (ตัวเดียวกับเจ้าของทรัพย์สิน/ผู้บาดเจ็บ) ──
const cases: Array<[unknown[], string]> = [
  [['46/23', '7', 'ท้ายบ้าน', 'อำเภอเมืองสมุทรปราการ', 'สมุทรปราการ'], '46/23 ม.7 ต.ท้ายบ้าน อ.เมืองสมุทรปราการ จ.สมุทรปราการ'],
  [['99/9 ซอยทดสอบ', '', 'บางด้วน', 'เขตภาษีเจริญ', 'กรุงเทพ ฯ'], '99/9 ซอยทดสอบ แขวงบางด้วน เขตภาษีเจริญ กรุงเทพฯ'],
  [['1/1 ถนนวิภาวดี กรุงเทพ ฯ', '', '', '', ''], '1/1 ถนนวิภาวดี กรุงเทพ ฯ'],          // เคสเก่า/ISURVEY ข้อความเดียว = เดิม
  [['รอตรวจสอบ', '', '', '', ''], '-'],
  [['', '', '', '', ''], ''],                                                             // ว่าง → บอทใช้ที่อยู่ผู้ขับขี่แทน (เดิม)
];
const bad = cases.filter(([a, want]) => addressLineOrDash(...(a as [unknown, unknown, unknown, unknown, unknown])) !== want)
  .map(([a, want]) => `${JSON.stringify(a)} → ${addressLineOrDash(...(a as [unknown, unknown, unknown, unknown, unknown]))} ≠ ${want}`);
check('สูตรที่อยู่เจ้าของรถ: 5 ช่อง → ข้อความเดียว · กรุงเทพ แขวง/เขต · ข้อความเดียวแบบเก่า = เดิม · รอตรวจสอบ = "-" · ว่าง = ""', bad.length === 0, bad.join(' ; '));

const xml = generateSurveyXml({
  survey_job_no: 'SEABI-TEST-OWNER', claim_no: 'CLAIM-OWNER', acc_place: 'ทดสอบ', acc_province: 'ชลบุรี', acc_district: 'อำเภอบางละมุง',
  opposing_parties: [
    { plate: '1กก1', province: 'ชลบุรี', first_name: 'ผู้ขับ', last_name: 'ทดสอบ', owner_name: 'เจ้าของ ทดสอบ',
      owner_address: '46/23', owner_moo: '7', owner_subdistrict: 'หนองปรือ', owner_district: 'อำเภอบางละมุง', owner_province: 'ชลบุรี',
      address: '46/23', moo: '7', subdistrict: 'หนองปรือ', district: 'อำเภอบางละมุง', home_province: 'ชลบุรี' },
    { plate: '2กก2', province: 'ชลบุรี', first_name: 'คันที่', last_name: 'สอง', owner_address: '5 ถ.สุขุมวิท ชลบุรี' },
  ],
  injured_persons: [], damaged_property: [],
} as never);
const opo = [...xml.matchAll(/<OPO_ADDRESS>([^<]*)<\/OPO_ADDRESS>/g)].map((m) => m[1]);
check('XML OPO_ADDRESS: ประกอบจาก 5 ช่อง · คันที่ข้อความเดียวแบบเก่า = เดิม · รถประกันว่าง (el() เขียนค่าว่างเป็นช่องว่าง 1 ตัว)',
  JSON.stringify(opo) === JSON.stringify([' ', '46/23 ม.7 ต.หนองปรือ อ.บางละมุง จ.ชลบุรี', '5 ถ.สุขุมวิท ชลบุรี']), JSON.stringify(opo));

const integ = read('backend', 'src', 'routes', 'integration.routes.ts');
check('บอท: /integrations/cases/:id/report ส่ง owner_address_emcs (สูตรเดียวกับ XML)',
  integ.includes('owner_address_emcs: addressLineOrDash(o.owner_address, o.owner_moo, o.owner_subdistrict, o.owner_district, o.owner_province),'));

// ── 3) บันทึก/ส่งงาน: หมู่ที่พิมพ์ปน → ช่องหมู่ · ต./อ./จ. ที่พิมพ์ปนตัดเมื่อมีช่องแยก ──
const o1: Record<string, unknown> = { owner_address: '46/23 ม.7 ต.ท้ายบ้าน', owner_subdistrict: 'ท้ายบ้าน', owner_district: 'อำเภอเมืองสมุทรปราการ', owner_province: 'สมุทรปราการ',
  address: '12 หมู่ 3', subdistrict: '', district: '', home_province: '' };
normalizeOpponentAddressFields(o1);
const o2: Record<string, unknown> = { owner_address: '5 หมู่ 2 ถ.สุขุมวิท', owner_moo: '9' };   // กรอกช่องหมู่มาแล้ว = ไม่แตะ
normalizeOpponentAddressFields(o2);
check('บันทึก: หมู่ปนในที่อยู่เจ้าของรถ → owner_moo · ตำบลที่พิมพ์ปนตัดเมื่อมีช่องแยก · ช่องหมู่กรอกแล้วไม่แตะ · ที่อยู่ผู้ขับขี่ยังทำเหมือนเดิม',
  o1.owner_address === '46/23' && o1.owner_moo === '7' && o1.address === '12' && o1.moo === '3'
  && o2.owner_address === '5 หมู่ 2 ถ.สุขุมวิท' && o2.owner_moo === '9', JSON.stringify({ o1, o2 }));

// ── 4) แอป ──
const ed = read('mobile', 'lib', 'screens', 'survey', 'opponent_editor.dart');
check('แอป: ที่อยู่เจ้าของรถ 5 ช่อง โหลด/บันทึกครบ (owner_moo/owner_province/owner_district/owner_subdistrict)',
  ed.includes("'policy_no', 'claim_no', 'estimated_cost', 'moo', 'owner_moo']) {")
  && ed.includes("_ownerProvince = (widget.data['owner_province'] ?? '').toString();")
  && ed.includes("'owner_moo': _ctl('owner_moo').text.trim(),") && ed.includes("'owner_province': _ownerProvince,")
  && ed.includes("'owner_district': _ownerDistrict,") && ed.includes("'owner_subdistrict': _ownerSubdistrict,")
  && ed.includes("kText(_ctl('owner_address'), 'ที่อยู่เจ้าของรถ (บ้านเลขที่ / ถนน)'"));
check('แอป: ติ๊ก "ที่อยู่เดียวกับเจ้าของรถคู่กรณี" คัดลอกครบ 5 ช่อง · ล็อกช่องผู้ขับขี่ · ทุกช่องของเจ้าของรถสั่งคัดลอกตาม',
  ed.includes("title: const Text('ที่อยู่เดียวกับเจ้าของรถคู่กรณี'")
  && /_ctl\('address'\)\.text = _ctl\('owner_address'\)\.text;\s*_ctl\('moo'\)\.text = _ctl\('owner_moo'\)\.text;\s*_homeProvince = _ownerProvince;\s*_district = _ownerDistrict;\s*_subdistrict = _ownerSubdistrict;/.test(ed)
  && /IgnorePointer\(\s*ignoring: _drvSameAsOwner,[\s\S]{0,200}?kText\(_ctl\('address'\), 'ที่อยู่ปัจจุบัน/.test(ed)
  && (ed.match(/_syncDrvFromOwner\(\); \}\)\),/g) || []).length === 3 && (ed.match(/onChanged: \(_\) => setState\(_syncDrvFromOwner\)\)/g) || []).length === 2);
check('แอป: อนุมานติ๊กตอนเปิดจาก 5 ช่องที่ตรงกัน · สแกนบัตรผู้ขับขี่ที่มีที่อยู่ = เอาติ๊กออก · ช่องที่ขาดบอกให้เติมที่ที่อยู่เจ้าของรถ',
  /_drvSameAsOwner = OpponentEditor\.addrHasData\(_ctl\('owner_address'\)\.text, _ctl\('owner_moo'\)\.text, _ownerProvince, _ownerDistrict, _ownerSubdistrict\)/.test(ed)
  && ed.includes('&& _ownerProvince == _homeProvince && _ownerDistrict == _district && _ownerSubdistrict == _subdistrict;')
  && ed.includes("if (f('address').isNotEmpty || _matchProvince(f('province')) != null) _drvSameAsOwner = false;")
  && ed.includes("'จังหวัด ($_addrWho)'") && ed.includes("String get _addrWho => _drvSameAsOwner ? 'ที่อยู่เจ้าของรถ' : 'ที่อยู่ผู้ขับขี่';")
  && (ed.match(/req: _ownerAddrReq/g) || []).length === 3);

// ── 5) เว็บ ──
const web = read('web', 'src', 'components', 'cases', 'RecordEditors.tsx');
check('เว็บ: ที่อยู่เจ้าของรถ 5 ช่อง (บ้านเลขที่+หมู่ ช่องเดียวกัน · จังหวัด · อำเภอ · ตำบลจาก /api/geo/tumbons) · ไม่บังคับ · เปลี่ยนจังหวัด/อำเภอล้างชั้นล่าง',
  web.includes("{ k: 'owner_address', label: 'ที่อยู่เจ้าของรถ (บ้านเลขที่ / ถนน)' },") && web.includes("{ k: 'owner_moo', label: 'หมู่' },")
  && web.includes("{ k: 'owner_province', label: 'จังหวัด (ที่อยู่เจ้าของรถ)', options: PROVINCE_OPTIONS },")
  && web.includes("{ k: 'owner_subdistrict', label: 'ตำบล/แขวง (ที่อยู่เจ้าของรถ)' },")
  && web.includes('addrKey="owner_address" mooKey="owner_moo" label="ที่อยู่เจ้าของรถ (บ้านเลขที่ / ถนน)"')
  && web.includes("useTumbonOptions(items, (it) => String(it.owner_province ?? ''), 'owner_district', 'owner_subdistrict');")
  && web.includes("if (k === 'owner_province' && v !== String(it.owner_province ?? '')) { next.owner_district = ''; next.owner_subdistrict = ''; }")
  && !web.includes("{ k: 'owner_address', label: 'ที่อยู่เจ้าของรถ', wide: true },"));

// ── บอท (se-autokey ข้าง ๆ — ข้ามถ้าไม่มี) ──
const bot = path.join(root, '..', 'se-autokey');
if (fs.existsSync(path.join(bot, 'main.py'))) {
  const main = fs.readFileSync(path.join(bot, 'main.py'), 'utf8');
  const conv = fs.readFileSync(path.join(bot, 'autokey', 'isurvey_to_sesurvey.py'), 'utf8');
  check('บอท: txtOpo_Address ใช้ owner_address_emcs ก่อน · ไม่มีค่อยประกอบเอง · ตัวดึงงาน ISURVEY แยกหมู่ของที่อยู่เจ้าของรถ',
    main.includes('"opo_address": str(o.get("owner_address_emcs") or "").strip() or opponent_address_line(')
    && conv.includes('"owner_moo": split_moo(_s(r.get("owner_address")))[1],'));
} else {
  console.log('[SKIP] ไม่มี repo se-autokey ข้าง ๆ — ข้ามเทสฝั่งบอท');
}

console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
