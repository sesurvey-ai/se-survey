'use client';

/**
 * แก้ "ผู้บาดเจ็บ" + "ทรัพย์สินเสียหาย" บนหน้าตรวจงาน
 *
 * จำเป็นเพราะ: เคสที่นำเข้าจากไฟล์ XML ของ ISURVEY ได้ข้อมูลสองส่วนนี้มาไม่ครบ —
 * ไฟล์จริง 5 ไฟล์ไม่เคยมี HOS_NAME/INCOME/POSITION/WORK_PLACE/FROM_DATE/TO_DATE/COST เลย
 * และ PERSON_TYPE ฝั่งคู่กรณี (02/04) กู้จาก XML ไม่ได้เพราะ export ยุบเหลือ DV/PV/ON
 * ก่อนหน้านี้เว็บโชว์อย่างเดียว ผู้ตรวจต้องไปเติมใน EMCS เอง
 *
 * key ของ object ตรงกับที่แอปมือถือเก็บ (injured_editor.dart / property_editor.dart)
 * และตัวเลือก dropdown = master ของ EMCS verbatim (survey_master.dart) — ถ้าพิมพ์เพี้ยน
 * lookup ใน xmlExport.service.ts จะ map ไม่เจอ แล้วส่งค่าว่างเข้า EMCS
 *
 * รวมสองตัวไว้ไฟล์เดียวเพราะใช้ layout/primitive ชุดเดียวกัน (การ์ดต่อ 1 ระเบียน + ปุ่มลบ + ปุ่มเพิ่ม)
 */
import React, { useEffect, useRef, useState } from 'react';
import api from '@/lib/api';
import { PROVINCE_OPTIONS, CAR_COLOR_OPTIONS, EV_TYPE_OPTIONS, POLICY_TYPE_OPTIONS, carBrandOptions,
         brandTypeIssue, CAR_TYPE_LABELS, isValidSeDate, carTypeCode, ALL_BRAND, ageFromSeDate, emcsPlate } from './caseOptions';
import { districtOptions } from './districtOptions';
import { insurerOptions, isEmcsInsurer } from './insurerOptions';
import DamageDialog from './DamageDialog';
import { DamageItem, DamageList } from './DamageEditor';

export type RecordItem = Record<string, string>;

/**
 * คู่กรณี 1 คัน — **ไม่ใช่ `RecordItem`** เพราะมีคีย์ที่ไม่ใช่ข้อความปนอยู่:
 * `damage` (อาเรย์ความเสียหายรายชิ้น) และ `kfk` (บูลีน)
 * ถ้าแปลงทั้งก้อนเป็นสตริงเหมือนผู้บาดเจ็บ/ทรัพย์สิน ข้อมูลสองตัวนี้จะพัง
 * (`damage` กลายเป็น "[object Object]") → editor นี้จึงแตะเฉพาะคีย์ที่ตัวเองรู้จัก
 * คีย์อื่นส่งผ่านไปเฉย ๆ
 */
export type LooseRecord = Record<string, unknown>;

/** ประเภทผู้บาดเจ็บ — EMCS ddlPerson_Type (01-05) */
const PERSON_TYPES = [
  'ผู้ขับขี่ - รถประกัน', 'ผู้ขับขี่ - รถคู่กรณี', 'ผู้โดยสาร - รถประกัน',
  'ผู้โดยสาร - รถคู่กรณี', 'บุคคลภายนอกรถ',
];
/** ระดับการบาดเจ็บ — EMCS ddlWounded_Type (01-06) */
const WOUND_LEVELS = [
  'บาดเจ็บ - เล็กน้อย', 'บาดเจ็บ - ปานกลาง', 'บาดเจ็บ - สาหัส',
  'ทุพพลภาพ', 'เสียชีวิตก่อนรักษา', 'เสียชีวิตหลังรักษา',
];
/** ความสัมพันธ์ — EMCS ddlDri_Relation_ID (40 รหัส) */
const RELATIONS = [
  'สามี', 'ภรรยา', 'บุตร', 'บิดา', 'มารดา', 'นายจ้าง', 'ลูกจ้าง', 'ผู้เช่า', 'พี่ชาย',
  'พี่สาว', 'น้องชาย', 'น้องสาว', 'เจ้าของรถ', 'หลาน', 'อา', 'น้า', 'ลุง', 'ป้า', 'ญาติ',
  'เพื่อน', 'แฟน', 'พนักงาน', 'พี่เขย', 'น้องเขย', 'พี่สะใภ้', 'น้องสะใภ้',
  'พนักงานผู้เช่า', 'ลุงเขย', 'น้าเขย', 'น้าสะใภ้', 'อาเขย', 'อาสะใภ้', 'หุ้นส่วน',
  'บุตรหุ้นส่วน', 'เจ้าของบริษัท', 'เพื่อนบุตรเจ้าของรถ', 'บุตรเขย', 'หลานเขย',
  'บุตรสะใภ้',
];
const GENDERS = ['ชาย', 'หญิง'];
/** คำนำหน้า — EMCS ddlDri_Title_ID (sync survey_master.dart kTitles) */
const TITLES = ['นาย', 'นาง', 'นางสาว', 'ด.ช.', 'ด.ญ.', 'คุณ'];
/** ประเภทรถคู่กรณี — EMCS ddlCType verbatim (sync survey_master.dart kOpoCarTypes) */
const OPO_CAR_TYPES = [
  'เก๋งเอเชีย', 'เก๋งยุโรป', 'รถจักรยานยนต์', 'รถอื่นๆ', 'กระบะ', 'รถตู้', 'รถบรรทุก',
];
/** ประเภทใบขับขี่ — EMCS ddlEmcs_License_Type verbatim (sync survey_master.dart kLicenseTypes) */
const LICENSE_TYPES = [
  'ใบขับขี่รถยนต์ส่วนบุคคลตลอดชีพ', 'ใบขับขี่รถจักรยานยนต์ส่วนบุคคลตลอดชีพ',
  'ใบขับขี่รถยนต์ส่วนบุคคลชั่วคราว', 'ใบขับขี่รถจักรยานยนต์ส่วนบุคคลชั่วคราว',
  'ใบขับขี่รถยนต์ส่วนบุคคล 5 ปีต่ออายุ', 'ใบขับขี่รถยนต์สาธารณะ', 'ใบขับขี่สากล',
  'ใบขับขี่รถยนต์ส่วนบุคคลหนึ่งปีต่ออายุ', 'ใบขับขี่รถจักรยานยนต์ส่วนบุคคลหนึ่งปี',
  'ใบขับขี่รถยนต์ส่วนบุคคล 7 ปีต่ออายุ', 'ใบขับขี่รถยนต์ส่วนบุคคล',
  'ใบขับขี่รถจักรยานยนต์ส่วนบุคคล', 'ใบขับขี่ขนส่งชนิดที่1', 'ใบขับขี่ขนส่งชนิดที่2',
  'ใบขับขี่ขนส่งชนิดที่3', 'ใบอนุญาติขับขี่ชนิดที่4', 'ไม่มีใบขับขี่',
  'ใบขับขี่รถยนต์สามล้อส่วนบุคคลสาธารณะ', 'ใบขับขี่รถยนต์สามล้อส่วนบุคคลชั่วคราว',
  'ใบอนุญาตเป็นผู้ขับรถทุกประเภท', 'อื่นๆ',
];


/** ข้อความ placeholder ที่ปนอยู่ในลิสต์ตัวเลือก — ต้องไม่กลายเป็นค่าที่เลือกได้จริง */
const PLACEHOLDERS = new Set(['-- ระบุ --', '-- เลือก --', '-- เขต --']);

/** คงค่าเดิมที่ไม่อยู่ในลิสต์ไว้เป็นตัวเลือกด้วย — เคสเก่า/ค่าที่นำเข้าจากระบบอื่น
 *  ถ้าไม่คง <select> จะไม่มี option ที่ตรง value → โชว์ว่างแล้วหายตอนบันทึก */
