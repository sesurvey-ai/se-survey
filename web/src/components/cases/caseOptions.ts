// ตัวเลือก dropdown สำหรับหน้ารายละเอียดเคส

export const PROVINCE_OPTIONS = [
  '-- ระบุ --', 'กระบี่', 'กรุงเทพ ฯ', 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร',
  'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร',
  'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก', 'นครนายก', 'นครปฐม', 'นครพนม',
  'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน',
  'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี', 'พะเยา',
  'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'แพร่',
  'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด',
  'ระนอง', 'ระยอง', 'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ',
  'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร',
  'สระแก้ว', 'สระบุรี', 'สิงห์บุรี', 'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี',
  'สุรินทร์', 'หนองคาย', 'หนองบัวลำภู', 'พระนครศรีอยุธยา', 'อ่างทอง',
  'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี', 'เบตง',
  'บึงกาฬ', 'อื่นๆ',
];

// ยี่ห้อรถ — sync EMCS master ddlCMFG แยกตาม 'ประเภทรถ' (ddlCType) 2026-07-25
// EMCS กรองลิสต์ยี่ห้อตามประเภทรถ: 350 ยี่ห้อไม่ซ้ำ แต่ 231 ตัวมีอยู่แค่ประเภทเดียว
export const CAR_BRANDS_BY_TYPE: Record<string, string[]> = {
  // เก๋งเอเชีย
  A: [
    'AION', 'ASIACAB', 'ATTHAM', 'AVATR', 'BAOJUN', 'BORGWARD', 'BYD', 'CHANGAN',
    'CHERY', 'DAEWOO', 'DAIHATSU', 'DATSUN', 'DFM', 'FOMM', 'FORD', 'GEELY', 'HAVAL',
    'HINDUSTAN', 'HONDA', 'HONGQI', 'HUASONG', 'HYUNDAI', 'ISUZU', 'JAECOO', 'JETOUR', 'JONWAY',
    'JUNEYAO', 'KIA', 'LEAPMOTOR', 'LEPAS', 'LEXUS', 'LI AUTO', 'LUXGEN', 'LYNK CO', 'MAHINDRA',
    'MAZDA', 'MG', 'MITSUBISHI', 'MITSUOKA', 'NASA', 'NAZA', 'NETA', 'NIO', 'NISSAN', 'OMODA',
    'ORA', 'PERODUA', 'POCCO', 'PORSCHE', 'PROTON', 'SKODA', 'SSANGYONG', 'SUBARU', 'SUZUKI',
    'TANK', 'TATA', 'TOYOTA', 'TRUMPCHI', 'VIAUTO', 'VINFAST', 'VMC', 'VOLT', 'WEIAO BOMA',
    'WELTMEISTER', 'WEY', 'WULING', 'XPENG', 'ZEEKR', 'ZOTYE',
  ],
  // เก๋งยุโรป
  E: [
    'ALFA', 'ALLARD', 'ALPINE', 'AMC JAVELIN', 'ASTONMARTIN', 'AUDI', 'AUSTIN',
    'BENTLEY', 'BENZ', 'BMW', 'BYD', 'CADILLAC', 'CHEVROLET', 'CHRYSLER', 'CITROEN', 'DAIMLER',
    'DODGE', 'EM', 'FERRARI', 'FIAT', 'FORD', 'HILLMAN', 'HOLDEN', 'HUMMER', 'JAGUAR', 'JEEP',
    'LAMBORGHINI', 'LANCIA', 'LANDROVER', 'LEXUS', 'LINCOLN', 'LONDON', 'LOTUS', 'MASERATI',
    'MAZDA', 'MCLAREN', 'MERCER', 'MG', 'MINI', 'MORRIS', 'OLDSMOBILE', 'OPEL', 'PEUGEOT',
    'PONTIAC', 'PORSCHE', 'RENAULT', 'ROEWE', 'ROLLSROYCE', 'ROVER', 'SAAB', 'SEAT', 'SIMCA',
    'SKODA', 'SMART', 'SUZUKI', 'TATRA', 'TESLA', 'TOYOTA', 'VOLKSWAGEN', 'VOLVO',
  ],
  // รถจักรยานยนต์
  M: [
    'AJ', 'ALPHA VOLANTIS', 'APRILIA', 'ATV', 'BAJAJ', 'BENELLI', 'BICOSE', 'BMW',
    'CAGIVA', 'CAN-AM', 'CFMOTO', 'DECO', 'DUCATI', 'EM', 'ENGY', 'ETRAN', 'EVO', 'GPX',
    'HANWAY', 'HAONAIQI', 'HARDE', 'HARLEY', 'HARLEYDEVIDSON', 'HONDA', 'HSEM', 'HUNTER',
    'HUSABER', 'I-MOTOR', 'ISUZU', 'JONWAY', 'JRD', 'KAVALLO', 'KAWASAKI', 'KEEWAY', 'KOZAWA',
    'KTM', 'L&P', 'LAMBRETTA', 'LIFAN', 'LION', 'LONCIN', 'LUCKY', 'LUYUAN', 'MALAGUTI', 'MJNT',
    'MODENAS', 'MODYAK', 'MOTO GUZZI', 'MOTO PARILLA', 'MZ', 'NISSAN', 'NIU', 'NKT', 'PATTINUM',
    'PEDA', 'PEUGEOT', 'PIAGGIO', 'PLATINUM', 'RAPID', 'ROYAL ALLOY', 'ROYAL ENFIELD', 'RYUKA',
    'SACHS', 'SCOMADI', 'SHINERAY', 'SLEEK', 'STALLIONS', 'STAR8', 'STROM', 'SUZUKI',
    'SWAP AND GO', 'SWM', 'SYM', 'TIGER', 'TOMAS', 'TRIUMPH', 'VARETA', 'VESPA', 'VINFAST',
    'VMOTO', 'YADEA', 'YAMAHA', 'ZONGSHEN', 'ZONTES',
  ],
  // รถอื่นๆ
  O: [
    'AICHI', 'ANKAI', 'APRILIA', 'ASHOK LEYLAND', 'ASIASTAR', 'ATV', 'BAOJUN', 'BENELLI',
    'BENZ', 'BIZNEX', 'BMC', 'BMW', 'BOBCAT', 'BOMAG', 'BONLUCK', 'BYD', 'CAMC', 'CATERPILLAR',
    'CFMOTO', 'CHANGLIN', 'CHEETAH', 'CHERY', 'CIAGIA', 'CLAAS', 'DAEWOO', 'DAF', 'DAIHATSU',
    'DAYUN', 'DENWAY', 'DEVA', 'DFM', 'DONGFENG', 'DUCATI', 'EAGLE', 'EUROTRAC', 'EVT', 'FAW',
    'FORD', 'FOTON', 'FURUKAWA', 'GALION', 'GENIE', 'GOLDENDRAGON', 'GOLDHOFER', 'GPX', 'GTM',
    'HALLA', 'HANIX', 'HAONAIQI', 'HARLEYDEVIDSON', 'HENGTONG', 'HIDROMEK', 'HIGER', 'HINO',
    'HINOTA', 'HITACHI', 'HONDA', 'HUAJIAN', 'HUMMER', 'HUNTER', 'HYDROQUIP', 'HYMER', 'HYSTER',
    'HYUNDAI', 'IHI', 'IMIO', 'INGERSOLLRAND', 'INTERNATIONAL', 'ISKI', 'ISUZU', 'IVECO', 'JAC',
    'JCB', 'JGM', 'JIAHE', 'JMC', 'JNT', 'JOHNSTON', 'JRD', 'KALMAR', 'KATO', 'KAVALLO',
    'KAWASAKI', 'KIA', 'KINGLONG', 'KOBELCO', 'KOMATSU', 'KRUPP', 'KTM', 'KUBOTA', 'LEYLAND',
    'LIBAMOTOR', 'LIEBHERR', 'LIFAN', 'LIUGONG', 'LONKING', 'LOVOL', 'LV', 'MACK', 'MAN',
    'MARSHELL', 'MASSEY FERGUSON', 'MAX LOGGER', 'MAZDA', 'MEADOW', 'MG', 'MIDEA', 'MINE',
    'MINI', 'MITSUBISHI', 'MODYAK', 'MONIKA', 'NAGANO', 'NEX', 'NICHIYU', 'NIIGATA', 'NISSAN',
    'OMNIA', 'ORA', 'P&H', 'PANUS', 'PETERBILT', 'PIAGGIO', 'PLATINUM', 'RCK', 'ROADTEC',
    'ROSENBAUER', 'ROYAL ALLOY', 'ROYAL ENFIELD', 'SAKUN.C', 'SAMMITR', 'SANY', 'SCANIA',
    'SDLG', 'SHACMAN', 'SHANTUI', 'SINGTHAI', 'SINOMACH', 'SINOTRUK', 'SKYWELL', 'SOKON',
    'STALLIONS', 'STEYR', 'SUMITOMO', 'SUNLONG', 'SUNWARD', 'SUZUKI', 'SYZG', 'TADANO',
    'TALAYTHONG', 'TATA', 'TCM', 'TEREX', 'TESLA', 'THAINA', 'TIGER', 'TKING', 'TOYOTA',
    'TRAILER', 'TRIUMPH', 'VESPA', 'VOLVO', 'WIRTGEN', 'XCMG', 'XGMA', 'XINYUAN', 'YADEA',
    'YAMAHA', 'YANMAR', 'YAXING', 'YBM', 'YUCHAI', 'YUTONG', 'ZHONGTONG', 'ZOOMLION',
  ],
  // กระบะ
  T: [
    'BENZ', 'BYD', 'CHANGAN', 'CHEVROLET', 'CITROEN', 'DAIHATSU', 'DATSUN', 'DFM',
    'DODGE', 'FIREBRIGHT', 'FORD', 'FOTON', 'GMC', 'HONDA', 'HUANGHAI', 'INTERNATIONAL',
    'ISUZU', 'JAC', 'JEEP', 'KARRY', 'KIA', 'KINGLONG', 'MAZDA', 'MG', 'MITSUBISHI', 'NEX',
    'NEXTEM', 'NISSAN', 'OPEL', 'PEUGEOT', 'POER', 'RAM', 'RELY', 'RIDDARA', 'SAMMITR',
    'SKYWELL', 'SUZUKI', 'TAKANO', 'TATA', 'THAIRUNG', 'TOYOTA', 'VOLKSWAGEN', 'WULING',
  ],
  // รถตู้
  V: [
    'AION', 'BENZ', 'BYD', 'CHEVROLET', 'CHRYSLER', 'CITROEN', 'DAIHATSU', 'DATSUN',
    'DENZA', 'DFM', 'FARIZON', 'FORD', 'FOTON', 'GMC', 'HIGER', 'HINO', 'HONDA', 'HYUNDAI',
    'ISUZU', 'JINBEI', 'JOYLONG', 'KARRY', 'KIA', 'KYC', 'LEXUS', 'MAXUS', 'MAZDA', 'MG',
    'MITSUBISHI', 'NISSAN', 'PEUGEOT', 'POLARSUN', 'RELY', 'RENAULT', 'ROEWE', 'SKYWELL',
    'SOKON', 'SUBARU', 'SUZUKI', 'THAIRUNG', 'TOYOTA', 'TRUMPCHI', 'VOLKSWAGEN', 'WEY',
    'WULING', 'XPENG', 'ZEEKR', 'ZHONGTONG',
  ],
  // รถบรรทุก
  W: [
    'BEIBEN', 'BENZ', 'BMC', 'BMW', 'CAMC', 'CHENGLONG', 'DAF', 'DAYUN', 'DEVA', 'DFM',
    'DONGFENG', 'EVO', 'FAW', 'FORD', 'FOTON', 'FUSO', 'HILLMAN', 'HINO', 'HONGYANG', 'HYUNDAI',
    'ISUZU', 'IVECO', 'JAC', 'JMC', 'KIA', 'MAN', 'MAZDA', 'MINE', 'MITSUBISHI', 'NEOMOR',
    'NEX', 'NISSAN', 'REO', 'RILEY', 'SAMMIT', 'SAMMITR', 'SANY', 'SCANIA', 'SERES', 'SHACMAN',
    'SHINERAY', 'SINOTRUK', 'SKYWELL', 'SOKON', 'STEYR', 'TADANO', 'TATA', 'TATRA', 'THAINA',
    'TKING', 'TOYOTA', 'TRAILER', 'UD TRUCKS', 'UDTRUCKS', 'VOLVO', 'WIRTGEN', 'WULING', 'XCMG',
    'YUCHAI', 'YUTONG',
  ],
};

