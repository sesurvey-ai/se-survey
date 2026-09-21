'use client';

import { useEffect, useState } from 'react';
import api from '@/lib/api';

/**
 * ประวัติการจ่ายงานของเคส (user สั่ง 22/09/69) — ใครมอบหมาย / ดึงงานกลับ / ช่างปฏิเสธ เมื่อไร ใหม่ → เก่า
 * อ่านจาก GET /api/cases/:id/dispatch-log (ตาราง case_dispatch_log migration 065)
 * ⛔ เคสที่จ่ายก่อนวันรัน migration ไม่มีบันทึกย้อนหลัง — ต้องบอกให้รู้ ไม่ใช่โชว์ว่างเปล่าเหมือนไม่เคยจ่าย
 */
interface DispatchEvent {
  id: number;
  action: 'assigned' | 'recalled' | 'declined';
  reason?: string | null;
  created_at: string;
  surveyor_first_name?: string | null;
  surveyor_last_name?: string | null;
  surveyor_code?: string | null;
  by_first_name?: string | null;
  by_last_name?: string | null;
  by_role?: string | null;
}

/** dd/mm/yyyy HH:mm — รูปแบบเดียวกับหน้ารายการคอลเซ็นเตอร์ (formatDate) */
export function formatDispatchTime(d: string): string {
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return d;
    return `${dt.getDate()}/${dt.getMonth() + 1}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
  } catch { return d; }
}

const fullName = (first?: string | null, last?: string | null) => `${first || ''} ${last || ''}`.trim();

export default function DispatchHistory({ caseId, className = '' }: { caseId: number | string; className?: string }) {
  const [events, setEvents] = useState<DispatchEvent[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.get(`/api/cases/${caseId}/dispatch-log`)
      .then((res) => {
        if (!alive) return;
        if (res.data?.success) setEvents((res.data.data || []) as DispatchEvent[]);
        else { setError(res.data?.message || 'โหลดประวัติการจ่ายงานไม่สำเร็จ'); setEvents([]); }
      })
      .catch(() => { if (alive) { setError('โหลดประวัติการจ่ายงานไม่สำเร็จ'); setEvents([]); } });
    return () => { alive = false; };
  }, [caseId]);

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-200 ${className}`}>
      <div className="px-5 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-800">ประวัติการจ่ายงาน</h3>
        <p className="text-xs text-gray-500 mt-0.5">มอบหมาย · ดึงงานกลับ · ช่างปฏิเสธ — ใหม่ไปเก่า</p>
      </div>
      <div className="px-5 py-3 text-sm">
        {error ? (
          <div className="text-red-600">{error}</div>
        ) : events === null ? (
          <div className="text-gray-400">กำลังโหลด…</div>
        ) : events.length === 0 ? (
          <div className="text-gray-400">ยังไม่มีบันทึก (เริ่มเก็บ 22/09/69 — เหตุการณ์ก่อนหน้านั้นไม่มีย้อนหลัง)</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {events.map((e) => {
              const surveyor = `${e.surveyor_code ? `${e.surveyor_code} ` : ''}${fullName(e.surveyor_first_name, e.surveyor_last_name)}`.trim() || '-';
              const by = fullName(e.by_first_name, e.by_last_name);
              const style = e.action === 'assigned' ? 'bg-blue-100 text-blue-700'
                : e.action === 'recalled' ? 'bg-amber-100 text-amber-800'
                : 'bg-red-100 text-red-700';
              const label = e.action === 'assigned' ? 'มอบหมาย' : e.action === 'recalled' ? 'ดึงงานกลับ' : 'ช่างปฏิเสธ';
              return (
                <li key={e.id} className="py-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-xs text-gray-500 whitespace-nowrap">{formatDispatchTime(e.created_at)}</span>
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${style}`}>{label}</span>
                  <span className="text-gray-800">
                    {e.action === 'assigned' ? `ให้ ${surveyor}` : e.action === 'recalled' ? `จาก ${surveyor}` : surveyor}
                    {e.action === 'declined' && e.reason ? <span className="text-gray-500"> — {e.reason}</span> : null}
                  </span>
                  {e.action !== 'declined' && by ? (
                    <span className="text-xs text-gray-500">โดย {by}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
