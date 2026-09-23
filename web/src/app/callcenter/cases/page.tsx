'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import { downloadCaseXml } from '@/lib/downloadXml';
import RecallJobButton, { recallNotice } from '@/components/cases/RecallJobButton';
import CancelJobButton, { canCancelStatus, cancelNotice } from '@/components/cases/CancelJobButton';

interface CaseRow {
  id: number;
  customer_name: string;
  status: string;
  created_at: string;
  surveyor_first_name?: string;
  surveyor_last_name?: string;
  claim_no?: string;
  survey_job_no?: string;
  claim_ref_no?: string;
  visit_count?: number;
  assigned_at?: string | null;
  /** ดึงงานกลับล่าสุด (ยังไม่จ่ายใหม่) — ดึงจากใคร โดยใคร เมื่อไร (case_dispatch_log migration 065) */
  recalled_first_name?: string | null;
  recalled_last_name?: string | null;
  recalled_code?: string | null;
  recalled_by_first_name?: string | null;
  recalled_by_last_name?: string | null;
  recalled_at?: string | null;
  /** ยกเลิกงาน (23/09/69) — เหตุผล/คน/เวลา โชว์ใต้ป้าย "ยกเลิก" */
  cancel_reason?: string | null;
  cancelled_by_name?: string | null;
  cancelled_at?: string | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending:  { label: 'รอมอบหมาย',   color: 'text-gray-700',   bg: 'bg-gray-100' },
  assigned: { label: 'มอบหมายแล้ว', color: 'text-orange-700', bg: 'bg-orange-100' },
  finished: { label: 'เสร็จงานแล้ว', color: 'text-teal-700',   bg: 'bg-teal-100' },
  surveyed: { label: 'สำรวจแล้ว',   color: 'text-blue-700',   bg: 'bg-blue-100' },
  reviewed: { label: 'ตรวจสอบแล้ว', color: 'text-green-700',  bg: 'bg-green-100' },
  declined: { label: 'ปฏิเสธแล้ว',  color: 'text-red-700',    bg: 'bg-red-100' },
  cancelled: { label: 'ยกเลิก',       color: 'text-red-800',    bg: 'bg-red-50' },   // ยกเลิกงาน (22/09/69)
};

