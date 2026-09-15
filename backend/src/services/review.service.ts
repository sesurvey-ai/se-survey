/**
 * ประตูอนุมัติ — จุดเดียวที่ตัดสินว่าเคสไหน "พร้อมให้บอทยกเข้า EMCS"
 *
 * กติกาที่ user เคาะ 15/08/69:
 *   หัวหน้าตรวจจบบนเว็บ → กดอนุมัติ → **ล็อกทั้งเคส** → บอทหยิบเฉพาะที่อนุมัติ
 *   จะแก้ต้องให้ **แอดมิน** ปลดล็อก แล้ว **อนุมัติใหม่** (ไม่ใช่แก้เงียบ ๆ แล้วบอทหยิบของใหม่ไป)
 *
 * ⛔ ทำไมต้องล็อก: หลังเฟส 3 บอทจะกดปุ่ม "ส่งงานใหม่" บน EMCS เอง ซึ่งถอยไม่ได้
 *    "อนุมัติ" จึงไม่ใช่ป้ายสถานะ แต่เป็นลายเซ็นว่าคนคนหนึ่งรับรองข้อมูลชุดนี้แล้ว
 *    ถ้าข้อมูลเปลี่ยนได้หลังอนุมัติ ลายเซ็นนั้นก็ไม่ได้รับรองอะไรเลย
 *
 * reviews มี 1 แถวต่อ 1 เคส (case_id UNIQUE) — อนุมัติ/ปลดล็อกคือการเปลี่ยนสถานะแถวเดิม
 * ไม่ใช่สร้างแถวใหม่ (INSERT ซ้ำจะชน UNIQUE)
 */
import { db } from '../config/database';
import { NotFoundError, ForbiddenError } from '../middleware/errorHandler';
import { notifyCaseChanged } from './caseEvents';
import { removeCapture, sendCapture } from './sebilling.service';
import { isurveyPullService } from './isurveyPull.service';

