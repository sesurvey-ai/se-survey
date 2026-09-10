import 'dart:async';
import 'package:flutter_image_compress/flutter_image_compress.dart';
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../providers/case_provider.dart';
import '../models/case_model.dart';
import '../providers/auth_provider.dart';
import '../config/api_config.dart';
import '../services/auth_token.dart';
import '../app_icons.dart';
import '../widgets/car_damage_diagram.dart';
import 'damage_notice_screen.dart';
import '../data/survey_master.dart'
    show cidChecksum, kWounds, kLicenseTypes, kCarColors, carBrandsFor, kEmcsPhotoQuota, kEmcsPhotoWarn,
         kTitles, kRelations, kCarTypeCodeToLabel, kEvCodeToLabel, kPolicyTypes;
import 'package:permission_handler/permission_handler.dart';
import 'package:image_picker/image_picker.dart';
import '../widgets/form_kit.dart' show kCidField, kPhoneFormatters;
import 'survey/opponent_editor.dart';
import 'survey/injured_editor.dart';
import 'survey/property_editor.dart';
import 'survey/camera_capture_screen.dart';

// ── Design tokens (from Claude design "survey-form.html") ──
const _bg = Color(0xFFEEF0F4);
const _cardBg = Color(0xFFFFFFFF);
const _fill = Color(0xFFF4F6F9);
const _line = Color(0xFFE8EBF1);
const _lineStrong = Color(0xFFDDE1E9);
const _ink = Color(0xFF1E2330);
const _muted = Color(0xFF737D90);
const _muted2 = Color(0xFF9AA3B4);
const _primary = Color(0xFF2F6BD8);
const _tint = Color(0xFFEAF1FD);
const _warn = Color(0xFFC98A06);
const _warnTint = Color(0xFFFDF3DF);
const _alert = Color(0xFFDC2626); // แดง — แจ้งเตือน "ขาดข้อมูล"
const _alertTint = Color(0xFFFDECEC);
const _ok = Color(0xFF1F9D6B);
const _okTint = Color(0xFFE4F6EE);

// มุมมองใน Hub-and-Spoke: hub = แดชบอร์ด, s1..s6 = หน้าหมวดเต็มจอ, ที่เหลือ = แท็บอื่น
// 'notes' ถูกถอดออก 18/08/69 — หน้าจอนั้นไม่มีทางเข้าถึงอยู่แล้ว (ไม่มีปุ่มไหนพาไป)
// และช่องหมายเหตุไม่เคยถูกส่งเข้าระบบประกัน ฝั่งเว็บก็ถอดออกไปพร้อมกัน
enum _SView { hub, s1, s2, s3, s4, s5, s6, photos, injured, property, expenses, review }

class SurveyFormScreen extends StatefulWidget {
  final int caseId;
  const SurveyFormScreen({super.key, required this.caseId});

  @override
  State<SurveyFormScreen> createState() => _SurveyFormScreenState();
}

class _SurveyFormScreenState extends State<SurveyFormScreen> with WidgetsBindingObserver {
  final _formKey = GlobalKey<FormState>();
  final List<String> _photoPaths = [];
  final Map<String, String> _photoCat = {}; // path → หมวดรูป (Phase 5)
  // OCR confidence ต่อ "ช่องในฟอร์ม" (formKey → medium/low) → โชว์ธงเตือนบนช่องที่ OCR ไม่มั่นใจ
  final Map<String, String> _ocrConf = {};
  Map<String, String> _lastOcrConf = {}; // confidence ต่อ "คีย์ OCR" จากการสแกนล่าสุด
  final Map<String, String> _scanDocPaths = {}; // overwriteKey → path รูปสแกนล่าสุด (บันทึกทับ ไม่สะสมบัตร/ใบขับขี่)
  // ประเภทรูปตามระบบประกัน (จาก edit.txt) — เลือกหมวดก่อนเปิดกล้อง
  static const List<String> _imgCats = [
    'รูปประกอบ',
    'รูปแผนที่เกิดเหตุ',
    'รูปรถประกัน',
    'รูปรถคู่กรณี',
    'ใบรายงานความเสียหาย',
    'ใบแจ้งความเสียหาย',
    'ใบรับเงินจากคู่กรณี',
    'ใบขับขี่รถประกัน',
    'ใบขับขี่รถคู่กรณี',
    'ใบรายการแจ้งความ',
    'รูปผู้บาดเจ็บรถประกัน',
    'รูปผู้บาดเจ็บรถคู่กรณี',
    'รูปทรัพย์สินอื่นๆของคู่กรณี',
  ];
  static const String _imgCatDefault = 'รูปประกอบ';
  // slug ASCII ต่อหมวด — ใช้ตั้งชื่อไฟล์รูปหลังถ่าย (เลี่ยงอักขระไทยใน path/URL/multipart ที่อาจ encode พัง)
  static const Map<String, String> _catSlug = {
    'รูปประกอบ': 'photo',
    'รูปแผนที่เกิดเหตุ': 'map',
    'รูปรถประกัน': 'insured_car',
    'รูปรถคู่กรณี': 'opponent_car',
    'ใบรายงานความเสียหาย': 'damage_report',
    'ใบแจ้งความเสียหาย': 'damage_notice',
    'ใบรับเงินจากคู่กรณี': 'payment_receipt',
    'ใบขับขี่รถประกัน': 'insured_license',
    'ใบขับขี่รถคู่กรณี': 'opponent_license',
    'ใบรายการแจ้งความ': 'police_report',
    'รูปผู้บาดเจ็บรถประกัน': 'insured_injured',
    'รูปผู้บาดเจ็บรถคู่กรณี': 'opponent_injured',
    'รูปทรัพย์สินอื่นๆของคู่กรณี': 'opponent_property',
  };
  Set<int>? _imgSel; // โหมดเลือกหลายรูป (null = ปิด)
  List<String> _provinceNames = [];
  Map<String, List<String>> _provincesData = {};
  List<Map<String, dynamic>> _caseImages = [];
  bool _showImageSheet = false;
  // มุมมองปัจจุบันของ Hub-and-Spoke (เริ่มที่แดชบอร์ด)
  _SView _view = _SView.hub;
  DateTime? _slaStart; // เวลาลูกค้าแจ้งประกัน (ตั้งต้น SLA 24 ชม.) — จาก report.customer_reported_at
  // keys for the section card wrappers (reused as GlobalKeys)
  final List<GlobalKey> _secKeys = List.generate(8, (_) => GlobalKey());

  // Phase 2: capture tools
  String? _savedAt;      // เวลาบันทึกร่างอัตโนมัติล่าสุด (HH:MM)
  bool _ocrBusy = false; // กำลังสแกน OCR

  // Phase 3: ข้อมูลหลายรายการ (persist เป็น JSONB)
  final List<Map<String, dynamic>> _opponents = [];
  final List<Map<String, dynamic>> _injured = [];
  final List<Map<String, dynamic>> _property = [];
  // สวิตช์ "มี/ไม่มี" ของ 3 หมวด optional (ค่าเริ่มต้น "ไม่มี") — เปิด "มี" ถ้ามีข้อมูลอยู่แล้ว
  bool _hasOpponents = false;
  bool _hasInjured = false;
  bool _hasProperty = false;
  // snapshot ของหน้าย่อย (คู่กรณี/ผู้บาดเจ็บ) ที่กำลังเปิดค้าง หลังเพิ่งสแกน OCR — เก็บลง draft เพื่อกู้ถ้าแอปถูก kill
  // {'type': 'opponent'|'injured', 'index': int? (null=รายการใหม่), 'data': {...}}
  Map<String, dynamic>? _pendingEditor;

  void _go(_SView v) {
    FocusManager.instance.primaryFocus?.unfocus();
    _autosave();
    setState(() => _view = v);
  }

  // หมวดถัดไปแบบเรียงลำดับ (s1→…→s5 หมวดหลัก) — null = ไม่มีถัดไป (โชว์ปุ่ม "กลับ Hub"/"ตรวจสอบ")
  // 6-8 (คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน) + รูปภาพ เป็น optional เข้าจาก Hub เท่านั้น ไม่อยู่ในลำดับบังคับ
  static const _sectionOrder = [_SView.s1, _SView.s2, _SView.s3, _SView.s4, _SView.s5];
  _SView? _nextSectionView() {
    final i = _sectionOrder.indexOf(_view);
    return (i >= 0 && i < _sectionOrder.length - 1) ? _sectionOrder[i + 1] : null;
  }

  _SView? _prevSectionView() {
    final i = _sectionOrder.indexOf(_view);
    return (i > 0) ? _sectionOrder[i - 1] : null;
  }

  String _sectionShortTitle(_SView v) {
    switch (v) {
      case _SView.s2: return 'รถประกัน';
      case _SView.s3: return 'ผู้ขับขี่';
      case _SView.s4: return 'ความเสียหาย';
      case _SView.s5: return 'เหตุการณ์';
      case _SView.s6: return 'คู่กรณี';
      default: return '';
    }
  }

