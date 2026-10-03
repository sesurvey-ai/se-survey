import { db } from '../config/database';
import { NotFoundError } from '../middleware/errorHandler';

export const userService = {
  async getProfile(userId: number) {
    // phone: แอปที่ล็อกอินค้างไว้ก่อนอัปเดตได้เบอร์จากตรงนี้ (refresh ตอนเปิดแอป) — ใช้เติมช่อง "โทรศัพท์สำรวจ"
    const result = await db.query(
      'SELECT id, username, first_name, last_name, role, code, phone, supervisor_id, is_active, created_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User not found');
    }

    return result.rows[0];
  },

  async updateFcmToken(userId: number, fcmToken: string) {
    await db.query(
      'UPDATE users SET fcm_token = $1 WHERE id = $2',
      [fcmToken, userId]
    );
  },

  /**
   * ใครรับแจ้งเตือนงานใหม่ได้บ้าง — สำหรับออฟฟิศไล่ตามคนที่ยังไม่พร้อม
   *
   * ⛔ ไม่มี fcm_token = **จ่ายงานไปก็ไม่มีอะไรขึ้นบนเครื่องเลย** ไม่ใช่แค่ช้า
   *    (ตรวจ prod 31/08/69: ผู้สำรวจ active 152 คน มี token แค่ 83 — อีก 69 คนเงียบสนิท)
   *    token ลงทะเบียนเองทุกครั้งที่เปิดแอป → ไม่มี token มักแปลว่า "ยังไม่เคยเปิดแอปใหม่"
   *
   * last_push_ok = ครั้งล่าสุดที่แจ้งเตือน **ถึงเครื่องจริง** (เครื่องตอบรับกลับมา)
   * ⛔ อย่าใช้เวลารายงานพิกัดแทน: พิกัดถูกบันทึกเฉพาะตอนแอดมินกดขอ ไม่ใช่สัญญาณว่าเครื่องตื่น
   *    และ surveyor_locations.recorded_at เป็น TIMESTAMP ไม่มีโซน = อ่านออกมาเพี้ยน 7 ชม.
   */
  async notificationReadiness() {
    const result = await db.query(
      `SELECT u.id, u.username, u.code, u.first_name, u.last_name,
              (u.fcm_token IS NOT NULL) AS has_token,
              p.last_push_ok
         FROM users u
         LEFT JOIN LATERAL (
              SELECT max(push_delivered_at) AS last_push_ok
                FROM cases WHERE assigned_to = u.id
         ) p ON true
        WHERE u.role = 'surveyor' AND u.is_active = true
        ORDER BY (u.fcm_token IS NOT NULL), u.code NULLS LAST, u.username`
    );
    const rows = result.rows;
    return {
      total: rows.length,
      ready: rows.filter((r) => r.has_token).length,
      not_ready: rows.filter((r) => !r.has_token).length,
      surveyors: rows,
    };
  },
};
