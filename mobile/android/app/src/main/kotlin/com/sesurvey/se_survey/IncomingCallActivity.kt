package com.sesurvey.se_survey

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

class IncomingCallActivity : Activity() {

    companion object {
        /**
         * เหตุผลที่ปฏิเสธงาน — user กำหนด 31/08/69
         * ⛔ ข้อความที่นี่ถูกส่งขึ้นเซิร์ฟเวอร์ตรง ๆ แล้วโชว์ให้ผู้จ่ายงานอ่าน
         *    แก้คำเมื่อไหร่ ของเก่าในฐานข้อมูลยังเป็นคำเดิม (เก็บเป็นข้อความ ไม่ใช่รหัส)
         */
        private val REASONS = listOf(
            "อยู่ระหว่างปฏิบัติงานอื่น",
            "ระยะทางไกลเกินไป",
            "ยานพาหนะ/อุปกรณ์ขัดข้อง",
            "ติดภารกิจ ไม่สะดวกรับงาน",
        )
        /** เวลานับถอยหลังบนหัวจอ — ล็อกให้เท่ากับเพดานเสียงเตือน (NotificationHelper.ALARM_MAX_MS) */
        private const val COUNTDOWN_SEC = 60
        /** หน้าสรุปค้างไว้กี่มิลลิวินาที — user เคาะ 0.8 วิ (01/09/69): พอกันกดพลาดตอนงานเข้าติดกัน
         *  แต่ไม่ขวางช่างที่กำลังรีบออกหน้างาน */
        private const val SUMMARY_MS = 800L
        /** จอสรุป "งานถูกถอนแล้ว" ค้างนานกว่าหน้ารับ/ปฏิเสธ — ช่างไม่ได้กดอะไรเอง ต้องมีเวลาอ่านว่าเกิดอะไรขึ้น */
        private const val WITHDRAWN_MS = 1_800L

        /** การ์ดที่กำลังโชว์อยู่ (ถ้ามี) — ให้ FCM service สั่งถอนงานถึงตัวได้ โดยไม่ต้องเปิด activity ใหม่ขึ้นมาแค่เพื่อปิด */
        @Volatile private var current: java.lang.ref.WeakReference<IncomingCallActivity>? = null

        /**
         * ถอนงาน (22/09/69): ถ้าการ์ดที่เปิดอยู่คือเคสนี้และช่างยังไม่ได้กดอะไร → ขึ้นจอสรุปแล้วปิดเอง
         * คืน true เมื่อจัดการแล้ว · การ์ดของเคสอื่น/ไม่มีการ์ด = ไม่แตะ (แถบของเคสที่ถูกถอนถูก cancel ไปแล้วที่ NotificationHelper)
         */
        fun withdraw(caseId: Int, claimNo: String, text: String): Boolean {
            val a = current?.get() ?: return false
            if (a.isFinishing || a.caseId != caseId || a.actionTaken) return false
            a.runOnUiThread { a.showWithdrawn(claimNo, text) }
            return true
        }
    }

    private var caseId: Int = 0
    private var notificationId: Int = 0
    private var incidentLocation: String = ""
    private var claimNo: String = ""
    private var insuranceCompany: String = ""
    private var actionTaken = false // กดรับ/ปฏิเสธแล้วหรือยัง — กันโพสต์ bar หลังจบงาน

    private var muted = false
    private var reasonIdx = -1
    private var secondsLeft = COUNTDOWN_SEC
    private val ticker = Handler(Looper.getMainLooper())
    private var tick: Runnable? = null
    private var pendingFinish: Runnable? = null   // ปิดเองหลังจอสรุป "งานถูกถอน" — ยกเลิกได้ถ้ามีใบใหม่เข้ามาทัน

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // แสดงบน lock screen + เปิดจอ
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val km = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            km.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        setContentView(R.layout.activity_incoming_call)
        current = java.lang.ref.WeakReference(this)
        applySystemBarInsets()

        bindData(intent)
        buildReasonList()
        startCountdown()
        // เข้ามาจากปุ่ม "ปฏิเสธงาน" บนแถบแจ้งเตือน → เปิดแผ่นเลือกเหตุผลให้เลย
        if (intent.getBooleanExtra("open_decline", false)) showDeclineSheet(true)

