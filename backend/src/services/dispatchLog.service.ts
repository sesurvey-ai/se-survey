import { db } from '../config/database';

/**
 * ประวัติการจ่ายงาน (migration 065 · user สั่ง 22/09/69) — 1 แถว/เหตุการณ์ ไม่ทับกัน
 *   assigned  = จ่ายงานให้ช่าง (คอลเซ็นเตอร์กดมอบหมาย / แอดมินย้ายให้คนใหม่ / กู้เคสจากถังขยะ)
 *   recalled  = ดึงงานกลับจากช่าง (ปุ่ม "ดึงงานกลับ" ของคอลเซ็นเตอร์ / แอดมินย้าย-ถอนผู้สำรวจ)
 *   declined  = ช่างกดปฏิเสธเอง (เหตุผลจากแอป)
 * เดิม cases เก็บได้แค่การปฏิเสธ "ครั้งล่าสุด" (declined_*) ส่วนการดึงกลับไม่มีที่เก็บ — ผู้จ่ายงานไม่รู้ว่าใครดึง เมื่อไร จากใคร
 */
export type DispatchAction = 'assigned' | 'recalled' | 'declined';

/**
 * บันทึกเหตุการณ์ — ⛔ ห้ามโยน error ออก: ประวัติเขียนไม่ได้ (เช่นยังไม่ได้รัน migration บน prod)
 * ต้องไม่ทำให้การจ่ายงาน/ดึงกลับ/ปฏิเสธล้มไปด้วย แค่ log ไว้ให้เห็นว่าประวัติหาย
 */
export async function logDispatch(
  caseId: number, action: DispatchAction,
  opts: { surveyorId?: number | null; byUserId?: number | null; reason?: string | null } = {},
): Promise<void> {
  try {
    await db.query(
      'INSERT INTO case_dispatch_log (case_id, action, surveyor_id, by_user_id, reason) VALUES ($1, $2, $3, $4, $5)',
      [caseId, action, opts.surveyorId ?? null, opts.byUserId ?? null, opts.reason ?? null],
    );
  } catch (err) {
    console.error(`[dispatch-log] บันทึกไม่สำเร็จ (case ${caseId} ${action}) — ประวัติเหตุการณ์นี้จะหาย:`, err);
  }
}

/** ประวัติทั้งสายของเคส ใหม่ → เก่า พร้อมชื่อช่าง/ชื่อคนกด (หน้าจ่ายงานคอลเซ็นเตอร์) */
export async function getDispatchLog(caseId: number) {
  const r = await db.query(
    `SELECT l.id, l.action, l.reason, l.created_at,
            s.id AS surveyor_id, s.first_name AS surveyor_first_name, s.last_name AS surveyor_last_name, s.code AS surveyor_code,
            b.id AS by_user_id, b.first_name AS by_first_name, b.last_name AS by_last_name, b.role AS by_role
       FROM case_dispatch_log l
       LEFT JOIN users s ON s.id = l.surveyor_id
       LEFT JOIN users b ON b.id = l.by_user_id
      WHERE l.case_id = $1
      ORDER BY l.created_at DESC, l.id DESC`,
    [caseId],
  );
  return r.rows;
}

/**
 * ชิ้น SQL สำหรับหน้ารายการ (getStats.recent + list): เหตุการณ์ล่าสุดของเคส — ถ้าเป็น "ดึงงานกลับ"
 * โชว์ "ดึงกลับจากใคร โดยใคร เมื่อไร" ในช่องช่างสำรวจ (คู่กับที่โชว์คนปฏิเสธ) ไม่งั้นจ่ายให้คนเดิมซ้ำโดยไม่รู้ตัว
 * ⛔ ต้องใช้คู่กัน: SELECT ชิ้นนี้ต่อท้ายคอลัมน์ + JOIN ชิ้นนี้หลัง `FROM cases c` (alias c)
 */
export const LAST_RECALL_SELECT = `
              rf.first_name AS recalled_first_name, rf.last_name AS recalled_last_name, rf.code AS recalled_code,
              rb.first_name AS recalled_by_first_name, rb.last_name AS recalled_by_last_name,
              CASE WHEN le.action = 'recalled' THEN le.created_at END AS recalled_at`;
export const LAST_RECALL_JOIN = `
       LEFT JOIN LATERAL (
         SELECT l.action, l.surveyor_id, l.by_user_id, l.created_at
           FROM case_dispatch_log l WHERE l.case_id = c.id
          ORDER BY l.created_at DESC, l.id DESC LIMIT 1
       ) le ON TRUE
       LEFT JOIN users rf ON le.action = 'recalled' AND rf.id = le.surveyor_id
       LEFT JOIN users rb ON le.action = 'recalled' AND rb.id = le.by_user_id`;