function withCurrentOption(list: string[], current: unknown): string[] {
  const cur = String(current ?? '').trim();
  return cur && !PLACEHOLDERS.has(cur) && !list.includes(cur) ? [...list, cur] : list;
}

type FieldDef = {
  k: string;
  label: string;
  /** ไม่ใส่ = ช่องข้อความ */
  options?: string[];
  /** ตัวเลือกที่ขึ้นกับค่าช่องอื่นในระเบียนเดียวกัน (ยี่ห้อ←ประเภทรถ · อำเภอ←จังหวัด) */
  optionsFrom?: (rec: LooseRecord) => string[];
  /** กว้างเต็มแถว (ที่อยู่/รายละเอียด) */
  wide?: boolean;
  placeholder?: string;
  /** บังคับแบบมีเงื่อนไข — คืน true = ช่องนี้บังคับสำหรับระเบียนนี้ (ป้ายได้ดอกจัน กรอบแดงเมื่อว่าง นับเข้าประตูอนุมัติ) */
  reqWhen?: (rec: LooseRecord) => boolean;
};

/** เลือกค่าจริงแล้วหรือยัง (ว่าง/ป้าย "-- ระบุ --" = ยังไม่เลือก) */
const chosen = (v: unknown) => { const t = String(v ?? '').trim(); return t !== '' && !t.startsWith('--'); };

/** ป้ายจริงของช่องสำหรับระเบียนนี้ — ช่องบังคับแบบมีเงื่อนไขได้ " *" ต่อท้ายเมื่อเงื่อนไขเป็นจริง */
const labelFor = (def: FieldDef, rec: LooseRecord) =>
  def.reqWhen && def.reqWhen(rec) && !/ \*$/.test(def.label.trim()) ? `${def.label.trim()} *` : def.label;

/**
 * ช่องบังคับที่ยังว่าง = กรอบแดง + พื้นแดง (ชุดเดียวกับฟอร์มหลักในหน้าตรวจงาน)
 *
 * "บังคับ" อ่านจากป้ายที่ลงท้ายด้วย ` *` ซึ่งเป็นเครื่องหมายที่ใช้อยู่แล้วในลิสต์ด้านล่าง
 * → ช่องบังคับที่เพิ่มวันหลังได้สีเองโดยไม่ต้องมาแก้ที่นี่
 * ⛔ ไม่นับ `*(บางบริษัท)` — บังคับเฉพาะบางบริษัท ทาแดงไว้จะกลายเป็นเตือนหลอกทุกเคส
 */
const isRequiredLabel = (label: string) => / \*$/.test(label.trim());

/**
 * ป้ายช่อง + ดอกจันที่มีสี — ต้องเป็นชุดเดียวกับฟอร์มหลัก (`Req` ใน CaseDetail.tsx)
 *   แดง  = บังคับเสมอ ` *`
 *   เหลือง = บังคับเฉพาะบางบริษัท `*(บางบริษัท)`
 * เดิมพิมพ์ทั้งป้ายเป็นข้อความเดียว ดอกจันจึงเทาเหมือนชื่อช่อง มองไม่ออกว่าช่องไหนบังคับ
 * (user ทัก 02/09/69) · ⛔ ตัวเช็ค isRequiredLabel ยังอ่านจากข้อความป้ายเหมือนเดิม
 *    อย่าเปลี่ยนข้อความในลิสต์ FieldDef เพื่อจัดหน้า ไม่งั้นกรอบแดงหายไปด้วย
 */
function ReqLabel({ label }: { label: string }) {
  const m = label.match(/^(.*?)\s*(\*\(บางบริษัท\)|\*)$/);
  if (!m) return <>{label}</>;
  const when = m[2] !== '*';
  return (
    <>
      {m[1]}
      <span className={when ? 'text-amber-500 ml-0.5' : 'text-red-500 ml-0.5'}>{m[2]}</span>
    </>
  );
}
const REQ_CLS = 'border-red-400 ring-1 ring-red-300 bg-red-50';
const OK_CLS = 'border-gray-300 bg-white';

/**
 * ช่อง "ชื่อคน" ของ EMCS มีตัวกรองอักขระติดอยู่ (TextboxValidate.js: `/([ a-zA-Z0-9ก-์.-])/`)
 * เจออักขระนอกลิสต์ — **วงเล็บก็อยู่นอกลิสต์** — EMCS จะ *ล้างค่าทั้งช่องทิ้ง* ตอนคนคลิก
 * เข้า-ออกช่องนั้น ไม่ใช่แค่ตัดตัวอักษร → ชื่อหายไปทั้งชื่อโดยไม่มีใครรู้
 * ต้องตรงกับ EMCS_NAME_OK ใน backend/src/services/xmlExport.service.ts
 */
const EMCS_NAME_OK = /^[ a-zA-Z0-9ก-์.-]*$/;
const NAME_KEYS = new Set(['owner_name', 'first_name', 'last_name', 'name']);

/** อักขระในชื่อที่ EMCS ไม่รับ (คืนค่าว่าง = ไม่มีปัญหา) — ใช้ร่วมกับ CaseDetail */
export const emcsBadChars = (v: string) => {
  const s = String(v ?? '');
  if (!s.trim()) return '';
  const bad = Array.from(new Set(s.split('').filter((c) => !EMCS_NAME_OK.test(c))));
  return bad.join(' ');
};

const badNameChars = (k: string, v: string) => (NAME_KEYS.has(k) ? emcsBadChars(v) : '');

const cls = (def: FieldDef, value: string, warn: string) =>
  `w-full border rounded-none h-9 px-3 text-sm text-gray-800 ${
    warn || (isRequiredLabel(def.label) && !String(value ?? '').trim()) ? REQ_CLS : OK_CLS}`;

/**
 * เลขบัตรประชาชนไทย 13 หลัก (mod 11) — ลอกจาก `cidChecksum` ของแอปมือถือทีต่อที
 *
 * ⛔ EMCS ตรวจหลักตรวจสอบเอง แล้ว **ปัดตกทั้งบล็อกผู้บาดเจ็บ** ด้วยข้อความ
 *    "กรุณาระบุเลขที่บัตรประชาชน ของ::คนที่ 1 ให้ถูกต้อง" (เจอจากการทดสอบสด 19/08/69)
 *    แอปมือถือกันไว้ตั้งแต่หน้ากรอกแล้ว เว็บเป็นทางเดียวที่ปล่อยเลขมั่วผ่านไปได้
 */
export const cidChecksum = (raw: string): boolean => {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i);
  return (11 - (sum % 11)) % 10 === Number(d[12]);
};