  // บันทึกร่างอัตโนมัติแบบเงียบ (ไม่มี snackbar) + อัปเดตป้ายเวลา
  Future<void> _autosave() async {
    if (!_loaded) return; // ยังโหลดฟอร์มไม่เสร็จ → อย่าเพิ่งเขียน draft (กัน draft ว่างทับข้อมูล server)
    // ส่งสำเร็จ + ลบ draft แล้ว → ห้ามเขียนคืน (lifecycle-save/debounce ที่ค้างท่อจะ resurrect draft
    // ให้กลับมาทับข้อมูล server ตลอดไป — เช่นผู้ใช้กดส่งแล้วล็อกจอทันที)
    if (_skipDraftFlush) return;
    try {
      final data = _collectFormData();
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_draftKey, jsonEncode(data));
      final now = DateTime.now();
      final t = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
      if (mounted) {
        _autosaveLabelTick = true;
        try { setState(() => _savedAt = t); } finally { _autosaveLabelTick = false; }
      }
    } catch (_) {}
  }

  // บีบอัด/ย่อรูปตอน copy เข้าโฟลเดอร์เคส — เดิมเก็บ raw จากกล้อง (เลือกได้ถึง ResolutionPreset.max)
  // เปลืองเนื้อที่/แรมตอนแสดง/เวลาอัปโหลดโดยไม่จำเป็น; จำกัดด้านสั้น ~1920 คุณภาพ 82 พอสำหรับงานเคลม
  // บีบไม่สำเร็จ → copy ตรง ๆ (รูปต้องถึงโฟลเดอร์เคสเสมอ); สำเร็จแล้วลบไฟล์ temp ของกล้อง (กัน cache โต)
  Future<bool> _copyPhotoCompressed(String src, String dest) async {
    var ok = false;
    try {
      // keepExif: รูปหลักฐานเคลม — เวลา/กล้องใน EXIF มีค่าในข้อพิพาท (orientation ถูก bake ลง pixel แล้ว ไม่หมุนซ้ำ)
      final r = await FlutterImageCompress.compressAndGetFile(src, dest, minWidth: 1920, minHeight: 1920, quality: 82, keepExif: true);
      ok = r != null;
    } catch (_) {}
    if (!ok) {
      try { await File(src).copy(dest); ok = true; } catch (_) {}
    }
    if (ok) { try { File(src).deleteSync(); } catch (_) {} }
    return ok;
  }

  // ลบไฟล์ temp ของกล้อง (XFile ใน cache) ที่ไม่ถูก consume — ไม่งั้นค้างใน cache ถาวร
  void _deleteCameraTemps(Iterable<XFile> xs) {
    for (final x in xs) {
      try { File(x.path).deleteSync(); } catch (_) {}
    }
  }

  // เลือกจากคลังภาพ: image_picker copy รูปที่เลือกเข้า cache ของแอปเสมอ — pipeline เดิม
  // (_copyPhotoCompressed ลบ src / _deleteCameraTemps) ลบแค่สำเนาใน cache ไฟล์ต้นฉบับในเครื่องไม่ถูกแตะ
  final _imgPicker = ImagePicker();

  // ให้ผู้ใช้เลือกแหล่งรูป: กล้องในแอป หรือรูปที่มีในเครื่อง (ถ่ายด้วยกล้องมือถือเอง/ส่งมาจากแอปอื่น เช่น LINE)
  Future<String?> _pickPhotoSource({String title = 'เพิ่มรูปจาก'}) {
    FocusManager.instance.primaryFocus?.unfocus();
    return showModalBottomSheet<String>(
      context: context,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 14, 18, 2),
            child: Align(
                alignment: Alignment.centerLeft,
                child: Text(title, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700, color: _ink))),
          ),
          ListTile(
            leading: const Icon(Icons.photo_camera_outlined, color: _primary),
            title: const Text('ถ่ายด้วยกล้อง', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
            onTap: () => Navigator.pop(ctx, 'camera'),
          ),
          ListTile(
            leading: const Icon(Icons.photo_library_outlined, color: _primary),
            title: const Text('เลือกจากคลังภาพ', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
            subtitle: const Text('รูปที่ถ่าย/บันทึกไว้ในเครื่อง เช่น ส่งมาจาก LINE', style: TextStyle(fontSize: 11.5, color: _muted)),
            onTap: () => Navigator.pop(ctx, 'gallery'),
          ),
          const SizedBox(height: 6),
        ]),
      ),
    );
  }

  // ── OCR core: ถ่ายด้วยกล้องในแอป (กล้องหลังเสมอ) → เก็บรูปเข้าเคส + สกัดข้อมูล → คืน fields ──
  // kind = 'claim' | 'idcard' | 'license'; photoCategory = หมวด/ชื่อไฟล์ของรูปที่เก็บ (default 'เอกสาร')
  Future<Map<String, dynamic>?> _captureRetainOcr(String kind, {String photoCategory = 'เอกสาร', String? overwriteKey}) async {
    try {
      final src = await _pickPhotoSource(title: 'สแกนจาก');
      if (src == null || !mounted) return null;
      List<XFile>? shots;
      if (src == 'camera') {
        final status = await Permission.camera.request();
        if (!status.isGranted) {
          if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('ต้องอนุญาตใช้กล้องก่อน')));
          return null;
        }
        if (!mounted) return null;
        // กล้องในแอป เริ่มจากกล้องหลังเสมอ + ชัตเตอร์ได้รูปทันที (ไม่ต้องกด "ตกลง")
        shots = await Navigator.of(context).push<List<XFile>>(
            MaterialPageRoute(fullscreenDialog: true, builder: (_) => CameraCaptureScreen(captureCat: photoCategory)));
      } else {
        // สแกนจากรูปในเครื่อง (เช่น การ์ดเคลม/บัตรที่ส่งมาทาง LINE) — สแกนใช้รูปเดียว
        final x = await _imgPicker.pickImage(source: ImageSource.gallery);
        shots = x == null ? null : [x];
      }
      if (shots == null || shots.isEmpty) return null;
      if (!mounted) { _deleteCameraTemps(shots); return null; }
      final caseFolder = await _getCaseFolder();
      final slug = photoCategory == 'เอกสาร' ? 'doc' : _catSlugOf(photoCategory);
      // overwriteKey (สแกนบัตร/ใบขับขี่): ลบ "รูปสแกนเดิม" ของคีย์นี้ทิ้งก่อน (บันทึกทับ ไม่สะสมซ้ำ)
      // — ลบเฉพาะรูปที่บันทึก path ไว้ ไม่แตะรูปหมวดเดียวกันที่ผู้ใช้ถ่ายเอง (เช่น รูปรถประกันจริง)
      if (overwriteKey != null) {
        final old = _scanDocPaths.remove(overwriteKey);
        if (old != null) {
          _photoPaths.remove(old);
          _photoCat.remove(old);
          try { final f = File(old); if (f.existsSync()) f.deleteSync(); } catch (_) {}
        }
      }
      // สแกนเอกสาร (overwriteKey) = เก็บรูปเดียวพอ; อื่นๆ = เก็บทุกรูปที่ถ่าย
      final take = overwriteKey != null ? shots.take(1) : shots;
      final added = <String>[];
      for (final x in take) {
        final p = '$caseFolder/${slug}_${DateTime.now().millisecondsSinceEpoch}_${added.length}.jpg';
        if (await _copyPhotoCompressed(x.path, p)) added.add(p);
      }
      // โหมดสแกนใช้รูปเดียว — รูปที่เหลือจากการกดชัตเตอร์รัวไม่ถูก copy ต้องลบทิ้งจาก cache
      if (overwriteKey != null && shots.length > 1) _deleteCameraTemps(shots.skip(1));
      if (added.isEmpty || !mounted) return null;
      if (overwriteKey != null) _scanDocPaths[overwriteKey] = added.first; // จำ path ไว้ทับรอบหน้า
      setState(() { for (final p in added) { _photoPaths.add(p); _photoCat[p] = photoCategory; } _ocrBusy = true; });
      // เซฟทันที (ไม่รอ debounce): เพิ่งลบรูปสแกนเก่า + เพิ่มรูปใหม่ แล้วกำลังจะรอ OCR ผ่าน network
      // — โดน kill ระหว่างรอ (จุดเสี่ยงแรมสูงสุด) draft บนดิสก์ต้องรู้จักรูปใหม่แล้ว ไม่งั้น orphan
      _autosave();
      final cp = context.read<CaseProvider>();
      final res = kind == 'claim' ? await cp.ocrClaim(added.first) : await cp.ocrDocument(added.first, kind);
      if (!mounted) return null;
      setState(() => _ocrBusy = false);
      final fields = (res?['fields'] as Map?)?.cast<String, dynamic>() ?? {};
      _lastOcrConf = ((res?['confidence'] as Map?)?.map((k, v) => MapEntry(k.toString(), (v ?? '').toString()))) ?? {};
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(fields.isEmpty ? 'บันทึกรูปแล้ว แต่อ่านข้อมูลไม่ได้ — ลองถ่ายใหม่ให้ชัด' : 'เก็บรูป + เติมข้อมูลแล้ว (${fields.length} ช่อง)'),
        backgroundColor: fields.isEmpty ? Colors.orange : Colors.green,
        duration: const Duration(seconds: 2),
      ));
      return fields;
    } catch (_) {
      if (mounted) {
        setState(() => _ocrBusy = false);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('สแกนไม่สำเร็จ')));
      }
      return null;
    }
  }

  // สแกนบัตร ปชช./ใบขับขี่ ของผู้ขับ (s3) — บัตร ปชช. → หมวด "รูปรถประกัน", ใบขับขี่ → "ใบขับขี่รถประกัน"
  Future<void> _scanDriverDoc(String kind) async {
    final fields = await _captureRetainOcr(kind,
        photoCategory: kind == 'idcard' ? 'รูปรถประกัน' : 'ใบขับขี่รถประกัน',
        overwriteKey: kind == 'idcard' ? 'driver_idcard' : 'driver_license'); // บันทึกทับรูปสแกนเดิม
    if (fields == null || fields.isEmpty || !mounted) return;
    String f(String k) => (fields[k] ?? '').toString().trim();
    // ตั้งธงเตือนของช่อง formKey ตาม confidence ของ ocrKey (medium/low = ธง, high = ล้างธง)
    void setConf(String formKey, String ocrKey) {
      final c = _lastOcrConf[ocrKey] ?? '';
      if (c == 'medium' || c == 'low') { _ocrConf[formKey] = c; } else { _ocrConf.remove(formKey); }
    }
    void applyPrefix(String p, String ocrKey) {
      if (const ['นาย', 'นาง', 'นางสาว', 'ด.ช.', 'ด.ญ.'].contains(p)) {
        _driverTitle = p;
        _driverGender = (p == 'นาย' || p == 'ด.ช.') ? 'M' : 'F';
        setConf('driver_title', ocrKey);
      }
    }
    void applyBirthdate(String b, String ocrKey) {
      if (b.isEmpty) return;
      b = _normThaiDateEra(b); // OCR อาจอ่านฝั่งอังกฤษได้ปี ค.ศ.
      _driverBirthdateCtl.text = b;
      setConf('driver_birthdate', ocrKey);
      final age = _ageFromThaiDate(b);
      if (age.isNotEmpty) _driverAgeCtl.text = age; // คำนวณอายุจากวันเกิดให้เลย
    }
    void applyProvinceDistrict(String provRaw, String distRaw) {
      final prov = _matchProvince(provRaw);
      if (prov == null) return;
      _driverProvinceCtl.text = prov;
      setConf('driver_province', 'province');
      final dist = _matchDistrict(prov, distRaw);
      if (dist != null) {
        _driverDistrictCtl.text = dist;
        setConf('driver_district', 'district');
      } else {
        // อ่านอำเภอไม่ตรง dropdown (ที่อยู่บนบัตรมักย่อ): คงค่าที่ผู้ใช้เลือกไว้ "เฉพาะเมื่อยังอยู่ใน
        // จังหวัดใหม่" — OCR เปลี่ยนจังหวัดแล้วอำเภอเดิมข้ามจังหวัด ต้องล้าง (dropdown โชว์ว่าง
        // แต่ controller ค้างค่าเก่า → submit จังหวัด/อำเภอไม่คู่กัน)
        final ds = _provincesData[prov];
        if (ds == null || !ds.contains(_driverDistrictCtl.text)) {
          _driverDistrictCtl.text = '';
          _ocrConf.remove('driver_district');
        }
      }
    }
    if (kind == 'idcard') {
      if (f('first_name').isNotEmpty) { _driverNameCtl.text = f('first_name'); setConf('driver_name', 'first_name'); }
      if (f('last_name').isNotEmpty) { _driverLastnameCtl.text = f('last_name'); setConf('driver_last', 'last_name'); }
      if (f('cid').isNotEmpty) { _driverIdCardCtl.text = f('cid'); setConf('driver_id_card', 'cid'); }
      applyBirthdate(f('birthdate'), 'birthdate');
      if (f('address').isNotEmpty) { _driverAddressCtl.text = f('address'); setConf('driver_address', 'address'); }
      applyProvinceDistrict(f('province'), f('district')); // เลือกจังหวัด/อำเภอ จากที่อยู่บนบัตร
      applyPrefix(f('prefix'), 'prefix');
    } else {
      _driverHasLicense = true; // สแกนใบขับขี่ = มีใบขับขี่ (กันช่องยังซ่อนอยู่)
      if (f('license_no').isNotEmpty) { _driverLicenseNoCtl.text = f('license_no'); setConf('driver_license_no', 'license_no'); }
      final lt = _matchLicenseType(f('license_type')); // map ประเภท (ไทย/อังกฤษ) → ตัวเลือก dropdown
      if (lt != null) { _driverLicenseTypeCtl.text = lt; setConf('driver_license_type', 'license_type'); }
      if (f('issue_date').isNotEmpty) { _driverLicenseStartCtl.text = _normThaiDateEra(f('issue_date')); setConf('driver_license_start', 'issue_date'); }
      if (f('expiry_date').isNotEmpty) { _driverLicenseEndCtl.text = _normThaiDateEra(f('expiry_date')); setConf('driver_license_end', 'expiry_date'); }
      if (_driverNameCtl.text.trim().isEmpty && f('first_name').isNotEmpty) { _driverNameCtl.text = f('first_name'); setConf('driver_name', 'first_name'); }
      if (_driverLastnameCtl.text.trim().isEmpty && f('last_name').isNotEmpty) { _driverLastnameCtl.text = f('last_name'); setConf('driver_last', 'last_name'); }
      // เพศ/คำนำหน้า/วันเกิด จากใบขับขี่ — เติมเฉพาะที่ยังว่าง (ไม่ทับค่าจากบัตร ปชช.)
      if (_driverTitle == '0' || _driverTitle.isEmpty) applyPrefix(f('prefix'), 'prefix');
      if (_driverBirthdateCtl.text.trim().isEmpty) applyBirthdate(f('birthdate'), 'birthdate');
    }
    setState(() {});
    _autosave(); // เซฟทันทีหลัง OCR เติมช่องสำคัญ (กล้อง/OCR กินแรม — เสี่ยงโดน kill)
  }

  // ── normalize ปีของวันที่ "d/m/y" เป็น พ.ศ. — OCR อ่านฝั่งอังกฤษของใบขับขี่/บัตรได้ปี ค.ศ.
  // ปี ค.ศ. หลุดเข้าระบบแล้วทำ wheel ปี พ.ศ. เพี้ยน (initialItem ติดลบ) + era ปนกันใน DB ──
  String _normThaiDateEra(String s) {
    final parts = s.trim().split('/');
    if (parts.length != 3) return s.trim();
    final y = int.tryParse(parts[2].trim());
    if (y == null || y < 1900 || y >= 2100) return s.trim(); // ไม่ใช่ ค.ศ. ชัดเจน → คงเดิม
    return '${parts[0].trim()}/${parts[1].trim()}/${y + 543}';
  }

  // ── อายุจากวันเกิด "d/m/พ.ศ." → คืนเป็นสตริงจำนวนปี ('' ถ้าอ่านไม่ได้) ──
  String _ageFromThaiDate(String s) {
    final parts = s.split('/');
    if (parts.length != 3) return '';
    final d = int.tryParse(parts[0].trim());
    final m = int.tryParse(parts[1].trim());
    final by = int.tryParse(parts[2].trim());
    if (d == null || m == null || by == null) return '';
    if (m < 1 || m > 12 || d < 1 || d > 31) return '';
    final ceYear = by > 2400 ? by - 543 : by; // เผื่อกรอกเป็น ค.ศ.
    final now = DateTime.now();
    var age = now.year - ceYear;
    if (now.month < m || (now.month == m && now.day < d)) age -= 1; // ยังไม่ถึงวันเกิดปีนี้
    if (age < 0 || age > 120) return '';
    return age.toString();
  }

  // ── จับคู่ชื่อจังหวัด/อำเภอ ที่ OCR อ่านได้ กับตัวเลือกใน dropdown (normalize prefix/ช่องว่าง/ฯ) ──
  String _normTh(String s) => s.replaceAll(RegExp(r'\s+'), '').replaceAll('ฯ', '');

  String? _matchProvince(String raw) {
    if (raw.trim().isEmpty || _provinceNames.isEmpty) return null;
    final n = _normTh(raw).replaceAll('จังหวัด', '').replaceAll('จ.', '');
    if (n.contains('กรุงเทพ') || n == 'กทม' || n == 'กทม.') {
      for (final p in _provinceNames) { if (p.contains('กรุงเทพ')) return p; }
    }
    for (final p in _provinceNames) { if (_normTh(p) == n) return p; } // ตรงเป๊ะก่อน
    if (n.length >= 3) {
      for (final p in _provinceNames) {
        final pn = _normTh(p);
        if (pn.contains(n) || n.contains(pn)) return p;
      }
    }
    return null;
  }

  String? _matchDistrict(String province, String raw) {
    final ds = _provincesData[province];
    if (ds == null || ds.isEmpty || raw.trim().isEmpty) return null;
    String strip(String s) => _normTh(s)
        .replaceAll('กิ่งอำเภอ', '').replaceAll('อำเภอ', '').replaceAll('เขต', '')
        .replaceAll('กิ่ง', '').replaceAll('อ.', '').replaceAll('ข.', '').replaceAll('ต.', '');
    final n = strip(raw);
    if (n.isEmpty) return null;
    for (final d in ds) {
      final dn = strip(d);
      if (dn == n || dn.startsWith(n) || n.startsWith(dn)) return d;
    }
    return null;
  }

  // ตัวเลือกประเภทใบขับขี่ (ใช้ทั้ง dropdown + matcher OCR) — แหล่งเดียวกับคู่กรณี
  static const List<String> _licenseTypeOptions = kLicenseTypes;

  // จับคู่ "ประเภทใบขับขี่" ที่ OCR อ่านได้ (ไทย/อังกฤษ) → ตัวเลือกใน dropdown; null = ไม่มั่นใจ (เลือกเอง)
  String? _matchLicenseType(String raw) {
    if (raw.trim().isEmpty) return null;
    final s = raw.toLowerCase();
    final th = _normTh(raw);
    for (final t in _licenseTypeOptions) { if (_normTh(t) == th) return t; } // ตรงเป๊ะก่อน

    final intl = s.contains('international') || th.contains('สากล') || th.contains('ระหว่างประเทศ');
    if (intl) return 'ใบขับขี่สากล';
    if (th.contains('ทุกประเภท')) return 'ใบอนุญาตเป็นผู้ขับรถทุกประเภท';

    final motor = s.contains('motorcycle') || s.contains('motorbike') || th.contains('จักรยานยนต์');
    final car = s.contains('car') || s.contains('private') || th.contains('รถยนต์') || th.contains('ส่วนบุคคล');
    final public = s.contains('public') || th.contains('สาธารณะ');

    String durOf() {
      if (th.contains('ตลอดชีพ') || s.contains('lifetime') || s.contains('permanent')) return 'life';
      if (th.contains('ชั่วคราว') || s.contains('temporary')) return 'temp';
      if (th.contains('5ปี') || s.contains('5year') || s.contains('5-year')) return '5y';
      if (th.contains('7ปี') || s.contains('7year') || s.contains('7-year')) return '7y';
      if (th.contains('หนึ่งปี') || th.contains('1ปี') || s.contains('1year')) return '1y';
      return '';
    }
    final dur = durOf();

    if (motor) {
      if (dur == 'life') return 'ใบขับขี่รถจักรยานยนต์ส่วนบุคคลตลอดชีพ';
      if (dur == 'temp') return 'ใบขับขี่รถจักรยานยนต์ส่วนบุคคลชั่วคราว';
      if (dur == '1y') return 'ใบขับขี่รถจักรยานยนต์ส่วนบุคคลหนึ่งปี';
      return 'ใบขับขี่รถจักรยานยนต์ส่วนบุคคล';
    }
    if (public) return 'ใบขับขี่รถยนต์สาธารณะ'; // สาธารณะ (แท็กซี่) → รถยนต์สาธารณะ
    if (car) {
      if (dur == 'life') return 'ใบขับขี่รถยนต์ส่วนบุคคลตลอดชีพ';
      if (dur == 'temp') return 'ใบขับขี่รถยนต์ส่วนบุคคลชั่วคราว';
      if (dur == '5y') return 'ใบขับขี่รถยนต์ส่วนบุคคล 5 ปีต่ออายุ';
      if (dur == '7y') return 'ใบขับขี่รถยนต์ส่วนบุคคล 7 ปีต่ออายุ';
      if (dur == '1y') return 'ใบขับขี่รถยนต์ส่วนบุคคลหนึ่งปีต่ออายุ';
      return 'ใบขับขี่รถยนต์ส่วนบุคคล';
    }
    return null;
  }

  // ── ธงเตือน OCR: ห่อ field ถ้า OCR ไม่มั่นใจช่องนี้ (medium/low) → โชว์คำเตือนใต้ช่อง ──
  Widget _ocrField(String formKey, Widget field) {
    final c = _ocrConf[formKey];
    if (c != 'medium' && c != 'low') return field;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        field,
        Padding(
          padding: const EdgeInsets.only(top: 4, left: 6),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.flag_rounded, size: 13, color: _warn),
            const SizedBox(width: 4),
            Flexible(child: Text(c == 'low' ? 'OCR อ่านไม่ชัด' : 'OCR ไม่มั่นใจ',
                style: const TextStyle(fontSize: 11.5, color: _warn, fontWeight: FontWeight.w600),
                maxLines: 1, overflow: TextOverflow.ellipsis)),
          ]),
        ),
      ],
    );
  }

  // ── แตะชิ้นส่วนบนแผนภาพ → เพิ่ม/แก้รายการ + เลือกข้าง/ระดับใน bottom sheet ──
  Future<void> _onTapDiagramPart(String part, [String pos = 'A']) async {
    // ชิ้นส่วนที่ EMCS ไม่มีปุ่มเลือกด้าน → บังคับ 'A' (ใช้ลิสต์กลางร่วมกับ car_damage_diagram)
    if (kNoSideParts.contains(part)) pos = 'A';
    // ชื่อชิ้นส่วนตรง checklist EMCS (ไม่มีข้างในชื่อ) → จับคู่ด้วย part+pos
    int idx = _damageItems.indexWhere(
        (it) => it['part'] == part && (it['pos'] ?? 'A') == pos);
    Map<String, String>? justAdded;
    if (idx < 0) {
      justAdded = {'part': part, 'pos': pos, 'level': ''};
      _damageItems.add(justAdded);
      idx = _damageItems.length - 1;
      _syncDamageDesc();
      _autosave();
    }
    await _showDamagePartSheet(idx);
    if (!mounted) return;
    // เพิ่งแตะชิ้นส่วนใหม่แล้วปิด sheet โดยไม่เลือกระดับ → ถอน entry ผี (level ว่างแต่ part มีชื่อ
    // เลยหลุดตัวกรอง _filledDamageItems เข้า insured_damage ตอนเซฟ) — remove ตาม identity ของ map
    // เหมือน fix เดียวกันใน car_damage_diagram.dart
    if (justAdded != null && (justAdded['level'] ?? '').isEmpty) {
      setState(() {
        _damageItems.remove(justAdded);
        _syncDamageDesc();
      });
      _autosave();
    }
  }

  Future<void> _showDamagePartSheet(int idx) {
    FocusManager.instance.primaryFocus?.unfocus();
    return showModalBottomSheet(
      context: context,
      useSafeArea: true, // กันปุ่ม "เสร็จ" โดน nav bar บัง (route-level SafeArea)
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) {
          final item = _damageItems[idx];
          Widget seg(String group, Map<String, String> opts, Map<String, Color> colors) => Wrap(spacing: 8, runSpacing: 8, children: [
                for (final e in opts.entries)
                  GestureDetector(
                    onTap: () {
                      final sel = item[group] == e.key;
                      setSheet(() => item[group] = sel ? '' : e.key);
                      _updateDamageItem(idx, group, item[group] ?? '');
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                      decoration: BoxDecoration(
                        color: item[group] == e.key ? (colors[e.key] ?? _primary) : Colors.white,
                        borderRadius: BorderRadius.circular(11),
                        border: Border.all(color: item[group] == e.key ? (colors[e.key] ?? _primary) : _lineStrong, width: 1.5),
                      ),
                      child: Text(e.value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: item[group] == e.key ? Colors.white : _muted)),
                    ),
                  ),
              ]);
          return SafeArea(
            top: false,
            child: Padding(
            padding: EdgeInsets.fromLTRB(16, 14, 16, 16 + MediaQuery.of(ctx).viewInsets.bottom),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(item['part'] ?? '', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: _ink))),
                GestureDetector(
                  onTap: () { setState(() { _damageItems.removeAt(idx); _syncDamageDesc(); }); _autosave(); Navigator.pop(ctx); },
                  child: Container(padding: const EdgeInsets.all(6), decoration: BoxDecoration(color: Colors.red.shade50, shape: BoxShape.circle), child: Icon(Icons.delete_outline, size: 18, color: Colors.red.shade700)),
                ),
              ]),
              // ชิ้นส่วนที่ EMCS ไม่มี radio ด้าน → ไม่ต้องโชว์ตัวเลือก (บังคับ 'A' ไปแล้วตอนแตะ)
              if (!kNoSideParts.contains(item['part'])) ...[
                const SizedBox(height: 14),
                const Text('ตำแหน่ง', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: _muted)),
                const SizedBox(height: 8),
                seg('pos', const {'L': 'ซ้าย', 'R': 'ขวา', 'A': 'ทั้งหมด'}, const {}),
              ],
              const SizedBox(height: 14),
              const Text('ระดับความเสียหาย', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: _muted)),
              const SizedBox(height: 8),
              seg('level', const {'L': 'ต่ำ', 'M': 'กลาง', 'H': 'สูง', 'X': 'สูงมาก'},
                  const {'L': Color(0xFF16A34A), 'M': Color(0xFFEAB308), 'H': Color(0xFFEA8600), 'X': Color(0xFFDC2626)}),
              const SizedBox(height: 18),
              SizedBox(
                width: double.infinity, height: 46,
                child: ElevatedButton(
                  onPressed: () => Navigator.pop(ctx),
                  style: ElevatedButton.styleFrom(backgroundColor: _primary, foregroundColor: Colors.white, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13))),
                  child: const Text('เสร็จ', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                ),
              ),
            ]),
          ));
        },
      ),
    );
  }

  // debounce autosave ระหว่างพิมพ์ (กันข้อมูลหายถ้าแอปโดน kill/กด Back ระบบ ก่อนเปลี่ยนหน้า)
  Timer? _autosaveTimer;
  // ฟอร์มโหลดเสร็จ (server + draft) แล้วหรือยัง — กัน autosave/dispose เขียน draft "ว่าง" ระหว่างโหลด
  // (draft ว่างจะทับข้อมูล server ตอนเปิดใหม่ → รายการหาย). หลัง _loaded=true แล้ว draft ว่าง = ผู้ใช้ตั้งใจลบจริง
  bool _loaded = false;
  // ตั้ง true ตอนส่งสำเร็จ (ลบ draft แล้ว) → กัน dispose เขียน draft กลับมาหลอน
  bool _skipDraftFlush = false;
  // ค่าสรุปความเสียหายอัตโนมัติล่าสุด — ใช้กัน _syncDamageDesc เขียนทับ note ที่ช่างพิมพ์เอง
  String _lastAutoDesc = '';
  // ฟังการเปลี่ยนของช่องบังคับ → อัปเดตป้าย "ครบ N/5" แบบ real-time ระหว่างพิมพ์
  late final Listenable _completionListenable;

  void _scheduleAutosave() {
    _autosaveTimer?.cancel();
    _autosaveTimer = Timer(const Duration(milliseconds: 1200), _autosave);
  }

  // กัน setState ของป้ายเวลา "บันทึกแล้ว" (ใน _autosave เอง) วนกลับมา schedule autosave ไม่รู้จบ
  bool _autosaveLabelTick = false;

  // ทุก mutation ของฟอร์มผ่าน setState → เข้าคิว autosave (debounced) เสมอ
  // ครอบคลุม chips/dropdown/สวิตช์/date picker/checkbox ที่เดิมไม่เรียกเซฟเอง — โดน kill แล้วตัวเลือกหาย
  // (setState ที่เป็น UI ล้วน เช่น โหมดเลือกรูป ก็เข้าคิวด้วย — เซฟเกินดีกว่าเซฟขาด, debounce กันถี่ให้แล้ว)
  @override
  void setState(VoidCallback fn) {
    super.setState(fn);
    if (!_autosaveLabelTick) _scheduleAutosave();
  }

  // แอพลง background (สลับแอพ/จอดับ) = จุดเสี่ยงโดน OS kill → flush ร่างทันที ไม่รอ debounce
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.paused || state == AppLifecycleState.hidden) {
      _autosaveTimer?.cancel();
      _autosave();
    }
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _completionListenable = Listenable.merge([
      _policyNoCtl, _policyTypeCtl, _assuredNameCtl, _claimNoCtl,
      _licensePlateCtl, _carProvinceCtl, _carBrandCtl,
      _driverNameCtl, _driverLastnameCtl, _driverPhoneCtl, _driverIdCardCtl, _driverLicenseNoCtl,
      _accDateCtl, _accPlaceCtl, _accCauseCtl, _accDetailCtl, _accSurveyorCtl,
      _survPlaceCtl,
      _accPoliceNameCtl, _accPoliceStationCtl,
    ]);
    _loadProvinces();
    _loadExistingReport();
  }

  Future<void> _loadProvinces() async {
    try {
      final raw = await DefaultAssetBundle.of(context).loadString('assets/thai_provinces.json');
      final parsed = Map<String, dynamic>.from(jsonDecode(raw));
      if (!mounted) return; // back ออกก่อนโหลด asset เสร็จ → กัน setState หลัง dispose
      setState(() {
        _provincesData = parsed.map((k, v) => MapEntry(k, List<String>.from(v)));
        _provinceNames = _provincesData.keys.toList()..sort();
      });
    } catch (_) {}
  }

  void _showBuddhistDatePicker(TextEditingController target, {String title = 'เลือกวันที่', int defaultYearsAgo = 0, int yearsAhead = 5}) {
    // ปล่อย focus ของช่องข้อความที่ค้างอยู่ ก่อนเปิด bottom sheet → ปิดแล้วไม่เด้ง focus/คีย์บอร์ดกลับ
    FocusManager.instance.primaryFocus?.unfocus();
    final now = DateTime.now();
    final thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    int selDay = now.day;
    int selMonth = now.month;
    int selYear = now.year + 543 - defaultYearsAgo;

    final existing = target.text.trim();
    if (existing.isNotEmpty) {
      final parts = existing.split('/');
      if (parts.length == 3) {
        selDay = int.tryParse(parts[0]) ?? selDay;
        selMonth = int.tryParse(parts[1]) ?? selMonth;
        selYear = int.tryParse(parts[2]) ?? selYear;
        // ค่าเก่าอาจเป็นปี ค.ศ. (OCR อ่านฝั่งอังกฤษของเอกสาร) → แปลงเป็น พ.ศ.
        if (selYear >= 1900 && selYear < 2100) selYear += 543;
      }
    }
    // clamp เข้าช่วงของ wheel — ปีนอกช่วงทำ initialItem ติดลบ/เกิน childCount (ล้อว่าง +
    // ค่าที่โชว์ไม่ตรงค่าที่คืน)
    final wheelMinYear = now.year + 543 - 100;
    final wheelMaxYear = wheelMinYear + 100 + yearsAhead;
    if (selYear < wheelMinYear) selYear = wheelMinYear;
    if (selYear > wheelMaxYear) selYear = wheelMaxYear;

    showModalBottomSheet(
      context: context,
      enableDrag: false, // กันปัดลง (โดยเฉพาะบนหัว sheet) เผลอปิด picker แทนที่จะหมุน wheel
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModalState) {
            final maxDay = DateTime(selYear - 543, selMonth + 1, 0).day;
            if (selDay > maxDay) selDay = maxDay;
            return Container(
              height: 320,
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                      TextButton(
                        onPressed: () {
                          final formatted = '${selDay.toString().padLeft(2, '0')}/${selMonth.toString().padLeft(2, '0')}/$selYear';
                          setState(() {
                            target.text = formatted;
                            if (identical(target, _driverBirthdateCtl)) {
                              final a = _ageFromThaiDate(formatted); // เลือกวันเกิดเอง → คำนวณอายุให้
                              if (a.isNotEmpty) _driverAgeCtl.text = a;
                              _ocrConf.remove('driver_birthdate');
                            } else if (identical(target, _driverLicenseStartCtl)) {
                              _ocrConf.remove('driver_license_start');
                            } else if (identical(target, _driverLicenseEndCtl)) {
                              _ocrConf.remove('driver_license_end');
                            }
                          });
                          Navigator.pop(ctx);
                        },
                        child: const Text('ตกลง', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Expanded(
                    child: Row(
                      children: [
                        Expanded(
                          flex: 2,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              const Text('วัน', style: TextStyle(fontSize: 13, color: Colors.grey)),
                              const SizedBox(height: 4),
                              Expanded(
                                child: ListWheelScrollView.useDelegate(
                                  itemExtent: 36,
                                  diameterRatio: 1.5,
                                  physics: const FixedExtentScrollPhysics(),
                                  controller: FixedExtentScrollController(initialItem: selDay - 1),
                                  onSelectedItemChanged: (i) => setModalState(() => selDay = i + 1),
                                  childDelegate: ListWheelChildBuilderDelegate(
                                    childCount: maxDay,
                                    builder: (ctx, i) => Center(child: Text('${i + 1}', style: TextStyle(fontSize: 18, fontWeight: (i + 1) == selDay ? FontWeight.bold : FontWeight.normal))),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Expanded(
                          flex: 4,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              const Text('เดือน', style: TextStyle(fontSize: 13, color: Colors.grey)),
                              const SizedBox(height: 4),
                              Expanded(
                                child: ListWheelScrollView.useDelegate(
                                  itemExtent: 36,
                                  diameterRatio: 1.5,
                                  physics: const FixedExtentScrollPhysics(),
                                  controller: FixedExtentScrollController(initialItem: selMonth - 1),
                                  onSelectedItemChanged: (i) => setModalState(() => selMonth = i + 1),
                                  childDelegate: ListWheelChildBuilderDelegate(
                                    childCount: 12,
                                    builder: (ctx, i) => Center(child: Text(thaiMonths[i], style: TextStyle(fontSize: 16, fontWeight: (i + 1) == selMonth ? FontWeight.bold : FontWeight.normal))),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                        Expanded(
                          flex: 3,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.center,
                            children: [
                              const Text('ปี พ.ศ.', style: TextStyle(fontSize: 13, color: Colors.grey)),
                              const SizedBox(height: 4),
                              Expanded(
                                child: ListWheelScrollView.useDelegate(
                                  itemExtent: 36,
                                  diameterRatio: 1.5,
                                  physics: const FixedExtentScrollPhysics(),
                                  controller: FixedExtentScrollController(initialItem: selYear - (now.year + 543 - 100)),
                                  onSelectedItemChanged: (i) => setModalState(() => selYear = (now.year + 543 - 100) + i),
                                  childDelegate: ListWheelChildBuilderDelegate(
                                    childCount: 101 + yearsAhead,
                                    builder: (ctx, i) {
                                      final y = (now.year + 543 - 100) + i;
                                      return Center(child: Text('$y', style: TextStyle(fontSize: 18, fontWeight: y == selYear ? FontWeight.bold : FontWeight.normal)));
                                    },
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  // เคลมคู่จาก server — เคสอื่นในระบบที่เป็นอีกมุมของอุบัติเหตุเดียวกัน (ใช้เตือนกันข้อมูลปนกัน)
  List<Map<String, dynamic>> _linkedCases = [];
  // ผู้ใช้กดปิดคำเตือนเคลมคู่แล้ว — จำต่อเคส (ปิดครั้งเดียว ไม่เด้งอีกทุกครั้งที่เปิดฟอร์ม)
  bool _pairWarnDismissed = false;

  Future<void> _loadPairWarnDismissed() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      if (mounted && (prefs.getBool('pair_warn_off_${widget.caseId}') ?? false)) {
        setState(() => _pairWarnDismissed = true);
      }
    } catch (_) {}
  }

  Future<void> _dismissPairWarn() async {
    setState(() => _pairWarnDismissed = true);
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool('pair_warn_off_${widget.caseId}', true);
    } catch (_) {}
  }

  Future<void> _loadExistingReport() async {
    // โหลด draft ในเครื่อง "ก่อน" (เร็วกว่า network มาก) — เดิมรอ fetch server เสร็จก่อนค่อยโหลด draft
    // → เน็ตช้า ฟอร์มเปิดว่างทั้งที่มี draft, user เริ่มพิมพ์, server มาถึงทีหลังทับสิ่งที่พิมพ์หาย
    // draft เป็น snapshot สมบูรณ์ของทั้งฟอร์ม (รวมค่าจาก server ณ ตอนสร้าง) → มี draft = ไม่ต้อง
    // populate จาก server ซ้ำ (เอาเฉพาะข้อมูลนอกฟอร์ม: รูป OCR, เวลาตั้งต้น SLA)
    final caseProvider = context.read<CaseProvider>(); // จับก่อน await — กันใช้ context ข้าม async gap
    _loadPairWarnDismissed(); // ไม่ต้องรอ — แค่ตั้งธงซ่อนคำเตือนเคลมคู่ถ้าเคยกดปิด
    final hadDraft = await _loadDraft();
    if (hadDraft && mounted) {
      _loaded = true; // เปิด autosave ทันที — สิ่งที่ user พิมพ์ระหว่างรอ server ถูกเซฟ ไม่ถูกทับ
    }
    try {
      final report = await caseProvider.fetchCaseDetail(widget.caseId);
      if (report != null && mounted) {
        final images = report['case_images'];
        if (images != null && images is List && images.isNotEmpty) {
          setState(() {
            _caseImages = List<Map<String, dynamic>>.from(
              images.where((img) => img['image_type'] == 'ocr'),
            );
          });
        }
        // เคลมคู่: server metadata — เซ็ตเสมอไม่ว่ามี draft หรือไม่ (ไม่ใช่ข้อมูลฟอร์ม ไม่ทับอะไร)
        final lc = report['linked_cases'];
        if (lc is List) {
          setState(() => _linkedCases =
              lc.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList());
        }
        if (!hadDraft) {
          _populateForm(report);
        } else {
          // มี draft → ห้ามทับฟอร์ม; เก็บเฉพาะเวลาตั้งต้น SLA ที่ไม่ได้อยู่ใน draft
          final cr = report['customer_reported_at'];
          if (cr is String && cr.isNotEmpty) {
            setState(() => _slaStart = DateTime.tryParse(cr));
          }
        }
      }
    } catch (_) {}
    _loaded = true; // โหลดเสร็จ → เปิดให้ autosave/dispose ทำงาน (draft ว่างหลังจากนี้ = ผู้ใช้ตั้งใจลบจริง)

    // เติม "ผู้สำรวจภัย" อัตโนมัติ = "รหัสพนักงาน ชื่อ นามสกุล" ของคนที่ล็อกอิน (เมื่อช่องยังว่าง)
    // รูปแบบนี้คือ reference ผู้สำรวจที่ใช้อ้างอิงในพอร์ทัลประกัน — ไหลเข้า ACC_SURV ใน XML ตอน export
    if (mounted && _accSurveyorCtl.text.trim().isEmpty) {
      final u = context.read<AuthProvider>().user;
      if (u != null) {
        final full = '${u.code.isNotEmpty ? '${u.code} ' : ''}${u.firstName} ${u.lastName}'.trim();
        if (full.isNotEmpty) {
          _accSurveyorCtl.text = full;
          _scheduleAutosave();
        }
      }
    }
  }

  // fromDraft: การตีความ null ต่างกัน — draft เก็บ null = "ผู้ใช้ล้างค่า" (ต้องล้างตาม)
  // แต่ report จาก server มี null = "คอลัมน์ว่าง" (ห้ามล้าง — ฟอร์มเปิดให้พิมพ์ได้ระหว่างรอ fetch
  // ถ้าล้างตาม server ที่มาช้า ค่าที่ user เพิ่งพิมพ์ในช่องพวกนี้จะหายทั้งที่ยังไม่ทันเข้า draft)
  void _populateForm(Map<String, dynamic> data, {bool fromDraft = false}) {
    setState(() {
      _claimType = data['claim_type'] ?? _claimType;
      _damageLevel = data['damage_level'] ?? _damageLevel;
      final ct = data['car_type'];
      _carType = (ct != null && const ['0','A','E','M','T','V','W','O'].contains(ct)) ? ct : _carType;
      // ev_type: null ใน draft = ผู้ใช้ล้างค่า (เดิมข้าม null → ค่าเก่าคืนชีพหลังรีสตาร์ท)
      if (fromDraft && data.containsKey('ev_type')) {
        _evType = (data['ev_type'] ?? '').toString();
      } else {
        _evType = data['ev_type'] ?? _evType;
      }
      final dg = data['driver_gender'];
      _driverGender = (dg != null && const ['M','F'].contains(dg)) ? dg : _driverGender;
      final dt = data['driver_title'];
      final validMale = ['นาย','ด.ช.','คุณ'];
      final validFemale = ['นาง','นางสาว','ด.ญ.','คุณ'];
      if (dt != null && const ['นาย','นาง','นางสาว','ด.ช.','ด.ญ.','คุณ'].contains(dt)) {
        if (_driverGender == 'M' && validMale.contains(dt)) {
          _driverTitle = dt;
        } else if (_driverGender == 'F' && validFemale.contains(dt)) {
          _driverTitle = dt;
        } else if (_driverGender == '') {
          _driverTitle = '0';
        } else {
          _driverTitle = _driverGender == 'M' ? 'นาย' : 'นางสาว';
        }
      } else {
        if (_driverGender == 'M') _driverTitle = 'นาย';
        else if (_driverGender == 'F') _driverTitle = 'นางสาว';
        else _driverTitle = '0';
      }
      _accFault = data['acc_fault'] ?? _accFault;
      _accFollowup = data['acc_followup'] ?? _accFollowup;
      // กู้ car_lost จาก report — เดิมไม่กู้ ทำให้ submit ทับค่า car_lost=true ที่ callcenter ตั้งไว้ ให้กลายเป็น false
      final cl = data['car_lost'];
      if (cl != null) _carLost = cl == true || cl == 'true' || cl == 1 || cl == 't';
    });

    final mapping = <TextEditingController, String>{
      _surveyCompanyCtl: 'survey_company', _surveyCompanyAddressCtl: 'survey_company_address',
      _surveyCompanyPhoneCtl: 'survey_company_phone',
      _surveyJobNoCtl: 'survey_job_no', _claimRefNoCtl: 'claim_ref_no', _claimNoCtl: 'claim_no',
      _insuranceCompanyCtl: 'insurance_company', _insuranceBranchCtl: 'insurance_branch',
      _prbNumberCtl: 'prb_number', _policyNoCtl: 'policy_no', _driverByPolicyCtl: 'driver_by_policy',
      _policyStartCtl: 'policy_start', _policyEndCtl: 'policy_end',
      _assuredNameCtl: 'assured_name', _policyTypeCtl: 'policy_type',
      _assuredEmailCtl: 'assured_email', _riskCodeCtl: 'risk_code', _deductibleCtl: 'deductible',
      _repairShopCtl: 'repair_shop',
      _licensePlateCtl: 'license_plate', _carProvinceCtl: 'car_province',
      _carBrandCtl: 'car_brand', _carModelCtl: 'car_model', _carColorCtl: 'car_color',
      _carRegYearCtl: 'car_reg_year', _chassisNoCtl: 'chassis_no', _engineNoCtl: 'engine_no',
      _modelNoCtl: 'model_no', _mileageCtl: 'mileage',
      // EV: _collectFormData เซฟ 3 ช่องนี้ลง draft แต่เดิมไม่เคย restore → ปิด-เปิดแอปแล้วหายเงียบ
      _evBatteryNoCtl: 'ev_battery_no', _evBatteryStartCtl: 'ev_battery_start', _evChargerNoCtl: 'ev_charger_no',
      _driverNameCtl: 'driver_first_name', _driverLastnameCtl: 'driver_last_name',
      _driverAgeCtl: 'driver_age', _driverBirthdateCtl: 'driver_birthdate',
      _driverPhoneCtl: 'driver_phone', _driverAddressCtl: 'driver_address',
      _driverIdCardCtl: 'driver_id_card', _driverLicenseNoCtl: 'driver_license_no',
      _driverLicenseTypeCtl: 'driver_license_type', _driverLicensePlaceCtl: 'driver_license_place',
      _driverLicenseStartCtl: 'driver_license_start', _driverLicenseEndCtl: 'driver_license_end',
      _driverRelationCtl: 'driver_relation',
      _driverProvinceCtl: 'driver_province', _driverDistrictCtl: 'driver_district',
      _damageDescCtl: 'damage_description', _estimatedCostCtl: 'estimated_cost',
      _accDateCtl: 'acc_date', _accTimeCtl: 'acc_time', _accPlaceCtl: 'acc_place',
      _accProvinceCtl: 'acc_province', _accDistrictCtl: 'acc_district',
      _survPlaceCtl: 'survey_place', _survProvinceCtl: 'survey_province', _survDistrictCtl: 'survey_district',
      _accCauseCtl: 'acc_cause', _accDamageTypeCtl: 'acc_damage_type', _accDetailCtl: 'acc_detail',
      _accReporterCtl: 'acc_reporter', _accSurveyorCtl: 'acc_surveyor',
      _accSurveyorBranchCtl: 'acc_surveyor_branch', _accSurveyorPhoneCtl: 'acc_surveyor_phone',
      _accFaultOpponentNoCtl: 'acc_fault_opponent_no',
      _accClaimAmountCtl: 'acc_claim_amount',
      _accClaimTotalAmountCtl: 'acc_claim_total_amount',
      _accPoliceNameCtl: 'acc_police_name', _accPoliceStationCtl: 'acc_police_station',
      _accPoliceCommentCtl: 'acc_police_comment', _accPoliceDateCtl: 'acc_police_date',
      _accPoliceBookNoCtl: 'acc_police_book_no', _accAlcoholTestCtl: 'acc_alcohol_test',
      _accAlcoholResultCtl: 'acc_alcohol_result', _driverTicketCtl: 'driver_ticket',
      _accFollowupCountCtl: 'acc_followup_count', _accFollowupDetailCtl: 'acc_followup_detail',
      _accFollowupDateCtl: 'acc_followup_date',
    };
    // ช่องตัวเลขที่ _collectFormData เขียน null เมื่อว่าง (null ใน draft = ผู้ใช้ตั้งใจล้างค่า)
    // — restore จาก draft ต้องล้างตาม ไม่ใช่ข้าม (เดิมข้าม null → ค่าเก่าจาก server คืนชีพ
    // หลังรีสตาร์ทแล้วถูก submit กลับไปทั้งที่ลบไปแล้ว); จาก server (fromDraft=false) ข้ามตามเดิม
    const nullableNumeric = {
      'mileage', 'driver_age', 'estimated_cost', 'deductible',
      'acc_fault_opponent_no', 'acc_claim_amount', 'acc_claim_total_amount',
    };
    // ป้าย placeholder ของ dropdown (แอป/ฟอร์มเว็บ CaseDetail ที่ select ยังไม่เลือก) ห้ามหลุดเข้าเป็น
    // ค่าจริงในช่อง — เคยหลุดเข้า car_color/acc_province/acc_surveyor_branch → submit ทับกลับ →
    // รหัสจังหวัดใน XML ที่ส่ง EMCS ว่าง (แถวเก่าใน DB ก่อน backend เริ่ม strip ยังมีค่านี้อยู่)
    const placeholderSentinels = {'-- ระบุ --', '-- เลือก --', '-- เขต --'};
    for (final entry in mapping.entries) {
      final val = data[entry.value];
      if (val != null) {
        final s = val.toString();
        entry.key.text = placeholderSentinels.contains(s.trim()) ? '' : s;
      } else if (fromDraft && data.containsKey(entry.value) && nullableNumeric.contains(entry.value)) {
        entry.key.text = '';
      }
    }
    // ติ๊ก "สถานที่เดียวกับที่เกิดเหตุ" ไม่มีคอลัมน์ — อนุมานจากค่า: กรอกแล้วและตรงกับสถานที่เกิดเหตุครบ 3 ช่อง
    _survSameAsAcc = _survPlaceCtl.text.trim().isNotEmpty
        && _survPlaceCtl.text.trim() == _accPlaceCtl.text.trim()
        && _survProvinceCtl.text.trim() == _accProvinceCtl.text.trim()
        && _survDistrictCtl.text.trim() == _accDistrictCtl.text.trim();

    // restore ข้อมูลหลายรายการ + แผนภาพความเสียหาย (จาก server report หรือ draft)
    setState(() {
      void restoreList(String key, List<Map<String, dynamic>> target) {
        final v = data[key];
        if (v is List) {
          target
            ..clear()
            ..addAll(v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)));
        }
      }
      restoreList('opposing_parties', _opponents);
      restoreList('injured_persons', _injured);
      restoreList('damaged_property', _property);
      // กู้ snapshot หน้าย่อยที่สแกน OCR ค้างไว้ตอนแอปถูก kill (editor ยังไม่ได้กด "บันทึก")
      // append (รายการใหม่) หรือ replace (แก้รายการเดิม) — idempotent เพราะ restoreList เคลียร์+เติมใหม่ก่อนทุกครั้ง
      final pe = data['pending_editor'];
      if (pe is Map && pe['data'] is Map) {
        final rec = Map<String, dynamic>.from(pe['data'] as Map);
        final target = pe['type'] == 'injured' ? _injured : _opponents;
        final idx = pe['index'];
        if (idx is int && idx >= 0 && idx < target.length) {
          target[idx] = rec;
        } else {
          target.add(rec);
        }
      }
      // restore รูป + หมวดรูป จาก draft (กรองเฉพาะไฟล์ที่ยังอยู่จริง — กันแกลเลอรีว่างหลังเปิดใหม่)
      final pp = data['photo_paths_local'];
      if (pp is List) {
        _photoPaths
          ..clear()
          ..addAll(pp.map((e) => e.toString()).where((p) => File(p).existsSync()));
      }
      final pc = data['photo_categories'];
      if (pc is Map) {
        _photoCat.clear();
        pc.forEach((k, v) {
          if (File(k.toString()).existsSync()) _photoCat[k.toString()] = v.toString();
        });
      }
      // กู้ path รูปสแกนล่าสุด (กรองเฉพาะไฟล์ที่ยังอยู่) → รีสแกนบัตร/ใบขับขี่แล้วทับรูปเดิมได้แม้แอปเคยถูกปิด
      final sdp = data['scan_doc_paths'];
      if (sdp is Map) {
        _scanDocPaths.clear();
        sdp.forEach((k, v) {
          if (File(v.toString()).existsSync()) _scanDocPaths[k.toString()] = v.toString();
        });
      }
      // มีข้อมูลอยู่แล้ว → เปิดสวิตช์ "มี" (กันข้อมูลถูกซ่อน); ว่าง → "ไม่มี"
      _hasOpponents = _opponents.isNotEmpty || data['has_opponents'] == true;
      _hasInjured = _injured.isNotEmpty || data['has_injured'] == true;
      _hasProperty = _property.isNotEmpty || data['has_property'] == true;
      // มีใบขับขี่ = ประเภทเป็นชนิดจริง (ไม่ว่าง/ไม่ใช่ "ไม่มีใบขับขี่") หรือมีเลขใบขับขี่อยู่แล้ว; ว่าง/ยังไม่กรอก = ไม่มี (สแกนแล้วจะเปิดเอง)
      _driverHasLicense = (_driverLicenseTypeCtl.text.trim().isNotEmpty && _driverLicenseTypeCtl.text.trim() != 'ไม่มีใบขับขี่') || _driverLicenseNoCtl.text.trim().isNotEmpty;
      // ชนิดบัตร: ใช้ค่าที่เคยเลือกไว้; ไม่มี (งานเก่า/ยังไม่เคยเลือก) = คนไทยตามเดิม
      _driverIdThai = '${data['driver_id_type'] ?? ''}'.trim() != 'foreign';
      final idmg = data['insured_damage'];
      if (idmg is List) {
        _damageItems
          ..clear()
          ..addAll(idmg.whereType<Map>().map((e) => {'part': '${e['part'] ?? ''}', 'pos': '${e['pos'] ?? ''}', 'level': '${e['level'] ?? ''}'}));
        _syncDamageDesc();
      }
      final cr = data['customer_reported_at'];
      if (cr is String && cr.isNotEmpty) _slaStart = DateTime.tryParse(cr);

      // 4 ไทม์สแตมป์เก็บเป็น "dd/mm/yyyy|HH:mm" → แยกวันที่/เวลา
      void splitDT(String key, TextEditingController d, TextEditingController t) {
        final v = (data[key] ?? '').toString();
        if (v.isEmpty) return;
        final parts = v.split('|');
        d.text = parts[0];
        if (parts.length > 1) t.text = parts[1];
      }
      splitDT('acc_customer_report_date', _accCustomerReportDateCtl, _accCustomerReportTimeCtl);
      splitDT('acc_insurance_notify_date', _accInsNotifyDateCtl, _accInsNotifyTimeCtl);
      splitDT('acc_survey_arrive_date', _accSurveyArriveDateCtl, _accSurveyArriveTimeCtl);
      splitDT('acc_survey_complete_date', _accSurveyCompleteDateCtl, _accSurveyCompleteTimeCtl);
      splitDT('acc_police_date', _accPoliceDateCtl, _accPoliceTimeCtl);
      splitDT('acc_followup_date', _accFollowupDateCtl, _accFollowupTimeCtl);

      // การเรียกร้องคู่กรณี: comma-separated → set checkbox
      final oc = (data['acc_claim_opponent'] ?? '').toString();
      _opoClaims
        ..clear()
        ..addAll(oc.split(',').map((s) => s.trim()).where((s) => s.isNotEmpty));

      // สวิตช์ progressive: เปิดถ้ามีข้อมูลอยู่แล้ว
      _hasPrb = _prbNumberCtl.text.trim().isNotEmpty;
      _hasPolice = _accPoliceNameCtl.text.trim().isNotEmpty ||
          _accPoliceStationCtl.text.trim().isNotEmpty ||
          _accPoliceCommentCtl.text.trim().isNotEmpty ||
          _accPoliceBookNoCtl.text.trim().isNotEmpty;
    });
  }

  // === บริษัทสำรวจ ===
  final _surveyCompanyCtl = TextEditingController();
  final _surveyCompanyAddressCtl = TextEditingController();
  final _surveyCompanyPhoneCtl = TextEditingController();

  // === เคลม ===
  String _claimType = '';
  String _damageLevel = '';
  bool _carLost = false;
  bool _hasPrb = false;    // สวิตช์ "มี พรบ." — เปิดแล้วโผล่ช่องเลข พรบ.
  bool _hasPolice = false; // สวิตช์ "มีการแจ้งความ/ลงประจำวัน" — เปิดแล้วโผล่ส่วนตำรวจ
  bool _driverHasLicense = false; // สวิตช์ "มีใบขับขี่" (s3) — ค่าเริ่มต้น=ปิด (=ไม่มีใบขับขี่); สแกนใบขับขี่ = เปิดอัตโนมัติ; ปิด = ซ่อน+เคลียร์+ไม่นับว่าขาด
  final _insuranceCompanyCtl = TextEditingController();
  final _insuranceBranchCtl = TextEditingController();
  final _surveyJobNoCtl = TextEditingController();
  final _claimRefNoCtl = TextEditingController();
  final _claimNoCtl = TextEditingController();

  // === กรมธรรม์ ===
  final _prbNumberCtl = TextEditingController();
  final _policyNoCtl = TextEditingController();
  final _driverByPolicyCtl = TextEditingController();
  final _policyStartCtl = TextEditingController();
  final _policyEndCtl = TextEditingController();
  final _assuredNameCtl = TextEditingController();
  final _policyTypeCtl = TextEditingController();
  final _assuredEmailCtl = TextEditingController();
  final _riskCodeCtl = TextEditingController();
  final _deductibleCtl = TextEditingController();
  // ชื่ออู่/ศูนย์ที่นำรถเข้าซ่อม — ข้อความล้วน (บางที่ตั้งชื่อมีตัวเลข/สาขา อย่าทำเป็นช่องตัวเลข)
  final _repairShopCtl = TextEditingController();

  // === รถ ===
  String _carType = '0';
  final _carBrandCtl = TextEditingController();
  final _carModelCtl = TextEditingController();
  final _carColorCtl = TextEditingController();
  final _licensePlateCtl = TextEditingController();
  final _carProvinceCtl = TextEditingController();
  final _chassisNoCtl = TextEditingController();
  final _engineNoCtl = TextEditingController();
  final _mileageCtl = TextEditingController();
  final _carRegYearCtl = TextEditingController();
  String _evType = '';
  final _evBatteryNoCtl = TextEditingController();
  final _evBatteryStartCtl = TextEditingController();
  final _evChargerNoCtl = TextEditingController();
  final _modelNoCtl = TextEditingController();

  // === ผู้ขับขี่ ===
  String _driverGender = '';
  String _driverTitle = '0';
  final _driverNameCtl = TextEditingController();
  final _driverLastnameCtl = TextEditingController();
  final _driverAgeCtl = TextEditingController();
  final _driverBirthdateCtl = TextEditingController();
  final _driverPhoneCtl = TextEditingController();
  final _driverAddressCtl = TextEditingController();
  final _driverIdCardCtl = TextEditingController();
  // ชนิดบัตรผู้ขับขี่: true = คนไทย (13 หลัก+checksum) / false = ต่างชาติ (พิมพ์อิสระ)
  bool _driverIdThai = true;
  final _driverLicenseNoCtl = TextEditingController();
  final _driverLicenseTypeCtl = TextEditingController();
  final _driverLicensePlaceCtl = TextEditingController();
  final _driverLicenseStartCtl = TextEditingController();
  final _driverLicenseEndCtl = TextEditingController();
  final _driverRelationCtl = TextEditingController();
  final _driverProvinceCtl = TextEditingController();
  final _driverDistrictCtl = TextEditingController();

  // === ความเสียหาย ===
  final _damageDescCtl = TextEditingController();
  final _estimatedCostCtl = TextEditingController();
  // รายการความเสียหาย: {part: ชื่อชิ้นส่วน, pos: L/R/A, level: O/L/M/H/X}
  final List<Map<String, String>> _damageItems = [];
  // ยุบ/ขยายด้วย controller แทน key ผูก state — เดิม key: ValueKey('damage_expanded_$_damageExpanded')
  // ทำให้ทุก setState (ทุก keystroke ในฟอร์ม) remount tile กลับเป็น expanded = ยุบไม่อยู่
  // (fix เดียวกับ DamagePartList ใน car_damage_diagram.dart)
  final _damageExpCtl = ExpansionTileController();

  // เฉพาะแถวที่กรอกชิ้นส่วนจริง (ตัดแถวเปล่าจากการกด "+" ที่ยังไม่กรอก ออกจากการนับ/complete)
  List<Map<String, String>> _filledDamageItems() =>
      _damageItems.where((it) => (it['part'] ?? '').trim().isNotEmpty).toList();

  // เพิ่ม/ลบ/แก้รายการต้อง autosave — setState override เข้าคิว (debounced) ให้อัตโนมัติแล้ว
  // เดิมเรียก _autosave() ตรง ๆ ทุกครั้ง = jsonEncode ทั้งฟอร์ม + เขียนดิสก์ "ทุก keystroke"
  // ของช่องชิ้นส่วน (_updateDamageItem) — กระตุกบนเครื่องกลาง-ล่าง; debounce 1.2s +
  // เซฟตอนแอปลง background ครอบความเสี่ยงโดน kill ไว้แล้ว
  void _addDamageItem() {
    setState(() {
      _damageItems.add({'part': '', 'pos': '', 'level': ''});
    });
    // ขยายให้เห็นรายการที่เพิ่ง + (ถ้าถูกยุบอยู่) — หลัง build เฟรมถัดไป
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && !_damageExpCtl.isExpanded) _damageExpCtl.expand();
    });
  }

  void _removeDamageItem(int index) {
    setState(() {
      _damageItems.removeAt(index);
      _syncDamageDesc();
    });
  }

  void _updateDamageItem(int index, String key, String value) {
    setState(() {
      _damageItems[index][key] = value;
      _syncDamageDesc();
    });
  }

  void _syncDamageDesc() {
    final posLabels = {'L': 'ซ้าย', 'R': 'ขวา', 'A': 'ทั้งหมด'};
    final levelLabels = {'L': 'ต่ำ', 'M': 'กลาง', 'H': 'สูง', 'X': 'สูงมาก'};
    final lines = <String>[];
    for (int i = 0; i < _damageItems.length; i++) {
      final item = _damageItems[i];
      if (item['part']?.isNotEmpty == true) {
        final pos = posLabels[item['pos']] ?? '';
        final level = levelLabels[item['level']] ?? '';
        final parts = [item['part']!, if (pos.isNotEmpty) pos, if (level.isNotEmpty) level];
        lines.add('${i + 1}. ${parts.join(' - ')}');
      }
    }
    // เขียนสรุปอัตโนมัติเฉพาะเมื่อช่องยังว่าง หรือยังเป็นค่าสรุปเดิม (ยังไม่ถูกช่างแก้เอง)
    // → note ที่ช่างพิมพ์เองจะไม่ถูกเขียนทับ
    final auto = lines.join('\n');
    if (_damageDescCtl.text.isEmpty || _damageDescCtl.text == _lastAutoDesc) {
      _damageDescCtl.text = auto;
    }
    _lastAutoDesc = auto;
  }

  // === อุบัติเหตุ ===
  final _accDateCtl = TextEditingController();
  final _accTimeCtl = TextEditingController();
  final _accPlaceCtl = TextEditingController();
  final _accProvinceCtl = TextEditingController();
  final _accDistrictCtl = TextEditingController();
  // สถานที่ออกตรวจสอบ (10/09/69) — เว็บ se-survey ใช้คิดเรทค่าบริการจากชุดนี้ก่อนสถานที่เกิดเหตุ
  // (survey_place/survey_province/survey_district, migration 058) จึงบังคับกรอกทั้ง 3 ช่อง
  // ติ๊ก "สถานที่เดียวกับที่เกิดเหตุ" = คัดลอกจากสถานที่เกิดเหตุ และตามไปตลอดที่ยังติ๊กอยู่
  // ⛔ ตัวติ๊กไม่มีคอลัมน์บน server — อนุมานตอนโหลดจากค่าที่ตรงกันทั้ง 3 ช่อง (ดู _applyReport)
  final _survPlaceCtl = TextEditingController();
  final _survProvinceCtl = TextEditingController();
  final _survDistrictCtl = TextEditingController();
  bool _survSameAsAcc = false;
  final _accCauseCtl = TextEditingController();
  final _accDamageTypeCtl = TextEditingController();
  final _accDetailCtl = TextEditingController();
  String _accFault = '';
  final _accReporterCtl = TextEditingController();
  final _accSurveyorCtl = TextEditingController();
  final _accCustomerReportDateCtl = TextEditingController();
  final _accCustomerReportTimeCtl = TextEditingController();
  final _accInsNotifyDateCtl = TextEditingController();
  final _accInsNotifyTimeCtl = TextEditingController();
  final _accSurveyArriveDateCtl = TextEditingController();
  final _accSurveyArriveTimeCtl = TextEditingController();
  final _accSurveyCompleteDateCtl = TextEditingController();
  final _accSurveyCompleteTimeCtl = TextEditingController();
  // การเรียกร้องค่าเสียหายจากคู่กรณี (5 ตัวเลือก, เก็บ comma-separated ลง acc_claim_opponent)
  final Set<String> _opoClaims = {};
  final _accFaultOpponentNoCtl = TextEditingController();   // คู่กรณีคันที่ (EMCS บังคับเมื่อคู่กรณีผิด)
  final _accClaimAmountCtl = TextEditingController();
  final _accClaimTotalAmountCtl = TextEditingController();
  final _accPoliceNameCtl = TextEditingController();
  final _accPoliceStationCtl = TextEditingController();
  final _accPoliceCommentCtl = TextEditingController();
  final _accAlcoholTestCtl = TextEditingController();
  String _accFollowup = '';
  final _accFollowupCountCtl = TextEditingController();
  final _accFollowupDetailCtl = TextEditingController();
  final _accFollowupDateCtl = TextEditingController();
  final _accSurveyorBranchCtl = TextEditingController();
  final _accSurveyorPhoneCtl = TextEditingController();
  final _accPoliceDateCtl = TextEditingController();
  // EMCS มีช่องชั่วโมง/นาทีแยกคู่กับวันที่ (txtPolice_Date_Hour/Minute,
  // txtFlu_Date_Hour/Minute) — เดิมแอปมีแต่วันที่ หัวหน้าต้องเติมเวลาเองทุกเคส
  final _driverTicketCtl = TextEditingController();   // → txtDri_Order (backend มีคอลัมน์อยู่แล้ว)
  final _accPoliceTimeCtl = TextEditingController();
  final _accFollowupTimeCtl = TextEditingController();
  final _accAlcoholResultCtl = TextEditingController();
  final _accPoliceBookNoCtl = TextEditingController();


  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _autosaveTimer?.cancel();
    // best-effort เซฟร่างล่าสุดก่อน controllers ถูก dispose (กัน back/kill ระหว่างกรอก)
    // อ่าน controllers แบบ sync ก่อน await → ปลอดภัยแม้ dispose ต่อทันที
    if (!_skipDraftFlush && _loaded) {
      try {
        final data = _collectFormData();
        SharedPreferences.getInstance()
            .then((p) => p.setString(_draftKey, jsonEncode(data)))
            .catchError((_) => false);
      } catch (_) {}
    }
    for (final c in [
      _surveyCompanyCtl, _surveyCompanyAddressCtl, _surveyCompanyPhoneCtl,
      _insuranceCompanyCtl, _insuranceBranchCtl, _surveyJobNoCtl, _claimRefNoCtl, _claimNoCtl,
      _prbNumberCtl, _policyNoCtl, _driverByPolicyCtl, _policyStartCtl, _policyEndCtl,
      _assuredNameCtl, _policyTypeCtl, _assuredEmailCtl, _riskCodeCtl, _deductibleCtl,
      _repairShopCtl,
      _carBrandCtl, _carModelCtl, _carColorCtl, _licensePlateCtl, _carProvinceCtl,
      _chassisNoCtl, _engineNoCtl, _mileageCtl, _carRegYearCtl, _modelNoCtl,
      _evBatteryNoCtl, _evBatteryStartCtl, _evChargerNoCtl,
      _driverNameCtl, _driverLastnameCtl, _driverAgeCtl, _driverBirthdateCtl,
      _driverPhoneCtl, _driverAddressCtl, _driverIdCardCtl, _driverLicenseNoCtl,
      _driverLicenseTypeCtl, _driverLicensePlaceCtl, _driverLicenseStartCtl, _driverLicenseEndCtl,
      _driverRelationCtl, _driverProvinceCtl, _driverDistrictCtl,
      _damageDescCtl, _estimatedCostCtl,
      _accDateCtl, _accTimeCtl, _accPlaceCtl, _accProvinceCtl, _accDistrictCtl,
      _survPlaceCtl, _survProvinceCtl, _survDistrictCtl,
      _accCauseCtl, _accDamageTypeCtl, _accDetailCtl, _accReporterCtl, _accSurveyorCtl,
      _accCustomerReportDateCtl, _accInsNotifyDateCtl, _accSurveyArriveDateCtl, _accSurveyCompleteDateCtl,
      _accCustomerReportTimeCtl, _accInsNotifyTimeCtl, _accSurveyArriveTimeCtl, _accSurveyCompleteTimeCtl,
      _accClaimAmountCtl, _accClaimTotalAmountCtl,
      _accPoliceNameCtl, _accPoliceStationCtl, _accPoliceCommentCtl, _accPoliceDateCtl, _accPoliceBookNoCtl,
      _accAlcoholTestCtl, _accFollowupCountCtl, _accFollowupDetailCtl, _accFollowupDateCtl,
      _accSurveyorBranchCtl, _accSurveyorPhoneCtl,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  void _showCardImage(int initialIndex) {
    final urls = _caseImages.map((img) {
      final filePath = img['file_path']?.toString() ?? '';
      return '${ApiConfig.baseUrl}/uploads/$filePath';
    }).toList();
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.black,
        insetPadding: EdgeInsets.zero,
        child: Stack(
          children: [
            PageView.builder(
              controller: PageController(initialPage: initialIndex),
              itemCount: urls.length,
              itemBuilder: (context, index) => InteractiveViewer(
                child: Image.network(
                  urls[index],
                  headers: AuthToken.imageHeaders,
                  fit: BoxFit.contain,
                  loadingBuilder: (context, child, progress) =>
                      progress == null ? child : const Center(child: CircularProgressIndicator(color: Colors.white)),
                  errorBuilder: (context, error, stackTrace) => const Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.image_not_supported_outlined, color: Colors.white54, size: 48),
                        SizedBox(height: 12),
                        Text('ไม่พบรูปภาพ', style: TextStyle(color: Colors.white70, fontSize: 14)),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              top: MediaQuery.of(ctx).padding.top + 8,
              right: 8,
              child: IconButton(onPressed: () => Navigator.pop(ctx), icon: const Icon(Icons.close, color: Colors.white, size: 28)),
            ),
          ],
        ),
      ),
    );
  }

  // โฟลเดอร์รูปประจำเคส — ผูกกับ case id (immutable) เท่านั้น
  // เดิมตั้งชื่อตามเลขเคลม/เลขเซอร์เวย์ที่แก้ไขได้ → เลขเปลี่ยนระหว่างทาง (เปิดฟอร์มออฟไลน์/แก้เลขที่
  // OCR อ่านผิด) แล้วรูปที่ถ่ายไว้ก่อนหน้าหลุดจากโฟลเดอร์ที่ถูกอัปโหลดตอน submit แบบเงียบ
  String get _caseFolderPath =>
      '/storage/emulated/0/Download/SE_Survey/case_${widget.caseId}/job_${widget.caseId}';

  Future<String> _getCaseFolder() async {
    final folder = Directory(_caseFolderPath);
    if (!folder.existsSync()) folder.createSync(recursive: true);
    return folder.path;
  }

  // เลือกประเภทรูปก่อน (ใช้ทั้งตอนถ่ายใหม่ + เปลี่ยนหมวดรูปเดิม) — คืน label หรือ null ถ้ายกเลิก
  // ถ้าเลือก "รูปรถคู่กรณี" และมีคู่กรณีในเคส → เลือกต่อว่าเป็น "คันที่ N"
  Future<String?> _pickImageCategory({String? current, String title = 'เลือกประเภทรูป'}) async {
    final base = _baseCat(current); // ไฮไลต์หมวดฐาน (ตัด "คันที่ N" ออก)
    final picked = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 6), child: Row(children: [
            Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: _ink)),
            const Spacer(),
            IconButton(icon: const Icon(Icons.close, size: 22, color: _muted), onPressed: () => Navigator.pop(ctx)),
          ])),
          Flexible(
            child: ListView(shrinkWrap: true, children: [
              for (final c in _imgCats)
                ListTile(
                  dense: true,
                  title: Text(c, style: const TextStyle(fontSize: 14.5, color: _ink)),
                  trailing: c == base ? const Icon(Icons.check, color: _primary, size: 20) : null,
                  onTap: () => Navigator.pop(ctx, c),
                ),
            ]),
          ),
          const SizedBox(height: 8),
        ]),
      ),
    );
    if (picked == null || !mounted) return picked;
    // หมวดที่ผูกกับ record list (คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน) → เลือก "คันที่/คนที่/ชิ้นที่ N"
    // (หรือเพิ่มรายการใหม่ ณ ที่เกิดเหตุ) เสมอ แม้ยังไม่ได้กรอกข้อมูล
    final rc = _recordCatFor(picked);
    final result = rc != null ? await _pickRecord(picked, rc, current: current) : picked;
    // เลือกหมวดคู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน → เปิด toggle "มี" ให้อัตโนมัติ (flow ถ่ายก่อนกรอกทีหลัง)
    if (result != null && mounted) setState(() => _autoEnableForCat(result));
    return result;
  }

  // config หมวดรูปที่ผูกกับ record list — คืน null ถ้าหมวดนั้นไม่ผูกกับลิสต์ใด
  _RecordCat? _recordCatFor(String baseCat) {
    switch (baseCat) {
      case 'รูปรถคู่กรณี':
      case 'ใบขับขี่รถคู่กรณี':
      case 'ใบรับเงินจากคู่กรณี':
        return _RecordCat(_opponents, 'คันที่', 'คัน', 'คู่กรณี',
            (m, i) => 'คันที่ ${i + 1}${(m['plate'] ?? '').toString().trim().isNotEmpty ? ' · ${m['plate']}' : ''}');
      case 'รูปผู้บาดเจ็บรถประกัน':
      case 'รูปผู้บาดเจ็บรถคู่กรณี':
        return _RecordCat(_injured, 'คนที่', 'คน', 'ผู้บาดเจ็บ',
            (m, i) => 'คนที่ ${i + 1}${(m['name'] ?? '').toString().trim().isNotEmpty ? ' · ${m['name']}' : ''}');
      case 'รูปทรัพย์สินอื่นๆของคู่กรณี':
        return _RecordCat(_property, 'ชิ้นที่', 'ชิ้น', 'ทรัพย์สิน',
            (m, i) => 'ชิ้นที่ ${i + 1}${(m['item'] ?? '').toString().trim().isNotEmpty ? ' · ${m['item']}' : ''}');
      default:
        return null;
    }
  }

  // เลือกว่าเป็นรายการไหน (คันที่/คนที่/ชิ้นที่ N) + เพิ่มรายการใหม่ได้ (ณ ที่เกิดเหตุ ยังไม่ต้องกรอก) — สร้างช่องให้เลย
  Future<String?> _pickRecord(String cat, _RecordCat rc, {String? current}) {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(padding: const EdgeInsets.fromLTRB(16, 14, 16, 6), child: Row(children: [
            Expanded(child: Text('$cat — เลือก${rc.noun}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: _ink))),
            IconButton(icon: const Icon(Icons.close, size: 22, color: _muted), onPressed: () => Navigator.pop(ctx)),
          ])),
          Flexible(
            child: ListView(shrinkWrap: true, children: [
              for (var i = 0; i < rc.list.length; i++)
                ListTile(
                  dense: true,
                  title: Text(rc.label(rc.list[i], i), style: const TextStyle(fontSize: 14.5, color: _primary)),
                  trailing: current == '$cat ${rc.word} ${i + 1}' ? const Icon(Icons.check, color: _primary, size: 20) : null,
                  onTap: () => Navigator.pop(ctx, '$cat ${rc.word} ${i + 1}'),
                ),
              // เพิ่มรายการใหม่ → สร้างช่องว่างในหมวดของมัน (กรอกทีหลัง) แล้วผูกรูปกับรายการนั้น
              ListTile(
                dense: true,
                leading: const Icon(Icons.add_circle_outline, color: _primary, size: 22),
                title: Text('เพิ่ม${rc.addNoun} (${rc.word} ${rc.list.length + 1})',
                    style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700, color: _primary)),
                onTap: () {
                  if (rc.list.length >= rc.max) { _snack('เพิ่ม${rc.addNoun}ได้สูงสุด ${rc.max} ${rc.noun}'); return; }
                  final n = rc.list.length + 1;
                  setState(() => rc.list.add(<String, dynamic>{}));
                  _autosave();
                  Navigator.pop(ctx, '$cat ${rc.word} $n');
                },
              ),
              const Divider(height: 1),
              ListTile(
                dense: true,
                title: Text('ไม่ระบุ${rc.noun}', style: const TextStyle(fontSize: 14.5, color: _muted)),
                trailing: current == cat ? const Icon(Icons.check, color: _primary, size: 20) : null,
                onTap: () => Navigator.pop(ctx, cat),
              ),
            ]),
          ),
          const SizedBox(height: 8),
        ]),
      ),
    );
  }

  // หมวดฐาน (ตัด " คันที่ N" ออก) — ใช้ไฮไลต์ในตัวเลือก + จัดกลุ่มในตารางนับ
  String _baseCat(String? c) {
    if (c == null || c.isEmpty) return '';
    for (final k in _imgCats) { if (c == k || c.startsWith('$k ')) return k; }
    return c;
  }

  // slug ASCII ของหมวด (+ เลข "คันที่ N" ถ้ามี) สำหรับตั้งชื่อไฟล์รูป เช่น "รูปรถคู่กรณี คันที่ 2" → opponent_car_2
  String _catSlugOf(String cat) {
    var slug = _catSlug[_baseCat(cat)] ?? 'photo';
    final m = RegExp(r'(\d+)\s*$').firstMatch(cat);
    if (m != null) slug = '${slug}_${m.group(1)}';
    return slug;
  }

  // เลือกหมวดรูปที่ผูกกับ record list → เปิด toggle "มี" ของหมวดนั้นให้อัตโนมัติ (flow ถ่ายก่อนกรอกทีหลัง)
  // ผูกตามลิสต์จริง: รูป/เอกสารคู่กรณี→หมวด6, ผู้บาดเจ็บ→หมวด7, ทรัพย์สิน→หมวด8 (ไม่ปลุกหมวดอื่นเกินจำเป็น)
  void _autoEnableForCat(String c) {
    final rc = _recordCatFor(_baseCat(c));
    if (rc == null) return;
    if (identical(rc.list, _opponents)) {
      _hasOpponents = true;
    } else if (identical(rc.list, _injured)) {
      _hasInjured = true;
    } else if (identical(rc.list, _property)) {
      _hasProperty = true;
    }
  }

  // ── จัดการ tag รูป "<หมวด> <คำ> N" เมื่อลบ/ล้าง record (กันรูปชี้รายการที่ไม่มีอยู่) ──
  // word = "คันที่"/"คนที่"/"ชิ้นที่" — จับทุกหมวดที่ผูกกับลิสต์เดียวกัน (ใช้คำเดียวกัน)
  void _remapRecordPhotoTags(String word, int removedIdx) {
    final marker = ' $word ';
    final removed = removedIdx + 1;
    for (final key in _photoCat.keys.toList()) {
      final v = _photoCat[key]!;
      final idx = v.lastIndexOf(marker);
      if (idx < 0) continue;
      final n = int.tryParse(v.substring(idx + marker.length));
      if (n == null) continue;
      final base = v.substring(0, idx);
      if (n == removed) _photoCat[key] = base;                       // รายการที่ถูกลบ → กลับเป็นหมวดฐาน
      else if (n > removed) _photoCat[key] = '$base $word ${n - 1}'; // รายการหลังเลื่อนเลขลง 1
    }
  }

  // "คู่กรณีคันที่" (หมวด 5 ตอนผลคดี = คู่กรณีผิด) อ้างอิงลำดับคันในหมวด 6 —
  // ลบคู่กรณีทิ้งแล้วเลขต้องขยับตาม ไม่งั้นค่าเดิมชี้ไปคันที่ไม่มีอยู่แล้วไหลเข้าระบบประกันตรง ๆ
  void _remapFaultOpponentNo(int removedIdx) {
    final n = int.tryParse(_accFaultOpponentNoCtl.text.trim());
    if (n == null) return;
    final removed = removedIdx + 1;
    if (n == removed) {
      _accFaultOpponentNoCtl.clear();   // คันที่ถูกอ้างอิงโดนลบเอง → ต้องเลือกใหม่ ไม่เดาแทน
    } else if (n > removed) {
      _accFaultOpponentNoCtl.text = '${n - 1}';
    }
  }

  void _demoteRecordPhotoTags(String word) {
    final marker = ' $word ';
    for (final key in _photoCat.keys.toList()) {
      final v = _photoCat[key]!;
      final idx = v.lastIndexOf(marker);
      if (idx < 0) continue;
      if (int.tryParse(v.substring(idx + marker.length)) == null) continue;
      _photoCat[key] = v.substring(0, idx);
    }
  }

  Future<void> _takePhoto() async {
    // snapshot ก่อนเลือกหมวด — ถ้ายกเลิกกล้อง/ไม่อนุญาต จะคืนสถานะ (toggle + คันที่เพิ่งเพิ่ม) กันรายการค้าง
    final oppBefore = _opponents.length, injBefore = _injured.length, propBefore = _property.length;
    final hadOpp = _hasOpponents, hadInj = _hasInjured, hadProp = _hasProperty;
    void revertProvisional() {
      if (_opponents.length > oppBefore && _emptyRec(_opponents.last)) _opponents.removeLast();
      if (_injured.length > injBefore && _emptyRec(_injured.last)) _injured.removeLast();
      if (_property.length > propBefore && _emptyRec(_property.last)) _property.removeLast();
      _hasOpponents = hadOpp; _hasInjured = hadInj; _hasProperty = hadProp;
      if (mounted) setState(() {});
      _autosave();
    }
    try {
      // เลือกประเภทรูปก่อน ค่อยเลือกแหล่งรูป (กล้อง/คลังภาพ)
      final cat = await _pickImageCategory(title: 'เพิ่มรูปเข้าประเภท');
      if (cat == null || !mounted) { revertProvisional(); return; }
      final src = await _pickPhotoSource();
      if (src == null || !mounted) { revertProvisional(); return; }
      List<XFile>? shots;
      if (src == 'camera') {
        final status = await Permission.camera.request();
        if (!status.isGranted) {
          revertProvisional();
          if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('ต้องอนุญาตใช้กล้องก่อน')));
          return;
        }
        if (!mounted) { revertProvisional(); return; }
        // กล้องในแอป: กดชัตเตอร์แล้วได้รูปทันที (ไม่มีจอ "ตกลง"), ถ่ายรัวหลายรูปเข้าประเภทที่เลือก
        shots = await Navigator.of(context).push<List<XFile>>(
            MaterialPageRoute(fullscreenDialog: true, builder: (_) => CameraCaptureScreen(captureCat: cat)));
      } else {
        // คลังภาพ: เลือกหลายรูปเข้าประเภทเดียวกันได้ในรอบเดียว
        shots = await _imgPicker.pickMultiImage();
      }
      if (shots == null || shots.isEmpty) { revertProvisional(); return; }
      if (!mounted) { _deleteCameraTemps(shots); revertProvisional(); return; }
      final caseFolder = await _getCaseFolder();
      final slug = _catSlugOf(cat); // ตั้งชื่อไฟล์ตามหมวดที่เลือก เช่น opponent_car_1752..._0.jpg
      final added = <String>[];
      for (final x in shots) {
        final localPath = '$caseFolder/${slug}_${DateTime.now().millisecondsSinceEpoch}_${added.length}.jpg';
        if (await _copyPhotoCompressed(x.path, localPath)) added.add(localPath);
      }
      if (added.isEmpty || !mounted) { revertProvisional(); return; } // คัดลอกรูปไม่สำเร็จ/ถูก unmount → คืนช่องที่เพิ่งเพิ่ม
      setState(() { for (final p in added) { _photoPaths.add(p); _photoCat[p] = cat; } });
      _autosave();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('เพิ่มรูปไม่สำเร็จ')));
    }
  }

  int _photoCountOf(String cat) => _photoCat.values.where((c) => c == cat).length;

  /// ปุ่มออกใบเอกสารหน้างาน (ใบแจ้งความเสียหาย / ใบติดต่อ) — ใช้ข้อมูลที่กรอกอยู่ตอนนี้
  /// ไม่ต้องรอส่งงาน เพราะใบนี้ต้องยื่นให้คู่กรณีเซ็นตั้งแต่อยู่หน้างาน
  // ── "เสร็จงาน" หน้างาน (user สั่ง 07/09/69) ─────────────────────────────────
  // ไม่ใช่ส่งงาน: แค่บอกระบบว่าเสร็จหน้างานแล้ว → ศูนย์เห็นว่าว่าง จ่ายงานถัดไปได้ · หัวหน้าเห็น "รอส่งรายงาน"
  // ฟอร์มยังแก้ต่อได้ (ที่บ้าน) จนกด "ตรวจสอบ & ส่ง" · งานที่ถูกตีกลับไม่ต้องกด (หน้างานเสร็จไปแล้ว)
  bool _finishing = false;

  Widget _finishButton() {
    final cm = context.watch<CaseProvider>().getCaseById(widget.caseId);
    if (cm == null || cm.isSentBack) return const SizedBox.shrink();
    if (cm.isFinished) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(6, 12, 6, 0),
        child: Row(children: [
          const Icon(Icons.flag_circle_rounded, size: 20, color: _ok),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'เสร็จงานหน้างานแล้ว${_finishedAtText(cm)} — รับงานถัดไปได้ · กรอกต่อแล้วกด "ตรวจสอบ & ส่ง"',
              style: const TextStyle(fontSize: 12.5, color: _muted),
            ),
          ),
        ]),
      );
    }
    if (cm.status != 'assigned') return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 10, 4, 0),
      child: OutlinedButton.icon(
        onPressed: _finishing ? null : _finishOnSite,
        icon: _finishing
            ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2))
            : const Icon(Icons.flag_circle_outlined, size: 20),
        label: const Padding(
          padding: EdgeInsets.symmetric(vertical: 12),
          child: Text('เสร็จงานหน้างาน — รับงานถัดไปได้'),
        ),
        style: OutlinedButton.styleFrom(foregroundColor: _ok, side: BorderSide(color: _ok.withValues(alpha: .6))),
      ),
    );
  }

  String _finishedAtText(CaseModel cm) {
    final t = DateTime.tryParse(cm.finishedAt ?? '')?.toLocal();
    if (t == null) return '';
    return ' ${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
  }

  Future<void> _finishOnSite() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('เสร็จงานหน้างาน?'),
        content: const Text('ระบบจะบันทึกเวลา "สำรวจเสร็จ" ตอนนี้ และแจ้งศูนย์ว่าคุณรับงานถัดไปได้\n\n'
            'รายงานนี้ยังแก้ต่อได้ทุกที่ (เช่น ที่บ้าน) แล้วค่อยกด "ตรวจสอบ & ส่ง" ให้หัวหน้าตรวจ'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('ยังก่อน')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('เสร็จงาน')),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _finishing = true);
    final cp = context.read<CaseProvider>();
    final err = await cp.finishCase(widget.caseId);
    if (!mounted) return;
    setState(() => _finishing = false);
    if (err != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err), backgroundColor: Colors.red));
      return;
    }
    // เวลา "สำรวจเสร็จ" ที่ server เติมให้ → ใส่ช่องไทม์ไลน์ถ้ายังว่าง
    // ไม่งั้นตอนส่งงาน ค่าว่างจากฟอร์มจะทับ แล้ว server เติมเป็นเวลาส่งงานแทน (ไม่ตรงความจริง)
    final stamp = cp.lastFinishStamp ?? '';
    if (stamp.contains('|') && _accSurveyCompleteDateCtl.text.trim().isEmpty) {
      final p = stamp.split('|');
      _accSurveyCompleteDateCtl.text = p[0];
      if (p.length > 1) _accSurveyCompleteTimeCtl.text = p[1];
      _autosave();
    }
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
      content: Text('บันทึกเสร็จงานแล้ว — รับงานถัดไปได้ กรอกรายงานต่อแล้วกดส่งเมื่อพร้อม'),
      backgroundColor: Colors.green,
      duration: Duration(seconds: 4),
    ));
  }

  /// การ์ด "ออกใบเอกสารหน้างาน" — หน้าตาเดียวกับการ์ดหมวด 1-8 ด้านบน (ไอคอนในกล่อง + หัวข้อ + บรรทัดย่อย + ลูกศร)
  /// เดิมเป็นปุ่มขอบมนแบบ OutlinedButton ข้อความตัดบรรทัด ดูแปลกแยกจากการ์ดอื่น (user ขอ 09/09/69)
  Widget _slipButton() {
    final n = _photoCountOf(_kSlipCat);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: _cardBg,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: _openSlip,
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: _line),
              boxShadow: [BoxShadow(color: const Color(0xFF141E3C).withValues(alpha: 0.035), blurRadius: 20, offset: const Offset(0, 6))],
            ),
            child: Row(children: [
              Container(
                width: 40, height: 40,
                decoration: BoxDecoration(color: _tint, borderRadius: BorderRadius.circular(12)),
                child: const Icon(Icons.receipt_long_outlined, size: 21, color: _primary),
              ),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('ออกใบเอกสารหน้างาน', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: _ink)),
                const SizedBox(height: 2),
                Text(n > 0 ? 'ออกแล้ว $n ใบ' : 'พิมพ์ใบให้ลูกค้า/คู่กรณีเซ็นหน้างาน',
                    style: TextStyle(fontSize: 12, color: n > 0 ? _primary : _muted)),
              ])),
              const SizedBox(width: 8),
              const Icon(Icons.chevron_right, color: _muted2),
            ]),
          ),
        ),
      ),
    );
  }

  static const _kSlipCat = 'ใบแจ้งความเสียหาย';

  /// เปิดหน้าออกใบ แล้วเอารูปใบที่ได้ **เข้ารายการรูปหมวดเดียวกับที่ถ่ายเอง**
  /// จึงอัปขึ้นเซิร์ฟเวอร์และไหลต่อไปตามท่อรูปเดิมโดยไม่ต้องแก้อะไรเพิ่ม
  Future<void> _openSlip() async {
    final folder = await _getCaseFolder();
    if (!mounted) return;
    final path = await Navigator.of(context).push<String>(MaterialPageRoute(
      builder: (_) => DamageNoticeScreen(
        report: _collectFormData(),
        operatorName: _accSurveyorCtl.text.trim(),
        operatorPhone: _accSurveyorPhoneCtl.text.trim(),
        caseFolder: folder,
      ),
    ));
    if (path == null || !mounted) return;
    setState(() {
      _photoPaths.add(path);
      _photoCat[path] = _kSlipCat;
    });
    _autosave();
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('เก็บใบเข้าสำนวนแล้ว (หมวดใบแจ้งความเสียหาย)')));
  }

  // sub ใต้หัวข้อ "รูปภาพ"
  Widget _imgSubline() => const Padding(
        padding: EdgeInsets.only(top: 2, bottom: 2),
        child: Text('ถ่ายเข้าเคสโดยตรง · แตะรูปเพื่อดูรายละเอียด/จัดหมวด', style: TextStyle(fontSize: 11.5, color: _muted)),
      );

  /// เกินโควตาแล้วหรือยัง (นับเฉพาะรูปที่จะส่ง EMCS — รูปยืนยันถึงที่เกิดเหตุไม่นับ
  /// เพราะบอทกรองทิ้งอยู่แล้ว และมันเก็บคนละที่ ไม่ได้อยู่ใน _photoPaths)
  bool get _photoQuotaOver => _photoPaths.length > kEmcsPhotoQuota;

  /// ป้ายเตือนโควตา — null = ยังไม่ต้องเตือน
  /// ⚠️ แอปรู้แค่ "เราถ่ายกี่ใบ" ไม่รู้โควตาที่เหลือจริงของเคลม (EMCS แชร์โควตากับรูป
  /// ที่คนอื่นอัปไว้ก่อน) → เตือนอย่างเดียว **ไม่บล็อก** เพราะบล็อกแล้วช่างเสียหลักฐานถาวร
  /// ส่วนบอทตัดให้พอดีโควตาจริงตอนอัป + log ว่าตกไปกี่ใบ (se-autokey 4ff9af1)
  String? get _photoQuotaNote {
    final n = _photoPaths.length;
    if (n > kEmcsPhotoQuota) return 'เกินโควตา EMCS — รูปส่วนเกินจะไม่ขึ้นระบบประกัน';
    if (n >= kEmcsPhotoWarn) return 'ใกล้เต็มโควตา EMCS ($kEmcsPhotoQuota ใบ/เคลม)';
    return null;
  }

  // การ์ดสรุปจำนวนรูปแต่ละประเภท (โชว์เฉพาะประเภทที่มีรูปแล้ว) — ซ่อนถ้ายังไม่มีรูป
  Widget _imgChecklist() {
    // จัดกลุ่ม: หมวดฐานก่อน แล้วตามด้วย variant "คันที่ N" ที่มีรูป (กันหมวด dynamic หลุดจากตารางนับ)
    final present = _photoCat.values.toSet();
    final rows = <String>[];
    int tailNum(String s) => int.tryParse(s.substring(s.lastIndexOf(' ') + 1)) ?? 0; // เลขท้าย "…คันที่ N"
    for (final base in _imgCats) {
      if (present.contains(base)) rows.add(base);
      final variants = present.where((c) => c != base && c.startsWith('$base ')).toList()
        ..sort((a, b) => tailNum(a).compareTo(tailNum(b))); // เรียงตามเลข ไม่ใช่ตัวอักษร (10 ต้องหลัง 2)
      rows.addAll(variants);
    }
    for (final c in present) { if (!rows.contains(c)) rows.add(c); } // safety: หมวดที่ไม่ตรงฐานใด
    if (rows.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: _fill, borderRadius: BorderRadius.circular(13), border: Border.all(color: _line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text('จำนวนรูปภาพ (${_photoPaths.length} / $kEmcsPhotoQuota)',
              style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: _ink)),
          if (_photoQuotaNote != null) ...[
            const SizedBox(width: 8),
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: _photoQuotaOver ? const Color(0xFFFEE2E2) : const Color(0xFFFEF3C7),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: Text(_photoQuotaNote!,
                    style: TextStyle(
                        fontSize: 10.5,
                        fontWeight: FontWeight.w700,
                        color: _photoQuotaOver ? const Color(0xFFB91C1C) : const Color(0xFF92400E))),
              ),
            ),
          ],
        ]),
        const SizedBox(height: 6),
        for (final c in rows)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 3.5),
            child: Row(children: [
              Expanded(child: Text(c, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: _ink))),
              const SizedBox(width: 8),
              Text('${_photoCountOf(c)} รูป', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: _primary)),
            ]),
          ),
      ]),
    );
  }

  // แถบเครื่องมือ: ปุ่มเลือกหลายรูป + แถบลบเมื่ออยู่โหมดเลือก
  Widget _imgToolbar() {
    final sel = _imgSel;
    return Column(children: [
      Row(children: [
        const Spacer(),
        TextButton.icon(
          onPressed: () => setState(() => _imgSel = sel == null ? <int>{} : null),
          icon: Icon(sel == null ? Icons.checklist_rtl : Icons.close, size: 18),
          label: Text(sel == null ? 'เลือก' : 'ยกเลิก', style: const TextStyle(fontWeight: FontWeight.w600)),
          style: TextButton.styleFrom(foregroundColor: _primary, padding: const EdgeInsets.symmetric(horizontal: 8)),
        ),
      ]),
      if (sel != null)
        Container(
          margin: const EdgeInsets.only(top: 4),
          padding: const EdgeInsets.fromLTRB(12, 4, 6, 4),
          decoration: BoxDecoration(color: _tint, borderRadius: BorderRadius.circular(11)),
          child: Row(children: [
            Text('เลือก ${sel.length} รูป', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: _ink)),
            const Spacer(),
            TextButton(onPressed: _imgSelectAllVisible, child: const Text('ทั้งหมด')),
            TextButton(
              onPressed: sel.isEmpty ? null : _imgDeleteSelected,
              child: Text('ลบ', style: TextStyle(color: sel.isEmpty ? _muted2 : Colors.red, fontWeight: FontWeight.w700)),
            ),
          ]),
        ),
    ]);
  }

  List<int> _visiblePhotoIndices() => [for (var i = 0; i < _photoPaths.length; i++) i];

  void _imgSelectAllVisible() => setState(() => _imgSel = {..._visiblePhotoIndices()});

  void _imgDeleteSelected() {
    final sel = _imgSel;
    if (sel == null || sel.isEmpty) return;
    _confirmDelete('${sel.length} รูปที่เลือก', () {
      final idx = sel.toList()..sort((a, b) => b.compareTo(a));
      final paths = <String>[];
      setState(() {
        for (final i in idx) {
          if (i >= 0 && i < _photoPaths.length) { paths.add(_photoPaths[i]); _photoCat.remove(_photoPaths[i]); _photoPaths.removeAt(i); }
        }
        _imgSel = null;
      });
      for (final p in paths) { _deletePhotoFile(p); }
    });
  }

  // ลบไฟล์รูปจริงออกจากเครื่อง (กันไฟล์ค้างสะสม)
  void _deletePhotoFile(String path) {
    try { final f = File(path); if (f.existsSync()) f.deleteSync(); } catch (_) {}
  }

  // cache mtime ต่อ path — เดิม statSync() ทุก tile ทุก rebuild (กริด shrinkWrap + แตะเลือก
  // = setState) ยิง disk stat N ครั้งต่อเฟรมบน UI thread; mtime ของไฟล์ไม่เปลี่ยนหลังถ่าย
  final Map<String, DateTime?> _photoStampCache = {};
  DateTime? _photoStamp(String path) {
    return _photoStampCache.putIfAbsent(path, () {
      try { return File(path).statSync().modified; } catch (_) { return null; }
    });
  }

  String _photoTimeLabel(String path) {
    final dt = _photoStamp(path);
    if (dt == null) return '';
    return '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  }

  void _confirmDeletePhoto(int index) => _confirmDelete('รูป', () {
        final path = _photoPaths[index];
        setState(() { _photoCat.remove(path); _photoPaths.removeAt(index); });
        _deletePhotoFile(path);
      });

  // เปลี่ยนหมวดของรูป + เปลี่ยนชื่อไฟล์ให้ตรง slug ใหม่ด้วย — คืน path ใหม่ (path เดิมถ้า rename ไม่สำเร็จ)
  Future<String> _applyPhotoCategory(String oldPath, String newCat) async {
    var newPath = oldPath;
    try {
      final f = File(oldPath);
      if (await f.exists()) {
        final dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
        newPath = '$dir/${_catSlugOf(newCat)}_${DateTime.now().millisecondsSinceEpoch}.jpg';
        await f.rename(newPath); // rename คงเวลาแก้ไขไฟล์ (mtime) → _photoStamp ยังถูก
      }
    } catch (_) { newPath = oldPath; } // ไฟล์หาย/สิทธิ์ไม่พอ → คงชื่อเดิม ยังใช้งานได้
    final i = _photoPaths.indexOf(oldPath);
    if (i >= 0) _photoPaths[i] = newPath;
    _photoCat.remove(oldPath);
    _photoCat[newPath] = newCat;
    return newPath;
  }

  // เปลี่ยนประเภทของรูป (แตะป้ายบนรูป) — ใช้ตัวเลือกประเภทเดียวกับตอนถ่าย
  Future<void> _changePhotoCat(int index) async {
    final path = _photoPaths[index];
    final chosen = await _pickImageCategory(current: _photoCat[path], title: 'เปลี่ยนประเภทรูป');
    if (chosen == null || !mounted || chosen == _photoCat[path]) return;
    await _applyPhotoCategory(path, chosen); // เปลี่ยนชื่อไฟล์ตามหมวดใหม่
    if (!mounted) return;
    setState(() {});
    _autosave();
  }

  // ชีทรายละเอียดรูป: พรีวิวใหญ่ + เปลี่ยนหมวด + เวลา + ลบ
  void _openPhotoSheet(int index) {
    var path = _photoPaths[index]; // mutable — เปลี่ยนได้เมื่อ rename ตอนเปลี่ยนหมวด
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (ctx) => StatefulBuilder(builder: (ctx, setSheet) {
        final cat = _photoCat[path] ?? _imgCatDefault;
        final dt = _photoStamp(path);
        final when = dt == null
            ? '-'
            : '${dt.day}/${dt.month}/${dt.year + 543} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')} น.';
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: _line, borderRadius: BorderRadius.circular(2)))),
              const SizedBox(height: 12),
              ClipRRect(borderRadius: BorderRadius.circular(14), child: Image.file(File(path), width: double.infinity, height: 220, fit: BoxFit.cover, cacheWidth: 1080)),
              const SizedBox(height: 14),
              const Text('ประเภทรูป', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: _ink)),
              const SizedBox(height: 8),
              GestureDetector(
                onTap: () async {
                  final picked = await _pickImageCategory(current: cat, title: 'เปลี่ยนประเภทรูป');
                  if (picked == null || picked == cat) return;
                  path = await _applyPhotoCategory(path, picked); // rename ไฟล์ + อัปเดต path ในชีท
                  if (mounted) setState(() {});
                  setSheet(() {});
                  _autosave();
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
                  decoration: BoxDecoration(color: _fill, borderRadius: BorderRadius.circular(11), border: Border.all(color: _lineStrong)),
                  child: Row(children: [
                    Expanded(child: Text(cat, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: _ink))),
                    const Icon(Icons.arrow_drop_down, size: 22, color: _muted),
                  ]),
                ),
              ),
              const SizedBox(height: 14),
              Row(children: [
                const Icon(Icons.schedule, size: 15, color: _muted2),
                const SizedBox(width: 6),
                Text('ถ่ายเมื่อ $when', style: const TextStyle(fontSize: 12, color: _muted)),
              ]),
              const SizedBox(height: 16),
              Row(children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () { Navigator.pop(ctx); _confirmDeletePhoto(index); },
                    icon: const Icon(Icons.delete_outline, size: 18),
                    label: const Text('ลบรูปนี้'),
                    style: OutlinedButton.styleFrom(foregroundColor: Colors.red, side: const BorderSide(color: Color(0xFFF0C0C0)), padding: const EdgeInsets.symmetric(vertical: 12)),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton(
                    onPressed: () => Navigator.pop(ctx),
                    style: FilledButton.styleFrom(backgroundColor: _primary, padding: const EdgeInsets.symmetric(vertical: 12)),
                    child: const Text('ปิด'),
                  ),
                ),
              ]),
            ]),
          ),
        );
      }),
    );
  }

  String get _draftKey => 'survey_draft_${widget.caseId}';

  /// คืน true ถ้ามี draft และ populate สำเร็จ
  Future<bool> _loadDraft() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final json = prefs.getString(_draftKey);
      if (json == null) return false;
      final data = jsonDecode(json) as Map<String, dynamic>;
      if (!mounted) return false; // ผู้ใช้ back ออกก่อนโหลดเสร็จ → กัน setState หลัง dispose
      _migrateLegacyPhotos(data); // ย้ายรูปจากโฟลเดอร์ระบบเก่า (ตามเลขเคลม) เข้าโฟลเดอร์ประจำเคส
      _populateForm(data, fromDraft: true);
      return true;
    } catch (e) {
      debugPrint('loadDraft failed: $e');
      // draft เสีย/ฟอร์แมตเก่า → ลบทิ้ง กันพัง (throw) ทุกครั้งที่เปิดฟอร์ม
      try { (await SharedPreferences.getInstance()).remove(_draftKey); } catch (_) {}
      return false;
    }
  }

  // ย้ายรูปจากโฟลเดอร์ระบบเก่า (ตั้งชื่อตามเลขเคลม/เลขเซอร์เวย์) เข้าโฟลเดอร์ประจำเคส case_<id>/job_<id>
  // แล้วแก้ path ใน draft ให้ชี้ที่ใหม่ — รันก่อน _populateForm เพื่อให้ตัวกรอง "ไฟล์ยังอยู่จริง" เห็น path ใหม่
  // (โฟลเดอร์เก่าที่หาไม่เจอไม่เป็นไร: path เดิมยังใช้ได้ และ uploadCaseFolder กวาด photo_paths_local ให้ด้วย)
  void _migrateLegacyPhotos(Map<String, dynamic> draft) {
    try {
      String san(String s) => s.replaceAll(RegExp(r'[/\\?%*:|"<>]'), '_');
      const root = '/storage/emulated/0/Download/SE_Survey';
      final canonical = Directory(_caseFolderPath);
      // โฟลเดอร์เก่าที่เป็นไปได้: จากเลขใน draft (+ controller เผื่อกรณีถูกเติมก่อนหน้า —
      // draft โหลดก่อน server แล้ว ดังนั้นปกติ controller ยังว่าง; โฟลเดอร์ตามเลขของ server
      // ที่หาไม่เจอถูกกวาดชั้นสองโดย uploadCaseFolder ผ่าน photo_paths_local อยู่แล้ว)
      final candidates = <String>{};
      void addCand(String? cn, String? sj) {
        final c = (cn ?? '').trim(), j = (sj ?? '').trim();
        candidates.add(
            '$root/${c.isNotEmpty ? san(c) : 'case_${widget.caseId}'}/${j.isNotEmpty ? san(j) : 'job_${widget.caseId}'}');
      }
      addCand(draft['claim_no']?.toString(), draft['survey_job_no']?.toString());
      addCand(_claimNoCtl.text, _surveyJobNoCtl.text);
      candidates.remove(canonical.path);

      for (final c in candidates) {
        final legacy = Directory(c);
        if (!legacy.existsSync()) continue;
        if (!canonical.existsSync()) canonical.createSync(recursive: true);
        for (final f in legacy.listSync().whereType<File>()) {
          final dest = File('${canonical.path}/${f.path.split('/').last}');
          try {
            if (!dest.existsSync()) f.renameSync(dest.path);
          } catch (_) {}
        }
        // เก็บกวาดโฟลเดอร์เก่าที่ว่างแล้ว (best-effort)
        try { if (legacy.listSync().isEmpty) legacy.deleteSync(); } catch (_) {}
        try {
          final p = legacy.parent;
          if (p.path != root && p.existsSync() && p.listSync().isEmpty) p.deleteSync();
        } catch (_) {}
      }
      // remap รันเสมอ (ไม่ gate ด้วย "รอบนี้ย้ายไหม"): ถ้าย้ายไฟล์รอบก่อนแล้วแอปถูก kill ก่อน
      // draft ถูกเขียนกลับ path ใน draft ยังเป็นของเก่า — remap ซ่อมให้ (self-guarding:
      // แก้เฉพาะ path ที่ไฟล์เดิมหาย + มีไฟล์ชื่อเดียวกันในโฟลเดอร์ประจำเคส)
      if (!canonical.existsSync()) return;

      // แก้ path ใน draft ให้ชี้โฟลเดอร์ประจำเคส (ที่เดิมหาย + ที่ใหม่มี)
      String remap(String p) {
        if (File(p).existsSync()) return p;
        final np = '${canonical.path}/${p.split('/').last}';
        return File(np).existsSync() ? np : p;
      }
      final pp = draft['photo_paths_local'];
      if (pp is List) draft['photo_paths_local'] = pp.map((e) => remap(e.toString())).toList();
      final pc = draft['photo_categories'];
      if (pc is Map) {
        draft['photo_categories'] = pc.map((k, v) => MapEntry(remap(k.toString()), v));
      }
      final sdp = draft['scan_doc_paths'];
      if (sdp is Map) {
        draft['scan_doc_paths'] = sdp.map((k, v) => MapEntry(k, remap(v.toString())));
      }
    } catch (_) {}
  }

  Map<String, dynamic> _collectFormData() {
    // '0' = sentinel "ยังไม่เลือกคำนำหน้า" → อย่าให้ติดไปเป็น prefix ของชื่อ (เดิมได้ '0 สมชาย ...')
    final titlePrefix = _driverTitle == '0' ? '' : _driverTitle;
    final driverFullName = '$titlePrefix ${_driverNameCtl.text.trim()} ${_driverLastnameCtl.text.trim()}'.trim();
    final data = <String, dynamic>{
      'survey_company': _surveyCompanyCtl.text.trim(),
      'survey_company_address': _surveyCompanyAddressCtl.text.trim(),
      'survey_company_phone': _surveyCompanyPhoneCtl.text.trim(),
      'claim_type': _claimType,
      'damage_level': _damageLevel,
      'car_lost': _carLost,
      'insurance_company': _insuranceCompanyCtl.text.trim(),
      'insurance_branch': _insuranceBranchCtl.text.trim(),
      'survey_job_no': _surveyJobNoCtl.text.trim(),
      'claim_ref_no': _claimRefNoCtl.text.trim(),
      'claim_no': _claimNoCtl.text.trim(),
      'prb_number': _prbNumberCtl.text.trim(),
      'policy_no': _policyNoCtl.text.trim(),
      'driver_by_policy': _driverByPolicyCtl.text.trim(),
      'policy_start': _policyStartCtl.text.trim(),
      'policy_end': _policyEndCtl.text.trim(),
      'assured_name': _assuredNameCtl.text.trim(),
      'policy_type': _policyTypeCtl.text.trim(),
      'assured_email': _assuredEmailCtl.text.trim(),
      'risk_code': _riskCodeCtl.text.trim(),
      'repair_shop': _repairShopCtl.text.trim(),
      'car_brand': _carBrandCtl.text.trim(),
      'car_model': _carModelCtl.text.trim(),
      'car_color': _carColorCtl.text.trim(),
      'car_type': _carType,
      'license_plate': _licensePlateCtl.text.trim(),
      'car_province': _carProvinceCtl.text.trim(),
      'chassis_no': _chassisNoCtl.text.trim(),
      'engine_no': _engineNoCtl.text.trim(),
      'car_reg_year': _carRegYearCtl.text.trim(),
      'ev_type': _evType.isNotEmpty ? _evType : null,
      'ev_battery_no': _evBatteryNoCtl.text.trim(),
      'ev_battery_start': _evBatteryStartCtl.text.trim(),
      'ev_charger_no': _evChargerNoCtl.text.trim(),
      'model_no': _modelNoCtl.text.trim(),
      'driver_gender': _driverGender,
      'driver_title': _driverTitle,
      'driver_name': driverFullName,
      // เก็บชื่อ/นามสกุลแยกด้วย (restore อ่านจาก 2 ตัวนี้ — ไม่งั้น draft round-trip แล้วหาย)
      'driver_first_name': _driverNameCtl.text.trim(),
      'driver_last_name': _driverLastnameCtl.text.trim(),
      'driver_birthdate': _driverBirthdateCtl.text.trim(),
      'driver_phone': _driverPhoneCtl.text.trim(),
      'driver_address': _driverAddressCtl.text.trim(),
      'driver_id_card': _driverIdCardCtl.text.trim(),
      'driver_id_type': _driverIdThai ? 'thai' : 'foreign',
      'driver_license_no': _driverLicenseNoCtl.text.trim(),
      'driver_license_type': _driverHasLicense ? _driverLicenseTypeCtl.text.trim() : 'ไม่มีใบขับขี่', // สวิตช์ปิด = เก็บ "ไม่มีใบขับขี่"
      'driver_license_place': _driverLicensePlaceCtl.text.trim(),
      'driver_license_start': _driverLicenseStartCtl.text.trim(),
      'driver_license_end': _driverLicenseEndCtl.text.trim(),
      'driver_relation': _driverRelationCtl.text.trim(),
      'driver_province': _driverProvinceCtl.text.trim(),
      'driver_district': _driverDistrictCtl.text.trim(),
      'damage_description': _damageDescCtl.text.trim(),
      // แผนภาพความเสียหายรถประกัน (structured) → JSONB คอลัมน์ insured_damage (ตัดแถวเปล่า)
      'insured_damage': _filledDamageItems(),
      // รูป + หมวดรูป — เก็บลง draft เพื่อ restore ตอนเปิดใหม่ (server strip คีย์ที่ไม่รู้จักทิ้งเอง)
      'photo_paths_local': _photoPaths,
      'photo_categories': _photoCat,
      'scan_doc_paths': _scanDocPaths, // path รูปสแกนบัตร/ใบขับขี่ล่าสุด (ไว้บันทึกทับข้ามครั้ง)
      // ข้อมูลหลายรายการ → JSONB
      'opposing_parties': _opponents,
      'injured_persons': _injured,
      'damaged_property': _property,
      // snapshot หน้าย่อยที่เปิดค้างหลังสแกน (draft-only — server strip ทิ้ง) → กู้ถ้าแอปถูก kill ก่อนกด "บันทึก"
      'pending_editor': _pendingEditor,
      // สถานะ toggle มี/ไม่มี (เก็บเอง เผื่อเปิด "มี" แต่ยังไม่มีรายการ — ถ่ายก่อนกรอกทีหลัง)
      'has_opponents': _hasOpponents,
      'has_injured': _hasInjured,
      'has_property': _hasProperty,
      'acc_date': _accDateCtl.text.trim(),
      'acc_time': _accTimeCtl.text.trim(),
      'acc_place': _accPlaceCtl.text.trim(),
      'acc_province': _accProvinceCtl.text.trim(),
      'acc_district': _accDistrictCtl.text.trim(),
      'survey_place': _survPlaceCtl.text.trim(),
      'survey_province': _survProvinceCtl.text.trim(),
      'survey_district': _survDistrictCtl.text.trim(),
      'acc_cause': _accCauseCtl.text.trim(),
      'acc_damage_type': _accDamageTypeCtl.text.trim(),
      'acc_detail': _accDetailCtl.text.trim(),
      'acc_fault': _accFault,
      'acc_reporter': _accReporterCtl.text.trim(),
      'acc_surveyor': _accSurveyorCtl.text.trim(),
      'acc_surveyor_branch': _accSurveyorBranchCtl.text.trim(),
      'acc_surveyor_phone': _accSurveyorPhoneCtl.text.trim(),
      'acc_customer_report_date': _combineDT(_accCustomerReportDateCtl, _accCustomerReportTimeCtl),
      'acc_insurance_notify_date': _combineDT(_accInsNotifyDateCtl, _accInsNotifyTimeCtl),
      'acc_survey_arrive_date': _combineDT(_accSurveyArriveDateCtl, _accSurveyArriveTimeCtl),
      'acc_survey_complete_date': _combineDT(_accSurveyCompleteDateCtl, _accSurveyCompleteTimeCtl),
      'acc_claim_opponent': _opoClaims.join(','),
      'driver_ticket': _driverTicketCtl.text.trim(),
      'acc_police_name': _accPoliceNameCtl.text.trim(),
      'acc_police_station': _accPoliceStationCtl.text.trim(),
      'acc_police_comment': _accPoliceCommentCtl.text.trim(),
      'acc_police_date': _combineDT(_accPoliceDateCtl, _accPoliceTimeCtl),
      'acc_police_book_no': _accPoliceBookNoCtl.text.trim(),
      'acc_alcohol_test': _accAlcoholTestCtl.text.trim(),
      'acc_alcohol_result': _accAlcoholResultCtl.text.trim(),
      'acc_followup': _accFollowup,
      'acc_followup_count': _accFollowupCountCtl.text.trim(),
      'acc_followup_detail': _accFollowupDetailCtl.text.trim(),
      'acc_followup_date': _combineDT(_accFollowupDateCtl, _accFollowupTimeCtl),
    };
    // ส่ง key ตัวเลข "เสมอ" (null เมื่อว่าง) — เดิม omit เมื่อว่าง ทำให้ล้างค่าไม่ได้ (ค่าเก่าฟื้นจาก draft/DB)
    // ตัด comma ก่อน parse กัน '12,345' → null เงียบ ๆ
    int? asInt(String t) { final s = t.trim().replaceAll(',', ''); return s.isEmpty ? null : int.tryParse(s); }
    double? asNum(String t) { final s = t.trim().replaceAll(',', ''); return s.isEmpty ? null : double.tryParse(s); }
    data['mileage'] = asInt(_mileageCtl.text);
    data['driver_age'] = asInt(_driverAgeCtl.text);
    data['estimated_cost'] = asNum(_estimatedCostCtl.text);
    data['deductible'] = asNum(_deductibleCtl.text);
    data['acc_claim_amount'] = asNum(_accClaimAmountCtl.text);
    data['acc_claim_total_amount'] = asNum(_accClaimTotalAmountCtl.text);
    // คู่กรณีคันที่ — ส่งเฉพาะตอนผลคดี = คู่กรณีผิด (ช่องถูกซ่อนกรณีอื่น ค่าค้างไม่ควรหลุดไป)
    // ⚠️ ช่องนี้เก็บเป็น "ข้อความ" (VARCHAR) ไม่ใช่ตัวเลข — เดิมส่ง double ไป
    // server ตีกลับ 400 ทุกครั้งที่ผลคดี = คู่กรณีผิด (เจอจริง 2026-08-07)
    final _oppNo = asInt(_accFaultOpponentNoCtl.text);
    data['acc_fault_opponent_no'] =
        _faultIs('คู่กรณีผิด') ? _oppNo?.toString() : null;
    return data;
  }

  Future<void> _submitSurvey() async {
    final data = _collectFormData();
    final caseProvider = context.read<CaseProvider>();
    final r = await caseProvider.submitSurveyOffline(widget.caseId, data, _photoPaths);
    if (!mounted) return;
    if (r == 'busy') return; // กันกดส่งซ้ำ (double-tap) — provider กำลังส่งอยู่
    if (r == 'ok') {
      _skipDraftFlush = true; // ตั้งก่อนลบ — กัน _autosave ที่ interleave ระหว่าง await เขียน draft คืนหลัง remove
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_draftKey);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('ส่งข้อมูลสำรวจสำเร็จ'), backgroundColor: Colors.green));
      context.go('/cases');
    } else if (r == 'queued') {
      // ไม่มีสัญญาณ — เก็บคิวไว้ ระบบจะส่งอัตโนมัติเมื่อมีเน็ต (draft ยังคงไว้จนส่งได้จริง)
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text('ไม่มีสัญญาณเน็ต — บันทึกไว้แล้ว ระบบจะส่งให้อัตโนมัติเมื่อกลับมาออนไลน์'),
        backgroundColor: Colors.orange,
        duration: Duration(seconds: 4),
      ));
      context.go('/cases');
    } else {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(caseProvider.error ?? 'เกิดข้อผิดพลาด'), backgroundColor: Colors.red));
    }
  }

  // ============================================================
  // UI (Claude design)
  // ============================================================
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _bg,
      appBar: _topbar(),
      bottomNavigationBar: Consumer<CaseProvider>(builder: (c, cp, _) => _savebar(cp)),
      body: Consumer<CaseProvider>(
        builder: (context, caseProvider, _) {
          return Stack(
            children: [
              Column(
                children: [
                  Expanded(child: _viewBody()),
                ],
              ),
              ..._overlays(caseProvider),
            ],
          );
        },
      ),
    );
  }

  // ── สลับ body ตามมุมมอง (hub / หมวด / แท็บ) ──
  Widget _viewBody() {
    switch (_view) {
      case _SView.hub:
        return _hubBody();
      case _SView.s1:
        return _sectionScroll(_card(0, Icons.verified_user_outlined, '1. เคลม & กรมธรรม์', _secClaimPolicy(), asset: 'assets/section_icons/s1.png'));
      case _SView.s2:
        return _sectionScroll(_card(2, Icons.directions_car_outlined, '2. รถประกัน', _secCar(), asset: 'assets/section_icons/s2.png'));
      case _SView.s3:
        return _sectionScroll(_card(3, Icons.person_outline, '3. ผู้ขับขี่รถประกัน', _secDriver(), asset: 'assets/section_icons/s3.png'));
      case _SView.s4:
        return _sectionScroll(_card(4, Icons.minor_crash_outlined, '4. ความเสียหาย', _secDamage(), asset: 'assets/section_icons/s4.png'));
      case _SView.s5:
        return _sectionScroll(_card(5, Icons.car_crash_outlined, '5. สถานที่เกิดเหตุ', _secEvent(), asset: 'assets/section_icons/s5.png'));
      case _SView.s6:
        return _opponentsBody();
      case _SView.photos:
        return _sectionScroll(_card(7, MyFlutterApp.camera, 'รูปภาพ', [
          _imgSubline(),
          _imgChecklist(),
          if (_photoPaths.isNotEmpty) _imgToolbar(),
          _buildPhotoGrid(),
        ]));
      case _SView.injured:
        return _injuredBody();
      case _SView.property:
        return _propertyBody();
      case _SView.expenses:
        return _soonBody(Icons.receipt_long_outlined, 'ค่าใช้จ่าย', 'อยู่นอกขอบเขตตอนนี้');
      case _SView.review:
        return _reviewBody();
    }
  }

  Widget _sectionScroll(Widget child) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(8, 12, 8, 24),
      child: Form(key: _formKey, child: child),
    );
  }

  Widget _soonBody(IconData icon, String title, String desc) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 64, height: 64, decoration: BoxDecoration(color: _tint, borderRadius: BorderRadius.circular(18)), child: Icon(icon, size: 30, color: _primary)),
          const SizedBox(height: 16),
          Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: _ink)),
          const SizedBox(height: 8),
          Text(desc, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13.5, color: _muted, height: 1.5)),
          const SizedBox(height: 20),
          OutlinedButton.icon(onPressed: () => _go(_SView.hub), icon: const Icon(Icons.arrow_back, size: 18), label: const Text('กลับ Hub'), style: OutlinedButton.styleFrom(foregroundColor: _primary, side: const BorderSide(color: _lineStrong))),
        ]),
      ),
    );
  }

  // ── overlays (submitting + card-image sheet) ──
  List<Widget> _overlays(CaseProvider caseProvider) {
    return [
      if (caseProvider.isSubmitting)
        Container(
          color: Colors.black26,
          child: const Center(child: Card(child: Padding(padding: EdgeInsets.all(32), child: Column(mainAxisSize: MainAxisSize.min, children: [CircularProgressIndicator(), SizedBox(height: 16), Text('กำลังส่งข้อมูล...')])))),
        ),
      if (_showImageSheet && _caseImages.isNotEmpty)
        DraggableScrollableSheet(
          initialChildSize: 0.4,
          minChildSize: 0.15,
          maxChildSize: 0.85,
          builder: (context, scrollController) {
            return Container(
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
                boxShadow: [BoxShadow(color: Colors.black.withValues(alpha: 0.3), blurRadius: 10, offset: const Offset(0, -2))],
              ),
              child: Column(
                children: [
                  Container(margin: const EdgeInsets.only(top: 8), width: 40, height: 4, decoration: BoxDecoration(color: Colors.grey.shade300, borderRadius: BorderRadius.circular(2))),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    child: Row(
                      children: [
                        const Icon(Icons.credit_card, color: _primary, size: 20),
                        const SizedBox(width: 8),
                        Text('หน้าการ์ด (${_caseImages.length})', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: _primary)),
                        const Spacer(),
                        IconButton(icon: const Icon(Icons.close, size: 20), onPressed: () => setState(() => _showImageSheet = false), padding: EdgeInsets.zero, constraints: const BoxConstraints()),
                      ],
                    ),
                  ),
                  const Divider(height: 1),
                  Expanded(
                    child: ListView.builder(
                      controller: scrollController,
                      padding: const EdgeInsets.all(12),
                      itemCount: _caseImages.length,
                      itemBuilder: (context, index) {
                        final filePath = _caseImages[index]['file_path']?.toString() ?? '';
                        final imageUrl = '${ApiConfig.baseUrl}/uploads/$filePath';
                        return Padding(
                          padding: const EdgeInsets.only(bottom: 12),
                          child: GestureDetector(
                            onTap: () => _showCardImage(index),
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(8),
                              child: Image.network(
                                imageUrl,
                                headers: AuthToken.imageHeaders,
                                width: double.infinity,
                                fit: BoxFit.fitWidth,
                                loadingBuilder: (context, child, progress) {
                                  if (progress == null) return child;
                                  return const SizedBox(height: 100, child: Center(child: CircularProgressIndicator()));
                                },
                                errorBuilder: (context, error, stackTrace) {
                                  return Container(height: 80, color: Colors.grey.shade200, child: const Center(child: Icon(Icons.broken_image, color: Colors.grey)));
                                },
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            );
          },
        ),
    ];
  }

  // ── Hub dashboard ──
  Widget _hubBody() {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(12, 14, 12, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _timelineStrip(),
          const SizedBox(height: 16),
          // คำเตือนเคลมคู่ — โชว์เมื่อเคสนี้พัวพันกับเคลมอื่นของอุบัติเหตุเดียวกัน
          _pairClaimWarning(),
          // ปุ่มถ่ายรูป (ไอคอนกล้องตรงกลาง) — ยกขึ้นบนสุด เข้าหน้ารูปภาพเหมือนเดิม (จำนวนรูปโชว์ด้านใน)
          _photoButton(),
          _hubCard(Icons.verified_user_outlined, '1. เคลม & กรมธรรม์', _s1Summary(), _SView.s1, _s1Filled(), asset: 'assets/section_icons/s1.png'),
          _hubCard(Icons.directions_car_outlined, '2. รถประกัน', _s2Summary(), _SView.s2, _s2Filled(), asset: 'assets/section_icons/s2.png'),
          _hubCard(Icons.person_outline, '3. ผู้ขับขี่', _s3Summary(), _SView.s3, _s3Filled(), asset: 'assets/section_icons/s3.png'),
          _hubCard(Icons.minor_crash_outlined, '4. ความเสียหาย', _s4Summary(), _SView.s4, _s4Filled(), asset: 'assets/section_icons/s4.png'),
          _hubCard(Icons.car_crash_outlined, '5. สถานที่เกิดเหตุ', _s5Summary(), _SView.s5, _s5Filled(), asset: 'assets/section_icons/s5.png'),
          // 6-8: หมวด optional มีสวิตช์ "มี/ไม่มี" (ค่าเริ่มต้น "ไม่มี")
          _hubToggleCard(Icons.groups_2_outlined, '6. คู่กรณี', _SView.s6, _hasOpponents, _opponents.length, _opponents, 'คู่กรณี',
              (v) => _hasOpponents = v, asset: 'assets/section_icons/s6.png'),
          _hubToggleCard(MyFlutterApp.procedures, '7. ผู้บาดเจ็บ', _SView.injured, _hasInjured, _injured.length, _injured, 'ผู้บาดเจ็บ',
              (v) => _hasInjured = v),
          _hubToggleCard(Icons.category, '8. ทรัพย์สิน', _SView.property, _hasProperty, _property.length, _property, 'ทรัพย์สิน',
              (v) => _hasProperty = v),
          _slipButton(),
          _finishButton(),
        ],
      ),
    );
  }

  // ── คำเตือนเคลมคู่ (อุบัติเหตุเดียวกัน คนละเคลม) — กันข้อมูลผู้บาดเจ็บ/ความเสียหายสองเคลมปนกัน ──
  // เงื่อนไขโชว์: คู่กรณีมีเลขเคลมของตัวเอง หรือ server เจอเคสอื่นในระบบที่พัวพันเลขเคลมกัน
  Widget _pairClaimWarning() {
    if (_pairWarnDismissed) return const SizedBox.shrink();
    final oppClaims = <String>{};
    for (final o in _opponents) {
      final c = (o['claim_no'] ?? '').toString().trim();
      if (c.isNotEmpty) oppClaims.add(c);
    }
    for (final lc in _linkedCases) {
      final c = (lc['claim_no'] ?? '').toString().trim();
      if (c.isNotEmpty) oppClaims.add(c);
    }
    if (oppClaims.isEmpty) return const SizedBox.shrink();
    final inSystem = _linkedCases.map((lc) => 'เคส #${lc['id']}').join(', ');
    final ourClaim = _claimNoCtl.text.trim();
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        color: _warnTint,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: _warn.withValues(alpha: .45)),
      ),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Icon(Icons.link, size: 20, color: _warn),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('เคลมคู่ — อุบัติเหตุเดียวกัน คนละเคลม',
                style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: _warn)),
            const SizedBox(height: 3),
            Text('เคลมของคู่กรณี: ${oppClaims.join(', ')}${inSystem.isNotEmpty ? ' · ในระบบ: $inSystem' : ''}',
                style: const TextStyle(fontSize: 12, color: _ink)),
            const SizedBox(height: 3),
            Text(
              'บันทึกเฉพาะข้อมูลมุมมองของเคลมนี้${ourClaim.isNotEmpty ? ' ($ourClaim)' : ''} — '
              'ผู้บาดเจ็บ/ความเสียหาย/ค่าซ่อมที่เบิกภายใต้เคลมคู่ ห้ามนำมาบันทึกซ้ำในเคลมนี้',
              style: const TextStyle(fontSize: 11.5, color: _muted),
            ),
          ]),
        ),
        // ปุ่มปิด — จำต่อเคส เปิดฟอร์มรอบหน้าไม่เด้งอีก
        InkWell(
          onTap: _dismissPairWarn,
          borderRadius: BorderRadius.circular(12),
          child: const Padding(
            padding: EdgeInsets.all(4),
            child: Icon(Icons.close, size: 18, color: _muted),
          ),
        ),
      ]),
    );
  }

  // ปุ่มถ่ายรูปบนสุด — ไอคอนกล้องอยู่กลาง (ไม่โชว์จำนวน) กดแล้วเข้าหน้ารูปภาพ
  Widget _photoButton() => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Material(
          color: _primary,
          borderRadius: BorderRadius.circular(18),
          child: InkWell(
            borderRadius: BorderRadius.circular(18),
            onTap: () => _go(_SView.photos),
            child: Container(
              height: 60,
              alignment: Alignment.center,
              decoration: BoxDecoration(borderRadius: BorderRadius.circular(18)),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(MyFlutterApp.camera, size: 26, color: Colors.white),
                  SizedBox(width: 10),
                  Text('ถ่ายรูป & ดูรูป', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Colors.white)),
                ],
              ),
            ),
          ),
        ),
      );

  // ไอคอนหมวด 4-6 เป็นรูปแนวกว้าง (เตี้ย) เต็มความกว้าง canvas อยู่แล้ว
  // เลยขยายเป็น asset ไม่ได้ ต้องเรนเดอร์กล่องใหญ่ขึ้นนิดหน่อยให้ดูสมส่วนกับ 1-3
  double _iconScale(String? asset) {
    if (asset == null) return 1;
    if (asset.endsWith('s6.png')) return 1.20;
    if (asset.endsWith('s4.png')) return 1.18;
    if (asset.endsWith('s5.png')) return 1.10;
    return 0.90; // s1/s2/s3 — ลดลงนิดหน่อยให้เข้าชุดกับหมวด 4-6
  }

  Widget _hubCard(IconData icon, String title, String summary, _SView target, bool started, {bool warn = false, String? asset}) {
    final missing = _sectionMissing(target);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: _cardBg,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: () => _go(target),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: _line),
              boxShadow: [BoxShadow(color: const Color(0xFF141E3C).withValues(alpha: 0.035), blurRadius: 20, offset: const Offset(0, 6))],
            ),
            child: Row(children: [
              Container(width: 40, height: 40, decoration: BoxDecoration(color: warn ? _warnTint : _tint, borderRadius: BorderRadius.circular(12)), child: asset != null ? Center(child: Image.asset(asset, width: 28 * _iconScale(asset), height: 28 * _iconScale(asset))) : Icon(icon, size: 21, color: warn ? _warn : _primary)),
              const SizedBox(width: 12),
              Expanded(child: Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: _ink))),
              const SizedBox(width: 8),
              _statusChipHub(missing, started),
              const Icon(Icons.chevron_right, color: _muted2),
            ]),
          ),
        ),
      ),
    );
  }

  // การ์ดหมวด optional (คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน): สวิตช์ "มี/ไม่มี"
  //  ไม่มี → แถวเทา ไม่กดเข้า; มี → กดเข้าหน้ากรอกได้ (โชว์จำนวน)
  Widget _hubToggleCard(IconData icon, String title, _SView target, bool on, int count,
      List<Map<String, dynamic>> list, String noun, void Function(bool) apply, {String? asset}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: _cardBg,
        borderRadius: BorderRadius.circular(18),
        child: InkWell(
          borderRadius: BorderRadius.circular(18),
          onTap: on ? () => _go(target) : null,
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: _line),
              boxShadow: [BoxShadow(color: const Color(0xFF141E3C).withValues(alpha: 0.035), blurRadius: 20, offset: const Offset(0, 6))],
            ),
            child: Row(children: [
              Container(width: 40, height: 40, decoration: BoxDecoration(color: _tint, borderRadius: BorderRadius.circular(12)), child: asset != null ? Center(child: Image.asset(asset, width: 28 * _iconScale(asset), height: 28 * _iconScale(asset))) : Icon(icon, size: 21, color: _primary)),
              const SizedBox(width: 12),
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: _ink)),
                const SizedBox(height: 2),
                Text(on ? (count > 0 ? '$count รายการ' : 'มี — แตะเพื่อกรอก') : 'ไม่มีในเคสนี้',
                    style: TextStyle(fontSize: 12, color: on ? _primary : _muted)),
              ])),
              const SizedBox(width: 6),
              Switch(
                value: on,
                onChanged: (v) => _toggleOptional(v, list, apply, noun),
                activeTrackColor: _primary,
              ),
              Icon(Icons.chevron_right, color: on ? _muted2 : _line),
            ]),
          ),
        ),
      ),
    );
  }

  // สลับ "มี/ไม่มี": เปิดได้เลย; ปิดขณะมีข้อมูล → ถามยืนยันลบทั้งหมดก่อน
  Future<void> _toggleOptional(bool v, List<Map<String, dynamic>> list, void Function(bool) apply, String noun) async {
    if (v || list.isEmpty) {
      setState(() => apply(v));
      _autosave();
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('ตั้งเป็น "ไม่มี"?'),
        content: Text('จะลบข้อมูล$noun ${list.length} รายการทั้งหมด'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('ยกเลิก')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('ลบทั้งหมด', style: TextStyle(color: Colors.red))),
        ],
      ),
    );
    if (ok == true && mounted) {
      setState(() {
        if (identical(list, _opponents)) {
          _demoteRecordPhotoTags('คันที่');
        } else if (identical(list, _injured)) {
          _demoteRecordPhotoTags('คนที่');
        } else if (identical(list, _property)) {
          _demoteRecordPhotoTags('ชิ้นที่');
        }
        list.clear();
        apply(false);
      });
      _autosave();
    }
  }

  // ป้ายสถานะรายหมวด: ขาด N (เหลือง) / ครบ (เขียว) / ว่าง (เทา)
  Widget _statusChipHub(List<String> missing, bool started) {
    final Color c, bg;
    final String label;
    if (missing.isNotEmpty) {
      c = _alert; bg = _alertTint; label = 'ขาด ${missing.length}';
    } else if (started) {
      c = _ok; bg = _okTint; label = 'ครบ';
    } else {
      c = _muted; bg = _fill; label = 'ว่าง';
    }
    return Container(
      margin: const EdgeInsets.only(right: 4),
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(missing.isNotEmpty ? Icons.error_outline : (started ? Icons.check_circle : Icons.circle), size: 11, color: c),
        const SizedBox(width: 5),
        Text(label, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: c)),
      ]),
    );
  }

  Widget _timelineStrip() {
    // node "ลูกค้าแจ้ง": ถ้าช่างยังไม่กรอกวัน/เวลาเอง ให้ fallback ไปโชว์ "เวลาแจ้งจริง"
    // จาก customer_reported_at (= _slaStart) — แสดงอย่างเดียว ไม่เขียนทับข้อมูลที่บันทึก
    String crDate = _accCustomerReportDateCtl.text.trim();
    String crTime = _accCustomerReportTimeCtl.text.trim();
    if ((crDate.isEmpty || crTime.isEmpty) && _slaStart != null) {
      final s = _slaStart!.toLocal(); // customer_reported_at เป็น UTC instant → แปลงเป็นเวลาเครื่อง (ไทย) ก่อนแสดง
      String two(int v) => v.toString().padLeft(2, '0');
      if (crDate.isEmpty) crDate = '${two(s.day)}/${two(s.month)}/${s.year + 543}';
      if (crTime.isEmpty) crTime = '${two(s.hour)}:${two(s.minute)}';
    }
    final nodes = <List<String>>[
      ['ลูกค้าแจ้ง', crDate, crTime],
      ['แจ้งเซอร์เวย์', _accInsNotifyDateCtl.text.trim(), _accInsNotifyTimeCtl.text.trim()],
      ['ถึงที่เกิดเหตุ', _accSurveyArriveDateCtl.text.trim(), _accSurveyArriveTimeCtl.text.trim()],
      ['สำรวจเสร็จ', _accSurveyCompleteDateCtl.text.trim(), _accSurveyCompleteTimeCtl.text.trim()],
    ];
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      decoration: BoxDecoration(color: _cardBg, borderRadius: BorderRadius.circular(18), border: Border.all(color: _line)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [Icon(Icons.timeline, size: 16, color: _primary), SizedBox(width: 6), Text('ไทม์ไลน์งาน', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: _ink))]),
        const SizedBox(height: 12),
        Row(children: [
          for (final n in nodes)
            Expanded(child: Column(children: [
              Container(
                width: 26, height: 26,
                decoration: BoxDecoration(color: n[1].isNotEmpty ? _ok : _fill, shape: BoxShape.circle, border: Border.all(color: n[1].isNotEmpty ? _ok : _lineStrong, width: 1.5)),
                child: Icon(n[1].isNotEmpty ? Icons.check : Icons.circle_outlined, size: 14, color: n[1].isNotEmpty ? Colors.white : _muted2),
              ),
              const SizedBox(height: 5),
              Text(n[0], textAlign: TextAlign.center, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: _ink)),
              Text(n[1].isNotEmpty ? n[1] : '—', textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 9.5, color: _muted)),
              if (n[2].isNotEmpty)
                Text(n[2], textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 9.5, color: _muted2)),
            ])),
        ]),
      ]),
    );
  }

  // ── สถานะ/สรุปรายหมวด (Hub) ──
  bool _s1Filled() => _claimType.isNotEmpty || _claimNoCtl.text.trim().isNotEmpty;
  bool _s2Filled() => _licensePlateCtl.text.trim().isNotEmpty || _carBrandCtl.text.trim().isNotEmpty;
  bool _s3Filled() => _driverNameCtl.text.trim().isNotEmpty;
  bool _s4Filled() => _filledDamageItems().isNotEmpty;
  bool _s5Filled() => _accDateCtl.text.trim().isNotEmpty;
  bool _s6Filled() => _opponents.isNotEmpty || _opoClaims.isNotEmpty;
  int _filledCount() {
    const views = [_SView.s1, _SView.s2, _SView.s3, _SView.s4, _SView.s5];
    final started = [_s1Filled(), _s2Filled(), _s3Filled(), _s4Filled(), _s5Filled()];
    var n = 0;
    for (var i = 0; i < views.length; i++) {
      if (_sectionMissing(views[i]).isEmpty && started[i]) n++;
    }
    return n;
  }

  String _s1Summary() {
    final ins = _insuranceCompanyCtl.text.trim();
    final cn = _claimNoCtl.text.trim();
    if (ins.isEmpty && cn.isEmpty && _claimType.isEmpty) return 'ยังไม่กรอกข้อมูลเคลม';
    return [if (ins.isNotEmpty) ins, if (cn.isNotEmpty) 'เคลม $cn'].join(' · ');
  }
  String _s2Summary() {
    final p = _licensePlateCtl.text.trim();
    final b = _carBrandCtl.text.trim();
    if (p.isEmpty && b.isEmpty) return 'ทะเบียน · ยี่ห้อ · รุ่น';
    return [if (p.isNotEmpty) p, if (b.isNotEmpty) b].join(' · ');
  }
  String _s3Summary() {
    final n = '${_driverNameCtl.text.trim()} ${_driverLastnameCtl.text.trim()}'.trim();
    return n.isNotEmpty ? n : 'สแกนบัตร / กรอกผู้ขับขี่';
  }
  String _s4Summary() => _filledDamageItems().isEmpty ? 'ยังไม่มีรายการความเสียหาย' : '${_filledDamageItems().length} รายการ';
  String _s5Summary() {
    final d = _accDateCtl.text.trim();
    final c = _accCauseCtl.text.trim();
    if (d.isEmpty && c.isEmpty) return 'วัน-เวลา · สถานที่ · สาเหตุ';
    return [if (d.isNotEmpty) d, if (c.isNotEmpty) c].join(' · ');
  }

  // ══ Validation (Phase 4) ══════════════════════════════════════════

  /// ผลคดีมีหลายสำเนียงใน DB — แอปเก็บค่าสั้น ('คู่กรณีผิด') แต่เว็บเคยเขียนป้ายเต็ม
  /// ('รถคู่กรณีเป็นฝ่ายผิด') ทับลงไป และของเก่ายังมี 'รถประกันฝ่ายผิด' ค้างอยู่จริง
  /// เทียบตรง ๆ แล้วเงื่อนไขบังคับจะเงียบหายไปทั้งชุด → normalize ก่อนเทียบเสมอ
  /// (เว็บแก้ให้ส่งค่าสั้นแล้วเช่นกัน อันนี้เป็นตาข่ายรับของเก่า)
  bool _faultIs(String canonical) {
    const alias = <String, List<String>>{
      'ฝ่ายผิด': ['รถประกันฝ่ายผิด', 'รถประกันเป็นฝ่ายผิด'],
      'คู่กรณีผิด': ['รถคู่กรณีเป็นฝ่ายผิด'],
      'ฝ่ายถูกและผิด': ['รถประกันเป็นฝ่ายถูกและผิด', 'ถูกและผิด'],
      'รอสรุปผลคดี': ['รอผลคดี'],
      'ไปถึงแล้วไม่พบ': ['ไปถึง แล้วไม่พบ'],
    };
    final v = _accFault.trim();
    return v == canonical || (alias[canonical]?.contains(v) ?? false);
  }

  // ตำรวจจำเป็นเมื่อ: ฝ่ายประมาท="รอสรุปผลคดี" เท่านั้น (มีผู้บาดเจ็บไม่บังคับ)
  bool _policeRequired() => _faultIs('รอสรุปผลคดี');

  /// "การเรียกร้องค่าเสียหายจากคู่กรณี" บังคับเมื่อไหร่ — **ผูกกับผลคดี 2 ค่าเท่านั้น**
  ///
  /// user 31/08/69 (เจอตอนเทสกรอกจริง): เลือก "รถประกันฝ่ายผิด" แล้วยังโดนบังคับ
  /// เพราะกรอกคู่กรณีไว้ → สั่งให้ผูกกับผลคดีอย่างเดียว
  ///
  /// ⛔ **กลับกติกา 22/08/69 ที่เคยบังคับ "มีคู่กรณี → ต้องติ๊กเสมอ" — อย่าใส่กลับ**
  ///    ของเดิมกว้างกว่าที่ EMCS บังคับจริง: บอทหยุดรอเฉพาะตอนผลคดี = คู่กรณีผิด
  ///    (rdoAcc_Cause01) เท่านั้น ค่าอื่นติ๊กหรือไม่ติ๊กก็บันทึกผ่าน
  ///    แลกมาด้วย: งานที่รถประกันผิดแล้วมีคู่กรณี จะไม่ถูกบังคับอีก หัวหน้าอาจต้องเติมเอง
  ///    ตอนตรวจ — user รับทราบและเลือกทางนี้
  bool _claimRequired() => _faultIs('คู่กรณีผิด') || _faultIs('ฝ่ายถูกและผิด');
  // คนไทย = ต้องผ่าน checksum 13 หลัก · ต่างชาติ = ขอแค่ไม่ว่าง (บัตรต่างด้าว/พาสปอร์ต
  // ไม่มีสูตรตรวจ) — user สรุป 2026-08-06
  bool _driverCidValid() {
    final t = _driverIdCardCtl.text.trim();
    if (t.isEmpty) return false;
    return _driverIdThai ? cidChecksum(t) : true;
  }

  // รายการ "ที่ยังขาด" ของแต่ละหมวด (label ที่ผู้ใช้อ่านเข้าใจ)
  List<String> _sectionMissing(_SView v) {
    List<String> miss(List<List<dynamic>> checks) => [for (final c in checks) if (!(c[1] as bool)) c[0] as String];
    bool has(TextEditingController c) => c.text.trim().isNotEmpty;
    switch (v) {
      case _SView.s1:
        // เลขรับแจ้ง/เลขเคลม/เลขเรื่องเซอร์เวย์ มาจากงานมอบหมาย + OCR ตอนรับแจ้ง → ไม่บังคับให้ช่างกรอก
        // บังคับเฉพาะช่องที่ช่างต้องกรอก/ยืนยัน (ตรงกับจุดแดงในหน้า)
        return miss([
          ['ประเภทเคลม', _claimType.isNotEmpty],
          ['ระดับความเสียหาย', _damageLevel.isNotEmpty],
          ['เลขกรมธรรม์', has(_policyNoCtl)],
          ['ประเภทประกัน', has(_policyTypeCtl)],
          ['ผู้เอาประกันภัย', has(_assuredNameCtl)],
          // EMCS บังคับเลข พ.ร.บ. **เมื่อติ๊ก "มี พ.ร.บ."** เท่านั้น (chkHas_Prb → txtPrb_Number)
          // ช่องนี้มีจุดแดงในหน้าอยู่แล้วตอนเปิดสวิตช์ แต่ไม่เคยมีใครตรวจ = จุดแดงลอย
          // และเลขว่าง → XML ตั้ง HAS_PRB จาก "มีเลขไหม" = ติ๊ก "มี พ.ร.บ." หายทั้งใบ
          ['เลข พ.ร.บ.', !_hasPrb || has(_prbNumberCtl)],
        ]);
      case _SView.s2:
        return miss([
          ['ทะเบียนรถ', has(_licensePlateCtl)],
          ['จังหวัด', has(_carProvinceCtl)],
          ['ประเภทรถ', _carType != '0'],
        ]);
      case _SView.s3:
        // ⚠️ ต้องตรงกับ "จุดแดง" บนหน้าจอ และตรงกับที่ EMCS บังคับจริง (vlidSurvey):
        // rdoGender / ddlDri_Title_ID / txtDri_Name01 / txtDri_LastName01 / txtDri_Age /
        // wuCale_Dri_BirthDay / txtDri_TelNo / txtDri_CardID / txtDri_DrvID / txtDri_Address /
        // ddlDri_ProvinceID / ddlDri_DistrictID
        // เดิมตรวจแค่ 4 ช่อง → ช่างเห็น "ครบ" ทั้งที่ที่อยู่/จังหวัดยังว่าง แล้วหัวหน้าไป
        // บันทึกบน EMCS ไม่ผ่าน (เจอสดตอนเทส 2026-08-01)
        final s3 = miss([
          ['เพศ', _driverGender.isNotEmpty],
          ['คำนำหน้า', _driverTitle != '0' && _driverTitle.isNotEmpty],
          ['ชื่อ-นามสกุลผู้ขับ', has(_driverNameCtl) && has(_driverLastnameCtl)],
          ['ความสัมพันธ์', has(_driverRelationCtl)],
          ['วันเกิด', has(_driverBirthdateCtl)],
          ['อายุ', has(_driverAgeCtl)],
          ['โทรศัพท์', has(_driverPhoneCtl)],
          ['เลขบัตรประชาชน (ถูกต้อง)', _driverCidValid()],
          ['ที่อยู่ปัจจุบัน', has(_driverAddressCtl)],
          ['จังหวัดผู้ขับขี่', has(_driverProvinceCtl)],
          ['เขต/อำเภอผู้ขับขี่', has(_driverDistrictCtl)],
        ]);
        // เลขใบขับขี่บังคับเฉพาะเมื่อ "มีใบขับขี่" (ปิดสวิตช์ = ไม่มี ไม่นับว่าขาด)
        if (_driverHasLicense) s3.addAll(miss([['เลขใบขับขี่', has(_driverLicenseNoCtl)]]));
        return s3;
      case _SView.s4:
        return miss([
          ['รายการความเสียหาย ≥1', _filledDamageItems().isNotEmpty],
        ]);
      case _SView.s5:
        final base = miss([
          // EMCS บังคับทั้ง "วันที่" และ "ชั่วโมง/นาที" (txtAcc_Date_Hour / txtAcc_Date_Minute)
          // เดิมตรวจแค่วันที่ → ส่งงานโดยไม่กรอกเวลาได้ แล้วบอทไปตกที่ btnUpdate ของ EMCS
          ['วัน-เวลาเกิดเหตุ', has(_accDateCtl) && has(_accTimeCtl)],
          ['สถานที่เกิดเหตุ', has(_accPlaceCtl)],
          // จังหวัด/เขต-อำเภอ/ลักษณะความเสียหาย = * บังคับฝั่ง EMCS เหมือนกัน
          ['จังหวัดที่เกิดเหตุ', has(_accProvinceCtl)],
          ['เขต/อำเภอที่เกิดเหตุ', has(_accDistrictCtl)],
          // สถานที่ออกตรวจสอบ บังคับทั้ง 3 ช่อง — เว็บใช้คิดเรทค่าบริการ (10/09/69)
          ['สถานที่ออกตรวจสอบ', has(_survPlaceCtl)],
          ['จังหวัดที่ตรวจสอบ', has(_survProvinceCtl)],
          ['เขต/อำเภอที่ตรวจสอบ', has(_survDistrictCtl)],
          ['ลักษณะการเกิดเหตุ', has(_accCauseCtl)],
          ['ลักษณะความเสียหาย', has(_accDamageTypeCtl)],
          // EMCS บังคับ rdoAcc_Cause0 — เดิมไม่ได้ตรวจ ส่งไปทั้งที่ยัง '-- ระบุ --' ได้
          ['ฝ่ายประมาท', _accFault.isNotEmpty],
          ['รายละเอียดการเกิดเหตุ', has(_accDetailCtl)],
          ['ผู้สำรวจภัย', has(_accSurveyorCtl)],
          ['โทรศัพท์สำรวจ', has(_accSurveyorPhoneCtl)],
        ]);
        // มีคู่กรณี → EMCS บังคับติ๊ก "การเรียกร้องค่าเสียหายจากคู่กรณี" อย่างน้อย 1 ข้อ
        // **ไม่ผูกกับผลคดี** (chkOpo_Result ของ EMCS แยกจาก rdoAcc_Cause) — เดิมบังคับเฉพาะ
        // ตอนคู่กรณีผิด งานที่รถประกันผิดจึงหลุดไปโดยไม่มีค่านี้ แล้วหัวหน้าต้องมาเติมเอง
        // ทุกใบตอนตรวจ (เจอจริง 22/08/69 ตอนเทสกรอกจริงบนมือถือทั้ง 2 บริษัท)
        if (_claimRequired()) {
          base.addAll(miss([
            ['การเรียกร้องค่าเสียหายจากคู่กรณี', _opoClaims.isNotEmpty],
          ]));
        }
        // ผลคดี = คู่กรณีผิด → EMCS บังคับ "คู่กรณีคันที่" เพิ่มอีกช่อง
        if (_faultIs('คู่กรณีผิด')) {
          base.addAll(miss([
            ['คู่กรณีคันที่', has(_accFaultOpponentNoCtl)],
          ]));
          // เลขคันต้องมีคันนั้นอยู่จริงในหมวด 6 — ลบคู่กรณีทิ้งแล้วเลขค้าง = ชี้ไปคันที่ไม่มี
          // (ค่านี้ไหลเข้าช่อง 'คู่กรณีคันที่' ของระบบประกันตรง ๆ ไม่มีใครดักให้)
          final n = int.tryParse(_accFaultOpponentNoCtl.text.trim());
          if (n != null && (n < 1 || n > _opponents.length)) {
            base.add('คู่กรณีคันที่ = $n แต่ในหมวด 6 มี ${_opponents.length} คัน');
          }
        }
        // บังคับช่องตำรวจเมื่อ "รอสรุปผลคดี" หรือเปิดสวิตช์ "มีการแจ้งความ" (ช่องขึ้น req: true อยู่แล้ว
        // — เดิม gate เช็คเฉพาะ รอสรุปผลคดี ทำให้เปิดสวิตช์แล้วเว้นว่างได้ ทั้งที่จุดแดงบอกว่าต้องกรอก)
        if (_policeRequired() || _hasPolice) {
          base.addAll(miss([
            ['ชื่อพนักงานสอบสวน', has(_accPoliceNameCtl)],
            ['สถานีตำรวจ', has(_accPoliceStationCtl)],
          ]));
        }
        return base;
      case _SView.s6:
        return const []; // คู่กรณีไม่บังคับ
      default:
        return const [];
    }
  }

  // รวม error ทุกหมวด (สำหรับ gate ตอนส่ง) — key = ชื่อหมวด
  // รายการว่าง (เพิ่มคันไว้แต่ยังไม่กรอก) — นับ false/ลิสต์ว่าง/แผนที่ว่างเป็นค่าว่างด้วย
  // (เผื่อ editor ใส่ field โครงสร้างมาเสมอ เช่น kfk:false, damage:[] ) เพื่อไม่ให้รายการเปล่าหลุดการเตือน
  static bool _emptyRec(Map<String, dynamic> m) => m.values.every((v) =>
      v == null || v == false || (v is String && v.trim().isEmpty) || (v is Iterable && v.isEmpty) || (v is Map && v.isEmpty));

  Map<String, List<String>> _collectErrors() {
    final e = <String, List<String>>{};
    const titles = {
      _SView.s1: '1. เคลม & กรมธรรม์', _SView.s2: '2. รถประกัน', _SView.s3: '3. ผู้ขับขี่',
      _SView.s4: '4. ความเสียหาย', _SView.s5: '5. สถานที่เกิดเหตุ',
    };
    for (final entry in titles.entries) {
      final m = _sectionMissing(entry.key);
      if (m.isNotEmpty) e[entry.value] = m;
    }
    // หมวด optional เปิด "มี" แต่ยังไม่ได้กรอก (เช่น เพิ่มคันคู่กรณีไว้แต่ลืมกรอก) → แจ้งเตือนดักตอนส่ง
    void checkOpt(String title, bool has, List<Map<String, dynamic>> items, String noun) {
      if (!has) return;
      if (items.isEmpty) { e[title] = ['เปิด "มี" แต่ยังไม่ได้เพิ่ม$noun']; return; }
      final n = items.where(_emptyRec).length;
      if (n > 0) e[title] = ['$noun $n รายการยังไม่ได้กรอก'];
    }
    checkOpt('6. คู่กรณี', _hasOpponents, _opponents, 'คู่กรณี');
    checkOpt('7. ผู้บาดเจ็บ', _hasInjured, _injured, 'ผู้บาดเจ็บ');
    checkOpt('8. ทรัพย์สิน', _hasProperty, _property, 'ทรัพย์สิน');

    // ── ช่องบังคับ "รายคน/รายชิ้น" ของหมวด 7-8 ────────────────────────────────
    // _emptyRec ข้างบนจับได้แค่ "รายการที่ว่างทั้งก้อน" — กรอกแค่ชื่อคนเดียวก็ผ่าน gate
    // แต่ EMCS บังคับหลายช่องต่อคน/ต่อชิ้น (vlidInjPerson / vlidAsset) ไม่ครบ =
    // กดบันทึกบล็อกนั้นบน EMCS ไม่ผ่าน "ทั้งบล็อก" และช่องที่ว่างจะกลายเป็น '-'
    // ให้หัวหน้าไล่แก้ทีละช่อง — จึงต้องดักตั้งแต่ตอนส่งงาน (เหมือนหมวด 1-5)
    /// [alsoMissing] = ช่องที่บังคับ**แบบมีเงื่อนไข** (ดูค่าอื่นในระเบียนเดียวกันถึงจะรู้)
    /// คืนชื่อช่องที่ยังขาดของระเบียนนั้น
    void checkItems(String title, bool has, List<Map<String, dynamic>> items,
        String noun, Map<String, String> requiredKeys,
        {String unit = 'คนที่/ชิ้นที่',
         List<String> Function(Map<String, dynamic>)? alsoMissing}) {
      if (!has || items.isEmpty) return;
      final msgs = <String>[];
      for (var i = 0; i < items.length; i++) {
        final it = items[i];
        if (_emptyRec(it)) continue;   // แจ้งไปแล้วโดย checkOpt
        final miss = requiredKeys.entries
            .where((kv) => (it[kv.key] ?? '').toString().trim().isEmpty)
            .map((kv) => kv.value)
            .toList()
          ..addAll(alsoMissing?.call(it) ?? const []);
        if (miss.isNotEmpty) msgs.add('$noun $unit ${i + 1}: ขาด ${miss.join(", ")}');
      }
      if (msgs.isNotEmpty) (e[title] ??= <String>[]).addAll(msgs);
    }

    // หมวด 6 เป็นหมวดเดียวที่ไม่เคยตรวจรายคัน — ปล่อยว่างได้ 4 ช่องที่ EMCS บล็อก
    // (เพศ · วันเกิด · อายุ · มีประกันภัยที่ ล้วนเป็นตัวเลือก/วันที่/ตัวเลข ใส่ "-" แทนไม่ได้)
    // เจอจริง 2026-08-10 เคลม 21BR10AVD-6908-000097 — บอทค้างกลางทางที่หน้าคู่กรณี
    // ⚠️ ลิสต์นี้ต้องตรงกับ `vlidOpoCar` ของ EMCS (สกัดจากหน้าจริงเคส 000098 · ส่วน base
    //    ก่อน switch = บังคับทุกบริษัท) และตรงกับ OPPONENT_REQUIRED ในเว็บ (RecordEditors.tsx)
    //    เดิมขาด `owner_name` → บอทต้องยัด '-' แทน สำนวนคู่กรณีของบริษัทประกันเลยได้
    //    ชื่อเจ้าของรถเป็น "-" ทุกใบ
    //    (policy_no/claim_no EMCS ก็บังคับ แต่ **ไม่เอามาบังคับที่นี่** เพราะคู่กรณีไม่มีประกัน
    //     มีจริง — ปล่อยให้บอทใส่ '-' ตามกติกา _dash ต่อไป)
    checkItems('6. คู่กรณี', _hasOpponents, _opponents, 'คู่กรณี', const {
      'car_type': 'ประเภทรถ', 'plate': 'ทะเบียน', 'province': 'จังหวัด',
      'owner_name': 'เจ้าของรถ',
      'gender': 'เพศผู้ขับขี่', 'birthdate': 'วันเกิด', 'age': 'อายุ',
      'insurer': 'มีประกันภัยที่',
    }, unit: 'คันที่');
    checkItems('7. ผู้บาดเจ็บ', _hasInjured, _injured, 'ผู้บาดเจ็บ', const {
      'person_type': 'ประเภทผู้บาดเจ็บ', 'gender': 'เพศ', 'name': 'ชื่อ-นามสกุล',
      'cid': 'เลขบัตรประชาชน', 'hospital': 'โรงพยาบาล', 'symptom': 'อาการบาดเจ็บ',
    },
      // EMCS (vlidInjPerson) บังคับเลขทะเบียนทุกประเภท **ยกเว้น 'บุคคลภายนอกรถ'** (คนนอกรถไม่มีรถ)
      // เดิมตรวจแค่ในปุ่ม "บันทึกคนนี้" ของ editor → ระเบียนที่มาจาก draft/นำเข้า XML หลุดด่านนี้
      alsoMissing: (it) {
        final pt = (it['person_type'] ?? '').toString().trim();
        final reg = (it['car_reg'] ?? '').toString().trim();
        return (pt.isNotEmpty && pt != 'บุคคลภายนอกรถ' && reg.isEmpty)
            ? const ['เลขทะเบียนรถ'] : const <String>[];
      });
    checkItems('8. ทรัพย์สิน', _hasProperty, _property, 'ทรัพย์สิน', const {
      'item': 'รายการทรัพย์สิน', 'cause': 'สาเหตุที่เสียหาย',
      'detail': 'รายละเอียดความเสียหาย', 'owner_name': 'ชื่อเจ้าของ',
    });

    // เพดานของ EMCS: ผู้บาดเจ็บ 32 คน / ทรัพย์สิน 30 ชิ้น — ส่วนเกินหายเงียบตอน import
    if (_injured.length > 32) {
      (e['7. ผู้บาดเจ็บ'] ??= <String>[])
          .add('เกิน 32 คน (${_injured.length}) — EMCS รับได้สูงสุด 32 ส่วนเกินจะไม่ถูกนำเข้า');
    }
    if (_property.length > 30) {
      (e['8. ทรัพย์สิน'] ??= <String>[])
          .add('เกิน 30 ชิ้น (${_property.length}) — EMCS รับได้สูงสุด 30 ส่วนเกินจะไม่ถูกนำเข้า');
    }
    return e;
  }

  // สรุปข้อความ + สถานะเตือน ของหมวด optional สำหรับหน้าตรวจสอบ
  String _optText(bool has, List<Map<String, dynamic>> items, String noun) {
    if (!has) return 'ไม่มี';
    if (items.isEmpty) return 'ยังไม่ได้เพิ่ม';
    final n = items.where(_emptyRec).length;
    return n > 0 ? '${items.length} $noun · $n ยังไม่ครบ' : '${items.length} $noun';
  }

  bool _optBad(bool has, List<Map<String, dynamic>> items) => has && (items.isEmpty || items.any(_emptyRec));

  // ── หน้าตรวจสอบ & ส่ง ──
  Widget _reviewBody() {
    const sections = <List<dynamic>>[
      ['1. เคลม & กรมธรรม์', _SView.s1, Icons.verified_user_outlined],
      ['2. รถประกัน', _SView.s2, Icons.directions_car_outlined],
      ['3. ผู้ขับขี่', _SView.s3, Icons.person_outline],
      ['4. ความเสียหาย', _SView.s4, Icons.minor_crash_outlined],
      ['5. สถานที่เกิดเหตุ', _SView.s5, Icons.car_crash_outlined],
    ];
    final errors = _collectErrors();
    final total = errors.values.fold<int>(0, (a, b) => a + b.length);
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(12, 14, 12, 24),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(color: total == 0 ? _okTint : _alertTint, borderRadius: BorderRadius.circular(16)),
          child: Row(children: [
            Icon(total == 0 ? Icons.check_circle : Icons.warning_amber_rounded, color: total == 0 ? _ok : _alert),
            const SizedBox(width: 10),
            Expanded(child: Text(
              total == 0 ? 'ข้อมูลครบ พร้อมส่งรายงาน' : 'ยังขาด $total รายการ — แตะหมวดเพื่อไปแก้ (ส่งได้แต่ควรกรอกให้ครบ)',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: total == 0 ? _ok : _alert, height: 1.4),
            )),
          ]),
        ),
        const SizedBox(height: 14),
        for (final s in sections) _reviewRow(s[0] as String, s[1] as _SView, s[2] as IconData),
        const SizedBox(height: 6),
        _reviewMini('6. คู่กรณี', _optText(_hasOpponents, _opponents, 'คัน'), Icons.groups_2_outlined, () => _go(_SView.s6), alert: _optBad(_hasOpponents, _opponents)),
        _reviewMini('7. ผู้บาดเจ็บ', _optText(_hasInjured, _injured, 'คน'), MyFlutterApp.procedures, () => _go(_SView.injured), alert: _optBad(_hasInjured, _injured)),
        _reviewMini('8. ทรัพย์สิน', _optText(_hasProperty, _property, 'ชิ้น'), Icons.category, () => _go(_SView.property), alert: _optBad(_hasProperty, _property)),
        _reviewMini('รูปภาพ', '${_photoPaths.length} รูป', MyFlutterApp.camera, () => _go(_SView.photos)),
        const SizedBox(height: 10),
        const Text('กด "ส่งรายงาน" ด้านล่างเพื่อส่งเข้าระบบ', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: _muted)),
      ]),
    );
  }

  Widget _reviewRow(String title, _SView v, IconData icon) {
    final started = {
      _SView.s1: _s1Filled(), _SView.s2: _s2Filled(), _SView.s3: _s3Filled(),
      _SView.s4: _s4Filled(), _SView.s5: _s5Filled(), _SView.s6: _s6Filled(),
    }[v]!;
    final missing = _sectionMissing(v);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: _cardBg,
        borderRadius: BorderRadius.circular(15),
        child: InkWell(
          borderRadius: BorderRadius.circular(15),
          onTap: () => _go(v),
          child: Container(
            padding: const EdgeInsets.all(13),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(15), border: Border.all(color: _line)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Icon(icon, size: 18, color: _primary),
                const SizedBox(width: 9),
                Expanded(child: Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: _ink))),
                _statusChipHub(missing, started),
              ]),
              if (missing.isNotEmpty) ...[
                const SizedBox(height: 7),
                Text('ขาด: ${missing.join(", ")}', style: const TextStyle(fontSize: 11.5, color: _alert, height: 1.35)),
              ],
            ]),
          ),
        ),
      ),
    );
  }

  Widget _reviewMini(String title, String value, IconData icon, VoidCallback onTap, {bool alert = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
          decoration: BoxDecoration(color: alert ? _alertTint : _cardBg, borderRadius: BorderRadius.circular(13), border: Border.all(color: alert ? _alert.withValues(alpha: 0.4) : _line)),
          child: Row(children: [
            Icon(icon, size: 17, color: alert ? _alert : _muted),
            const SizedBox(width: 9),
            Expanded(child: Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: _ink))),
            Text(value, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: alert ? _alert : _muted)),
            const Icon(Icons.chevron_right, size: 18, color: _muted2),
          ]),
        ),
      ),
    );
  }

  // ตรวจก่อนส่ง: ถ้าขาด → เปิด error sheet; ครบ → ส่งเลย
  void _submitWithGate() {
    final errors = _collectErrors();
    if (errors.isEmpty) { _submitSurvey(); return; }
    _showErrorSheet(errors);
  }

  void _showErrorSheet(Map<String, List<String>> errors) {
    final total = errors.values.fold<int>(0, (a, b) => a + b.length);
    const titleToView = {
      '1. เคลม & กรมธรรม์': _SView.s1, '2. รถประกัน': _SView.s2, '3. ผู้ขับขี่': _SView.s3,
      '4. ความเสียหาย': _SView.s4, '5. สถานที่เกิดเหตุ': _SView.s5,
      '6. คู่กรณี': _SView.s6, '7. ผู้บาดเจ็บ': _SView.injured, '8. ทรัพย์สิน': _SView.property,
    };
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.3,
        maxChildSize: 0.9,
        expand: false,
        builder: (ctx, scroll) => Column(children: [
          const SizedBox(height: 8),
          Container(width: 40, height: 4, decoration: BoxDecoration(color: _lineStrong, borderRadius: BorderRadius.circular(2))),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: Row(children: [
              const Icon(Icons.warning_amber_rounded, color: _alert),
              const SizedBox(width: 8),
              Expanded(child: Text('พบ $total รายการที่ยังไม่ครบ', style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, color: _ink))),
            ]),
          ),
          Expanded(
            child: ListView(
              controller: scroll,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              children: [
                for (final entry in errors.entries) ...[
                  GestureDetector(
                    onTap: () { Navigator.pop(ctx); final v = titleToView[entry.key]; if (v != null) _go(v); },
                    child: Container(
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(color: _alertTint, borderRadius: BorderRadius.circular(12)),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text(entry.key, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: _alert))),
                          const Icon(Icons.arrow_forward, size: 16, color: _alert),
                        ]),
                        const SizedBox(height: 4),
                        Text('• ${entry.value.join("\n• ")}', style: const TextStyle(fontSize: 12, color: _alert, height: 1.5)),
                      ]),
                    ),
                  ),
                ],
              ],
            ),
          ),
          Padding(
            padding: EdgeInsets.fromLTRB(16, 4, 16, 12 + MediaQuery.of(ctx).padding.bottom),
            child: Row(children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(ctx),
                  style: OutlinedButton.styleFrom(foregroundColor: _primary, side: const BorderSide(color: _lineStrong), padding: const EdgeInsets.symmetric(vertical: 13), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13))),
                  child: const Text('กลับไปแก้', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: ElevatedButton(
                  onPressed: () { Navigator.pop(ctx); _submitSurvey(); },
                  style: ElevatedButton.styleFrom(backgroundColor: _alert, foregroundColor: Colors.white, elevation: 0, padding: const EdgeInsets.symmetric(vertical: 13), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13))),
                  child: const Text('ส่งทั้งที่ยังไม่ครบ', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                ),
              ),
            ]),
          ),
        ]),
      ),
    );
  }

  // ── เนื้อหารายหมวด (reuse ฟิลด์เดิมทั้งหมด) ──
  List<Widget> _secClaimPolicy() => [
        _insurerLockField(),
        _fieldLabel('ประเภทเคลม', req: true),
        _claimTypeChips(),
        _fieldLabel('ระดับความเสียหาย', req: true),
        Row(children: [
          _chip('หนัก', _damageLevel == 'หนัก', () => setState(() => _damageLevel = 'หนัก'), grow: true),
          const SizedBox(width: 10),
          _chip('เบา', _damageLevel == 'เบา', () => setState(() => _damageLevel = 'เบา'), grow: true),
        ]),
        _txt(_claimRefNoCtl, 'เลขที่รับแจ้ง'),
        _txt(_claimNoCtl, 'เลขที่เคลม', onChanged: (_) => setState(() {})),
        _txt(_surveyJobNoCtl, 'เลขเรื่องเซอร์เวย์'),
        _subhead('กรมธรรม์'),
        _txt(_policyNoCtl, 'เลขกรมธรรม์', req: true),
        _switchRow('มี พรบ.', _hasPrb, (v) => setState(() { _hasPrb = v; if (!v) _prbNumberCtl.clear(); })),
        if (_hasPrb) _txt(_prbNumberCtl, 'เลข พรบ.', req: true),
        _row2(_dateField(_policyStartCtl, 'วันเริ่มคุ้มครอง', yearsAhead: 1), _dateField(_policyEndCtl, 'วันสิ้นสุด', yearsAhead: 6)),
        _txt(_assuredNameCtl, 'ผู้เอาประกันภัย', req: true),
        _txt(_driverByPolicyCtl, 'ชื่อผู้ขับขี่ตามกรมธรรม์'),
        _row2(_policyTypeField(), _txt(_riskCodeCtl, 'รหัสภัยยานยนต์')),
        _txt(_assuredEmailCtl, 'อีเมลผู้เอาประกัน', keyboardType: TextInputType.emailAddress),
        _numField(_deductibleCtl, 'ค่าเสียหายส่วนแรก', decimal: true),
        // จำกัด 200 ตัวให้ตรงกับ VARCHAR(200) ในฐานข้อมูล — ช่องนี้คนมักวางชื่ออู่พ่วงที่อยู่ยาว ๆ
        // ยาวเกินแล้ว Postgres ไม่ได้ตัดปลายให้ แต่โยน error จน **ส่งงานทั้งใบไม่ผ่าน**
        _txt(_repairShopCtl, 'ซ่อมที่',
            formatters: [LengthLimitingTextInputFormatter(200)]),
      ];

  // ประเภทประกัน = dropdown ชุดเดียวกับ ISURVEY (30/08/69) — เดิมเป็นช่องพิมพ์อิสระ
  // เพราะของจริงมีนอกลิสต์ ("ประเภท 2+ ซ่อมอู่") แต่พิมพ์เองทำให้แต่ละคนเขียนคนละแบบ
  // ('ชั้น 1' / 'ประเภท 1' / '52' / '2EXTRA' อยู่ในฐานข้อมูลจริงทั้งหมด) แล้วแปลงเป็น
  // รหัสส่ง EMCS ไม่ได้ → ตกเป็นข้อความดิบเงียบ ๆ
  // ⚠️ ค่าเก่าที่ไม่อยู่ในลิสต์ต้องยังโชว์ได้ ไม่งั้นเปิดเคสเก่ามาช่องจะว่างแล้วหายตอนบันทึก
  Widget _policyTypeField() => _dd(
      'ประเภทประกัน', _policyTypeCtl.text,
      _withCurrent(kPolicyTypes, _policyTypeCtl.text),
      (v) => setState(() => _policyTypeCtl.text = v ?? ''),
      req: true);

  /// คงค่าเดิมที่ไม่อยู่ในลิสต์ไว้เป็นตัวเลือกด้วย (เคสเก่า/ค่าที่นำเข้าจากระบบอื่น)
  List<String> _withCurrent(List<String> items, String current) {
    final c = current.trim();
    return (c.isEmpty || items.contains(c)) ? items : [...items, c];
  }

  List<Widget> _secCar() => [
        _row2(
          _txt(_licensePlateCtl, 'ทะเบียน', req: true),
          _dd('จังหวัด', _carProvinceCtl.text, _provinceNames,
              (v) => setState(() => _carProvinceCtl.text = v ?? ''),
              hint: 'เลือกจังหวัด', req: true, key: ValueKey('cp_${_carProvinceCtl.text}')),
        ),
        _carTypeField(),
        _row2(_carBrandField(), _txt(_carModelCtl, 'รุ่น')),
        _row2(_carColorField(), _txt(_carRegYearCtl, 'ปีจดทะเบียน (พ.ศ.)')),
        _evTypeField(),
        if (_evType.isNotEmpty) ...[
          _row2(_txt(_evBatteryNoCtl, 'หมายเลขแบตเตอรี่'), _txt(_evChargerNoCtl, 'หมายเลขเครื่องชาร์จ')),
          _dateField(_evBatteryStartCtl, 'วันเริ่มใช้งานแบตเตอรี่', yearsAhead: 0),
        ],
        _txt(_chassisNoCtl, 'หมายเลขตัวถัง (VIN)'),
        _row2(_txt(_engineNoCtl, 'หมายเลขเครื่อง'), _txt(_modelNoCtl, 'หมายเลข Model')),
        _numField(_mileageCtl, 'หมายเลข กม.'),
      ];

  // ประเภทรถ = dropdown (ตัวเลือก + ค่าตาม ddlCType จริง)
  Widget _carTypeField() {
    const labels = {'0': '-- ระบุ --', ...kCarTypeCodeToLabel};   // master ที่เดียว
    return DropdownButtonFormField<String>(
      initialValue: labels.containsKey(_carType) ? _carType : '0',
      isExpanded: true,
      icon: const Icon(Icons.keyboard_arrow_down_rounded, color: _muted),
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: _ink),
      decoration: _dec('ประเภทรถ', req: true),
      // ยังไม่เลือก ('0') → โชว์ "-- ระบุ --" สีเทาจางแบบ placeholder (บังคับกรอก)
      selectedItemBuilder: (context) => labels.entries
          .map((e) => Align(alignment: Alignment.centerLeft, child: Text(e.value, style: TextStyle(fontSize: e.key == '0' ? 13 : 15, color: e.key == '0' ? _muted2 : _ink))))
          .toList(),
      items: labels.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value, style: const TextStyle(fontSize: 14.5)))).toList(),
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      // เปลี่ยนประเภทรถ → ล้างยี่ห้อ (EMCS โหลดลิสต์ยี่ห้อใหม่ตามประเภท ยี่ห้อเดิม
      // มักไม่มีในลิสต์ใหม่ — 231 จาก 350 ยี่ห้อมีอยู่แค่ประเภทเดียว)
      onChanged: (v) => setState(() {
        final next = v ?? '0';
        if (next != _carType) _carBrandCtl.text = '';
        _carType = next;
      }),
    );
  }

  // รถยนต์ไฟฟ้า (EV) = dropdown
  Widget _evTypeField() {
    // '' = ยังไม่ระบุ (โชว์ placeholder เทาจาง) ; เก็บ null = ไม่ใช่ EV เหมือนเดิม
    const labels = kEvCodeToLabel;   // master ที่เดียว
    return DropdownButtonFormField<String>(
      initialValue: labels.containsKey(_evType) ? _evType : '',
      isExpanded: true,
      icon: const Icon(Icons.keyboard_arrow_down_rounded, color: _muted),
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: _ink),
      decoration: _dec('รถยนต์ไฟฟ้า (EV)'),
      selectedItemBuilder: (context) => labels.entries
          .map((e) => Align(alignment: Alignment.centerLeft, child: Text(e.value, style: TextStyle(fontSize: e.key.isEmpty ? 13 : 15, color: e.key.isEmpty ? _muted2 : _ink))))
          .toList(),
      items: labels.entries.map((e) => DropdownMenuItem(value: e.key, child: Text(e.value, style: const TextStyle(fontSize: 14.5)))).toList(),
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      onChanged: (v) => setState(() => _evType = v ?? ''),
    );
  }

  // ยี่ห้อ = dropdown ตาม "ประเภทรถ" ที่เลือก (EMCS กรองลิสต์ยี่ห้อตาม ddlCType)
  // เดิมเป็นลิสต์ไทย 17 ตัวตายตัว → บอทเลือกใน EMCS ไม่ได้เลย ('เอ็มจี' vs 'MG' = 0 คะแนน)
  Widget _carBrandField() {
    final base = carBrandsFor(_carType);
    final cur = _carBrandCtl.text.trim();
    final items = [...base, if (cur.isNotEmpty && !base.contains(cur)) cur];
    return _dd(
        base.isEmpty ? 'ยี่ห้อ (เลือกประเภทรถก่อน)' : 'ยี่ห้อ', cur, items,
        (v) => setState(() => _carBrandCtl.text = v ?? ''),
        // ⚠️ ไม่ใส่ req — EMCS **ไม่ได้บังคับ** ยี่ห้อ (ddlCMFG ไม่อยู่ใน vlidSurvey เลย)
        //    เดิมมีจุดแดงแต่ _sectionMissing ไม่เคยตรวจ = จุดแดงลอย ทำให้ช่างงงว่าทำไม
        //    "ครบ N/5" ทั้งที่ยังแดงอยู่ · จุดแดงต้องมีคนตรวจเสมอ ไม่งั้นอย่าใส่
        hint: base.isEmpty ? 'เลือกประเภทรถก่อน' : 'เลือกยี่ห้อ',
        key: ValueKey('cb_${_carType}_$cur'));
  }

  // สีรถ = dropdown (ลิสต์ตรง master EMCS ddlCar_Color — เดิม 'บรอนซ์'/'อื่นๆ' ไม่มีใน EMCS
  // และ 'อื่นๆ' ยังไปเข้า 'ทอง' ตอนบอทกรอก (fuzzy 45) แบบเงียบ ๆ)
  Widget _carColorField() {
    const base = kCarColors;
    final cur = _carColorCtl.text.trim();
    final items = [...base, if (cur.isNotEmpty && !base.contains(cur)) cur];
    return _dd('สีรถ', cur, items, (v) => setState(() => _carColorCtl.text = v ?? ''), hint: 'เลือกสี', key: ValueKey('cc_$cur'));
  }

  List<Widget> _secDriver() => [
        _scanRow(),
        _subhead('บัตรประชาชน'),
        // เพศ (ปุ่ม) | คำนำหน้า — แถวเดียวกัน, dropdown แคบลง
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(flex: 6, child: _genderChips()),
          const SizedBox(width: 12),
          Expanded(flex: 5, child: _ocrField('driver_title', _titleDropdown())),
        ]),
        _row2(_ocrField('driver_name', _txt(_driverNameCtl, 'ชื่อ', req: true, ocrKey: 'driver_name')),
            _ocrField('driver_last', _txt(_driverLastnameCtl, 'นามสกุล', req: true, ocrKey: 'driver_last'))),
        _relationDropdown(),
        // วันเกิด | อายุ
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(flex: 5, child: _ocrField('driver_birthdate', _birthdateField())),
          const SizedBox(width: 10),
          Expanded(flex: 3, child: _numField(_driverAgeCtl, 'อายุ', req: true)),
        ]),
        _txt(_driverPhoneCtl, 'โทรศัพท์', keyboardType: TextInputType.phone, req: true, formatters: kPhoneFormatters),
        _ocrField('driver_id_card', _driverCidField()),
        _ocrField('driver_address', _txt(_driverAddressCtl, 'ที่อยู่ปัจจุบัน', req: true, ocrKey: 'driver_address', maxLines: 2)),
        _ocrField('driver_province', _dd('จังหวัด', _driverProvinceCtl.text, _provinceNames,
            (v) => setState(() { _driverProvinceCtl.text = v ?? ''; _driverDistrictCtl.text = ''; _ocrConf.remove('driver_province'); _ocrConf.remove('driver_district'); }),
            hint: 'เลือกจังหวัด', req: true, key: ValueKey('dp_${_driverProvinceCtl.text}'))),
        _ocrField('driver_district', _districtDropdown()),
        // ── ใบขับขี่ (เปิด/ปิด — บางเคสไม่มีใบขับขี่) ──
        _switchRow('มีใบขับขี่', _driverHasLicense, (v) => setState(() {
              _driverHasLicense = v;
              if (!v) {
                _driverLicenseNoCtl.clear();
                _driverLicensePlaceCtl.clear();
                _driverLicenseStartCtl.clear();
                _driverLicenseEndCtl.clear();
                _driverLicenseTypeCtl.text = 'ไม่มีใบขับขี่';
                _ocrConf.removeWhere((k, _) => k.startsWith('driver_license'));
              } else if (_driverLicenseTypeCtl.text == 'ไม่มีใบขับขี่') {
                _driverLicenseTypeCtl.clear();
              }
              _autosave();
            })),
        if (_driverHasLicense) ...[
          _ocrField('driver_license_type', _licenseTypeDropdown()),
          _row2(_ocrField('driver_license_no', _txt(_driverLicenseNoCtl, 'ใบอนุญาตขับขี่เลขที่', req: true, ocrKey: 'driver_license_no')),
              _txt(_driverLicensePlaceCtl, 'ออกให้ที่')),
          _row2(_ocrField('driver_license_start', _dateField(_driverLicenseStartCtl, 'ออกให้วันที่', yearsAhead: 0)),
              _ocrField('driver_license_end', _dateField(_driverLicenseEndCtl, 'หมดอายุวันที่', yearsAhead: 10))),
        ],
      ];

  List<Widget> _secDamage() => [
        CarDamageDiagram(items: _damageItems, onTapPart: _onTapDiagramPart),
        _damageList(),
        // ⛔ เอา "รายละเอียดความเสียหาย" ออก 2026-07-31: EMCS ไม่มี control รองรับ
        // (ความเสียหายลงเป็นชิ้นส่วน+ด้าน+ระดับ ผ่าน checklist/ช่องอิสระเท่านั้น)
        // คงคีย์ใน payload ไว้ ข้อมูลเก่าจึงไม่หาย
        _numField(_estimatedCostCtl, 'ค่าเสียหายประมาณ (บาท)', decimal: true),
      ];

  List<Widget> _secEvent() => [
        _dateTime(_accDateCtl, _accTimeCtl, 'วันที่เกิดเหตุ', req: true),
        _txt(_accPlaceCtl, 'สถานที่เกิดเหตุ', req: true, onChanged: (_) => _syncSurveyFromAcc()),
        // จังหวัด/เขต-อำเภอที่เกิดเหตุ = dropdown (EMCS เป็น * บังคับทั้งคู่) — ใช้ชุดเดียว
        // กับหน้าผู้ขับขี่ ซึ่งตรง master EMCS 79 จังหวัดอยู่แล้ว; เดิมพิมพ์เอง ทำให้
        // 'กทม.' ไปเข้า 'ปทุมธานี' ตอนบอทกรอก EMCS (fuzzy 45 คะแนน) แบบไม่มีใครรู้
        _row2(_accProvinceDropdown(), _accDistrictDropdown()),
        // ── สถานที่ออกตรวจสอบ ── (user ขอ 10/09/69) เว็บคิดเรทค่าบริการจากชุดนี้ก่อนสถานที่เกิดเหตุ
        // จึงบังคับกรอกทั้ง 3 ช่อง · ส่วนใหญ่ออกตรวจที่เดียวกับที่เกิดเหตุ → ติ๊กแล้วคัดลอกให้และตามไปตลอด
        // ระหว่างติ๊กอยู่ ช่องแก้ไม่ได้ (จาง) กันแก้แล้วงงว่าทำไมถูกทับกลับ
        _sameAsAccTile(),
        IgnorePointer(
          ignoring: _survSameAsAcc,
          child: Opacity(
            opacity: _survSameAsAcc ? 0.6 : 1,
            child: Column(children: [
              _txt(_survPlaceCtl, 'สถานที่ออกตรวจสอบ', req: true),
              const SizedBox(height: 14),   // ระยะเดียวกับ _withGaps ของการ์ด (อยู่ใน Column ซ้อน เลยไม่ได้ช่องว่างอัตโนมัติ)
              _row2(_survProvinceDropdown(), _survDistrictDropdown()),
            ]),
          ),
        ),
        _dd('ลักษณะการเกิดเหตุ', _accCauseCtl.text, _accCauseOptions,
            (v) => setState(() => _accCauseCtl.text = v ?? ''), req: true, key: ValueKey('ac_${_accCauseCtl.text}')),
        // ลักษณะความเสียหาย = * บังคับใน EMCS (ว่าง → บอทหยุดรอคนกรอกบนหน้า EMCS)
        _dd('ลักษณะความเสียหาย', _accDamageTypeCtl.text, _accDamageOptions,
            (v) => setState(() => _accDamageTypeCtl.text = v ?? ''), req: true, key: ValueKey('ad_${_accDamageTypeCtl.text}')),
        _txt(_accDetailCtl, 'รายละเอียดการเกิดเหตุ', maxLines: 5, req: true),
        _faultDropdown(),
        // EMCS บังคับ 'คู่กรณีคันที่' + ติ๊กการเรียกร้อง เมื่อผลคดี = คู่กรณีผิด
        // (ไม่กรอก = บอทกรอกให้ไม่ได้ หัวหน้าต้องมาเติมเองบน EMCS ทุกเคส)
        if (_faultIs('คู่กรณีผิด'))
          _numField(_accFaultOpponentNoCtl, 'คู่กรณีคันที่', req: true),
        // EMCS มีช่องจริงทั้งคู่ (txtDri_Order / chkLost_Car) แต่เดิมแอปไม่มีให้กรอก
        _txt(_driverTicketCtl, 'ใบสั่ง (เลขที่ใบสั่งจราจร)'),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          dense: true,
          title: const Text('รถหาย', style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600)),
          value: _carLost,
          onChanged: (v) => setState(() => _carLost = v),
        ),
        _txt(_accReporterCtl, 'ผู้แจ้ง'),
        _txt(_accSurveyorCtl, 'ผู้สำรวจภัย', req: true),
        // ⛔ เอาช่อง "สาขา" ออก 2026-07-27: ddlSurv_Branch บน EMCS มี option เดียวคือ
        // '-- ระบุ --' (เลือกอะไรไม่ได้) และงานจริงที่พนักงานทำก็ค้างที่ค่านั้น
        // ส่วน "โทรศัพท์สำรวจ" มีปลายทางจริง (txtAcc_Tel) — บอทส่งให้แล้วตั้งแต่ 2d78f0e
        // req: EMCS บังคับ txtAcc_Tel ใน vlidSurvey (เดิมไม่มีจุดแดง ปล่อยว่างแล้วส่งได้)
        _txt(_accSurveyorPhoneCtl, 'โทรศัพท์สำรวจ', req: true, keyboardType: TextInputType.phone, formatters: kPhoneFormatters),
        _dateTime(_accCustomerReportDateCtl, _accCustomerReportTimeCtl, 'วันที่ลูกค้าแจ้ง บ.ประกัน'),
        _dateTime(_accInsNotifyDateCtl, _accInsNotifyTimeCtl, 'วันที่ บ.ประกันแจ้งสำรวจ'),
        _dateTime(_accSurveyArriveDateCtl, _accSurveyArriveTimeCtl, 'วันที่ถึงที่เกิดเหตุ'),
        _dateTime(_accSurveyCompleteDateCtl, _accSurveyCompleteTimeCtl, 'วันที่สำรวจเสร็จ'),
        _opoClaimChecks(),
        _row2(_numField(_accClaimAmountCtl, 'รับเงินจำนวน (บาท)', decimal: true),
            _numField(_accClaimTotalAmountCtl, 'จากจำนวนเรียกร้องทั้งหมด (บาท)', decimal: true)),
        _switchRow(_policeRequired() ? 'มีการแจ้งความ / ลงประจำวัน (จำเป็น)' : 'มีการแจ้งความ / ลงประจำวัน',
            _hasPolice || _policeRequired(), (v) => setState(() => _hasPolice = v)),
        if (_hasPolice || _policeRequired()) ...[
          _subhead('ตำรวจ'),
          _row2(_txt(_accPoliceNameCtl, 'ชื่อพนักงานสอบสวน', req: true), _txt(_accPoliceStationCtl, 'สถานีตำรวจ', req: true)),
          _txt(_accPoliceCommentCtl, 'ความเห็นพนักงานสอบสวน'),
          _dateTime(_accPoliceDateCtl, _accPoliceTimeCtl, 'วันที่ (ตำรวจ)'),
          _txt(_accPoliceBookNoCtl, 'ประจำวันข้อที่'),
          // EMCS เป็น radio 2 ตัว + ช่อง "ระบุผล" ที่ปลดล็อกเมื่อเลือก "มีการตรวจ"
          _alcoholField(),
        ],
        _subhead('การติดตามงาน'),
        _followupDropdown(),
        // EMCS เป็น dropdown 1-5 (maxlength 2 + รับเฉพาะตัวเลข) ไม่ใช่ช่องพิมพ์อิสระ
        _simpleDropdown('ครั้งที่นัดหมาย', _accFollowupCountCtl.text,
            const ['1', '2', '3', '4', '5'], (v) => _accFollowupCountCtl.text = v),
        _txt(_accFollowupDetailCtl, 'รายละเอียดการนัดหมาย'),
        _dateTime(_accFollowupDateCtl, _accFollowupTimeCtl, 'วันที่นัดหมาย'),
      ];

  // ผลการตรวจแอลกอฮอล์ — EMCS เป็น radio 2 ตัว (rdoAlc_Chk_0 = ไม่มีการตรวจ /
  // _1 = มีการตรวจ) + ช่อง "ระบุผล" (txtAlc_Result) ที่ใช้ได้เมื่อเลือก "มีการตรวจ"
  // เดิมแอปเป็นกล่องข้อความเดียว ทำให้บอทต้องเดาจากข้อความว่าตรวจหรือไม่ตรวจ
  static const _kAlcNo = 'ไม่มีการตรวจแอลกอฮอล์';
  static const _kAlcYes = 'มีการตรวจแอลกอฮอล์';

  Widget _simpleDropdown(String label, String value, List<String> options,
      void Function(String) onChanged) {
    return DropdownButtonFormField<String>(
      key: ValueKey('$label\_$value'),
      initialValue: options.contains(value) ? value : null,
      isExpanded: true,
      icon: const Icon(Icons.keyboard_arrow_down_rounded, color: _muted),
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: _ink),
      decoration: _dec(label),
      hint: const Text('-- ระบุ --', style: TextStyle(fontSize: 13, color: _muted2)),
      items: [
        const DropdownMenuItem(value: '', child: Text('-- ระบุ --', style: TextStyle(fontSize: 14.5, color: _muted2))),
        ...options.map((k) => DropdownMenuItem(
            value: k, child: Text(k, style: const TextStyle(fontSize: 14.5), overflow: TextOverflow.ellipsis))),
      ],
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      onChanged: (v) => setState(() => onChanged(v ?? '')),
    );
  }

  Widget _alcoholField() => Column(children: [
        _simpleDropdown('ผลการตรวจแอลกอฮอล์', _accAlcoholTestCtl.text,
            const [_kAlcNo, _kAlcYes], (v) {
          _accAlcoholTestCtl.text = v;
          if (v != _kAlcYes) _accAlcoholResultCtl.clear();
        }),
        if (_accAlcoholTestCtl.text == _kAlcYes)
          _txt(_accAlcoholResultCtl, 'ระบุผล (ค่าที่ตรวจได้)'),
      ]);

  // ฝ่ายประมาท — dropdown (โชว์ป้ายเต็ม, เก็บค่าเดิมแบบสั้น)
  Widget _faultDropdown() {
    // key = ค่าที่บันทึกลงฐานข้อมูล · value = ป้ายที่ช่างเห็น — **จงใจให้ต่างกันได้**
    // ⛔ ห้ามเปลี่ยน key เด็ดขาดเมื่ออยากแก้คำบนจอ: key ไหลตรงไปเป็นตัวเลือก radio
    //    ของ EMCS (CAUSE_RADIO ใน se-autokey) + รหัสผลคดีในไฟล์ XML + เงื่อนไขบังคับ
    //    ทุกที่ที่เรียก _faultIs() · เปลี่ยน key = ของเก่าในฐานข้อมูลกลายเป็นค่าที่ไม่มีใครรู้จัก
    //    แล้วบอทจะกรอกผลคดีผิดฝ่ายทั้งสำนวนโดยไม่มีอะไรฟ้อง
    const opts = <String, String>{
      'ฝ่ายผิด': 'รถประกันฝ่ายผิด',
      'ฝ่ายถูกและผิด': 'ฝ่ายถูกและผิด',
      // ⛔ user 31/08/69: **ห้ามเปลี่ยนคำเป็น "รถประกันฝ่ายถูก"** — เคยลองแล้วถอยกลับ
      //    เหตุผล: ตัวเลือกชุดนี้ต้องตรงกับที่อยู่บน EMCS หัวหน้าจะได้เทียบหน้าจอต่อหน้าจอ
      //    ได้ตอนตรวจ · ถึงจะเป็นเรื่องเดียวกันคนละมุมมองก็ตาม
      'คู่กรณีผิด': 'คู่กรณีผิด',
      'ประมาทร่วม': 'ประมาทร่วม',
      'รอสรุปผลคดี': 'รอสรุปผลคดี',
      'ยกเลิกการเคลม': 'ยกเลิกการเคลม',
      'ไปถึงแล้วไม่พบ': 'ไปถึงแล้วไม่พบ',
    };
    final keys = opts.keys.toList();
    return DropdownButtonFormField<String>(
      key: ValueKey('fault_$_accFault'),
      initialValue: keys.contains(_accFault) ? _accFault : null,
      isExpanded: true,
      icon: const Icon(Icons.keyboard_arrow_down_rounded, color: _muted),
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: _ink),
      decoration: _dec('ฝ่ายประมาท', req: true),   // EMCS บังคับ rdoAcc_Cause0 (vlidSurvey)
      hint: const Text('-- ระบุ --', style: TextStyle(fontSize: 13, color: _muted2)),
      items: [
        const DropdownMenuItem(value: '', child: Text('-- ระบุ --', style: TextStyle(fontSize: 14.5, color: _muted2))),
        ...keys.map((k) => DropdownMenuItem(value: k, child: Text(opts[k]!, style: const TextStyle(fontSize: 14.5), overflow: TextOverflow.ellipsis))),
      ],
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      onChanged: (v) => setState(() => _accFault = v ?? ''),
    );
  }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m), duration: const Duration(seconds: 2)));

  // ── list view ทั่วไปของข้อมูลหลายรายการ (คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน) ──
  Widget _recordListScroll({
    required IconData icon,
    required String title,
    required List<Map<String, dynamic>> items,
    required String emptyHint,
    required String addLabel,
    required VoidCallback onAdd,
    required String Function(Map<String, dynamic> m, int i) lineTitle,
    required String Function(Map<String, dynamic> m) lineSub,
    required void Function(int) onTap,
    required void Function(int) onDelete,
    Widget? Function(Map<String, dynamic> m)? badgeBuilder,
    List<Widget> footer = const [],
    String? asset,
  }) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(12, 14, 12, 24),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(children: [
          Container(width: 36, height: 36, decoration: BoxDecoration(color: _tint, borderRadius: BorderRadius.circular(11)), child: asset != null ? Center(child: Image.asset(asset, width: 24 * _iconScale(asset), height: 24 * _iconScale(asset))) : Icon(icon, size: 19, color: _primary)),
          const SizedBox(width: 10),
          Expanded(child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: _ink))),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(color: items.isEmpty ? _fill : _okTint, borderRadius: BorderRadius.circular(999)),
            child: Text('${items.length} รายการ', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: items.isEmpty ? _muted : _ok)),
          ),
        ]),
        const SizedBox(height: 12),
        if (items.isEmpty)
          Container(
            padding: const EdgeInsets.symmetric(vertical: 26, horizontal: 16),
            decoration: BoxDecoration(color: _cardBg, borderRadius: BorderRadius.circular(16), border: Border.all(color: _line)),
            child: Center(child: Text(emptyHint, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: _muted))),
          ),
        for (int i = 0; i < items.length; i++) _recordCard(lineTitle(items[i], i), lineSub(items[i]), () => onTap(i), () => onDelete(i), badge: badgeBuilder?.call(items[i])),
        const SizedBox(height: 10),
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: onAdd,
            icon: const Icon(Icons.add, size: 18),
            label: Text(addLabel, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
            style: OutlinedButton.styleFrom(foregroundColor: _primary, backgroundColor: _tint, side: BorderSide.none, padding: const EdgeInsets.symmetric(vertical: 14), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13))),
          ),
        ),
        ...footer,
      ]),
    );
  }

  Widget _recordCard(String title, String sub, VoidCallback onTap, VoidCallback onDelete, {Widget? badge}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: _cardBg,
        borderRadius: BorderRadius.circular(15),
        child: InkWell(
          borderRadius: BorderRadius.circular(15),
          onTap: onTap,
          child: Container(
            padding: const EdgeInsets.fromLTRB(14, 12, 8, 12),
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(15), border: Border.all(color: _line)),
            child: Row(children: [
              Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Flexible(child: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w700, color: _ink))),
                  if (badge != null) ...[const SizedBox(width: 8), badge],
                ]),
                const SizedBox(height: 2),
                Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: _muted)),
              ])),
              IconButton(icon: Icon(Icons.delete_outline, size: 20, color: Colors.red.shade400), onPressed: onDelete),
              const Icon(Icons.chevron_right, color: _muted2),
            ]),
          ),
        ),
      ),
    );
  }

  // แบดจ์สีระดับความรุนแรง (จาก wound_level ที่เลือกในหน้า editor)
  Widget? _woundBadge(String? wound) {
    final w = (wound ?? '').trim();
    if (w.isEmpty) return null;
    final match = kWounds.where((e) => e['label'] == w);
    final color = match.isNotEmpty ? Color(match.first['color'] as int) : _muted;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 2),
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(999)),
      child: Text(w, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white)),
    );
  }

  Future<void> _confirmDelete(String what, VoidCallback onYes) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('ลบ$what?'),
        content: Text('ต้องการลบ$whatนี้หรือไม่'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('ยกเลิก')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('ลบ', style: TextStyle(color: Colors.red))),
        ],
      ),
    );
    if (ok == true && mounted) { onYes(); _autosave(); }
  }

  // ── คู่กรณี ──
  Widget _opponentsBody() => _recordListScroll(
        icon: Icons.groups_2_outlined,
        asset: 'assets/section_icons/s6.png',
        title: '6. คู่กรณี (${_opponents.length})',
        items: _opponents,
        emptyHint: 'ยังไม่มีคู่กรณีในเคสนี้\nกด "เพิ่มคู่กรณี" เพื่อเริ่ม',
        addLabel: 'เพิ่มคู่กรณี',
        onAdd: _addOpponent,
        onTap: _editOpponent,
        onDelete: (i) => _confirmDelete('คู่กรณีคันที่ ${i + 1}', () => setState(() { _opponents.removeAt(i); _remapRecordPhotoTags('คันที่', i); _remapFaultOpponentNo(i); })),
        lineTitle: (m, i) => 'คันที่ ${i + 1}${(m['plate'] ?? '').toString().trim().isNotEmpty ? ' · ${m['plate']}' : ''}',
        lineSub: (m) {
          final owner = (m['owner_name'] ?? '').toString().trim();
          final ins = (m['insurer'] ?? '').toString().trim();
          return [if (owner.isNotEmpty) owner, ins.isNotEmpty ? ins : 'ไม่ระบุประกัน'].join(' · ');
        },
      );

  // เปิด editor หน้าย่อย (คู่กรณี/ผู้บาดเจ็บ) พร้อมกัน OCR-draft หาย:
  // onDraft (เรียกตอนสแกนในหน้าย่อย) → เก็บ snapshot ลง _pendingEditor + autosave ทันที;
  // พอ editor ปิด (ผลลัพธ์ใดก็ตาม) → เคลียร์ _pendingEditor แล้ว persist (กัน snapshot ค้างถ้ากดยกเลิกหลังสแกน)
  Future<Map?> _openRecordEditor(String type, int? index, Widget Function(void Function(Map<String, dynamic>) onDraft) build) async {
    final res = await Navigator.of(context).push<Map>(MaterialPageRoute(
        builder: (_) => build((d) { _pendingEditor = {'type': type, 'index': index, 'data': d}; _autosave(); })));
    if (_pendingEditor != null) { _pendingEditor = null; if (mounted) _autosave(); }
    return mounted ? res : null;
  }

  Future<void> _addOpponent() async {
    if (_opponents.length >= 20) { _snack('เพิ่มคู่กรณีได้สูงสุด 20 คัน'); return; }
    final res = await _openRecordEditor('opponent', null, (onDraft) => OpponentEditor(
        data: const {}, provinces: _provinceNames, provincesData: _provincesData, number: _opponents.length + 1, isNew: true, onScan: _captureRetainOcr, onDraft: onDraft));
    if (res == null || res['action'] != 'save') return;
    setState(() { _opponents.add(Map<String, dynamic>.from(res['data'] as Map)); _hasOpponents = true; });
    _autosave();
  }

  Future<void> _editOpponent(int i) async {
    final res = await _openRecordEditor('opponent', i, (onDraft) => OpponentEditor(
        data: _opponents[i], provinces: _provinceNames, provincesData: _provincesData, number: i + 1, onScan: _captureRetainOcr, onDraft: onDraft));
    if (res == null) return;
    setState(() {
      if (res['action'] == 'save') {
        _opponents[i] = Map<String, dynamic>.from(res['data'] as Map);
      } else if (res['action'] == 'delete') {
        _opponents.removeAt(i);
        _remapRecordPhotoTags('คันที่', i);
      }
    });
    _autosave();
  }

  // ── ผู้บาดเจ็บ ──
  Widget _injuredBody() => _recordListScroll(
        icon: MyFlutterApp.procedures,
        title: '7. ผู้บาดเจ็บ',
        items: _injured,
        emptyHint: 'ยังไม่มีผู้บาดเจ็บ\nกด "เพิ่มผู้บาดเจ็บ" หากมี',
        addLabel: 'เพิ่มผู้บาดเจ็บ',
        onAdd: _addInjured,
        onTap: _editInjured,
        onDelete: (i) => _confirmDelete('ผู้บาดเจ็บคนที่ ${i + 1}', () => setState(() { _injured.removeAt(i); _remapRecordPhotoTags('คนที่', i); })),
        badgeBuilder: (m) => _woundBadge((m['wound_level'] ?? '').toString()),
        lineTitle: (m, i) => '${i + 1}. ${(m['name'] ?? '').toString().trim().isNotEmpty ? m['name'] : 'ไม่ระบุชื่อ'}',
        lineSub: (m) {
          final t = (m['person_type'] ?? '').toString().trim();
          final reg = (m['car_reg'] ?? '').toString().trim();
          final hosp = (m['hospital'] ?? '').toString().trim();
          return [if (t.isNotEmpty) t, if (reg.isNotEmpty) reg, if (hosp.isNotEmpty) hosp].join(' · ');
        },
      );

  Future<void> _addInjured() async {
    final res = await _openRecordEditor('injured', null, (onDraft) => InjuredEditor(
        data: const {}, provinces: _provinceNames, number: _injured.length + 1, isNew: true, onScan: _captureRetainOcr, onDraft: onDraft));
    if (res == null || res['action'] != 'save') return;
    setState(() { _injured.add(Map<String, dynamic>.from(res['data'] as Map)); _hasInjured = true; });
    _autosave();
  }

  Future<void> _editInjured(int i) async {
    final res = await _openRecordEditor('injured', i, (onDraft) => InjuredEditor(
        data: _injured[i], provinces: _provinceNames, number: i + 1, onScan: _captureRetainOcr, onDraft: onDraft));
    if (res == null) return;
    setState(() {
      if (res['action'] == 'save') {
        _injured[i] = Map<String, dynamic>.from(res['data'] as Map);
      } else if (res['action'] == 'delete') {
        _injured.removeAt(i);
        _remapRecordPhotoTags('คนที่', i);
      }
    });
    _autosave();
  }

  // ── ทรัพย์สิน ──
  Widget _propertyBody() => _recordListScroll(
        icon: Icons.category,
        title: '8. ทรัพย์สิน',
        items: _property,
        emptyHint: 'ยังไม่มีทรัพย์สินเสียหาย\nกด "เพิ่มทรัพย์สิน" หากมี',
        addLabel: 'เพิ่มทรัพย์สิน',
        onAdd: _addProperty,
        onTap: _editProperty,
        onDelete: (i) => _confirmDelete('ทรัพย์สินชิ้นที่ ${i + 1}', () => setState(() { _property.removeAt(i); _remapRecordPhotoTags('ชิ้นที่', i); })),
        lineTitle: (m, i) => '${i + 1}. ${(m['item'] ?? '').toString().trim().isNotEmpty ? m['item'] : 'ไม่ระบุ'}',
        lineSub: (m) {
          final o = (m['owner_name'] ?? '').toString().trim();
          final c = (m['estimated_cost'] ?? '').toString().trim();
          return [if (o.isNotEmpty) o, if (c.isNotEmpty) '฿$c'].join(' · ');
        },
      );

  Future<void> _addProperty() async {
    final res = await Navigator.of(context).push<Map>(MaterialPageRoute(
        builder: (_) => PropertyEditor(data: const {}, number: _property.length + 1, isNew: true)));
    if (!mounted || res == null || res['action'] != 'save') return;
    setState(() { _property.add(Map<String, dynamic>.from(res['data'] as Map)); _hasProperty = true; });
    _autosave();
  }

  Future<void> _editProperty(int i) async {
    final res = await Navigator.of(context).push<Map>(MaterialPageRoute(
        builder: (_) => PropertyEditor(data: _property[i], number: i + 1)));
    if (!mounted || res == null) return;
    setState(() {
      if (res['action'] == 'save') {
        _property[i] = Map<String, dynamic>.from(res['data'] as Map);
      } else if (res['action'] == 'delete') {
        _property.removeAt(i);
        _remapRecordPhotoTags('ชิ้นที่', i);
      }
    });
    _autosave();
  }

  // ชื่อบริษัทประกันแบบย่อ — ตัด "บริษัท" นำหน้า และ "จำกัด (มหาชน)" ท้าย
  String get _shortInsurer {
    var s = _insuranceCompanyCtl.text.trim();
    s = s.replaceFirst(RegExp(r'^บริษัท\s*'), '');
    s = s.replaceFirst(RegExp(r'\s*จำกัด.*$'), '');
    return s.trim();
  }

  // ปุ่มประเภทเคลม — เหลี่ยม + label บรรทัดเดียว (FittedBox ย่อพอดี)
  Widget _claimTypeChips() {
    const opts = [['เคลมสด', 'F'], ['เคลมแห้ง', 'D'], ['นัดหมาย', 'A'], ['ติดตาม', 'C']];
    return Row(children: [
      for (var i = 0; i < opts.length; i++) ...[
        if (i > 0) const SizedBox(width: 6),
        Expanded(
          child: GestureDetector(
            onTap: () => setState(() => _claimType = opts[i][1]),
            child: Container(
              height: 42,
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 4),
              decoration: BoxDecoration(
                color: _claimType == opts[i][1] ? _primary : Colors.white,
                borderRadius: BorderRadius.circular(11),
                border: Border.all(color: _claimType == opts[i][1] ? _primary : _lineStrong, width: 1.5),
              ),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(opts[i][0], maxLines: 1, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: _claimType == opts[i][1] ? Colors.white : _muted)),
              ),
            ),
          ),
        ),
      ],
    ]);
  }

  // ── ป้ายบริษัทประกัน (ล็อกจากงานที่ได้รับ) ──
  Widget _insurerLockField() {
    final name = _shortInsurer;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
      decoration: BoxDecoration(color: _fill, borderRadius: BorderRadius.circular(13), border: Border.all(color: _line)),
      child: Row(children: [
        const Icon(Icons.lock_outline, size: 16, color: _muted),
        const SizedBox(width: 10),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('บริษัทประกัน', style: TextStyle(fontSize: 11, color: _muted, fontWeight: FontWeight.w500)),
          Text(name.isNotEmpty ? name : 'กำหนดจากงานที่ได้รับ', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: _ink)),
        ])),
      ]),
    );
  }

  Widget _subhead(String t) => Padding(
        padding: const EdgeInsets.only(top: 8, bottom: 2),
        child: Row(children: [
          Text(t, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: _muted)),
          const SizedBox(width: 8),
          Expanded(child: Container(height: 1, color: _line)),
        ]),
      );

  // ช่องเลขบัตร ปชช ผู้ขับ + ตัวเลือก คนไทย/ต่างชาติ
  // คนไทย = 13 หลัก + checksum (ไอคอน ✓/⚠) · ต่างชาติ = พิมพ์อะไรก็ได้ ไม่เกิน 13 ตัว
  Widget _driverCidField() => kCidField(
        _driverIdCardCtl,
        isThai: _driverIdThai,
        onTypeChanged: (v) => setState(() { _driverIdThai = v; _autosave(); }),
        checksum: cidChecksum,
        onChanged: (_) => setState(() { _ocrConf.remove('driver_id_card'); _autosave(); }),
      );

  // รวมวันที่+เวลา เป็น "dd/mm/yyyy|HH:mm" (ตรงกับที่หน้าเว็บ checker อ่าน)
  String _combineDT(TextEditingController d, TextEditingController t) {
    final ds = d.text.trim();
    final ts = t.text.trim();
    if (ds.isEmpty) return '';
    return ts.isEmpty ? ds : '$ds|$ts';
  }

  Widget _dateTime(TextEditingController d, TextEditingController t, String label, {bool req = false}) {
    // label 2 อันอยู่แถวเดียว, ช่อง input อยู่แถวถัดไปให้ตรงกัน (วัน + เวลา แถวเดียวกัน)
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Expanded(child: _fieldLabel(label, req: req)),
          const SizedBox(width: 8),
          SizedBox(width: 118, child: _fieldLabel('เวลา')),
        ]),
        const SizedBox(height: 4),
        Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          Expanded(child: _dateField(d, label, req: req, yearsAhead: 1, showLabel: false)),
          const SizedBox(width: 8),
          _TimeField(t, key: ValueKey('tm_${identityHashCode(t)}'), showLabel: false, onChanged: _scheduleAutosave),
        ]),
      ]),
    );
  }

  // การเรียกร้องค่าเสียหายจากคู่กรณี — 5 ตัวเลือก (ตรงกับหน้าเว็บ checker)
  Widget _opoClaimChecks() {
    const opts = {
      'คัดประจำวัน': 'คัดประจำวัน',
      'รับหลักฐานจากคู่กรณี': 'รับหลักฐานจากคู่กรณี',
      'บันทึกยอมรับผิด': 'บันทึกยอมรับผิด',
      'บัตรติดต่อ': 'บัตรติดต่อ',
      'รับเงินจำนวน': 'รับเงินจำนวน',
    };
    // จุดแดงขึ้นตามเงื่อนไขจริง ไม่ใช่ติดตายไว้ — ใช้ตัวเดียวกับตัวตรวจก่อนส่งงาน
    // (ถ้าบังคับแต่ไม่ขึ้นจุด ช่างจะรู้ตัวตอนกดส่งแล้วไม่ผ่าน แล้วต้องไล่หาเองว่าช่องไหน)
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      _fieldLabel('การเรียกร้องค่าเสียหายจากคู่กรณี', req: _claimRequired()),
      for (final e in opts.entries)
        GestureDetector(
          onTap: () => setState(() => _opoClaims.contains(e.key) ? _opoClaims.remove(e.key) : _opoClaims.add(e.key)),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 3),
            child: Row(children: [
              Icon(_opoClaims.contains(e.key) ? Icons.check_box : Icons.check_box_outline_blank, color: _opoClaims.contains(e.key) ? _primary : _muted2, size: 22),
              const SizedBox(width: 8),
              Expanded(child: Text(e.value, style: const TextStyle(fontSize: 13.5, color: _ink))),
            ]),
          ),
        ),
    ]);
  }

  // ปุ่ม capture (สแกน/GPS) เต็มความกว้าง มีสถานะ busy

  // ── topbar (sticky header: เลขเคลม + สถานะ; มีปุ่มย้อนกลับเมื่ออยู่ในหมวด) ──
  PreferredSizeWidget _topbar() {
    final claimNo = _claimNoCtl.text.trim();
    final inSection = _view != _SView.hub;
    return AppBar(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.white,
      foregroundColor: _ink,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      titleSpacing: inSection ? 0 : 16,
      leading: inSection
          ? IconButton(icon: const Icon(Icons.arrow_back, color: _ink), tooltip: 'กลับ Hub', onPressed: () => _go(_SView.hub))
          : null,
      title: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text('งานสำรวจ', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: _ink)),
          if (claimNo.isNotEmpty)
            Text('เคลม #$claimNo', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: _muted)),
        ],
      ),
      actions: [
        _slaChip(),
        if (_caseImages.isNotEmpty)
          IconButton(
            tooltip: 'หน้าการ์ด',
            onPressed: () => setState(() => _showImageSheet = !_showImageSheet),
            icon: Icon(_showImageSheet ? Icons.close : Icons.badge_outlined, color: _primary),
          ),
        Padding(padding: const EdgeInsets.only(right: 12, left: 2), child: _statusChip()),
      ],
      bottom: PreferredSize(preferredSize: const Size.fromHeight(1), child: Container(height: 1, color: _line)),
    );
  }

  // ป้าย SLA 24 ชม. (เฉพาะเคลมสด + มีเวลาลูกค้าแจ้ง) — ซ่อนถ้าไม่มีข้อมูลเวลา
  Widget _slaChip() {
    if (_claimType != 'F' || _slaStart == null) return const SizedBox.shrink();
    final remain = _slaStart!.add(const Duration(hours: 24)).difference(DateTime.now());
    final over = remain.isNegative;
    final hrs = remain.inMinutes.abs() / 60.0;
    final label = over ? 'เกิน SLA' : 'เหลือ ${hrs.toStringAsFixed(hrs < 10 ? 1 : 0)} ชม.';
    final Color c, bg;
    if (over) { c = const Color(0xFFDC2626); bg = const Color(0xFFFDECEC); }
    else if (remain.inHours < 6) { c = _warn; bg = _warnTint; }
    else { c = _ok; bg = _okTint; }
    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(Icons.timer_outlined, size: 13, color: c),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w700, color: c)),
        ]),
      ),
    );
  }

  Widget _statusChip() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
      decoration: BoxDecoration(color: _okTint, borderRadius: BorderRadius.circular(999)),
      child: const Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(Icons.circle, size: 8, color: _ok),
        SizedBox(width: 6),
        Text('กำลังสำรวจ', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: _ok)),
      ]),
    );
  }

  // ── bottom bar: ความคืบหน้า N/6 + ปุ่มหลัก (hub=ส่ง / หมวด=กลับ Hub) + บันทึกร่าง ──
  Widget _savebar(CaseProvider cp) {
    final inHub = _view == _SView.hub;
    final inReview = _view == _SView.review;
    return Container(
      padding: EdgeInsets.fromLTRB(10, 8, 10, 10 + MediaQuery.of(context).padding.bottom),
      decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: _line))),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        // ฟังช่องบังคับ → อัปเดต "ครบ N/5" ทันทีระหว่างพิมพ์ (ไม่ต้องรอ blur/rebuild)
        ListenableBuilder(
          listenable: _completionListenable,
          builder: (context, _) {
            final n = _filledCount();
            return Row(children: [
              Text('ครบ $n/5 หมวด', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: _muted)),
              const SizedBox(width: 10),
              Expanded(child: ClipRRect(borderRadius: BorderRadius.circular(999), child: LinearProgressIndicator(value: n / 5, minHeight: 6, backgroundColor: _line, color: _ok))),
              if (_savedAt != null) ...[
                const SizedBox(width: 10),
                const Icon(Icons.check_circle, size: 13, color: _ok),
                const SizedBox(width: 3),
                Text('บันทึก $_savedAt', style: const TextStyle(fontSize: 10.5, color: _muted)),
              ],
            ]);
          },
        ),
        const SizedBox(height: 8),
        _savebarButtons(cp, inHub, inReview),
      ]),
    );
  }

  // ปุ่มแถวล่าง — มี autosave แล้วจึงตัดปุ่มบันทึกออก
  //  hub/review → ปุ่มหลักเต็มแถว | หมวดหลัก → [Hub ไอคอน] [ก่อนหน้า] [ถัดไป/ตรวจสอบ] | หน้าเสริม → กลับ Hub
  Widget _savebarButtons(CaseProvider cp, bool inHub, bool inReview) {
    ButtonStyle primaryStyle() => ElevatedButton.styleFrom(
          backgroundColor: _primary,
          foregroundColor: Colors.white,
          elevation: 0,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        );
    ButtonStyle outlinedStyle() => OutlinedButton.styleFrom(
          foregroundColor: _primary,
          side: const BorderSide(color: _lineStrong),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        );

    if (inHub || inReview) {
      return SizedBox(
        height: 50,
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: cp.isSubmitting ? null : (inReview ? _submitWithGate : () => _go(_SView.review)),
          icon: cp.isSubmitting
              ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white))
              : Icon(inReview ? Icons.send_rounded : Icons.fact_check_outlined, size: 20),
          label: Text(inReview ? 'ส่งรายงาน' : 'ตรวจสอบ & ส่ง', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          style: primaryStyle(),
        ),
      );
    }

    final prev = _prevSectionView();
    final next = _nextSectionView();

    // หน้าเสริม (ไม่อยู่ในลำดับหมวด) → ปุ่มกลับ Hub เต็มแถว
    if (prev == null && next == null) {
      return SizedBox(
        height: 50,
        width: double.infinity,
        child: OutlinedButton.icon(
          onPressed: () => _go(_SView.hub),
          icon: const Icon(Icons.arrow_back, size: 19),
          label: const Text('กลับ Hub', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          style: outlinedStyle(),
        ),
      );
    }

    // ปุ่มขวา: มีถัดไป → "ถัดไป: X" | หมวดสุดท้าย → "ตรวจสอบ & ส่ง"
    final forwardBtn = SizedBox(
      height: 50,
      child: ElevatedButton.icon(
        onPressed: () => _go(next ?? _SView.review),
        icon: Icon(next != null ? Icons.arrow_forward_rounded : Icons.fact_check_outlined, size: 19),
        label: Text(next != null ? 'ถัดไป: ${_sectionShortTitle(next)}' : 'ตรวจสอบ & ส่ง',
            maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600)),
        style: primaryStyle(),
      ),
    );

    return Row(children: [
      SizedBox(
        width: 50,
        height: 50,
        child: OutlinedButton(
          onPressed: () => _go(_SView.hub),
          style: OutlinedButton.styleFrom(
            foregroundColor: _primary,
            side: const BorderSide(color: _lineStrong),
            padding: EdgeInsets.zero,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
          ),
          child: const Icon(Icons.grid_view_rounded, size: 20),
        ),
      ),
      const SizedBox(width: 8),
      if (prev != null) ...[
        SizedBox(
          width: 50,
          height: 50,
          child: OutlinedButton(
            onPressed: () => _go(prev),
            style: OutlinedButton.styleFrom(
              foregroundColor: _primary,
              side: const BorderSide(color: _lineStrong),
              padding: EdgeInsets.zero,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            ),
            child: const Icon(Icons.arrow_back_rounded, size: 20),
          ),
        ),
        const SizedBox(width: 8),
      ],
      Expanded(child: forwardBtn),
    ]);
  }

  // ── card (section) ──
  Widget _card(int idx, IconData icon, String title, List<Widget> children, {bool warn = false, String? asset}) {
    return Container(
      key: _secKeys[idx],
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.fromLTRB(12, 4, 12, 14),
      decoration: BoxDecoration(
        color: _cardBg,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: _line),
        boxShadow: [BoxShadow(color: const Color(0xFF141E3C).withValues(alpha: 0.035), blurRadius: 24, offset: const Offset(0, 8))],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(0, 13, 0, 12),
            margin: const EdgeInsets.only(bottom: 14),
            decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: _line))),
            child: Row(children: [
              Container(
                width: 32, height: 32,
                decoration: BoxDecoration(color: warn ? _warnTint : _tint, borderRadius: BorderRadius.circular(10)),
                child: asset != null ? Center(child: Image.asset(asset, width: 22 * _iconScale(asset), height: 22 * _iconScale(asset))) : Icon(icon, size: 18, color: warn ? _warn : _primary),
              ),
              const SizedBox(width: 11),
              Expanded(child: Text(title, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: _ink))),
            ]),
          ),
          ..._withGaps(children),
        ],
      ),
    );
  }

  List<Widget> _withGaps(List<Widget> items) {
    final out = <Widget>[];
    for (var i = 0; i < items.length; i++) {
      out.add(items[i]);
      if (i < items.length - 1) out.add(const SizedBox(height: 14));
    }
    return out;
  }

  Widget _fieldLabel(String text, {bool req = false}) => Padding(
        padding: const EdgeInsets.only(top: 2, bottom: 2),
        child: Text.rich(
          TextSpan(text: text, children: req ? const [TextSpan(text: ' ●', style: TextStyle(color: Color(0xFFDC2626)))] : const []),
          style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: _ink),
        ),
      );

  Widget _row2(Widget a, Widget b) =>
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: a), const SizedBox(width: 10), Expanded(child: b)]);

  // ── filled, floating-label decoration (req=true → จุดแดง ● ท้าย label) ──
  InputDecoration _dec(String label, {Widget? suffixIcon, String? hint, bool req = false, bool showLabel = true}) {
    OutlineInputBorder b(Color c) => OutlineInputBorder(borderRadius: BorderRadius.circular(13), borderSide: BorderSide(color: c, width: 1.5));
    const labelStyle = TextStyle(fontSize: 12.5, fontWeight: FontWeight.w500, color: _muted);
    return InputDecoration(
      label: (showLabel && req)
          ? Text.rich(TextSpan(text: label, children: const [TextSpan(text: ' ●', style: TextStyle(color: Color(0xFFDC2626)))]), style: labelStyle)
          : null,
      labelText: (showLabel && !req) ? label : null,
      hintText: hint,
      floatingLabelBehavior: FloatingLabelBehavior.always,
      labelStyle: labelStyle,
      hintStyle: const TextStyle(fontSize: 13, color: _muted2),
      filled: true,
      fillColor: _fill,
      isDense: true,
      contentPadding: const EdgeInsets.fromLTRB(13, 10, 13, 10),
      suffixIcon: suffixIcon,
      suffixIconConstraints: const BoxConstraints(minWidth: 36, minHeight: 36),
      border: b(Colors.transparent),
      enabledBorder: b(Colors.transparent),
      focusedBorder: b(_primary),
    );
  }

  Widget _txt(TextEditingController ctl, String label, {TextInputType? keyboardType, int maxLines = 1, ValueChanged<String>? onChanged, bool req = false, String? ocrKey, List<TextInputFormatter>? formatters}) {
    return TextFormField(
      controller: ctl,
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: _ink),
      decoration: _dec(label, req: req),
      keyboardType: keyboardType,
      inputFormatters: formatters,
      maxLines: maxLines,
      textInputAction: maxLines == 1 ? TextInputAction.next : TextInputAction.newline,
      // แก้ช่องเอง → ล้างธงเตือน OCR (setState เฉพาะครั้งแรกที่มีธงให้ล้าง)
      onChanged: (v) { onChanged?.call(v); if (ocrKey != null && _ocrConf.remove(ocrKey) != null) setState(() {}); _scheduleAutosave(); },
    );
  }

  Widget _numField(TextEditingController ctl, String label, {bool decimal = false, bool req = false}) {
    return TextFormField(
      controller: ctl,
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: _ink),
      decoration: _dec(label, req: req),
      keyboardType: TextInputType.numberWithOptions(decimal: decimal),
      inputFormatters: decimal ? [FilteringTextInputFormatter.allow(RegExp(r'[\d.]'))] : [FilteringTextInputFormatter.digitsOnly],
      textInputAction: TextInputAction.next,
      onChanged: (_) => _scheduleAutosave(),
    );
  }

  // ── ช่องวันที่: แตะเปิด date picker พ.ศ. + ไอคอนปฏิทิน (req → จุดแดง) ──
  Widget _dateField(TextEditingController ctl, String label, {bool req = false, int defaultYearsAgo = 0, int yearsAhead = 5, bool showLabel = true}) {
    return GestureDetector(
      onTap: () => _showBuddhistDatePicker(ctl, title: label, defaultYearsAgo: defaultYearsAgo, yearsAhead: yearsAhead),
      child: AbsorbPointer(
        child: TextFormField(
          controller: ctl,
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: _ink),
          decoration: _dec(label, req: req, showLabel: showLabel, hint: req ? 'วว/ดด/ปปปป' : null, suffixIcon: const Icon(Icons.calendar_month_outlined, size: 18, color: _muted)),
        ),
      ),
    );
  }

  // แถวสวิตช์ (progressive disclosure — เปิดแล้วโผล่ช่องเพิ่ม)
  Widget _switchRow(String label, bool value, ValueChanged<bool> onChanged) {
    return Container(
      padding: const EdgeInsets.fromLTRB(13, 2, 8, 2),
      decoration: BoxDecoration(color: _fill, borderRadius: BorderRadius.circular(13), border: Border.all(color: _line)),
      child: Row(children: [
        Expanded(child: Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: _ink))),
        Switch(value: value, activeThumbColor: _primary, onChanged: onChanged),
      ]),
    );
  }

  // ── pill chip ──
  Widget _chip(String label, bool selected, VoidCallback onTap, {bool grow = false}) {
    final chip = GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 130),
        // grow chips share row width equally → tighter h-padding so labels fit on one line
        padding: EdgeInsets.symmetric(horizontal: grow ? 8 : 16, vertical: 9),
        // only the full-width (grow) chips center their label; pills size to content
        alignment: grow ? Alignment.center : null,
        decoration: BoxDecoration(
          color: selected ? _primary : Colors.white,
          borderRadius: BorderRadius.circular(11),
          border: Border.all(color: selected ? _primary : _lineStrong, width: 1.5),
        ),
        child: Text(label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: selected ? Colors.white : _muted)),
      ),
    );
    return grow ? Expanded(child: chip) : chip;
  }

  // ── generic string dropdown (filled style) ──
  Widget _dd(String label, String? value, List<String> items, ValueChanged<String?> onChanged, {String hint = '-- ระบุ --', Key? key, bool req = false}) {
    final v = (value != null && value.isNotEmpty && items.contains(value)) ? value : null;
    return DropdownButtonFormField<String>(
      key: key,
      initialValue: v,
      isExpanded: true,
      icon: const Icon(Icons.keyboard_arrow_down_rounded, color: _muted),
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: _ink),
      decoration: _dec(label, req: req),
      hint: req ? Text(hint, style: const TextStyle(fontSize: 13, color: _muted2)) : null,
      items: [
        // ตัวเลือกบนสุด = ล้างค่ากลับเป็น placeholder (dropdown ไม่งั้นล้างค่าเองไม่ได้)
        DropdownMenuItem(value: '', child: Text(hint, style: const TextStyle(fontSize: 14.5, color: _muted2))),
        ...items.map((e) => DropdownMenuItem(value: e, child: Text(e, style: const TextStyle(fontSize: 14.5), overflow: TextOverflow.ellipsis))),
      ],
      // ปล่อย focus ของช่องข้อความที่ค้างอยู่ก่อนเปิดเมนู → พอเลือกเสร็จเมนูปิด จะไม่เด้ง focus/คีย์บอร์ดกลับช่องเดิม
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      onChanged: onChanged,
    );
  }

  // การติดตามงาน — display label ไม่เท่ากับค่าที่เก็บ (ค่าแรกเก็บ 'ไม่มีการนัดหมาย')
  Widget _followupDropdown() {
    const stored = ['ไม่มีการนัดหมาย', 'รอการนัดหมาย', 'มีการนัดหมาย'];
    return DropdownButtonFormField<String>(
      key: ValueKey('fu_$_accFollowup'),
      initialValue: stored.contains(_accFollowup) ? _accFollowup : null,
      isExpanded: true,
      icon: const Icon(Icons.keyboard_arrow_down_rounded, color: _muted),
      style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: _ink),
      decoration: _dec('การติดตามงาน'),
      hint: const Text('-- ระบุ --', style: TextStyle(fontSize: 13, color: _muted2)),
      items: const [
        DropdownMenuItem(value: '', child: Text('-- ระบุ --', style: TextStyle(fontSize: 14.5, color: _muted2))),
        DropdownMenuItem(value: 'ไม่มีการนัดหมาย', child: Text('ไม่มีนัดหมาย', style: TextStyle(fontSize: 14.5))),
        DropdownMenuItem(value: 'รอการนัดหมาย', child: Text('รอการนัดหมาย', style: TextStyle(fontSize: 14.5))),
        DropdownMenuItem(value: 'มีการนัดหมาย', child: Text('มีการนัดหมาย', style: TextStyle(fontSize: 14.5))),
      ],
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      onChanged: (v) => setState(() => _accFollowup = v ?? ''),
    );
  }

  // เพศ — ปุ่มเลือก ชาย/หญิง แบบเหลี่ยม (เก็บค่าเป็น M/F) สูง 48 เท่า dropdown คำนำหน้า → อยู่แถวเดียวกันพอดี
  Widget _genderChips() => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _fieldLabel('เพศ', req: true),
          const SizedBox(height: 6),
          Row(children: [
            _genderBtn('ชาย', 'M'),
            const SizedBox(width: 8),
            _genderBtn('หญิง', 'F'),
          ]),
        ],
      );

  Widget _genderBtn(String label, String code) {
    final sel = _driverGender == code;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() {
          _driverGender = code;
          if (_driverTitle == '0' || _driverTitle.isEmpty) {
            _driverTitle = code == 'M' ? 'นาย' : 'นางสาว';
          }
          _ocrConf.remove('driver_title');
        }),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 130),
          height: 48,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: sel ? _primary : Colors.white,
            borderRadius: BorderRadius.circular(11),
            border: Border.all(color: sel ? _primary : _lineStrong, width: 1.5),
          ),
          child: Text(label, style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600, color: sel ? Colors.white : _muted)),
        ),
      ),
    );
  }

  // คำนำหน้า — label ภายนอก + dropdown เตี้ย (สูง 48) ให้อยู่แถวเดียว/ตรงกับปุ่มเพศ และแคบลง
  Widget _titleDropdown() {
    const items = ['0', ...kTitles];   // master ที่เดียว
    final labels = {'0': '-- ระบุ --', for (final t in kTitles) t: t};
    OutlineInputBorder b(Color c) => OutlineInputBorder(borderRadius: BorderRadius.circular(13), borderSide: BorderSide(color: c, width: 1.5));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _fieldLabel('คำนำหน้า', req: true),
        const SizedBox(height: 6),
        SizedBox(
          height: 48,
          child: DropdownButtonFormField<String>(
            key: ValueKey('title_$_driverTitle'),
            initialValue: items.contains(_driverTitle) ? _driverTitle : '0',
            isExpanded: true,
            icon: const Icon(Icons.keyboard_arrow_down_rounded, color: _muted),
            style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w500, color: _ink),
            decoration: InputDecoration(
              filled: true,
              fillColor: _fill,
              isDense: true,
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 13),
              border: b(Colors.transparent),
              enabledBorder: b(Colors.transparent),
              focusedBorder: b(_primary),
            ),
            // ยังไม่เลือก ('0') → "-- ระบุ --" สีเทาจางแบบ placeholder (บังคับกรอก)
            selectedItemBuilder: (context) => items.map((e) => Align(alignment: Alignment.centerLeft, child: Text(labels[e]!, style: TextStyle(fontSize: 14.5, color: e == '0' ? _muted2 : _ink), overflow: TextOverflow.ellipsis))).toList(),
            items: items.map((e) => DropdownMenuItem(value: e, child: Text(labels[e]!, style: const TextStyle(fontSize: 14.5), overflow: TextOverflow.ellipsis))).toList(),
            onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
            onChanged: (v) => setState(() { _driverTitle = v ?? '0'; _ocrConf.remove('driver_title'); }),
          ),
        ),
      ],
    );
  }

  Widget _birthdateField() => _dateField(_driverBirthdateCtl, 'วันเกิด', req: true, yearsAhead: 0, defaultYearsAgo: 30);

  Widget _relationDropdown() {
    const rel = kRelations;   // master ที่เดียว
    return _dd('ความสัมพันธ์', _driverRelationCtl.text, rel,
        (v) => setState(() => _driverRelationCtl.text = v ?? ''),
        req: true, key: ValueKey('rel_${_driverRelationCtl.text}'));
  }

  // จังหวัด/เขต-อำเภอ "ที่เกิดเหตุ" — คู่เดียวกับหน้าผู้ขับขี่ (asset thai_provinces.json
  // ตรง master EMCS verbatim) เปลี่ยนจังหวัดแล้วล้างอำเภอ กันคู่ที่ไม่เข้ากัน
  Widget _accProvinceDropdown() => _dd('จังหวัด', _accProvinceCtl.text, _provinceNames,
      (v) => setState(() { _accProvinceCtl.text = v ?? ''; _accDistrictCtl.text = ''; _syncSurveyFromAcc(); }),
      hint: 'เลือกจังหวัด', req: true, key: ValueKey('ap_${_accProvinceCtl.text}'));

  Widget _accDistrictDropdown() {
    final districts = _provincesData[_accProvinceCtl.text] ?? const <String>[];
    return _dd('เขต/อำเภอ', _accDistrictCtl.text, districts,
        (v) => setState(() { _accDistrictCtl.text = v ?? ''; _syncSurveyFromAcc(); }),
        hint: 'เลือกเขต/อำเภอ', req: true,
        key: ValueKey('ad2_${_accProvinceCtl.text}_${_accDistrictCtl.text}'));
  }

  // ── สถานที่ออกตรวจสอบ (10/09/69) ──
  /// ติ๊กอยู่ = คัดลอกสถานที่/จังหวัด/เขต-อำเภอ ที่เกิดเหตุ มาใส่ชุดตรวจสอบ (เรียกทุกครั้งที่ชุดเกิดเหตุเปลี่ยน)
  void _syncSurveyFromAcc() {
    if (!_survSameAsAcc) return;
    _survPlaceCtl.text = _accPlaceCtl.text;
    _survProvinceCtl.text = _accProvinceCtl.text;
    _survDistrictCtl.text = _accDistrictCtl.text;
  }

  Widget _sameAsAccTile() => CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        dense: true,
        controlAffinity: ListTileControlAffinity.leading,
        title: const Text('สถานที่เดียวกับที่เกิดเหตุ', style: TextStyle(fontSize: 14.5, fontWeight: FontWeight.w600)),
        subtitle: Text(
          _survSameAsAcc
              ? 'คัดลอกจากสถานที่เกิดเหตุให้แล้ว แก้สถานที่เกิดเหตุจะตามไปด้วย'
              : 'ติ๊กถ้าออกตรวจสอบที่เดียวกับที่เกิดเหตุ ไม่ต้องกรอกซ้ำ',
          style: TextStyle(fontSize: 12, color: Colors.grey.shade600),
        ),
        value: _survSameAsAcc,
        onChanged: (v) => setState(() { _survSameAsAcc = v ?? false; _syncSurveyFromAcc(); }),
      );

  Widget _survProvinceDropdown() => _dd('จังหวัดที่ตรวจสอบ', _survProvinceCtl.text, _provinceNames,
      (v) => setState(() { _survProvinceCtl.text = v ?? ''; _survDistrictCtl.text = ''; }),
      hint: 'เลือกจังหวัด', req: true, key: ValueKey('sp_${_survProvinceCtl.text}'));

  Widget _survDistrictDropdown() {
    final districts = _provincesData[_survProvinceCtl.text] ?? const <String>[];
    return _dd('อำเภอที่ตรวจสอบ', _survDistrictCtl.text, districts,   // 'เขต/อำเภอ…' ยาวจนจุดแดงตกบรรทัดในครึ่งจอ
        (v) => setState(() => _survDistrictCtl.text = v ?? ''),
        hint: 'เลือกเขต/อำเภอ', req: true,
        key: ValueKey('sd_${_survProvinceCtl.text}_${_survDistrictCtl.text}'));
  }

  Widget _districtDropdown() {
    final districts = (_driverProvinceCtl.text.isNotEmpty && _provincesData.containsKey(_driverProvinceCtl.text))
        ? _provincesData[_driverProvinceCtl.text]!
        : <String>[];
    // req: EMCS บังคับ ddlDri_DistrictID ใน vlidSurvey (เดิมไม่มีจุดแดง → ปล่อยว่างแล้วส่งได้)
    return _dd('เขต/อำเภอ', _driverDistrictCtl.text, districts,
        (v) => setState(() { _driverDistrictCtl.text = v ?? ''; _ocrConf.remove('driver_district'); }),
        hint: 'เลือกเขต/อำเภอ', req: true, key: ValueKey('dd_${_driverProvinceCtl.text}_${_driverDistrictCtl.text}'));
  }

  Widget _licenseTypeDropdown() {
    // ตัด "ไม่มีใบขับขี่" ออก — สวิตช์ "มีใบขับขี่" คุมสถานะนี้แทนแล้ว (กันขัดกันเอง)
    return _dd('ประเภทใบขับขี่', _driverLicenseTypeCtl.text, _licenseTypeOptions.where((t) => t != 'ไม่มีใบขับขี่').toList(),
        (v) => setState(() { _driverLicenseTypeCtl.text = v ?? ''; _ocrConf.remove('driver_license_type'); }),
        key: ValueKey('lt_${_driverLicenseTypeCtl.text}'));
  }

  Widget _scanRow() {
    Widget btn(IconData icon, String label, VoidCallback? onTap) => OutlinedButton.icon(
          onPressed: onTap,
          icon: Icon(icon, size: 18),
          label: Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500)),
          style: OutlinedButton.styleFrom(
            foregroundColor: _primary,
            backgroundColor: _tint,
            side: BorderSide.none,
            padding: const EdgeInsets.symmetric(vertical: 13),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13)),
          ),
        );
    return Row(children: [
      Expanded(child: btn(Icons.credit_card, 'สแกนบัตรประชาชน', _ocrBusy ? null : () => _scanDriverDoc('idcard'))),
      const SizedBox(width: 10),
      Expanded(child: btn(Icons.badge_outlined, 'สแกนใบขับขี่', _ocrBusy ? null : () => _scanDriverDoc('license'))),
    ]);
  }

  // ── damage list (collapsible) ──
  Widget _damageList() {
    return Container(
      decoration: BoxDecoration(color: _fill, borderRadius: BorderRadius.circular(13), border: Border.all(color: _line)),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          controller: _damageExpCtl,
          initiallyExpanded: _damageItems.isNotEmpty, // อ่านครั้งแรกตอน mount เท่านั้น
          tilePadding: const EdgeInsets.symmetric(horizontal: 13),
          childrenPadding: const EdgeInsets.fromLTRB(13, 0, 13, 13),
          leading: const Icon(Icons.build_circle_outlined, color: _primary, size: 20),
          title: Text('รายการชิ้นส่วนเสียหาย (${_filledDamageItems().length})', style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: _primary)),
          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
            GestureDetector(
              onTap: _addDamageItem,
              child: Container(
                padding: const EdgeInsets.all(4),
                decoration: BoxDecoration(color: _tint, borderRadius: BorderRadius.circular(8)),
                child: const Icon(Icons.add, size: 20, color: _primary),
              ),
            ),
            const SizedBox(width: 4),
            const Icon(Icons.expand_more, color: _muted),
          ]),
          children: [
            if (_damageItems.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 14),
                child: Text('กด + เพื่อเพิ่มรายการชิ้นส่วนที่เสียหาย', style: TextStyle(fontSize: 12, color: Colors.grey.shade500)),
              ),
            for (int i = 0; i < _damageItems.length; i++) ...[
              if (i > 0) const Divider(color: _line, height: 18),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('ชิ้นส่วนที่ ${i + 1}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: _primary)),
                  GestureDetector(
                    onTap: () => _removeDamageItem(i),
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: BoxDecoration(color: Colors.red.shade50, shape: BoxShape.circle),
                      child: Icon(Icons.close, size: 14, color: Colors.red.shade700),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),
              TextFormField(
                // key ตาม "ตัวรายการ" ไม่ใช่ index — เดิมลบรายการแล้ว field ที่ index เดิมยังโชว์ข้อความเก่า (ไม่ตรงข้อมูล)
                key: ObjectKey(_damageItems[i]),
                initialValue: _damageItems[i]['part'],
                style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: _ink),
                decoration: InputDecoration(
                  hintText: 'ชิ้นส่วน เช่น กันชนหน้า, ประตูหน้า',
                  hintStyle: const TextStyle(fontSize: 13, color: _muted2),
                  filled: true,
                  fillColor: Colors.white,
                  isDense: true,
                  contentPadding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: _line)),
                  enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: _line)),
                  focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: _primary, width: 1.5)),
                ),
                onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
                onChanged: (v) => _updateDamageItem(i, 'part', v),
              ),
              const SizedBox(height: 8),
              // ชิ้นส่วนที่ EMCS ไม่มีปุ่มเลือกด้าน → ไม่ต้องโชว์ (สำเนาที่ 4 ของ UI เดียวกัน
              // — เจอตอนกรอกงานจริง หลังแก้ 3 จุดแรกแล้วยังโผล่อยู่ในรายการด้านล่างแผนภาพ)
              if (!kNoSideParts.contains((_damageItems[i]['part'] ?? '').trim()))
              Row(children: [
                const Text('ตำแหน่ง ', style: TextStyle(fontSize: 11, color: _muted)),
                ...['L', 'R', 'A'].map((pos) {
                  const labels = {'L': 'ซ้าย', 'R': 'ขวา', 'A': 'ทั้งหมด'};
                  final selected = _damageItems[i]['pos'] == pos;
                  return Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: GestureDetector(
                      onTap: () => _updateDamageItem(i, 'pos', selected ? '' : pos),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(color: selected ? _primary : Colors.white, borderRadius: BorderRadius.circular(11), border: Border.all(color: selected ? _primary : _lineStrong)),
                        child: Text(labels[pos]!, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: selected ? Colors.white : _muted)),
                      ),
                    ),
                  );
                }),
              ]),
              const SizedBox(height: 6),
              Row(children: [
                const Text('ระดับ ', style: TextStyle(fontSize: 11, color: _muted)),
                ...['L', 'M', 'H', 'X'].map((lv) {
                  const labels = {'L': 'ต่ำ', 'M': 'กลาง', 'H': 'สูง', 'X': 'สูงมาก'};
                  const colors = {'L': Colors.lightGreen, 'M': Colors.orange, 'H': Colors.red, 'X': Colors.purple};
                  final selected = _damageItems[i]['level'] == lv;
                  return Padding(
                    padding: const EdgeInsets.only(right: 4),
                    child: GestureDetector(
                      onTap: () => _updateDamageItem(i, 'level', selected ? '' : lv),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                        decoration: BoxDecoration(color: selected ? colors[lv] : Colors.white, borderRadius: BorderRadius.circular(11), border: Border.all(color: selected ? colors[lv]! : _lineStrong)),
                        child: Text(labels[lv]!, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: selected ? Colors.white : colors[lv])),
                      ),
                    ),
                  );
                }),
              ]),
            ],
          ],
        ),
      ),
    );
  }

  Widget _damageDescField() {
    return ConstrainedBox(
      constraints: const BoxConstraints(maxHeight: 130),
      child: Scrollbar(
        thumbVisibility: true,
        child: TextFormField(
          controller: _damageDescCtl,
          style: const TextStyle(fontSize: 14.5, fontWeight: FontWeight.w500, color: _ink),
          decoration: _dec('รายละเอียดความเสียหาย'),
          maxLines: null,
          onChanged: (_) => _scheduleAutosave(),
        ),
      ),
    );
  }

  Widget _addPhotoTile() => Column(children: [
        Expanded(
          child: InkWell(
            onTap: _takePhoto,
            borderRadius: BorderRadius.circular(13),
            child: Container(
              width: double.infinity,
              decoration: BoxDecoration(color: _fill, border: Border.all(color: _lineStrong), borderRadius: BorderRadius.circular(13)),
              child: const Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                Icon(Icons.add_a_photo_outlined, size: 26, color: _muted),
                SizedBox(height: 4),
                Text('เพิ่มรูป', style: TextStyle(color: _muted, fontSize: 12, fontWeight: FontWeight.w500)),
              ]),
            ),
          ),
        ),
        const SizedBox(height: 3),
        const Text(' ', style: TextStyle(fontSize: 9.5)),
      ]);

  Widget _buildPhotoGrid() {
    final vis = _visiblePhotoIndices();
    final selMode = _imgSel != null;
    final count = vis.length + (selMode ? 0 : 1); // ซ่อนช่อง "ถ่ายรูป" ตอนเลือกหลายรูป
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 10, mainAxisSpacing: 10, childAspectRatio: 0.78),
      itemCount: count,
      itemBuilder: (context, gi) {
        if (!selMode && gi == 0) return _addPhotoTile(); // ปุ่มถ่ายรูปอยู่ซ้ายบนสุดเสมอ
        final index = vis[selMode ? gi : gi - 1];
        final path = _photoPaths[index];
        final cat = _photoCat[path] ?? _imgCatDefault;
        final time = _photoTimeLabel(path);
        final selected = _imgSel?.contains(index) ?? false;
        return GestureDetector(
          onTap: () {
            if (selMode) {
              setState(() { selected ? _imgSel!.remove(index) : _imgSel!.add(index); });
            } else {
              _openPhotoSheet(index);
            }
          },
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(
              child: Stack(children: [
                // cacheWidth: thumbnail ในกริด — เดิม decode เต็ม resolution กล้องทุกใบ (แรมพุ่ง/กระตุก)
                Positioned.fill(child: ClipRRect(borderRadius: BorderRadius.circular(13), child: Image.file(File(path), fit: BoxFit.cover, cacheWidth: 360))),
                if (selMode && selected)
                  Positioned.fill(child: ClipRRect(borderRadius: BorderRadius.circular(13), child: Container(color: _primary.withValues(alpha: 0.20)))),
                if (selMode)
                  Positioned(top: 4, left: 4, child: Icon(selected ? Icons.check_circle : Icons.radio_button_unchecked, size: 22, color: selected ? _primary : Colors.white)),
                // ปุ่มเลือกหมวด (แตะเพื่อเปลี่ยนหมวดรูปเร็ว ๆ)
                if (!selMode)
                  Positioned(
                    bottom: 4, left: 4, right: 4,
                    child: GestureDetector(
                      onTap: () => _changePhotoCat(index),
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(color: _ink.withValues(alpha: 0.72), borderRadius: BorderRadius.circular(6)),
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          Flexible(child: Text(cat, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 9, color: Colors.white, fontWeight: FontWeight.w600))),
                          const Icon(Icons.arrow_drop_down, size: 13, color: Colors.white),
                        ]),
                      ),
                    ),
                  ),
              ]),
            ),
            const SizedBox(height: 3),
            Text(time.isEmpty ? ' ' : time, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 9.5, color: _muted)),
          ]),
        );
      },
    );
  }

  static const _accCauseOptions = [
    'ชนท้ายคู่กรณี', 'ชนคนบาดเจ็บ/เสียชีวิต', 'ชนรถคู่กรณีมีการบาดเจ็บ/เสียชีวิต',
    'ชน/เสียหลักหมุน/พลิกคว่ำ/ตกข้างทางมีผู้บาดเจ็บ/เสียชีวิต',
    'ชนทรัพย์สินคู่กรณี', 'ชนคู่กรณีในช่องทางสวน', 'ชนคู่กรณีและถูกชน',
    'ถอยชนคู่กรณี', 'เฉี่ยว/เบียดคู่กรณี', 'เปิดประตูชนรถคู่กรณี',
    'ชนคู่กรณี/หรือถูกชนและไม่ทราบคู่กรณี', 'เลี้ยว/กลับรถ/เปลี่ยนช่องทางชนคู่กรณี',
    'ชนรถคู่กรณีไม่คุ้มครองรถประกัน', 'ชนวัสดุ/สิ่งของ เช่น เสา,กำแพง,ประตู ฯลฯ',
    'ชนฟุตบาท', 'ชนทรัพย์สินตนเอง', 'ชนสัตว์',
    'ทรัพย์สินหล่นใส่คู่กรณี', 'ผู้โดยสารตกรถ',
    'เกี่ยวสายไฟฟ้า/โทรศัพท์/สายน้ำมัน', 'เสียหลักล้ม',
    'ฝากระโปรงหน้าเปิด', 'ยางระเบิด', 'ตกหลุม',
    'ถูกน้ำมันเบรคราด', 'ประมาทร่วม', 'ต่างฝ่ายต่างซ่อม',
    'ช่วยเหลือมนุษยธรรม', 'รอคู่กรณีติดต่อ', 'รอตรวจสอบใบขับขี่',
    'แก๊สระเบิด', 'คู่กรณีชนท้าย', 'คู่กรณีชนแล้วหลบหนี',
    'คู่กรณีเฉี่ยวชน', 'คู่กรณีเฉี่ยวชนบุคคลในรถประกันบาดเจ็บ/เสียชีวิต',
    'ชนสัตว์และเรียกร้องเจ้าของ', 'คู่กรณีเปิดประตูชนรถประกัน',
    'คู่กรณีถอยชน', 'คู่กรณีชน/ทรัพย์สินผู้เอาประกันเดียวกัน',
    'คู่กรณีกลั่นแกล้ง', 'ทรัพย์สินคู่กรณีหล่นใส่',
    'เด็กปั๊มประมาทลืมปลดสายน้ำมัน',
    'ความเสียหายของรถประกันทีเกิดจากเหตุภายนอก',
    'รถหายโดยการฉ้อฉล ตามสัญญาประกันภัย(A.P.HONDA)',
    'ไฟไหม้จากเหตุภายนอก', 'ถูกก้อนหิน', 'ถูกขูดขีด/กลั่นแกล้ง',
    'วัตถุหล่นใส่', 'รถหายตามสัญญาเช่าซื้อ', 'รถหายโดยการโจรกรรม',
    'ไฟไหม้โดยระบบของตัวรถยนต์', 'ไฟไหม้ที่เกิดจากการชน',
    'น้ำท่วม', 'ภัยธรรมชาติอื่น ๆ', 'ลักทรัพย์อุปกรณ์/ส่วนควบ',
    'ภัยอื่น ๆ', 'ภัยก่อการร้าย',
    'ไม่พบรถประกัน', 'ไม่พบรถคู่กรณี', 'ไม่พบรถประกัน/คู่กรณี',
    'รอผลคดี', 'รอตรวจสอบกรมธรรม์', 'รอเซ็นเคลม',
    'รอรายงานอุบัติเหตุ', 'รอรถประกันติดต่อ',
    'เคลมซ้ำ', 'เปิดเคลมผิดพลาด',
    'ฉ้อฉลจากการชน', 'รถหายโดยการฉ้อฉล',
    'ไฟไหม้โดยการฉ้อฉล', 'การยึดรถ ( A.P.HONDA )',
    'เสียหายขณะจอดอยู่', 'กระจกบังลมหน้าแตก', 'กระจกอื่นๆ แตก',
    'รถประกันชนรถคู่กรณีไม่เอาความ', 'สูญเสียการควบคุม',
    'หนูกัดสายไฟ', 'การเสียชีวิตอ้นเกิดจากสาเหตุอื่นๆ',
    'การเสียชีวิตอันเกิดจาการใช้รถ',
  ];

  // sync EMCS master ddlLoss_ID (verbatim + ลำดับตาม EMCS) 2026-07-25
  static const _accDamageOptions = [
    'เคลมแห้ง', 'กระจกแตก', 'กระจกอื่นๆ แตก', 'ชนคู่กรณีเสียหาย',
    'ถูกคู่กรณีชน', 'ตกถนน', 'พลิกคว่ำ', 'รถประกันชนรถคู่กรณีไม่เอาความ',
    'เฉี่ยวชนวัสดุ', 'ถูกขูดขีดกลั่นแกล้ง', 'ถูกลักอุปกรณ์ส่วนควบ',
    'วัสดุหล่นใส่', 'ยางระเบิด', 'จอดไว้ถูกชนไม่ทราบคู่กรณี',
    'หนูกัดสายไฟ', 'รถหาย', 'รถประกันไฟไหม้', 'น้ำท่วมเสียหาย',
    'ชนคนบาดเจ็บ', 'ผู้โดยสารประกันตกรถ', 'เสียหายทั้งหมด',
  ];
}

