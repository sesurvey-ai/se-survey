'use client';

import React, { useState, useRef, useCallback, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';
import AssignSurveyor from '@/components/cases/AssignSurveyor';

// ป้ายภาษาไทยของ 5 ฟิลด์จาก OCR (flipped) — ใช้ในแบนเนอร์ "ให้ตรวจสอบ"
const OCR_FIELD_LABELS: Record<string, string> = {
  claim_ref_no: 'เลขรับแจ้ง', claim_no: 'เลขเคลม', prb_number: 'เลขพรบ', survey_job_no: 'เลขเซอร์เวย์', survey_job_no_2: 'เลขเซอร์เวย์ งาน 2', policy_no: 'เลขกรมธรรม์', chassis_no: 'เลขตัวถัง', incident_location: 'สถานที่เกิดเหตุ', acc_customer_report_date: 'ลูกค้าแจ้ง (วันที่รับแจ้ง)', reporter_phone: 'เบอร์โทรผู้แจ้งเหตุ', driver_phone: 'เบอร์โทรผู้ขับขี่',
};

/**
 * "ลูกค้าแจ้ง" (วันเวลารับแจ้ง) — **บังคับกรอก** (user สั่ง 22/09/69): ไทม์ไลน์งานบนแอป/EMCS เริ่มจากจุดนี้
 * เคสที่กรอกเองโดยไม่ OCR หน้าการ์ด เดิมช่องนี้ว่างได้ → ไทม์ไลน์ "ลูกค้าแจ้ง" ของช่างว่าง (เคลม 777 ที่ user เจอ)
 * เก็บรูปแบบเดียวกับ OCR = "วว/ดด/พพพพ|ชช:นน" (พ.ศ.) — ตัวอ่านบนแอป (splitDT) และ XML/EMCS ใช้ค่านี้ตรง ๆ
 * ฟอร์มแยกเป็น 2 ช่อง (วัน · เวลา) แล้วรวมกลับตอนเก็บ · OCR เติมค่ารวมมาให้ก็แยกโชว์ได้
 */
const splitReportDT = (v: string): [string, string] => {
  const [d = '', t = ''] = (v || '').split('|');
  return [d, t];
};
const joinReportDT = (d: string, t: string) => (d.trim() || t.trim()) ? `${d.trim()}|${t.trim()}` : '';
/** ตรวจ + จัดรูป (เติม 0 ให้ครบ) — คืน null ถ้าไม่ครบ/ไม่ใช่ พ.ศ./เวลาเกินช่วง */
const normalizeReportDT = (v: string): string | null => {
  const [d, t] = splitReportDT(v);
  const md = d.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const mt = t.trim().match(/^(\d{1,2})[:.](\d{2})$/);
  if (!md || !mt) return null;
  const [dd, mm, yyyy] = [Number(md[1]), Number(md[2]), Number(md[3])];
  const [hh, mi] = [Number(mt[1]), Number(mt[2])];
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12 || yyyy < 2500 || yyyy > 2700 || hh > 23 || mi > 59) return null;
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(dd)}/${p2(mm)}/${yyyy}|${p2(hh)}:${p2(mi)}`;
};
/** เวลาปัจจุบันของเครื่องคนกรอก (คอลเซ็นเตอร์อยู่ไทย) — ปุ่ม "ตอนนี้" สำหรับลูกค้าที่เพิ่งโทรแจ้ง */
const nowReportDT = () => {
  const n = new Date();
  const p2 = (x: number) => String(x).padStart(2, '0');
  return `${p2(n.getDate())}/${p2(n.getMonth() + 1)}/${n.getFullYear() + 543}|${p2(n.getHours())}:${p2(n.getMinutes())}`;
};

// บริษัทประกันที่รองรับ (เพิ่มบริษัทใหม่ = เพิ่ม entry) — value ต้องตรงกับที่ใช้เช็คเงื่อนไขฟอร์มด้านล่าง
// logo = path ใน public (วางไฟล์ที่ web/public/insurance/*.png); ถ้าไฟล์ไม่มีจะ fallback เป็นตัวย่อ (code)
const INSURANCE_COMPANIES: { value: string; name: string; sub?: string; logo: string; code: string; disabled?: boolean }[] = [
  { value: 'บริษัท ไทยไพบูลย์ประกันภัย จำกัด (มหาชน)', name: 'ไทยไพบูลย์ประกันภัย', sub: 'จำกัด (มหาชน)', logo: '/insurance/tpb.png', code: 'TPB' },
  { value: 'ไอโออิกรุงเทพประกันภัย', name: 'ไอโออิ กรุงเทพประกันภัย', logo: '/insurance/aioi.png', code: 'AIOI' },
];

export default function NewCasePage() {
  const router = useRouter();
  const { socket } = useSocket();
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // หลังสร้างเคสสำเร็จ — แสดงส่วนมอบหมายช่างสำรวจ inline ในหน้าเดียวกัน (ไม่ต้องเปลี่ยนหน้า)
  const [createdCaseId, setCreatedCaseId] = useState<number | null>(null);
  const assignRef = useRef<HTMLDivElement>(null);
  /** คอลัมน์ขวาของหน้า (15/09/69 user ออกแบบใหม่): รายชื่อช่างสำรวจไป render ในนี้ ส่วนรายละเอียดงานอยู่ซ้าย · ไม่มีแผนที่แล้ว */
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (createdCaseId !== null) assignRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [createdCaseId]);

  const [customerName, setCustomerName] = useState('');
  const [insuranceCompany, setInsuranceCompany] = useState('');
  const [incidentLocation, setIncidentLocation] = useState('');
  // มีบริษัทที่เปิดใช้เพียงบริษัทเดียว → เลือกให้อัตโนมัติ (ฟอร์มโผล่ทันที ไม่ต้องกดเลือกซ้ำ)
  useEffect(() => {
    const active = INSURANCE_COMPANIES.filter(c => !c.disabled);
    if (active.length === 1) setInsuranceCompany(prev => prev || active[0].value);
  }, []);

  const [form, setForm] = useState<Record<string, string>>({});
  const f = (key: string) => form[key] || '';
  const s = (key: string, v: string) => setForm(prev => ({ ...prev, [key]: v }));
  /** ข้อความเตือนใต้ช่อง "ลูกค้าแจ้ง" — ล้างทันทีที่แก้ */
  const [reportDTError, setReportDTError] = useState('');
  const [reportDate, reportTime] = splitReportDT(f('acc_customer_report_date'));
  const setReportDT = (d: string, t: string) => { setReportDTError(''); s('acc_customer_report_date', joinReportDT(d, t)); };

  // OCR state
  // ไทยไพบูลย์เท่านั้นที่มีเลขเรื่องเซอร์เวย์บนใบรับแจ้ง — ไอโออิไม่มี
  const isTPB = insuranceCompany === 'บริษัท ไทยไพบูลย์ประกันภัย จำกัด (มหาชน)';
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrDone, setOcrDone] = useState(false);
  const [ocrPreview, setOcrPreview] = useState<string | null>(null);
  const [ocrImages, setOcrImages] = useState<string[]>([]);   // URL รูปที่อัปโหลด (แสดงทั้งใบแทนตาราง)
  const [ocrRaw, setOcrRaw] = useState('');
  const [showOcrRaw, setShowOcrRaw] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ocrImagePaths, setOcrImagePaths] = useState<string[]>([]);
  // ผลความมั่นใจจาก flipped OCR (ไว้ไฮไลต์/เตือนให้ตรวจ)
  const [ocrReview, setOcrReview] = useState<{ review_needed: boolean; confidence: Record<string, string> } | null>(null);

  // append mode: ข้อมูลใหม่เติมเฉพาะช่องที่ยังว่าง
  const handleOcrUpload = async (file: File, append = false) => {
    setError('');
    setOcrLoading(true);
    const previewUrl = URL.createObjectURL(file);
    setOcrPreview(previewUrl);
    setOcrImages(prev => (append ? [...prev, previewUrl] : [previewUrl]));
    try {
      const formData = new FormData();
      formData.append('image', file);
      /**
       * บอกตัวอ่านด้วยว่าเป็นการ์ดของบริษัทไหน — ใบไทยไพบูลย์กับการ์ดไอโออิคนละหน้าตา
       * และเลขคนละรูปแบบ (มีตัวอักษรคั่น vs ตัวเลขล้วน) ใช้ชุดตรวจข้ามกันตกทุกเลข
       */
      formData.append('insurer', INSURANCE_COMPANIES.find(c => c.value === insuranceCompany)?.code || 'TPB');
      // flipped pipeline (Gemini + Vision) — เร็ว/แม่น ดึง 5 เลขสำคัญ + confidence
      const res = await api.post('/api/ocr/claim', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      if (res.data.success && res.data.data) {
        const { fields, confidence, review_needed, savedImage } = res.data.data as {
          fields: Record<string, string>; confidence?: Record<string, string>;
          review_needed?: boolean; savedImage?: string;
        };
        if (savedImage) setOcrImagePaths(prev => [...prev, savedImage]);
        setOcrReview({ review_needed: !!review_needed, confidence: confidence || {} });
        // flipped ไม่มี markdown ดิบ → สรุปฟิลด์+ความมั่นใจไว้ใน "ดู OCR Raw"
        const summary = Object.entries(fields || {}).map(([k, v]) => `${OCR_FIELD_LABELS[k] || k}: ${v}  [${confidence?.[k] || '-'}]`).join('\n');
        setOcrRaw(prev => append ? prev + '\n---\n' + summary : summary);
        const newForm: Record<string, string> = {};
        for (const [key, val] of Object.entries(fields || {})) {
          if (val && typeof val === 'string' && val.trim()) {
            if (key === 'incident_location') continue; // เก็บใน state แยก → ส่งผ่าน payload.incident_location
            newForm[key] = val.trim();
          }
        }
        // สถานที่เกิดเหตุ (OCR) → state (โชว์บนการ์ดงานมือถือ) — append: ไม่ทับค่าที่มีอยู่
        const ocrLoc = (fields?.incident_location || '').trim();
        if (ocrLoc) setIncidentLocation(prev => (append && prev.trim()) ? prev : ocrLoc);
        if (append) {
          // เติมเฉพาะช่องที่ยังว่าง
          setForm(prev => {
            const merged = { ...prev };
            for (const [key, val] of Object.entries(newForm)) {
              if (!merged[key] || !merged[key].trim()) {
                merged[key] = val;
              }
            }
            return merged;
          });
        } else {
          setForm(prev => ({ ...prev, ...newForm }));
        }
        setOcrDone(true);
      } else {
        setError(res.data.message || 'ไม่สามารถอ่านข้อมูลจากรูปได้');
      }
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { message?: string } } };
      setError(ax.response?.data?.message || 'เกิดข้อผิดพลาดในการอ่าน OCR กรุณาลองใหม่');
    } finally {
      setOcrLoading(false);
    }
  };

  const [appendMode, setAppendMode] = useState(false);
  const appendFileRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleOcrUpload(file);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleOcrUpload(file, appendMode);
    setAppendMode(false);
  };

  const handleAppendFile = () => {
    setAppendMode(true);
    appendFileRef.current?.click();
  };

  const handleAppendCapture = () => {
    setAppendMode(true);
    handleScreenCapture();
  };

  const resetOcr = () => {
    setOcrDone(false);
    setOcrReview(null);
    setOcrPreview(null);
    setOcrImages([]);
    setForm({});
    setCustomerName('');
    setIncidentLocation('');
    setOcrImagePaths([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Screen capture + multi-crop state
  type CropRect = { x: number; y: number; w: number; h: number };
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const [cropStart, setCropStart] = useState<{ x: number; y: number } | null>(null);
  const [cropEnd, setCropEnd] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [savedCrops, setSavedCrops] = useState<CropRect[]>([]);
  const capturedImgRef = useRef<HTMLImageElement | null>(null);

  const handleScreenCapture = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor' } as MediaTrackConstraints });
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();
      await new Promise(r => setTimeout(r, 300));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')!.drawImage(video, 0, 0);
      stream.getTracks().forEach(t => t.stop());
      setCapturedImage(canvas.toDataURL('image/png'));
      setCropping(true);
      setCropStart(null);
      setCropEnd(null);
      setSavedCrops([]);
    } catch {
      // user cancelled
    }
  }, []);

  const getCropRect = (): CropRect | null => {
    if (!cropStart || !cropEnd) return null;
    const r = {
      x: Math.min(cropStart.x, cropEnd.x),
      y: Math.min(cropStart.y, cropEnd.y),
      w: Math.abs(cropEnd.x - cropStart.x),
      h: Math.abs(cropEnd.y - cropStart.y),
    };
    return r.w > 20 && r.h > 20 ? r : null;
  };

  // บันทึกส่วนที่เลือก แล้วเลือกส่วนถัดไปได้
  const handleAddCrop = () => {
    const rect = getCropRect();
    if (rect) {
      setSavedCrops(prev => [...prev, rect]);
      setCropStart(null);
      setCropEnd(null);
    }
  };

  // ลบส่วนที่เลือกล่าสุด
  const handleUndoCrop = () => {
    setSavedCrops(prev => prev.slice(0, -1));
  };

  // รวมทุกส่วนที่เลือกเป็นรูปเดียว แล้วส่ง OCR
  const handleCropConfirm = useCallback(async () => {
    if (!capturedImgRef.current) return;
    const img = capturedImgRef.current;
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;

    // รวม crop ปัจจุบัน (ถ้ามี) กับที่บันทึกไว้
    const currentRect = getCropRect();
    const allCrops = [...savedCrops];
    if (currentRect) allCrops.push(currentRect);
    if (allCrops.length === 0) return;

    // รวมทุกส่วนเป็นรูปเดียว (ต่อแนวตั้ง)
    const GAP = 10;
    const scaledCrops = allCrops.map(r => ({
      sx: r.x * scaleX, sy: r.y * scaleY,
      sw: r.w * scaleX, sh: r.h * scaleY,
    }));
    const maxW = Math.max(...scaledCrops.map(c => c.sw));
    const totalH = scaledCrops.reduce((sum, c) => sum + c.sh, 0) + GAP * (scaledCrops.length - 1);

    const canvas = document.createElement('canvas');
    canvas.width = maxW;
    canvas.height = totalH;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let offsetY = 0;
    for (const c of scaledCrops) {
      ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, offsetY, c.sw, c.sh);
      offsetY += c.sh + GAP;
    }

    canvas.toBlob(async (blob) => {
      if (!blob) return;
      setCropping(false);
      setCapturedImage(null);
      setSavedCrops([]);
      const file = new File([blob], 'capture.png', { type: 'image/png' });
      handleOcrUpload(file, appendMode);
      setAppendMode(false);
    }, 'image/png');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropStart, cropEnd, savedCrops, appendMode]);

  const handleCropCancel = () => {
    setCropping(false);
    setCapturedImage(null);
    setCropStart(null);
    setCropEnd(null);
    setSavedCrops([]);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    // "ลูกค้าแจ้ง" บังคับ (22/09/69) — ไม่ครบ/ไม่ใช่ พ.ศ. ไม่ให้ส่ง (เซิร์ฟเวอร์ก็กันซ้ำอีกชั้นใน createCaseSchema)
    const reportDT = normalizeReportDT(f('acc_customer_report_date'));
    if (!reportDT) {
      setReportDTError('กรอกวันที่ (วว/ดด/พพพพ เป็น พ.ศ.) และเวลา (ชช:นน) ที่ลูกค้าแจ้งให้ครบ หรือกด "ตอนนี้"');
      setError('ยังไม่ได้กรอก "ลูกค้าแจ้ง" (วันเวลารับแจ้ง) — ใช้เป็นจุดเริ่มไทม์ไลน์งานของช่าง');
      document.getElementById('acc_customer_report_date')?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        customer_name: customerName,
        incident_location: incidentLocation,
      };
      if (insuranceCompany) payload.insurance_company = insuranceCompany;
      if (ocrImagePaths.length > 0) payload.ocr_image_paths = ocrImagePaths;
      for (const [key, val] of Object.entries(form)) {
        if (val.trim()) {
          // ช่องที่ฐานข้อมูลเก็บเป็นตัวเลข — ฟอร์มถือทุกค่าเป็นข้อความ ต้องแปลงก่อนส่ง
          // (พิกัดมาจากการ์ดไอโออิเป็นข้อความ ส่งดิบ ๆ แล้วโดนตีกลับ "Expected number")
          payload[key] = key === 'deductible' ? (parseFloat(val) || 0)
            : (key === 'incident_lat' || key === 'incident_lng') ? parseFloat(val)
            : val.trim();
        }
      }
      payload.acc_customer_report_date = reportDT;   // ค่าที่จัดรูปแล้ว (เติม 0) ทับของดิบจากฟอร์ม
      const res = await api.post('/api/cases', payload);
      if (res.data.success && res.data.data) {
        const newCaseId = res.data.data.id;
        if (socket) {
          socket.emit('request_location', { request_id: String(newCaseId) });
        }
        // แสดงส่วนมอบหมายช่างสำรวจ inline ใต้ฟอร์ม (แทนการเปลี่ยนไปอีกหน้า)
        setCreatedCaseId(newCaseId);
      } else {
        setError(res.data.message || 'ไม่สามารถสร้างเคสได้');
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string; errors?: Record<string, string[]> } } };
      const fieldErrors = axiosErr.response?.data?.errors;
      if (fieldErrors) {
        const details = Object.entries(fieldErrors).map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`).join('; ');
        setError(`ข้อมูลไม่ถูกต้อง: ${details}`);
      } else {
        setError(axiosErr.response?.data?.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    // ขั้นกรอกข้อมูล: กว้าง 4xl กลางจอ (ฟอร์มอ่านง่าย) · ขั้นมอบหมาย (15/09/69 user ออกแบบใหม่): กางเต็มจอ
    // ซ้าย = รายละเอียดงาน + ประเภทเคลม · ขวา = รายชื่อช่างสำรวจ · ไม่มีแผนที่ (ซ้ำกับเมนู "พนักงานทั้งหมด")
    <div className={createdCaseId !== null ? 'max-w-screen-2xl mx-auto' : 'max-w-4xl mx-auto'}>
      <div className="flex items-center mb-6">
        <div className="flex items-center">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${createdCaseId !== null ? 'bg-green-500 text-white' : 'bg-blue-600 text-white'}`}>{createdCaseId !== null ? '✓' : '1'}</div>
          <span className={`ml-2 text-sm font-medium ${createdCaseId !== null ? 'text-green-600' : 'text-blue-600'}`}>ข้อมูลเคส</span>
        </div>
        <div className={`flex-1 mx-4 h-px ${createdCaseId !== null ? 'bg-blue-600' : 'bg-gray-200'}`}></div>
        <div className="flex items-center">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${createdCaseId !== null ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-400'}`}>2</div>
          <span className={`ml-2 text-sm font-medium ${createdCaseId !== null ? 'text-blue-600' : 'text-gray-400'}`}>มอบหมาย</span>
        </div>
      </div>

      <div className={createdCaseId !== null ? 'grid grid-cols-1 xl:grid-cols-[minmax(0,52rem)_minmax(0,1fr)] gap-8 items-start' : ''}>
      <div className="min-w-0">
      <form onSubmit={handleSubmit}>
        {/* หลังสร้างเคสแล้ว ล็อกฟอร์มไว้เป็นข้อมูลอ้างอิง (แก้ไม่ได้) */}
        <fieldset disabled={createdCaseId !== null} className="min-w-0 border-0 p-0 m-0">
        {error && <div className="text-red-600 text-xs mb-3 bg-red-50 px-3 py-2 rounded">{error}</div>}

        {/* บริษัทประกัน — ด้านบนตาราง */}
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-500 mb-1">บริษัทประกัน</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {INSURANCE_COMPANIES.map(co => {
              const selected = insuranceCompany === co.value;
              return (
                <button key={co.value} type="button" disabled={co.disabled}
                  onClick={() => setInsuranceCompany(co.value)}
                  className={`relative flex items-center gap-3 text-left rounded-xl p-3 transition-colors ${
                    co.disabled ? 'border border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
                      : selected ? 'border-2 border-blue-600 bg-blue-50/40'
                      : 'border border-gray-300 bg-white hover:bg-gray-50'}`}>
                  <span className="flex-none w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center overflow-hidden">
                    <img src={co.logo} alt="" className="w-10 h-10 object-contain"
                      onError={e => { e.currentTarget.style.display = 'none'; const fb = e.currentTarget.nextElementSibling as HTMLElement | null; if (fb) fb.style.display = 'flex'; }} />
                    <span className="hidden w-full h-full items-center justify-center text-blue-700 text-xs font-medium">{co.code}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-gray-900 truncate">{co.name}</span>
                    {co.sub && <span className="block text-xs text-gray-400 truncate">{co.sub}</span>}
                    {co.disabled && <span className="block text-[11px] text-amber-600">เร็วๆ นี้</span>}
                  </span>
                  {selected && (
                    <svg className="absolute top-2 right-2 w-5 h-5 text-blue-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.3 3.3 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" /></svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/**
          * ฟอร์มกรอกหลัก + อ่านจากรูป — **ใช้ร่วมกันทั้ง 2 บริษัท**
          * เดิมไอโออิมีตารางของตัวเอง 27 ช่อง ซึ่งซ้ำซ้อนกับหน้าตรวจที่แก้ได้ครบอยู่แล้ว
          * (user เคาะ 23/08/69: ทำแบบเดียวกับไทยไพบูลย์ ใช้ฟิลด์ที่มีอยู่พอ)
          * ต่างกันจุดเดียวคือ **ไอโออิไม่มีเลขเรื่องเซอร์เวย์บนการ์ด** — ดูที่ isTPB
          */}
        {insuranceCompany !== '' && (
          <>
            {/* ช่องกรอกข้อมูลหลัก — แสดงเสมอ */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">เลขเคลม</label>
                <input value={f('claim_no')} onChange={e => s('claim_no', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="กรอกเลขเคลม" />
              </div>
              {/* ไอโออิไม่มีเลขนี้บนการ์ด (มีบางใบ อ่านได้ก็ใส่ให้ แต่ไม่ต้องมีช่องให้กรอกมือ)
                  เคสที่ไม่มีเลขเซอร์เวย์สร้างได้ปกติ — ตัวตรวจเลขซ้ำข้ามค่าว่างอยู่แล้ว */}
              {isTPB && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">เลขเรื่องเซอร์เวย์</label>
                  <input value={f('survey_job_no')} onChange={e => s('survey_job_no', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="กรอกเลขเรื่องเซอร์เวย์" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">เลขรับแจ้ง</label>
                <input value={f('claim_ref_no')} onChange={e => s('claim_ref_no', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="กรอกเลขรับแจ้ง" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">เลขกรมธรรม์</label>
                <input value={f('policy_no')} onChange={e => s('policy_no', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="กรอกเลขกรมธรรม์" />
              </div>
              {/* โชว์เฉพาะเมื่อ OCR เจอค่า (มี 2 เลขเคลม/2 เลขเซอร์เวย์) */}
              {f('prb_number') && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">เลขพรบ</label>
                  <input value={f('prb_number')} onChange={e => s('prb_number', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="เลขพรบ" />
                </div>
              )}
              {f('survey_job_no_2') && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">เลขเซอร์เวย์ (งาน 2)</label>
                  <input value={f('survey_job_no_2')} onChange={e => s('survey_job_no_2', e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="เลขเซอร์เวย์ งาน 2" />
                </div>
              )}
              {/**
                * เบอร์โทร — คนละที่บนเอกสารของแต่ละบริษัท (user เคาะ 24/08/69)
                *   ไทยไพบูลย์: เบอร์เดียว อยู่บรรทัด "ชื่อผู้แจ้งเหตุ" บนใบรับแจ้ง
                *   ไอโออิ:     2 เบอร์ มีป้ายกำกับแยกบนการ์ด (ผู้แจ้งเหตุ / ผู้ขับขี่)
                */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">เบอร์โทรผู้แจ้งเหตุ</label>
                <input value={f('reporter_phone')} onChange={e => s('reporter_phone', e.target.value)} inputMode="tel" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="เช่น 0812345678" />
              </div>
              {!isTPB && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">เบอร์โทรผู้ขับขี่</label>
                  <input value={f('driver_phone')} onChange={e => s('driver_phone', e.target.value)} inputMode="tel" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="เช่น 0812345678" />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  ลูกค้าแจ้ง <span className="text-red-500">*</span>{' '}
                  <span className="text-gray-400 font-normal">(วันเวลารับแจ้ง · จุดเริ่มไทม์ไลน์งาน)</span>
                </label>
                {/* บังคับกรอก (22/09/69) — OCR หน้าการ์ดเติมให้ · กรอกเองต้องใส่ทั้งวันและเวลา หรือกด "ตอนนี้" */}
                <div className="flex gap-2">
                  <input
                    id="acc_customer_report_date"
                    value={reportDate}
                    onChange={e => setReportDT(e.target.value, reportTime)}
                    inputMode="numeric"
                    className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm ${reportDTError ? 'border-red-400' : 'border-gray-300'}`}
                    placeholder="วว/ดด/พพพพ (พ.ศ.)"
                  />
                  <input
                    value={reportTime}
                    onChange={e => setReportDT(reportDate, e.target.value)}
                    inputMode="numeric"
                    className={`w-24 shrink-0 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm ${reportDTError ? 'border-red-400' : 'border-gray-300'}`}
                    placeholder="ชช:นน"
                  />
                  <button
                    type="button"
                    onClick={() => { const [d, t] = splitReportDT(nowReportDT()); setReportDT(d, t); }}
                    title="ใช้วันเวลาปัจจุบัน — ลูกค้าเพิ่งโทรแจ้งตอนนี้"
                    className="shrink-0 px-2.5 py-2 text-xs font-medium border border-blue-300 text-blue-700 rounded-lg hover:bg-blue-50 transition-colors whitespace-nowrap"
                  >
                    ตอนนี้
                  </button>
                </div>
                {reportDTError && <p className="text-xs text-red-600 mt-1">{reportDTError}</p>}
              </div>
              <div className="col-span-3">
                <label className="block text-xs font-medium text-gray-500 mb-1">สถานที่เกิดเหตุ <span className="text-gray-400 font-normal">(อ่านจากรูป · แสดงบนการ์ดงานของช่างสำรวจ)</span></label>
                <input value={incidentLocation} onChange={e => setIncidentLocation(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm" placeholder="อ่านจากรูป หรือกรอกเอง" />
              </div>
            </div>

            {/* Upload zone + Capture button — ทางเลือกเสริม */}
            {!ocrDone && !ocrLoading && (
              <div className="flex gap-3 mb-4">
                {/* Upload zone */}
                <div
                  onDragOver={e => e.preventDefault()}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors border-gray-300 hover:border-blue-400 hover:bg-blue-50"
                >
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
                  <div className="space-y-1">
                    <div className="text-3xl text-gray-300">&#128193;</div>
                    <p className="text-sm font-medium text-gray-600">เลือกไฟล์รูป</p>
                    <p className="text-xs text-gray-400">ลากไฟล์มาวาง หรือคลิก (ไม่บังคับ)</p>
                  </div>
                </div>
                {/* Capture button */}
                <div
                  onClick={handleScreenCapture}
                  className="flex-1 border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors border-gray-300 hover:border-green-400 hover:bg-green-50"
                >
                  <div className="space-y-1">
                    <div className="text-3xl text-gray-300">&#9986;</div>
                    <p className="text-sm font-medium text-gray-600">จับภาพหน้าจอ</p>
                    <p className="text-xs text-gray-400">เลือกเฉพาะส่วนที่ต้องการ (ไม่บังคับ)</p>
                  </div>
                </div>
              </div>
            )}

            {/* Loading state */}
            {ocrLoading && (
              <div className="border-2 border-dashed rounded-xl p-8 text-center border-blue-400 bg-blue-50 mb-4">
                <div className="space-y-3">
                  <div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full mx-auto"></div>
                  <p className="text-sm text-blue-600 font-medium">กำลังอ่านข้อมูลจากรูป...</p>
                  <p className="text-xs text-gray-400">กำลังประมวลผล อาจใช้เวลาสักครู่</p>
                </div>
                {ocrPreview && (
                  <img src={ocrPreview} alt="preview" className="mt-4 max-h-40 mx-auto rounded-lg opacity-50" />
                )}
              </div>
            )}

            {/* Crop overlay modal — เลือกได้หลายส่วน */}
            {cropping && capturedImage && (
              <div className="fixed inset-0 bg-black/70 z-50 flex flex-col">
                <div className="bg-white px-4 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <p className="text-sm font-medium text-gray-700">ลากเมาส์เลือกพื้นที่</p>
                    {savedCrops.length > 0 && (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">เลือกแล้ว {savedCrops.length} ส่วน</span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {getCropRect() && (
                      <button type="button" onClick={handleAddCrop} className="px-4 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700">+ เพิ่มส่วน</button>
                    )}
                    {savedCrops.length > 0 && (
                      <button type="button" onClick={handleUndoCrop} className="px-4 py-1.5 bg-yellow-100 text-yellow-700 text-sm rounded-lg hover:bg-yellow-200">ย้อน</button>
                    )}
                    {(savedCrops.length > 0 || getCropRect()) && (
                      <button type="button" onClick={handleCropConfirm} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
                        ตกลง ({savedCrops.length + (getCropRect() ? 1 : 0)} ส่วน)
                      </button>
                    )}
                    <button type="button" onClick={handleCropCancel} className="px-4 py-1.5 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300">ยกเลิก</button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto relative cursor-crosshair"
                  onMouseDown={e => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
                    const y = e.clientY - rect.top + e.currentTarget.scrollTop;
                    setCropStart({ x, y });
                    setCropEnd({ x, y });
                    setIsDragging(true);
                  }}
                  onMouseMove={e => {
                    if (!isDragging) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left + e.currentTarget.scrollLeft;
                    const y = e.clientY - rect.top + e.currentTarget.scrollTop;
                    setCropEnd({ x, y });
                  }}
                  onMouseUp={() => setIsDragging(false)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img ref={capturedImgRef} src={capturedImage} alt="captured" className="max-w-none" draggable={false} />
                  {/* ส่วนที่บันทึกไว้แล้ว — เส้นเขียว */}
                  {savedCrops.map((r, i) => (
                    <div key={i} className="absolute border-2 border-green-500 bg-green-500/10" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
                      <span className="absolute -top-5 left-0 text-xs bg-green-600 text-white px-1.5 rounded">{i + 1}</span>
                    </div>
                  ))}
                  {/* ส่วนที่กำลังเลือก — เส้นฟ้า */}
                  {cropStart && cropEnd && (() => {
                    const r = getCropRect();
                    return r ? (
                      <div className="absolute border-2 border-blue-500 bg-blue-500/10" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
                    ) : null;
                  })()}
                </div>
              </div>
            )}

            {/* OCR success bar */}
            {ocrDone && (
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-green-600 text-sm font-medium">&#10003; อ่านข้อมูลสำเร็จ</span>
                  <span className="text-xs text-gray-400">ตรวจสอบและแก้ไขข้อมูลได้ก่อนสร้างเคส</span>
                </div>
                <div className="flex gap-3 items-center">
                  <input ref={appendFileRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
                  <button type="button" onClick={handleAppendFile} className="text-xs text-green-600 hover:underline font-medium">+ เลือกไฟล์เพิ่ม</button>
                  <button type="button" onClick={handleAppendCapture} className="text-xs text-green-600 hover:underline font-medium">+ จับภาพเพิ่ม</button>
                  <span className="text-gray-300">|</span>
                  {ocrRaw && <button type="button" onClick={() => setShowOcrRaw(!showOcrRaw)} className="text-xs text-gray-500 hover:underline">{showOcrRaw ? 'ซ่อน' : 'ดู'} OCR Raw</button>}
                  <button type="button" onClick={resetOcr} className="text-xs text-red-500 hover:underline">เริ่มใหม่</button>
                </div>
              </div>
            )}

            {ocrDone && ocrReview && ocrReview.review_needed && (
              <div className="mb-3">
                <div className="bg-yellow-50 border border-yellow-300 text-yellow-800 text-xs rounded px-3 py-2">
                  &#9888; ระบบไม่มั่นใจบางเลข — กรุณาตรวจสอบ{(() => {
                    const items = Object.entries(ocrReview.confidence).filter(([, c]) => c === 'medium' || c === 'low').map(([k]) => OCR_FIELD_LABELS[k] || k);
                    return items.length ? `: ${items.join(', ')}` : '';
                  })()}
                </div>
              </div>
            )}

            {showOcrRaw && ocrRaw && (
              <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-[11px] text-gray-600 mb-3 max-h-60 overflow-auto whitespace-pre-wrap">{ocrRaw}</pre>
            )}

            {/* ปุ่มสร้างเคส — ย้ายไว้เหนือรูป */}
            {!createdCaseId && (
              <div className="flex justify-end mb-4">
                <button type="submit" disabled={submitting} className="px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {submitting ? 'กำลังสร้าง...' : 'สร้างเคสและมอบหมาย'}
                </button>
              </div>
            )}

            {/* รูปใบรับแจ้งเคลม — อ่านข้อมูลที่เหลือจากรูปทั้งใบได้เลย */}
            {ocrImages.length > 0 && (
              <div className="mb-4">
                <div className="text-xs font-medium text-gray-500 mb-1.5">รูปใบรับแจ้งเคลม{ocrImages.length > 1 ? ` (${ocrImages.length} รูป)` : ''}</div>
                <div className="space-y-3">
                  {ocrImages.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer" className="block">
                      <img src={url} alt={`ใบรับแจ้งเคลม ${i + 1}`} className="w-full rounded-lg border border-gray-200 hover:border-blue-400 transition-colors" />
                    </a>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">คลิกรูปเพื่อดูขนาดเต็ม</p>
              </div>
            )}
          </>
        )}
        </fieldset>
      </form>

      {/* ส่วนมอบหมายช่างสำรวจ — แสดง inline ใต้ฟอร์มหลังสร้างเคสสำเร็จ */}
      {createdCaseId !== null && (
        <div ref={assignRef} className="mt-8 pt-8 border-t border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-800">มอบหมายช่างสำรวจ</h2>
              <p className="text-gray-500 mt-0.5 text-sm">สร้างเคส #{createdCaseId} สำเร็จ — เลือกช่างสำรวจเพื่อมอบหมายงาน</p>
            </div>
            <button type="button" onClick={() => router.push('/callcenter')} className="text-sm text-gray-500 hover:text-gray-700 hover:underline">
              ข้ามไปก่อน
            </button>
          </div>
          <AssignSurveyor caseId={createdCaseId} onAssigned={() => router.push('/callcenter')} listContainer={listEl} />
        </div>
      )}
      </div>
      {/* คอลัมน์ขวา: รายชื่อช่างสำรวจ (AssignSurveyor render เข้ามาทาง portal) — ติดขอบบนตอนเลื่อนบนจอกว้าง */}
      {createdCaseId !== null && (
        <div ref={setListEl} className="min-w-0 xl:sticky xl:top-4" />
      )}
      </div>
    </div>
  );
}