export const reviewService = {
  async submitReview(caseId: number, checkerId: number, data: { comment?: string; proposed_fee?: number; approved_fee?: number }) {
    const caseResult = await db.query('SELECT status FROM cases WHERE id = $1', [caseId]);
    if (caseResult.rows.length === 0) throw new NotFoundError('Case not found');
    const status = caseResult.rows[0].status;
    if (status === 'reviewed') throw new ForbiddenError('เคสนี้อนุมัติแล้ว — ต้องให้แอดมินปลดล็อกก่อนจึงจะแก้/อนุมัติใหม่ได้');
    if (status !== 'surveyed') throw new ForbiddenError('Case is not ready for review');

    const client = await db.getClient();
    try {
      await client.query('BEGIN');

      // อนุมัติซ้ำหลังปลดล็อก = ทับใบเดิม (คนอนุมัติ/เวลา เป็นของครั้งล่าสุดเสมอ)
      // unlocked_count ไม่รีเซ็ต — เก็บไว้ว่าเคสนี้ผ่านการปลดล็อกมากี่รอบ
      const reviewResult = await client.query(
        `INSERT INTO reviews (case_id, checker_id, comment, proposed_fee, approved_fee, status, reviewed_at)
         VALUES ($1, $2, $3, $4, $5, 'approved', NOW())
         ON CONFLICT (case_id) DO UPDATE
            SET checker_id = EXCLUDED.checker_id,
                comment = EXCLUDED.comment,
                proposed_fee = EXCLUDED.proposed_fee,
                approved_fee = EXCLUDED.approved_fee,
                status = 'approved',
                reviewed_at = NOW()
         RETURNING *`,
        [caseId, checkerId, data.comment || null, data.proposed_fee || null, data.approved_fee || null]
      );

      await client.query(`UPDATE cases SET status = 'reviewed' WHERE id = $1`, [caseId]);

      await client.query('COMMIT');
      // อนุมัติแล้ว = หลุดจากคิว "รอตรวจ" ของทุกคน — คนอื่นต้องเห็นทันที ไม่งั้นเปิดซ้ำ
      notifyCaseChanged(caseId, 'approved', checkerId);
      // ท่อ se-billing — หลัง COMMIT เท่านั้น และไม่ทำให้การอนุมัติล้ม (sendCapture ไม่ throw)
      // รอผลเพื่อบอกหน้าจอว่าส่งถึงหรือไม่ (ช้าสุด 8 วิ ถ้า se-billing ไม่ตอบ)
      const billing = await sendCapture(caseId);
      // เขียนกลับ ISURVEY (กด "ยืนยันการตรวจสอบ" แทนหัวหน้า) — เฉพาะเคสที่ดึงจาก ISURVEY · ไม่รอผล ไม่ทำให้อนุมัติล้ม
      // (ISURVEY ตอบช้าได้เป็นนาที) ผลไปโผล่เป็นป้ายบนหน้าเคสผ่านสัญญาณ case_changed (08/09/69)
      void isurveyPullService.closeAfterApprove(caseId, checkerId);
      return { ...reviewResult.rows[0], billing };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * ปลดล็อกเคสที่อนุมัติแล้วให้กลับไปแก้ได้ (แอดมินเท่านั้น — บังคับที่ชั้น route)
   *
   * ⛔ ปลดล็อกไม่ได้เมื่อ **ส่งงานให้บริษัทประกันแล้ว** (emcs_submitted_at) — ตรงนั้นถอยไม่ได้
   *    แก้ข้อมูลฝั่งเราทีหลังก็ได้แค่ข้อมูล 2 ที่ไม่ตรงกันโดยไม่มีใครรู้
   *
   * ✅ แต่ "มี draft บน EMCS แล้ว" (emcs_imported_at) ปลดล็อกได้ — draft ยังไม่ถึงมือประกัน
   *    และการแก้ข้อมูลแล้วให้บอทเข้าไปซ่อม draft เดิมคือขั้นตอนปกติที่ออกแบบไว้
   *    (--sesurvey-fill-existing) · เดิมกันตรงนี้ไว้ด้วย ทำให้เคสที่ draft ยังไม่สมบูรณ์
   *    ติดตาย แก้อะไรไม่ได้เลย (เจอจริง 15/08/69 เคส #141)
   */
  async unlock(caseId: number, adminId: number, reason?: string) {
    const c = await db.query(
      'SELECT status, source, emcs_imported_at, emcs_submitted_at FROM cases WHERE id = $1', [caseId]);
    if (c.rows.length === 0) throw new NotFoundError('Case not found');
    if (c.rows[0].status !== 'reviewed') throw new ForbiddenError('เคสนี้ยังไม่ได้อนุมัติ ไม่ต้องปลดล็อก');
    // เคสอ้างอิง (ครั้งก่อนหน้าที่ปิดจบบน ISURVEY แล้ว) แก้ข้อมูลได้เลยโดยไม่ต้องปลดล็อก (15/09/69) — ปลดล็อกจะพาเข้าคิวอนุมัติ
    // แล้วอนุมัติซ้ำจะส่ง se-billing/ปิด ISURVEY อีกรอบทั้งที่ครั้งนั้นจบไปแล้ว
    if (c.rows[0].source === 'isurvey_reference') {
      throw new ForbiddenError('เคสอ้างอิงจาก ISURVEY แก้ข้อมูลได้เลยที่หน้าเคส ไม่ต้องปลดล็อก (ปลดล็อกจะทำให้ต้องอนุมัติซ้ำ)');
    }
    if (c.rows[0].emcs_submitted_at) {
      throw new ForbiddenError('เคสนี้ส่งงานให้บริษัทประกันไปแล้ว ปลดล็อกไม่ได้ — แก้ที่ EMCS โดยตรง');
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `UPDATE reviews
            SET status = 'pending',
                unlocked_by = $2,
                unlocked_at = NOW(),
                unlocked_count = unlocked_count + 1,
                comment = COALESCE(NULLIF($3, ''), comment)
          WHERE case_id = $1
          RETURNING *`,
        [caseId, adminId, reason ?? '']
      );
      // ไม่มีใบอนุมัติแต่สถานะเป็น reviewed = ข้อมูลเพี้ยน ปล่อยผ่านไม่ได้
      if (r.rowCount === 0) throw new NotFoundError('ไม่พบใบอนุมัติของเคสนี้');
      await client.query(`UPDATE cases SET status = 'surveyed' WHERE id = $1`, [caseId]);
      await client.query('COMMIT');
      notifyCaseChanged(caseId, 'unlocked', adminId);
      // ยอดกำลังจะเปลี่ยน → ถอนออกจากบัญชี se-billing (ไม่ต้องรอ ผลไปโผล่ที่ billing_error ถ้าพัง)
      void removeCapture(caseId);
      return r.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