// ช่องเวลา: 2 กล่อง (ชม. : นาที) เก็บค่ารวมเป็น "HH:mm" ใน controller เดียว (target)
class _TimeField extends StatefulWidget {
  final TextEditingController target;
  final bool showLabel;
  final VoidCallback? onChanged; // target เขียนแบบ programmatic — ฟอร์มต้องรับสัญญาณไป autosave เอง
  const _TimeField(this.target, {super.key, this.showLabel = true, this.onChanged});
  @override
  State<_TimeField> createState() => _TimeFieldState();
}

class _TimeFieldState extends State<_TimeField> {
  late final TextEditingController _hh;
  late final TextEditingController _mm;
  bool _selfWrite = false; // กัน listener สะท้อนค่าที่ตัวเองเพิ่งเขียน (loop)

  @override
  void initState() {
    super.initState();
    final p = widget.target.text.split(':');
    _hh = TextEditingController(text: p.isNotEmpty && p[0].trim().isNotEmpty ? p[0].trim() : '');
    _mm = TextEditingController(text: p.length > 1 && p[1].trim().isNotEmpty ? p[1].trim() : '');
    // resync เมื่อ target ถูกเขียนจากภายนอก (server prefill/draft มาช้ากว่าเปิดหน้า)
    // — เดิม copy ครั้งเดียวใน initState: ค่าที่ prefill ทีหลังไม่โชว์ ผู้ใช้ไม่รู้ว่ามีค่าซ่อนอยู่
    widget.target.addListener(_onTargetChanged);
  }

