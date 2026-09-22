'use client';

import { useEffect, useState } from 'react';

/**
 * ── ตั้งค่าการแสดงผล: ขนาดตัวอักษร ── (user ขอ 02/09/69 · ย้ายเข้าเมนู "ตั้งค่า" รูปเฟือง 22/09/69 ดู SettingsMenu.tsx)
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
/**
 * 7 ระดับ 80–140 · **ค่าเริ่มต้น 100%** = ขนาดที่ออกแบบ (user เคาะรอบ 2 22/09/69: เคยตั้ง 90 เป็นค่าเริ่มต้นอยู่ครึ่งวัน
 * แล้วเปลี่ยนเป็น "ให้แต่ละคนเลือกเอง" — เพิ่มขั้น 80/90 ให้ย่อได้ แต่ทุกคนเริ่มที่ 100)
 * ค่าที่เลือก **จำต่อเครื่อง/เบราว์เซอร์** (localStorage ui_scale) และตั้งให้ทุกครั้งที่เปิดหน้า = "ล็อก" ไว้จนกว่าจะกดเปลี่ยนเอง
 * ไม่ผูกกับบัญชี — ล็อกอินเครื่องอื่นได้ 100% · ⛔ ช่วงค่าต้องตรงกับสคริปต์บูตใน layout.tsx (s>=80&&s<=140)
 */
const SCALES = [80, 90, 100, 110, 120, 130, 140];
export const DEFAULT_SCALE = 100;

export const applyScale = (pct: number) => {
  document.documentElement.style.fontSize = `${(16 * pct) / 100}px`;
};

/** แถว "ขนาดตัวอักษร ก− 100% ก+" — วางในแผงตั้งค่า (พื้นเข้ม) */
export function FontScaleRow() {
  const [scale, setScale] = useState(DEFAULT_SCALE);

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

  const BTN = 'w-7 h-7 flex items-center justify-center border border-white/25 text-gray-200 rounded'
    + ' hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed';

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="text-gray-200">ขนาดตัวอักษร</span>
      <div className="ml-auto flex items-center gap-1">
        <button type="button" onClick={() => step(-1)} disabled={scale === SCALES[0]}
          className={BTN} aria-label="เล็กลง">ก−</button>
        <span className="w-10 text-center text-xs text-gray-200 tabular-nums">{scale}%</span>
        <button type="button" onClick={() => step(1)} disabled={scale === SCALES[SCALES.length - 1]}
          className={BTN} aria-label="ใหญ่ขึ้น">ก+</button>
      </div>
    </div>
  );
}
