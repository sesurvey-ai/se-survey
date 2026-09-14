'use client';

/**
 * "ทะเบียนพนักงานสำรวจ" ยุบเข้า "จัดการผู้ใช้" แล้ว (user เคาะ 14/09/69: สองหน้าซ้ำกัน)
 * — รหัส/เบอร์โทร/หัวหน้า-ทีม/นำเข้า Excel อยู่ที่ /admin/users ทั้งหมด · ลิงก์เก่าเด้งไปกรองบทบาทช่างสำรวจให้
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminStaffRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/admin/users?role=surveyor'); }, [router]);
  return <div className="p-6 text-sm text-gray-500">หน้านี้ย้ายไปรวมกับ &quot;จัดการผู้ใช้&quot; แล้ว กำลังพาไป…</div>;
}
