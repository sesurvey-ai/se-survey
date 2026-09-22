import { db } from '../config/database';
import { isFirebaseReady } from '../config/firebase';
import { fcmService } from './fcm.service';
import { getIO } from '../socket';

/** ผลการส่งการ์ดงานใหม่ — ไหลกลับไปถึงคนกดมอบหมาย (หน้าเว็บใช้ตัดสินว่าจะเตือนไหม) */
export type AssignPush = { status: 'sent' | 'no_token' | 'failed' | 'no_fcm'; reason?: string };

/** เหตุผลถอนงาน — มือถือแปลเป็นข้อความบนจอ (NotificationHelper.withdrawnText) */
export type WithdrawReason = 'reassigned' | 'unassigned' | 'deleted' | 'cancelled';

type SurveyorRow = { id: number; fcm_token: string | null };
type CaseCard = {
  incident_location?: string | null;
  customer_name?: string | null;
  claim_no?: string | null;
  insurance_company?: string | null;
};

/**
 * แจ้งงานใหม่ไปเครื่องช่าง (การ์ด "งานสำรวจใหม่" + เสียงเรียก + socket) — ย้ายมาจาก caseService.assign (22/09/69)
 * ให้ทางแอดมินย้ายงาน (updateCase) / กู้เคสจากถังขยะ (restoreCase) ใช้ชุดเดียวกับคอลเซ็นเตอร์จ่ายงาน
 *
 * ⚠️ ผลการส่งต้อง "ไหลกลับไปถึงคนกดมอบหมาย" — เดิมสำเร็จก็ log พังก็ log แล้วไปต่อ
 * เงียบ ๆ หน้าเว็บขึ้นว่ามอบหมายสำเร็จเหมือนกันหมด ทั้งที่ช่างอาจไม่ได้รับอะไรเลย
 * (ตรวจ prod 2026-08-11: ผู้สำรวจ active 144 คน มี fcm_token แค่ 84 — อีก 60 คน
 *  จ่ายงานไปก็ไม่มีทางได้รับแจ้งเตือน และไม่มีสัญญาณอะไรบอกคนจ่ายเลย)
 * ⚠️ status === 'sent' แปลว่า **FCM รับเรื่องไว้** เท่านั้น ไม่ได้แปลว่าเครื่องได้รับ
 *    ตัวที่บอกว่าถึงจริงคือ push_delivered_at ซึ่งเครื่องช่างเป็นคนยิงกลับมาเอง (ackPush)
 * ⛔ ต้องล้าง push_delivered_at ทุกครั้ง — reassign หลังช่างคนก่อนปฏิเสธ ถ้าไม่ล้าง
 *    เวลาตอบรับของคนเก่าจะค้างมาหลอกว่างานรอบใหม่ถึงเครื่องคนใหม่แล้ว
 */
export async function pushNewSurvey(caseId: number, surveyor: SurveyorRow, card: CaseCard): Promise<AssignPush> {
  let push: AssignPush;
  if (!isFirebaseReady()) {
    push = { status: 'no_fcm', reason: 'ระบบแจ้งเตือนยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์' };
    console.error('[FCM] Firebase not configured — assign without push');
  } else if (!surveyor.fcm_token) {
    push = { status: 'no_token', reason: 'เครื่องของผู้สำรวจยังไม่เคยลงทะเบียนรับแจ้งเตือน' };
    console.warn(`[FCM] Surveyor ${surveyor.id} has no token — skip push`);
  } else {
    try {
      const fcmResult = await fcmService.sendUrgentSurvey(
        surveyor.fcm_token,
        caseId,
        card.incident_location || '',
        card.claim_no || '',
        card.insurance_company || ''
      );
      console.log('[FCM] Send success:', fcmResult);
      push = { status: 'sent' };
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      console.error('[FCM] Send failed:', err);
      // token ตายแล้ว (ถอนแอป/ล้างข้อมูล) → ล้างทิ้ง ไม่งั้นค้างหลอกว่ามี token
      if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
        await db.query('UPDATE users SET fcm_token = NULL WHERE id = $1', [surveyor.id])
          .catch(() => {});
        push = { status: 'no_token', reason: 'เครื่องของผู้สำรวจถอนการลงทะเบียนแจ้งเตือนไปแล้ว' };
      } else {
        push = { status: 'failed', reason: 'ส่งแจ้งเตือนไม่สำเร็จ' };
      }
    }
  }

  // บันทึกผลการส่ง เพื่อให้ "แจ้งเตือนไม่ถึง" กลายเป็นเรื่องที่ระบบรู้ตัวเองได้
  await db.query(
    'UPDATE cases SET push_sent_at = $1, push_delivered_at = NULL WHERE id = $2',
    [push.status === 'sent' ? new Date() : null, caseId]
  ).catch((err) => console.error('[assign] บันทึกสถานะ push ไม่สำเร็จ (ไม่บล็อกการมอบหมาย):', err));

  // Send real-time notification via Socket.io
  const io = getIO();
  if (io) {
    io.to(`user:${surveyor.id}`).emit('case_assigned', {
      case_id: caseId,
      customer_name: card.customer_name,
      incident_location: card.incident_location,
      message: `คุณได้รับมอบหมายงานสำรวจ: ${card.customer_name}`,
    });
  }
  return push;
}

