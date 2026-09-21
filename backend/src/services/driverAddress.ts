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
 *   - ตำบล/อำเภอ/จังหวัด ที่พิมพ์ปนในบ้านเลขที่ ("2/1609 ต.ท่าช้าง อ.เมือง จันทบุรี") ถูก**ตัดทิ้ง**เมื่อมีช่องแยกระดับนั้น แล้วต่อจากช่องแยกท้ายเสมอ
 *     (stripAdminParts — user เคาะ 21/09/69 หลังเคลม 2026013173082 ได้ "…อ.เมือง จันทบุรี อ.เมืองจันทบุรี" ซ้ำ เพราะเดิมกันซ้ำเฉพาะชื่อตรงเป๊ะ)
 *     · ระดับที่ไม่มีช่องแยกคงข้อความที่พิมพ์ไว้ (ที่อยู่เต็มแบบเก่าไม่เพี้ยน) · แขวง/เขต ตัดเฉพาะกรุงเทพ · ชื่อจังหวัดเปล่า ๆ ที่ตรงช่องแยกตัดด้วย
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
const isPlaceholder = (v: unknown): boolean => { const t = String(v ?? '').trim(); return PLACEHOLDERS.has(t) || /^-+$/.test(t); };   // "--" ที่ ISURVEY ส่งมาแทนไม่ทราบ ก็นับ (20/09/69)

/** ชื่อผู้ขับขี่คู่กรณี / ผู้บาดเจ็บ / เจ้าของทรัพย์สิน ที่ไม่ทราบ (ว่าง · "รอตรวจสอบ" · ขีดกี่ขีดก็ตาม) → "ไม่ทราบชื่อ" (user เคาะ 21/09/69 เคส #433 — เดิม "-")
 *  ⛔ ไม่ใช้กับผู้ขับขี่รถประกันและเจ้าของรถคู่กรณี (ยังเป็น "-") · เรียกหลัง withTitle (ตัวแทนค่าไม่ต่อคำนำหน้าอยู่แล้ว จึงไม่มี "คุณ ไม่ทราบชื่อ") */
export const UNKNOWN_NAME = 'ไม่ทราบชื่อ';
export function nameOrUnknown(v: unknown): string { const t = s(v); return !t || isPlaceholder(t) ? UNKNOWN_NAME : t; }

/** จับ "หมู่ที่ 7" / "หมู่ 7" / "หมู่7" / "ม.7" / "ม. 7" ที่ขึ้นต้นข้อความ หลังช่องว่าง/จุลภาค หรือติดหลังตัวเลข ("261ม.2") — "หมู่บ้าน…" ไม่ติด (ต้องตามด้วยตัวเลข) */
const MOO_RE = /(?:^|(?<=[\s,\d]))(?:หมู่ที่|หมู่|ม\.)\s*(\d{1,3})(?=$|[\s,])/u;
const MOO_PREFIX = /^(หมู่ที่|หมู่|ม\.)\s*/u;
const TUMBON_PREFIX = /^(ตำบล|แขวง|ต\.)\s*/u;
const AMPHUR_PREFIX = /^(อำเภอ|เขต|อ\.)\s*/u;
const PROVINCE_PREFIX = /^(จังหวัด|จ\.)\s*/u;
const isBangkok = (province: string): boolean => /^(กรุงเทพ|กทม)/u.test(province);   // กรุงเทพฯ / กรุงเทพมหานคร / กทม. (21/09/69)

/** แยกหมู่ออกจากบ้านเลขที่ → { address (ไม่มีหมู่แล้ว), moo ('' = ไม่มี) } */
export function splitMoo(address: unknown): { address: string; moo: string } {
  const addr = s(address).replace(/\s+/g, ' ');
  const m = MOO_RE.exec(addr);
  if (!m) return { address: addr, moo: '' };
  const rest = tidy(addr.slice(0, m.index) + ' ' + addr.slice(m.index + m[0].length));
  return { address: rest, moo: m[1] };
}

