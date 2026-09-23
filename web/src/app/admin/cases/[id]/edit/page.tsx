'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';

export default function EditCasePage() {
  const router = useRouter();
  const params = useParams();
  const caseId = params.id;

  const [form, setForm] = useState({
    customer_name: '',
    incident_location: '',
    status: '',
    assigned_to: '' as string | number,
  });
  const [surveyors, setSurveyors] = useState<{ id: number; first_name: string; last_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get(`/api/admin/cases/${caseId}`),
      api.get('/api/admin/users?role=surveyor&limit=100'),
    ])
      .then(([caseRes, usersRes]) => {
        if (caseRes.data.success) {
          const c = caseRes.data.data.case;
          setForm({
            customer_name: c.customer_name,
            incident_location: c.incident_location || '',
            status: c.status,
            assigned_to: c.assigned_to || '',
          });
        }
        if (usersRes.data.success) {
          setSurveyors(usersRes.data.data.users);
        }
      })
      .catch(() => setError('ไม่พบเคส'))
      .finally(() => setLoading(false));
  }, [caseId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        customer_name: form.customer_name,
        incident_location: form.incident_location,
        status: form.status,
      };
      if (form.assigned_to) {
        payload.assigned_to = Number(form.assigned_to);
      } else {
        payload.assigned_to = null;
      }

      const res = await api.put(`/api/admin/cases/${caseId}`, payload);
      if (res.data.success) {
        router.push('/admin/cases');
      } else {
        setError(res.data.message || 'ไม่สามารถอัพเดทได้');
      }
    } catch (err) {
      // backend บอกเหตุผลเป็นภาษาคน (เช่น เคสยกเลิกอยู่ต้องใช้ปุ่มเลิกยกเลิก) — ส่งต่อให้เห็น
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div></div>;
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/admin/cases" className="text-blue-600 hover:underline text-sm">&larr; กลับไปรายการเคส</Link>
        <h1 className="text-2xl font-bold text-gray-800 mt-2">แก้ไขเคส #{caseId}</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อลูกค้า</label>
            <input type="text" value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">สถานที่เกิดเหตุ</label>
            <input type="text" value={form.incident_location} onChange={(e) => setForm({ ...form, incident_location: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">สถานะ</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
              disabled={form.status === 'cancelled'}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 disabled:bg-gray-100">
              <option value="pending">รอดำเนินการ</option>
              <option value="assigned">มอบหมายแล้ว</option>
              <option value="finished">เสร็จงานแล้ว (รอส่งรายงาน)</option>
              <option value="surveyed">สำรวจแล้ว</option>
              <option value="reviewed">ตรวจสอบแล้ว</option>
              <option value="declined">ปฏิเสธแล้ว</option>
              {/* ยกเลิกงาน (23/09/69): มีไว้แสดงค่าปัจจุบันเท่านั้น — เข้า/ออกจากสถานะนี้ต้องใช้ปุ่มที่หน้าเคส
                  (เก็บเหตุผล · ถอน/คืนการ์ดงานบนเครื่องช่าง) backend ปฏิเสธถ้าเปลี่ยนตรงนี้ */}
              <option value="cancelled" disabled>ยกเลิก</option>
            </select>
            {form.status === 'cancelled' && (
              <p className="mt-1 text-xs text-red-700">
                เคสนี้ยกเลิกอยู่ — คืนสถานะด้วยปุ่ม &quot;เลิกยกเลิก&quot; ที่{' '}
                <Link href={`/inspector/cases/${caseId}`} className="underline">หน้าเคส</Link>
                {' '}ระบบจะคืนสถานะเดิมและส่งการ์ดงานคืนช่างให้
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ช่างสำรวจ</label>
            <select value={form.assigned_to} onChange={(e) => setForm({ ...form, assigned_to: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900">
              <option value="">ไม่ระบุ</option>
              {surveyors.map((s) => (
                <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Link href="/admin/cases" className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm font-medium">ยกเลิก</Link>
            <button type="submit" disabled={submitting} className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm">
              {submitting ? 'กำลังบันทึก...' : 'บันทึกการเปลี่ยนแปลง'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
