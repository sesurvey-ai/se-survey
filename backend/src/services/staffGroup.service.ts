/**
 * ทีมของหัวหน้าผู้ตรวจ (staff_groups / staff_group_members) — migration 051, user สั่ง 04/09/69
 *
 *  - หัวหน้า (checker) เห็นทีมของตัวเองอ่านอย่างเดียว · แอดมินแก้ได้
 *  - ใช้กรอง "งานรอตรวจ (ISURVEY)" ให้เหลือเฉพาะงานของลูกทีม: จับคู่ด้วย **รหัสช่าง** ที่นำหน้าชื่อใน
 *    ISURVEY ("SE478 วรัญญู ยืนสุข") หรือ **ชื่อบริษัท OSS** ทั้งก้อน (ไม่มีรหัส)
 *  - ที่มาเริ่มต้น = ไฟล์ mapping ของ se-billing (นำเข้าด้วย scripts/import_staff_groups.js)
 */
import { db } from '../config/database';
import { AppError, NotFoundError } from '../middleware/errorHandler';

export interface StaffMember {
  id: number; staff_name: string; staff_code: string | null; surveyor_id: number | null;
  /** ชื่อปัจจุบันจากทะเบียนพนักงาน (ถ้าจับคู่รหัสได้) */
  surveyor_name?: string | null; surveyor_active?: boolean | null;
}
export interface StaffGroup {
  id: number; name: string; checker_id: number | null; checker_name?: string | null; checker_username?: string | null;
  member_count?: number; members?: StaffMember[];
}

/** รหัสช่างที่นำหน้าข้อความ ("SEC343 นาย มี …" → "SEC343") · ไม่มี = null (บริษัท OSS) */
export const staffCodeOf = (s: string): string | null => {
  const m = /^\s*(SE[A-Z]*\d+)\b/i.exec(String(s ?? ''));
  return m ? m[1].toUpperCase() : null;
};
/** ชื่อบริษัท/ข้อความให้เทียบกันได้ (ยุบช่องว่าง ตัดจุด/คำนำหน้าบริษัท) */
export const normName = (s: string): string =>
  String(s ?? '').toLowerCase().replace(/[. ]/g, ' ').replace(/^(บริษัท|บจก|บจ|หจก|ห้างหุ้นส่วนจำกัด)\s*/u, '')
    .replace(/\s*(จำกัด|\(มหาชน\)|มหาชน)\s*/gu, ' ').replace(/\s+/g, ' ').trim();

const MEMBER_SQL = `
  SELECT m.id, m.staff_name, m.staff_code, m.surveyor_id,
         CASE WHEN u.id IS NULL THEN NULL ELSE TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) END AS surveyor_name,
         u.is_active AS surveyor_active
    FROM staff_group_members m
    LEFT JOIN users u ON u.id = m.surveyor_id
   WHERE m.group_id = $1
   ORDER BY m.staff_code NULLS LAST, m.staff_name`;

async function attachMembers(g: StaffGroup): Promise<StaffGroup> {
  const r = await db.query(MEMBER_SQL, [g.id]);
  return { ...g, members: r.rows as StaffMember[], member_count: r.rowCount ?? r.rows.length };
}

/**
 * ทะเบียนพนักงาน (users.supervisor_id) ต้องตามทีมเสมอ — คอลัมน์ "หัวหน้า" ในหน้าทะเบียนพนักงานสำรวจอ่านจากคอลัมน์นี้
 * ซึ่งเดิมมีแต่ตัวนำเข้าไฟล์ตารางเวรเขียน ส่วนหน้าจัดการผู้ใช้/ทีมเขียนลง staff_groups → สองที่ไม่ตามกัน
 * (user เจอ 14/09/69: ย้าย SEC311/SEC454 ไปทีมศุภชัยแล้ว ทะเบียนยังโชว์ยรรยง) · ทีมที่ยังไม่มีบัญชีผู้ตรวจ = NULL
 */
async function syncSupervisorFromTeam(userIds: Array<number | null | undefined>): Promise<void> {
  const ids = userIds.filter((n): n is number => Number.isInteger(n) && (n as number) > 0);
  if (!ids.length) return;
  await db.query(
    `UPDATE users u SET supervisor_id = (
        SELECT g.checker_id FROM staff_group_members m JOIN staff_groups g ON g.id = m.group_id
         WHERE m.surveyor_id = u.id ORDER BY m.id DESC LIMIT 1)
      WHERE u.id = ANY($1::int[])`, [ids]);
}

/** หา surveyor_id จากรหัส (ทะเบียนพนักงาน users.code) — ไม่เจอ = null ไม่ใช่ error */
async function surveyorIdByCode(code: string | null): Promise<number | null> {
  if (!code) return null;
  const r = await db.query("SELECT id FROM users WHERE UPPER(code) = $1 AND role = 'surveyor' ORDER BY is_active DESC, id LIMIT 1", [code.toUpperCase()]);
  return r.rows[0]?.id ?? null;
}

