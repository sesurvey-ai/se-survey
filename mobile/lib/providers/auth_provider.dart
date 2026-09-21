import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import '../models/user.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../services/fcm_service.dart';
import '../services/notification_service.dart';
import '../services/consult_background.dart';
import '../services/consult_sync.dart';
import '../services/survey_queue.dart';

class AuthProvider extends ChangeNotifier {
  final ApiService _apiService;
  final AuthService _authService;
  final FcmService _fcmService;
  VoidCallback? _onCaseAssignedRefresh;
  // Callback เมื่อมีงานใหม่ — ให้ UI แสดง IncomingSurveyPage
  void Function(Map<String, dynamic> data)? onNewSurveyIncoming;

  User? _user;
  String? _token;
  bool _isLoading = false;
  // อ่าน token จาก storage ตอนเปิดแอปเสร็จหรือยัง — router ใช้กัน redirect ก่อนรู้สถานะจริง
  // (เดิม cold start เด้ง /login แวบก่อน checkAuth เสร็จ แล้วเด้งกลับ /home + ทิ้ง deep-link)
  bool _authResolved = false;
  bool get authResolved => _authResolved;
  String? _error;

  AuthProvider({
    required ApiService apiService,
    required FcmService fcmService,
  })  : _apiService = apiService,
        _authService = AuthService(apiService),
        _fcmService = fcmService;

  void setOnCaseAssignedRefresh(VoidCallback callback) {
    _onCaseAssignedRefresh = callback;
  }

  User? get user => _user;
  String? get token => _token;
  bool get isLoading => _isLoading;
  String? get error => _error;
  bool get isLoggedIn => _token != null;

  Future<void> checkAuth() async {
    _isLoading = true;
    notifyListeners();

    try {
      _token = await _authService.getToken();
      _user = await _authService.getUser();
      _authResolved = true; // รู้สถานะจริงแล้ว → router redirect ได้ถูกต้อง
      // แจ้ง router ทันทีที่ได้ session (ไป /home หรือ /login เร็ว ไม่ต้องรอ Firebase/FCM
      // → logged-in user ไม่เห็นหน้า login แวบก่อนเข้า home)
      notifyListeners();

      if (_token != null) {
        // refresh ข้อมูล user จาก server แบบไม่บล็อก — cache ใน prefs ค้างตั้งแต่ login
        // (เช่นรหัสพนักงานที่เพิ่งถูกเติมใน DB จะโชว์เมื่อเปิดแอปครั้งถัดไป ไม่ต้อง re-login)
        _authService.refreshUser().then((u) {
          if (u != null && _token != null) { _user = u; notifyListeners(); }
        });
        await _ensureServicesInited(); // Firebase/Notification/Consult ต้องพร้อมก่อน FCM (ทำหลัง UI ขึ้น)
        await _initializeFcm();
        _initConsultSync();
      }
    } catch (e) {
      _token = null;
      _user = null;
      _authResolved = true; // getToken ล้มก็ถือว่ารู้แล้ว (= ไม่ล็อกอิน) → ไป /login ได้
    }

    _isLoading = false;
    notifyListeners();
  }

  // init บริการที่ FCM ต้องใช้ แบบครั้งเดียว — ย้ายมาจาก main() เพื่อไม่ให้บล็อก runApp (แก้จอขาว)
  // Firebase ต้องพร้อมก่อน FcmService.initialize() ถึงจะ getToken ได้
  bool _servicesInited = false;
  Future<void> _ensureServicesInited() async {
    if (_servicesInited) return;
    _servicesInited = true;
    try { await Firebase.initializeApp(); } catch (e) { debugPrint('Firebase init failed: $e'); }
    try { await NotificationService().initialize(); } catch (e) { debugPrint('Notification init failed: $e'); }
    try { await ConsultBackground.init(); } catch (e) { debugPrint('ConsultBackground init failed: $e'); }
  }

  Future<void> _initializeFcm() async {
    // ตั้ง callback เมื่อ FCM foreground ได้รับ new_survey
    _fcmService.onNewSurveyReceived = (data) async {
      debugPrint('[Auth] FCM new_survey received: $data');
      // native (MyFirebaseMessagingService) แสดงหน้าเต็มจอ + เสียง alarm ให้แล้วทุกสถานะ
      // ฝั่ง Flutter แค่รีเฟรชรายการงาน — ไม่แสดง notification ซ้ำ (กันเด้ง/ให้กดรับซ้ำ)
      _onCaseAssignedRefresh?.call();
      notifyListeners();
    };
    // งานถูกถอน (ย้าย/ถอน/ลบจากเว็บ) — รีเฟรชรายการให้ใบนั้นหายไปทันทีถ้าช่างกำลังดูรายการอยู่
    _fcmService.onSurveyWithdrawn = (data) async {
      debugPrint('[Auth] FCM cancel_survey received: $data');
      _onCaseAssignedRefresh?.call();
      notifyListeners();
    };

    await _fcmService.initialize();
  }

