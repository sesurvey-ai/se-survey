'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CLAIM_TYPE_OPTIONS } from './caseOptions';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';
import api from '@/lib/api';

// 15/09/69 user ออกแบบใหม่: **ไม่มีแผนที่** ในหน้ามอบหมายแล้ว (ซ้ำกับเมนู "พนักงานทั้งหมด" ที่มีแผนที่สดอยู่)
// เหลือรายชื่อที่เรียงตามระยะทาง/จังหวัดจากพิกัดเดิม — ปุ่ม "เรียกพิกัด" ยังอยู่เพราะรายชื่อต้องใช้พิกัดล่าสุด

interface SurveyorLocation {
  user_id: string;
  username: string;
  first_name?: string;
  last_name?: string;
  /** รหัสพนักงาน (SE###/SEC###) — ใช้ระบุตัวคนได้แน่กว่าชื่อ และตรงกับที่ใช้เรียกกันในงาน */
  code?: string | null;
  /** จังหวัดที่พิกัดล่าสุดตกอยู่ (เซิร์ฟเวอร์คำนวณจากขอบเขตจังหวัดจริง) — null = อยู่นอกประเทศ/พิกัดเพี้ยน */
  province?: string | null;
  /** เวลาที่มือถือรายงานพิกัดครั้งล่าสุด — ใช้บอกว่าตำแหน่งนี้เชื่อได้แค่ไหน */
  recorded_at?: string | null;
  latitude: number;
  longitude: number;
  distance?: number;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface AssignSurveyorProps {
  caseId: number | string;
  /** เรียกหลังมอบหมายสำเร็จ — ถ้าไม่ส่ง จะ router.push('/callcenter') */
  onAssigned?: (surveyorId: number) => void;
  /**
   * กล่องปลายทางของ "รายชื่อช่างสำรวจ" (15/09/69 user ออกแบบใหม่): หน้าที่ฝังตัวนี้วางรายละเอียดงานไว้ซ้าย
   * แล้วให้รายชื่ออยู่คอลัมน์ขวาของหน้า — ส่ง element ของคอลัมน์ขวามา รายชื่อจะไป render ในนั้น (portal)
   * ไม่ส่ง = รายชื่อต่อท้ายส่วนควบคุมตามปกติ
   */
  listContainer?: HTMLElement | null;
}

/** ส่วน "มอบหมายช่างสำรวจ" (ประเภทเคลม + ปุ่มเรียกพิกัด + รายชื่อ) ใช้ซ้ำได้ทั้งหน้า standalone และ inline ในหน้าสร้างเคส */
export default function AssignSurveyor({ caseId, onAssigned, listContainer = null }: AssignSurveyorProps) {
  const router = useRouter();
  const { socket } = useSocket();
  const caseIdStr = String(caseId);

  const [surveyors, setSurveyors] = useState<SurveyorLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);
  const [error, setError] = useState('');
  // แจ้งเตือนงานใหม่ไปไม่ถึงเครื่องช่าง — มอบหมายสำเร็จแล้วแต่ต้องโทรตาม
  const [pushWarning, setPushWarning] = useState('');
  /**
   * รอเครื่องช่างตอบรับว่าแจ้งเตือน **ถึงเครื่องจริง**
   *
   * ⛔ ส่งสำเร็จ ≠ ถึงเครื่อง — FCM ตอบ success แค่ว่า Google รับเรื่องไว้
   *    ถ้าเครื่องหลับลึก/โดนตัวประหยัดแบตดับแอป/ไม่มีเน็ต งานจะเงียบไปเลยโดยไม่มีใครรู้
   *    ตัวนี้ทำให้คนจ่ายงานรู้ตัวใน 20 วินาที แล้วโทรตามได้ทันแทนที่จะรู้ตอนลูกค้าโทรมาถาม
   */
  const [ackState, setAckState] = useState<'waiting' | 'ok' | 'timeout' | null>(null);
  // ช่างที่เพิ่งมอบหมายให้ — ปุ่ม "รับทราบ" ตอน timeout ต้องรู้ว่าจะส่งใครกลับไปให้หน้าแม่
  const [ackSurveyorId, setAckSurveyorId] = useState(0);
  // ออกจากหน้าไปแล้วต้องหยุด poll + ห้าม setState (กัน memory leak / เด้งหน้าหลังผู้ใช้ไปทำอย่างอื่น)
  //
  // ⛔ **ต้องรีเซ็ตเป็น false ตอน mount ด้วย** ไม่ใช่ตั้งแต่ประกาศ useRef อย่างเดียว —
  //    React StrictMode (dev) รัน effect สองรอบแบบ mount → unmount → mount ทำให้ cleanup
  //    ยิง ackAbort = true ค้างไว้ตั้งแต่ยังไม่ได้ใช้ แล้ว poll จะ return ทิ้งทุกครั้ง
  //    ผลคือแบนเนอร์ค้าง "กำลังรอเครื่องช่างตอบรับ" ตลอดกาล ไม่เคยขึ้นทั้งเขียวและเหลือง
  //    (เจอจากการเทสจริง — ไม่มี error ที่ไหนเลย) · เคสรีมาวต์จริงก็พังแบบเดียวกัน
  const ackAbort = useRef(false);
  useEffect(() => {
    ackAbort.current = false;
    return () => { ackAbort.current = true; };
  }, []);
  const [requestSent, setRequestSent] = useState(false);
  // จังหวัดที่เกิดเหตุ — ใช้จัดกลุ่มช่าง ไม่ใช่กรองทิ้ง (ดูเหตุผลที่กลุ่ม "ช่างคนอื่น")
  const [incidentProvince, setIncidentProvince] = useState<string | null>(null);
  const [incidentDistrict, setIncidentDistrict] = useState<string | null>(null);
  /** 'case' = พิกัดมากับเคส (บางใบละเอียดถึงปากซอย) · 'district' = เราคำนวณจากอำเภอให้ */
  const [coordSource, setCoordSource] = useState<'case' | 'district' | null>(null);
  const [incidentLat, setIncidentLat] = useState<number | undefined>();
  const [incidentLng, setIncidentLng] = useState<number | undefined>();
  // โหลดพิกัดเคสเสร็จหรือยัง — กัน race: ต้องได้พิกัดก่อน auto-request ถึงจะเข้า path เรียงตามระยะทาง
  const [caseLoaded, setCaseLoaded] = useState(false);
  /**
   * งานในมือของแต่ละคน `{ user_id: { assigned, surveyed } }`
   *
   * `null` = ยังไม่รู้ (กำลังโหลด หรือโหลดไม่สำเร็จ) → **ถือว่าทุกคนว่าง ไม่ซ่อนใครทั้งนั้น**
   * ซ่อนคนเพราะข้อมูลที่เราไม่มี = คนจ่ายงานเห็นรายชื่อหาย แล้วจ่ายงานไม่ได้ทั้งที่คนว่างอยู่
   */
  const [workload, setWorkload] = useState<Record<string, { assigned: number; finished: number; surveyed: number }> | null>(null);
  /** เผยคนที่ถืองานอยู่ — ค่าเริ่มต้นซ่อนไว้ ตามที่ user ขอ "แสดงเฉพาะคนที่ว่าง" */
  const [showBusy, setShowBusy] = useState(false);
  /**
   * ประเภทเคลมที่คนจ่ายงานเลือก → ส่งไปกับการมอบหมาย แล้วโผล่บนแอปช่าง
   * ว่าง = ไม่ระบุ (ไม่แตะค่าเดิม) · ช่างยังแก้เองบนแอปได้ตามปกติ
   * งานครั้งแรกปกติเป็น เคลมสด/เคลมแห้ง · งานนัดหมาย/ติดตาม มักเป็นครั้งถัดไปของเคลมเดิม
   */
  const [claimType, setClaimType] = useState('');