/** เหมือน pushNewSurvey แต่โหลดข้อมูลการ์ด + token เอง — ทางแอดมิน (ย้ายงาน / กู้เคส) ที่ไม่มีแถวติดมืออยู่แล้ว */
export async function pushNewSurveyById(caseId: number, surveyorId: number): Promise<AssignPush> {
  const c = await db.query(
    `SELECT c.incident_location, c.customer_name, sr.claim_no, sr.insurance_company
       FROM cases c LEFT JOIN survey_reports sr ON sr.case_id = c.id WHERE c.id = $1`,
    [caseId]
  );
  const u = await db.query('SELECT id, fcm_token FROM users WHERE id = $1', [surveyorId]);
  if (c.rows.length === 0 || u.rows.length === 0) return { status: 'failed', reason: 'ไม่พบเคสหรือผู้สำรวจ' };
  return pushNewSurvey(caseId, u.rows[0], c.rows[0]);
}

/**
 * ถอนงานออกจากเครื่องช่าง (22/09/69) — push ชนิด cancel_survey วิ่งสวนทางกับ new_survey
 * ใช้เมื่อใบที่ยังค้าง "มอบหมาย" ถูกย้ายให้คนอื่น / ถอนออก / ลบลงถังขยะ ระหว่างที่การ์ด "รับงาน"
 * อาจยังค้างอยู่บนเครื่องคนเดิม (เจอจากเทส 22/09/69: ลบเคสแล้วการ์ดยังขึ้น "รับงาน" ให้กดอยู่)
 * ⛔ ห้ามบล็อกการกระทำหลัก — ส่งไม่ได้ก็แค่ log (การ์ดค้างแบบเดิม = สภาพก่อนมีฟีเจอร์นี้)
 * ⛔ ไม่แตะ push_sent_at/push_delivered_at — เป็นประวัติของรอบจ่ายงานที่เพิ่งถูกถอน ไม่ใช่รอบใหม่
 */
export async function pushSurveyWithdrawn(
  caseId: number, surveyorId: number, reason: WithdrawReason,
): Promise<'sent' | 'skipped' | 'failed'> {
  try {
    if (!isFirebaseReady()) return 'skipped';
    const u = await db.query('SELECT fcm_token FROM users WHERE id = $1', [surveyorId]);
    const token = (u.rows[0]?.fcm_token as string | null | undefined) || null;
    if (!token) return 'skipped';
    // survey_reports ไม่ใช่ VIEW — เคสที่เพิ่งลงถังขยะยังอ่านเลขเคลมได้
    const r = await db.query('SELECT claim_no FROM survey_reports WHERE case_id = $1', [caseId]);
    await fcmService.sendSurveyWithdrawn(token, caseId, String(r.rows[0]?.claim_no || ''), reason);
    return 'sent';
  } catch (err) {
    console.error(`[FCM] cancel_survey failed: case ${caseId} → surveyor ${surveyorId} (${reason}):`, err);
    return 'failed';
  }
}
