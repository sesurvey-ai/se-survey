// Master data สำหรับ editor คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน (Phase 3)
// ย่อจากชุด legacy ในเว็บ/prototype — ครอบตัวเลือกที่ใช้บ่อย + "อื่นๆ"

// บริษัทประกันคู่กรณี — sync EMCS master ddlHave_Insurance (50 บ. ชื่อเต็ม verbatim) 2026-07-23
const List<String> kOpoInsurers = [
  'ไม่มีบริษัทประกันภัย', 'บริษัท กรุงเทพประกันภัย จำกัด (มหาชน)',
  'บริษัท กรุงไทยพานิชประกันภัย จำกัด (มหาชน)', 'บริษัท กลางคุ้มครองผู้ประสบภัยจากรถ จำกัด',
  'บริษัท คุ้มภัยโตเกียวมารีนประกันภัย (ประเทศไทย) จำกัด (มหาชน)',
  'บริษัท เคดับบลิวไอ ประกันภัย จำกัด (มหาชน)', 'บริษัท จรัญประกันภัย จำกัด (มหาชน)',
  'บริษัท เจนเนอราลี่ ประกันภัย (ไทยแลนด์) จำกัด (มหาชน)',
  'บริษัท เจมาร์ท ประกันภัย จำกัด (มหาชน)', 'บริษัท ชับบ์สามัคคีประกันภัย จำกัด (มหาชน)',
  'บริษัท ไชน่าอินชัวรันส์ (ไทย) จำกัด (มหาชน)',
  'บริษัท ซมโปะ ประกันภัย (ประเทศไทย) จำกัด (มหาชน)',
  'บริษัท ซันเดย์ ประกันภัย (ประเทศไทย) จำกัด (มหาชน)', 'บริษัท ซิกน่า ประกันภัย จำกัด (มหาชน)',
  'บริษัท ทิพยประกันภัย จำกัด (มหาชน)', 'บริษัท ทูนประกันภัย จำกัด (มหาชน)',
  'บริษัท เทเวศประกันภัย จำกัด (มหาชน)', 'บริษัท ไทยประกันภัย จำกัด (มหาชน)',
  'บริษัท ไทยประกันสุขภาพ จำกัด (มหาชน)', 'บริษัท ไทยพัฒนาประกันภัย จำกัด (มหาชน)',
  'บริษัท ไทยไพบูลย์ประกันภัย จำกัด (มหาชน)', 'บริษัท ไทยรับประกันภัยต่อ จำกัด (มหาชน)',
  'บริษัท ไทยเศรษฐกิจประกันภัย จำกัด (มหาชน)', 'บริษัท ธนชาตประกันภัย จำกัด (มหาชน)',
  'บริษัท นวกิจประกันภัย จำกัด (มหาชน)', 'บริษัท นิวอินเดีย แอสชัวรันส์ จำกัด สาขาประเทศไทย',
  'บริษัท บางกอกสหประกันภัย จำกัด (มหาชน)', 'บริษัท ประกันภัยไทยวิวัฒน์ จำกัด (มหาชน)',
  'บริษัท แปซิฟิค ครอส ประกันสุขภาพ จำกัด (มหาชน)', 'บริษัท ฟอลคอนประกันภัย จำกัด (มหาชน)',
  'บริษัท มิตซุย สุมิโตโม อินชัวรันซ์ สาขาประเทศไทย', 'บริษัท มิตรแท้ประกันภัย จำกัด (มหาชน)',
  'บริษัท เมืองไทยประกันภัย จำกัด (มหาชน)', 'บริษัท รู้ใจประกันภัย จำกัด (มหาชน)',
  'บริษัท วิริยะประกันภัย จำกัด (มหาชน)',
  'บริษัท สตาร์ อินเตอร์เนชั่นแนล อินชัวรันซ์ (ประเทศไทย) จำกัด (มหาชน)',
  'บริษัท สยามสไมล์ ประกันภัย จำกัด (มหาชน)', 'บริษัท สหนิรภัยประกันภัย จำกัด (มหาชน)',
  'บริษัท สหมงคลประกันภัย จำกัด (มหาชน)', 'บริษัท อลิอันซ์ อยุธยา ประกันภัย จำกัด (มหาชน)',
  'บริษัท อินชัวร์เวิร์ส จำกัด (มหาชน)', 'บริษัท อินทรประกันภัย จำกัด (มหาชน)',
  'บริษัท เอ็ม เอส ไอ จี ประกันภัย (ประเทศไทย) จำกัด (มหาชน)',
  'บริษัท เอราวัณประกันภัย จำกัด (มหาชน)', 'บริษัท เออร์โกประกันภัย (ประเทศไทย) จำกัด (มหาชน)',
  'บริษัท เอไอจี ประกันภัย (ประเทศไทย) จำกัด (มหาชน)',
  'บริษัท เอไอเอ จำกัด (ประกันวินาศภัย) สาขาประเทศไทย', 'บริษัท แอกซ่าประกันภัย จำกัด (มหาชน)',
  'บริษัท แอลเอ็มจี ประกันภัย จำกัด (มหาชน)', 'บริษัท ไอแคร์ ประกันภัย จำกัด (มหาชน)',
  'บริษัท ไอโออิ กรุงเทพ ประกันภัย จำกัด (มหาชน)', 'อื่นๆ',
];