/** ป้ายไทย → code — คู่กรณีเก็บ "ประเภทรถ" เป็นป้ายไทย ('เก๋งเอเชีย') ไม่ใช่ code
 *  ตารางยี่ห้อข้างบน key เป็น code → ถ้าไม่แปลงก่อน ลิสต์ยี่ห้อของคู่กรณีจะว่างเปล่าทุกคัน
 *  (มือถือแปลงทางกลับกันอยู่แล้วที่ carBrandsFor ใน survey_master.dart) */
const CAR_TYPE_LABEL_TO_CODE: Record<string, string> = {
  'เก๋งเอเชีย': 'A', 'เก๋งยุโรป': 'E', 'รถจักรยานยนต์': 'M', 'รถอื่นๆ': 'O',
  'กระบะ': 'T', 'รถตู้': 'V', 'รถบรรทุก': 'W',
};

/** ตัวเลือกยี่ห้อของประเภทรถนี้ — รับได้ทั้ง code (A/E/M/O/T/V/W) และป้ายไทย
 *  current: ค่าที่บันทึกไว้แล้ว ถ้าไม่อยู่ในลิสต์ (ข้อมูลเก่าเป็นไทย เช่น 'เอ็มจี')
 *  ให้คงไว้เป็นตัวเลือก ไม่งั้น select จะเด้งไป '-- ระบุ --' แล้วเซฟทับค่าเดิมทิ้ง */