/**
 * ตัด ต./อ./จ. ที่พิมพ์ปนในบ้านเลขที่ เฉพาะระดับที่มีช่องแยกส่งมา (user เคาะ 21/09/69 หลังเคลม 2026013173082)
 * ช่องแยก (dropdown ISURVEY / ตัวเลือกในแอป-เว็บ) เป็นผู้กำหนด ต./อ./จ. เสมอ · "<คำนำหน้า><ชื่อ>" ตัดทุกที่ที่พบ (ชื่อ = ก้อนถัดไปจนถึงช่องว่าง/จุลภาค)
 * · ชื่อเปล่า ๆ ที่เท่ากับช่องแยก (พิมพ์ "จันทบุรี" ไม่มี จ.) ตัดด้วย · แขวง/เขต เฉพาะกรุงเทพ (นอกกรุงเทพ "เขต…" อาจเป็นชื่อสถานที่)
 * · กรุงเทพฯ/กทม./กรุงเทพมหานคร นับเป็นกรุงเทพทุกแบบ · ไม่มีช่องแยก = ไม่แตะ
 * ⚠️ สูตรเดียวกับบอท claim_data.strip_admin_parts — แก้ที่หนึ่งต้องแก้อีกที่
 */
type Level = 'sub' | 'dist' | 'prov';
const LEVELS: Level[] = ['sub', 'dist', 'prov'];
/** คำนำหน้าของแต่ละระดับ (แขวง/เขต เฉพาะกรุงเทพ) */
const TAG_RE: Record<Level, [string, string | null]> = { sub: ['ตำบล|ต\\.', 'แขวง'], dist: ['อำเภอ|อ\\.', 'เขต'], prov: ['จังหวัด|จ\\.', null] };
const BKK_BARE = /^(กรุงเทพ\S*|กทม\.?)$/u;
type AdminNames = Record<Level, string>;
const adminNames = (subdistrict: unknown, district: unknown, province: unknown): AdminNames => ({
  sub: s(subdistrict).replace(TUMBON_PREFIX, '').trim(), dist: s(district).replace(AMPHUR_PREFIX, '').trim(), prov: s(province).replace(PROVINCE_PREFIX, '').trim(),
});

/**
 * แยกบ้านเลขที่/ถนน ออกจาก "หาง" ตำบล/อำเภอ/จังหวัด ที่พิมพ์ปน → { head, typed: ข้อความที่พิมพ์ไว้ตามเดิมของแต่ละระดับ }
 * รู้จักหางจาก: ก้อนที่ขึ้นต้นด้วยคำนำหน้า (ต./ตำบล · อ./อำเภอ · จ./จังหวัด · แขวง/เขต เฉพาะกรุงเทพ — นอกกรุงเทพ "เขต…" เป็นชื่อสถานที่ได้)
 * และก้อนเปล่าที่เท่ากับช่องแยก (พิมพ์ "จันทบุรี" ไม่มี จ.) หรือชื่อกรุงเทพทุกแบบ · ก้อนอื่นที่แทรกอยู่ "กลาง" หาง (ถ.สุขุมวิท) คืนกลับ head
 * · ก้อนที่ไม่รู้จัก "ท้าย" หาง (หลังก้อนที่รู้จักตัวสุดท้าย เช่น "ศรีสะเกษ" ตอนไม่มีช่องจังหวัด) ติดไปกับระดับสุดท้ายที่พบ ("อ.อุทุมพรพิสัย ศรีสะเกษ")
 * "ต. ท่าช้าง" (เว้นวรรคหลังคำนำหน้า) = ก้อนถัดไปคือชื่อ · ไม่มีช่องแยกเลย = ไม่แยก (คืนข้อความเดิม) ที่อยู่เต็มแบบเก่าจึงไม่เพี้ยน
 * ⚠️ สูตรเดียวกับบอท claim_data.split_admin_tail — แก้ที่หนึ่งต้องแก้อีกที่
 */
