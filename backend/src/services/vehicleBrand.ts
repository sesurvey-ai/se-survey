/**
 * ยี่ห้อรถ ↔ ประเภทรถ ตามกติกา EMCS (15/09/69 — เคส #300 เคลม 2026013171675)
 *
 * EMCS กรองลิสต์ยี่ห้อ (ddlCMFG) ตามประเภทรถ (ddlCType): "เก๋งเอเชีย" ไม่มี BENZ/BMW/AUDI ฯลฯ
 * ถ้าข้อมูลบอกเก๋งเอเชีย + MERCEDES-BENZ บอทจะเลือกยี่ห้อไม่ได้แล้วหยุดรอคนกลางทาง
 * และ EMCS ใช้ป้ายยี่ห้อคนละชุดกับ ISURVEY (BENZ ≠ MERCEDES-BENZ)
 *
 * ที่นี่ = กติกาชุดเดียวใช้ 3 ทาง: ตอนดึงงานเข้า (แก้ให้ + จดเตือน) · คำเตือนบนหน้าตรวจ/XML ·
 * บอทตรวจก่อนนำเข้า (ผ่าน GET /api/integrations/car-brands)
 * ⚠️ ฝั่งเว็บมีชุดเดียวกันใน web/src/components/cases/caseOptions.ts (ตาราง + alias) —
 *    contract test ล็อกให้ตรงกัน แก้ที่หนึ่งต้องแก้อีกที่
 */
import { CAR_BRANDS_BY_TYPE } from './carBrandsByType';

export { CAR_BRANDS_BY_TYPE };

export const CAR_TYPE_LABELS: Record<string, string> = {
  A: 'เก๋งเอเชีย', E: 'เก๋งยุโรป', M: 'รถจักรยานยนต์', O: 'รถอื่นๆ', T: 'กระบะ', V: 'รถตู้', W: 'รถบรรทุก',
};

const CAR_TYPE_CODE: Record<string, string> = {
  'เก๋งเอเชีย': 'A', 'เก๋งเอเซีย': 'A', 'เก๋งยุโรป': 'E', 'รถจักรยานยนต์': 'M', 'จักรยานยนต์': 'M',
  'รถอื่นๆ': 'O', 'อื่นๆ': 'O', 'กระบะ': 'T', 'รถกระบะ': 'T', 'รถตู้': 'V', 'รถบรรทุก': 'W',
};

/** ชื่อยี่ห้อที่สะกดต่างจากป้าย EMCS (ISURVEY / คนพิมพ์เอง) → ป้าย EMCS · คีย์พิมพ์ใหญ่ */
export const BRAND_ALIASES: Record<string, string> = {
  'MERCEDES-BENZ': 'BENZ', 'MERCEDES BENZ': 'BENZ', 'MERCEDESBENZ': 'BENZ', 'MERCEDES': 'BENZ',
  'MERCEDES-AMG': 'BENZ', 'MERC': 'BENZ',
  'LAND ROVER': 'LANDROVER', 'LAND-ROVER': 'LANDROVER', 'RANGE ROVER': 'LANDROVER',
  'ROLLS-ROYCE': 'ROLLSROYCE', 'ROLLS ROYCE': 'ROLLSROYCE',
  'ASTON MARTIN': 'ASTONMARTIN', 'ASTON-MARTIN': 'ASTONMARTIN',
  'ALFA ROMEO': 'ALFA', 'ALFA-ROMEO': 'ALFA',
  'HARLEY-DAVIDSON': 'HARLEY', 'HARLEY DAVIDSON': 'HARLEY',
  'VW': 'VOLKSWAGEN', 'CHEVY': 'CHEVROLET',
  'LYNK & CO': 'LYNK CO', 'LYNK&CO': 'LYNK CO', 'MOTO-GUZZI': 'MOTO GUZZI',
  'ROYAL-ENFIELD': 'ROYAL ENFIELD', 'CAN AM': 'CAN-AM',
};