/** ยี่ห้อ "-ALL-" = ตัวเลือกจริงใน ddlCMFG ของ EMCS ทุกประเภทรถ ยกเว้น รถอื่นๆ (user พบ 16/09/69) — ใช้ตอน "รอตรวจสอบ"/ไม่ทราบยี่ห้อ
 *  ไม่อยู่ในตาราง CAR_BRANDS_BY_TYPE (ตารางนั้น sync จาก EMCS และล็อก backend=web) จึงเติมให้ตรงนี้ · ชุดเดียวกับแอป (survey_master.dart kAllBrand) */
export const ALL_BRAND = '-ALL-';

export function carBrandOptions(carType?: string | null, current?: string | null): string[] {
  const raw = (carType || '').trim();
  const code = CAR_TYPE_LABEL_TO_CODE[raw] ?? raw;
  const list = CAR_BRANDS_BY_TYPE[code] ?? [];
  const all = list.length && code !== 'O' ? [ALL_BRAND] : [];
  const cur = (current || '').trim();
  const keep = cur && cur !== '-- ระบุ --' && !list.includes(cur) && !all.includes(cur) ? [cur] : [];
  return ['-- ระบุ --', ...all, ...list, ...keep];
}

// ── ยี่ห้อ ↔ ประเภทรถ ตามกติกา EMCS (15/09/69 เคส #300: เก๋งเอเชีย + MERCEDES-BENZ อนุมัติผ่านแล้วบอทติดที่ EMCS) ──
// ⚠️ ชุดเดียวกับ backend/src/services/vehicleBrand.ts — contract test ล็อกให้ตรงกัน แก้ที่หนึ่งต้องแก้อีกที่
export const CAR_TYPE_LABELS: Record<string, string> = {
  A: 'เก๋งเอเชีย', E: 'เก๋งยุโรป', M: 'รถจักรยานยนต์', O: 'รถอื่นๆ', T: 'กระบะ', V: 'รถตู้', W: 'รถบรรทุก',
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

/** ประเภทรถ (code หรือป้ายไทย) → code · ไม่รู้จัก → '' */
export function carTypeCode(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  if (/^[A-Za-z]$/.test(s)) return CAR_TYPE_LABELS[s.toUpperCase()] ? s.toUpperCase() : '';
  return CAR_TYPE_LABEL_TO_CODE[s] ?? (s === 'เก๋งเอเซีย' ? 'A' : '');
}

export type BrandTypeIssue = {
  brand: string; typeCode: string; typeLabel: string; typesWithBrand: string[];
  /** ประเภทที่ควรเปลี่ยนไป (code) — มีเมื่อชี้ได้แน่ (ยี่ห้อมีประเภทเดียว หรือเก๋งอีกฝั่ง) */
  suggestion: string | null;
  message: string;
};

/** ยี่ห้อกับประเภทรถเข้ากันตามลิสต์ EMCS ไหม — null = ไม่มีปัญหา (รวมกรณีค่าว่าง/ประเภทไม่รู้จัก) */
export function brandTypeIssue(type: unknown, brand: unknown): BrandTypeIssue | null {
  const code = carTypeCode(type);
  const b = normalizeBrand(brand);
  if (!code || !b) return null;
  // "-ALL-" = ตัวเลือกจริงใน ddlCMFG ของ EMCS ทุกประเภทรถ ยกเว้น รถอื่นๆ — ใช้ตอน "รอตรวจสอบ"/ไม่ทราบยี่ห้อ (user พบ 16/09/69)
  if (b === ALL_BRAND) {
    return code === 'O' ? { brand: b, typeCode: code, typeLabel: CAR_TYPE_LABELS[code], typesWithBrand: ['A', 'E', 'M', 'T', 'V', 'W'], suggestion: null,
      message: 'ยี่ห้อ "-ALL-" ไม่มีในประเภทรถ รถอื่นๆ ของ EMCS — เลือกยี่ห้อจริง หรือเปลี่ยนประเภทรถ' } : null;
  }
  const list = CAR_BRANDS_BY_TYPE[code];
  if (!list || list.includes(b)) return null;
  const types = Object.keys(CAR_BRANDS_BY_TYPE).filter((t) => CAR_BRANDS_BY_TYPE[t].includes(b));
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
 * วันที่แบบ วว/ดด/ปปปป (พ.ศ. หรือ ค.ศ.) เป็นวันจริงไหม — "00/00/2569" ผ่านรูปแบบแต่ไม่ใช่วัน
 * (เคส #299 เคลม 2026013171626: EMCS ปัดตกทั้งไฟล์ "DateTime ... not supported in calendar")
 * ว่าง = ไม่ตรวจ (ใช้ร่วมกับตัวเช็คช่องบังคับ) · กติกาเดียวกับ parseSe ใน backend xmlExport.service.ts
 */
export function isValidSeDate(v: unknown): boolean {
  const s = String(v ?? '').trim();
  if (!s) return true;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s.includes('|') ? s.split('|')[0].trim() : s);
  if (!m) return false;
  const d = Number(m[1]), mo = Number(m[2]);
  let y = Number(m[3]);
  if (y < 100) y += 2500; else if (y < 2400) y += 543;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2400 || y > 2700) return false;
  const t = new Date(Date.UTC(y - 543, mo - 1, d));
  return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

// sync EMCS master ddlCar_Color (verbatim 55 สี) 2026-07-25
/**
 * ประเภทประกัน — ชุดเดียวกับตาราง masterPolicyType ของ ISURVEY เป๊ะ ๆ (ดึงสด 30/08/69)
 * เรียงตามรหัส: 01 02 03 04 05 10 52 53
 *
 * ⛔ ห้ามแก้คำ ("ประเภท" ไม่ใช่ "ชั้น") — backend แปลงเป็นรหัสด้วยคำพวกนี้ตอนส่ง XML
 *    เข้า EMCS (POLICY_TYPE_CODE ใน xmlExport.service.ts) · แก้ที่นี่ต้องแก้ที่นั่นด้วย
 * ⚠️ ต้องมี '-- ระบุ --' เป็นตัวแรกเหมือน PROVINCE_OPTIONS/CAR_COLOR_OPTIONS —
 *    <select> ใช้ defaultValue='-- ระบุ --' ตอนยังไม่มีค่า ถ้าลิสต์ไม่มีตัวนี้
 *    เบราว์เซอร์จะเลือกตัวแรก ('ประเภท 1') ให้เอง = บันทึกค่าที่ไม่มีใครเลือกเงียบ ๆ
 *    (RecordEditors กรอง placeholder ออกเองก่อน render อยู่แล้ว)
 */
export const POLICY_TYPE_OPTIONS = [
  '-- ระบุ --',
  'ประเภท 1', 'ประเภท 2', 'ประเภท 3', 'พรบ.',
  'ประเภท 5', 'ไม่พบความคุ้มครอง', 'ประเภท 2+', 'ประเภท 3+',
];

/**
 * ประเภทเคลม — รหัสตัวอักษรที่ใช้ตรงกันทั้งแอปมือถือ · หน้าตรวจ · XML → EMCS
 * ⛔ ชุดนี้ตรงกับ radio 4 ตัวบน EMCS (`rdoSurv_Claim_Type`) ห้ามเพิ่ม/ลด
 *    โดยเฉพาะ **ห้ามใส่ "เจรจาสินไหม"** — EMCS ไม่มีตัวเลือกนั้น บอทติ๊กให้ไม่ได้
 *    (งานติดตาม/เจรจา = "งานครั้งถัดไป" ของเคลมเดิม ไม่ใช่ประเภทบนหน้าแรก)
 * ⚠️ แก้ที่นี่ต้องแก้ mobile/lib/screens/survey_form_screen.dart (_claimTypeChips) ด้วย
 */
export const CLAIM_TYPE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'F', label: 'เคลมสด' },
  { code: 'D', label: 'เคลมแห้ง' },
  { code: 'A', label: 'งานนัดหมาย' },
  { code: 'C', label: 'งานติดตาม' },
];
export const CLAIM_TYPE_LABELS: Record<string, string> =
  Object.fromEntries(CLAIM_TYPE_OPTIONS.map((o) => [o.code, o.label]));

