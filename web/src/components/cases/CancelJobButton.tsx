'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '@/lib/api';

/**
 * ปุ่ม "ยกเลิกงาน" ของคอลเซ็นเตอร์ (user สั่ง 23/09/69) — เช่น ลูกค้าโทรมาบอกไม่ติดใจ ไม่เคลม / แจ้งซ้ำ / บริษัทประกันยกเลิกงาน
 * เดิมหลังบ้านอนุญาตคอลเซ็นเตอร์แล้ว (POST /api/cases/:id/cancel) แต่หน้าจอคอลเซ็นเตอร์ไม่มีปุ่ม ต้องรอหัวหน้ากดที่หน้าตรวจเคส
 *
 * กติกาเดียวกับหน้าตรวจเคส (caseService.cancelCase):
 *   - ยกเลิกได้ทุกสถานะที่ยังไม่อนุมัติ · อนุมัติแล้วต้องให้แอดมินปลดล็อกก่อน
 *   - ต้องบอกเหตุผล · กดยืนยันในหน้าต่างนี้อีกครั้งก่อนยิงจริง
 *   - งานที่อยู่กับช่าง (มอบหมายแล้ว/เสร็จงานหน้างาน) → เซิร์ฟเวอร์ถอนการ์ดบนเครื่องช่างให้เอง
 *   - เลิกยกเลิกได้เฉพาะแอดมิน (หน้าตรวจเคส)
 *
 * ⛔ หน้าต่างเปิดผ่าน portal แต่ event ของ React ยังไหลขึ้นแถวตาราง (แถว "รอมอบหมาย" คลิกแล้วไปหน้าจ่ายงาน)
 *    จึงต้อง stopPropagation ทั้งที่ปุ่มและที่หน้าต่าง
 */
export const CANCELLABLE_STATUSES = ['pending', 'assigned', 'finished', 'surveyed', 'declined'] as const;
export const canCancelStatus = (status?: string | null): boolean =>
  (CANCELLABLE_STATUSES as readonly string[]).includes(String(status ?? ''));

export interface CancelResult {
  /** ผลการถอนการ์ดบนเครื่องช่าง: sent = ยิงถึง Google แล้ว · skipped = เครื่องไม่ได้ลงทะเบียน · failed = ส่งไม่สำเร็จ · ไม่มี = งานไม่ได้อยู่กับช่าง */
  withdrawn?: 'sent' | 'skipped' | 'failed';
  status_before_cancel?: string;
  cancel_reason?: string;
}

interface Props {
  caseId: number;
  claimNo?: string | null;
  status?: string | null;
  /** ช่างที่ถืองานอยู่ — บอกในหน้าต่างว่าการ์ดบนเครื่องใครจะถูกถอน */
  surveyorName?: string;
  onCancelled: (r: CancelResult) => void;
  className?: string;
}

export default function CancelJobButton({ caseId, claimNo, status, surveyorName, onCancelled, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const close = () => { if (!busy) { setOpen(false); setReason(''); setErr(''); } };
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const withSurveyor = status === 'assigned' || status === 'finished';
  const job = claimNo ? `เคลม ${claimNo}` : `เคส #${caseId}`;

  const submit = async () => {
    const text = reason.trim();
    if (!text) { setErr('ต้องบอกเหตุผลที่ยกเลิก'); return; }
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const res = await api.post(`/api/cases/${caseId}/cancel`, { reason: text });
      if (res.data?.success) {
        setOpen(false); setReason('');
        onCancelled((res.data.data || {}) as CancelResult);
      } else setErr(res.data?.message || 'ยกเลิกไม่สำเร็จ');
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setErr(msg || 'ยกเลิกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const dialog = open ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { e.stopPropagation(); close(); }}>
      <div role="dialog" aria-modal="true" aria-label={`ยกเลิกงาน ${job}`}
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl text-left"
        onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-gray-900">ยกเลิกงาน {job}</h3>
        <ul className="mt-2 space-y-1 text-sm text-gray-600 list-disc pl-5">
          <li>ยกเลิกแล้วเคสอ่านอย่างเดียว ไม่เข้าคิวตรวจ ไม่เข้า EMCS และไม่ส่ง se-billing</li>
          {withSurveyor && (
            <li className="text-amber-800">
              งานนี้อยู่กับช่าง{surveyorName ? ` ${surveyorName}` : ''} — การ์ดงานบนเครื่องช่างจะถูกถอนออกให้
            </li>
          )}
          <li>ต้องการคืนงานภายหลัง ให้แอดมินกด &quot;เลิกยกเลิก&quot; ที่หน้าเคส</li>
        </ul>
        <label className="mt-4 block text-sm font-medium text-gray-800" htmlFor={`cancel-reason-${caseId}`}>เหตุผลที่ยกเลิก</label>
        <input id={`cancel-reason-${caseId}`} type="text" autoFocus value={reason}
          onChange={(e) => { setReason(e.target.value); if (err) setErr(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit(); } }}
          placeholder="เช่น ลูกค้าไม่ติดใจ ไม่เคลม / แจ้งซ้ำ / บริษัทประกันยกเลิกงาน"
          className="mt-1 w-full rounded border border-red-300 px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-red-400" />
        {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={close} disabled={busy}
            className="px-4 py-2 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-100 disabled:opacity-50">
            ปิด
          </button>
          <button type="button" onClick={() => void submit()} disabled={busy || !reason.trim()}
            className="px-4 py-2 text-sm font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? 'กำลังยกเลิก...' : 'ยืนยันยกเลิกงาน'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button type="button"
        onClick={(e) => { e.stopPropagation(); setErr(''); setOpen(true); }}
        title="ยกเลิกงานนี้ เช่น ลูกค้าไม่ติดใจ ไม่เคลม — ต้องบอกเหตุผล · แอดมินเลิกยกเลิกคืนได้"
        className={`px-2.5 py-1 text-xs font-medium border border-red-600 text-red-700 rounded hover:bg-red-50 transition-colors whitespace-nowrap ${className}`}>
        ✕ ยกเลิกงาน
      </button>
      {dialog && typeof document !== 'undefined' ? createPortal(dialog, document.body) : null}
    </>
  );
}

/**
 * ข้อความสรุปหลังยกเลิก — บอกคนกดว่าการ์ดบนเครื่องช่างถูกถอนหรือเปล่า
 * ถอนไม่ได้ = ต้องโทรบอกช่าง ไม่งั้นช่างยังเห็นการ์ดค้างแล้ววิ่งไปหน้างานเก้อ (แบบเดียวกับ "ดึงงานกลับ")
 */
export function cancelNotice(r: CancelResult, claimNo?: string | null, surveyorName?: string): string {
  const job = claimNo ? `เคลม ${claimNo} ` : 'งาน';
  const who = surveyorName ? `${surveyorName} ` : 'ช่าง';
  if (r.withdrawn === 'sent') return `ยกเลิก${job}แล้ว — ถอนการ์ดงานบนเครื่อง ${who}แล้ว`;
  if (r.withdrawn === 'skipped') return `ยกเลิก${job}แล้ว แต่ถอนการ์ดบนเครื่อง ${who}ไม่ได้ (เครื่องไม่ได้ลงทะเบียนแจ้งเตือน) — โทรแจ้งช่างด้วย`;
  if (r.withdrawn === 'failed') return `ยกเลิก${job}แล้ว แต่ส่งคำสั่งถอนการ์ดไปเครื่อง ${who}ไม่สำเร็จ — โทรแจ้งช่างด้วย`;
  return `ยกเลิก${job}แล้ว`;
}