  // Fetch case coordinates on mount
  useEffect(() => {
    api.get(`/api/cases/${caseIdStr}`)
      .then((res) => {
        if (res.data.success && res.data.data) {
          const c = res.data.data;
          if (c.incident_lat != null) setIncidentLat(parseFloat(c.incident_lat));
          if (c.incident_lng != null) setIncidentLng(parseFloat(c.incident_lng));
          if (c.acc_province) setIncidentProvince(String(c.acc_province));
          if (c.acc_district) setIncidentDistrict(String(c.acc_district));
          if (c.incident_coord_source) setCoordSource(c.incident_coord_source);
          if (c.claim_type) setClaimType(String(c.claim_type));
        }
      })
      .catch(() => {})
      .finally(() => setCaseLoaded(true));
  }, [caseIdStr]);

  // งานในมือของช่างทุกคน — โหลดครั้งเดียวตอนเปิด แล้วโหลดซ้ำหลังมอบหมายสำเร็จ
  const loadWorkload = useCallback(() => {
    api.get('/api/cases/workload')
      .then((res) => {
        const rows = (res.data?.data ?? []) as { user_id: number | string; assigned?: number; finished?: number; surveyed?: number }[];
        const map: Record<string, { assigned: number; finished: number; surveyed: number }> = {};
        rows.forEach((w) => {
          map[String(w.user_id)] = {
            assigned: Number(w.assigned) || 0, finished: Number(w.finished) || 0, surveyed: Number(w.surveyed) || 0,
          };
        });
        setWorkload(map);
      })
      // โหลดไม่ได้ = ไม่รู้ว่าใครถืองาน → คงค่า null ไว้ แล้วโชว์ทุกคน (ดูคอมเมนต์ที่ state)
      .catch(() => setWorkload(null));
  }, []);

