'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import AssignSurveyor from '@/components/cases/AssignSurveyor';

export default function AssignPage() {
  const params = useParams();
  const caseId = params.id as string;
  /** คอลัมน์ขวา = รายชื่อช่างสำรวจ (15/09/69 user ออกแบบใหม่ ไม่มีแผนที่แล้ว) — AssignSurveyor render เข้ามาทาง portal */
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);

  return (
    <div className="max-w-screen-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">มอบหมายช่างสำรวจ</h1>
        <p className="text-gray-500 mt-1">เลือกช่างสำรวจสำหรับเคส #{caseId}</p>
      </div>

      <div className="flex items-center mb-8">
        <div className="flex items-center"><div className="w-8 h-8 bg-green-500 text-white rounded-full flex items-center justify-center text-sm">&#10003;</div><span className="ml-2 text-sm font-medium text-green-600">ข้อมูลเคส</span></div>
        <div className="flex-1 mx-4 h-px bg-blue-600"></div>
        <div className="flex items-center"><div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-sm font-medium">2</div><span className="ml-2 text-sm font-medium text-blue-600">มอบหมายช่างสำรวจ</span></div>
      </div>

      {/* ซ้าย = ประเภทเคลม/สถานะการมอบหมาย · ขวา = รายชื่อช่างสำรวจ (ติดขอบบนตอนเลื่อนบนจอกว้าง) */}
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] gap-8 items-start">
        <div className="min-w-0">
          <AssignSurveyor caseId={caseId} listContainer={listEl} />
        </div>
        <div ref={setListEl} className="min-w-0 xl:sticky xl:top-4" />
      </div>
    </div>
  );
}
