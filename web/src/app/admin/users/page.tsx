'use client';

/**
 * จัดการผู้ใช้ — บัญชีทุกบทบาท + ทะเบียนพนักงานสำรวจในหน้าเดียว
 *
 * 14/09/69 ยุบหน้า "ทะเบียนพนักงานสำรวจ" (/admin/staff) เข้ามาที่นี่ (user เคาะว่าซ้ำกัน):
 * เพิ่มคอลัมน์ รหัส · เบอร์โทร (แก้ในตารางได้) · หัวหน้า/ทีม และย้ายปุ่มนำเข้าไฟล์ Excel ของฝ่ายบุคคลมาไว้ด้านบน
 * ?role=surveyor = เปิดมาพร้อมกรองช่างสำรวจ (ลิงก์เก่าของหน้าทะเบียนเด้งมาแบบนี้)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import ResetPasswordDialog from './ResetPasswordDialog';
import StaffImportPanel, { fmtPhone } from '@/components/admin/StaffImportPanel';

interface User {
  id: number;
  username: string;
  code?: string | null;
  first_name: string;
  last_name: string;
  role: string;
  is_active: boolean;
  created_at: string;
  phone?: string | null;
  supervisor_id?: number | null;
  /** ชื่อหัวหน้าตามช่องเก่าของบัญชี (ซิงก์กับทีมแล้ว) — ใช้เมื่อยังไม่มีทีม */
  supervisor_name?: string | null;
  /** ทีมผู้ตรวจที่สังกัด (staff_groups) = ที่มาจริงของ "หัวหน้า" */
  staff_group_name?: string | null;
  // เวอร์ชันแอปล่าสุดที่เครื่องคนนี้ยิงเข้ามา (null = ยังไม่เคยเข้าจากแอปรุ่นที่ส่งเวอร์ชัน)
  app_version?: string | null;
  app_version_at?: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'ผู้ดูแลระบบ',
  surveyor: 'ช่างสำรวจ',
  callcenter: 'พนักงานรับแจ้ง',
  checker: 'ผู้ตรวจสอบ',
};

const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-100 text-red-800',
  surveyor: 'bg-blue-100 text-blue-800',
  callcenter: 'bg-green-100 text-green-800',
  checker: 'bg-purple-100 text-purple-800',
};

const ROLES = new Set(Object.keys(ROLE_LABELS));

