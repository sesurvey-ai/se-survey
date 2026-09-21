import 'package:flutter/foundation.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'api_service.dart';

// Top-level handler for background messages
// new_survey จะถูกจัดการโดย native MyFirebaseMessagingService แล้ว (แสดง custom notification)
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  debugPrint('Background message received: ${message.messageId}');
  // new_survey → native Android จัดการแล้ว ไม่ต้องทำซ้ำ
}

class FcmService {
  final ApiService _apiService;
  final FlutterLocalNotificationsPlugin _localNotifications =
      FlutterLocalNotificationsPlugin();

  // Callback for when a notification is tapped with a case ID
  void Function(int caseId)? onNotificationTapWithCaseId;

  // Callback เมื่อได้รับงานสำรวจใหม่ (urgent notification)
  void Function(Map<String, dynamic> data)? onNewSurveyReceived;

  // Callback เมื่องานถูกถอน (cancel_survey — ย้าย/ถอน/ลบจากเว็บ 22/09/69): native ปิดการ์ด/แถบ/เสียงให้แล้ว
  void Function(Map<String, dynamic> data)? onSurveyWithdrawn;

  bool _listenersAttached = false; // subscribe stream ครั้งเดียว (initialize ถูกเรียกซ้ำทุก re-login)

  // generation ของ session — เพิ่มทุกครั้งที่ logout/re-init เพื่อยกเลิก retry ที่ค้างท่อ
  // (เครื่องแชร์: retry ของ user เก่าตื่นมาหลัง user ใหม่ login แล้ว PUT token ตายทับของใหม่)
  int _sessionEpoch = 0;

  FcmService(this._apiService);

  Future<void> initialize() async {
    try {
      // Initialize local notifications
      const androidSettings =
          AndroidInitializationSettings('@mipmap/ic_launcher');
      const iosSettings = DarwinInitializationSettings(
        requestAlertPermission: true,
        requestBadgePermission: true,
        requestSoundPermission: true,
      );
      const initSettings = InitializationSettings(
        android: androidSettings,
        iOS: iosSettings,
      );

      await _localNotifications.initialize(
        settings: initSettings,
        onDidReceiveNotificationResponse: _onNotificationTap,
      );

      // Initialize Firebase Messaging
      await _initializeFirebase();
    } catch (e) {
      debugPrint(
          'FCM initialization failed (Firebase may not be configured): $e');
    }
  }

  Future<void> _initializeFirebase() async {
    try {
      _sessionEpoch++; // เริ่ม session ใหม่ → retry เก่าที่ยังค้างท่อหมดสิทธิ์ส่ง
      final messaging = FirebaseMessaging.instance;

      // subscribe listeners ครั้งเดียวตลอดอายุแอป — กัน listener ซ้อนเมื่อ initialize() ถูกเรียกซ้ำ (re-login/session-expiry)
      if (!_listenersAttached) {
        _listenersAttached = true;
        FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

        // Listen for token refresh
        messaging.onTokenRefresh.listen((String newToken) {
          debugPrint('FCM token refreshed');
          _sendTokenToServer(newToken);
        });

        // Handle foreground messages
        FirebaseMessaging.onMessage.listen((RemoteMessage message) {
          debugPrint('Foreground message received: ${message.messageId}');
          final data = message.data;

          // Data message type: new_survey → แสดงหน้ารับงาน
          if (data['type'] == 'new_survey') {
            debugPrint('FCM foreground new_survey received');
            onNewSurveyReceived?.call(data);
            return;
          }
          // ถอนงาน → ฝั่งนี้แค่รีเฟรชรายการงานให้ใบนั้นหายไป (native จัดการจอ/เสียง/แจ้งเตือนเองแล้ว)
          if (data['type'] == 'cancel_survey') {
            debugPrint('FCM foreground cancel_survey received');
            onSurveyWithdrawn?.call(data);
            return;
          }

          // Regular notification message
          final notification = message.notification;
          if (notification != null) {
            showLocalNotification(
              title: notification.title ?? 'SE Survey',
              body: notification.body ?? '',
              payload: data['case_id'],
            );
          }
        });

        // Handle notification tap when app is in background
        FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
          debugPrint('Notification opened app: ${message.messageId}');
          final caseId = int.tryParse(message.data['case_id'] ?? '');
          if (caseId != null && onNotificationTapWithCaseId != null) {
            onNotificationTapWithCaseId!(caseId);
          }
        });
      }