export const staffGroupService = {
  async list(): Promise<StaffGroup[]> {
    const r = await db.query(
      `SELECT g.id, g.name, g.checker_id, u.username AS checker_username,
              CASE WHEN u.id IS NULL THEN NULL ELSE TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) END AS checker_name,
              (SELECT COUNT(*)::int FROM staff_group_members m WHERE m.group_id = g.id) AS member_count
         FROM staff_groups g LEFT JOIN users u ON u.id = g.checker_id
        ORDER BY g.name`);
    return r.rows as StaffGroup[];
  },

  async get(id: number): Promise<StaffGroup> {
    const r = await db.query(
      `SELECT g.id, g.name, g.checker_id, u.username AS checker_username,
              CASE WHEN u.id IS NULL THEN NULL ELSE TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) END AS checker_name
         FROM staff_groups g LEFT JOIN users u ON u.id = g.checker_id WHERE g.id = $1`, [id]);
    if (r.rows.length === 0) throw new NotFoundError('ไม่พบทีมนี้');
    return attachMembers(r.rows[0] as StaffGroup);
  },

  /** ทีมของบัญชีผู้ตรวจนี้ — null = ยังไม่ได้ผูกทีม (เห็นงานทั้งหมดตามเดิม) */
  async mine(userId: number): Promise<StaffGroup | null> {
    const r = await db.query('SELECT id FROM staff_groups WHERE checker_id = $1', [userId]);
    if (r.rows.length === 0) return null;
    return this.get(r.rows[0].id);
  },

  async create(name: string, checkerId?: number | null): Promise<StaffGroup> {
    const n = String(name ?? '').trim();
    if (!n) throw new AppError(400, 'ต้องระบุชื่อทีม/หัวหน้า');
    if (checkerId) await assertChecker(checkerId);
    const r = await db.query(
      'INSERT INTO staff_groups (name, checker_id) VALUES ($1, $2) RETURNING id', [n, checkerId ?? null]);
    return this.get(r.rows[0].id);
  },

  async update(id: number, patch: { name?: string; checker_id?: number | null }): Promise<StaffGroup> {
    if (patch.checker_id) await assertChecker(patch.checker_id);
    const r = await db.query(
      `UPDATE staff_groups SET name = COALESCE(NULLIF($2, ''), name),
              checker_id = CASE WHEN $3::boolean THEN $4 ELSE checker_id END, updated_at = now()
        WHERE id = $1 RETURNING id`,
      [id, patch.name?.trim() ?? '', patch.checker_id !== undefined, patch.checker_id ?? null]);
    if (r.rows.length === 0) throw new NotFoundError('ไม่พบทีมนี้');
    // เปลี่ยนบัญชีผู้ตรวจของทีม → หัวหน้าในทะเบียนของลูกทีมทุกคนต้องเปลี่ยนตาม
    if (patch.checker_id !== undefined) {
      const mem = await db.query('SELECT surveyor_id FROM staff_group_members WHERE group_id = $1 AND surveyor_id IS NOT NULL', [id]);
      await syncSupervisorFromTeam(mem.rows.map((m: { surveyor_id: number }) => m.surveyor_id));
    }
    return this.get(id);
  },

  async remove(id: number): Promise<void> {
    const mem = await db.query('SELECT surveyor_id FROM staff_group_members WHERE group_id = $1 AND surveyor_id IS NOT NULL', [id]);
    await db.query('DELETE FROM staff_groups WHERE id = $1', [id]);
    await syncSupervisorFromTeam(mem.rows.map((m: { surveyor_id: number }) => m.surveyor_id));   // ทีมหาย = ไม่มีหัวหน้า
  },

  /** เพิ่มสมาชิกด้วยข้อความเต็ม ("SEC343 นาย มี …" หรือชื่อบริษัท) — รหัสแยกให้เอง, จับคู่ทะเบียนให้เอง */
  async addMember(groupId: number, staffName: string): Promise<StaffGroup> {
    const name = String(staffName ?? '').replace(/\s+/g, ' ').trim();
    if (!name) throw new AppError(400, 'ต้องระบุรหัส/ชื่อพนักงาน หรือชื่อบริษัท');
    const code = staffCodeOf(name);
    const dup = await db.query(
      `SELECT g.name FROM staff_group_members m JOIN staff_groups g ON g.id = m.group_id
        WHERE m.group_id <> $1 AND (($2::text IS NOT NULL AND UPPER(m.staff_code) = $2) OR LOWER(m.staff_name) = LOWER($3))`,
      [groupId, code, name]);
    if (dup.rows.length) throw new AppError(409, `รายการนี้อยู่ในทีม "${dup.rows[0].name}" แล้ว — ย้ายโดยลบจากทีมเดิมก่อน`);
    const surveyorId = await surveyorIdByCode(code);
    await db.query(
      `INSERT INTO staff_group_members (group_id, staff_name, staff_code, surveyor_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, staff_name) DO NOTHING`,
      [groupId, name, code, surveyorId]);
    await syncSupervisorFromTeam([surveyorId]);
    return this.get(groupId);
  },

  async removeMember(groupId: number, memberId: number): Promise<StaffGroup> {
    const m = await db.query('SELECT surveyor_id FROM staff_group_members WHERE id = $1 AND group_id = $2', [memberId, groupId]);
    await db.query('DELETE FROM staff_group_members WHERE id = $1 AND group_id = $2', [memberId, groupId]);
    await syncSupervisorFromTeam([m.rows[0]?.surveyor_id]);
    return this.get(groupId);
  },

  /**
   * ตั้งทีมให้ช่างจากทะเบียนพนักงาน (หน้าสร้าง/แก้ผู้ใช้ของแอดมิน) — ช่างอยู่ได้ทีมเดียว:
   * ลบสมาชิกเดิมที่ชี้มาที่ผู้ใช้นี้ (หรือรหัสเดียวกัน) แล้วใส่ทีมใหม่ · groupId null = เอาออกจากทุกทีม
   * ข้อความสมาชิกใช้รูปแบบเดียวกับ ISURVEY ("SE315 ชื่อ นามสกุล") เพื่อให้ตัวกรองงานรอตรวจจับด้วยรหัสได้
   */
  async setSurveyorGroup(userId: number, groupId: number | null): Promise<void> {
    const u = await db.query('SELECT id, code, first_name, last_name FROM users WHERE id = $1', [userId]);
    if (u.rows.length === 0) throw new NotFoundError('User not found');
    const { code, first_name, last_name } = u.rows[0] as { code: string | null; first_name: string; last_name: string };
    const upperCode = code ? String(code).trim().toUpperCase() : null;
    await db.query(
      `DELETE FROM staff_group_members WHERE surveyor_id = $1 OR ($2::text IS NOT NULL AND UPPER(staff_code) = $2)`,
      [userId, upperCode]);
    if (!groupId) { await syncSupervisorFromTeam([userId]); return; }
    const g = await db.query('SELECT id FROM staff_groups WHERE id = $1', [groupId]);
    if (g.rows.length === 0) throw new AppError(400, 'ไม่พบทีม/หัวหน้าที่เลือก');
    const staffName = [upperCode, `${first_name ?? ''} ${last_name ?? ''}`.trim()].filter(Boolean).join(' ');
    await db.query(
      `INSERT INTO staff_group_members (group_id, staff_name, staff_code, surveyor_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (group_id, staff_name) DO UPDATE SET staff_code = EXCLUDED.staff_code, surveyor_id = EXCLUDED.surveyor_id`,
      [groupId, staffName, upperCode, userId]);
    await syncSupervisorFromTeam([userId]);
  },

  /** ทีมปัจจุบันของช่าง (id) — null = ยังไม่มีหัวหน้ากำกับ */
  async groupOfSurveyor(userId: number): Promise<number | null> {
    const r = await db.query('SELECT group_id FROM staff_group_members WHERE surveyor_id = $1 LIMIT 1', [userId]);
    return r.rows[0]?.group_id ?? null;
  },

  /**
   * ตัวกรองงาน ISURVEY ของบัญชีนี้ — null = ไม่กรอง (แอดมิน / ยังไม่ผูกทีม)
   * คืนฟังก์ชันตัดสินจาก "ชื่อพนักงานสำรวจ" ที่ ISURVEY ให้ (empcode: รหัส+ชื่อ หรือชื่อบริษัท OSS)
   */
  async filterFor(userId: number, role: string): Promise<{ group: StaffGroup; match: (empcode: string) => boolean } | null> {
    if (role === 'admin') return null;
    const g = await this.mine(userId);
    if (!g || !g.members || g.members.length === 0) return null;
    const codes = new Set(g.members.map((m) => m.staff_code).filter(Boolean) as string[]);
    const names = new Set(g.members.filter((m) => !m.staff_code).map((m) => normName(m.staff_name)));
    return {
      group: g,
      match: (empcode: string) => {
        const c = staffCodeOf(empcode);
        if (c) return codes.has(c);
        return names.has(normName(empcode));
      },
    };
  },
};

async function assertChecker(userId: number): Promise<void> {
  const r = await db.query("SELECT id FROM users WHERE id = $1 AND role IN ('checker', 'admin')", [userId]);
  if (r.rows.length === 0) throw new AppError(400, 'บัญชีที่เลือกไม่ใช่ผู้ตรวจ/แอดมิน');
}
