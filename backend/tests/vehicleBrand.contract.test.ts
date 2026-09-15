/**
 * Contract test — ยี่ห้อ ↔ ประเภทรถ ตาม EMCS + วันที่ต้องเป็นวันจริง (15/09/69 เคส #299 / #300)
 *
 * ล็อกกติกา:
 *  1) ตารางยี่ห้อ/alias/ชื่อไทย ฝั่ง backend (vehicleBrand.ts) กับฝั่งเว็บ (caseOptions.ts) ต้องเหมือนกันเป๊ะ
 *  2) normalizeBrand: MERCEDES-BENZ → BENZ (ป้าย EMCS) · ไทย → อังกฤษ · '-' → ''
 *  3) brandTypeIssue: เก๋งเอเชีย + BENZ = ปัญหา (เสนอเก๋งยุโรป) · TOYOTA อยู่ทั้งสองฝั่ง = ไม่มีปัญหา
 *  4) normalizeVehicleFields แก้ประเภท/ยี่ห้อตอนนำเข้า + จดเตือน · importFromXml เรียกใช้
 *  5) parseSe ปัด "00/00/2569" / "31/02/2569" (EMCS ปัดตกทั้งไฟล์) · isValidSeDate ฝั่งเว็บให้ผลเดียวกัน
 *  6) emcsNameWarnings ครอบวันที่ไม่จริง + ยี่ห้อไม่ตรงประเภท · เว็บ/บอทมีตัวกั้น
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';
import {
  CAR_BRANDS_BY_TYPE, BRAND_ALIASES, THAI_BRANDS, normalizeBrand, brandTypeIssue, normalizeVehicleFields, normalizeDamageLevels,
} from '../src/services/vehicleBrand';
import {
  CAR_BRANDS_BY_TYPE as WEB_BRANDS, BRAND_ALIASES as WEB_ALIASES, THAI_BRANDS as WEB_THAI,
  brandTypeIssue as webBrandTypeIssue, isValidSeDate,
} from '../../web/src/components/cases/caseOptions';
import { parseSe, emcsNameWarnings } from '../src/services/xmlExport.service';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// 1) สองฝั่งต้องตรงกัน
check('ตารางยี่ห้อตามประเภทรถ backend = web', JSON.stringify(CAR_BRANDS_BY_TYPE) === JSON.stringify(WEB_BRANDS));
check('ตาราง alias ยี่ห้อ backend = web', JSON.stringify(BRAND_ALIASES) === JSON.stringify(WEB_ALIASES));
check('ตารางยี่ห้อไทย backend = web', JSON.stringify(THAI_BRANDS) === JSON.stringify(WEB_THAI));
check('ทุก alias/ชื่อไทย ชี้ไปยี่ห้อที่มีในลิสต์ EMCS จริง',
  [...Object.values(BRAND_ALIASES), ...Object.values(THAI_BRANDS)]
    .every((b) => Object.values(CAR_BRANDS_BY_TYPE).some((l) => l.includes(b))));

// 2) normalizeBrand
check('normalizeBrand: MERCEDES-BENZ/mercedes benz/เบนซ์ → BENZ · Mazda → MAZDA · โตโยต้า → TOYOTA · "-"/"-- ระบุ --" → ""',
  normalizeBrand('MERCEDES-BENZ') === 'BENZ' && normalizeBrand('mercedes benz') === 'BENZ' && normalizeBrand('เบนซ์') === 'BENZ'
  && normalizeBrand('Mazda') === 'MAZDA' && normalizeBrand('โตโยต้า') === 'TOYOTA'
  && normalizeBrand('-') === '' && normalizeBrand('-- ระบุ --') === '' && normalizeBrand('') === '');

// 3) brandTypeIssue
const iss = brandTypeIssue('เก๋งเอเชีย', 'MERCEDES-BENZ');
check('เก๋งเอเชีย + MERCEDES-BENZ = ปัญหา เสนอเปลี่ยนเป็นเก๋งยุโรป', !!iss && iss.suggestion === 'E' && iss.brand === 'BENZ' && /เก๋งยุโรป/.test(iss.message));
check('code A + TOYOTA / E + TOYOTA (มีทั้งสองฝั่ง) / ว่าง = ไม่มีปัญหา',
  brandTypeIssue('A', 'TOYOTA') === null && brandTypeIssue('E', 'TOYOTA') === null
  && brandTypeIssue('A', '') === null && brandTypeIssue('', 'BENZ') === null && brandTypeIssue('A', '-- ระบุ --') === null);
check('ยี่ห้อที่ไม่มีในลิสต์ไหนเลย = เตือนว่าไม่มีใน EMCS (ไม่มีข้อเสนอ)',
  (() => { const x = brandTypeIssue('T', 'FOOBAR'); return !!x && x.suggestion === null && /ไม่มีในลิสต์/.test(x.message); })());
check('web brandTypeIssue ให้ผลเดียวกับ backend',
  JSON.stringify(webBrandTypeIssue('เก๋งเอเชีย', 'MERCEDES-BENZ')) === JSON.stringify(iss)
  && webBrandTypeIssue('A', 'TOYOTA') === null);

// 4) normalizeVehicleFields
{
  const rep: Record<string, unknown> = {
    car_type: 'A', car_brand: 'MERCEDES-BENZ',
    opposing_parties: [{ car_type: 'เก๋งเอเชีย', car_brand: 'mercedes benz' }, { car_type: 'เก๋งเอเชีย', car_brand: 'TOYOTA' }],
  };
  const notes = normalizeVehicleFields(rep);
  const ops = rep.opposing_parties as Record<string, unknown>[];
  check('นำเข้า: รถประกัน A+MERCEDES-BENZ → E+BENZ (code คงเป็น code)', rep.car_type === 'E' && rep.car_brand === 'BENZ');
  check('นำเข้า: คู่กรณี เก๋งเอเชีย+mercedes benz → เก๋งยุโรป+BENZ (ป้ายไทยคงเป็นป้าย) · TOYOTA ไม่แตะ',
    ops[0].car_type === 'เก๋งยุโรป' && ops[0].car_brand === 'BENZ' && ops[1].car_type === 'เก๋งเอเชีย' && ops[1].car_brand === 'TOYOTA');
  check('นำเข้า: จดเตือน 2 รายการให้หัวหน้าตรวจ', notes.length === 2 && /รถประกัน/.test(notes[0]) && /คู่กรณีคันที่ 1/.test(notes[1]));
  const cs = read('src/services/case.service.ts');
  check('importFromXml เรียก normalizeVehicleFields และเก็บคำเตือนลง import_warnings',
    /const vehicleNotes = \[\.\.\.normalizeVehicleFields\(report\), \.\.\.sanitizeReportDates\(report\), \.\.\.normalizeDamageLevels\(report\)\]/.test(cs)
    && /parsed\.warnings = \[\.\.\.\(parsed\.warnings \?\? \[\]\), \.\.\.vehicleNotes\]/.test(cs));
}

// 4b) ระดับความเสียหาย (เคส #343)
{
  const rep: Record<string, unknown> = {
    insured_damage: [{ part: 'กันชนหน้า', level: 'แผลเบา' }, { part: 'ประตู', level: 'B' }, { part: 'ไฟหน้า', level: '' }],
    opposing_parties: [{ damage: [{ part: 'ฝาปิดน้ำมัน', level: 'เปลี่ยน' }, { part: 'กันชนหลัง', level: 'ปานกลางมาก' }] }],
  };
  const notes = normalizeDamageLevels(rep);
  const ins = rep.insured_damage as Record<string, unknown>[];
  const opp = (rep.opposing_parties as Record<string, unknown>[])[0].damage as Record<string, unknown>[];
  check('นำเข้า: ระดับ แผลเบา→L · B→M · เปลี่ยน→X (คำแปลก/ว่าง คงไว้)',
    ins[0].level === 'L' && ins[1].level === 'M' && ins[2].level === '' && opp[0].level === 'X' && opp[1].level === 'ปานกลางมาก');
  check('นำเข้า: จดเตือนชิ้นที่ยังไม่มีระดับ (รถประกัน 1 · คู่กรณี 1)',
    notes.length === 2 && /รถประกัน.*ไฟหน้า/.test(notes[0]) && /คู่กรณีคันที่ 1.*กันชนหลัง/.test(notes[1]));
  const cs = read('src/services/case.service.ts');
  check('importFromXml เรียก normalizeDamageLevels ด้วย', /normalizeDamageLevels\(report\)/.test(cs));
  const cd = fs.readFileSync(path.join(__dirname, '..', '..', 'web/src/components/cases/CaseDetail.tsx'), 'utf8');
  const re = fs.readFileSync(path.join(__dirname, '..', '..', 'web/src/components/cases/RecordEditors.tsx'), 'utf8');
  check('เว็บ: ประตูอนุมัตินับเฉพาะชิ้นที่ระดับเป็น L/M/H/X + กั้นชิ้นที่ไม่มีระดับ (รถประกัน + คู่กรณี)',
    /DAMAGE_LEVEL_OK\.has\(x\.level\)/.test(cd) && /badDamageLevels > 0/.test(cd) && /\.map\(\(\) => 'damage_level'\)/.test(re));
}

// 5) วันที่ต้องเป็นวันจริง
check('parseSe ปัด 00/00/2569 · 31/02/2569 · 13/13/2569 · "-"', parseSe('00/00/2569') === null && parseSe('31/02/2569') === null
  && parseSe('13/13/2569') === null && parseSe('-') === null);
check('parseSe รับ 13/09/2542 · 8/4/2538 · 15/09/2026 (ค.ศ.→พ.ศ.) · 29/02/2567 (ปีอธิกสุรทิน)',
  parseSe('13/09/2542')?.d === '13' && parseSe('8/4/2538')?.m === '04' && parseSe('15/09/2026')?.yBE === 2569 && parseSe('29/02/2567') !== null);
check('web isValidSeDate ให้ผลเดียวกัน', !isValidSeDate('00/00/2569') && !isValidSeDate('31/02/2569') && isValidSeDate('13/09/2542')
  && isValidSeDate('8/4/2538') && isValidSeDate('29/02/2567') && isValidSeDate(''));

// 6) คำเตือน + ตัวกั้น
{
  const w = emcsNameWarnings({
    car_type: 'A', car_brand: 'BENZ', driver_birthdate: '00/00/2569',
    opposing_parties: [{ car_type: 'เก๋งเอเชีย', car_brand: 'MERCEDES-BENZ', birthdate: '-', license_end: '30/02/2570' }],
  } as never);
  const tags = w.map((x) => `${x.tag}:${x.label}`);
  check('emcsNameWarnings: ยี่ห้อรถประกัน + คู่กรณี + วันเกิด 00/00 + ใบขับขี่ 30/02 (ข้าม "-")',
    tags.includes('CMFG:ยี่ห้อรถประกัน') && tags.includes('CMFG:ยี่ห้อรถคู่กรณีคันที่ 1')
    && tags.includes('DRI_BIRTHDAY:วันเกิดผู้ขับขี่รถประกัน') && tags.includes('DRI_DRVDATE_END:ใบขับขี่คู่กรณีคันที่ 1 หมดอายุวันที่')
    && !tags.includes('DRI_BIRTHDAY:วันเกิดผู้ขับขี่รถคู่กรณีคันที่ 1'), tags.join(' | '));
  const re = fs.readFileSync(path.join(__dirname, '..', '..', 'web/src/components/cases/RecordEditors.tsx'), 'utf8');
  check('เว็บ: opponentMissing นับวันที่ไม่จริง + ยี่ห้อไม่ตรงประเภท (กั้นอนุมัติ)',
    /opponentMissing = [\s\S]*?isValidSeDate\(v\)[\s\S]*?brandTypeIssue\(rec\.car_type, rec\.car_brand\)/.test(re));
  const cd = fs.readFileSync(path.join(__dirname, '..', '..', 'web/src/components/cases/CaseDetail.tsx'), 'utf8');
  check('เว็บ: หน้าเคสกั้นอนุมัติเมื่อยี่ห้อรถประกันไม่ตรงประเภท / วันที่ผู้ขับขี่ไม่จริง',
    /\.\.\.\(carBrandIssue \? \[/.test(cd) && /\.\.\.badDrvDates\.map\(/.test(cd));
  const ir = read('src/routes/integration.routes.ts');
  check('บอทดึงตารางได้จาก GET /api/integrations/car-brands', /router\.get\('\/car-brands', integrationAuth/.test(ir));
}

console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
process.exit(failed ? 1 : 0);