/** ยี่ห้อภาษาไทย (แอป/OCR/งานเก่า) → ป้าย EMCS */
export const THAI_BRANDS: Record<string, string> = {
  'โตโยต้า': 'TOYOTA', 'โตโยตา': 'TOYOTA', 'ฮอนด้า': 'HONDA', 'ฮอนดา': 'HONDA', 'อีซูซุ': 'ISUZU', 'อิซูซุ': 'ISUZU',
  'นิสสัน': 'NISSAN', 'มิตซูบิชิ': 'MITSUBISHI', 'มาสด้า': 'MAZDA', 'ซูซูกิ': 'SUZUKI', 'ซูบารุ': 'SUBARU',
  'ไดฮัทสุ': 'DAIHATSU', 'เลกซัส': 'LEXUS', 'เล็กซัส': 'LEXUS', 'ฮุนได': 'HYUNDAI', 'เกีย': 'KIA', 'เอ็มจี': 'MG',
  'ฟอร์ด': 'FORD', 'เชฟโรเลต': 'CHEVROLET', 'เชฟโรเล็ต': 'CHEVROLET',
  'เมอร์เซเดส-เบนซ์': 'BENZ', 'เมอร์เซเดส': 'BENZ', 'เบนซ์': 'BENZ', 'เบนซ': 'BENZ',
  'บีเอ็มดับเบิลยู': 'BMW', 'บีเอ็มดับบลิว': 'BMW', 'วอลโว่': 'VOLVO', 'ปอร์เช่': 'PORSCHE', 'ออดี้': 'AUDI',
  'เปอโยต์': 'PEUGEOT', 'โฟล์คสวาเกน': 'VOLKSWAGEN', 'มินิ': 'MINI', 'เทสล่า': 'TESLA', 'บีวายดี': 'BYD',
  'ยามาฮ่า': 'YAMAHA', 'คาวาซากิ': 'KAWASAKI', 'เวสป้า': 'VESPA', 'ฮีโน่': 'HINO', 'ฟูโซ่': 'FUSO',
};

const NOT_A_BRAND = new Set(['', 'N/A', 'NA', 'NONE', 'NULL', '0']);

/** ชื่อยี่ห้อ → ป้ายที่ EMCS ใช้ (พิมพ์ใหญ่) · ว่าง/'-'/placeholder → '' */
export function normalizeBrand(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s || s.startsWith('--')) return '';
  if (NOT_A_BRAND.has(s.toUpperCase().replace(/[-./ ]/g, ''))) return '';
  const th = THAI_BRANDS[s];
  if (th) return th;
  const up = s.toUpperCase().replace(/\s+/g, ' ').trim();
  return BRAND_ALIASES[up] ?? up;
}

/** ประเภทรถ (code A/E/M/O/T/V/W หรือป้ายไทย) → code · ไม่รู้จัก → '' */
export function carTypeCode(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^[A-Za-z]$/.test(s)) return CAR_TYPE_LABELS[s.toUpperCase()] ? s.toUpperCase() : '';
  return CAR_TYPE_CODE[s] ?? '';
}

/** ประเภทรถ (code) ที่มียี่ห้อนี้ในลิสต์ EMCS */
export function brandTypesFor(brand: string): string[] {
  const b = normalizeBrand(brand);
  if (!b) return [];
  return Object.keys(CAR_BRANDS_BY_TYPE).filter((t) => CAR_BRANDS_BY_TYPE[t].includes(b));
}

export type BrandTypeIssue = {
  brand: string; typeCode: string; typeLabel: string;
  /** ประเภทรถที่มียี่ห้อนี้ (code) — ว่าง = สะกดไม่ตรง EMCS เลย */
  typesWithBrand: string[];
  /** ประเภทที่ควรเปลี่ยนไป (code) — มีเมื่อชี้ได้แน่ (ยี่ห้อมีประเภทเดียว หรือเก๋งอีกฝั่ง) */
  suggestion: string | null;
  message: string;
};