export const CAR_COLOR_OPTIONS = [
  '-- ระบุ --', 'ขาว', 'เทา', 'เงิน', 'ทอง', 'เหลือง', 'เขียว', 'ฟ้า', 'น้ำเงิน', 'ม่วง',
  'แดง', 'ส้ม', 'เลือดหมู', 'ดำ', 'ขาว / ทอง', 'เทา / เงิน', 'เหลือง / เงิน', 'เขียว / เงิน',
  'น้ำเงิน / เทา', 'น้ำเงิน / เงิน', 'แดง / เทา', 'ดำ / เทา', 'น้ำตาล', 'เขียว / เทา', 'ชมพู',
  'แดง/ทอง', 'เขียว / เหลือง', 'ขาวมุก', 'ขาว / เขียว / เหลือง', 'น้ำตาล / เทา', 'บรอน',
  'เทา/น้ำเงิน/เหลือง', 'ฟ้า/แดง', 'ทอง / น้ำตาล', 'น้ำตาล / เขียว', 'ขาว / น้ำเงิน',
  'บรอนทอง', 'ขาว / น้ำตาล', 'บรอนฟ้า', 'ครีม', 'ขาว / เหลือง / ส้ม', 'ดำ / น้ำตาล',
  'น้ำเงิน / น้ำตาล', 'ขาว / เทา', 'เหลือง/ทอง', 'ม่วง/เทา', 'บรอน/ทอง', 'ขาว/ดำ', 'ขาว/แดง',
  'แดง/ดำ', 'ขาว/ส้ม/เขียว', 'ดำ/ขาว/เหลือง', 'ขาว/แดง/หลายสี', 'หลายสี', 'UNDEFINE',
  'เหลือง/ดำ'
];

