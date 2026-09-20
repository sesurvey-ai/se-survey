/**
 * ที่อยู่ + ชื่อ ที่ต้องประกอบเป็น "ข้อความช่องเดียว" ให้ EMCS/XML (user เคาะ 16/09/69)
 *
 * ── ผู้ขับขี่รถประกัน ──
 * เว็บ/มือถือเก็บแยก: driver_address (บ้านเลขที่/ถนน) · driver_moo (หมู่) · driver_subdistrict (ตำบล) · จังหวัด · อำเภอ
 * EMCS มีช่องที่อยู่เป็นข้อความเดียว + dropdown จังหวัด/อำเภอ (ไม่มีช่องหมู่/ตำบล) → ประกอบเป็น
 *   "46/23 ม.7 ต.ท้ายบ้าน"   (จังหวัด/อำเภอไม่ใส่ในข้อความ — ไปช่อง dropdown อยู่แล้ว)
 *
 * ── ผู้ขับขี่รถคู่กรณี (16/09/69 รอบคู่กรณี) ──
 * opposing_parties[].address · moo · subdistrict · district · home_province — บล็อกคู่กรณีของ EMCS มีแต่ช่องข้อความเดียว
 * (dropdown จังหวัด/อำเภอถูกซ่อน) → ประกอบทั้ง 5 ส่วน  "46/23 ม.7 ต.ท้ายบ้าน อ.เมือง จ.สมุทรปราการ"
 *   · กรุงเทพ ไม่มีตำบล/อำเภอ → "แขวงบางด้วน เขตภาษีเจริญ กรุงเทพฯ"
 *
 * กติการ่วม:
 *   - หมู่ที่ช่างพิมพ์ปนในบ้านเลขที่ ("46/23 หมู่ที่ 7" / "หมู่ 7" / "ม.7" / "261ม.2") ถูกแยกออกมาเป็นหมู่ให้อัตโนมัติ
 *     → ข้อความออกมาเป็นรูปแบบเดียวเสมอ "ม.<เลข>" แทรกถัดจากบ้านเลขที่ ("450 ม.2 ซ.เจริญศิลป์ 32") · ช่องหมู่ที่กรอกมาชนะเลขที่ปนในข้อความ
 *   - ตำบล/อำเภอ/จังหวัด ที่พิมพ์ปนมาแบบ "ต.ท้ายบ้าน" ถูกย้ายไปท้ายในรูปแบบเดียว · ชื่อที่มีอยู่แล้วในข้อความไม่ต่อซ้ำ (ที่อยู่เต็มแบบเก่าไม่เพี้ยน)
 *   - ส่วนไหนว่างก็ข้าม · ทั้งหมดว่าง = ""
 *
 * ── ชื่อเจ้าของรถคู่กรณี ──
 * owner_title + owner_name → "นาย บุญเลี้ยง ชงสุวรรณ" (เว้นวรรคระหว่างคำนำหน้ากับชื่อ · คำนำหน้าที่พิมพ์ติดในชื่ออยู่แล้วไม่ซ้ำ)
 *
 * บอท (se-autokey) ใช้สูตรเดียวกัน (autokey/claim_data.py driver_address_line/opponent_address_line/with_title/split_moo)
 * — แก้ที่หนึ่งต้องแก้อีกที่ · contract test (tests/driverAddress.contract.test.ts) ล็อกทั้งคู่
 */
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();
const escapeRe = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tidy = (addr: string): string => addr.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/^[\s,]+|[\s,]+$/g, '');
/** ตัวแทนค่า "ไม่ทราบ" ที่คนพิมพ์/ระบบเติม ไม่ใช่ข้อมูลจริง (user เคาะ 20/09/69 หลังเคส #528): "รอตรวจสอบ" ถือเท่ากับ "-" — ไม่เอามาประกอบที่อยู่/ต่อคำนำหน้า */
const PLACEHOLDERS = new Set(['-', 'รอตรวจสอบ']);
const isPlaceholder = (v: unknown): boolean => PLACEHOLDERS.has(String(v ?? '').trim());

/** จับ "หมู่ที่ 7" / "หมู่ 7" / "หมู่7" / "ม.7" / "ม. 7" ที่ขึ้นต้นข้อความ หลังช่องว่าง/จุลภาค หรือติดหลังตัวเลข ("261ม.2") — "หมู่บ้าน…" ไม่ติด (ต้องตามด้วยตัวเลข) */
const MOO_RE = /(?:^|(?<=[\s,\d]))(?:หมู่ที่|หมู่|ม\.)\s*(\d{1,3})(?=$|[\s,])/u;
const MOO_PREFIX = /^(หมู่ที่|หมู่|ม\.)\s*/u;
const TUMBON_PREFIX = /^(ตำบล|แขวง|ต\.)\s*/u;
const AMPHUR_PREFIX = /^(อำเภอ|เขต|อ\.)\s*/u;
const PROVINCE_PREFIX = /^(จังหวัด|จ\.)\s*/u;
const isBangkok = (province: string): boolean => /^กรุงเทพ/u.test(province);