/** ยี่ห้อกับประเภทรถเข้ากันตามลิสต์ EMCS ไหม — null = ไม่มีปัญหา (รวมกรณีค่าว่าง/ประเภทไม่รู้จัก) */
export function brandTypeIssue(type: unknown, brand: unknown): BrandTypeIssue | null {
  const code = carTypeCode(type);
  const b = normalizeBrand(brand);
  if (!code || !b) return null;
  const list = CAR_BRANDS_BY_TYPE[code];
  if (!list || list.includes(b)) return null;
  const types = brandTypesFor(b);
  let suggestion: string | null = null;
  if (types.length === 1) suggestion = types[0];
  else if (types.length > 1) {
    const twin = code === 'A' ? 'E' : code === 'E' ? 'A' : null;   // เก๋งเอเชีย ↔ เก๋งยุโรป
    if (twin && types.includes(twin)) suggestion = twin;
  }
  const message = types.length === 0
    ? `ยี่ห้อ "${b}" ไม่มีในลิสต์ยี่ห้อของ EMCS เลย — เลือกยี่ห้อใหม่จากลิสต์`
    : `ยี่ห้อ "${b}" ไม่มีในประเภทรถ ${CAR_TYPE_LABELS[code]} ของ EMCS (มีใน: ${types.map((t) => CAR_TYPE_LABELS[t]).join(' / ')})`;
  return { brand: b, typeCode: code, typeLabel: CAR_TYPE_LABELS[code], typesWithBrand: types, suggestion, message };
}

/**
 * ทำให้ยี่ห้อ/ประเภทรถของรายงานตรงกติกา EMCS ตั้งแต่ตอนนำเข้า (ISURVEY สด / ไฟล์ XML) — แก้ในที่
 *  - ยี่ห้อ → ป้าย EMCS (MERCEDES-BENZ → BENZ, ไทย → อังกฤษ)
 *  - ยี่ห้อไม่มีในประเภทที่ให้มา แต่ชี้ประเภทที่ถูกได้แน่ → เปลี่ยนประเภทให้ + จดเตือนให้หัวหน้าตรวจ
 *  - ชี้ไม่ได้ → จดเตือนอย่างเดียว (หัวหน้าแก้เองบนหน้าตรวจ ซึ่งกั้นอนุมัติไว้)
 * คืนรายการคำเตือน (ไทย) สำหรับ import_warnings
 */
export function normalizeVehicleFields(report: Record<string, unknown>): string[] {
  const notes: string[] = [];
  const fix = (rec: Record<string, unknown>, who: string) => {
    const rawBrand = String(rec.car_brand ?? '').trim();
    const nb = normalizeBrand(rawBrand);
    if (rawBrand && nb && nb !== rawBrand) rec.car_brand = nb;
    const issue = brandTypeIssue(rec.car_type, rec.car_brand);
    if (!issue) return;
    if (issue.suggestion) {
      const asCode = /^[A-Za-z]$/.test(String(rec.car_type ?? '').trim());
      const to = CAR_TYPE_LABELS[issue.suggestion];
      rec.car_type = asCode ? issue.suggestion : to;
      notes.push(`${who}: ประเภทรถ "${issue.typeLabel}" ไม่มียี่ห้อ ${issue.brand} ใน EMCS — ระบบเปลี่ยนเป็น "${to}" ให้ ตรวจสอบก่อนอนุมัติ`);
    } else {
      notes.push(`${who}: ${issue.message}`);
    }
  };
  fix(report, 'รถประกัน');
  let ops = report.opposing_parties;
  if (typeof ops === 'string') { try { ops = JSON.parse(ops); } catch { ops = null; } }
  if (Array.isArray(ops)) {
    ops.forEach((o, i) => { if (o && typeof o === 'object') fix(o as Record<string, unknown>, `คู่กรณีคันที่ ${i + 1}`); });
    report.opposing_parties = ops;
  }
  return notes;
}