export const BANGKOK_DISTRICT_OPTIONS = [
  '-- เขต --', 'เขตพระนคร', 'เขตดุสิต', 'เขตหนองจอก', 'เขตบางรัก', 'เขตบางเขน',
  'เขตบางกะปิ', 'เขตปทุมวัน', 'เขตป้อมปราบศัตรูพ่าย', 'เขตพระโขนง', 'เขตมีนบุรี',
  'เขตลาดกระบัง', 'เขตยานนาวา', 'เขตสัมพันธวงศ์', 'เขตพญาไท', 'เขตธนบุรี',
  'เขตบางกอกใหญ่', 'เขตห้วยขวาง', 'เขตคลองสาน', 'เขตตลิ่งชัน', 'เขตบางกอกน้อย',
  'เขตบางขุนเทียน', 'เขตภาษีเจริญ', 'เขตหนองแขม', 'เขตราษฎร์บูรณะ', 'เขตบางพลัด',
  'เขตดินแดง', 'เขตบึงกุ่ม', 'เขตสาทร', 'เขตบางซื่อ', 'เขตจตุจักร', 'เขตบางคอแหลม',
  'เขตประเวศ', 'เขตคลองเตย', 'เขตสวนหลวง', 'เขตจอมทอง', 'เขตดอนเมือง', 'เขตราชเทวี',
  'เขตลาดพร้าว', 'เขตวัฒนา', 'เขตบางแค', 'เขตหลักสี่', 'เขตสายไหม', 'เขตคันนายาว',
  'เขตสะพานสูง', 'เขตวังทองหลาง', 'เขตคลองสามวา', 'เขตบางนา', 'เขตทวีวัฒนา',
  'เขตทุ่งครุ', 'เขตบางบอน',
];

