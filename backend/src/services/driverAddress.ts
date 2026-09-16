/**
 * ที่อยู่ปัจจุบันผู้ขับขี่รถประกัน → ข้อความช่องเดียวสำหรับ EMCS/XML (user เคาะ 16/09/69)
 *
 * เว็บ/มือถือเก็บแยก: driver_address (บ้านเลขที่/ถนน) · driver_moo (หมู่) · driver_subdistrict (ตำบล) · จังหวัด · อำเภอ
 * EMCS มีช่องที่อยู่เป็นข้อความเดียว + dropdown จังหวัด/อำเภอ (ไม่มีช่องหมู่/ตำบล) → ประกอบเป็น
 *   "46/23 ม.7 ต.ท้ายบ้าน"   (จังหวัด/อำเภอไม่ใส่ในข้อความ — ไปช่อง dropdown อยู่แล้ว)
 * กติกา:
 *   - ส่วนไหนว่างก็ข้าม · ทั้งหมดว่าง = ""
 *   - ถ้าข้อความที่อยู่มี "ม.7"/"หมู่ 7" อยู่แล้ว (เคสเก่า/OCR/ISURVEY พิมพ์รวมมา) ไม่ต่อหมู่ซ้ำ
 *   - ถ้าข้อความมีชื่อตำบลอยู่แล้ว ไม่ต่อ "ต.<ตำบล>" ซ้ำ
 * บอท (se-autokey) ใช้สูตรเดียวกัน (autokey/claim_data.py driver_address_line) — แก้ที่หนึ่งต้องแก้อีกที่ · contract test ล็อกทั้งคู่
 */
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim();

export function driverAddressLine(address: unknown, moo: unknown, subdistrict: unknown): string {
  const addr = s(address).replace(/\s+/g, ' ');
  const m = s(moo).replace(/^(หมู่ที่|หมู่|ม\.)\s*/u, '').trim();
  const t = s(subdistrict).replace(/^(ตำบล|แขวง|ต\.)\s*/u, '').trim();
  const parts: string[] = [];
  if (addr) parts.push(addr);
  if (m && !new RegExp(`(^|\\s)(ม\\.|หมู่ที่|หมู่)\\s*${escapeRe(m)}(\\s|$)`, 'u').test(addr)) parts.push(`ม.${m}`);
  if (t && !addr.includes(t)) parts.push(`ต.${t}`);
  return parts.join(' ');
}

function escapeRe(x: string): string {
  return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