  useEffect(() => { loadWorkload(); }, [loadWorkload]);

  // Listen for real-time location updates via socket
  useEffect(() => {
    if (!socket) return;
    const handle = (data: SurveyorLocation | SurveyorLocation[]) => {
      setSurveyors((prev) => {
        let updated: SurveyorLocation[];
        if (Array.isArray(data)) {
          updated = data;
        } else {
          if (incidentLat !== undefined && incidentLng !== undefined) {
            data.distance = haversineDistance(incidentLat, incidentLng, Number(data.latitude), Number(data.longitude));
          }
          const idx = prev.findIndex((s) => String(s.user_id) === String(data.user_id));
          if (idx >= 0) { updated = [...prev]; updated[idx] = data; }
          else { updated = [...prev, data]; }
        }
        updated.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
        return updated;
      });
    };
    socket.on('location_update', handle);
    return () => { socket.off('location_update', handle); };
  }, [socket, incidentLat, incidentLng]);

  const handleRequestLocation = useCallback(() => {
    if (!socket) { setError('ไม่สามารถเชื่อมต่อ Socket ได้'); return; }
    setLoading(true); setRequestSent(true); setError('');
    socket.emit('request_location', { request_id: caseIdStr });

    const params = new URLSearchParams();
    if (incidentLat !== undefined && incidentLng !== undefined) {
      params.set('lat', String(incidentLat));
      params.set('lng', String(incidentLng));
    }
    // ไม่ส่ง limit → แสดงช่างสำรวจออนไลน์ทุกคน (เรียงตามระยะทางจากจุดเกิดเหตุ)

    api.get(`/api/locations/latest?${params.toString()}`)
      .then((res) => { if (res.data.success && res.data.data) setSurveyors(res.data.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [socket, caseIdStr, incidentLat, incidentLng]);

  // Auto-request locations once socket ready AND case coords resolved
  // (รอ caseLoaded กัน race — ถ้ายิงก่อนได้พิกัด รายชื่อจะไม่เรียงตามระยะทาง)
  const autoRequested = useRef(false);
  useEffect(() => {
    if (socket && caseLoaded && !autoRequested.current) {
      autoRequested.current = true;
      handleRequestLocation();
    }
  }, [socket, caseLoaded, handleRequestLocation]);

  /** ไปต่อหลังจบเรื่องแจ้งเตือน (กดรับทราบ / ตอบรับแล้ว) */
  const leaveAfterAssign = useCallback((surveyorUserId: number) => {
    if (onAssigned) onAssigned(surveyorUserId);
    else router.push('/callcenter');
  }, [onAssigned, router]);

  /**
   * ถามเซิร์ฟเวอร์ทุก 2 วินาที (สูงสุด 20 วินาที) ว่าเครื่องช่างตอบรับหรือยัง
   *
   * ทำไม 20 วินาที: เครื่องที่ตื่นอยู่ตอบกลับใน 1-3 วินาที ส่วนเครื่องที่หลับใน Doze
   * อาจใช้เวลาถึงหลักสิบวินาที — ยาวกว่านี้คนจ่ายงานก็ไม่รออยู่แล้ว และ "ยังไม่ถึง"
   * ก็ยังค้างอยู่ในฐานข้อมูลให้ตามทีหลังได้ ไม่ได้หายไปไหน
   *
   * ⛔ poll ล้ม (เน็ตออฟฟิศสะดุด) ห้ามสรุปว่า "ไม่ถึง" — ข้ามรอบนั้นไปเฉย ๆ
   *    ไม่งั้นจะเตือนผิดจนคนเลิกเชื่อคำเตือน แล้วคำเตือนก็หมดค่า
   */
  const waitForAck = async (surveyorUserId: number) => {
    setAckState('waiting');
    setAckSurveyorId(surveyorUserId);
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      if (ackAbort.current) return;
      try {
        const r = await api.get(`/api/cases/${caseIdStr}/push-status`);
        if (r.data?.data?.push_delivered_at) {
          if (ackAbort.current) return;
          setAckState('ok');
          // ให้เห็นผลสักครู่ก่อนเด้งออก — เด้งทันทีคนจ่ายงานจะไม่ทันเห็นว่าถึงแล้ว
          setTimeout(() => { if (!ackAbort.current) leaveAfterAssign(surveyorUserId); }, 1400);
          return;
        }
      } catch { /* อ่านสถานะไม่ได้รอบนี้ ≠ ไม่ถึง — รอรอบหน้า */ }
    }
    if (!ackAbort.current) setAckState('timeout');
  };

  const handleAssign = async (surveyorUserId: string) => {
    setAssigning(surveyorUserId); setError('');
    try {
      const res = await api.post(`/api/cases/${caseIdStr}/assign`, {
        surveyor_id: Number(surveyorUserId),
        ...(claimType ? { claim_type: claimType } : {}),   // ไม่เลือก = ไม่ส่ง = ไม่ทับของเดิม
      });
      if (res.data.success) {
        loadWorkload();   // คนที่เพิ่งรับงานต้องหลุดจากรายชื่อ "ว่าง" ทันที
        // มอบหมายสำเร็จ ≠ ช่างรู้ตัว — ถ้าแจ้งเตือนไปไม่ถึง ต้องบอกคนจ่ายงานให้โทรตาม
        // (เดิมเด้งออกจากหน้าทันทีเหมือนกันหมด ทั้งที่ push อาจล้มเงียบ)
        const push = res.data.data?.push as { status?: string; reason?: string } | undefined;
        if (push && push.status !== 'sent') {
          setPushWarning(push.reason || 'แจ้งเตือนไปไม่ถึงเครื่องช่าง');
          return;   // ค้างหน้าไว้ให้เห็นคำเตือน ไม่เด้งออก
        }
        // ยิงออกจากเซิร์ฟเวอร์แล้ว — แต่ยังไม่รู้ว่าถึงเครื่องไหม รอเครื่องช่างตอบรับก่อนเด้งออก
        setAssigning(null);
        await waitForAck(Number(surveyorUserId));
        return;
      } else setError(res.data.message || 'ไม่สามารถมอบหมายงานได้');
    } catch { setError('เกิดข้อผิดพลาด กรุณาลองใหม่'); }
    finally { setAssigning(null); }
  };

  const sorted = [...surveyors].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

  /**
   * แบ่งเป็น "อยู่ในจังหวัดที่เกิดเหตุ" กับ "ช่างคนอื่น"
   *
   * ⛔ **กรองทิ้งไม่ได้ ต้องแค่แยกกลุ่ม** — พิกัดของช่างมากกว่าครึ่งเก่ากว่า 7 วัน
   *    วันไหนไม่มีใครรายงานพิกัดจากจังหวัดนั้นเลย คนจ่ายงานจะเห็นรายชื่อว่างเปล่า
   *    แล้วจ่ายงานไม่ได้ทั้งที่จริง ๆ มีคนอยู่แถวนั้น — แย่กว่าเรียงมั่ว
   *
   * แบ่งที่ระดับ**จังหวัด ไม่ใช่อำเภอ** ด้วยเหตุผลเดียวกัน (อำเภอแคบไป จะว่างบ่อยมาก)
   */
  /**
   * มีพิกัดที่เกิดเหตุ → **เรียงตามระยะทางล้วน ไม่ต้องแบ่งจังหวัด**
   * เพราะระยะทางบอกได้ตรงกว่า และถ้าแบ่งจังหวัดด้วย คนที่อยู่ห่างแค่ 3 กม.
   * แต่คนละฝั่งเส้นแบ่งจังหวัดจะถูกพับไปอยู่ในกลุ่ม "ช่างคนอื่น" ซึ่งกลับหัวกลับหาง
   *
   * ⚠️ **ระยะทางที่โชว์เป็นค่าโดยประมาณเสมอ** — ปัดเป็นจำนวนเต็ม ไม่โชว์ทศนิยม
   *    เพราะฝั่ง "ที่เกิดเหตุ" หยาบระดับอำเภอ ไม่ว่ามาทางไหน:
   *    `'district'` backend คำนวณจุดกลางอำเภอให้ (ทางปกติ) → บอกได้เลยว่าวัดจากตรงไหน
   *    `'case'`     ใช้พิกัดในเคสเพราะจับคู่ชื่ออำเภอไม่ได้ → **ไม่รู้ที่มา** บอกแค่ว่าประมาณ
   *                 (พิกัดบนการ์ดประกันก็เป็นค่าสมมติจากอำเภออยู่แล้ว user ยืนยัน 25/08/69)
   *    ⛔ อย่าโชว์ทศนิยม — คนจ่ายงานจะเชื่อว่าวัดมาเป๊ะแล้วเลือกคนผิด
   *    (ฝั่งช่างเป็นพิกัด GPS จริงจากมือถือ ความหยาบอยู่ฝั่งที่เกิดเหตุฝั่งเดียว)
   */
  const byDistance = incidentLat !== undefined && incidentLng !== undefined;
  /** รู้ว่าวัดจากจุดกลางอำเภอไหน — บอกชื่ออำเภอบนหน้าจอได้ */
  const fromDistrict = coordSource === 'district';

  /**
   * "ว่าง" = **ยังไม่ได้รับมอบหมายงาน** (กติกา user 24/08/69)
   *
   * งานที่ช่างส่งแล้วรอหัวหน้าตรวจ **ไม่นับว่าไม่ว่าง** — ช่างทำจบแล้ว รับงานใหม่ได้
   * (โชว์เป็นข้อมูลข้างชื่อแทน) · ยังไม่รู้ workload = ถือว่าว่างไว้ก่อน ไม่ซ่อนใคร
   * 07/09/69: กด "เสร็จงาน" หน้างานแล้ว (finished) ก็ **ว่าง** เช่นกัน — นี่คือเหตุผลที่มีปุ่มนั้น
   *   workload.assigned จาก server นับเฉพาะงานที่ยังไม่เสร็จหน้างานอยู่แล้ว
   */
  const jobsOf = (s: SurveyorLocation) => workload?.[String(s.user_id)] ?? null;
  const isFree = (s: SurveyorLocation) => (jobsOf(s)?.assigned ?? 0) === 0;

  /**
   * ⛔ **ไม่ตัดคนที่ถืองานทิ้ง แค่ยุบเก็บ** — บางวันช่างในพื้นที่ถืองานกันหมด
   *    ถ้าตัดออกจริง คนจ่ายงานจะเจอรายชื่อว่างเปล่าแล้วจ่ายงานไม่ได้เลย
   *    (เหตุผลเดียวกับที่ไม่กรองด้วยพิกัด — ดูคอมเมนต์กลุ่ม "ช่างคนอื่น")
   */
  const free = sorted.filter(isFree);
  const busy = sorted.filter((s) => !isFree(s));

  const inProvince = !byDistance && incidentProvince ? free.filter((x) => x.province === incidentProvince) : [];
  const others = !byDistance && incidentProvince ? free.filter((x) => x.province !== incidentProvince) : free;
  const [showOthers, setShowOthers] = useState(false);

  /** พิกัดอัปเดตเมื่อไหร่ — ตำแหน่งเมื่อ 10 วันก่อนกับเมื่อ 10 นาทีก่อน เชื่อได้ไม่เท่ากัน */
  const freshness = (iso?: string | null): { text: string; cls: string } | null => {
    if (!iso) return null;
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (!Number.isFinite(mins) || mins < 0) return null;
    if (mins < 60) return { text: `${mins} นาทีที่แล้ว`, cls: 'text-green-600' };
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return { text: `${hrs} ชม.ที่แล้ว`, cls: 'text-green-600' };
    const days = Math.round(hrs / 24);
    return { text: `${days} วันก่อน`, cls: days >= 7 ? 'text-red-500' : 'text-amber-600' };
  };

  /** แถวช่าง 1 คน — ใช้ซ้ำทั้งกลุ่ม "ในจังหวัด" และ "คนอื่น" จะได้ไม่ต้องดูแล 2 ที่ */
  const row = (s: SurveyorLocation) => {
    const fresh = freshness(s.recorded_at);
    const jobs = jobsOf(s);
    return (
      <div key={s.user_id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
        <div className="min-w-0">
          <h3 className="font-medium text-gray-800 flex items-center gap-2">
            {/* รหัสพนักงานมาก่อนชื่อ — ชื่อซ้ำกันได้ รหัสไม่ซ้ำ และเป็นตัวที่ใช้เรียกกันในงานจริง */}
            {s.code && (
              <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-xs font-mono tracking-tight">{s.code}</span>
            )}
            <span className="truncate">{s.first_name ? `${s.first_name} ${s.last_name || ''}` : s.username}</span>
            {/* งานที่ยังไม่ส่ง = เหตุผลที่คนนี้ไม่ถือว่าว่าง — ต้องเห็นตอนตัดสินใจว่าจะจ่ายซ้ำไหม */}
            {(jobs?.assigned ?? 0) > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-medium shrink-0"
                title="งานที่รับไปแล้วแต่ยังไม่ส่ง">
                ถืองาน {jobs!.assigned} ใบ
              </span>
            )}
          </h3>
          <p className="text-sm text-gray-500 flex items-center gap-2 flex-wrap">
            {s.province && <span>{s.province}</span>}
            {/* ส่งแล้วรอหัวหน้าตรวจ = ไม่นับว่าไม่ว่าง แสดงเป็นข้อมูลเฉย ๆ (กติกา user) */}
            {/* เสร็จงานหน้างานแล้ว กำลังทำรายงาน = ว่าง รับงานใหม่ได้ — โชว์ให้รู้ว่ายังมีรายงานค้างส่ง */}
            {(jobs?.finished ?? 0) > 0 && (
              <span className="text-teal-600" title="กดเสร็จงานหน้างานแล้ว กำลังทำรายงาน — รับงานใหม่ได้ ไม่นับว่าไม่ว่าง">
                เสร็จงานแล้ว รอส่งรายงาน {jobs!.finished} ใบ
              </span>
            )}
            {(jobs?.surveyed ?? 0) > 0 && (
              <span className="text-gray-400" title="ส่งงานแล้ว รอหัวหน้าตรวจ — ไม่นับว่าไม่ว่าง">
                ส่งแล้วรอตรวจ {jobs!.surveyed} ใบ
              </span>
            )}
            {/* ตำแหน่งเมื่อ 10 วันก่อนกับเมื่อ 10 นาทีก่อน เชื่อได้ไม่เท่ากัน — ต้องเห็น */}
            {fresh && <span className={fresh.cls}>อัปเดต {fresh.text}</span>}
            {s.distance !== undefined && (
              <span className="text-blue-600" title="วัดจากจุดกลางของอำเภอที่เกิดเหตุ ไม่ใช่จุดเกิดเหตุจริง">
                ~{Math.round(Number(s.distance))} กม.
              </span>
            )}
          </p>
        </div>
        <button type="button" onClick={() => handleAssign(String(s.user_id))} disabled={assigning === String(s.user_id)} className="ml-4 shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
          {assigning === String(s.user_id) ? 'กำลังมอบหมาย...' : 'มอบหมาย'}
        </button>
      </div>
    );
  };

  return (
    <div>
      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-6">{error}</div>}

      {/* ประเภทเคลม — คนรับแจ้งรู้ตั้งแต่ต้นสาย จึงเลือกตรงนี้แล้วส่งไปโผล่บนแอปช่าง
          (เดิมมีให้กรอกแค่บนแอปกับหน้าตรวจ = คนที่รู้ก่อนกลับไม่มีที่ให้บอก)
          ⛔ ไม่บังคับ — ไม่เลือกก็จ่ายงานได้ ช่างเลือกเองบนแอปได้เหมือนเดิม */}
      <div className="mb-6 p-4 bg-white border border-gray-200 rounded-xl">
        <label htmlFor="claim_type" className="block text-sm font-semibold text-gray-800 mb-1">ประเภทเคลม</label>
        <select
          id="claim_type"
          value={claimType}
          onChange={(e) => setClaimType(e.target.value)}
          className="w-full md:w-72 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">-- ไม่ระบุ --</option>
          {CLAIM_TYPE_OPTIONS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
        </select>
        <p className="mt-1.5 text-xs text-gray-500">
          งานครั้งแรกปกติเป็น <strong>เคลมสด</strong> หรือ <strong>เคลมแห้ง</strong> ·
          งานนัดหมาย/ติดตาม มักเป็นงานครั้งถัดไปของเคลมเดิม ·
          ช่างแก้เองบนแอปได้ถ้าหน้างานไม่ตรง
        </p>
      </div>

      {ackState === 'waiting' && (
        <div className="bg-blue-50 border border-blue-200 text-blue-900 px-4 py-3 rounded-lg text-sm mb-6 flex items-center gap-3">
          <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span>มอบหมายงานแล้ว — กำลังรอเครื่องช่างตอบรับว่าแจ้งเตือนถึงแล้ว…</span>
        </div>
      )}

      {ackState === 'ok' && (
        <div className="bg-green-50 border border-green-300 text-green-900 px-4 py-3 rounded-lg text-sm mb-6">
          ✅ <strong>แจ้งเตือนถึงเครื่องช่างแล้ว</strong> — มอบหมายงานเรียบร้อย
        </div>
      )}

      {ackState === 'timeout' && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-3 rounded-lg text-sm mb-6">
          <div className="font-semibold mb-1">⚠️ มอบหมายงานแล้ว แต่เครื่องช่างยังไม่ตอบรับ</div>
          <div className="text-amber-800">
            งานถูกส่งออกจากระบบแล้ว แต่ยังไม่มีสัญญาณว่าถึงเครื่อง (เครื่องอาจปิด/ไม่มีเน็ต/ถูกตัวประหยัดแบตดับแอป)
            — <strong>โทรแจ้งช่างด้วย</strong> ไม่งั้นอาจไม่มีใครรู้ว่ามีงาน
          </div>
          <button
            type="button"
            onClick={() => { setAckState(null); leaveAfterAssign(ackSurveyorId); }}
            className="mt-2 px-4 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700"
          >
            รับทราบ
          </button>
        </div>
      )}

      {pushWarning && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 px-4 py-3 rounded-lg text-sm mb-6">
          <div className="font-semibold mb-1">⚠️ มอบหมายงานแล้ว แต่แจ้งเตือนไปไม่ถึงเครื่องช่าง</div>
          <div className="text-amber-800">{pushWarning} — <strong>โทรแจ้งช่างด้วย</strong> ไม่งั้นอาจไม่มีใครรู้ว่ามีงาน</div>
          <button
            type="button"
            onClick={() => { setPushWarning(''); if (onAssigned) onAssigned(0); else router.push('/callcenter'); }}
            className="mt-2 px-4 py-1.5 text-xs font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700"
          >
            รับทราบ
          </button>
        </div>
      )}

      {/**
        * รายชื่อช่างสำรวจ (15/09/69 user ออกแบบใหม่): ไม่มีแผนที่แล้ว — รายละเอียดงานอยู่คอลัมน์ซ้ายของหน้า
        * รายชื่ออยู่คอลัมน์ขวา (portal ไป listContainer ที่หน้าส่งมา) · ปุ่ม "เรียกพิกัด" ย้ายมาอยู่หัวรายชื่อ
        * เพราะรายชื่อเรียงตามพิกัดล่าสุด/จังหวัดที่ช่างอยู่ ต้องมีพิกัดก่อนถึงจะเห็นรายชื่อ
        */}
      {(() => {
        const list = (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-lg font-semibold text-gray-800">
            รายชื่อช่างสำรวจ
            {sorted.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400">
                {workload ? `ว่าง ${free.length} จาก ${sorted.length} คน` : `${sorted.length} คน`}
              </span>
            )}
          </h2>
          <button type="button" onClick={handleRequestLocation} disabled={loading}
            title="ขอพิกัดล่าสุดจากเครื่องช่างทุกคน แล้วเรียงรายชื่อตามระยะทาง/จังหวัดที่เกิดเหตุ"
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
            {loading ? 'กำลังเรียกพิกัด...' : sorted.length > 0 ? 'เรียกพิกัดใหม่' : 'เรียกพิกัด'}
          </button>
        </div>
        {sorted.length === 0 ? (
          <div className="text-center py-8 text-gray-500">{requestSent ? 'กำลังรอข้อมูลพิกัดจากช่างสำรวจ...' : 'กดปุ่ม "เรียกพิกัด" เพื่อดูรายชื่อช่างสำรวจเรียงตามระยะทาง'}</div>
        ) : (
          <div className="space-y-3 xl:max-h-[calc(100vh-12rem)] xl:overflow-y-auto xl:pr-1">
            {byDistance ? (
              <div className="text-xs text-gray-500">
                เรียงตามระยะทาง <span className="text-gray-400">โดยประมาณ</span> — ใกล้สุดขึ้นก่อน
                <div className="text-gray-400">
                  {fromDistrict
                    ? `วัดจากจุดกลางของ${incidentDistrict ? `${incidentDistrict} ` : 'อำเภอที่เกิดเหตุ '}`
                      + `${incidentProvince ?? ''} ซึ่งกว้างได้หลายสิบกิโลเมตร`
                    : 'จุดที่เกิดเหตุเป็นค่าโดยประมาณ ไม่ใช่ตำแหน่งที่วัดมาจริง'}
                </div>
              </div>
            ) : incidentProvince && (
              <div className="text-xs text-gray-500">
                ที่เกิดเหตุอยู่ <span className="font-medium text-gray-700">{incidentProvince}</span>
                {inProvince.length === 0 && ' — ไม่มีใครรายงานพิกัดจากจังหวัดนี้ (ดูรายชื่อทั้งหมดข้างล่าง)'}
              </div>
            )}

            {inProvince.map(row)}

            {!byDistance && incidentProvince && others.length > 0 && (
              <>
                <button type="button" onClick={() => setShowOthers((v) => !v)}
                  className="w-full text-left text-sm text-gray-500 hover:text-gray-700 border-t border-gray-200 pt-3">
                  {showOthers ? '▾' : '▸'} ช่างคนอื่น {others.length} คน
                  <span className="text-gray-400"> (ไม่ได้อยู่ใน{incidentProvince})</span>
                </button>
                {showOthers && others.map(row)}
              </>
            )}
            {(byDistance || !incidentProvince) && others.map(row)}

            {/* คนที่ถืองานอยู่ — ยุบไว้ท้ายรายการ ยังกดมอบหมายได้ถ้าจำเป็น */}
            {busy.length > 0 && (
              <>
                <button type="button" onClick={() => setShowBusy((v) => !v)}
                  className="w-full text-left text-sm text-gray-500 hover:text-gray-700 border-t border-gray-200 pt-3">
                  {showBusy ? '▾' : '▸'} ช่างที่ถืองานอยู่ {busy.length} คน
                  <span className="text-gray-400"> (ยังมอบหมายได้ถ้าจำเป็น)</span>
                </button>
                {showBusy && busy.map(row)}
              </>
            )}

            {free.length === 0 && busy.length > 0 && !showBusy && (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                ตอนนี้ไม่มีช่างที่ว่างเลย — กดดูรายชื่อข้างบนเพื่อมอบหมายให้คนที่ถืองานอยู่
              </div>
            )}
          </div>
        )}
        </div>
        );
        return listContainer ? createPortal(list, listContainer) : list;
      })()}
    </div>
  );
}