// sync EMCS master ddlClm_Cause (verbatim 79 ตัว รวมคำที่ EMCS สะกดผิดเอง) 2026-07-25
export const ACC_CAUSE_OPTIONS = [
  '-- ระบุ --', 'ชนท้ายคู่กรณี', 'ชนคนบาดเจ็บ/เสียชีวิต', 'ชนรถคู่กรณีมีการบาดเจ็บ/เสียชีวิต',
  'ชน/เสียหลักหมุน/พลิกคว่ำ/ตกข้างทางมีผู้บาดเจ็บ/เสียชีวิต', 'ชนทรัพย์สินคู่กรณี',
  'ชนคู่กรณีในช่องทางสวน', 'ชนคู่กรณีและถูกชน', 'ถอยชนคู่กรณี', 'เฉี่ยว/เบียดคู่กรณี',
  'เปิดประตูชนรถคู่กรณี', 'ชนคู่กรณี/หรือถูกชนและไม่ทราบคู่กรณี',
  'เลี้ยว/กลับรถ/เปลี่ยนช่องทางชนคู่กรณี', 'ชนรถคู่กรณีไม่คุ้มครองรถประกัน',
  'ชนวัสดุ/สิ่งของ เช่น เสา,กำแพง,ประตู ฯลฯ', 'ชนฟุตบาท', 'ชนทรัพย์สินตนเอง', 'ชนสัตว์',
  'ทรัพย์สินหล่นใส่คู่กรณี', 'ผู้โดยสารตกรถ', 'เกี่ยวสายไฟฟ้า/โทรศัพท์/สายน้ำมัน',
  'เสียหลักล้ม', 'ฝากระโปรงหน้าเปิด', 'ยางระเบิด', 'ตกหลุม', 'ถูกน้ำมันเบรคราด', 'ประมาทร่วม',
  'ต่างฝ่ายต่างซ่อม', 'ช่วยเหลือมนุษยธรรม', 'รอคู่กรณีติดต่อ', 'รอตรวจสอบใบขับขี่',
  'แก๊สระเบิด', 'คู่กรณีชนท้าย', 'คู่กรณีชนแล้วหลบหนี', 'คู่กรณีเฉี่ยวชน',
  'คู่กรณีเฉี่ยวชนบุคคลในรถประกันบาดเจ็บ/เสียชีวิต', 'ชนสัตว์และเรียกร้องเจ้าของ',
  'คู่กรณีเปิดประตูชนรถประกัน', 'คู่กรณีถอยชน', 'คู่กรณีชน/ทรัพย์สินผู้เอาประกันเดียวกัน',
  'คู่กรณีกลั่นแกล้ง', 'ทรัพย์สินคู่กรณีหล่นใส่', 'เด็กปั๊มประมาทลืมปลดสายน้ำมัน',
  'ความเสียหายของรถประกันทีเกิดจากเหตุภายนอก', 'รถหายโดยการฉ้อฉล ตามสัญญาประกันภัย(A.P.HONDA)',
  'ไฟไหม้จากเหตุภายนอก', 'ถูกก้อนหิน', 'ถูกขูดขีด/กลั่นแกล้ง', 'วัตถุหล่นใส่',
  'รถหายตามสัญญาเช่าซื้อ', 'รถหายโดยการโจรกรรม', 'ไฟไหม้โดยระบบของตัวรถยนต์',
  'ไฟไหม้ที่เกิดจากการชน', 'น้ำท่วม', 'ภัยธรรมชาติอื่น ๆ', 'ลักทรัพย์อุปกรณ์/ส่วนควบ',
  'ภัยอื่น ๆ', 'ภัยก่อการร้าย', 'ไม่พบรถประกัน', 'ไม่พบรถคู่กรณี', 'ไม่พบรถประกัน/คู่กรณี',
  'รอผลคดี', 'รอตรวจสอบกรมธรรม์', 'รอเซ็นเคลม', 'รอรายงานอุบัติเหตุ', 'รอรถประกันติดต่อ',
  'เคลมซ้ำ', 'เปิดเคลมผิดพลาด', 'ฉ้อฉลจากการชน', 'รถหายโดยการฉ้อฉล', 'ไฟไหม้โดยการฉ้อฉล',
  'การยึดรถ ( A.P.HONDA )', 'เสียหายขณะจอดอยู่', 'กระจกบังลมหน้าแตก', 'กระจกอื่นๆ แตก',
  'รถประกันชนรถคู่กรณีไม่เอาความ', 'สูญเสียการควบคุม', 'หนูกัดสายไฟ',
  'การเสียชีวิตอ้นเกิดจากสาเหตุอื่นๆ', 'การเสียชีวิตอันเกิดจาการใช้รถ'
];

