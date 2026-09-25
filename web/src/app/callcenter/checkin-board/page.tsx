'use client';

// เวลาเข้างานพนักงาน — บอร์ดการ์ดตามพื้นที่ (จุด → เวร) ตามดีไซน์ "ตารางเวรประจำจุด"
// ข้อมูล: จุด+เวร+คน จากตารางจัดเวร (DB duty_schedules + seed roster-jun เหมือน duty-demo2)
//         overlay การลงเวลาจากแอป (attendance) จับคู่ด้วยรหัส SE → ใครเข้างานแล้ว + เวลา
import { useState, useEffect, useMemo, useCallback, useRef, CSSProperties } from 'react';
import api, { getPhotoUrl } from '@/lib/api';
import { ROSTER_JUN } from '../../duty-demo2/roster-jun';
import { PROVINCE_CENTERS, PROVINCE_SEED } from '../../duty-demo2/roster-provinces';

// ── ศูนย์/ภาค (ตรงกับ duty-demo2) ──
const REGIONS = [
  { key: 'bkk', label: 'กรุงเทพฯ' },
  { key: 'pmt', label: 'ปริมณฑล' },
  { key: 'upc', label: 'ต่างจังหวัด' },
];
const CENTERS: { id: string; name: string; region: string }[] = [
  { id: 'ladprao', name: 'ลาดพร้าว', region: 'bkk' },
  { id: 'raminthra', name: 'รามอินทรา', region: 'bkk' },
  { id: 'onnut', name: 'อ่อนนุช', region: 'bkk' },
  { id: 'bangkhae', name: 'บางแค', region: 'bkk' },
  { id: 'minburi', name: 'มีนบุรี', region: 'bkk' },
  { id: 'rama9', name: 'พระราม 9', region: 'bkk' },
  { id: 'bangna', name: 'บางนา', region: 'bkk' },
  { id: 'sathon', name: 'สาทร', region: 'bkk' },
  { id: 'rama2', name: 'พระราม 2', region: 'bkk' },
  { id: 'bangphlat', name: 'บางพลัด', region: 'bkk' },
  { id: 'pathum', name: 'ปทุมธานี', region: 'pmt' },
  { id: 'pakkret', name: 'ปากเกร็ด', region: 'pmt' },
  { id: 'nonthaburi', name: 'นนทบุรี', region: 'pmt' },
  { id: 'samutprakan', name: 'สมุทรปราการ', region: 'pmt' },
  ...PROVINCE_CENTERS,
];

// จังหวัด (ต่างจังหวัด) ใช้ pipeline เดียวกับ กทม. — center_id = province id ใน duty_schedules
const SEED_Y = 2026, SEED_M = 6; // ROSTER_JUN = ตารางเดือน มิ.ย. 2026 เท่านั้น
// seed ของศูนย์ตามเดือนที่ดู: จังหวัด = static เสมอ (ยังไม่จัดเวรลง DB), กทม./ปริมณฑล = ใช้ ROSTER_JUN เฉพาะ มิ.ย. 2026
// เดือนอื่นที่ DB ว่าง/ดึงตารางล้ม → ไม่ substitute แพตเทิร์นเดือน มิ.ย. หลอก (ให้ขึ้นว่าง/เตือนแทน)
const seedFor = (cid: string, y: number, m: number): { people: { code: string; name: string }[]; grid: string[][] } | undefined =>
  PROVINCE_SEED[cid] ?? (y === SEED_Y && m === SEED_M ? ROSTER_JUN[cid] : undefined);
type Band = 'morning' | 'afternoon' | 'night' | 'fix8' | 'fix10' | 'fix14' | 'offday';
const SHIFT_ORDER: Band[] = ['morning', 'afternoon', 'night', 'fix8', 'fix10', 'fix14', 'offday'];
const SH_META: Record<Band, { label: string; short: string; range: string }> = {
  morning: { label: 'เวร 1 · เช้า', short: 'เวร1', range: '07.00–16.00' },
  afternoon: { label: 'เวร 2 · บ่าย', short: 'เวร2', range: '15.00–24.00' },
  night: { label: 'เวร 3 · ดึก', short: 'เวร3', range: '23.00–08.00' },
  fix8: { label: 'FIX 8', short: 'FIX8', range: '08.00–17.00' },
  fix10: { label: 'FIX 10', short: 'FIX10', range: '10.00–19.00' },
  fix14: { label: 'FIX 14', short: 'FIX14', range: '14.00–23.00' },
  offday: { label: 'วันหยุด · อาสามาทำงาน', short: 'หยุด', range: '—' }, // ตารางให้หยุด แต่เช็คอินเข้ามาทำงาน
};
const isFix = (b: string) => b === 'fix8' || b === 'fix10' || b === 'fix14';
// ลำดับการแสดงภายใน "ความสำคัญ 1" (อยู่ในเวร): เวร1 → Fix7 → Fix11 → Fix14 → เวร2 → เวร3
const TIER1_ORDER: Band[] = ['morning', 'fix8', 'fix10', 'fix14', 'afternoon', 'night'];
// เวลาเริ่ม/สิ้นสุดของแต่ละเวร (นาทีจากเที่ยงคืน) — อ่านจาก SH_META.range เช่น '07.00–16.00'
const parseHM = (s: string) => { const [h, m] = s.split('.').map(Number); return (h || 0) * 60 + (m || 0); };
const bandStartMin = (b: Band) => parseHM(SH_META[b].range.split('–')[0]);
const bandEndMin = (b: Band) => parseHM(SH_META[b].range.split('–')[1]);
// ?now=HH:MM / ?now=HHMM — override "เวลาตอนนี้" เพื่อทดสอบ เปิดเฉพาะตอน dev (prod ห้ามปลอมเวลา/ธงอาสา)
const devNowOverride = (): number | null => {
  if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('now');
    if (q) {
      const parts = q.includes(':') ? q.split(':') : [q.slice(0, -2), q.slice(-2)];
      const h = Number(parts[0]), m = Number(parts[1]);
      if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m;
    }
  }
  return null;
};
// แปลง epoch ms → วันที่/นาที ตามเวลาไทย (Asia/Bangkok) ไม่ขึ้นกับ TZ ของเบราว์เซอร์ — ใช้คู่กับ offset เวลา server
const _bkkFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const bkkParts = (epochMs: number) => {
  const p: Record<string, string> = {};
  for (const x of _bkkFmt.formatToParts(new Date(epochMs))) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
};
// เวรนี้ "กำลังอยู่ในช่วงเวลาเวรหรือไม่" ณ เวลา now — รองรับเวรข้ามคืน (เช่น ดึก 23.00–08.00)
const bandInShift = (b: Band, now: number) => {
  if (b === 'offday') return false; // วันหยุดไม่มีช่วงเวรของตัวเอง → ทำงานเมื่อไหร่ก็เป็นอาสา
  const s = bandStartMin(b), e = bandEndMin(b);
  return e > s ? now >= s && now < e : now >= s || now < e;
};
// raw shift key (จากตาราง) → แถบเวรในการ์ด; off/none = ไม่ขึ้นเวร (ข้าม เว้นแต่เช็คอิน → 'offday')
const RAW_TO_BAND: Record<string, Band | null> = {
  s1: 'morning', s2: 'afternoon', s3: 'night',
  fix8: 'fix8', fix10: 'fix10', fix14: 'fix14', f1120: 'fix10', f1423: 'fix14',
  fix7: 'fix8', fix11: 'fix10', // legacy keys (เดือนเก่า) → นิยามใหม่
  off: null, none: null,
};

// legend เวร + เวลา (แสดงชิดขวาของหัวภูมิภาค) — สีตรงกับ "ตารางเวรประจำจุด"
const SHIFT_LEGEND: { dot: string; label: string }[] = [
  { dot: '#139DA0', label: 'เวร 1 · เช้า · 07.00–16.00' },
  { dot: '#E0991A', label: 'เวร 2 · บ่าย · 15.00–24.00' },
  { dot: '#6366E8', label: 'เวร 3 · ดึก · 23.00–08.00' },
  { dot: '#A855F7', label: 'FIX 8 · 08.00–17.00' },
  { dot: '#A855F7', label: 'FIX 10 · 10.00–19.00' },
  { dot: '#A855F7', label: 'FIX 14 · 14.00–23.00' },
];
// สี badge เวร (ในแต่ละแถว) — bg(tint) · text(ink) · border แยกตามเวร ตรงกับ legend
const SH_BADGE: Record<string, { ink: string; bg: string; bd: string }> = {
  morning:   { ink: '#0d6b6d', bg: '#def1f2', bd: '#8fd2d4' },
  afternoon: { ink: '#9C6206', bg: '#FBF0D9', bd: '#e6c98a' },
  night:     { ink: '#4A45C2', bg: '#EBEAFB', bd: '#bcb9f0' },
  fix8:      { ink: '#7E22CE', bg: '#F3E8FF', bd: '#d8b4f0' },
  fix10:     { ink: '#7E22CE', bg: '#F3E8FF', bd: '#d8b4f0' },
  fix14:     { ink: '#7E22CE', bg: '#F3E8FF', bd: '#d8b4f0' },
  offday:    { ink: '#64748b', bg: '#f1f5f9', bd: '#cbd5e1' }, // วันหยุด (อาสามาทำงาน) = เทา
};
// badge "อาสา" (กรอบเหมือนเวร คนละสี) — ใช้เมื่อพนักงานทำงานนอกช่วงเวรตัวเอง (ก่อน/หลังเวร หรือวันหยุด)
const VOL_BADGE = { ink: '#1d4ed8', bg: '#dbeafe', bd: '#93c5fd' };
const GREY_BADGE = { ink: '#64748b', bg: '#f1f5f9', bd: '#cbd5e1' }; // เวร badge ในนอกระบบ = เทา

type Status = 'present' | 'pending' | 'done' | 'leave';
const ST_META: Record<Status, { label: string; dot: string }> = {
  present: { label: 'เข้างานแล้ว', dot: 'var(--ok)' },
  done: { label: 'ออกงานแล้ว', dot: 'oklch(0.62 0.01 255)' },
  pending: { label: 'รอเข้างาน', dot: 'var(--pending)' },
  leave: { label: 'ลา', dot: '#d97706' },
};
const arrived = (s: Status) => s === 'present' || s === 'done'; // มาทำงานแล้ว (ยังอยู่ หรือ ออกแล้ว)
// ประเภทลา (leave_type จาก backend) → ป้ายไทย
const LEAVE_LABEL: Record<string, string> = { sick: 'ลาป่วย', personal: 'ลากิจ', vacation: 'ลาพักร้อน', other: 'ลา' };

type Person = {
  c: string; n: string; p: string; centerId: string; s: string; region: string;
  sh: Band; status: Status; t: string; tOut: string; tags: string[]; jobs: number; photo: string | null; leaveType?: string;
  off?: boolean; // วันหยุดตามตารางเวร (ไม่มีเวร + ไม่ได้เช็คอิน) → โชว์ในกลุ่ม "หยุดวันนี้" ไม่นับเป็นทำงาน/ยังไม่มา
  photoAt?: string; // photo เป็นรูปจากการลงเวลาครั้งก่อน (วันที่ดูยังไม่มีรูปของคนนี้) → ข้อความบอกว่าถ่ายเมื่อไร
};

type AttRow = { user_id: number; username?: string; user_name?: string; code?: string | null; check_in_time?: string | null; check_out_time?: string | null; check_in_photo?: string | null; work_date?: string };
// รูปลงเวลาล่าสุดของแต่ละคน (GET /api/attendance/latest-photos) — ตัวลบรูปเก็บรูปนี้ไว้เสมอ จึงโชว์ค้างได้จนกว่าจะถ่ายใหม่
type LatestPhotoRow = { user_id: number; username?: string; user_name?: string; code?: string | null; check_in_photo: string; work_date: string; check_in_time?: string | null };
type ZoneData = { staff: { id: string; code: string; name: string }[]; schedule: Record<string, Record<number, string>> };

