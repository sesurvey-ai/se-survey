import { admin } from '../config/firebase';

export const fcmService = {
  async sendNotification(fcmToken: string, title: string, body: string, data?: Record<string, string>) {
    try {
      console.log(`[FCM] Sending notification: "${title}" to token: ${fcmToken.substring(0, 20)}...`);
      const result = await admin.messaging().send({
        token: fcmToken,
        notification: { title, body },
        data: data || {},
        android: { priority: 'high' as const },
        apns: { payload: { aps: { 'content-available': 1 } } },
      });
      console.log('[FCM] Message sent successfully, ID:', result);
      return result;
    } catch (err) {
      console.error('[FCM] notification error:', err);
      throw err;
    }
  },

  // ส่ง data-only message สำหรับ urgent notification (เสียงดังไม่หยุด)
  // การ์ดงานมือถือโชว์ 3 รายการ: สถานที่เกิดเหตุ · เลขเคลม · บริษัทประกัน
  async sendUrgentSurvey(fcmToken: string, caseId: number, incidentLocation: string, claimNo: string, insuranceCompany: string) {
    try {
      console.log(`[FCM] Sending urgent survey notification for case ${caseId}`);
      const result = await admin.messaging().send({
        token: fcmToken,
        data: {
          type: 'new_survey',
          case_id: String(caseId),
          incident_location: incidentLocation || '',
          claim_no: claimNo || '',
          insurance_company: insuranceCompany || '',
          created_at: new Date().toISOString(),
        },
        android: { priority: 'high' as const },
        apns: {
          payload: { aps: { 'content-available': 1 } },
          headers: { 'apns-priority': '10' },
        },
      });
      console.log('[FCM] Urgent survey sent, ID:', result);
      return result;
    } catch (err) {
      console.error('[FCM] Urgent survey error:', err);
      throw err;
    }
  },

  /**
   * ถอนงาน (22/09/69) — data message วิ่งสวนทางกับ new_survey ไปเครื่องช่าง "คนเดิม":
   * เครื่องปิดการ์ดเต็มจอ/แถบ/เสียงของเคสนั้นเอง แล้วทิ้งแจ้งเตือนเงียบ ๆ บอกเหตุผล (MyFirebaseMessagingService.handleCancelSurvey)
   * reason: reassigned (ย้ายให้ช่างคนอื่น) · unassigned (ถอนออก/ดึงกลับไปรอจ่าย) · deleted (ลบเคสลงถังขยะ)
   * ⛔ ไม่ตั้ง TTL สั้น — เครื่องออฟไลน์ต้องได้รับตอนกลับมา ไม่งั้นการ์ดค้างเหมือนก่อนมีฟีเจอร์นี้ · APK เก่าเมินชนิดนี้เฉย ๆ ไม่พัง
   */
  async sendSurveyWithdrawn(fcmToken: string, caseId: number, claimNo: string, reason: string) {
    const result = await admin.messaging().send({
      token: fcmToken,
      data: {
        type: 'cancel_survey',
        case_id: String(caseId),
        claim_no: claimNo || '',
        reason,
        created_at: new Date().toISOString(),
      },
      android: { priority: 'high' as const },
      apns: {
        payload: { aps: { 'content-available': 1 } },
        headers: { 'apns-priority': '10' },
      },
    });
    console.log(`[FCM] cancel_survey sent for case ${caseId} (${reason}), ID:`, result);
    return result;
  },

  async sendSilentPush(fcmToken: string, data: Record<string, string>) {
    try {
      await admin.messaging().send({
        token: fcmToken,
        data,
        android: { priority: 'high' as const },
        apns: { payload: { aps: { 'content-available': 1 } } },
      });
    } catch (err) {
      console.error('FCM silent push error:', err);
    }
  },
};
