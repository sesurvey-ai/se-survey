package com.sesurvey.se_survey

import android.content.Context
import android.os.PowerManager
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class MyFirebaseMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)

        val data = remoteMessage.data
        Log.d("FCM-Native", "Message received: type=${data["type"]}")

        when (data["type"]) {
            "new_survey" -> handleNewSurvey(data)
            "cancel_survey" -> handleCancelSurvey(data)
            "request_location" -> handleRequestLocation(data)
        }
    }

    private fun handleNewSurvey(data: Map<String, String>) {
        val caseIdStr = data["case_id"] ?: ""
        val caseId = caseIdStr.toIntOrNull() ?: (System.currentTimeMillis() / 1000).toInt()

        // ตอบกลับเซิร์ฟเวอร์ว่าถึงเครื่องแล้ว — ต้องถือ wakelock คร่อมไว้ด้วยเหตุผลเดียวกับ
        // handleRequestLocation: onMessageReceived คืนแล้ว process โดน freeze ใน Doze
        // ก่อน POST เสร็จ = ออฟฟิศเห็นเป็น "ยังไม่ถึง" ทั้งที่ถึงแล้ว (false alarm ที่ทำให้คนเลิกเชื่อ)
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "se_survey:push_ack").acquire(20_000L)
        } catch (e: Exception) {
            Log.w("FCM-Native", "wakelock acquire failed: $e")
        }
        // เฉพาะเคสจริง — caseId ที่ generate จากนาฬิกา (ไม่มี case_id มากับ push) ไม่มีอยู่บนเซิร์ฟเวอร์
        if (caseIdStr.toIntOrNull() != null) LocationHelper.postPushAck(this, caseId)
        // การ์ดงานโชว์ 3 รายการ: สถานที่เกิดเหตุ · เลขเคลม · บริษัทประกัน
        val incidentLocation = data["incident_location"] ?: ""
        val claimNo = data["claim_no"] ?: ""
        val insuranceCompany = data["insurance_company"] ?: ""

        NotificationHelper.showIncomingNotification(
            context = this,
            id = caseId,
            title = "งานสำรวจใหม่",
            caseId = caseId,
            incidentLocation = incidentLocation,
            claimNo = claimNo,
            insuranceCompany = insuranceCompany,
        )
        Log.d("FCM-Native", "Incoming notification shown for caseId=$caseId")
    }

    /**
     * ถอนงาน (22/09/69) — push วิ่งสวนทางกับ new_survey: งานที่ยังค้าง "รับงาน" บนเครื่องนี้ถูกย้ายให้คนอื่น /
     * ถอนออก / ลบเคสบนเว็บ → ปิดการ์ดเต็มจอ + แถบ + เสียงของเคสนั้น แล้วทิ้งแจ้งเตือนเงียบ ๆ บอกเหตุผลไว้
     * ⛔ ก่อนหน้านี้ไม่มีทางถอน — การ์ดค้างจนช่างกดรับ/ปฏิเสธเอง (เจอจากเทส 22/09/69: ลบเคสแล้วการ์ดยังขึ้น "รับงาน")
     * ⛔ ไม่มี case_id = ไม่รู้จะปิดใบไหน → เมิน (ห้ามเดาไปปิดใบอื่น)
     */
    private fun handleCancelSurvey(data: Map<String, String>) {
        val caseId = data["case_id"]?.toIntOrNull()
        if (caseId == null) {
            Log.w("FCM-Native", "cancel_survey without case_id — ignored")
            return
        }
        NotificationHelper.withdrawIncoming(this, caseId, data["claim_no"] ?: "", data["reason"] ?: "")
        Log.d("FCM-Native", "Incoming withdrawn: caseId=$caseId reason=${data["reason"]}")
    }

    private fun handleRequestLocation(data: Map<String, String>) {
        val requestId = data["request_id"] ?: ""
        Log.d("FCM-Native", "Location request received: request_id=$requestId")

        // ถือ partial wakelock คร่อม GPS (สูงสุด 8s) + POST (fire-and-forget อีก ~20s) —
        // ใน Doze หน้าต่างประมวลผลจาก high-priority FCM สั้น: onMessageReceived คืนแล้ว
        // process โดน freeze ก่อน POST เสร็จ = พิกัดหายเงียบ; acquire แบบมี timeout ปล่อยเองกันค้าง
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "se_survey:location_request")
                .acquire(35_000L)
        } catch (e: Exception) {
            Log.w("FCM-Native", "wakelock acquire failed: $e")
        }

        // จับ GPS สด (ให้แม่นเท่าตอนลงเวลา) — getFreshLocation จะ fallback เป็น last known ให้เองถ้าจับไม่ทัน
        val location = LocationHelper.getFreshLocation(this)
        if (location != null) {
            // ส่ง GPS กลับ server ผ่าน REST API
            LocationHelper.postLocationToServer(
                context = this,
                latitude = location.latitude,
                longitude = location.longitude,
                requestId = requestId,
            )
            Log.d("FCM-Native", "Location sent: ${location.latitude}, ${location.longitude}")
        } else {
            Log.w("FCM-Native", "No location available")
        }
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d("FCM-Native", "New token: ${token.take(12)}…") // อย่า log token เต็ม (credential)
        // token หมุนได้ตอนแอปถูก kill (Play Services อัปเดต/restore) — ฝั่ง Dart ไม่มีโอกาสเห็น
        // ถ้าไม่ส่งจาก native เลย server จะ push ไปที่ token ตายจนกว่าผู้ใช้จะเปิดแอปอีกครั้ง
        LocationHelper.postFcmTokenToServer(this, token)
    }
}
