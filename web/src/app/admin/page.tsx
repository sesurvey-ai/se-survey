'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import api from '@/lib/api';

interface DashboardStats {
  users: { total: number; by_role: Record<string, number> };
  cases: { total: number; by_status: Record<string, number> };
  reviews: { total: number };
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'ผู้ดูแลระบบ',
  surveyor: 'ช่างสำรวจ',
  callcenter: 'พนักงานรับแจ้ง',
  checker: 'ผู้ตรวจสอบ',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'รอดำเนินการ',
  assigned: 'มอบหมายแล้ว',
  finished: 'เสร็จงานแล้ว',
  surveyed: 'สำรวจแล้ว',
  reviewed: 'ตรวจสอบแล้ว',
  declined: 'ปฏิเสธแล้ว',
  cancelled: 'ยกเลิก',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  assigned: 'bg-blue-100 text-blue-800',
  finished: 'bg-teal-100 text-teal-800',
  surveyed: 'bg-yellow-100 text-yellow-800',
  reviewed: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
  cancelled: 'bg-red-50 text-red-800',
};

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/admin/dashboard')
      .then((res) => { if (res.data.success) setStats(res.data.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="flex justify-center py-12"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div></div>;
  }

  if (!stats) {
    return <div className="text-center text-gray-500 py-12">ไม่สามารถโหลดข้อมูลได้</div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">แดชบอร์ดผู้ดูแลระบบ</h1>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Link href="/admin/users" className="block p-6 bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">ผู้ใช้ทั้งหมด</p>
              <p className="text-3xl font-bold text-gray-800 mt-1">{stats.users.total}</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-2xl">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" /></svg>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(stats.users.by_role).map(([role, count]) => (
              <span key={role} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {ROLE_LABELS[role] || role}: {count}
              </span>
            ))}
          </div>
        </Link>

        <Link href="/admin/cases" className="block p-6 bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">เคสทั้งหมด</p>
              <p className="text-3xl font-bold text-gray-800 mt-1">{stats.cases.total}</p>
            </div>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(stats.cases.by_status).map(([status, count]) => (
              <span key={status} className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'}`}>
                {STATUS_LABELS[status] || status}: {count}
              </span>
            ))}
          </div>
        </Link>

        <Link href="/admin/reviews" className="block p-6 bg-white rounded-xl shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-500">รีวิวทั้งหมด</p>
              <p className="text-3xl font-bold text-gray-800 mt-1">{stats.reviews.total}</p>
            </div>
            <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            </div>
          </div>
        </Link>
      </div>

      {/* Quick Actions */}
      <h2 className="text-lg font-semibold text-gray-700 mb-4">การดำเนินการด่วน</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/admin/users/new" className="flex items-center gap-3 p-4 bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
          <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">เพิ่มผู้ใช้ใหม่</p>
            <p className="text-xs text-gray-500">สร้างบัญชีผู้ใช้งานใหม่</p>
          </div>
        </Link>
        <Link href="/admin/users" className="flex items-center gap-3 p-4 bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
          <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" /></svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">จัดการผู้ใช้</p>
            <p className="text-xs text-gray-500">ดู แก้ไข ลบ ผู้ใช้งาน</p>
          </div>
        </Link>
        <Link href="/admin/cases" className="flex items-center gap-3 p-4 bg-white rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
          <div className="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-800">จัดการเคส</p>
            <p className="text-xs text-gray-500">ดู แก้ไข ลบ เคสทั้งหมด</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
