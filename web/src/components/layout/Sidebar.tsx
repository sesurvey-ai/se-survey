'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import AppearanceControls from './AppearanceControls';

const NAV_ITEMS: Record<string, { label: string; href: string }[]> = {
  admin: [
    { label: 'แดชบอร์ด', href: '/admin' },
    // "ทะเบียนพนักงานสำรวจ" ยุบเข้าหน้านี้แล้ว 14/09/69 (รหัส/เบอร์/หัวหน้า-ทีม/นำเข้า Excel อยู่ในจัดการผู้ใช้)
    { label: 'จัดการผู้ใช้', href: '/admin/users' },
    { label: 'จัดการทีมผู้ตรวจ', href: '/admin/staff-groups' },
    { label: 'จัดการเคส', href: '/admin/cases' },
    { label: 'จัดการรีวิว', href: '/admin/reviews' },
    { label: 'รายงานการโทร', href: '/admin/call-consult' },
    { label: 'ใบลาพนักงาน', href: '/admin/leave' },
    { label: 'เวลาเข้างานพนักงาน · ประจำจุด', href: '/admin/checkin-board' },
    { label: 'เวลาเข้า–ออกงาน', href: '/admin/attendance' },
    { label: 'ตารางเวรประจำจุด', href: '/admin/duty-roster' },
    { label: 'เรทค่าตอบแทน', href: '/admin/billing-rates' },
  ],
  callcenter: [
    { label: 'หน้าหลัก', href: '/callcenter' },
    { label: 'สร้างเคสใหม่', href: '/callcenter/cases/new' },
    { label: 'รายการเคสทั้งหมด', href: '/callcenter/cases' },
    { label: 'พนักงานทั้งหมด', href: '/callcenter/employees' },
    { label: 'ความพร้อมรับแจ้งเตือน', href: '/callcenter/notification-readiness' },
    { label: 'เวลาเข้างานพนักงาน · ประจำจุด', href: '/callcenter/checkin-board' },
    { label: 'เวลาเข้า–ออกงาน', href: '/callcenter/attendance' },
    { label: 'ตารางเวรประจำจุด', href: '/callcenter/duty-roster' },
  ],
  checker: [
    { label: 'รายการงาน', href: '/inspector' },
    // งานจากระบบ ISURVEY เดิม: อัปโหลด XML → สร้างเคส → ตรวจ/แก้ → ปิดงาน → บอทนำเข้า EMCS
    // ⛔ ซ่อนเมนูไว้ก่อน (user สั่ง 15/09/69) — หน้า /inspector/cases/import-xml ยังเปิดตรง ๆ ได้ ทางดึงสดจาก ISURVEY ใช้แทน
    // { label: 'นำเข้าจากไฟล์ XML', href: '/inspector/cases/import-xml' },
    { label: 'งานรอตรวจ (ISURVEY)', href: '/inspector/isurvey' },
    { label: 'บัญชี ISURVEY', href: '/inspector/isurvey/account' },
    { label: 'ลูกทีมของฉัน', href: '/inspector/team' },
  ],
};