// sync EMCS master ddlLoss_ID (verbatim 21 ตัว ตามลำดับ EMCS) 2026-07-25
export const ACC_DAMAGE_TYPE_OPTIONS = [
  '-- ระบุ --', 'เคลมแห้ง', 'กระจกแตก', 'กระจกอื่นๆ แตก', 'ชนคู่กรณีเสียหาย', 'ถูกคู่กรณีชน',
  'ตกถนน', 'พลิกคว่ำ', 'รถประกันชนรถคู่กรณีไม่เอาความ', 'เฉี่ยวชนวัสดุ', 'ถูกขูดขีดกลั่นแกล้ง',
  'ถูกลักอุปกรณ์ส่วนควบ', 'วัสดุหล่นใส่', 'ยางระเบิด', 'จอดไว้ถูกชนไม่ทราบคู่กรณี',
  'หนูกัดสายไฟ', 'รถหาย', 'รถประกันไฟไหม้', 'น้ำท่วมเสียหาย', 'ชนคนบาดเจ็บ',
  'ผู้โดยสารประกันตกรถ', 'เสียหายทั้งหมด'
];

/*
 * ไม่มี POLICY_TYPE_OPTIONS แล้ว — "ประเภทกรมธรรม์" เป็นช่องพิมพ์ทั้งรถประกันและคู่กรณี
 *
 * เหตุผล: EMCS เองไม่มีรายการให้เลือก (รถประกัน = ป้ายอ่านอย่างเดียว `lblPolicy_Type`
 * คู่กรณี = ช่องพิมพ์ `txtPolicy_Type`) และของจริงมีนอกลิสต์ 7 ตัวที่เคยตั้งไว้ —
 * ใบแจ้งความเสียหายจริงเขียน "ประเภท 2+ ซ่อมอู่" คู่กับรหัส 52 ในไฟล์ใบเดียวกัน
 * เคสนำเข้าจึงเคยค้างเป็น "52 (ค่าเดิม)" เลือกไม่ได้
 * ที่เคยกลัวว่าพิมพ์เองแล้วค่าหาย แก้ที่ `policyTypeCode()` แล้ว (ส่งตามที่กรอก ไม่ดึงตัวเลข)
 */

export const EV_TYPE_OPTIONS = [
  { value: '0', label: '-- ระบุ --' },
  { value: 'BEV', label: 'BEV รถยนต์ไฟฟ้า BEV (100%)' },
  { value: 'FCEV', label: 'FCEV รถยนต์ไฟฟ้า เซลล์เชื้อเพลิง (FCEV)' },
  { value: 'HEV', label: 'HEV รถยนต์ไฟฟ้า ไฮบริด (HEV)' },
  { value: 'MEV', label: 'MEV รถยนต์ไฟฟ้าดัดแปลง (รถยนต์สันดาปที่ดัดแปลงเป็นรถไฟฟ้า)' },
  { value: 'PHEV', label: 'PHEV รถยนต์ไฟฟ้า ปลั๊กอินไฮบริด (PHEV)' },
];
