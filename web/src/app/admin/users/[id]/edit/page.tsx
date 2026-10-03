'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import { phoneDigits, phoneError } from '@/lib/phone';

export default function EditUserPage() {
  const router = useRouter();
  const params = useParams();
  const userId = params.id;

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    code: '',
    phone: '',
    role: '',
    is_active: true,
    password: '',
    staff_group_id: '',
  });
  const [groups, setGroups] = useState<{ id: number; name: string; checker_username?: string | null }[]>([]);
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get(`/api/admin/users/${userId}`)
      .then((res) => {
        if (res.data.success) {
          const u = res.data.data;
          setUsername(u.username);
          setForm({
            first_name: u.first_name,
            last_name: u.last_name,
            code: u.code || '',
            phone: u.phone || '',
            role: u.role,
            is_active: u.is_active,
            password: '',
            staff_group_id: u.staff_group_id ? String(u.staff_group_id) : '',
          });
        }
      })
      .catch(() => setError('ไม่พบผู้ใช้'))
      .finally(() => setLoading(false));
    api.get('/api/staff-groups').then((r) => setGroups(r.data?.data ?? [])).catch(() => setGroups([]));
  }, [userId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const badPhone = phoneError(form.phone);
    if (badPhone) { setError(badPhone); return; }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        first_name: form.first_name,
        last_name: form.last_name,
        code: form.code.trim() || null,
        phone: phoneDigits(form.phone) || null,   // ตัวเลขล้วน · ลบช่องให้ว่าง = ลบเบอร์
        role: form.role,
        is_active: form.is_active,
      };
      if (form.password) payload.password = form.password;
      // ทีม/หัวหน้า — ส่งเฉพาะช่าง (null = เอาออกจากทีม)
      if (form.role === 'surveyor') payload.staff_group_id = form.staff_group_id ? Number(form.staff_group_id) : null;

      const res = await api.put(`/api/admin/users/${userId}`, payload);
      if (res.data.success) {
        router.push('/admin/users');
      } else {
        setError(res.data.message || 'ไม่สามารถอัพเดทได้');
      }
    } catch {
      setError('เกิดข้อผิดพลาด กรุณาลองใหม่');
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
        <Link href="/admin/users" className="text-blue-600 hover:underline text-sm">&larr; กลับไปรายการผู้ใช้</Link>
        <h1 className="text-2xl font-bold text-gray-800 mt-2">แก้ไขผู้ใช้: {username}</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

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
            <label className="block text-sm font-medium text-gray-700 mb-1">รหัส SE <span className="text-gray-400 font-normal">(เลขในตารางเวร — ใช้จับคู่การลงเวลากับเวร/จุด)</span></label>
            <input type="text" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="เช่น SE 468 หรือ 468" className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900" />
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
              <label className="block text-sm font-medium text-gray-700 mb-1">หัวหน้า/ทีมที่สังกัด <span className="text-gray-400 font-normal">— ว่าง = ยังไม่มีหัวหน้ากำกับ งานจะไม่โผล่ให้หัวหน้าคนไหน</span></label>
              <select value={form.staff_group_id} onChange={(e) => setForm({ ...form, staff_group_id: e.target.value })}
                className={`w-full px-4 py-2.5 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900 ${form.staff_group_id ? 'border-gray-300' : 'border-amber-400 bg-amber-50'}`}>
                <option value="">— ยังไม่มีหัวหน้า —</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.checker_username ? '' : ' (ยังไม่มีบัญชีผู้ตรวจ)'}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">รหัสผ่านใหม่ (เว้นว่างถ้าไม่ต้องการเปลี่ยน)</label>
            {/* new-password: กันเบราว์เซอร์เติมรหัสที่จำไว้ของคนที่ล็อกอินอยู่ แล้วกดบันทึกเปลี่ยนรหัสช่างโดยไม่รู้ตัว */}
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-gray-900" minLength={8} />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="is_active" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500" />
            <label htmlFor="is_active" className="text-sm font-medium text-gray-700">เปิดใช้งาน</label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Link href="/admin/users" className="px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 text-sm font-medium">
              ยกเลิก
            </Link>
            <button type="submit" disabled={submitting} className="px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm">
              {submitting ? 'กำลังบันทึก...' : 'บันทึกการเปลี่ยนแปลง'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