const p2 = (n: number) => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const prevDateStr = (s: string) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const onlyDigits = (s: string) => (s || '').replace(/\D/g, '');
const fmtThaiDate = (s: string) => { try { return new Date(s + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return s; } };

// ── การ์ดดีไซน์ใหม่ (ทุกจุดกรุงเทพฯ) ──
const fmtThaiShort = (s: string) => { try { return new Date(s + 'T00:00:00').toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return s; } };
const ST_PILL: Record<Status, { cls: string; label: string }> = {
  present: { cls: 'ok', label: 'เข้างาน' },
  done: { cls: 'out', label: 'ออกแล้ว' },
  pending: { cls: 'wait', label: 'ยังไม่มา' },
  leave: { cls: 'leave', label: 'ลา' },
};
// avatar = รูปเช็คอินจริง (check_in_photo) ถ้ามี · ยังไม่ลงเวลาในวันที่ดู → รูปล่าสุดของคนนั้น; ไม่มี/โหลดไม่ได้ → อักษรย่อจากชื่อ
const nameInitials = (n: string) => (n || '').trim().slice(0, 2) || '—';
function AttAvatar({ photo, name, mini = false, title }: { photo: string | null; name: string; mini?: boolean; title?: string }) {
  // จำว่า "ไฟล์ไหน" โหลดพัง — รูปเปลี่ยน (ลงเวลาใหม่ระหว่างเปิดบอร์ด) ต้องลองโหลดรูปใหม่ ไม่ติดอักษรย่อค้าง
  const [errFor, setErrFor] = useState<string | null>(null);
  if (photo && errFor !== photo) return <img className="lpc-av-img" src={getPhotoUrl(photo)} alt={name} title={title} onError={() => setErrFor(photo)} />;
  return mini ? <>{nameInitials(name)}</> : <span className="lpc-av-in">{nameInitials(name)}</span>;
}
// ── ป้าย/ชิ้นเล็ก ──
function StatusDot({ status }: { status: Status }) {
  return <span className="dot" style={{ background: ST_META[status].dot }} title={ST_META[status].label} />;
}
function TimeChip({ status, t, tOut }: { status: Status; t: string; tOut?: string }) {
  if (status === 'leave') return <span className="timechip s-pending">ลา</span>;
  if (status === 'pending') return <span className="timechip s-pending">—</span>;
  if (status === 'done') return <span className="timechip s-done">{(t || '—') + ' – ' + (tOut || '—')}</span>;
  return <span className="timechip s-present"><span className="tc-ic">●</span>{t || 'เข้างานแล้ว'}</span>;
}
function Tag({ tag }: { tag: string }) {
  const cls = tag.startsWith('FIX') ? 't-fix' : tag === 'อาสา' ? 't-vol' : 't-soft';
  return <span className={`tag ${cls}`}>{tag}</span>;
}

function PersonRow({ p, onSelect, active }: { p: Person; onSelect: (p: Person) => void; active: boolean }) {
  return (
    <button className={`person ${p.status} ${active ? 'is-active' : ''}`} onClick={() => onSelect(p)}>
      <span className="p-code mono">{p.c}</span>
      <span className="p-main">
        <span className="p-name">{p.n}</span>
        {p.p && <span className="p-phone mono">{p.p}</span>}
      </span>
      <span className="p-tags">{p.tags.map((t) => <Tag key={t} tag={t} />)}</span>
      <span className="p-time"><TimeChip status={p.status} t={p.t} tOut={p.tOut} /></span>
    </button>
  );
}

function ShiftGroup({ band, people, onSelect, selected }: { band: Band; people: Person[]; onSelect: (p: Person) => void; selected: Person | null }) {
  const sh = SH_META[band];
  return (
    <div className={`shiftgroup sg-${band}`}>
      <div className="sg-head">
        <span className="sg-bar" />
        <span className="sg-label">{sh.short}</span>
        <span className="sg-range mono">{sh.range}</span>
        <span className="sg-count mono">{people.length}</span>
      </div>
      <div className="sg-people">
        {people.map((p) => (
          <PersonRow key={p.centerId + p.c + p.n} p={p} onSelect={onSelect} active={!!selected && selected.c === p.c && selected.n === p.n && selected.centerId === p.centerId} />
        ))}
      </div>
    </div>
  );
}

function StationCard({ name, people, onSelect, selected }: { name: string; people: Person[]; onSelect: (p: Person) => void; selected: Person | null }) {
  const present = people.filter((p) => arrived(p.status)).length;
  const total = people.length;
  const pct = total ? Math.round((present / total) * 100) : 0;
  const byBand: Record<string, Person[]> = {};
  people.forEach((p) => { (byBand[p.sh] = byBand[p.sh] || []).push(p); });
  return (
    <div className="card">
      <div className="card-head">
        <div className="ch-left"><span className="ch-pin">◈</span><h3 className="ch-name">{name}</h3></div>
        <div className="ch-meter" title={`เข้างาน ${present}/${total}`}>
          <span className="ch-frac mono"><b>{present}</b>/{total}</span>
          <span className="ch-bar"><span className="ch-fill" style={{ width: pct + '%' }} /></span>
        </div>
      </div>
      <div className="card-body">
        {SHIFT_ORDER.filter((k) => byBand[k]?.length).map((k) => (
          <ShiftGroup key={k} band={k} people={byBand[k]} onSelect={onSelect} selected={selected} />
        ))}
      </div>
    </div>
  );
}

// ไอคอน (โทร/แชท/ส่ง/แก้ไขกะ) — จากดีไซน์ "การ์ดเช็คอิน B"
const IcPhone = (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.7a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.1-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.7.6a2 2 0 0 1 1.7 2Z" /></svg>);
const IcChat = (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-4-1L3 20l1.1-4.9a8.4 8.4 0 0 1-.9-3.6 8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8.8 8Z" /></svg>);
const IcEdit = (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>);
const IcSend = (<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2 15 22 11 13 2 9Z" /></svg>);
const shiftStart = (band: Band) => (SH_META[band]?.range.split('–')[0] || '').replace('.', ':') || '—';

function LpcPerson({ p, onOpen, onToast, active }: { p: Person; onOpen: (p: Person) => void; onToast: (m: string) => void; active: boolean }) {
  const [hover, setHover] = useState(false);
  const timeText = (p.off || p.status === 'leave') ? '' : p.status === 'done' ? `${p.t || '—'} – ${p.tOut || '—'}` : p.status === 'present' ? (p.t || '—') : 'ยังไม่มา'; // ลา/หยุด → ให้ป้ายสีบอกแทน (ไม่ซ้ำ)
  const shc = p.status === 'present' ? SH_BADGE[p.sh] : GREY_BADGE; // นอกระบบ → badge เวรเทา
  return (
    <div className={`lpc-person ${p.status} ${active ? 'active' : ''}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={() => onOpen(p)} role="button" tabIndex={0}>
      <span className="lpc-av">
        <span className="lpc-av-ring"><AttAvatar photo={p.photo} name={p.n} title={p.photoAt} /></span>
        {arrived(p.status) && <span className="lpc-av-badge">✓</span>}
      </span>
      <span className="lpc-main">
        <span className="lpc-r1">
          <span className="lpc-code mono">{p.c.replace(/\s+/g, '')}</span>
          <span className="lpc-name">{p.n}</span>
          <span className="lpc-rt">
            <span className={`lpc-time ${p.status}`}>{timeText}</span>
            <span className="lpc-badges">
              {p.status === 'leave' && <span className="lpc-shbadge" style={{ color: '#b45309', background: '#fffbeb', borderColor: '#fcd34d' }} title="ลาที่อนุมัติแล้ว">{LEAVE_LABEL[p.leaveType || ''] || 'ลา'}</span>}
              {p.tags.includes('ข้ามคืน') && <span className="lpc-shbadge" style={{ color: '#64748b', background: '#f1f5f9', borderColor: '#cbd5e1' }} title="รอบค้างจากเมื่อวาน ยังไม่เช็คเอาท์">เมื่อวาน</span>}
              {p.tags.includes('อาสา') && p.status === 'present' && <span className="lpc-shbadge" style={{ color: VOL_BADGE.ink, background: VOL_BADGE.bg, borderColor: VOL_BADGE.bd }}>อาสา</span>}
              <span className="lpc-shbadge" style={{ color: shc.ink, background: shc.bg, borderColor: shc.bd }}>{p.off ? 'หยุด' : SH_META[p.sh].short}</span>
              {!p.off && p.status !== 'leave' && <span className="lpc-shbadge" style={{ color: '#475569', background: '#eef2f6', borderColor: '#cbd5e1' }} title="งานที่ถืออยู่ (ยังไม่ปิด)">{p.jobs} งาน</span>}
            </span>
          </span>
        </span>
      </span>
      {hover && (
        <span className="lpc-acts" onClick={(e) => e.stopPropagation()}>
          <button className="lpc-act accent" title="โทร" onClick={() => onToast(`กำลังโทรหา ${p.n}…`)}>{IcPhone}</button>
          <button className="lpc-act" title="แชท" onClick={() => onToast(`เปิดแชทกับ ${p.n}`)}>{IcChat}</button>
          <button className="lpc-act" title="ส่งข้อความ" onClick={() => onToast(`ส่งข้อความถึง ${p.n}`)}>{IcSend}</button>
        </span>
      )}
    </div>
  );
}

function LadpraoCard({ name, people, onOpen, onToast, selected }: { name: string; people: Person[]; onOpen: (p: Person) => void; onToast: (m: string) => void; selected: Person | null }) {
  const working = people.filter((p) => !p.off && p.status !== 'leave');    // คนที่ต้องเข้าเวรวันนี้ (รวมเช็คอิน/อาสา)
  const offPeople = people.filter((p) => p.off);                            // หยุดตามตารางเวร
  const leavePeople = people.filter((p) => !p.off && p.status === 'leave'); // ลาที่อนุมัติแล้ว (เคยต้องเข้าเวร)
  const byCode = (a: Person, b: Person) => a.c.localeCompare(b.c);
  const awayPeople = [...leavePeople].sort(byCode).concat([...offPeople].sort(byCode)); // ไม่เข้างานวันนี้ (ลา+หยุด) → กลุ่มเดียวท้ายการ์ด
  const awayLabel = 'หยุด / ลา วันนี้'; // กล่องเดียวรวม หยุด+ลา — แยกประเภทด้วยป้าย (หยุด=เทา, ลา=เหลือง) กันการ์ดดูเยอะ
  const came = working.filter((p) => arrived(p.status)).length;
  const absent = working.filter((p) => p.status === 'pending').length;
  const onLeave = leavePeople.length;
  // เรียงตามลำดับเวร แล้วเวลาเข้า — ให้ยังอ่านเป็นกลุ่มเวรได้แม้เอาแถบหัวเวรออก
  const byShift = (a: Person, b: Person) => {
    const d = SHIFT_ORDER.indexOf(a.sh) - SHIFT_ORDER.indexOf(b.sh);
    return d !== 0 ? d : (a.t || '').localeCompare(b.t || '');
  };
  // ความสำคัญการแสดง "ในระบบ" (2 ระดับ):
  //   1 = อยู่ในช่วงเวร — เรียงลำดับเวร เวร1 → Fix7 → Fix11 → Fix14 → เวร2 → เวร3 (TIER1_ORDER) → เวลาเช็คอิน
  //   2 = อาสา (นอกช่วงเวรตัวเอง/วันหยุด) — ไม่สนลำดับเวร เรียงตามเวลาเช็คอินอย่างเดียว (ใครออนไลน์อยู่ก่อนได้คิวก่อน)
  //   เสมอกัน: คนงานน้อยกว่าอยู่บน (กระจายงาน)
  const tierOf = (p: Person) => (p.tags.includes('อาสา') ? 2 : 1);
  // เวลา "ออนไลน์ตั้งแต่" — คนรอบค้างข้ามคืน (t = เวลาเมื่อวาน) ต้องอยู่ก่อนคนที่เพิ่งเข้าวันนี้เสมอ
  // (เทียบ HH:MM ตรง ๆ ทำให้ '22:50' เมื่อวาน > '08:30' วันนี้ → คนออนไลน์นานสุดตกไปท้ายคิว)
  const onlineKey = (p: Person) => (p.tags.includes('ข้ามคืน') ? '0' : '1') + (p.t || '');
  const byPriority = (a: Person, b: Person) =>
    (tierOf(a) - tierOf(b)) ||
    (tierOf(a) === 1 ? TIER1_ORDER.indexOf(a.sh) - TIER1_ORDER.indexOf(b.sh) : 0) ||
    onlineKey(a).localeCompare(onlineKey(b)) ||
    (a.jobs - b.jobs);
  const inList = [...working].filter((p) => p.status === 'present').sort(byPriority); // ในระบบ = เช็คอินอยู่ (เรียงตามลำดับความสำคัญ)
  const outList = [...working].filter((p) => p.status !== 'present').sort(byShift);  // นอกระบบ = ออกแล้ว + ยังไม่มา
  const isActive = (p: Person) => !!selected && selected.c === p.c && selected.n === p.n && selected.centerId === p.centerId;
  const BLUE = { '--band': '#0ea5e9', '--band-ink': '#0369a1', '--band-tint': '#e0f2fe' } as CSSProperties;
  const GREY = { '--band': 'var(--muted)', '--band-ink': 'var(--muted)', '--band-tint': 'var(--surface-2)' } as CSSProperties;
  return (
    <div className="lpc">
      <div className="lpc-head">
        <div className="lpc-htitle">
          <h3 className="lpc-name-h">{name}</h3>
        </div>
        <div className="lpc-counts">
          <span className="lpc-count ok"><b>{came}</b> เช็คอิน</span>
          <span className="lpc-count wait"><b>{absent}</b> ยังไม่มา</span>
          {onLeave > 0 && <span className="lpc-count leave"><b>{onLeave}</b> ลา</span>}
          {offPeople.length > 0 && <span className="lpc-count off"><b>{offPeople.length}</b> หยุด</span>}
        </div>
      </div>
      <div className="lpc-body">
        {inList.length > 0 && (
          <div className="lpc-shift lpc-in" style={BLUE}>
            {inList.map((p) => (
              <LpcPerson key={p.centerId + p.c + p.n} p={p} onOpen={onOpen} onToast={onToast} active={isActive(p)} />
            ))}
          </div>
        )}
        {outList.length > 0 && (
          <div className="lpc-shift lpc-out" style={GREY}>
            {outList.map((p) => (
              <LpcPerson key={p.centerId + p.c + p.n} p={p} onOpen={onOpen} onToast={onToast} active={isActive(p)} />
            ))}
          </div>
        )}
        {awayPeople.length > 0 && (
          <div className="lpc-shift lpc-offgrp" style={GREY}>
            <div className="lpc-offhead">{awayLabel} · {awayPeople.length}</div>
            {awayPeople.map((p) => (
              <LpcPerson key={p.centerId + p.c + p.n} p={p} onOpen={onOpen} onToast={onToast} active={isActive(p)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── การ์ดต่างจังหวัด (ยังไม่จัดเวร) — แสดงรายชื่อพนักงานในจังหวัด ยังไม่มีเวร/เช็คอิน ──
// staff ต่างจังหวัด + สถานะจากการลงเวลา (overlay) — ยังไม่จัดเวร แต่เช็คอินแล้วขึ้นเขียว
type PStaff = { code: string; name: string; status: Status; t: string; tOut: string; photo: string | null; leaveType?: string };

function ProvincePersonRow({ s }: { s: PStaff }) {
  const timeText = s.status === 'done' ? `${s.t || '—'} – ${s.tOut || '—'}`
    : s.status === 'present' ? (s.t || '—')
    : s.status === 'leave' ? (LEAVE_LABEL[s.leaveType || ''] || 'ลา')
    : 'ยังไม่จัดเวร';
  return (
    <div className={`lpc-person ${s.status}`}>
      <span className="lpc-av">
        <span className="lpc-av-ring"><AttAvatar photo={s.photo} name={s.name} /></span>
        {arrived(s.status) && <span className="lpc-av-badge">✓</span>}
      </span>
      <span className="lpc-main">
        <span className="lpc-r1">
          <span className="lpc-code mono">{s.code}</span>
          <span className="lpc-name">{s.name}</span>
          <span className="lpc-rt">
            <span className={`lpc-time ${s.status}`}>{timeText}</span>
            <span className="lpc-badges">
              {s.status === 'present' && <span className="lpc-shbadge" style={{ color: VOL_BADGE.ink, background: VOL_BADGE.bg, borderColor: VOL_BADGE.bd }} title="เช็คอินแล้ว (ยังไม่จัดเวร = อาสา)">อาสา</span>}
              {s.status === 'leave' && <span className="lpc-shbadge" style={{ color: '#b45309', background: '#fffbeb', borderColor: '#fcd34d' }}>{LEAVE_LABEL[s.leaveType || ''] || 'ลา'}</span>}
              {s.status === 'pending' && <span className="lpc-shbadge" style={{ color: '#64748b', background: '#f1f5f9', borderColor: '#cbd5e1' }} title="ยังไม่ได้กำหนดเวร">ยังไม่จัดเวร</span>}
            </span>
          </span>
        </span>
      </span>
    </div>
  );
}

function ProvinceCard({ name, staff }: { name: string; staff: PStaff[] }) {
  const came = staff.filter((s) => arrived(s.status)).length;
  const onLeave = staff.filter((s) => s.status === 'leave').length;
  return (
    <div className="lpc">
      <div className="lpc-head">
        <div className="lpc-htitle"><h3 className="lpc-name-h">{name}</h3></div>
        <div className="lpc-counts">
          <span className="lpc-count ok"><b>{came}</b> เช็คอิน</span>
          <span className="lpc-count wait"><b>{staff.length - came - onLeave}</b> ยังไม่มา</span>
          {onLeave > 0 && <span className="lpc-count leave"><b>{onLeave}</b> ลา</span>}
        </div>
      </div>
      <div className="lpc-body">
        <div className="lpc-shift">
          {staff.map((s) => <ProvincePersonRow key={s.code + s.name} s={s} />)}
        </div>
      </div>
    </div>
  );
}

function Field2({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (<div className="lpc-field"><div className="lpc-fl">{label}</div><div className={'lpc-fv' + (mono ? ' mono' : '')}>{value}</div></div>);
}

// แผงรายละเอียด (คลิกแถว) — เช็คอินวันนี้ + ประวัติย้อนหลัง + ปุ่มโทร/แชท/แก้ไขกะ (จากดีไซน์ B)
function LpcDetail({ p, onClose, onToast, serverEpoch }: { p: Person; onClose: () => void; onToast: (m: string) => void; serverEpoch: () => number }) {
  const pill = ST_PILL[p.status];
  const [hist, setHist] = useState<{ d: string; t: string }[] | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const code = onlyDigits(p.c);
    // ช่วงประวัติ 7 วัน อิงเวลา server (เวลาไทย) — เลื่อนวันด้วย ms (Asia/Bangkok ไม่มี DST) แล้ว project เป็นวันที่ไทย
    const mk = (back: number) => bkkParts(serverEpoch() - back * 86400000).date;
    api.get(`/api/attendance/report?from=${mk(7)}&to=${mk(1)}`).then((r) => {
      const rows: AttRow[] = r.data?.data?.rows ?? [];
      const byDay: Record<string, string> = {};
      rows.forEach((x) => { const wd = x.work_date; if (wd && x.check_in_time && onlyDigits(x.code || x.username || '') === code && !byDay[wd]) byDay[wd] = x.check_in_time; });
      setHist(Object.keys(byDay).sort().reverse().slice(0, 4).map((wd) => ({ d: fmtThaiShort(wd), t: byDay[wd] })));
    }).catch(() => setHist([]));
    return () => window.removeEventListener('keydown', onKey);
  }, [p, onClose, serverEpoch]);
  return (
    <div className="lpc-modal" onClick={onClose}>
      <div className="lpc-card" onClick={(e) => e.stopPropagation()}>
        <div className="lpc-mhead">
          <span className={`lpc-mav ${p.status}`}><AttAvatar photo={p.photo} name={p.n} mini title={p.photoAt} /></span>
          <div className="lpc-mid">
            <div className="lpc-mname">{p.n}</div>
            <div className="lpc-mse">{p.s} · <span className="mono">{p.c.replace(/\s+/g, '')}</span></div>
          </div>
          <span className={`lpc-pill ${pill.cls}`}>{pill.label}</span>
        </div>
        <div className="lpc-msec">
          <div className="lpc-mlabel">เช็คอินวันนี้</div>
          <div className="lpc-mgrid">
            <Field2 label="กะ" value={`${SH_META[p.sh].short} · ${SH_META[p.sh].range}`} />
            <Field2 label="เวลาเข้างาน" value={shiftStart(p.sh)} mono />
            <Field2 label="เช็คอินจริง" value={p.status === 'pending' ? '—' : (p.t || '—')} mono />
            <Field2 label={p.status === 'done' ? 'เวลาออก' : 'สถานะ'} value={p.status === 'done' ? (p.tOut || '—') : pill.label} mono={p.status === 'done'} />
          </div>
        </div>
        <div className="lpc-msec">
          <div className="lpc-mlabel">ประวัติเช็คอินล่าสุด</div>
          {hist === null ? <div className="lpc-mempty">กำลังโหลด…</div>
            : hist.length === 0 ? <div className="lpc-mempty">ยังไม่มีประวัติย้อนหลัง</div>
            : <div className="lpc-mhist">{hist.map((h, i) => (
                <div className="lpc-hrow" key={i}><span className="lpc-hdot" /><span className="lpc-hd">{h.d}</span><span className="lpc-ht mono">{h.t}</span></div>
              ))}</div>}
        </div>
        <div className="lpc-macts">
          <button className="lpc-mact primary" onClick={() => onToast(`กำลังโทรหา ${p.n}…`)}>{IcPhone}โทร</button>
          <button className="lpc-mact" onClick={() => onToast(`เปิดแชทกับ ${p.n}`)}>{IcChat}แชท</button>
          <button className="lpc-mact" onClick={() => onToast(`แก้ไข/มอบหมายกะของ ${p.n}`)}>{IcEdit}แก้ไขกะ</button>
        </div>
      </div>
    </div>
  );
}

function DetailDrawer({ p, onClose }: { p: Person | null; onClose: () => void }) {
  if (!p) return null;
  const m = ST_META[p.status];
  const sh = SH_META[p.sh];
  const rg = REGIONS.find((r) => r.key === p.region);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer">
        <button className="dw-close" onClick={onClose}>✕</button>
        <div className="dw-top"><span className="dw-code mono">{p.c}</span><span className="dw-status"><StatusDot status={p.status} />{m.label}</span></div>
        <h2 className="dw-name">{p.n}</h2>
        {p.p ? <a className="dw-phone mono" href={`tel:${p.p.replace(/-/g, '')}`}>{p.p}</a> : <span className="dw-phone mono" style={{ color: 'var(--muted)' }}>ไม่มีเบอร์</span>}
        <div className="dw-grid">
          <div className="dw-cell"><span className="dw-k">ประจำจุด</span><span className="dw-v">{p.s}</span></div>
          <div className="dw-cell"><span className="dw-k">ภูมิภาค</span><span className="dw-v">{rg?.label || p.region}</span></div>
          <div className="dw-cell"><span className="dw-k">เวร</span><span className="dw-v">{sh.label}</span></div>
          <div className="dw-cell"><span className="dw-k">ช่วงเวลา</span><span className="dw-v">{sh.range}</span></div>
          <div className="dw-cell"><span className="dw-k">{p.status === 'done' ? 'เวลาเข้า–ออก' : 'เวลาเข้างาน'}</span><span className="dw-v"><TimeChip status={p.status} t={p.t} tOut={p.tOut} /></span></div>
        </div>
        {p.tags.length > 0 && <div className="dw-tags">{p.tags.map((t) => <Tag key={t} tag={t} />)}</div>}
      </aside>
    </>
  );
}

export default function CallcenterAttendancePage() {
  const [date, setDate] = useState(todayStr());
  const [dbByCenter, setDbByCenter] = useState<Record<string, ZoneData>>({});
  const [dbPrevByCenter, setDbPrevByCenter] = useState<Record<string, ZoneData>>({}); // เดือนของ "เมื่อวาน" (ใช้หาเวรรอบค้างข้ามคืน)
  const [att, setAtt] = useState<AttRow[]>([]); // 2 วัน: เมื่อวาน + วันที่เลือก
  const [latest, setLatest] = useState<LatestPhotoRow[]>([]); // รูปลงเวลาล่าสุดของแต่ละคน (คนที่ยังไม่ลงเวลาในวันที่ดู)
  const [leaves, setLeaves] = useState<{ code?: string | null; leave_type?: string; start_date?: string; end_date?: string }[]>([]); // ใบลาอนุมัติแล้วครอบคลุมวันที่เลือก
  const [jobsByCode, setJobsByCode] = useState<Record<string, number>>({}); // รหัส(เลข) -> จำนวนงานที่ถืออยู่
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [shift, setShift] = useState<'all' | Band | 'fix'>('all');
  const [region, setRegion] = useState('all');
  const [statusF, setStatusF] = useState<'all' | Status>('all');
  const [sortMode, setSortMode] = useState<'name' | 'count'>('name');
  const [selected, setSelected] = useState<Person | null>(null);
  const [lpSel, setLpSel] = useState<Person | null>(null); // การ์ดกรุงเทพ: คลิกเปิดแผงรายละเอียด
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((m: string) => { setToast(m); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 1900); }, []);
  const [updatedAt, setUpdatedAt] = useState('');
  const [schedError, setSchedError] = useState(false); // ดึงตารางเวรล้ม → เตือน + อย่า fallback seed เดือนอื่น
  const loadSeq = useRef(0);                            // กัน response เก่าทับใหม่ (เปลี่ยนวันแล้ว batch เก่ามาช้า)
  // เวลา server (เวลาไทย) — ยึดเป็นหลักแทนนาฬิกาเครื่อง (กันเบราว์เซอร์ TZ อื่นคำนวณ "วันนี้"/อาสาเพี้ยน)
  const serverOffsetMs = useRef(0);              // = serverEpochMs - Date.now(); เป็น 0 จนกว่า /now จะตอบ (fallback = นาฬิกาเครื่อง)
  const [clockTick, setClockTick] = useState(0); // ticker บัมพ์ทุก 30 วิ → ดัน memo ที่อิง "ตอนนี้" ให้เดินต่อแม้บอร์ดเปิดค้างนาน
  const [userPickedDate, setUserPickedDate] = useState(false); // ผู้ใช้เลือกวันเอง → อย่า re-default ทับ
  const serverEpoch = useCallback(() => Date.now() + serverOffsetMs.current, []);
  const bkkToday = useCallback(() => bkkParts(serverEpoch()).date, [serverEpoch]);
  const bkkNowMinutes = useCallback(() => { const dev = devNowOverride(); return dev !== null ? dev : bkkParts(serverEpoch()).minutes; }, [serverEpoch]);

  const isToday = useMemo(() => date === bkkToday(), [date, clockTick, bkkToday]);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    const seq = ++loadSeq.current;   // token ของ batch นี้
    const prev = prevDateStr(date); // ดึงเผื่อเมื่อวาน — รอบเวรดึกที่ยังไม่เช็คเอาท์ (ข้ามคืน) ต้องโผล่บนบอร์ดวันนี้
    const [Y, M] = date.split('-').map(Number);
    const [PY, PM] = prev.split('-').map(Number);
    let schedOk = true; // ตารางเวรของ "วันที่เลือก" ดึงสำเร็จไหม (แยกจาก endpoint อื่น)
    Promise.all([
      api.get(`/api/duty/schedules?y=${Y}&m=${M}`).then((r) => r.data?.data?.schedules ?? {}).catch(() => { schedOk = false; return {}; }),
      api.get(`/api/attendance/report?from=${prev}&to=${date}`).then((r) => r.data?.data?.rows ?? []).catch(() => []),
      api.get(`/api/cases/workload`).then((r) => r.data?.data ?? []).catch(() => []),
      PY === Y && PM === M
        ? Promise.resolve(null)
        : api.get(`/api/duty/schedules?y=${PY}&m=${PM}`).then((r) => r.data?.data?.schedules ?? {}).catch(() => ({})),
      api.get(`/api/leave/active?date=${date}`).then((r) => r.data?.data?.requests ?? []).catch(() => []),
      // ดึงพลาด = null → คงรูปชุดเดิมไว้ (ไม่ให้รูปหายวูบเป็นอักษรย่อตอนเน็ตสะดุดรอบเดียว)
      api.get('/api/attendance/latest-photos').then((r) => r.data?.data?.rows ?? null).catch(() => null),
    ]).then(([sched, rows, workload, prevSched, leaveRows, latestRows]) => {
      if (seq !== loadSeq.current) return; // มี load ใหม่กว่า (เปลี่ยนวัน/refresh) → ทิ้งผลเก่า กันข้อมูลวันอื่นทับ
      setSchedError(!schedOk);
      setDbByCenter(sched as Record<string, ZoneData>);
      setDbPrevByCenter((prevSched ?? sched) as Record<string, ZoneData>);
      setAtt(rows as AttRow[]);
      if (latestRows) setLatest(latestRows as LatestPhotoRow[]);
      setLeaves(leaveRows as { code?: string | null; leave_type?: string; start_date?: string; end_date?: string }[]);
      const jmap: Record<string, number> = {};
      (workload as { code?: string | null; active?: number }[]).forEach((w) => { const k = onlyDigits(w.code || ''); if (k) jmap[k] = Number(w.active) || 0; });
      setJobsByCode(jmap);
      // ดึงตารางเวรล้ม → อย่ารีเฟรช "อัปเดต HH:MM" (กันหลอกว่าข้อมูลสด ทั้งที่กำลังโชว์ของเก่า/ว่าง)
      if (schedOk) setUpdatedAt(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }));
    }).finally(() => { if (seq === loadSeq.current) setLoading(false); });
  }, [date]);

  useEffect(() => { load(); }, [load]);
  // ดึงเวลา server (เวลาไทย) ครั้งเดียวตอน mount → คำนวณ offset เทียบนาฬิกาเครื่อง + ตั้งวันเริ่มต้นเป็น "วันนี้" ของ server (ถ้าผู้ใช้ยังไม่เลือกเอง)
  useEffect(() => {
    let alive = true, attempts = 0;
    const fetchNow = () => {
      const t0 = Date.now();
      api.get('/api/attendance/now').then((r) => {
        if (!alive) return;
        const d = r.data?.data;
        if (!d || typeof d.epochMs !== 'number') throw new Error('bad /now');
        const rtt = (Date.now() - t0) / 2; // ชดเชย latency ครึ่งทาง (สมมติ symmetric)
        serverOffsetMs.current = (d.epochMs + rtt) - Date.now();
        setUserPickedDate((picked) => { if (!picked && d.today) setDate(d.today); return picked; });
        setClockTick((n) => n + 1);
      }).catch(() => { if (alive && attempts < 4) { attempts += 1; setTimeout(fetchNow, 1000 * attempts); } }); // retry 1s,2s,3s,4s; ล้มหมด → offset=0 = นาฬิกาเครื่อง
    };
    fetchNow();
    return () => { alive = false; };
  }, []);
  // ticker: ดัน "ตอนนี้" ทุก 30 วิ (บอร์ดเปิดค้างนาน ธงอาสา/ช่วงเวรต้องเดินต่อ) + ข้ามเที่ยงคืนไทยแล้ว re-default วัน (ถ้าผู้ใช้ยังไม่เลือกเอง)
  useEffect(() => {
    const t = setInterval(() => {
      setClockTick((n) => n + 1);
      setUserPickedDate((picked) => { if (!picked) setDate((cur) => { const td = bkkToday(); return cur === td ? cur : td; }); return picked; });
    }, 30000);
    return () => clearInterval(t);
  }, [bkkToday]);
  useEffect(() => { if (!isToday) return; const t = setInterval(() => load(true), 30000); return () => clearInterval(t); }, [isToday, load]);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelected(null); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);

  // index การลงเวลา "ของวันที่เลือก": รหัส(ตัวเลข)/ชื่อ → { เข้าเร็วสุด, ออกช้าสุด, ยังเปิดอยู่ไหม }
  // open=true ถ้ามี "รอบ" ที่ยังไม่ลงเวลาออก (check_out ว่าง) → ยังทำงานอยู่; ถ้าปิดหมด → ออกงานแล้ว
  const attIndex = useMemo(() => {
    type Rec = { in: string; out: string | null; open: boolean; photo: string | null; pin: string };
    const byCode: Record<string, Rec> = {}, byName: Record<string, Rec> = {};
    const merge = (map: Record<string, Rec>, key: string, inT: string, outT: string | null, photo: string | null) => {
      if (!key) return;
      const ex = map[key];
      if (!ex) { map[key] = { in: inT, out: outT, open: !outT, photo, pin: photo ? inT : '' }; return; }
      if (inT && (!ex.in || inT < ex.in)) ex.in = inT;        // เข้าเร็วสุด (เวลาที่แสดง)
      if (outT && (!ex.out || outT > ex.out)) ex.out = outT;  // ออกช้าสุด
      if (!outT) ex.open = true;                              // มีรอบเปิดค้าง → ยังทำงานอยู่
      if (photo && inT >= ex.pin) { ex.photo = photo; ex.pin = inT; }  // รูป = รอบเช็คอินล่าสุด (เปลี่ยนทุกครั้งที่ถ่ายใหม่)
    };
    att.filter((r) => r.work_date === date).forEach((r) => {
      const inT = r.check_in_time || '';
      const outT = r.check_out_time || null;
      merge(byCode, onlyDigits(r.code || r.username || ''), inT, outT, r.check_in_photo || null);
      merge(byName, (r.user_name || '').trim(), inT, outT, r.check_in_photo || null);
    });
    return { byCode, byName };
  }, [att, date]);

  // รูปลงเวลาล่าสุดของแต่ละคน: รหัส(ตัวเลข)/ชื่อ → { รูป, ข้อความบอกว่าถ่ายเมื่อไร }
  // ใช้กับคนที่ "วันที่ดู" ยังไม่มีรูปของตัวเอง (ยังไม่ลงเวลา/ลา/หยุด) — รูปค้างไว้จนกว่าจะลงเวลาใหม่ (user เคาะ 25/09/69)
  const latestIndex = useMemo(() => {
    type LRec = { photo: string; at: string };
    const byCode: Record<string, LRec> = {}, byName: Record<string, LRec> = {};
    latest.forEach((r) => {
      const rec = { photo: r.check_in_photo, at: `รูปจากการลงเวลาครั้งล่าสุด ${fmtThaiShort(r.work_date)} ${r.check_in_time || ''} น.` };
      const k = onlyDigits(r.code || r.username || '');
      if (k && !byCode[k]) byCode[k] = rec;
      const n = (r.user_name || '').trim();
      if (n && !byName[n]) byName[n] = rec;
    });
    return { byCode, byName };
  }, [latest]);

  // รอบค้างข้ามคืนจาก "เมื่อวาน" (เช็คอินแล้วยังไม่เช็คเอาท์ เช่น เวรดึก 23.00–08.00) → ถือว่ายังทำงานอยู่บนบอร์ดวันนี้
  const carryIndex = useMemo(() => {
    const prev = prevDateStr(date);
    type CRec = { t: string; photo: string | null };
    const byCode: Record<string, CRec> = {}, byName: Record<string, CRec> = {}; // → เวลา+รูปเช็คอินเมื่อวาน
    att.filter((r) => r.work_date === prev && r.check_in_time && !r.check_out_time).forEach((r) => {
      const k = onlyDigits(r.code || r.username || '');
      if (k && !byCode[k]) byCode[k] = { t: r.check_in_time!, photo: r.check_in_photo || null };
      const n = (r.user_name || '').trim();
      if (n && !byName[n]) byName[n] = { t: r.check_in_time!, photo: r.check_in_photo || null };
    });
    return { byCode, byName };
  }, [att, date]);

  // เวรของ "เมื่อวาน" ต่อรหัสพนักงาน (ไว้ติดป้ายให้รอบค้างข้ามคืน) — DB เดือนของเมื่อวาน ทับ seed
  const yBandByCode = useMemo(() => {
    const prev = prevDateStr(date);
    const Dy = Number(prev.split('-')[2]);
    const map: Record<string, Band> = {};
    for (const c of CENTERS) {
      const db = dbPrevByCenter[c.id];
      if (db && db.staff?.length) {
        db.staff.forEach((s) => {
          const b = RAW_TO_BAND[db.schedule?.[s.id]?.[Dy] ?? 'none'];
          const k = onlyDigits(s.code);
          if (k && b) map[k] = b;
        });
      } else {
        const seed = seedFor(c.id, +prev.slice(0, 4), +prev.slice(5, 7));
        if (seed) seed.people.forEach((pp, i) => {
          const b = RAW_TO_BAND[seed.grid[Dy - 1]?.[i] ?? 'none'];
          const k = onlyDigits(pp.code);
          if (k && b) map[k] = b;
        });
      }
    }
    return map;
  }, [dbPrevByCenter, date]);

  // รหัส(เลข) → ประเภทลา ของคนที่ "ลาอนุมัติแล้ว" ครอบคลุมวันที่เลือก (endpoint กรองวันให้แล้ว)
  const leaveByCode = useMemo(() => {
    const m: Record<string, string> = {};
    leaves.forEach((l) => { const k = onlyDigits(l.code || ''); if (k) m[k] = l.leave_type || 'other'; });
    return m;
  }, [leaves]);

  // รวมรายชื่อจากตาราง (DB ทับ seed) ของวันที่เลือก → ใส่สถานะจากการลงเวลา
  const allPeople = useMemo(() => {
    const D = Number(date.split('-')[2]);
    const NOW = bkkNowMinutes(); // เวลาปัจจุบัน (นาที, เวลาไทยจาก server) — ใช้ตัดสิน "อาสา = มาก่อนเวรตัวเองเริ่ม"
    const out: Person[] = [];
    for (const c of CENTERS) {
      const db = dbByCenter[c.id];
      const rows: { code: string; name: string; raw: string }[] = [];
      if (db && db.staff?.length) {
        db.staff.forEach((s) => rows.push({ code: s.code, name: s.name, raw: db.schedule?.[s.id]?.[D] ?? 'none' }));
      } else {
        const seed = seedFor(c.id, +date.slice(0, 4), +date.slice(5, 7));
        if (seed) seed.people.forEach((pp, i) => rows.push({ code: pp.code, name: pp.name, raw: seed.grid[D - 1]?.[i] ?? 'none' }));
      }
      rows.forEach((r) => {
        const codeDigits = onlyDigits(r.code);
        const rec = attIndex.byCode[codeDigits] ?? attIndex.byName[r.name.trim()];
        // รอบค้างข้ามคืนจากเมื่อวาน (ยังไม่เช็คเอาท์) — ใช้เมื่อวันนี้ยังไม่มีรอบของตัวเอง
        const carry = !rec ? (carryIndex.byCode[codeDigits] ?? carryIndex.byName[r.name.trim()]) : undefined;
        const last = latestIndex.byCode[codeDigits] ?? latestIndex.byName[r.name.trim()]; // รูปล่าสุด (ครั้งก่อน)
        let band = RAW_TO_BAND[r.raw];
        if (!band) {
          if (!rec && !carry) {
            // วันหยุด/ไม่มีเวร และไม่ได้เช็คอิน → โชว์ในกลุ่ม "หยุดวันนี้" (ครบตามตารางเวร) ไม่นับเป็นทำงาน/ยังไม่มา
            out.push({
              c: r.code, n: r.name, p: '', centerId: c.id, s: c.name, region: c.region,
              sh: 'offday', status: 'pending', t: '', tOut: '', tags: [], jobs: 0, photo: last?.photo ?? null, photoAt: last?.at, off: true,
            });
            return;
          }
          band = 'offday';  // วันหยุดแต่เช็คอินเข้ามา = อาสามาทำงาน → แสดงบนบอร์ด
        }
        if (carry) band = yBandByCode[codeDigits] ?? 'offday'; // ข้ามคืน: ติดป้ายเวรของเมื่อวาน (เช่น เวร3)
        let status: Status = carry ? 'present' : !rec ? 'pending' : rec.open ? 'present' : 'done';
        // คนมีเวรแต่ "ลาอนุมัติแล้ว" และยังไม่เช็คอิน → ป้าย "ลา" (แทนการนับเป็นยังไม่มา/ขาด)
        const leaveType = status === 'pending' ? leaveByCode[codeDigits] : undefined;
        if (leaveType) status = 'leave';
        // อาสา = กำลังทำงานอยู่ (present) แต่อยู่นอกช่วงเวรของตัวเอง (ก่อนเริ่ม หรือ เลยเวลาเลิกเวร)
        const isVolNow = status === 'present' && !bandInShift(band, NOW);
        out.push({
          c: r.code, n: r.name, p: '', centerId: c.id, s: c.name, region: c.region,
          sh: band, status, t: carry?.t ?? rec?.in ?? '', tOut: rec && !rec.open ? (rec.out || '') : '',
          tags: [...(carry ? ['ข้ามคืน'] : []), ...(isFix(band) ? [SH_META[band].short] : []), ...(isVolNow ? ['อาสา'] : [])],
          jobs: jobsByCode[codeDigits] ?? 0,
          // รูปของวันที่ดูก่อน (รอบข้ามคืน/วันนี้) · ยังไม่มี → รูปล่าสุดที่ค้างไว้จนกว่าจะลงเวลาใหม่
          photo: carry?.photo ?? rec?.photo ?? last?.photo ?? null,
          photoAt: (carry?.photo || rec?.photo) ? undefined : last?.at,
          leaveType,
        });
      });
    }
    return out;
  }, [dbByCenter, attIndex, carryIndex, latestIndex, yBandByCode, date, jobsByCode, clockTick, bkkNowMinutes, leaveByCode]);

  // เช็คอินของวันที่เลือกที่ "จับคู่ตารางเวรไม่ได้" (รหัส SE/ชื่อ ไม่ตรงตารางใด ๆ) → ไม่ขึ้นบนบอร์ดเลย
  // โชว์เป็นป้ายเตือน เพื่อแยก "ขาดงานจริง" ออกจาก "จับคู่พลาด" (รหัสผิด/ชื่อไม่ตรงบัญชีแอป)
  const unmatched = useMemo(() => {
    const codes = new Set<string>();
    const names = new Set<string>();
    const norm = (s: string) => (s || '').replace(/\s+/g, '').toUpperCase();
    for (const c of CENTERS) {
      const db = dbByCenter[c.id];
      if (db && db.staff?.length) {
        db.staff.forEach((s) => { const k = onlyDigits(s.code); if (k) codes.add(k); const n = (s.name || '').trim(); if (n) names.add(n); });
      } else {
        const seed = seedFor(c.id, +date.slice(0, 4), +date.slice(5, 7));
        if (seed) seed.people.forEach((pp) => { const k = onlyDigits(pp.code); if (k) codes.add(k); const n = (pp.name || '').trim(); if (n) names.add(n); });
      }
    }
    type Orphan = { code: string; name: string; in: string; out: string | null; open: boolean; photo: string | null; pin: string };
    const byKey: Record<string, Orphan> = {};
    att.filter((r) => r.work_date === date && r.check_in_time).forEach((r) => {
      const cd = onlyDigits(r.code || r.username || '');
      const nm = (r.user_name || '').trim();
      const full = norm(r.code || r.username || '');
      if ((cd && codes.has(cd)) || (nm && names.has(nm))) return; // จับคู่ได้ → อยู่บนบอร์ดแล้ว (รวมต่างจังหวัด)
      const key = full || nm || String(r.user_id);
      const inT = r.check_in_time || '';
      const outT = r.check_out_time || null;
      const photo = r.check_in_photo || null;
      const ex = byKey[key];
      if (!ex) { byKey[key] = { code: r.code || r.username || '—', name: nm || '(ไม่มีชื่อ)', in: inT, out: outT, open: !outT, photo, pin: photo ? inT : '' }; return; }
      if (inT && (!ex.in || inT < ex.in)) ex.in = inT;
      if (outT && (!ex.out || outT > ex.out)) ex.out = outT;
      if (!outT) ex.open = true;
      if (photo && inT >= ex.pin) { ex.photo = photo; ex.pin = inT; }
    });
    return Object.values(byKey);
  }, [att, date, dbByCenter]);

  // รหัส SE ที่ซ้ำในตารางเวรที่กำลังแสดง (รหัสเดียวอยู่หลายจุด/แถว) — เป็นความผิดพลาดในไฟล์เวร
  // แบบ "SE436 ลืมแก้ในไฟล์": digit-match จะยุบ 2 แถวเป็นคนเดียว/สถานะปนกัน → เตือนให้ไปแก้ไฟล์เวร
  const dupCodes = useMemo(() => {
    const occ: Record<string, { name: string; center: string }[]> = {};
    for (const c of CENTERS) {
      const db = dbByCenter[c.id];
      const add = (code: string, name: string) => {
        const k = onlyDigits(code); if (!k) return;
        (occ[k] ||= []).push({ name: (name || '').trim(), center: c.name });
      };
      if (db && db.staff?.length) db.staff.forEach((s) => add(s.code, s.name));
      else { const seed = seedFor(c.id, +date.slice(0, 4), +date.slice(5, 7)); if (seed) seed.people.forEach((pp) => add(pp.code, pp.name)); }
    }
    return Object.entries(occ)
      .filter(([, a]) => a.length > 1)
      .map(([digit, a]) => ({ digit, places: a.map((x) => `${x.name || '?'} · ${x.center}`) }));
  }, [dbByCenter, date]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return allPeople.filter((p) => {
      if (shift !== 'all' && p.sh !== shift && !(shift === 'fix' && isFix(p.sh))) return false;
      if (region !== 'all' && p.region !== region) return false;
      if (p.off && statusF !== 'all') return false; // คนหยุด ไม่เข้าเงื่อนไขสถานะทำงาน → ซ่อนเมื่อกรองสถานะ
      if (statusF !== 'all' && (statusF === 'present' ? !arrived(p.status) : p.status !== statusF)) return false;
      if (term && !`${p.c} ${p.n} ${p.p} ${p.s}`.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [allPeople, q, shift, region, statusF]);

  const stats = useMemo(() => {
    const work = filtered.filter((p) => !p.off);   // สถิติด้านบน = คนมีเวรวันนี้ (ไม่รวมคนหยุด)
    const present = work.filter((p) => arrived(p.status)).length;
    const out = work.filter((p) => p.status === 'done').length;
    const onLeave = work.filter((p) => p.status === 'leave').length;
    const fix = work.filter((p) => isFix(p.sh)).length;
    const off = filtered.filter((p) => p.off).length;
    return { total: work.length, present, out, leave: onLeave, pending: work.length - present - onLeave, fix, off };
  }, [filtered]);

  const regionGroups = useMemo(() => {
    return REGIONS.map((rg) => {
      const rows = filtered.filter((p) => p.region === rg.key);
      const byStation: Record<string, Person[]> = {};
      rows.forEach((p) => { (byStation[p.s] = byStation[p.s] || []).push(p); });
      const stations = Object.keys(byStation).map((name) => ({ name, people: byStation[name] }));
      if (sortMode === 'count') stations.sort((a, b) => b.people.length - a.people.length);
      else stations.sort((a, b) => a.name.localeCompare(b.name, 'th'));
      return { rk: rg.key, label: rg.label, stations, total: rows.length };
    }).filter((g) => g.stations.length);
  }, [filtered, sortMode]);

  // ── ไม่ระบุจุด: คนเช็คอินที่จับคู่จุด/จังหวัดไม่ได้ → การ์ดรวม (มาจาก unmatched) ผูกจุดแล้วย้ายออกเอง ──
  const unassignedStaff = useMemo<PStaff[]>(() => {
    if (region !== 'all') return [];   // โชว์เฉพาะมุมมองรวม (ไม่รบกวนตอนกรองภูมิภาค)
    if (shift !== 'all') return [];     // ไม่มีเวร → ซ่อนเมื่อกรองเวร
    const term = q.trim().toLowerCase();
    let staff: PStaff[] = unmatched.map((o) => ({
      code: o.code, name: o.name,
      status: (o.open ? 'present' : 'done') as Status,
      t: o.in || '', tOut: o.open ? '' : (o.out || ''),
      photo: o.photo || null,
    }));
    if (term) staff = staff.filter((s) => `${s.code} ${s.name}`.toLowerCase().includes(term));
    if (statusF !== 'all') staff = staff.filter((s) => statusF === 'present' ? arrived(s.status) : s.status === statusF);
    staff.sort((a, b) => (a.t || '').localeCompare(b.t || ''));
    return staff;
  }, [unmatched, region, shift, statusF, q]);

  const shiftChips: { k: 'all' | Band | 'fix'; label: string }[] = [
    { k: 'all', label: 'ทุกเวร' }, { k: 'morning', label: 'เวร1' }, { k: 'afternoon', label: 'เวร2' }, { k: 'night', label: 'เวร3' }, { k: 'fix', label: 'FIX' },
  ];
  const statusChips: { k: 'all' | Status; label: string }[] = [
    { k: 'all', label: 'ทุกสถานะ' }, { k: 'present', label: 'เข้างานแล้ว' }, { k: 'pending', label: 'รอเข้างาน' }, { k: 'leave', label: 'ลา' },
  ];

  return (
    <div className="atb">
      <style dangerouslySetInnerHTML={{ __html: ATB_CSS }} />

      <header className="topbar">
        <div className="tb-id">
          <div className="tb-mark">{loading ? '…' : '◴'}</div>
          <div className="tb-title">
            <h1>เวลาเข้างานพนักงาน · ประจำจุด</h1>
            <p>{fmtThaiDate(date)}{isToday && <span className="live"> · อัปเดตอัตโนมัติ{updatedAt && ` (${updatedAt})`}</span>}</p>
            {schedError && <p style={{ color: '#dc2626', fontSize: '0.8rem', fontWeight: 600 }}>⚠ ดึงตารางเวรไม่สำเร็จ — ข้อมูลเวร/สถานะอาจไม่ครบ กรุณารีเฟรช</p>}
          </div>
        </div>
        <div className="stats">
          <div className="stat st-total"><span className="stat-v mono">{stats.total}</span><span className="stat-l">ทั้งหมด</span></div>
          <div className="stat st-ok"><span className="stat-v mono">{stats.present}</span><span className="stat-l">เข้างานแล้ว</span></div>
          <div className="stat st-out"><span className="stat-v mono">{stats.out}</span><span className="stat-l">ออกแล้ว</span></div>
          <div className="stat st-pending"><span className="stat-v mono">{stats.pending}</span><span className="stat-l">รอเข้างาน</span></div>
          {stats.leave > 0 && <div className="stat st-leave"><span className="stat-v mono">{stats.leave}</span><span className="stat-l">ลา</span></div>}
          <div className="stat st-fix"><span className="stat-v mono">{stats.fix}</span><span className="stat-l">FIX</span></div>
          {stats.off > 0 && <div className="stat st-off"><span className="stat-v mono">{stats.off}</span><span className="stat-l">หยุดวันนี้</span></div>}
        </div>
      </header>

      <div className="toolbar">
        <div className="search">
          <span className="search-ic">⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา ชื่อ · รหัส · ประจำจุด" />
          {q && <button className="search-clear" onClick={() => setQ('')}>✕</button>}
        </div>
        <div className="chips">
          {shiftChips.map((c) => <button key={c.k} className={`chip ${shift === c.k ? 'on' : ''} ck-${c.k}`} onClick={() => setShift(c.k)}>{c.label}</button>)}
        </div>
        <div className="chips">
          <button className={`chip ${region === 'all' ? 'on' : ''}`} onClick={() => setRegion('all')}>ทั้งหมด</button>
          {REGIONS.map((r) => <button key={r.key} className={`chip ${region === r.key ? 'on' : ''}`} onClick={() => setRegion(r.key)}>{r.label}</button>)}
        </div>
        <div className="chips">
          {statusChips.map((c) => <button key={c.k} className={`chip soft ${statusF === c.k ? 'on' : ''}`} onClick={() => setStatusF(c.k)}>{c.label}</button>)}
        </div>
        <div className="rightctl">
          <input type="date" className="dateinput" value={date} max={bkkToday()} onChange={(e) => { setUserPickedDate(true); setDate(e.target.value || bkkToday()); }} />
          <div className="sort"><span>เรียง</span>
            <button className={sortMode === 'name' ? 'on' : ''} onClick={() => setSortMode('name')}>ชื่อจุด</button>
            <button className={sortMode === 'count' ? 'on' : ''} onClick={() => setSortMode('count')}>จำนวนคน</button>
          </div>
        </div>
      </div>

      {dupCodes.length > 0 && (
        <div style={{ margin: '12px 28px 0', padding: '9px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, color: '#991b1b', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>🔴 รหัสซ้ำในตารางเวร {dupCodes.length} รหัส</span>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flex: 1 }}>
            {dupCodes.slice(0, 8).map((d, i) => (
              <span key={i} style={{ background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 8, padding: '1px 8px', fontSize: 12.5 }}>
                <span className="mono">SE{d.digit}</span> · {d.places.join(' / ')}
              </span>
            ))}
            {dupCodes.length > 8 && <span style={{ color: '#b91c1c', fontSize: 12.5 }}>…อีก {dupCodes.length - 8}</span>}
          </span>
          <span style={{ color: '#b91c1c', fontSize: 12, whiteSpace: 'nowrap' }}>แก้ไฟล์เวร — รหัสเดียวอยู่หลายจุด</span>
        </div>
      )}

      {/* แถบเตือน unmatched เดิม → ย้ายเป็นการ์ด "ไม่ระบุจุด" ท้ายบอร์ดแล้ว */}

      <main className="board">
        {loading ? (
          <div className="empty">กำลังโหลด…</div>
        ) : (regionGroups.length === 0 && unassignedStaff.length === 0) ? (
          <div className="empty">ไม่พบรายการที่ตรงกับเงื่อนไข<br /><span style={{ fontSize: 13 }}>ตารางเวรของวันนี้ว่าง — จัดเวรได้ที่หน้า &quot;ตารางเวรประจำจุด&quot;</span></div>
        ) : (
          <>
            {regionGroups.map((g) => (
              <section key={g.rk} className="region">
                <div className="region-head">
                  <h2>{g.label}</h2>
                  <span className="region-meta mono">{g.stations.length} จุด · {g.total} คน</span>
                  <div className="shift-legend">
                    {SHIFT_LEGEND.map((s) => (
                      <span className="leg-item" key={s.label}><span className="leg-dot" style={{ background: s.dot }} />{s.label}</span>
                    ))}
                  </div>
                </div>
                <div className="cardgrid">
                  {/* ทุกจุด (กรุงเทพฯ + ปริมณฑล) ใช้การ์ด + ลำดับความสำคัญแบบใหม่เหมือนกัน */}
                  {g.stations.map((st) => (
                    <LadpraoCard key={st.name} name={st.name} people={st.people} onOpen={setLpSel} onToast={showToast} selected={lpSel} />
                  ))}
                </div>
              </section>
            ))}
            {unassignedStaff.length > 0 && (
              <section className="region">
                <div className="region-head">
                  <h2>ไม่ระบุจุด</h2>
                  <span className="region-meta mono">{unassignedStaff.length} คน · เช็คอินแต่ยังไม่อยู่จุด/จังหวัดใด</span>
                  <span className="prov-note">ผูกเข้าจุด/จังหวัดแล้วจะย้ายออกเอง · ถ้ารหัส/ชื่อไม่ตรง ให้แก้ที่ตารางเวร</span>
                </div>
                <div className="cardgrid">
                  <ProvinceCard name="ไม่ระบุจุด" staff={unassignedStaff} />
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <DetailDrawer p={selected} onClose={() => setSelected(null)} />
      {lpSel && <LpcDetail p={lpSel} onClose={() => setLpSel(null)} onToast={showToast} serverEpoch={serverEpoch} />}
      <div className={'lpc-toast' + (toast ? ' show' : '')}>{toast}</div>
    </div>
  );
}

const ATB_CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
.atb {
  --bg: oklch(0.97 0.005 250); --surface: #fff; --surface-2: oklch(0.985 0.004 250);
  --ink: oklch(0.27 0.02 255); --ink-2: oklch(0.45 0.02 255); --muted: oklch(0.60 0.015 255);
  --line: oklch(0.91 0.006 255); --line-2: oklch(0.94 0.005 255);
  --brand: oklch(0.52 0.13 248); --brand-soft: oklch(0.95 0.03 248);
  --ok: oklch(0.62 0.13 152); --leave: oklch(0.60 0.19 25); --off: oklch(0.68 0.02 255);
  --watch: oklch(0.74 0.15 78); --pending: oklch(0.70 0.015 255); --fix: oklch(0.55 0.16 305);
  --r: 14px; --shadow: 0 1px 2px oklch(0.4 0.02 255 / 0.05), 0 6px 20px oklch(0.4 0.02 255 / 0.06);
  font-family: Arial, Helvetica, sans-serif; color: var(--ink); font-size: 15px; line-height: 1.45;
  margin: -24px; background: var(--bg); min-height: calc(100vh - 64px);
}
.atb * { box-sizing: border-box; }
.atb .mono { font-family: 'IBM Plex Mono', monospace; }
.atb h1, .atb h2, .atb h3 { font-weight: 600; letter-spacing: -0.01em; margin: 0; }

.atb .topbar { position: sticky; top: 0; z-index: 12; display: flex; align-items: center; justify-content: space-between; gap: 24px; flex-wrap: wrap; padding: 16px 28px; background: oklch(0.99 0.003 250 / 0.9); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
.atb .tb-id { display: flex; align-items: center; gap: 14px; }
.atb .tb-mark { font-family: 'IBM Plex Mono', monospace; font-weight: 600; font-size: 18px; color: #fff; background: var(--brand); width: 40px; height: 40px; display: grid; place-items: center; border-radius: 10px; }
.atb .tb-title h1 { font-size: 20px; }
.atb .tb-title p { font-size: 13px; color: var(--muted); margin-top: 2px; }
.atb .tb-title .live { color: var(--ok); }
.atb .stats { display: flex; gap: 8px; flex-wrap: wrap; }
.atb .stat { display: flex; flex-direction: column; align-items: flex-start; min-width: 80px; padding: 8px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.atb .stat-v { font-size: 22px; font-weight: 600; line-height: 1.1; }
.atb .stat-l { font-size: 11.5px; color: var(--muted); margin-top: 1px; }
.atb .st-ok .stat-v { color: var(--ok); } .atb .st-pending .stat-v { color: oklch(0.55 0.015 255); } .atb .st-fix .stat-v { color: var(--fix); } .atb .st-out .stat-v { color: oklch(0.52 0.06 245); } .atb .st-off .stat-v { color: var(--muted); }
.atb .st-total { background: var(--ink); border-color: var(--ink); } .atb .st-total .stat-v { color: #fff; } .atb .st-total .stat-l { color: oklch(0.8 0.01 255); }

.atb .toolbar { position: sticky; top: 73px; z-index: 11; display: flex; align-items: center; gap: 12px 14px; flex-wrap: wrap; padding: 12px 28px; background: oklch(0.99 0.003 250 / 0.88); backdrop-filter: blur(12px); border-bottom: 1px solid var(--line); }
.atb .search { display: flex; align-items: center; gap: 8px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 0 12px; height: 38px; min-width: 240px; flex: 1 1 240px; max-width: 340px; }
.atb .search:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.atb .search-ic { color: var(--muted); font-size: 17px; }
.atb .search input { border: none; outline: none; background: none; flex: 1; font: inherit; color: var(--ink); }
.atb .search-clear { border: none; background: none; color: var(--muted); cursor: pointer; font-size: 13px; }
.atb .chips { display: flex; gap: 6px; flex-wrap: wrap; }
.atb .chip { font: inherit; font-size: 13.5px; padding: 7px 14px; border-radius: 999px; cursor: pointer; background: var(--surface); border: 1px solid var(--line); color: var(--ink-2); transition: all 0.12s; }
.atb .chip:hover { border-color: oklch(0.82 0.01 255); }
.atb .chip.on { background: var(--ink); color: #fff; border-color: var(--ink); }
.atb .chip.soft.on { background: var(--brand); border-color: var(--brand); }
.atb .chip.ck-morning.on { background: var(--ok); border-color: var(--ok); }
.atb .chip.ck-afternoon.on { background: var(--watch); border-color: var(--watch); color: oklch(0.3 0.05 78); }
.atb .chip.ck-night.on { background: oklch(0.42 0.08 262); border-color: oklch(0.42 0.08 262); }
.atb .chip.ck-fix.on { background: var(--fix); border-color: var(--fix); }
.atb .rightctl { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.atb .dateinput { font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); }
.atb .sort { display: flex; align-items: center; gap: 4px; font-size: 13px; color: var(--muted); }
.atb .sort button { font: inherit; font-size: 13px; padding: 6px 11px; border-radius: 8px; cursor: pointer; background: var(--surface); border: 1px solid var(--line); color: var(--ink-2); }
.atb .sort button.on { background: var(--brand-soft); border-color: var(--brand); color: var(--brand); font-weight: 500; }

.atb .board { padding: 24px 28px 80px; }
.atb .region { margin-bottom: 36px; }
.atb .region-head { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; padding-bottom: 10px; border-bottom: 2px solid var(--line); }
.atb .shift-legend { margin-left: auto; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px 16px; }
.atb .leg-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.atb .leg-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.atb .region-head h2 { font-size: 17px; }
.atb .region-meta { font-size: 13px; color: var(--muted); }
.atb .prov-note { margin-left: auto; font-size: 12.5px; color: var(--muted); }
.atb .cardgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 16px; }

.atb .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); box-shadow: var(--shadow); overflow: hidden; display: flex; flex-direction: column; }
.atb .card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 12px; border-bottom: 1px solid var(--line-2); background: linear-gradient(180deg, var(--surface-2), var(--surface)); }
.atb .ch-left { display: flex; align-items: center; gap: 9px; min-width: 0; }
.atb .ch-pin { color: var(--brand); font-size: 13px; }
.atb .ch-name { font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.atb .ch-meter { display: flex; flex-direction: column; align-items: flex-end; gap: 5px; flex-shrink: 0; }
.atb .ch-frac { font-size: 12px; color: var(--muted); } .atb .ch-frac b { color: var(--ok); font-weight: 600; }
.atb .ch-bar { width: 64px; height: 5px; border-radius: 99px; background: var(--line); overflow: hidden; }
.atb .ch-fill { display: block; height: 100%; background: var(--ok); border-radius: 99px; transition: width 0.3s; }
.atb .card-body { padding: 6px 8px 10px; display: flex; flex-direction: column; gap: 2px; }

.atb .shiftgroup { padding: 6px 6px 4px; }
.atb .sg-head { display: flex; align-items: center; gap: 8px; padding: 4px 6px; }
.atb .sg-bar { width: 3px; height: 13px; border-radius: 2px; background: var(--off); }
.atb .sg-morning .sg-bar { background: var(--ok); } .atb .sg-afternoon .sg-bar { background: var(--watch); }
.atb .sg-night .sg-bar { background: oklch(0.5 0.09 262); } .atb .sg-fix8 .sg-bar, .atb .sg-fix10 .sg-bar, .atb .sg-fix14 .sg-bar { background: var(--fix); }
.atb .sg-label { font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
.atb .sg-range { font-size: 11px; color: var(--muted); }
.atb .sg-count { margin-left: auto; font-size: 11px; color: var(--muted); background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 99px; padding: 1px 7px; }
.atb .sg-people { display: flex; flex-direction: column; gap: 2px; margin-top: 2px; }

.atb .person { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 10px; width: 100%; text-align: left; font: inherit; cursor: pointer; background: none; border: 1px solid transparent; border-radius: 9px; padding: 7px 8px; transition: background 0.1s, border-color 0.1s; }
.atb .person:hover { background: var(--surface-2); border-color: var(--line-2); }
.atb .person.is-active { background: var(--brand-soft); border-color: oklch(0.8 0.06 248); }
/* คนที่เข้างานแล้ว = พื้นหลังเขียว มองเห็นง่าย */
.atb .person.present { background: oklch(0.95 0.045 152); border-color: transparent; }
.atb .person.present:hover { background: oklch(0.93 0.06 152); border-color: transparent; }
/* คนที่ออกงานแล้ว (checkout/logout) = เทาอ่อน ไม่เขียว */
.atb .person.done { background: oklch(0.96 0.003 255); border-color: transparent; }
.atb .person.done:hover { background: oklch(0.945 0.004 255); border-color: transparent; }
.atb .p-code { font-size: 11px; font-weight: 500; color: var(--muted); background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 6px; padding: 2px 6px; min-width: 40px; text-align: center; }
.atb .p-main { min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
.atb .p-name { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.atb .p-phone { font-size: 11px; color: var(--muted); }
.atb .p-tags { display: flex; gap: 4px; }
.atb .tag { font-size: 10.5px; font-weight: 500; padding: 2px 7px; border-radius: 99px; white-space: nowrap; }
.atb .t-vol { background: oklch(0.95 0.04 152); color: oklch(0.42 0.12 152); }
.atb .t-fix { background: oklch(0.95 0.04 305); color: var(--fix); }
.atb .t-soft { background: var(--surface-2); color: var(--muted); border: 1px solid var(--line-2); }
.atb .p-time { justify-self: end; }
.atb .timechip { font-size: 12px; font-weight: 500; padding: 3px 9px; border-radius: 7px; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; font-family: 'IBM Plex Mono', monospace; }
.atb .tc-ic { font-size: 7px; }
.atb .s-present { background: oklch(0.95 0.05 152); color: oklch(0.42 0.12 152); } .atb .s-present .tc-ic { color: var(--ok); }
.atb .s-pending { background: var(--surface-2); color: var(--pending); border: 1px dashed var(--line); }
.atb .s-done { background: transparent; color: oklch(0.62 0.003 255); border: none; }
.atb .dot { width: 9px; height: 9px; border-radius: 99px; display: inline-block; }
.atb .empty { text-align: center; color: var(--muted); padding: 80px 0; font-size: 15px; line-height: 1.8; }

.atb .scrim { position: fixed; inset: 0; background: oklch(0.3 0.02 255 / 0.28); z-index: 40; animation: atbfade 0.15s; }
@keyframes atbfade { from { opacity: 0; } }
.atb .drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(380px, 92vw); background: var(--surface); z-index: 50; box-shadow: -8px 0 40px oklch(0.3 0.02 255 / 0.18); padding: 28px; overflow-y: auto; animation: atbslide 0.2s cubic-bezier(0.2, 0.8, 0.2, 1); }
@keyframes atbslide { from { transform: translateX(40px); opacity: 0; } }
.atb .dw-close { position: absolute; top: 18px; right: 18px; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; background: var(--surface-2); border: 1px solid var(--line); color: var(--ink-2); font-size: 14px; }
.atb .dw-top { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.atb .dw-code { font-size: 13px; font-weight: 600; color: #fff; background: var(--brand); border-radius: 7px; padding: 4px 10px; }
.atb .dw-status { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink-2); }
.atb .dw-name { font-size: 24px; margin-bottom: 2px; }
.atb .dw-phone { font-size: 15px; color: var(--brand); text-decoration: none; }
.atb .dw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line-2); border: 1px solid var(--line-2); border-radius: 12px; overflow: hidden; margin: 22px 0; }
.atb .dw-cell { background: var(--surface); padding: 11px 14px; display: flex; flex-direction: column; gap: 4px; }
.atb .dw-cell:nth-child(5) { grid-column: 1 / -1; }
.atb .dw-k { font-size: 11.5px; color: var(--muted); }
.atb .dw-v { font-size: 14.5px; font-weight: 500; }
.atb .dw-tags { display: flex; gap: 6px; flex-wrap: wrap; }

/* ── การ์ดดีไซน์ใหม่ (ลาดพร้าว) ── */
.atb .lpc { background: var(--surface); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); overflow: hidden; display: flex; flex-direction: column; }
.atb .lpc-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 15px 18px 13px; border-bottom: 1px solid var(--line-2); background: linear-gradient(180deg, var(--surface-2), var(--surface)); }
.atb .lpc-name-h { font-size: 24px; font-weight: 700; letter-spacing: -0.01em; }
.atb .lpc-counts { display: flex; gap: 6px; flex-shrink: 0; }
.atb .lpc-count { font-size: 11.5px; padding: 5px 10px; border-radius: 10px; font-weight: 500; white-space: nowrap; }
.atb .lpc-count b { font-size: 14px; font-weight: 700; margin-right: 2px; }
.atb .lpc-count.ok { background: oklch(0.95 0.05 152); color: oklch(0.42 0.12 152); }
.atb .lpc-count.wait { background: var(--surface-2); color: var(--muted); border: 1px solid var(--line); }
.atb .lpc-body { padding: 8px 6px 14px; display: flex; flex-direction: column; gap: 3px; }
.atb .lpc-shift { padding: 4px 0 6px; margin-bottom: 2px; }
.atb .lpc-shead { display: flex; align-items: center; gap: 8px; padding: 4px 11px; background: var(--band-tint); border-radius: 8px; margin-bottom: 3px; }
.atb .lpc-sdot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; background: var(--band); }
.atb .lpc-slabel { font-size: 13px; font-weight: 700; color: var(--band-ink); }
.atb .lpc-fix { font-size: 13px; font-weight: 700; color: var(--band-ink); }
.atb .lpc-srange { margin-left: auto; font-size: 11px; color: var(--muted); }
.atb .lpc-r2 { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 3px; white-space: nowrap; }
.atb .lpc-shlabel { font-size: 11px; color: var(--muted); font-weight: 600; white-space: nowrap; }
.atb .lpc-out { margin: 8px 4px 2px; padding: 2px 6px 4px; background: oklch(0.975 0.002 255); border: 1px dashed var(--line); border-radius: 12px; }
.atb .lpc-out .lpc-slabel { color: var(--muted); }

.atb .lpc-person { position: relative; display: flex; align-items: center; gap: 11px; width: 100%; text-align: left; padding: 8px; border-radius: 12px; cursor: pointer; border: 1px solid transparent; transition: background 0.1s, border-color 0.1s; }
.atb .lpc-in .lpc-person { background: linear-gradient(90deg, oklch(0.94 0.06 152), transparent 78%); }
.atb .lpc-person:hover { background: var(--surface-2); }
.atb .lpc-person.active { background: var(--brand-soft); border-color: oklch(0.8 0.06 248); }

.atb .lpc-av { position: relative; width: 42px; height: 42px; flex-shrink: 0; }
.atb .lpc-av-ring { width: 42px; height: 42px; border-radius: 50%; border: 4px solid var(--line); display: grid; place-items: center; overflow: hidden; }
.atb .lpc-av-in { font-size: 13.5px; font-weight: 700; }
.atb .lpc-av-img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; }
.atb .lpc-av-badge { position: absolute; right: -1px; bottom: -1px; width: 16px; height: 16px; border-radius: 50%; display: grid; place-items: center; font-size: 9px; color: #fff; border: 2px solid var(--surface); background: var(--ok); }
.atb .lpc-person.present .lpc-av-ring { border-color: oklch(0.72 0.13 152); background: oklch(0.96 0.04 152); }
.atb .lpc-person.present .lpc-av-in { color: oklch(0.42 0.12 152); }
.atb .lpc-person.present .lpc-av-badge { background: var(--ok); }
.atb .lpc-person.done .lpc-av-ring { border-color: oklch(0.84 0.01 255); background: oklch(0.96 0.004 255); }
.atb .lpc-person.done .lpc-av-in { color: oklch(0.52 0.01 255); }
.atb .lpc-person.done .lpc-av-badge { background: oklch(0.72 0.02 255); }
.atb .lpc-person.pending .lpc-av-ring { border-color: oklch(0.88 0.008 255); background: oklch(0.975 0.003 255); }
.atb .lpc-person.pending .lpc-av-in { color: oklch(0.62 0.01 255); }

.atb .lpc-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.atb .lpc-r1 { display: flex; align-items: center; gap: 7px; }
.atb .lpc-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.atb .lpc-code { font-size: 10.5px; font-weight: 600; color: var(--muted); background: var(--surface-2); border: 1px solid var(--line-2); border-radius: 6px; padding: 1px 6px; flex-shrink: 0; }
.atb .lpc-person.present .lpc-code { color: oklch(0.42 0.12 152); background: oklch(0.96 0.04 152); border-color: oklch(0.78 0.1 152); }
.atb .lpc-person.done .lpc-code { color: oklch(0.5 0.012 255); background: oklch(0.965 0.004 255); border-color: oklch(0.86 0.01 255); }
.atb .lpc-person.pending .lpc-code { color: oklch(0.6 0.012 255); background: oklch(0.975 0.003 255); border-color: oklch(0.88 0.008 255); }
.atb .lpc-pill { font-size: 10.5px; font-weight: 600; padding: 2px 9px; border-radius: 999px; flex-shrink: 0; }
.atb .lpc-pill.ok { background: oklch(0.95 0.05 152); color: oklch(0.42 0.12 152); }
.atb .lpc-pill.out { background: var(--surface-2); color: var(--muted); }
.atb .lpc-pill.wait { background: oklch(0.96 0.05 78); color: oklch(0.5 0.12 78); }
.atb .lpc-time { font-size: 11.5px; font-weight: 500; font-family: 'IBM Plex Mono', monospace; flex-shrink: 0; text-align: center; }
.atb .lpc-time.present { color: var(--muted); }
.atb .lpc-time.done { color: var(--muted); font-weight: 600; }
.atb .lpc-time.pending { color: var(--pending); font-weight: 500; font-family: inherit; font-size: 11.5px; }
.atb .lpc-time.leave { color: #b45309; font-weight: 600; font-family: inherit; font-size: 11.5px; }
.atb .st-leave .stat-v { color: #d97706; }
.atb .lpc-count.leave { background: #fffbeb; color: #b45309; border: 1px solid #fcd34d; }
.atb .lpc-count.off { background: var(--surface-2); color: var(--muted); border: 1px solid var(--line); }
.atb .lpc-person.leave .lpc-av-ring { border-color: #fcd34d; background: #fffbeb; }
.atb .lpc-person.leave .lpc-code { color: #b45309; background: #fffbeb; border-color: #fcd34d; }
/* นอกระบบ: รูป/ชื่อ/เวลา เป็นเทา (de-emphasize) */
.atb .lpc-out .lpc-name { color: var(--muted); }
.atb .lpc-out .lpc-time { color: var(--muted); }
.atb .lpc-out .lpc-av-img { filter: grayscale(100%); }
.atb .lpc-out .lpc-person { opacity: 0.6; transition: opacity 0.12s; }
.atb .lpc-out .lpc-person:hover { opacity: 1; }
.atb .lpc-offgrp { margin: 8px 4px 2px; padding: 4px 6px 6px; background: oklch(0.975 0.002 255); border: 1px dashed var(--line); border-radius: 12px; }
.atb .lpc-offhead { font-size: 11.5px; font-weight: 600; color: var(--muted); padding: 3px 4px 5px; letter-spacing: -0.01em; }
.atb .lpc-offgrp .lpc-name { color: var(--muted); }
.atb .lpc-offgrp .lpc-time { color: var(--muted); }
.atb .lpc-offgrp .lpc-av-img { filter: grayscale(100%); }
.atb .lpc-offgrp .lpc-person { opacity: 0.62; transition: opacity 0.12s; }
.atb .lpc-offgrp .lpc-person:hover { opacity: 1; }
.atb .lpc-rt { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
.atb .lpc-badges { display: flex; align-items: center; gap: 4px; }
.atb .lpc-shbadge { font-size: 10.5px; font-weight: 700; border: 1px solid; border-radius: 6px; padding: 1px 7px; white-space: nowrap; line-height: 1.45; text-align: center; }

.atb .lpc-acts { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); display: flex; gap: 5px; background: var(--surface); padding: 3px; border-radius: 11px; box-shadow: 0 2px 8px oklch(0.4 0.02 255 / 0.18); }
.atb .lpc-act { width: 32px; height: 32px; border-radius: 9px; border: 1px solid var(--line); background: var(--surface); display: grid; place-items: center; cursor: pointer; color: var(--ink-2); transition: background .12s, color .12s, transform .12s, border-color .12s; }
.atb .lpc-act:hover { background: var(--surface-2); transform: translateY(-1px); }
.atb .lpc-act.accent { color: #0f766e; }
.atb .lpc-act.accent:hover { background: #effaf7; border-color: #0f766e; }

/* แผงรายละเอียด (คลิกแถว) + toast — ดีไซน์ B */
.atb .lpc-modal { position: fixed; inset: 0; background: rgba(15,23,42,.32); backdrop-filter: blur(3px); display: grid; place-items: center; z-index: 50; padding: 16px; animation: atbfade .15s; }
.atb .lpc-card { width: 100%; max-width: 392px; background: #fff; border-radius: 18px; box-shadow: 0 24px 60px -12px rgba(15,23,42,.4); overflow: hidden; animation: lpcpop .18s cubic-bezier(.2,.8,.2,1); }
@keyframes lpcpop { from { transform: scale(.96); opacity: 0; } }
.atb .lpc-mhead { display: flex; align-items: center; gap: 13px; padding: 18px 20px; border-bottom: 1px solid #f1f4f7; }
.atb .lpc-mav { width: 50px; height: 50px; border-radius: 99px; display: grid; place-items: center; font-weight: 700; font-size: 17px; flex-shrink: 0; border: 2px solid var(--line); background: var(--surface-2); overflow: hidden; }
.atb .lpc-mav.present { border-color: oklch(0.72 0.13 152); background: oklch(0.96 0.04 152); color: oklch(0.42 0.12 152); }
.atb .lpc-mav.done { border-color: oklch(0.84 0.01 255); background: oklch(0.96 0.004 255); color: oklch(0.52 0.01 255); }
.atb .lpc-mav.pending { border-color: oklch(0.88 0.008 255); color: oklch(0.6 0.01 255); }
.atb .lpc-mid { flex: 1; min-width: 0; }
.atb .lpc-mname { font-size: 16.5px; font-weight: 700; color: #0f172a; }
.atb .lpc-mse { font-size: 12.5px; color: var(--muted); font-weight: 500; margin-top: 2px; }
.atb .lpc-msec { padding: 15px 20px; border-bottom: 1px solid #f6f8fa; }
.atb .lpc-mlabel { font-size: 11.5px; font-weight: 700; color: var(--muted); letter-spacing: .03em; margin-bottom: 10px; }
.atb .lpc-mgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
.atb .lpc-field { background: var(--surface-2); border-radius: 11px; padding: 9px 12px; }
.atb .lpc-fl { font-size: 11px; color: var(--muted); font-weight: 600; margin-bottom: 3px; }
.atb .lpc-fv { font-size: 13.5px; font-weight: 700; color: var(--ink); }
.atb .lpc-mhist { display: flex; flex-direction: column; }
.atb .lpc-hrow { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid #f4f6f8; }
.atb .lpc-hrow:first-child { border-top: none; }
.atb .lpc-hdot { width: 7px; height: 7px; border-radius: 99px; background: var(--ok); flex-shrink: 0; }
.atb .lpc-hd { font-size: 13px; color: var(--ink-2); flex: 1; }
.atb .lpc-ht { font-size: 13px; font-weight: 700; color: oklch(0.42 0.12 152); }
.atb .lpc-mempty { font-size: 12.5px; color: var(--muted); padding: 2px 0 4px; }
.atb .lpc-macts { display: flex; gap: 8px; padding: 14px 20px 18px; }
.atb .lpc-mact { flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px; padding: 11px 8px; border-radius: 12px; cursor: pointer; font: inherit; font-size: 13.5px; font-weight: 600; border: 1px solid var(--line); background: #fff; color: var(--ink-2); transition: filter .15s; }
.atb .lpc-mact:hover { filter: brightness(.97); }
.atb .lpc-mact.primary { border: none; background: #0f766e; color: #fff; }
.atb .lpc-toast { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%) translateY(8px); background: #0f172a; color: #fff; font-size: 13.5px; font-weight: 600; padding: 11px 18px; border-radius: 12px; box-shadow: 0 12px 30px -8px rgba(15,23,42,.5); opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; z-index: 60; }
.atb .lpc-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }

@media (max-width: 720px) {
  .atb .topbar, .atb .toolbar { position: static; }
  .atb .cardgrid { grid-template-columns: 1fr; }
  .atb .rightctl { margin-left: 0; }
}
`;
