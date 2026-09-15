'use client';

/**
 * งานรอตรวจ (ISURVEY) — ดึงงานของฉันจาก ISURVEY เข้ามาเป็นเคสบนเว็บนี้ (04/09/69)
 *
 *   ช่างส่งงานบน ISURVEY → หัวหน้ากดดึงที่นี่ (บัญชี ISURVEY ของตัวเอง) → ได้เคส "รอตรวจ" + รูป
 *   → ตรวจ/แก้/ใส่เรทที่หน้าเคส → อนุมัติ → บอทยกเข้า EMCS (+ ระบบปิดงานบน ISURVEY ให้เอง 08/09/69)
 *
 * กติกาที่ user เคาะหลังใช้จริง (04/09/69):
 *   - วันที่เริ่มที่ "วันนี้" ทั้งคู่ ผู้ใช้เลือกช่วงเอง · ไม่โหลดอัตโนมัติ (บางบัญชีงานค้างมาก ช้า) กด "โหลดรายการ" เอง
 *   - โหลดมาทุกสถานะ แล้วเลือกสถานะที่จะดูได้ (ค่าเริ่มต้น "รอตรวจข้อมูล")
 *     08/09/69: เลือกได้หลายสถานะพร้อมกัน (ติ๊ก checkbox เช่น "เสร็จงาน" + "ถึงที่ตรวจสอบ") · ไม่ติ๊กเลย = ทั้งหมด
 *   - "ดึงเข้า" ทีละงานเสร็จ → เด้งไปหน้าเคสนั้นเลย · "ดึงทั้งหมด" ไม่เด้ง
 *   - 08/09/69: งานที่อนุมัติแล้วบนเว็บเรา **หายจากรายการ "รอตรวจข้อมูล" เอง** ไม่ต้องกด "โหลดรายการ" —
 *     หน้านี้ถามสถานะ "ในระบบเรา" ใหม่ (endpoint เร็ว ไม่แตะ ISURVEY) เมื่อมีสัญญาณเคสเปลี่ยน/กลับมาที่แท็บ
 * หน้านี้ "สร้างเคส" อย่างเดียว — ไม่เขียนอะไรกลับ ISURVEY (การปิดงานทำตอนอนุมัติที่หน้าเคส)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';

type Row = {
  claim_no: string; survey_no: string; surveyor_name: string; acc_province: string;
  plate_no: string; finish_dt: string; status: string; emcs_sent: boolean;
  dispatch_dt?: string; send_report_dt?: string;   // จ่ายงานเวลา / ส่งรายงานเวลา (user ขอ 07/09/69)
  imported_case_id?: number | null; imported_status?: string | null;
};
type Filter = { applied: boolean; group_name: string | null; members: number; hidden: number };
type PullResult = {
  caseId?: number; warnings?: string[]; photos?: { added?: number; error?: string; note?: string };
  /** ครั้งที่ของใบที่ดึง (ตามเลขเซอร์เวย์) + ครั้งก่อนหน้าที่ระบบดึงมาเป็นเคสอ้างอิงให้เอง (13/09/69) */
  visit_no?: number | null;
  references?: { survey_no: string; round: number; caseId?: number | null; skipped?: string | null;
    /** รูปของครั้งนั้น (15/09/69 เลิกข้ามรูปครั้งก่อนหน้า) */
    photos?: { added?: number; error?: string; note?: string } | null }[];
};

const PENDING = 'รอตรวจข้อมูล';
/** สถานะที่กดดึงเข้าได้ (user เคาะ 13/09/69): รอตรวจข้อมูล = งานใหม่เข้าคิวตรวจ · จบงาน = งานปิดแล้ว
 *  สถานะอื่น (ยังทำงานอยู่บน ISURVEY / ตรวจสอบแล้ว / ยกเลิก / ไม่รับงาน) ซ่อนปุ่ม — ตัวดึงงานฝั่ง server กันซ้ำอีกชั้น */