/** แยกหมู่ออกจากบ้านเลขที่ → { address (ไม่มีหมู่แล้ว), moo ('' = ไม่มี) } */
export function splitMoo(address: unknown): { address: string; moo: string } {
  const addr = s(address).replace(/\s+/g, ' ');
  const m = MOO_RE.exec(addr);
  if (!m) return { address: addr, moo: '' };
  const rest = tidy(addr.slice(0, m.index) + ' ' + addr.slice(m.index + m[0].length));
  return { address: rest, moo: m[1] };
}

/** "ตำบลท้ายบ้าน"/"ต. ท้ายบ้าน" (หรือ อ./จ. ตาม prefixes) ที่พิมพ์ปนมา → เขียนเป็นรูปแบบเดียว (canon) **อยู่ที่เดิม** — ไม่ย้าย ลำดับที่อยู่เต็มแบบเก่าจึงไม่เพี้ยน */
const canonTag = (addr: string, prefixes: string, name: string, canon: string): string =>
  tidy(addr.replace(new RegExp(`(?:^|(?<=[\\s,]))(?:${prefixes})\\s*${escapeRe(name)}(?=$|[\\s,])`, 'u'), canon));

/** แทรก "ม.<เลข>" ถัดจากบ้านเลขที่ (ก้อนแรกที่มีตัวเลข) — ไม่มีบ้านเลขที่ค่อยต่อท้าย */
function insertMoo(addr: string, m: string): string {
  if (!m) return addr;
  if (!addr) return `ม.${m}`;
  const hit = /(?:^|[\s,])([^\s,]*\d[^\s,]*)(?=[\s,]|$)/u.exec(addr);
  if (!hit) return `${addr} ม.${m}`;
  const end = hit.index + hit[0].length;
  return tidy(`${addr.slice(0, end)} ม.${m} ${addr.slice(end)}`);
}

export function driverAddressLine(address: unknown, moo: unknown, subdistrict: unknown): string {
  const split = splitMoo(isPlaceholder(address) ? '' : address);   // บ้านเลขที่ "-"/"รอตรวจสอบ" = ไม่ทราบ (20/09/69)
  let addr = split.address;
  const m = s(moo).replace(MOO_PREFIX, '').trim() || split.moo;   // ช่องหมู่ที่กรอกมาชนะเลขที่ปนในข้อความ
  const t = s(subdistrict).replace(TUMBON_PREFIX, '').trim();
  if (t) addr = canonTag(addr, 'ตำบล|แขวง|ต\\.', t, `ต.${t}`);
  addr = insertMoo(addr, m);
  const parts: string[] = [];
  if (addr) parts.push(addr);
  if (t && !addr.includes(t)) parts.push(`ต.${t}`);
  return parts.join(' ');
}

/** ที่อยู่ปัจจุบันผู้ขับขี่รถคู่กรณี → "46/23 ม.7 ต.ท้ายบ้าน อ.เมือง จ.สมุทรปราการ" (กรุงเทพ: แขวง/เขต/กรุงเทพฯ) */
export function opponentAddressLine(address: unknown, moo: unknown, subdistrict: unknown, district: unknown, province: unknown): string {
  const split = splitMoo(isPlaceholder(address) ? '' : address);   // บ้านเลขที่ "-"/"รอตรวจสอบ" = ไม่ทราบ (20/09/69)
  let addr = split.address;
  const m = s(moo).replace(MOO_PREFIX, '').trim() || split.moo;
  const t = s(subdistrict).replace(TUMBON_PREFIX, '').trim();
  const d = s(district).replace(AMPHUR_PREFIX, '').trim();
  const pRaw = s(province).replace(PROVINCE_PREFIX, '').trim();
  const bkk = isBangkok(pRaw);
  const p = bkk ? 'กรุงเทพฯ' : pRaw;
  if (t) addr = canonTag(addr, 'ตำบล|แขวง|ต\\.', t, bkk ? `แขวง${t}` : `ต.${t}`);
  if (d) addr = canonTag(addr, 'อำเภอ|เขต|อ\\.', d, bkk ? `เขต${d}` : `อ.${d}`);
  if (pRaw) addr = canonTag(addr, 'จังหวัด|จ\\.', pRaw, bkk ? p : `จ.${p}`);
  addr = insertMoo(addr, m);
  const parts: string[] = [];
  if (addr) parts.push(addr);
  if (t && !addr.includes(t)) parts.push(bkk ? `แขวง${t}` : `ต.${t}`);
  if (d && !addr.includes(d)) parts.push(bkk ? `เขต${d}` : `อ.${d}`);
  if (p && !(bkk ? /กรุงเทพ/u.test(addr) : addr.includes(p))) parts.push(bkk ? p : `จ.${p}`);
  return parts.join(' ');
}

