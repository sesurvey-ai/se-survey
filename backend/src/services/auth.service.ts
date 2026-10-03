import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { StringValue } from 'ms';
import { db } from '../config/database';
import { env } from '../config/env';
import { AppError, UnauthorizedError } from '../middleware/errorHandler';
import { assertStrongPassword } from './password';

export const authService = {
  async login(username: string, password: string) {
    // phone = เบอร์ของตัวเอง → แอปเติมช่อง "โทรศัพท์สำรวจ" (ช่องบังคับ EMCS) ให้ช่างไม่ต้องพิมพ์ทุกงาน (03/10/69)
    const result = await db.query(
      'SELECT id, username, password_hash, first_name, last_name, role, code, phone, is_active FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1',
      [username]
    );

    const user = result.rows[0];
    if (!user) {
      throw new UnauthorizedError('Invalid username or password');
    }

    if (!user.is_active) {
      throw new UnauthorizedError('Account is deactivated');
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedError('Invalid username or password');
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as StringValue }
    );

    const { password_hash, ...userWithoutPassword } = user;
    return { token, user: userWithoutPassword };
  },

  /**
   * เปลี่ยนรหัสผ่านของตัวเอง — ต้องกรอกรหัสเดิมยืนยันเสมอ
   *
   * ทำไมต้องขอรหัสเดิมทั้งที่ล็อกอินอยู่แล้ว: จอที่เปิดค้างไว้ไม่ได้แปลว่าเป็นเจ้าของบัญชี
   * (คอมกลางในออฟฟิศ ลุกไปกินข้าวแล้วไม่ล็อกจอ) ถ้าไม่ขอ ใครเดินมาก็ยึดบัญชีได้เลย
   *
   * ⚠️ ข้อจำกัดที่รู้ตัว: token เป็น JWT ไม่มีทะเบียนเพิกถอน — เครื่องอื่นที่ล็อกอินค้างไว้
   *    ด้วยรหัสเก่า **ยังใช้ได้จนกว่า token จะหมดอายุ** (15 วัน) เปลี่ยนรหัสไม่ได้เตะออก
   *    จะปิดช่องนี้ต้องเก็บ token_version ต่อผู้ใช้แล้วเช็คตอน verify — เป็นงานแยก
   */
  async changePassword(userId: number, currentPassword: string, newPassword: string) {
    const result = await db.query(
      'SELECT id, username, password_hash FROM users WHERE id = $1 AND is_active = true LIMIT 1',
      [userId]
    );
    const user = result.rows[0];
    if (!user) throw new UnauthorizedError('ไม่พบบัญชีผู้ใช้');

    if (!(await bcrypt.compare(currentPassword, user.password_hash))) {
      throw new AppError(400, 'รหัสผ่านเดิมไม่ถูกต้อง');
    }
    // เทียบก่อนตรวจความแข็งแรง — "ตั้งรหัสเดิมซ้ำ" ควรได้ข้อความที่ตรงเรื่อง
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      throw new AppError(400, 'รหัสผ่านใหม่ซ้ำกับรหัสเดิม');
    }
    assertStrongPassword(newPassword, user.username);

    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2',
      [await bcrypt.hash(newPassword, 10), userId]);
    return { message: 'เปลี่ยนรหัสผ่านแล้ว' };
  },
};