function Field({ def, value, onChange, warnOverride, quickFix }: {
  def: FieldDef; value: string; onChange: (v: string) => void;
  /** คำเตือนที่คิดจากช่องอื่นในระเบียนเดียวกัน (ยี่ห้อ ↔ ประเภทรถ) — ตัวการ์ดส่งมา */
  warnOverride?: string;
  /** ปุ่มแก้ให้ทันที ข้างคำเตือน (เช่น "เปลี่ยนประเภทรถเป็น เก๋งยุโรป") */
  quickFix?: { label: string; onClick: () => void };
}) {
  const v = String(value ?? '');
  const badChars = badNameChars(def.k, v);
  // ทะเบียน: EMCS ไม่รับ "-"/เครื่องหมาย/คำพ่วง (เคลม 2026013076932 "83-2668" บันทึกคู่กรณีไม่ผ่าน 20/09/69) — บอทตัดให้เอง (emcsPlate) บอกหัวหน้าไว้ก่อน
  const plateClean = def.k === 'plate' ? emcsPlate(v) : '';
  const badPlate = def.k === 'plate' && v.trim() !== '' && plateClean !== v.trim();
  // "รอตรวจสอบ" ในช่องเลขบัตร = ค่าที่แอป/เว็บเติมตอนคู่กรณีหลบหนี ไม่ใช่เลขผิด (16/09/69)
  // "-" = ไม่ทราบ ตามกติกาช่องข้อความบังคับของ EMCS (ผู้บาดเจ็บ/คู่กรณี user เคาะ 20/09/69) ไม่ใช่เลขผิด
  const badCid = def.k === 'cid' && v.trim() !== '' && v.trim() !== PENDING_TEXT && v.trim() !== '-' && !cidChecksum(v);
  // อายุ/วันที่ต้องเป็นรูปแบบที่ระบบประกันรับ — "-" ในช่องอายุทำ EMCS ปัดตกทั้งไฟล์ XML (เคส #282 10/09/69)
  const badAge = def.k === 'age' && v.trim() !== '' && !/^\d{1,3}$/.test(v.trim());
  // วันที่ต้องเป็น "วันจริง" ไม่ใช่แค่รูปแบบ — "00/00/2569" ผ่านรูปแบบแต่ EMCS ปัดตกทั้งไฟล์ (เคส #299 15/09/69)
  const badDate = ['birthdate', 'license_start', 'license_end'].includes(def.k)
    && v.trim() !== '' && (v.trim() === '-' || !isValidSeDate(v.trim()));
  /**
   * ชื่อบริษัทที่ไม่มีในลิสต์ของ EMCS — บอทเลือกไม่ได้
   * เกิดกับงานเก่าที่นำเข้ามาก่อนมีลิสต์นี้ และชื่อฝั่ง ISURVEY ที่แปลงอัตโนมัติไม่ได้
   * (จงใจไม่เดาให้ — ชื่อบริษัทประกันต่างกันแค่คำท้าย เช่น ประกันภัย/ประกันสุขภาพ
   *  เดาผิดทีเดียว = เคลมไปผูกกับบริษัทผิด · ให้คนเลือกปลอดภัยกว่า)
   */
  const offList = def.k === 'insurer' && !isEmcsInsurer(v);
  const warn = warnOverride ? warnOverride
    : badChars ? `EMCS ไม่รับอักขระ ${badChars}`
      : badPlate ? `EMCS ไม่รับเครื่องหมาย/คำพ่วงในทะเบียน — บอทจะกรอก "${plateClean || '(ว่าง)'}" ถ้าไม่ใช่ แก้ที่นี่`
      : offList ? 'ชื่อนี้ไม่มีใน EMCS — เลือกใหม่จากลิสต์'
        : badCid ? 'เลขบัตรไม่ถูกต้อง — EMCS จะไม่ยอมบันทึกทั้งบล็อก'
          : badAge ? 'อายุต้องเป็นตัวเลข — ใส่ "-" แล้ว EMCS ปัดตกทั้งไฟล์ (ไม่รู้ = เว้นว่าง)'
            : badDate ? (def.k === 'birthdate'
              ? 'วันเกิดไม่ใช่วันจริง (ISURVEY/XML ส่งมาเป็น 00/00 หรือใส่ "-") — ใส่ วว/ดด/ปปปป จริง หรือติ๊ก "รอตรวจสอบ" ถ้าไม่ทราบ · ปล่อยไว้อนุมัติไม่ผ่าน'
              : 'ต้องเป็นวันที่จริง วว/ดด/ปปปป (พ.ศ.) — 00/00 หรือ "-" ไม่ได้ EMCS ปัดตกทั้งไฟล์ (ไม่รู้ = เว้นว่าง)')
              : '';
  const c = cls(def, v, warn);
  return (
    <div className={def.wide ? 'col-span-2 md:col-span-4' : ''}>
      <label className="block text-xs text-[var(--md-muted)] mb-0.5">
        <ReqLabel label={def.label} />
        {warn && <span className="ml-1 text-red-600 font-medium">· {warn}</span>}
        {warn && quickFix && (
          <button type="button" onClick={quickFix.onClick}
            className="ml-1 px-1.5 border border-red-300 text-red-700 rounded-none hover:bg-red-50 font-medium">
            {quickFix.label}
          </button>
        )}
      </label>
      {def.options ? (
        <select className={c} value={value} title={warn || undefined}
                onChange={(e) => onChange(e.target.value)}>
          <option value="">-- ระบุ --</option>
          {/* ⛔ ตัดตัว placeholder ออกจากลิสต์ก่อน — PROVINCE_OPTIONS[0] / CAR_COLOR_OPTIONS[0]
              เป็น '-- ระบุ --' และ districtOptions[0] เป็น '-- เขต --' ซึ่ง**มีค่าเป็นข้อความจริง**
              ถ้าไม่ตัด dropdown จะมี 2 บรรทัดหน้าตาเหมือนกันเป๊ะ ตัวล่างเลือกแล้วเก็บข้อความนั้น
              ลง JSONB → ตัวนับช่องบังคับเห็นว่า "กรอกแล้ว" ป้ายเตือนหาย และรหัสจังหวัดใน XML ว่าง */}
          {def.options.filter((o) => !PLACEHOLDERS.has(o.trim()))
            .map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input
          type="text" className={c} value={value} placeholder={def.placeholder}
          title={badChars ? `EMCS จะล้างชื่อทั้งช่องทิ้งเพราะมีอักขระ: ${badChars}` : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

/** การ์ด 1 ระเบียน + ปุ่มลบ, และปุ่มเพิ่มท้ายรายการ — ใช้ร่วมกันทั้งผู้บาดเจ็บ/ทรัพย์สิน */
function RecordList({
  items, onChange, fields, cardTitle, addLabel, emptyHint,
}: {
  items: RecordItem[];
  onChange: (next: RecordItem[]) => void;
  fields: FieldDef[];
  cardTitle: (i: number) => string;
  addLabel: string;
  /** ข้อความตอนยังไม่มีรายการ — ไม่ส่ง = ไม่แสดงกล่องเหลือง (user ถอดของผู้บาดเจ็บ/ทรัพย์สิน 07/09/69) */
  emptyHint?: string;
}) {
  const set = (i: number, k: string, v: string) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, [k]: v } : it)));

  return (
    <div className="space-y-4">
      {items.length === 0 && emptyHint && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-none px-3 py-2">{emptyHint}</p>
      )}

      {items.map((it, i) => (
        <div key={i} className="border border-gray-200 rounded-none overflow-hidden">
          <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-200 flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-700">{cardTitle(i)}</span>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, idx) => idx !== i))}
              className="ml-auto px-2 py-0.5 text-xs text-red-600 border border-red-200 rounded-none hover:bg-red-50"
            >
              ลบ
            </button>
          </div>
          <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2">
            {fields.map((f) => (
              <Field key={f.k} def={f} value={it[f.k] ?? ''} onChange={(v) => set(i, f.k, v)} />
            ))}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...items, Object.fromEntries(fields.map((f) => [f.k, ''])) as RecordItem])}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-none hover:bg-gray-50 text-gray-700"
      >
        {addLabel}
      </button>
    </div>
  );
}

// ลำดับช่องตามหน้าผู้บาดเจ็บของแอปมือถือ (person_type → ข้อมูลตัว → ที่ทำงาน → การรักษา)
//
// ⚠️ `*` = ช่องบังคับ **รายคน/รายชิ้น** ของระบบประกัน (vlidInjPerson / vlidAsset)
//    ลิสต์ต้องตรงกับ `checkItems()` ในแอปมือถือ (survey_form_screen.dart)
//    ขาดแม้ช่องเดียว = บันทึก**ทั้งบล็อก**บนระบบประกันไม่ผ่าน และช่องที่ว่างกลายเป็น '-'
//    ให้หัวหน้าไล่แก้เองทีละช่อง — เดิมหน้านี้ติดดาวไว้ช่องเดียว (ประเภทผู้บาดเจ็บ)
const INJURED_FIELDS: FieldDef[] = [
  { k: 'person_type', label: 'ประเภทผู้บาดเจ็บ *', options: PERSON_TYPES },
  { k: 'relation', label: 'ความสัมพันธ์', optionsFrom: (r) => withCurrentOption(RELATIONS, r.relation) },
  { k: 'gender', label: 'เพศ *', options: GENDERS },
  { k: 'name', label: 'ชื่อ-นามสกุล *' },
  { k: 'age', label: 'อายุ' },
  { k: 'cid', label: 'เลขบัตรประชาชน *' },
  { k: 'car_reg', label: 'เลขทะเบียนรถ' },
  { k: 'phone', label: 'โทรศัพท์' },
  { k: 'occupation', label: 'อาชีพ' },
  { k: 'work_place', label: 'ทำงานที่' },
  { k: 'position', label: 'ตำแหน่ง' },
  { k: 'income', label: 'รายได้' },
  { k: 'hospital', label: 'โรงพยาบาล *' },
  { k: 'treat_from', label: 'รักษาตั้งแต่', placeholder: 'วว/ดด/ปปปป (พ.ศ.)' },
  { k: 'treat_to', label: 'ถึงวันที่', placeholder: 'วว/ดด/ปปปป (พ.ศ.)' },
  { k: 'treat_cost', label: 'ค่ารักษา' },
  { k: 'wound_level', label: 'ระดับการบาดเจ็บ', options: WOUND_LEVELS },
  { k: 'address', label: 'ที่อยู่', wide: true },
  { k: 'symptom', label: 'อาการบาดเจ็บ *', wide: true },
];

const PROPERTY_FIELDS: FieldDef[] = [
  { k: 'item', label: 'รายการทรัพย์สิน *' },
  { k: 'owner_name', label: 'เจ้าของ *' },
  { k: 'owner_phone', label: 'โทรศัพท์เจ้าของ' },
  { k: 'estimated_cost', label: 'ค่าเสียหายประมาณ' },
  { k: 'owner_address', label: 'ที่อยู่เจ้าของ', wide: true },
  { k: 'cause', label: 'สาเหตุที่เสียหาย *', wide: true },
  { k: 'detail', label: 'รายละเอียดความเสียหาย *', wide: true },
];

export function InjuredEditor({ items, onChange }: { items: RecordItem[]; onChange: (n: RecordItem[]) => void }) {
  return (
    <RecordList
      items={items} onChange={onChange} fields={INJURED_FIELDS}
      cardTitle={(i) => `ผู้บาดเจ็บคนที่ ${i + 1}`}
      addLabel="+ เพิ่มผู้บาดเจ็บ"
    />
  );
}

export function PropertyEditor({ items, onChange }: { items: RecordItem[]; onChange: (n: RecordItem[]) => void }) {
  return (
    <RecordList
      items={items} onChange={onChange} fields={PROPERTY_FIELDS}
      cardTitle={(i) => `รายการที่ ${i + 1}`}
      addLabel="+ เพิ่มทรัพย์สิน"
    />
  );
}

/** ทิ้งแถวที่ว่างทั้งใบ (กดเพิ่มแล้วไม่กรอก) — ส่งไปก็ทำให้บอทนับรายการเพี้ยน */
export const dropEmptyRecords = (items: RecordItem[]): RecordItem[] =>
  items.filter((it) => Object.values(it).some((v) => String(v ?? '').trim() !== ''));

// ───────────────────────── คู่กรณี ─────────────────────────
//
// เดิมหน้าตรวจงาน **แสดงคู่กรณีอย่างเดียว แก้ไม่ได้** ทั้งที่ระบบประกันบังคับ 7 ช่องรายคัน
// และ 4 ใน 7 (ประเภทรถ · เพศ · วันเกิด · อายุ) เป็น dropdown/วันที่/ตัวเลข ที่ใส่ "-" แทนไม่ได้
// → ขาดแล้วบอทค้างกลางทางที่หน้าคู่กรณี ผู้ตรวจต้องโทรตามให้ช่างแก้จากแอปอย่างเดียว
//
// `*` = **สกัดจาก validator จริง `vlidOpoCar`** บนหน้า EMCS ที่เซฟไว้ (เคส 000098)
//   base 8 ช่องบังคับทุกบริษัท: เจ้าของ · ทะเบียน · จังหวัด · มีประกันภัยที่ · กรมธรรม์
//                              · วันเกิด · อายุ · ประเภทรถ
//
// ⚠️ **ต่างจากลิสต์ในแอปมือถือ 3 จุด** (แอปเช็ค 7 ช่อง) — อ้างอิง validator เพราะเป็นตัวที่บล็อกจริง:
//   · แอป**ไม่เช็ค** "เจ้าของคู่กรณี" + "กรมธรรม์" ทั้งที่ EMCS บังคับทุกบริษัท → ที่นี่ติดดาวแดง
//   · แอปเช็ค "เพศ" เสมอ แต่ EMCS บังคับเฉพาะ `case '12'` → ที่นี่เป็นดาวส้ม
//     (แอปเข้มกว่าไม่เสียหาย ข้อมูลมีมาให้อยู่แล้ว — แค่คนละเหตุผล)
//
// ⚠️ `province` ทำ 2 หน้าที่ในสคีมาของแอป: จังหวัดป้ายทะเบียน **และ** จังหวัดที่อยู่ผู้ขับขี่
//    (เป็น parent ของ cascade อำเภอ) — สืบทอดมาจากฝั่งแอป ยังไม่ได้แยก
/** ที่อยู่ผู้ขับขี่คู่กรณี "มีข้อมูล" = กรอกส่วนใดส่วนหนึ่ง (บ้านเลขที่ที่ไม่ใช่ -/รอตรวจสอบ · หมู่ · จังหวัด · อำเภอ · ตำบล)
 *  → จังหวัด/อำเภอ/ตำบล ต้องครบ (user เคาะ 16/09/69 "ถ้ามีก็ต้องกรอก") · ไม่มีข้อมูลเลย = เว้นว่างทั้งหมด บอทใส่ "-" · แอปติ๊ก "รอตรวจสอบ" = ยกเว้น
 *  กติกาเดียวกับแอป (OpponentEditor.addrHasData + alsoMissing หมวด 6) */
export const opponentHasAddress = (r: LooseRecord): boolean => {
  if (r.pending === true) return false;
  const a = String(r.address ?? '').trim();
  return (a !== '' && a !== '-' && a !== 'รอตรวจสอบ') || String(r.moo ?? '').trim() !== '' || chosen(r.home_province) || chosen(r.district) || chosen(r.subdistrict);
};

const OPPONENT_FIELDS: FieldDef[] = [
  // ลำดับ 5 แถวแรก user กำหนดเอง 10/09/69 (กริด 4 ช่องต่อแถวบนจอกว้าง):
  //   แถว 1 เจ้าของรถคู่กรณี · ประเภทรถ · ทะเบียน · จังหวัด
  //   แถว 2 ยี่ห้อ · รุ่น · สีรถ · ปีจดทะเบียน
  //   แถว 3 เลขตัวถัง · เลขไมล์ · ประเภทรถไฟฟ้า · เลขเคลมคู่กรณี
  //   แถว 4 มีประกันภัยที่ · เลขกรมธรรม์ · ประเภทประกัน (ช่องที่ 4 ว่าง)
  //   แถว 5 ที่อยู่เจ้าของรถ เต็มแถว — ที่เหลือลำดับเดิม
  // ⛔ user ตัดสินไม่เพิ่มช่องที่แอปมีแต่เว็บไม่มี (ชนิดบัตร · รายละเอียดความเสียหาย · รอตรวจสอบ) เพราะ EMCS ไม่มีช่องรับ
  // 16/09/69 (user สั่ง): คำนำหน้าเจ้าของรถ (ไม่บังคับ — เจ้าของเป็นบริษัทได้) วาดรวมในช่องเดียวกับชื่อ (OwnerNameCell)
  // → EMCS/XML รวมเป็น "นาย บุญเลี้ยง ชงสุวรรณ" (backend services/driverAddress.ts withTitle · บอท with_title)
  { k: 'owner_title', label: 'คำนำหน้า', options: TITLES },
  { k: 'owner_name', label: 'เจ้าของรถคู่กรณี *' },
  { k: 'car_type', label: 'ประเภทรถ *', optionsFrom: (r) => withCurrentOption(OPO_CAR_TYPES, r.car_type) },
  { k: 'plate', label: 'ทะเบียน *' },
  { k: 'province', label: 'จังหวัด *', options: PROVINCE_OPTIONS },
  // เลือกประเภทรถแล้ว EMCS บังคับยี่ห้อด้วย (ddlCMFG cascade จากประเภทรถ) — user ขอ 10/09/69 · ยังไม่เลือกประเภท = ยังไม่บังคับ
  // ยกเว้นคันที่ติ๊ก "รอตรวจสอบ" (17/09/69): ประเภท รถอื่นๆ ไม่มี -ALL- ให้เลือก และ EMCS ไม่ตรวจยี่ห้อคู่กรณีตอนบันทึก (vlidOpoCar) — บอท v1.1.7 ข้ามยี่ห้อว่างให้
  { k: 'car_brand', label: 'ยี่ห้อ', optionsFrom: (r) => carBrandOptions(String(r.car_type ?? ''), String(r.car_brand ?? '')),
    reqWhen: (r) => chosen(r.car_type) && r.pending !== true },
  { k: 'car_model', label: 'รุ่น' },
  // ค่าที่นำเข้าจาก ISURVEY มักสะกดไม่ตรงลิสต์ (เคส #255 สีรถ "บอน") — เดิม <select> ไม่มี option ตรง value
  // → โชว์ "-- ระบุ --" ทั้งที่มีค่าอยู่ แล้วบอทกรอก EMCS ด้วยค่าจริง (fuzzy → "บรอน") หัวหน้าเลยงงว่า EMCS รู้ได้ไง
  // คงค่าเดิมไว้เป็นตัวเลือกให้เห็นและแก้ได้ (user ถาม 10/09/69)
  { k: 'car_color', label: 'สีรถ', optionsFrom: (r) => withCurrentOption(CAR_COLOR_OPTIONS, r.car_color) },
  { k: 'reg_year', label: 'ปีจดทะเบียน' },
  { k: 'vin', label: 'เลขตัวถัง' },
  { k: 'mileage', label: 'เลขไมล์' },
  // ต้องเป็นตัวเลือก ไม่ใช่ช่องพิมพ์ — แอปเก็บ "รหัส" (BEV/HEV/…) และบอทเลือกด้วย
  // select_by_value แบบตรงตัว พิมพ์เองเพี้ยนนิดเดียว = บอทข้ามช่องนี้เงียบ ๆ
  { k: 'ev_type', label: 'ประเภทรถไฟฟ้า', options: EV_TYPE_OPTIONS.map((e) => e.value).filter(Boolean) },
  { k: 'claim_no', label: 'เลขเคลมคู่กรณี' },
  // dropdown ไม่ใช่ช่องพิมพ์ — บน EMCS ช่องนี้คือ ddlHave_Insurance และบอทเลือกด้วย
  // fuzzy_select · สะกดเองเพี้ยนนิดเดียว บอทข้ามช่องนี้เงียบ ๆ (ดู insurerOptions.ts)
  { k: 'insurer', label: 'มีประกันภัยที่ *', optionsFrom: (r) => insurerOptions(String(r.insurer ?? '')) },
  { k: 'policy_no', label: 'เลขกรมธรรม์ *' },
  // dropdown ชุดเดียวกับ ISURVEY (30/08/69) — เดิมเป็นช่องพิมพ์ ทำให้คำเขียนไม่ตรงกัน
  // แล้ว backend แปลงเป็นรหัสส่ง EMCS ไม่ได้ · optionsFrom คงค่าเดิมของเคสเก่าไว้ในลิสต์
  // (ตัว renderer เลือกตาม value ตรงตัว ค่าที่ไม่อยู่ในลิสต์จะกลายเป็นช่องว่างแล้วหายตอนบันทึก)
  { k: 'policy_type', label: 'ประเภทประกัน',
    optionsFrom: (r) => withCurrentOption(POLICY_TYPE_OPTIONS, r.policy_type) },
  { k: 'owner_address', label: 'ที่อยู่เจ้าของรถ', wide: true },
  // ชื่อเดียวกับช่องของรถประกันและ EMCS — user หาช่องนี้ไม่เจอตอนชื่อ "ค่าเสียหายประมาณ" (04/09/69)
  // ยอด = Σ(ค่าแรง+ค่าอะไหล่) จากตารางความเสียหายของคู่กรณี (ตัวแปลง ISURVEY คำนวณให้เหมือนรถประกัน)
  // (วาดแยกเหนือปุ่ม "ข้อมูลความเสียหาย" ไม่อยู่ในกริด — ดู OPPONENT_COST_FIELD)
  { k: 'estimated_cost', label: 'ความเสียหายประมาณ (บาท)' },
  { k: 'title', label: 'คำนำหน้า', optionsFrom: (r) => withCurrentOption(TITLES, r.title) },
  { k: 'first_name', label: 'ชื่อผู้ขับขี่' },
  { k: 'last_name', label: 'นามสกุล' },
  { k: 'gender', label: 'เพศ *(บางบริษัท)', optionsFrom: (r) => withCurrentOption(GENDERS, r.gender) },
  { k: 'birthdate', label: 'วันเกิด *', placeholder: 'วว/ดด/ปปปป (พ.ศ.)' },
  { k: 'age', label: 'อายุ *' },
  { k: 'relation', label: 'ความสัมพันธ์', optionsFrom: (r) => withCurrentOption(RELATIONS, r.relation) },
  { k: 'phone', label: 'โทรศัพท์' },
  { k: 'cid', label: 'เลขบัตรประชาชน' },
  { k: 'license_no', label: 'เลขใบขับขี่' },
  { k: 'license_type', label: 'ประเภทใบขับขี่', optionsFrom: (r) => withCurrentOption(LICENSE_TYPES, r.license_type) },
  { k: 'license_start', label: 'ใบขับขี่ ออกให้', placeholder: 'วว/ดด/ปปปป (พ.ศ.)' },
  { k: 'license_end', label: 'ใบขับขี่ สิ้นสุด', placeholder: 'วว/ดด/ปปปป (พ.ศ.)' },
  // จังหวัดของ "ที่อยู่ผู้ขับขี่" แยกจากจังหวัดป้ายทะเบียน — แอปมือถือและ XML export ใช้ home_province อยู่แล้ว
  // (export: DRI_PROVINCEID = home_province || province) แต่เว็บไม่มีช่องนี้ ทำให้อำเภอที่ตัวดึงงาน ISURVEY
  // ใส่มาจากภูมิลำเนาไม่โผล่ในลิสต์เมื่อป้ายทะเบียนเป็นคนละจังหวัด (audit 03/09/69 เคลม 2026013058298:
  // ป้าย กทม. / ภูมิลำเนา ศรีสะเกษ → อำเภอปรางค์กู่หายจากลิสต์)
  // ที่อยู่ปัจจุบันผู้ขับขี่คู่กรณี (user สั่ง 16/09/69): บ้านเลขที่+หมู่ (ช่องเดียวกัน — AddressMooCell) · จังหวัด · เขต/อำเภอ · ตำบล/แขวง แถวเดียวกัน
  // EMCS มีช่องข้อความเดียว (dropdown ของบล็อกคู่กรณีซ่อน) → บอท/XML ประกอบ "46/23 ม.7 ต.ท้ายบ้าน อ.เมือง จ.สมุทรปราการ"
  // (backend services/driverAddress.ts opponentAddressLine) · มีที่อยู่ส่วนใดส่วนหนึ่ง → จังหวัด/อำเภอ/ตำบล บังคับ (opponentHasAddress) · ว่างทั้งหมด = ไม่มีข้อมูล บอทใส่ "-"
  { k: 'address', label: 'ที่อยู่ผู้ขับขี่ (บ้านเลขที่ / ถนน)' },
  { k: 'moo', label: 'หมู่' },
  { k: 'home_province', label: 'จังหวัด (ที่อยู่ผู้ขับขี่)', options: PROVINCE_OPTIONS, reqWhen: opponentHasAddress },
  { k: 'district', label: 'เขต/อำเภอ (ที่อยู่)', reqWhen: opponentHasAddress,
    optionsFrom: (r) => districtOptions(String(r.home_province || r.province || ''), String(r.district ?? '')) },
  { k: 'subdistrict', label: 'ตำบล/แขวง (ที่อยู่)', reqWhen: opponentHasAddress },   // ตัวเลือกจาก /api/geo/tumbons ตามจังหวัด+อำเภอ (tumbonOptions ใน OpponentEditor)
];

/** คีย์ที่ editor นี้ดูแล — ใช้ตัดสินว่าการ์ด "ว่างทั้งใบ" ไหม โดยไม่นับ damage/kfk */
const OPPONENT_KEYS = OPPONENT_FIELDS.map((f) => f.k);
/** ช่องยอดความเสียหาย — วาดแยกจากกริด ไว้เหนือปุ่ม "ข้อมูลความเสียหาย" (ยังอยู่ใน OPPONENT_FIELDS ให้ KEYS ครบ) */
const OPPONENT_COST_FIELD: FieldDef = OPPONENT_FIELDS.find((f) => f.k === 'estimated_cost')!;

/** ค่า "ไม่มีประกัน" ในช่องมีประกันภัยที่ — เลขกรมธรรม์ต้องเป็น "-" (ดู set() ใน OpponentEditor) */
const NO_INSURER = 'ไม่มีบริษัทประกันภัย';
/** ค่าที่แอป/เว็บเคยเติมตอนติ๊ก "รอตรวจสอบ" (ชุด 16/09/69 — 17/09 เปลี่ยนเป็น "-"/"00"/"ไม่ทราบชื่อ") ยังอยู่ในคันเก่า → ใช้ยกเว้นเตือนเลขบัตร/ที่อยู่ */
const PENDING_TEXT = 'รอตรวจสอบ';

/** 8 ช่องที่ `vlidOpoCar` บล็อกทุกบริษัท — ใช้นับป้าย "ยังขาด N ช่องบังคับ" */
export const OPPONENT_REQUIRED = [
  'owner_name', 'plate', 'province', 'insurer', 'policy_no', 'birthdate', 'age', 'car_type',
];

/**
 * ช่องบังคับของคู่กรณีคันนี้ที่ยังว่าง — รวมช่องบังคับแบบมีเงื่อนไข (ยี่ห้อ เมื่อเลือกประเภทรถแล้ว)
 * ⛔ การ์ดคู่กรณีและประตูอนุมัติในหน้าเคสต้องใช้ตัวนี้ตัวเดียวกัน ไม่งั้นการ์ดขึ้น "ยังขาด" แต่แถบบนเขียว
 */
export const opponentMissing = (rec: LooseRecord): string[] => [
  ...OPPONENT_REQUIRED.filter((k) => !String(rec[k] ?? '').trim()),
  ...OPPONENT_FIELDS.filter((f) => f.reqWhen && f.reqWhen(rec) && !chosen(rec[f.k])).map((f) => f.k),
  // วันที่ที่ไม่ใช่วันจริง (00/00/2569) นับเป็น "ยังไม่ครบ" — ปล่อยอนุมัติแล้ว EMCS ปัดตกไฟล์ทั้งไฟล์ (เคส #299 15/09/69)
  // วันเกิดคู่กรณี: "-" ก็ไม่ผ่าน (user เคาะ 19/09/69 — วันเกิดไม่จริงจาก ISURVEY/XML ให้เตือนบนเว็บแล้วหัวหน้าแก้ ไม่ทราบ = ติ๊กรอตรวจสอบ;
  //   เดิม "-" ผ่านแล้วบอทใส่วันนี้+อายุ 1 ให้เงียบ ๆ) · วันออก/หมดอายุใบขับขี่ "-" = ไม่ทราบ ปล่อยผ่านเหมือนเดิม
  ...['birthdate', 'license_start', 'license_end'].filter((k) => {
    const v = String(rec[k] ?? '').trim();
    if (v === '') return false;
    if (v === '-') return k === 'birthdate';
    return !isValidSeDate(v);
  }),
  // ยี่ห้อไม่มีในลิสต์ของประเภทรถนั้นบน EMCS — บอทเลือกไม่ได้ (เคส #300 15/09/69)
  ...(brandTypeIssue(rec.car_type, rec.car_brand) ? ['car_brand'] : []),
  // ความเสียหายทุกชิ้นต้องมีระดับ L/M/H/X — EMCS บังคับ ว่าง/คำไทย ("แผลเบา" จาก ISURVEY) ทำ popup ค้าง (เคส #343 15/09/69)
  ...((Array.isArray(rec.damage) ? rec.damage : []) as Array<Record<string, unknown>>)
    .filter((d) => d && String(d.part ?? '').trim() && !['L', 'M', 'H', 'X'].includes(String(d.level ?? '').trim()))
    .map(() => 'damage_level'),
];

/**
 * ช่องบังคับของผู้บาดเจ็บ/ทรัพย์สิน — ดึงจากดอกจันท้าย label ของ field def เดียวกับที่วาดฟอร์ม
 * ⛔ ต้อง export ให้หน้าตรวจเคสเอาไปนับเข้าประตูอนุมัติด้วย ไม่งั้นการ์ดขึ้น "ยังขาด N ช่อง"
 *    แต่แถบบนขึ้นเขียว "ครบแล้ว" แล้วอนุมัติผ่าน → บอทไปตายที่หน้าคู่กรณีของ EMCS
 */
const reqKeys = (defs: FieldDef[]) => defs.filter((f) => f.label.trim().endsWith('*')).map((f) => f.k);
export const INJURED_REQUIRED = reqKeys(INJURED_FIELDS);
export const PROPERTY_REQUIRED = reqKeys(PROPERTY_FIELDS);

/** เจ้าของรถคู่กรณี: คำนำหน้า (เลือก ไม่บังคับ — เจ้าของเป็นบริษัทได้) + ชื่อ ในช่องเดียว (16/09/69) → EMCS/XML รวมเป็น "นาย บุญเลี้ยง ชงสุวรรณ" */
function OwnerNameCell({ it, set }: { it: LooseRecord; set: (k: string, v: string) => void }) {
  const name = String(it.owner_name ?? '');
  const title = String(it.owner_title ?? '');
  const bad = emcsBadChars(name);
  const box = 'border rounded-none h-9 text-sm text-gray-800';
  return (
    <div>
      <label className="block text-xs text-[var(--md-muted)] mb-0.5">
        <ReqLabel label="เจ้าของรถคู่กรณี *" />
        {bad && <span className="ml-1 text-red-600 font-medium">· EMCS ไม่รับอักขระ {bad}</span>}
      </label>
      <div className="flex items-center gap-1">
        <select className={`${box} ${OK_CLS} w-[5.5rem] shrink-0 px-1`} value={title} title="คำนำหน้าเจ้าของรถ (ไม่บังคับ)"
                onChange={(e) => set('owner_title', e.target.value)}>
          <option value="">คำนำหน้า</option>
          {withCurrentOption(TITLES, title).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <input type="text" className={`${box} ${bad || !name.trim() ? REQ_CLS : OK_CLS} flex-1 min-w-0 px-3`} value={name}
               title={bad ? `EMCS จะล้างชื่อทั้งช่องทิ้งเพราะมีอักขระ: ${bad}` : undefined}
               onChange={(e) => set('owner_name', e.target.value)} />
      </div>
    </div>
  );
}

/** ที่อยู่ผู้ขับขี่คู่กรณี: บ้านเลขที่/ถนน + หมู่ ในช่องเดียว (แบบเดียวกับผู้ขับขี่รถประกันในหน้าเคส) — ทั้งคู่ไม่บังคับ */
function AddressMooCell({ it, set }: { it: LooseRecord; set: (k: string, v: string) => void }) {
  const box = `border rounded-none h-9 text-sm text-gray-800 ${OK_CLS}`;
  return (
    <div className="md:col-start-1">{/* ขึ้นแถวใหม่เสมอ → ที่อยู่+หมู่ | จังหวัด | อำเภอ | ตำบล อยู่แถวเดียวกัน (แบบเดียวกับผู้ขับขี่รถประกัน) */}
      <label className="block text-xs text-[var(--md-muted)] mb-0.5">ที่อยู่ผู้ขับขี่ (บ้านเลขที่ / ถนน)</label>
      <div className="flex items-center gap-1">
        <input type="text" className={`${box} flex-1 min-w-0 px-3`} value={String(it.address ?? '')} placeholder="บ้านเลขที่ / ถนน / ซอย"
               onChange={(e) => set('address', e.target.value)} />
        <span className="text-sm text-gray-600 shrink-0 pl-1">หมู่</span>
        <input type="text" className={`${box} w-14 shrink-0 px-2`} value={String(it.moo ?? '')} title="หมู่ที่ (ไม่บังคับ)"
               onChange={(e) => set('moo', e.target.value)} />
      </div>
    </div>
  );
}

export function OpponentEditor({ items, onChange }: {
  items: LooseRecord[]; onChange: (next: LooseRecord[]) => void;
}) {
  // spread ของเดิมไว้เสมอ → `damage` / `kfk` / คีย์ที่ยังไม่รู้จัก รอดไปกับการบันทึก
  const set = (i: number, k: string, v: string) =>
    onChange(items.map((it, idx) => {
      if (idx !== i) return it;
      const next: LooseRecord = { ...it, [k]: v };
      // ที่อยู่ผู้ขับขี่: เปลี่ยนจังหวัด → ล้างอำเภอ+ตำบล · เปลี่ยนอำเภอ → ล้างตำบล (รายการตำบลผูกกับคู่จังหวัด/อำเภอ)
      if (k === 'home_province' && v !== String(it.home_province ?? '')) { next.district = ''; next.subdistrict = ''; }
      if (k === 'district' && v !== String(it.district ?? '')) next.subdistrict = '';
      // แก้วันเกิด → คำนวณอายุใหม่ (ปีเต็ม ณ วันนี้ สูตรเดียวกับแอป) เฉพาะตอนหัวหน้าแก้บนเว็บ — ข้อมูลจากแอปมาพร้อมอายุแล้ว
      // ไม่คำนวณซ้ำตอนโหลด · ช่องอายุยังพิมพ์ทับได้ (user สั่ง 19/09/69)
      if (k === 'birthdate' && v !== String(it.birthdate ?? '')) { const a = ageFromSeDate(v); if (a) next.age = a; }
      // "ไม่มีบริษัทประกันภัย" → เลขกรมธรรม์ "-" ให้เอง (EMCS บังคับช่องนี้ทุกบริษัท · กติกาช่องบังคับไม่มีข้อมูล = "-")
      // เปลี่ยนกลับเป็นบริษัทจริงแล้วยังเป็น "-" อยู่ → ล้างให้กรอกเลขจริง (user ขอ 10/09/69)
      if (k === 'insurer') {
        const pn = String(next.policy_no ?? '').trim();
        if (v === NO_INSURER && !pn) next.policy_no = '-';
        else if (v !== NO_INSURER && pn === '-') next.policy_no = '';
      }
      return next;
    }));

  /** "รอตรวจสอบ" (คู่กรณีหลบหนี / ยังไม่มีรายละเอียด) — สถานะเดียวกับแอป (`pending`, user สั่ง 16/09/69)
   *  ติ๊กแล้วเติมช่องบังคับที่ยังว่างด้วยค่าที่ EMCS ยอมรับ ชุดเดียวกับ OpponentEditor._applyPending ของแอป — ชุดค่า user เคาะ 17/09/69
   *  (แทนชุด 16/09 "รอตรวจสอบ"/เก๋งเอเชีย/-ALL-/ประกัน อื่นๆ/วันเกิดปี 2525):
   *  เจ้าของรถ "-" · ทะเบียน "00" · ประเภทรถ รถอื่นๆ (ยี่ห้อว่าง — รถอื่นๆ ไม่มี -ALL- และ EMCS ไม่บังคับยี่ห้อคู่กรณี;
   *  ประเภทอื่นที่เลือกไว้แล้ว + ยี่ห้อว่าง → -ALL-) · จังหวัด อื่นๆ · เพศ ชาย + ชื่อ "ไม่ทราบชื่อ" (ไม่ใส่คำนำหน้า/นามสกุล → EMCS เห็นคำเดียว) ·
   *  วันเกิด 01/01/2500 + อายุจากปี พ.ศ. · ประกัน ไม่มีบริษัทประกันภัย · กรมธรรม์ "-" · ที่อยู่/เลขบัตร/โทร ปล่อยว่าง (บอทใส่ "-" ให้ EMCS)
   *  ของที่กรอกไว้แล้วไม่ทับ · เอาติ๊กออกไม่ล้างค่า · ที่อยู่ว่าง = ไม่บังคับ 3 ช่อง (opponentHasAddress) · คันที่ติ๊กไว้ก่อน 17/09 ยังเป็นค่าเดิม */
  const setPending = (i: number, on: boolean) =>
    onChange(items.map((it, idx) => {
      if (idx !== i) return it;
      const next: LooseRecord = { ...it, pending: on };
      if (!on) return next;
      const fill = (k: string, v: string) => { if (!chosen(next[k])) next[k] = v; };
      fill('owner_name', '-'); fill('plate', '00'); fill('first_name', 'ไม่ทราบชื่อ');
      fill('car_type', 'รถอื่นๆ');
      if (!chosen(next.car_brand) && carTypeCode(next.car_type) !== 'O') next.car_brand = ALL_BRAND;
      fill('province', 'อื่นๆ'); fill('gender', 'ชาย'); fill('insurer', NO_INSURER); fill('policy_no', '-');
      // วันเกิดที่ไม่ใช่วันจริง ("-" · 00/00/00 จาก ISURVEY/XML) นับเป็นว่าง → 01/01/2500 · อายุที่ไม่ใช่ตัวเลข/เป็น 0 → คำนวณใหม่ (19/09/69)
      { const b = String(next.birthdate ?? '').trim(); if (b === '-' || !isValidSeDate(b)) next.birthdate = ''; }
      fill('birthdate', '01/01/2500');
      if (!/^[1-9]\d{0,2}$/.test(String(next.age ?? '').trim())) next.age = ageFromSeDate(next.birthdate);
      return next;
    }));

  // ระเบียนที่มีอยู่แล้ว (แอปเก่าส่ง policy_no ว่างมากับ "ไม่มีบริษัทประกันภัย") → เติม "-" ตอนเปิดหน้าให้ด้วย
  useEffect(() => {
    const fixed = items.map((it) =>
      String(it.insurer ?? '') === NO_INSURER && !String(it.policy_no ?? '').trim() ? { ...it, policy_no: '-' } : it);
    if (fixed.some((x, i) => x !== items[i])) onChange(fixed);
  }, [items, onChange]);

  /** ตำบล/แขวง ตามจังหวัด+อำเภอของที่อยู่ผู้ขับขี่ — โหลดจาก /api/geo/tumbons ครั้งเดียวต่อคู่ (แคชในหน้า)
   *  ค่าที่บันทึกไว้แต่ไม่อยู่ในรายการยังโชว์ · จังหวัดใช้ home_province (เคสเก่าไม่มี → จังหวัดป้ายทะเบียน ตามที่ลิสต์อำเภอใช้) */
  const [tumbons, setTumbons] = useState<Record<string, string[]>>({});
  const pendingRef = useRef<Set<string>>(new Set());
  const tumbonKey = (it: LooseRecord): string => {
    const p = String(it.home_province || it.province || '').trim();
    const d = String(it.district ?? '').trim();
    return p && d && !p.startsWith('--') && !d.startsWith('--') ? `${p}|${d}` : '';
  };
  useEffect(() => {
    for (const key of Array.from(new Set(items.map(tumbonKey)))) {
      if (!key || key in tumbons || pendingRef.current.has(key)) continue;
      pendingRef.current.add(key);
      const [province, district] = key.split('|');
      api.get('/api/geo/tumbons', { params: { province, district } })
        .then((res) => setTumbons((prev) => ({ ...prev, [key]: Array.isArray(res.data?.data) ? (res.data.data as string[]) : [] })))
        .catch(() => setTumbons((prev) => ({ ...prev, [key]: [] })))
        .finally(() => pendingRef.current.delete(key));
    }
  }, [items, tumbons]);
  const tumbonOptions = (it: LooseRecord): string[] => withCurrentOption(tumbons[tumbonKey(it)] ?? [], it.subdistrict);

  /** หน้าต่าง "ข้อมูลความเสียหาย" ของคู่กรณีคันที่เปิดอยู่ (null = ปิด)
   *  เดิมความเสียหายคู่กรณีแก้ได้เฉพาะในแอป หน้าตรวจเห็นแค่ตัวเลข → หัวหน้าตรวจไม่ได้
   *  ว่าช่างเลือกถูกไหม ทั้งที่ EMCS มีช่องรับของคู่กรณีแยกทุกคัน (user สั่ง 20/08/69) */
  const [dmgFor, setDmgFor] = useState<number | null>(null);
  const dmgOf = (it: LooseRecord): DamageItem[] =>
    (Array.isArray(it.damage) ? it.damage : []) as DamageItem[];

  return (
    <div className="space-y-4">
      {items.map((it, i) => {
        const missing = opponentMissing(it);
        const dmg = Array.isArray(it.damage) ? it.damage.length : 0;
        return (
          <div key={i} className="border border-gray-200 rounded-none overflow-hidden">
            <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-200 flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-700">คู่กรณีคันที่ {i + 1}</span>
              {/* ติ๊ก KFK ถอดออกจากเว็บ 16/09/69 (user: ไม่ได้ใช้) — ค่า kfk ที่แอปติ๊กมายังอยู่ใน JSON และไปถึง XML/บอทตามเดิม (spread ของเดิมไว้) */}
              {/* "รอตรวจสอบ" — สถานะเดียวกับแอป (pending): ช่างติ๊กมาจากแอปก็ขึ้นป้ายที่นี่ · หัวหน้าติ๊กบนเว็บได้เอง (user สั่ง 16/09/69) */}
              <label className="flex items-center gap-1 text-xs text-gray-600" title="คู่กรณีหลบหนี / ยังไม่มีรายละเอียด — เติมช่องบังคับที่ยังว่างให้อัตโนมัติ แก้เองได้ (เอาติ๊กออกไม่ล้างค่า)">
                <input type="checkbox" className="w-3.5 h-3.5" checked={it.pending === true} onChange={(e) => setPending(i, e.target.checked)} />
                รอตรวจสอบ
              </label>
              {it.pending === true && (
                <span className="px-2 py-0.5 text-xs font-semibold rounded-none bg-amber-100 text-amber-800 border border-amber-300">⏳ รอตรวจสอบ — คู่กรณีหลบหนี / ยังไม่มีรายละเอียด</span>
              )}
              {missing.length > 0 && (
                <span className="text-xs text-red-600">⚠ ยังขาด {missing.length} ช่องบังคับ</span>
              )}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, idx) => idx !== i))}
                className="ml-auto px-2 py-0.5 text-xs text-red-600 border border-red-200 rounded-none hover:bg-red-50"
              >
                ลบ
              </button>
            </div>
            <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2">
              {OPPONENT_FIELDS.filter((f) => f.k !== OPPONENT_COST_FIELD.k).map((f) => {
                // คำนำหน้าเจ้าของรถ / หมู่ วาดรวมในช่องของ ชื่อเจ้าของรถ / ที่อยู่ (16/09/69)
                if (f.k === 'owner_title' || f.k === 'moo') return null;
                if (f.k === 'owner_name') return <OwnerNameCell key={f.k} it={it} set={(k, v) => set(i, k, v)} />;
                if (f.k === 'address') return <AddressMooCell key={f.k} it={it} set={(k, v) => set(i, k, v)} />;
                // ยี่ห้อ ↔ ประเภทรถ ตามลิสต์ EMCS (15/09/69) — เตือนใต้ช่องยี่ห้อ + ปุ่มเปลี่ยนประเภทให้เมื่อชี้ได้แน่
                const issue = f.k === 'car_brand' ? brandTypeIssue(it.car_type, it.car_brand) : null;
                const options = f.k === 'subdistrict' ? tumbonOptions(it) : (f.optionsFrom ? f.optionsFrom(it) : f.options);
                return (
                  <Field
                    key={f.k}
                    def={{ ...f, options, label: labelFor(f, it) }}
                    value={String(it[f.k] ?? '')}
                    onChange={(v) => set(i, f.k, v)}
                    warnOverride={issue?.message}
                    quickFix={issue?.suggestion
                      ? { label: `เปลี่ยนประเภทรถเป็น ${CAR_TYPE_LABELS[issue.suggestion]}`,
                          onClick: () => set(i, 'car_type', CAR_TYPE_LABELS[issue.suggestion as string]) }
                      : undefined}
                  />
                );
              })}
            </div>
            {/* ยอดความเสียหายอยู่คู่กับรายการความเสียหาย (เหนือปุ่ม) — user 04/09/69: อยู่ในกริดรถแล้วหาไม่เจอ
                ค่าจากงาน ISURVEY = Σ(ค่าแรง+ค่าอะไหล่) ของรายการด้านล่างนี้ */}
            <div className="px-3 grid grid-cols-2 md:grid-cols-4 gap-x-4">
              <Field def={OPPONENT_COST_FIELD} value={String(it[OPPONENT_COST_FIELD.k] ?? '')}
                     onChange={(v) => set(i, OPPONENT_COST_FIELD.k, v)} />
            </div>
            {/* ใต้ช่องสุดท้าย ("ที่อยู่ผู้ขับขี่") — user ขอย้ายลงมาจากหัวการ์ด 20/08/69
                เพราะปุ่มขอบบางบนแถบหัวกลืนกับชื่อการ์ด หาไม่เจอ */}
            <div className="px-3 pb-3 pt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button" onClick={() => setDmgFor(i)}
                className="shrink-0 whitespace-nowrap px-3 py-1.5 text-sm border border-blue-300 rounded-none bg-blue-50 hover:bg-blue-100 text-blue-800 font-medium"
              >
                ข้อมูลความเสียหาย{dmg > 0 ? ` (${dmg})` : ''}
              </button>
              {/* โชว์รายการที่เลือกไว้เลย ไม่ต้องเปิดหน้าต่างทีละคันถึงจะรู้ (user ขอ 03/09/69) */}
              <DamageList items={dmgOf(it)} />
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => onChange([...items, Object.fromEntries(OPPONENT_KEYS.map((k) => [k, ''])) as LooseRecord])}
        className="px-3 py-1.5 text-sm border border-gray-300 rounded-none hover:bg-gray-50 text-gray-700"
      >
        + เพิ่มคู่กรณี
      </button>
      {/* หน้าต่างเดียวกับของรถประกัน — ช่องข้างในไม่มี name จึงไม่ปนกับ FormData ของฟอร์มหลัก */}
      {dmgFor !== null && items[dmgFor] && (
        <DamageDialog
          open items={dmgOf(items[dmgFor])}
          onClose={() => setDmgFor(null)}
          onSave={(next) => onChange(items.map((x, idx) => (idx === dmgFor ? { ...x, damage: next } : x)))}
        />
      )}
    </div>
  );
}

/** ทิ้งคันที่ยังไม่กรอกอะไรเลย — ไม่นับ `damage`/`kfk` เพราะการ์ดเปล่าก็มีสองคีย์นี้ติดมาได้ */
export const dropEmptyOpponents = (items: LooseRecord[]): LooseRecord[] =>
  items.filter((it) => OPPONENT_KEYS.some((k) => String(it[k] ?? '').trim() !== ''));