  void _onTargetChanged() {
    if (_selfWrite || !mounted) return;
    final p = widget.target.text.split(':');
    final h = p.isNotEmpty ? p[0].trim() : '';
    final m = p.length > 1 ? p[1].trim() : '';
    if (h == _hh.text.trim() && m == _mm.text.trim()) return;
    setState(() { _hh.text = h; _mm.text = m; });
  }

  @override
  void dispose() {
    widget.target.removeListener(_onTargetChanged);
    _hh.dispose();
    _mm.dispose();
    super.dispose();
  }

  void _sync() {
    final h = _hh.text.trim();
    final m = _mm.text.trim();
    _selfWrite = true;
    try {
      widget.target.text = (h.isEmpty && m.isEmpty) ? '' : '$h:$m';
    } finally {
      _selfWrite = false;
    }
    widget.onChanged?.call();
  }

  Widget _box(TextEditingController c, String hint) {
    OutlineInputBorder b(Color col) => OutlineInputBorder(borderRadius: BorderRadius.circular(11), borderSide: BorderSide(color: col, width: 1.5));
    return SizedBox(
      width: 50,
      child: TextField(
        controller: c,
        textAlign: TextAlign.center,
        keyboardType: TextInputType.number,
        maxLength: 2,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly],
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: _ink),
        onChanged: (_) => _sync(),
        decoration: InputDecoration(
          counterText: '',
          hintText: hint,
          hintStyle: const TextStyle(fontSize: 13, color: _muted2),
          filled: true,
          fillColor: _fill,
          isDense: true,
          contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 12),
          border: b(Colors.transparent),
          enabledBorder: b(Colors.transparent),
          focusedBorder: b(_primary),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final boxes = Row(mainAxisSize: MainAxisSize.min, children: [
      _box(_hh, 'ชม.'),
      const Padding(
        padding: EdgeInsets.symmetric(horizontal: 4),
        child: Text(':', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: _muted)),
      ),
      _box(_mm, 'นาที'),
    ]);
    if (!widget.showLabel) return boxes;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(top: 2, bottom: 2),
          child: Text('เวลา', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: _ink)),
        ),
        const SizedBox(height: 6),
        boxes,
      ],
    );
  }
}

/// config หมวดรูปที่ผูกกับ record list (คู่กรณี/ผู้บาดเจ็บ/ทรัพย์สิน) — ให้ picker เลือก "คันที่/คนที่/ชิ้นที่ N" + เพิ่มรายการได้
class _RecordCat {
  final List<Map<String, dynamic>> list;                  // ลิสต์จริงในฟอร์ม (_opponents/_injured/_property)
  final String word;                                      // คำนำหน้าเลขในป้ายรูป: "คันที่"/"คนที่"/"ชิ้นที่"
  final String noun;                                      // คำเรียกรายการสั้น ๆ: "คัน"/"คน"/"ชิ้น"
  final String addNoun;                                   // ชื่อหมวดสำหรับปุ่มเพิ่ม: "คู่กรณี"/"ผู้บาดเจ็บ"/"ทรัพย์สิน"
  final String Function(Map<String, dynamic> m, int i) label; // ป้ายรายการในชีตเลือก
  final int max = 20;                                     // เพิ่มได้สูงสุดต่อหมวด
  const _RecordCat(this.list, this.word, this.noun, this.addNoun, this.label);
}
