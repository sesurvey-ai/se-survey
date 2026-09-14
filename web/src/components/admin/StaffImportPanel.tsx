'use client';

/**
 * นำเข้าทะเบียนพนักงานสำรวจจากไฟล์ Excel ของฝ่ายบุคคล — ย้ายมาจากหน้า "ทะเบียนพนักงานสำรวจ" (/admin/staff)
 * ตอนยุบหน้านั้นเข้า "จัดการผู้ใช้" (user เคาะ 14/09/69: สองหน้าซ้ำกัน)
 *
 * **ดูแผนก่อนเสมอ** แล้วค่อยเลือกว่าจะทำหมวดไหน · "ผูกหัวหน้า" = ย้ายช่างเข้าทีมผู้ตรวจของหัวหน้าคนนั้น
 * (ตัวเดียวกับที่ใช้กรองงานรอตรวจ) ไม่ใช่แค่ช่องหัวหน้าเก่า
 */
import { useState } from 'react';
import api from '@/lib/api';

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

export const fmtPhone = (p?: string | null) => {
  const d = (p || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (p || '—');
};

const Section = ({ title, n, children }: { title: string; n: number; children?: React.ReactNode }) =>
  n === 0 ? null : (
    <details className="border border-gray-200 rounded">
      <summary className="px-3 py-1.5 text-sm cursor-pointer bg-gray-50">{title} <b>{n}</b></summary>
      <div className="px-3 py-2 text-xs text-gray-700 space-y-0.5 max-h-56 overflow-auto">{children}</div>
    </details>
  );

export default function StaffImportPanel({ onApplied }: { onApplied?: () => void | Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [pw, setPw] = useState('');
  const [pick, setPick] = useState({ phone: true, name: true, supervisor: true, create: false, deactivate: false });

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
        setMsg(`เสร็จแล้ว — เติมเบอร์ ${n.phone ?? 0} · แก้ชื่อ ${n.name ?? 0} · ผูกหัวหน้า/ทีม ${n.supervisor ?? 0}`
          + ` · สร้างใหม่ ${n.created ?? 0} · ปิดใช้งาน ${n.deactivated ?? 0}`);
        setPlan(d?.plan ?? null);
        await onApplied?.();
      } else {
        setPlan(d as Plan);
      }
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      setMsg('ไม่สำเร็จ: ' + (err.response?.data?.message || 'เกิดข้อผิดพลาด'));
    } finally { setBusy(''); }
  };

  return (
    <div className="space-y-3">
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
            <Section title="ผูกหัวหน้า/ย้ายเข้าทีม" n={plan.linkSupervisor.length}>
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
              {([['phone', 'เติม/แก้เบอร์'], ['name', 'แก้ตัวสะกดชื่อ'], ['supervisor', 'ผูกหัวหน้า/ย้ายเข้าทีม'],
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
  );
}
