'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FontScaleRow } from './AppearanceControls';
import ChangePasswordDialog from './ChangePasswordDialog';

/**
 * ── เมนู "ตั้งค่า" ท้ายแถบข้าง ── (user สั่ง 22/09/69)
 *
 * ปุ่มรูปเฟืองแทนแถบ "ขนาดตัวอักษร ก− 100% ก+" เดิม — กดแล้วเปิดแผงรวมของที่ไม่ใช่งานประจำวัน:
 *   ขนาดตัวอักษร · เปลี่ยนรหัสผ่าน (ทุกบทบาท — เดิมเป็นปุ่มบนแถบหัว ย้ายมา 22/09/69) · บัญชี ISURVEY · ลูกทีมของฉัน (เฉพาะหัวหน้าผู้ตรวจ — เดิมเป็น 2 รายการในเมนูหลัก)
 * เมนูหลักเหลือแต่หน้างาน ของตั้งค่ามารวมที่เดียว
 *
 * ⛔ แถบข้างเป็น overflow-hidden (กันเมนูล้นตอนยุบ) — แผงตอนแถบ "ยุบ" (กว้าง 3.5rem) จึงต้องเป็น fixed
 *    ลอยข้างราง ไม่ใช่ absolute ในแถบ ไม่งั้นโดนตัดขอบ · ตอนกางใช้ absolute เหนือปุ่มในแถบได้ (กว้างพอ)
 * ⛔ เปลี่ยนหน้า / คลิกนอกแผง / Esc = ปิดแผง — แผงค้างทับเมนูหลักคือความรำคาญที่คนจะเลิกใช้
 */
const SETTINGS_LINKS: Record<string, { label: string; href: string; hint: string }[]> = {
  checker: [
    { label: 'บัญชี ISURVEY', href: '/inspector/isurvey/account', hint: 'บัญชีที่ใช้ดึงงานรอตรวจจาก ISURVEY' },
    { label: 'ลูกทีมของฉัน', href: '/inspector/team', hint: 'รายชื่อช่างในทีม (แอดมินเป็นคนตั้ง)' },
  ],
};

interface Props {
  collapsed: boolean;
  role: string;
  pathname: string;
}

export default function SettingsMenu({ collapsed, role, pathname }: Props) {
  const [open, setOpen] = useState(false);
  /** กล่องเปลี่ยนรหัสผ่าน — เปิดจากรายการในแผง (ปิดแผงก่อน ไม่งั้นซ้อนกัน) */
  const [pwOpen, setPwOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const links = SETTINGS_LINKS[role] || [];
  /** อยู่ในหน้าที่มาจากเมนูตั้งค่า → ไฮไลต์ปุ่มเฟืองแทนรายการเมนูหลัก (ที่ไม่มีรายการนี้แล้ว) */
  const onSettingsPage = links.some((l) => pathname === l.href);

  // เปลี่ยนหน้าแล้วปิดแผง (กดลิงก์ในแผงแล้วแผงต้องไม่ค้าง)
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const gear = (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );

  const active = open || onSettingsPage;

  return (
    <div ref={wrapRef} className={collapsed ? 'relative flex justify-center pb-3' : 'relative border-t border-white/15 p-3'}>
      {open && (
        <div
          role="dialog"
          aria-label="ตั้งค่า"
          className={`z-40 rounded-xl bg-gray-800 border border-white/15 shadow-2xl p-3 text-sm ${
            collapsed ? 'fixed left-16 bottom-3 w-72' : 'absolute left-3 right-3 bottom-full mb-2'
          }`}
        >
          <div className="text-[0.6875rem] uppercase tracking-wide text-gray-400 mb-2">ตั้งค่า</div>
          <FontScaleRow />
          <button
            type="button"
            onClick={() => { setOpen(false); setPwOpen(true); }}
            className="w-full text-left px-3 py-2 rounded-lg text-gray-200 hover:bg-gray-700 transition-colors"
          >
            เปลี่ยนรหัสผ่าน
            <span className="block text-[0.6875rem] text-gray-400 font-normal">รหัสผ่านเข้าเว็บของคุณ</span>
          </button>
          {links.length > 0 && (
            <div className="mt-2 pt-2 border-t border-white/10 space-y-0.5">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  title={l.hint}
                  className={`block px-3 py-2 rounded-lg transition-colors ${
                    pathname === l.href ? 'bg-blue-600 text-white' : 'text-gray-200 hover:bg-gray-700'
                  }`}
                >
                  {l.label}
                  <span className="block text-[0.6875rem] text-gray-400 font-normal">{l.hint}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="ตั้งค่า"
        className={collapsed
          ? `w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700 hover:text-white'}`
          : `w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm transition-colors ${active ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}
      >
        {gear}
        {!collapsed && <span>ตั้งค่า</span>}
      </button>
      {pwOpen && <ChangePasswordDialog onClose={() => setPwOpen(false)} />}
    </div>
  );
}