export default function AdminUsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  // บทบาทเริ่มต้นอ่านจาก ?role= ตอนเปิดหน้า (ลิงก์เก่าของหน้าทะเบียนพนักงานสำรวจส่ง surveyor มา)
  const [roleFilter, setRoleFilter] = useState(() => {
    if (typeof window === 'undefined') return '';
    const r = new URLSearchParams(window.location.search).get('role') ?? '';
    return ROLES.has(r) ? r : '';
  });
  const [searchInput, setSearchInput] = useState(''); // ช่องพิมพ์ (debounce → search)
  const [search, setSearch] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  // ผู้ใช้ที่กำลังตั้งรหัสใหม่ให้ (null = ไม่ได้เปิดกล่อง)
  const [pwUser, setPwUser] = useState<User | null>(null);
  const reqSeq = useRef(0); // กัน response เก่าทับใหม่ (พิมพ์เร็ว → คำขอเก่ามาช้า)

  // แก้เบอร์ทีละคนในตาราง (ย้ายมาจากหน้าทะเบียน — เบอร์คือต้นทางของ "โทรศัพท์ผู้สำรวจภัย" ที่ระบบเติมให้เคส)
  const [editId, setEditId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const [msg, setMsg] = useState('');

  // debounce ช่องค้นหา → search (ลดจำนวนคำขอ)
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchUsers = useCallback(async () => {
    const seq = ++reqSeq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', '15');
      if (roleFilter) params.set('role', roleFilter);
      if (search) params.set('search', search);

      const res = await api.get(`/api/admin/users?${params}`);
      if (seq !== reqSeq.current) return; // มีคำขอใหม่กว่า → ทิ้งผลเก่า
      if (res.data.success) {
        setUsers(res.data.data.users);
        setTotal(res.data.data.total);
        setTotalPages(res.data.data.totalPages);
      }
    } catch {
      // handled
    } finally {
      if (seq === reqSeq.current) setLoading(false);
    }
  }, [page, roleFilter, search]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/api/admin/users/${id}`);
      setDeleteConfirm(null);
      fetchUsers();
    } catch {
      alert('ไม่สามารถปิดการใช้งานผู้ใช้ได้');
    }
  };

  const startEdit = (u: User) => { setEditId(u.id); setEditVal((u.phone || '').replace(/\D/g, '')); setMsg(''); };
  const savePhone = async (u: User) => {
    const digits = editVal.replace(/\D/g, '');
    if (digits && (digits.length < 9 || digits.length > 10)) {
      setMsg('ไม่สำเร็จ: เบอร์ต้องเป็นตัวเลข 9–10 หลัก (เช่น 0812345678)');
      return;
    }
    setSavingId(u.id);
    try {
      const res = await api.put(`/api/admin/users/${u.id}`, { phone: digits || null });
      const saved = (res.data?.data?.phone ?? digits ?? null) as string | null;
      setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, phone: saved } : x)));
      setMsg(digits ? `บันทึกเบอร์ของ ${u.code || ''} ${u.first_name} แล้ว (${fmtPhone(digits)})` : `ลบเบอร์ของ ${u.code || ''} ${u.first_name} แล้ว`);
      setEditId(null);
    } catch (e) {
      setMsg('ไม่สำเร็จ: ' + ((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'บันทึกเบอร์ไม่ได้'));
    } finally { setSavingId(null); }
  };

  const teamOf = (u: User) => u.staff_group_name || u.supervisor_name || '';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">จัดการผู้ใช้</h1>
          <p className="text-gray-500 text-sm mt-1">
            ทั้งหมด {total} คน · เบอร์โทรในตารางคือต้นทางของช่อง &quot;โทรศัพท์ผู้สำรวจภัย&quot; ที่ระบบเติมให้เคส
            · หัวหน้า/ทีม แก้ที่ปุ่ม &quot;แก้ไข&quot; หรือหน้า จัดการทีมผู้ตรวจ
          </p>
        </div>
        <Link href="/admin/users/new" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
          + เพิ่มผู้ใช้ใหม่
        </Link>
      </div>

      {/* นำเข้าจาก Excel ของฝ่ายบุคคล — พับไว้ ใช้ไม่บ่อย */}
      <details className="bg-white rounded-lg shadow-sm border border-gray-200 mb-4">
        <summary className="px-4 py-3 text-sm font-medium text-gray-700 cursor-pointer select-none">
          นำเข้าทะเบียนพนักงานสำรวจจากไฟล์ Excel ของฝ่ายบุคคล (เติมเบอร์ · แก้ชื่อ · ย้ายเข้าทีมหัวหน้า · สร้างบัญชี · ปิดคนที่ออก)
        </summary>
        <div className="px-4 pb-4">
          <StaffImportPanel onApplied={fetchUsers} />
        </div>
      </details>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 flex flex-wrap gap-4">
        <input
          type="text"
          placeholder="ค้นหาชื่อ, username, รหัส..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none flex-1 min-w-[200px]"
        />
        <select
          value={roleFilter}
          onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none"
        >
          <option value="">ทุกบทบาท</option>
          <option value="admin">ผู้ดูแลระบบ</option>
          <option value="surveyor">ช่างสำรวจ</option>
          <option value="callcenter">พนักงานรับแจ้ง</option>
          <option value="checker">ผู้ตรวจสอบ</option>
        </select>
      </div>

      {msg && (
        <div className={`rounded px-4 py-2 text-sm mb-4 ${msg.startsWith('ไม่สำเร็จ')
          ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>{msg}</div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-x-auto border border-gray-200">
        {loading ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div></div>
        ) : users.length === 0 ? (
          <div className="text-center text-gray-500 py-12">ไม่พบผู้ใช้</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">รหัส</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">Username</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">ชื่อ-สกุล</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">บทบาท</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">เบอร์โทร</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">หัวหน้า/ทีม</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">สถานะ</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">เวอร์ชันแอป</th>
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase">วันที่สร้าง</th>
                <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">จัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-3 py-3 text-sm font-medium text-gray-900">#{u.id}</td>
                  <td className="px-3 py-3 text-sm font-mono text-gray-700">{u.code || '—'}</td>
                  <td className="px-3 py-3 text-sm text-gray-700">{u.username}</td>
                  <td className="px-3 py-3 text-sm text-gray-700 whitespace-nowrap">{u.first_name} {u.last_name}</td>
                  <td className="px-3 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[u.role] || 'bg-gray-100 text-gray-800'}`}>
                      {ROLE_LABELS[u.role] || u.role}
                    </span>
                  </td>
                  {/* เบอร์: ช่างที่ยังไม่มีเบอร์ขึ้นแดง (EMCS บังคับช่องโทรศัพท์ผู้สำรวจภัย) */}
                  <td className={`px-3 py-3 text-sm whitespace-nowrap ${(u.phone || '').trim() ? 'text-gray-800' : (u.role === 'surveyor' ? 'text-red-600' : 'text-gray-400')}`}>
                    {editId === u.id ? (
                      <span className="inline-flex items-center gap-1">
                        <input type="tel" value={editVal} autoFocus disabled={savingId === u.id}
                          onChange={(e) => setEditVal(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void savePhone(u); } if (e.key === 'Escape') setEditId(null); }}
                          placeholder="0812345678"
                          className="w-32 border border-blue-400 rounded px-2 py-0.5 text-sm text-gray-800 bg-white" />
                        <button type="button" onClick={() => void savePhone(u)} disabled={savingId === u.id}
                          className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded disabled:opacity-50">บันทึก</button>
                        <button type="button" onClick={() => setEditId(null)} disabled={savingId === u.id}
                          className="px-2 py-0.5 text-xs border border-gray-300 rounded text-gray-600">ยกเลิก</button>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span>{fmtPhone(u.phone)}</span>
                        <button type="button" onClick={() => startEdit(u)} title="แก้เบอร์"
                          className="px-1.5 py-0.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100">แก้</button>
                      </span>
                    )}
                  </td>
                  {/* หัวหน้า/ทีม: ทีมผู้ตรวจที่สังกัด — ช่างที่ยังไม่มีทีมขึ้นเหลือง (งานจะไม่โผล่ให้หัวหน้าคนไหน) */}
                  <td className="px-3 py-3 text-sm whitespace-nowrap">
                    {u.role === 'surveyor'
                      ? (teamOf(u)
                          ? <span className="text-gray-700">{teamOf(u)}</span>
                          : <span className="text-amber-700" title="ยังไม่มีหัวหน้ากำกับ — งานจะไม่โผล่ให้หัวหน้าคนไหน">ยังไม่มีทีม</span>)
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {u.is_active ? 'ใช้งาน' : 'ปิดใช้งาน'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-sm">
                    {u.app_version ? (
                      <span className="text-gray-700" title={u.app_version_at ? `เข้าใช้ล่าสุด ${u.app_version_at}` : undefined}>
                        {u.app_version}
                      </span>
                    ) : (
                      // ไม่เคยส่งเวอร์ชันมา = ยังใช้ APK รุ่นก่อนที่จะเริ่มส่ง (หรือไม่เคยเข้าจากแอป)
                      <span className="text-amber-700" title="ยังไม่เคยเข้าใช้จากแอปรุ่นที่รายงานเวอร์ชัน — น่าจะยังไม่ได้อัป APK">
                        ไม่ทราบ
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {new Date(u.created_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={`/admin/users/${u.id}/edit`} className="px-3 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors">
                        แก้ไข
                      </Link>
                      <button onClick={() => setPwUser(u)} title="ตั้งรหัสผ่านใหม่ให้ผู้ใช้คนนี้"
                        className="px-3 py-1 text-xs bg-slate-600 text-white rounded hover:bg-slate-700 transition-colors">
                        รหัสผ่าน
                      </button>
                      {deleteConfirm === u.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => handleDelete(u.id)} className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">
                            ยืนยัน
                          </button>
                          <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1 text-xs bg-gray-300 text-gray-700 rounded hover:bg-gray-400">
                            ยกเลิก
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setDeleteConfirm(u.id)} className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors">
                          ปิดใช้งาน
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {pwUser && <ResetPasswordDialog user={pwUser} onClose={() => setPwUser(null)} />}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-100 text-gray-700">
            ก่อนหน้า
          </button>
          <span className="text-sm text-gray-600">หน้า {page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-100 text-gray-700">
            ถัดไป
          </button>
        </div>
      )}
    </div>
  );
}