export function splitAdminTail(address: unknown, subdistrict: unknown, district: unknown, province: unknown): { head: string; typed: Partial<Record<Level, string>> } {
  const addr = s(address).replace(/\s+/g, ' ');
  const names = adminNames(subdistrict, district, province);
  if (!names.sub && !names.dist && !names.prov) return { head: addr, typed: {} };
  const toks = [...addr.matchAll(/[^\s,]+/gu)].map((m) => ({ start: m.index ?? 0, tok: m[0] }));
  const bkk = isBangkok(names.prov) || toks.some((x) => BKK_BARE.test(x.tok));
  const levelOf = (tok: string): [Level, string | null] | null => {
    for (const lv of LEVELS) {
      const [pre, bkkPre] = TAG_RE[lv];
      const m = new RegExp(`^(?:${pre}${bkk && bkkPre ? `|${bkkPre}` : ''})(.*)$`, 'u').exec(tok);
      if (m) return [lv, m[1]];
    }
    for (const lv of LEVELS) if (names[lv] && tok === names[lv]) return [lv, null];
    if (bkk && BKK_BARE.test(tok)) return ['prov', null];
    return null;
  };
  const typed: Partial<Record<Level, string>> = {};
  const mid: string[] = [];
  let pending: string[] = [];
  let start: number | null = null;
  let lastLv: Level | null = null;
  for (let i = 0; i < toks.length; i++) {
    const { start: s0, tok } = toks[i];
    const lv = levelOf(tok);
    if (!lv) { if (start !== null) pending.push(tok); continue; }   // ยังไม่รู้ว่าอยู่กลางหางหรือท้ายหาง
    if (start === null) start = s0;
    mid.push(...pending); pending = [];                               // มีก้อนที่รู้จักตามมา = ก้อนพวกนี้อยู่กลางหาง → คืน head
    let text = tok;
    if (lv[1] === '' && i + 1 < toks.length && !levelOf(toks[i + 1].tok)) { text = tok + toks[i + 1].tok; i++; }
    if (typed[lv[0]] === undefined) { typed[lv[0]] = text; lastLv = lv[0]; }
  }
  if (start === null) return { head: addr, typed: {} };
  if (pending.length && lastLv) { typed[lastLv] = `${typed[lastLv]} ${pending.join(' ')}`; pending = []; }   // ก้อนท้ายหาง → ติดกับระดับสุดท้ายที่พบ
  return { head: tidy(addr.slice(0, start) + ' ' + [...mid, ...pending].join(' ')), typed };
}

/** บ้านเลขที่ที่ไม่มี ต./อ./จ. ของระดับที่มีช่องแยกแล้ว — ระดับที่ไม่มีช่องแยกคงข้อความที่พิมพ์ไว้ (ตามลำดับ ต. อ. จ.) · ใช้ตอนบันทึก (normalize) ให้ข้อมูลในระบบสะอาด */
export function stripAdminParts(address: unknown, subdistrict: unknown, district: unknown, province: unknown): string {
  const { head, typed } = splitAdminTail(address, subdistrict, district, province);
  const names = adminNames(subdistrict, district, province);
  const keep = LEVELS.filter((lv) => !names[lv] && typed[lv]).map((lv) => typed[lv] as string);
  return tidy([...(head ? [head] : []), ...keep].join(' '));
}

/** แทรก "ม.<เลข>" ถัดจากบ้านเลขที่ (ก้อนแรกที่มีตัวเลข) — ไม่มีบ้านเลขที่ค่อยต่อท้าย */
function insertMoo(addr: string, m: string): string {
  if (!m) return addr;
  if (!addr) return `ม.${m}`;
  const hit = /(?:^|[\s,])([^\s,]*\d[^\s,]*)(?=[\s,]|$)/u.exec(addr);
  if (!hit) return `${addr} ม.${m}`;
  const end = hit.index + hit[0].length;
  return tidy(`${addr.slice(0, end)} ม.${m} ${addr.slice(end)}`);
}

