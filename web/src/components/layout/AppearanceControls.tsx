'use client';

import { useEffect, useState } from 'react';

/**
 * ── ตั้งค่าการแสดงผล: ขนาดตัวอักษร ── (user ขอ 02/09/69)
 *
 * ฟอนต์: user ตัดสินใจใช้ **Sarabun ตัวเดียว** (15/09/69) — ถอดตัวเลือกฟอนต์ออกแล้ว
 * (เดิมสลับได้ 3 แบบ เก็บใน localStorage 'ui_font') ทั้งเว็บอ่าน --font-thai = Sarabun จาก globals.css
 *
 * ขนาดตัวอักษรเก็บไว้ในเครื่องของคนเลือก **ไม่ใช่ค่าของทั้งระบบ** → พนักงานสายตาไม่เท่ากัน
 * ตั้งคนละขนาดพร้อมกันได้ ไม่กวนกัน
 *
 * ⛔ ขนาดตัวอักษรทำโดยขยับ font-size ของ <html> — ทั้งเว็บวัดเป็น rem จึงโตตามกันหมด
 *    (ตัวหนังสือ ช่องกรอก ระยะห่าง) **ยกเว้นจุดสลับเลย์เอาต์ min-[1500px] ที่ผูกกับ
 *    ความกว้างจอจริง** ตั้งใจให้เป็นแบบนั้น — ขยายแล้วจอไม่ได้กว้างขึ้น
 * ⛔ คีย์ ui_scale กับรูปแบบค่า ต้องตรงกับสคริปต์ท้าย <head> ใน layout.tsx
 *    ซึ่งอ่านค่าเดียวกันนี้ก่อนหน้าถูกวาด (ไม่งั้นหน้าแวบเปลี่ยนทุกครั้งที่เปิด)
 */
/** 5 ระดับ · 100% คือขนาดออกแบบ ที่เหลือคือใหญ่ขึ้นเท่านั้น (เล็กกว่านี้อ่านฟอร์มไม่ไหว) */
const SCALES = [100, 110, 120, 130, 140];

export const applyScale = (pct: number) => {
  document.documentElement.style.fontSize = pct === 100 ? '' : `${(16 * pct) / 100}px`;
};

export default function AppearanceControls({ compact = false }: { compact?: boolean }) {
  const [scale, setScale] = useState(100);

  useEffect(() => {
    try {
      const s = Number(localStorage.getItem('ui_scale'));
      if (SCALES.includes(s)) setScale(s);
      // ค่าฟอนต์ที่เคยเลือกไว้ (ก่อน 15/09/69) ไม่มีผลแล้ว — ล้างทิ้งกันสับสน
      localStorage.removeItem('ui_font');
    } catch { /* โหมดส่วนตัว/ปิดคุกกี้ — ใช้ค่าตั้งต้นไป ไม่ต้องพัง */ }
  }, []);

  const step = (dir: 1 | -1) => {
    const i = SCALES.indexOf(scale);
    const next = SCALES[Math.min(SCALES.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))];
    setScale(next);
    applyScale(next);
    try { localStorage.setItem('ui_scale', String(next)); } catch { /* เหมือนข้างบน */ }
  };

  const BTN = 'w-7 h-7 flex items-center justify-center border border-white/25 text-gray-200'
    + ' hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed';

  // แถบยุบแล้วกว้าง 3.5rem — ใส่ได้แค่ปุ่มย่อ/ขยาย
  if (compact) {
    return (
      <div className="flex flex-col items-center gap-1 pb-3" title={`ขนาดตัวอักษร ${scale}%`}>
        <button type="button" onClick={() => step(1)} disabled={scale === SCALES[SCALES.length - 1]}
          className={BTN} aria-label="ตัวอักษรใหญ่ขึ้น">ก+</button>
        <button type="button" onClick={() => step(-1)} disabled={scale === SCALES[0]}
          className={BTN} aria-label="ตัวอักษรเล็กลง">ก−</button>
      </div>
    );
  }

  return (
    <div className="border-t border-white/15 p-4">
      <div className="flex items-center gap-2">
        <span className="text-[0.6875rem] text-gray-400">ขนาดตัวอักษร</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={() => step(-1)} disabled={scale === SCALES[0]}
            className={BTN} aria-label="เล็กลง">ก−</button>
          <span className="w-10 text-center text-xs text-gray-200 tabular-nums">{scale}%</span>
          <button type="button" onClick={() => step(1)} disabled={scale === SCALES[SCALES.length - 1]}
            className={BTN} aria-label="ใหญ่ขึ้น">ก+</button>
        </div>
      </div>
    </div>
  );
}
