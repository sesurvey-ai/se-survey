import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:provider/provider.dart';
import '../providers/case_provider.dart';
import '../models/case_model.dart';
import '../config/api_config.dart';
import 'package:geolocator/geolocator.dart';
import '../services/api_service.dart';
import '../services/location_service.dart';
import '../services/auth_token.dart';

class CaseDetailScreen extends StatefulWidget {
  final int caseId;

  const CaseDetailScreen({super.key, required this.caseId});

  @override
  State<CaseDetailScreen> createState() => _CaseDetailScreenState();
}

class _CaseDetailScreenState extends State<CaseDetailScreen> {
  Map<String, dynamic>? _report;
  bool _loadingDetail = true;
  bool _detailLoadFailed = false; // โหลดรายละเอียดไม่สำเร็จ (เน็ตล่ม) — โชว์ error+retry แทนจอว่างเงียบ
  Map<String, List<String>> _provincesData = {};
  bool _arrivalConfirmed = false;
  bool _checkingArrival = true; // กำลังเช็คว่าเคยถ่ายรูปยืนยันถึงที่เกิดเหตุไว้แล้วหรือยัง (กันปุ่มกระพริบ arrival→survey)
  // เช็คสถานะ arrival ไม่สำเร็จ — ห้ามเดาว่า "ยังไม่ยืนยัน" แล้วโชว์ prompt ถ่ายรูปซ้ำ
  // (คนที่ยืนยันแล้วจะถูกหลอกให้ถ่าย/ยืนยันใหม่ + เวลาถึงที่เกิดเหตุใน report ถูกเขียนทับ)
  bool _arrivalCheckFailed = false;
  String? _arrivalPhotoPath;
  bool _uploadingArrival = false;
  final _picker = ImagePicker();

  @override
  void initState() {
    super.initState();
    _fetchDetail();
    _loadProvinces();
  }

  Future<void> _loadProvinces() async {
    try {
      final raw = await DefaultAssetBundle.of(context).loadString('assets/thai_provinces.json');
      final Map<String, dynamic> parsed = jsonDecode(raw);
      if (!mounted) return; // back ออกก่อนโหลดเสร็จ → กัน setState หลัง dispose
      setState(() {
        _provincesData = parsed.map((k, v) => MapEntry(k, List<String>.from(v)));
      });
    } catch (e) {
      debugPrint('Failed to load provinces: $e');
    }
  }

