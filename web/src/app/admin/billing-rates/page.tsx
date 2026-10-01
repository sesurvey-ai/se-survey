'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@/lib/api';

/**
 * หน้าแก้เรทค่าตอบแทน (ผู้ดูแลระบบ)
 *
 * เดิมเรทอยู่ใน SQLite ของระบบเก่า ไม่มีหน้าแก้ ใครจะเปลี่ยนต้องเข้าไปยิง SQL เอง
 * หน้านี้ทำให้แก้ได้เอง — และเพราะแก้ได้ง่ายขึ้น จึงต้องเห็นชัดว่า
 *   • ฝั่งไหนเป็นเงินของพนักงาน ฝั่งไหนเป็นเงินที่เรียกเก็บประกัน (สลับกัน = จ่ายผิด)
 *   • ทุกการแก้ถูกบันทึกว่าใครแก้ จากเท่าไหร่เป็นเท่าไหร่ (แท็บ "ประวัติการแก้")
 */

type Dict = Record<string, unknown>;
type TeamMap = Record<string, number>;

interface AmphurRow extends Dict {
  amphur_id: string; amphur_name: string; province_id: string; province_name: string;
  has_rate: boolean;
}
interface ProvinceRow extends Dict { province_id: string; province_name: string; sur_invest: number; enabled: boolean }
interface TumbonRow extends Dict { tumbon_id: string; label: string; tumbon_name: string; parent_amphur: string; parent_name: string }
interface TeamRow { sec_code: string; team: string; user_name?: string | null }
interface SettingRow { key: string; value: Dict; note?: string | null; updated_at?: string }
interface ChangeRow {
  id: number; scope: string; ref_id: string; label?: string | null; field: string;
  old_value?: string | null; new_value?: string | null;
  changed_by_name?: string | null; changed_at: string;
}

const TABS = [
  { id: 'amphur', label: 'เรทรายอำเภอ' },
  { id: 'province', label: 'เรทรายจังหวัด' },
  { id: 'tumbon', label: 'เรทรายตำบล' },
  { id: 'team', label: 'ทีมผู้สำรวจ' },
  { id: 'setting', label: 'ค่าคงที่' },
  { id: 'log', label: 'ประวัติการแก้' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const SCOPE_LABEL: Record<string, string> = {
  amphur: 'อำเภอ', province: 'จังหวัด', tumbon: 'ตำบล', team: 'ทีม', setting: 'ค่าคงที่',
};

/** '' → null (ไม่มีเรท) ต่างจาก 0 (มีเรทแต่เป็นศูนย์) — สองอย่างนี้ให้ผลคนละแบบตอนคิดเงิน */
const toNum = (s: string): number | null => (s.trim() === '' ? null : Number(s));
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const money = (v: unknown) =>
  v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('th-TH');

function thaiTime(v?: string | null) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('th-TH', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** ตัวเลขในตาราง: ฝั่งจ่ายพนักงานเน้นเขียว ฝั่งเรียกเก็บประกันปล่อยเทา — กันแก้ผิดฝั่ง */
const PAY_CELL = 'px-3 py-2 text-sm text-right font-medium text-emerald-700';
const INS_CELL = 'px-3 py-2 text-sm text-right text-gray-600';
const TH = 'px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap';
const TH_NUM = 'px-3 py-2 text-right text-xs font-medium text-gray-500 whitespace-nowrap';
const INPUT = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-blue-500 outline-none';

export default function BillingRatesPage() {
  const [tab, setTab] = useState<TabId>('amphur');
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  const [provinces, setProvinces] = useState<ProvinceRow[]>([]);
  const [tumbons, setTumbons] = useState<TumbonRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [noTeam, setNoTeam] = useState<{ code: string; name: string }[]>([]);
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [provinceOptions, setProvinceOptions] = useState<{ id: string; name: string }[]>([]);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const flash = useCallback((ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), ok ? 2500 : 6000);
  }, []);

  const loadOverview = useCallback(async () => {
    const res = await api.get('/api/admin/billing/overview');
    if (!res.data.success) return;
    const d = res.data.data;
    setProvinces(d.provinces); setTumbons(d.tumbons); setTeams(d.teams);
    setNoTeam(d.surveyors_without_team); setSettings(d.settings);
    setProvinceOptions(d.province_options);
  }, []);

  useEffect(() => { loadOverview().catch(() => {}).finally(() => setLoading(false)); }, [loadOverview]);

  // ประวัติโหลดตอนเปิดแท็บ และรีเฟรชทุกครั้งที่กลับมาดู (มีการแก้ระหว่างนั้นได้)
  useEffect(() => {
    if (tab !== 'log') return;
    api.get('/api/admin/billing/changes?limit=200')
      .then((r) => { if (r.data.success) setChanges(r.data.data); })
      .catch(() => {});
  }, [tab]);

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-1">เรทค่าตอบแทน</h1>
      <p className="text-sm text-gray-500 mb-4">
        เรทที่ระบบใช้คิดยอดจ่ายพนักงานและยอดเรียกเก็บประกัน — แก้แล้วมีผลกับงานที่คิดเงิน
        <span className="font-medium">หลังจากนี้</span> เท่านั้น งานที่คิดไปแล้วไม่เปลี่ยนย้อนหลัง
      </p>

      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span className="font-medium">เรทชุดนี้เป็นของ se-survey แยกต่างหาก</span> — ระบบเก่า
        (ISURVEY + ส่วนขยายเบราว์เซอร์) ใช้เรทคนละชุด แก้ที่นี่แล้วฝั่งโน้นไม่เปลี่ยนตาม
        ถ้าต้องการให้ตรงกันต้องไปแก้อีกฝั่งด้วย
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'amphur' && (
        <AmphurTab provinceOptions={provinceOptions} flash={flash} />
      )}
      {tab === 'province' && (
        <ProvinceTab rows={provinces} flash={flash} reload={loadOverview} />
      )}
      {tab === 'tumbon' && (
        <TumbonTab rows={tumbons} flash={flash} reload={loadOverview} />
      )}
      {tab === 'team' && (
        <TeamTab rows={teams} noTeam={noTeam} flash={flash} reload={loadOverview} />
      )}
      {tab === 'setting' && (
        <SettingTab rows={settings} flash={flash} reload={loadOverview} />
      )}
      {tab === 'log' && <LogTab rows={changes} />}

      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-3 rounded-lg shadow-lg text-sm text-white ${toast.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.text}
        </div>
      )}
    </div>
  );
}

