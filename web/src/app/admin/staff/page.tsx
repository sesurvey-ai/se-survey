'use client';

/**
 * ทะเบียนพนักงานสำรวจ — รหัส · ชื่อ · เบอร์ · หัวหน้า · สถานะ
 *
 * แยกจาก "จัดการผู้ใช้" (/admin/users) โดยตั้งใจ: หน้านั้นดูแล **บัญชีเข้าระบบ**
 * (username / บทบาท / เวอร์ชันแอป) ส่วนหน้านี้ดูแล **ตัวพนักงาน** ที่ฝ่ายบุคคลคุมอยู่
 * และเป็นต้นทางของ "เบอร์ผู้สำรวจภัย" ที่ระบบเติมให้เคสอัตโนมัติ (EMCS บังคับช่องนี้)
 *
 * 09/09/69: แก้เบอร์ทีละคนในตารางได้ (กด "แก้" ที่ช่องเบอร์) — user ทักว่าเดิมกรอกเบอร์ไม่ได้ มีแต่ทางนำเข้า Excel
 * นำเข้าจากไฟล์ Excel ของฝ่ายบุคคลได้ตรง ๆ — **ดูแผนก่อนเสมอ** แล้วค่อยเลือกวาจะทำหมวดไหน
 */
import { useState, useEffect, useCallback } from 'react';
import api from '@/lib/api';

type Staff = {
  id: number; username: string; code: string | null;
  first_name: string; last_name: string; role: string;
  is_active: boolean; phone?: string | null; supervisor_id?: number | null;
};

type Plan = {
  file: { supervisors: number; staff: number; withPhone: number };
  create: Array<{ code: string; name: string; phone: string; supervisor: string }>;
  updatePhone: Array<{ code: string; who: string; from: string; to: string }>;
  updateName: Array<{ code: string; from: string; to: string }>;
  linkSupervisor: Array<{ code: string; supervisor: string }>;
  deactivate: Array<{ code: string; who: string }>;
  unknownSupervisors: string[];
  conflicts: Array<{ code: string; reason: string }>;
};

