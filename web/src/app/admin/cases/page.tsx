'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { downloadCaseXml } from '@/lib/downloadXml';

interface Case {
  id: number;
  customer_name: string;
  incident_location: string;
  claim_no?: string | null;
  survey_job_no?: string | null;
  status: string;
  surveyor_first_name?: string;
  surveyor_last_name?: string;
  creator_first_name?: string;
  creator_last_name?: string;
  created_at: string;
}

const STATUS_LABELS: Record<string, string> = { pending: 'รอดำเนินการ', assigned: 'มอบหมายแล้ว', finished: 'เสร็จงานแล้ว', surveyed: 'สำรวจแล้ว', reviewed: 'ตรวจสอบแล้ว', declined: 'ปฏิเสธแล้ว', cancelled: 'ยกเลิก' };
const STATUS_COLORS: Record<string, string> = { pending: 'bg-gray-100 text-gray-800', assigned: 'bg-blue-100 text-blue-800', surveyed: 'bg-yellow-100 text-yellow-800', reviewed: 'bg-green-100 text-green-800', declined: 'bg-red-100 text-red-800', cancelled: 'bg-red-50 text-red-800' };

export default function AdminCasesPage() {
  const [cases, setCases] = useState<Case[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState(''); // ช่องพิมพ์ (debounce → search)
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [xmlBusyId, setXmlBusyId] = useState<number | null>(null);
  const reqSeq = useRef(0); // กัน response เก่าทับใหม่ (พิมพ์เร็ว → คำขอเก่ามาช้า)

  // ดาวน์โหลดไฟล์ XML สำหรับ import เข้า EMCS — โชว์เฉพาะเคสที่สำรวจแล้ว
  const handleXml = async (id: number) => {
    if (xmlBusyId !== null) return;
    setXmlBusyId(id);
    try {
      await downloadCaseXml(id);
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
      params.set('limit', '15');
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);

      const res = await api.get(`/api/admin/cases?${params}`);
      if (seq !== reqSeq.current) return; // มีคำขอใหม่กว่า → ทิ้งผลเก่า
      if (res.data.success) {
        setCases(res.data.data.cases);
        setTotal(res.data.data.total);
        setTotalPages(res.data.data.totalPages);
      }
    } catch {
      // handled
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/api/admin/cases/${id}`);
      setDeleteConfirm(null);
      fetchCases();
    } catch {
      alert('ไม่สามารถลบเคสได้');
    }
  };

  const formatDate = (d: string) => d ? new Date(d).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) : '-';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">จัดการเคส</h1>
          <p className="text-gray-500 text-sm mt-1">ทั้งหมด {total} เคส · กดลบ = พักไว้ในถังขยะ 30 วัน กู้คืนได้</p>
        </div>
        <Link href="/admin/cases/trash" className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm">🗑 ถังขยะ</Link>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 flex flex-wrap gap-4">
        <input
          type="text"
          placeholder="ค้นหาชื่อลูกค้า, สถานที่, เลขเคลม, เลขเซอร์เวย์..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none flex-1 min-w-[200px]"
        />
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">ทุกสถานะ</option>
          <option value="pending">รอดำเนินการ</option>
          <option value="assigned">มอบหมายแล้ว</option>
          <option value="finished">เสร็จงานแล้ว (รอส่งรายงาน)</option>
          <option value="surveyed">สำรวจแล้ว</option>
          <option value="cancelled">ยกเลิก</option>
          <option value="reviewed">ตรวจสอบแล้ว</option>
          <option value="declined">ปฏิเสธแล้ว</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-gray-200">
        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
        ) : cases.length === 0 ? (
          <div className="text-center text-gray-500 py-12">ไม่พบเคส</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">เลขเคลม / เลขเซอร์เวย์</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ชื่อลูกค้า</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">สถานที่</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">สถานะ</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ช่างสำรวจ</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">วันที่</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {cases.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">#{c.id}</td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    <div className="font-mono text-gray-800">{c.claim_no || '-'}</div>
                    <div className="font-mono text-xs text-gray-500">{c.survey_job_no || '-'}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">{c.customer_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 max-w-[200px] truncate">{c.incident_location || '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] || 'bg-gray-100 text-gray-800'}`}>
                      {STATUS_LABELS[c.status] || c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {c.surveyor_first_name ? `${c.surveyor_first_name} ${c.surveyor_last_name}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{formatDate(c.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {(c.status === 'surveyed' || c.status === 'reviewed') && (
                        <button
                          onClick={() => handleXml(c.id)}
                          disabled={xmlBusyId !== null}
                          title="ดาวน์โหลดไฟล์ XML สำหรับ import เข้าพอร์ทัลประกัน (EMCS)"
                          className="px-3 py-1 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                        >
                          {xmlBusyId === c.id ? 'กำลังสร้าง...' : 'XML'}
                        </button>
                      )}
                      {/* หน้าตรวจเคส (23/09/69) — แอดมินเข้าได้แบบอ่านอย่างเดียว: เลิกยกเลิก · ปลดล็อก · แก้เลขระบุเคส · ยกเลิกงาน */}
                      <Link href={`/inspector/cases/${c.id}`}
                        title="เปิดหน้าตรวจเคส — เลิกยกเลิก / ปลดล็อก / แก้เลขระบุเคส / ยกเลิกงาน"
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors whitespace-nowrap">
                        เปิดหน้าเคส
                      </Link>
                      <Link href={`/admin/cases/${c.id}/edit`} className="px-3 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors">
                        แก้ไข
                      </Link>
                      {deleteConfirm === c.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => handleDelete(c.id)} className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">ยืนยัน</button>
                          <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400">ยกเลิก</button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirm(c.id)} title="พักไว้ในถังขยะ 30 วัน กู้คืนได้ที่หน้าถังขยะ"
                          className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors">ลบ</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