type Flash = (ok: boolean, text: string) => void;

// ────────────────── เรทรายอำเภอ ──────────────────

function AmphurTab({ provinceOptions, flash }: {
  provinceOptions: { id: string; name: string }[]; flash: Flash;
}) {
  const [province, setProvince] = useState('');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AmphurRow[]>([]);
  const [busy, setBusy] = useState(true);
  const [editing, setEditing] = useState<AmphurRow | null>(null);
  const seq = useRef(0);

  useEffect(() => { const t = setTimeout(() => setQ(qInput.trim()), 350); return () => clearTimeout(t); }, [qInput]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setBusy(true);
    try {
      const p = new URLSearchParams();
      if (province) p.set('province', province);
      if (q) p.set('q', q);
      const res = await api.get(`/api/admin/billing/amphurs?${p}`);
      if (my !== seq.current) return;   // พิมพ์เร็ว → ทิ้งผลของคำขอเก่า
      if (res.data.success) setRows(res.data.data);
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }, [province, q]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  return (
    <>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
        <select value={province} onChange={(e) => setProvince(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">ทุกจังหวัด (เฉพาะอำเภอที่มีเรท)</option>
          {provinceOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input value={qInput} onChange={(e) => setQInput(e.target.value)}
          placeholder="ค้นหาชื่ออำเภอ หรือรหัส..."
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 flex-1 min-w-[220px]" />
        <span className="text-sm text-gray-500">{rows.length} อำเภอ</span>
      </div>

      {(province || q) && (
        <p className="text-xs text-gray-500 mb-2">
          เลือกจังหวัดหรือค้นหาแล้วจะเห็น<span className="font-medium">อำเภอที่ยังไม่มีเรท</span>ด้วย —
          กดแก้เพื่อเพิ่มเรทให้พื้นที่ให้บริการใหม่
        </p>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
        {busy ? (
          <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center text-gray-500 py-12">ไม่พบอำเภอที่ตรงเงื่อนไข</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className={TH}>รหัส</th>
                <th className={TH}>อำเภอ</th>
                <th className={TH}>จังหวัด</th>
                <th className={`${TH_NUM} bg-emerald-50 text-emerald-800`}>จ่ายพนักงาน</th>
                <th className={`${TH} bg-emerald-50 text-emerald-800`}>รายทีม</th>
                <th className={TH_NUM}>เรียกเก็บ สด/แห้ง</th>
                <th className={TH_NUM}>เรียกเก็บ ติดตาม</th>
                <th className={TH_NUM}>ค่าเดินทาง</th>
                <th className={TH_NUM}>ค่ารูป</th>
                <th className={TH}>แก้ล่าสุด</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rows.map((r) => (
                <tr key={r.amphur_id} className={`hover:bg-gray-50 ${r.has_rate ? '' : 'bg-gray-50/60'}`}>
                  <td className="px-3 py-2 text-sm text-gray-500 font-mono">{r.amphur_id}</td>
                  <td className="px-3 py-2 text-sm text-gray-900">
                    {r.amphur_name}
                    {!r.has_rate && <span className="ml-2 text-xs text-amber-700">ยังไม่มีเรท</span>}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-500">{r.province_name}</td>
                  <td className={`${PAY_CELL} bg-emerald-50/40`}>{money(r.sur_invest)}</td>
                  <td className="px-3 py-2 text-xs bg-emerald-50/40"><TeamBadges map={r.sur_invest_by_team as TeamMap | null} /></td>
                  <td className={INS_CELL}>{money(r.ins_invest_12)}</td>
                  <td className={INS_CELL}>{money(r.ins_invest_34)}</td>
                  <td className={INS_CELL}>
                    {money(r.ins_trans)}
                    {r.ins_trans_by_team ? <span className="ml-1 text-xs text-gray-400">+ทีม</span> : null}
                  </td>
                  <td className={INS_CELL}>{money(r.ins_photo_12)}</td>
                  <td className="px-3 py-2 text-xs text-gray-400">{r.updated_at ? thaiTime(String(r.updated_at)) : '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(r)}
                      className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">แก้</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <RateModal
          title={`${editing.amphur_name} · ${editing.province_name}`}
          subtitle={`รหัสอำเภอ ${editing.amphur_id}`}
          row={editing}
          fields={[
            { key: 'sur_invest', label: 'จ่ายพนักงาน', side: 'pay' },
            { key: 'ins_invest_12', label: 'เรียกเก็บ เคลมสด/เคลมแห้ง', side: 'ins' },
            { key: 'ins_invest_34', label: 'เรียกเก็บ ติดตาม/อื่นๆ', side: 'ins' },
            { key: 'ins_trans', label: 'ค่าเดินทาง (เรียกเก็บ)', side: 'ins' },
            { key: 'ins_photo_12', label: 'ค่ารูป (เรียกเก็บ เคลมสด/แห้ง)', side: 'ins' },
          ]}
          teamFields={[
            { key: 'sur_invest_by_team', label: 'จ่ายพนักงาน แยกตามทีม', side: 'pay' },
            { key: 'ins_trans_by_team', label: 'ค่าเดินทาง แยกตามทีม', side: 'ins' },
          ]}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await api.put(`/api/admin/billing/amphurs/${editing.amphur_id}`, patch);
            flash(true, `บันทึกเรท ${editing.amphur_name} แล้ว`);
            setEditing(null);
            await load();
          }}
          flash={flash}
        />
      )}
    </>
  );
}

function TeamBadges({ map }: { map: TeamMap | null | undefined }) {
  if (!map || !Object.keys(map).length) return <span className="text-gray-300">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(map).map(([t, v]) => (
        <span key={t} className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 whitespace-nowrap">
          {t} {Number(v).toLocaleString('th-TH')}
        </span>
      ))}
    </div>
  );
}

// ────────────────── กล่องแก้เรท (อำเภอ / ตำบล) ──────────────────

interface FieldDef { key: string; label: string; side: 'pay' | 'ins' }

function RateModal({ title, subtitle, row, fields, teamFields, onClose, onSave, flash }: {
  title: string; subtitle: string; row: Dict;
  fields: FieldDef[]; teamFields: FieldDef[];
  onClose: () => void; onSave: (patch: Dict) => Promise<void>; flash: Flash;
}) {
  const [nums, setNums] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, row[f.key] === null || row[f.key] === undefined ? '' : String(row[f.key])])));
  const [maps, setMaps] = useState<Record<string, [string, string][]>>(() =>
    Object.fromEntries(teamFields.map((f) => {
      const m = (row[f.key] ?? null) as TeamMap | null;
      return [f.key, m ? Object.entries(m).map(([k, v]) => [k, String(v)] as [string, string]) : []];
    })));
  const [saving, setSaving] = useState(false);

  const setPair = (key: string, i: number, which: 0 | 1, val: string) =>
    setMaps((m) => {
      const next = m[key].map((p, j) => (j === i ? (which === 0 ? [val, p[1]] : [p[0], val]) as [string, string] : p));
      return { ...m, [key]: next };
    });

  const submit = async () => {
    const patch: Dict = {};
    for (const f of fields) {
      const v = toNum(nums[f.key] ?? '');
      if (v !== null && !Number.isFinite(v)) { flash(false, `${f.label}: ต้องเป็นตัวเลข`); return; }
      patch[f.key] = v;
    }
    for (const f of teamFields) {
      const obj: Dict = {};
      for (const [t, v] of maps[f.key] ?? []) {
        const name = t.trim();
        if (!name) continue;
        if (v.trim() === '') continue;   // ยอดว่าง = ลบทีมนั้นออก
        const n = Number(v);
        if (!Number.isFinite(n)) { flash(false, `${f.label} / ${name}: ต้องเป็นตัวเลข`); return; }
        obj[name] = n;
      }
      patch[f.key] = obj;
    }
    setSaving(true);
    try { await onSave(patch); }
    catch (e) { flash(false, errText(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-xs text-gray-500">
            เว้นว่าง = <span className="font-medium">ไม่มีเรท</span> (ระบบจะไปหาจากระดับที่กว้างกว่า)
            ซึ่งไม่เหมือนใส่ 0 ที่แปลว่ามีเรทและเป็นศูนย์
          </p>

          <div className="grid grid-cols-2 gap-4">
            {fields.map((f) => (
              <div key={f.key}>
                <label className={`block text-sm mb-1 ${f.side === 'pay' ? 'text-emerald-800 font-medium' : 'text-gray-600'}`}>
                  {f.label}
                  {f.side === 'pay' && <span className="ml-1 text-xs font-normal text-emerald-600">(เงินพนักงาน)</span>}
                </label>
                <input value={nums[f.key] ?? ''} inputMode="numeric"
                  onChange={(e) => setNums((s) => ({ ...s, [f.key]: e.target.value }))}
                  className={`${INPUT} text-right ${f.side === 'pay' ? 'border-emerald-300 bg-emerald-50/40' : ''}`} />
              </div>
            ))}
          </div>

          {teamFields.map((f) => (
            <div key={f.key} className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between mb-2">
                <label className={`text-sm ${f.side === 'pay' ? 'text-emerald-800 font-medium' : 'text-gray-600'}`}>
                  {f.label}
                </label>
                <button type="button"
                  onClick={() => setMaps((m) => ({ ...m, [f.key]: [...(m[f.key] ?? []), ['', '']] }))}
                  className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">+ เพิ่มทีม</button>
              </div>
              {(maps[f.key] ?? []).length === 0 ? (
                <p className="text-xs text-gray-400">ไม่มี — ทุกทีมใช้เรทด้านบนเท่ากัน</p>
              ) : (
                <div className="space-y-2">
                  {(maps[f.key] ?? []).map(([t, v], i) => (
                    <div key={i} className="flex gap-2">
                      <input value={t} placeholder="ชื่อทีม" onChange={(e) => setPair(f.key, i, 0, e.target.value)}
                        className={`${INPUT} flex-1`} />
                      <input value={v} placeholder="ยอด" inputMode="numeric"
                        onChange={(e) => setPair(f.key, i, 1, e.target.value)}
                        className={`${INPUT} w-28 text-right`} />
                      <button type="button"
                        onClick={() => setMaps((m) => ({ ...m, [f.key]: m[f.key].filter((_, j) => j !== i) }))}
                        className="px-3 text-sm text-red-600 hover:bg-red-50 rounded">ลบ</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">
                ชื่อทีมต้องตรงกับที่ตั้งไว้ในแท็บ &ldquo;ทีมผู้สำรวจ&rdquo; ไม่งั้นจะไม่ถูกใช้
              </p>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">ยกเลิก</button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </div>
  );
}

function errText(e: unknown): string {
  const r = (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
  return r?.message || r?.error || 'บันทึกไม่สำเร็จ';
}

// ────────────────── เรทรายจังหวัด ──────────────────

function ProvinceTab({ rows, flash, reload }: { rows: ProvinceRow[]; flash: Flash; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const save = async (r: ProvinceRow, patch: Dict) => {
    setSaving(r.province_id);
    try {
      await api.put(`/api/admin/billing/provinces/${r.province_id}`, patch);
      setDraft((d) => { const n = { ...d }; delete n[r.province_id]; return n; });
      await reload();
      flash(true, `บันทึก ${r.province_name} แล้ว`);
    } catch (e) { flash(false, errText(e)); }
    finally { setSaving(null); }
  };

  return (
    <>
      <p className="text-sm text-gray-500 mb-3">
        เรทระดับจังหวัดเป็น<span className="font-medium">ตัวสำรอง</span> — ใช้เมื่ออำเภอนั้นไม่มีเรทของตัวเอง
        · ปิดใช้งาน = ไม่รับงานในจังหวัดนั้น
      </p>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className={TH}>รหัส</th>
              <th className={TH}>จังหวัด</th>
              <th className={`${TH_NUM} bg-emerald-50 text-emerald-800`}>จ่ายพนักงาน</th>
              <th className={TH}>เปิดใช้งาน</th>
              <th className={TH}>แก้ล่าสุด</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map((r) => {
              const cur = draft[r.province_id] ?? String(r.sur_invest ?? '');
              const dirty = cur !== String(r.sur_invest ?? '');
              return (
                <tr key={r.province_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-sm text-gray-500 font-mono">{r.province_id}</td>
                  <td className="px-3 py-2 text-sm text-gray-900">{r.province_name}</td>
                  <td className="px-3 py-2 bg-emerald-50/40">
                    <input value={cur} inputMode="numeric"
                      onChange={(e) => setDraft((d) => ({ ...d, [r.province_id]: e.target.value }))}
                      className="w-28 px-2 py-1 border border-emerald-300 rounded text-sm text-right text-gray-900 outline-none focus:ring-2 focus:ring-emerald-500" />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => save(r, { enabled: !r.enabled })}
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.enabled ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                      {r.enabled ? 'เปิด' : 'ปิด'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400">{thaiTime(r.updated_at as string)}</td>
                  <td className="px-3 py-2 text-right">
                    <button disabled={!dirty || saving === r.province_id}
                      onClick={() => save(r, { sur_invest: toNum(cur) })}
                      className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-30">
                      บันทึก
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ────────────────── เรทรายตำบล ──────────────────

function TumbonTab({ rows, flash, reload }: { rows: TumbonRow[]; flash: Flash; reload: () => Promise<void> }) {
  const [editing, setEditing] = useState<TumbonRow | null>(null);
  return (
    <>
      <p className="text-sm text-gray-500 mb-3">
        ตำบลที่คิดเรทไม่เท่าอำเภอแม่ — ค่าที่ใส่ที่นี่<span className="font-medium">ทับ</span>ของอำเภอแม่
        · เพิ่มตำบลใหม่ยังต้องทำผ่านฐานข้อมูล (ปัจจุบันมีแค่ {rows.length} ตำบล)
      </p>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className={TH}>รหัส</th>
              <th className={TH}>ตำบล</th>
              <th className={TH}>อำเภอแม่</th>
              <th className={`${TH} bg-emerald-50 text-emerald-800`}>จ่ายพนักงาน (รายทีม)</th>
              <th className={TH_NUM}>เรียกเก็บ สด/แห้ง</th>
              <th className={TH_NUM}>เรียกเก็บ ติดตาม</th>
              <th className={TH_NUM}>ค่าเดินทาง</th>
              <th className={TH_NUM}>ค่ารูป</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map((r) => (
              <tr key={r.tumbon_id} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-sm text-gray-500 font-mono">{r.tumbon_id}</td>
                <td className="px-3 py-2 text-sm text-gray-900">{r.label}</td>
                <td className="px-3 py-2 text-sm text-gray-500">{r.parent_name}</td>
                <td className="px-3 py-2 text-xs bg-emerald-50/40"><TeamBadges map={r.sur_invest_by_team as TeamMap | null} /></td>
                <td className={INS_CELL}>{money(r.ins_invest_12)}</td>
                <td className={INS_CELL}>{money(r.ins_invest_34)}</td>
                <td className={INS_CELL}>{money(r.ins_trans)}</td>
                <td className={INS_CELL}>{money(r.ins_photo_12)}</td>
                <td className="px-3 py-2 text-right">
                  <button onClick={() => setEditing(r)}
                    className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">แก้</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <RateModal
          title={`ตำบล${editing.label}`}
          subtitle={`รหัส ${editing.tumbon_id} · อยู่ในอำเภอ${editing.parent_name}`}
          row={editing}
          fields={[
            { key: 'ins_invest_12', label: 'เรียกเก็บ เคลมสด/เคลมแห้ง', side: 'ins' },
            { key: 'ins_invest_34', label: 'เรียกเก็บ ติดตาม/อื่นๆ', side: 'ins' },
            { key: 'ins_trans', label: 'ค่าเดินทาง (เรียกเก็บ)', side: 'ins' },
            { key: 'ins_photo_12', label: 'ค่ารูป (เรียกเก็บ เคลมสด/แห้ง)', side: 'ins' },
          ]}
          teamFields={[
            { key: 'sur_invest_by_team', label: 'จ่ายพนักงาน แยกตามทีม', side: 'pay' },
            { key: 'ins_trans_by_team', label: 'ค่าเดินทาง แยกตามทีม', side: 'ins' },
          ]}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await api.put(`/api/admin/billing/tumbons/${editing.tumbon_id}`, patch);
            flash(true, `บันทึกตำบล${editing.label} แล้ว`);
            setEditing(null);
            await reload();
          }}
          flash={flash}
        />
      )}
    </>
  );
}

// ────────────────── ทีมผู้สำรวจ ──────────────────

function TeamTab({ rows, noTeam, flash, reload }: {
  rows: TeamRow[]; noTeam: { code: string; name: string }[]; flash: Flash; reload: () => Promise<void>;
}) {
  const [code, setCode] = useState('');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  const known = Array.from(new Set(rows.map((r) => r.team))).sort();

  const add = async () => {
    setBusy(true);
    try {
      await api.post('/api/admin/billing/teams', { sec_code: code, team });
      setCode(''); setTeam('');
      await reload();
      flash(true, 'บันทึกแล้ว');
    } catch (e) { flash(false, errText(e)); }
    finally { setBusy(false); }
  };

  const remove = async (c: string) => {
    try {
      await api.delete(`/api/admin/billing/teams/${c}`);
      setConfirm(null);
      await reload();
      flash(true, `ลบ ${c} แล้ว`);
    } catch (e) { flash(false, errText(e)); }
  };

  return (
    <>
      <p className="text-sm text-gray-500 mb-3">
        จับคู่รหัสผู้สำรวจกับทีม — ใช้ตอนอำเภอนั้นจ่ายไม่เท่ากันตามทีม
        · ผู้สำรวจที่ไม่มีในตารางนี้จะได้เรทกลางของอำเภอแทน
      </p>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">รหัสผู้สำรวจ</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="SEC123"
            className={`${INPUT} w-40 font-mono`} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">ทีม</label>
          <input value={team} onChange={(e) => setTeam(e.target.value)} list="known-teams"
            placeholder="เช่น บางละมุง" className={`${INPUT} w-60`} />
          <datalist id="known-teams">{known.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
        <button onClick={add} disabled={busy || !code.trim() || !team.trim()}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
          เพิ่ม / แก้
        </button>
      </div>

      {noTeam.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium mb-1">ผู้สำรวจรหัส SEC อีก {noTeam.length} คนยังไม่ได้จับคู่ทีม</p>
          <p className="text-xs mb-2">
            คนเหล่านี้จะได้เรทกลางของอำเภอเสมอ ไม่ว่าอำเภอนั้นจะตั้งเรทรายทีมไว้หรือไม่ —
            ถ้าตั้งใจให้เป็นแบบนั้นก็ไม่ต้องทำอะไร
            (รหัส SE ของกรุงเทพฯ ไม่นับ — ใช้เรทกลางเท่ากันหมดอยู่แล้ว)
          </p>
          <div className="flex flex-wrap gap-1">
            {noTeam.slice(0, 40).map((s) => (
              <button key={s.code} onClick={() => setCode(s.code)}
                className="px-2 py-0.5 rounded bg-white border border-amber-300 text-xs hover:bg-amber-100"
                title={s.name}>
                {s.code}
              </button>
            ))}
            {noTeam.length > 40 && <span className="text-xs self-center">และอีก {noTeam.length - 40} คน</span>}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className={TH}>รหัส</th>
              <th className={TH}>ชื่อในระบบ</th>
              <th className={TH}>ทีม</th>
              <th className={TH} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.map((r) => (
              <tr key={r.sec_code} className="hover:bg-gray-50">
                <td className="px-3 py-2 text-sm font-mono text-gray-900">{r.sec_code}</td>
                <td className="px-3 py-2 text-sm text-gray-500">
                  {r.user_name || <span className="text-amber-700">ไม่พบรหัสนี้ในรายชื่อผู้ใช้</span>}
                </td>
                <td className="px-3 py-2 text-sm text-gray-700">{r.team}</td>
                <td className="px-3 py-2 text-right">
                  {confirm === r.sec_code ? (
                    <span className="inline-flex gap-2">
                      <button onClick={() => remove(r.sec_code)}
                        className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700">ยืนยันลบ</button>
                      <button onClick={() => setConfirm(null)}
                        className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded">ยกเลิก</button>
                    </span>
                  ) : (
                    <span className="inline-flex gap-2">
                      <button onClick={() => { setCode(r.sec_code); setTeam(r.team); }}
                        className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700">แก้</button>
                      <button onClick={() => setConfirm(r.sec_code)}
                        className="px-3 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100">ลบ</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ────────────────── ค่าคงที่ ──────────────────

const SETTING_TITLES: Record<string, string> = {
  modifier_fees: 'ค่านอกพื้นที่ / นอกเวลา',
  company2_rules: 'เรทตามคำนำหน้าเลขเซอร์เวย์',
  continuous_rules: 'งานต่อเนื่อง (ครั้งที่ 2)',
  daily_check_fees: 'ค่าคัดประจำวัน',
  ins_lump_by_survey_seq: 'เรทเหมาตามลำดับเรื่องในเดือน (ราชบุรี)',
  ins_lump_by_amphur: 'จังหวัดเหมาตามเรทรายอำเภอ ไม่มีค่าเดินทาง/ค่ารูปแยก (กระบี่)',
};

function SettingTab({ rows, flash, reload }: { rows: SettingRow[]; flash: Flash; reload: () => Promise<void> }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        ค่าที่เดิมฝังอยู่ในโค้ดส่วนขยาย แก้ทีต้องสร้างใหม่แล้วแจกทุกเครื่อง — ย้ายมาแก้ที่นี่ได้เลย
      </p>
      {/* นอกพื้นที่/นอกเวลาขึ้นก่อน — เป็นตัวเดียวที่คนแก้บ่อย ที่เหลือแทบไม่แตะ */}
      {[...rows].sort((a, b) => Number(b.key === 'modifier_fees') - Number(a.key === 'modifier_fees')).map((s) => (
        s.key === 'modifier_fees'
          ? <ModifierFeesCard key={s.key} row={s} flash={flash} reload={reload} />
          : <JsonSettingCard key={s.key} row={s} flash={flash} reload={reload} />
      ))}
    </div>
  );
}

/** ตัวที่คนแก้บ่อยที่สุด — ให้เป็นช่องตัวเลข ไม่ต้องมานั่งแก้ JSON */
function ModifierFeesCard({ row, flash, reload }: { row: SettingRow; flash: Flash; reload: () => Promise<void> }) {
  const v = row.value as { outOfArea?: number; outOfHours?: number };
  const [area, setArea] = useState(String(v.outOfArea ?? ''));
  const [hours, setHours] = useState(String(v.outOfHours ?? ''));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const a = Number(area), h = Number(hours);
    if (!Number.isFinite(a) || !Number.isFinite(h)) { flash(false, 'ต้องเป็นตัวเลข'); return; }
    setBusy(true);
    try {
      await api.put(`/api/admin/billing/settings/${row.key}`, { value: { outOfArea: a, outOfHours: h } });
      await reload();
      flash(true, 'บันทึกแล้ว');
    } catch (e) { flash(false, errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <h3 className="font-medium text-gray-800">{SETTING_TITLES[row.key] ?? row.key}</h3>
      <p className="text-xs text-gray-500 mt-1 mb-3">
        ค่า<span className="font-medium">ตั้งต้น</span>ที่เติมให้อัตโนมัติเมื่อผู้ตรวจติ๊กช่องนั้น —
        แก้เป็นเลขอื่นรายงานได้ที่หน้าตรวจงาน
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1">นอกพื้นที่ (บาท)</label>
          <input value={area} inputMode="numeric" onChange={(e) => setArea(e.target.value)}
            className={`${INPUT} w-32 text-right`} />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">นอกเวลา (บาท)</label>
          <input value={hours} inputMode="numeric" onChange={(e) => setHours(e.target.value)}
            className={`${INPUT} w-32 text-right`} />
        </div>
        <button onClick={save} disabled={busy}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
          บันทึก
        </button>
        <span className="text-xs text-gray-400">แก้ล่าสุด {thaiTime(row.updated_at)}</span>
      </div>
    </div>
  );
}

/** ที่เหลือโครงไม่เหมือนกันเลย — ให้แก้เป็น JSON ตรง ๆ แต่ตรวจให้ก่อนส่ง */
function JsonSettingCard({ row, flash, reload }: { row: SettingRow; flash: Flash; reload: () => Promise<void> }) {
  const original = JSON.stringify(row.value, null, 2);
  const [text, setText] = useState(original);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { setErr('รูปแบบ JSON ไม่ถูกต้อง — ยังไม่ได้บันทึก'); return; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setErr('ต้องเป็นออบเจ็กต์ { ... }'); return;
    }
    setErr(null); setBusy(true);
    try {
      await api.put(`/api/admin/billing/settings/${row.key}`, { value: parsed });
      await reload();
      flash(true, 'บันทึกแล้ว');
    } catch (e) { flash(false, errText(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <h3 className="font-medium text-gray-800">{SETTING_TITLES[row.key] ?? row.key}</h3>
      {row.note && <p className="text-xs text-gray-500 mt-1">{row.note}</p>}
      <textarea value={text} onChange={(e) => { setText(e.target.value); setErr(null); }}
        spellCheck={false} rows={Math.min(14, text.split('\n').length + 1)}
        className="mt-3 w-full px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs text-gray-900 outline-none focus:ring-2 focus:ring-blue-500" />
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
      <div className="flex items-center gap-3 mt-2">
        <button onClick={save} disabled={busy || text === original}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
          บันทึก
        </button>
        {text !== original && (
          <button onClick={() => { setText(original); setErr(null); }}
            className="px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">คืนค่าเดิม</button>
        )}
        <span className="text-xs text-gray-400">แก้ล่าสุด {thaiTime(row.updated_at)}</span>
      </div>
    </div>
  );
}

// ────────────────── ประวัติการแก้ ──────────────────

function LogTab({ rows }: { rows: ChangeRow[] }) {
  if (!rows.length) {
    return <div className="bg-white rounded-lg shadow-sm border border-gray-200 py-12 text-center text-gray-500">
      ยังไม่มีการแก้เรทผ่านหน้านี้
    </div>;
  }
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className={TH}>เวลา</th>
            <th className={TH}>ระดับ</th>
            <th className={TH}>รายการ</th>
            <th className={TH}>ช่อง</th>
            <th className={TH}>จาก</th>
            <th className={TH}>เป็น</th>
            <th className={TH}>ผู้แก้</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((c) => (
            <tr key={c.id} className="hover:bg-gray-50">
              <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">{thaiTime(c.changed_at)}</td>
              <td className="px-3 py-2 text-xs text-gray-500">{SCOPE_LABEL[c.scope] ?? c.scope}</td>
              <td className="px-3 py-2 text-sm text-gray-900">
                {c.label || c.ref_id}
                <span className="ml-1 text-xs text-gray-400 font-mono">{c.ref_id}</span>
              </td>
              <td className="px-3 py-2 text-sm text-gray-600">{FIELD_TH[c.field] ?? c.field}</td>
              <td className="px-3 py-2 text-sm text-red-700 max-w-xs truncate" title={c.old_value ?? ''}>{show(c.old_value)}</td>
              <td className="px-3 py-2 text-sm text-emerald-700 max-w-xs truncate" title={c.new_value ?? ''}>{show(c.new_value)}</td>
              <td className="px-3 py-2 text-sm text-gray-500">{c.changed_by_name || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FIELD_TH: Record<string, string> = {
  sur_invest: 'จ่ายพนักงาน',
  sur_invest_by_team: 'จ่ายพนักงาน (รายทีม)',
  ins_invest_12: 'เรียกเก็บ สด/แห้ง',
  ins_invest_34: 'เรียกเก็บ ติดตาม',
  ins_trans: 'ค่าเดินทาง',
  ins_trans_by_team: 'ค่าเดินทาง (รายทีม)',
  ins_photo_12: 'ค่ารูป',
  enabled: 'เปิดใช้งาน',
  team: 'ทีม',
  value: 'ค่า',
};
