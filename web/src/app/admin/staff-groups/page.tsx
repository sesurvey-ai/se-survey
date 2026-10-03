'use client';

/**
 * จัดการทีมผู้ตรวจ (แอดมิน) — หัวหน้า ↔ ช่าง/บริษัท OSS ในสังกัด (04/09/69)
 *
 * ที่มาเริ่มต้นนำเข้าจากไฟล์ mapping ของ se-billing · ใช้กรอง "งานรอตรวจ (ISURVEY)" ให้หัวหน้าเห็นเฉพาะงานลูกทีม
 * เพิ่มสมาชิกด้วยข้อความเต็มแบบเดียวกับ ISURVEY ("SEC343 นาย มี วงษ์สุวรรณ") หรือชื่อบริษัท OSS — รหัสแยกให้เอง
 */
import React, { useCallback, useEffect, useState } from 'react';
import api from '@/lib/api';

type Member = { id: number; staff_name: string; staff_code: string | null; surveyor_id: number | null; surveyor_name?: string | null; surveyor_active?: boolean | null };
type Group = { id: number; name: string; checker_id: number | null; checker_name?: string | null; checker_username?: string | null; member_count?: number; members?: Member[];
  /** เห็นงานไทยไพบูลย์ทั้งหมดในหน้ารายการงาน โดยไม่ต้องย้ายช่าง (03/10/69 — ทีมสราวุธ) */
  sees_thaipaiboon?: boolean };
type Checker = { id: number; username: string; first_name: string; last_name: string; role: string; is_active: boolean };

const errMsg = (e: unknown) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || (e as Error)?.message || 'เกิดข้อผิดพลาด';

