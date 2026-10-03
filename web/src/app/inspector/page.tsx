'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '@/lib/api';
import { useSocket } from '@/hooks/useSocket';
import CaseList, { type Case, surveyorLabel } from '@/components/cases/CaseList';
import { queueStats } from '@/components/cases/reviewQueue';

type Tab = 'pending' | 'finished' | 'sentBack' | 'approved' | 'sent';
type HistTab = 'approved' | 'sent';
const isHist = (t: Tab): t is HistTab => t === 'approved' || t === 'sent';

/**
 * ตัวเลขที่ server นับให้มากับรายการหลัก (view=active — 03/10/69)
 * แท็บอนุมัติแล้ว/ส่งประกันแล้วไม่ได้โหลดมาทั้งก้อนแล้ว หน้าเว็บนับเองจากรายการไม่ได้
 */
interface ActiveMeta {
  counts: { approved: number; sent: number };
  /** สร้าง draft ใน EMCS แล้วแต่ยังไม่มีใครกด "ส่งงานใหม่" */
  drafts: number;
  emcs: { queued: number; running: number; failed: number };
  /** ป้ายช่างทุกคนในรายการ (รวมงานเก่า) — ตัวเลือกของตัวกรอง "ช่างสำรวจ" */
  surveyors: string[];
}
interface HistPage { key: string; rows: Case[]; total: number; page: number; page_size: number }
interface Found { key: string; rows: Case[]; hits: Record<Tab, number>; total: number; limit: number }