        findViewById<View>(R.id.btn_accept).setOnClickListener { handleAction("accept") }
        findViewById<View>(R.id.btn_decline).setOnClickListener { showDeclineSheet(true) }
        findViewById<View>(R.id.btn_cancel_decline).setOnClickListener { showDeclineSheet(false) }
        findViewById<View>(R.id.btn_confirm_decline).setOnClickListener { confirmDecline() }
        findViewById<ImageButton>(R.id.btn_mute).setOnClickListener { toggleMute() }
        // แตะฉากหลังของแผ่นเลือกเหตุผล = ปิด (ไม่ใช่ปฏิเสธ) — ทางออกที่คาดเดาได้
        findViewById<View>(R.id.decline_sheet).setOnClickListener { showDeclineSheet(false) }

        Log.d("IncomingCall", "Activity created: caseId=$caseId claim=$claimNo")
    }

    // อ่านข้อมูลจาก intent → ตั้งค่า UI (ใช้ทั้ง onCreate และ onNewIntent ตอนแตะ notification เปิดกลับ)
    private fun bindData(source: Intent) {
        caseId = source.getIntExtra("case_id", caseId)
        notificationId = source.getIntExtra("notification_id", notificationId)
        incidentLocation = source.getStringExtra("incident_location") ?: incidentLocation
        claimNo = source.getStringExtra("claim_no") ?: claimNo
        insuranceCompany = source.getStringExtra("insurance_company") ?: insuranceCompany

        findViewById<TextView>(R.id.txt_incident).text =
            if (incidentLocation.isNotBlank()) incidentLocation else "ไม่ระบุสถานที่"

        // เลขเคลม — ⛔ ไม่มีเลข = ซ่อนทั้งบล็อก ไม่ใส่ "-" (งานที่เปิดก่อนได้เลขจากบริษัทประกันมีจริง)
        val hasClaim = claimNo.isNotBlank()
        findViewById<View>(R.id.row_claim).visibility = if (hasClaim) View.VISIBLE else View.GONE
        findViewById<View>(R.id.div_incident).visibility = if (hasClaim) View.VISIBLE else View.GONE
        if (hasClaim) findViewById<TextView>(R.id.txt_claim_no).text = claimNo

        val shortName = NotificationHelper.shortInsurer(insuranceCompany)
        findViewById<TextView>(R.id.txt_insurance_name).text = if (shortName.isNotBlank()) shortName else "-"

        // ชื่ออังกฤษ — ไม่ได้เก็บในฐานข้อมูล เทียบจากชื่อไทยเอา (user ตัดสิน 31/08/69)
        val en = findViewById<TextView>(R.id.txt_insurance_en)
        val enName = NotificationHelper.insurerEnglish(insuranceCompany)
        if (enName != null) {
            en.text = enName
            en.visibility = View.VISIBLE
        } else {
            en.visibility = View.GONE
        }

        val logoView = findViewById<ImageView>(R.id.img_logo)
        val logo = NotificationHelper.logoFor(insuranceCompany)
        if (logo != null) {
            logoView.setImageResource(logo)
            logoView.visibility = View.VISIBLE
        } else {
            logoView.visibility = View.GONE
        }
    }

    /**
     * เว้นที่ให้แถบสถานะ (บน) และแถบนำทาง (ล่าง)
     *
     * ⛔ หน้านี้เปิดทับ lock screen จึงวาดเต็มจอจริง ๆ — ไม่เว้นเอง = หัวจอโดนนาฬิกาทับ
     *    และ **ปุ่มรับงานโดนแถบนำทางกินไปครึ่งปุ่ม** (เจอจากการเทสจริง 31/08/69)
     * ⛔ ตั้ง listener ที่ root ตัวเดียวแล้วกระจายเอง — ตั้งที่ลูกสองตัวจะแย่งกันรับ
     *    แล้วตัวหลังไม่ได้ inset
     */
    private fun applySystemBarInsets() {
        val root = findViewById<View>(R.id.root_frame)
        val content = findViewById<View>(R.id.content_root)
        val sheet = findViewById<View>(R.id.sheet_panel)
        // หน้าสรุปวางเนื้อหาชิดล่าง — ไม่เว้น inset = ตัวหนังสือมุดใต้แถบนำทาง
        val accepted = findViewById<View>(R.id.accepted_screen)
        val declined = findViewById<View>(R.id.declined_screen)
        val declinedBody = findViewById<View>(R.id.declined_body)
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars())
            content.setPadding(0, bars.top, 0, bars.bottom)
            sheet.setPadding(dp(20), dp(20), dp(20), dp(24) + bars.bottom)
            accepted.setPadding(dp(24), bars.top, dp(24), dp(28) + bars.bottom)
            // หน้าปฏิเสธเว้นด้านบนที่ตัวนอก เพื่อให้แถบแดงอยู่ "ใต้แถบสถานะ" ไม่ใช่ถูกมันทับ
            declined.setPadding(0, bars.top, 0, 0)
            declinedBody.setPadding(dp(24), 0, dp(24), dp(28) + bars.bottom)
            insets
        }
    }

    // ── นับถอยหลัง ────────────────────────────────────────────────
    /**
     * บอกว่างานเพิ่งเข้ามากี่วินาทีแล้ว — ตัวเลขเดินคู่กับเสียงเตือนที่หยุดเองเมื่อครบ 60 วิ
     * ครบแล้วเหลือแค่คำว่า "เข้ามาใหม่" (โชว์ "0 วิ" ค้างไว้ไม่ได้บอกอะไร)
     */
    private fun startCountdown() {
        val label = findViewById<TextView>(R.id.txt_countdown)
        val dot = findViewById<View>(R.id.dot_live)
        val r = object : Runnable {
            override fun run() {
                if (secondsLeft > 0) {
                    label.text = "เข้ามาใหม่ · $secondsLeft วิ"
                    secondsLeft--
                    ticker.postDelayed(this, 1000)
                } else {
                    label.text = "เข้ามาใหม่"
                    dot.setBackgroundColor(Color.parseColor("#7D7979"))
                }
            }
        }
        tick = r
        ticker.post(r)
    }

    private fun stopCountdown() {
        tick?.let { ticker.removeCallbacks(it) }
        tick = null
    }

    // ── ปิด/เปิดเสียง ─────────────────────────────────────────────
    private fun toggleMute() {
        muted = !muted
        val btn = findViewById<ImageButton>(R.id.btn_mute)
        if (muted) {
            NotificationHelper.stopAlarm()
            btn.setImageResource(R.drawable.ic_bell_off)
            btn.contentDescription = "เปิดเสียงแจ้งเตือน"
        } else {
            NotificationHelper.startAlarm(this)
            btn.setImageResource(R.drawable.ic_bell)
            btn.contentDescription = "ปิดเสียงแจ้งเตือน"
        }
    }

    // ── แผ่นเลือกเหตุผลปฏิเสธ ─────────────────────────────────────
    private fun buildReasonList() {
        val list = findViewById<LinearLayout>(R.id.reason_list)
        val dark = Color.parseColor("#201E1D")
        val green = Color.parseColor("#006A29")
        REASONS.forEachIndexed { i, label ->
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(4), dp(13), dp(4), dp(13))
                isClickable = true
                setOnClickListener { pickReason(i) }
            }
            val fill = View(this).apply {
                layoutParams = LinearLayout.LayoutParams(dp(8), dp(8)).apply {
                    // จุดตรงกลางกล่อง — โผล่เมื่อเลือกข้อนี้
                    marginStart = dp(4)
                    topMargin = dp(4)
                }
                setBackgroundColor(Color.TRANSPARENT)
                tag = "fill$i"
            }
            val boxWrap = LinearLayout(this).apply {
                layoutParams = LinearLayout.LayoutParams(dp(16), dp(16))
                setBackgroundResource(R.drawable.reason_box)
                addView(fill)
            }
            val text = TextView(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
                    .apply { marginStart = dp(12) }
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                setTextColor(dark)
                setLineSpacing(0f, 1.5f)
                setText(label)
                tag = "label$i"
            }
            row.addView(boxWrap)
            row.addView(text)
            list.addView(row)
            // เส้นคั่นบาง ๆ ระหว่างข้อ
            list.addView(View(this).apply {
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(1))
                setBackgroundColor(Color.parseColor("#D7D3D3"))
            })
        }
        // เก็บสีไว้ใช้ตอนเลือก
        list.tag = intArrayOf(dark, green)
    }

    private fun pickReason(i: Int) {
        reasonIdx = i
        val list = findViewById<LinearLayout>(R.id.reason_list)
        val (dark, green) = (list.tag as IntArray).let { it[0] to it[1] }
        REASONS.indices.forEach { n ->
            val chosen = n == i
            list.findViewWithTag<View>("fill$n")
                ?.setBackgroundColor(if (chosen) green else Color.TRANSPARENT)
            list.findViewWithTag<TextView>("label$n")
                ?.setTextColor(if (chosen) green else dark)
        }
        // ปุ่มยืนยันเพิ่งใช้ได้ตอนนี้ — จาง 45% จนกว่าจะเลือก (ตรงกับแบบ)
        findViewById<TextView>(R.id.btn_confirm_decline).alpha = 1f
    }

    private fun showDeclineSheet(show: Boolean) {
        findViewById<View>(R.id.decline_sheet).visibility = if (show) View.VISIBLE else View.GONE
        if (!show) {
            reasonIdx = -1
            findViewById<TextView>(R.id.btn_confirm_decline).alpha = 0.45f
            val list = findViewById<LinearLayout>(R.id.reason_list)
            val dark = Color.parseColor("#201E1D")
            REASONS.indices.forEach { n ->
                list.findViewWithTag<View>("fill$n")?.setBackgroundColor(Color.TRANSPARENT)
                list.findViewWithTag<TextView>("label$n")?.setTextColor(dark)
            }
        }
    }

    private fun confirmDecline() {
        // ⛔ ยังไม่เลือกเหตุผล = ไม่ทำอะไร (ปุ่มจางอยู่แล้ว) — ปฏิเสธโดยไม่มีเหตุผล
        //    ทำให้ผู้จ่ายงานได้ข้อมูลเปล่า ๆ ซึ่งเป็นปัญหาเดิมที่กำลังแก้อยู่
        if (reasonIdx < 0) return
        val reason = REASONS[reasonIdx]
        actionTaken = true
        stopCountdown()
        NotificationHelper.cancelNotification(this, notificationId)
        // ยิงจาก native เอง — หน้าเต็มจอเด้งได้แม้แอปตาย จะพึ่ง Flutter ให้ยิงแทนไม่ได้
        LocationHelper.postDecline(this, caseId, reason)

        // หน้าสรุป: ยืนยันให้ช่างเห็นว่ากดอะไรไป + เหตุผลที่ส่งขึ้นระบบจริง
        // ⛔ ปฏิเสธแล้ว **ไม่เปิดแอป** — ช่างเพิ่งบอกว่าไม่รับงาน การเด้งแอปขึ้นมาสวนความตั้งใจ
        //    (รายการงานฝั่ง Flutter รีเฟรชเองตอนกลับเข้าแอป)
        findViewById<TextView>(R.id.txt_declined_claim).text =
            if (claimNo.isNotBlank()) "เลขเคลม $claimNo" else "งานสำรวจ"
        findViewById<TextView>(R.id.txt_declined_reason).text = "เหตุผล: $reason"
        showDeclineSheet(false)
        findViewById<View>(R.id.declined_screen).visibility = View.VISIBLE
        ticker.postDelayed({ finish() }, SUMMARY_MS)
    }

    private fun dp(v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics).toInt()

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        // งานใหม่ (คนละเคส) เข้ามาทับหน้าเต็มจอของงานแรกที่ยังไม่ได้กดรับ — ถ้าไม่ทำอะไร
        // งานแรกจะหายเงียบ (ไม่มีทั้งจอและ bar เพราะ onResume ของมันเคย cancel bar ไปแล้ว)
        // → โพสต์ notification bar ของงานแรกคืนก่อนสลับข้อมูลเป็นงานใหม่
        val newCaseId = intent.getIntExtra("case_id", caseId)
        if (newCaseId != caseId && caseId != 0 && !actionTaken) {
            NotificationHelper.showFallbackNotification(this, notificationId, "งานสำรวจใหม่", caseId, incidentLocation, claimNo, insuranceCompany)
        }
        setIntent(intent)
        bindData(intent)
        // ใบใหม่เข้ามาระหว่างจอสรุป "งานถูกถอน" ของใบเก่ากำลังจะปิดตัว → ยกเลิกการปิด แล้วเริ่มใบใหม่ตามปกติ
        pendingFinish?.let {
            ticker.removeCallbacks(it)
            pendingFinish = null
            actionTaken = false
        }
        findViewById<View>(R.id.withdrawn_screen).visibility = View.GONE
        // งานใบใหม่ = เริ่มนับใหม่ และปิดแผ่นเหตุผลของใบเก่าทิ้ง (ไม่งั้นกดยืนยันไปโดนเคสผิด)
        showDeclineSheet(false)
        stopCountdown()
        secondsLeft = COUNTDOWN_SEC
        startCountdown()
        // กดปุ่มปฏิเสธบนแถบตอนหน้านี้เปิดค้างอยู่ → เข้าทาง onNewIntent ต้องเปิดแผ่นให้เหมือนกัน
        if (intent.getBooleanExtra("open_decline", false)) showDeclineSheet(true)
    }

    override fun onResume() {
        super.onResume()
        // หน้าเต็มจอกำลังแสดง → ซ่อน notification bar (กันซ้อน) — ไม่หยุดเสียง
        NotificationHelper.cancelBarOnly(this, notificationId)
    }

    override fun onStop() {
        super.onStop()
        // หน้าเต็มจอหลุดไปพื้นหลัง (กด Home/Recent) โดยยังไม่กดรับ → โชว์ notification bar ให้กดรับได้
        if (!isFinishing && !actionTaken) {
            NotificationHelper.showFallbackNotification(this, notificationId, "งานสำรวจใหม่", caseId, incidentLocation, claimNo, insuranceCompany)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        stopCountdown()
        if (current?.get() === this) current = null
    }

    /** งานถูกถอนจากเว็บ (ย้าย/ถอน/ลบ) — จอสรุปสีเทาบอกเหตุผล แล้วปิดเอง ไม่เปิดแอป ไม่ยิง API (ไม่มีอะไรให้ตอบกลับ) */
    private fun showWithdrawn(claimNo: String, text: String) {
        actionTaken = true
        stopCountdown()
        showDeclineSheet(false)
        val claim = if (claimNo.isNotBlank()) claimNo else this.claimNo
        findViewById<TextView>(R.id.txt_withdrawn_claim).text =
            if (claim.isNotBlank()) "เลขเคลม $claim" else "งานสำรวจ"
        findViewById<TextView>(R.id.txt_withdrawn_reason).text = text
        findViewById<View>(R.id.withdrawn_screen).visibility = View.VISIBLE
        val r = Runnable { finish() }
        pendingFinish = r
        ticker.postDelayed(r, WITHDRAWN_MS)
    }

    private fun handleAction(action: String) {
        actionTaken = true
        stopCountdown()
        // หยุดเสียง + ปิด notification
        NotificationHelper.cancelNotification(this, notificationId)

        // หน้าสรุป "รับงานแล้ว" คั่นสั้น ๆ ก่อนเข้าแอป — กดแล้วจอกระโดดเข้าฟอร์มทันที
        // ช่างไม่ทันเห็นว่ากดโดนใบไหน (งานเข้าติด ๆ กันแล้วกดพลาดจะไม่รู้ตัวเลย)
        findViewById<TextView>(R.id.txt_accepted_claim).text =
            if (claimNo.isNotBlank()) "เลขเคลม $claimNo" else "งานสำรวจ"
        findViewById<View>(R.id.accepted_screen).visibility = View.VISIBLE

        ticker.postDelayed({
            // เปิดแอปหลักพร้อมส่ง action กลับ Flutter
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            launchIntent?.apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra("notification_action", action)
                putExtra("case_id", caseId)
            }
            startActivity(launchIntent)
            finish()
        }, SUMMARY_MS)
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // เปิดแผ่นเหตุผลอยู่ → ปิดแผ่นก่อน (ไม่ใช่ปิดทั้งหน้า)
        if (findViewById<View>(R.id.decline_sheet).visibility == View.VISIBLE) {
            showDeclineSheet(false)
            return
        }
        // ไม่ให้กด back ปิดได้ — ต้องกดปุ่มรับ/ปฏิเสธ
    }
}