const PULLABLE = new Set([PENDING, 'จบงาน']);
const pullable = (r: Row) => PULLABLE.has(String(r.status ?? '').trim());
const NO_STATUS = '(ไม่ระบุ)';
/**
 * จำรายการที่โหลดล่าสุดไว้ในแท็บนี้ (sessionStorage) — เปลี่ยนเมนู/เด้งไปหน้าเคสแล้วกลับมาไม่ต้องโหลดใหม่
 * (โหลดครั้งหนึ่ง 10 กว่าวินาที) · ปิดแท็บ = หาย · กด "โหลดรายการ" = ดึงสดทับ
 */
const CACHE_KEY = 'isurvey-pending-cache-v3';   // v3: ตัวกรองสถานะเป็นหลายค่า (statuses) — v2 เก็บค่าเดียว
type Cache = { from: string; to: string; statuses: string[]; rows: Row[]; filter: Filter | null; loadedAt: string };
const readCache = (): Cache | null => {
  try { const raw = sessionStorage.getItem(CACHE_KEY); return raw ? (JSON.parse(raw) as Cache) : null; } catch { return null; }
};
const writeCache = (c: Cache | null) => {
  try { if (c) sessionStorage.setItem(CACHE_KEY, JSON.stringify(c)); else sessionStorage.removeItem(CACHE_KEY); } catch { /* storage ปิด — ไม่เป็นไร */ }
};
const todayISO = () => new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);   // วันตามเวลาไทย
const errMsg = (e: unknown) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || (e as Error)?.message || 'เกิดข้อผิดพลาด';
const STATUS_TH: Record<string, string> = {
  surveyed: 'รอตรวจ', reviewed: 'อนุมัติแล้ว', assigned: 'ตีกลับ/มอบหมาย', finished: 'เสร็จงาน', pending: 'รอมอบหมาย',
};
const statusOf = (r: Row) => r.status || NO_STATUS;