/** ผู้ขับขี่รถประกัน: อำเภอ/จังหวัด (ถ้าส่งมา) ใช้ตัดที่พิมพ์ปนเท่านั้น ไม่ต่อในข้อความ — ไป dropdown ของ EMCS · กรุงเทพ → "แขวง" (21/09/69) */
export function driverAddressLine(address: unknown, moo: unknown, subdistrict: unknown, district: unknown = '', province: unknown = ''): string {
  const split = splitMoo(isPlaceholder(address) ? '' : address);   // บ้านเลขที่ "-"/"รอตรวจสอบ" = ไม่ทราบ (20/09/69)
  const m = s(moo).replace(MOO_PREFIX, '').trim() || split.moo;   // ช่องหมู่ที่กรอกมาชนะเลขที่ปนในข้อความ
  const names = adminNames(subdistrict, district, province);
  const { head, typed } = splitAdminTail(split.address, subdistrict, district, province);
  const bkk = isBangkok(names.prov) || isBangkok(typed.prov ?? '');
  const parts: string[] = [];
  if (head || m) parts.push(insertMoo(head, m));
  if (names.sub) parts.push(bkk ? `แขวง${names.sub}` : `ต.${names.sub}`);
  else if (typed.sub) parts.push(typed.sub);
  for (const lv of ['dist', 'prov'] as Level[]) {   // อ./จ. ที่พิมพ์ไว้คงเดิมเฉพาะเมื่อไม่มีช่องแยก (มีช่องแยก = ไป dropdown ไม่ใส่ในข้อความ)
    if (!names[lv] && typed[lv]) parts.push(typed[lv] as string);
  }
  return parts.join(' ');
}