  Future<void> _fetchDetail() async {
    setState(() {
      _loadingDetail = true;
      _detailLoadFailed = false;
    });
    try {
      final caseProvider = context.read<CaseProvider>();
      final report = await caseProvider.fetchCaseDetail(widget.caseId);
      if (!mounted) return;
      setState(() {
        _report = report;
        _loadingDetail = false;
        // fetchCaseDetail throw เมื่อโหลดพลาด → มาถึงตรงนี้ = สำเร็จ (report null = เคสยังไม่มีรายงาน
        // ซึ่งไม่ใช่ error — การ์ดรถแค่ไม่แสดง เหมือนพฤติกรรมเดิม)
        _detailLoadFailed = false;
      });
      // Check if arrival photo already exists
      _checkArrivalPhotos();
      // Download OCR images to local folder
      _downloadCaseImages();
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loadingDetail = false;
        _detailLoadFailed = true;
        _checkingArrival = false;
        // fetch พัง = _checkArrivalPhotos ยังไม่ได้รัน → สถานะยืนยันถึงที่เกิดเหตุ "ไม่รู้"
        // ต้องโชว์ปุ่มลองใหม่ ไม่ใช่ปล่อยตกไป prompt ถ่ายรูป (ถ่ายซ้ำ = ทับเวลาถึงที่เกิดเหตุจริง)
        _arrivalCheckFailed = true;
      });
    }
  }

  Future<void> _downloadCaseImages() async {
    try {
      final images = _report?['case_images'];
      if (images == null || images is! List || images.isEmpty) return;
      final caseFolder = await _getCaseFolder();
      final httpClient = HttpClient();
      for (final img in images) {
        final filePath = img['file_path']?.toString() ?? '';
        if (filePath.isEmpty) continue;
        final fileName = filePath.split('/').last;
        final localFile = File('$caseFolder/$fileName');
        // เก็บกวาด .part ตกค้างจากรอบที่โดน kill กลางดาวน์โหลด
        try { final p = File('${localFile.path}.part'); if (p.existsSync()) p.deleteSync(); } catch (_) {}
        if (localFile.existsSync()) continue; // skip if already downloaded
        try {
          final url = '${ApiConfig.baseUrl}/uploads/$filePath';
          final request = await httpClient.getUrl(Uri.parse(url));
          AuthToken.imageHeaders.forEach(request.headers.set); // /uploads ต้องผ่าน auth
          final response = await request.close();
          if (response.statusCode == 200) {
            // stream ลงไฟล์ .part แล้วค่อย rename — เดิม fold ใส่ List<int> (copy ซ้ำ ~8 เท่า
            // ของขนาดรูปบน UI isolate); เขียนตรงลงชื่อจริงก็ไม่ได้: โดน kill กลางทางจะเหลือไฟล์ครึ่งเดียว
            // ที่ skip-check (existsSync) มองว่าโหลดแล้วตลอดกาล + ถูกกวาดขึ้น server ตอนส่งงาน
            final tmpFile = File('${localFile.path}.part');
            final sink = tmpFile.openWrite();
            try {
              await response.pipe(sink);
              tmpFile.renameSync(localFile.path);
            } catch (_) {
              // close() คืน done ของ sink = throw error เดิมซ้ำ — ต้องกลืน ไม่งั้น delete ข้างล่างไม่รัน
              try { await sink.close(); } catch (_) {}
              try { if (tmpFile.existsSync()) tmpFile.deleteSync(); } catch (_) {}
              rethrow;
            }
          } else {
            await response.drain<void>();
          }
        } catch (_) {}
      }
      httpClient.close();
    } catch (_) {}
  }

  Future<void> _checkArrivalPhotos() async {
    if (mounted && !_checkingArrival) setState(() => _checkingArrival = true);
    var failed = false;
    try {
      final apiService = ApiService();
      final res = await apiService.getArrivalPhotos(widget.caseId);
      if (res.data['success'] == true) {
        final List photos = res.data['data'] ?? [];
        // มี record arrival = ยืนยันถึงที่เกิดเหตุแล้ว — ไม่ดึงรูปจาก server
        // (ไฟล์รูปจริงยังไม่ถูกอัปโหลดจนกว่าจะส่งงาน → URL จะ 404 ในสถานะนี้เสมอ)
        if (photos.isNotEmpty && mounted) {
          setState(() => _arrivalConfirmed = true);
        }
      } else {
        failed = true;
      }
    } catch (_) {
      failed = true; // เช็คไม่ได้ (เน็ตล่ม) ≠ ยังไม่ยืนยัน — โชว์ปุ่มลองใหม่แทน prompt ถ่ายรูป
    } finally {
      if (mounted) {
        setState(() {
          _checkingArrival = false;
          _arrivalCheckFailed = failed;
        });
      }
    }
  }

  Future<String> _getCaseFolder() async {
    // ขอ storage permission บน Android
    if (Platform.isAndroid) {
      final status = await Permission.manageExternalStorage.request();
      if (!status.isGranted) {
        debugPrint('Storage permission denied');
      }
    }
    // โฟลเดอร์รูปประจำเคสผูกกับ case id (immutable) — สอดคล้องกับหน้าฟอร์มสำรวจ/การอัปโหลด
    // (เดิมตั้งชื่อตามเลขเคลมที่แก้ไขได้ → รูป arrival/OCR หลุดจากโฟลเดอร์ที่ถูกอัปโหลด)
    final downloadDir = Directory(
        '/storage/emulated/0/Download/SE_Survey/case_${widget.caseId}/job_${widget.caseId}');
    if (!downloadDir.existsSync()) downloadDir.createSync(recursive: true);
    return downloadDir.path;
  }

  /// ขอพิกัดแบบ **ไม่ค้าง** — จับไม่ได้ก็คืน null แล้วให้คนเลือกพื้นที่เอง
  /// (ในอาคาร/ห้างจับไม่ติดเป็นเรื่องปกติ ห้ามให้ช่างติดอยู่ตรงนี้)
  Future<Position?> _tryGetPosition() async {
    try {
      return await LocationService().getCurrentPosition().timeout(const Duration(seconds: 10));
    } catch (_) {
      return null;
    }
  }

  /// หน้าจอ "ยืนยันพื้นที่ที่ออกสำรวจ" — GPS เติมให้ก่อน คนแก้ได้ แล้วกดยืนยัน
  /// คืน null = กดยกเลิก · คืน (จังหวัด, อำเภอ) = ค่าที่คนยืนยัน
  Future<(String, String)?> _confirmArrivalArea(String? gpsProv, String? gpsDist, {required bool hasGps}) async {
    final names = _provincesData.keys.toList()..sort();
    String prov = (gpsProv != null && names.contains(gpsProv)) ? gpsProv : '';
    String dist = '';
    if (prov.isNotEmpty && gpsDist != null && (_provincesData[prov] ?? []).contains(gpsDist)) dist = gpsDist;

    return showModalBottomSheet<(String, String)?>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(builder: (ctx, setSheet) {
        final districts = _provincesData[prov] ?? <String>[];
        return Padding(
          // ⛔ ต้องเผื่อ **แถบนำทางของ Android** ด้วย (padding.bottom) ไม่ใช่แค่คีย์บอร์ด
          //    (viewInsets) — ไม่งั้นปุ่มยืนยันไปอยู่ใต้แถบนำทาง กดไม่โดน (เจอจริงบนเครื่องเทส)
          padding: EdgeInsets.fromLTRB(
            16, 16, 16,
            MediaQuery.of(ctx).viewInsets.bottom + MediaQuery.of(ctx).padding.bottom + 16,
          ),
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('ยืนยันพื้นที่ที่ออกสำรวจ', style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Text(
              hasGps
                  ? 'ระบบเดาจากพิกัดให้แล้ว — ถ้าไม่ตรงกับที่คุณยืนอยู่ แก้ได้เลย'
                  : 'จับพิกัดไม่ได้ (อยู่ในอาคาร?) — เลือกพื้นที่ที่คุณกำลังออกสำรวจ',
              style: TextStyle(fontSize: 12.5, color: hasGps ? Colors.grey.shade600 : Colors.orange.shade800),
            ),
            const SizedBox(height: 14),
            DropdownButtonFormField<String>(
              initialValue: prov.isEmpty ? null : prov,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'จังหวัด', border: OutlineInputBorder(), isDense: true),
              hint: const Text('-- เลือกจังหวัด --'),
              items: names.map((n) => DropdownMenuItem(value: n, child: Text(n))).toList(),
              onChanged: (v) => setSheet(() { prov = v ?? ''; dist = ''; }),   // เปลี่ยนจังหวัด = ล้างอำเภอ
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              key: ValueKey('arrival_dist_$prov'),
              initialValue: dist.isEmpty ? null : dist,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'อำเภอ / เขต', border: OutlineInputBorder(), isDense: true),
              hint: Text(prov.isEmpty ? '-- เลือกจังหวัดก่อน --' : '-- เลือกอำเภอ --'),
              items: districts.map((n) => DropdownMenuItem(value: n, child: Text(n))).toList(),
              onChanged: districts.isEmpty ? null : (v) => setSheet(() => dist = v ?? ''),
            ),
            const SizedBox(height: 16),
            Row(children: [
              Expanded(child: OutlinedButton(
                onPressed: () => Navigator.pop(ctx, null),
                child: const Text('ยกเลิก'),
              )),
              const SizedBox(width: 10),
              Expanded(flex: 2, child: FilledButton(
                // ต้องเลือกให้ครบก่อน — พื้นที่ว่างแปลว่าไม่มีใครยืนยันอะไรเลย
                onPressed: (prov.isEmpty || dist.isEmpty) ? null : () => Navigator.pop(ctx, (prov, dist)),
                child: const Text('ยืนยันถึงที่เกิดเหตุ'),
              )),
            ]),
          ]),
        );
      }),
    );
  }

  Future<void> _takeArrivalPhoto() async {
    try {
      final photo = await _picker.pickImage(source: ImageSource.camera, imageQuality: 80, maxWidth: 1920);
      if (photo == null) return;

      // Copy to local folder
      final caseFolder = await _getCaseFolder();
      final localPath = '$caseFolder/arrival.jpg';
      await File(photo.path).copy(localPath);

      // จอถูก dispose ระหว่างกล้อง/copy (เช่น session หมดอายุเด้ง login) — setState ต่อไม่ได้
      if (!mounted) return;
      setState(() {
        _arrivalPhotoPath = localPath;
        _uploadingArrival = true;
      });
      // ── พิกัด + ให้คนยืนยันพื้นที่ ──
      // ⛔ **GPS เสนอ คนยืนยัน** — ห้ามเชื่อพิกัดดิบอย่างเดียว ยืนใกล้เส้นแบ่งจังหวัด
      //    หรือสัญญาณเพี้ยน = พื้นที่ผิดแบบเงียบ ๆ · จังหวัดนี้จะถูกใช้ต่อในเรื่องเลขเซอร์เวย์
      // ⛔ GPS จับไม่ได้ (ในอาคาร/ห้าง) ต้องเลือกเองแล้วไปต่อได้ **ห้ามค้าง**
      final apiService = ApiService();
      final pos = await _tryGetPosition();
      String? gp, gd;
      if (pos != null) {
        try {
          final r = await apiService.resolveArea(pos.latitude, pos.longitude);
          final d = r.data?['data'] ?? {};
          gp = d['province'] as String?;
          gd = d['district_guess'] as String?;
        } catch (_) { /* หาพื้นที่ไม่ได้ = ให้คนเลือกเองจากลิสต์ ไม่ใช่เหตุให้ล้ม */ }
      }
      if (!mounted) return;
      final area = await _confirmArrivalArea(gp, gd, hasGps: pos != null);
      if (area == null) {                       // กดยกเลิก = ไม่บันทึกอะไรเลย
        setState(() { _arrivalPhotoPath = null; _uploadingArrival = false; });
        return;
      }

      // บันทึกเวลาถึงที่เกิดเหตุ (ไม่อัปโหลดรูปขึ้น server — จะอัปโหลดตอนส่งงาน)
      await apiService.confirmArrival(
        widget.caseId, 'arrival.jpg',
        lat: pos?.latitude, lng: pos?.longitude,
        province: area.$1, district: area.$2,
      );
      if (mounted) {
        setState(() {
          _arrivalConfirmed = true;
          _uploadingArrival = false;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('ยืนยันถึงที่เกิดเหตุแล้ว'), backgroundColor: Colors.green),
        );
      }
    } catch (e) {
      debugPrint('Arrival error: $e');
      if (mounted) {
        setState(() => _uploadingArrival = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('ไม่สามารถอัปโหลดรูปได้: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  void _showBuddhistDatePicker() {
    // ปล่อย focus ของช่องข้อความที่ค้างอยู่ ก่อนเปิด bottom sheet → ปิดแล้วไม่เด้ง focus/คีย์บอร์ดกลับ
    FocusManager.instance.primaryFocus?.unfocus();
    final now = DateTime.now();
    final thaiMonths = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    int selDay = now.day;
    int selMonth = now.month;
    int selYear = now.year + 543 - 25; // default ~25 years ago

    // Try parse existing value
    final existing = _val('driver_birthdate');
    if (existing != '-') {
      final parts = existing.split('/');
      if (parts.length == 3) {
        selDay = int.tryParse(parts[0]) ?? selDay;
        selMonth = int.tryParse(parts[1]) ?? selMonth;
        selYear = int.tryParse(parts[2]) ?? selYear;
        // ค่าเก่าอาจเป็นปี ค.ศ. (OCR จาก APK เก่าอ่านฝั่งอังกฤษของเอกสาร) → แปลงเป็น พ.ศ.
        if (selYear >= 1900 && selYear < 2100) selYear += 543;
      }
    }
    // clamp เข้าช่วงของ wheel (childCount=101) — ปีนอกช่วงทำ initialItem ติดลบ/เกิน = ล้อว่าง
    final wheelMinYear = DateTime.now().year + 543 - 100;
    if (selYear < wheelMinYear) selYear = wheelMinYear;
    if (selYear > wheelMinYear + 100) selYear = wheelMinYear + 100;

    showModalBottomSheet(
      context: context,
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
                      const Text('เลือกวันเกิด', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                      TextButton(
                        onPressed: () {
                          final formatted = '${selDay.toString().padLeft(2, '0')}/${selMonth.toString().padLeft(2, '0')}/$selYear';
                          _set('driver_birthdate', formatted);
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
                        // วัน
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
                        // เดือน
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
                        // ปี พ.ศ.
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
                                    childCount: 101,
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

  void _set(String key, String value) {
    setState(() {
      _report ??= {};
      _report![key] = value;
    });
  }

  String _val(String? key) {
    if (key == null || _report == null) return '-';
    final v = _report![key];
    if (v == null || v.toString().isEmpty) return '-';
    return v.toString();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('หน้าการ์ด'),
      ),
      body: Consumer<CaseProvider>(
        builder: (context, caseProvider, _) {
          final CaseModel? caseModel = caseProvider.getCaseById(widget.caseId);

          if (caseModel == null) {
            return const Center(
              child: Text('ไม่พบข้อมูลงาน', style: TextStyle(fontSize: 16, color: Colors.grey)),
            );
          }

          return SingleChildScrollView(
            // เผื่อขอบล่าง = ความสูง nav bar (กันปุ่ม "ถ่ายรูปยืนยัน"/"เริ่มสำรวจ" โดน nav bar บัง)
            padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewPadding.bottom),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // การ์ด "หน้าการ์ด" (ตัด badge สถานะออก — โชว์ "มอบหมายแล้ว" ในหน้างานของฉันอยู่แล้ว)
                if (_loadingDetail)
                  const Card(
                    child: Padding(
                      padding: EdgeInsets.all(32),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                  )
                else if (_report != null)
                  _buildVehicleCard(arrived: _arrivalConfirmed || caseModel.isFinished)
                else if (_detailLoadFailed)
                  // เดิม: โหลดพลาด = จอว่างเงียบ ไม่มีทางรู้/ไม่มีทางลองใหม่
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: Colors.red.shade50,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: Colors.red.shade200),
                    ),
                    child: Column(children: [
                      Icon(Icons.wifi_off, size: 40, color: Colors.red.shade300),
                      const SizedBox(height: 8),
                      const Text('โหลดรายละเอียดงานไม่สำเร็จ', style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Colors.red)),
                      const SizedBox(height: 4),
                      Text('ตรวจสอบสัญญาณอินเทอร์เน็ตแล้วลองใหม่', style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        onPressed: () { _fetchDetail(); },
                        icon: const Icon(Icons.refresh, size: 18),
                        label: const Text('ลองใหม่'),
                      ),
                    ]),
                  ),

                const SizedBox(height: 12),

                // เสร็จงานหน้างานแล้ว (finished, 07/09/69) — ไม่ต้องยืนยันถึงที่เกิดเหตุอีก
                // เหลือกรอกรายงานต่อ (ที่ไหนก็ได้) แล้วกดส่ง · รับงานถัดไปได้แล้ว
                if (caseModel.isFinished) ...[
                  _finishedCard(caseModel),
                  const SizedBox(height: 12),
                  _surveyButton(caseModel, 'กรอกรายงานต่อ / ส่งงาน', Icons.edit_note),
                ]
                // Arrival confirmation + Survey button
                else if (caseModel.status == 'assigned') ...[
                  // ระหว่างเช็คสถานะรูปยืนยัน แสดง loader กันปุ่มกระพริบ (ถ่ายรูปยืนยัน → เริ่มสำรวจ)
                  if (_checkingArrival)
                    const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
                  // เช็คสถานะไม่สำเร็จ — ห้ามเดาว่ายังไม่ยืนยันแล้วชวนถ่ายซ้ำ (เขียนทับเวลาถึงที่เกิดเหตุ)
                  else if (!_arrivalConfirmed && _arrivalCheckFailed)
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade100,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.grey.shade300),
                      ),
                      child: Column(children: [
                        Text('เช็คสถานะการยืนยันถึงที่เกิดเหตุไม่สำเร็จ', style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: Colors.grey.shade700)),
                        const SizedBox(height: 8),
                        OutlinedButton.icon(
                          onPressed: _checkArrivalPhotos,
                          icon: const Icon(Icons.refresh, size: 18),
                          label: const Text('ลองใหม่'),
                        ),
                      ]),
                    )
                  // ถ่ายรูปยืนยันถึงที่เกิดเหตุ
                  else if (!_arrivalConfirmed) ...[
                    if (_arrivalPhotoPath != null && _uploadingArrival)
                      const Center(child: Padding(padding: EdgeInsets.all(16), child: CircularProgressIndicator()))
                    else if (_arrivalPhotoPath != null)
                      ClipRRect(
                        borderRadius: BorderRadius.circular(12),
                        child: Image.file(File(_arrivalPhotoPath!), height: 200, width: double.infinity, fit: BoxFit.cover),
                      )
                    else
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(20),
                        decoration: BoxDecoration(
                          color: Colors.orange.shade50,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.orange.shade200),
                        ),
                        child: Column(
                          children: [
                            Icon(Icons.camera_alt, size: 48, color: Colors.orange.shade400),
                            const SizedBox(height: 8),
                            const Text('ถ่ายรูปยืนยันถึงที่เกิดเหตุ', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.orange)),
                            const SizedBox(height: 4),
                            Text('กรุณาถ่ายรูปสถานที่เพื่อยืนยันก่อนเริ่มสำรวจ', style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                            const SizedBox(height: 16),
                            SizedBox(
                              width: double.infinity,
                              height: 48,
                              child: ElevatedButton.icon(
                                onPressed: _takeArrivalPhoto,
                                icon: const Icon(Icons.camera_alt),
                                label: const Text('ถ่ายรูปยืนยัน', style: TextStyle(fontSize: 16)),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: Colors.orange,
                                  foregroundColor: Colors.white,
                                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ] else ...[
                    // ยืนยันแล้ว — สถานะขึ้นเป็นแถบเขียวบนหัวการ์ดแล้ว (10/09/69) ตรงนี้เหลือแค่ปุ่มเริ่มสำรวจ
                    _surveyButton(caseModel, 'เริ่มสำรวจ', Icons.assignment),
                  ],
                ],

                // รูปหน้าการ์ดอยู่ใต้ปุ่ม (10/09/69) — ปุ่มถ่ายรูปยืนยัน/เริ่มสำรวจ ต้องกดได้โดยไม่ต้องเลื่อนหน้าจอ
                if (_report != null) ...[
                  const SizedBox(height: 16),
                  _buildCardImageCard(),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  /// ปุ่มเข้าฟอร์มสำรวจ — ใช้ทั้ง "เริ่มสำรวจ" (assigned) และ "กรอกรายงานต่อ" (finished)
  Widget _surveyButton(CaseModel caseModel, String label, IconData icon) {
    return SizedBox(
      width: double.infinity,
      height: 48,
      child: ElevatedButton.icon(
        onPressed: () async {
          // สร้างโฟลเดอร์บนเครื่อง
          await _getCaseFolder();
          // สร้างโฟลเดอร์บน server
          try {
            final apiService = ApiService();
            await apiService.createCaseFolder(caseModel.id);
          } catch (_) {}
          if (mounted) context.go('/cases/${caseModel.id}/survey');
        },
        icon: Icon(icon),
        label: Text(label, style: const TextStyle(fontSize: 16)),
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF2F6BD8),
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
    );
  }

  /// การ์ด "เสร็จงานหน้างานแล้ว" (status finished) — รับงานถัดไปได้ · กรอกรายงานต่อที่ไหนก็ได้ · ยังไม่ส่ง
  Widget _finishedCard(CaseModel caseModel) {
    String when = '';
    final t = DateTime.tryParse(caseModel.finishedAt ?? '')?.toLocal();
    if (t != null) {
      when = ' ${t.day}/${t.month}/${t.year + 543} ${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    }
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.teal.shade50,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.teal.shade200),
      ),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Icon(Icons.flag_circle_rounded, color: Colors.teal.shade700, size: 24),
          const SizedBox(width: 8),
          Expanded(
            child: Text('เสร็จงานหน้างานแล้ว$when',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Colors.teal.shade800)),
          ),
        ]),
        const SizedBox(height: 6),
        Text('รับงานถัดไปได้แล้ว · กรอกรายงานต่อได้ทุกที่ แล้วกด "ตรวจสอบ & ส่ง" ให้หัวหน้าตรวจ',
            style: TextStyle(fontSize: 12.5, color: Colors.grey.shade700)),
      ]),
    );
  }

  // การ์ด "หน้าการ์ด": โชว์รูปใบรับแจ้งเคลมที่ระบบ OCR อ่าน (แทนการแสดงรายละเอียดที่แยกฟิลด์)
  // 10/09/69 (user ขอ): ชื่อหน้าเป็น "หน้าการ์ด" แล้ว จึงตัดแถบน้ำเงินหัวการ์ดที่ซ้ำคำออก
  //   หัวการ์ดใช้บอกสถานะแทน — ยืนยันถึงที่เกิดเหตุแล้ว = แถบเขียว (กล่องเขียวท้ายหน้าเดิมตัดออก)
  //   ประเภทเคลมที่เคยเป็นป้ายบนแถบน้ำเงิน ย้ายลงมาเป็นแถวในเลขอ้างอิง
  Widget _buildVehicleCard({required bool arrived}) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // แถบสถานะบนหัวการ์ด — ขึ้นเมื่อยืนยันถึงที่เกิดเหตุแล้ว (หรือเสร็จงานแล้ว) เท่านั้น
          if (arrived)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.green.shade50,
                border: Border(bottom: BorderSide(color: Colors.green.shade200)),
              ),
              child: Row(
                children: [
                  Icon(Icons.check_circle, color: Colors.green.shade600, size: 22),
                  const SizedBox(width: 8),
                  const Text(
                    'ยืนยันถึงที่เกิดเหตุแล้ว',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: Colors.green),
                  ),
                ],
              ),
            ),

          // เลขอ้างอิงเคลม (callcenter กรอก หรือได้จาก OCR) — แสดงเสมอ แม้งานนั้นไม่มีรูปหน้าการ์ด
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            child: Column(
              children: [
                _refRow('เลขรับแจ้ง', _val('claim_ref_no')),
                _refRow('เลขเคลม', _val('claim_no')),
                _refRow('เลขเซอร์เวย์', _val('survey_job_no')),
                if (_val('claim_type') != '-') _refRow('ประเภทเคลม', _claimTypeLabel(_val('claim_type'))),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// การ์ดรูปหน้าการ์ด (ที่ระบบ OCR อ่าน) — แยกออกจากการ์ดเลขอ้างอิง (10/09/69) เพื่อให้ปุ่ม
  /// ถ่ายรูปยืนยัน/เริ่มสำรวจ อยู่ใต้เลขอ้างอิงทันที ไม่ต้องเลื่อนผ่านรูปการ์ดที่สูงเกือบเต็มจอ
  /// และไม่ไปจมอยู่ท้ายหน้าให้แถบปุ่มเครื่องบัง (user ขอ) · แตะรูปเพื่อดูเต็มจอเหมือนเดิม
  Widget _buildCardImageCard() {
    final images = (_report?['case_images'] as List?) ?? [];
    final ocrImages = images.where((img) => img['image_type'] == 'ocr').toList();
    return Card(
      clipBehavior: Clip.antiAlias,
      child: ocrImages.isNotEmpty
          ? Column(
              children: [
                for (int i = 0; i < ocrImages.length; i++)
                  _cardImage(ocrImages[i]['file_path']?.toString() ?? ''),
              ],
            )
          : Padding(
              padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 16),
              child: Center(
                child: Column(
                  children: [
                    Icon(Icons.credit_card_off, size: 40, color: Colors.grey.shade400),
                    const SizedBox(height: 8),
                    Text('ยังไม่มีรูปหน้าการ์ด', style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
                  ],
                ),
              ),
            ),
    );
  }

  // แถวเลขอ้างอิง (ป้าย + ค่า) — ค่าเป็น '-' ถ้ายังไม่มีข้อมูล
  Widget _refRow(String label, String value) {
    final empty = value == '-';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 108,
            child: Text(label, style: TextStyle(fontSize: 13, color: Colors.grey.shade600)),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: empty ? FontWeight.normal : FontWeight.w600,
                color: empty ? Colors.grey.shade400 : const Color(0xFF1E2330),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _cardImage(String filePath) {
    if (filePath.isEmpty) return const SizedBox.shrink();
    final imageUrl = '${ApiConfig.baseUrl}/uploads/$filePath';
    return GestureDetector(
      onTap: () => _showFullImage(imageUrl),
      child: Image.network(
        imageUrl,
        headers: AuthToken.imageHeaders,
        width: double.infinity,
        fit: BoxFit.fitWidth,
        loadingBuilder: (context, child, progress) {
          if (progress == null) return child;
          return const SizedBox(
            height: 120,
            child: Center(child: CircularProgressIndicator()),
          );
        },
        errorBuilder: (context, error, stackTrace) {
          return Container(
            height: 100,
            color: Colors.grey.shade200,
            child: const Center(child: Icon(Icons.broken_image, color: Colors.grey)),
          );
        },
      ),
    );
  }

  Widget _buildCaseImagesSection() {
    final images = _report!['case_images'] as List;
    final baseUrl = ApiConfig.baseUrl;
    return Column(
      children: [
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('เอกสารใบแจ้งเคลม', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Color(0xFF2F6BD8))),
              const SizedBox(height: 8),
              ...images.map((img) {
                final filePath = img['file_path']?.toString() ?? '';
                final imageUrl = '$baseUrl/uploads/$filePath';
                return Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: GestureDetector(
                    onTap: () => _showFullImage(imageUrl),
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.network(
                        imageUrl,
                        headers: AuthToken.imageHeaders,
                        width: double.infinity,
                        fit: BoxFit.fitWidth,
                        loadingBuilder: (context, child, progress) {
                          if (progress == null) return child;
                          return const SizedBox(
                            height: 100,
                            child: Center(child: CircularProgressIndicator()),
                          );
                        },
                        errorBuilder: (context, error, stackTrace) {
                          return Container(
                            height: 80,
                            color: Colors.grey.shade200,
                            child: const Center(child: Icon(Icons.broken_image, color: Colors.grey)),
                          );
                        },
                      ),
                    ),
                  ),
                );
              }),
            ],
          ),
        ),
      ],
    );
  }

  /// ดูรูปเต็มจอ — ใบเคลม/หน้าการ์ดเป็นเอกสารตัวหนังสือเล็ก ยิ่งได้พื้นที่มากยิ่งอ่านออก
  ///
  /// ⛔ เดิมเป็น `Dialog` ซึ่ง **ไม่มีวันเต็มจอ**: มันเป็นกล่องลอยกลางจอ มีขอบเว้นรอบ
  ///    และถูกบีบตามขนาดเนื้อหา รูปเลยไปโผล่เล็ก ๆ ตรงกลางโดยเห็นหน้าเดิมทะลุอยู่ข้างหลัง
  ///    (user แจ้ง 31/08/69) → เปลี่ยนเป็น "หน้า" เต็มจอจริงแทน
  void _showFullImage(String imageUrl) {
    Navigator.of(context).push(PageRouteBuilder<void>(
      opaque: true,
      barrierColor: Colors.black,
      pageBuilder: (ctx, _, __) => Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          children: [
            // เต็มจอจริง รวมพื้นที่ใต้แถบสถานะ — เอกสารแนวตั้งจะได้กว้างเต็มจอ
            // แล้วบีบนิ้วซูมอ่านตัวเล็กต่อได้ (maxScale 6 พอสำหรับตัวหนังสือบนการ์ด)
            Positioned.fill(
              child: InteractiveViewer(
                minScale: 1,
                maxScale: 6,
                child: Image.network(
                  imageUrl,
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
            // ⛔ ต้องบวก padding.top — เต็มจอแล้วปุ่มปิดจะไปซ้อนใต้นาฬิกา/สัญญาณ กดไม่โดน
            Positioned(
              top: MediaQuery.of(ctx).padding.top + 4,
              right: 4,
              child: Container(
                decoration: const BoxDecoration(color: Colors.black45, shape: BoxShape.circle),
                child: IconButton(
                  onPressed: () => Navigator.pop(ctx),
                  icon: const Icon(Icons.close, color: Colors.white, size: 28),
                  tooltip: 'ปิด',
                ),
              ),
            ),
          ],
        ),
      ),
    ));
  }

  Widget _inputField(String label, String value, {String? fieldKey, int maxLines = 1}) {
    return TextFormField(
      initialValue: value == '-' ? '' : value,
      readOnly: fieldKey == null,
      maxLines: maxLines,
      style: const TextStyle(fontSize: 13, color: Colors.black87),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(fontSize: 12, color: Colors.grey),
        filled: true,
        fillColor: fieldKey != null ? Colors.white : Colors.grey.shade100,
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: BorderSide(color: Colors.grey.shade300)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: BorderSide(color: Colors.grey.shade300)),
        isDense: true,
      ),
      onChanged: fieldKey != null ? (v) => _set(fieldKey, v) : null,
    );
  }

  Widget _inputRow2(String l1, String v1, String l2, String v2) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(children: [
        Expanded(child: _inputField(l1, v1)),
        const SizedBox(width: 8),
        Expanded(child: _inputField(l2, v2)),
      ]),
    );
  }

  Widget _inputRow1(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: _inputField(label, value),
    );
  }

  Widget _selectField(String label, String? value, List<String> options, {String? fieldKey, ValueChanged<String>? onSelect}) {
    final current = (value != null && value != '-' && options.contains(value)) ? value : options.first;
    final editable = fieldKey != null || onSelect != null;
    return DropdownButtonFormField<String>(
      initialValue: current,
      isExpanded: true,
      style: const TextStyle(fontSize: 13, color: Colors.black87),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(fontSize: 12, color: Colors.grey),
        filled: true,
        fillColor: editable ? Colors.white : Colors.grey.shade100,
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: BorderSide(color: Colors.grey.shade300)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: BorderSide(color: Colors.grey.shade300)),
        isDense: true,
      ),
      items: options.map((o) => DropdownMenuItem(value: o, child: Text(o, style: const TextStyle(fontSize: 13)))).toList(),
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      onChanged: editable ? (v) {
        if (v != null) {
          if (fieldKey != null) _set(fieldKey, v);
          onSelect?.call(v);
        }
      } : null,
    );
  }

  Widget _provinceSelect(String label, String value, {String? fieldKey, String? districtFieldKey}) {
    final names = _provincesData.keys.toList()..sort();
    final items = ['-- เลือกจังหวัด --', ...names];
    final current = (value != '-' && names.contains(value)) ? value : items.first;
    return DropdownButtonFormField<String>(
      initialValue: current,
      isExpanded: true,
      style: const TextStyle(fontSize: 13, color: Colors.black87),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(fontSize: 12, color: Colors.grey),
        filled: true, fillColor: fieldKey != null ? Colors.white : Colors.grey.shade100,
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: BorderSide(color: Colors.grey.shade300)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: BorderSide(color: Colors.grey.shade300)),
        isDense: true,
      ),
      items: items.map((o) => DropdownMenuItem(value: o, child: Text(o, style: const TextStyle(fontSize: 13)))).toList(),
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      onChanged: fieldKey != null ? (v) {
        if (v != null) {
          _set(fieldKey, v);
          if (districtFieldKey != null) _set(districtFieldKey, '');
        }
      } : null,
    );
  }

  Widget _districtSelect(String label, String value, String province, {String? fieldKey}) {
    final districts = (province != '-' && _provincesData.containsKey(province))
        ? _provincesData[province]!
        : <String>[];
    final items = ['-- เลือกอำเภอ --', ...districts];
    final current = (value != '-' && districts.contains(value)) ? value : items.first;
    return DropdownButtonFormField<String>(
      key: ValueKey('${province}_$fieldKey'),
      initialValue: current,
      isExpanded: true,
      style: const TextStyle(fontSize: 13, color: Colors.black87),
      decoration: InputDecoration(
        labelText: label,
        labelStyle: const TextStyle(fontSize: 12, color: Colors.grey),
        filled: true, fillColor: fieldKey != null ? Colors.white : Colors.grey.shade100,
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: BorderSide(color: Colors.grey.shade300)),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: BorderSide(color: Colors.grey.shade300)),
        isDense: true,
      ),
      items: items.map((o) => DropdownMenuItem(value: o, child: Text(o, style: const TextStyle(fontSize: 13)))).toList(),
      onTap: () => FocusManager.instance.primaryFocus?.unfocus(),
      onChanged: fieldKey != null ? (v) { if (v != null) _set(fieldKey, v); } : null,
    );
  }

  Widget _buildDriverSection() {
    final genderRaw = _val('driver_gender');
    final gender = genderRaw == 'M' ? 'ชาย' : genderRaw == 'F' ? 'หญิง' : 'เพศ';
    final titleRaw = _val('driver_title');
    final title = (titleRaw != '-') ? titleRaw : 'คำนำหน้า';
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('ข้อมูลผู้ขับขี่', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Color(0xFF2F6BD8))),
          const SizedBox(height: 10),
          // ปุ่มสแกน
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Row(children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () {
                    // TODO: สแกนบัตรประชาชน
                  },
                  icon: const Icon(Icons.credit_card, size: 18),
                  label: const Text('สแกนบัตรประชาชน', style: TextStyle(fontSize: 13)),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF2F6BD8),
                    side: const BorderSide(color: Color(0xFF2F6BD8)),
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () {
                    // TODO: สแกนใบขับขี่
                  },
                  icon: const Icon(Icons.badge, size: 18),
                  label: const Text('สแกนใบขับขี่', style: TextStyle(fontSize: 13)),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFF2F6BD8),
                    side: const BorderSide(color: Color(0xFF2F6BD8)),
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ),
            ]),
          ),
          // แถว 1: เพศ + คำนำหน้า + วันเกิด
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              Flexible(flex: 2, child: _selectField('เพศ', gender, const ['เพศ', 'ชาย', 'หญิง'], fieldKey: 'driver_gender', onSelect: (v) {
                final code = v == 'ชาย' ? 'M' : v == 'หญิง' ? 'F' : '';
                _set('driver_gender', code);
              })),
              const SizedBox(width: 6),
              Flexible(flex: 3, child: _selectField('คำนำหน้า', title, const ['คำนำหน้า', 'นาย', 'นาง', 'นางสาว', 'ด.ช.', 'ด.ญ.', 'คุณ'], fieldKey: 'driver_title')),
              const SizedBox(width: 6),
              Flexible(
                flex: 3,
                child: GestureDetector(
                  onTap: () => _showBuddhistDatePicker(),
                  child: InputDecorator(
                    decoration: InputDecoration(
                      labelText: 'วันเกิด',
                      labelStyle: const TextStyle(fontSize: 12, color: Colors.grey),
                      filled: true, fillColor: Colors.white,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: BorderSide(color: Colors.grey.shade300)),
                      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(4), borderSide: BorderSide(color: Colors.grey.shade300)),
                      isDense: true,
                      suffixIcon: const Icon(Icons.calendar_today, size: 14, color: Colors.grey),
                    ),
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      alignment: Alignment.centerLeft,
                      child: Text(
                        _val('driver_birthdate') == '-' ? '' : _val('driver_birthdate'),
                        style: const TextStyle(fontSize: 13, color: Colors.black87),
                        maxLines: 1,
                      ),
                    ),
                  ),
                ),
              ),
            ]),
          ),
          // แถว 2: ชื่อ + นามสกุล
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              Expanded(child: _inputField('ชื่อ', _val('driver_first_name'), fieldKey: 'driver_first_name')),
              const SizedBox(width: 8),
              Expanded(child: _inputField('นามสกุล', _val('driver_last_name'), fieldKey: 'driver_last_name')),
            ]),
          ),
          // แถว 3: อายุ + โทรศัพท์ + ความสัมพันธ์
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              SizedBox(width: 55, child: _inputField('อายุ', _val('driver_age'), fieldKey: 'driver_age')),
              const SizedBox(width: 8),
              SizedBox(width: 110, child: _inputField('โทรศัพท์', _val('driver_phone'), fieldKey: 'driver_phone')),
              const SizedBox(width: 8),
              Expanded(child: _selectField('ความสัมพันธ์กับเจ้าของรถ', _val('driver_relation'), const [
                '-- ระบุ --', 'สามี', 'ภรรยา', 'บุตร', 'บิดา', 'มารดา',
                'นายจ้าง', 'ลูกจ้าง', 'ผู้เช่า', 'พี่ชาย', 'พี่สาว',
                'น้องชาย', 'น้องสาว', 'เจ้าของรถ', 'หลาน', 'อา', 'น้า', 'ลุง', 'ป้า',
                'ญาติ', 'เพื่อน', 'แฟน', 'พนักงาน', 'พี่เขย', 'น้องเขย',
                'พี่สะใภ้', 'น้องสะใภ้', 'พนักงานผู้เช่า', 'ลุงเขย', 'น้าเขย',
                'น้าสะใภ้', 'อาเขย', 'อาสะใภ้', 'หุ้นส่วน', 'บุตรหุ้นส่วน',
                'เจ้าของบริษัท', 'เพื่อนบุตรเจ้าของรถ', 'บุตรเขย', 'หลานเขย', 'บุตรสะใภ้',
              ], fieldKey: 'driver_relation')),
            ]),
          ),
          // แถว 4: ที่อยู่
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _inputField('ที่อยู่ปัจจุบัน', _val('driver_address'), fieldKey: 'driver_address', maxLines: 2),
          ),
          // แถว 5: จังหวัด
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _provinceSelect('จังหวัด', _val('driver_province'), fieldKey: 'driver_province', districtFieldKey: 'driver_district'),
          ),
          // แถว 6: เขต/อำเภอ
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _districtSelect('เขต/อำเภอ', _val('driver_district'), _val('driver_province'), fieldKey: 'driver_district'),
          ),
          // แถว 6: บัตรประชาชน + ใบขับขี่
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              Expanded(child: _inputField('บัตรประชาชนเลขที่', _val('driver_id_card'), fieldKey: 'driver_id_card')),
              const SizedBox(width: 8),
              Expanded(child: _inputField('ใบอนุญาตขับขี่เลขที่', _val('driver_license_no'), fieldKey: 'driver_license_no')),
            ]),
          ),
          // แถว 8: ประเภทใบขับขี่ + ออกให้ที่
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              Expanded(child: _inputField('ประเภท', _val('driver_license_type'), fieldKey: 'driver_license_type')),
              const SizedBox(width: 8),
              Expanded(child: _inputField('ออกให้ที่', _val('driver_license_place'), fieldKey: 'driver_license_place')),
            ]),
          ),
          // แถว 9: ออกให้วันที่ + หมดอายุ
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Row(children: [
              Expanded(child: _inputField('ออกให้วันที่', _val('driver_license_start'), fieldKey: 'driver_license_start')),
              const SizedBox(width: 8),
              Expanded(child: _inputField('หมดอายุวันที่', _val('driver_license_end'), fieldKey: 'driver_license_end')),
            ]),
          ),
        ],
      ),
    );
  }

  Widget _buildSection(String title, List<Widget> rows) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: Color(0xFF2F6BD8))),
          const SizedBox(height: 8),
          ...rows,
        ],
      ),
    );
  }

  String _claimTypeLabel(String type) {
    switch (type) {
      case 'F': return 'เคลมสด';
      case 'D': return 'เคลมแห้ง';
      case 'A': return 'งานนัดหมาย';
      case 'C': return 'งานติดตาม';
      default: return type;
    }
  }

}
