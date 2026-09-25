'use client';

/**
 * งานแก้ไข / งานต่อเนื่อง (EMCS) — เรื่องที่ค้างในกล่อง INBOX "รายงานแก้ไข" และ "งานต่อเนื่อง" บน EMCS (user สั่ง 25/09/69)
 *
 * ข้อมูลมาจาก se-billing: scraper ดึงจาก EMCS วันละครั้ง ~06:00 (ชุดเดียวกับแดชบอร์ดงานค้างใน extension บน ISURVEY)
 * หน้านี้อ่านอย่างเดียว ไม่เข้า EMCS · หัวหน้า = ผู้ปิดงานของเคลมนั้นบน ISURVEY
 * ใครเห็นอะไร (user สั่ง 25/09/69 · กรองที่ server): หัวหน้าผู้ตรวจเห็นเฉพาะงานของตัวเอง · แอดมินเห็นทุกคน + ปุ่มเลือกดูรายหัวหน้า
 * เรื่องที่อยู่ในกล่องเกิน 2 ปี = ป้ายเล็ก "เกิน 2 ปี" (แดชบอร์ดเดิมของ se-billing ตัดทิ้ง หน้านี้แสดงครบ)
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

type Kind = 'edit' | 'continuous';
type Row = {
  claim_no: string; date: string; aging_days: number | null; supervisor: string; over_age: boolean;
  esurvey_no: string; survey_no: string; company: string; car_role: string; follow_type: string;
  keyer: string; lock_by: string;
  case_id: number | null; case_status: string | null; case_count: number;
};
type Data = {
  generated_at: string | null; date: string | null;
  complete: boolean; inbox_ok: boolean; max_age_years: number;
  scope: 'all' | 'mine'; my_name: string; my_supervisor: string | null;
  edit: Row[]; continuous: Row[];
  supervisors: { name: string; edit: number; continuous: number }[];
  unknown_supervisor: string;
};

const KINDS: Kind[] = ['edit', 'continuous'];
const KIND_LABEL: Record<Kind, string> = { edit: 'รายงานแก้ไข', continuous: 'งานต่อเนื่อง' };
const ALL = '';
const STATUS_TH: Record<string, string> = {
  pending: 'รอมอบหมาย', assigned: 'มอบหมายแล้ว', declined: 'ช่างปฏิเสธ', surveyed: 'รอตรวจ',
  reviewed: 'อนุมัติแล้ว', finished: 'เสร็จงาน', cancelled: 'ยกเลิก',
};
/** ข้อมูลเก่ากว่านี้ = ตัวดึงรายวันของ se-billing น่าจะไม่ได้รัน (เครื่องที่ตั้งเวลาไว้ปิดอยู่) */
const STALE_HOURS = 30;

const errMsg = (e: unknown) =>
  (e as { response?: { data?: { message?: string } } })?.response?.data?.message || (e as Error)?.message || 'โหลดไม่สำเร็จ';
const fmtBkk = (iso: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
};
const agingClass = (n: number | null) =>
  n === null ? 'text-gray-400' : n >= 30 ? 'text-red-700 font-semibold' : n >= 7 ? 'text-amber-700' : 'text-gray-700';
/** "ไอโออิกรุงเทพประกันภัย" → "ไอโออิ" · "ไทยไพบูลย์ประกันภัย" → "ไทยไพบูลย์" (ชื่อเต็มอยู่ใน title) */
const shortCompany = (s: string) => s.replace(/ประกันภัย.*$/, '').replace(/กรุงเทพ$/, '').trim() || s;