/** ที่อยู่ปัจจุบันผู้ขับขี่รถคู่กรณี → "46/23 ม.7 ต.ท้ายบ้าน อ.เมือง จ.สมุทรปราการ" (กรุงเทพ: แขวง/เขต/กรุงเทพฯ) */
export function opponentAddressLine(address: unknown, moo: unknown, subdistrict: unknown, district: unknown, province: unknown): string {
  const split = splitMoo(isPlaceholder(address) ? '' : address);   // บ้านเลขที่ "-"/"รอตรวจสอบ" = ไม่ทราบ (20/09/69)
  const m = s(moo).replace(MOO_PREFIX, '').trim() || split.moo;
  const names = adminNames(subdistrict, district, province);
  // 21/09/69: หาง ต./อ./จ. ที่พิมพ์ปนถูกแยกออก · ช่องแยกชนะ · ระดับที่ไม่มีช่องแยกคงที่พิมพ์ไว้ · ประกอบตามลำดับ ต. อ. จ. เสมอ
  // → ไม่ซ้ำ "อ.เมือง … อ.เมืองจันทบุรี" (เคลม 2026013173082) และลำดับไม่เพี้ยน
  const { head, typed } = splitAdminTail(split.address, subdistrict, district, province);
  const bkk = isBangkok(names.prov) || isBangkok(typed.prov ?? '');
  const canon: Record<Level, string> = {
    sub: names.sub ? (bkk ? `แขวง${names.sub}` : `ต.${names.sub}`) : '',
    dist: names.dist ? (bkk ? `เขต${names.dist}` : `อ.${names.dist}`) : '',
    prov: names.prov ? (bkk ? 'กรุงเทพฯ' : `จ.${names.prov}`) : '',
  };
  const parts: string[] = [];
  if (head || m) parts.push(insertMoo(head, m));
  for (const lv of LEVELS) {
    if (canon[lv]) parts.push(canon[lv]);
    else if (typed[lv]) parts.push(typed[lv] as string);
  }
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
/** ที่อยู่แยกช่อง (ผู้บาดเจ็บ/เจ้าของทรัพย์สิน 21/09/69) ประกอบสูตรคู่กรณี · ประกอบได้ว่างแต่บ้านเลขที่เป็นตัวแทนค่า ("-"/"รอตรวจสอบ"/"--")
 *  → "-" ตามกติกาช่องข้อความ 20/09/69 (บอท/XML กรอก "-" แทนคำที่คนพิมพ์) · ว่างจริง → "" */
export function addressLineOrDash(address: unknown, moo: unknown, subdistrict: unknown, district: unknown, province: unknown): string {
  const line = opponentAddressLine(address, moo, subdistrict, district, province);
  return line || (isPlaceholder(address) ? '-' : '');
}

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
type AddrKeys = { addr: string; moo: string; sub: string; dist: string; prov: string };
const DRIVER_KEYS: AddrKeys = { addr: 'driver_address', moo: 'driver_moo', sub: 'driver_subdistrict', dist: 'driver_district', prov: 'driver_province' };
const CARD_KEYS: AddrKeys = { addr: 'address', moo: 'moo', sub: 'subdistrict', dist: 'district', prov: 'home_province' };   // คู่กรณี + ผู้บาดเจ็บ
const OWNER_KEYS: AddrKeys = { addr: 'owner_address', moo: 'owner_moo', sub: 'owner_subdistrict', dist: 'owner_district', prov: 'owner_province' };   // เจ้าของทรัพย์สิน

/**
 * ระเบียนเดียว: (1) หมู่ที่พิมพ์ปนในบ้านเลขที่ → ช่องหมู่ (เมื่อช่องหมู่ว่าง) (2) ต./อ./จ. ที่พิมพ์ปน → ตัด เมื่อระเบียนมีช่องแยกระดับนั้น (21/09/69)
 * แก้ object ที่ส่งมาโดยตรง · ไม่แตะเมื่อไม่ได้ส่งบ้านเลขที่มา
 */
function normalizeAddressRecord(rec: Record<string, unknown>, k: AddrKeys): void {
  if (typeof rec[k.addr] !== 'string') return;
  if (!s(rec[k.moo])) {
    const { address, moo } = splitMoo(rec[k.addr]);
    if (moo) { rec[k.addr] = address; rec[k.moo] = moo; }
  }
  if (s(rec[k.sub]) || s(rec[k.dist]) || s(rec[k.prov])) {
    const cleaned = stripAdminParts(rec[k.addr], rec[k.sub], rec[k.dist], rec[k.prov]);
    if (cleaned !== rec[k.addr]) rec[k.addr] = cleaned;
  }
}

export function normalizeDriverAddressFields(data: Record<string, unknown>): void {
  normalizeAddressRecord(data, DRIVER_KEYS);
}

/** อย่างเดียวกันสำหรับคู่กรณี 1 คัน (opposing_parties[].address → moo · ตัด ต./อ./จ. ที่พิมพ์ปน) */
export function normalizeOpponentAddressFields(o: Record<string, unknown>): void {
  normalizeAddressRecord(o, CARD_KEYS);
}

/** ผู้บาดเจ็บ (injured_persons[] คีย์ชุดเดียวกับคู่กรณี) + เจ้าของทรัพย์สิน (damaged_property[] owner_*) — 21/09/69 */
export function normalizeCardAddresses(data: Record<string, unknown>): void {
  for (const [key, keys] of [['injured_persons', CARD_KEYS], ['damaged_property', OWNER_KEYS]] as Array<[string, AddrKeys]>) {
    const arr = data[key];
    if (!Array.isArray(arr)) continue;
    for (const rec of arr) {
      if (rec && typeof rec === 'object' && !Array.isArray(rec)) normalizeAddressRecord(rec as Record<string, unknown>, keys);
    }
  }
}

/** ไล่ทุกคันใน data.opposing_parties (ถ้าส่งมา) */
export function normalizeOpponentsAddress(data: Record<string, unknown>): void {
  if (!Array.isArray(data.opposing_parties)) return;
  for (const o of data.opposing_parties) {
    if (o && typeof o === 'object' && !Array.isArray(o)) normalizeOpponentAddressFields(o as Record<string, unknown>);
  }
}