export default function InspectorDashboard() {
  /** งานที่ยังต้องทำ (รอตรวจ · เสร็จงาน · ตีกลับ) — โหลดเต็มทุกครั้ง */
  const [cases, setCases] = useState<Case[]>([]);
  /** null = backend รุ่นก่อน 03/10/69 (คืนทุกสถานะมาในก้อนเดียว) — หน้านี้ทำงานแบบเดิมจนกว่า backend จะ deploy เสร็จ */
  const [meta, setMeta] = useState<ActiveMeta | null>(null);
  /** ทีมของหัวหน้า (staff_groups) — รายการงานถูกกรองตามทีมที่ backend แล้ว ตรงนี้แค่บอกให้รู้ว่ากรองอยู่ (07/09/69) */
  const [team, setTeam] = useState<{ name: string; member_count?: number; thaiPaiboon?: boolean } | null>(null);
  useEffect(() => {
    api.get('/api/staff-groups/mine').then((r) => {
      const g = r.data?.data;
      const n = g ? (g.member_count ?? (g.members?.length ?? 0)) : 0;
      // ทีมที่ตั้ง "เห็นงานไทยไพบูลย์ทั้งหมด" (ทีมสราวุธ 03/10/69) ถูกกรองแม้ยังไม่มีลูกทีม — ต้องบอกให้รู้ว่ากรองอยู่
      setTeam(g && (n > 0 || g.sees_thaipaiboon) ? { name: g.name, member_count: n, thaiPaiboon: Boolean(g.sees_thaipaiboon) } : null);
    }).catch(() => setTeam(null));
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [tab, setTab] = useState<Tab>('pending');
  // เวลาที่ข้อมูลในจอตรงกับเซิร์ฟเวอร์ล่าสุด — ต้องเห็นได้ ไม่งั้นไม่มีทางรู้ว่าจอค้างมานานแค่ไหน
  const [freshAt, setFreshAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const { socket } = useSocket();
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [q, setQ] = useState('');
  const [src, setSrc] = useState('');
  const [who, setWho] = useState('');
  // แท็บอนุมัติแล้ว/ส่งประกันแล้ว: ทีละหน้าจาก server · ผลค้นหา: ค้นที่ server ทุกสถานะ
  const [page, setPage] = useState(1);
  const [hist, setHist] = useState<HistPage | null>(null);
  const [histBusy, setHistBusy] = useState(false);
  const [histError, setHistError] = useState('');
  const [found, setFound] = useState<Found | null>(null);
  const [searchError, setSearchError] = useState('');
  // คำขอที่ตอบช้ากว่าคำขอใหม่ ห้ามทับของใหม่ (กดเปลี่ยนหน้า/พิมพ์ค้นเร็ว ๆ)
  const histSeq = useRef(0);
  const searchSeq = useRef(0);

  /** ต้องโหลดผ่าน api (มี token) แล้วค่อยเซฟเป็นไฟล์ — เปิด URL ตรง ๆ จะโดน 401 */
  const downloadPay = async () => {
    setDownloading(true);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set('from', from);
      if (to) qs.set('to', to);
      const res = await api.get(`/api/cases/pay/export.xlsx?${qs}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ค่าตอบแทนผู้สำรวจ_${from || 'ทั้งหมด'}_${to || ''}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('ดาวน์โหลดใบเบิกเงินไม่สำเร็จ');
    } finally { setDownloading(false); }
  };

  /**
   * ── ทำให้คิวไม่ค้าง ──
   * เดิมโหลดครั้งเดียวตอนเปิดหน้า พอมีหัวหน้าหลายคนต่างคนต่างเห็นภาพคนละเวลา —
   * เปิดเรื่องที่คนอื่นตรวจจบไปแล้ว หรือไม่เห็นงานใหม่จนกว่าจะบังเอิญกด F5
   *
   * ── โหลดเฉพาะงานที่ยังต้องทำ (user สั่ง 03/10/69 ก่อนเริ่มใช้งานจริง) ──
   * เดิมดึงงานทั้งทีมตั้งแต่เริ่มระบบทุกรอบ (1.6 MB) งานอนุมัติแล้วสะสมเดือนละหลักพัน → ยิ่งใช้ยิ่งช้า
   * ตอนนี้รายการหลักมีแค่ รอตรวจ/เสร็จงาน/ตีกลับ + ตัวเลขของแท็บอื่น · แท็บงานเก่าโหลดทีละหน้าเมื่อเปิด
   *
   * `quiet` = โหลดเบื้องหลัง ไม่ต้องขึ้นหน้าจอ "กำลังโหลด" ทับของที่อ่านอยู่
   */
  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      // รอนานกว่าค่าปกติ 15 วิ — เน็ตช้าแล้วโดนตัด = ขึ้น "ไม่สามารถโหลดรายการงานได้" ทั้งที่ข้อมูลกำลังมา (user เจอ 03/10/69)
      const res = await api.get('/api/cases/review', { params: { view: 'active' }, timeout: 45_000 });
      if (res.data.success) {
        const d = res.data.data;
        // backend รุ่นเก่าไม่รู้จัก view → คืนทุกสถานะเป็น array (ช่วง deploy backend/web เสร็จไม่พร้อมกัน)
        if (Array.isArray(d)) { setCases(d); setMeta(null); } else { setCases(d.rows); setMeta(d.meta); }
        setFreshAt(new Date()); setError('');
      }
    } catch {
      // โหลดเงียบพลาด = เน็ตสะดุดชั่วคราว ไม่ต้องล้างของเดิมทิ้งแล้วขึ้นหน้าจอ error
      // (ป้าย "อัปเดตเมื่อ" จะค้างอยู่ที่เวลาเดิม ซึ่งบอกความจริงว่าข้อมูลเก่าแล้ว)
      if (!quiet) setError('ไม่สามารถโหลดรายการงานได้');
    } finally {
      if (quiet) setRefreshing(false); else setLoading(false);
    }
  }, []);

  /**
   * แท็บอนุมัติแล้ว/ส่งประกันแล้ว ทีละหน้า (50) — POST เพราะชื่อช่างในตัวกรองห้ามไปอยู่ใน URL (log ของเซิร์ฟเวอร์)
   * เรียง: อนุมัติล่าสุดก่อน / ส่งประกันล่าสุดก่อน — หน้าแรกคือสิ่งที่เพิ่งทำ
   */
  const loadHist = useCallback(async (view: HistTab, pg: number, s: string, w: string, quiet = false) => {
    const seq = ++histSeq.current;
    if (!quiet) setHistBusy(true);
    try {
      const res = await api.post('/api/cases/review/query',
        { view, page: pg, src: s || undefined, who: w || undefined }, { timeout: 45_000 });
      if (seq !== histSeq.current) return;
      const d = res.data.data;
      setHist({ key: `${view}|${pg}|${s}|${w}`, rows: d.rows, total: d.total, page: d.page, page_size: d.page_size });
      setHistError('');
    } catch {
      if (seq === histSeq.current && !quiet) setHistError('โหลดรายการไม่สำเร็จ');
    } finally {
      if (seq === histSeq.current) setHistBusy(false);
    }
  }, []);

  /**
   * ค้นหาด้วยข้อความ = ค้น**ทุกสถานะ** (user สั่ง 15/09/69) ที่ server — งานเก่าไม่ได้อยู่ในเครื่องแล้ว
   * POST: คำค้น (ทะเบียน/ชื่อผู้เอาประกัน) ห้ามไปอยู่ใน URL
   */
  const loadSearch = useCallback(async (needle: string, s: string, w: string) => {
    const seq = ++searchSeq.current;
    try {
      const res = await api.post('/api/cases/review/query',
        { view: 'search', q: needle, src: s || undefined, who: w || undefined }, { timeout: 45_000 });
      if (seq !== searchSeq.current) return;
      const d = res.data.data;
      setFound({ key: `${needle}|${s}|${w}`, rows: d.rows, hits: d.hits, total: d.total, limit: d.limit });
      setSearchError('');
    } catch {
      if (seq === searchSeq.current) setSearchError('ค้นหาไม่สำเร็จ');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const needle = q.trim().toLowerCase();
  const serverPaged = meta !== null;
  const histKey = `${tab}|${page}|${src}|${who}`;
  const searchKey = `${needle}|${src}|${who}`;

  // เปิดแท็บงานเก่า / เปลี่ยนหน้า / เปลี่ยนตัวกรอง → โหลดหน้านั้น
  useEffect(() => {
    if (!serverPaged || needle || !isHist(tab)) return;
    loadHist(tab, page, src, who);
  }, [serverPaged, needle, tab, page, src, who, loadHist]);

  // พิมพ์ค้นหา → รอพิมพ์เสร็จ (0.3 วิ) แล้วค่อยถาม server
  useEffect(() => {
    if (!serverPaged || !needle) return;
    const t = setTimeout(() => loadSearch(needle, src, who), 300);
    return () => clearTimeout(t);
  }, [serverPaged, needle, src, who, loadSearch]);

  /** รีเฟรชทุกอย่างที่อยู่บนจอ (รายการหลัก + หน้า/ผลค้นที่เปิดอยู่) — ใช้กับ socket และตาข่ายรอง */
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    refreshRef.current = () => {
      load(true);
      if (!serverPaged) return;
      if (needle) loadSearch(needle, src, who);
      else if (isHist(tab)) loadHist(tab, page, src, who, true);
    };
  });

  /** เคสเปลี่ยน (ใครก็ตามทำ) → โหลดใหม่ · รวบหลายสัญญาณที่มาติด ๆ กันเป็นครั้งเดียว */
  useEffect(() => {
    if (!socket) return;
    const onChange = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => refreshRef.current(), 400);
    };
    socket.on('case_changed', onChange);
    return () => {
      socket.off('case_changed', onChange);
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
    };
  }, [socket]);

  /**
   * ตาข่ายรอง — socket หลุดเงียบได้ (เน็ตวืบ/พร็อกซีตัด) แล้วจะไม่มีสัญญาณอะไรมาอีกเลย
   * โหลดเฉพาะตอนแท็บเปิดอยู่จริง ไม่ยิงทิ้งจากแท็บที่ถูกพับไว้ข้ามคืน
   */
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refreshRef.current();
    }, 60_000);
    // กลับมาที่แท็บ = จังหวะที่คนกำลังจะอ่าน ต้องสดที่สุด
    const onVis = () => { if (document.visibilityState === 'visible') refreshRef.current(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  /**
   * แบ่งงานเป็นกอง — กติกาเดียวกับ backend (reviewList.ts) และ reviewQueue.ts
   * รายการหลักมีแค่ รอตรวจ/เสร็จงาน/ตีกลับ แล้ว (approved/sent ว่าง ยกเว้น backend รุ่นเก่าช่วง deploy)
   *
   * "ส่งประกันแล้ว" ใช้ emcs_submitted_at ไม่ใช่ emcs_imported_at —
   * นำเข้าแล้ว (มี draft) ยังไม่ใช่ประกันได้รับงาน ต้องเห็นว่าค้างอยู่
   */
  const groups = useMemo(() => {
    const pending: Case[] = [], finished: Case[] = [], sentBack: Case[] = [], approved: Case[] = [], sent: Case[] = [];
    for (const c of cases) {
      if (c.emcs_submitted_at) sent.push(c);
      else if (c.status === 'reviewed') approved.push(c);
      // ตีกลับไปแล้ว = งานอยู่กับช่าง ไม่ใช่คิวที่หัวหน้าต้องลงมือ — แยกแท็บ ไม่งั้น
      // ตัวเลข "รอตรวจ" จะบวมด้วยงานที่รออีกฝั่งอยู่ (แต่ยังเปิดแก้เองได้ตามที่ตกลงกันไว้)
      else if (c.status === 'assigned' && c.sent_back_at) sentBack.push(c);
      // เสร็จงานหน้างานแล้ว ยังไม่ส่งรายงาน (07/09/69) — หัวหน้าเห็นว่างานภาคสนามจบแล้ว แต่ยังตรวจไม่ได้
      else if (c.status === 'finished') finished.push(c);
      else pending.push(c);
    }
    return { pending, finished, sentBack, approved, sent };
  }, [cases]);

  /** งานที่กดอนุมัติไม่ได้จนกว่าจะเติมข้อมูล — ตัวเลขที่หัวหน้าต้องเห็นก่อนเปิดเคส
   *  คิดที่ reviewQueue.ts ที่เดียว (นับเฉพาะงานรอตรวจ ซึ่งอยู่ในรายการหลักครบ) */
  const incomplete = useMemo(() => queueStats(cases).incomplete, [cases]);

  const surveyors = useMemo(() => {
    // ช่างทุกคนในรายการรวมงานเก่า (server ให้มา) + ของที่อยู่ในจอ
    const s = new Set<string>(meta?.surveyors ?? []);
    for (const c of cases) {
      const label = surveyorLabel(c);   // ชื่อ+นามสกุล · งาน OSS = ชื่อ/บริษัทตามรายงาน (กรองได้เหมือนช่างในระบบ)
      if (label) s.add(label);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'th'));
  }, [cases, meta]);

  /**
   * ค้นหาด้วยข้อความ = ค้น**ทุกสถานะ** (user สั่ง 15/09/69) — เดิมค้นเฉพาะแท็บที่เลือกอยู่
   * พิมพ์เลขเคลมตอนอยู่แท็บ "อนุมัติแล้ว" ทั้งที่งานยังรอตรวจ = หาไม่เจอ และไม่มีอะไรบอกว่าต้องสลับแท็บก่อน
   * ระหว่างค้น แท็บโชว์ "พบ/ทั้งหมด" ของแต่ละสถานะแทน (ไม่ไฮไลต์แท็บ เพราะผลรวมทุกสถานะ) · ตัวกรองที่มา/ช่าง
   * ยังกรองซ้อนได้ · ล้างช่องค้นหาแล้วแท็บกลับมามีผลตามเดิม
   * `shown` = null → กำลังโหลดหน้า/ผลค้นที่ขอ (ยังไม่มีอะไรตรงกับที่เลือกให้โชว์)
   */
  const { shown, hits } = useMemo((): { shown: Case[] | null; hits: Record<Tab, number> | null } => {
    const ok = (c: Case) => {
      if (src && String(c.source ?? 'mobile') !== src) return false;
      if (who && surveyorLabel(c) !== who) return false;
      if (!needle) return true;
      return [c.claim_no, c.survey_job_no, c.claim_ref_no, c.license_plate, c.customer_name]
        .some((v) => String(v ?? '').toLowerCase().includes(needle));
    };
    const keys = Object.keys(groups) as Tab[];
    if (!serverPaged) {
      // backend รุ่นเก่า (ช่วง deploy) — ทุกสถานะอยู่ในเครื่อง ค้น/แบ่งแท็บเองแบบเดิม
      const pool = needle ? cases : groups[tab];
      return {
        shown: pool.filter(ok),
        hits: needle ? Object.fromEntries(keys.map((k) => [k, groups[k].filter(ok).length])) as Record<Tab, number> : null,
      };
    }
    if (needle) {
      const fresh = found && found.key === searchKey ? found : null;
      return { shown: fresh ? fresh.rows : null, hits: fresh ? fresh.hits : null };
    }
    if (isHist(tab)) return { shown: hist && hist.key === histKey ? hist.rows : null, hits: null };
    return { shown: groups[tab].filter(ok), hits: null };
  }, [cases, groups, tab, needle, src, who, serverPaged, found, searchKey, hist, histKey]);

  // ตัวเลขบนแท็บ: งานที่ยังต้องทำนับจากรายการ · งานเก่านับที่ server
  const count: Record<Tab, number> = {
    pending: groups.pending.length,
    finished: groups.finished.length,
    sentBack: groups.sentBack.length,
    approved: meta ? meta.counts.approved : groups.approved.length,
    sent: meta ? meta.counts.sent : groups.sent.length,
  };
  const pages = hist ? Math.max(1, Math.ceil(hist.total / hist.page_size)) : 1;

  // งานย้ายแท็บไปแล้วจนหน้าที่เปิดอยู่ว่าง (เช่น หน้าสุดท้าย) → ถอยไปหน้าสุดท้ายที่มีของ
  useEffect(() => {
    if (hist && hist.key === histKey && hist.rows.length === 0 && page > pages) setPage(pages);
  }, [hist, histKey, page, pages]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-gray-500">กำลังโหลดรายการงาน...</div></div>;
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>;

  const TABS: { key: Tab; label: string; n: number }[] = [
    { key: 'pending', label: 'รอตรวจ', n: count.pending },
    { key: 'finished', label: 'เสร็จงาน รอส่งรายงาน', n: count.finished },
    { key: 'sentBack', label: 'ตีกลับแล้ว', n: count.sentBack },
    { key: 'approved', label: 'อนุมัติแล้ว', n: count.approved },
    { key: 'sent', label: 'ส่งประกันแล้ว', n: count.sent },
  ];
  // draft ค้าง = สร้างเรื่องใน EMCS แล้วแต่ยังไม่มีใครกด "ส่งงานใหม่"
  const pendingDrafts = meta ? meta.drafts : cases.filter((c) => c.emcs_imported_at && !c.emcs_submitted_at).length;
  // คิวสถานีนำเข้า EMCS (migration 052) — server นับจากงานล่าสุดต่อเคส (งานพวกนี้อยู่แท็บอนุมัติแล้ว ไม่ได้มากับรายการหลัก)
  const emcsQ = meta ? meta.emcs : {
    queued: cases.filter((c) => c.emcs_job_status === 'queued').length,
    running: cases.filter((c) => c.emcs_job_status === 'running').length,
    failed: cases.filter((c) => c.emcs_job_status === 'failed' && !c.emcs_imported_at).length,
  };
  const changeTab = (t: Tab) => { setTab(t); setPage(1); };
  const histPaging = serverPaged && !needle && isHist(tab);
  const pager = histPaging && hist && hist.key === histKey && hist.total > hist.page_size ? (
    <div className="flex items-center gap-2 text-sm">
      <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || histBusy}
        className="px-3 py-1 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40">‹ ก่อนหน้า</button>
      <span className="text-gray-600">หน้า {page} / {pages}</span>
      <button type="button" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages || histBusy}
        className="px-3 py-1 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40">ถัดไป ›</button>
    </div>
  ) : null;

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">รายการงานตรวจสอบ</h2>
          {/* บอกความสดของข้อมูล — หน้าอัปเดตเองอยู่แล้ว แต่ต้องพิสูจน์ให้เห็น
              ไม่งั้นคนยังกด F5 เผื่อไว้ (และไม่มีทางรู้เลยถ้าการอัปเดตเงียบไป) */}
          <p className="text-gray-500 mt-1 flex items-center gap-2">
            <span>งานที่รอการตรวจสอบและอนุมัติ</span>
            {team && (
              <span className="ml-2 text-xs text-blue-800" title="กรองตามรายชื่อลูกทีมที่แอดมินตั้งไว้ · งานที่คุณดึง/สร้างเองแสดงด้วยเสมอ · ดูรายชื่อที่เมนู ลูกทีมของฉัน">
                {team.thaiPaiboon
                  ? <>· งานไทยไพบูลย์ทั้งหมด{team.member_count ? ` + ทีม ${team.name} (${team.member_count} รายชื่อ)` : ''}</>
                  : <>· เฉพาะงานของทีม {team.name}{team.member_count ? ` (${team.member_count} รายชื่อ)` : ''}</>}
              </span>
            )}
            {freshAt && (
              <span className="text-xs text-gray-400">
                · อัปเดตเมื่อ {freshAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} น.
              </span>
            )}
            <button type="button" onClick={() => refreshRef.current()} disabled={refreshing}
              className="text-xs text-blue-600 hover:underline disabled:text-gray-400">
              {refreshing ? 'กำลังอัปเดต...' : 'อัปเดตเดี๋ยวนี้'}
            </button>
          </p>
        </div>
        {/* ใบเบิกเงินค่าตอบแทนผู้สำรวจ — เฉพาะงานที่คิดเงินผ่านระบบนี้
            งานที่ยังทำผ่านระบบเก่ายังออกใบจาก se-billing เหมือนเดิม */}
        <div className="flex items-end gap-2 shrink-0">
          <label className="text-xs text-gray-500">
            ตั้งแต่
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="block border border-gray-300 rounded px-2 py-1 text-sm text-gray-800" />
          </label>
          <label className="text-xs text-gray-500">
            ถึง
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="block border border-gray-300 rounded px-2 py-1 text-sm text-gray-800" />
          </label>
          <button type="button" onClick={downloadPay} disabled={downloading}
            className="px-4 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:bg-emerald-300">
            {downloading ? 'กำลังสร้าง...' : 'ใบเบิกเงิน (Excel)'}
          </button>
        </div>
      </div>

      {/* แถบสรุป — เดิมต้องไล่อ่านทีละแถวถึงจะรู้ว่าเหลือกี่งาน */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div className="text-xs text-gray-500">รอตรวจ</div>
          <div className="text-2xl font-semibold text-gray-800">{count.pending}</div>
        </div>
        <div className={`rounded-lg px-4 py-3 border ${incomplete > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
          <div className={`text-xs ${incomplete > 0 ? 'text-amber-700' : 'text-gray-500'}`}>ข้อมูลยังไม่ครบ</div>
          <div className={`text-2xl font-semibold ${incomplete > 0 ? 'text-amber-700' : 'text-gray-800'}`}>{incomplete}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
          <div className="text-xs text-gray-500">อนุมัติแล้ว</div>
          <div className="text-2xl font-semibold text-gray-800">{count.approved}</div>
        </div>
        <div className={`rounded-lg px-4 py-3 border ${pendingDrafts > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
          <div className={`text-xs ${pendingDrafts > 0 ? 'text-amber-700' : 'text-gray-500'}`}>draft ค้างที่ประกัน</div>
          <div className={`text-2xl font-semibold ${pendingDrafts > 0 ? 'text-amber-700' : 'text-gray-800'}`}>{pendingDrafts}</div>
        </div>
      </div>

      {/* คิวสถานีนำเข้า EMCS (migration 052) */}
      {(() => {
        const { queued: qn, running: r, failed: f } = emcsQ;
        if (qn + r + f === 0) return null;
        return (
          <div className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 ${f > 0 ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'}`}>
            <span className="text-lg leading-none">🏭</span>
            <span className={`text-sm ${f > 0 ? 'text-red-800' : 'text-blue-900'}`}>
              คิวสถานีนำเข้า EMCS: รอ <strong>{qn}</strong> · กำลังทำ <strong>{r}</strong>
              {f > 0 ? <> · นำเข้าไม่สำเร็จ <strong>{f}</strong> (ดูสาเหตุในแท็บ &quot;อนุมัติแล้ว&quot; แล้วส่งเข้าคิวอีกครั้ง)</> : null}
            </span>
          </div>
        );
      })()}

      {pendingDrafts > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
          <span className="text-lg leading-none">⏳</span>
          <span className="text-sm text-amber-800">
            มี <strong>{pendingDrafts}</strong> เรื่องที่สร้างใน EMCS แล้วแต่ยังไม่ได้กด
            &quot;ส่งงานใหม่&quot; — บริษัทประกันยังไม่ได้รับงาน
          </span>
        </div>
      )}

      <div className="flex gap-2 mb-3">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => changeTab(t.key)}
            title={hits ? `กำลังค้นทุกสถานะ — พบในสถานะนี้ ${hits[t.key]} จาก ${t.n} เรื่อง` : undefined}
            className={`px-4 py-1.5 text-sm rounded-lg border transition-colors ${
              !needle && tab === t.key
                ? 'bg-white border-gray-400 text-gray-800 font-medium'
                : 'bg-transparent border-transparent text-gray-500 hover:bg-gray-100'}`}>
            {t.label} {hits ? (
              <span className={hits[t.key] > 0 ? 'text-gray-800 font-medium' : ''}>{hits[t.key]}<span className="text-gray-400 font-normal">/{t.n}</span></span>
            ) : t.n}
          </button>
        ))}
      </div>

      <div className="flex gap-2 mb-4">
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="ค้นหา เลขเคลม / เลขเซอร์เวย์ / เลขรับแจ้ง / ทะเบียน / ชื่อผู้เอาประกัน"
          className="flex-[2] min-w-0 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-800 bg-white" />
        <select value={src} onChange={(e) => { setSrc(e.target.value); setPage(1); }}
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-800 bg-white">
          <option value="">ที่มา — ทั้งหมด</option>
          <option value="mobile">แอปมือถือ</option>
          <option value="isurvey_live">ระบบเก่า (สด)</option>
          <option value="isurvey_xml">ไฟล์ XML</option>
          <option value="isurvey_reference">อ้างอิง ISURVEY</option>
        </select>
        <select value={who} onChange={(e) => { setWho(e.target.value); setPage(1); }}
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-gray-800 bg-white">
          <option value="">ช่างสำรวจ — ทุกคน</option>
          {surveyors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* บรรทัดสรุปเหนือรายการ: ค้นหา = พบกี่เรื่อง · แท็บงานเก่า = แถวที่เท่าไหร่ของทั้งหมด · แท็บอื่นที่กรองอยู่ = เหลือกี่เรื่อง */}
      {(needle || histPaging || src || who) && (
        <div className="flex items-center justify-between gap-3 mb-2 min-h-[2rem]">
          <p className="text-xs text-gray-500">
            {needle ? (
              !serverPaged ? <>แสดง {shown?.length ?? 0} จาก {cases.length} เรื่อง — ค้นทุกสถานะ</>
                : searchError ? <span className="text-red-600">{searchError}</span>
                : found && found.key === searchKey ? (
                  <>พบ {found.total} เรื่อง — ค้นทุกสถานะ{found.total > found.rows.length ? ` (แสดง ${found.rows.length} เรื่องล่าสุด — พิมพ์ให้ละเอียดขึ้นเพื่อหาเรื่องที่เก่ากว่า)` : ''}</>
                ) : 'กำลังค้นหา...'
            ) : histPaging ? (
              histError ? <span className="text-red-600">{histError}</span>
                : hist && hist.key === histKey ? (
                  hist.total > 0
                    ? <>แสดง {(hist.page - 1) * hist.page_size + 1}–{(hist.page - 1) * hist.page_size + hist.rows.length} จาก {hist.total} เรื่อง · {tab === 'approved' ? 'อนุมัติล่าสุดก่อน' : 'ส่งล่าสุดก่อน'}</>
                    : <>ไม่มีเรื่องในแท็บนี้</>
                ) : 'กำลังโหลด...'
            ) : (
              <>แสดง {shown?.length ?? 0} จาก {groups[tab].length} เรื่อง</>
            )}
            {(q || src || who) && (
              <button type="button" onClick={() => { setQ(''); setSrc(''); setWho(''); setPage(1); }}
                className="ml-2 text-blue-600 hover:underline">ล้างตัวกรอง</button>
            )}
          </p>
          {pager}
        </div>
      )}

      {shown === null ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          {(needle ? searchError : histError) || (needle ? 'กำลังค้นหา...' : 'กำลังโหลด...')}
        </div>
      ) : (
        <CaseList cases={shown} basePath="/inspector" />
      )}
      {pager && <div className="flex justify-end mt-3">{pager}</div>}
    </div>
  );
}
