import bcrypt from 'bcryptjs';
import { db } from '../config/database';
import { storage } from '../config/storage';
import { staffGroupService } from './staffGroup.service';
import { removeCapture, sendCapture } from './sebilling.service';
import { notifyCaseChanged } from './caseEvents';
import { pushNewSurveyById, pushSurveyWithdrawn } from './surveyPush.service';
import { logDispatch } from './dispatchLog.service';
import { omitHeavy } from './listRows';
import { invalidateCaseOwner } from '../middleware/uploadsAuth';
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

/** พักเคสที่ลบไว้กี่วันก่อนลบจริง (ถังขยะ) — user เคาะ 14/09/69 */
export const TRASH_DAYS = 30;

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
      cases: omitHeavy(dataResult.rows),   // รายการแอดมิน — ไม่ส่ง payload ISURVEY ติดไปทุกแถว
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

  /** @param by แอดมินที่แก้ — ลงประวัติการจ่ายงานเมื่อย้าย/ถอนผู้สำรวจ (migration 065) */
  async updateCase(id: number, data: { customer_name?: string; incident_location?: string; status?: string; assigned_to?: number | null }, by?: number | null) {
    const fields: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (data.customer_name !== undefined) { fields.push(`customer_name = $${idx++}`); params.push(data.customer_name); }
    if (data.incident_location !== undefined) { fields.push(`incident_location = $${idx++}`); params.push(data.incident_location); }
    if (data.status !== undefined) { fields.push(`status = $${idx++}`); params.push(data.status); }
    if (data.assigned_to !== undefined) { fields.push(`assigned_to = $${idx++}`); params.push(data.assigned_to); }

    if (fields.length === 0) throw new AppError(400, 'No fields to update');

    // ค่าก่อนแก้ — ไว้ตัดสินว่างานเพิ่ง "หลุดจากมือช่างคนเดิม" หรือ "ไปถึงมือช่างคนใหม่" หรือเปล่า
    const prev = await db.query('SELECT assigned_to, status FROM cases WHERE id = $1', [id]);
    if (prev.rows.length === 0) throw new NotFoundError('Case not found');

    params.push(id);
    const result = await db.query(
      `UPDATE cases SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      params
    );
    if (result.rows.length === 0) throw new NotFoundError('Case not found');
    const before = prev.rows[0];
    const after = result.rows[0];
    const prevSurveyor = before.assigned_to ? Number(before.assigned_to) : null;
    const nextSurveyor = after.assigned_to ? Number(after.assigned_to) : null;
    const surveyorChanged = nextSurveyor !== prevSurveyor;
    // ย้ายเจ้าของเคส — ล้าง cache สิทธิ์ดูรูป (เหมือน caseService.assign) ไม่งั้นคนเดิมยังเปิดรูปได้อีกพัก
    if (surveyorChanged) invalidateCaseOwner(id);

    // ถอนงาน (22/09/69): ใบที่ยังค้าง "มอบหมาย" ถูกย้ายให้คนอื่น / ถอนออก / ดึงกลับไปรอจ่าย
    // → เครื่องช่างคนเดิมปิดการ์ด "รับงาน" ที่อาจยังค้างอยู่ (ไม่งั้นค้างจนเขากดรับแล้ววิ่งไปหน้างานซ้ำคนใหม่)
    // ⛔ เปลี่ยนสถานะเดินหน้า (assigned → finished/surveyed) โดยช่างคนเดิม = งานยังเป็นของเขา ไม่ถอน
    let withdrawn: 'sent' | 'skipped' | 'failed' | undefined;
    if (prevSurveyor && before.status === 'assigned'
        && (surveyorChanged || ['pending', 'declined'].includes(String(after.status)))) {
      withdrawn = await pushSurveyWithdrawn(id, prevSurveyor, nextSurveyor && surveyorChanged ? 'reassigned' : 'unassigned');
      await logDispatch(id, 'recalled', { surveyorId: prevSurveyor, byUserId: by ?? null });
    }
    // ช่างคนใหม่ได้การ์ดงานเหมือนจ่ายจากคอลเซ็นเตอร์ — ย้ายงานแล้วคนใหม่ต้องรู้ ไม่ใช่นอนเงียบในรายการ
    let push: Awaited<ReturnType<typeof pushNewSurveyById>> | undefined;
    if (nextSurveyor && surveyorChanged && after.status === 'assigned') {
      push = await pushNewSurveyById(id, nextSurveyor);
      await logDispatch(id, 'assigned', { surveyorId: nextSurveyor, byUserId: by ?? null });
    }
    return { ...after, push, withdrawn };
  },

  /**
   * ลบแบบพักไว้ (soft delete) — user สั่ง 14/09/69 หลังเคส #226 ถูกลบจริงแล้วกู้ไม่ได้
   * แค่ประทับ deleted_at บนตารางจริง (cases_all) → VIEW `cases` ซ่อนแถวนี้จากทุกหน้าทันที (migration 062)
   * ข้อมูล/รูป/ใบอนุมัติยังอยู่ครบ กู้คืนได้ที่ถังขยะ · ลบจริงเมื่อครบ TRASH_DAYS (trashPurge) หรือกด "ลบถาวร"
   */
  async deleteCase(id: number, deletedBy?: number | null) {
    const r = await db.query(
      `UPDATE cases_all SET deleted_at = now(), deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING id, status, assigned_to`,
      [id, deletedBy ?? null]);
    if (r.rows.length === 0) throw new NotFoundError('Case not found');
    // แถวในบัญชี se-billing ของเคสนี้ (ถ้าเคยอนุมัติแล้วส่งไป) ถอนออกระหว่างพัก — กู้คืนแล้วส่งกลับให้ (restoreCase)
    await removeCapture(id);
    // ถอนงาน (22/09/69): ลบเคสที่ยังค้าง "มอบหมาย" → เครื่องช่างปิดการ์ด "รับงาน" ที่อาจยังค้างอยู่
    let withdrawn: 'sent' | 'skipped' | 'failed' | undefined;
    if (r.rows[0].status === 'assigned' && r.rows[0].assigned_to) {
      withdrawn = await pushSurveyWithdrawn(id, Number(r.rows[0].assigned_to), 'deleted');
    }
    notifyCaseChanged(id, 'deleted', deletedBy ?? null);
    return { id, trash_days: TRASH_DAYS, withdrawn };
  },

  /** รายการในถังขยะ — อ่านจากตารางจริง (VIEW cases มองไม่เห็นแถวที่ลบ) */
  async listTrash() {
    const r = await db.query(
      `SELECT ca.id, ca.status, ca.source, ca.customer_name, ca.visit_no,
              sr.claim_no, sr.survey_job_no, sr.insurance_company,
              to_char(ca.deleted_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI') AS deleted_at_th,
              (u.first_name || ' ' || u.last_name) AS deleted_by_name,
              GREATEST(0, $1 - FLOOR(EXTRACT(EPOCH FROM (now() - ca.deleted_at)) / 86400))::int AS days_left,
              (SELECT COUNT(*) FROM survey_photos sp JOIN survey_reports r2 ON r2.id = sp.report_id
                WHERE r2.case_id = ca.id)::int AS photo_count
         FROM cases_all ca
         LEFT JOIN survey_reports sr ON sr.case_id = ca.id
         LEFT JOIN users u ON u.id = ca.deleted_by
        WHERE ca.deleted_at IS NOT NULL
        ORDER BY ca.deleted_at DESC`, [TRASH_DAYS]);
    return { cases: r.rows, days: TRASH_DAYS };
  },

  /** กู้คืนจากถังขยะ — กลับสถานะเดิมทุกอย่าง · เคสที่อนุมัติแล้วส่งยอดกลับ se-billing ให้ด้วย (ตอนลบถอนไว้) */
  async restoreCase(id: number, by?: number | null) {
    const r = await db.query(
      `UPDATE cases_all SET deleted_at = NULL, deleted_by = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id, status, assigned_to`,
      [id]);
    if (r.rows.length === 0) throw new NotFoundError('ไม่พบเคสนี้ในถังขยะ');
    let billing: unknown = null;
    if (r.rows[0].status === 'reviewed') billing = await sendCapture(id);   // ไม่ throw
    // กู้ใบที่ยังค้าง "มอบหมาย" — การ์ดถูกถอนไปตอนลบ ต้องส่งการ์ดงานกลับไปให้ช่างคนเดิมใหม่ (ไม่ throw)
    let push: Awaited<ReturnType<typeof pushNewSurveyById>> | undefined;
    if (r.rows[0].status === 'assigned' && r.rows[0].assigned_to) {
      push = await pushNewSurveyById(id, Number(r.rows[0].assigned_to));
    }
    notifyCaseChanged(id, 'restored', by ?? null);
    return { id, status: r.rows[0].status, billing, push };
  },

  /** ลบจริงทุกเคสที่พักในถังขยะเกิน TRASH_DAYS — เรียกจาก trashPurge (พังทีละเคส ไม่ล้มทั้งรอบ) */
  async purgeExpired(days: number = TRASH_DAYS) {
    const r = await db.query(
      `SELECT id FROM cases_all WHERE deleted_at IS NOT NULL AND deleted_at < now() - ($1::int * INTERVAL '1 day') ORDER BY id`,
      [days]);
    const failed: number[] = [];
    let purged = 0;
    for (const row of r.rows as { id: number }[]) {
      try { await this.purgeCase(row.id); purged++; } catch { failed.push(row.id); }
    }
    return { purged, failed };
  },

  /**
   * ลบจริง (purge) — เฉพาะเคสที่อยู่ในถังขยะแล้วเท่านั้น: ลบรายงาน/ค่าใช้จ่าย/ใบอนุมัติ/รูป + ไฟล์บนดิสก์
   * ใช้โดยปุ่ม "ลบถาวร" ในถังขยะ และตัวลบอัตโนมัติหลังครบกำหนด · กู้ไม่ได้
   */
  async purgeCase(id: number) {
    // แถวในบัญชี se-billing ถอนไว้ตั้งแต่ตอนพัก — เรียกซ้ำเผื่อกู้คืนแล้วลบใหม่ (removeCapture ไม่ throw)
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

      // ลบจากตารางจริง และเฉพาะแถวที่พักในถังขยะแล้ว — เคสที่ยังใช้งานอยู่ต้องผ่านการพักก่อนเสมอ
      const result = await client.query('DELETE FROM cases_all WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id', [id]);
      if (result.rows.length === 0) throw new NotFoundError('ไม่พบเคสนี้ในถังขยะ (ลบถาวรได้เฉพาะเคสที่พักไว้แล้ว)');

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // ลบไฟล์รูป (ดิสก์หรือ S3 ตามโหมด — config/storage.ts) หลัง COMMIT: ไฟล์หายกู้ไม่ได้ ทำหลังยืนยัน
    const keys = [...surveyPhotos.rows, ...caseImages.rows].map((p: { file_path: string }) => String(p.file_path));
    const failed = await storage.deleteMany(keys);
    if (failed.length) console.warn(`[purge] เคส #${id} ลบไฟล์ไม่ได้ ${failed.length} ไฟล์:`, failed.slice(0, 5));
    // โฟลเดอร์ประจำเคส case_<id> (ผูกกับเคสที่ไม่มีแล้ว) ทิ้งทั้งก้อน — ไฟล์ค้างที่ไม่มีแถวใน DB ก็ไม่เหลือ
    try { await storage.deleteFolder(`case_${id}`); } catch (e) { console.warn(`[purge] เคส #${id} ลบโฟลเดอร์ไม่ได้:`, e); }
    // โฟลเดอร์เลขเคลมระบบเก่าบนดิสก์ที่ว่างแล้ว (surveyJobNo → claimNo)
    storage.cleanupEmptyFolders(keys);

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
