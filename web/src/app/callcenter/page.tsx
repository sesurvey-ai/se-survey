'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import api from '@/lib/api';
import { downloadCaseXml } from '@/lib/downloadXml';
import RecallJobButton, { recallNotice } from '@/components/cases/RecallJobButton';
import CancelJobButton, { canCancelStatus, cancelNotice } from '@/components/cases/CancelJobButton';

interface CaseRow {
  id: number;
  customer_name: string;
  insurance_company?: string;
  status: string;
  created_at: string;
  surveyor_first_name?: string;
  surveyor_last_name?: string;
  /** งานที่ถูกปฏิเสธ — assigned_to ถูกล้างทิ้ง จึงต้องมีชุดนี้แยกถึงจะรู้ว่าใครไม่รับและทำไม */
  declined_first_name?: string;
  declined_last_name?: string;
  declined_code?: string;
  declined_reason?: string;
  /** ดึงงานกลับล่าสุด (ยังไม่จ่ายใหม่) — ดึงจากใคร โดยใคร เมื่อไร (case_dispatch_log migration 065) */
  recalled_first_name?: string | null;
  recalled_last_name?: string | null;
  recalled_code?: string | null;
  recalled_by_first_name?: string | null;
  recalled_by_last_name?: string | null;
  recalled_at?: string | null;
  claim_no?: string;
  survey_job_no?: string;
  claim_ref_no?: string;
  visit_count?: number;
  /** ยกเลิกงาน (23/09/69) — เหตุผล/คน/เวลา โชว์ใต้ป้าย "ยกเลิก" */
  cancel_reason?: string | null;
  cancelled_by_name?: string | null;
  cancelled_at?: string | null;
}

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: 'รอมอบหมาย',   color: 'text-gray-700',   bg: 'bg-gray-100' },
  assigned:  { label: 'มอบหมายแล้ว', color: 'text-orange-700', bg: 'bg-orange-100' },
  finished:  { label: 'เสร็จงานแล้ว', color: 'text-teal-700',   bg: 'bg-teal-100' },
  surveyed:  { label: 'สำรวจแล้ว',   color: 'text-blue-700',   bg: 'bg-blue-100' },
  reviewed:  { label: 'ตรวจสอบแล้ว', color: 'text-green-700',  bg: 'bg-green-100' },
  declined:  { label: 'ปฏิเสธแล้ว',  color: 'text-red-700',    bg: 'bg-red-100' },
  cancelled: { label: 'ยกเลิก',       color: 'text-red-800',    bg: 'bg-red-50' },   // ยกเลิกงาน (22/09/69)
};

