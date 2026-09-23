'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import api from '@/lib/api';
import AssignSurveyor from '@/components/cases/AssignSurveyor';
import DispatchHistory from '@/components/cases/DispatchHistory';
import CancelJobButton, { canCancelStatus, cancelNotice } from '@/components/cases/CancelJobButton';

/** ข้อมูลเคสที่หน้านี้ใช้เอง (สถานะ/ยกเลิก) — พิกัด/จังหวัดสำหรับจัดลำดับช่าง AssignSurveyor โหลดเองแยก */
interface CaseHead {
  status?: string;
  claim_no?: string | null;
  cancel_reason?: string | null;
  cancelled_by_name?: string | null;
  cancelled_at?: string | null;
}

export default function AssignPage() {
  const params = useParams();
  const caseId = params.id as string;
  /** คอลัมน์ขวา = รายชื่อช่างสำรวจ (15/09/69 user ออกแบบใหม่ ไม่มีแผนที่แล้ว) — AssignSurveyor render เข้ามาทาง portal */
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  /**
   * ยกเลิกงานจากหน้าจ่ายงาน (user สั่ง 23/09/69) — ลูกค้าโทรมาบอกไม่เคลมระหว่างกำลังหาช่าง
   * เคสที่ยกเลิกแล้วซ่อนตัวเลือกช่าง (หลังบ้านไม่ยอมมอบหมายอยู่แล้ว) แล้วบอกว่าใครยกเลิกเพราะอะไร
   */
  const [head, setHead] = useState<CaseHead | null>(null);
  const [notice, setNotice] = useState('');
  const loadHead = useCallback(() => {
    api.get(`/api/cases/${caseId}`)
      .then((res) => { if (res.data?.success && res.data.data) setHead(res.data.data as CaseHead); })
      .catch(() => {});
  }, [caseId]);
  useEffect(() => { loadHead(); }, [loadHead]);

  const cancelled = head?.status === 'cancelled';
  const fmt = (d?: string | null) => (d ? new Date(d).toLocaleString('th-TH', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

  return (
    <div className="max-w-screen-2xl mx-auto">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">มอบหมายช่างสำรวจ</h1>
          <p className="text-gray-500 mt-1">
            เลือกช่างสำรวจสำหรับเคส #{caseId}{head?.claim_no ? ` · เคลม ${head.claim_no}` : ''}
          </p>
        </div>
        {head && canCancelStatus(head.status) && (
          <CancelJobButton
            caseId={Number(caseId)}
            claimNo={head.claim_no}
            status={head.status}
            className="px-3 py-1.5 text-sm"
            onCancelled={(r) => { setNotice(cancelNotice(r, head.claim_no)); loadHead(); }}
          />
        )}
      </div>

      {notice && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{notice}</span>
          <button onClick={() => setNotice('')} className="text-xs font-medium text-amber-700 hover:text-amber-900">ปิด</button>
        </div>
      )}

      {cancelled ? (
        <div className="max-w-2xl rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <p className="font-bold">เคสนี้ยกเลิกแล้ว — มอบหมายช่างไม่ได้</p>
          <p className="mt-1">
            {head?.cancel_reason ? `เหตุผล: ${head.cancel_reason}` : ''}
            {head?.cancelled_by_name ? ` · โดย ${head.cancelled_by_name}` : ''}
            {head?.cancelled_at ? ` · ${fmt(head.cancelled_at)}` : ''}
          </p>
          <p className="mt-1 text-red-700">ถ้าต้องคืนงาน ให้แอดมินกด &quot;เลิกยกเลิก&quot; ที่หน้าเคส</p>
          <Link href="/callcenter/cases" className="mt-2 inline-block text-blue-700 underline">กลับไปรายการเคส</Link>
        </div>
      ) : null}
      {cancelled ? (
        <DispatchHistory caseId={caseId} className="mt-6 max-w-2xl" />
      ) : (
        <>
          <div className="flex items-center mb-8">
            <div className="flex items-center"><div className="w-8 h-8 bg-green-500 text-white rounded-full flex items-center justify-center text-sm">&#10003;</div><span className="ml-2 text-sm font-medium text-green-600">ข้อมูลเคส</span></div>
            <div className="flex-1 mx-4 h-px bg-blue-600"></div>
            <div className="flex items-center"><div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">2</div><span className="ml-2 text-sm font-medium text-blue-600">มอบหมายช่างสำรวจ</span></div>
          </div>

          {/* ซ้าย = ประเภทเคลม/สถานะการมอบหมาย · ขวา = รายชื่อช่างสำรวจ (ติดขอบบนตอนเลื่อนบนจอกว้าง) */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] gap-8 items-start">
            <div className="min-w-0">
              <AssignSurveyor caseId={caseId} listContainer={listEl} />
              {/* ประวัติการจ่ายงาน (22/09/69) — จ่ายให้ใคร/ดึงกลับจากใคร/ใครปฏิเสธ ทั้งสาย ก่อนจ่ายซ้ำ */}
              <DispatchHistory caseId={caseId} className="mt-6" />
            </div>
            <div ref={setListEl} className="min-w-0 xl:sticky xl:top-4" />
          </div>
        </>
      )}
    </div>
  );
}