const fmtPhone = (p?: string | null) => {
  const d = (p || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (p || '—');
};

export default function AdminStaffPage() {
  const [rows, setRows] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);

  // นำเข้า Excel
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [pw, setPw] = useState('');
  const [pick, setPick] = useState({ phone: true, name: true, supervisor: true, create: false, deactivate: false });

  // แก้เบอร์ทีละคนในตาราง (บันทึกผ่าน PUT /api/admin/users/:id {phone} — ตัวเดียวกับหน้าผู้ใช้)
  const [editId, setEditId] = useState<number | null>(null);
  const [editVal, setEditVal] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const startEdit = (r: Staff) => { setEditId(r.id); setEditVal((r.phone || '').replace(/\D/g, '')); setMsg(''); };
  const savePhone = async (r: Staff) => {
    const digits = editVal.replace(/\D/g, '');
    if (digits && (digits.length < 9 || digits.length > 10)) {
      setMsg('ไม่สำเร็จ: เบอร์ต้องเป็นตัวเลข 9–10 หลัก (เช่น 0812345678)');
      return;
    }
    setSavingId(r.id);
    try {
      const res = await api.put(`/api/admin/users/${r.id}`, { phone: digits || null });
      const saved = (res.data?.data?.phone ?? digits ?? null) as string | null;
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, phone: saved } : x)));
      setMsg(digits ? `บันทึกเบอร์ของ ${r.code || ''} ${r.first_name} แล้ว (${fmtPhone(digits)})` : `ลบเบอร์ของ ${r.code || ''} ${r.first_name} แล้ว`);
      setEditId(null);
    } catch (e) {
      setMsg('ไม่สำเร็จ: ' + ((e as { response?: { data?: { message?: string } } })?.response?.data?.message || 'บันทึกเบอร์ไม่ได้'));
    } finally { setSavingId(null); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get('/api/admin/users', { params: { limit: 500 } });
      setRows((r.data?.data?.users ?? []) as Staff[]);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const send = async (apply: boolean) => {
    if (!file) { setMsg('กรุณาเลือกไฟล์ .xlsx ก่อน'); return; }
    setBusy(apply ? 'apply' : 'plan'); setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (apply) {
        fd.append('apply', '1');
        fd.append('do_phone', pick.phone ? '1' : '0');
        fd.append('do_name', pick.name ? '1' : '0');
        fd.append('do_supervisor', pick.supervisor ? '1' : '0');
        fd.append('do_create', pick.create ? '1' : '0');
        fd.append('do_deactivate', pick.deactivate ? '1' : '0');
        if (pw) fd.append('new_password', pw);
      }
      const r = await api.post('/api/admin/staff/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000,
      });
      const d = r.data?.data;
      if (apply) {
        const n = d?.done ?? {};
        setMsg(`เสร็จแล้ว — เติมเบอร์ ${n.phone ?? 0} · แก้ชื่อ ${n.name ?? 0} · ผูกหัวหน้า ${n.supervisor ?? 0}`
          + ` · สร้างใหม่ ${n.created ?? 0} · ปิดใช้งาน ${n.deactivated ?? 0}`);
        setPlan(d?.plan ?? null);
        await load();
      } else {
        setPlan(d as Plan);
      }
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setMsg('ไม่สำเร็จ: ' + (err.response?.data?.message || 'เกิดข้อผิดพลาด'));
    } finally { setBusy(''); }
  };

  const byId = new Map(rows.map((r) => [r.id, r]));
  const shown = rows
    .filter((r) => r.code)
    .filter((r) => (onlyActive ? r.is_active : true))
    .filter((r) => {
      const s = q.trim().toLowerCase();
      if (!s) return true;
      return [r.code, r.first_name, r.last_name, r.phone].join(' ').toLowerCase().includes(s);
    });
  const noPhone = shown.filter((r) => !(r.phone || '').trim()).length;

  const Section = ({ title, n, children }: { title: string; n: number; children?: React.ReactNode }) =>
    n === 0 ? null : (
      <details className="border border-gray-200 rounded">
        <summary className="px-3 py-1.5 text-sm cursor-pointer bg-gray-50">{title} <b>{n}</b></summary>
        <div className="px-3 py-2 text-xs text-gray-700 space-y-0.5 max-h-56 overflow-auto">{children}</div>
      </details>
    );

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">ทะเบียนพนักงานสำรวจ</h1>
        <p className="text-sm text-gray-500 mt-1">
          เบอร์ในหน้านี้คือต้นทางของช่อง &quot;โทรศัพท์ผู้สำรวจภัย&quot; ที่ระบบเติมให้เคสอัตโนมัติ
          · คอลัมน์ &quot;หัวหน้า&quot; = ผู้ตรวจของทีมที่สังกัด (แก้ที่ จัดการผู้ใช้ › หัวหน้า/ทีมที่สังกัด หรือ จัดการทีมผู้ตรวจ)
        </p>
      </div>

      {/* ── นำเข้าจาก Excel ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">นำเข้าจากไฟล์ Excel ของฝ่ายบุคคล</h2>
        <input
          type="file" accept=".xlsx"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPlan(null); setMsg(''); }}
          className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-gray-800 bg-white"
        />
        <div className="flex gap-2">
          <button onClick={() => void send(false)} disabled={!!busy}
            className="px-5 py-2 bg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50">
            {busy === 'plan' ? 'กำลังอ่าน...' : 'ดูแผนก่อน (ยังไม่แก้ข้อมูล)'}
          </button>
        </div>

        {plan && (
          <div className="space-y-3 pt-1">
            <p className="text-sm text-gray-600">
              ในไฟล์: หัวหน้า <b>{plan.file.supervisors}</b> · พนักงาน <b>{plan.file.staff}</b> · มีเบอร์ <b>{plan.file.withPhone}</b>
            </p>
            <div className="grid gap-2">
              <Section title="เติม/แก้เบอร์" n={plan.updatePhone.length}>
                {plan.updatePhone.map((x) => (
                  <div key={x.code}>{x.code} {x.who} — {x.from ? fmtPhone(x.from) + ' → ' : ''}{fmtPhone(x.to)}</div>
                ))}
              </Section>
              <Section title="แก้ตัวสะกดชื่อ" n={plan.updateName.length}>
                {plan.updateName.map((x) => <div key={x.code}>{x.code} {x.from} → {x.to}</div>)}
              </Section>
              <Section title="ผูกหัวหน้า" n={plan.linkSupervisor.length}>
                {plan.linkSupervisor.map((x) => <div key={x.code}>{x.code} → {x.supervisor}</div>)}
              </Section>
              <Section title="สร้างบัญชีใหม่" n={plan.create.length}>
                {plan.create.map((x) => <div key={x.code}>{x.code} {x.name} ({x.supervisor})</div>)}
              </Section>
              <Section title="ปิดใช้งาน (ไม่มีในไฟล์แล้ว)" n={plan.deactivate.length}>
                {plan.deactivate.map((x) => <div key={x.code}>{x.code} {x.who}</div>)}
              </Section>
              <Section title="หัวหน้าที่ยังไม่มีบัญชีในระบบ" n={plan.unknownSupervisors.length}>
                {plan.unknownSupervisors.map((x) => <div key={x}>{x}</div>)}
              </Section>
              <Section title="ต้องดูเอง" n={plan.conflicts.length}>
                {plan.conflicts.map((x) => <div key={x.code}>{x.code} — {x.reason}</div>)}
              </Section>
            </div>

            <div className="border-t border-gray-200 pt-3 space-y-2">
              <p className="text-sm font-medium text-gray-700">เลือกสิ่งที่จะให้ทำจริง</p>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-700">
                {([['phone', 'เติม/แก้เบอร์'], ['name', 'แก้ตัวสะกดชื่อ'], ['supervisor', 'ผูกหัวหน้า'],
                   ['create', 'สร้างบัญชีใหม่'], ['deactivate', 'ปิดใช้งานคนที่ออกแล้ว']] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-1.5">
                    <input type="checkbox" checked={pick[k]} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} />
                    {label}
                  </label>
                ))}
              </div>
              {pick.create && plan.create.length > 0 && (
                <div>
                  <input
                    type="text" value={pw} onChange={(e) => setPw(e.target.value)}
                    placeholder="รหัสผ่านเริ่มต้นของบัญชีใหม่ (อย่างน้อย 6 ตัว)"
                    className="w-full max-w-sm border border-gray-300 rounded px-3 py-1.5 text-sm bg-white text-gray-800"
                  />
                  <p className="text-xs text-amber-600 mt-1">
                    บัญชีใหม่ทุกคนจะได้รหัสนี้เหมือนกัน — ต้องให้พนักงานเปลี่ยนเมื่อเข้าใช้ครั้งแรก
                  </p>
                </div>
              )}
              <button onClick={() => void send(true)} disabled={!!busy}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {busy === 'apply' ? 'กำลังบันทึก...' : 'ทำตามที่เลือก'}
              </button>
            </div>
          </div>
        )}

        {msg && (
          <div className={`rounded px-4 py-2 text-sm ${msg.startsWith('ไม่สำเร็จ')
            ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>{msg}</div>
        )}
      </div>

      {/* ── ทะเบียน ── */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 flex flex-wrap items-center gap-3 border-b border-gray-200">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหา รหัส / ชื่อ / เบอร์"
            className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white text-gray-800" />
          <label className="flex items-center gap-1.5 text-sm text-gray-700">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
            เฉพาะที่ยังใช้งาน
          </label>
          <span className="ml-auto text-sm text-gray-500">
            {shown.length} คน{noPhone > 0 && <span className="text-red-600"> · ยังไม่มีเบอร์ {noPhone}</span>}
          </span>
        </div>
        {loading ? <div className="p-8 text-center text-gray-500">กำลังโหลด...</div> : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['รหัส', 'ชื่อ-สกุล', 'เบอร์โทร', 'หัวหน้า', 'สถานะ'].map((h) => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const sup = r.supervisor_id ? byId.get(r.supervisor_id) : null;
                return (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-4 py-2 font-mono text-gray-700">{r.code}</td>
                    <td className="px-4 py-2 text-gray-800">{`${r.first_name} ${r.last_name}`.trim()}</td>
                    <td className={`px-4 py-2 ${(r.phone || '').trim() ? 'text-gray-800' : 'text-red-600'}`}>
                      {editId === r.id ? (
                        <span className="inline-flex items-center gap-1">
                          <input type="tel" value={editVal} autoFocus disabled={savingId === r.id}
                            onChange={(e) => setEditVal(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void savePhone(r); } if (e.key === 'Escape') setEditId(null); }}
                            placeholder="0812345678"
                            className="w-32 border border-blue-400 rounded px-2 py-0.5 text-sm text-gray-800 bg-white" />
                          <button type="button" onClick={() => void savePhone(r)} disabled={savingId === r.id}
                            className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded disabled:opacity-50">บันทึก</button>
                          <button type="button" onClick={() => setEditId(null)} disabled={savingId === r.id}
                            className="px-2 py-0.5 text-xs border border-gray-300 rounded text-gray-600">ยกเลิก</button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <span>{fmtPhone(r.phone)}</span>
                          <button type="button" onClick={() => startEdit(r)} title="แก้เบอร์"
                            className="px-1.5 py-0.5 text-xs border border-gray-300 rounded text-gray-600 hover:bg-gray-100">แก้</button>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{sup ? `${sup.first_name} ${sup.last_name}`.trim() : '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${r.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                        {r.is_active ? 'ใช้งาน' : 'ปิด'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