export default function StaffGroupsAdminPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [checkers, setCheckers] = useState<Checker[]>([]);
  const [sel, setSel] = useState<Group | null>(null);
  const [newName, setNewName] = useState('');
  const [newMember, setNewMember] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadGroups = useCallback(async (keepId?: number) => {
    const r = await api.get('/api/staff-groups');
    const gs = (r.data?.data ?? []) as Group[];
    setGroups(gs);
    if (keepId) {
      const d = await api.get(`/api/staff-groups/${keepId}`);
      setSel(d.data?.data as Group);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadGroups();
        // บัญชีผู้ตรวจ/แอดมินสำหรับผูกทีม — ดึงจากรายการผู้ใช้ (หน้าละ 100 พอสำหรับตอนนี้)
        const [ck, ad] = await Promise.all([
          api.get('/api/admin/users', { params: { role: 'checker', is_active: 'true', limit: 100 } }),
          api.get('/api/admin/users', { params: { role: 'admin', is_active: 'true', limit: 100 } }),
        ]);
        const pick = (r: { data?: { data?: { users?: Checker[] } | Checker[] } }) => {
          const d = r.data?.data as { users?: Checker[] } | Checker[] | undefined;
          return Array.isArray(d) ? d : (d?.users ?? []);
        };
        setCheckers([...pick(ck), ...pick(ad)]);
      } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    })();
  }, [loadGroups]);

  const open = async (g: Group) => {
    setMsg(null);
    try { const d = await api.get(`/api/staff-groups/${g.id}`); setSel(d.data?.data as Group); }
    catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  };

  const run = async (fn: () => Promise<void>, okText: string) => {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: okText }); }
    catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    finally { setBusy(false); }
  };

  const createGroup = () => run(async () => {
    const r = await api.post('/api/staff-groups', { name: newName });
    setNewName(''); await loadGroups((r.data?.data as Group).id);
  }, 'สร้างทีมแล้ว');

  const linkChecker = (checkerId: number | null) => sel && run(async () => {
    await api.put(`/api/staff-groups/${sel.id}`, { checker_id: checkerId });
    await loadGroups(sel.id);
  }, checkerId ? 'ผูกบัญชีผู้ตรวจแล้ว' : 'ยกเลิกการผูกบัญชีแล้ว');

  const setThaiPaiboon = (on: boolean) => sel && run(async () => {
    await api.put(`/api/staff-groups/${sel.id}`, { sees_thaipaiboon: on });
    await loadGroups(sel.id);
  }, on ? 'ทีมนี้เห็นงานไทยไพบูลย์ทั้งหมดแล้ว' : 'เลิกให้ทีมนี้เห็นงานไทยไพบูลย์ทั้งหมดแล้ว');

  const addMember = () => sel && run(async () => {
    await api.post(`/api/staff-groups/${sel.id}/members`, { staff_name: newMember });
    setNewMember(''); await loadGroups(sel.id);
  }, 'เพิ่มสมาชิกแล้ว');

  const removeMember = (m: Member) => sel && window.confirm(`เอา "${m.staff_name}" ออกจากทีม ${sel.name}?`) && run(async () => {
    await api.delete(`/api/staff-groups/${sel.id}/members/${m.id}`);
    await loadGroups(sel.id);
  }, 'ลบสมาชิกแล้ว');

  const removeGroup = () => sel && window.confirm(`ลบทีม "${sel.name}" ทั้งทีม (สมาชิก ${sel.members?.length ?? 0})?`) && run(async () => {
    await api.delete(`/api/staff-groups/${sel.id}`);
    setSel(null); await loadGroups();
  }, 'ลบทีมแล้ว');

  return (
    <div className="max-w-6xl">
      <h1 className="text-xl font-bold text-gray-800 mb-1">จัดการทีมผู้ตรวจ</h1>
      <p className="text-sm text-gray-600 mb-4">
        หัวหน้าแต่ละคนดูแลช่าง/บริษัท OSS ชุดไหน — ใช้กรองหน้า &quot;งานรอตรวจ (ISURVEY)&quot; ให้เห็นเฉพาะงานลูกทีม · หัวหน้าดูได้เอง แก้ได้ที่นี่เท่านั้น
      </p>
      {msg && <div className={`mb-3 text-sm px-3 py-2 border ${msg.ok ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>{msg.text}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200">
          <div className="px-3 py-2 border-b border-gray-200 text-sm font-semibold text-gray-700">ทีม ({groups.length})</div>
          <ul>
            {groups.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => open(g)}
                  className={`w-full text-left px-3 py-2 text-sm border-b border-gray-100 hover:bg-gray-50 ${sel?.id === g.id ? 'bg-blue-50' : ''}`}>
                  <div className="font-medium text-gray-800">{g.name}</div>
                  <div className="text-xs text-gray-500">
                    สมาชิก {g.member_count ?? 0} · {g.checker_username ? `บัญชี ${g.checker_username}` : <span className="text-amber-700">ยังไม่ผูกบัญชี</span>}
                    {g.sees_thaipaiboon ? ' · เห็นงานไทยไพบูลย์ทั้งหมด' : ''}
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="p-3 border-t border-gray-200 flex gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ชื่อหัวหน้า/ทีมใหม่"
              className="flex-1 border border-gray-300 px-2 py-1 text-sm" />
            <button type="button" disabled={busy || !newName.trim()} onClick={createGroup}
              className="px-3 py-1 bg-[var(--md-blue)] text-white text-sm disabled:opacity-50">สร้าง</button>
          </div>
        </div>

        <div className="md:col-span-2 bg-white border border-gray-200 p-4">
          {!sel ? <div className="text-sm text-gray-500">เลือกทีมทางซ้าย</div> : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <div>
                  <div className="text-xs text-gray-500">ทีม</div>
                  <div className="text-lg font-semibold text-gray-800">{sel.name}</div>
                </div>
                <label className="ml-auto text-sm flex items-center gap-2">
                  <span className="text-gray-600">บัญชีผู้ตรวจ</span>
                  <select value={sel.checker_id ?? 0} disabled={busy} onChange={(e) => linkChecker(Number(e.target.value) || null)}
                    className="border border-gray-300 px-2 py-1 text-sm">
                    <option value={0}>— ยังไม่ผูก —</option>
                    {checkers.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name} ({c.username})</option>)}
                  </select>
                </label>
                <button type="button" disabled={busy} onClick={removeGroup} className="text-xs text-red-700 hover:underline disabled:opacity-50">ลบทีม</button>
              </div>

              {/* 03/10/69 user สั่ง: สราวุธตรวจเฉพาะไทยไพบูลย์ (ช่างกรุงเทพทุกคน) โดยไม่ย้ายช่าง — ช่างอยู่ได้ทีมเดียว
                  ย้ายเข้าทีมนี้ = หัวหน้าไอโออิที่ดูแลอยู่ไม่เห็นงานแอปของช่างอีก → ติ๊กที่ทีมแทน */}
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={Boolean(sel.sees_thaipaiboon)} disabled={busy}
                  onChange={(e) => setThaiPaiboon(e.target.checked)} className="mt-0.5" />
                <span>
                  เห็นงานไทยไพบูลย์ทั้งหมดในหน้า &quot;รายการงาน&quot; — ไม่ต้องย้ายช่างเข้าทีมนี้ ช่างยังอยู่ทีมเดิม
                  <span className="block text-xs text-gray-500">หัวหน้าทีมนี้เห็นงานไทยไพบูลย์ทุกเรื่อง + งานของลูกทีม (ถ้ามี) + งานที่ดึง/สร้างเอง · หัวหน้าทีมเดิมของช่างยังเห็นงานของลูกทีมตามปกติ</span>
                </span>
              </label>

              <div className="flex gap-2">
                <input value={newMember} onChange={(e) => setNewMember(e.target.value)}
                  placeholder='เพิ่มสมาชิก: "SEC343 นาย มี วงษ์สุวรรณ" หรือชื่อบริษัท OSS'
                  onKeyDown={(e) => { if (e.key === 'Enter') addMember(); }}
                  className="flex-1 border border-gray-300 px-2 py-1 text-sm" />
                <button type="button" disabled={busy || !newMember.trim()} onClick={addMember}
                  className="px-3 py-1 border border-gray-300 bg-white text-sm disabled:opacity-50">เพิ่ม</button>
              </div>

              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr><th className="px-2 py-1.5 text-left">รหัส</th><th className="px-2 py-1.5 text-left">ข้อความใน mapping</th><th className="px-2 py-1.5 text-left">ทะเบียนพนักงาน</th><th></th></tr>
                </thead>
                <tbody>
                  {(sel.members ?? []).map((m) => (
                    <tr key={m.id} className="border-t border-gray-100">
                      <td className="px-2 py-1 font-mono whitespace-nowrap">{m.staff_code ?? <span className="text-gray-400">OSS</span>}</td>
                      <td className="px-2 py-1">{m.staff_name}</td>
                      <td className="px-2 py-1 text-gray-600">
                        {m.staff_code ? (m.surveyor_id ? `${m.surveyor_name}${m.surveyor_active === false ? ' (ปิดใช้งาน)' : ''}` : <span className="text-amber-700">ไม่พบรหัสในทะเบียน</span>) : ''}
                      </td>
                      <td className="px-2 py-1 text-right">
                        <button type="button" disabled={busy} onClick={() => removeMember(m)} className="text-xs text-red-700 hover:underline disabled:opacity-50">เอาออก</button>
                      </td>
                    </tr>
                  ))}
                  {(sel.members ?? []).length === 0 && <tr><td colSpan={4} className="px-2 py-4 text-center text-gray-500">ยังไม่มีสมาชิก</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
