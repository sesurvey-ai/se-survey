'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import api from '@/lib/api';
import CaseDetail from '@/components/cases/CaseDetail';
import { confirmLeaveIfDirty } from '@/lib/dirtyGuard';

export default function CaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const caseId = params.id as string;

  const [caseData, setCaseData] = useState(null);
  const [report, setReport] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [review, setReview] = useState(null);
  const [visitCount, setVisitCount] = useState(1);
  /** ครั้งที่ทั้งหมดของเลขเคลมนี้ — แต่ละครั้งเป็นคนละเคส (ดู getDetail) */
  const [visits, setVisits] = useState([]);
  const [expenses, setExpenses] = useState(null);
  /** ครั้งที่ 2+ (15/09/69 แบบ EMCS): ข้อมูลหลักมาจากครั้งที่ 1 — main_from = ใบครั้งที่ 1 · main_locked_fields = ช่องที่ต้องล็อกบนหน้านี้ */
  const [mainFrom, setMainFrom] = useState<{ case_id: number; visit_no: number | null; survey_job_no: string | null; status: string; source: string } | null>(null);
  const [mainLockedFields, setMainLockedFields] = useState<string[]>([]);
  /** ค่ารูปตามกติกาเหมา ที่ backend คิดให้ — null = ตัดสินไม่ได้ ให้คนกรอกเอง */
  const [photoFeeSuggest, setPhotoFeeSuggest] = useState<{count:number;price:number;reason:string}|null>(null);
  /** ตำบลที่มีเรทของตัวเอง — มาจากตารางเรท ไม่ใช่รายชื่อที่เขียนไว้ในหน้าเว็บ */
  const [tumbonOptions, setTumbonOptions] = useState<{tumbon:string;district:string;province:string}[]>([]);
  // ชื่อคนที่มีอักขระซึ่ง EMCS จะล้างค่าทั้งช่องทิ้งตอนหัวหน้าคลิกโดน (backend คำนวณให้)
  const [nameWarnings, setNameWarnings] = useState<
    { tag: string; label: string; value: string; bad: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  /**
   * ⛔ โชว์ "กำลังโหลด" เต็มหน้า **เฉพาะครั้งแรก** เท่านั้น
   *
   * เดิม refetch ทุกครั้ง (หลังบันทึก · หลังอัปรูป · หลังตีกลับ) ตั้ง loading=true
   * ทำให้ทั้งหน้าถูกถอดออกจากจอชั่วขณะ แล้ว <CaseDetail> ถูกสร้างใหม่ทั้งก้อน
   * → ทุกช่องกลับไปเป็นค่าที่บันทึกไว้ และ state ของคู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน/
   *   ความเสียหาย ถูก init ใหม่ = **สิ่งที่หัวหน้าพิมพ์ค้างไว้หายทั้งหน้าโดยไม่มีอะไรถาม**
   *   (เจอง่ายสุดตอนอัปรูปเพิ่ม ซึ่งการ์ดรูปชวนให้ทำอยู่แล้วด้วยป้าย "รูปน้อยผิดปกติ")
   */
  const firstLoad = useRef(true);
  const fetchDetail = useCallback(async () => {
    try {
      if (firstLoad.current) setLoading(true);
      const res = await api.get(`/api/cases/${caseId}/detail`);
      if (res.data.success) {
        setCaseData(res.data.data.case);
        setReport(res.data.data.report || null);
        setPhotos(res.data.data.photos || []);
        setReview(res.data.data.review || null);
        setVisitCount(res.data.data.visit_count || 1);
        setVisits(res.data.data.visits || []);
        setExpenses(res.data.data.expenses || null);
        setMainFrom(res.data.data.main_from || null);
        setMainLockedFields(res.data.data.main_locked_fields || []);
        setPhotoFeeSuggest(res.data.data.photo_fee_suggest || null);
        setTumbonOptions(res.data.data.tumbon_options || []);
        setNameWarnings(res.data.data.emcs_name_warnings || []);
      }
    } catch { setError('ไม่สามารถโหลดข้อมูลเคสได้'); }
    finally { setLoading(false); firstLoad.current = false; }
  }, [caseId]);

  useEffect(() => { if (caseId) fetchDetail(); }, [caseId, fetchDetail]);

  // เอาแถบ "คิวตรวจวันนี้" ออกจากหน้านี้แล้ว (user เคาะ 18/08/69) — ตัวเลขชุดเดียวกัน
  // มีอยู่ที่หน้ารายการงานอยู่แล้ว ซ้ำสองที่ = พื้นที่หายไปเปล่า ๆ บนหน้าที่ยาวอยู่แล้ว
  // (ตัวคิดเลขยังอยู่ที่ reviewQueue.ts หน้ารายการงานใช้อยู่)

  // ดาวน์โหลด INSERT_SURV_REPORT_XML เพื่อ import เข้าพอร์ทัลประกัน
  const [xmlBusy, setXmlBusy] = useState(false);
  const downloadXml = async () => {
    try {
      setXmlBusy(true);
      const res = await api.get(`/api/cases/${caseId}/export-xml`, { responseType: 'blob' });
      const claim = (report as { claim_no?: string } | null)?.claim_no || caseId;
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url; a.download = `survey_${claim}.xml`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { setError('สร้างไฟล์ XML ไม่สำเร็จ (เคสนี้อาจยังไม่มีข้อมูลรายงาน)'); }
    finally { setXmlBusy(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-gray-500">กำลังโหลดข้อมูลเคส...</div></div>;
  if (error || !caseData) return (
    <div>
      <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-none mb-4">{error || 'ไม่พบข้อมูลเคส'}</div>
      <button onClick={() => router.push('/inspector')} className="text-blue-600 hover:text-blue-800 text-sm">กลับไปรายการงาน</button>
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex items-center gap-4">
        {/* ⛔ ถามก่อนถ้ายังมีของพิมพ์ค้าง — router.push ไม่ยิง beforeunload
            จึงต้องถามเองที่นี่ (ธงตั้งจากฟอร์มใน CaseDetail) */}
        <button onClick={() => { if (confirmLeaveIfDirty()) router.push('/inspector'); }}
          className="text-[var(--md-muted-2)] hover:text-[var(--md-ink)]">&larr; กลับ</button>
        {/* เลขเคสเป็นสีน้ำเงินตัวเดียวในหัวเรื่อง — ที่หมายตาเวลาเปิดหลายแท็บ (แบบ Modernist) */}
        <h1 className="text-2xl font-extrabold tracking-tight text-[var(--md-ink)]">
          รายละเอียดเคส <span className="text-[var(--md-blue-strong)]">#{(caseData as { id: number }).id}</span>
        </h1>
        {report && (
          <button onClick={downloadXml} disabled={xmlBusy}
            className="ml-auto inline-flex items-center gap-2 px-4 h-9 bg-white border border-[var(--md-ink)] text-[var(--md-ink)] text-sm font-bold hover:bg-[var(--md-tint)] disabled:opacity-50 transition-colors"
            title="สร้างไฟล์ XML สำหรับ import เข้าพอร์ทัลประกัน">
            {xmlBusy ? 'กำลังสร้าง...' : '⬇ ดาวน์โหลด XML (นำเข้าประกัน)'}
          </button>
        )}
      </div>
      {nameWarnings.length > 0 && (
        <div className="mb-4 rounded-none border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-semibold text-amber-900">
            ⚠️ {nameWarnings.length} ช่องมีอักขระที่ EMCS ไม่รับ (ทะเบียนรถ: บอทตัดเครื่องหมาย/คำพ่วงให้เองตามที่แสดงหลัง →)
          </p>
          <p className="mt-1 text-xs text-amber-800">
            EMCS จะ<strong>ลบข้อความทั้งช่องทิ้ง</strong>ทันทีที่มีคนคลิกเข้า-ออกช่องนั้น
            (ไม่ใช่แค่ตัดอักขระ) แก้ที่นี่ก่อนส่งเข้า EMCS — ใช้ได้เฉพาะตัวอักษร ตัวเลข เว้นวรรค จุด และขีดกลาง
          </p>
          <ul className="mt-2 space-y-1">
            {nameWarnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-900">
                <span className="font-medium">{w.label}</span>
                <span className="mx-1 text-amber-700">—</span>
                <span className="rounded-none bg-white px-1 py-0.5 font-mono">{w.value}</span>
                <span className="ml-1 text-amber-700">(อักขระที่มีปัญหา: <strong>{w.bad}</strong>)</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <CaseDetail caseData={caseData} report={report} photos={photos} review={review} visitCount={visitCount} visits={visits} expenses={expenses} photoFeeSuggest={photoFeeSuggest} tumbonOptions={tumbonOptions} mainFrom={mainFrom} mainLockedFields={mainLockedFields} onReviewSubmitted={fetchDetail} />
    </div>
  );
}