export default function CallcenterCasesPage() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [xmlBusyId, setXmlBusyId] = useState<number | null>(null);
  /** กำลังเปิดงานครั้งถัดไปของเคสไหน — กันกดรัวจนได้ 2 ใบ */
  const [followBusyId, setFollowBusyId] = useState<number | null>(null);
  /** ข้อความหลัง "ดึงงานกลับ" — ต้องบอกว่าการ์ดบนเครื่องช่างถูกถอนหรือเปล่า */
  const [notice, setNotice] = useState('');
  /** ดัน "ตอนนี้" ทุก 60 วิ — ป้ายอายุงานต้องเดินต่อแม้เปิดหน้าค้างไว้ทั้งวัน */
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const reqSeq = useRef(0); // กัน response เก่าทับใหม่ (พิมพ์เร็ว → คำขอเก่ามาช้า)

  /**
   * เปิดงานครั้งถัดไปของเคลมเดิม แล้วพาไปหน้าจ่ายงานทันที
   * (ประเภทเคลมของครั้งใหม่เลือกที่หน้านั้น — ปกติเป็นงานติดตาม/นัดหมาย)
   */
  /**
   * อายุงานนับจาก **เวลาจ่ายงาน** (กติกา user 31/08/69) — KPI ภายใน 24 ชม.
   * ไม่มีค่าปรับจากประกัน จึงเตือนให้เห็น ไม่ขวางงาน ไม่มีนับถอยหลังเร้าใจ
   *
   * นับเฉพาะงานที่ **จ่ายแล้วแต่ช่างยังไม่ส่ง** (`assigned`) — ช่วงเดียวที่ยังทำอะไรได้
   * ส่งแล้ว/ตรวจแล้ว นาฬิกาหยุด ไม่ต้องเตือนอีก
   * งานเก่าที่ยังไม่มี assigned_at ถอยไปใช้เวลาสร้างเคส (ทำเครื่องหมาย ~ ว่าเป็นค่าประมาณ)
   */
  const ageOf = (c: CaseRow): { text: string; cls: string; over: boolean } | null => {
    if (c.status !== 'assigned') return null;
    const base = c.assigned_at || c.created_at;
    if (!base) return null;
    const ms = Date.now() - new Date(base).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    const hrs = ms / 3_600_000;
    const approx = c.assigned_at ? '' : '~';
    const text = hrs < 1 ? `${approx}${Math.max(1, Math.round(ms / 60_000))} นาที` : `${approx}${Math.floor(hrs)} ชม.`;
    if (hrs >= 24) return { text, cls: 'bg-red-100 text-red-700', over: true };
    if (hrs >= 18) return { text, cls: 'bg-amber-100 text-amber-800', over: false };
    return { text, cls: 'bg-gray-100 text-gray-500', over: false };
  };
  /** งานที่จ่ายแล้วเกิน 24 ชม. — โชว์เป็นแถบสรุปบนสุด ถ้าไม่มีก็ไม่ต้องขึ้นอะไร */
  const overdue = cases.filter((c) => ageOf(c)?.over).length;

  const handleFollowup = async (c: CaseRow) => {
    if (followBusyId !== null) return;
    setFollowBusyId(c.id);
    try {
      const res = await api.post(`/api/cases/${c.id}/followup`);
      const newId = res.data?.data?.id;
      if (res.data?.success && newId) router.push(`/callcenter/cases/${newId}/assign`);
      else alert(res.data?.message || 'เปิดงานครั้งถัดไปไม่สำเร็จ');
    } catch (e) {
      // backend บอกเหตุผลมาเป็นภาษาคน (เช่น มีงานค้างอยู่แล้ว) — ส่งต่อให้ผู้ใช้เห็น
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      alert(msg || 'เปิดงานครั้งถัดไปไม่สำเร็จ');
    } finally { setFollowBusyId(null); }
  };

  const handleXml = async (c: CaseRow) => {
    if (xmlBusyId !== null) return;
    setXmlBusyId(c.id);
    try {
      await downloadCaseXml(c.id, c.claim_no);
    } catch {
      alert('สร้างไฟล์ XML ไม่สำเร็จ (เคสนี้อาจยังไม่มีข้อมูลรายงาน)');
    } finally {
      setXmlBusyId(null);
    }
  };

  // debounce ช่องค้นหา → search
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchCases = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '20');
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);

      const res = await api.get(`/api/cases/list?${params}`);
      if (seq !== reqSeq.current) return; // มีคำขอใหม่กว่า → ทิ้งผลเก่า
      if (res.data.success) {
        setCases(res.data.data.cases);
        setTotal(res.data.data.total);
        setTotalPages(res.data.data.totalPages);
      }
    } catch {
      // handled by interceptor
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  const formatDate = (d: string) => {
    if (!d) return '-';
    try {
      const dt = new Date(d);
      return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    } catch { return d; }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">รายการเคสทั้งหมด</h1>
          <p className="text-gray-500 text-sm mt-1">ทั้งหมด {total} เคส</p>
        </div>
        <Link href="/callcenter/cases/new" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          + สร้างเคสใหม่
        </Link>
      </div>

      {/* งานที่จ่ายแล้วเกิน 24 ชม. — KPI ภายใน ไม่มีค่าปรับ จึงบอกให้เห็น ไม่ขวางงาน
          ⛔ ไม่มีงานเกิน = ไม่ต้องขึ้นอะไรเลย (แถบที่ขึ้นทุกวันจนคนชิน = เตือนไม่ได้อีก) */}
      {overdue > 0 && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-2.5 rounded-lg text-sm mb-4">
          <strong>{overdue} เคส</strong> จ่ายงานไปเกิน 24 ชม. แล้วช่างยังไม่ส่งงาน —
          ดูป้ายเวลาสีแดงในคอลัมน์ &quot;วันที่&quot;
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4 flex flex-wrap gap-4">
        <input
          type="text"
          placeholder="ค้นหา เลขเคลม, เลขเซอร์เวย์, เลขรับแจ้ง, ชื่อลูกค้า, สถานที่..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none flex-1 min-w-[240px]"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">ทุกสถานะ</option>
          <option value="pending">รอมอบหมาย</option>
          <option value="assigned">มอบหมายแล้ว</option>
          <option value="finished">เสร็จงานแล้ว (รอส่งรายงาน)</option>
          <option value="surveyed">สำรวจแล้ว</option>
          <option value="cancelled">ยกเลิก</option>
          <option value="reviewed">ตรวจสอบแล้ว</option>
          <option value="declined">ปฏิเสธแล้ว</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
        ) : cases.length === 0 ? (
          <div className="text-center text-gray-400 py-12">ไม่พบเคส</div>
        ) : (
          <div className="overflow-x-auto">
            {notice && (
              <div className="flex items-start justify-between gap-3 px-5 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-900">
                <span>{notice}</span>
                <button onClick={() => setNotice('')} className="text-amber-700 hover:text-amber-900 text-xs font-medium">ปิด</button>
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-5 py-3 font-semibold text-gray-600">สถานะ</th>
                  <th className="px-5 py-3 font-semibold text-gray-600">เลขเคลม</th>
                  <th className="px-5 py-3 font-semibold text-gray-600">เลขเซอร์เวย์</th>
                  <th className="px-5 py-3 font-semibold text-gray-600">เลขรับแจ้ง</th>
                  <th className="px-5 py-3 font-semibold text-gray-600">ลูกค้า</th>
                  <th className="px-5 py-3 font-semibold text-gray-600">ช่างสำรวจ</th>
                  <th className="px-5 py-3 font-semibold text-gray-600">ครั้งที่</th>
                  <th className="px-5 py-3 font-semibold text-gray-600">วันที่</th>
                  <th className="px-5 py-3 font-semibold text-gray-600">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const s = STATUS_MAP[c.status] || { label: c.status, color: 'text-gray-700', bg: 'bg-gray-100' };
                  const isPending = c.status === 'pending';
                  return (
                    <tr
                      key={c.id}
                      onClick={isPending ? () => router.push(`/callcenter/cases/${c.id}/assign`) : undefined}
                      className={`border-t border-gray-100 hover:bg-gray-50 ${isPending ? 'cursor-pointer' : ''}`}
                    >
                      <td className="px-5 py-3">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.color}`}>
                          {s.label}
                        </span>
                        {c.status === 'cancelled' && (c.cancel_reason || c.cancelled_by_name) && (
                          /* ยกเลิกแล้ว (23/09/69) — ต้องเห็นว่าทำไม ใครยกเลิก เมื่อไร (คืนงานได้เฉพาะแอดมิน) */
                          <span className="block mt-1 text-xs text-red-700 max-w-[240px]">
                            {c.cancel_reason || '-'}
                            <span className="block text-gray-500">
                              {c.cancelled_by_name ? `โดย ${c.cancelled_by_name}` : ''}
                              {c.cancelled_at ? ` · ${formatDate(c.cancelled_at)}` : ''}
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-gray-600">{c.claim_no || '-'}</td>
                      <td className="px-5 py-3 text-gray-600">{c.survey_job_no || '-'}</td>
                      <td className="px-5 py-3 text-gray-600">{c.claim_ref_no || '-'}</td>
                      <td className="px-5 py-3 text-gray-600 max-w-[180px] truncate">{c.customer_name || '-'}</td>
                      <td className="px-5 py-3 text-gray-600">
                        {c.surveyor_first_name ? `${c.surveyor_first_name} ${c.surveyor_last_name || ''}` : c.recalled_first_name ? (
                          /* ดึงงานกลับแล้ว (22/09/69) — ต้องเห็นว่าดึงจากใคร โดยใคร เมื่อไร ก่อนจ่ายซ้ำ */
                          <span className="text-amber-700">
                            {c.recalled_code ? `${c.recalled_code} ` : ''}
                            {c.recalled_first_name} {c.recalled_last_name || ''}
                            <span className="block text-xs text-gray-500">
                              ดึงงานกลับโดย {`${c.recalled_by_first_name || ''} ${c.recalled_by_last_name || ''}`.trim() || '-'}
                              {c.recalled_at ? ` · ${formatDate(c.recalled_at)}` : ''}
                            </span>
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-5 py-3 text-gray-500">{c.visit_count || 1}</td>
                      <td className="px-5 py-3 text-gray-500 whitespace-nowrap">
                        {formatDate(c.created_at)}
                        {(() => {
                          const a = ageOf(c);
                          if (!a) return null;
                          return (
                            <span
                              title={c.assigned_at
                                ? 'เวลาที่ผ่านไปนับจากจ่ายงาน (KPI ภายใน 24 ชม.)'
                                : 'งานนี้จ่ายก่อนระบบเก็บเวลาจ่ายงาน — นับจากเวลาสร้างเคสแทน (ค่าประมาณ)'}
                              className={`ml-2 inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${a.cls}`}
                            >
                              {a.text}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                        {(c.status === 'surveyed' || c.status === 'reviewed') ? (
                          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => handleXml(c)}
                              disabled={xmlBusyId !== null}
                              title="ดาวน์โหลดไฟล์ XML สำหรับ import เข้าพอร์ทัลประกัน (EMCS)"
                              className="px-2.5 py-1 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                            >
                              {xmlBusyId === c.id ? 'กำลังสร้าง...' : '⬇ XML'}
                            </button>
                            {/* งานครั้งถัดไปของเคลมเดิม — ก๊อปเลขเคลม/กรมธรรม์/รถให้ ไม่ต้องพิมพ์ซ้ำ
                                (พิมพ์เลขเคลมผิดตัวเดียว = ระบบไม่รู้ว่าเป็นงานเดียวกัน "ครั้งที่" กลับเป็น 1) */}
                            <button
                              onClick={() => handleFollowup(c)}
                              disabled={followBusyId !== null}
                              title="เปิดงานครั้งถัดไปของเคลมนี้ (ติดตาม/นัดหมาย/เจรจา) — ข้อมูลเคลมก๊อปให้ ไม่ต้องพิมพ์ซ้ำ"
                              className="px-2.5 py-1 text-xs font-medium bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              {followBusyId === c.id ? 'กำลังเปิด...' : '+ งานครั้งถัดไป'}
                            </button>
                          </div>
                        ) : isPending ? (
                          <Link
                            href={`/callcenter/cases/${c.id}/assign`}
                            onClick={(e) => e.stopPropagation()}
                            title="มอบหมายช่างสำรวจให้เคสนี้"
                            className="inline-block px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                          >
                            มอบหมาย
                          </Link>
                        ) : c.status === 'assigned' ? (
                          /* ดึงงานกลับ (22/09/69) — งานกลับไปรอมอบหมาย + การ์ดบนเครื่องช่างถูกถอน แล้วจ่ายคนใหม่ได้ทันที */
                          <RecallJobButton
                            caseId={c.id}
                            claimNo={c.claim_no}
                            surveyorName={c.surveyor_first_name ? `${c.surveyor_first_name} ${c.surveyor_last_name || ''}`.trim() : undefined}
                            onRecalled={(r) => {
                              const who = c.surveyor_first_name ? `${c.surveyor_first_name} ${c.surveyor_last_name || ''}`.trim() : undefined;
                              setNotice(recallNotice(r, c.claim_no, who));
                              fetchCases();   // แถวนี้ต้องกลายเป็น "รอมอบหมาย" (คลิกแล้วไปจ่ายงานได้เลย)
                            }}
                          />
                        ) : !canCancelStatus(c.status) ? (
                          <span className="text-gray-300 text-xs">-</span>
                        ) : null}
                        {/* ยกเลิกงาน (23/09/69) — ทุกสถานะที่ยังไม่อนุมัติ · ต้องบอกเหตุผล · งานที่อยู่กับช่างถูกถอนการ์ดให้ · แอดมินเลิกยกเลิกได้ */}
                        {canCancelStatus(c.status) && (
                          <CancelJobButton
                            caseId={c.id}
                            claimNo={c.claim_no}
                            status={c.status}
                            surveyorName={c.surveyor_first_name ? `${c.surveyor_first_name} ${c.surveyor_last_name || ''}`.trim() : undefined}
                            onCancelled={(r) => {
                              const who = c.surveyor_first_name ? `${c.surveyor_first_name} ${c.surveyor_last_name || ''}`.trim() : undefined;
                              setNotice(cancelNotice(r, c.claim_no, who));
                              fetchCases();   // แถวนี้ต้องกลายเป็น "ยกเลิก" พร้อมเหตุผล
                            }}
                          />
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-100 text-gray-700">ก่อนหน้า</button>
          <span className="text-sm text-gray-600">หน้า {page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-100 text-gray-700">ถัดไป</button>
        </div>
      )}
    </div>
  );
}
