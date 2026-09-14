'use client';

/**
 * ถังขยะเคส — เคสที่แอดมินกดลบจะพักไว้ที่นี่ (ข้อมูล + รูปยังอยู่) กู้คืนได้ปุ่มเดียว
 * ลบจริงเองเมื่อพักครบ 30 วัน หรือกด "ลบถาวร" (ยืนยัน 2 ชั้น) — user สั่ง 14/09/69 หลังเคส #226 ถูกลบจริงแล้วกู้ไม่ได้
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

type TrashRow = {
  id: number; status: string; source: string | null; customer_name: string | null; visit_no: number | null;
  claim_no: string | null; survey_job_no: string | null; insurance_company: string | null;
  deleted_at_th: string | null; deleted_by_name: string | null; days_left: number; photo_count: number;
};

const STATUS_TH: Record<string, string> = {
  pending: 'รอจ่ายงาน', assigned: 'มอบหมายแล้ว', finished: 'เสร็จงาน', surveyed: 'รอตรวจ', reviewed: 'อนุมัติแล้ว', declined: 'ปฏิเสธ',
};

export default function AdminCaseTrashPage() {
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [purgeConfirm, setPurgeConfirm] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/admin/cases/trash');
      setRows((r.data?.data?.cases ?? []) as TrashRow[]);
      setDays(Number(r.data?.data?.days ?? 30));
    } catch {
      setMsg('ไม่สำเร็จ: โหลดถังขยะไม่ได้');
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const restore = async (r: TrashRow) => {
    setBusy(r.id); setMsg('');
    try {
      await api.post(`/api/admin/cases/${r.id}/restore`);
      setMsg(`กู้คืนเคส #${r.id} แล้ว — กลับไปอยู่ในรายการงานตามสถานะเดิม (${STATUS_TH[r.status] ?? r.status})`);
      await load();
    } catch (e) {
      setMsg('ไม่สำเร็จ: ' + ((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'กู้คืนไม่ได้'));
    } finally { setBusy(null); }
  };

  const purge = async (r: TrashRow) => {
    setBusy(r.id); setMsg(''); setPurgeConfirm(null);
    try {
      await api.delete(`/api/admin/cases/${r.id}/purge`);
      setMsg(`ลบเคส #${r.id} ถาวรแล้ว (ข้อมูลและรูปถูกลบ กู้ไม่ได้)`);
      await load();
    } catch (e) {
      setMsg('ไม่สำเร็จ: ' + ((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'ลบถาวรไม่ได้'));
    } finally { setBusy(null); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">ถังขยะเคส</h1>
          <p className="text-gray-500 text-sm mt-1">
            เคสที่กดลบจะพักไว้ที่นี่ {days} วัน (ข้อมูลและรูปยังอยู่ กู้คืนได้) ครบกำหนดระบบลบจริงให้เอง · ทั้งหมด {rows.length} เคส
          </p>
        </div>
        <Link href="/admin/cases" className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm">← กลับไปจัดการเคส</Link>
      </div>

      {msg && (
        <div className={`rounded px-4 py-2 text-sm mb-4 ${msg.startsWith('ไม่สำเร็จ')
          ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>{msg}</div>
      )}

      <div className="bg-white rounded-lg shadow-sm overflow-x-auto border border-gray-200">
        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
        ) : rows.length === 0 ? (
          <div className="text-center text-gray-500 py-12">ถังขยะว่าง</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['#', 'เลขเคลม', 'เลขเซอร์เวย์', 'ลูกค้า', 'สถานะตอนลบ', 'รูป', 'ลบเมื่อ · โดย', 'เหลือ', ''].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-3 py-3 font-medium text-gray-900">#{r.id}{r.visit_no && r.visit_no > 1 ? <span className="ml-1 text-xs text-gray-500">ครั้งที่ {r.visit_no}</span> : null}</td>
                  <td className="px-3 py-3 font-mono text-gray-700">{r.claim_no || '—'}</td>
                  <td className="px-3 py-3 font-mono text-gray-700">{r.survey_job_no || '—'}</td>
                  <td className="px-3 py-3 text-gray-700">{r.customer_name || '—'}</td>
                  <td className="px-3 py-3 text-gray-700">{STATUS_TH[r.status] ?? r.status}</td>
                  <td className="px-3 py-3 text-gray-700">{r.photo_count}</td>
                  <td className="px-3 py-3 text-gray-600 whitespace-nowrap">{r.deleted_at_th || '—'}{r.deleted_by_name ? ` · ${r.deleted_by_name}` : ''}</td>
                  <td className={`px-3 py-3 whitespace-nowrap ${r.days_left <= 3 ? 'text-red-600 font-medium' : 'text-gray-700'}`}>{r.days_left} วัน</td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => void restore(r)} disabled={busy === r.id}
                        className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">กู้คืน</button>
                      {purgeConfirm === r.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => void purge(r)} disabled={busy === r.id}
                            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">ยืนยันลบถาวร</button>
                          <button onClick={() => setPurgeConfirm(null)} className="px-3 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400">ยกเลิก</button>
                        </div>
                      ) : (
                        <button onClick={() => setPurgeConfirm(r.id)} disabled={busy === r.id} title="ลบข้อมูลและรูปทิ้งจริง กู้ไม่ได้"
                          className="px-3 py-1 text-xs border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50">ลบถาวร</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
