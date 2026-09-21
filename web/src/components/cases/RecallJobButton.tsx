'use client';

import { useState } from 'react';
import api from '@/lib/api';

/**
 * ปุ่ม "ดึงงานกลับ" (user สั่ง 22/09/69) — คอลเซ็นเตอร์ถอนงานที่มอบหมายไปแล้วกลับมา "รอมอบหมาย"
 * แล้วเซิร์ฟเวอร์ยิง push ถอนงานไปปิดการ์ด "รับงาน" บนเครื่องช่างคนเดิมให้เอง (เดิมทำได้เฉพาะแอดมินที่หน้าแก้ไขเคส)
 *
 * ⛔ ใช้ได้เฉพาะงานสถานะ "มอบหมายแล้ว" — ช่างกดเสร็จงาน/ส่งงานแล้ว เซิร์ฟเวอร์จะปฏิเสธ (ข้อมูลหน้างานเป็นของช่างคนนั้น)
 * ⛔ ต้องยืนยันก่อนเสมอ — กดพลาดทีเดียวการ์ดบนเครื่องช่างหายและงานหลุดจากมือเขาทันที
 */
export interface RecallResult {
  /** ผลการถอนการ์ดบนเครื่องช่าง: sent = ยิงถึง Google แล้ว · skipped = เครื่องไม่ได้ลงทะเบียน · failed = ส่งไม่สำเร็จ */
  withdrawn?: 'sent' | 'skipped' | 'failed';
  recalled_from?: number | null;
}

interface Props {
  caseId: number;
  claimNo?: string;
  surveyorName?: string;
  onRecalled: (r: RecallResult) => void;
  className?: string;
}

export default function RecallJobButton({ caseId, claimNo, surveyorName, onRecalled, className = '' }: Props) {
  const [busy, setBusy] = useState(false);

  const handle = async (e: React.MouseEvent) => {
    e.stopPropagation();   // แถว "รอมอบหมาย" คลิกแล้วเด้งไปหน้าจ่ายงาน — ปุ่มนี้อยู่บนแถวเดียวกันห้ามลาม
    if (busy) return;
    // เว้นวรรคหลังเลขเคลม — "ดึงเคลม 2026013199030กลับ" อ่านติดกันเป็นเลขเดียว (เจอตอนเทสหน้าจริง 22/09/69)
    const job = claimNo ? `เคลม ${claimNo} ` : 'งานนี้';
    const who = surveyorName ? ` จาก ${surveyorName}` : '';
    if (!window.confirm(`ดึง${job}กลับ${who}?\n\nงานจะกลับไป "รอมอบหมาย" และการ์ดรับงานบนเครื่องช่างจะถูกถอนออก`)) return;
    setBusy(true);
    try {
      const res = await api.post(`/api/cases/${caseId}/recall`);
      if (res.data?.success) onRecalled((res.data.data || {}) as RecallResult);
      else alert(res.data?.message || 'ดึงงานกลับไม่สำเร็จ');
    } catch (err) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      alert(msg || 'ดึงงานกลับไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={handle}
      disabled={busy}
      title="ถอนงานจากช่างคนนี้กลับมารอจ่ายใหม่ — การ์ดรับงานบนเครื่องช่างจะถูกถอนออก"
      className={`px-2.5 py-1 text-xs font-medium border border-amber-600 text-amber-700 rounded hover:bg-amber-50 disabled:opacity-50 transition-colors whitespace-nowrap ${className}`}
    >
      {busy ? 'กำลังดึงกลับ...' : '↩ ดึงงานกลับ'}
    </button>
  );
}

/**
 * ข้อความสรุปหลังดึงกลับ — บอกคนกดว่าการ์ดบนเครื่องช่างถูกถอนหรือเปล่า
 * ถอนไม่ได้ (เครื่องไม่ได้ลงทะเบียนแจ้งเตือน) ต้องบอกให้โทรตาม ไม่งั้นช่างยังเห็นการ์ดค้างแล้ววิ่งไปหน้างานเก้อ
 */
export function recallNotice(r: RecallResult, claimNo?: string, surveyorName?: string): string {
  const job = claimNo ? `เคลม ${claimNo} ` : 'งาน';
  const who = surveyorName ? `${surveyorName} ` : 'ช่าง';
  if (r.withdrawn === 'sent') return `ดึง${job}กลับแล้ว — ถอนการ์ดรับงานบนเครื่อง ${who}แล้ว งานกลับไป "รอมอบหมาย"`;
  return `ดึง${job}กลับแล้ว แต่ถอนการ์ดบนเครื่อง ${who}ไม่ได้ (เครื่องไม่ได้ลงทะเบียนแจ้งเตือน) — โทรแจ้งช่างด้วย ไม่งั้นอาจยังเห็นการ์ดรับงานค้างอยู่`;
}