      // ทำทุกครั้ง: ขอ permission + (re)ส่ง token → ผูก token กับ user ปัจจุบัน (เครื่องแชร์: user ใหม่ต้องรับ noti ตัวเอง)
      final settings = await messaging.requestPermission(alert: true, badge: true, sound: true);
      debugPrint('FCM permission status: ${settings.authorizationStatus}');
      final String? token = await messaging.getToken();
      if (token != null) {
        debugPrint('FCM token obtained');
        // ไม่ await — _sendTokenToServer มี retry ในตัว (สูงสุด ~26s) อย่าบล็อก flow login/เปิดแอป
        _sendTokenToServer(token);
      }

      // Check if app was opened from a terminated state via notification
      final initialMessage = await messaging.getInitialMessage();
      if (initialMessage != null) {
        final caseId = int.tryParse(initialMessage.data['case_id'] ?? '');
        if (caseId != null && onNotificationTapWithCaseId != null) {
          onNotificationTapWithCaseId!(caseId);
        }
      }
    } catch (e) {
      debugPrint('Firebase messaging setup failed: $e');
    }
  }

  // ล้าง FCM token ของเครื่อง (logout) → server ที่เก็บ token เดิมไว้จะส่ง noti ไม่ถึงอีก (กัน noti ข้าม user บนเครื่องแชร์)
  Future<void> clearToken() async {
    _sessionEpoch++; // ยกเลิก retry ส่ง token ที่ค้างอยู่ — token กำลังจะถูก invalidate
    try {
      await FirebaseMessaging.instance.deleteToken();
    } catch (e) {
      debugPrint('deleteToken failed: $e');
    }
  }

  // ส่ง token แบบ retry + backoff — เดิมล้มครั้งเดียว (login บนเน็ตห่วย) = กลืนเงียบ
  // → server เก็บ token เก่า/ว่าง ทั้ง session ไม่ได้รับงานใหม่เลยจนกว่าจะเปิดแอปใหม่
  Future<void> _sendTokenToServer(String token, {int attempts = 4}) async {
    final epoch = _sessionEpoch; // ผูก retry กับ session ตอนเริ่ม — logout/re-login แล้วหยุดทันที
    var delay = const Duration(seconds: 2);
    for (var i = 0; i < attempts; i++) {
      if (epoch != _sessionEpoch) return; // session เปลี่ยน (logout/user ใหม่) → token นี้ตายแล้ว
      try {
        await _apiService.updateFcmToken(token);
        return;
      } catch (e) {
        debugPrint('Failed to send FCM token (attempt ${i + 1}/$attempts): $e');
        if (i == attempts - 1) return; // หมดโควตา — เปิดแอป/checkAuth ครั้งหน้าจะส่งใหม่เอง
        await Future.delayed(delay);
        delay *= 3; // 2s → 6s → 18s
      }
    }
  }

  void _onNotificationTap(NotificationResponse response) {
    final payload = response.payload;
    if (payload != null) {
      final caseId = int.tryParse(payload);
      if (caseId != null && onNotificationTapWithCaseId != null) {
        onNotificationTapWithCaseId!(caseId);
      }
    }
  }

  Future<void> showLocalNotification({
    required String title,
    required String body,
    String? payload,
  }) async {
    const androidDetails = AndroidNotificationDetails(
      'se_survey_channel',
      'SE Survey Notifications',
      channelDescription: 'Notifications for SE Survey app',
      importance: Importance.high,
      priority: Priority.high,
    );
    const iosDetails = DarwinNotificationDetails();
    const details = NotificationDetails(
      android: androidDetails,
      iOS: iosDetails,
    );

    await _localNotifications.show(
      id: DateTime.now().millisecondsSinceEpoch ~/ 1000,
      title: title,
      body: body,
      notificationDetails: details,
      payload: payload,
    );
  }
}
