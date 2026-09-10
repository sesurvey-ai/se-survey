'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import PhotoGallery from './PhotoGallery';
import { PROVINCE_OPTIONS, carBrandOptions, CAR_COLOR_OPTIONS, EV_TYPE_OPTIONS, ACC_CAUSE_OPTIONS, ACC_DAMAGE_TYPE_OPTIONS, POLICY_TYPE_OPTIONS, CLAIM_TYPE_LABELS, CLAIM_TYPE_OPTIONS } from './caseOptions';
import { districtOptions } from './districtOptions';
import api from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { setFormDirty } from '@/lib/dirtyGuard';
import { useSocket } from '@/hooks/useSocket';
import { DamageItem, DamageList, autoDamageDesc } from './DamageEditor';
import DamageDialog from './DamageDialog';
import { OPPONENT_REQUIRED, INJURED_REQUIRED, PROPERTY_REQUIRED } from './RecordEditors';
import { InjuredEditor, PropertyEditor, OpponentEditor, dropEmptyRecords, dropEmptyOpponents, emcsBadChars, RecordItem, LooseRecord } from './RecordEditors';
import PolicyInfoModal from './PolicyInfoModal';

/** ค่าตอบแทนผู้สำรวจของเคส — `suggest` คือยอดที่ระบบคิดจากตารางเรท `saved` คือที่ผู้ตรวจบันทึกจริง
 *  แยกกันเพื่อให้เห็นว่าผู้ตรวจปรับจากยอดที่ระบบแนะนำไปเท่าไหร่ */
interface PayData {
  saved: Record<string, number | string | boolean | null> | null;
  suggest: {
    service_fee: number | null;
    /** เรทฝั่งเรียกเก็บประกันจากตารางเรท (ต่อครั้ง) — null = ไม่มีเรทของพื้นที่นี้ */
    ins_service_fee?: number | null;
    ins_travel_fee?: number | null;
    snapshot: Record<string, unknown>;
  } | null;
  area: {
    province_code: string | null; amphur_code: string | null; team: string | null;
    province_name: string | null; district_name: string | null; subdistrict_name?: string | null; tumbon_code?: string | null;
    /** พื้นที่ที่ใช้หาเรทมาจาก 'survey' = สถานที่ออกตรวจสอบ · 'accident' = สถานที่เกิดเหตุ (เคสไม่มีสถานที่ออกตรวจสอบ) */
    rate_location?: 'survey' | 'accident' | null;
    /** รหัสช่าง (SEC…) ที่ใช้หาทีม — บอกในข้อความ "ยังไม่ได้กำหนดทีม" */
    surveyor_code?: string | null;
    resolved: boolean; photo_count: number;
  } | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface CaseDetailProps {
  caseData: any;
  report: any;
  photos: any[];
  review: any;
  visitCount?: number;
  /** ครั้งที่ทั้งหมดของเลขเคลมนี้ (คนละเคสกัน) — ดู getDetail ฝั่ง backend */
  visits?: { id: number; visit_no: number | string; survey_job_no: string | null; status: string; created_on: string }[];
  expenses?: any;
  photoFeeSuggest?: { count: number; price: number; reason: string } | null;
  /** ตำบลที่มีเรทของตัวเอง (มาจากตารางเรท) — ใช้ทำตัวเลือก "ตำบล" ใต้เขต/อำเภอ */
  tumbonOptions?: { tumbon: string; district: string; province: string }[];
  onReviewSubmitted: () => void;
}

function parseDatetime(val: string | null) {
  if (!val) return { date: '', hour: '', minute: '' };
  const parts = val.split('|');
  const date = parts[0] || '';
  const time = parts[1] || '';
  const [hour, minute] = time.split(':');
  return { date, hour: hour || '', minute: minute || '' };
}

/**
 * บริษัทประกันที่รับงานจริง — value ต้องตรงกับที่ `resolve_insurer_code` ของบอทรู้จัก
 * (se-autokey/autokey/insurer_map.py) ไม่งั้นบอทหยุดและฟ้อง ไม่นำเข้ามั่ว
 * เพิ่มบริษัทใหม่: เติมที่นี่ + หน้า "นำเข้าจากไฟล์ XML" + เช็ครหัสใน insurer_map.py
 */
const INSURER_OPTIONS = [
  'บริษัท ไทยไพบูลย์ประกันภัย จำกัด (มหาชน)',
  'ไอโออิกรุงเทพประกันภัย',
];

/**
 * ศูนย์ = "ยังไม่ได้กำหนด" ในช่องที่ไม่มีใครตั้งใจใส่ 0 จริง ๆ (เช่นเปอร์เซ็นต์ค่าเรียกร้อง)
 * โชว์ 0.00 ไว้เฉย ๆ มีแต่ทำให้ต้องลบทิ้งก่อนพิมพ์ทับทุกครั้ง
 */
/**
 * เติมศูนย์หน้าให้ ชม./นาที ตอนออกจากช่อง — พิมพ์ "5" แล้วเห็น "05" ทันที
 * (backend เติมให้อีกชั้นเป็นด่านหลัก อันนี้ไว้ให้คนเห็นว่าค่าถูกจัดรูปแล้ว)
 */
function padTimeOnBlur(e: React.FocusEvent<HTMLInputElement>) {
  const v = e.target.value.trim();
  if (/^[0-9]{1}$/.test(v)) e.target.value = v.padStart(2, '0');
}

/**
 * ⛔ ค่าที่บันทึกไว้ต้องอยู่ในลิสต์เสมอ ไม่งั้นเบราว์เซอร์เลือก option แรกให้แทน
 *    (= "-- ระบุ --") แล้วพอกดบันทึก ตัวล้าง placeholder แปลงเป็นค่าว่าง
 *    → ข้อมูลเดิมหายถาวรโดยไม่มีดอกจันหรืออะไรเตือน
 *    เกิดจริงกับสีรถ (OCR ส่งข้อความอิสระเข้ามา) จังหวัด และสาเหตุการเกิดเหตุ
 *    ทำแบบเดียวกับที่ carBrandOptions / districtOptions กันไว้อยู่แล้ว
 */
/** ประเภทใบขับขี่ที่ EMCS มีให้เลือก — ยกมาจาก <option> ข้างล่างให้เทียบค่านอกลิสต์ได้ */
const DRIVER_LICENSE_TYPES = [
  'ใบขับขี่รถยนต์ส่วนบุคคลตลอดชีพ',
  'ใบขับขี่รถจักรยานยนต์ส่วนบุคคลตลอดชีพ',
  'ใบขับขี่รถยนต์ส่วนบุคคลชั่วคราว',
  'ใบขับขี่รถจักรยานยนต์ส่วนบุคคลชั่วคราว',
  'ใบขับขี่รถยนต์ส่วนบุคคล 5 ปีต่ออายุ',
  'ใบขับขี่รถยนต์สาธารณะ',
  'ใบขับขี่สากล',
  'ใบขับขี่รถยนต์ส่วนบุคคลหนึ่งปีต่ออายุ',
  'ใบขับขี่รถจักรยานยนต์ส่วนบุคคลหนึ่งปี',
  'ใบขับขี่รถยนต์ส่วนบุคคล 7 ปีต่ออายุ',
  'ใบขับขี่รถยนต์ส่วนบุคคล',
  'ใบขับขี่รถจักรยานยนต์ส่วนบุคคล',
  'ใบขับขี่ขนส่งชนิดที่1',
  'ใบขับขี่ขนส่งชนิดที่2',
  'ใบขับขี่ขนส่งชนิดที่3',
  'ใบอนุญาติขับขี่ชนิดที่4',
  'ไม่มีใบขับขี่',
  'ใบขับขี่รถยนต์สามล้อส่วนบุคคลสาธารณะ',
  'ใบขับขี่รถยนต์สามล้อส่วนบุคคลชั่วคราว',
  'ใบอนุญาตเป็นผู้ขับรถทุกประเภท',
  'อื่นๆ',
];

/**
 * เทียบชื่อพื้นที่ข้ามแหล่ง — ฟอร์มเก็บ "อำเภอศรีราชา"/"กรุงเทพ ฯ" ส่วนตารางเรทเก็บ
 * "ศรีราชา"/"กรุงเทพฯ" · ตัดคำนำหน้ากับช่องว่าง/ฯ ออกก่อนเทียบ ไม่งั้นไม่มีวันตรงกัน
 */
const areaKey = (v: unknown) => String(v ?? '').replace(/^(อำเภอ|เขต|จังหวัด)/, '').replace(/[s ฯ]/g, '').trim();
/** select จังหวัด/อำเภอที่ยังไม่เลือก ('0' / '-- ระบุ --' / '-- เขต --') = ว่าง */
const isProv = (v: string) => Boolean(v) && v !== '0' && !/^--/.test(v);
const isDist = (v: string) => Boolean(v) && !/^--/.test(v);

function withCurrent(list: string[], current: unknown, placeholder = '-- ระบุ --'): string[] {
  const cur = String(current ?? '').trim();
  return cur && cur !== placeholder && !list.includes(cur) ? [...list, cur] : list;
}

function zeroBlank(v: unknown): string {
  const t = String(v ?? '').trim();
  return Number(t) === 0 ? '' : t;
}
/** เปอร์เซ็นต์ค่าเรียกร้อง — DB คืน "10.00" ช่องแคบเห็นเป็น "10.0" (user ทัก 09/09/69) → โชว์ "10" มีเศษค่อยโชว์ไม่เกิน 2 ตำแหน่ง */
function pctBlank(v: unknown): string {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n !== 0 ? String(Math.round(n * 100) / 100) : '';
}
/** ยอดนอกพื้นที่/นอกเวลาในช่องแก้เอง — DB คืน "100.00" → โชว์ "100" (ค่าตั้งต้นตอนติ๊กก็โชว์ "100" อยู่แล้ว
 *  สองแบบปนกันดูเหมือนคนละช่อง) จำนวนเต็มไม่ใส่ทศนิยม มีเศษค่อยโชว์ไม่เกิน 2 ตำแหน่ง */
/** ผลจากท่อ se-billing ที่ backend แนบมากับผลอนุมัติ/ส่งซ้ำ (ดู backend sebilling.service) */
type BillingResult = { ok?: boolean; id?: number; skipped?: boolean; error?: string } | null | undefined;
const billingNote = (b: BillingResult): string => {
  if (!b) return '';
  if (b.ok) return ` · ส่งเข้า se-billing แล้ว (#${b.id})`;
  if (b.skipped) return '';   // เซิร์ฟเวอร์ปิดท่อ (เครื่องพัฒนา) — ไม่ต้องรบกวน
  return ` · ส่งเข้า se-billing ไม่สำเร็จ: ${b.error || 'เกิดข้อผิดพลาด'}`;
};
const SEBILLING_CAPTURES_URL = (process.env.NEXT_PUBLIC_SEBILLING_URL || 'https://billing.sesurvey.cloud') + '/captures';

function amtText(v: unknown): string {
  const t = zeroBlank(v);
  if (!t) return '';
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
/**
 * เพศผู้ขับขี่รถประกันเก็บเป็น 'M'/'F' (มือถือ + เว็บ + XML) แต่ข้อมูลที่ดึง/นำเข้ามาเคยเป็น
 * 'ชาย'/'หญิง' (บอทดึงสดจาก ISURVEY ก่อน 03/09/69) หรือ 'W' (รหัสหญิงอีกแบบใน XML)
 * → radio ไม่ติ๊กทั้งที่ข้อมูลมี หัวหน้าเห็น "ยังขาด 1 ช่อง" แต่หาไม่เจอ (เคส #221)
 * แปลงตอนอ่านให้ติ๊กได้ทุกแบบ; backend ก็แปลงตอนนำเข้าแล้ว นี่กันข้อมูลเก่าที่ค้างใน DB
 */
const genderMF = (v: unknown): string => {
  const s = String(v ?? '').trim();
  const u = s.toUpperCase();
  if (u === 'M' || s === 'ชาย') return 'M';
  if (u === 'F' || u === 'W' || s === 'หญิง') return 'F';
  return s;
};
/**
 * ช่องเงินที่เก็บเป็นตัวเลขใน DB — null หรือ 0 = ยังไม่ได้กรอก จึงโชว์ว่าง
 * มีค่าจริงค่อยจัดทศนิยม 2 ตำแหน่งให้เหมือนเดิม
 */
function money2(v: unknown): string {
  if (v == null || v === '') return '';
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) return String(v);
  return n === 0 ? '' : n.toFixed(2);
}

/** ยอดเงินสำหรับ "อ่าน" — 0 ก็โชว์ 0.00 (ต่างจาก money2 ที่ 0 = ยังไม่กรอก จึงโชว์ว่าง) */
const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ช่องนี้มีข้อมูลจริงไหม — 0 กับ "0" นับเป็นยังไม่กรอก · ข้อความล้วน (เช่นรายละเอียดค่าใช้จ่ายอื่น) นับ */
function filled(v: unknown): boolean {
  const t = String(v ?? '').trim();
  if (t === '') return false;
  const n = Number(t);
  return Number.isNaN(n) ? true : n !== 0;
}

/**
 * ช่องเงิน 2 ฝั่งของการ์ดค่าใช้จ่าย — ชื่อตรงกับ `name` ของ input และคอลัมน์ใน DB
 *
 * ⛔ ต้องตรงกับฝั่ง backend เสมอ ไม่งั้นยอดรวมที่โชว์กับยอดที่บันทึกจะคนละตัว
 *    ฝั่งพนักงาน = `PAY_MONEY_FIELDS` ใน backend/src/services/pay.service.ts (เติม pay_ นำหน้า)
 *    ฝั่งประกัน  = ชุดเดียวกับที่ getDetail ดึงมาให้ + ที่ใช้บวกยอดสะสมทั้งเคลม
 *    (มีการ์ดเทสคุมไว้ที่ backend/tests/expenseCard.contract.test.ts)
 */
const INS_MONEY_INPUTS = ['service_fee_price', 'travel_fee_price', 'photo_fee_price', 'phone_fee',
                          'bail_fee', 'claim_fee_price', 'daily_record_fee', 'other_fee_price'];
const PAY_MONEY_INPUTS = ['pay_service_fee', 'pay_travel_fee', 'pay_photo_fee', 'pay_phone_fee',
                          'pay_bail_fee', 'pay_claim_fee', 'pay_daily_fee', 'pay_other_fee'];
/** ตัวปรับเรทฝั่งพนักงาน — หน้าเว็บส่งแค่ติ๊ก/ไม่ติ๊ก ยอดคงที่นี้อยู่ที่ backend */
const OUT_OF_AREA_AMT = 50;
const OUT_OF_HOURS_AMT = 100;

/**
 * เรทค่าคัดประจำวัน (user เคาะ 01/09/69) — เลือกผลแล้วเติมยอดให้ทั้ง 2 ฝั่ง
 * ฝั่งพนักงาน 50 ทุกผล · ฝั่งประกันจ่ายผล "ถูก" เป็นสองเท่าของอีก 2 ผล
 * ⛔ เติมตอน "เลือก" เท่านั้น ไม่เติมตอนเปิดหน้า — เคสที่หัวหน้าแก้ยอดเองไว้
 *    จะได้ไม่ถูกเขียนทับทุกครั้งที่เปิดดู
 */
const DAILY_FEE_PAY = 50;
const DAILY_FEE_INS: Record<string, number> = { 'ถูก': 100, 'ผิด': 50, 'รอผล': 50 };
/** ค่าเสียหายประมาณของคู่กรณี/ทรัพย์สิน — 0 ที่ติดมากับข้อมูลคือ "ไม่ได้กรอก" ล้างตอนโหลด
 *  (ล้างที่ตอนโหลด ไม่ใช่ตอนวาด — ช่องพวกนี้เป็น controlled ถ้าล้างตอนวาดจะพิมพ์เลข 0 ไม่ได้) */
function blankZeroCost<T extends Record<string, unknown>>(x: T): T {
  const c = x?.estimated_cost;
  return (c != null && c !== '' && Number(c) === 0) ? { ...x, estimated_cost: '' } : x;
}
/**
 * ดอกจันช่องบังคับ
 *
 * ⚠️ **ลิสต์ต้องตรงกับ `_sectionMissing()` ในแอปมือถือ** (`survey_form_screen.dart`)
 * ซึ่ง sync กับ validator จริงของ EMCS (`vlidSurvey` / `vlidInjPerson` / `vlidAsset`) อยู่แล้ว
 * — ว่างแล้วกดบันทึกบน EMCS ไม่ผ่าน หัวหน้าต้องมานั่งไล่เติมเองทีละช่อง
 *
 * ผู้สำรวจเห็นจุดแดงพวกนี้บนมือถืออยู่แล้ว แต่หน้าตรวจงานไม่เคยมี → ผู้ตรวจแก้ข้อมูลแล้ว
 * เผลอลบช่องบังคับทิ้งโดยไม่มีอะไรเตือน
 *
 * `when` = เงื่อนไขที่ทำให้ช่องนี้บังคับ (ไม่ได้บังคับตลอด) — ฟอร์มนี้เป็น uncontrolled
 * จึงไม่ไล่ตามค่าที่พิมพ์แบบ real-time แต่บอกเงื่อนไขไว้ให้อ่านแทน
 */
const Req = ({ when, of }: { when?: string; of?: string }) => (
  <span
    // `of` = ชื่อช่อง (name=) ที่ดอกจันตัวนี้คุม — คั่นด้วย , ถ้าคุมหลายช่อง
    // ⛔ ต้องใส่ทุกตัว: ไม่ใส่แล้วจะตกไปใช้วิธีเดาจากตำแหน่ง DOM ซึ่งพังทันทีที่เปลี่ยนเลย์เอาต์
    data-req-of={of}
    className={when ? 'text-amber-500 ml-0.5 req-mark-when' : 'text-red-500 ml-0.5 req-mark'}
    title={when
      ? `บังคับเมื่อ ${when} — ระบบประกันไม่รับถ้าเว้นว่างในกรณีนี้`
      : 'ช่องบังคับของระบบประกัน — เว้นว่างแล้วบันทึกเข้าระบบประกันไม่ผ่าน'}
  >*</span>
);

/**
 * ไฮไลต์ "ช่องบังคับที่ยังว่าง" ด้วยกรอบแดง + นับจำนวนไว้โชว์หัวหน้า
 *
 * ทำเป็น pass เดียวหลัง render แทนการไปแก้ className ทีละช่อง เพราะหน้านี้มีช่องบังคับ
 * ~49 ช่องกระจายอยู่ทั่วฟอร์ม และเพิ่มขึ้นเรื่อย ๆ — ผูกกับดอกจันที่มีอยู่แล้วทำให้
 * ช่องบังคับที่เพิ่มวันหลังได้กรอบแดงเองโดยไม่ต้องมาแก้ที่นี่ซ้ำ
 *
 * นับเฉพาะดอกจัน**แดง** (บังคับเสมอ) — ดอกจันเหลืองเป็นแบบมีเงื่อนไข ไฮไลต์แล้วจะหลอก
 */
const RING = ['border-red-400', 'ring-1', 'ring-red-300', 'bg-red-50'];
// พื้นหลังเดิมของช่อง (bg-white ตอนแก้ได้ / bg-gray-100 ตอนล็อก) — ต้องถอดออกตอนทาแดง
// ไม่งั้นชนกันเองแล้วแล้วแต่ลำดับใน CSS ว่าใครชนะ (ไม่ใช่ลำดับใน class attribute)
const BG_ORIG = ['bg-white', 'bg-gray-100'];
/**
 * กลุ่ม radio ที่ระบบประกันบังคับ — ตัวทาสีทั่วไปคุมไม่ได้ 2 เหตุผล
 *   1. ทาสีที่ตัว input เองแทบมองไม่เห็น (วงกลม/กล่องเล็กมาก) ต้องคุมสีทั้งกลุ่ม
 *   2. `isBlank()` มองทีละช่อง คืน false เสมอสำหรับ radio — ไม่รู้จัก "ทั้งกลุ่มยังไม่มีใครติ๊ก"
 * เดิมดอกจัน 2 ตัวนี้จึงเป็นแค่ตัวอักษร ไม่ได้คุมอะไรเลย (user เจอ 18/08/69)
 * ทั้งคู่ส่งเข้า EMCS จริง — SURV_CLAIM_TYPE กับ HEV_CAR
 */
/**
 * กลุ่ม radio ที่ต้องนับเป็น "ช่องบังคับ" — ตัวไล่หาช่องว่างมองไม่เห็น radio เอง
 * (isBlank คืน false เสมอ) ต้องมาลิสต์ไว้ที่นี่เท่านั้น
 *
 * ⛔ มีดอกจันแล้วลืมใส่ที่นี่ = ดอกจันหลอก · ผ่านหน้าเว็บแต่ EMCS ตีกลับ
 *    acc_fault / driver_gender เพิ่ม 19/08/69 — EMCS บังคับทั้งคู่ทุกบริษัท
 *    (acc_fault ว่างยังลามไปทำให้ "การเรียกร้องค่าเสียหาย" กับ "คู่กรณีคันที่"
 *     ตกจากแดงเป็นเหลือง หลุดจากประตูอนุมัติอีก 2 ช่อง)
 */
const REQ_RADIO_GROUPS = ['claim_type', 'damage_level', 'acc_fault', 'driver_gender'];

/** ตัด placeholder ของ dropdown ('0' / '-- ระบุ --') ออกก่อนเอาไปแสดงเป็นข้อความ — ไม่ใช่ค่าจริง */
const noPh = (v: unknown) => {
  const t = String(v ?? '').trim();
  return t === '0' || t.startsWith('--') ? '' : t;
};

/**
 * ข้อมูลบริษัทผู้จัดเรื่อง — **โชว์บนเว็บ se-survey อย่างเดียว**
 *
 * เหมือนกันทุกเคส ไม่ใช่ข้อมูลของเคส จึงไม่เก็บรายเคสและไม่ให้แก้บนหน้าเคส
 * ⛔ ห้ามต่อท่อไป XML/บอท — ฝั่ง EMCS เติมช่องนี้เองจากบริษัทประกันที่เลือก
 *    ตอน import XML (ฝั่งเราส่ง SURVEYBRID จาก env ไม่ใช่ค่าพวกนี้)
 * (user เคาะ 18/08/69 · คอลัมน์ survey_company* ใน DB ไม่มีใครอ่านแล้ว)
 */
const SURVEY_CO = {
  name: 'เอสอี เซอร์เวย์ แอนด์ คอนซัลแตนท์ สำนักงานใหญ่',
  address: '41 ซอยลาดพร้าว 138 (มีสุข) ถนนลาดพร้าว แขวงคลองจั่น เขตบางกะปิ 10240',
  phone: '02-766-8889',
} as const;

/**
 * className มาตรฐานของช่องกรอก
 * ⚠️ ต้องมี `border-gray-300` + `bg-white`/`bg-gray-100` เสมอ — ตัวทากรอบแดงสลับคลาส
 *    ชุดนี้ (ดู RING / BG_ORIG) เปลี่ยนชื่อคลาสเมื่อไหร่ กรอบแดงจะทาไม่ติดเงียบ ๆ
 */
const CTL = (locked: boolean) =>
  `w-full border border-gray-300 rounded-none h-9 px-3 text-gray-800 ${locked ? 'bg-gray-100' : 'bg-white'} text-sm`;
/**
 * ช่อง "ชื่อคน" ในฟอร์มหลักที่ EMCS มีตัวกรองอักขระติดอยู่
 * ต้องตรงกับ `emcsNameWarnings()` ฝั่ง backend (xmlExport.service.ts)
 * ⚠️ "ผู้เอาประกัน" (assured_name) **ไม่มี** ตัวกรองนี้ — ตรวจแล้ว ไม่ต้องใส่
 */
/**
 * แถบหัวหมวด — ชื่อหมวดตามที่ดีไซน์ใหม่จัดไว้ + ป้ายบอกว่าหมวดนี้ยังกรอกไม่ครบ
 *
 * ⛔ **ห้ามใส่ปุ่มยุบ/ซ่อนหมวดกลับเข้ามา** (user เคาะ 18/08/69)
 *    เคยทำเป็นโหมดสรุป (ยุบหมวดที่กรอกครบ) แล้วถอดออก — เหตุผล: หมวดที่ถูกยุบไว้
 *    คือหมวดที่ผู้ตรวจจะไม่เปิดดู แล้วปล่อยข้อมูลผิดผ่านไปได้
 *    หน้านี้เป็นหน้า "ตรวจ" ต้องเห็นทุกช่องเสมอ · แถบนี้มีไว้ช่วยหาที่ ไม่ได้ซ่อนอะไร
 */
/**
 * ช่องกรอกแบบการ์ด — ป้ายเล็กด้านบน ช่องด้านล่าง (เลย์เอาต์ตามดีไซน์ใหม่)
 *
 * แทนตาราง 4 คอลัมน์แบบเดิมที่เป็น `ป้าย : [ช่อง]` เรียงข้างกัน
 * ⚠️ className ของตัวช่องต้องเหมือนเดิมเป๊ะ (`border-gray-300` + `bg-white`/`bg-gray-100`)
 *    ตัวทากรอบแดงสลับคลาสพวกนี้อยู่ — เปลี่ยนแล้วกรอบแดงจะทาไม่ติด
 */
function F({ label, req, span, right, children }: {
  label: string; req?: React.ReactNode; span?: 2 | 4;
  /** ปุ่มเล็กมุมขวาของแถวป้าย (เช่น "⤢ ขยาย") — ไม่ส่งมาก็ไม่มีอะไรเปลี่ยน */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  // เขียนคลาสเต็มทั้งชุด ห้ามต่อสตริง — Tailwind อ่านซอร์สแบบข้อความ ต่อเองแล้วไม่ผลิต class ให้
  const w = span === 4 ? 'col-span-2 md:col-span-4' : span === 2 ? 'col-span-2 md:col-span-2 min-w-0' : 'min-w-0';
  return (
    // เส้นคั่นบางเหนือทุกช่อง = "การแยกส่วน" ของแบบ (Claude Design 02/09/69)
    // ทำให้เห็นกริด 4 คอลัมน์โดยไม่ต้องตีกล่องรอบทุกช่อง — หน้านี้มี 189 ช่อง
    // ถ้าตีกล่องจะกลายเป็นลายตาราง
    <div className={`${w} border-t border-[var(--md-line)] pt-2`}>
      {/* ⛔ ห่อด้วย flex **เฉพาะตอนมีปุ่ม** — หน้านี้มีเกือบ 200 ช่อง
          ถ้าห่อทุกช่อง ป้ายจะกลายเป็น flex item แล้วการตัดบรรทัดของป้ายยาวเปลี่ยนไปทั้งหน้า */}
      {right ? (
        <div className="flex items-start justify-between gap-2">
          <label className="block text-xs text-[var(--md-muted)] mb-1">{label}{req ? <> {req}</> : null}</label>
          {right}
        </div>
      ) : (
        <label className="block text-xs text-[var(--md-muted)] mb-1">{label}{req ? <> {req}</> : null}</label>
      )}
      {children}
    </div>
  );
}

/**
 * หัวหมวด — แถบเข้มไล่สีน้ำเงินกรม→ดำ ตัวหนังสือขาว (แบบจาก Claude Design 02/09/69)
 *
 * หน้านี้ยาว 12 หมวด เลื่อนดูนาน ๆ แล้วหาว่า "ตอนนี้อยู่หมวดไหน" ยาก —
 * แถบเข้มทำให้เห็นรอยต่อหมวดตั้งแต่หางตา ต่างจากแถบเทาเดิมที่กลืนไปกับการ์ด
 *
 * ⛔ มุมฉาก 0px + เส้นใต้ 2px = กติกาของ design system (Modernist) ทั้งหน้า
 *    อย่าใส่ rounded-none กลับมาเฉพาะจุด จะกลายเป็นหน้าเดียวมี 2 ภาษา
 * ⛔ ป้าย "ยังกรอกไม่ครบ" ต้องอ่านออกบนพื้นเข้ม — ใช้พื้นขาวตัวแดง ไม่ใช่ตัวแดงบนดำ
 */
/**
 * "รายการตรวจสอบ" ของหัวหน้า — ชุดเดียวกับ ISURVEY แท็บ 1 (user ขอ 08/09/69)
 * เก็บ JSONB survey_reports.checklist (migration 057) · รหัสตรงกับ inputValue ของ ISURVEY (chk_*) จึงส่งกลับตอนปิดงานได้ตรง ๆ
 * ตอนอนุมัติ วาดเป็นรูปแบบเดียวกับใบพิมพ์ ISURVEY เข้าหมวด "รูปรถประกัน" → ไหลเข้า EMCS ทางท่อรูปเหมือนใบแจ้งความเสียหายของแอป
 */
type Checklist = { claimform: string; chassis: string; driver_license: string; document: string; other: string; image_photo_id?: number | null };
const CHECKLIST_ROWS: { key: 'claimform' | 'chassis' | 'driver_license' | 'document'; label: string; options: { code: string; label: string }[] }[] = [
  { key: 'claimform', label: 'เอกสารเคลมฟอร์ม ([บันทึกถ้อยคำลูกค้า])', options: [{ code: 'Y', label: 'มี' }, { code: 'N', label: 'ไม่มี' }] },
  { key: 'chassis', label: 'เลขตัวถัง', options: [{ code: 'Y', label: 'ตรง' }, { code: 'N', label: 'ไม่ตรง' }] },
  { key: 'driver_license', label: 'ใบขับขี่รถประกัน', options: [{ code: 'Y', label: 'มี' }, { code: 'N', label: 'ไม่มี' }] },
  { key: 'document', label: 'สำเนาใบรับรองความเสียหาย / บัตรติดต่อ',
    options: [{ code: 'D', label: 'ใบรับรองความเสียหาย' }, { code: 'C', label: 'บัตรติดต่อ' }, { code: 'N', label: 'ไม่ออกเอกสาร' }] },
];
const toChecklist = (v: unknown): Checklist => {
  const o = (v && typeof v === 'object') ? v as Record<string, unknown> : {};
  const t = (k: string) => String(o[k] ?? '');
  return { claimform: t('claimform'), chassis: t('chassis'), driver_license: t('driver_license'), document: t('document'),
           other: t('other'), image_photo_id: o.image_photo_id ? Number(o.image_photo_id) : null };
};
const checklistHasAny = (c: Checklist) => Boolean(c.claimform || c.chassis || c.driver_license || c.document || c.other.trim());

/** วาดรูป "รายการตรวจสอบ" แบบใบพิมพ์ของ ISURVEY: กระดาษขาว แถบส้มบน ☑ หน้าข้อที่เลือก ข้อที่ไม่เลือกเป็นตัวจาง → PNG A4 */
async function renderChecklistPng(c: Checklist, footer: string): Promise<Blob> {
  const W = 1240, H = 1754;
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('เบราว์เซอร์นี้วาดรูปไม่ได้');
  try { await document.fonts.load('24px Sarabun'); } catch { /* ไม่มี Sarabun → ฟอนต์สำรอง */ }
  const font = (px: number, bold = false) => `${bold ? '600 ' : ''}${px}px Sarabun, Tahoma, "Noto Sans Thai", sans-serif`;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#F5A623'; ctx.fillRect(0, 0, W, 10);
  ctx.textBaseline = 'middle';
  const xLabel = 90, xOpt = 560;
  let y = 240;
  const tick = (x: number, yy: number) => {
    ctx.lineWidth = 3; ctx.strokeStyle = '#111';
    ctx.strokeRect(x, yy - 16, 32, 32);
    ctx.beginPath(); ctx.moveTo(x + 7, yy + 1); ctx.lineTo(x + 14, yy + 10); ctx.lineTo(x + 27, yy - 10); ctx.stroke();
  };
  for (const row of CHECKLIST_ROWS) {
    ctx.fillStyle = '#222'; ctx.font = font(24); ctx.fillText(row.label, xLabel, y);
    // วางตัวเลือกต่อกันตามความกว้างจริงของข้อความ — ระยะคงที่ทำให้ "ใบรับรองความเสียหาย" ทับ "บัตรติดต่อ" (เจอตอนวาดทดลอง 08/09/69)
    let x = xOpt;
    for (const o of row.options) {
      const sel = c[row.key] === o.code;
      if (sel) tick(x, y);
      ctx.fillStyle = sel ? '#111' : '#777'; ctx.font = font(22, sel);
      const tx = x + (sel ? 44 : 0);
      ctx.fillText(o.label, tx, y);
      x = tx + ctx.measureText(o.label).width + 70;
    }
    y += 60;
  }
  ctx.fillStyle = '#222'; ctx.font = font(24); ctx.fillText('อื่นๆ', xLabel, y);
  const other = c.other.trim();
  if (other) {
    ctx.fillStyle = '#111'; ctx.font = font(22);
    // ตัดบรรทัดตามความกว้างจริง (ข้อความไทยไม่มีช่องว่างมาก ตัดทีละตัวอักษร)
    let line = ''; let yy = y;
    for (const ch of other.replace(/\r/g, '')) {
      if (ch === '\n' || ctx.measureText(line + ch).width > 620) { ctx.fillText(line, xOpt, yy); yy += 36; line = ch === '\n' ? '' : ch; }
      else line += ch;
    }
    if (line) ctx.fillText(line, xOpt, yy);
  }
  ctx.fillStyle = '#999'; ctx.font = font(20); ctx.fillText(footer, xLabel, H - 80);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('สร้างไฟล์รูปไม่สำเร็จ'))), 'image/png'));
}