// ประเภทรถคู่กรณี — sync EMCS master ddlCType (verbatim; ลำดับ A/E/M/O/T/V/W)
const List<String> kOpoCarTypes = [
  'เก๋งเอเชีย', 'เก๋งยุโรป', 'รถจักรยานยนต์', 'รถอื่นๆ', 'กระบะ', 'รถตู้', 'รถบรรทุก',
];

// ยี่ห้อรถ — sync EMCS master ddlCMFG (verbatim) แยกตามประเภทรถ 2026-07-25
// ⚠️ EMCS กรองลิสต์ยี่ห้อตาม ddlCType: 350 ยี่ห้อไม่ซ้ำ แต่ 231 ตัวมีอยู่แค่ประเภทเดียว
// → ต้องเลือกประเภทรถก่อน ยี่ห้อถึงจะขึ้นให้ตรงกับที่ EMCS ยอมรับ
// ป้ายเป็นอังกฤษล้วนตามต้นฉบับ (เคยเก็บเป็นไทยแล้วบอทเลือกไม่ได้ — 'เอ็มจี' vs 'MG')
const Map<String, List<String>> kCarBrandsByType = {
  'เก๋งเอเชีย': [
    'AION', 'ASIACAB', 'ATTHAM', 'AVATR', 'BAOJUN', 'BORGWARD', 'BYD', 'CHANGAN',
    'CHERY', 'DAEWOO', 'DAIHATSU', 'DATSUN', 'DFM', 'FOMM', 'FORD', 'GEELY', 'HAVAL',
    'HINDUSTAN', 'HONDA', 'HONGQI', 'HUASONG', 'HYUNDAI', 'ISUZU', 'JAECOO', 'JETOUR', 'JONWAY',
    'JUNEYAO', 'KIA', 'LEAPMOTOR', 'LEPAS', 'LEXUS', 'LI AUTO', 'LUXGEN', 'LYNK CO', 'MAHINDRA',
    'MAZDA', 'MG', 'MITSUBISHI', 'MITSUOKA', 'NASA', 'NAZA', 'NETA', 'NIO', 'NISSAN', 'OMODA',
    'ORA', 'PERODUA', 'POCCO', 'PORSCHE', 'PROTON', 'SKODA', 'SSANGYONG', 'SUBARU', 'SUZUKI',
    'TANK', 'TATA', 'TOYOTA', 'TRUMPCHI', 'VIAUTO', 'VINFAST', 'VMC', 'VOLT', 'WEIAO BOMA',
    'WELTMEISTER', 'WEY', 'WULING', 'XPENG', 'ZEEKR', 'ZOTYE',
  ],
  'เก๋งยุโรป': [
    'ALFA', 'ALLARD', 'ALPINE', 'AMC JAVELIN', 'ASTONMARTIN', 'AUDI', 'AUSTIN',
    'BENTLEY', 'BENZ', 'BMW', 'BYD', 'CADILLAC', 'CHEVROLET', 'CHRYSLER', 'CITROEN', 'DAIMLER',
    'DODGE', 'EM', 'FERRARI', 'FIAT', 'FORD', 'HILLMAN', 'HOLDEN', 'HUMMER', 'JAGUAR', 'JEEP',
    'LAMBORGHINI', 'LANCIA', 'LANDROVER', 'LEXUS', 'LINCOLN', 'LONDON', 'LOTUS', 'MASERATI',
    'MAZDA', 'MCLAREN', 'MERCER', 'MG', 'MINI', 'MORRIS', 'OLDSMOBILE', 'OPEL', 'PEUGEOT',
    'PONTIAC', 'PORSCHE', 'RENAULT', 'ROEWE', 'ROLLSROYCE', 'ROVER', 'SAAB', 'SEAT', 'SIMCA',
    'SKODA', 'SMART', 'SUZUKI', 'TATRA', 'TESLA', 'TOYOTA', 'VOLKSWAGEN', 'VOLVO',
  ],
  'รถจักรยานยนต์': [
    'AJ', 'ALPHA VOLANTIS', 'APRILIA', 'ATV', 'BAJAJ', 'BENELLI', 'BICOSE', 'BMW',
    'CAGIVA', 'CAN-AM', 'CFMOTO', 'DECO', 'DUCATI', 'EM', 'ENGY', 'ETRAN', 'EVO', 'GPX',
    'HANWAY', 'HAONAIQI', 'HARDE', 'HARLEY', 'HARLEYDEVIDSON', 'HONDA', 'HSEM', 'HUNTER',
    'HUSABER', 'I-MOTOR', 'ISUZU', 'JONWAY', 'JRD', 'KAVALLO', 'KAWASAKI', 'KEEWAY', 'KOZAWA',
    'KTM', 'L&P', 'LAMBRETTA', 'LIFAN', 'LION', 'LONCIN', 'LUCKY', 'LUYUAN', 'MALAGUTI',
    'MJNT', 'MODENAS', 'MODYAK', 'MOTO GUZZI', 'MOTO PARILLA', 'MZ', 'NISSAN', 'NIU', 'NKT',
    'PATTINUM', 'PEDA', 'PEUGEOT', 'PIAGGIO', 'PLATINUM', 'RAPID', 'ROYAL ALLOY',
    'ROYAL ENFIELD', 'RYUKA', 'SACHS', 'SCOMADI', 'SHINERAY', 'SLEEK', 'STALLIONS', 'STAR8',
    'STROM', 'SUZUKI', 'SWAP AND GO', 'SWM', 'SYM', 'TIGER', 'TOMAS', 'TRIUMPH', 'VARETA',
    'VESPA', 'VINFAST', 'VMOTO', 'YADEA', 'YAMAHA', 'ZONGSHEN', 'ZONTES',
  ],
  'รถอื่นๆ': [
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
  'กระบะ': [
    'BENZ', 'BYD', 'CHANGAN', 'CHEVROLET', 'CITROEN', 'DAIHATSU', 'DATSUN', 'DFM',
    'DODGE', 'FIREBRIGHT', 'FORD', 'FOTON', 'GMC', 'HONDA', 'HUANGHAI', 'INTERNATIONAL',
    'ISUZU', 'JAC', 'JEEP', 'KARRY', 'KIA', 'KINGLONG', 'MAZDA', 'MG', 'MITSUBISHI', 'NEX',
    'NEXTEM', 'NISSAN', 'OPEL', 'PEUGEOT', 'POER', 'RAM', 'RELY', 'RIDDARA', 'SAMMITR',
    'SKYWELL', 'SUZUKI', 'TAKANO', 'TATA', 'THAIRUNG', 'TOYOTA', 'VOLKSWAGEN', 'WULING',
  ],
  'รถตู้': [
    'AION', 'BENZ', 'BYD', 'CHEVROLET', 'CHRYSLER', 'CITROEN', 'DAIHATSU', 'DATSUN',
    'DENZA', 'DFM', 'FARIZON', 'FORD', 'FOTON', 'GMC', 'HIGER', 'HINO', 'HONDA', 'HYUNDAI',
    'ISUZU', 'JINBEI', 'JOYLONG', 'KARRY', 'KIA', 'KYC', 'LEXUS', 'MAXUS', 'MAZDA', 'MG',
    'MITSUBISHI', 'NISSAN', 'PEUGEOT', 'POLARSUN', 'RELY', 'RENAULT', 'ROEWE', 'SKYWELL',
    'SOKON', 'SUBARU', 'SUZUKI', 'THAIRUNG', 'TOYOTA', 'TRUMPCHI', 'VOLKSWAGEN', 'WEY',
    'WULING', 'XPENG', 'ZEEKR', 'ZHONGTONG',
  ],
  'รถบรรทุก': [
    'BEIBEN', 'BENZ', 'BMC', 'BMW', 'CAMC', 'CHENGLONG', 'DAF', 'DAYUN', 'DEVA', 'DFM',
    'DONGFENG', 'EVO', 'FAW', 'FORD', 'FOTON', 'FUSO', 'HILLMAN', 'HINO', 'HONGYANG', 'HYUNDAI',
    'ISUZU', 'IVECO', 'JAC', 'JMC', 'KIA', 'MAN', 'MAZDA', 'MINE', 'MITSUBISHI', 'NEOMOR',
    'NEX', 'NISSAN', 'REO', 'RILEY', 'SAMMIT', 'SAMMITR', 'SANY', 'SCANIA', 'SERES', 'SHACMAN',
    'SHINERAY', 'SINOTRUK', 'SKYWELL', 'SOKON', 'STEYR', 'TADANO', 'TATA', 'TATRA', 'THAINA',
    'TKING', 'TOYOTA', 'TRAILER', 'UD TRUCKS', 'UDTRUCKS', 'VOLVO', 'WIRTGEN', 'WULING', 'XCMG',
    'YUCHAI', 'YUTONG',
  ],
};

// ประเภทรถรถประกันเก็บเป็น code (A/E/M/O/T/V/W) — แปลงเป็นป้าย EMCS ก่อนหาลิสต์ยี่ห้อ
const Map<String, String> kCarTypeCodeToLabel = {
  'A': 'เก๋งเอเชีย', 'E': 'เก๋งยุโรป', 'M': 'รถจักรยานยนต์', 'O': 'รถอื่นๆ',
  'T': 'กระบะ', 'V': 'รถตู้', 'W': 'รถบรรทุก',
};

/// ยี่ห้อ "-ALL-" = ตัวเลือกจริงใน ddlCMFG ของ EMCS ทุกประเภทรถ ยกเว้น รถอื่นๆ (user พบ 16/09/69)
/// ใช้ตอน "รอตรวจสอบ"/ไม่ทราบยี่ห้อ · ไม่อยู่ในตาราง kCarBrandsByType (sync จาก EMCS) จึงเติมให้ที่ carBrandsFor · ชุดเดียวกับเว็บ (caseOptions ALL_BRAND)
const String kAllBrand = '-ALL-';

/// ยี่ห้อที่เลือกได้ของประเภทรถนี้ — รับได้ทั้ง code ('A') และป้าย ('เก๋งเอเชีย') · "-ALL-" อยู่หัวลิสต์ (ยกเว้นรถอื่นๆ)
List<String> carBrandsFor(String carType) {
  final k = kCarTypeCodeToLabel[carType] ?? carType;
  final list = kCarBrandsByType[k] ?? const <String>[];
  if (list.isEmpty || k == 'รถอื่นๆ') return list;
  return [kAllBrand, ...list];
}

// สีรถ — sync EMCS master ddlCar_Color (verbatim ตามลำดับ value) 2026-07-25
// ⚠️ ป้ายต้องตรงเป๊ะ: EMCS ใช้ 'บรอน' (ไม่ใช่ 'บรอนซ์'), 'UNDEFINE' (ไม่ใช่ 'อื่นๆ')
// และสีคู่มีทั้งแบบเว้นวรรครอบ / ('เทา / เงิน') และไม่เว้น ('ขาว/ดำ') — ลอกตามต้นฉบับ
const List<String> kCarColors = [
  'ขาว', 'เทา', 'เงิน', 'ทอง', 'เหลือง', 'เขียว', 'ฟ้า', 'น้ำเงิน', 'ม่วง',
  'แดง', 'ส้ม', 'เลือดหมู', 'ดำ', 'ขาว / ทอง', 'เทา / เงิน', 'เหลือง / เงิน',
  'เขียว / เงิน', 'น้ำเงิน / เทา', 'น้ำเงิน / เงิน', 'แดง / เทา', 'ดำ / เทา',
  'น้ำตาล', 'เขียว / เทา', 'ชมพู', 'แดง/ทอง', 'เขียว / เหลือง', 'ขาวมุก',
  'ขาว / เขียว / เหลือง', 'น้ำตาล / เทา', 'บรอน', 'เทา/น้ำเงิน/เหลือง',
  'ฟ้า/แดง', 'ทอง / น้ำตาล', 'น้ำตาล / เขียว', 'ขาว / น้ำเงิน', 'บรอนทอง',
  'ขาว / น้ำตาล', 'บรอนฟ้า', 'ครีม', 'ขาว / เหลือง / ส้ม', 'ดำ / น้ำตาล',
  'น้ำเงิน / น้ำตาล', 'ขาว / เทา', 'เหลือง/ทอง', 'ม่วง/เทา', 'บรอน/ทอง',
  'ขาว/ดำ', 'ขาว/แดง', 'แดง/ดำ', 'ขาว/ส้ม/เขียว', 'ดำ/ขาว/เหลือง',
  'ขาว/แดง/หลายสี', 'หลายสี', 'UNDEFINE', 'เหลือง/ดำ',
];

// EV — sync EMCS master ddlEvType (verbatim label, ลำดับ BEV/FCEV/HEV/MEV/PHEV) 2026-07-23
/// รหัส EV → ป้ายสั้นที่ใช้ใน dropdown ของฟอร์ม (ค่าที่ **เก็บลง DB คือรหัส**)
///
/// แยกจาก [kEvTypes] ที่เป็นข้อความเต็มของ EMCS โดยตั้งใจ — คนละหน้าที่:
/// อันนั้นไว้จับคู่ข้อความจาก EMCS/OCR ส่วนอันนี้ไว้ให้คนเลือกแล้วเก็บรหัส
/// ⚠️ เดิมแมปนี้ประกาศอยู่ในฟอร์มหลัก ทำให้แก้ที่ไฟล์ master แล้วไม่มีผล
const Map<String, String> kEvCodeToLabel = {
  '': '-- ระบุ --', 'BEV': 'BEV (100%)', 'HEV': 'HEV',
  'PHEV': 'PHEV', 'FCEV': 'FCEV', 'MEV': 'MEV ดัดแปลง',
};

const List<String> kEvTypes = [
  'BEV รถยนต์ไฟฟ้า BEV (100%)',
  'FCEV รถยนต์ไฟฟ้า เซลล์เชื้อเพลิง (FCEV)',
  'HEV รถยนต์ไฟฟ้า ไฮบริด (HEV)',
  'MEV รถยนต์ไฟฟ้าดัดแปลง (รถยนต์สันดาปที่ดัดแปลงเป็นรถไฟฟ้า)',
  'PHEV รถยนต์ไฟฟ้า ปลั๊กอินไฮบริด (PHEV)',
];

// ความสัมพันธ์ — sync จาก EMCS master ddlDri_Relation_ID (40 รหัส, verbatim) 2026-07-23
const List<String> kRelations = [
  'สามี', 'ภรรยา', 'บุตร', 'บิดา', 'มารดา', 'นายจ้าง', 'ลูกจ้าง', 'ผู้เช่า', 'พี่ชาย',
  'พี่สาว', 'น้องชาย', 'น้องสาว', 'เจ้าของรถ', 'หลาน', 'อา', 'น้า', 'ลุง', 'ป้า', 'ญาติ',
  'เพื่อน', 'แฟน', 'พนักงาน', 'พี่เขย', 'น้องเขย', 'พี่สะใภ้', 'น้องสะใภ้',
  'พนักงานผู้เช่า', 'ลุงเขย', 'น้าเขย', 'น้าสะใภ้', 'อาเขย', 'อาสะใภ้', 'หุ้นส่วน',
  'บุตรหุ้นส่วน', 'เจ้าของบริษัท', 'เพื่อนบุตรเจ้าของรถ', 'บุตรเขย', 'หลานเขย',
  'บุตรสะใภ้',
];

// คำนำหน้า — sync EMCS master ddlDri_Title_ID (verbatim)
const List<String> kTitles = ['นาย', 'นาง', 'นางสาว', 'ด.ช.', 'ด.ญ.', 'คุณ'];

// ประเภทใบขับขี่ (ใช้ทั้งหน้าผู้ขับขี่รถประกัน + คู่กรณี + matcher OCR) — "ไม่มีใบขับขี่" ถูกกรองออกตอนแสดง (สวิตช์ "มีใบขับขี่" คุมแทน)
const List<String> kLicenseTypes = [
  'ใบขับขี่รถยนต์ส่วนบุคคลตลอดชีพ',
  'ใบขับขี่รถจักรยานยนต์ส่วนบุคคลตลอดชีพ',
  'ใบขับขี่รถยนต์ส่วนบุคคลชั่วคราว',
  'ใบขับขี่รถจักรยานยนต์ส่วนบุคคลชั่วคราว',
  'ใบขับขี่รถยนต์ส่วนบุคคล 5 ปีต่ออายุ',
  'ใบขับขี่รถยนต์สาธารณะ',
  'ใบขับขี่สากล',
  'ใบขับขี่รถยนต์ส่วนบุคคลหนึ่งปีต่ออายุ',
  'ใบขับขี่รถจักรยานยนต์ส่วนบุคคลหนึ่งปี',
  'ใบขับขี่รถยนต์ส่วนบุคคล 7 ปีต่ออายุ',
  'ใบขับขี่รถยนต์ส่วนบุคคล',
  'ใบขับขี่รถจักรยานยนต์ส่วนบุคคล',
  'ใบขับขี่ขนส่งชนิดที่1',
  'ใบขับขี่ขนส่งชนิดที่2',
  'ใบขับขี่ขนส่งชนิดที่3',
  'ใบอนุญาติขับขี่ชนิดที่4',
  'ไม่มีใบขับขี่',
  'ใบขับขี่รถยนต์สามล้อส่วนบุคคลสาธารณะ',
  'ใบขับขี่รถยนต์สามล้อส่วนบุคคลชั่วคราว',
  'ใบอนุญาตเป็นผู้ขับรถทุกประเภท',
  'อื่นๆ',
];

// ประเภทประกัน — ชุดเดียวกับตาราง masterPolicyType ของ ISURVEY เป๊ะ ๆ (ดึงสด 30/08/69)
// เรียงตามรหัส: 01 02 03 04 05 10 52 53 · ห้ามแก้คำ ("ประเภท" ไม่ใช่ "ชั้น") เพราะ
// backend แปลงเป็นรหัสด้วยคำพวกนี้ตอนส่ง XML เข้า EMCS (ดู POLICY_TYPE_CODE)
const List<String> kPolicyTypes = [
  'ประเภท 1', 'ประเภท 2', 'ประเภท 3', 'พรบ.',
  'ประเภท 5', 'ไม่พบความคุ้มครอง', 'ประเภท 2+', 'ประเภท 3+',
];

// โควตารูปต่อ "เคลม" ของ EMCS — เห็นจริงบนหน้า Upload รูป: "จากทั้งหมด 80 รูป"
// ⚠️ เป็นโควตาของเคลม ไม่ใช่ของงานเรา — แชร์กับรูปที่คนอื่นอัปไว้ก่อนแล้ว
// ("upload ไปแล้ว 14 รูป" ทั้งที่เรายังไม่ได้อัป) แอปจึงรู้ได้แค่ "เราถ่ายกี่ใบ"
// → ใช้เตือนเฉย ๆ ไม่บล็อก; บอทอ่านโควตาจริงจาก lblCurr_Image แล้วตัดให้พอดีตอนอัป
// ค่านี้มาจากบริษัทไอโออิ — บริษัทอื่นอาจต่างกัน ถ้าเจอค่าอื่นให้แก้ตรงนี้ที่เดียว
const int kEmcsPhotoQuota = 80;
const int kEmcsPhotoWarn = 60;   // ถึงจำนวนนี้เริ่มขึ้นป้ายเหลือง

// ประเภทผู้บาดเจ็บ — sync EMCS master ddlPerson_Type (verbatim ครบ 5 ตัว: 01-05)
// 2026-07-27: เดิมมีแค่ 3 ตัว (01/03/05) ขาดฝั่งคู่กรณี — งานจริงของพนักงาน
// (เคลมไอโออิ 2026013058298) ใช้ '02 ผู้ขับขี่ - รถคู่กรณี' จริง
const List<String> kPersonTypes = [
  'ผู้ขับขี่ - รถประกัน',      // 01
  'ผู้ขับขี่ - รถคู่กรณี',      // 02
  'ผู้โดยสาร - รถประกัน',     // 03
  'ผู้โดยสาร - รถคู่กรณี',     // 04
  'บุคคลภายนอกรถ',            // 05
];

// ระดับการบาดเจ็บ (label, สี) — sync EMCS master ddlWounded_Type (verbatim label) 2026-07-23
const List<Map<String, dynamic>> kWounds = [
  {'label': 'บาดเจ็บ - เล็กน้อย', 'color': 0xFF16A34A},
  {'label': 'บาดเจ็บ - ปานกลาง', 'color': 0xFFEAB308},
  {'label': 'บาดเจ็บ - สาหัส', 'color': 0xFFEA8600},
  {'label': 'ทุพพลภาพ', 'color': 0xFFDC2626},
  {'label': 'เสียชีวิตก่อนรักษา', 'color': 0xFF1F2937},
  {'label': 'เสียชีวิตหลังรักษา', 'color': 0xFF4B5563},
];

// บริษัทประกันที่เข้าเกณฑ์ KFK (Knock-for-Knock) — ติ๊ก default; ชื่อเต็มตรง kOpoInsurers (EMCS)
const Set<String> kKfkInsurers = {
  'บริษัท กรุงเทพประกันภัย จำกัด (มหาชน)', 'บริษัท ทิพยประกันภัย จำกัด (มหาชน)',
  'บริษัท วิริยะประกันภัย จำกัด (มหาชน)', 'บริษัท เมืองไทยประกันภัย จำกัด (มหาชน)',
  'บริษัท ไอโออิ กรุงเทพ ประกันภัย จำกัด (มหาชน)',
  'บริษัท คุ้มภัยโตเกียวมารีนประกันภัย (ประเทศไทย) จำกัด (มหาชน)',
  'บริษัท เอ็ม เอส ไอ จี ประกันภัย (ประเทศไทย) จำกัด (มหาชน)',
  'บริษัท ธนชาตประกันภัย จำกัด (มหาชน)',
};

// ── ตรวจ checksum เลขบัตรประชาชน (mod 11) ──
bool cidChecksum(String raw) {
  final d = raw.replaceAll(RegExp(r'\D'), '');
  if (d.length != 13) return false;
  var sum = 0;
  for (var i = 0; i < 12; i++) {
    sum += int.parse(d[i]) * (13 - i);
  }
  final check = (11 - (sum % 11)) % 10;
  return check == int.parse(d[12]);
}
