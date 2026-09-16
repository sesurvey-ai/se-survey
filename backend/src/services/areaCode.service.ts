import { TH_AMPHURS, TH_PROVINCES, TH_TUMBONS } from '../data/thaiAreaCodes';

/**
 * ชื่อจังหวัด/อำเภอที่พนักงานเลือกในแอป → **รหัสมาตรฐานไทย** (คีย์ของตารางเรท)
 *
 * ทำไมต้องมี: เคสเก็บพื้นที่เป็น**ข้อความไทย** (`acc_province` = 'กรุงเทพ ฯ',
 * `acc_district` = 'อำเภอธัญบุรี') แต่ตารางเรทอ้าง**รหัส** ('10', '1305')
 * ถ้าแปลงไม่ได้ = หาเรทไม่เจอ = คิดค่าตอบแทนไม่ได้ทั้งงาน
 *
 * ⚠️ อย่าเผลอใช้ `emcsDistricts.ts` แทน — นั่นเป็นรหัสภายในของพอร์ทัลประกัน (ชลบุรี = 9)
 *    คนละชุดกับรหัสมาตรฐาน (ชลบุรี = 20) ใช้สลับกันแล้วได้เรทของจังหวัดอื่นแบบเงียบ ๆ
 *
 * ชื่อ 2 ฝั่งเขียนไม่เหมือนกันจึงต้อง normalize:
 *   แอป            'อำเภอเมือง'   'เขตบางกะปิ'   'กรุงเทพ ฯ'
 *   ตารางมาตรฐาน   'เมืองชลบุรี'   'บางกะปิ'      'กรุงเทพฯ'
 */

/** ตัดคำนำหน้า/ช่องว่าง/รูปแบบ ฯ ที่เขียนไม่ตรงกันออก ให้เทียบกันได้ */
function norm(s: string): string {
  return String(s || '')
    .replace(/^(กิ่งอำเภอ|อำเภอ|เขต|จังหวัด|อ\.|จ\.)\s*/u, '')
    .replace(/\s+/g, '')
    .replace(/ฯ+$/u, '')      // 'กรุงเทพ ฯ' / 'กรุงเทพฯ' → 'กรุงเทพ'
    .trim();
}

const provinceIndex = new Map<string, string>();
for (const [code, name] of Object.entries(TH_PROVINCES)) provinceIndex.set(norm(name), code);
// แอปเขียน 'กรุงเทพ ฯ' ส่วนตารางเขียน 'กรุงเทพฯ' — norm จัดการให้แล้ว
// ที่เหลือเป็นชื่อพ้องที่สะกดต่างกันจริง ๆ ไม่ใช่แค่คำนำหน้า
for (const [alias, code] of Object.entries({
  กรุงเทพมหานคร: '10',
  พระนคร: '10',
  ศรีสะเกษ: '33',
  หนองบัวลําภู: '39',   // ไม้หันอากาศ+ลอ vs ลําพัง — พบทั้ง 2 แบบในข้อมูลจริง
  // แอปลิสต์ 'เบตง' เป็นจังหวัด (ไม่มีอำเภอย่อย) ทั้งที่จริงเป็นอำเภอหนึ่งของยะลา —
  // น่าจะเพราะบริษัทประกันนับเป็นพื้นที่บริการแยก · แม็ปไปยะลาเพื่อให้ยังหาเรทระดับจังหวัดได้
  เบตง: '95',
})) if (!provinceIndex.has(norm(alias))) provinceIndex.set(norm(alias), code);

export function provinceCode(name?: string | null): string | null {
  if (!name) return null;
  return provinceIndex.get(norm(name)) ?? null;
}

/**
 * หาอำเภอ **ภายในจังหวัดนั้น** เท่านั้น — 'อำเภอเมือง' มีอยู่ทุกจังหวัด
 * ถ้าไม่จำกัดขอบเขตจะได้อำเภอเมืองของจังหวัดอื่นแล้วคิดเรทผิด
 *
 * ตารางมาตรฐานเขียนอำเภอเมืองเป็น 'เมือง<ชื่อจังหวัด>' (เมืองชลบุรี) ส่วนแอปเขียนแค่
 * 'อำเภอเมือง' → จับด้วยการขึ้นต้นด้วย 'เมือง' ภายในจังหวัดเดียวกัน
 */
export function amphurCode(province?: string | null, district?: string | null): string | null {
  const pc = provinceCode(province);
  if (!pc || !district) return null;
  const want = norm(district);
  if (!want) return null;

  let muang: string | null = null;
  for (const [code, name] of Object.entries(TH_AMPHURS)) {
    if (!code.startsWith(pc)) continue;
    const have = norm(name);
    if (have === want) return code;
    // 'อำเภอเมือง' (แอป) ↔ 'เมืองชลบุรี' (ตาราง) — เอาตัวแรก (รหัสหลัก xx01) ไม่ทับด้วยสาขาอำเภอที่ตามมา
    // (3651 'เมืองชัยภูมิ (สาขาตำบลโนนสำราญ)*' / 9251 'อำเภอเมืองตรัง(สาขาคลองเต็ง)**' เคยชนะแล้วได้ตำบล 0 — 16/09/69)
    if (!muang && want === 'เมือง' && have.startsWith('เมือง')) muang = code;
    // บางจังหวัดแอปเขียนอำเภอเมืองด้วยชื่อจังหวัดเลย: 'อำเภอบึงกาฬ' ↔ 'เมืองบึงกาฬ'
    if (!muang && have === `เมือง${want}`) muang = code;
  }
  return muang;
}

/** รายชื่อตำบลทั้งหมดในอำเภอ (ชื่อจังหวัด/อำเภอตามที่แอปเขียน) — dropdown ตำบลของที่อยู่ผู้ขับขี่ (16/09/69) · หาอำเภอไม่เจอ = [] */
export function tumbonNames(province?: string | null, district?: string | null): string[] {
  const ac = amphurCode(province, district);
  if (!ac) return [];
  const names: string[] = [];
  for (const [code, name] of Object.entries(TH_TUMBONS)) {
    if (code.startsWith(ac) && name) names.push(name.replace(/^\*+/, '').trim());   // ชุดข้อมูลบางตำบลมี * นำหน้า
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'th'));
}

/** ตำบล — ใช้เฉพาะตอนเช็คว่าเป็นตำบลที่จ่ายไม่เท่าอำเภอแม่หรือเปล่า */
export function tumbonCode(
  province?: string | null, district?: string | null, tumbon?: string | null,
): string | null {
  const ac = amphurCode(province, district);
  if (!ac || !tumbon) return null;
  const want = norm(tumbon);
  for (const [code, name] of Object.entries(TH_TUMBONS)) {
    if (code.startsWith(ac) && norm(name) === want) return code;
  }
  return null;
}
