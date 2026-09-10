'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import api, { getPhotoUrl } from '@/lib/api';

export interface Case {
  id: number;
  customer_name: string;
  status: string;
  source?: string | null;
  claim_no?: string;
  survey_job_no?: string;
  claim_ref_no?: string;
  license_plate?: string;
  surveyor_first_name?: string;
  surveyor_last_name?: string;
  surveyor_code?: string | null;
  /** Postgres คืน ROW_NUMBER/COUNT เป็นสตริง — ประกาศให้ตรงความจริง กัน `"2" > 1` แบบเผลอ */
  visit_count?: number | string;
  created_at: string;
  /** เรื่องที่ต้องเติมก่อนอนุมัติ — เก็บไว้ตั้งแต่ตอนนำเข้า (migration 040) */
  import_warnings?: string[] | null;
  photo_count?: number | string | null;
  pay_total?: number | string | null;
  has_insurer_bill?: boolean | null;
  review_status?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  /** เวลาไทย พ.ศ. 'DD/MM/ปปปป HH:MM' (backend จัดรูปแบบให้) — คอลัมน์ "ส่งงาน / ตรวจรายงาน" (10/09/69) */
  submitted_at_th?: string | null;
  reviewed_at_th?: string | null;
  unlocked_count?: number | null;
  /** ตีกลับให้ผู้สำรวจ (migration 041) — status กลับเป็น 'assigned' แต่ยังอยู่ในลิสต์นี้ */
  sent_back_at?: string | null;
  sent_back_reason?: string | null;
  sent_back_count?: number | null;
  /** เสร็จงานหน้างานแล้ว (migration 054, 07/09/69) — status 'finished' ยังไม่ส่งรายงาน ช่างรับงานใหม่ได้ */
  finished_at?: string | null;
  emcs_imported_at?: string | null; // สร้าง draft ใน EMCS แล้วเมื่อ (null = ยัง) — กันกดซ้ำถาวรข้ามเครื่อง
  // ⚠️ "นำเข้าแล้ว" ≠ "ส่งงานแล้ว" — บอทสร้าง draft ให้เท่านั้น ปุ่ม "ส่งงานใหม่" คนกดเอง
  emcs_submitted_at?: string | null;  // ยืนยันแล้วว่าประกันรับงาน (null = ยังเป็น draft ค้าง)
  emcs_status_text?: string | null;   // ข้อความสถานะดิบจากหน้ารายการ EMCS
  // คิวนำเข้า EMCS ของสถานีนำเข้า (migration 052) — งานล่าสุดของเคส
  emcs_job_id?: number | null;
  emcs_job_status?: string | null;      // queued | running | done | failed | cancelled
  emcs_job_dry_run?: boolean | null;
  emcs_job_station?: string | null;
  emcs_job_error?: string | null;
  emcs_job_screenshot?: string | null;
  emcs_job_position?: number | string | null;
  emcs_job_requested_at?: string | null;
}
interface CaseListProps { cases: Case[]; basePath?: string; }

// ตัวรับงานคือโปรแกรม SE-AutoKey ที่รันบนเครื่องผู้ตรวจ (webui, พอร์ต 8765)
// — หน้าเว็บสั่ง EMCS ตรงไม่ได้ (คนละ origin) จึงส่งงานให้โปรแกรมบนเครื่องเป็นคนขับ EMCS แทน
// (เรียก http://127.0.0.1 จากหน้า https ได้ — เบราว์เซอร์ยกเว้น mixed-content ให้ loopback)
const AUTOKEY_URL = 'http://127.0.0.1:8765';

type AutokeyState = 'checking' | 'ready' | 'missing' | 'blocked';

/** Chrome 142+ ("Local network access"): เว็บ https ต้องได้รับอนุญาตจากผู้ใช้ก่อนจึงจะคุยกับ 127.0.0.1 ได้
 *  → 'prompt' = Chrome จะเด้งถามตอนยิงครั้งแรก · 'denied' = ผู้ใช้เคยกดบล็อก (ต้องไปแก้ที่ตั้งค่าไซต์) · null = เบราว์เซอร์ไม่มีระบบนี้ */