  // ตั้ง background sync ประวัติการโทรปรึกษาหัวหน้า (เฉพาะ surveyor) + sync รอบแรกทันที
  void _initConsultSync() {
    if (_user?.role != 'surveyor') return;
    ConsultBackground.schedule();
    runConsultSync().then((_) {}).catchError((_) {});
  }

  Future<bool> login(String username, String password) async {
    _isLoading = true;
    _error = null;
    notifyListeners();

    try {
      _user = await _authService.login(username, password);
      _token = await _authService.getToken();

      if (_token != null) {
        await _ensureServicesInited();
        await _initializeFcm();
        _initConsultSync();
      }

      _isLoading = false;
      notifyListeners();
      return true;
    } catch (e) {
      // แยกสาเหตุ — เดิมทุก error ขึ้น "รหัสผ่านไม่ถูกต้อง" ทั้งที่เป็นแค่เน็ตล่ม/server มีปัญหา
      // → ผู้ใช้ในสนามพิมพ์รหัสใหม่ ยิงซ้ำ จนโดน rate-limit login ทั้งที่รหัสถูก
      if (e is DioException) {
        final status = e.response?.statusCode;
        if (e.response == null) {
          _error = 'เชื่อมต่อไม่ได้ กรุณาตรวจสอบสัญญาณอินเทอร์เน็ตแล้วลองใหม่';
        } else if (status == 401 || status == 400) {
          _error = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
        } else if (status == 429) {
          _error = 'ลองเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่';
        } else {
          _error = 'ระบบขัดข้อง (${status ?? '-'}) กรุณาลองใหม่อีกครั้ง';
        }
      } else {
        _error = 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
      }
      _isLoading = false;
      notifyListeners();
      return false;
    }
  }

  Future<void> logout() async {
    // best-effort (ต้องเรียกก่อน _authService.logout() เพราะยังต้องใช้ token):
    // ทุกขั้นเป็น network call ที่พลาดได้ — ครอบเพดานเวลารวม ไม่งั้นเน็ตห่วย (timeout 30s ต่อ call
    // ต่อกัน 4 calls) ทำ logout ค้างเป็นนาที; เกินเพดานแล้วเดินหน้าเคลียร์ session ในเครื่องต่อเลย
    try {
      await () async {
        // 1) ปิดรอบเข้างานที่ค้างอยู่ → สถานะเข้างาน = ไม่ (check-out ลบหมุดให้ฝั่ง server ด้วย)
        try { await _apiService.checkOutAttendance(); } catch (_) {}
        // 2) เผื่อไม่มีรอบเปิดค้างแต่ยังมีหมุดค้าง → ลบหมุดอีกชั้น
        try { await _apiService.clearMyLocation(); } catch (_) {}
        // 3) พยายามส่งงานสำรวจที่ค้างคิว "ตอนยังมี token ของ user นี้" — ไม่ล้างคิวทิ้ง
        //    (ออฟไลน์แล้วล้าง = งานที่ส่งไม่ได้หายถาวร) งานที่ยังส่งไม่ได้จะคงในคิว:
        //    user เดิมกลับมา login → ส่งต่อได้; ถ้าเป็นคนอื่น flush จะโดน 403 (ไม่ใช่เคสตน) แล้วถูกทิ้งเอง — ไม่ mis-submit ข้าม user
        try { await flushSurveyQueue(); } catch (_) {}
        // 4) ล้าง FCM token ของเครื่อง — หยุด noti งานของ user นี้ยิงเข้าเครื่องหลัง logout
        try { await _fcmService.clearToken(); } catch (_) {}
      }().timeout(const Duration(seconds: 15));
    } catch (_) {
      // timeout/พลาด → ยอมทิ้งงาน best-effort (คิวยังอยู่ ส่งรอบหน้าได้) แล้ว logout ต่อ
    }
    await ConsultBackground.cancel();
    await _authService.logout();
    _user = null;
    _token = null;
    _error = null;
    notifyListeners();
  }

  /// เรียกเมื่อ API ตอบ 401 (token หมดอายุ) → เคลียร์ session + ให้ router เด้งกลับหน้า login
  Future<void> handleSessionExpired() async {
    if (_token == null) return; // ออกจากระบบไปแล้ว / กัน 401 ซ้อนหลายตัว
    _token = null;
    _user = null;
    _error = 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
    notifyListeners();
    // เคลียร์เท่ากับ logout — เดิมข้าม 2 อย่างนี้: server ยังถือ FCM token ของเครื่อง (ยิง noti
    // ข้าม session ต่อ) + WorkManager consult ยังรันด้วย token ที่ตายแล้ว (สแปม 401 เบื้องหลัง)
    try { await _fcmService.clearToken(); } catch (_) {}
    await ConsultBackground.cancel();
    await _authService.logout(); // ล้าง token ในเครื่อง
  }
}