const TITLES: Record<string, string> = {
  admin: 'ผู้ดูแลระบบ',
  callcenter: 'รับแจ้งอุบัติเหตุ',
  checker: 'ระบบตรวจสอบ',
};

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  /**
   * เปิดหน้ารายละเอียดเคส = ยุบเมนูให้เอง (user เคาะ 18/08/69)
   *
   * หน้าเคสกว้างเต็มจอทั้งฟอร์ม ~200 ช่อง + รางค่าใช้จ่ายทางขวา — เมนู 256px
   * ที่ไม่ได้ใช้ตอนนั้นเบียดพื้นที่อ่านข้อมูลไปเปล่า ๆ · ออกจากหน้าเคสแล้วกางคืนให้
   * (กางคืนเฉพาะตอนที่ "เรา" เป็นคนยุบ — คนกดยุบเองที่หน้าอื่นต้องไม่ถูกกางแทรก)
   */
  const onCaseDetail = /^\/(inspector|admin|callcenter)\/cases\/\d+/.test(pathname ?? '');
  const autoCollapsed = useRef(false);
  useEffect(() => {
    if (onCaseDetail) { autoCollapsed.current = true; setCollapsed(true); }
    else if (autoCollapsed.current) { autoCollapsed.current = false; setCollapsed(false); }
  }, [onCaseDetail]);
  const role = user?.role || '';
  const items = NAV_ITEMS[role] || [];
  const title = TITLES[role] || 'SE Survey';

  return (
    <>
      {/* ── เมนูข้าง ──
          ตอนยุบไม่ได้หดเหลือ 0 แล้ว แต่เหลือเป็นแถบแคบ ๆ ที่ยัง "กินที่" ตามปกติ
          เดิมปุ่มเปิดเมนูเป็น fixed ลอยทับมุมซ้ายบน → ไปบังเลขเคลมบนแถบหัวเคส
          (user เจอจริง 18/08/69) · ทำเป็นแถบในสายตาแทน เนื้อหาเลยถูกดันมาเองไม่ต้องเผื่อที่ */}
      {/* ⛔ ต้อง sticky + h-screen + self-start ไม่ใช่ min-h-screen —
          เดิมแถบยืดสูงเท่า "ทั้งหน้า" (หน้าตรวจเคสสูงหมื่นกว่า px) ปุ่มฟอนต์/ขนาดตัวอักษร
          ที่อยู่ท้ายแถบจึงไปอยู่ก้นหน้า ต้องเลื่อนสุดหน้าถึงจะเห็น ทั้งที่ไม่เกี่ยวกับเนื้อหา
          (user แจ้ง 02/09/69) · self-start กัน flex ยืดกลับมาเท่าความสูงเนื้อหา */}
      {/* ⛔ ห้ามใส่ transition ให้ความกว้างกลับเข้าไป (เดิม `transition-all duration-300`) —
          ความกว้างแถบกระทบเลย์เอาต์ ทุกเฟรมของอนิเมชันเบราว์เซอร์ต้องคำนวณตำแหน่งใหม่
          ทั้งหน้า (หน้าตรวจเคส = 190 ช่องกรอก · 2,100 กล่อง · สูง 8,000px · ตารางค่าใช้จ่าย
          กว้างเป็น % · รางค่าใช้จ่าย sticky) ติดกัน ~18 เฟรม → กดแล้วกระตุก (user แจ้ง 02/09/69)
          แถมเนื้อหาข้างในสลับทันทีตั้งแต่เฟรมแรก เมนูเต็มจึงถูกยัดในแถบ 56px แล้วค่อย ๆ คลี่
          ดูเป็นตัวหนังสือเด้งไปมา ไม่ใช่เลื่อนออก · ตัดทิ้ง = คำนวณเลย์เอาต์ครั้งเดียว เปลี่ยนทันที
          · overflow-hidden กันเมนูเต็มล้นออกนอกแถบตอนสลับ */}
      <aside className={`bg-[var(--md-ink)] text-white sticky top-0 self-start h-screen shrink-0 flex flex-col overflow-hidden ${collapsed ? 'w-14' : 'w-64'}`}>
        {collapsed ? (
          <>
          <button
            onClick={() => setCollapsed(false)}
            className="w-10 h-10 m-2 rounded-lg flex items-center justify-center text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
            title="เปิดเมนู"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          {/* ตัวคั่นยืดหยุ่น = ดันปุ่มขนาดตัวอักษรลงล่างสุดของแถบ */}
          <div className="flex-1" />
          <AppearanceControls compact />
          </>
        ) : (
          <>
        <div className="p-5 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{title}</h1>
            <p className="text-gray-400 text-xs mt-1">SE Survey System</p>
          </div>
          <button
            onClick={() => setCollapsed(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-700 transition-colors text-gray-400 hover:text-white"
            title="ซ่อนเมนู"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
        {/* ⛔ overflow-x-hidden จำเป็น — ตั้ง overflow-y เป็น auto อย่างเดียวไม่ได้
            เพราะ CSS บังคับให้ overflow-x เปลี่ยนจาก visible เป็น auto ตามไปด้วย
            ป้ายเมนูล้นออกนิดเดียว (ตอนแถบแคบ/ขยายตัวอักษร) ก็มีแถบเลื่อนแนวนอน
            โผล่คาดกลางเมนู เห็นเป็นเส้นแปลกปลอม (user แจ้ง 03/09/69)
            · แถบเลื่อนแนวตั้งทำให้บางและสีกลืนพื้นดำ ไม่ใช่แถบขาวของวินโดวส์ */}
        <nav className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-4 space-y-1
                        [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.25)_transparent]">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block px-4 py-2.5 rounded-lg text-sm transition-colors [overflow-wrap:anywhere] ${
                pathname === item.href
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <AppearanceControls />
          </>
        )}
      </aside>
    </>
  );
}
