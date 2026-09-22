import type { Metadata } from 'next';
import { Sarabun } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/providers/AuthProvider';

/**
 * ── ฟอนต์ของทั้งเว็บ: Sarabun ตัวเดียว ── (user ตัดสินใจ 15/09/69 — เดิมสลับได้ 3 แบบตั้งแต่ 02/09/69)
 *
 * ⛔ ของเดิมโหลดฟอนต์ Geist ไว้แต่ไม่มีใครใช้ (globals.css ทับด้วย Arial) และ Arial
 *    ไม่มีอักขระไทย → ไทยตกไปใช้ฟอนต์ของเครื่องผู้ใช้ (Windows=Leelawadee UI,
 *    Mac=Thonburi) หน้าเดียวกันจึงหน้าตาไม่เหมือนกันคนละเครื่อง
 *
 * เอาน้ำหนักเท่าที่ใช้จริงในซอร์ส: 400 · 500 · 600 · 700
 * ⛔ อย่าโหลดครบ 100-900 — ฟอนต์ไทยไฟล์ใหญ่ ทุกน้ำหนักที่ไม่ได้ใช้คือถ่วงหน้าเปล่า ๆ
 * ⛔ ตัวแปรฟอนต์ต้องอยู่บน <html> — globals.css ตั้ง `--font-thai: var(--font-sarabun)` ที่ :root
 *    ถ้าตัวแปรปลายทางประกาศไว้ที่ body มันจะหาไม่เจอแล้วได้ค่าว่าง
 */
/** ฟอนต์มาตรฐานเอกสารราชการไทย คนไทยคุ้นตาที่สุด · ตัวแคบ บรรทัดหนึ่งจุได้มาก ซึ่งมีผลจริงกับหน้าที่มีเกือบ 200 ช่อง */
const sarabun = Sarabun({
  subsets: ['thai', 'latin'], weight: ['400', '500', '600', '700'],
  variable: '--font-sarabun', display: 'swap',
});

export const metadata: Metadata = {
  title: 'SE Survey — ระบบจัดการงานสำรวจ',
  description: 'ระบบจัดการงานสำรวจสำหรับเจ้าหน้าที่',
};

/**
 * ตั้งขนาดตัวอักษรที่จำไว้ **ก่อน** หน้าถูกวาด — ถ้าไปตั้งใน useEffect
 * ผู้ใช้จะเห็นค่าตั้งต้นแวบหนึ่งแล้วค่อยกระโดดเปลี่ยนทุกครั้งที่เปิดหน้า
 * ⛔ คีย์กับช่วงค่าต้องตรงกับ AppearanceControls.tsx (ui_scale 90-140) · ไม่มีค่าที่จำไว้ = ปล่อยให้ globals.css ให้ 90% (ค่าเริ่มต้น 22/09/69)
 * (ค่าฟอนต์ 'ui_font' ที่เคยจำไว้ไม่อ่านแล้ว — ฟอนต์เป็น Sarabun ตัวเดียวตั้งแต่ 15/09/69)
 */
const UI_BOOT = `try{var d=document.documentElement;
var s=+localStorage.getItem('ui_scale');
if(s>=90&&s<=140)d.style.fontSize=(16*s/100)+'px';}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={sarabun.variable}>
      <head><script dangerouslySetInnerHTML={{ __html: UI_BOOT }} /></head>
      <body className="antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
