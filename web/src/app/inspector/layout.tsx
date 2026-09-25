'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
// หน้าคิวตรวจ/หน้าเคสฟังสัญญาณ case_changed เพื่ออัปเดตเองโดยไม่ต้องกด F5
// ไม่มี provider = useSocket() คืน null แล้วเหลือแต่การโหลดซ้ำตามเวลา (ช้ากว่ามาก)
import { SocketProvider } from '@/providers/SocketProvider';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';

/**
 * แอดมินเปิด "หน้าตรวจเคสรายใบ" ได้ (user สั่ง 23/09/69) — เดิมทั้งส่วนนี้ให้เฉพาะ checker
 * ปุ่มของแอดมินในหน้าเคส (เลิกยกเลิก · ปลดล็อก · แก้เลขระบุเคส) จึงไม่มีใครกดได้จริง
 * หน้าอื่นของหัวหน้า (รายการงาน · งานรอตรวจ ISURVEY · นำเข้า XML) ยังเฉพาะ checker — API พวกนั้นรับเฉพาะหัวหน้า
 * 25/09/69: + หน้า "งานแก้ไข/ต่อเนื่อง (EMCS)" (/inspector/emcs) — API รับทั้ง checker และ admin · มีในเมนูแอดมิน
 */
const ADMIN_PAGES = /^\/inspector\/(?:cases\/\d+|emcs)\/?$/;

export default function InspectorLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const adminAllowed = user?.role === 'admin' && ADMIN_PAGES.test(pathname);

  useEffect(() => {
    if (!loading) {
      if (!isAuthenticated) router.replace('/login');
      else if (user?.role !== 'checker' && !adminAllowed) router.replace(user?.role === 'admin' ? '/admin' : '/login');
    }
  }, [isAuthenticated, loading, user, router, adminAllowed]);

  if (loading || !isAuthenticated) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div></div>;
  }

  return (
    <SocketProvider>
      <div className="flex min-h-screen min-w-[1024px]">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <Header />
          <main className="flex-1 p-4 bg-[var(--md-bg)]">{children}</main>
        </div>
      </div>
    </SocketProvider>
  );
}
