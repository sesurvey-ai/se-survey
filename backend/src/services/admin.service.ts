import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { db } from '../config/database';
import { staffGroupService } from './staffGroup.service';
import { removeCapture } from './sebilling.service';
import { env } from '../config/env';
import { NotFoundError, AppError } from '../middleware/errorHandler';
import { assertStrongPassword } from './password';

interface PaginationParams {
  page?: number;
  limit?: number;
}

interface UserFilters extends PaginationParams {
  role?: string;
  is_active?: boolean;
  search?: string;
}

interface CaseFilters extends PaginationParams {
  status?: string;
  search?: string;
}

interface ReviewFilters extends PaginationParams {
  status?: string;
}

export const adminService = {
  // ==================== Dashboard ====================
  async getDashboardStats() {
    const [usersTotal, usersByRole, casesTotal, casesByStatus, reviewsTotal] = await Promise.all([
      db.query('SELECT COUNT(*)::int AS count FROM users'),
      db.query('SELECT role, COUNT(*)::int AS count FROM users GROUP BY role'),
      db.query('SELECT COUNT(*)::int AS count FROM cases'),
      db.query('SELECT status, COUNT(*)::int AS count FROM cases GROUP BY status'),
      db.query('SELECT COUNT(*)::int AS count FROM reviews'),
    ]);

    const byRole: Record<string, number> = {};
    usersByRole.rows.forEach((r: { role: string; count: number }) => { byRole[r.role] = r.count; });

    const byStatus: Record<string, number> = {};
    casesByStatus.rows.forEach((r: { status: string; count: number }) => { byStatus[r.status] = r.count; });

    return {
      users: { total: usersTotal.rows[0].count, by_role: byRole },
      cases: { total: casesTotal.rows[0].count, by_status: byStatus },
      reviews: { total: reviewsTotal.rows[0].count },
    };
  },

  // ==================== Users CRUD ====================
  async getUsers(filters: UserFilters = {}) {
    const { role, is_active, search, page = 1, limit = 20 } = filters;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (role) {
      conditions.push(`role = $${idx++}`);
      params.push(role);
    }
    if (is_active !== undefined) {
      conditions.push(`is_active = $${idx++}`);
      params.push(is_active);
    }
    if (search) {
      // ค้นด้วยรหัสพนักงาน (SE315) ได้ด้วย — หน้าจัดการผู้ใช้เป็นทะเบียนพนักงานสำรวจแล้ว (14/09/69)
      conditions.push(`(username ILIKE $${idx} OR first_name ILIKE $${idx} OR last_name ILIKE $${idx} OR code ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      db.query(
        // app_version = เวอร์ชันแอปล่าสุดที่เครื่องคนนี้ยิงเข้ามา (soft mode ไม่บล็อก)
        // ไว้ไล่ดูว่าใครยังไม่อัป APK — แจกด้วยมือ ไม่มีทางรู้จากที่อื่น
        `SELECT id, username, code, first_name, last_name, role, supervisor_id, is_active, phone, created_at,
                app_version, to_char(app_version_at, 'YYYY-MM-DD HH24:MI') AS app_version_at,
                -- หัวหน้า/ทีม (14/09/69 หน้าจัดการผู้ใช้โชว์คอลัมน์นี้แทนหน้าทะเบียนที่ยุบไป):
                -- ทีมผู้ตรวจที่สังกัด = ที่มาจริง · ชื่อหัวหน้าจากช่องเก่า (ซิงก์กับทีมแล้ว) ไว้เผื่อยังไม่มีทีม
                (SELECT g.name FROM staff_group_members m JOIN staff_groups g ON g.id = m.group_id
                  WHERE m.surveyor_id = users.id ORDER BY m.id DESC LIMIT 1) AS staff_group_name,
                (SELECT s.first_name || ' ' || s.last_name FROM users s WHERE s.id = users.supervisor_id) AS supervisor_name
         FROM users ${where} ORDER BY id ASC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
      db.query(`SELECT COUNT(*)::int AS total FROM users ${where}`, params),
    ]);

    return {
      users: dataResult.rows,
      total: countResult.rows[0].total,
      page,
      limit,
      totalPages: Math.ceil(countResult.rows[0].total / limit),
    };
  },

  async getUserById(id: number) {
    const result = await db.query(
      'SELECT id, username, code, first_name, last_name, role, supervisor_id, is_active, phone, created_at FROM users WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) throw new NotFoundError('User not found');
    // ทีม/หัวหน้าของช่าง — หน้าแก้ไขต้องเห็นค่าปัจจุบัน
    return { ...result.rows[0], staff_group_id: await staffGroupService.groupOfSurveyor(id) };
  },

  async createUser(data: { staff_group_id?: number | null; username: string; password: string; first_name: string; last_name: string; role: string; supervisor_id?: number; code?: string; phone?: string }) {
    // เทียบแบบไม่สนตัวพิมพ์ — login ใช้ LOWER(username) จึงห้ามมีชื่อซ้ำต่างเคส (เช่น SE408 กับ se408)
    const existing = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [data.username]);
    if (existing.rows.length > 0) throw new AppError(409, 'Username already exists');

    // กติกาเดียวกับตอนผู้ใช้เปลี่ยนรหัสเอง — ไม่งั้นแอดมินตั้งรหัสอ่อนให้ได้ตั้งแต่แรก
    // แล้วกติกาฝั่งผู้ใช้ก็ไม่มีความหมาย (คนส่วนใหญ่ไม่เคยเปลี่ยนรหัสที่แอดมินตั้งให้)
    assertStrongPassword(data.password, data.username);
    // ช่างใหม่ต้องมีหัวหน้ากำกับตั้งแต่วันแรก (user เคาะ 04/09/69) — ไม่งั้นงานเขาจะไม่โผล่ให้หัวหน้าคนไหนเลย
    // (หน้างานรอตรวจกรองตามทีม) · บทบาทอื่นไม่เกี่ยว
    if (data.role === 'surveyor' && !data.staff_group_id) {
      throw new AppError(400, 'ช่างสำรวจต้องระบุหัวหน้า/ทีมที่สังกัด');
    }
    const hash = await bcrypt.hash(data.password, 10);
    const result = await db.query(
      `INSERT INTO users (username, password_hash, first_name, last_name, role, supervisor_id, code, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, username, code, first_name, last_name, role, supervisor_id, is_active, phone, created_at`,
      [data.username, hash, data.first_name, data.last_name, data.role, data.supervisor_id || null,
       data.code || null, data.phone || null]
    );
    const user = result.rows[0];
    if (data.role === 'surveyor') await staffGroupService.setSurveyorGroup(user.id, data.staff_group_id ?? null);
    return { ...user, staff_group_id: data.role === 'surveyor' ? data.staff_group_id ?? null : null };
  },

  async updateUser(id: number, data: { staff_group_id?: number | null; first_name?: string; last_name?: string; role?: string; supervisor_id?: number | null; is_active?: boolean; password?: string; code?: string | null; phone?: string | null }) {
    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.first_name !== undefined) { fields.push(`first_name = $${idx++}`); params.push(data.first_name); }
    if (data.last_name !== undefined) { fields.push(`last_name = $${idx++}`); params.push(data.last_name); }
    if (data.role !== undefined) { fields.push(`role = $${idx++}`); params.push(data.role); }
    if (data.supervisor_id !== undefined) { fields.push(`supervisor_id = $${idx++}`); params.push(data.supervisor_id); }
    if (data.is_active !== undefined) { fields.push(`is_active = $${idx++}`); params.push(data.is_active); }
    if (data.code !== undefined) { fields.push(`code = $${idx++}`); params.push(data.code || null); }
    if (data.phone !== undefined) { fields.push(`phone = $${idx++}`); params.push(data.phone || null); }
    if (data.password) {
      // แอดมินรีเซ็ตรหัสให้คนอื่น — ต้องผ่านกติกาเดียวกัน และห้ามตั้งเป็นชื่อผู้ใช้ของ
      // เจ้าของบัญชี (ไม่ใช่ของแอดมิน) จึงต้องอ่าน username ของ id ที่กำลังแก้
      const target = await db.query('SELECT username FROM users WHERE id = $1', [id]);
      if (target.rows.length === 0) throw new NotFoundError('User not found');
      assertStrongPassword(data.password, target.rows[0].username);
      const hash = await bcrypt.hash(data.password, 10);
      fields.push(`password_hash = $${idx++}`);
      params.push(hash);
    }

    if (fields.length === 0 && data.staff_group_id === undefined) throw new AppError(400, 'No fields to update');

    let row: Record<string, unknown>;
    if (fields.length > 0) {
      params.push(id);
      const result = await db.query(
        `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}
         RETURNING id, username, code, first_name, last_name, role, supervisor_id, is_active, phone, created_at`,
        params
      );
      if (result.rows.length === 0) throw new NotFoundError('User not found');
      row = result.rows[0];
    } else {
      row = await this.getUserById(id);
    }
    // ทีม/หัวหน้า — ตั้งหลังอัปเดตชื่อ/รหัส เพื่อให้ข้อความสมาชิกเป็นค่าล่าสุด · ส่ง null = เอาออกจากทีม
    if (data.staff_group_id !== undefined) {
      await staffGroupService.setSurveyorGroup(id, data.staff_group_id ?? null);
    }
    return { ...row, staff_group_id: await staffGroupService.groupOfSurveyor(id) };
  },

  async deleteUser(id: number, adminId: number) {
    if (id === adminId) throw new AppError(400, 'Cannot deactivate yourself');

    const result = await db.query(
      `UPDATE users SET is_active = false WHERE id = $1
       RETURNING id, username, first_name, last_name, role, is_active`,
      [id]
    );
    if (result.rows.length === 0) throw new NotFoundError('User not found');
    return result.rows[0];
  },

  // ==================== Cases CRUD ====================
  async getCases(filters: CaseFilters = {}) {
    const { status, search, page = 1, limit = 20 } = filters;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`c.status = $${idx++}`);
      params.push(status);
    }
    if (search) {
      // ค้นด้วยเลขเคลม/เลขเซอร์เวย์ได้ด้วย — แอดมินหาเคสจากเลขที่คนแจ้งมา ไม่ใช่ชื่อลูกค้า (user 04/09/69)
      conditions.push(`(c.customer_name ILIKE $${idx} OR c.incident_location ILIKE $${idx}
                        OR sr.claim_no ILIKE $${idx} OR sr.survey_job_no ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;
    // เลขเคลม/เลขเซอร์เวย์อยู่ที่ survey_reports (ปกติ 1 แถวต่อเคส — เอาแถวล่าสุดกันซ้ำ)
    const reportJoin = `LEFT JOIN LATERAL (
         SELECT sr.claim_no, sr.survey_job_no FROM survey_reports sr
          WHERE sr.case_id = c.id ORDER BY sr.id DESC LIMIT 1) sr ON TRUE`;

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `SELECT c.*, sr.claim_no, sr.survey_job_no,
                u.first_name AS surveyor_first_name, u.last_name AS surveyor_last_name,
                cr.first_name AS creator_first_name, cr.last_name AS creator_last_name
         FROM cases c
         ${reportJoin}
         LEFT JOIN users u ON c.assigned_to = u.id
         LEFT JOIN users cr ON c.created_by = cr.id
         ${where}
         ORDER BY c.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
      db.query(`SELECT COUNT(*)::int AS total FROM cases c ${reportJoin} ${where}`, params),
    ]);

    return {
      cases: dataResult.rows,
      total: countResult.rows[0].total,
      page,
      limit,
      totalPages: Math.ceil(countResult.rows[0].total / limit),
    };
  },

  async getCaseById(id: number) {
    const caseResult = await db.query(
      `SELECT c.*, u.first_name AS surveyor_first_name, u.last_name AS surveyor_last_name
       FROM cases c LEFT JOIN users u ON c.assigned_to = u.id WHERE c.id = $1`,
      [id]
    );
    if (caseResult.rows.length === 0) throw new NotFoundError('Case not found');

    const reportResult = await db.query('SELECT * FROM survey_reports WHERE case_id = $1', [id]);

    let photos: unknown[] = [];
    if (reportResult.rows.length > 0) {
      const photoResult = await db.query('SELECT * FROM survey_photos WHERE report_id = $1', [reportResult.rows[0].id]);
      photos = photoResult.rows;
    }

    const reviewResult = await db.query('SELECT * FROM reviews WHERE case_id = $1', [id]);

    return {
      case: caseResult.rows[0],
      report: reportResult.rows[0] || null,
      photos,
      review: reviewResult.rows[0] || null,
    };
  },

  async updateCase(id: number, data: { customer_name?: string; incident_location?: string; status?: string; assigned_to?: number | null }) {
    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.customer_name !== undefined) { fields.push(`customer_name = $${idx++}`); params.push(data.customer_name); }
    if (data.incident_location !== undefined) { fields.push(`incident_location = $${idx++}`); params.push(data.incident_location); }
    if (data.status !== undefined) { fields.push(`status = $${idx++}`); params.push(data.status); }
    if (data.assigned_to !== undefined) { fields.push(`assigned_to = $${idx++}`); params.push(data.assigned_to); }

    if (fields.length === 0) throw new AppError(400, 'No fields to update');

    params.push(id);
    const result = await db.query(
      `UPDATE cases SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) throw new NotFoundError('Case not found');
    return result.rows[0];
  },

  async deleteCase(id: number) {
    // แถวในบัญชี se-billing ของเคสนี้ (ถ้าเคยอนุมัติแล้วส่งไป) ต้องถอนก่อน — ลบเคสแล้วปล่อยแถวค้าง
    // = ยอดผีในบัญชีที่ไม่มีเคสให้ย้อนดู (removeCapture ไม่ throw · ไม่ได้ตั้ง SEBILLING_URL = ข้าม)
    await removeCapture(id);
    // Find related photos before deleting
    const surveyPhotos = await db.query(
      `SELECT sp.file_path FROM survey_photos sp
       JOIN survey_reports sr ON sp.report_id = sr.id
       WHERE sr.case_id = $1`,
      [id]
    );
    const caseImages = await db.query(
      'SELECT file_path FROM case_images WHERE case_id = $1',
      [id]
    );

    // Delete related records in correct order (foreign key dependencies) — ห่อ transaction เดียว
    // กัน pooler ตัดกลางคัน แล้วเหลือเคสครึ่งๆ (case ยังอยู่ แต่ report/photos/review หาย กู้ไม่ได้)
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM survey_expenses WHERE report_id IN (SELECT id FROM survey_reports WHERE case_id = $1)`,
        [id]
      );
      await client.query(
        `DELETE FROM survey_photos WHERE report_id IN (SELECT id FROM survey_reports WHERE case_id = $1)`,
        [id]
      );
      await client.query('DELETE FROM survey_reports WHERE case_id = $1', [id]);
      await client.query('DELETE FROM reviews WHERE case_id = $1', [id]);
      await client.query('DELETE FROM case_images WHERE case_id = $1', [id]);

      const result = await client.query('DELETE FROM cases WHERE id = $1 RETURNING id', [id]);
      if (result.rows.length === 0) throw new NotFoundError('Case not found');

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // Delete photo files from disk + cleanup empty folders (หลัง COMMIT — ไฟล์หายกู้ไม่ได้ ทำหลังยืนยัน)
    const foldersToClean = new Set<string>();
    for (const photo of [...surveyPhotos.rows, ...caseImages.rows]) {
      const filePath = path.join(env.UPLOAD_DIR, photo.file_path);
      try { fs.unlinkSync(filePath); } catch { /* file may not exist */ }
      // เก็บ path โฟลเดอร์ย่อยเพื่อลบทีหลัง
      const dir = path.dirname(filePath);
      if (dir !== path.resolve(env.UPLOAD_DIR)) foldersToClean.add(dir);
    }

    // ลบโฟลเดอร์ย่อย (surveyJobNo) แล้วลบโฟลเดอร์แม่ (claimNo) ถ้าว่าง
    for (const folder of foldersToClean) {
      try {
        if (fs.existsSync(folder) && fs.readdirSync(folder).length === 0) {
          fs.rmdirSync(folder);
          const parent = path.dirname(folder);
          if (parent !== path.resolve(env.UPLOAD_DIR) && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
            fs.rmdirSync(parent);
          }
        }
      } catch { /* skip */ }
    }

    return { id };
  },

  // ==================== Reviews CRUD ====================
  async getReviews(filters: ReviewFilters = {}) {
    const { status, page = 1, limit = 20 } = filters;
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (status) {
      conditions.push(`r.status = $${idx++}`);
      params.push(status);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      db.query(
        `SELECT r.*, c.customer_name, c.incident_location,
                ch.first_name AS checker_first_name, ch.last_name AS checker_last_name
         FROM reviews r
         JOIN cases c ON r.case_id = c.id
         LEFT JOIN users ch ON r.checker_id = ch.id
         ${where}
         ORDER BY r.reviewed_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
      db.query(`SELECT COUNT(*)::int AS total FROM reviews r ${where}`, params),
    ]);

    return {
      reviews: dataResult.rows,
      total: countResult.rows[0].total,
      page,
      limit,
      totalPages: Math.ceil(countResult.rows[0].total / limit),
    };
  },

  // ดึงรีวิวเดี่ยวตาม id — หน้าแก้รีวิวเดิมดึงมา 100 อันล่าสุดแล้ว .find() → รีวิวเก่าแก้ไม่ได้
  async getReviewById(id: number) {
    const result = await db.query(
      `SELECT r.*, c.customer_name, c.incident_location,
              ch.first_name AS checker_first_name, ch.last_name AS checker_last_name
       FROM reviews r
       JOIN cases c ON r.case_id = c.id
       LEFT JOIN users ch ON r.checker_id = ch.id
       WHERE r.id = $1`,
      [id]
    );
    if (result.rows.length === 0) throw new NotFoundError('Review not found');
    return result.rows[0];
  },

  async updateReview(id: number, data: { comment?: string; proposed_fee?: number; approved_fee?: number; status?: string }) {
    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.comment !== undefined) { fields.push(`comment = $${idx++}`); params.push(data.comment); }
    if (data.proposed_fee !== undefined) { fields.push(`proposed_fee = $${idx++}`); params.push(data.proposed_fee); }
    if (data.approved_fee !== undefined) { fields.push(`approved_fee = $${idx++}`); params.push(data.approved_fee); }
    if (data.status !== undefined) { fields.push(`status = $${idx++}`); params.push(data.status); }

    if (fields.length === 0) throw new AppError(400, 'No fields to update');

    params.push(id);
    const result = await db.query(
      `UPDATE reviews SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) throw new NotFoundError('Review not found');
    return result.rows[0];
  },

  async deleteReview(id: number) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const review = await client.query('SELECT case_id FROM reviews WHERE id = $1', [id]);
      if (review.rows.length === 0) throw new NotFoundError('Review not found');

      await client.query('DELETE FROM reviews WHERE id = $1', [id]);
      await client.query(`UPDATE cases SET status = 'surveyed' WHERE id = $1`, [review.rows[0].case_id]);

      await client.query('COMMIT');
      return { id };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