export default function CallcenterDashboard() {
  const { user } = useAuth();
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [xmlBusyId, setXmlBusyId] = useState<number | null>(null);
  /** ข้อความหลัง "ดึงงานกลับ" — ต้องบอกว่าการ์ดบนเครื่องช่างถูกถอนหรือเปล่า */
  const [notice, setNotice] = useState('');

  // ดาวน์โหลดไฟล์ XML สำหรับ import เข้า EMCS — โชว์เฉพาะเคสที่สำรวจแล้ว
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

  // โหลดซ้ำหลังยกเลิกงานด้วย (23/09/69) — ตัวเลขการ์ดสถานะต้องลดตาม แถวต้องกลายเป็น "ยกเลิก" พร้อมเหตุผล
  const loadStats = useCallback(() => {
    api.get('/api/cases/stats')
      .then((res) => {
        if (res.data.success) {
          setCounts(res.data.data.counts);
          setRecent(res.data.data.recent);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { loadStats(); }, [loadStats]);

  const cards = [
    { key: 'pending',  label: 'รอมอบหมาย',   icon: '📋', gradient: 'from-gray-500 to-gray-600' },
    { key: 'assigned', label: 'มอบหมายแล้ว', icon: '🔄', gradient: 'from-orange-500 to-orange-600' },
    // เสร็จงานหน้างานแล้ว รอช่างส่งรายงาน (07/09/69) — ช่างกลุ่มนี้รับงานใหม่ได้แล้ว
    { key: 'finished', label: 'เสร็จงาน รอส่งรายงาน', icon: '🏁', gradient: 'from-teal-500 to-teal-600' },
    { key: 'surveyed', label: 'สำรวจแล้ว',   icon: '🔍', gradient: 'from-blue-500 to-blue-600' },
    { key: 'reviewed', label: 'ตรวจสอบแล้ว', icon: '✅', gradient: 'from-green-500 to-green-600' },
  ];

  const formatDate = (d: string) => {
    try {
      const dt = new Date(d);
      return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    } catch { return d; }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 mb-1">สวัสดี, {user?.first_name} {user?.last_name}</h1>
          <p className="text-gray-500 text-sm">ภาพรวมงานทั้งหมดในระบบ</p>
        </div>
        {!loading && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 px-5 py-3 flex items-center gap-3">
            <span className="text-gray-600 font-medium">งานทั้งหมดในระบบ</span>
            <span className="text-2xl font-bold text-gray-800">{counts.total ?? 0} <span className="text-sm font-normal text-gray-500">เคส</span></span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      ) : (
        <>
          {/* Stats cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            {cards.map((c) => (
              <div key={c.key} className={`bg-gradient-to-br ${c.gradient} rounded-xl p-5 text-white shadow-sm`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-2xl">{c.icon}</span>
                  <span className="text-3xl font-bold">{counts[c.key] ?? 0}</span>
                </div>
                <p className="text-sm opacity-90">{c.label}</p>
              </div>
            ))}
          </div>

          {/* Recent cases table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-800">เคสล่าสุด</h2>
            </div>
            {notice && (
              <div className="flex items-start justify-between gap-3 px-5 py-3 bg-amber-50 border-b border-amber-200 text-sm text-amber-900">
                <span>{notice}</span>
                <button onClick={() => setNotice('')} className="text-amber-700 hover:text-amber-900 text-xs font-medium">ปิด</button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-5 py-3 font-semibold text-gray-600">สถานะ</th>
                    <th className="px-5 py-3 font-semibold text-gray-600">เลขเคลม</th>
                    <th className="px-5 py-3 font-semibold text-gray-600">เลขเซอร์เวย์</th>
                    <th className="px-5 py-3 font-semibold text-gray-600">เลขรับแจ้ง</th>
                    <th className="px-5 py-3 font-semibold text-gray-600">ช่างสำรวจ</th>
                    <th className="px-5 py-3 font-semibold text-gray-600">ครั้งที่</th>
                    <th className="px-5 py-3 font-semibold text-gray-600">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((c) => {
                    const s = STATUS_MAP[c.status] || { label: c.status, color: 'text-gray-700', bg: 'bg-gray-100' };
                    // ช่างปฏิเสธ = กลับมาให้จ่ายใหม่ (หลังบ้านรับทั้ง pending/declined อยู่แล้ว · เดิมหน้านี้ไม่มีทางไปหน้ามอบหมาย เจอ 24/09/69)
                    const isPending = c.status === 'pending' || c.status === 'declined';
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
                        <td className="px-5 py-3 text-gray-600">
                          {c.surveyor_first_name ? (
                            `${c.surveyor_first_name} ${c.surveyor_last_name || ''}`
                          ) : c.declined_first_name ? (
                            /* ปฏิเสธแล้ว — ต้องเห็นว่า "ใคร" ไม่รับ ไม่งั้นจ่ายให้คนเดิมซ้ำโดยไม่รู้ตัว */
                            <span className="text-red-700">
                              {c.declined_code ? `${c.declined_code} ` : ''}
                              {c.declined_first_name} {c.declined_last_name || ''}
                              <span className="block text-xs text-gray-500">
                                ไม่รับงาน{c.declined_reason ? ` — ${c.declined_reason}` : ''}
                              </span>
                            </span>
                          ) : c.recalled_first_name ? (
                            /* ดึงงานกลับแล้ว (22/09/69) — ต้องเห็นว่าดึงจากใคร โดยใคร เมื่อไร ก่อนจ่ายซ้ำ (ประวัติทั้งสายอยู่หน้าจ่ายงาน) */
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
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                          {(c.status === 'surveyed' || c.status === 'reviewed') ? (
                            <button
                              onClick={() => handleXml(c)}
                              disabled={xmlBusyId !== null}
                              title="ดาวน์โหลดไฟล์ XML สำหรับ import เข้าพอร์ทัลประกัน (EMCS)"
                              className="px-2.5 py-1 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                            >
                              {xmlBusyId === c.id ? 'กำลังสร้าง...' : '⬇ XML'}
                            </button>
                          ) : isPending ? (
                            <Link
                              href={`/callcenter/cases/${c.id}/assign`}
                              onClick={(e) => e.stopPropagation()}
                              title={c.status === 'declined' ? 'ช่างคนเดิมไม่รับงาน — เลือกช่างคนใหม่' : 'มอบหมายช่างสำรวจให้เคสนี้'}
                              className="inline-block px-2.5 py-1 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors whitespace-nowrap"
                            >
                              {c.status === 'declined' ? 'มอบหมายใหม่' : 'มอบหมาย'}
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
                                setRecent((rows) => rows.map((x) => x.id === c.id
                                  ? { ...x, status: 'pending', surveyor_first_name: undefined, surveyor_last_name: undefined }
                                  : x));
                                setCounts((k) => ({ ...k, pending: Number(k.pending || 0) + 1, assigned: Math.max(0, Number(k.assigned || 0) - 1) }));
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
                                loadStats();
                              }}
                            />
                          )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {recent.length === 0 && (
                    <tr><td colSpan={7} className="px-5 py-8 text-center text-gray-400">ยังไม่มีเคส</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
