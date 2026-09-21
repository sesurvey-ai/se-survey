'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';

const ROLE_LABELS: Record<string, string> = {
  admin: 'ผู้ดูแลระบบ',
  callcenter: 'พนักงานรับแจ้ง',
  checker: 'เจ้าหน้าที่ตรวจสอบ',
};

export default function Header() {
  const { user, logout } = useAuth();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  // ไม่มีหัวข้อฝั่งซ้ายแล้ว (user เคาะ 18/08/69) — "แผงควบคุม" ไม่ได้บอกอะไร
  // ทุกหน้ามีหัวข้อของตัวเองอยู่แล้ว · เหลือแค่ชื่อผู้ใช้กับปุ่มออกจากระบบชิดขวา
  // "เปลี่ยนรหัสผ่าน" ย้ายไปเมนูตั้งค่า (เฟืองท้ายแถบข้าง) แล้ว — user สั่ง 22/09/69 ดู SettingsMenu.tsx
  return (
    <header className="bg-white border-b-2 border-[var(--md-ink)] px-6 py-2.5 flex items-center justify-end">
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-sm font-medium text-gray-700">
            {user?.first_name} {user?.last_name}
          </p>
          <span className="text-[11px] font-bold tracking-wide text-[var(--md-muted-2)] border border-[var(--md-line-2)] px-2 py-0.5">
            {ROLE_LABELS[user?.role || ''] || user?.role}
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="px-3 py-1.5 text-sm font-bold border border-[var(--md-accent)] bg-[var(--md-accent)] text-white hover:brightness-110 transition-colors"
        >
          ออกจากระบบ
        </button>
      </div>
    </header>
  );
}