async function localNetworkPermission(): Promise<PermissionState | null> {
  try {
    const p = await navigator.permissions.query({ name: 'local-network-access' as PermissionName });
    return p.state;
  } catch {
    return null;
  }
}

/** เครื่องนี้มีโปรแกรม SE-AutoKey เปิดอยู่ไหม — ใช้ตัดสินว่าจะโชว์ปุ่ม "นำเข้า EMCS" หรือข้อความ "รอผู้นำเข้า"
 *  webui ทุกรุ่นตอบพร้อม CORS แม้เป็น 404 → fetch สำเร็จ = มีโปรแกรม · ต่อไม่ติด (ไม่ได้เปิด/ไม่ได้ติดตั้ง) = TypeError */
async function probeAutokey(): Promise<AutokeyState> {
  const perm = await localNetworkPermission();
  if (perm === 'denied') return 'blocked';
  const ctl = new AbortController();
  // ถ้า Chrome ต้องถามสิทธิ์ก่อน (prompt) ให้รอผู้ใช้กดตอบได้นานหน่อย — ไม่งั้นจะสรุปว่า "ไม่มีโปรแกรม" ทั้งที่ยังไม่ทันตอบ
  const timer = setTimeout(() => ctl.abort(), perm === 'prompt' ? 20000 : 2000);
  try {
    await fetch(`${AUTOKEY_URL}/healthz`, { signal: ctl.signal, cache: 'no-store' });
    return 'ready';
  } catch {
    // ผู้ใช้กด "บล็อก" ตอน Chrome ถาม → สิทธิ์เพิ่งกลายเป็น denied หลัง fetch ล้ม
    if ((await localNetworkPermission()) === 'denied') return 'blocked';
    return 'missing';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * ป้าย "ที่มา" ของงาน — สำคัญเพราะ **กติกาเงินต่างกันตามที่มา**
 * งานที่เกิดในระบบเรา (mobile) กับที่ดึงสดจากระบบเก่า (isurvey_live) หัวหน้ากรอกยอดเองได้
 * ส่วนงานที่ปิดจบบนระบบเก่าแล้ว (isurvey_xml) ยอดอยู่ที่ se-billing → ที่นี่ดูอย่างเดียว
 * ไม่บอกที่มาบนหน้าลิสต์ = หัวหน้างงว่าทำไมบางเคสกรอกยอดได้ บางเคสกรอกไม่ได้
 */
const SOURCE_LABEL: Record<string, { text: string; cls: string }> = {
  mobile: { text: 'แอปมือถือ', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  isurvey_live: { text: 'ระบบเก่า (สด)', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  isurvey_xml: { text: 'ไฟล์ XML', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  emcs_extract: { text: 'ข้อมูลทดสอบ', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

/** รูปน้อยกว่านี้ = น่าจะยังอัปไม่ครบ (งานจากระบบเก่าทยอยอัปรูปหลังช่างส่งงาน) */
const LOW_PHOTO = 5;

/** ย่อคำเตือนยาว ๆ ให้เป็นป้ายสั้นพอใส่ในตาราง — ข้อความเต็มอยู่ใน title */
function warnChip(w: string): string {
  const m: [RegExp, string][] = [
    [/ประเภทรถ/, 'ประเภทรถ'],
    [/รายการความเสียหาย/, 'ความเสียหาย'],
    [/เลขที่รับแจ้ง/, 'เลขที่รับแจ้ง'],
    [/ผลคดี/, 'ผลคดี'],
    [/ประเภทเคลม/, 'ประเภทเคลม'],
    [/ระดับการบาดเจ็บ/, 'ระดับบาดเจ็บ'],
    [/ประเภทผู้บาดเจ็บ/, 'ประเภทผู้บาดเจ็บ'],
    [/จังหวัด/, 'จังหวัด'],
    [/เลขเคลม/, 'เลขเคลม'],
    [/เลขเซอร์เวย์/, 'เลขเซอร์เวย์'],
  ];
  for (const [re, label] of m) if (re.test(w)) return label;
  return w.length > 18 ? w.slice(0, 18) + '…' : w;
}

/** ยอดเงินที่ยังขาด — กติกาเดียวกับที่หน้ารายละเอียดใช้กันปุ่มอนุมัติ */
export function moneyGaps(c: Case): string[] {
  const gaps: string[] = [];
  const payEditable = ['mobile', 'isurvey_live'].includes(String(c.source ?? 'mobile'));
  if (payEditable && !(Number(c.pay_total ?? 0) > 0)) gaps.push('ยอดพนักงาน');
  if (!c.has_insurer_bill) gaps.push('ยอดประกัน');
  return gaps;
}

/** เวลาไทย "7/9 10:15" จาก ISO — ใช้ป้ายเล็กในแถว (เทียบวันเวลาด้วยเวลา UTC จะเพี้ยนช่วงหัวค่ำ) */
function bkkTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleString('th-TH', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
}

function getStatusBadge(status: string) {
  const styles: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700',
    assigned: 'bg-orange-100 text-orange-700',
    finished: 'bg-teal-100 text-teal-700',
    surveyed: 'bg-blue-100 text-blue-700',
    reviewed: 'bg-green-100 text-green-700',
    declined: 'bg-red-100 text-red-700',
  };
  const labels: Record<string, string> = { pending: 'รอมอบหมาย', assigned: 'มอบหมายแล้ว', finished: 'เสร็จงานแล้ว', surveyed: 'สำรวจแล้ว', reviewed: 'ตรวจสอบแล้ว', declined: 'ปฏิเสธแล้ว' };
  return <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${styles[status] || styles.pending}`}>{labels[status] || status}</span>;
}

export default function CaseList({ cases, basePath = '/inspector' }: CaseListProps) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [sentIds, setSentIds] = useState<Set<number>>(new Set());
  /** ผลกดคิวแบบทันที (ก่อนรายการโหลดใหม่ผ่าน socket) — key = case id */
  const [queued, setQueued] = useState<Record<number, 'queued' | 'cancelled'>>({});
  const [queueBusy, setQueueBusy] = useState<number | null>(null);
  const [shotOpen, setShotOpen] = useState<number | null>(null);

  /** ส่งเข้าคิวสถานีนำเข้า — กดจากเครื่องไหนก็ได้ ไม่ต้องมีบอทในเครื่อง (user ตัดสิน 04/09/69) */
  const enqueue = async (c: Case) => {
    if (queueBusy !== null) return;
    if (!window.confirm(`ส่งเคส #${c.id}${c.claim_no ? ` (เคลม ${c.claim_no})` : ''} เข้าคิวให้สถานีสร้าง draft บน EMCS?`)) return;
    setQueueBusy(c.id);
    try {
      await api.post(`/api/emcs-queue/cases/${c.id}`);
      setQueued((m) => ({ ...m, [c.id]: 'queued' }));
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      alert(err.response?.data?.message || 'ส่งเข้าคิวไม่สำเร็จ');
    } finally { setQueueBusy(null); }
  };
  const dequeue = async (c: Case) => {
    if (queueBusy !== null) return;
    setQueueBusy(c.id);
    try {
      const r = await api.delete(`/api/emcs-queue/cases/${c.id}`);
      if (r.data?.data?.cancelled) setQueued((m) => ({ ...m, [c.id]: 'cancelled' }));
      else alert(r.data?.data?.reason || 'ยกเลิกไม่ได้');
    } catch (e) {
      const err = e as { response?: { data?: { message?: string } } };
      alert(err.response?.data?.message || 'ยกเลิกไม่สำเร็จ');
    } finally { setQueueBusy(null); }
  };

  // ปุ่ม "นำเข้า EMCS" ใช้ได้เฉพาะเครื่องที่มีบอทเปิดอยู่ — เครื่องอื่นเห็น "รอผู้นำเข้า EMCS หรือติดตั้ง se-autokey"
  // (user เคาะ 04/09/69: บอทอยู่บนเครื่องผู้ใช้ก่อน รันบนเซิร์ฟเวอร์ไว้เฟสถัดไป) · ตรวจเฉพาะเมื่อมีแถวที่ต้องใช้ปุ่ม
  const needsAutokey = cases.some((c) => c.status === 'reviewed' && !c.emcs_imported_at);
  // รายการใหม่มาถึง (socket/โพล) = server รู้สถานะจริงแล้ว → เลิกใช้ผลที่กดในเครื่อง
  useEffect(() => { setQueued({}); }, [cases]);
  const [autokey, setAutokey] = useState<AutokeyState>('checking');
  useEffect(() => {
    if (!needsAutokey) return;
    let alive = true;
    const check = async () => {
      const st = await probeAutokey();
      if (alive) setAutokey(st);
    };
    check();
    // เปิดโปรแกรมทีหลังแล้วสลับกลับมาหน้านี้ → ตรวจใหม่ ปุ่มโผล่เองไม่ต้องรีเฟรช
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(onVisible, 60000);
    return () => {
      alive = false;
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [needsAutokey]);

  // ส่งเคสให้ SE-AutoKey บนเครื่องนี้นำเข้า EMCS **จริง** (สร้าง draft — บอทไม่กดส่งงาน คนกดเอง)
  // user เปิดโหมดจริงจากเว็บ 04/09/69 · ถามยืนยันก่อนเพราะ draft ที่สร้างแล้วลบใน EMCS ไม่ได้ (ยกเลิกได้อย่างเดียว)
  const sendToAutokey = async (c: Case) => {
    if (busyId !== null) return;
    if (!window.confirm(`สร้าง draft บน EMCS ของเคส #${c.id}${c.claim_no ? ` (เคลม ${c.claim_no})` : ''} ตอนนี้?\n\n`
      + 'บอทบนเครื่องนี้จะเปิด EMCS แล้วกรอกให้จนถึง draft — ไม่กด "ส่งงานใหม่" ให้ ต้องตรวจแล้วกดส่งเอง\n'
      + 'draft ที่สร้างแล้วลบใน EMCS ไม่ได้ (ยกเลิกได้อย่างเดียว) กดตกลงเมื่อพร้อม')) return;
    setBusyId(c.id);
    try {
      const res = await fetch(`${AUTOKEY_URL}/api/import-sesurvey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: c.id, claim_no: c.claim_no || '', survey_job_no: c.survey_job_no || '', live: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`SE-AutoKey ปฏิเสธงาน: ${body.error || res.status}`);
        return;
      }
      setSentIds((prev) => new Set(prev).add(c.id));
    } catch {
      // ผ่านการตรวจตอนเปิดหน้า แต่ตอนกดต่อไม่ติด = โปรแกรมเพิ่งถูกปิด หรือ Chrome บล็อกการเข้าถึงเครือข่ายภายใน → ตรวจใหม่แล้วบอกสาเหตุ
      void probeAutokey().then(setAutokey);
      alert('เชื่อมต่อโปรแกรม SE-AutoKey ไม่ได้ — โปรแกรมอาจถูกปิดไปแล้ว เปิดใหม่ (start-webui.bat) แล้วลองอีกครั้ง\n\nถ้า Chrome ถามสิทธิ์ "เข้าถึงเครือข่ายภายใน" ให้กด อนุญาต (ถ้าเคยกดบล็อก ไปแก้ที่ตั้งค่าไซต์ข้างช่อง URL)\n\nหรือรอผู้นำเข้า EMCS นำเข้าให้');
    } finally {
      setBusyId(null);
    }
  };

  if (cases.length === 0) return <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">ไม่มีรายการงานในขณะนี้</div>;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">เลขเคลม</th>
            <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">ที่มา</th>
            <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">ช่างสำรวจ</th>
            {/* รอตรวจ = เวลาส่งงานจากแอป (งานไหนค้างนานสุด) · อนุมัติแล้ว/ส่งประกันแล้ว = เวลาที่หัวหน้ากดอนุมัติ (user เคาะ 10/09/69) */}
            <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">ส่งงาน / ตรวจรายงาน</th>
            <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">ต้องเติมก่อนอนุมัติ</th>
            <th className="px-5 py-3 text-left text-xs font-medium text-gray-500 uppercase">EMCS</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {cases.map((c) => {
            const src = SOURCE_LABEL[String(c.source ?? 'mobile')] ?? SOURCE_LABEL.mobile;
            const warns = Array.isArray(c.import_warnings) ? c.import_warnings : [];
            const photos = Number(c.photo_count ?? 0);
            const gaps = moneyGaps(c);
            const approved = c.status === 'reviewed';
            return (
            <tr key={c.id} onClick={() => router.push(`${basePath}/cases/${c.id}`)} className="hover:bg-gray-50 cursor-pointer transition-colors">
              <td className="px-5 py-4">
                <div className="text-sm text-gray-800">{c.claim_no || '-'}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {c.survey_job_no || '-'}
                  {/* Postgres คืน COUNT/ROW_NUMBER มาเป็นสตริง — ต้อง Number() ก่อนเทียบ */}
                  {Number(c.visit_count ?? 1) > 1 && <span className="ml-1">· ครั้งที่ {c.visit_count}</span>}
                </div>
              </td>
              <td className="px-5 py-4">
                <span className={`px-2 py-0.5 rounded text-xs border ${src.cls}`}>{src.text}</span>
              </td>
              <td className="px-5 py-4 text-sm text-gray-600">
                {c.surveyor_first_name
                  ? `${c.surveyor_code ? c.surveyor_code + ' ' : ''}${c.surveyor_first_name}`
                  : <span className="text-amber-600 text-xs">ยังไม่ได้มอบหมาย</span>}
              </td>
              <td className="px-5 py-4 text-xs whitespace-nowrap">
                {approved ? (
                  <>
                    <div className="text-gray-400">ตรวจรายงาน</div>
                    <div className="text-gray-800">{c.reviewed_at_th || '-'}</div>
                  </>
                ) : (
                  <>
                    <div className="text-gray-400">ส่งงาน</div>
                    {/* งานจาก ISURVEY/XML ไม่ได้ส่งผ่านแอป → ไม่มีเวลาส่งงาน */}
                    <div className="text-gray-800">{c.submitted_at_th || '-'}</div>
                  </>
                )}
              </td>
              <td className="px-5 py-4">
                {approved ? (
                  <span className="text-xs text-green-700">
                    ✓ อนุมัติแล้ว{c.approved_by ? ` · ${c.approved_by}` : ''}
                  </span>
                ) : (warns.length + gaps.length === 0 && photos > LOW_PHOTO) ? (
                  <span className="text-xs text-green-700">✓ ครบ · {photos} รูป</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {gaps.map((g) => (
                      <span key={g} title={`ยังไม่ได้กรอก${g}`}
                        className="px-1.5 py-0.5 rounded text-xs bg-red-50 text-red-700 border border-red-200">{g}</span>
                    ))}
                    {warns.map((w, i) => (
                      <span key={i} title={w}
                        className="px-1.5 py-0.5 rounded text-xs bg-amber-50 text-amber-700 border border-amber-200">{warnChip(w)}</span>
                    ))}
                    {photos <= LOW_PHOTO && (
                      <span title="รูปน้อยผิดปกติ — ต้นทางอาจยังอัปไม่ครบ กด &quot;ดึงรูปใหม่&quot; ที่โปรแกรมผู้ตรวจ หรือเพิ่มรูปเองในหน้าเคส"
                        className="px-1.5 py-0.5 rounded text-xs bg-amber-50 text-amber-700 border border-amber-200">
                        รูป {photos} ใบ
                      </span>
                    )}
                  </div>
                )}
                {c.status === 'assigned' && c.sent_back_at && (
                  <div className="text-xs text-orange-700 mt-1" title={String(c.sent_back_reason ?? '')}>
                    ตีกลับแล้ว — รอช่างส่งใหม่
                  </div>
                )}
                {/* เสร็จงานหน้างานแล้ว (07/09/69) — งานภาคสนามจบ เหลือช่างทำรายงานแล้วกดส่ง ยังไม่ใช่คิวของหัวหน้า */}
                {c.status === 'finished' && (
                  <div className="text-xs text-teal-700 mt-1" title="ช่างกด &quot;เสร็จงาน&quot; หน้างานแล้ว กำลังทำรายงาน — ยังไม่ส่งให้ตรวจ · ช่างรับงานใหม่ได้แล้ว">
                    เสร็จงานแล้ว — รอช่างส่งรายงาน{c.finished_at ? ` (${bkkTime(c.finished_at)})` : ''}
                  </div>
                )}
                {(c.unlocked_count ?? 0) > 0 && (
                  <div className="text-xs text-gray-400 mt-1" title="เคสนี้เคยถูกปลดล็อกเพื่อแก้ไข">
                    ปลดล็อกมาแล้ว {c.unlocked_count} ครั้ง
                  </div>
                )}
              </td>
              <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                {(c.status === 'surveyed' || c.status === 'reviewed') ? (
                  c.emcs_imported_at ? (
                    // นำเข้า EMCS แล้ว (mark ถาวรใน DB) — ห้าม import ซ้ำ: EMCS จะสร้างเรื่องซ้ำที่เลขเคลมเดิม
                    // แต่ "นำเข้าแล้ว" ยังไม่ใช่ "ประกันได้รับงาน" — บอทสร้างได้แค่ draft
                    // ปุ่ม "ส่งงานใหม่" บน EMCS คนต้องกดเอง ป้ายจึงต้องแยก 2 สถานะ
                    c.emcs_submitted_at ? (
                      <span className="text-xs font-medium text-green-700"
                            title={`ส่งงานเมื่อ ${c.emcs_submitted_at}`}>✓ ส่งงานแล้ว</span>
                    ) : (
                      <span className="text-xs font-medium text-amber-700"
                            title={`สร้าง draft เมื่อ ${c.emcs_imported_at}`
                                   + (c.emcs_status_text ? ` · สถานะล่าสุด: ${c.emcs_status_text}` : '')}>
                        ⏳ draft ค้าง — รอกด &quot;ส่งงานใหม่&quot;
                      </span>
                    )
                  ) : sentIds.has(c.id) ? (
                    <span className="text-xs font-medium text-emerald-700" title="บอทกำลังสร้าง draft — ดูความคืบหน้าที่หน้าโปรแกรม SE-AutoKey บนเครื่องนี้ · เสร็จแล้วแถวนี้จะเปลี่ยนเป็น draft ค้าง">
                      ✓ ส่งให้บอทเครื่องนี้แล้ว — กำลังสร้าง draft
                    </span>
                  ) : approved ? (() => {
                    // สถานะคิวสถานี — ค่าจาก server ถูกทับด้วยผลที่เพิ่งกดในเครื่องจนกว่ารายการจะโหลดใหม่
                    const local = queued[c.id];
                    const st = local === 'queued' ? 'queued' : local === 'cancelled' ? 'cancelled' : (c.emcs_job_status ?? null);
                    const err = c.emcs_job_error ?? '';
                    if (st === 'queued') {
                      return (
                        <span className="text-xs text-blue-800" title={`ส่งเข้าคิวเมื่อ ${c.emcs_job_requested_at ?? 'เมื่อสักครู่'}`}>
                          🕓 อยู่ในคิวสถานี{c.emcs_job_position && local !== 'queued' ? ` ลำดับ ${c.emcs_job_position}` : ''}{c.emcs_job_dry_run ? ' (ทดสอบ)' : ''}
                          <button type="button" onClick={() => dequeue(c)} disabled={queueBusy !== null}
                            className="ml-2 underline text-gray-500 hover:text-red-600 disabled:opacity-50">ยกเลิก</button>
                        </span>
                      );
                    }
                    if (st === 'running') {
                      return (
                        <span className="text-xs text-amber-700" title="บอทที่สถานีกำลังเปิด EMCS สร้าง draft — รอสักครู่ แถวนี้จะเปลี่ยนเอง">
                          ⚙️ สถานี {c.emcs_job_station || ''} กำลังสร้าง draft…
                        </span>
                      );
                    }
                    return (
                      <div className="flex flex-col items-start gap-1">
                        {st === 'failed' && (
                          <div className="text-xs text-red-600 max-w-[22rem]" title={err}>
                            ❌ สถานี{c.emcs_job_station ? ` ${c.emcs_job_station}` : ''} นำเข้าไม่สำเร็จ: {err.length > 90 ? `${err.slice(0, 90)}…` : err}
                            {c.emcs_job_screenshot && (
                              <button type="button" onClick={() => setShotOpen(shotOpen === c.id ? null : c.id)}
                                className="ml-1 underline text-gray-600">{shotOpen === c.id ? 'ซ่อนภาพ' : 'ดูภาพหน้าจอ'}</button>
                            )}
                            {shotOpen === c.id && c.emcs_job_screenshot && (
                              <img src={getPhotoUrl(c.emcs_job_screenshot)} alt="ภาพหน้าจอตอนพัง" className="mt-1 border border-gray-300 max-w-[22rem]" />
                            )}
                          </div>
                        )}
                        {st === 'done' && c.emcs_job_dry_run && (
                          <span className="text-xs text-emerald-700">✓ ทดสอบสถานีผ่าน (ไม่แตะ EMCS)</span>
                        )}
                        {st === 'cancelled' && <span className="text-xs text-gray-400">ยกเลิกคิวแล้ว</span>}
                        <button
                          type="button" onClick={() => enqueue(c)} disabled={queueBusy !== null}
                          title="ส่งเข้าคิวให้เครื่องสถานีนำเข้า EMCS สร้าง draft (กดได้จากทุกเครื่อง ไม่ต้องมีบอทในเครื่อง)"
                          className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                        >
                          {queueBusy === c.id ? 'กำลังส่ง...' : st === 'failed' ? '📤 ส่งเข้าคิวอีกครั้ง' : '📤 ส่งเข้าคิว EMCS'}
                        </button>
                        {autokey === 'ready' && (
                          // ทางรอง: เครื่องนี้มีบอทเปิดอยู่ — สร้าง draft ด้วยตัวเองได้เลย (ถามยืนยันก่อน)
                          <button type="button" onClick={() => sendToAutokey(c)} disabled={busyId !== null}
                            title="ใช้บอทบนเครื่องนี้สร้าง draft เดี๋ยวนี้ (ไม่ผ่านคิว) — อย่ากดถ้าเครื่องนี้คือสถานีที่กำลังรับคิวอยู่"
                            className="text-[0.7rem] text-indigo-700 underline hover:text-indigo-900 disabled:opacity-50">
                            {busyId === c.id ? 'กำลังส่ง...' : 'หรือนำเข้าด้วยบอทเครื่องนี้'}
                          </button>
                        )}
                      </div>
                    );
                  })() : (
                    // ⛔ ยังไม่อนุมัติ = บอทดึงข้อมูลไม่ได้อยู่แล้ว (403 NOT_APPROVED)
                    // โชว์ปุ่มไว้เฉย ๆ จะทำให้กดแล้วเจอ error โดยไม่รู้สาเหตุ
                    <span className="text-xs text-gray-400">รออนุมัติก่อน</span>
                  )
                ) : (
                  <span className="text-gray-300 text-xs">-</span>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { getStatusBadge };
