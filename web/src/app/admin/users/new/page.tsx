'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import { phoneDigits, phoneError } from '@/lib/phone';

export default function NewUserPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    username: '',
    code: '',
    password: '',
    first_name: '',
    last_name: '',
    phone: '',
    role: 'surveyor',
    staff_group_id: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // ทีม/หัวหน้า (staff_groups) — ช่างใหม่ต้องเลือกตั้งแต่ตอนสร้าง (04/09/69) ไม่ให้มีช่างที่ไม่มีหัวหน้ากำกับ
  const [groups, setGroups] = useState<{ id: number; name: string; checker_username?: string | null }[]>([]);
  useEffect(() => {
    api.get('/api/staff-groups').then((r) => setGroups(r.data?.data ?? [])).catch(() => setGroups([]));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const badPhone = phoneError(form.phone);
    if (badPhone) { setError(badPhone); return; }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        phone: phoneDigits(form.phone) || undefined,   // เก็บตัวเลขล้วน ('096-9829655' → '0969829655') · ว่าง = ไม่ส่ง
        staff_group_id: form.role === 'surveyor' && form.staff_group_id ? Number(form.staff_group_id) : undefined,
      };
      const res = await api.post('/api/admin/users', payload);
      if (res.data.success) {
        router.push('/admin/users');
      } else {
        setError(res.data.message || 'ไม่สามารถสร้างผู้ใช้ได้');
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <Link href="/admin/users" className="text-blue-600 hover:underline text-sm">&larr; กลับไปรายการผู้ใช้</Link>
        <h1 className="text-2xl font-bold text-gray-800 mt-2">เพิ่มผู้ใช้ใหม่</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            {/* autoComplete: กันเบราว์เซอร์เติม username/รหัสผ่านที่จำไว้ของคนที่ล็อกอินอยู่ (เช่น admin01) ลงบัญชีใหม่ — เจอ 03/10/69 */}
            <input type="text" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900" required />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รหัสพนักงาน (SE) <span className="text-gray-400 font-normal">— เลขในตารางเวร ใช้จับคู่การลงเวลา (จะใช้เป็น username ก็ได้)</span></label>
            <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="เช่น SE315" className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รหัสผ่าน</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900" minLength={8} required />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ</label>
              <input type="text" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900" required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">นามสกุล</label>
              <input type="text" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900" required />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เบอร์โทร <span className="text-gray-400 font-normal">— ใส่ขีดได้ · แอปมือถือเติมช่อง &quot;โทรศัพท์สำรวจ&quot; ให้จากเบอร์นี้</span></label>
            <input type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="เช่น 081-234-5678" autoComplete="off" maxLength={20}
              className={`w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 ${form.role === 'surveyor' && !phoneDigits(form.phone) ? 'border-amber-400 bg-amber-50' : 'border-gray-300'}`} />
            {form.role === 'surveyor' && !phoneDigits(form.phone) && <p className="text-xs text-amber-700 mt-1">ช่างที่ไม่มีเบอร์ต้องพิมพ์เบอร์เองทุกงานในแอป (EMCS บังคับช่องนี้)</p>}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">บทบาท</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900">
              <option value="admin">ผู้ดูแลระบบ</option>
              <option value="surveyor">ช่างสำรวจ</option>
              <option value="callcenter">พนักงานรับแจ้ง</option>
              <option value="checker">ผู้ตรวจสอบ</option>
            </select>
          </div>

          {form.role === 'surveyor' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">หัวหน้า/ทีมที่สังกัด <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">— หน้ารายการงานของหัวหน้าทีมนี้จะเห็นงานของช่างคนนี้</span></label>
              <select value={form.staff_group_id} onChange={(e) => setForm({ ...form, staff_group_id: e.target.value })} required
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900">
                <option value="">— เลือกหัวหน้า —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.checker_username ? '' : ' (ยังไม่มีบัญชีผู้ตรวจ)'}</option>)}
              </select>
              {groups.length === 0 && <p className="text-xs text-amber-700 mt-1">ยังไม่มีทีมในระบบ — สร้างที่เมนู &quot;จัดการทีมผู้ตรวจ&quot; ก่อน</p>}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Link href="/admin/users" className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm font-medium">
              ยกเลิก
            </Link>
            <button type="submit" disabled={submitting} className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm">
              {submitting ? 'กำลังสร้าง...' : 'สร้างผู้ใช้'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