function SectionBar({ title, gap, right }: { title: string; gap: boolean; right?: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 border-b-2 border-[var(--md-ink)]"
      /* พื้นสีเดียวทั้งแถบ ไม่ไล่เฉดไปดำ (user เคาะ 03/09/69) — ไล่เฉดแล้วหัวข้อ
         ท้ายแถบจมหายไปกับสีดำ และแต่ละแถบดูเหมือนคนละสีเมื่อความกว้างไม่เท่ากัน */
      style={{ background: gap ? '#8A1B0B' : '#1E3E82' }}
    >
      <span className="text-[0.9375rem] font-bold text-white">{title}</span>
      {gap && (
        <span className="text-[0.6875rem] font-semibold text-red-700 bg-white rounded-none px-1.5 py-0.5">
          ยังกรอกไม่ครบ
        </span>
      )}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}

/** ชื่อจังหวะในลำดับเวลา — ใช้ทั้งการ์ดลำดับเวลาและข้อความ "ยังอนุมัติไม่ได้" */
const TL_LABEL: Record<string, string> = {
  acc_date: 'เกิดเหตุ',
  acc_customer_report_date_val: 'ลูกค้าแจ้ง บ.ประกัน',
  acc_insurance_notify_date_val: 'บ.ประกันแจ้งสำรวจภัย',
  acc_survey_arrive_date_val: 'ถึงที่เกิดเหตุ',
  acc_survey_complete_date_val: 'สำรวจภัยเสร็จ',
};
const EMCS_NAME_FIELDS = [
  'acc_reporter', 'acc_surveyor', 'acc_police_name',
  'driver_name', 'driver_first_name', 'driver_last_name',
];
// สีเตือนของช่องบังคับ**แบบมีเงื่อนไข** — มีสีเดียวคือแดง = "บังคับตอนนี้และยังว่าง"
// ⛔ เคยมีเหลือง (ยังไม่บังคับแต่ยังว่าง) — ถอดออก 03/09/69 ตามที่ user สั่ง
// เขียนเป็นสตริงเต็มทั้งชุด (ห้ามต่อสตริงเอง) ไม่งั้น Tailwind ไม่ผลิต class ให้ตอน build
const HL_CLS = {
  red: 'border-red-400 ring-1 ring-red-300 bg-red-50',
} as const;

/**
 * ดอกจัน 1 ตัว คุม "ช่องของมันเอง" เท่านั้น
 *
 * ⛔ เดิมถอยขึ้นไปจนถึง <tr> แล้วคว้าทุก input ในแถว — แต่เลย์เอาต์หน้านี้ยัด 2-3 คู่
 *    ป้าย/ช่อง ไว้ในแถวเดียว เช่น
 *      <td>ผู้แจ้ง</td><td>[ช่อง]</td><td>ผู้สำรวจภัย *</td><td>[ช่อง]</td>
 *    ดอกจันของ "ผู้สำรวจภัย" จึงไปทาแดงให้ "ผู้แจ้ง" ที่ไม่ได้บังคับด้วย
 *    ตอนเป็นแค่กรอบแดงก็แค่เตือนหลอก · พอเอาไปบล็อกปุ่มอนุมัติ = อนุมัติไม่ได้
 *    ทั้งที่ข้อมูลครบ (เจอจริง 15/08/69 เคส #141 ขึ้นแดง 2 ช่อง ทั้งที่ไม่ขาดอะไร)
 */
function fieldsOfMark(mark: Element, form?: HTMLFormElement | null): HTMLElement[] {
  const q = (el: Element): HTMLElement[] =>
    Array.prototype.slice.call(el.querySelectorAll('input,select,textarea')) as HTMLElement[];

  // ── ทางหลัก: ดอกจันบอกเองว่าคุมช่องไหน ──
  // ผูกด้วยชื่อช่องแทนตำแหน่งใน DOM — ย้ายเลย์เอาต์/เปลี่ยนตารางเป็นการ์ดแล้วยังถูกเสมอ
  // (วิธีเดาจากตำแหน่งข้างล่างเคยทำให้ดอกจันไปทาแดงช่องข้าง ๆ จนกดอนุมัติไม่ได้ — เคส #141)
  const of = mark.getAttribute('data-req-of');
  if (of && form) {
    const out: HTMLElement[] = [];
    for (const name of of.split(',').map((s) => s.trim()).filter(Boolean)) {
      const els = form.querySelectorAll(`[name="${name}"]`);
      for (const el of Array.prototype.slice.call(els) as HTMLElement[]) out.push(el);
    }
    return out;
  }

  const cell = mark.closest('td');
  if (cell) {
    const own = q(cell);          // ป้ายกับช่องอยู่ช่องตารางเดียวกัน
    if (own.length) return own;
    let sib = cell.nextElementSibling;   // เลย์เอาต์ปกติ: ป้ายอยู่ td ก่อนหน้าช่อง
    for (let i = 0; sib && i < 2; i++) {
      const f = q(sib);
      if (f.length) return f;
      sib = sib.nextElementSibling;
    }
    return [];                    // อยู่ในตารางแต่หาช่องไม่เจอ — อย่าเดาไปทั้งแถว
  }
  // บล็อกที่ไม่ได้ใช้ตาราง — ถอยขึ้นหาแถบที่ครอบใกล้สุดที่มีช่อง (พฤติกรรมเดิม)
  let n: Element | null = mark;
  for (let hop = 0; n && hop < 5; hop++) {
    const row: Element | null = n.parentElement;
    if (row) {
      const f = q(row);
      if (f.length) return f;
    }
    n = n.parentElement;
  }
  return [];
}

const isBlank = (el: HTMLElement) => {
  const v = (el as HTMLInputElement).value ?? '';
  if (el instanceof HTMLSelectElement) {
    return !v || v === '0' || /^--/.test(el.options[el.selectedIndex]?.text ?? '');
  }
  if ((el as HTMLInputElement).type === 'radio' || (el as HTMLInputElement).type === 'checkbox') return false;
  return !v.trim();
};

export default function CaseDetail({ caseData, report, photos, review, visitCount = 1, visits = [], expenses, photoFeeSuggest = null, tumbonOptions = [], onReviewSubmitted }: CaseDetailProps) {
  const ex = expenses || {};
  // ประเภทรถ → ตัวเลือกยี่ห้อ (EMCS กรองลิสต์ยี่ห้อตามประเภทรถ; เดิมโชว์ชุดของ
  // 'เก๋งเอเชีย' ชุดเดียวกับทุกประเภท → กระบะ/มอเตอร์ไซค์เลือกยี่ห้อที่ EMCS ไม่รับ)
  const [carType, setCarType] = useState<string>(report.car_type || '0');
  /** หน้าต่างข้อมูลกรมธรรม์ทั้งชุดจาก ISURVEY แท็บ 7 (report.policy_info, migration 053) — user ขอ 07/09/69 */
  const [policyOpen, setPolicyOpen] = useState(false);
  const policyInfo = (report?.policy_info && typeof report.policy_info === 'object') ? report.policy_info as Record<string, string> : null;
  // จังหวัด → เขต/อำเภอ cascade (เดิมโชว์ 51 เขต กทม. กับทุกจังหวัด)
  const [accProv, setAccProv] = useState<string>(report.acc_province || '0');
  const [accDist, setAccDist] = useState<string>(report.acc_district || '-- เขต --');
  const [accTumbon, setAccTumbon] = useState<string>(report.acc_subdistrict || '');
  /**
   * ── สถานที่ออกตรวจสอบ ── (user ขอ 09/09/69 กับเคลม 2026013072661)
   * ISURVEY แยก "สถานที่ออกตรวจสอบ / จังหวัด / เขต-อำเภอ / ตำบล ที่ตรวจสอบ" ออกจากสถานที่เกิดเหตุ
   * (เกิดเหตุ กทม./สวนหลวง แต่ช่างออกตรวจที่ ชลบุรี/บางละมุง) และเรทค่าบริการต้องคิดจาก**ที่ออกตรวจ** ไม่ใช่ที่เกิดเหตุ
   * — ชุดเดียวกับที่ extension se-billing ใช้หาเรทบน ISURVEY · ว่าง = คิดจากสถานที่เกิดเหตุ (งานมือถือ/XML ไม่มีข้อมูลนี้)
   */
  const [survProv, setSurvProv] = useState<string>(report.survey_province || '-- ระบุ --');
  const [survDist, setSurvDist] = useState<string>(report.survey_district || '-- เขต --');
  const [survTumbon, setSurvTumbon] = useState<string>(report.survey_subdistrict || '');

  /**
   * ── กล่องเขียนความเห็นแบบเต็มจอ ── (user ขอ 01/09/69)
   *
   * 3 ช่องความเห็นสูงแค่ 4 บรรทัด ข้อความจริงยาว 10-20 บรรทัด ต้องลากมุมขวาล่าง
   * ขยายเองทุกครั้งที่จะพิมพ์ · ปุ่ม "ขยาย" เปิดกล่องใหญ่ พิมพ์เสร็จค่ากลับเข้าช่องเดิม
   *
   * ⛔ ช่องพวกนี้เป็น uncontrolled (defaultValue) — เขียนกลับต้องแตะ .value ของ DOM ตรง ๆ
   *    ถ้าเปลี่ยนเป็น controlled จะพิมพ์หน่วงทั้งฟอร์มเพราะ re-render ทุกตัวอักษร
   * ⛔ textarea ในกล่องใหญ่ **ห้ามมี name** — มันอยู่ใน <form> เดียวกัน มี name เมื่อไหร่
   *    FormData จะเก็บ 2 ค่าชื่อเดียวกัน แล้วตัวหลังทับตัวแรกเงียบ ๆ
   */
  const [bigEdit, setBigEdit] = useState<{ name: string; label: string } | null>(null);
  const [bigDraft, setBigDraft] = useState('');
  const fieldEl = (name: string) =>
    formRef.current?.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`) ?? null;
  const openBig = (name: string, label: string) => {
    setBigDraft(fieldEl(name)?.value ?? '');
    setBigEdit({ name, label });
  };
  const applyBig = () => {
    if (!bigEdit) return;
    const el = fieldEl(bigEdit.name);
    if (el) {
      el.value = bigDraft;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      // ช่องความเสียหาย: พอพิมพ์คำบรรยายเอง ต้องสลับกลับไปโชว์เป็นช่องข้อความ
      // ไม่งั้นแก้แล้วไม่เห็นสิ่งที่พิมพ์ (ปกติช่องถูกซ่อน โชว์เป็นรายการแทน)
      if (bigEdit.name === 'damage_description') {
        const t = bigDraft.trim();
        setDescCustom(t !== '' && t !== autoDamageDesc(damage).trim());
      }
    }
    setBigEdit(null);
  };
  /**
   * ── ตัวเลือก "ตำบล" ── (user ขอ 01/09/69)
   *
   * ขึ้นเฉพาะอำเภอที่มีตำบลซึ่งคิดเรทไม่เท่าอำเภอแม่ (ตอนนี้ ศรีราชา→บ่อวิน · สัตหีบ→พลูตาหลวง)
   * รายชื่อมาจาก**ตารางเรท** ไม่ได้เขียนไว้ในโค้ด — เพิ่มเรทตำบลใหม่ในหน้าแอดมินแล้วโผล่เอง
   *
   * ⛔ ช่องนี้หายไปจากฟอร์มได้ (อำเภออื่นไม่มีตำบล) แต่ **ไม่ทำให้ค่าเดิมถูกล้าง** —
   *    ฝั่ง survey_reports เขียนเฉพาะคีย์ที่ส่งมา (ต่างจาก survey_pay ที่ upsert ทั้งแถว)
   */
  const tumbonChoices = (tumbonOptions ?? [])
    .filter((t) => areaKey(t.province) === areaKey(accProv) && areaKey(t.district) === areaKey(accDist))
    .map((t) => t.tumbon);
  const survTumbonChoices = (tumbonOptions ?? [])
    .filter((t) => areaKey(t.province) === areaKey(survProv) && areaKey(t.district) === areaKey(survDist))
    .map((t) => t.tumbon);
  const [driverProv, setDriverProv] = useState<string>(report.driver_province || '0');
  const [driverDist, setDriverDist] = useState<string>(report.driver_district || '-- เขต --');
  /**
   * ทุกช่องพิมพ์ได้ทันที ไม่ต้องกด "แก้ไขทั้งหมด" ก่อน (user เคาะ 17/08/69)
   *
   * เดิมหน้าเปิดมาเป็นโหมดอ่าน ต้องกดปุ่มก่อนถึงจะพิมพ์ได้ — ผู้ตรวจเห็นช่องแดง
   * แต่แก้ไม่ได้จนกว่าจะรู้ว่าต้องกดปุ่มก่อน
   *
   * ⚠️ ตัวแปรนี้ยังอยู่เพราะ `handleSave` ใช้มันคุมว่า "จะส่ง JSONB กับยอดเงินไปด้วยไหม"
   *    ตอนเป็นโหมดอ่านมันจงใจไม่ส่ง เพื่อไม่ให้เขียนทับของเดิมด้วยค่าว่าง
   *    ตอนนี้พิมพ์ได้ตลอด จึงต้องส่งตลอด — ปล่อยเป็น true คงที่ ห้ามเปลี่ยนกลับเป็น state
   *    ถ้าไม่ได้แก้ handleSave ให้ปลอดภัยก่อน
   */
  const isEditing = true;
  // ความเสียหายรถประกันเป็น JSONB — แก้ผ่าน FormData ไม่ได้ ต้องถือ state เอง
  // (เคสที่นำเข้าจากไฟล์ XML ของ ISURVEY จะว่างเสมอ ผู้ตรวจต้องกรอกก่อนส่งเข้า EMCS)
  /**
   * สลับ "ครั้งที่" = เปิดเคสของครั้งนั้นแทน (คนละเคสกัน — ดูหมายเหตุที่หัวการ์ดค่าใช้จ่าย)
   * เตือนก่อนถ้ายังไม่ได้บันทึก เพราะออกจากหน้าไปแล้วสิ่งที่พิมพ์ค้างไว้หาย
   */
  const switchVisit = (id: string) => {
    if (!id || Number(id) === Number(caseData?.id)) return;
    const msg = 'เปิดเคสของครั้งที่เลือก?' + String.fromCharCode(10)
      + 'ถ้ายังไม่ได้กด "บันทึกร่าง" สิ่งที่แก้ค้างไว้จะหาย';
    if (!window.confirm(msg)) return;
    window.location.href = `/inspector/cases/${id}`;
  };
  const [dmgOpen, setDmgOpen] = useState(false);
  const [damage, setDamage] = useState<DamageItem[]>(() =>
    (Array.isArray(report?.insured_damage) ? report.insured_damage : []).map((x: Record<string, unknown>) => ({
      part: String(x?.part ?? ''), pos: String(x?.pos ?? 'A'), level: String(x?.level ?? ''),
    })));
  /**
   * ช่องข้อความ "ความเสียหายรถประกันภัย" วิ่งตามรายการที่ผู้ตรวจเพิ่มในหน้าต่าง
   * "ข้อมูลความเสียหาย" — กติกาเดียวกับแอปมือถือ (`_syncDamageDesc`): เขียนทับเฉพาะตอน
   * ช่องยังว่าง หรือยังเป็นข้อความอัตโนมัติชุดเดิม → คำบรรยายที่ช่างพิมพ์เองไม่ถูกลบ
   *
   * ถ้าเป็นคำบรรยายที่พิมพ์เอง จะไปโชว์รายการจริงใต้ปุ่มแทน (descCustom) — ไม่งั้นผู้ตรวจ
   * เพิ่มชิ้นส่วนแล้วหน้าจอเงียบ ไม่รู้ว่าเข้าหรือยัง (user ขอ 03/09/69)
   *
   * ⛔ ช่องนี้เป็น uncontrolled (FormData อ่านค่าจาก DOM) เขียนผ่าน fieldEl เท่านั้น
   *    เหมือน applyBig — ทำเป็น state เมื่อไหร่จะตีกับหน้าต่าง "⥂ ขยาย"
   */
  const lastAutoDesc = useRef<string>('');
  const descReady = useRef(false);
  const [descCustom, setDescCustom] = useState(() => {
    const t = String(report?.damage_description ?? '').trim();
    return t !== '' && t !== autoDamageDesc(damage).trim();
  });
  useEffect(() => {
    const auto = autoDamageDesc(damage);
    if (!descReady.current) {   // รอบแรก — แค่จำข้อความอัตโนมัติของค่าที่โหลดมา ยังไม่แตะช่อง
      descReady.current = true;
      lastAutoDesc.current = auto;
      return;
    }
    const el = fieldEl('damage_description');
    const cur = (el?.value ?? '').trim();
    if (el && (cur === '' || cur === lastAutoDesc.current.trim())) {
      el.value = auto;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      setDescCustom(false);
    } else {
      setDescCustom(true);
    }
    lastAutoDesc.current = auto;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [damage]);
  // ผู้บาดเจ็บ/ทรัพย์สิน เป็น JSONB เหมือนกัน — ค่าใน object เป็นสตริงทั้งหมด (แอปมือถือเก็บแบบนี้)
  const toRecords = (v: unknown): RecordItem[] =>
    (Array.isArray(v) ? v : []).map((x: Record<string, unknown>) =>
      blankZeroCost(
        Object.fromEntries(Object.entries(x ?? {}).map(([k, val]) => [k, val == null ? '' : String(val)]))));
  const [injured, setInjured] = useState<RecordItem[]>(() => toRecords(report?.injured_persons));
  const [property, setProperty] = useState<RecordItem[]>(() => toRecords(report?.damaged_property));
  /** รายการตรวจสอบ 5 ข้อ (ดู CHECKLIST_ROWS) — เก็บ JSONB report.checklist · ส่งไปกับบันทึก/อนุมัติ */
  const [checklist, setChecklist] = useState<Checklist>(() => toChecklist(report?.checklist));
  // คู่กรณีเก็บดิบ ไม่ผ่าน toRecords — มี `damage` (อาเรย์) กับ `kfk` (บูลีน) ที่แปลงเป็นสตริงแล้วพัง
  const [opponents, setOpponents] = useState<LooseRecord[]>(
    () => (Array.isArray(report?.opposing_parties)
      ? (report.opposing_parties as LooseRecord[]).map(blankZeroCost) : []));
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  /**
   * ── กันหัวหน้า 2 คนบันทึกทับกัน ──
   * เลขรุ่นของข้อมูล ณ ตอนที่หน้านี้โหลดมา · ส่งกลับไปทุกครั้งที่บันทึก
   * ถ้าฝั่งเซิร์ฟเวอร์เดินไปแล้ว = มีคนบันทึกคั่น → ตอบ 409 ไม่เขียนอะไรเลย (reportRev.ts)
   * เดิมไม่มีตัวนี้ คนบันทึกทีหลังทับงานคนแรกทั้งหน้าโดยทั้งคู่เห็น "บันทึกสำเร็จ"
   */
  const [rev, setRev] = useState<number | null>(
    typeof report?.rev === 'number' ? report.rev : null);
  // ข้อความตอนชนกัน — แยกจาก saveMsg เพราะต้องค้างไว้จนกว่าจะกดโหลดใหม่ ไม่ใช่หายเองใน 3 วิ
  const [conflict, setConflict] = useState('');
  // ค่าตอบแทนผู้สำรวจ (ฝั่งจ่ายพนักงาน) — คนละฝั่งเงินกับตาราง survey_expenses ข้างบน
  const [pay, setPay] = useState<PayData | null>(null);
  /**
   * ประวัติการแก้ยอดเงิน — โหลดตอนกางเท่านั้น ไม่ดึงมาพร้อมหน้า
   * (ส่วนใหญ่ไม่มีใครเปิดดู ดึงทุกครั้งคือยิงเปล่า)
   */
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<Record<string, string>[] | null>(null);
  const loadAudit = useCallback(async () => {
    try {
      const r = await api.get(`/api/cases/${caseData.id}/money-audit`);
      setAudit(r.data?.success ? r.data.data : []);
    } catch { setAudit([]); }
  }, [caseData.id]);
  const formRef = useRef<HTMLFormElement>(null);
  /** มีของพิมพ์ค้างที่ยังไม่ได้บันทึกไหม — ดู useEffect "กันออกจากหน้าทั้งที่ยังไม่บันทึก" */
  const dirtyRef = useRef(false);
  const { user } = useAuth();
  const { socket } = useSocket();
  /**
   * ประตูอนุมัติ (user เคาะ 15/08/69) — อนุมัติแล้ว = ล็อกทั้งหน้า แก้ต่อไม่ได้
   * เพราะบอทหยิบเฉพาะเคสที่อนุมัติแล้วไปเข้า EMCS และจะกดส่งงานเองในเฟสถัดไป
   * ถ้าแก้ได้หลังอนุมัติ สิ่งที่บอทส่งจะไม่ใช่สิ่งที่หัวหน้ารับรอง
   */
  // ⛔ ห้ามใช้ "มีใบอนุมัติอยู่" เป็นตัวชี้ขาด — ตอนปลดล็อก ใบยังอยู่ แค่เปลี่ยนเป็น 'pending'
  //    (reviews มี 1 แถวต่อเคส ใช้ซ้ำเมื่ออนุมัติใหม่) เช็คแบบเดิมทำให้ปลดล็อกแล้วหน้ายังล็อกอยู่
  //    แก้อะไรไม่ได้เลย — เจอจริง 15/08/69 เคส #141
  const approved = caseData?.status === 'reviewed' || review?.status === 'approved';
  const isAdmin = user?.role === 'admin';
  /**
   * ที่มาของงานที่ระบบ **เตือน** ว่ายังไม่ได้กรอกยอด — ไม่ใช่ตัวล็อกช่องอีกแล้ว
   *
   * งานจากระบบเดิม (isurvey_xml) เคยกรอกยอดไว้ที่ ISURVEY/se-billing แล้ว จึงไม่ทวงซ้ำที่นี่
   * แต่ **กรอกได้** ถ้าอยากกรอก — เอาที่มาไปล็อกช่องคือล็อกผิดแกน แบบเดียวกับที่เคยเจอ
   * กับ "หักเงิน" มาแล้ว (user แจ้ง 18/08/69 ว่ากรอกช่องราคาพนักงานไม่ได้)
   */
  const payRequired = ['mobile', 'isurvey_live'].includes(String(caseData?.source ?? 'mobile'));
  /**
   * ⚠️ `d` เคยเป็น "ล็อกทั้งฟอร์ม" — ผูกอยู่กับ 116 ช่องที่ไม่เกี่ยวกับเงินเลย
   *
   * สูตรเดิม `!isEditing || !ที่มาของงานกรอกยอดได้` ทำให้**งานจากระบบเก่า
   * แก้อะไรไม่ได้เลยทั้งหน้า** แม้แต่ชื่อ ที่อยู่ สถานที่เกิดเหตุ — ตอนที่ยังต้องกด
   * "แก้ไขทั้งหมด" ก่อนไม่มีใครสังเกต เพราะดูเหมือนยังไม่ได้เข้าโหมดแก้
   * (user เจอจริง 17/08/69 เคส #149: 6 ช่องพิมพ์ไม่ได้)
   *
   * แยกเป็น 2 ตัว: ช่องทั่วไปแก้ได้เสมอ (การล็อกตอนอนุมัติทำที่ <fieldset disabled>)
   */
  /**
   * ── ดู "ครั้งที่" อื่นของเลขเคลมเดียวกัน ──
   *
   * EMCS เก็บทุกครั้งไว้ในเรื่องเดียว สลับด้วย dropdown บนหน้าค่าใช้จ่าย (ddlAdd_No)
   * — ตรวจของจริงแล้ว 18/08/69 เคลม 2026013144978 มี 3 ครั้งในเรื่อง S68426063383
   * ฝั่งเรา 1 ครั้ง = 1 เคส (เหมือน ISURVEY) จึงทำให้ "ดูได้ทุกครั้ง แต่แก้ได้เฉพาะเคสที่เปิดอยู่"
   *
   * ⛔ ครั้งอื่น = อ่านอย่างเดียวเท่านั้น · และห้ามกดบันทึก/อนุมัติระหว่างดูครั้งอื่น
   *    เพราะช่องพวกนี้อยู่ใน <form> เดียวกับฟอร์มหลัก กดบันทึกทีเดียว = เขียนข้ามเคส
   *    (ยิ่งกว่านั้น ช่องที่ disabled จะไม่ถูกส่งไปเลย → survey_pay บันทึกทั้งแถว
   *     ยอดของเคสที่เปิดอยู่จะกลายเป็นค่าว่างทั้งแถว)
   */
  const [viewVisit, setViewVisit] = useState<number | null>(null);
  /**
   * ⛔ สลับ "ครั้งที่" ทำให้รางขวาถูกสร้างใหม่ทั้งราง (ดู key ที่ครอบราง) — ช่องในนั้น
   *    เป็น uncontrolled ทั้งหมด ค่าที่หัวหน้าพิมพ์ค้างไว้จึงหายเกลี้ยงโดยไม่มีอะไรถาม
   *    ซึ่งเจอแน่ ๆ เพราะเหตุผลเดียวที่ฟีเจอร์นี้มีอยู่คือ "เปิดไปเทียบยอดกับครั้งก่อน"
   *    → เก็บค่าไว้ก่อนออก แล้วเขียนคืนให้ตอนกลับมาครั้งของเคสนี้
   */
  const railRef = useRef<HTMLDivElement>(null);
  const railDraft = useRef<Record<string, { v?: string; c?: boolean }> | null>(null);
  const railFields = () => Array.from(
    railRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[name]') ?? []);
  const readRail = () => {
    const out: Record<string, { v?: string; c?: boolean }> = {};
    for (const el of railFields()) {
      out[el.name] = (el instanceof HTMLInputElement && el.type === 'checkbox')
        ? { c: el.checked } : { v: el.value };
    }
    return out;
  };
  const pv = (visits ?? []).find((v) => v.id === viewVisit) as Record<string, unknown> | undefined;
  const previewing = Boolean(pv) && Number(viewVisit) !== Number(caseData?.id);
  const pvv = previewing ? (pv as Record<string, any>) : null;
  /** ค่าที่รางขวาใช้แสดง — ครั้งปัจจุบันใช้ของเคสนี้ · ครั้งอื่นใช้ของครั้งนั้น */
  const exV = pvv ?? ex;
  /**
   * ค่ารูปตามกติกาเหมา — **เติมให้เฉพาะตอนยังไม่เคยกรอก** (หัวหน้าแก้ทับได้ตลอด)
   *
   * ⛔ ห้ามเติมทับค่าที่บันทึกไว้แล้ว — หัวหน้าอาจแก้ด้วยเหตุผลเฉพาะเคส
   *    เติมทับทุกครั้งที่เปิดหน้า = การแก้ของคนหายเงียบ (แก้ได้ก็เท่ากับแก้ไม่ได้)
   * ⛔ ดูครั้งอื่นอยู่ (previewing) = อ่านอย่างเดียว ไม่เติมอะไรทั้งนั้น
   */
  const photoFeeUnset = !exV.photo_fee_count && !Number(exV.photo_fee_price ?? 0);
  const photoFee = (!previewing && photoFeeSuggest && photoFeeUnset) ? photoFeeSuggest : null;
  // ค่ารูป: ที่บันทึก = "ราคาต่อรูป" (photo_fee_price) แต่ช่องที่เห็นในคอลัมน์ "ราคาประกัน" = ยอดรวม (user 07/09/69)
  const photoUnitDefault = zeroBlank(exV.photo_fee_price) || (photoFee?.price ? String(photoFee.price) : '');
  const photoCountDefault = Number(exV.photo_fee_count || photoFee?.count || 0) || 1;
  const photoTotalDefault = photoUnitDefault
    ? (Math.round(Number(photoUnitDefault) * photoCountDefault * 100) / 100).toFixed(2) : '';
  /**
   * ── เรทฝั่งเรียกเก็บประกัน ── (user สั่งเปิดใช้ 01/09/69)
   *
   * ตารางเรทรู้คำตอบอยู่แล้วครบทุกอำเภอ เดิมหัวหน้าต้องพิมพ์เองทุกช่องทุกเคส
   * กติกาเติมเหมือนค่ารูปเหมาเป๊ะ:
   *   ⛔ เติมเฉพาะตอนช่องยังว่าง ไม่ทับของที่บันทึกไว้ (หัวหน้าแก้ด้วยเหตุผลเฉพาะเคสได้)
   *   ⛔ ดูครั้งอื่นอยู่ = อ่านอย่างเดียว ไม่เติมอะไรทั้งนั้น
   * ค่ารูปไม่อยู่ในชุดนี้ — มีกติกาเหมาของตัวเองอยู่แล้ว (photoFee ข้างบน)
   */
  const insFill = (n: keyof NonNullable<PayData['suggest']>, cur: unknown) => {
    if (previewing) return null;
    const v = pay?.suggest?.[n];
    if (typeof v !== 'number' || v <= 0) return null;
    return Number(String(cur ?? '').replace(/,/g, '')) ? null : v;
  };
  const insService = insFill('ins_service_fee', exV.service_fee_price);
  const insTravel = insFill('ins_travel_fee', exV.travel_fee_price);
  /**
   * ⛔ คอลัมน์ฝั่งจ่ายพนักงานถูก alias เป็น `pay_*` ตอน query (เพราะ phone_fee/bail_fee
   *    ชนกับฝั่งเรียกเก็บประกัน) — ต้องแมปกลับเป็นชื่อเดิมก่อนส่งให้ช่องกรอกอ่าน
   *    ไม่งั้นช่อง "ราคาพนักงาน" ว่างทั้งคอลัมน์ตอนดูครั้งอื่น (เจอจริงตอนทดสอบ 18/08/69)
   */
  const payV = pvv ? {
    saved: {
      service_fee: pvv.pay_service_fee, travel_fee: pvv.pay_travel_fee,
      photo_fee: pvv.pay_photo_fee, phone_fee: pvv.pay_phone_fee,
      bail_fee: pvv.pay_bail_fee, claim_fee: pvv.pay_claim_fee,
      daily_fee: pvv.pay_daily_fee, other_fee: pvv.pay_other_fee,
      deduct_fee: pvv.pay_deduct_fee, deduct_late: pvv.deduct_late,
      deduct_docs: pvv.deduct_docs, deduct_reason: pvv.deduct_reason,
      out_of_area: pvv.out_of_area, out_of_hours: pvv.out_of_hours,
      out_of_area_amt: pvv.out_of_area_amt, out_of_hours_amt: pvv.out_of_hours_amt,
      special_tumbon: pvv.special_tumbon, daily_check: pvv.daily_check,
      total: pvv.pay_total,
    },
  } : pay;
  const repV = pvv ?? report;

  /**
   * ── 2 ช่องที่แทบไม่ได้ใช้ (ค่าโทรศัพท์ / ค่าประกันตัว) ──
   *
   * พับเก็บไว้ให้ตารางสั้นลง แต่ **กางเองเมื่อเคสนั้นมีกรอกไว้จริง** ไม่งั้น
   * เงินที่กรอกไว้จะหายไปจากสายตาผู้ตรวจทั้งที่ยังนับรวมอยู่ในยอดรวม
   *
   * ⛔ "ค่าใช้จ่ายอื่นๆ" ไม่อยู่ในกลุ่มนี้แล้ว (user เคาะ 02/09/69) — ใช้จริงบ่อยกว่าอีก 2 ช่อง
   *    จึงอย่าเอากลับเข้ามานับใน hasExtra ไม่งั้นกลุ่มนี้จะกางเองทุกเคสที่มี "ค่าใช้จ่ายอื่นๆ"
   */
  const [extraOpen, setExtraOpen] = useState(false);
  const hasExtra = filled(exV.phone_fee) || filled(exV.bail_fee)
    || filled(payV?.saved?.phone_fee) || filled(payV?.saved?.bail_fee);
  useEffect(() => { if (hasExtra) setExtraOpen(true); }, [hasExtra]);

  /** กลับมาครั้งของเคสนี้แล้ว → เขียนค่าที่เก็บไว้คืนลงช่อง (รางเพิ่งถูกสร้างใหม่) */
  useEffect(() => {
    if (previewing || !railDraft.current) return;
    for (const el of railFields()) {
      const keep = railDraft.current[el.name];
      if (!keep) continue;
      if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(keep.c);
      else el.value = keep.v ?? '';
    }
    railDraft.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewVisit, previewing]);


  /** ยอดสะสมทั้งเคลม — บวกทุกครั้งของเลขเคลมเดียวกัน (ฝั่งจ่ายพนักงาน / ฝั่งเรียกเก็บประกัน) */
  const claimTotals = (() => {
    const n = (v: unknown) => Number(String(v ?? '').replace(/,/g, '')) || 0;
    const INS = INS_MONEY_INPUTS;
    let pay = 0, ins = 0;
    for (const v of (visits ?? []) as Record<string, unknown>[]) {
      pay += n(v.pay_total);
      // ค่ารูป = ราคาต่อรูป × จำนวน (ไม่มีจำนวน = 1) ให้ตรงกับยอดสดและยอดที่ส่งออก
      for (const k of INS) ins += k === 'photo_fee_price' ? n(v[k]) * (n(v.photo_fee_count) || 1) : n(v[k]);
    }
    return { pay, ins };
  })();

  /**
   * ── ยอดรวมสดของครั้งนี้ (แสดงอย่างเดียว) ──
   *
   * ต่างจาก "ยอดสะสมทั้งเคลม" ข้างล่างที่บวกจากของที่**บันทึกแล้ว** — ตัวนี้อ่านจากช่อง
   * ที่กำลังพิมพ์อยู่ หัวหน้าจะได้เห็นยอดทั้งสองฝั่งระหว่างกรอก ไม่ต้องกดบันทึกก่อนถึงจะรู้
   *
   * ⛔ **ห้ามใส่ name ให้ช่องยอดรวม** — การ์ดนี้อยู่ใน <form> เดียวกับฟอร์มหลัก
   *    มี name เมื่อไหร่ FormData เก็บไปด้วย แล้วยอดที่ "คำนวณให้ดู" จะกลายเป็นยอดที่
   *    ถูกบันทึก → ไหลต่อไปถึง XML และหน้าค่าใช้จ่าย EMCS ทั้งที่ EMCS คิดยอดรวมเอง
   *    (บอทกรอกแต่ช่องรายแถวฝั่งเสนอ แล้วกด Tab ให้ EMCS รวมเอง — user ย้ำ 01/09/69)
   */
  const [liveSum, setLiveSum] = useState(
    { pay: 0, ins: 0, area: 0, hours: 0, deduct: 0, reasoned: false, photo: 0, photoCount: 0, photoUnit: 0 });
  /**
   * ค่ารูป 2 ช่องต้องสอดคล้องกัน: ช่องที่เห็น photo_fee_total (ยอดรวม) · ช่องที่บันทึก photo_fee_price (ต่อรูป, hidden)
   * พิมพ์ยอดรวม → ต่อรูป = ยอด ÷ จำนวน · แก้จำนวนรูป → ยอดรวม = ต่อรูป × จำนวน (คงราคาต่อรูป เช่น 5 บาท/รูป)
   * ที่ไม่เปลี่ยนไปเก็บยอดรวมตรง ๆ: XML (SUR_PHOTO=ต่อรูป×จำนวน) / se-billing / ใบเบิก / ตัวแปลง ISURVEY คูณ-หารด้วยจำนวนรูปกันอยู่แล้ว
   */
  const syncPhotoFee = useCallback((e?: Event) => {
    const root = railRef.current;
    if (!root) return;
    const el = (n: string) => root.querySelector<HTMLInputElement>(`[name="${n}"]`);
    const total = el('photo_fee_total'), unit = el('photo_fee_price'), cnt = el('photo_fee_count');
    if (!total || !unit) return;
    const num = (v: string | undefined) => Number(String(v ?? '').replace(/,/g, '')) || 0;
    const n = num(cnt?.value) || 1;
    const target = (e?.target as HTMLInputElement | null)?.name;
    if (target === 'photo_fee_count') {
      const u = num(unit.value);
      if (u > 0) total.value = String(Math.round(u * n * 100) / 100);
    } else if (target === 'photo_fee_total' || !target) {
      const t = num(total.value);
      unit.value = t > 0 ? String(Math.round((t / n) * 100) / 100) : '';
    }
  }, []);
  const recalcSums = useCallback(() => {
    const root = railRef.current;
    if (!root) return;
    const el = (n: string) => root.querySelector<HTMLInputElement>(`[name="${n}"]`);
    const num = (n: string) => Number(String(el(n)?.value ?? '').replace(/,/g, '')) || 0;
    const on = (n: string) => Boolean(el(n)?.checked);
    const txt = (n: string) => String(el(n)?.value ?? '').trim();
    /** ว่าง = ใช้ค่าตั้งต้น · 0 ที่กรอกเองถือเป็น 0 จริง — ให้ตรงกับ num() ฝั่ง backend */
    const amt = (n: string, dflt: number) => {
      const t = txt(n).replace(/,/g, '');
      if (t === '') return dflt;
      const v = Number(t);
      return Number.isFinite(v) ? v : dflt;
    };
    const r2 = (v: number) => Math.round(v * 100) / 100;
    // ค่ารูปในช่องคือ "ราคาต่อรูป" (5) — ยอดจริงที่เรียกเก็บ = × จำนวนรูป (10 × 5 = 50) เหมือนที่ XML/se-billing/ใบเบิกคูณอยู่แล้ว
    // เดิมบวกแค่ 5 → รวมยอดบนจอน้อยกว่ายอดที่ส่งออกจริง (user ทัก 04/09/69)
    const photo = r2(num('photo_fee_total'));
    const photoCount = num('photo_fee_count') || 1;
    const photoUnit = r2(num('photo_fee_price'));
    const ins = r2(INS_MONEY_INPUTS.reduce((t, k) => t + (k === 'photo_fee_price' ? photo : num(k)), 0));
    const area = on('out_of_area') ? amt('out_of_area_amt', OUT_OF_AREA_AMT) : 0;
    const hours = on('out_of_hours') ? amt('out_of_hours_amt', OUT_OF_HOURS_AMT) : 0;
    const deduct = Math.abs(num('pay_deduct_fee'));
    /** หักเงินต้องมีเหตุผลกำกับ — ติ๊กข้อใดข้อหนึ่ง หรือพิมพ์เหตุผลอื่นก็นับ */
    const reasoned = on('deduct_late') || on('deduct_docs') || txt('deduct_reason') !== '';
    const pay = r2(PAY_MONEY_INPUTS.reduce((t, k) => t + num(k), 0) + area + hours - deduct);
    setLiveSum((prev) => (prev.pay === pay && prev.ins === ins && prev.area === area
      && prev.hours === hours && prev.deduct === deduct && prev.reasoned === reasoned && prev.photo === photo
      && prev.photoCount === photoCount && prev.photoUnit === photoUnit)
      ? prev : { pay, ins, area, hours, deduct, reasoned, photo, photoCount, photoUnit });
  }, []);
  /**
   * พิมพ์ที่ช่องไหนในรางขวาก็คิดใหม่ — ฟังที่รางทั้งราง ไม่ต้องแขวน onChange ทีละช่อง
   *
   * ⛔ ต้องมี viewVisit ใน deps — รางมี key={viewVisit} คือ **สร้าง DOM ใหม่ทั้งราง**
   *    ตอนสลับครั้งที่ ถ้าไม่ผูกใหม่ ตัวฟังจะค้างอยู่กับ node เก่าที่หลุดจากจอไปแล้ว
   *    → ยอดรวมค้างเลขของครั้งก่อนโดยไม่มีอะไรฟ้อง
   */
  useEffect(() => {
    const root = railRef.current;
    if (!root) return;
    const h = (e: Event) => { syncPhotoFee(e); recalcSums(); };
    root.addEventListener('input', h);
    root.addEventListener('change', h);
    return () => {
      root.removeEventListener('input', h);
      root.removeEventListener('change', h);
    };
  }, [recalcSums, syncPhotoFee, viewVisit]);
  /**
   * ค่าที่โหลดมาทีหลัง (ยอดเงินเป็น async) ไม่ยิง event ใด ๆ — ต้องคิดเองหลัง render
   * ⛔ setLiveSum ต้องคืนตัวเดิมเมื่อยอดไม่เปลี่ยน (ดูข้างบน) ไม่งั้น effect ที่ผูกกับ
   *    อ็อบเจกต์ prop จะวนไม่จบ
   */
  useEffect(() => { recalcSums(); });

  const d = false;
  /**
   * ยอดจ่ายพนักงานกรอกได้ทุกที่มาของงาน (user เคาะ 18/08/69)
   *
   * เดิมล็อกงานจากระบบเดิมไว้ด้วยเหตุผลว่า "ยอดอยู่ที่ se-billing แล้ว" — แต่เอาเข้าจริง
   * หัวหน้าต้องกรอกยอดที่นี่ได้ทุกงาน (EMCS ไม่มีช่องเก็บเรทพนักงานเลย ยอดต้องออกจากระบบเรา)
   * ล็อกไว้ = ทั้งคอลัมน์พิมพ์ไม่ได้ — แกนเดียวกับที่เคยล็อก "หักเงิน" ผิดมาก่อน
   */
  const dPay = previewing;
  /**
   * "หักเงิน" กรอกได้ทุกที่มาของงาน — ต่างจากยอดรายรับ (user เคาะ 17/08/69)
   *
   * เหตุผล: หักเงินเป็นกติกาของ **เราเอง** ไม่ได้มาจากระบบเดิมและไม่มีที่เก็บใน se-billing
   * (ระบบเดิมไม่มีแถวนี้ด้วยซ้ำ — ต้องยืมช่อง "ค่าใช้จ่ายอื่นๆ" ดูคอมเมนต์ตรงตารางข้างล่าง)
   * ล็อกตามที่มาของงานจึงเป็นการล็อกผิดฝั่ง หัวหน้าหักเงินงานระบบเดิมไม่ได้เลย
   * (ต่อมา 18/08/69 ยอดรายรับก็เลิกล็อกด้วยเหตุผลเดียวกัน — ดู `dPay` ข้างบน)
   */
  const dDeduct = previewing;
  /**
   * ── ตีกลับให้ผู้สำรวจ ── (กติกา user เคาะ 18/08/69)
   *
   * สถานะกลับเป็น "กำลังสำรวจ" → งานโผล่ในรายการของช่างอีกครั้ง ให้แก้ในแอปแล้วส่งใหม่
   * ไม่มีการแจ้งเตือนเข้าเครื่อง (ตกลงกันว่าแค่ให้เห็นในรายการงานพอ)
   * และ**หัวหน้ายังแก้เองได้ด้วย** — เคสที่ตีกลับแล้วยังอยู่ในหน้าตรวจสอบ เปิดแก้ได้ตามปกติ
   *
   * ใช้กับเรื่องที่หัวหน้าแก้แทนไม่ได้เพราะต้องถามคนที่ไปหน้างาน — ไม่ใช่ทางลัดแทนการแก้เอง
   */
  const sentBack = Boolean(caseData?.sent_back_at);
  const waitingSurveyor = caseData?.status === 'assigned' && sentBack;
  /**
   * ── เสร็จงานหน้างาน (07/09/69) ── status 'finished' = ช่างกด "เสร็จงาน" แล้วแต่ยังไม่ส่งรายงาน
   * งานยังอยู่กับช่าง (กรอกต่อที่บ้านได้) — หัวหน้าเปิดดูได้ แต่อนุมัติ/ตีกลับไม่ได้จนกว่าช่างจะส่ง
   * (ฝั่ง server: review ต้อง 'surveyed' · send-back ตอบ "อยู่กับผู้สำรวจอยู่แล้ว")
   */
  const finishedWaiting = caseData?.status === 'finished';
  const finishedAtText = (() => {
    const t = new Date(String(caseData?.finished_at ?? ''));
    return Number.isNaN(t.getTime()) ? ''
      : ' ' + t.toLocaleString('th-TH', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
  })();
  const [sbOpen, setSbOpen] = useState(false);
  const [sbReason, setSbReason] = useState('');
  const doSendBack = async () => {
    const reason = sbReason.trim();
    if (!reason) { setSaveMsg('ตีกลับไม่สำเร็จ: ต้องบอกเหตุผลว่าให้แก้อะไร'); return; }
    // บันทึกก่อนเสมอ — สิ่งที่หัวหน้าเพิ่งแก้ต้องไปถึงเครื่องช่างพร้อมกับเหตุผล
    // ไม่งั้นช่างเปิดแอปมาเจอข้อมูลชุดเก่า แล้วส่งกลับมาทับของที่หัวหน้าแก้ไว้
    if (!(await handleSave())) return;
    setSaving(true);
    try {
      await api.post(`/api/cases/${caseData.id}/send-back`, { reason });
      setSaveMsg('ตีกลับให้ผู้สำรวจแล้ว');
      setSbOpen(false); setSbReason('');
      onReviewSubmitted();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setSaveMsg('ตีกลับไม่สำเร็จ: ' + (msg || 'เกิดข้อผิดพลาด'));
    } finally { setSaving(false); }
  };

  /**
   * แอดมินแก้ตัวระบุตัวเคส — ทางออกเดียวเมื่อเลขผิดมาตั้งแต่ต้นทาง (user เคาะ 18/08/69)
   * ⛔ ช่องในแผงนี้ **ห้ามมี name** — มันอยู่ใน <form> เดียวกับฟอร์มหลัก
   *    ถ้ามี name จะถูก FormData เก็บไปด้วยตอนกดบันทึก แล้วทับค่าที่ตั้งใจล็อกไว้
   */
  const [keyEdit, setKeyEdit] = useState<Record<string, string> | null>(null);
  const [keyMsg, setKeyMsg] = useState('');
  const openKeyEdit = () => {
    setKeyMsg('');
    setKeyEdit({
      insurance_company: String(report?.insurance_company ?? ''),
      insurance_branch: String(report?.insurance_branch ?? 'กรุงเทพ'),
      survey_job_no: String(report?.survey_job_no ?? ''),
      claim_ref_no: String(report?.claim_ref_no ?? ''),
      claim_no: String(report?.claim_no ?? ''),
    });
  };
  const saveKeyEdit = async () => {
    if (!keyEdit) return;
    setKeyMsg('');
    try {
      const r = await api.patch(`/api/cases/${caseData.id}/identity`, keyEdit);
      if (r.data?.success) { setKeyEdit(null); onReviewSubmitted(); }
      else setKeyMsg(r.data?.message || 'แก้ไม่สำเร็จ');
    } catch (e) {
      const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setKeyMsg(m || 'แก้ไม่สำเร็จ');
    }
  };
  /**
   * ตัวระบุตัวเคส — **แสดงอย่างเดียว ไม่มีช่องกรอกเลย** (user เคาะ 18/08/69)
   *   บริษัทประกัน · สาขา · เลขเรื่องเซอร์เวย์ · เลขที่รับแจ้ง · เลขที่เคลม
   *
   * ถูกกำหนดตั้งแต่ตอนรับงาน/นำเข้า แก้ทีหลังแล้วเคสจะไปผูกกับงานผิดใบ
   * (เลขเซอร์เวย์ใช้อ้างอิงเบิกเงิน · บริษัทประกันผิดที = เคสไปโผล่ผิดบริษัทใน EMCS
   *  ซึ่ง draft ของ EMCS ลบไม่ได้)
   *
   * ⛔ ห้ามเปลี่ยนกลับเป็น <input>/<select> — ไม่มี name ในฟอร์มแล้ว จึงไม่มีทาง
   *    ถูกเขียนทับตอนบันทึก ถ้าใส่กลับมาต้องคิดเรื่องกันเขียนทับใหม่ทั้งหมด
   */
  // จำนวนช่องบังคับที่ยังว่าง — โชว์เป็นแถบสรุปหัวหน้า (กรอบแดงรายช่องดูใน effect ด้านล่าง)
  const [missing, setMissing] = useState<string[]>([]);
  /**
   * หมวดไหนยังมีช่องแดง — ใช้ติดป้าย "ยังกรอกไม่ครบ" ที่หัวหมวดเท่านั้น
   *
   * ⛔ **ห้ามเอาไปใช้ยุบ/ซ่อนหมวด** (user เคาะ 18/08/69) — เคยทำแล้วถอดออก
   *    หมวดที่ถูกยุบไว้คือหมวดที่ผู้ตรวจจะไม่เปิดดู แล้วปล่อยข้อมูลผิดผ่านไป
   *    หน้านี้เป็นหน้า "ตรวจ" ต้องเห็นทุกช่องเสมอ · มีการ์ดเทสกันไว้
   */
  const [gapSec, setGapSec] = useState<string[] | null>(null);
  /**
   * ช่องชื่อที่มีอักขระซึ่ง EMCS ไม่รับ (ทาแดงโดย paint) — เก็บเป็น state ด้วย
   * ⛔ ไม่งั้นป้าย "ยังกรอกไม่ครบ" ที่หัวหมวดค้าง: ป้ายคำนวณใหม่เมื่อ state เปลี่ยนเท่านั้น
   *    แต่การทาแดง/ล้างแดงของช่องชื่อแตะแค่ DOM ไม่แตะ state → หัวหน้าลบ NBSP ออกจากชื่อ
   *    กรอบแดงหายแล้ว ป้ายหัวหมวดยังแดงอยู่ (user เจอ 03/09/69 เคส #221)
   */
  const [badNames, setBadNames] = useState<string[]>([]);
  /**
   * "การเรียกร้องค่าเสียหายจากคู่กรณี" — ช่องเดียวในฟอร์มที่ **บังคับแบบมีเงื่อนไข**
   *
   * กติกาของ EMCS เอง (สกัดจาก vlidSurvey ของเขา):
   *   if (rdoAcc_Cause01.checked)  → ต้องติ๊กอย่างน้อย 1 ใน 5 ข้อ **และกรอก "คู่กรณีคันที่"**
   *   (ยืนยันซ้ำ 03/09/69 จากไฟล์หน้า EMCS จริง: CheckCheckBoxArrayValid('chkOpo_Result_',5,...)
   *    + CheckInputBoxValid('txtAcc_Cause_No',...) อยู่ในบล็อก if ตัวเดียวกันทั้งคู่)
   *   rdoAcc_Cause01 = "รถคู่กรณีเป็นฝ่ายผิด" · ผลคดีอีก 6 ตัวไม่บังคับ · ไม่แยกตามบริษัท
   *
   * ตัวไฮไลต์ทั่วไปทำช่องแบบนี้ไม่ได้ (มันดูดอกจันแดง = บังคับเสมอ และ isBlank มองข้าม
   * checkbox เพราะเป็นกลุ่ม ไม่ใช่ช่องเดี่ยว) จึงคุมสีของทั้งกลุ่มแยกตรงนี้
   *   แดง = บังคับตอนนี้และยังไม่ติ๊ก · นอกนั้นไม่ทาสีเลย
   *   ⛔ เคยมีสถานะ "เหลือง" (ยังไม่บังคับแต่ยังว่าง) — ถอดออก 03/09/69 เพราะผลคดี
   *      ส่วนใหญ่ไม่ใช่ "คู่กรณีผิด" กรอบเหลืองจึงติดค้างแทบทุกเคสโดยไม่ต้องทำอะไรกับมัน
   */
  const [claimHl, setClaimHl] = useState<'red' | 'none'>('none');
  /**
   * อีก 2 กติกาที่ EMCS ผูกไว้กับบล็อกเดียวกัน (สกัดจาก vlidSurvey ของเขา)
   *   1. ผลคดี = คู่กรณีผิด → บังคับ "คู่กรณีคันที่" (txtAcc_Cause_No) ด้วย
   *   2. ติ๊ก "รับเงินจำนวน" (chkOpo_Result_4) → บังคับช่องเงินทั้งคู่ และ
   *      "รับเงินจำนวน" ต้อง ≤ "จากจำนวนเงินเรียกร้องทั้งหมด" ไม่งั้น EMCS เด้ง alert
   */
  const [oppNoHl, setOppNoHl] = useState<'red' | 'none'>('none');
  const [payHl, setPayHl] = useState<'red' | 'none'>('none');
  /** กรอกยอด "รับเงินจำนวน" แล้วแต่ยังไม่ติ๊กกล่อง — กรอบแดงที่กล่องติ๊ก (user ขอ 09/09/69 หลังเจอเคส #241) */
  const [tickHl, setTickHl] = useState<'red' | 'none'>('none');
  const [payOver, setPayOver] = useState(false);
  /**
   * ลำดับเวลา — กฎอีกชนิดที่ระบบประกันตรวจ และเราไม่เคยตรวจเลย
   *
   * เจอจริง 15/08/69 เคส #141 (มาจากแอปมือถือ ผ่านการอนุมัติมาแล้ว):
   *   เกิดเหตุ 16:00 · ถึงที่เกิดเหตุ 15:50  → ไปถึงก่อนเกิดเหตุ 10 นาที
   * ระบบประกันตีกลับ 3 ข้อรวด ทั้งที่ช่องบังคับครบหมด — ตรวจ "ช่องว่าง" อย่างเดียวไม่พอ
   */
  const [timeErrs, setTimeErrs] = useState<{ at: string; msg: string }[]>([]);
  /**
   * งานจากแอปมือถือไม่มียอดเงินติดมา — หัวหน้าต้องกรอกบนเว็บก่อนอนุมัติ
   * (งานจากระบบเดิมมียอดมาแล้ว ไม่ต้องเช็ค) · user ย้ำ 15/08/69
   */
  const [moneyMissing, setMoneyMissing] = useState<string[]>([]);
  /**
   * เหตุผลที่ยังกดอนุมัติไม่ได้
   *
   * อนุมัติ = ล็อกเคส + บอทหยิบไปเข้า EMCS ทันที · ปล่อยให้อนุมัติทั้งที่ช่องบังคับยังว่าง
   * แปลว่าบอทจะไปตายที่หน้า EMCS แล้วเสียเที่ยว (เจอจริง 15/08/69 เคลม -001860:
   * บันทึกหน้าหลักไม่ผ่านเพราะไม่ได้ติ๊ก "การเรียกร้องค่าเสียหายจากคู่กรณี")
   * ดักที่นี่ถูกกว่า — ผู้ตรวจยังเปิดหน้าอยู่ แก้ได้เลย
   *
   * นับเฉพาะ "แดง" (บังคับจริงตอนนี้) — เหลืองคือยังไม่บังคับ ไม่บล็อก
   */
  /**
   * ช่องบังคับใน 3 ตารางย่อย (คู่กรณี · ผู้บาดเจ็บ · ทรัพย์สิน)
   *
   * ⛔ ช่องพวกนี้ไม่มี name และไม่มีดอกจันในฟอร์มหลัก ตัวไล่หาช่องว่างจึงมองไม่เห็นเลย
   *    ผลคือการ์ดขึ้น "⚠ ยังขาด N ช่องบังคับ" แต่แถบบนขึ้นเขียว "ช่องบังคับครบแล้ว"
   *    หน้าจอขัดกันเอง แล้วอนุมัติผ่าน → บอทไปตายที่หน้าคู่กรณีของ EMCS (vlidOpoCar
   *    บังคับ 8 ช่องต่อคันทุกบริษัท) ต้องให้แอดมินปลดล็อกแล้วทำใหม่
   */
  const recordGaps = (() => {
    const cnt = (rows: Record<string, unknown>[], keys: string[]) =>
      rows.reduce((n, it) => n + keys.filter((k) => !String(it[k] ?? '').trim()).length, 0);
    return cnt(opponents as Record<string, unknown>[], OPPONENT_REQUIRED)
         + cnt(injured as Record<string, unknown>[], INJURED_REQUIRED)
         + cnt(property as Record<string, unknown>[], PROPERTY_REQUIRED);
  })();
  /**
   * รายการความเสียหายต้องมีอย่างน้อย 1 ชิ้น (B7)
   * ⛔ เดิมดอกจันไปผูกกับ textarea `damage_description` ซึ่ง **ไม่เคยถึง EMCS เลย**
   *    (ไม่มีใน xmlExport และไม่มีในบอททั้ง repo) → พิมพ์อะไรก็ได้ = ปลดล็อกเกต
   *    ทั้งที่รายการจริงยังว่าง แล้วบอทยกเข้า EMCS ด้วยความเสียหาย 0 ชิ้น
   */
  const damageRows = damage.filter((x) => x.part && x.level).length;

  const approvalBlockers = [
    ...(finishedWaiting ? ['ช่างเสร็จงานหน้างานแล้วแต่ยังไม่ส่งรายงาน — อนุมัติได้เมื่อช่างกดส่งงาน'] : []),
    ...(missing.length > 0 ? [`ช่องบังคับยังว่าง ${missing.length} ช่อง`] : []),
    ...(claimHl === 'red' ? ['ยังไม่ได้ติ๊ก "การเรียกร้องค่าเสียหายจากคู่กรณี"'] : []),
    ...(oppNoHl === 'red' ? ['ยังไม่ได้กรอก "คู่กรณีคันที่"'] : []),
    ...(payHl === 'red' ? ['ติ๊ก "รับเงินจำนวน" แล้วแต่ยังไม่กรอกยอด'] : []),
    ...(tickHl === 'red' ? ['กรอกยอด "รับเงินจำนวน" แล้วแต่ยังไม่ติ๊กกล่อง'] : []),
    ...(payOver ? ['"รับเงินจำนวน" มากกว่ายอดเรียกร้องทั้งหมด'] : []),
    ...timeErrs.map((e) => `"${TL_LABEL[e.at] ?? e.at}" ${e.msg}`),
    ...(recordGaps > 0 ? [`คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน ยังขาด ${recordGaps} ช่องบังคับ`] : []),
    ...(damageRows === 0 ? ['ยังไม่มีรายการความเสียหายรถประกัน (ปุ่ม "ข้อมูลความเสียหาย")'] : []),
    ...moneyMissing,
  ];

  /**
   * 5 จังหวะของงาน เรียงตามลำดับที่ต้องเป็นจริง — ใช้วาดการ์ด "ลำดับเวลา"
   * ชื่อช่องต้องตรงกับที่ `updateReport` ฝั่ง backend ประกอบกลับเป็น "วันที่|ชม:นาที"
   * และตรงกับชื่อที่ตัวตรวจลำดับเวลา (stamp() ใน paint) อ่าน — แก้ที่นี่ต้องแก้ทั้ง 3 ที่
   */
  const tl = (date: string, hour: string, min: string,
              v: { date: string; hour: string; minute: string }) =>
    ({ date, hour, min, label: TL_LABEL[date], v, keys: [date, hour, min] });
  const accT = String(report?.acc_time ?? '').split(':');
  const TIMELINE = report ? [
    tl('acc_date', 'acc_time_hour', 'acc_time_minute',
       { date: report.acc_date || '', hour: accT[0] || '', minute: accT[1] || '' }),
    tl('acc_customer_report_date_val', 'acc_customer_report_hour', 'acc_customer_report_minute',
       parseDatetime(report.acc_customer_report_date)),
    tl('acc_insurance_notify_date_val', 'acc_insurance_notify_hour', 'acc_insurance_notify_minute',
       parseDatetime(report.acc_insurance_notify_date)),
    tl('acc_survey_arrive_date_val', 'acc_survey_arrive_hour', 'acc_survey_arrive_minute',
       parseDatetime(report.acc_survey_arrive_date)),
    tl('acc_survey_complete_date_val', 'acc_survey_complete_hour', 'acc_survey_complete_minute',
       parseDatetime(report.acc_survey_complete_date)),
  ] : [];

  // ทาสีกรอบแดงให้ช่องบังคับที่ยังว่าง + นับจำนวน
  // ทำหลัง render เพราะช่องบังคับกระจายอยู่ ~49 จุด ผูกกับดอกจันที่มีอยู่แล้วดีกว่าไล่แก้ทีละช่อง
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    // อาเรย์ใหม่ทุกครั้ง = re-render ทุกครั้งแม้เนื้อหาเท่าเดิม (หน้านี้มี ~200 ช่อง)
    const setList = <T,>(set: (u: (prev: T[]) => T[]) => void, next: T[]) =>
      set((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    const paint = () => {
      const names: string[] = [];
      form.querySelectorAll('.req-mark').forEach((mark) => {
        fieldsOfMark(mark, form).forEach((el) => {
          const blank = isBlank(el);
          // จำพื้นหลังเดิมไว้ครั้งแรก แล้วสลับไปมาระหว่างเดิม ↔ แดง
          if (!el.dataset.bg0) el.dataset.bg0 = BG_ORIG.find((c) => el.classList.contains(c)) || 'bg-white';
          el.classList.toggle('border-gray-300', !blank);
          el.classList.toggle(el.dataset.bg0, !blank);
          RING.forEach((c) => el.classList.toggle(c, blank));
          const nm = (el as HTMLInputElement).name;
          if (blank && nm && !names.includes(nm)) names.push(nm);
        });
      });
      // กลุ่ม radio ที่บังคับ (ดู REQ_RADIO_GROUPS) — นับเองเพราะตัวทาสีทั่วไปมองไม่เห็น
      for (const nm of REQ_RADIO_GROUPS) {
        if (!form.querySelector(`input[name="${nm}"]:checked`)) names.push(nm);
      }

      /**
       * ── ชื่อที่มีอักขระ EMCS ไม่รับ (วงเล็บ ทับ ฯลฯ) → ทาแดงที่ช่องเลย ──
       * เดิมเตือนเป็นแถบเหลืองบนหัวหน้าอย่างเดียว ซึ่งคำนวณตอนโหลดหน้า แก้แล้วไม่หาย
       * และไม่บอกว่าอยู่ช่องไหนในบรรดา ~200 ช่อง (user เคาะ 17/08/69 ให้มาโชว์ที่ช่อง)
       * EMCS ไม่ได้แค่ตัดอักขระ — มัน **ล้างชื่อทั้งช่องทิ้ง** ตอนคนคลิกเข้า-ออก
       */
      const badList: string[] = [];
      for (const nm of EMCS_NAME_FIELDS) {
        const el = form.querySelector(`[name="${nm}"]`) as HTMLInputElement | null;
        if (!el) continue;
        const bad = emcsBadChars(el.value ?? '');
        if (bad) badList.push(nm);
        el.title = bad ? `EMCS จะล้างชื่อทั้งช่องทิ้งเพราะมีอักขระ: ${bad}` : '';
        // ช่องที่ทาแดงเพราะ "ว่าง" อยู่แล้ว ปล่อยให้ตัวเดิมคุมไป อย่าทับกัน
        if (names.includes(nm)) continue;
        if (!el.dataset.bg0) el.dataset.bg0 = BG_ORIG.find((c) => el.classList.contains(c)) || 'bg-white';
        el.classList.toggle('border-gray-300', !bad);
        el.classList.toggle(el.dataset.bg0, !bad);
        RING.forEach((c) => el.classList.toggle(c, Boolean(bad)));
      }

      setList(setMissing, names);
      setList(setBadNames, badList);   // เปลี่ยนเฉพาะตอนชุดช่องที่แดงเปลี่ยนจริง → ป้ายหัวหมวดตามทัน

      // ── บล็อก "การเรียกร้องค่าเสียหายจากคู่กรณี" (บังคับแบบมีเงื่อนไข) ──
      // ค่า radio "คู่กรณีผิด" ตรงกับ rdoAcc_Cause01 ของ EMCS ที่เป็นตัวเปิดเงื่อนไข
      const val = (sel: string) =>
        String((form.querySelector(sel) as HTMLInputElement | null)?.value ?? '').trim();
      const fault = val('input[name="acc_fault"]:checked');
      const oppFault = fault === 'คู่กรณีผิด';

      const ticks = Array.prototype.map.call(
        form.querySelectorAll('input[name="acc_claim_opponent"]:checked'),
        (el) => (el as HTMLInputElement).value) as string[];
      // ⛔ ไม่มีสถานะ "เหลือง" แล้ว (user เคาะ 03/09/69) — ผลคดีอื่นไม่บังคับช่องนี้เลย
      // กรอบเหลืองจึงขึ้นแทบทุกเคสโดยไม่ได้บอกอะไร กลายเป็นเตือนหลอกจนคนเลิกมอง
      setClaimHl(oppFault && ticks.length === 0 ? 'red' : 'none');

      // "คู่กรณีคันที่" — EMCS บังคับในเงื่อนไขเดียวกันเป๊ะ ใช้สีชุดเดียวกัน
      const oppNoBlank = !val('input[name="acc_fault_opponent_no"]');
      setOppNoHl(oppFault && oppNoBlank ? 'red' : 'none');

      // ช่องเงิน — บังคับเมื่อ "ติ๊กรับเงินจำนวน" เท่านั้น (ไม่เกี่ยวกับผลคดี)
      // ไม่ทาเหลืองตอนไม่บังคับ เพราะเคสส่วนใหญ่ไม่มีการรับเงิน จะกลายเป็นเตือนหลอกทุกใบ
      const moneyTick = ticks.some((v) => v.includes('รับเงิน'));
      const amt = val('input[name="acc_claim_amount"]').replace(/,/g, '');
      const total = val('input[name="acc_claim_total_amount"]').replace(/,/g, '');
      setPayHl(moneyTick && (!amt || !total) ? 'red' : 'none');
      setPayOver(Boolean(moneyTick && amt && total && Number(amt) > Number(total)));
      // กลับด้าน: มียอดแต่ยังไม่ติ๊ก — ข้อมูลไม่สอดคล้อง (EMCS มีกล่องติ๊กคู่กับช่องเงิน) ทาแดงที่กล่องติ๊ก
      setTickHl(!moneyTick && Number(amt) > 0 ? 'red' : 'none');

      /**
       * ── ค่าเรียกร้องเติมให้เอง (user เคาะ 08/09/69) ──
       * กรอกยอด "รับเงินจำนวน" (> 0) → ช่อง % และ "ราคาพนักงาน" ของค่าเรียกร้อง = ยอด × %
       *   ⛔ ไม่ผูกกับกล่องติ๊ก "รับเงินจำนวน" — user เจอจริง 09/09/69 (#241) พิมพ์ยอดแล้วแต่ยังไม่ติ๊ก % ไม่ขึ้น งง
       *      extension บน ISURVEY ก็ดูแค่ยอดอย่างเดียว
       *   "ผู้สำรวจภัย" ขึ้นต้น SE (พนักงานเรา รวม SEC ต่างจังหวัด) = 5% · ช่างนอก (OSS ชื่ออื่น) = 10%
       *   บริษัท 2 (เลขเซอร์เวย์ขึ้นต้น SETP ไทยไพบูลย์ / SEMS MSIG) = 5% เสมอไม่ว่าช่างใคร
       *   (กติกาเดียวกับ extension se-billing บน ISURVEY: COMPANY2_CLAIM_SUR_PCT) · ช่องผู้สำรวจภัยว่าง = ไม่รู้ว่าใคร ไม่เติม
       * ฝั่งเรียกเก็บประกัน (claim_fee_price): โชว์ 10% เป็นตัวจาง ๆ (placeholder) ให้เห็นว่ามียอด — ไม่ใส่เป็นค่าจริง
       *   จึงไม่รวมยอดฝั่งประกัน ไม่ถูกบันทึก ไม่ไป XML/se-billing (user เคาะ 08/09/69) · พิมพ์ทับเมื่อจะเรียกเก็บจริง
       * เขียนทับเฉพาะช่องว่างหรือค่าที่ระบบเติมไว้เอง (จำไว้ใน data-auto) — หัวหน้าพิมพ์ทับแล้วระบบไม่แย่งคืน
       * เลิกติ๊ก/ล้างยอด → ล้างเฉพาะค่าที่ระบบเติม · เติมแล้วต้องคิดยอดรวมใหม่เอง (event ไหลผ่านรางไปแล้ว)
       */
      {
        const surveyor = val('input[name="acc_surveyor"]');
        const amtNum = Number(amt);
        const company2 = /^(SETP|SEMS)/i.test(String(report?.survey_job_no ?? '').trim());
        const isSE = /^SE/i.test(surveyor);
        const pct = company2 ? 5 : isSE ? 5 : surveyor ? 10 : null;
        const hasAmt = pct !== null && Number.isFinite(amtNum) && amtNum > 0;
        const feeStr = hasAmt ? String(Math.round(amtNum * pct) / 100) : '';
        // เติมเป็นค่าจริง (เข้ารวมยอด บันทึก) เฉพาะพนักงาน SE — ช่างนอกได้แค่ตัวเทา (placeholder) ไม่นับรวม
        // เหมือนฝั่งประกัน (user เคาะ 09/09/69: ช่างนอกไม่ได้รับเงินผ่านใบเบิกนี้)
        const auto = hasAmt && isSE ? { claim_fee_percent: String(pct), pay_claim_fee: feeStr } : null;
        let touched = false;
        // [ชื่อช่อง, ค่าจริงที่จะเติม (SE), ตัวเทาของช่างนอก]
        const targets: Array<[string, string | undefined, string]> = [
          ['claim_fee_percent', auto?.claim_fee_percent, hasAmt ? String(pct) : ''],
          ['pay_claim_fee', auto?.pay_claim_fee, feeStr],
        ];
        for (const [nm, next, ossHint] of targets) {
          const el = form.querySelector(`input[name="${nm}"]`) as HTMLInputElement | null;
          if (!el || el.disabled) continue;
          const cur = el.value.trim();
          const mine = cur === '' || (el.dataset.auto !== undefined && cur === el.dataset.auto);
          if (next !== undefined) {
            if (mine && cur !== next) { el.value = next; el.dataset.auto = next; touched = true; }
          } else if (el.dataset.auto !== undefined && cur === el.dataset.auto) {
            el.value = ''; delete el.dataset.auto; touched = true;
          } else if (!isSE && ossHint !== '' && cur !== '' && Number(cur.replace(/,/g, '')) === Number(ossHint)) {
            // ช่างนอกแต่มีค่าจริงเท่ากับตัวเทาเป๊ะ (เช่น 300 = 10% ของ 3000) = ระบบรุ่นก่อนเติมไว้แล้วบันทึก
            // (user เจอ #241 09/09/69) → ล้างให้เป็นตัวเทา ไม่รวมยอด · ค่าที่ต่างจากตัวเทา = พิมพ์เองตั้งใจจ่าย ปล่อยไว้
            el.value = ''; touched = true;
          }
        }
        // ตัวเทา (placeholder = ไม่ใช่ค่า ไม่รวมยอด ไม่บันทึก): ฝั่งประกัน 10% ทุกงาน · ฝั่งพนักงาน + ช่อง % เฉพาะช่างนอก
        const hints: Array<[string, string, string]> = [
          ['claim_fee_price', hasAmt ? String(Math.round(amtNum * 10) / 100) : '', '10% ของยอดเรียกร้อง (ยังไม่นับรวม) — พิมพ์ทับถ้าต้องการเรียกเก็บ'],
          ['pay_claim_fee', hasAmt && !isSE ? feeStr : '', `${pct}% ของยอดเรียกร้อง (ช่างนอก ยังไม่นับรวม) — พิมพ์ทับถ้าต้องการจ่าย`],
          ['claim_fee_percent', hasAmt && !isSE ? String(pct) : '', 'เปอร์เซ็นต์แนะนำสำหรับช่างนอก — ยังไม่บันทึก'],
        ];
        for (const [nm, hint, tip] of hints) {
          const el = form.querySelector(`input[name="${nm}"]`) as HTMLInputElement | null;
          if (!el) continue;
          if (el.placeholder !== hint) el.placeholder = hint;
          el.title = hint ? tip : '';
        }
        if (touched) recalcSums();
      }

      // ── ลำดับเวลา (กติกาของระบบประกัน) ──
      // วันที่บนฟอร์มเป็น พ.ศ. รูปแบบ วว/ดด/ปปปป — อ่านไม่ออกก็ข้าม ไม่เดา
      const stamp = (dn: string, hn: string, mn: string): number | null => {
        const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(val(`input[name="${dn}"]`));
        if (!m) return null;
        const h = Number(val(`input[name="${hn}"]`) || 0);
        const mi = Number(val(`input[name="${mn}"]`) || 0);
        return new Date(Number(m[3]) - 543, Number(m[2]) - 1, Number(m[1]), h, mi).getTime();
      };
      const tAcc = stamp('acc_date', 'acc_time_hour', 'acc_time_minute');
      const tCus = stamp('acc_customer_report_date_val', 'acc_customer_report_hour', 'acc_customer_report_minute');
      const tIns = stamp('acc_insurance_notify_date_val', 'acc_insurance_notify_hour', 'acc_insurance_notify_minute');
      const tArr = stamp('acc_survey_arrive_date_val', 'acc_survey_arrive_hour', 'acc_survey_arrive_minute');
      const tFin = stamp('acc_survey_complete_date_val', 'acc_survey_complete_hour', 'acc_survey_complete_minute');
      /**
       * ⛔ EMCS ใช้เงื่อนไข **">=" เป็น error** คือ "ห้ามเท่ากัน" ด้วย
       *    เดิมที่นี่ใช้ a < b เฉย ๆ → เวลาเท่ากันเป๊ะผ่านหน้าเว็บแต่ตกที่ EMCS
       */
      const before = (a: number | null, b: number | null) => a !== null && b !== null && a <= b;
      // `at` = ช่องที่ผิด — เอาไว้แปะข้อความเตือนใต้จังหวะนั้นในการ์ดลำดับเวลา
      // (เดิมมีแต่ข้อความรวมบนหัวหน้า ตัวช่องได้แค่กรอบแดง ไม่บอกว่าผิดยังไง
      //  ต้องเลื่อนขึ้นไปอ่านแล้วเลื่อนกลับลงมาแก้ — user เคาะ 17/08/69 ให้ย้ายมาไว้ที่จุด)
      const te: { at: string; msg: string }[] = [];
      const ARR = 'acc_survey_arrive_date_val';
      if (before(tArr, tAcc)) te.push({ at: ARR, msg: 'ย้อนหลังกว่าเวลาเกิดเหตุ' });
      if (before(tArr, tCus)) te.push({ at: ARR, msg: 'ย้อนหลังกว่าเวลาที่ลูกค้าแจ้ง บ.ประกัน' });
      if (before(tArr, tIns)) te.push({ at: ARR, msg: 'ย้อนหลังกว่าเวลาที่ บ.ประกันแจ้งสำรวจภัย' });
      // ข้อนี้ยังไม่เคยเห็นระบบประกันฟ้อง แต่เป็นไปไม่ได้ทางตรรกะ — ปล่อยผ่านก็เสียเที่ยวอยู่ดี
      if (before(tFin, tArr)) te.push({ at: 'acc_survey_complete_date_val', msg: 'ย้อนหลังกว่าเวลาที่ถึงที่เกิดเหตุ' });
      /**
       * อีก 3 คู่ที่ EMCS ตรวจแต่เดิมที่นี่ไม่ได้ตรวจ — และ **ไม่ได้ตามมาโดยปริยาย**
       * ตัวอย่างที่หลุด: เกิดเหตุ 12:00 · ลูกค้าแจ้ง 14:20 · แจ้งสำรวจ 13:50 · ถึงที่ 15:00
       * → 4 กฎเดิมผ่านหมด แต่ EMCS เด้งเพราะแจ้งสำรวจมาก่อนลูกค้าแจ้ง
       */
      const CUS = 'acc_customer_report_date_val';
      const INS = 'acc_insurance_notify_date_val';
      if (before(tCus, tAcc)) te.push({ at: CUS, msg: 'ย้อนหลังกว่าเวลาเกิดเหตุ' });
      if (before(tIns, tAcc)) te.push({ at: INS, msg: 'ย้อนหลังกว่าเวลาเกิดเหตุ' });
      if (before(tIns, tCus)) te.push({ at: INS, msg: 'ย้อนหลังกว่าเวลาที่ลูกค้าแจ้ง บ.ประกัน' });
      /**
       * ⛔ ห้ามล้ำเวลาปัจจุบัน — EMCS ฟ้องว่า "กรุณาระบุวันที่สำรวจภัยเสร็จ ต้องไม่เกินวันที่
       *    ณ ปัจจุบัน" แล้วปัดตกทั้งหน้า **เทียบถึงระดับนาที ไม่ใช่ระดับวัน**
       *    ยืนยันจากการทดสอบสด 19/08/69: ล้ำไป 45 นาทีก็ตก ล้ำไป 2 นาทีก็ตก
       *    (จึงเตือนแบบเดียวกับ EMCS เป๊ะ ๆ — ปัดให้หลวมกว่านี้เท่ากับปล่อยให้เสียเที่ยว)
       */
      if (tFin !== null && tFin > Date.now()) {
        te.push({ at: 'acc_survey_complete_date_val', msg: 'ล้ำเวลาปัจจุบัน — ระบบประกันไม่รับ' });
      }
      /**
       * ⛔ เคลมสด: 5 เวลาต้องอยู่ในกรอบ 24 ชั่วโมง — EMCS ฟ้องว่า
       *    "กรณี [เคลมสด] ต้องระบุ 'วันที่เกิดเหตุและเวลา' 'วันที่ลูกค้าแจ้งบ.ประกัน'
       *     'วันที่บ.ประกันแจ้งสำรวจภัย' 'วันที่สำรวจภัย(ถึงที่เกิดเหตุเวลา)'
       *     'วันที่สำรวจภัยเสร็จ' ให้อยู่ภายใน 24 ชั่วโมง." แล้วปัดตกทั้งหน้า
       *
       *    เจอจริง 22/08/69 ทั้งไอโออิและไทยไพบูลย์: เวลาที่แอปบันทึกคือเวลาจริงในสนาม
       *    แต่กว่าหัวหน้าจะตรวจ+อนุมัติอาจข้ามวัน → ตกทั้งคู่ ต้องมาไล่แก้ทีหลัง
       *    (ตรวจเฉพาะจังหวะที่กรอกมาแล้ว — ช่องว่างมีกติกา "ช่องบังคับ" ดักอยู่แล้ว)
       */
      const isFresh = (document.querySelector('input[name="claim_type"]:checked') as HTMLInputElement | null)?.value === 'F';
      if (isFresh) {
        const ts = [tAcc, tCus, tIns, tArr, tFin].filter((x): x is number => x !== null);
        if (ts.length >= 2 && Math.max(...ts) - Math.min(...ts) > 24 * 60 * 60 * 1000) {
          te.push({ at: 'acc_date', msg: 'เคลมสด: 5 จังหวะเวลาต้องอยู่ในกรอบ 24 ชม. — ระบบประกันไม่รับ' });
        }
      }
      setList(setTimeErrs, te);

      // ── ยอดเงินของงานจากแอปมือถือ ──
      const mm: string[] = [];
      // ดูที่ "ค่าบริการ" ฝั่งพนักงานโดยเฉพาะ (ช่องสด + ที่บันทึกไว้) — user เจอ 09/09/69: ค่าเรียกร้องที่ระบบเติมให้
      // ทำให้กรอบแดงค่าบริการหายทั้งที่ยังไม่ได้กรอก เพราะเดิมนับ "มีเงินช่องไหนก็ได้"
      const liveService = Number(val('input[name=pay_service_fee]').replace(/,/g, '')) > 0;
      const payMissing = payRequired && Boolean(pay) && !(Number(pay?.saved?.service_fee ?? 0) > 0) && !liveService;
      const insMissing = payRequired && !val('input[name="service_fee_price"]');
      if (payMissing) mm.push('ยังไม่ได้กรอก "ราคาพนักงาน" (ค่าบริการ)');
      if (insMissing) mm.push('ยังไม่ได้กรอก "ราคาประกัน" (ค่าบริการ)');
      /**
       * ทาแดงที่ช่องจริง — user ทัก 09/09/69: ป้ายบอก "ยังอนุมัติไม่ได้ 2 ข้อ" แต่ไม่มีช่องไหนแดง
       * คนหาไม่เจอว่าอยู่ตรงไหน · ช่องเงินมีขอบสีของตัวเอง (ฟ้า) ต้องถอดออกตอนทาแดง ไม่งั้นสีตีกัน
       */
      for (const [nm, on] of [['pay_service_fee', payMissing], ['service_fee_price', insMissing]] as const) {
        const el = form.querySelector(`input[name="${nm}"]`) as HTMLInputElement | null;
        if (!el) continue;
        if (!el.dataset.bg0) el.dataset.bg0 = BG_ORIG.find((c) => el.classList.contains(c)) || 'bg-white';
        if (!el.dataset.border0) el.dataset.border0 = ['border-gray-300', 'border-blue-300', 'border-blue-600'].find((c) => el.classList.contains(c)) || 'border-gray-300';
        el.classList.toggle(el.dataset.bg0, !on);
        el.classList.toggle(el.dataset.border0, !on);
        RING.forEach((c) => el.classList.toggle(c, on));
      }
      setList(setMoneyMissing, mm);
    };
    paint();
    /**
     * ⛔ ห้ามผูก `paint` กับ event ตรง ๆ — ต้องหน่วงออกไปนอกจังหวะที่ event กำลังไหล
     *
     * `<form>` เป็น ancestor ของทุกช่อง ส่วน React (Next.js App Router) ดัก event ไว้ที่
     * `document` ซึ่งอยู่ **เหนือ** form ขึ้นไป → ลำดับจริงคือ  ช่อง → form(paint) → document(React)
     *
     * paint เรียก setState ที่ทำให้ re-render ทันทีกลางคัน · ตอน re-render React เขียนค่า
     * `value` ของช่อง **controlled** กลับเป็นค่าใน state ซึ่งยังเป็นค่าเก่า (onChange ยังไม่ทำงาน
     * เพราะ event ยังไปไม่ถึง React!) → พอ event ไหลถึง React ค่ากับตัวจำเท่ากันพอดี
     * → React สรุปว่า "ไม่มีอะไรเปลี่ยน" **ไม่ยิง onChange เลย** = พิมพ์/เลือกไม่เข้าถาวร
     *
     * กระทบเฉพาะช่อง controlled: คู่กรณี · ผู้บาดเจ็บ · ทรัพย์สิน · ความเสียหาย และ 5 dropdown
     * cascade (ประเภทรถ · จังหวัด-เขต ที่เกิดเหตุ · จังหวัด-เขต ผู้ขับขี่)
     * ช่องทั่วไปเป็น uncontrolled จึงรอด — เลยดูเหมือน "บางช่องพิมพ์ไม่ได้" (เจอจริง 17/08/69 เคส #149)
     *
     * rAF = รอให้ event ไหลจบก่อนค่อย setState · กรอบแดงยังอัปเดตทันตาเหมือนเดิม
     */
    let raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); };
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    return () => {
      cancelAnimationFrame(raf);
      form.removeEventListener('input', schedule);
      form.removeEventListener('change', schedule);
    };
    // pay โหลดทีหลัง (async) — ไม่ใส่ไว้ ตัวเช็ค "ยังไม่กรอกราคาพนักงาน" จะค้างที่ผลก่อนโหลด
  }, [report, isEditing, saveMsg, pay, payRequired, recalcSums]);

  /**
   * ── เส้นใต้บอกสถานะช่อง: เข้ม = กรอกแล้ว · จาง = ยังว่าง ──
   *
   * แกนของแบบใหม่ (Claude Design 02/09/69) หน้านี้มีเกือบ 200 ช่อง ถ้าทุกช่องหน้าตา
   * เหมือนกันหมด ต้องกวาดตาอ่านค่าทีละช่องถึงจะรู้ว่าเหลืออะไร เส้นใต้ทำให้
   * เห็นได้จากการเลื่อนผ่าน · ตัวสไตล์อยู่ใน globals.css (`[data-filled]`)
   *
   * ⛔ คนละเรื่องกับกรอบแดง — กรอบแดง = "บังคับแล้วยังไม่กรอก"
   *    ช่องที่ถูกทาแดงอยู่ต้องไม่โดนทับ (CSS กันไว้ด้วย :not(.border-red-400))
   * ⛔ ห้ามรวมเข้ากับ paint() — paint เรียก setState ตัวนี้แตะแค่ DOM attribute
   *    เอาไปปนแล้วจะกลายเป็นวงวน render
   */
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const mark = () => {
      form.querySelectorAll('input,select,textarea').forEach((el) => {
        const t = (el as HTMLInputElement).type;
        if (t === 'radio' || t === 'checkbox' || t === 'hidden' || t === 'file') return;
        (el as HTMLElement).dataset.filled = isBlank(el as HTMLElement) ? '0' : '1';
      });
    };
    let raf = 0;
    const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(mark); };
    mark();                       // ทุกรอบ render — แถวคู่กรณี/ผู้บาดเจ็บที่เพิ่งเพิ่มจะได้ติดด้วย
    form.addEventListener('input', schedule);
    form.addEventListener('change', schedule);
    return () => {
      cancelAnimationFrame(raf);
      form.removeEventListener('input', schedule);
      form.removeEventListener('change', schedule);
    };
  });

  /**
   * ป้าย "ยังกรอกไม่ครบ" ที่หัวหมวด — ต้องอ่าน DOM **หลัง** React วาดเสร็จ
   *
   * ⛔ อย่าย้ายกลับไปคิดใน paint() — ตอน paint ทำงาน คลาสไฮไลต์ที่ React คุม
   *    (claimHl / oppNoHl / payHl) ยังเป็นค่าของรอบก่อน ป้ายจะช้าไป 1 จังหวะ:
   *    ติ๊ก "การเรียกร้องค่าเสียหายจากคู่กรณี" แล้วกรอบแดงหายทันที แต่ป้ายยังค้าง
   *    ว่ายังกรอกไม่ครบ (เจอจริง 18/08/69) · deps จึงต้องมีสถานะไฮไลต์ครบทุกตัว
   */
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const gs: string[] = [];
    form.querySelectorAll('[data-section]').forEach((sec) => {
      if (sec.querySelector('.' + RING[0])) gs.push(sec.getAttribute('data-section') || '');
    });
    setGapSec((prev) => (JSON.stringify(prev) === JSON.stringify(gs) ? prev : gs));
  }, [missing, badNames, claimHl, oppNoHl, payHl, tickHl, payOver, timeErrs, moneyMissing, opponents, injured, property, damage]);

  useEffect(() => {
    let alive = true;
    api.get(`/api/cases/${caseData.id}/pay`)
      .then((r) => { if (alive && r.data?.success) setPay(r.data.data as PayData); })
      .catch(() => {});   // ยังไม่มีสิทธิ์/ยังไม่มีข้อมูล → ซ่อนบล็อกไปเลย ไม่ต้องรบกวนผู้ตรวจ
    return () => { alive = false; };
  }, [caseData.id]);

  /**
   * ── เรทแนะนำต้องตาม "พื้นที่ที่กำลังเลือก" ไม่ใช่ที่บันทึกไว้ (user เจอ #252 09/09/69) ──
   * เปลี่ยนจังหวัด/อำเภอ/ตำบลบนหน้า → ขอเรทใหม่ด้วยพื้นที่นั้นทันที (หน่วง 350 ms กันยิงถี่)
   * เดิมคิดครั้งเดียวตอนโหลดจากรายงานที่บันทึกไว้ → เลือกตำบลบ่อวินแล้วยังแนะนำเรทอำเภอ หัวหน้าต้องพิมพ์เอง
   * 09/09/69: พื้นที่ที่ส่ง = สถานที่ออกตรวจสอบก่อน (มีจังหวัดที่ตรวจสอบ) ไม่มีค่อยส่งสถานที่เกิดเหตุ — ดู rateLocationOf ฝั่ง backend
   */
  const suggestReqRef = useRef(0);
  const suggestMountedRef = useRef(false);
  useEffect(() => {
    if (!suggestMountedRef.current) { suggestMountedRef.current = true; return; }   // โหลดแรกมี effect ข้างบนแล้ว
    if (previewing) return;
    const id = ++suggestReqRef.current;
    const t = setTimeout(() => {
      const params: Record<string, string> = {};
      // เรทคิดจาก "สถานที่ออกตรวจสอบ" ก่อน — มีจังหวัดที่ตรวจสอบ = ส่งชุดนั้นทั้งชุด ไม่มีค่อยส่งสถานที่เกิดเหตุ
      // ส่งอำเภอ/ตำบลไปแม้ว่าง (เอาติ๊กตำบลออก = เรทต้องกลับเป็นของอำเภอทันที ไม่ใช่ค้างของที่บันทึกไว้)
      const useSurvey = isProv(survProv);
      const [p, dd, tb] = useSurvey ? [survProv, survDist, survTumbon] : [accProv, accDist, accTumbon];
      if (isProv(p)) params.province = p;
      params.district = isDist(dd) ? dd : '';
      params.subdistrict = tb;
      params.location = useSurvey ? 'survey' : 'accident';
      api.get(`/api/cases/${caseData.id}/pay`, { params })
        .then((r) => {
          if (id !== suggestReqRef.current || !r.data?.success) return;
          const d = r.data.data as PayData;
          setPay((prev) => (prev ? { ...prev, suggest: d.suggest, area: d.area } : d));
        })
        .catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [accProv, accDist, accTumbon, survProv, survDist, survTumbon, caseData.id, previewing]);

  /**
   * เรทแนะนำเปลี่ยน → เติมช่องให้ทันที เฉพาะช่องที่ "ว่าง" หรือ "ยังเป็นค่าที่ระบบเติมไว้" (จำใน data-auto /
   * เท่ากับเรทแนะนำรอบก่อน) — ค่าที่หัวหน้าพิมพ์เองไม่ถูกทับ · ครอบ 3 ช่อง: ค่าบริการฝั่งประกัน · ค่าเดินทางฝั่งประกัน ·
   * ค่าบริการฝั่งพนักงาน (เดิมฝั่งพนักงานมีแค่ข้อความ "ระบบแนะนำ" ให้พิมพ์ตาม → เติมให้เลย)
   */
  const lastSuggestRef = useRef<Record<string, number | null>>({});
  useEffect(() => {
    const sg = pay?.suggest;
    const form = formRef.current;
    if (!sg || !form || previewing) return;
    const map: Array<[string, number | null | undefined]> = [
      ['service_fee_price', sg.ins_service_fee],
      ['travel_fee_price', sg.ins_travel_fee],
      ['pay_service_fee', sg.service_fee],
    ];
    let touched = false;
    for (const [nm, v] of map) {
      const el = form.querySelector(`input[name="${nm}"]`) as HTMLInputElement | null;
      if (!el || el.disabled) { lastSuggestRef.current[nm] = typeof v === 'number' ? v : null; continue; }
      const cur = el.value.trim();
      const curNum = Number(cur.replace(/,/g, ''));
      const prev = lastSuggestRef.current[nm];
      const mine = cur === '' || (el.dataset.auto !== undefined && cur === el.dataset.auto)
        || (prev != null && curNum === prev);
      if (typeof v === 'number' && v > 0 && mine && curNum !== v) {
        el.value = String(v); el.dataset.auto = String(v); touched = true;
      }
      lastSuggestRef.current[nm] = typeof v === 'number' ? v : null;
    }
    if (touched) recalcSums();
  }, [pay?.suggest, previewing, recalcSums]);

  /**
   * โหลดเคสใหม่ (onReviewSubmitted) แล้ว rev ที่ถืออยู่ต้องเดินตามด้วย
   * ไม่งั้นหลังกดโหลดใหม่จะยังส่ง rev เก่าไป = ชนซ้ำวนไปเรื่อย ๆ แก้อะไรไม่ได้เลย
   */
  useEffect(() => {
    if (typeof report?.rev === 'number') setRev(report.rev);
  }, [report?.rev]);

  /**
   * ── เตือนแต่เนิ่น ๆ ว่ามีคนอื่นแตะเคสนี้ ──
   * ด่านกันบันทึกทับ (rev) ทำงานตอน "กดบันทึก" ซึ่งอาจเป็นหลังพิมพ์ไปแล้วครึ่งชั่วโมง
   * สัญญาณนี้บอกตั้งแต่วินาทีที่อีกฝ่ายบันทึก จะได้ตัดสินใจก่อนลงแรงต่อ
   *
   * ⛔ ห้ามโหลดข้อมูลใหม่ให้เอง — ของที่พิมพ์ค้างอยู่จะหายโดยไม่ได้ถาม
   *    (ใช้แถบเดียวกับตอนบันทึกชน ซึ่งมีปุ่มให้คนเลือกเองอยู่แล้ว)
   */
  useEffect(() => {
    if (!socket) return;
    const onChange = (p: { case_id?: number; by?: number | null }) => {
      if (Number(p?.case_id) !== Number(caseData.id)) return;
      // สัญญาณที่เกิดจากการบันทึกของตัวเอง ไม่ต้องเตือนตัวเอง
      if (p?.by != null && user?.id != null && Number(p.by) === Number(user.id)) return;
      setConflict('มีคนอื่นเพิ่งบันทึกเคสนี้ระหว่างที่คุณเปิดอยู่ — '
        + 'ถ้าบันทึกทับตอนนี้ งานของอีกฝ่ายจะหายทั้งหมด '
        + 'กด "โหลดข้อมูลล่าสุด" ก่อนแก้ต่อ (สิ่งที่พิมพ์ค้างไว้จะหาย จดไว้ก่อนถ้าจำเป็น)');
    };
    socket.on('case_changed', onChange);
    return () => { socket.off('case_changed', onChange); };
  }, [socket, caseData.id, user?.id]);

  /**
   * ── กันออกจากหน้าทั้งที่ยังไม่ได้บันทึก ── (03/09/69)
   *
   * หน้านี้กรอกกันทีละ 10-20 นาที แต่เดิมเตือนเฉพาะตอนสลับ "ครั้งที่" เท่านั้น
   * ปิดแท็บ / รีเฟรช / กดปุ่ม "← กลับ" = สิ่งที่พิมพ์ค้างหายเงียบโดยไม่มีอะไรถาม
   *
   * ⛔ นับว่าค้างเมื่อมี input/change จริงเท่านั้น — ห้ามตั้ง true ตอนเปิดหน้า
   *    ไม่งั้นเปิดดูเฉย ๆ แล้วปิดก็โดนถาม จนคนชินแล้วกดผ่านทุกครั้ง
   * ⛔ เบราว์เซอร์โชว์ข้อความมาตรฐานของตัวเอง กำหนดข้อความเองไม่ได้ (ตั้งแต่ Chrome 51)
   *    ส่วนปุ่มกลับใน page.tsx ใช้ confirmLeaveIfDirty ซึ่งมีข้อความของเรา
   */
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const touch = () => {
      if (dirtyRef.current) return;
      dirtyRef.current = true;
      setFormDirty(true);
    };
    const warn = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    form.addEventListener('input', touch);
    form.addEventListener('change', touch);
    window.addEventListener('beforeunload', warn);
    return () => {
      form.removeEventListener('input', touch);
      form.removeEventListener('change', touch);
      window.removeEventListener('beforeunload', warn);
      setFormDirty(false);   // ออกจากหน้าแล้วธงต้องไม่ค้างไปหน้าถัดไป
    };
  }, []);

  /**
   * บันทึกฟอร์ม — `extra` ทับค่าในชุดข้อมูลได้ (ใช้ตอนอนุมัติ: ใส่ checklist.image_photo_id ของรูปที่เพิ่งสร้าง
   * ให้ไปกับการบันทึกครั้งเดียวกัน — บันทึก 2 รอบติดกันไม่ได้ เพราะ base_rev ใน closure ยังเป็นรุ่นเก่า)
   */
  const saveWith = async (extra: Record<string, unknown> = {}): Promise<boolean> => {
    if (!formRef.current) return false;
    /**
     * ⛔ ด่านสุดท้ายกันเขียนข้ามเคส — ระหว่างดู "ครั้งที่" อื่น ช่องในรางขวาถูก disabled
     *    ซึ่งแปลว่ามันจะ **ไม่ถูกส่งไปเลย** ตอนกดบันทึก · survey_pay บันทึกทั้งแถว
     *    ยอดของเคสที่เปิดอยู่จะกลายเป็นค่าว่างยกแถวโดยไม่มีอะไรฟ้อง
     *    (ปุ่มถูก disable อยู่แล้ว อันนี้กันไว้อีกชั้นเผื่อกดจากทางอื่น)
     */
    if (previewing) {
      setSaveMsg('บันทึกไม่ได้ — กำลังดูครั้งอื่นอยู่ กลับไปครั้งของเคสนี้ก่อน');
      return false;
    }
    setSaving(true); setSaveMsg('');
    try {
      const fd = new FormData(formRef.current);
      const data: Record<string, string> = {};
      fd.forEach((val, key) => { data[key] = val as string; });
      // ป้าย placeholder ของ <select> ที่ยังไม่เลือก (เช่น acc_surveyor_branch/car_color/acc_province)
      // ห้ามบันทึกเป็นค่าจริง — เคยหลุดเข้า DB → รหัสจังหวัดใน XML ที่ส่ง EMCS ว่าง
      const SENTINELS = new Set(['-- ระบุ --', '-- เลือก --', '-- เขต --']);
      for (const k of Object.keys(data)) if (SENTINELS.has((data[k] ?? '').trim())) data[k] = '';
      // acc_claim_opponent + car_lost อยู่ในส่วนที่ disabled ตอน read-only → ไม่อยู่ใน FormData
      // เขียนเฉพาะตอนกดแก้ไขจริง ไม่งั้นบันทึก (หรืออนุมัติ) จะทับเป็น ''/false = ข้อมูลหายเงียบ
      if (isEditing) {
        const opponents = fd.getAll('acc_claim_opponent').map(v => String(v));
        data['acc_claim_opponent'] = opponents.join(',');
        data['car_lost'] = fd.has('car_lost') ? 'true' : 'false';
      }
      // ตัด comma ออกจากคอลัมน์ตัวเลข (เช่น mileage แสดงแบบ 12,345) กัน 500 invalid input for integer
      const numericCols = ['mileage', 'estimated_cost', 'deductible', 'acc_claim_amount', 'acc_claim_total_amount', 'driver_age'];
      for (const k of numericCols) if (typeof data[k] === 'string') data[k] = data[k].replace(/,/g, '');
      const payload: Record<string, unknown> = { ...data };
      if (isEditing) {
        // ทิ้งแถวที่ยังกรอกไม่ครบ — ส่งไปก็ตกที่ EMCS อยู่ดี และทำให้บอทนับรายการเพี้ยน
        payload.insured_damage = damage.filter((x) => x.part && x.level);
        payload.injured_persons = dropEmptyRecords(injured);
        payload.damaged_property = dropEmptyRecords(property);
        payload.opposing_parties = dropEmptyOpponents(opponents);
        payload.checklist = checklist;
      }
      Object.assign(payload, extra);
      // ยอดจ่ายพนักงานอยู่คนละตาราง (survey_pay) → ส่งแยก
      // ยิงก่อนบันทึกรายงาน เพื่อให้ถ้าพังจะพังทั้งคู่ ไม่เหลือสถานะครึ่ง ๆ
      // ยอดทุกช่องส่งเหมือนกันหมดทุกที่มาของงาน — ที่มาไม่ใช่ตัวตัดสินว่ากรอกได้ไหมอีกแล้ว
      if (isEditing) {
        const payBody: Record<string, unknown> = {
          deduct_fee: String(data['pay_deduct_fee'] ?? '').replace(/,/g, '') || null,
          deduct_late: fd.has('deduct_late'),
          deduct_docs: fd.has('deduct_docs'),
          deduct_reason: data['deduct_reason'] || null,
          other_reason: data['other_fee_detail'] ?? null,
          daily_check: (data['daily_check'] || '') || null,
          // พื้นที่/ประเภทเคลมที่กำลังบันทึก — ให้ snapshot เรทคิดจากรอบนี้ (ยอดเงินยิงก่อนรายงาน)
          acc_province: data['acc_province'] ?? null, acc_district: data['acc_district'] ?? null,
          acc_subdistrict: data['acc_subdistrict'] ?? null, claim_type: data['claim_type'] ?? null,
          // สถานที่ออกตรวจสอบ — มีจังหวัด = backend ใช้ชุดนี้หาเรทแทนสถานที่เกิดเหตุ (09/09/69)
          survey_province: data['survey_province'] ?? null, survey_district: data['survey_district'] ?? null,
          survey_subdistrict: data['survey_subdistrict'] ?? null,
        };
        for (const k of Object.keys(data)) {
          if (k.startsWith('pay_')) payBody[k.slice(4)] = data[k].replace(/,/g, '') || null;
        }
        for (const f of ['out_of_area', 'out_of_hours']) payBody[f] = fd.has(f);
        /**
         * ⛔ ตำบลพิเศษถอดช่องออกจากการ์ดค่าใช้จ่ายแล้ว (user ขอ 01/09/69 — จะย้ายไปหมวด
         *    สถานที่เกิดเหตุ) แต่คอลัมน์ยังอยู่ → ต้องส่ง**ค่าเดิม**กลับไป
         *    ใช้ fd.has() ตรง ๆ ไม่ได้ ไม่มีช่องในฟอร์มก็ได้ false เสมอ แล้ว survey_pay
         *    เป็น upsert ทั้งแถว = ค่าที่เคยติ๊กไว้ถูกล้างเงียบ ๆ ตอนบันทึกครั้งถัดไป
         */
        payBody.special_tumbon = fd.has('special_tumbon') || Boolean(pay?.saved?.special_tumbon);
        /**
         * ยอดนอกพื้นที่/นอกเวลาที่กรอกเอง — ว่างไว้ = null แล้ว backend ใช้ค่าตั้งต้น 50/100
         * ⛔ ต้องส่งทุกครั้ง (แม้ค่าว่าง) เพราะ survey_pay เป็น upsert ทั้งแถว —
         *    ไม่ส่ง = คอลัมน์ถูกเขียนทับเป็น null ยอดที่เคยกรอกเองหายเงียบ
         */
        for (const f of ['out_of_area_amt', 'out_of_hours_amt']) {
          payBody[f] = String(data[f] ?? '').replace(/,/g, '').trim() || null;
        }
        // ⛔ ไม่บังคับให้ระบุเหตุผลตอนหักเงิน (user เคาะ 17/08/69) — เดิมบล็อกการบันทึกทั้งหน้า
        // เคสที่ไม่มีใครแตะยอดเลย ไม่ต้องยิง — กันไม่ให้เกิดแถว survey_pay เปล่าทุกครั้งที่กดบันทึก
        // แต่ถ้าเคยมีแถวอยู่แล้วต้องยิงเสมอ ไม่งั้นลบยอดที่กรอกผิดไว้ไม่ได้
        const anyVal = (o: Record<string, unknown> | null | undefined) =>
          Boolean(o) && Object.values(o as Record<string, unknown>)
            .some((v) => v !== null && v !== '' && v !== false && v !== undefined);
        if (anyVal(payBody) || pay?.saved) {
          // base_rev = เลขรุ่นเดียวกับที่ส่งให้ /report — ฝั่งยอดเงินตรวจอย่างเดียว ไม่บวก rev
          const pr = await api.put(`/api/cases/${caseData.id}/pay`, { ...payBody, base_rev: rev });
          if (pr.data?.success) setPay((prev: PayData | null) => (prev ? { ...prev, saved: pr.data.data } : prev));
        }
      }
      const res = await api.put(`/api/cases/${caseData.id}/report`,
        { report_data: payload, base_rev: rev });
      if (res.data.success) {
        // เก็บ rev ใหม่ทันที ไม่งั้นกดบันทึกซ้ำจะเด้ง "มีคนบันทึกคั่น" ใส่ตัวเอง
        if (typeof res.data.data?.rev === 'number') setRev(res.data.data.rev);
        /**
         * บันทึกแล้วประวัติยอดเงินเปลี่ยนแน่นอน — ต้องทิ้งของที่โหลดไว้
         * ไม่งั้นกางแผงดูจะเห็นภาพก่อนบันทึก แล้วนึกว่าระบบไม่ได้เก็บ (เจอจริง 24/08/69)
         * กางอยู่ = โหลดใหม่ทันที · ปิดอยู่ = ล้างทิ้ง ค่อยโหลดตอนกางครั้งหน้า
         */
        if (auditOpen) loadAudit(); else setAudit(null);
        // บันทึกแล้วไม่มีอะไรค้าง — ปิดกล่องถามตอนออกจากหน้า
        dirtyRef.current = false; setFormDirty(false);
        setSaveMsg('บันทึกสำเร็จ'); onReviewSubmitted(); setTimeout(() => setSaveMsg(''), 3000); return true;
      }
      setSaveMsg('บันทึกไม่สำเร็จ: ' + (res.data.message || '')); return false;
    } catch (e) {
      /**
       * เดิม catch เปล่า ๆ แล้วขึ้น "เกิดข้อผิดพลาดในการบันทึก" ทุกกรณี — ข้อความจริง
       * จากเซิร์ฟเวอร์ (เช่น ชนกับคนอื่น / เลขเซอร์เวย์ซ้ำ) ถูกกลืนหายไปหมด
       */
      const err = e as { response?: { status?: number; data?: { message?: string } } };
      const msg = err.response?.data?.message || 'เกิดข้อผิดพลาดในการบันทึก';
      /**
       * ชนกัน = ขึ้นแถบเต็มความกว้างอย่างเดียว **ห้ามใส่ป้ายเล็กในแถบปุ่มด้วย**
       * ข้อความนี้ยาวหลายบรรทัด ใส่ 2 ที่แล้วแถบหัวเคสถูกดันจนปุ่มบันทึก/อนุมัติเบียดกัน
       * (เห็นจริงตอนทดสอบบนเว็บจริง 23/08/69)
       */
      if (err.response?.status === 409) { setConflict(msg); setSaveMsg(''); }
      else setSaveMsg(msg);
      return false;
    }
    finally { setSaving(false); }
  };
  const handleSave = () => saveWith();

  /**
   * แถบปุ่ม — เดิมอยู่ท้ายหน้า ต้องเลื่อนผ่าน ~200 ช่องกว่าจะถึง
   * ตอนนี้ย้ายไปอยู่ในแถบหัวเคสที่ติดขอบบน กดบันทึกได้จากทุกจุดของหน้า
   * ⛔ ต้องอยู่ **นอก** <fieldset disabled> ไม่งั้นตอนล็อกจะกดปลดล็อกไม่ได้
   */
  /** ส่ง/ส่งซ้ำเข้า se-billing — ปุ่มโผล่เมื่อยังไม่มีแถว (อนุมัติก่อนมีท่อ) หรือรอบก่อนส่งไม่สำเร็จ */
  const resendBilling = async () => {
    setSaving(true); setSaveMsg('');
    try {
      const r = await api.post(`/api/cases/${caseData.id}/billing-capture`, {});
      const b = r.data?.data as BillingResult;
      setSaveMsg(b?.ok ? `ส่งเข้า se-billing แล้ว (#${b.id})` : `ส่งเข้า se-billing ไม่สำเร็จ: ${b?.error || 'เกิดข้อผิดพลาด'}`);
      onReviewSubmitted();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setSaveMsg('ส่งเข้า se-billing ไม่สำเร็จ: ' + (msg || 'เกิดข้อผิดพลาด'));
    } finally { setSaving(false); }
  };

  /**
   * ปิดงานบน ISURVEY แทนหัวหน้า (กด "ยืนยันการตรวจสอบ" → จบงาน) — เฉพาะเคสที่ดึงจาก ISURVEY, อนุมัติแล้ว (08/09/69)
   * ปกติระบบยิงให้เองตอนอนุมัติ ปุ่มนี้ไว้ลองใหม่/สั่งเองสำหรับเคสที่อนุมัติก่อนมีระบบ · server ตัดสินว่าเป็นโหมดทดลองหรือยิงจริง
   */
  const closeIsurvey = async () => {
    setSaving(true); setSaveMsg('');
    try {
      const r = await api.post(`/api/cases/${caseData.id}/isurvey-close`, {});
      const d = r.data?.data as { live?: boolean; dry_run?: boolean; message?: string; skipped?: string;
                                  summary?: { fields?: number; comment_len?: number; ins_total?: string; sur_total?: string } };
      if (d?.skipped === 'already') setSaveMsg('งานนี้ปิดบน ISURVEY ไปแล้ว');
      else if (d?.skipped === 'already_closed') setSaveMsg(d?.message || 'งานนี้ปิดบน ISURVEY ไปก่อนแล้ว (หัวหน้าปิดมือ) — จดสถานะให้แล้ว');
      else if (d?.dry_run) setSaveMsg(`ISURVEY โหมดทดลอง: ประกอบคำสั่ง ${d.summary?.fields ?? '?'} ช่อง (ความเห็น ${d.summary?.comment_len ?? 0} ตัวอักษร · ประกัน ${d.summary?.ins_total ?? '-'} · พนักงาน ${d.summary?.sur_total ?? '-'}) — ยังไม่ยิงจริง`);
      else setSaveMsg(`ปิดงานบน ISURVEY แล้ว — ${d?.message ?? 'สำเร็จ'}`);
      onReviewSubmitted();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setSaveMsg('ปิดงาน ISURVEY ไม่สำเร็จ: ' + (msg || 'เกิดข้อผิดพลาด'));
      onReviewSubmitted();   // ป้าย error ถูกจดไว้ที่เคสแล้ว — โหลดใหม่ให้เห็น
    } finally { setSaving(false); }
  };
  const fromIsurvey = String(caseData?.source ?? '').startsWith('isurvey');
  /**
   * วาดรายการตรวจสอบเป็นรูปแล้วเก็บเข้าหมวด "รูปรถประกัน" (ไหลเข้า EMCS ทางท่อรูป)
   * คืน: undefined = ไม่ได้ติ๊กอะไร ไม่สร้าง · Checklist ใหม่ (มี image_photo_id) = สำเร็จ · null = ล้มเหลว
   * อนุมัติซ้ำหลังปลดล็อก: ลบรูปเดิมตาม id ที่จำไว้ก่อน แล้วสร้างใหม่ — ไม่งั้น EMCS ได้รูปซ้ำ
   */
  const prepareChecklistImage = async (): Promise<Checklist | null | undefined> => {
    if (!checklistHasAny(checklist)) return undefined;
    try {
      const claim = String(report?.claim_no ?? '');
      const d = new Date();
      const footer = `รายการตรวจสอบ · เคลม ${claim} · ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543}`;
      const blob = await renderChecklistPng(checklist, footer);
      const oldId = checklist.image_photo_id;
      if (oldId && (photos ?? []).some((x: { id: number }) => Number(x.id) === Number(oldId))) {
        await api.delete(`/api/cases/${caseData.id}/photos/${oldId}`);
      }
      const fd = new FormData();
      fd.append('photos', blob, `checklist_${caseData.id}.png`);
      fd.append('category', 'รูปรถประกัน');
      // ⛔ ต้องบอก multipart เอง — api instance ตั้ง Content-Type: application/json เป็นค่าเริ่มต้น
      //    ไม่งั้น FormData ถูกส่งแบบไม่มี boundary → server มองไม่เห็นไฟล์ "กรุณาเลือกรูปอย่างน้อย 1 ไฟล์" (เจอจริง 08/09/69 เคลม 2026013074059)
      const r = await api.post(`/api/cases/${caseData.id}/photos`, fd,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
      const newId = Number(r.data?.data?.ids?.[0]) || null;
      const next = { ...checklist, image_photo_id: newId };
      setChecklist(next);
      return next;
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message || (e as Error)?.message;
      setSaveMsg('สร้างรูปรายการตรวจสอบไม่สำเร็จ: ' + (msg || 'เกิดข้อผิดพลาด') + ' — ยังไม่อนุมัติ');
      return null;
    }
  };
  const bkk16 = (v: unknown) => (v ? new Date(String(v)).toLocaleString('th-TH', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '');

  const actionBar = approved ? (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 whitespace-nowrap">อนุมัติแล้ว · ล็อก</span>
      <span className="text-xs text-gray-600 hidden lg:inline">
        {review?.checker_name ? `โดย ${review.checker_name}` : ''}
        {review?.reviewed_at ? ` · ${String(review.reviewed_at).slice(0, 16).replace('T', ' ')}` : ''}
      </span>
      {/* ท่อ se-billing (/captures) — แถวของเคสนี้ไปถึงบัญชีหรือยัง + ปุ่มส่ง/ส่งซ้ำ (03/09/69) */}
      {caseData.billing_error ? (
        <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 max-w-[22rem] truncate"
          title={String(caseData.billing_error)}>se-billing ✗ {String(caseData.billing_error)}</span>
      ) : caseData.billing_capture_id ? (
        <a href={SEBILLING_CAPTURES_URL} target="_blank" rel="noreferrer"
          className="text-xs text-green-700 hover:underline whitespace-nowrap"
          title={caseData.billing_sent_at ? `ส่งเมื่อ ${String(caseData.billing_sent_at).slice(0, 16).replace('T', ' ')}` : ''}>
          se-billing ✓ #{caseData.billing_capture_id}
        </a>
      ) : (
        <span className="text-xs text-gray-500 whitespace-nowrap">ยังไม่ได้ส่งเข้า se-billing</span>
      )}
      {/* ปุ่มมีเสมอ — ส่งซ้ำ = แทนที่แถวเดิม (ไม่ซ้ำ) ไว้ซิงก์ใหม่หลังแก้บั๊กหรือข้อมูลบัญชี */}
      <button type="button" disabled={saving} onClick={resendBilling}
        title={caseData.billing_capture_id && !caseData.billing_error ? 'ส่งแถวใหม่แทนที่แถวเดิมใน se-billing' : ''}
        className="px-3 py-1 border border-gray-300 bg-white text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
        {caseData.billing_capture_id && !caseData.billing_error ? 'ส่งซ้ำ se-billing' : 'ส่งเข้า se-billing'}
      </button>
      {/* เขียนกลับ ISURVEY — ระบบกด "ยืนยันการตรวจสอบ" (ปิดงาน → จบงาน) แทนหัวหน้าตอนอนุมัติ (08/09/69) · เฉพาะเคสที่ดึงจาก ISURVEY */}
      {fromIsurvey && (
        <>
          {caseData.isurvey_close_error ? (
            <span className="text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 max-w-[22rem] truncate"
              title={String(caseData.isurvey_close_error)}>ISURVEY ✗ {String(caseData.isurvey_close_error)}</span>
          ) : caseData.isurvey_closed_at ? (
            <span className="text-xs text-green-700 whitespace-nowrap"
              title={`ปิดงานบน ISURVEY (จบงาน) เมื่อ ${bkk16(caseData.isurvey_closed_at)}`}>
              ISURVEY ✓ ปิดงานแล้ว {bkk16(caseData.isurvey_closed_at)}
            </span>
          ) : caseData.isurvey_close_dry_at ? (
            <span className="text-xs text-amber-700 whitespace-nowrap"
              title={`โหมดทดลอง ${bkk16(caseData.isurvey_close_dry_at)}: ประกอบคำสั่งปิดงานแล้วแต่ยังไม่ยิงจริง (รอเปิดใช้)`}>
              ISURVEY (ทดลอง) เตรียมคำสั่งแล้ว
            </span>
          ) : (
            <span className="text-xs text-gray-500 whitespace-nowrap">ยังไม่ได้ปิดงานบน ISURVEY</span>
          )}
          <button type="button" disabled={saving} onClick={closeIsurvey}
            title="กด &quot;ยืนยันการตรวจสอบ&quot; บน ISURVEY แทนหัวหน้า ด้วยบัญชี ISURVEY ของคุณ — ปกติระบบทำให้เองตอนอนุมัติ"
            className="px-3 py-1 border border-gray-300 bg-white text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap">
            {caseData.isurvey_closed_at ? 'ปิดงาน ISURVEY อีกครั้ง' : caseData.isurvey_close_error ? 'ลองปิดงาน ISURVEY ใหม่' : 'ปิดงานบน ISURVEY'}
          </button>
        </>
      )}
      {isAdmin ? (
        <button type="button" disabled={saving} onClick={async () => {
          // ปลดล็อกแล้วต้องอนุมัติใหม่ — ถามก่อนเพราะเป็นการถอนลายเซ็นของคนอื่น
          if (!window.confirm('ปลดล็อกเคสนี้ให้กลับไปแก้ได้?\nผู้ตรวจจะต้องกดอนุมัติใหม่อีกครั้ง')) return;
          setSaving(true); setSaveMsg('');
          try {
            await api.post(`/api/cases/${caseData.id}/unlock`, {});
            setSaveMsg('ปลดล็อกสำเร็จ');
            onReviewSubmitted();
          } catch (e) {
            const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
            setSaveMsg('ปลดล็อกไม่สำเร็จ: ' + (msg || 'เกิดข้อผิดพลาด'));
          } finally { setSaving(false); }
        }} className="px-4 py-1.5 bg-amber-600 text-white rounded-none text-sm font-medium hover:bg-amber-700 disabled:bg-amber-300 disabled:cursor-not-allowed transition">
          ปลดล็อก
        </button>
      ) : (
        <span className="text-xs text-gray-500">ต้องให้แอดมินปลดล็อกก่อน</span>
      )}
    </div>
  ) : (
    // ทุกช่องพิมพ์ได้ตลอด จึงไม่มีปุ่ม "แก้ไขทั้งหมด" / "ยกเลิก" อีกแล้ว
    <div className="flex items-center gap-2">
      {approvalBlockers.length > 0 && (
        <span title={approvalBlockers.join('\n')} className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-none px-2 py-1 whitespace-nowrap">
          ยังอนุมัติไม่ได้ {approvalBlockers.length} ข้อ
        </span>
      )}
      {/* ตีกลับให้ผู้สำรวจ — วางไว้ซ้ายสุดของแถบ ไกลจาก "อนุมัติ" ที่อยู่ขวาสุด
          และเป็นปุ่มขอบบาง ๆ ไม่ใช่ปุ่มทึบ เพราะเป็นการโยนงานออกจากมือ ไม่ใช่ทางลัดประจำวัน
          กดแล้วช่องเหตุผลจะกางออกใต้แถบ (ไม่ได้ตีกลับทันที) */}
      {!waitingSurveyor && !finishedWaiting && (
        <button type="button" onClick={() => setSbOpen(true)} disabled={saving || previewing}
          className="h-9 px-4 border border-[var(--md-purple)] text-[var(--md-purple)] bg-white text-sm font-bold hover:bg-[#f7effe] disabled:opacity-50 disabled:cursor-not-allowed transition">
          ตีกลับผู้สำรวจ
        </button>
      )}
      {/* "บันทึกร่าง" ตามดีไซน์ — ตรงความจริงด้วย: บันทึกแล้วเคสยังไม่ถูกส่งไปไหน */}
      <button type="button" onClick={handleSave} disabled={saving || previewing}
        title={previewing ? 'กำลังดูครั้งอื่น — กลับไปครั้งของเคสนี้ก่อน' : ''} className="h-9 px-4 border border-[#2eb593] bg-[var(--md-green)] text-white text-sm font-bold hover:brightness-105 disabled:opacity-40 disabled:cursor-not-allowed transition">
        {saving ? 'กำลังบันทึก...' : 'บันทึกร่าง'}
      </button>
      <button type="button" onClick={async () => {
        // กันไว้อีกชั้นเผื่อสถานะยังไม่ทันอัปเดต (ปุ่มถูก disable อยู่แล้วตามปกติ)
        if (approvalBlockers.length > 0) {
          setSaveMsg('อนุมัติไม่ได้ — ' + approvalBlockers.join(' · '));
          return;
        }
        // อนุมัติ = ล็อกเคส ถอยเองไม่ได้ ต้องให้แอดมินปลด — ถามก่อนเสมอ
        if (!window.confirm('อนุมัติเคสนี้?\nอนุมัติแล้วจะล็อก แก้เองไม่ได้ ต้องให้แอดมินปลดล็อก\nและบอทจะยกเคสนี้เข้า EMCS')) return;
        // รูป "รายการตรวจสอบ" → หมวดรูปรถประกัน (user ขอ 08/09/69) — ต้องทำก่อนอนุมัติ เพราะอนุมัติแล้วเพิ่มรูปไม่ได้ (423)
        const chk = await prepareChecklistImage();
        if (chk === null) return;   // ล้มเหลว (ขึ้นข้อความแล้ว) — ไม่อนุมัติทั้งที่สำนวนขาดรูป
        const ok = await saveWith(chk ? { checklist: chk } : {});
        if (!ok) return; // บันทึกไม่ผ่าน → อย่าอนุมัติทับด้วยข้อมูลเก่า
        try {
          const r = await api.post(`/api/cases/${caseData.id}/review`, {});
          setSaveMsg('อนุมัติสำเร็จ' + billingNote(r.data?.data?.billing));
          onReviewSubmitted();
        } catch (e) {
          const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
          setSaveMsg('อนุมัติไม่สำเร็จ: ' + (msg || 'เกิดข้อผิดพลาด'));
        }
      }} disabled={saving || previewing || approvalBlockers.length > 0}
        title={approvalBlockers.length > 0 ? 'อนุมัติไม่ได้ — ' + approvalBlockers.join(' · ') : ''}
        className="h-9 px-5 border border-[var(--md-blue)] bg-[var(--md-blue)] text-white text-sm font-bold hover:bg-[var(--md-blue-hover)] hover:border-[var(--md-blue-hover)] disabled:opacity-40 disabled:cursor-not-allowed transition">
        อนุมัติ
      </button>
    </div>
  );

  /** นับรูปแยกหมวด — ป้ายเดียวกับที่ PhotoGallery จัดกลุ่ม (ไม่ระบุหมวด = โหลดมาจากภายนอก) */
  const photoCats = (() => {
    const m = new Map<string, number>();
    for (const p of photos ?? []) {
      const c = (p as { category?: string | null })?.category?.trim() || 'ไม่ระบุหมวด';
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return Array.from(m, ([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
  })();

  /** ป้ายบอกที่มาของงาน — ชุดเดียวกับหน้ารายการงาน กติกาเงินต่างกันตามที่มา */
  const SRC_BADGE: Record<string, { t: string; c: string }> = {
    mobile: { t: 'แอปมือถือ', c: 'border-emerald-600 text-emerald-800' },
    isurvey_live: { t: 'ระบบเก่า (สด)', c: 'border-sky-600 text-sky-800' },
    isurvey_xml: { t: 'ไฟล์ XML', c: 'border-violet-600 text-violet-800' },
    emcs_extract: { t: 'ดึงจาก EMCS', c: 'border-slate-500 text-slate-700' },
  };
  const src = SRC_BADGE[String(caseData?.source ?? 'mobile')]
    ?? { t: String(caseData?.source ?? '-'), c: 'border-[var(--md-line-2)] text-[var(--md-muted-2)]' };

  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="md-fields space-y-4">
      {/* ── แถบหัวเคส (ติดขอบบน) ── ตัวระบุเคส + สถานะ + ปุ่ม อยู่ครบในบรรทัดเดียว
          หน้านี้ยาวมาก เลื่อนไปไหนก็ยังเห็นว่ากำลังตรวจเคลมไหน และกดบันทึกได้ทันที */}
      <div className="sticky top-0 z-20 -mx-1 px-1 pt-1 pb-2 bg-[var(--md-bg)]/95 backdrop-blur-sm">
        {/* แถบดำหนาริมซ้าย = ที่หมายว่าแถบนี้คือ "หัวเรื่อง" ไม่ใช่การ์ดข้อมูลอีกใบ (แบบ Modernist) */}
        <div className="bg-white border border-[var(--md-line)] border-l-[6px] border-l-[var(--md-ink)] px-4 py-2.5 flex flex-wrap items-center gap-x-7 gap-y-2">
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[0.6875rem] font-bold tracking-[0.06em] text-[var(--md-muted)] shrink-0">เคลม</span>
            <span className="text-base font-extrabold text-[var(--md-blue-strong)] truncate">{report?.claim_no || '—'}</span>
          </div>
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[0.6875rem] font-bold tracking-[0.06em] text-[var(--md-muted)] shrink-0">เซอร์เวย์</span>
            <span className="text-[0.9375rem] font-bold text-[var(--md-ink)] truncate">{report?.survey_job_no || '—'}</span>
          </div>
          <span className="text-sm font-semibold text-[var(--md-muted-2)] truncate hidden md:inline">{report?.insurance_company || '—'}</span>
          <span className={`px-2 py-[0.1875rem] border text-[0.6875rem] font-bold tracking-[0.04em] shrink-0 ${src.c}`}>{src.t}</span>
          <div className="ml-auto flex items-center gap-3">
            {saveMsg && (
              <span className={`px-3 py-1 rounded-none text-xs ${saveMsg.includes('สำเร็จ') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{saveMsg}</span>
            )}
            {actionBar}
          </div>

          {/**
            * ชนกับหัวหน้าอีกคน — ต้องค้างไว้จนกว่าจะตัดสินใจ ไม่ใช่ข้อความเล็ก ๆ ที่หายเอง
            * ⛔ ห้ามโหลดใหม่ให้อัตโนมัติ — สิ่งที่พิมพ์ค้างอยู่จะหายทั้งหมด
            *    ต้องให้คนอ่านก่อนว่าใครบันทึกคั่น แล้วเลือกเองว่าจะทิ้งของตัวเองไหม
            */}
          {conflict && (
            <div className="w-full border-t border-red-200 pt-2 flex flex-wrap items-center gap-3">
              <span className="text-lg leading-none shrink-0">⚠️</span>
              <span className="flex-1 min-w-[17.5rem] text-sm text-red-800">{conflict}</span>
              <button type="button"
                onClick={() => {
                  if (!window.confirm('โหลดข้อมูลล่าสุด?\nสิ่งที่คุณพิมพ์ค้างไว้ในหน้านี้จะหายทั้งหมด\nถ้ายังไม่อยากให้หาย ให้จดค่าที่แก้ไว้ก่อน แล้วค่อยกด')) return;
                  setConflict(''); setSaveMsg(''); onReviewSubmitted();
                }}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-none hover:bg-red-700 shrink-0">
                โหลดข้อมูลล่าสุด
              </button>
              <button type="button" onClick={() => setConflict('')}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-none hover:bg-[var(--md-tint)] shrink-0">
                ปิดข้อความ
              </button>
            </div>
          )}

          {/* ⛔ ช่องเหตุผล **ไม่มี name** — อยู่ใน <form> เดียวกับฟอร์มหลัก มี name เมื่อไหร่
              จะโดน FormData เก็บไปเป็นค่าของรายงานตอนกดบันทึก */}
          {sbOpen && !approved && (
            <div className="w-full border-t border-[var(--md-line)] pt-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-orange-900 shrink-0">ตีกลับ — ให้ช่างแก้อะไร</span>
              <input type="text" value={sbReason} onChange={(e) => setSbReason(e.target.value)}
                placeholder="เช่น ทะเบียนในรูปไม่ตรงกับที่กรอกมา / ขาดรูปความเสียหายฝั่งซ้าย"
                className="flex-1 min-w-[15rem] border border-orange-300 rounded-none px-2 py-1 text-sm bg-white text-gray-800" />
              <span className="text-xs text-orange-800 shrink-0">
                บันทึกให้ก่อน แล้วสถานะกลับเป็น &quot;กำลังสำรวจ&quot;
              </span>
              <button type="button" onClick={() => { setSbOpen(false); setSbReason(''); }}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-none hover:bg-[var(--md-tint)]">
                ยกเลิก
              </button>
              <button type="button" onClick={doSendBack} disabled={saving || !sbReason.trim()}
                className="px-4 py-1.5 bg-orange-600 text-white rounded-none text-sm font-medium hover:bg-orange-700 disabled:bg-orange-300 disabled:cursor-not-allowed">
                {saving ? 'กำลังตีกลับ...' : 'บันทึกแล้วตีกลับ'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* อนุมัติแล้ว = ปิดทั้งชุดด้วย <fieldset disabled> — ครอบทุกช่องในหน้าทีเดียว
          ไม่ต้องไล่ใส่ disabled ทีละช่อง (มี ~200 ช่อง พลาดช่องเดียวก็รั่ว)
          แถบปุ่มอยู่ *นอก* fieldset เพื่อให้แอดมินยังกด "ปลดล็อก" ได้ตอนถูกล็อก */}
      <fieldset disabled={approved} className="min-w-0 border-0 p-0 m-0">
      {/* ── จอกว้าง (≥ 1500px) = 2 คอลัมน์ ── ค่าใช้จ่ายย้ายไปคอลัมน์ขวา
          หน้านี้ยาวมาก เดิมกรอกยอดทีต้องเลื่อนลงล่างสุดทุกครั้ง แล้วเลื่อนกลับขึ้นมาดูข้อมูล
          จอแคบกว่านั้นกลับไปเรียงลงล่างแบบเดิมเอง (grid-cols-1) — ไม่มีอะไรหายไปจากหน้า
          คอลัมน์ซ้ายต้องมี min-w-0 ไม่งั้นตารางในนั้นดันคอลัมน์ให้กว้างเกิน 1fr */}
      <div className="grid grid-cols-1 min-[1500px]:grid-cols-[minmax(0,1fr)_clamp(440px,30%,580px)] gap-5 items-start">
      <div className="min-w-0 space-y-5">
      {report && (
        <>
          {/* คำอธิบายดอกจัน — จุดแดงชุดเดียวกับที่ผู้สำรวจเห็นบนแอป (อิงตัวตรวจของระบบประกัน) */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500">
            <span><span className="text-red-500">*</span> ช่องบังคับของระบบประกัน — เว้นว่างแล้วส่งงานเข้าระบบประกันไม่ผ่าน</span>
            <span><span className="text-amber-500">*</span> บังคับเฉพาะบางกรณี (ชี้เมาส์ที่ดอกจันเพื่อดูเงื่อนไข)</span>
            <span className="text-gray-400">ช่องบังคับที่ยังว่างจะขึ้นกรอบแดง</span>
          </div>

          {/* สรุปจำนวนช่องที่ยังขาด — กรอบแดงรายช่องอาจอยู่คนละหมวดห่างกันคนละหน้าจอ
              ถ้าไม่สรุปไว้บนสุด ผู้ตรวจต้องเลื่อนหาเอง แล้วไปเจอตอนบอทนำเข้าไม่ผ่าน */}
          {/* ลำดับเวลาผิด — ต่างจากช่องว่างตรงที่ "มองด้วยตาไม่เห็น" แต่ละช่องดูปกติหมด
              ต้องเอามาเทียบกันถึงจะรู้ ถ้าไม่สรุปไว้บนสุดก็ไม่มีทางสังเกตเจอ */}
          {/* เสร็จงานหน้างานแล้ว ยังไม่ส่งรายงาน — ต้องเห็นตั้งแต่เปิดหน้า: ข้อมูลยังไม่ครบ และช่างจะส่งทับสิ่งที่แก้ตอนนี้ */}
          {finishedWaiting && (
            <div className="rounded-none px-4 py-2 text-sm border flex items-center gap-2 flex-wrap bg-teal-50 border-teal-300 text-teal-900">
              <span className="w-2 h-2 shrink-0 bg-teal-600" />
              <span className="font-semibold">ช่างเสร็จงานหน้างานแล้ว{finishedAtText} — กำลังทำรายงาน รอกดส่งงาน</span>
              <span className="text-teal-700"> · อนุมัติ/ตีกลับได้เมื่อช่างส่งงานแล้ว · แก้ตอนนี้อาจถูกทับตอนช่างส่ง</span>
            </div>
          )}
          {/* ตีกลับแล้ว — ต้องเห็นตั้งแต่เปิดหน้า ไม่งั้นหัวหน้านั่งแก้อยู่โดยไม่รู้ว่างานอยู่กับช่าง
              (เคสยังอยู่ในหน้าตรวจสอบโดยตั้งใจ หัวหน้าแก้เองได้ด้วย — user เคาะ 18/08/69) */}
          {sentBack && (
            <div className={`rounded-none px-4 py-2 text-sm border flex items-center gap-2 flex-wrap ${waitingSurveyor
              ? 'bg-orange-50 border-orange-300 text-orange-900'
              : 'bg-white border-[var(--md-line)] text-[var(--md-accent)]'}`}>
              {/* สี่เหลี่ยมทึบสีเตือน — ที่หมายว่างานใบนี้เคยถูกตีกลับ เห็นได้จากการกวาดตา (แบบ Modernist) */}
              <span className={`w-2 h-2 shrink-0 ${waitingSurveyor ? 'bg-orange-600' : 'bg-[var(--md-accent)]'}`} />
              <span className="font-semibold">
                {waitingSurveyor
                  ? 'ตีกลับให้ผู้สำรวจแล้ว — รอแก้ในแอปแล้วส่งกลับมา'
                  : `เคยตีกลับให้ผู้สำรวจ ${caseData?.sent_back_count ?? 1} ครั้ง`}
              </span>
              {caseData?.sent_back_reason && (
                <span> · ให้แก้: {String(caseData.sent_back_reason)}</span>
              )}
              {waitingSurveyor && <span className="text-orange-700"> · หัวหน้ายังแก้เองได้ตามปกติ</span>}
            </div>
          )}
          {/* แจกแจงทุกข้อที่กันไม่ให้อนุมัติ — ป้ายบนหัวบอกแค่จำนวน คนหาไม่เจอว่าอยู่ตรงไหน (user ทัก 09/09/69)
              รายการเดียวกับที่ปุ่ม "อนุมัติ" ใช้ตัดสิน จึงตรงกับตัวเลขบนป้ายเสมอ */}
          {approvalBlockers.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-none px-4 py-2 text-sm text-amber-900">
              <span className="font-semibold">ยังอนุมัติไม่ได้ {approvalBlockers.length} ข้อ</span>
              <ol className="list-decimal ml-5 mt-1 space-y-0.5 text-amber-800">
                {approvalBlockers.map((b, i) => <li key={i}>{b}</li>)}
              </ol>
            </div>
          )}
          {/* สรุปสั้น ๆ พอให้รู้ว่ามีปัญหา — รายละเอียดไปอ่านที่จังหวะนั้นในการ์ดลำดับเวลา */}
          {timeErrs.length > 0 && (
            <div className="bg-red-50 border border-red-300 rounded-none px-4 py-2 text-sm text-red-800">
              <span className="font-semibold">ลำดับเวลาไม่ถูกต้อง {timeErrs.length} จุด</span>
              <span className="text-red-600"> — ระบบประกันไม่รับ ดูรายละเอียดที่การ์ด "ลำดับเวลา" ด้านล่าง</span>
            </div>
          )}
          {/* แถบ "งานจากแอปมือถือ — ยังไม่ได้กรอกยอดเงิน" ตัดออกแล้ว (user ทัก 09/09/69) — ซ้ำกับข้อในกล่องรายการด้านบน
              moneyMissing ยังอยู่ใน approvalBlockers และช่องที่ขาดทาแดงในตารางค่าใช้จ่ายอยู่แล้ว */}
          {missing.length > 0 ? (
            <div className="bg-red-50 border border-red-200 rounded-none px-4 py-2.5 text-sm text-red-800 flex items-center gap-2">
              <span className="font-semibold">ยังขาดช่องบังคับ {missing.length} ช่อง</span>
              <span className="text-red-600">— ดูช่องที่มีกรอบแดง เว้นว่างไว้แล้วนำเข้าระบบประกันไม่ผ่าน</span>
              <button
                type="button"
                onClick={() => formRef.current?.querySelector('.' + RING[0])
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                className="ml-auto shrink-0 px-3 py-1 text-xs border border-red-300 rounded-none hover:bg-red-100"
              >
                ไปช่องแรกที่ขาด
              </button>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-none px-4 py-2 text-sm text-green-800">
              ช่องบังคับครบแล้ว
            </div>
          )}
          {/* รายละเอียดรถยนต์ — header + ข้อมูลบริษัท/เคลม (แบบตาราง) */}
          <div data-section="biz" className="border border-[var(--md-line)] bg-white">
          <SectionBar title="รายละเอียด" gap={(gapSec ?? []).includes('biz')}
            right={isAdmin && !approved && !keyEdit ? (
              <button type="button" onClick={openKeyEdit}
                className="text-xs text-blue-700 hover:text-blue-900 hover:underline">
                แก้เลขระบุเคส (แอดมิน)
              </button>
            ) : undefined} />
          <div>
          <div className="bg-white overflow-hidden text-sm">
            {/* Header bar with claim type & damage level */}
            <div className="bg-[var(--md-tint)] border-b border-[var(--md-line)] text-[var(--md-ink)] px-4 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
              {/* กรอบคุมทั้งกลุ่ม ไม่ใช่รายช่อง — วงกลม radio อยู่บนแถบสี ทาสีทีละอันแล้วไม่เห็น
                  กติกาเดียวกับกลุ่ม "การเรียกร้องค่าเสียหายจากคู่กรณี" ข้างล่าง */}
              <div className={`ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-none px-2 py-0.5 border ${
                missing.includes('claim_type') ? 'border-red-400 bg-red-50' : 'border-transparent'}`}>
                <span className="font-bold">ประเภทเคลม :</span>
                <span className={missing.includes('claim_type') ? 'text-red-600 font-bold' : 'text-red-500'}>*</span>
                {CLAIM_TYPE_OPTIONS.map(({ code: v }) => (
                  <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="claim_type" value={v} disabled={d} defaultChecked={report.claim_type === v} className="peer w-3.5 h-3.5" />
                    <span className="peer-checked:font-semibold">{CLAIM_TYPE_LABELS[v]}</span>
                  </label>
                ))}
              </div>
              <div className="w-0.5 h-5 bg-[var(--md-line-2)] shrink-0" />
              <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-none px-2 py-0.5 border ${
                missing.includes('damage_level') ? 'border-red-400 bg-red-50' : 'border-transparent'}`}>
                <span className="font-bold">รถเสียหาย :</span>
                <span className={missing.includes('damage_level') ? 'text-red-600 font-bold' : 'text-red-500'}>*</span>
                {['หนัก','เบา'].map(v => (
                  <label key={v} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="radio" name="damage_level" value={v} disabled={d} defaultChecked={report.damage_level === v} className="peer w-3.5 h-3.5" />
                    <span className="peer-checked:font-semibold">{v}</span>
                  </label>
                ))}
              </div>
              <div className="w-0.5 h-5 bg-[var(--md-line-2)] shrink-0" />
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" name="car_lost" value="true" disabled={d} defaultChecked={!!report.car_lost} className="peer w-3.5 h-3.5" />
                <span className="peer-checked:font-semibold">รถหาย</span>
              </label>
            </div>
            {/* Table rows */}
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-3 text-sm">
              <F label="บริษัทประกัน">
                <p className="py-1 font-bold text-gray-900 truncate"
                   title={[report.insurance_company, report.insurance_branch].filter(Boolean).join(' · ')}>
                  {[noPh(report.insurance_company), noPh(report.insurance_branch) || 'กรุงเทพ']
                    .filter(Boolean).join(' · ') || '—'}
                </p>
              </F>
              <F label="เลขเรื่องเซอร์เวย์">
                <p className="py-1 font-bold text-gray-900 truncate" title={report.survey_job_no || ''}>{report.survey_job_no || '—'}</p>
              </F>
              <F label="เลขที่รับแจ้ง">
                <p className="py-1 font-bold text-gray-900 truncate" title={report.claim_ref_no || ''}>{report.claim_ref_no || '—'}</p>
              </F>
              <F label="เลขที่เคลม">
                <p className="py-1 font-bold text-gray-900 truncate" title={report.claim_no || ''}>{report.claim_no || '—'}</p>
              </F>

              {/* 4 ช่องนี้เป็นข้อมูลบริษัทเรา ไม่ได้แก้ที่นี่ (มาจากตั้งค่าระบบ) — แสดงอย่างเดียว */}
              {/* แผงแก้ของแอดมิน — โผล่เฉพาะตอนกดปุ่มบนหัวหมวด
                  ⛔ ช่องในนี้ไม่มี name โดยตั้งใจ (อยู่ใน <form> เดียวกับฟอร์มหลัก
                     ถ้ามี name จะโดน FormData เก็บไปทับค่าที่ล็อกไว้ตอนกดบันทึก) */}
              {keyEdit && (
                <div className="col-span-2 md:col-span-4 rounded-none border border-amber-300 bg-amber-50 p-3 space-y-2">
                  <p className="text-xs text-amber-900">
                    แก้เลขระบุเคส — ใช้เฉพาะตอนเลขผิดมาตั้งแต่ต้นทาง
                    <span className="text-amber-700"> · เลขเซอร์เวย์ห้ามซ้ำกับเคสอื่น (ใช้อ้างอิงเบิกเงิน)</span>
                  </p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2">
                    <F label="บริษัทประกัน">
                      <select value={keyEdit.insurance_company} className={CTL(false)}
                        onChange={(e) => setKeyEdit({ ...keyEdit, insurance_company: e.target.value })}>
                        <option value="">-- ระบุ --</option>
                        {INSURER_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        {keyEdit.insurance_company && !INSURER_OPTIONS.includes(keyEdit.insurance_company) && (
                          <option value={keyEdit.insurance_company}>{keyEdit.insurance_company} (ค่าเดิม)</option>
                        )}
                      </select>
                    </F>
                    <F label="สาขา">
                      <select value={keyEdit.insurance_branch} className={CTL(false)}
                        onChange={(e) => setKeyEdit({ ...keyEdit, insurance_branch: e.target.value })}>
                        <option value="กรุงเทพ">กรุงเทพ</option>
                      </select>
                    </F>
                    <F label="เลขเรื่องเซอร์เวย์">
                      <input type="text" value={keyEdit.survey_job_no} className={CTL(false)}
                        onChange={(e) => setKeyEdit({ ...keyEdit, survey_job_no: e.target.value })} />
                    </F>
                    <F label="เลขที่รับแจ้ง">
                      <input type="text" value={keyEdit.claim_ref_no} className={CTL(false)}
                        onChange={(e) => setKeyEdit({ ...keyEdit, claim_ref_no: e.target.value })} />
                    </F>
                    <F label="เลขที่เคลม">
                      <input type="text" value={keyEdit.claim_no} className={CTL(false)}
                        onChange={(e) => setKeyEdit({ ...keyEdit, claim_no: e.target.value })} />
                    </F>
                  </div>
                  {keyMsg && <p className="text-xs text-red-700">{keyMsg}</p>}
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={saveKeyEdit}
                      className="px-4 py-1.5 bg-amber-600 text-white rounded-none text-sm font-medium hover:bg-amber-700">
                      บันทึกเลขระบุเคส
                    </button>
                    <button type="button" onClick={() => { setKeyEdit(null); setKeyMsg(''); }}
                      className="px-4 py-1.5 border border-gray-300 rounded-none text-sm text-gray-700 hover:bg-[var(--md-tint)]">
                      ยกเลิก
                    </button>
                  </div>
                </div>
              )}

              {/* 4 ช่องนี้ **แสดงอย่างเดียว ห้ามทำให้แก้ได้** (user เคาะ 18/08/69)
                  · 3 ช่องบริษัทผู้จัดเรื่องคือข้อมูลของเราเอง เหมือนกันทุกเคส จึงตรึงค่าไว้
                    ไม่ต้องกรอกรายเคส · ฝั่ง EMCS ไม่ต้องส่งไป เพราะมันเติมเองจากบริษัทประกัน
                    ที่เลือกตอน import XML อยู่แล้ว (XML ใช้ SURVEYBRID จาก env ไม่ใช่คอลัมน์พวกนี้)
                  · ⛔ เคยมีช่อง "วันที่" (= วันที่เกิดเหตุ) ตรงนี้ด้วย — ถอดออก 03/09/69
                    เพราะลำดับเวลาย้ายมาอยู่ท้ายการ์ดเดียวกันแล้ว ค่าเดียวกันจึงโชว์ซ้ำห่างกันไม่กี่นิ้ว
                    แถมช่องบนแก้ไม่ได้ — แก้ที่จังหวะที่ 1 ของลำดับเวลาที่เดียว */}
              <F label="บริษัทผู้จัดเรื่อง">
                <p className="py-1 text-gray-800 truncate" title={SURVEY_CO.name}>{SURVEY_CO.name}</p>
              </F>
              <F label="เบอร์โทรศัพท์ / Fax">
                <p className="py-1 text-gray-800">{SURVEY_CO.phone}</p>
              </F>
              <F label="ที่อยู่" span={2}>
                <p className="py-1 text-gray-800 truncate" title={SURVEY_CO.address}>{SURVEY_CO.address}</p>
              </F>
            </div>
            {/* ===== ลำดับเวลา — 5 จังหวะของงาน เรียงซ้าย→ขวา =====
                เดิม 5 จังหวะนี้กระจายอยู่ 3 แถวคนละที่ในตาราง ทำให้ "ผิดลำดับ" มองด้วยตาไม่เห็น
                (เจอจริงเคส #141: ถึงที่เกิดเหตุก่อนเกิดเหตุ 10 นาที ผ่านการอนุมัติมาแล้ว)
                ชื่อช่องเหมือนเดิมทุกตัว — ตัวบันทึกและดอกจันไม่ต้องแก้ */}
            {/* ⛔ อยู่ท้ายหมวด "รายละเอียด" (user ย้ายมา 03/09/69) — เป็นหมวดย่อย
                ไม่ใช่การ์ดของตัวเองแล้ว จึงเป็นหัวข้อตัวหนา+เส้นคั่น ไม่ใช่แถบน้ำเงินซ้อนแถบน้ำเงิน */}
            <div className="border-t border-[var(--md-line)] px-4 pt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-bold text-[var(--md-ink)]">ลำดับเวลา</span>
              {timeErrs.length > 0 && (
                <span className="text-xs font-semibold border border-red-300 bg-red-50 text-red-700 rounded-none px-2 py-0.5">ผิดลำดับ {timeErrs.length} จุด</span>
              )}
            </div>
            <div className="px-4 pt-3 pb-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-x-3 gap-y-4">
              {TIMELINE.map((n, i) => {
                const gap = n.keys.some((k) => missing.includes(k));
                const errs = timeErrs.filter((e) => e.at === n.date);
                return (
                  <div key={n.date} className="relative min-w-0">
                    {/* เส้นเชื่อมระหว่างจังหวะ — โชว์เฉพาะจอกว้างที่วางเรียงกัน 5 ช่อง
                        ⛔ ทั้งเส้นในช่องไฟและเส้นต่อท้ายชื่อ ต้องอยู่กึ่งกลางกล่องเลขพอดี (0.75rem
                           จากขอบบนแถว = mt ของกล่อง 0.0625 + ครึ่งความสูง 0.6875) เส้นหนา 2px
                           จึงต้องเยื้องขึ้นครึ่งเส้น (0.0625rem) ทั้งคู่ ไม่งั้นเหลื่อมกัน 1px
                           มองเป็นเส้นหักคนละระดับ (user แจ้ง 03/09/69) */}
                    {i > 0 && <div className="hidden xl:block absolute -left-[0.875rem] top-[0.6875rem] w-[0.875rem] border-t-2 border-[var(--md-line)]" />}
                    <div className="flex items-start gap-2 mb-1.5">
                      {/* เลขจังหวะใช้น้ำเงินชุดเดียวกับแถบหัวการ์ด (เดิมดำ ดูเป็นคนละชุดกับหัวเรื่อง)
                          · ยังไม่กรอก = แดงเตือนเหมือนเดิม */}
                      <span className={`mt-[0.0625rem] w-[1.375rem] h-[1.375rem] shrink-0 text-[0.6875rem] font-extrabold flex items-center justify-center text-white ${
                        gap ? 'bg-[var(--md-accent)]' : ''}`} style={gap ? undefined : { background: '#1E3E82' }}>{i + 1}</span>
                      <span className="text-xs font-semibold text-[var(--md-muted-2)] leading-tight min-w-0">{n.label} <Req of={n.keys.join(',')} /></span>
                      {/* เส้นบางลากต่อจากชื่อจังหวะ — ทำให้ 5 จังหวะอ่านเป็น "เส้นเวลา" ไม่ใช่ 5 กล่องแยกกัน
                          (จังหวะที่ 5 ก็มีเส้น — user เคาะ 03/09/69 ให้เท่ากันทุกจังหวะ) */}
                      <span className="hidden xl:block flex-1 h-0.5 mt-[0.6875rem] bg-[var(--md-line)]" />
                    </div>
                    {/* ⛔ ช่องเวลา (ชม/นาที) กว้างเป็น rem จึงโตตามขนาดตัวอักษร แต่ความกว้าง
                        ของช่องจังหวะมาจากกริดซึ่งผูกกับความกว้างจอ **ไม่โตตาม** — พอผู้ใช้
                        ขยายตัวอักษรเป็น 130-140% ช่องวันที่ถูกบีบจนวันที่ขาด ("29/08/2")
                        กันด้วย min-w + flex-wrap: แคบเมื่อไหร่ให้เวลาตกลงไปบรรทัดล่าง
                        แทนที่จะบีบวันที่ · ห่อ ชม:นาที ไว้ด้วยกันไม่งั้นเครื่องหมาย ":"
                        ตกไปคนละบรรทัดกับนาที */}
                    <div className="flex flex-wrap items-center gap-1">
                      <input type="text" disabled={d} name={n.date} defaultValue={n.v.date} placeholder="วว/ดด/ปปปป"
                        className={`flex-1 min-w-[7rem] border border-gray-300 rounded-none h-9 px-2.5 text-gray-800 ${d ? 'bg-gray-100' : 'bg-white'} text-sm`} />
                      <div className="flex items-center gap-1 shrink-0">
                        <input type="text" maxLength={2} inputMode="numeric" onBlur={padTimeOnBlur} disabled={d} name={n.hour} defaultValue={n.v.hour} placeholder="ชม"
                          className={`w-[2.125rem] shrink-0 border border-gray-300 rounded-none h-9 px-1 text-gray-800 ${d ? 'bg-gray-100' : 'bg-white'} text-sm text-center`} />
                        <span className="text-gray-400 shrink-0">:</span>
                        <input type="text" maxLength={2} inputMode="numeric" onBlur={padTimeOnBlur} disabled={d} name={n.min} defaultValue={n.v.minute} placeholder="นาที"
                          className={`w-[2.125rem] shrink-0 border border-gray-300 rounded-none h-9 px-1 text-gray-800 ${d ? 'bg-gray-100' : 'bg-white'} text-sm text-center`} />
                      </div>
                    </div>
                    {/* เตือนตรงจุดที่ผิด — ไม่ต้องเลื่อนขึ้นไปอ่านข้างบนแล้วเลื่อนกลับลงมาแก้ */}
                    {errs.map((e) => (
                      <div key={e.msg} className="mt-1 text-[0.6875rem] leading-tight text-red-600">⚠ {e.msg}</div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          </div>
          </div>

          {/* กรมธรรม์ — แบบตาราง */}
          <div data-section="policy" className="border border-[var(--md-line)] bg-white">
          <SectionBar title="กรมธรรม์" gap={(gapSec ?? []).includes('policy')}
            right={policyInfo ? (
              <button type="button" onClick={() => setPolicyOpen(true)}
                title="ข้อมูลกรมธรรม์ทั้งชุดจาก ISURVEY แท็บ 7 (ทุนประกัน วงเงิน ร.ย. ผู้รับผลประโยชน์ เงื่อนไข) — แสดงอย่างเดียว"
                className="text-xs font-semibold text-[#1E3E82] bg-white rounded-none px-2 py-0.5 hover:bg-blue-50">
                📄 ข้อมูลกรมธรรม์ (ISURVEY)
              </button>
            ) : undefined} />
          {policyOpen && policyInfo && (
            <PolicyInfoModal info={policyInfo} claimNo={report?.claim_no} onClose={() => setPolicyOpen(false)} />
          )}
          <div>
            <div className="bg-white p-4 grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-3 text-sm">
              <F label="กรมธรรม์เลขที่" req={<Req of="policy_no" />}>
                <input type="text" disabled={d} name="policy_no" defaultValue={report.policy_no || ''} className={CTL(d)} />
              </F>
              {/* ช่องพิมพ์ ไม่ใช่ dropdown — EMCS เองก็ไม่มีรายการให้เลือก และของจริง
                  มีมากกว่าที่ลิสต์ไว้ (ใบจริงเขียน "ประเภท 2+ ซ่อมอู่" = รหัส 52)
                  ตอนส่งออก policyTypeCode แปลงป้ายไทยที่รู้จัก ที่เหลือส่งตามที่กรอก */}
              <F label="ประกันประเภท" req={<Req of="policy_type" />}>
                {/* dropdown ชุดเดียวกับ ISURVEY (30/08/69) — เดิมเป็นช่องพิมพ์ ทำให้คำเขียน
                    ไม่ตรงกัน ('ชั้น 1' / 'ประเภท 1' / '52' / '2EXTRA' อยู่ใน DB จริงทั้งหมด)
                    แล้วแปลงเป็นรหัสส่ง EMCS ไม่ได้ · withCurrent คงค่าเดิมของเคสเก่าไว้ */}
                <select disabled={d} name="policy_type" defaultValue={report.policy_type || '-- ระบุ --'} className={CTL(d)}>
                  {withCurrent(POLICY_TYPE_OPTIONS, report.policy_type).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </F>
              <F label="วันที่เริ่มต้น">
                <input type="text" disabled={d} name="policy_start" defaultValue={report.policy_start || ''} className={CTL(d)} />
              </F>
              <F label="วันที่สิ้นสุด">
                <input type="text" disabled={d} name="policy_end" defaultValue={report.policy_end || ''} className={CTL(d)} />
              </F>

              <F label="ผู้เอาประกันภัย" req={<Req of="assured_name" />}>
                <input type="text" disabled={d} name="assured_name" defaultValue={report.assured_name || ''} className={CTL(d)} />
              </F>
              <F label="ชื่อผู้ขับขี่ตามกรมธรรม์">
                <input type="text" disabled={d} name="driver_by_policy" defaultValue={report.driver_by_policy || ''} className={CTL(d)} />
              </F>
              <F label="อีเมลผู้เอาประกัน">
                <input type="text" disabled={d} name="assured_email" defaultValue={report.assured_email || ''} className={CTL(d)} />
              </F>
              <F label="รหัสภัยยานยนต์">
                <input type="text" disabled={d} name="risk_code" defaultValue={report.risk_code || ''} className={CTL(d)} />
              </F>

              {/* ⛔ เคยมีช่องติ๊ก "มี" คู่กับช่องนี้ — ถอดออก 03/09/69 เพราะมันผูกกับค่าที่โหลดมา
                  (checked ตายตัว ไม่มี onChange) จึงกดไม่ติดทั้งที่หน้าตาเหมือนกดได้ และ React
                  เตือนใน console ทุกครั้ง · "มีหรือไม่มี" ดูจากช่องว่างหรือไม่ว่างได้อยู่แล้ว
                  (เส้นใต้ [data-filled] บอกให้ด้วย) */}
              <F label="กรมธรรม์ (พรบ.)">
                <input type="text" disabled={d} name="prb_number" defaultValue={report.prb_number || ''} className={CTL(d)} />
              </F>
              <F label="ค่าเสียหายส่วนแรก">
                <input type="text" disabled={d} name="deductible" defaultValue={money2(report.deductible)} className={CTL(d)} />
              </F>
              {/* ชื่ออู่/ศูนย์ซ่อม เป็นข้อความล้วน — ห้ามใส่ใน numericCols (ตัด comma จะกินชื่ออู่ที่มีลูกน้ำ)
                  maxLength ตรงกับ VARCHAR(200) — ยาวเกินแล้ว Postgres ไม่ตัดปลายให้ แต่ error จนบันทึกไม่ผ่านทั้งใบ */}
              {/* user 07/09/69: เล็กลงและอยู่ข้างค่าเสียหายส่วนแรก (เดิมกว้างเต็มแถว) */}
              <F label="ซ่อมที่">
                <input type="text" disabled={d} maxLength={200} name="repair_shop" defaultValue={report.repair_shop || ''} className={CTL(d)} />
              </F>
            </div>

          </div>
          </div>

          {/* รายละเอียดรถยนต์ — แบบตาราง */}
          <div data-section="car" className="border border-[var(--md-line)] bg-white">
          <SectionBar title="รถประกัน" gap={(gapSec ?? []).includes('car')} />
          <div>
          <div className="bg-white p-4 grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-3 text-sm">
            <F label="หมายเลขทะเบียน" req={<Req of="license_plate" />}>
              <input type="text" disabled={d} name="license_plate" defaultValue={report.license_plate || ''} className={CTL(d)} />
            </F>
            <F label="จังหวัด" req={<Req of="car_province" />}>
              <select disabled={d} name="car_province" defaultValue={report.car_province || '-- ระบุ --'} className={CTL(d)}>
                {withCurrent(PROVINCE_OPTIONS, report.car_province).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </F>
            <F label="ประเภทรถ" req={<Req of="car_type" />}>
              <select disabled={d} name="car_type" value={carType} onChange={e => setCarType(e.target.value)} className={CTL(d)}>
                <option value="0">-- ระบุ --</option>
                <option value="A">เก๋งเอเชีย</option>
                <option value="E">เก๋งยุโรป</option>
                <option value="M">รถจักรยานยนต์</option>
                <option value="T">กระบะ</option>
                <option value="V">รถตู้</option>
                <option value="W">รถบรรทุก</option>
                <option value="O">รถอื่นๆ</option>
              </select>
            </F>
            {/* EMCS บังคับยี่ห้อรถทุกบริษัท — ว่างแล้วบอทหยุดรอคนไปเลือกเองบนหน้า EMCS */}
            <F label="ยี่ห้อ" req={<Req of="car_brand" />}>
              <select disabled={d} name="car_brand" defaultValue={report.car_brand || '-- ระบุ --'} className={CTL(d)}>
                {carBrandOptions(carType, report.car_brand).map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </F>

            <F label="รุ่น">
              <input type="text" disabled={d} name="car_model" defaultValue={report.car_model || ''} className={CTL(d)} />
            </F>
            <F label="สีรถ">
              <select disabled={d} name="car_color" defaultValue={report.car_color || '-- ระบุ --'} className={CTL(d)}>
                {withCurrent(CAR_COLOR_OPTIONS, report.car_color).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </F>
            <F label="ปีจดทะเบียนรถ">
              <input type="text" disabled={d} name="car_reg_year" defaultValue={report.car_reg_year || ''} className={CTL(d)} />
            </F>
            <F label="หมายเลขตัวถัง">
              <input type="text" disabled={d} name="chassis_no" defaultValue={report.chassis_no || ''} className={CTL(d)} />
            </F>

            <F label="หมายเลขเครื่อง">
              <input type="text" disabled={d} name="engine_no" defaultValue={report.engine_no || ''} className={CTL(d)} />
            </F>
            <F label="หมายเลข Model">
              <input type="text" disabled={d} name="model_no" defaultValue={report.model_no || ''} className={CTL(d)} />
            </F>
            <F label="หมายเลข กม.">
              <input type="text" disabled={d} name="mileage" defaultValue={report.mileage != null ? Number(report.mileage).toLocaleString() : ''} className={CTL(d)} />
            </F>
            <div className="min-w-0" />

            {/* 3 ช่องรถไฟฟ้า — แอปมือถือเก็บมาให้อยู่แล้ว แต่หน้านี้ไม่เคยมีที่แสดง/แก้
                (ผู้ตรวจจึงมองไม่เห็นและแก้ไม่ได้ ทั้งที่ข้อมูลมีอยู่ในระบบ) */}
            <F label="ประเภทรถยนต์ไฟฟ้า">
              <select disabled={d} name="ev_type" defaultValue={report.ev_type || '0'} className={CTL(d)}>
                {EV_TYPE_OPTIONS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
              </select>
            </F>
            <F label="หมายเลขแบตเตอรี่">
              <input type="text" disabled={d} name="ev_battery_no" defaultValue={report.ev_battery_no || ''} className={CTL(d)} />
            </F>
            <F label="วันเริ่มใช้แบตเตอรี่">
              <input type="text" disabled={d} name="ev_battery_start" defaultValue={report.ev_battery_start || ''} className={CTL(d)} />
            </F>
            <F label="หมายเลขเครื่องชาร์จ">
              <input type="text" disabled={d} name="ev_charger_no" defaultValue={report.ev_charger_no || ''} className={CTL(d)} />
            </F>
          </div>

          </div>
          </div>

          {/* ข้อมูลผู้ขับขี่ — แบบตาราง */}
          <div data-section="driver" className="border border-[var(--md-line)] bg-white">
          <SectionBar title="ผู้ขับขี่รถประกัน" gap={(gapSec ?? []).includes('driver')} />
          <div>
            <div className="bg-white p-4 grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-3 text-sm">
              {/* 4 ช่องบังคับชุดเดียวกัน: เพศ · คำนำหน้า · ชื่อ · นามสกุล (EMCS บล็อกทั้งชุด) */}
              <F label="ผู้ขับขี่รถประกันภัย" req={<Req of="driver_gender,driver_title,driver_first_name,driver_last_name" />}>
                <div className="flex items-center gap-2">
                  {/* กลุ่ม radio ไม่มีกรอบแดงของตัวเอง (isBlank มองไม่เห็นกลุ่ม) → ทาที่กรอบครอบแทน
                      แบบเดียวกับ "ประเภทเคลม" — ไม่งั้นป้ายบอก "ยังขาด 1 ช่อง" แต่ไม่มีอะไรแดงให้หา
                      และปุ่ม "ไปช่องแรกที่ขาด" ก็ไม่รู้จะเลื่อนไปไหน (เคส #221, 03/09/69) */}
                  <div className={`flex items-center gap-2 rounded-none px-1 border ${
                    missing.includes('driver_gender') ? 'border-red-400 bg-red-50' : 'border-transparent'}`}>
                    <label className="flex items-center gap-1 text-gray-500 shrink-0 text-xs"><input type="radio" name="driver_gender" value="M" disabled={d} defaultChecked={genderMF(report.driver_gender) === 'M'} className="w-3.5 h-3.5" /> ชาย</label>
                    <label className="flex items-center gap-1 text-gray-500 shrink-0 text-xs"><input type="radio" name="driver_gender" value="F" disabled={d} defaultChecked={genderMF(report.driver_gender) === 'F'} className="w-3.5 h-3.5" /> หญิง</label>
                  </div>
                  <select disabled={d} name="driver_title" defaultValue={report.driver_title || '0'} className={`min-w-0 flex-1 border border-gray-300 rounded-none h-9 px-2.5 text-gray-800 ${d ? 'bg-gray-100' : 'bg-white'} text-sm`}>
                    <option value="0">- คำนำหน้า -</option>
                    <option value="นาย">นาย</option>
                    <option value="นาง">นาง</option>
                    <option value="นางสาว">นางสาว</option>
                    <option value="ด.ช.">ด.ช.</option>
                    <option value="ด.ญ.">ด.ญ.</option>
                    <option value="คุณ">คุณ</option>
                  </select>
                </div>
              </F>
              <F label="ชื่อ">
                <input type="text" disabled={d} name="driver_first_name" defaultValue={report.driver_first_name || ''} className={CTL(d)} />
              </F>
              <F label="นามสกุล">
                <input type="text" disabled={d} name="driver_last_name" defaultValue={report.driver_last_name || ''} className={CTL(d)} />
              </F>
              <F label="ความสัมพันธ์กับเจ้าของรถ" req={<Req of="driver_relation" />}>
                <select disabled={d} name="driver_relation" defaultValue={report.driver_relation || '0'} className={CTL(d)}>
                  <option value="0">-- ระบุ --</option>
                  <option value="สามี">สามี</option>
                  <option value="ภรรยา">ภรรยา</option>
                  <option value="บุตร">บุตร</option>
                  <option value="บิดา">บิดา</option>
                  <option value="มารดา">มารดา</option>
                  <option value="นายจ้าง">นายจ้าง</option>
                  <option value="ลูกจ้าง">ลูกจ้าง</option>
                  <option value="ผู้เช่า">ผู้เช่า</option>
                  <option value="พี่ชาย">พี่ชาย</option>
                  <option value="พี่สาว">พี่สาว</option>
                  <option value="น้องชาย">น้องชาย</option>
                  <option value="น้องสาว">น้องสาว</option>
                  <option value="เจ้าของรถ">เจ้าของรถ</option>
                  <option value="หลาน">หลาน</option>
                  <option value="อา">อา</option>
                  <option value="น้า">น้า</option>
                  <option value="ลุง">ลุง</option>
                  <option value="ป้า">ป้า</option>
                  <option value="ญาติ">ญาติ</option>
                  <option value="เพื่อน">เพื่อน</option>
                  <option value="แฟน">แฟน</option>
                  <option value="พนักงาน">พนักงาน</option>
                  <option value="พี่เขย">พี่เขย</option>
                  <option value="น้องเขย">น้องเขย</option>
                  <option value="พี่สะใภ้">พี่สะใภ้</option>
                  <option value="น้องสะใภ้">น้องสะใภ้</option>
                  <option value="พนักงานผู้เช่า">พนักงานผู้เช่า</option>
                  <option value="ลุงเขย">ลุงเขย</option>
                  <option value="น้าเขย">น้าเขย</option>
                  <option value="น้าสะใภ้">น้าสะใภ้</option>
                  <option value="อาเขย">อาเขย</option>
                  <option value="อาสะใภ้">อาสะใภ้</option>
                  <option value="หุ้นส่วน">หุ้นส่วน</option>
                  <option value="บุตรหุ้นส่วน">บุตรหุ้นส่วน</option>
                  <option value="เจ้าของบริษัท">เจ้าของบริษัท</option>
                  <option value="เพื่อนบุตรเจ้าของรถ">เพื่อนบุตรเจ้าของรถ</option>
                  <option value="บุตรเขย">บุตรเขย</option>
                  <option value="หลานเขย">หลานเขย</option>
                  <option value="บุตรสะใภ้">บุตรสะใภ้</option>
                </select>
              </F>

              <F label="วันเกิด" req={<Req of="driver_birthdate" />}>
                <input type="text" disabled={d} name="driver_birthdate" defaultValue={report.driver_birthdate || ''} className={CTL(d)} />
              </F>
              <F label="อายุ" req={<Req of="driver_age" />}>
                <input type="text" disabled={d} name="driver_age" defaultValue={report.driver_age != null ? report.driver_age : ''} className={CTL(d)} />
              </F>
              <F label="โทรศัพท์" req={<Req of="driver_phone" />}>
                <input type="text" disabled={d} name="driver_phone" defaultValue={report.driver_phone || ''} className={CTL(d)} />
              </F>
              <F label="บัตรประชาชนเลขที่" req={<Req of="driver_id_card" />}>
                <div className="flex items-center gap-1">
                  <input type="text" disabled={d} name="driver_id_card" defaultValue={report.driver_id_card || ''} className={`flex-1 min-w-0 border border-gray-300 rounded-none h-9 px-2.5 text-gray-800 ${d ? 'bg-gray-100' : 'bg-white'} text-sm`} />
                  {/* คนไทยต้องผ่าน checksum 13 หลัก · ต่างชาติขอแค่ไม่ว่าง (บัตรต่างด้าว/พาสปอร์ต
                      ไม่มีสูตรตรวจ) — แอปเก็บค่านี้อยู่แล้ว แต่หน้านี้ไม่เคยมีให้เลือก */}
                  <select disabled={d} name="driver_id_type" defaultValue={report.driver_id_type || 'thai'} className={`w-[5.25rem] shrink-0 border border-gray-300 rounded-none h-9 px-2.5 text-gray-800 ${d ? 'bg-gray-100' : 'bg-white'} text-sm`}>
                    <option value="thai">คนไทย</option>
                    <option value="foreign">ต่างชาติ</option>
                  </select>
                </div>
              </F>

              {/* ที่อยู่ + จังหวัด + เขต/อำเภอ บังคับทั้ง 3 ช่อง (เจอสดตอนเทส 2026-08-01) */}
              <F label="ที่อยู่ปัจจุบัน" req={<Req of="driver_address,driver_province,driver_district" />} span={2}>
                <input type="text" disabled={d} name="driver_address" defaultValue={report.driver_address || ''} className={CTL(d)} />
              </F>
              <F label="จังหวัด">
                <select disabled={d} name="driver_province" value={driverProv} onChange={e => { setDriverProv(e.target.value); setDriverDist('-- เขต --'); }} className={CTL(d)}>
                  {withCurrent(PROVINCE_OPTIONS, driverProv).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </F>
              <F label="เขต / อำเภอ">
                <select disabled={d} name="driver_district" value={driverDist} onChange={e => setDriverDist(e.target.value)} className={CTL(d)}>
                  {districtOptions(driverProv, driverProv === report.driver_province ? report.driver_district : '').map(dt => <option key={dt} value={dt}>{dt}</option>)}
                </select>
              </F>

              <F label="ใบอนุญาตขับขี่เลขที่" req={<Req of="driver_license_no" when="ผู้ขับขี่มีใบขับขี่" />}>
                <input type="text" disabled={d} name="driver_license_no" defaultValue={report.driver_license_no || ''} className={CTL(d)} />
              </F>
              <F label="ประเภทใบขับขี่">
                <select disabled={d} name="driver_license_type" defaultValue={report.driver_license_type || '0'} className={CTL(d)}>
                  <option value="0">-- ระบุ --</option>
                  {/* ประเภทใบขับขี่นอกลิสต์ (มาจากระบบเก่า/OCR) ต้องไม่หายตอนบันทึก */}
                  {withCurrent(DRIVER_LICENSE_TYPES, report.driver_license_type, '0')
                    .filter((v) => !DRIVER_LICENSE_TYPES.includes(v))
                    .map((v) => <option key={v} value={v}>{v}</option>)}
                  <option value="ใบขับขี่รถยนต์ส่วนบุคคลตลอดชีพ">ใบขับขี่รถยนต์ส่วนบุคคลตลอดชีพ</option>
                  <option value="ใบขับขี่รถจักรยานยนต์ส่วนบุคคลตลอดชีพ">ใบขับขี่รถจักรยานยนต์ส่วนบุคคลตลอดชีพ</option>
                  <option value="ใบขับขี่รถยนต์ส่วนบุคคลชั่วคราว">ใบขับขี่รถยนต์ส่วนบุคคลชั่วคราว</option>
                  <option value="ใบขับขี่รถจักรยานยนต์ส่วนบุคคลชั่วคราว">ใบขับขี่รถจักรยานยนต์ส่วนบุคคลชั่วคราว</option>
                  <option value="ใบขับขี่รถยนต์ส่วนบุคคล 5 ปีต่ออายุ">ใบขับขี่รถยนต์ส่วนบุคคล 5 ปีต่ออายุ</option>
                  <option value="ใบขับขี่รถยนต์สาธารณะ">ใบขับขี่รถยนต์สาธารณะ</option>
                  <option value="ใบขับขี่สากล">ใบขับขี่สากล</option>
                  <option value="ใบขับขี่รถยนต์ส่วนบุคคลหนึ่งปีต่ออายุ">ใบขับขี่รถยนต์ส่วนบุคคลหนึ่งปีต่ออายุ</option>
                  <option value="ใบขับขี่รถจักรยานยนต์ส่วนบุคคลหนึ่งปี">ใบขับขี่รถจักรยานยนต์ส่วนบุคคลหนึ่งปี</option>
                  <option value="ใบขับขี่รถยนต์ส่วนบุคคล 7 ปีต่ออายุ">ใบขับขี่รถยนต์ส่วนบุคคล 7 ปีต่ออายุ</option>
                  <option value="ใบขับขี่รถยนต์ส่วนบุคคล">ใบขับขี่รถยนต์ส่วนบุคคล</option>
                  <option value="ใบขับขี่รถจักรยานยนต์ส่วนบุคคล">ใบขับขี่รถจักรยานยนต์ส่วนบุคคล</option>
                  <option value="ใบขับขี่ขนส่งชนิดที่1">ใบขับขี่ขนส่งชนิดที่1</option>
                  <option value="ใบขับขี่ขนส่งชนิดที่2">ใบขับขี่ขนส่งชนิดที่2</option>
                  <option value="ใบขับขี่ขนส่งชนิดที่3">ใบขับขี่ขนส่งชนิดที่3</option>
                  <option value="ใบอนุญาติขับขี่ชนิดที่4">ใบอนุญาติขับขี่ชนิดที่4</option>
                  <option value="ไม่มีใบขับขี่">ไม่มีใบขับขี่</option>
                  <option value="ใบขับขี่รถยนต์สามล้อส่วนบุคคลสาธารณะ">ใบขับขี่รถยนต์สามล้อส่วนบุคคลสาธารณะ</option>
                  <option value="ใบขับขี่รถยนต์สามล้อส่วนบุคคลชั่วคราว">ใบขับขี่รถยนต์สามล้อส่วนบุคคลชั่วคราว</option>
                  <option value="ใบอนุญาตเป็นผู้ขับรถทุกประเภท">ใบอนุญาตเป็นผู้ขับรถทุกประเภท</option>
                  <option value="อื่นๆ">อื่นๆ</option>
                </select>
              </F>
              <F label="ออกให้ที่">
                <input type="text" disabled={d} name="driver_license_place" defaultValue={report.driver_license_place || ''} className={CTL(d)} />
              </F>
              <F label="ใบสั่ง">
                <input type="text" disabled={d} name="driver_ticket" defaultValue={report.driver_ticket || ''} className={CTL(d)} />
              </F>

              <F label="ใบขับขี่ ออกให้วันที่">
                <input type="text" disabled={d} name="driver_license_start" defaultValue={report.driver_license_start || ''} className={CTL(d)} />
              </F>
              <F label="ใบขับขี่ หมดอายุวันที่">
                <input type="text" disabled={d} name="driver_license_end" defaultValue={report.driver_license_end || ''} className={CTL(d)} />
              </F>
              <F label="ความเสียหายประมาณ (บาท)">
                <input type="text" disabled={d} name="estimated_cost" defaultValue={report.estimated_cost != null ? Number(report.estimated_cost).toFixed(2) : ''} className={CTL(d)} />
              </F>
              <div className="min-w-0" />

              {/* ต้องมีรายการความเสียหายอย่างน้อย 1 รายการ (ผู้สำรวจเลือกจากแอป) */}
              {/* ⛔ ไม่ใส่ดอกจันที่ textarea นี้ — ค่าของมันไม่เคยถูกส่งเข้า EMCS เลย
                  ตัวที่ EMCS ต้องการคือ "รายการ" ความเสียหาย ซึ่งคุมที่ approvalBlockers */}
              <F label="ความเสียหายรถประกันภัย" span={4}
                 right={
                   /* ⛔ type="button" — ปุ่มในฟอร์มที่ไม่ระบุชนิด เบราว์เซอร์ถือเป็น submit */
                   <button type="button" disabled={d}
                     onClick={() => openBig('damage_description', 'ความเสียหายรถประกันภัย')}
                     className="shrink-0 text-xs text-blue-700 hover:text-blue-900 disabled:text-gray-400 disabled:cursor-not-allowed">
                     ⤢ ขยาย
                   </button>
                 }>
                {/* ⛔ CTL มี h-9 (สูง 36px) ติดมาด้วย — ช่องพิมพ์หลายบรรทัดต้องมี min-h มาทับเสมอ
                    ไม่งั้นโดนบีบเหลือบรรทัดเดียวทั้งที่ตั้ง rows ไว้ */}
                {/* ข้อความในช่องนี้ปกติ = รายการที่แอป/หน้าต่างเขียนให้ จึงโชว์เป็น**แถวเรียง
                    ไปทางขวา** แทนช่องพิมพ์ (user ขอ 03/09/69 — ขวามือว่างเยอะ เรียงลงมา
                    กินความสูงเปล่า ๆ) · แก้ข้อความได้ที่ปุ่ม "⥂ ขยาย" ซึ่งเปิดเป็นบรรทัดละชิ้น
                    ⛔ textarea ต้องอยู่ในฟอร์มเสมอ แค่ซ่อน — ทั้ง FormData ตอนบันทึกและปุ่มขยาย
                       อ่านค่าจาก DOM ตัวนี้ ถอดออกเมื่อไหร่ค่าหายตอนบันทึก */}
                <textarea disabled={d} name="damage_description" defaultValue={report.damage_description || ''} rows={2}
                  className={descCustom ? `${CTL(d)} min-h-[4rem] py-1.5` : 'hidden'} />
                {!descCustom && (
                  <div className={`min-h-9 flex items-center flex-wrap border border-gray-300 rounded-none px-3 py-1.5 ${d ? 'bg-gray-100' : 'bg-white'}`}>
                    {damage.length > 0
                      ? <DamageList items={damage} />
                      : <span className="text-xs text-gray-400">ยังไม่มีรายการ — กด "ข้อมูลความเสียหาย" ข้างล่างเพื่อเลือก</span>}
                  </div>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {/* หน้าต่างเดียวกับ EMCS — ผู้สำรวจเลือกมาจากแอปแล้ว ที่นี่ไว้เติม/แก้ที่ขาด */}
                  <button type="button" disabled={d} onClick={() => setDmgOpen(true)}
                    className="px-3 py-1 border border-gray-400 rounded-none bg-gray-200 text-gray-700 text-xs whitespace-nowrap hover:bg-gray-300">
                    ข้อมูลความเสียหาย{damage.length > 0 ? ` (${damage.length})` : ''}
                  </button>
                  {/* ปกติข้อความข้างบนวิ่งตามรายการอยู่แล้ว จึงไม่ต้องโชว์ซ้ำสองที่ —
                      โชว์เฉพาะตอนผู้ตรวจพิมพ์คำบรรยายเอง (ข้อความไม่ตรงกับรายการแล้ว)
                      ⛔ ช่องข้อความคือคำบรรยาย **ไม่เคยถูกส่งเข้า EMCS** ตัวที่เข้าจริงคือรายการนี้ */}
                  {descCustom && <DamageList items={damage} />}
                </div>
              </F>
            </div>

          </div>
          </div>

          {/* ===== รายละเอียดอุบัติเหตุ — แบบตาราง ===== */}
          <div data-section="acc" className="border border-[var(--md-line)] bg-white">
          <SectionBar title="อุบัติเหตุ" gap={(gapSec ?? []).includes('acc')} />
          <div>
          <div className="bg-white overflow-hidden text-sm">
            <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-3 text-sm">
              {/* สถานที่ + จังหวัด + เขต/อำเภอ บังคับทั้ง 3 (จังหวัด/อำเภอ = ตัวที่บอทใช้หาเรทด้วย) */}
              <F label="สถานที่เกิดเหตุ" req={<Req of="acc_place,acc_province,acc_district" />} span={2}>
                <input type="text" disabled={d} name="acc_place" defaultValue={report.acc_place || ''} className={CTL(d)} />
              </F>
              <F label="จังหวัด">
                <select disabled={d} name="acc_province" value={accProv} onChange={e => { setAccProv(e.target.value); setAccDist('-- เขต --'); setAccTumbon(''); }} className={CTL(d)}>
                  {withCurrent(PROVINCE_OPTIONS, accProv).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </F>
              <F label="เขต / อำเภอ">
                <select disabled={d} name="acc_district" value={accDist} onChange={e => { setAccDist(e.target.value); setAccTumbon(''); }} className={CTL(d)}>
                  {districtOptions(accProv, accProv === report.acc_province ? report.acc_district : '').map(dt => <option key={dt} value={dt}>{dt}</option>)}
                </select>
                {/* ── ตำบล ── (user เคาะ 01/09/69: เป็นช่องติ๊ก ไม่ใช่ dropdown)
                    อำเภอที่มีตำบลคิดเรทต่างจากอำเภอแม่มีตำบลเดียว dropdown ที่มี "ไม่ระบุ"
                    กับอีก 1 ตัวเลือกจึงเปลืองคลิกเปล่า ๆ · เผื่ออนาคตมีหลายตำบล = หลายช่องติ๊ก
                    ที่เลือกได้ทีละอัน (เคสหนึ่งอยู่ตำบลเดียว) */}
                {tumbonChoices.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {tumbonChoices.map((t) => (
                      <label key={t} className="flex items-center gap-1.5 text-sm text-gray-700">
                        <input type="checkbox" disabled={d} checked={accTumbon === t}
                          onChange={e => setAccTumbon(e.target.checked ? t : '')} />
                        ตำบล{t}
                      </label>
                    ))}
                  </div>
                )}
                {/**
                  * ⛔ ต้องมีช่องซ่อนเสมอ ไม่ใช่ให้ค่าไปกับช่องติ๊ก —
                  *    ช่องติ๊กที่ไม่ได้ติ๊กจะไม่ถูกส่งไปกับฟอร์มเลย เอาติ๊กออกแล้วค่าเดิมจะค้าง
                  *    ในฐานข้อมูลตลอดไป (ล้างไม่ได้) · ช่องซ่อนส่ง "" ไปแทนจึงล้างได้จริง
                  *    และยังทำให้ย้ายอำเภอไปที่ที่ไม่มีตำบล แล้วตำบลเดิมถูกล้างตามด้วย
                  */}
                <input type="hidden" disabled={d} name="acc_subdistrict" value={accTumbon} />
              </F>

              {/* ── สถานที่ออกตรวจสอบ ── (user ขอ 09/09/69 กับเคลม 2026013072661: เกิดเหตุ กทม./สวนหลวง แต่ออกตรวจ ชลบุรี/บางละมุง)
                  ISURVEY แยก "สถานที่ออกตรวจสอบ + จังหวัด/เขต-อำเภอ/ตำบล ที่ตรวจสอบ" ออกจากสถานที่เกิดเหตุ ตัวดึงงานเอามาให้
                  · เรทค่าบริการคิดจากชุดนี้ก่อน (ชุดเดียวกับ extension se-billing บน ISURVEY) ว่าง = ถอยไปคิดจากสถานที่เกิดเหตุ
                  · ไม่บังคับกรอก (งานมือถือ/XML ไม่มีข้อมูลนี้) · ไม่เข้า XML/EMCS · คอลัมน์ survey_* (migration 058) */}
              <F label="สถานที่ออกตรวจสอบ" span={2}>
                <input type="text" disabled={d} name="survey_place" defaultValue={report.survey_place || ''}
                  placeholder="ว่าง = ใช้สถานที่เกิดเหตุคิดเรท" className={CTL(d)} />
              </F>
              <F label="จังหวัดที่ตรวจสอบ">
                <select disabled={d} name="survey_province" value={survProv} onChange={e => { setSurvProv(e.target.value); setSurvDist('-- เขต --'); setSurvTumbon(''); }} className={CTL(d)}>
                  {withCurrent(PROVINCE_OPTIONS, survProv).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </F>
              <F label="เขต / อำเภอที่ตรวจสอบ">
                <select disabled={d} name="survey_district" value={survDist} onChange={e => { setSurvDist(e.target.value); setSurvTumbon(''); }} className={CTL(d)}>
                  {districtOptions(survProv, survProv === report.survey_province ? report.survey_district : '').map(dt => <option key={dt} value={dt}>{dt}</option>)}
                </select>
                {survTumbonChoices.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {survTumbonChoices.map((t) => (
                      <label key={t} className="flex items-center gap-1.5 text-sm text-gray-700">
                        <input type="checkbox" disabled={d} checked={survTumbon === t}
                          onChange={e => setSurvTumbon(e.target.checked ? t : '')} />
                        ตำบล{t}
                      </label>
                    ))}
                  </div>
                )}
                {/* ตำบลที่ ISURVEY ระบุมาแต่ไม่ใช่ตำบลพิเศษ (ไม่มีช่องติ๊ก) — โชว์ให้รู้ว่ามีค่า ไม่งั้นหายไปเงียบ ๆ ทั้งที่ยังถูกบันทึกอยู่ */}
                {survTumbon && !survTumbonChoices.includes(survTumbon) && (
                  <div className="mt-1 text-xs text-gray-500">ตำบล{survTumbon} (จาก ISURVEY)</div>
                )}
                {/* ช่องซ่อนส่ง "" เมื่อเอาติ๊กออก — เหตุผลเดียวกับ acc_subdistrict ข้างบน */}
                <input type="hidden" disabled={d} name="survey_subdistrict" value={survTumbon} />
              </F>

              <F label="ลักษณะการเกิดเหตุ" req={<Req of="acc_cause" />}>
                <select disabled={d} name="acc_cause" defaultValue={report.acc_cause || '-- ระบุ --'} className={CTL(d)}>
                  {withCurrent(ACC_CAUSE_OPTIONS, report.acc_cause).map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </F>
              <F label="ลักษณะความเสียหาย" req={<Req of="acc_damage_type" />}>
                <select disabled={d} name="acc_damage_type" defaultValue={report.acc_damage_type || '-- ระบุ --'} className={CTL(d)}>
                  {ACC_DAMAGE_TYPE_OPTIONS.map(dt => <option key={dt} value={dt}>{dt}</option>)}
                </select>
              </F>
              <F label="ผู้แจ้ง">
                <input type="text" disabled={d} name="acc_reporter" defaultValue={report.acc_reporter || ''} className={CTL(d)} />
              </F>
              <div className="min-w-0" />

              {/* ถอด <select> "สาขาผู้สำรวจ" ออก — มีตัวเลือกเดียวคือ placeholder จึงเขียนค่าว่าง
                  ทับทุกครั้งที่บันทึก · แอปมือถือถอด UI นี้ไปแล้ว และ XML ใช้ SURVEYBRID จาก env */}
              <F label="ผู้สำรวจภัย" req={<Req of="acc_surveyor" />} span={2}>
                <input type="text" disabled={d} name="acc_surveyor" defaultValue={report.acc_surveyor || ''} className={CTL(d)} />
              </F>
              <F label="โทรศัพท์ผู้สำรวจ" req={<Req of="acc_surveyor_phone" />}>
                <input type="text" disabled={d} name="acc_surveyor_phone" defaultValue={report.acc_surveyor_phone || ''} className={CTL(d)} />
              </F>
              <div className="min-w-0" />

              <F label="ฝ่ายประมาท" req={<Req of="acc_fault" />} span={4}>
                <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-none px-1 border ${
                  missing.includes('acc_fault') ? 'border-red-400 bg-red-50' : 'border-transparent'}`}>
                  {/* ⚠️ `value` ต้องเป็น **ค่าสั้นชุดเดียวกับแอปมือถือ** (_faultDropdown ที่
                      survey_form_screen.dart) — ไม่ใช่ป้ายเต็มที่โชว์
                      เดิมเว็บเขียนป้ายเต็มลง DB ทับค่าของแอป แล้วตรรกะในแอปที่เทียบตรง ๆ
                      (`_accFault == 'คู่กรณีผิด'`) เลิกทำงาน → แอปไม่บังคับ "คู่กรณีคันที่ +
                      การเรียกร้อง ≥1" ทั้งที่ EMCS ยังบังคับ */}
                  <label className="flex items-center gap-1"><input type="radio" name="acc_fault" value="ฝ่ายผิด" disabled={d} defaultChecked={report.acc_fault === 'ฝ่ายผิด' || report.acc_fault === 'รถประกันฝ่ายผิด' || report.acc_fault === 'รถประกันเป็นฝ่ายผิด'} className="w-3.5 h-3.5" /> รถประกันเป็นฝ่ายผิด</label>
                  <label className="flex items-center gap-1"><input type="radio" name="acc_fault" value="ฝ่ายถูกและผิด" disabled={d} defaultChecked={report.acc_fault === 'ฝ่ายถูกและผิด' || report.acc_fault === 'รถประกันเป็นฝ่ายถูกและผิด' || report.acc_fault === 'ถูกและผิด'} className="w-3.5 h-3.5" /> รถประกันเป็นฝ่ายถูกและผิด</label>
                  <label className="flex items-center gap-1"><input type="radio" name="acc_fault" value="คู่กรณีผิด" disabled={d} defaultChecked={report.acc_fault === 'คู่กรณีผิด' || report.acc_fault === 'รถคู่กรณีเป็นฝ่ายผิด'} className="w-3.5 h-3.5" /> รถคู่กรณีเป็นฝ่ายผิด</label>
                  <span className="text-gray-500">คู่กรณีคันที่{' '}
                    {/* ดอกจันเหลือง = "บังคับเฉพาะบางกรณี" ตามคำอธิบายบนหัวฟอร์ม — คงไว้
                        ส่วนกรอบ/พื้นสีเหลืองถอดออกแล้ว (เตือนหลอกทุกเคส) */}
                    <span className={`ml-0.5 ${oppNoHl === 'red' ? 'text-red-600 font-bold' : 'text-amber-500'}`}
                      title={oppNoHl === 'red'
                        ? 'ผลคดี = รถคู่กรณีเป็นฝ่ายผิด → ระบบประกันบังคับช่องนี้ (และต้องติ๊กการเรียกร้องอย่างน้อย 1 ข้อด้วย)'
                        : 'บังคับเมื่อผลคดี = รถคู่กรณีเป็นฝ่ายผิด'}>*</span></span>
                  <input type="text" disabled={d} name="acc_fault_opponent_no" defaultValue={report.acc_fault_opponent_no ?? ''}
                    className={`w-[2.5rem] border rounded-none px-2 py-1 text-gray-800 text-sm text-center ${
                      oppNoHl === 'none' ? `border-gray-300 ${d ? 'bg-gray-100' : 'bg-white'}` : HL_CLS[oppNoHl]}`} />
                  <label className="flex items-center gap-1"><input type="radio" name="acc_fault" value="ประมาทร่วม" disabled={d} defaultChecked={report.acc_fault === 'ประมาทร่วม'} className="w-3.5 h-3.5" /> ประมาทร่วม</label>
                  <label className="flex items-center gap-1"><input type="radio" name="acc_fault" value="รอสรุปผลคดี" disabled={d} defaultChecked={report.acc_fault === 'รอสรุปผลคดี'} className="w-3.5 h-3.5" /> รอสรุปผลคดี</label>
                  <label className="flex items-center gap-1"><input type="radio" name="acc_fault" value="ยกเลิกการเคลม" disabled={d} defaultChecked={report.acc_fault === 'ยกเลิกการเคลม'} className="w-3.5 h-3.5" /> ยกเลิกการเคลม</label>
                  <label className="flex items-center gap-1"><input type="radio" name="acc_fault" value="ไปถึงแล้วไม่พบ" disabled={d} defaultChecked={report.acc_fault === 'ไปถึงแล้วไม่พบ' || report.acc_fault === 'ไปถึง แล้วไม่พบ'} className="w-3.5 h-3.5" /> ไปถึงแล้วไม่พบ</label>
                </div>
              </F>

              {/* ตรงกับช่อง "รายละเอียดการเกิดเหตุ" แท็บข้อมูลทั่วไปของ EMCS (ACC_DETAIL) */}
              <F label="รายละเอียดการเกิดเหตุ" req={<Req of="acc_detail" />} span={4}
                 right={
                   /* ⛔ type="button" — ปุ่มในฟอร์มที่ไม่ระบุชนิด เบราว์เซอร์ถือเป็น submit */
                   <button type="button" disabled={d}
                     onClick={() => openBig('acc_detail', 'รายละเอียดการเกิดเหตุ')}
                     className="shrink-0 text-xs text-blue-700 hover:text-blue-900 disabled:text-gray-400 disabled:cursor-not-allowed">
                     ⤢ ขยาย
                   </button>
                 }>
                <textarea disabled={d} name="acc_detail" defaultValue={report.acc_detail || ''} className={`${CTL(d)} min-h-[5rem]`} rows={4} />
              </F>
              {/* "หมายเหตุ" จาก ISURVEY แท็บ 2 (ค่าพาหนะ/นัดหมาย/เงื่อนไขที่ช่างจด) — user ขอ 08/09/69
                  ⛔ แสดงอย่างเดียว ไม่มี name จึงไม่ถูกบันทึกทับ และไม่ไหลเข้า XML/EMCS (คอลัมน์ source_remark, migration 056) */}
              {String(report?.source_remark ?? '').trim() && (
                <div className="col-span-full -mt-1">
                  <div className="text-[0.6875rem] font-semibold text-gray-500">หมายเหตุจาก ISURVEY <span className="font-normal">· แสดงอย่างเดียว ไม่ส่งเข้า EMCS</span></div>
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 bg-amber-50 border border-amber-200 rounded-none px-2 py-1.5">{String(report.source_remark)}</pre>
                </div>
              )}
            </div>
          </div>

          </div>
          </div>

          {/* คู่กรณี + ตำรวจ + ติดตามงาน — แบบตาราง */}
          <div data-section="claim" className="border border-[var(--md-line)] bg-white">
          <SectionBar title="การเรียกร้องค่าเสียหายจากคู่กรณี" gap={(gapSec ?? []).includes('claim')} />
          <div>
          <div className="bg-white p-4 text-sm">
            <label className="block text-xs text-[var(--md-muted)] mb-1">
              การเรียกร้องค่าเสียหายจากคู่กรณี{' '}
              <span
                className={`ml-0.5 ${claimHl === 'red' ? 'text-red-600 font-bold' : 'text-amber-500'}`}
                title={claimHl === 'red'
                  ? 'ผลคดี = รถคู่กรณีเป็นฝ่ายผิด → ระบบประกันบังคับให้ติ๊กอย่างน้อย 1 ข้อ เว้นว่างแล้วบันทึกไม่ผ่าน'
                  : 'บังคับเมื่อผลคดี = รถคู่กรณีเป็นฝ่ายผิด — ผลคดีอื่นไม่บังคับ'}
              >*</span>
            </label>
            {/* กรอบ+พื้นหลังคุมทั้งกลุ่ม ไม่ใช่รายช่อง — checkbox เดี่ยว ๆ เล็กเกินกว่าจะเห็นสี
                border ใสตอนปกติ เพื่อไม่ให้ layout ขยับตอนเปลี่ยนสี */}
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-none px-2 py-1 border ${
              claimHl === 'none' ? 'border-transparent' : HL_CLS[claimHl]}`}>
              <label className="flex items-center gap-1"><input type="checkbox" name="acc_claim_opponent" value="คัดประจำวัน" disabled={d} defaultChecked={report.acc_claim_opponent?.includes('คัดประจำวัน')} className="w-3.5 h-3.5" /> คัดประจำวัน</label>
              <label className="flex items-center gap-1"><input type="checkbox" name="acc_claim_opponent" value="รับหลักฐานจากคู่กรณีผิด" disabled={d} defaultChecked={report.acc_claim_opponent?.includes('รับหลักฐานจากคู่')} className="w-3.5 h-3.5" /> รับหลักฐานจากคู่กรณีผิด</label>
              <label className="flex items-center gap-1"><input type="checkbox" name="acc_claim_opponent" value="บันทึกยอมรับผิด" disabled={d} defaultChecked={report.acc_claim_opponent?.includes('บันทึกยอมรับ')} className="w-3.5 h-3.5" /> บันทึกยอมรับผิด</label>
              <label className="flex items-center gap-1"><input type="checkbox" name="acc_claim_opponent" value="บัตรติดต่อ" disabled={d} defaultChecked={report.acc_claim_opponent?.includes('บัตรติดต่อ')} className="w-3.5 h-3.5" /> บัตรติดต่อ</label>
              <label className={`flex items-center gap-1 ${tickHl === 'red' ? `px-1 border rounded-none ${HL_CLS.red}` : ''}`}><input type="checkbox" name="acc_claim_opponent" value="รับเงิน" disabled={d} defaultChecked={report.acc_claim_opponent?.includes('รับเงิน')} className="w-3.5 h-3.5" /> รับเงินจำนวน</label>
              {/* ติ๊ก "รับเงินจำนวน" เมื่อไหร่ ช่องเงินคู่นี้บังคับทันที (กติกา EMCS) */}
              <input type="text" name="acc_claim_amount" disabled={d} defaultValue={money2(report.acc_claim_amount)}
                className={`w-[6.25rem] ml-1 border rounded-none px-2 py-1 text-gray-800 text-sm ${
                  payHl === 'none' ? `border-gray-300 ${d ? 'bg-gray-100' : 'bg-white'}` : HL_CLS.red}`} />
              <span className="text-gray-500">บาท</span>
              <span className="ml-2 text-gray-500">จากจำนวนเงินเรียกร้องทั้งหมด :</span>
              <input type="text" name="acc_claim_total_amount" disabled={d} defaultValue={money2(report.acc_claim_total_amount)}
                className={`w-[6.25rem] border rounded-none px-2 py-1 text-gray-800 text-sm ${
                  payHl === 'none' ? `border-gray-300 ${d ? 'bg-gray-100' : 'bg-white'}` : HL_CLS.red}`} />
              <span className="text-gray-500">บาท</span>
              {payOver && (
                <span className="w-full text-xs text-red-700 bg-red-50 border border-red-200 rounded-none px-2 py-1">
                  ⚠ &quot;รับเงินจำนวน&quot; มากกว่า &quot;จากจำนวนเงินเรียกร้องทั้งหมด&quot; — ระบบประกันจะไม่ยอมให้บันทึก
                </span>
              )}
            </div>
          </div>

          </div>
          </div>

          {/* พนักงานสอบสวน + แอลกอฮอล์ — แบบตาราง */}
          <div data-section="police" className="border border-[var(--md-line)] bg-white">
          <SectionBar title="คดี · ตำรวจ · ติดตามงาน" gap={(gapSec ?? []).includes('police')} />
          <div>
          <div className="bg-white p-4 grid grid-cols-2 md:grid-cols-4 gap-x-5 gap-y-3 text-sm">
            <F label="ชื่อพนักงานสอบสวน" req={<Req of="acc_police_name" when="ฝ่ายประมาท = &quot;รอสรุปผลคดี&quot; หรือมีการแจ้งความ" />}>
              <input type="text" disabled={d} name="acc_police_name" defaultValue={report.acc_police_name || ''} className={CTL(d)} />
            </F>
            <F label="สถานีตำรวจ" req={<Req of="acc_police_station" when="ฝ่ายประมาท = &quot;รอสรุปผลคดี&quot; หรือมีการแจ้งความ" />}>
              <input type="text" disabled={d} name="acc_police_station" defaultValue={report.acc_police_station || ''} className={CTL(d)} />
            </F>
            <F label="ประจำวันข้อที่">
              <input type="text" disabled={d} name="acc_police_book_no" defaultValue={report.acc_police_book_no || ''} className={CTL(d)} />
            </F>
            {/* วัน+เวลาเก็บรวมกันเป็น "วันที่|HH:mm" — ต้องแตกกลับมาใส่ช่องชั่วโมง/นาที
                เดิม hardcode '' ทั้งคู่ → กดบันทึกทีเดียวเวลาที่ช่างกรอกมาหายทันที
                (backend เขียนทับ acc_police_date ด้วยวันที่เปล่าเมื่อชั่วโมง/นาทีว่าง) */}
            {(() => { const pol = parseDatetime(report.acc_police_date); return (
              <F label="วันที่แจ้งความ">
                <div className="flex items-center gap-1">
                  <input type="text" disabled={d} name="acc_police_date" defaultValue={pol.date} className={`flex-1 min-w-0 border border-gray-300 rounded-none h-9 px-2.5 text-gray-800 ${d ? 'bg-gray-100' : 'bg-white'} text-sm`} />
                  <input type="text" maxLength={2} inputMode="numeric" onBlur={padTimeOnBlur} disabled={d} name="acc_police_hour" defaultValue={pol.hour} className={`w-[2.125rem] shrink-0 border border-gray-300 rounded-none h-9 px-1 text-gray-800 ${d ? 'bg-gray-100' : 'bg-white'} text-sm text-center`} />
                  <span className="text-gray-400 shrink-0">:</span>
                  <input type="text" maxLength={2} inputMode="numeric" onBlur={padTimeOnBlur} disabled={d} name="acc_police_minute" defaultValue={pol.minute} className={`w-[2.125rem] shrink-0 border border-gray-300 rounded-none h-9 px-1 text-gray-800 ${d ? 'bg-gray-100' : 'bg-white'} text-sm text-center`} />
                </div>
              </F>
            ); })()}

            <F label="ความเห็นพนักงานสอบสวน" span={4}>
              <input type="text" disabled={d} name="acc_police_comment" defaultValue={report.acc_police_comment || ''} className={CTL(d)} />
            </F>

            <F label="ผลการตรวจแอลกอฮอล์" span={2}>
              <div className="flex items-center gap-3 py-1">
                <label className="flex items-center gap-1"><input type="radio" name="acc_alcohol_test" value="ไม่มีการตรวจแอลกอฮอล์" disabled={d} defaultChecked={!report.acc_alcohol_test || report.acc_alcohol_test === 'ไม่มีการตรวจแอลกอฮอล์'} className="w-3.5 h-3.5" /> ไม่มีการตรวจ</label>
                <label className="flex items-center gap-1"><input type="radio" name="acc_alcohol_test" value="มีการตรวจแอลกอฮอล์" disabled={d} defaultChecked={report.acc_alcohol_test === 'มีการตรวจแอลกอฮอล์'} className="w-3.5 h-3.5" /> มีการตรวจ</label>
              </div>
            </F>
            <F label="ระบุผล" span={2}>
              <input type="text" disabled={d} name="acc_alcohol_result" defaultValue={report.acc_alcohol_result || ''} className={CTL(d)} />
            </F>

            {/* การติดตามงาน — รวมอยู่ในหมวดเดียวกันตามดีไซน์ใหม่ (เดิมแยกเป็นการ์ดที่ 2) */}
            <div className="col-span-2 md:col-span-4 border-t border-gray-100 pt-3 -mb-1" />

            <F label="การติดตามงาน" span={2}>
              <div className="flex items-center gap-3 py-1">
                <label className="flex items-center gap-1"><input type="radio" name="acc_followup" value="ไม่มีการนัดหมาย" disabled={d} defaultChecked={!report.acc_followup || report.acc_followup === 'ไม่มีการนัดหมาย'} className="w-3.5 h-3.5" /> ไม่มีการนัดหมาย</label>
                <label className="flex items-center gap-1"><input type="radio" name="acc_followup" value="รอการนัดหมาย" disabled={d} defaultChecked={report.acc_followup === 'รอการนัดหมาย'} className="w-3.5 h-3.5" /> รอการนัดหมาย</label>
                <label className="flex items-center gap-1"><input type="radio" name="acc_followup" value="มีการนัดหมาย" disabled={d} defaultChecked={report.acc_followup === 'มีการนัดหมาย'} className="w-3.5 h-3.5" /> มีการนัดหมาย</label>
              </div>
            </F>
            <F label="ครั้งที่นัดหมาย">
              <select disabled={d} name="acc_followup_count" defaultValue={report.acc_followup_count || '1'} className={CTL(d)}>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </F>
            {/* เช่นเดียวกับบล็อกตำรวจ — เดิมล้างเวลานัดหมายทิ้งทุกครั้งที่กดบันทึก */}
            {(() => { const flu = parseDatetime(report.acc_followup_date); return (
              <F label="วันที่นัดหมาย">
                <div className="flex items-center gap-1">
                  <input type="text" disabled={d} name="acc_followup_date" defaultValue={flu.date} className={`flex-1 min-w-0 border border-gray-300 rounded-none h-9 px-2.5 text-gray-800 ${d ? 'bg-gray-100' : 'bg-white'} text-sm`} />
                  <input type="text" maxLength={2} inputMode="numeric" onBlur={padTimeOnBlur} disabled={d} name="acc_followup_hour" defaultValue={flu.hour} className={`w-[2.125rem] shrink-0 border border-gray-300 rounded-none h-9 px-1 text-gray-800 ${d ? 'bg-gray-100' : 'bg-white'} text-sm text-center`} />
                  <span className="text-gray-400 shrink-0">:</span>
                  <input type="text" maxLength={2} inputMode="numeric" onBlur={padTimeOnBlur} disabled={d} name="acc_followup_minute" defaultValue={flu.minute} className={`w-[2.125rem] shrink-0 border border-gray-300 rounded-none h-9 px-1 text-gray-800 ${d ? 'bg-gray-100' : 'bg-white'} text-sm text-center`} />
                </div>
              </F>
            ); })()}
            <F label="รายละเอียดการนัดหมาย" span={4}>
              <input type="text" disabled={d} name="acc_followup_detail" defaultValue={report.acc_followup_detail || ''} className={CTL(d)} />
            </F>
          </div>

          </div>
          </div>

          {/* ===== คู่กรณี · ผู้บาดเจ็บ · ทรัพย์สินเสียหาย =====
              ทั้ง 3 หมวดแก้ได้เสมอ — โหมด "อ่านอย่างเดียว" ของ 3 หมวดนี้ถอดทิ้ง 03/09/69
              ตั้งแต่ 17/08/69 หน้านี้พิมพ์ได้ตลอด ไม่มีปุ่ม "แก้ไขทั้งหมด" แล้ว (isEditing = true คงที่)
              สาขาอ่านอย่างเดียวจึงไม่เคยถูกวาดอีกเลย · การล็อกตอนอนุมัติทำที่ <fieldset disabled>
              ที่ครอบทั้งหน้าอยู่แล้ว
              ⛔ การ์ดต้องโชว์เสมอแม้ยังไม่มีรายการ ไม่งั้นเคสที่ว่างจะกด "เพิ่ม" ไม่ได้ */}
          <div data-section="opp" className="border border-[var(--md-line)] bg-white">
            <SectionBar title={`คู่กรณี · ${opponents.length} คัน`} gap={(gapSec ?? []).includes('opp')} />
            <div className="bg-white overflow-hidden text-sm">
              <div className="p-4"><OpponentEditor items={opponents} onChange={setOpponents} /></div>
            </div>
          </div>

          <div data-section="inj" className="border border-[var(--md-line)] bg-white">
            <SectionBar title={`ผู้บาดเจ็บ · ${injured.length} คน`} gap={(gapSec ?? []).includes('inj')} />
            <div className="bg-white overflow-hidden text-sm">
              <div className="p-4"><InjuredEditor items={injured} onChange={setInjured} /></div>
            </div>
          </div>

          {/* ⛔ ไม่มีหมวด "ความเสียหายรถประกัน" ท้ายหน้าแล้ว (user สั่งถอด 03/09/69)
              มันลิสต์ค่าเดียวกัน (insured_damage) กับช่อง "ความเสียหายรถประกันภัย"
              + ปุ่ม "ข้อมูลความเสียหาย" ในหมวดผู้ขับขี่รถประกัน — แก้ที่ปุ่มนั้นที่เดียว */}
          <div data-section="prop" className="border border-[var(--md-line)] bg-white">
            <SectionBar title={`ทรัพย์สินเสียหาย · ${property.length} ชิ้น`} gap={(gapSec ?? []).includes('prop')} />
            <div className="bg-white overflow-hidden text-sm">
              <div className="p-4"><PropertyEditor items={property} onChange={setProperty} /></div>
            </div>
          </div>

          {/* ===== รายการตรวจสอบ (user ขอ 08/09/69) — ชุดเดียวกับ ISURVEY แท็บ 1 · เก็บ JSONB checklist (migration 057)
              ⛔ ช่องไม่มี name — ค่าไปกับ payload.checklist ตอนบันทึก (ไม่ผ่าน FormData) · ล็อกตามอนุมัติเหมือนหมวดอื่น
              ตอนอนุมัติวาดเป็นรูปเข้าหมวด "รูปรถประกัน" (prepareChecklistImage) และส่งกลับ ISURVEY เป็น chk_* ตอนปิดงาน */}
          <div data-section="chk" className="border border-[var(--md-line)] bg-white">
            <SectionBar title="รายการตรวจสอบ" gap={false}
              right={checklist.image_photo_id ? <span className="text-xs text-white/80">มีรูปในหมวดรูปรถประกันแล้ว</span> : undefined} />
            <div className="bg-white text-sm p-4 space-y-2.5">
              {CHECKLIST_ROWS.map((row, i) => (
                <div key={row.key} className="flex flex-wrap items-center gap-x-6 gap-y-1">
                  <span className="w-80 shrink-0 text-gray-700">{i + 1}. {row.label}:</span>
                  {row.options.map((o) => (
                    <label key={o.code} className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" disabled={previewing || approved} checked={checklist[row.key] === o.code}
                        onChange={() => setChecklist({ ...checklist, [row.key]: o.code })} />
                      <span>{o.label}</span>
                    </label>
                  ))}
                  {checklist[row.key] && !approved && !previewing && (
                    <button type="button" onClick={() => setChecklist({ ...checklist, [row.key]: '' })}
                      className="text-xs text-gray-400 hover:text-gray-600">ล้าง</button>
                  )}
                </div>
              ))}
              <div className="flex items-start gap-x-6">
                <span className="w-80 shrink-0 text-gray-700 pt-1">5. อื่นๆ:</span>
                <textarea disabled={previewing || approved} value={checklist.other} rows={2}
                  onChange={(e) => setChecklist({ ...checklist, other: e.target.value })}
                  className="flex-1 max-w-xl border border-gray-300 rounded-none px-2 py-1 text-sm" />
              </div>
              <div className="text-[0.6875rem] text-gray-500">
                กด "อนุมัติ" แล้วระบบจะวาดรายการที่เลือกเป็นรูปเข้าหมวด "รูปรถประกัน" ให้เอง และส่งค่ากลับ ISURVEY ตอนปิดงาน
              </div>
            </div>
          </div>

        </>
      )}

      {/* ── การ์ดรูปหลักฐาน ── จำนวนรูปบอกอะไรได้เยอะ เอามาไว้บนหัวการ์ดเลย
          งานที่ดึงจากระบบเก่าตอน "รอตรวจข้อมูล" รูปยังทยอยขึ้น (วัดจริง: 1–5 ใบ
          ตอนนั้น เทียบกับ 22–41 ใบตอนจบงาน) → ต้องเห็นตัวเลขก่อนกดอนุมัติ
          ไม่งั้นบอทยกเข้า EMCS ด้วยรูป 3 ใบแล้วต้องตามแก้ทีหลัง */}
      <div className="bg-white border border-[var(--md-line)] overflow-hidden">
        {/* แถบหัวเหมือนหมวดอื่น (พื้น #1E3E82 ตัวหนังสือขาว) — user เคาะ 03/09/69
            ของเดิมเป็นแถบเทาอ่อน หมวดรูปเลยดูเป็นของแถมทั้งที่เป็นหมวดที่ต้องดูก่อนอนุมัติ
            ⛔ ป้ายบนพื้นน้ำเงินต้องพื้นขาวตัวน้ำเงิน (กติกาเดียวกับป้าย "ยังกรอกไม่ครบ")
               ป้ายเทาบนน้ำเงินอ่านไม่ออก */}
        <div className="border-b-2 border-[var(--md-ink)] text-white px-4 py-2 text-sm flex flex-wrap items-center gap-x-3 gap-y-1"
             style={{ background: '#1E3E82' }}>
          <span className="text-[0.9375rem] font-bold">รูปหลักฐาน</span>
          <span className="bg-white text-[#1E3E82] rounded-none px-2 py-0.5 text-xs font-semibold">{photos?.length ?? 0} ใบ</span>
          {photoCats.length > 0 && (
            <span className="text-xs text-white/75 truncate">
              {photoCats.map((c) => `${c.name} ${c.n}`).join(' · ')}
            </span>
          )}
          {(photos?.length ?? 0) < 8 && (
            <span className="ml-auto text-xs font-semibold bg-amber-400 text-amber-950 rounded-none px-2 py-0.5">
              รูปน้อยผิดปกติ — เช็กว่าช่างส่งครบหรือยัง
            </span>
          )}
        </div>
        <div className="p-4">
          {/* onReviewSubmitted = โหลดเคสใหม่ทั้งก้อน — ใช้ซ้ำเพื่อให้รูปที่เพิ่งอัปโผล่ทันที
              (อนุมัติแล้วซ่อนแถบอัป — backend กันซ้ำอีกชั้นด้วย 423) */}
          <PhotoGallery photos={photos} caseId={approved ? undefined : caseData?.id}
                        onUploaded={onReviewSubmitted} />
        </div>
      </div>

      </div>{/* จบคอลัมน์ซ้าย */}

      {/* ── ค่าใช้จ่าย (คอลัมน์ขวาบนจอกว้าง) ──
          ลอยตามการเลื่อนหน้า (sticky) เพื่อให้กรอกยอดพร้อมกับดูข้อมูลเคสไปด้วยได้
          ถ้าการ์ดสูงเกินจอ ให้เลื่อนในตัวเองได้ ไม่งั้นแถวล่าง ๆ จะโดนตัดหายเลย
          ⛔ ห้ามถอดช่องยอดเงินออกจากหน้าตามขนาดจอเด็ดขาด — `survey_pay` บันทึกทั้งแถว
             ช่องที่ไม่ได้ถูกส่งไปด้วยจะกลายเป็น NULL คือยอดที่เคยกรอกไว้หายทั้งแถว */}
      {/* ⛔ ห้ามใส่ flex/w-1/2 กลับมา (แก้ 03/09/69) — ตกค้างจากสมัยที่รางนี้เคยวางคู่กับ
          การ์ดอีกใบ พอเหลือใบเดียวมันเลยกว้างครึ่งเดียวบนจอต่ำกว่า 1500px (โน้ตบุ๊ก 1366/1440)
          ตารางเงิน 4 คอลัมน์ถูกบีบ ส่วนอีกครึ่งจอว่างเปล่า · จอกว้างไม่เคยเห็นอาการนี้ */}
      <div className="min-[1500px]:sticky min-[1500px]:top-[4.25rem]
                      min-[1500px]:max-h-[calc(100vh-84px)] min-[1500px]:overflow-y-auto">
        <div className="w-full">

          {/* ── รางขวา = 2 การ์ดซ้อนกัน ──
              การ์ดบน: หัว "ค่าใช้จ่าย · ครั้งที่" (มาแทนหัวข้อ "การตรวจสอบ" ที่ถอดออก)
                       + 3 ช่องความเห็น เรียงตามที่ user กำหนด
                       ผลการดำเนินงาน → ความเห็นผู้ตรวจสอบ → ความเห็นเซอร์เวย์
              การ์ดล่าง: ตารางยอดเงิน — **แยกการ์ดจริง** เพื่อให้มีเงารอบกรอบของตัวเอง
                       (เดิมรวมการ์ดเดียวแล้วคั่นด้วยเงาด้านใน user บอกว่าอยากได้เงาของพื้นหลัง)
              แยกแล้วความกว้างตารางไม่เปลี่ยน — ทั้ง 2 การ์ดเต็มรางเท่ากัน ไม่ได้ซ้อนใน padding กัน
              รางแคบกว่าครึ่งจอเดิมมาก จึงวางช่องความเห็นเรียงลงล่างแทน 3 คอลัมน์ */}
          {/* key = บังคับสร้างใหม่ทั้งราง เมื่อสลับครั้งที่ — ช่องพวกนี้เป็น uncontrolled
              (defaultValue) ถ้าไม่สร้างใหม่ ค่าจะค้างของครั้งก่อนทั้งที่ข้อมูลเปลี่ยนแล้ว */}
          <div data-section="review" className="space-y-3" key={viewVisit ?? 'self'} ref={railRef}>
          <div className="bg-white border border-[var(--md-line)] overflow-hidden">
            {/* ── หัวการ์ด: ค่าใช้จ่าย · เลขเรื่องเซอร์เวย์ของครั้งนี้ · ตัวเลือกครั้งที่ ──
                ⛔ "ครั้งที่" ไม่ใช่รอบข้อมูลในเคสเดียว — **แต่ละครั้งเป็นคนละเคส**
                   เลือกครั้งอื่น = เปิดเคสนั้นแทน (ทั้งหน้าเปลี่ยนตาม ไม่ใช่แค่รางขวา)
                   จะสลับเฉพาะรางขวาไม่ได้ เพราะ 3 ช่องความเห็น + ยอดเงินอยู่ใน <form>
                   เดียวกับฟอร์มหลัก กดบันทึกทีเดียวจะเขียนข้อมูลของครั้งอื่นทับเคสที่เปิดอยู่ */}
            <div className="border-b-2 border-[var(--md-ink)] text-white px-4 py-2.5 text-sm flex flex-wrap items-center gap-x-3 gap-y-1"
                 style={{ background: '#1E3E82' }}>
              <span className="text-[0.9375rem] font-bold shrink-0">ค่าใช้จ่าย</span>
              <span className="text-[0.8125rem] font-bold truncate min-w-0" title="เลขเรื่องเซอร์เวย์ของครั้งนี้">
                {report?.survey_job_no || '—'}
              </span>
              <div className="ml-auto flex items-center gap-2 shrink-0">
                <span className="text-white/70 text-xs">ครั้งที่</span>
                {(visits ?? []).length > 1 ? (
                  <select value={String(viewVisit ?? caseData?.id ?? '')}
                    onChange={(e) => {
                      const to = Number(e.target.value);
                      if (!previewing) railDraft.current = readRail();
                      setViewVisit(to === Number(caseData?.id) ? null : to);
                    }}
                    className="border border-[var(--md-line-2)] rounded-none px-2 h-7 text-sm font-semibold text-[var(--md-ink)] bg-white">
                    {(visits ?? []).map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.visit_no}{v.survey_job_no ? ` · ${v.survey_job_no}` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="bg-[var(--md-bg)] text-[var(--md-ink)] rounded-none px-2 py-[0.0625rem] text-[0.8125rem] font-extrabold">{visitCount}</span>
                )}
                <input type="hidden" name="expense_count" value={visitCount} />
              </div>
              {previewing && (
                <div className="w-full flex flex-wrap items-center gap-2 border-t border-white/25 pt-1.5 mt-0.5">
                  <span className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded-none px-2 py-0.5">
                    กำลังดูครั้งที่ {String(pvv?.visit_no ?? '')} — อ่านอย่างเดียว แก้ที่นี่ไม่ได้
                  </span>
                  <button type="button" onClick={() => switchVisit(String(viewVisit))}
                    className="text-xs text-blue-700 hover:text-blue-900 hover:underline">
                    เปิดเคสครั้งนี้เพื่อแก้
                  </button>
                  <button type="button" onClick={() => setViewVisit(null)}
                    className="text-xs text-gray-600 hover:text-gray-900 hover:underline">
                    กลับไปครั้งที่ {visitCount}
                  </button>
                </div>
              )}
            </div>

          {/* ⛔ "ความเห็นของผู้ตรวจสอบ" มีที่เดียวเท่านั้น — 2 ช่องชื่อเดียวกันเมื่อไหร่
              ตัวบันทึกหยิบไปแค่ช่องเดียว แล้วอีกช่องหายเงียบ ๆ (มีการ์ดเทสจับชื่อช่องซ้ำทั้งไฟล์) */}
          <div className="p-4 space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm text-gray-500">ผลการดำเนินงาน</label>
                {/* ⛔ type="button" — ปุ่มในฟอร์มที่ไม่ระบุชนิด เบราว์เซอร์ถือเป็น submit
                    กดขยายกลายเป็นสั่งบันทึกทั้งเคส */}
                <button type="button" disabled={previewing}
                  onClick={() => openBig('survey_result', 'ผลการดำเนินงาน')}
                  className="text-xs text-blue-700 hover:text-blue-900 disabled:text-gray-400 disabled:cursor-not-allowed">
                  ⤢ ขยาย
                </button>
              </div>
              <textarea name="survey_result" disabled={previewing} defaultValue={repV?.survey_result || ''}
                className="w-full border border-gray-300 rounded-none px-2 py-1 text-gray-800 bg-white text-sm min-h-[6.875rem]" rows={4} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm text-gray-500">ความเห็นของผู้ตรวจสอบ</label>
                {/* ⛔ type="button" — ปุ่มในฟอร์มที่ไม่ระบุชนิด เบราว์เซอร์ถือเป็น submit
                    กดขยายกลายเป็นสั่งบันทึกทั้งเคส */}
                <button type="button" disabled={previewing}
                  onClick={() => openBig('review_comment', 'ความเห็นของผู้ตรวจสอบ')}
                  className="text-xs text-blue-700 hover:text-blue-900 disabled:text-gray-400 disabled:cursor-not-allowed">
                  ⤢ ขยาย
                </button>
              </div>
              <textarea name="review_comment" disabled={previewing} defaultValue={repV?.review_comment || (previewing ? '' : review?.comment) || ''}
                className="w-full border border-gray-300 rounded-none px-2 py-1 text-gray-800 bg-white text-sm min-h-[6.875rem]" rows={4} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm text-gray-500">ความเห็นของเซอร์เวย์</label>
                {/* ⛔ type="button" — ปุ่มในฟอร์มที่ไม่ระบุชนิด เบราว์เซอร์ถือเป็น submit
                    กดขยายกลายเป็นสั่งบันทึกทั้งเคส */}
                <button type="button" disabled={previewing}
                  onClick={() => openBig('surveyor_comment', 'ความเห็นของเซอร์เวย์')}
                  className="text-xs text-blue-700 hover:text-blue-900 disabled:text-gray-400 disabled:cursor-not-allowed">
                  ⤢ ขยาย
                </button>
              </div>
              <textarea name="surveyor_comment" disabled={previewing} defaultValue={repV?.surveyor_comment || (previewing ? '' : review?.surveyor_comment) || ''}
                className="w-full border border-gray-300 rounded-none px-2 py-1 text-gray-800 bg-white text-sm min-h-[6.875rem]" rows={4} />
            </div>
          </div>

          </div>{/* จบการ์ดบน */}

          {/* ── ราง 2 การ์ด: ขอบบาง ไม่มีเงา ไม่มีมุมมน ──
              แบบใหม่ (Claude Design 02/09/69) เลิกใช้เงาทั้งระบบ — ตัวคั่นการ์ดคือเส้นขอบ
              บนพื้นเทาอมน้ำตาลของหน้านี้ เส้น 1px #d7d3d3 เห็นชัดกว่าเงาจาง ๆ ที่เคยใช้
              (ของเดิมยกมาจาก Inspector Case 149.dc.html ซึ่งเลิกใช้แล้ว) */}
          <div className="bg-white border border-[var(--md-line)] p-4">
            <div>
              <table className="w-full text-sm table-fixed">
                {/* รางขวาแคบกว่าครึ่งจอเดิม — ช่อง "จำนวน" มีอินพุต+หน่วยอยู่ในบรรทัดเดียว
                    ถ้าไม่ขยายเปอร์เซ็นต์ให้ มันจะล้นไปทับคอลัมน์ข้าง ๆ (table-fixed ไม่ยืดให้) */}
                <colgroup>
                  <col className="w-[32%] min-[1500px]:w-[30%]" />
                  <col className="w-[20%] min-[1500px]:w-[24%]" />
                  {/* พื้นคอลัมน์เงิน 2 ฝั่ง — น้ำเงินทั้งคู่แต่คนละน้ำหนัก (อ่อน = จ่ายพนักงาน · เข้ม = เรียกเก็บประกัน)
                      ⛔ ถ้าแถวไหนมีพื้นหลังของตัวเอง (bg-* บน <tr>/<td>) จะทับพื้นคอลัมน์ทันที */}
                  <col className="w-[24%] min-[1500px]:w-[23%] bg-[#f4f7ff]" />
                  <col className="w-[24%] min-[1500px]:w-[23%] bg-[#d7e4fb]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-[var(--md-line)]">
                    <th className="px-3 min-[1500px]:px-2 py-2 text-left text-gray-600 font-semibold">รายละเอียด</th>
                    <th className="px-3 min-[1500px]:px-2 py-2 text-center text-gray-600 font-semibold">จำนวน</th>
                    {/* ฝั่งจ่ายพนักงาน — ระบบประกันไม่มีช่องนี้ ต้องเก็บที่ระบบเราเท่านั้น */}
                    <th className="px-3 min-[1500px]:px-2 py-2 text-center text-[var(--md-blue)] font-semibold">ราคาพนักงาน<div className="text-[0.625rem] font-normal text-[var(--md-blue-hover)]">
                      จ่ายผู้สำรวจ
                    </div></th>
                    {/* ⛔ ฝั่ง "ราคาประกัน" = ยอดเรียกเก็บบริษัทประกัน · ฝั่ง "ราคาพนักงาน" = ยอดจ่ายผู้สำรวจ
                        คนละกระเป๋าเงินกันคนละใบ — **ต้องแยกออกจากกันด้วยสายตา** (user เคาะ 02/09/69)
                        น้ำเงินทั้งคู่แต่ **คนละน้ำหนักทั้งชุด** (พื้นคอลัมน์ + ขอบช่อง + ตัวเลข + ยอดรวม)
                        อ่อน = จ่ายพนักงาน · เข้ม = เรียกเก็บประกัน
                        ⛔ ต่างกันแค่ตัวหนังสือไม่พอ — ของเดิมทำแบบนั้นแล้วดูเผิน ๆ เหมือนคอลัมน์เดียวกัน
                           ต้องต่างที่ "พื้นคอลัมน์" ด้วยเสมอ */}
                    <th className="px-3 min-[1500px]:px-2 py-2 text-center text-blue-950 font-semibold">ราคาประกัน<div className="text-[0.625rem] font-normal text-blue-800">เรียกเก็บประกัน</div></th>
                  </tr>
                </thead>
                <tbody>
                  {/* ค่าบริการเป็น "ครั้ง" เสมอ และเรทที่เติมให้คือเรทของ 1 ครั้ง — เติม 1 ให้เลย
                      (user เคาะ 01/09/69) · หัวหน้าแก้เป็นเลขอื่นได้ถ้าเคสนี้ไปหลายรอบ
                      ⛔ ดูครั้งอื่นอยู่ (previewing) = อ่านอย่างเดียว ห้ามเติม ไม่งั้นครั้งที่ยังไม่ได้กรอก
                         จะดูเหมือนกรอกไว้แล้ว 1 ครั้ง */}
                  <tr className="border-b border-gray-100">
                    <td className="px-3 min-[1500px]:px-2 py-2 text-gray-700">ค่าบริการ</td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5"><input type="text" disabled={previewing} name="service_fee_count" defaultValue={exV.service_fee_count || (previewing ? '' : '1')} className="w-[3.125rem] max-w-full min-[1500px]:w-[2.75rem] border border-gray-300 rounded-none px-2 py-1 text-gray-800 bg-white text-sm text-center" /><span className="text-gray-500 w-[1.875rem] min-[1500px]:w-[1.75rem]">ครั้ง</span></div></td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={dPay} name="pay_service_fee" defaultValue={zeroBlank(payV?.saved?.service_fee)} className={`w-full border rounded-none px-2 py-1 text-sm text-right ${dPay ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-blue-300 text-blue-800'}`} /></td><td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={previewing} name="service_fee_price" defaultValue={zeroBlank(exV.service_fee_price) || (insService ? String(insService) : '')} className="w-full border border-blue-600 rounded-none px-2 py-1 text-blue-950 bg-white text-sm text-right" /></td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-3 min-[1500px]:px-2 py-2 text-gray-700">ค่าเดินทาง/ค่าพาหนะ</td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5"><input type="text" disabled={previewing} name="travel_fee_count" defaultValue={exV.travel_fee_count || ''} className="w-[3.125rem] max-w-full min-[1500px]:w-[2.75rem] border border-gray-300 rounded-none px-2 py-1 text-gray-800 bg-white text-sm text-center" /><span className="text-gray-500 w-[1.875rem] min-[1500px]:w-[1.75rem]">ครั้ง</span></div></td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={dPay} name="pay_travel_fee" defaultValue={zeroBlank(payV?.saved?.travel_fee)} className={`w-full border rounded-none px-2 py-1 text-sm text-right ${dPay ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-blue-300 text-blue-800'}`} /></td><td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={previewing} name="travel_fee_price" defaultValue={zeroBlank(exV.travel_fee_price) || (insTravel ? String(insTravel) : '')} className="w-full border border-blue-600 rounded-none px-2 py-1 text-blue-950 bg-white text-sm text-right" /></td>
                  </tr>
                  {/* บอกที่มาของเรทฝั่งประกันที่เติมให้ — ไม่งั้นหัวหน้าเห็นเลขโผล่มาเองแล้วไม่รู้ว่าเชื่อได้ไหม
                      (ขึ้นเฉพาะตอนเป็นค่าที่ระบบเติม ไม่ใช่ตอนหัวหน้ากรอกเอง — แบบเดียวกับค่ารูปเหมา) */}
                  {(insService || insTravel) && (
                    <tr className="border-b border-gray-100">
                      <td colSpan={4} className="px-3 min-[1500px]:px-2 pb-2 pt-0 text-[0.6875rem] text-gray-500">
                        {`เรทฝั่งประกันเติมให้จากตารางเรท${pay?.area?.district_name ? ` ${pay.area.district_name}` : ''}`}
                        {repV?.claim_type ? ` · ${CLAIM_TYPE_LABELS[repV.claim_type as keyof typeof CLAIM_TYPE_LABELS] ?? repV.claim_type}` : ''}
                        {' — แก้ทับได้ถ้าเคสนี้ต่างออกไป'}
                      </td>
                    </tr>
                  )}
                  <tr className="border-b border-gray-100">
                    <td className="px-3 min-[1500px]:px-2 py-2 text-gray-700">
                      ค่ารูปถ่าย
                      {liveSum.photo > 0 && (
                        <div className="text-[0.6875rem] text-gray-500 tabular-nums whitespace-nowrap">{liveSum.photoCount} รูป × {baht(liveSum.photoUnit)} ต่อรูป</div>
                      )}
                    </td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5"><input type="text" disabled={previewing} name="photo_fee_count" defaultValue={exV.photo_fee_count || (photoFee?.count ? String(photoFee.count) : '')} title={photoFee?.reason} className="w-[3.125rem] max-w-full min-[1500px]:w-[2.75rem] border border-gray-300 rounded-none px-2 py-1 text-gray-800 bg-white text-sm text-center" /><span className="text-gray-500 w-[1.875rem] min-[1500px]:w-[1.75rem]">รูป</span></div></td>
                    {/* ⛔ ล็อกถาวร — **พนักงานไม่มีค่ารูป** ค่ารูปเป็นของฝั่งเรียกเก็บประกันเท่านั้น
                        (user เคาะ 20/08/69) · disabled = ไม่ติดไปกับ FormData ด้วย
                        ยอดเก่าที่เคยกรอกผิดไว้จึงถูกล้างเป็นค่าว่างตอนบันทึกครั้งถัดไป */}
                    <td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled name="pay_photo_fee" defaultValue="" title="พนักงานไม่มีค่ารูป — ค่ารูปเบิกได้เฉพาะฝั่งประกัน" className="w-full border rounded-none px-2 py-1 text-sm text-right bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed" /></td>
                    <td className="px-3 min-[1500px]:px-2 py-2">
                      {/* ช่องที่เห็น = ยอดค่ารูปที่เรียกเก็บ (จำนวนรูป × ราคาต่อรูป) — user 07/09/69: คอลัมน์ "ราคาประกัน" ต้องเป็นเงินที่เก็บจริง (50)
                          ไม่ใช่ราคาต่อรูป (5) · ที่บันทึกยังเป็น "ราคาต่อรูป" ใน photo_fee_price (hidden) — syncPhotoFee คิดให้ทั้งสองทาง */}
                      {/* ⛔ ห้ามใช้ type="hidden" — input hidden ใช้ value แบบ "default mode": React รีเรนเดอร์ทีไร (setLiveSum) จะเซ็ต defaultValue กลับ
                          ทำให้ค่าที่ syncPhotoFee เพิ่งคำนวณหายกลับเป็นค่าเดิม (เจอจริง 07/09/69: พิมพ์ 60 แล้วต่อรูปยังเป็น 5) → ใช้ text ที่ซ่อนด้วย CSS แทน */}
                      <input type="text" name="photo_fee_price" defaultValue={photoUnitDefault} className="hidden" tabIndex={-1} aria-hidden="true" />
                      <input type="text" disabled={previewing} name="photo_fee_total" defaultValue={photoTotalDefault} title={`ยอดค่ารูปที่เรียกเก็บประกัน = จำนวนรูป × ราคาต่อรูป — พิมพ์ยอดรวม ระบบคิดราคาต่อรูปให้${photoFee?.reason ? ` · ${photoFee.reason}` : ''}`} className="w-full border border-blue-600 rounded-none px-2 py-1 text-blue-950 bg-white text-sm text-right" />
                    </td>
                  </tr>
                  {/* บอกที่มาของตัวเลขที่เติมให้ — ไม่งั้นหัวหน้าเห็น 10/5 โผล่มาเองแล้วไม่รู้ว่ามาจากไหน
                      ⛔ ขึ้นเฉพาะตอน "เติมเลขให้จริง" เท่านั้น — บรรทัดกรณี "ไม่มีค่ารูป" ถอดออกแล้ว
                         (user เคาะ 02/09/69) เพราะงานกรุงเทพซึ่งเป็นงานส่วนใหญ่ไม่มีค่ารูป
                         บรรทัดนั้นจึงขึ้นแทบทุกเคสโดยไม่ได้บอกอะไรใหม่ */}
                  {photoFee && photoFee.count > 0 && (
                    <tr className="border-b border-gray-100">
                      <td colSpan={4} className="px-3 min-[1500px]:px-2 pb-2 pt-0 text-[0.6875rem] text-gray-500">
                        {`ค่ารูปเติมให้ตามกติกาเหมา: ${photoFee.reason} — แก้ทับได้ถ้าเคสนี้ต่างออกไป`}
                      </td>
                    </tr>
                  )}
                  <tr className="border-b border-gray-100">
                    <td className="px-3 min-[1500px]:px-2 py-2 text-gray-700">ค่าเรียกร้อง</td>
                    {/* 0.00 ในช่องเปอร์เซ็นต์ = ยังไม่ได้กำหนด ไม่ใช่ "ศูนย์เปอร์เซ็นต์" — โชว์ว่างไว้
                        ส่วนใหญ่พิมพ์ทับด้วย 5 หรือ 10 อยู่แล้ว (user แจ้ง 18/08/69) */}
                    <td className="px-3 min-[1500px]:px-2 py-2"><div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5"><input type="text" disabled={previewing} name="claim_fee_percent" defaultValue={pctBlank(exV.claim_fee_percent)} className="w-[3.125rem] max-w-full min-[1500px]:w-[2.75rem] border border-gray-300 rounded-none px-2 py-1 text-gray-800 bg-white text-sm text-center placeholder:text-gray-400" /><span className="text-gray-500 w-[1.875rem] min-[1500px]:w-[1.75rem]">%</span></div></td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={dPay} name="pay_claim_fee" defaultValue={zeroBlank(payV?.saved?.claim_fee)} className={`w-full border rounded-none px-2 py-1 text-sm text-right placeholder:text-gray-400 ${dPay ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-blue-300 text-blue-800'}`} /></td><td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={previewing} name="claim_fee_price" defaultValue={zeroBlank(exV.claim_fee_price)} className="w-full border border-blue-600 rounded-none px-2 py-1 text-blue-950 bg-white text-sm text-right placeholder:text-gray-400" /></td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-3 min-[1500px]:px-2 py-2 text-gray-700">ค่าคัดประจำวัน</td>
                    {/* ── ผลคัดประจำวันย้ายมาอยู่แถวเดียวกับยอด ── (user ขอ 01/09/69)
                        เดิมอยู่ในแถวตัวปรับใต้ตาราง คนละที่กับยอดของมันเอง
                        เลือกผลแล้วเติมเรทให้ทั้ง 2 ฝั่งเลย */}
                    <td className="px-3 min-[1500px]:px-2 py-2">
                      <div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5">
                        {/* ⛔ key จำเป็น — ยอดเงินโหลดมาทีหลัง (async) ตอน render แรกยังว่าง
                            React ไม่เอา defaultValue ของ <select> มาใส่ซ้ำเมื่อ props เปลี่ยน
                            (ต่างจาก <input>) ช่องนี้จะค้างที่ "ไม่มี" ตลอด แล้วพอกดบันทึก
                            ก็เขียนค่าว่างทับของเดิมใน survey_pay + rate_snapshot */}
                        <select key={`dc-${String(payV?.saved?.daily_check ?? '')}`}
                          disabled={dPay} name="daily_check" defaultValue={String(payV?.saved?.daily_check ?? '')}
                          onChange={(e) => {
                            const v = e.currentTarget.value;
                            const put = (n: string, val: string) => {
                              const el = railRef.current?.querySelector<HTMLInputElement>(`[name="${n}"]`);
                              if (el && !el.disabled) el.value = val;
                            };
                            put('pay_daily_fee', v ? String(DAILY_FEE_PAY) : '');
                            put('daily_record_fee', v ? String(DAILY_FEE_INS[v] ?? '') : '');
                            /** ⛔ ตัวฟังที่รางทำงานก่อน onChange ของ React — ต้องคิดยอดใหม่เอง */
                            recalcSums();
                          }}
                          className={`w-[5.25rem] max-w-full min-[1500px]:w-[4.75rem] border rounded-none px-1.5 py-1 text-sm ${dPay ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-gray-300 text-gray-800'}`}>
                          <option value="">ไม่มี</option>
                          <option value="ถูก">ถูก</option>
                          <option value="ผิด">ผิด</option>
                          <option value="รอผล">รอผล</option>
                        </select>
                      </div>
                    </td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={dPay} name="pay_daily_fee" defaultValue={zeroBlank(payV?.saved?.daily_fee)} className={`w-full border rounded-none px-2 py-1 text-sm text-right ${dPay ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-blue-300 text-blue-800'}`} /></td><td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={previewing} name="daily_record_fee" defaultValue={zeroBlank(exV.daily_record_fee)} className="w-full border border-blue-600 rounded-none px-2 py-1 text-blue-950 bg-white text-sm text-right" /></td>
                  </tr>
                  <tr className="border-b border-gray-100">
                    <td className="px-3 min-[1500px]:px-2 py-2 text-gray-700">ค่าใช้จ่ายอื่นๆ</td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={previewing} name="other_fee_detail" defaultValue={exV.other_fee_detail || ''} className="w-full border border-gray-300 rounded-none px-2 py-1 text-gray-800 bg-white text-sm" /></td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={dPay} name="pay_other_fee" defaultValue={zeroBlank(payV?.saved?.other_fee)} className={`w-full border rounded-none px-2 py-1 text-sm text-right ${dPay ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-blue-300 text-blue-800'}`} /></td><td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={previewing} name="other_fee_price" defaultValue={zeroBlank(exV.other_fee_price)} className="w-full border border-blue-600 rounded-none px-2 py-1 text-blue-950 bg-white text-sm text-right" /></td>
                  </tr>
                  {/* หักเงิน — ระบบเดิมไม่มีแถวนี้ ต้องยืมช่อง "ค่าใช้จ่ายอื่นๆ" มาใช้
                      เพราะแทรกช่องใหม่ลงฟอร์มระบบเก่าไม่ได้ · เว็บนี้เราคุมเอง จึงแยกให้ถูกความหมาย */}
                  {/* สีกลาง ๆ ไม่ใช่สีเตือน — หักเงินไม่ใช่ช่องบังคับ (user เคาะ 17/08/69)
                      สีแดงบนหน้านี้สงวนไว้ให้ "ยังกรอกไม่ครบ" อย่างเดียว จะได้ไม่เตือนหลอก */}
                  <tr className="border-b border-gray-100">
                    <td className="px-3 min-[1500px]:px-2 py-2 text-gray-700">หักเงิน</td>
                    <td className="px-3 min-[1500px]:px-1 py-2">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-700">
                        <label className="flex items-center gap-1 min-w-0 [overflow-wrap:anywhere]">
                          {/* ⛔ key จำเป็นเหมือน "ค่าคัดประจำวัน" — React ไม่เอา defaultChecked
                              มาใส่ซ้ำเมื่อยอดเงินโหลดมาทีหลัง (async) ช่องติ๊กจึงว่างทั้งที่ DB
                              มีค่า true แล้วกดบันทึกทีเดียวล้างเป็น false = ยอดจ่ายหาย 50-100 บาท
                              และเหตุผลหักเงินหาย · เจอจากการทดสอบสด 19/08/69 */}
                          <input type="checkbox" disabled={dDeduct} key={`deduct_late-${String(payV?.saved?.deduct_late ?? "")}`} name="deduct_late" defaultChecked={Boolean(payV?.saved?.deduct_late)} />ส่งช้า
                        </label>
                        <label className="flex items-center gap-1 min-w-0 [overflow-wrap:anywhere]">
                          <input type="checkbox" disabled={dDeduct} key={`deduct_docs-${String(payV?.saved?.deduct_docs ?? "")}`} name="deduct_docs" defaultChecked={Boolean(payV?.saved?.deduct_docs)} />งานไม่เรียบร้อย
                        </label>
                      </div>
                      {/* หักเงินแล้วต้องบอกเหตุผล (user ขอ 01/09/69) — ยอดที่หักไปโดยไม่มีเหตุผล
                          กำกับ ผู้สำรวจถามกลับมาก็ตอบไม่ได้ และ audit ย้อนหลังไม่รู้ว่าหักเพราะอะไร
                          · ช่อง "เหตุผลอื่น" ที่พิมพ์เองก็นับ ไม่ใช่บังคับให้ติ๊กเท่านั้น
                          · เตือนเฉย ๆ ไม่บล็อกการบันทึก — สีแดงบนหน้านี้แปลว่า "ยังกรอกไม่ครบ" */}
                      {liveSum.deduct > 0 && !liveSum.reasoned && (
                        <div className="mt-1 text-[0.6875rem] text-red-600">{'⚠ เลือกเหตุผล "หักเงิน"'}</div>
                      )}
                    </td>
                    {/* สลับให้ตรงกับแถวอื่น: คอลัมน์ 3 = ฝั่งพนักงาน · คอลัมน์ 4 = ฝั่งเรียกเก็บประกัน */}
                    <td className="px-3 min-[1500px]:px-2 py-2">
                      <input type="text" disabled={dDeduct} name="pay_deduct_fee" defaultValue={zeroBlank(payV?.saved?.deduct_fee)}
                        className={`w-full border rounded-none px-2 py-1 text-sm text-right ${dDeduct ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-gray-300 text-gray-800'}`} />
                      {/* ขากลับ: เลือกเหตุผลไว้แล้วแต่ยังไม่ใส่ยอด = ตั้งใจจะหักแต่ลืมกรอก
                          ยอดจะเป็น 0 ทั้งที่ในบันทึกมีเหตุผลหักเงินค้างอยู่ (user ขอ 01/09/69) */}
                      {liveSum.deduct === 0 && liveSum.reasoned && (
                        <div className="mt-1 text-[0.6875rem] text-red-600">{'⚠ กรอกยอด "หักเงิน"'}</div>
                      )}
                    </td>
                    <td className="px-3 min-[1500px]:px-2 py-2">
                      <input type="text" disabled={dDeduct} name="deduct_reason" placeholder="เหตุผลอื่น"
                        defaultValue={String(payV?.saved?.deduct_reason ?? '')}
                        className={`w-full border rounded-none px-2 py-1 text-sm ${dDeduct ? 'bg-gray-100 border-gray-300' : 'bg-white border-gray-300'}`} />
                    </td>
                  </tr>
                  {/* ── ตัวปรับเรทฝั่งพนักงาน ── ของเดิมอยู่ในส่วนขยายเบราว์เซอร์บนหน้าระบบเก่า

                      อยู่เหนือแถว "รวมยอด" (user ขอ 01/09/69) — 3 ตัวนี้บวก/ลบเข้ายอดฝั่งพนักงาน
                      วางไว้ก่อน จะได้อ่านไล่ลงมาแล้วจบที่ยอดรวมพอดี
                      ⛔ อยู่ในตารางแล้ว ต้องห่อด้วย <tr><td colSpan={4}> ไม่ใช่ <div> ลอย ๆ —
                         เบราว์เซอร์ดีด node ที่ไม่ใช่แถวออกไปนอก <table> เอง แล้วเลย์เอาต์เพี้ยน */}
                  <tr>
                    <td colSpan={4} className="px-3 min-[1500px]:px-2 pb-2">
                      <div className="mt-3 border-t border-[var(--md-line)] pt-3 text-sm">
                        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                          {/* ── ยอดนอกพื้นที่/นอกเวลาแก้เองได้ ── (user ขอ 01/09/69)
                              ค่าตั้งต้น 50/100 เป็นแค่ค่าปกติ บางเคสจ่ายมากกว่านั้น
                              ว่างไว้ = ใช้ค่าตั้งต้น (กติกาเดียวกับฝั่ง backend) */}
                          <div className="flex items-center gap-1.5">
                            <label className="flex items-center gap-1.5">
                              <input type="checkbox" disabled={dPay} key={`out_of_area-${String(payV?.saved?.out_of_area ?? "")}`} name="out_of_area" defaultChecked={Boolean(payV?.saved?.out_of_area)}
                                onChange={(e) => {
                                  const amt = railRef.current?.querySelector<HTMLInputElement>('[name="out_of_area_amt"]');
                                  if (amt) amt.value = e.currentTarget.checked ? (amt.value.trim() || String(OUT_OF_AREA_AMT)) : '';
                                  /** ⛔ ต้องเรียกเอง — ตัวฟังที่รางทำงาน**ก่อน** onChange ของ React
                                   *  (native bubble ถึง div ก่อนถึง root) ยอดจะคิดจากค่าเก่าไปหนึ่งจังหวะ */
                                  recalcSums();
                                }} />
                              <span className="text-gray-700">นอกพื้นที่</span>
                            </label>
                            {/* ⛔ ช่องยอดต้องอยู่ **นอก** <label> — อยู่ในนั้นคลิกเพื่อพิมพ์จะไปสลับช่องติ๊กแทน
                                ⛔ key จำเป็นเหมือนช่องติ๊ก ยอดเงินโหลดมาทีหลัง (async) React ไม่เอา
                                   defaultValue มาใส่ซ้ำ ช่องจะว่างแล้วบันทึกทับของเดิมเป็นค่าตั้งต้น */}
                            <input type="text" disabled={dPay} name="out_of_area_amt"
                              key={`ooa-${String(payV?.saved?.out_of_area ?? '')}-${String(payV?.saved?.out_of_area_amt ?? '')}`}
                              defaultValue={amtText(payV?.saved?.out_of_area_amt)
                                || (payV?.saved?.out_of_area ? String(OUT_OF_AREA_AMT) : '')}
                              title="ยอดที่จ่ายจริงของเคสนี้ (ปกติ 50 บาท)"
                              className={`w-[5rem] border rounded-none px-1.5 py-0.5 text-sm text-right ${dPay ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-blue-300 text-blue-800'}`} />
                            <span className="text-xs text-gray-400">บาท</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <label className="flex items-center gap-1.5">
                              <input type="checkbox" disabled={dPay} key={`out_of_hours-${String(payV?.saved?.out_of_hours ?? "")}`} name="out_of_hours" defaultChecked={Boolean(payV?.saved?.out_of_hours)}
                                onChange={(e) => {
                                  const amt = railRef.current?.querySelector<HTMLInputElement>('[name="out_of_hours_amt"]');
                                  if (amt) amt.value = e.currentTarget.checked ? (amt.value.trim() || String(OUT_OF_HOURS_AMT)) : '';
                                  /** ⛔ ต้องเรียกเอง — ตัวฟังที่รางทำงาน**ก่อน** onChange ของ React
                                   *  (native bubble ถึง div ก่อนถึง root) ยอดจะคิดจากค่าเก่าไปหนึ่งจังหวะ */
                                  recalcSums();
                                }} />
                              <span className="text-gray-700">นอกเวลา</span>
                            </label>
                            {/* ⛔ ช่องยอดต้องอยู่ **นอก** <label> — อยู่ในนั้นคลิกเพื่อพิมพ์จะไปสลับช่องติ๊กแทน
                                ⛔ key จำเป็นเหมือนช่องติ๊ก ยอดเงินโหลดมาทีหลัง (async) React ไม่เอา
                                   defaultValue มาใส่ซ้ำ ช่องจะว่างแล้วบันทึกทับของเดิมเป็นค่าตั้งต้น */}
                            <input type="text" disabled={dPay} name="out_of_hours_amt"
                              key={`ooh-${String(payV?.saved?.out_of_hours ?? '')}-${String(payV?.saved?.out_of_hours_amt ?? '')}`}
                              defaultValue={amtText(payV?.saved?.out_of_hours_amt)
                                || (payV?.saved?.out_of_hours ? String(OUT_OF_HOURS_AMT) : '')}
                              title="ยอดที่จ่ายจริงของเคสนี้ (ปกติ 100 บาท)"
                              className={`w-[5rem] border rounded-none px-1.5 py-0.5 text-sm text-right ${dPay ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-blue-300 text-blue-800'}`} />
                            <span className="text-xs text-gray-400">บาท</span>
                          </div>
                        </div>
                        {pay?.area && (pay.area.resolved ? (
                          <div className="mt-2 text-xs text-gray-500">
                            เรทของ {pay.area.province_name} / {pay.area.district_name}
                            {pay.suggest?.snapshot?.rate_from === 'tumbon_by_team' ? ` / ตำบลพิเศษ ${pay.area.subdistrict_name ?? ''}` : ''}
                            {pay.area.rate_location === 'survey' ? ' (สถานที่ออกตรวจสอบ)' : pay.area.rate_location === 'accident' ? ' (สถานที่เกิดเหตุ — เคสนี้ไม่มีสถานที่ออกตรวจสอบ)' : ''}
                            {pay.area.team ? ` · ทีม${pay.area.team}` : ''}
                            {pay.suggest?.service_fee != null ? ` · ระบบแนะนำค่าบริการ ${pay.suggest.service_fee} บาท` : ''}
                            {pay.saved?.total != null ? ` · รวมที่บันทึกไว้ ${pay.saved.total} บาท` : ''}
                            {/* ── หาเรทฝั่งพนักงานไม่ได้ ต้องบอกสาเหตุ ── (user เจอ #267 10/09/69: ช่องค่าบริการว่างเงียบ ๆ)
                                ศรีราชา/บ่อวิน จ่ายแยกตามทีม แต่ช่าง SEC481 ไม่มีทีมในตารางเรท → เดิมตอบ "0 บาท" แล้วไม่เติมช่อง
                                ตอนนี้ backend ตอบ null + team_needed/team_rates ให้บอกว่าต้องไปกำหนดทีมที่หน้าแอดมิน */}
                            {pay.suggest && pay.suggest.service_fee == null && pay.suggest.snapshot?.rate_from === 'ไม่พบเรท' && (
                              <div className="mt-1 text-amber-700 bg-amber-50 border border-amber-200 rounded-none px-2 py-1">
                                {pay.suggest.snapshot?.team_needed
                                  ? `หาเรทฝั่งพนักงานไม่ได้: ${pay.area.district_name ?? 'พื้นที่นี้'} จ่ายแยกตามทีม (${(pay.suggest.snapshot.team_rates as string[] | undefined ?? []).join(' / ')}) แต่ผู้สำรวจ${pay.area.surveyor_code ? ` ${pay.area.surveyor_code}` : ''} ยังไม่ได้กำหนดทีม — แอดมินกำหนดที่ "เรทค่าตอบแทน › ทีมผู้สำรวจ" แล้วเปิดหน้านี้ใหม่ หรือกรอกค่าบริการเอง`
                                  : 'ไม่พบเรทฝั่งพนักงานของพื้นที่นี้ในตารางเรท — กรอกค่าบริการเอง หรือให้แอดมินเพิ่มเรทที่ "เรทค่าตอบแทน"'}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-none px-2 py-1">
                            แปลงจังหวัด/อำเภอของเคสนี้เป็นรหัสพื้นที่ไม่ได้ — หาเรทอัตโนมัติไม่ได้ กรอกยอดเองได้ตามปกติ
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                  {/* ── 2 ช่องที่แทบไม่ได้ใช้ พับเก็บไว้ ── (user ขอ 01/09/69)
                      ยังต้องมีช่องอยู่ เผื่อเคสที่ใช้จริง แค่ไม่ต้องเกะกะทุกเคส

                      ⛔ **ซ่อนด้วย CSS เท่านั้น ห้ามถอด <tr> ออกจาก DOM** — ตอนบันทึกอ่านค่าจาก
                         FormData ของฟอร์มทั้งใบ ช่องที่ไม่อยู่ใน DOM = ไม่มีคีย์ใน payload
                         แล้ว pay.service เขียนทับเป็น null ทั้งคอลัมน์ = ยอดที่เคยกรอกไว้หายเงียบ
                      ⛔ type="button" ต้องมี — ปุ่มในฟอร์มไม่ระบุชนิด เบราว์เซอร์ถือเป็น submit
                         กดดูช่องที่ซ่อนอยู่กลายเป็นสั่งบันทึกทั้งเคส */}
                  <tr className="border-b border-gray-100">
                    <td colSpan={4} className="px-3 min-[1500px]:px-2 py-1.5">
                      <button type="button" onClick={() => setExtraOpen((v) => !v)}
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800">
                        <span className="text-[0.625rem] w-3">{extraOpen ? '▾' : '▸'}</span>
                        ค่าโทรศัพท์ · ค่าประกันตัว
                        {hasExtra && <span className="text-amber-700">— มีกรอกไว้</span>}
                      </button>
                    </td>
                  </tr>
                  <tr className={`border-b border-gray-100 ${extraOpen ? '' : 'hidden'}`}>
                    <td className="px-3 min-[1500px]:px-2 py-2 text-gray-700">ค่าโทรศัพท์</td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><div className="flex items-center justify-center gap-1"><span className="w-[3.125rem] min-[1500px]:w-[2.75rem]"></span><span className="w-[1.875rem] min-[1500px]:w-[1.75rem]"></span></div></td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={dPay} name="pay_phone_fee" defaultValue={zeroBlank(payV?.saved?.phone_fee)} className={`w-full border rounded-none px-2 py-1 text-sm text-right ${dPay ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-blue-300 text-blue-800'}`} /></td><td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={previewing} name="phone_fee" defaultValue={zeroBlank(exV.phone_fee)} className="w-full border border-blue-600 rounded-none px-2 py-1 text-blue-950 bg-white text-sm text-right" /></td>
                  </tr>
                  <tr className={`border-b border-gray-100 ${extraOpen ? '' : 'hidden'}`}>
                    <td className="px-3 min-[1500px]:px-2 py-2 text-gray-700">ค่าประกันตัว</td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><div className="flex items-center justify-center gap-1"><span className="w-[3.125rem] min-[1500px]:w-[2.75rem]"></span><span className="w-[1.875rem] min-[1500px]:w-[1.75rem]"></span></div></td>
                    <td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={dPay} name="pay_bail_fee" defaultValue={zeroBlank(payV?.saved?.bail_fee)} className={`w-full border rounded-none px-2 py-1 text-sm text-right ${dPay ? 'bg-gray-100 border-gray-300 text-gray-800' : 'bg-white border-blue-300 text-blue-800'}`} /></td><td className="px-3 min-[1500px]:px-2 py-2"><input type="text" disabled={previewing} name="bail_fee" defaultValue={zeroBlank(exV.bail_fee)} className="w-full border border-blue-600 rounded-none px-2 py-1 text-blue-950 bg-white text-sm text-right" /></td>
                  </tr>
                </tbody>
                {/* ── รวมยอดของแต่ละฝั่ง ── คิดสดจากช่องที่กำลังกรอก (user ขอ 01/09/69)
                    ⛔ แสดงอย่างเดียว ห้ามมี name — เหตุผลเต็มอยู่ที่ liveSum ข้างบน */}
                <tfoot>
                  <tr className="border-t-2 border-[var(--md-ink)]">
                    <td className="px-3 min-[1500px]:px-2 py-2 font-semibold text-gray-800">รวมยอด</td>
                    <td className="px-3 min-[1500px]:px-2 py-2 text-center text-[0.6875rem] text-gray-400">ยังไม่รวม VAT</td>
                    <td className="px-3 min-[1500px]:px-2 py-2 text-right font-bold text-[var(--md-blue)] tabular-nums">{baht(liveSum.pay)}</td>
                    <td className="px-3 min-[1500px]:px-2 py-2 text-right font-bold text-blue-950 tabular-nums">{baht(liveSum.ins)}</td>
                  </tr>
                  {/* นอกพื้นที่/นอกเวลาเป็นช่องติ๊ก · หักเงินอยู่คนละคอลัมน์กับยอด — ถ้าไม่บอก
                      หัวหน้าจะบวกเลขตามคอลัมน์แล้วไม่ตรงกับยอดรวม แล้วนึกว่าระบบคิดผิด */}
                  {(liveSum.area > 0 || liveSum.hours > 0 || liveSum.deduct > 0) && (
                    <tr>
                      <td colSpan={4} className="px-3 min-[1500px]:px-2 pb-2 pt-0 text-[0.6875rem] text-gray-500">
                        {`ยอดฝั่งพนักงานรวม ${[
                          liveSum.area > 0 ? `นอกพื้นที่ +${liveSum.area}` : null,
                          liveSum.hours > 0 ? `นอกเวลา +${liveSum.hours}` : null,
                          liveSum.deduct > 0 ? `หักเงิน −${baht(liveSum.deduct)}` : null,
                        ].filter(Boolean).join(' · ')} ไว้แล้ว`}
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
              {/**
                * ── ประวัติการแก้ยอดเงิน ──
                * มีไว้แยกให้ออกว่า "คนแก้" หรือ "บั๊กกลืนข้อมูล" — เดือน ส.ค. 69 เดือนเดียว
                * เจอบั๊กที่ยอดหายเงียบ ๆ 2 ตัว กว่าจะรู้ต้องมีคนบังเอิญสังเกต
                */}
              <div className="mt-3 border-t border-[var(--md-line)] pt-2 text-sm">
                <button type="button"
                  onClick={async () => {
                    const next = !auditOpen;
                    setAuditOpen(next);
                    if (next && audit === null) await loadAudit();
                  }}
                  className="text-gray-500 hover:text-gray-700">
                  {auditOpen ? '▾' : '▸'} ประวัติการแก้ยอดเงิน
                </button>
                {auditOpen && (
                  audit === null ? <div className="text-xs text-gray-400 mt-1">กำลังโหลด...</div>
                  : audit.length === 0 ? (
                    <div className="text-xs text-gray-400 mt-1">
                      ยังไม่มีประวัติ — เริ่มเก็บตั้งแต่ 24/08/69 การแก้ก่อนหน้านั้นไม่ได้บันทึกไว้
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1 max-h-56 overflow-y-auto pr-1">
                      {audit.map((a2, i) => (
                        <div key={i} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                          <span className="text-gray-400 tabular-nums">{a2.at}</span>
                          <span className="text-gray-700">{a2.by_name}</span>
                          <span className="text-gray-400">·</span>
                          <span className="text-gray-500">{a2.side}</span>
                          <span className="font-medium text-gray-800">{a2.label}</span>
                          <span className="text-gray-500">
                            {a2.old_value ?? '(ว่าง)'} <span className="text-gray-400">→</span>{' '}
                            {/* ยอดที่หายไปเฉย ๆ คือสัญญาณที่ต้องเห็นชัดที่สุด */}
                            <span className={a2.new_value ? 'text-gray-800' : 'text-red-600 font-medium'}>
                              {a2.new_value ?? '(ว่าง)'}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>

              {/* ยอดสะสมทั้งเคลม — EMCS มีช่องนี้อยู่ (ยอดรวมข้ามทุกครั้งของเลขเคลมเดียวกัน)
                  ฝั่งเราคิดจากทุกเคสที่เลขเคลมเดียวกัน · ยังไม่รวม VAT เพราะระบบเราไม่ได้เก็บ */}
              {(visits ?? []).length > 1 && (
                <div className="mt-3 border-t border-[var(--md-line)] pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-semibold text-gray-700">ยอดสะสมทั้งเคลม</span>
                  <span className="text-gray-500">{(visits ?? []).length} ครั้ง</span>
                  <span className="text-blue-800">พนักงาน {claimTotals.pay.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                  <span className="text-blue-900 font-medium">ประกัน {claimTotals.ins.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                  <span className="text-xs text-gray-400">(ยังไม่รวม VAT)</span>
                </div>
              )}

            </div>
          </div>
        </div>
        </div>
      </div>
      </div>{/* จบ grid 2 คอลัมน์ */}
      </fieldset>

      {/* ── กล่องเขียนความเห็นแบบเต็มจอ ── (user ขอ 01/09/69)
          อยู่นอก <form> ไม่ได้ (โครงหน้าเป็นก้อนเดียว) จึงต้องระวัง 2 อย่าง:
          textarea ห้ามมี name · ปุ่มทุกตัวต้อง type="button" */}
      {bigEdit && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setBigEdit(null)}>
          <div className="bg-white shadow-xl w-full max-w-4xl flex flex-col"
            style={{ maxHeight: '90vh' }} onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-[var(--md-line)] flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">{bigEdit.label}</h3>
              <span className="text-xs text-gray-400">{bigDraft.length.toLocaleString('th-TH')} ตัวอักษร</span>
            </div>
            <div className="p-4 flex-1 overflow-auto">
              {/* ⛔ ห้ามใส่ name — อยู่ใน <form> เดียวกับฟอร์มหลัก มี name แล้ว FormData
                  จะเก็บ 2 ค่าชื่อเดียวกัน ตัวหลังทับตัวแรกเงียบ ๆ */}
              <textarea autoFocus value={bigDraft} onChange={(e) => setBigDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setBigEdit(null); }}
                className="w-full border border-gray-300 rounded-none px-3 py-2 text-gray-800 bg-white text-sm leading-relaxed"
                style={{ height: '60vh' }} />
            </div>
            <div className="px-4 py-3 border-t border-[var(--md-line)] flex items-center justify-end gap-2">
              <button type="button" onClick={() => setBigEdit(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">ยกเลิก</button>
              <button type="button" onClick={applyBig}
                className="px-5 py-2 text-sm bg-blue-600 text-white rounded-none hover:bg-blue-700">เสร็จ</button>
            </div>
          </div>
        </div>
      )}

      <DamageDialog open={dmgOpen} items={damage} disabled={approved}
        onClose={() => setDmgOpen(false)} onSave={setDamage} />

    </form>
  );
}
