/**
 * ที่อยู่ปัจจุบันผู้ขับขี่รถประกัน → ข้อความช่องเดียวสำหรับ EMCS/XML (user เคาะ 16/09/69)
 *
 * เว็บ/มือถือเก็บแยก: driver_address (บ้านเลขที่/ถนน) · driver_moo (หมู่) · driver_subdistrict (ตำบล) · จังหวัด · อำเภอ
 * EMCS มีช่องที่อยู่เป็นข้อความเดียว + dropdown จังหวัด/อำเภอ (ไม่มีช่องหมู่/ตำบล) → ประกอบเป็น
 *   "46/23 ม.7 ต.ท้ายบ้าน"   (จังหวัด/อำเภอไม่ใส่ในข้อความ — ไปช่อง dropdown อยู่แล้ว)
 * กติกา:
 *   - หมู่ที่ช่างพิมพ์ปนในบ้านเลขที่ ("46/23 หมู่ที่ 7" / "หมู่ 7" / "ม.7") ถูกแยกออกมาเป็นหมู่ให้อัตโนมัติ (user สั่ง 16/09/69 รอบ 2)
 *     → ข้อความออกมาเป็นรูปแบบเดียวเสมอ "ม.<เลข>" · ช่องหมู่ที่กรอกมาชนะเลขที่ปนในข้อความ
 *   - ตำบลที่พิมพ์ปนมาแบบ "ต.ท้ายบ้าน" ถูกย้ายไปท้ายสุดในรูปแบบเดียว · ชื่อตำบลเปล่า ๆ ที่มีอยู่แล้วในข้อความไม่ต่อซ้ำ
 *   - ส่วนไหนว่างก็ข้าม · ทั้งหมดว่าง = ""
 * บอท (se-autokey) ใช้สูตรเดียวกัน (autokey/claim_data.py driver_address_line/split_moo) — แก้ที่หนึ่งต้องแก้อีกที่ · contract test ล็อกทั้งคู่
 */
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();
const escapeRe = (x: string): string => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** จับ "หมู่ที่ 7" / "หมู่ 7" / "หมู่7" / "ม.7" / "ม. 7" ที่ขึ้นต้นข้อความหรือหลังช่องว่าง/จุลภาค — "หมู่บ้าน…" ไม่ติด (ต้องตามด้วยตัวเลข) */
const MOO_RE = /(?:^|(?<=[\s,]))(?:หมู่ที่|หมู่|ม\.)\s*(\d{1,3})(?=$|[\s,])/u;

/** แยกหมู่ออกจากบ้านเลขที่ → { address (ไม่มีหมู่แล้ว), moo ('' = ไม่มี) } */
export function splitMoo(address: unknown): { address: string; moo: string } {
  const addr = s(address).replace(/\s+/g, ' ');
  const m = MOO_RE.exec(addr);
  if (!m) return { address: addr, moo: '' };
  const rest = (addr.slice(0, m.index) + ' ' + addr.slice(m.index + m[0].length)).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/^[\s,]+|[\s,]+$/g, '');
  return { address: rest, moo: m[1] };
}

export function driverAddressLine(address: unknown, moo: unknown, subdistrict: unknown): string {
  const split = splitMoo(address);
  let addr = split.address;
  const mooIn = s(moo).replace(/^(หมู่ที่|หมู่|ม\.)\s*/u, '').trim();
  const m = mooIn || split.moo;                                        // ช่องหมู่ที่กรอกมาชนะเลขที่ปนในข้อความ
  const t = s(subdistrict).replace(/^(ตำบล|แขวง|ต\.)\s*/u, '').trim();
  if (t) {
    // "ต.ท้ายบ้าน"/"ตำบลท้ายบ้าน" ที่พิมพ์ปนมา → ตัดออกแล้วไปต่อท้ายในรูปแบบเดียว
    addr = addr.replace(new RegExp(`(?:^|(?<=[\\s,]))(?:ตำบล|แขวง|ต\\.)\\s*${escapeRe(t)}(?=$|[\\s,])`, 'u'), ' ')
      .replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/^[\s,]+|[\s,]+$/g, '');
  }
  const parts: string[] = [];
  if (addr) parts.push(addr);
  if (m) parts.push(`ม.${m}`);
  if (t && !addr.includes(t)) parts.push(`ต.${t}`);
  return parts.join(' ');
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