/** คำนำหน้าที่สะกดต่างกันแต่ตัวเดียวกัน — ชื่อที่พิมพ์ "น.ส.สมใจ" มากับคำนำหน้า "นางสาว" ไม่ต่อซ้ำ */
const TITLE_ALIASES: Record<string, string[]> = {
  'นางสาว': ['น.ส.', 'นส.'], 'ด.ช.': ['เด็กชาย'], 'ด.ญ.': ['เด็กหญิง'],
};
/** สระหลัง/วรรณยุกต์ — ตัวถัดจากคำนำหน้าเป็นพวกนี้ = ชื่อจริงขึ้นต้นด้วยคำเดียวกัน ("นายิกา") ไม่ใช่คำนำหน้าติดชื่อ */
const THAI_FOLLOW = /^[ะ-ฺๅ็-๎]/u;

/**
 * คำนำหน้า + ชื่อ → "นาย บุญเลี้ยง ชงสุวรรณ" (เว้นวรรค 1 ช่อง)
 * · ชื่อที่มีคำนำหน้าเดียวกันติดมาแล้ว ("นายบุญเลี้ยง" / "นาย บุญเลี้ยง" / "น.ส.สมใจ"+นางสาว) → ตัดออกก่อน ไม่ซ้ำ
 * · ไม่มีคำนำหน้า = ชื่อตามเดิม · ไม่มีชื่อ = "" (ให้ผู้เรียกใส่ "-" ตามกติกาช่องบังคับ)
 */
export function withTitle(title: unknown, name: unknown): string {
  const t = s(title).replace(/\s+/g, ' ');
  const n = s(name).replace(/\s+/g, ' ');
  // ตัวแทนค่า (user เคาะ 20/09/69): "-"/"รอตรวจสอบ" → "-" · "ไม่ทราบชื่อ" คงเดิม — ไม่ต่อคำนำหน้า (EMCS เคยได้ "คุณ -" เคส #528)
  if (isPlaceholder(n)) return '-';
  if (n === 'ไม่ทราบชื่อ') return n;
  if (!n) return '';
  if (!t) return n;
  let rest = n;
  for (const cand of [t, ...(TITLE_ALIASES[t] ?? [])]) {
    if (!n.startsWith(cand)) continue;
    const after = n.slice(cand.length);
    if (after && THAI_FOLLOW.test(after)) break;
    rest = after.trim();
    break;
  }
  return rest ? `${t} ${rest}` : '';
}

/**
 * ใช้ตอนบันทึก/ส่งงาน (case.service): แอป/เว็บพิมพ์หมู่ปนในบ้านเลขที่ แต่ไม่ได้กรอกช่องหมู่ → ย้ายไปช่องหมู่ให้
 * แก้ object ที่ส่งมาโดยตรง · ไม่แตะเมื่อกรอกช่องหมู่มาแล้ว หรือไม่ได้ส่ง driver_address มา
 */
export function normalizeDriverAddressFields(data: Record<string, unknown>): void {
  if (typeof data.driver_address !== 'string') return;
  if (s(data.driver_moo)) return;
  const { address, moo } = splitMoo(data.driver_address);
  if (!moo) return;
  data.driver_address = address;
  data.driver_moo = moo;
}

/** อย่างเดียวกันสำหรับคู่กรณี 1 คัน (opposing_parties[].address → moo) */
export function normalizeOpponentAddressFields(o: Record<string, unknown>): void {
  if (typeof o.address !== 'string') return;
  if (s(o.moo)) return;
  const { address, moo } = splitMoo(o.address);
  if (!moo) return;
  o.address = address;
  o.moo = moo;
}

/** ไล่ทุกคันใน data.opposing_parties (ถ้าส่งมา) */
export function normalizeOpponentsAddress(data: Record<string, unknown>): void {
  if (!Array.isArray(data.opposing_parties)) return;
  for (const o of data.opposing_parties) {
    if (o && typeof o === 'object' && !Array.isArray(o)) normalizeOpponentAddressFields(o as Record<string, unknown>);
  }
}