export default function IsurveyPendingPage() {
  const router = useRouter();
  const { socket } = useSocket();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  /** สถานะ ISURVEY ที่เลือกดู — ว่าง = ทั้งหมด (เลือกได้หลายค่า 08/09/69) */
  const [statuses, setStatuses] = useState<string[]>([PENDING]);
  const [statusOpen, setStatusOpen] = useState(false);
  const statusBoxRef = useRef<HTMLDivElement | null>(null);
  /** งานที่อนุมัติแล้วในระบบเรา ซ่อนจากมุมมอง "รอตรวจข้อมูล" — กดโชว์ได้ */
  const [showApproved, setShowApproved] = useState(false);
  /** ค้นหา เลขเคลม / เลขเซอร์เวย์ / ผู้สำรวจ / จังหวัด — พิมพ์แล้วค้น**ทุกสถานะ** ไม่สนตัวกรองสถานะ (user ขอ 15/09/69) */
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [needAccount, setNeedAccount] = useState(false);
  const [pulling, setPulling] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string; caseId?: number }>>({});
  const [bulk, setBulk] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key = (r: Row) => `${r.claim_no}|${r.survey_no}`;

  // กลับมาที่หน้านี้ → เอารายการที่เคยโหลดในแท็บนี้ขึ้นมาก่อน (รวมธง "มีแล้ว #…" ของงานที่เพิ่งดึง)
  useEffect(() => {
    const c = readCache();
    if (c && Array.isArray(c.rows)) {
      setFrom(c.from); setTo(c.to); setRows(c.rows); setFilter(c.filter ?? null);
      setStatuses(Array.isArray(c.statuses) ? c.statuses : [PENDING]); setLoadedAt(c.loadedAt);
    }
  }, []);
  useEffect(() => {
    if (rows && loadedAt) writeCache({ from, to, statuses, rows, filter, loadedAt });
  }, [rows, filter, statuses, from, to, loadedAt]);

  // ปิดกล่องเลือกสถานะเมื่อคลิกนอกกล่อง
  useEffect(() => {
    if (!statusOpen) return;
    const onDown = (e: MouseEvent) => {
      if (statusBoxRef.current && !statusBoxRef.current.contains(e.target as Node)) setStatusOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [statusOpen]);

  const load = async () => {
    setLoading(true); setError(''); setNeedAccount(false); setResults({});
    try {
      const r = await api.get('/api/isurvey/pending', { params: { from, to }, timeout: 180000 });
      const cases = (r.data?.data?.cases ?? []) as Row[];
      setRows(cases);
      setFilter((r.data?.data?.filter ?? null) as Filter | null);
      setLoadedAt(new Date().toISOString());
      setSyncedAt(null); setShowApproved(false);
      // ค่าเริ่มต้นดู "รอตรวจข้อมูล" — ถ้าช่วงนี้ไม่มีเลยค่อยโชว์ทั้งหมด จะได้ไม่เจอตารางว่างทั้งที่มีงาน
      setStatuses(cases.some((c) => c.status === PENDING) ? [PENDING] : []);
    } catch (e) {
      const code = (e as { response?: { status?: number } })?.response?.status;
      if (code === 412) setNeedAccount(true);
      setError(errMsg(e)); setRows(null); setLoadedAt(null); writeCache(null);
    } finally { setLoading(false); }
  };

  /**
   * ถามสถานะ "ในระบบเรา" ของงานที่โหลดไว้ใหม่ (เร็ว ไม่แตะ ISURVEY) — งานที่เพิ่งอนุมัติจะเปลี่ยนเป็น "อนุมัติแล้ว"
   * และหายจากมุมมอง "รอตรวจข้อมูล" เอง (user ขอ 08/09/69 — เดิมต้องกด "โหลดรายการ" ซึ่งช้า 10 กว่าวินาที)
   */
  const syncImported = useCallback(async (list: Row[] | null) => {
    if (!list || list.length === 0) return;
    try {
      const r = await api.post('/api/isurvey/imported-status',
        { rows: list.map((x) => ({ claim_no: x.claim_no, survey_no: x.survey_no })) }, { timeout: 30000 });
      const st = (r.data?.data?.statuses ?? {}) as Record<string, { id: number; status: string }>;
      setRows((rs) => (rs ?? []).map((x) => {
        const hit = st[`${x.claim_no}|${x.survey_no}`];
        return hit ? { ...x, imported_case_id: hit.id, imported_status: hit.status } : x;
      }));
      setSyncedAt(new Date().toISOString());
    } catch { /* เช็คไม่ได้ = คงค่าเดิมในตาราง ไม่ต้องรบกวน */ }
  }, []);
  // โหลดจาก cache แล้ว / กลับมาที่แท็บ / มีสัญญาณเคสเปลี่ยน → ซิงก์ (รวบสัญญาณติด ๆ กันเป็นครั้งเดียว)
  const rowsRef = useRef<Row[] | null>(null);
  rowsRef.current = rows;
  const scheduleSync = useCallback(() => {
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => { void syncImported(rowsRef.current); }, 500);
  }, [syncImported]);
  useEffect(() => { if (loadedAt) scheduleSync(); }, [loadedAt, scheduleSync]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') scheduleSync(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [scheduleSync]);
  useEffect(() => {
    if (!socket) return;
    socket.on('case_changed', scheduleSync);
    return () => { socket.off('case_changed', scheduleSync); if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [socket, scheduleSync]);

  // สถานะที่มีในรายการที่โหลดมา + จำนวน — ไว้ทำตัวเลือก
  const statusCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(statusOf(r), (m.get(statusOf(r)) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => (a[0] === PENDING ? -1 : b[0] === PENDING ? 1 : b[1] - a[1]));
  }, [rows]);
  const isAll = statuses.length === 0;
  const byStatus = useMemo(() => (rows ?? []).filter((r) => isAll || statuses.includes(statusOf(r))), [rows, statuses, isAll]);
  /**
   * งานที่อนุมัติแล้วในระบบเรา ไม่ใช่ "รอตรวจ" อีกต่อไป (ระบบปิดงานบน ISURVEY ให้ตอนอนุมัติ) —
   * ซ่อนจากมุมมองที่มี "รอตรวจข้อมูล" จนกว่าจะกด "โหลดรายการ" ซึ่ง ISURVEY จะบอกสถานะใหม่เอง · ดูทั้งหมด/สถานะอื่น = ไม่ซ่อน
   */
  const hideApproved = !isAll && statuses.includes(PENDING) && !showApproved;
  const afterHide = useMemo(() => byStatus.filter((r) => !(hideApproved && r.status === PENDING && r.imported_status === 'reviewed')),
    [byStatus, hideApproved]);
  const hiddenApproved = byStatus.length - afterHide.length;
  /**
   * ค้นหา (user ขอ 15/09/69): พิมพ์อะไรก็ตาม = ค้นจากรายการที่โหลดมา**ทุกสถานะ** (ตัวกรองสถานะ/การซ่อนงานอนุมัติแล้วไม่มีผลชั่วคราว)
   * ตรงกับ เลขเคลม · เลขเซอร์เวย์ · ผู้สำรวจ (รหัส+ชื่อ) · จังหวัด แบบมีคำนั้นอยู่ ไม่สนตัวพิมพ์
   */
  const needle = q.trim().toLowerCase();
  const searching = needle.length > 0;
  const visible = useMemo(() => {
    if (!searching) return afterHide;
    return (rows ?? []).filter((r) =>
      [r.claim_no, r.survey_no, r.surveyor_name, r.acc_province].some((v) => String(v ?? '').toLowerCase().includes(needle)));
  }, [afterHide, rows, searching, needle]);
  const toggleStatus = (s: string) =>
    setStatuses((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const statusLabel = isAll ? `ทั้งหมด (${rows?.length ?? 0})`
    : statuses.length === 1 ? `${statuses[0]} (${statusCounts.find(([s]) => s === statuses[0])?.[1] ?? 0})`
    : `${statuses.length} สถานะ (${byStatus.length})`;

  const pullOne = async (r: Row, opts: { navigate: boolean }): Promise<boolean> => {
    const k = key(r);
    setPulling((p) => ({ ...p, [k]: true }));
    try {
      const res = await api.post('/api/isurvey/pull', { claim_no: r.claim_no, survey_no: r.survey_no }, { timeout: 300000 });
      const d = (res.data?.data ?? {}) as PullResult;
      const photos = d.photos?.error ? `รูป: ${d.photos.error}` : `รูป ${d.photos?.added ?? 0} ใบ`;
      const warn = d.warnings?.length ? ` · เตือน ${d.warnings.length} ข้อ` : '';
      // งานครั้งถัดไป: ระบบดึงครั้งก่อนหน้าของเคลมมาเป็นเคสอ้างอิงให้ก่อนแล้ว พร้อมรูปของครั้งนั้น (15/09/69 เลิกข้ามรูป)
      // — บอกให้รู้ว่าได้กี่ใบ/รูปกี่ใบ/ข้ามใบไหน
      const refs = d.references ?? [];
      const refPhotos = (x: NonNullable<PullResult['references']>[number]) =>
        x.photos?.error ? 'รูปพลาด' : `รูป ${x.photos?.added ?? 0} ใบ`;
      const refTxt = refs.length
        ? ` · ครั้งที่ ${d.visit_no ?? '?'} ของเคลม — ดึงครั้งก่อนหน้ามาเป็นเคสอ้างอิง ${refs.filter((x) => x.caseId).length}/${refs.length} ใบ`
          + (refs.some((x) => x.caseId) ? ` (${refs.filter((x) => x.caseId).map((x) => `ครั้งที่ ${x.round}: ${refPhotos(x)}`).join(', ')})` : '')
          + (refs.some((x) => x.skipped) ? ` (ข้าม ${refs.filter((x) => x.skipped).map((x) => `ครั้งที่ ${x.round}: ${x.skipped}`).join(', ')})` : '')
        : '';
      setResults((m) => ({ ...m, [k]: { ok: true, text: `ดึงแล้ว → เคส #${d.caseId} (${photos}${warn})${refTxt}`, caseId: d.caseId } }));
      setRows((rs) => (rs ?? []).map((x) => (key(x) === k ? { ...x, imported_case_id: d.caseId ?? null, imported_status: 'surveyed' } : x)));
      // ดึงทีละงาน = ตั้งใจจะไปตรวจงานนั้นต่อ → เปิดหน้าเคสให้เลย ไม่ต้องไปหาในรายการงาน
      if (opts.navigate && d.caseId) router.push(`/inspector/cases/${d.caseId}`);
      return true;
    } catch (e) {
      setResults((m) => ({ ...m, [k]: { ok: false, text: errMsg(e) } }));
      return false;
    } finally {
      setPulling((p) => ({ ...p, [k]: false }));
    }
  };

  const confirmPull = (r: Row): boolean => {
    if (r.status === PENDING) return true;
    return window.confirm(`งานนี้สถานะ "${r.status}" ไม่ใช่ "รอตรวจข้อมูล"${r.emcs_sent ? ' และเข้า EMCS ไปแล้ว' : ''} — ดึงเข้ามาเป็นเคสใหม่แน่ใจ?`);
  };

  const pullAll = async () => {
    const todo = visible.filter((r) => !r.imported_case_id && r.claim_no && pullable(r));   // ไม่มีเลขเคลม/สถานะดึงไม่ได้ = ข้าม
    if (todo.length === 0) return;
    const label = isAll ? 'ทุกสถานะ' : `สถานะ "${statuses.join('", "')}"`;
    if (!window.confirm(`ดึงงานที่ยังไม่มีในระบบ (${label}) ทั้งหมด ${todo.length} เรื่อง? (ทีละเรื่อง ใช้เวลาประมาณ ${todo.length * 15} วินาที)`)) return;
    setBulk(true);
    try {
      for (const r of todo) { await pullOne(r, { navigate: false }); }   // ทีละเรื่อง — ISURVEY จำกัด 1 การใช้งาน/บัญชี
    } finally { setBulk(false); }
  };

  const notImported = visible.filter((r) => !r.imported_case_id && r.claim_no).length;

  return (
    <div className="w-full">  {/* ตาราง 9 คอลัมน์กว้างกว่า max-w-6xl ปุ่ม "ดึงเข้า" เคยถูกตัดขอบขวา (04/09/69) */}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">งานรอตรวจ (ISURVEY)</h1>
          <p className="text-sm text-gray-600">งานของบัญชี ISURVEY ของคุณ — เลือกช่วงวันที่แล้วกดโหลด ดึงเข้ามาเป็นเคสแล้วตรวจ/ใส่เรท/อนุมัติที่นี่</p>
        </div>
        <div className="ml-auto flex flex-wrap items-end gap-2 text-sm">
          <label className="flex flex-col text-xs text-gray-600">ตั้งแต่
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="border border-gray-300 px-2 py-1 text-sm" /></label>
          <label className="flex flex-col text-xs text-gray-600">ถึง
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="border border-gray-300 px-2 py-1 text-sm" /></label>
          <button type="button" onClick={load} disabled={loading || bulk || !from || !to}
            className="px-3 py-1.5 bg-[var(--md-blue)] text-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
            {loading ? 'กำลังโหลด…' : 'โหลดรายการ'}
          </button>
          {rows && (
            /* ค้นหาข้ามสถานะ (user ขอ 15/09/69) — เลขเคลม / เลขเซอร์เวย์ / ผู้สำรวจ / จังหวัด · พิมพ์แล้วตัวกรองสถานะพักไว้ */
            <div className="flex flex-col text-xs text-gray-600">ค้นหา (ทุกสถานะ)
              <div className="relative">
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
                  placeholder="เลขเคลม / เลขเซอร์เวย์ / ผู้สำรวจ / จังหวัด"
                  className="border border-gray-300 bg-white px-2 py-1 pr-7 text-sm text-gray-800 w-[19rem]" />
                {searching && (
                  <button type="button" onClick={() => setQ('')} title="ล้างคำค้น"
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-800 text-sm px-1">✕</button>
                )}
              </div>
            </div>
          )}
          {rows && (
            /* ตัวกรองสถานะ ISURVEY — ติ๊กได้หลายค่าพร้อมกัน (user ขอ 08/09/69) · ไม่ติ๊กเลย = ทั้งหมด · ตอนค้นหาพักไว้ (ค้นทุกสถานะ) */
            <div ref={statusBoxRef} className={`relative flex flex-col text-xs text-gray-600 ${searching ? 'opacity-50' : ''}`}>สถานะ
              <button type="button" onClick={() => setStatusOpen((o) => !o)} disabled={searching}
                title={searching ? 'กำลังค้นหาทุกสถานะ — ล้างคำค้นก่อนถึงจะกรองสถานะ' : ''}
                className="border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 text-left min-w-[12rem] flex items-center justify-between gap-2 disabled:cursor-not-allowed">
                <span className="truncate">{statusLabel}</span><span className="text-gray-500">▾</span>
              </button>
              {statusOpen && (
                <div className="absolute z-20 top-full left-0 mt-1 w-64 bg-white border border-gray-300 shadow-lg p-2 text-sm text-gray-800">
                  <label className="flex items-center gap-2 px-1 py-1 cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" checked={isAll} onChange={() => setStatuses([])} />
                    <span className="font-semibold">ทั้งหมด</span><span className="text-gray-500">({rows.length})</span>
                  </label>
                  <div className="border-t border-gray-100 my-1" />
                  {statusCounts.map(([s, n]) => (
                    <label key={s} className="flex items-center gap-2 px-1 py-1 cursor-pointer hover:bg-gray-50">
                      <input type="checkbox" checked={!isAll && statuses.includes(s)} onChange={() => toggleStatus(s)} />
                      <span className={s === PENDING ? 'text-amber-700' : ''}>{s}</span><span className="text-gray-500">({n})</span>
                    </label>
                  ))}
                  <div className="text-[0.6875rem] text-gray-500 px-1 pt-1">ติ๊กได้หลายสถานะ · ไม่ติ๊กเลย = ทั้งหมด</div>
                </div>
              )}
            </div>
          )}
          {rows && (
            <button type="button" onClick={pullAll} disabled={loading || bulk || notImported === 0}
              className="px-3 py-1.5 border border-[var(--md-blue)] text-[var(--md-blue)] bg-white text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed">
              {bulk ? 'กำลังดึง…' : `ดึงทั้งหมดที่ยังไม่มี (${notImported})`}
            </button>
          )}
        </div>
      </div>

      {needAccount && (
        <div className="mb-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-2">
          ยังไม่ได้ตั้งบัญชี ISURVEY ของคุณ — ไปที่{' '}
          <Link href="/inspector/isurvey/account" className="underline font-semibold">บัญชี ISURVEY</Link> ก่อน
        </div>
      )}
      {error && !needAccount && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-2">{error}</div>
      )}
      {rows === null && !error && !loading && (
        <div className="bg-white border border-gray-200 px-4 py-8 text-center text-sm text-gray-500">
          เลือกช่วงวันที่ (ค่าเริ่มต้น = วันนี้) แล้วกด &quot;โหลดรายการ&quot;
        </div>
      )}

      {rows && loadedAt && (
        <div className="mb-1 text-xs text-gray-500">
          รายการที่โหลดเมื่อ {new Date(loadedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })} — จำไว้ในแท็บนี้ กด &quot;โหลดรายการ&quot; เพื่อดึงสดใหม่
          {syncedAt && <> · สถานะในระบบเราอัปเดต {new Date(syncedAt).toLocaleTimeString('th-TH', { timeStyle: 'short' })}</>}
        </div>
      )}
      {rows && filter && (
        <div className="mb-2 text-xs text-gray-600">
          {filter.applied
            ? <>แสดงเฉพาะงานของลูกทีม <span className="font-semibold">{filter.group_name}</span> ({filter.members} รายชื่อ) — ซ่อนงานของทีมอื่น {filter.hidden} เรื่อง · <Link href="/inspector/team" className="text-blue-700 hover:underline">ดูรายชื่อทีม</Link></>
            : <>แสดงงานทั้งบริษัท (บัญชีนี้ยังไม่ได้ผูกทีม — แอดมินผูกได้ที่ &quot;จัดการทีมผู้ตรวจ&quot;)</>}
        </div>
      )}
      {rows && (hiddenApproved > 0 || showApproved) && !isAll && statuses.includes(PENDING) && (
        <div className="mb-2 text-xs text-gray-600">
          {showApproved
            ? <>กำลังแสดงงานที่อนุมัติแล้วในระบบเราด้วย · <button type="button" className="text-blue-700 hover:underline" onClick={() => setShowApproved(false)}>ซ่อน</button></>
            : <>ซ่อนงานที่อนุมัติแล้วในระบบเรา {hiddenApproved} เรื่อง (ระบบปิดงานบน ISURVEY ให้แล้ว) · <button type="button" className="text-blue-700 hover:underline" onClick={() => setShowApproved(true)}>แสดง</button></>}
        </div>
      )}

      {rows && searching && (
        <div className="mb-2 text-xs text-gray-700">
          ค้นหา &quot;<span className="font-semibold">{q.trim()}</span>&quot; ใน<span className="font-semibold">ทุกสถานะ</span> ({rows.length} รายการที่โหลดมา) — พบ {visible.length} รายการ
          {' · '}<button type="button" className="text-blue-700 hover:underline" onClick={() => setQ('')}>ล้างคำค้น</button>
          <span className="text-gray-500"> · ตัวกรองสถานะพักไว้ระหว่างค้นหา</span>
        </div>
      )}
      {rows && (
        <div className="bg-white border border-gray-200 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-2 py-2 text-left">จ่ายงานเวลา</th>
                <th className="px-2 py-2 text-left">ส่งรายงานเวลา</th>
                <th className="px-2 py-2 text-left">เลขเคลม</th>
                <th className="px-2 py-2 text-left">เลขเซอร์เวย์</th>
                <th className="px-2 py-2 text-left">ผู้สำรวจ</th>
                <th className="px-2 py-2 text-left">จังหวัด</th>
                <th className="px-2 py-2 text-left">ทะเบียน</th>
                <th className="px-2 py-2 text-left">สถานะ ISURVEY</th>
                <th className="px-2 py-2 text-left">ในระบบเรา</th>
                <th className="px-2 py-2 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-6 text-center text-gray-500">
                  {rows.length === 0 ? 'ไม่มีงานในช่วงวันที่นี้'
                    : hiddenApproved > 0 ? 'งานในสถานะที่เลือกอนุมัติแล้วทั้งหมด — กด "แสดง" ด้านบนถ้าต้องการดู'
                    : 'ไม่มีงานในสถานะที่เลือก — เปลี่ยนสถานะด้านบน'}
                </td></tr>
              )}
              {visible.map((r, i) => {
                const k = key(r);
                const res = results[k];
                const busy = Boolean(pulling[k]);
                // key ของแถวต้องไม่ซ้ำ — ถ้าซ้ำ React ปล่อยแถวเก่าค้างในตารางตอนเปลี่ยนตัวกรองสถานะ (เจอจริง 04/09/69)
                return (
                  <tr key={`${k}#${i}`} className="border-t border-gray-100 align-top">
                    <td className="px-2 py-2 whitespace-nowrap text-gray-600">{r.dispatch_dt || '-'}</td>
                    {/* เดิมโชว์ finish_dt (สำรวจเสร็จ) ในชื่อ "ส่งงานเมื่อ" — user 07/09/69 ให้ใช้เวลาส่งรายงาน (sendReport_dt) แทน */}
                    <td className="px-2 py-2 whitespace-nowrap text-gray-600" title={r.finish_dt ? `สำรวจเสร็จ ${r.finish_dt}` : undefined}>{r.send_report_dt || '-'}</td>
                    <td className="px-2 py-2 whitespace-nowrap font-mono">{r.claim_no}</td>
                    <td className="px-2 py-2 whitespace-nowrap font-mono">{r.survey_no}</td>
                    <td className="px-2 py-2 min-w-[9rem]">{r.surveyor_name}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.acc_province}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{r.plate_no}</td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      <span className={r.status === PENDING ? 'text-amber-700' : 'text-gray-700'}>{r.status || '-'}</span>
                      {r.emcs_sent && <span className="ml-1 text-[0.65rem] px-1 py-0.5 border border-green-300 text-green-700 bg-green-50">เข้า EMCS แล้ว</span>}
                    </td>
                    <td className="px-2 py-2">
                      {r.imported_case_id ? (
                        <Link href={`/inspector/cases/${r.imported_case_id}`} className="text-green-700 hover:underline whitespace-nowrap">
                          มีแล้ว #{r.imported_case_id}{r.imported_status ? ` · ${STATUS_TH[r.imported_status] ?? r.imported_status}` : ''}
                        </Link>
                      ) : <span className="text-gray-400">ยังไม่มี</span>}
                      {res && (
                        <div className={`text-xs mt-0.5 ${res.ok ? 'text-green-700' : 'text-red-700'}`}>
                          {res.text}{res.ok && res.caseId ? <> · <Link href={`/inspector/cases/${res.caseId}`} className="underline">เปิดเคส</Link></> : null}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      {pullable(r) ? (
                        <button type="button" disabled={busy || bulk || !r.claim_no} onClick={() => { if (confirmPull(r)) void pullOne(r, { navigate: true }); }}
                          className={`px-3 py-1 text-xs border ${r.imported_case_id ? 'border-gray-300 bg-white text-gray-700' : 'border-[var(--md-blue)] bg-[var(--md-blue)] text-white'} disabled:opacity-50 disabled:cursor-not-allowed`}
                          title={!r.claim_no ? 'ISURVEY ยังไม่มีเลขเคลมของงานนี้ — ดึงเข้าไม่ได้' : r.imported_case_id ? 'ดึงซ้ำ = สร้างเคสใหม่อีกเคส (ระวังซ้ำ)' : 'สร้างเคส + ดึงรูป แล้วเปิดหน้าเคส'}>
                          {busy ? 'กำลังดึง…' : r.imported_case_id ? 'ดึงซ้ำ' : 'ดึงเข้า'}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400" title={`ดึงได้เฉพาะสถานะ "รอตรวจข้อมูล" หรือ "จบงาน" — งานนี้สถานะ "${r.status || '-'}"`}>ยังดึงไม่ได้</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500 mt-3">
        ดึงแล้วงานบน ISURVEY ยังสถานะเดิม จนกว่าจะกด &quot;อนุมัติ&quot; ที่หน้าเคส (ระบบปิดงานบน ISURVEY ให้เอง) · รูปที่ช่างทยอยอัปหลังจากนี้จะยังไม่ตามมา — กด &quot;ดึงซ้ำ&quot; จะได้เคสใหม่ ไม่ใช่เติมรูปเคสเดิม
      </p>
    </div>
  );
}