export default function EmcsBacklogPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = useState<Kind>('edit');
  /** แอดมิน: หัวหน้าที่เลือกดู (ALL = ทั้งหมด) · หัวหน้าผู้ตรวจได้แค่ของตัวเองจาก server อยู่แล้ว */
  const [sup, setSup] = useState<string>(ALL);
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      setData((await api.get('/api/emcs-backlog')).data?.data as Data);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const isAll = data?.scope === 'all';
  const supLabel = (name: string) => (data && name === data.unknown_supervisor ? 'ไม่พบหัวหน้า' : name);
  const needle = q.replace(/\s+/g, '').toUpperCase();
  const rows = useMemo(() => {
    const list = data?.[kind] ?? [];
    if (needle) return list.filter((r) => [r.claim_no, r.esurvey_no, r.survey_no].some((v) => v.toUpperCase().includes(needle)));
    return isAll && sup ? list.filter((r) => r.supervisor === sup) : list;
  }, [data, kind, sup, needle, isAll]);
  const chips = useMemo(() => (data?.supervisors ?? [])
    .map((s) => ({ name: s.name, n: s[kind] }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'th')), [data, kind]);
  const staleHours = data?.generated_at ? (Date.now() - new Date(data.generated_at).getTime()) / 3600000 : null;
  const overAgeCount = (k: Kind) => (data?.[k] ?? []).filter((r) => r.over_age).length;

  const copy = async (claim: string) => {
    try { await navigator.clipboard.writeText(claim); setCopied(claim); setTimeout(() => setCopied((c) => (c === claim ? '' : c)), 1500); }
    catch { /* คลิปบอร์ดถูกปิด — เลือกข้อความเองได้ */ }
  };

  return (
    <div className="max-w-7xl">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-xl font-bold text-gray-800">
          งานแก้ไข / งานต่อเนื่อง (EMCS)
          {data && !isAll && data.my_supervisor && <span className="text-base font-normal text-gray-600"> — ของ {data.my_supervisor}</span>}
        </h1>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="px-3 py-1.5 text-sm border border-gray-300 bg-white rounded-none hover:bg-gray-50 disabled:opacity-50">
          {loading ? 'กำลังโหลด…' : 'โหลดใหม่'}
        </button>
      </div>
      <p className="text-sm text-gray-600 mb-3">
        เรื่องที่ค้างในกล่อง INBOX &quot;รายงานแก้ไข&quot; และ &quot;งานต่อเนื่อง&quot; บน EMCS
        {data && <> · ข้อมูล ณ <span className="font-medium text-gray-800">{fmtBkk(data.generated_at)}</span></>}
        {' '}(se-billing ดึงจาก EMCS วันละครั้ง ~06:00)
        {data && (isAll ? ' · แอดมินเห็นงานของทุกหัวหน้า' : ' · แสดงเฉพาะงานของคุณ')}
      </p>

      {error && <div className="mb-3 bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-2">{error}</div>}
      {data && !data.inbox_ok && (
        <div className="mb-3 bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-2">
          รอบล่าสุดตัวดึงของ se-billing เข้า EMCS ไม่ได้ — รายการว่างไม่ได้แปลว่าไม่มีงาน (ตรวจรหัส EMCS ในเครื่องที่ตั้งเวลาไว้)
        </div>
      )}
      {staleHours !== null && staleHours > STALE_HOURS && (
        <div className="mb-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-2">
          ข้อมูลเก่ากว่า 1 วัน — ตัวดึงรายวันของ se-billing อาจไม่ได้รัน (เครื่องที่ตั้งเวลาไว้ปิดอยู่หรือเข้า EMCS ไม่ได้)
        </div>
      )}
      {data && !isAll && !data.my_supervisor && (
        <div className="mb-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm px-4 py-2">
          ชื่อบัญชีนี้ ({data.my_name || '-'}) ไม่ตรงกับชื่อหัวหน้าในข้อมูล EMCS — หัวหน้าในข้อมูลคือผู้ปิดงานบน ISURVEY · ถ้าควรมีงาน แจ้งแอดมินให้ตรวจชื่อบัญชี
        </div>
      )}
      {data && !data.complete && (
        <div className="mb-3 bg-gray-50 border border-gray-200 text-gray-700 text-sm px-4 py-2">
          ข้อมูลรอบนี้ยังเป็นแบบเดิมของ se-billing (ไม่มีเรื่องที่เกิน {data.max_age_years} ปี/ไม่มีเลขเคลม และไม่มีเลข e-Survey) — ตั้งแต่รอบ 06:00 ถัดไปจะครบทุกเรื่อง
        </div>
      )}
      {!data && !error && <div className="text-sm text-gray-500">กำลังโหลด…</div>}

      {data && (
        <>
          <div className="flex gap-0 border-b border-gray-300 mb-3">
            {KINDS.map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                className={`px-4 py-2 text-sm -mb-px border-b-2 ${kind === k ? 'border-blue-600 text-blue-700 font-semibold' : 'border-transparent text-gray-600 hover:text-gray-800'}`}>
                {KIND_LABEL[k]} <span className="text-xs">({data[k].length})</span>
                {overAgeCount(k) > 0 && <span className="text-[11px] text-gray-500"> · เกิน {data.max_age_years} ปี {overAgeCount(k)}</span>}
              </button>
            ))}
          </div>

          {isAll && (
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <button type="button" onClick={() => setSup(ALL)}
                className={`px-2.5 py-1 text-xs border rounded-none ${sup === ALL ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                ทั้งหมด ({data[kind].length})
              </button>
              {chips.map((c) => (
                <button key={c.name} type="button" onClick={() => setSup(c.name)}
                  className={`px-2.5 py-1 text-xs border rounded-none ${sup === c.name ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}`}>
                  {supLabel(c.name)} ({c.n})
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 mb-3">
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={isAll ? 'ค้นเลขเคลม / e-Survey / เลขเซอร์เวย์ (ค้นทุกหัวหน้า)' : 'ค้นเลขเคลม / e-Survey / เลขเซอร์เวย์'}
              className="w-96 border border-gray-300 rounded-none px-3 py-1.5 text-sm" />
            <span className="text-xs text-gray-500">{rows.length} เรื่อง</span>
          </div>

          <div className="bg-white border border-gray-200 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-3 py-2 text-right w-12">#</th>
                  <th className="px-3 py-2 text-left">เลขเคลม</th>
                  <th className="px-3 py-2 text-left">e-Survey · เลขเซอร์เวย์</th>
                  <th className="px-3 py-2 text-left">ประกัน</th>
                  <th className="px-3 py-2 text-left">วันที่ในกล่อง EMCS</th>
                  <th className="px-3 py-2 text-right">ค้างมา (วัน)</th>
                  <th className="px-3 py-2 text-left">ผู้คีย์ · ล็อก</th>
                  {isAll && <th className="px-3 py-2 text-left">หัวหน้า</th>}
                  <th className="px-3 py-2 text-left">ในเว็บ SE</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.esurvey_no}|${r.claim_no}|${r.date}|${i}`} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-1.5 text-right text-gray-400">{i + 1}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {r.claim_no ? (
                        <>
                          <span className="font-mono">{r.claim_no}</span>
                          <button type="button" onClick={() => void copy(r.claim_no)} title="คัดลอกเลขเคลม"
                            className="ml-2 text-xs text-gray-500 border border-gray-200 rounded-none px-1.5 hover:bg-gray-50">
                            {copied === r.claim_no ? 'คัดลอกแล้ว' : 'คัดลอก'}
                          </button>
                        </>
                      ) : <span className="text-gray-400">(ไม่มีเลขเคลม)</span>}
                      {r.over_age && (
                        <span title={`อยู่ในกล่องเกิน ${data.max_age_years} ปี — แดชบอร์ดเดิมของ se-billing ไม่นับเรื่องนี้`}
                          className="ml-1.5 px-1 py-px text-[10px] leading-none border border-amber-300 bg-amber-50 text-amber-800 align-middle">
                          เกิน {data.max_age_years} ปี
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap font-mono text-xs text-gray-700">
                      <div>{r.esurvey_no || '-'}</div>
                      {r.survey_no && <div className="text-gray-500">{r.survey_no}</div>}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-xs">
                      <div title={r.company}>{r.company ? shortCompany(r.company) : '-'}{r.car_role && <span className="text-gray-500"> · {r.car_role}</span>}</div>
                      {r.follow_type && <div className="text-amber-700">{r.follow_type}</div>}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-gray-700">{r.date || '-'}</td>
                    <td className={`px-3 py-1.5 text-right whitespace-nowrap ${agingClass(r.aging_days)}`}>{r.aging_days ?? '-'}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-xs text-gray-700">
                      <div>{r.keyer || '-'}</div>
                      {r.lock_by && <div className="text-red-700" title="มีคนเปิดเรื่องค้างอยู่บน EMCS (ล็อก)">ล็อก: {r.lock_by}</div>}
                    </td>
                    {isAll && <td className="px-3 py-1.5 whitespace-nowrap">{supLabel(r.supervisor)}</td>}
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {r.case_id ? (
                        <Link href={`/inspector/cases/${r.case_id}`} className="text-blue-700 hover:underline">
                          #{r.case_id} · {STATUS_TH[r.case_status ?? ''] ?? r.case_status}{r.case_count > 1 ? ` (${r.case_count} ครั้ง)` : ''}
                        </Link>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={isAll ? 9 : 8} className="px-3 py-6 text-center text-gray-500">
                    {needle ? 'ไม่พบเลขที่ค้น' : `ไม่มีเรื่องค้างใน${KIND_LABEL[kind]}`}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            หัวหน้า = ผู้ปิดงานของเคลมนั้นบน ISURVEY (ไม่มีเลขเคลม = ดูจากเลขเซอร์เวย์ SETP/SEMS) · &quot;ไม่พบหัวหน้า&quot; = หาไม่เจอ (เห็นเฉพาะแอดมิน) ·
            ป้าย &quot;เกิน {data.max_age_years} ปี&quot; = อยู่ในกล่องนานเกิน {data.max_age_years} ปี · ค้างมา = นับจากวันที่ในกล่อง EMCS (แดง ≥ 30 วัน · ส้ม ≥ 7 วัน) ·
            ล็อก = มีคนเปิดเรื่องค้างอยู่บน EMCS
          </p>
        </>
      )}
    </div>
  );
}
