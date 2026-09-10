import 'package:flutter/material.dart';
import '../../widgets/form_kit.dart';
import '../../widgets/car_damage_diagram.dart';
import '../../data/survey_master.dart';

/// Editor คู่กรณีรายคัน (Phase 3) — คืน {'action':'save','data':{...}} หรือ {'action':'delete'}
class OpponentEditor extends StatefulWidget {
  final Map<String, dynamic> data;
  final List<String> provinces;
  final Map<String, List<String>> provincesData; // จังหวัด → รายการอำเภอ (cascade เขต/อำเภอคู่กรณี)
  final int number; // คันที่ (1-based)
  final bool isNew;
  // สแกนเอกสาร (kind = idcard | license) → คืน fields (parent จัดการถ่าย+เก็บรูป+OCR)
  final Future<Map<String, dynamic>?> Function(String kind)? onScan;
  // เรียกทันทีหลังสแกน OCR สำเร็จ → ส่ง snapshot ปัจจุบันให้ parent เซฟ draft (กันข้อมูลหายถ้าถูก kill ก่อนกด "บันทึก")
  final void Function(Map<String, dynamic> data)? onDraft;
  const OpponentEditor({super.key, required this.data, required this.provinces, this.provincesData = const {}, required this.number, this.isNew = false, this.onScan, this.onDraft});

  @override
  State<OpponentEditor> createState() => _OpponentEditorState();
}

class _OpponentEditorState extends State<OpponentEditor> {
  late final Map<String, TextEditingController> _c;
  final _damage = <Map<String, String>>[];
  String _evType = '';
  String _carType = '', _carBrand = '', _carColor = '', _province = '', _homeProvince = '', _district = '', _gender = '', _title = '', _relation = '', _insurer = '', _licenseType = '', _policyType = '';
  bool _kfk = false;
  bool _pending = false;  // "รอตรวจสอบ" — คู่กรณีหลบหนี / ยังไม่มีรายละเอียด
  bool _cidThai = true;   // true = คนไทย (13 หลัก+checksum) / false = ต่างชาติ
  bool _hasLicense = false; // สวิตช์ "มีใบขับขี่" — ค่าเริ่มต้น=ปิด (=ไม่มีใบขับขี่); สแกนใบขับขี่ = เปิดอัตโนมัติ; ปิด = ซ่อน+เคลียร์

  TextEditingController _ctl(String k) => _c[k] ??= TextEditingController(text: (widget.data[k] ?? '').toString());

  @override
  void initState() {
    super.initState();
    _c = {};
    for (final k in ['owner_name', 'owner_address', 'car_model', 'plate', 'reg_year', 'mileage', 'vin',
      'first_name', 'last_name', 'birthdate', 'age', 'phone', 'address', 'cid', 'license_no', 'license_place', 'license_start', 'license_end',
      'policy_no', 'claim_no', 'estimated_cost']) {
      _c[k] = TextEditingController(text: (widget.data[k] ?? '').toString());
    }
    _policyType = (widget.data['policy_type'] ?? '').toString();
    _carType = (widget.data['car_type'] ?? '').toString();
    _carBrand = (widget.data['car_brand'] ?? '').toString();
    _carColor = (widget.data['car_color'] ?? '').toString();
    _province = (widget.data['province'] ?? '').toString();
    _homeProvince = (widget.data['home_province'] ?? '').toString();
    _district = (widget.data['district'] ?? '').toString();
    _evType = (widget.data['ev_type'] ?? '').toString();
    _gender = (widget.data['gender'] ?? '').toString();
    _title = (widget.data['title'] ?? '').toString();
    _relation = (widget.data['relation'] ?? '').toString();
    _insurer = (widget.data['insurer'] ?? '').toString();
    _licenseType = (widget.data['license_type'] ?? '').toString();
    _kfk = widget.data['kfk'] == true;
    _pending = widget.data['pending'] == true;
    // ชนิดบัตร: ค่าที่เคยเลือก; ไม่มี = คนไทย (พฤติกรรมเดิม)
    _cidThai = '${widget.data['id_type'] ?? ''}'.trim() != 'foreign';
    // มีใบขับขี่ = ประเภทเป็นชนิดจริง หรือมีเลขใบขับขี่อยู่แล้ว; ว่าง/ยังไม่กรอก = ไม่มี (สแกนแล้วจะเปิดเอง)
    _hasLicense = (_licenseType.isNotEmpty && _licenseType != 'ไม่มีใบขับขี่') || (widget.data['license_no'] ?? '').toString().trim().isNotEmpty;
    final dmg = widget.data['damage'];
    if (dmg is List) {
      for (final d in dmg) {
        if (d is Map) _damage.add({'part': '${d['part'] ?? ''}', 'pos': '${d['pos'] ?? ''}', 'level': '${d['level'] ?? ''}'});
      }
    }
  }

  @override
  void dispose() {
    for (final c in _c.values) { c.dispose(); }
    super.dispose();
  }

  bool get _hasInsurance => _insurer.isNotEmpty && _insurer != 'ไม่มีบริษัทประกันภัย' && _insurer != 'อื่นๆ';
  bool get _noInsurance => _insurer == 'ไม่มีบริษัทประกันภัย'; // "อื่นๆ" = มีประกัน (บริษัทนอกลิสต์) ห้ามล้างค่า

  Map<String, dynamic> _collect() => {
        'owner_name': _ctl('owner_name').text.trim(),
        'owner_address': _ctl('owner_address').text.trim(),
        'car_type': _carType,
        'car_brand': _carBrand,
        'car_model': _ctl('car_model').text.trim(),
        'car_color': _carColor,
        'plate': _ctl('plate').text.trim(),
        'province': _province,
        // ภูมิลำเนาผู้ขับขี่ (บัตร ปชช./ทะเบียนบ้าน) — ไม่มีช่องให้กรอกในแอป เพราะ EMCS ซ่อน
        // ddlDri_ProvinceID ของบล็อกคู่กรณีไว้ ส่งผ่านเฉย ๆ เพื่อไม่ทับค่าที่นำเข้าจาก XML ของ
        // ISURVEY (ไฟล์นั้นมี DRI_PROVINCEID จริง); ว่าง → xmlExport ใช้ province (ป้ายทะเบียน) แทน
        'home_province': _homeProvince,
        'district': _district,
        'ev_type': _evType,   // → dtlOpo_ctlNN_wuOpo_ddlEv_Type (บอทเดินสายรออยู่แล้ว)
        'reg_year': _ctl('reg_year').text.trim(),
        'mileage': _ctl('mileage').text.trim(),
        'vin': _ctl('vin').text.trim(),
        'gender': _gender,
        'title': _title,
        'first_name': _ctl('first_name').text.trim(),
        'last_name': _ctl('last_name').text.trim(),
        'relation': _relation,
        'birthdate': _ctl('birthdate').text.trim(),
        'age': _ctl('age').text.trim(),
        'phone': _ctl('phone').text.trim(),
        'address': _ctl('address').text.trim(),
        'cid': _ctl('cid').text.trim(),
        'id_type': _cidThai ? 'thai' : 'foreign',
        'license_no': _ctl('license_no').text.trim(),
        'license_type': _hasLicense ? _licenseType : 'ไม่มีใบขับขี่', // สวิตช์ปิด = เก็บ "ไม่มีใบขับขี่"
        'license_place': _ctl('license_place').text.trim(),
        'license_start': _ctl('license_start').text.trim(),
        'license_end': _ctl('license_end').text.trim(),
        'insurer': _insurer,
        // "ไม่มีบริษัทประกันภัย" → ห้ามเก็บค่าประกันค้าง (ช่องแค่ถูกซ่อน controller ยังถือค่าเดิม
        // เคยทำ record "ไม่มีประกัน" พ่วงเลขกรมธรรม์เก่า + XML เพี้ยน)
        // แต่ "อื่นๆ" = มีประกันกับบริษัทนอกลิสต์ (backend นับ HAVE_INSURANCE=1) — คงค่าที่พิมพ์ไว้
        // ไม่มีบริษัทประกันภัย → เลขกรมธรรม์ "-" (EMCS บังคับช่องนี้ทุกบริษัท · กติกาช่องบังคับไม่มีข้อมูล = "-")
        // เว็บจะได้ไม่ขึ้นกรอบแดงให้หัวหน้ามาเติมขีดเองทุกเคส (user ขอ 10/09/69)
        'policy_no': _noInsurance ? '-' : _ctl('policy_no').text.trim(),
        'claim_no': _noInsurance ? '' : _ctl('claim_no').text.trim(),
        'policy_type': _noInsurance ? '' : _policyType.trim(),
        'damage': _damage,
        'damage_description': _ctl('damage_description').text.trim(),
        'estimated_cost': _ctl('estimated_cost').text.trim(),
        'kfk': !_noInsurance && _kfk,
        'pending': _pending,   // จำสถานะติ๊กไว้ เปิดคันเดิมกลับมาจะยังติ๊กอยู่
      };

  // ── "รอตรวจสอบ" — คู่กรณีหลบหนี / ยังไม่มีรายละเอียด ────────────────────────
  // ค่าที่เติมคือค่าที่ระบบประกัน **ยอมรับ** ให้บันทึกผ่าน ไม่ใช่ข้อมูลจริง —
  // เติมเฉพาะช่องที่ยังว่าง (ที่กรอกไว้แล้วคือของจริง ห้ามทับ) แล้วพนักงานแก้ทีหลังได้
  // เอาติ๊กออก = ไม่ล้างค่าคืน (ล้างแล้วของที่พิมพ์เองหายไปด้วย)
  static const _pendingText = 'รอตรวจสอบ';
  void _applyPending() {
    void fill(String k) { if (_ctl(k).text.trim().isEmpty) _ctl(k).text = _pendingText; }
    // ช่องบังคับชนิดข้อความ → "รอตรวจสอบ"
    // ⛔ ไม่รวม 'phone' — ช่องเบอร์โทรรับเฉพาะตัวเลข (ระบบประกันเป็น varchar(10) ตัวเลขล้วน)
    //    ใส่ข้อความลงไปก็ถูกกรองทิ้งตอนส่งออกอยู่ดี ปล่อยว่างแล้วให้บอทใส่ '-' ให้ EMCS เอง
    for (final k in ['owner_name', 'plate', 'first_name', 'last_name', 'address', 'cid']) {
      fill(k);
    }
    // ช่องบังคับชนิดตัวเลือก/วันที่/ตัวเลข → ใส่ "รอตรวจสอบ" ไม่ได้ ต้องเป็นค่าที่มีจริงในลิสต์
    if (_carType.isEmpty) _carType = 'รถอื่นๆ';
    if (_province.isEmpty) _province = 'อื่นๆ';
    if (_insurer.isEmpty) _insurer = 'อื่นๆ';       // = มีประกันกับบริษัทนอกลิสต์ (ช่องกรมธรรม์จึงไม่โผล่)
    if (_gender.isEmpty) _gender = 'ชาย';
    if (_title.isEmpty) _title = 'นาย';             // ให้เข้าชุดกับเพศ (ระบบประกันรวมเป็นชื่อช่องเดียว)
    // ⛔ ไม่แตะ "ความสัมพันธ์กับเจ้าของรถ" — ไม่ใช่ช่องบังคับบน EMCS (ยืนยันจากหน้าจอจริง 2026-08-10)
    if (_ctl('birthdate').text.trim().isEmpty) _ctl('birthdate').text = '01/01/2525';
    _syncAge();
  }

  // อายุมาจากวันเกิดเสมอ — เลือกวันเกิดใหม่แล้วอายุขยับตาม
  void _syncAge() {
    final a = kAgeFromThaiDate(_ctl('birthdate').text);
    if (a.isNotEmpty) _ctl('age').text = a;
  }

  // ── ช่องที่ EMCS บังคับต่อคู่กรณี 1 คัน และ "บอทเติมแทนไม่ได้" ──────────────
  // ช่องข้อความที่บังคับ (เจ้าของ · ที่อยู่ · โทร · บัตร ปชช. · ใบขับขี่ · กรมธรรม์ ·
  // เลขเคลม · ประเภทประกัน) บอทใส่ "-" ให้ผ่านด่าน EMCS ได้ แต่ **ตัวเลือก/วันที่/
  // ตัวเลข ใส่ "-" ไม่ได้** → EMCS บล็อกการบันทึก "ทั้งบล็อกคู่กรณี" (ไม่ใช่แค่คันนี้)
  // หัวหน้าต้องมานั่งเติมเองทุกเคส และบอทค้างรอกลางทาง
  // เจอจริง 2026-08-10 เคลม 21BR10AVD-6908-000097: ขาด เพศ · วันเกิด · อายุ ·
  // มีประกันภัยที่ ครบทั้ง 4 ช่อง (เดิม req: true เป็นแค่จุดแดง กด "บันทึกคันนี้" ผ่านเลย)
  // ⚠️ ต้องตรงกับ checkItems('6. คู่กรณี') ในฟอร์มหลัก และ OPPONENT_REQUIRED บนเว็บ
  //    ทั้งหมดอ้าง `vlidOpoCar` ของ EMCS (base ก่อน switch = บังคับทุกบริษัท)
  List<String> _missing() => [
        if (_carType.trim().isEmpty) 'ประเภทรถ',
        if (_ctl('plate').text.trim().isEmpty) 'ทะเบียน',
        if (_province.trim().isEmpty) 'จังหวัด',
        // เจ้าของรถ (txtOpo_Name) — EMCS บังคับ แต่เดิมไม่มีใครตรวจ บอทเลยยัด '-' ให้ทุกใบ
        if (_ctl('owner_name').text.trim().isEmpty) 'เจ้าของรถ',
        if (_gender.trim().isEmpty) 'เพศผู้ขับขี่',
        if (_ctl('birthdate').text.trim().isEmpty) 'วันเกิด',
        if (_ctl('age').text.trim().isEmpty) 'อายุ',
        if (_insurer.trim().isEmpty) 'มีประกันภัยที่',
      ];

  Future<void> _save() async {
    final miss = _missing();
    // ไม่บล็อกตาย — คู่กรณีหนีหรือยังไม่ให้ข้อมูล ก็ต้องเก็บทะเบียน/ความเสียหายไว้ก่อน
    // (บล็อกตาย = พนักงานลบคันทิ้งแล้วข้อมูลที่ถ่ายมาหายหมด) แต่ต้องเห็นก่อนออกจากที่เกิดเหตุ
    if (miss.isNotEmpty) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('ยังกรอกไม่ครบ'),
          content: Text('ขาด: ${miss.join(", ")}\n\n'
              'ช่องพวกนี้ระบบประกันบังคับ และเติมแทนให้ไม่ได้ — '
              'ถ้าปล่อยว่าง หัวหน้าจะบันทึกข้อมูลคู่กรณีเข้าระบบไม่ผ่าน'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('กลับไปกรอก')),
            TextButton(onPressed: () => Navigator.pop(ctx, true),
                child: const Text('บันทึกทั้งที่ยังไม่ครบ', style: TextStyle(color: kDanger))),
          ],
        ),
      );
      if (ok != true || !mounted) return;
    }
    Navigator.pop(context, {'action': 'save', 'data': _collect()});
  }

  void _delete() {
    Navigator.pop(context, {'action': 'delete'});
  }

  Future<void> _scan(String kind) async {
    if (widget.onScan == null) return;
    final fields = await widget.onScan!(kind);
    if (fields == null || fields.isEmpty || !mounted) return;
    String f(String k) => (fields[k] ?? '').toString().trim();
    setState(() {
      if (kind == 'idcard') {
        if (f('first_name').isNotEmpty) _ctl('first_name').text = f('first_name');
        if (f('last_name').isNotEmpty) _ctl('last_name').text = f('last_name');
        if (f('cid').isNotEmpty) _ctl('cid').text = f('cid');
        if (f('birthdate').isNotEmpty) _ctl('birthdate').text = kNormThaiDateEra(f('birthdate'));
        if (f('address').isNotEmpty) _ctl('address').text = f('address');
        final p = f('prefix');
        if (const ['นาย', 'นาง', 'นางสาว', 'ด.ช.', 'ด.ญ.'].contains(p)) {
          _title = p;
          _gender = (p == 'นาย' || p == 'ด.ช.') ? 'ชาย' : 'หญิง';
        }
      } else {
        _hasLicense = true; // สแกนใบขับขี่ = มีใบขับขี่ (กันช่องยังซ่อนอยู่)
        if (f('license_no').isNotEmpty) _ctl('license_no').text = f('license_no');
        if (f('license_type').isNotEmpty) _licenseType = f('license_type');
        // OCR อาจอ่านฝั่งอังกฤษของใบขับขี่ได้ปี ค.ศ. → normalize เป็น พ.ศ.
        if (f('issue_date').isNotEmpty) _ctl('license_start').text = kNormThaiDateEra(f('issue_date'));
        if (f('expiry_date').isNotEmpty) _ctl('license_end').text = kNormThaiDateEra(f('expiry_date'));
        if (_ctl('first_name').text.trim().isEmpty && f('first_name').isNotEmpty) _ctl('first_name').text = f('first_name');
        if (_ctl('last_name').text.trim().isEmpty && f('last_name').isNotEmpty) _ctl('last_name').text = f('last_name');
      }
    });
    widget.onDraft?.call(_collect());   // autosave ทันทีหลังสแกน — กันข้อมูลหายถ้าแอปถูก kill ก่อนกด "บันทึก"
  }

  Widget _pendingToggle() => GestureDetector(
        onTap: () => setState(() { _pending = !_pending; if (_pending) _applyPending(); }),
        behavior: HitTestBehavior.opaque,
        child: Container(
          padding: const EdgeInsets.fromLTRB(6, 4, 12, 4),
          decoration: BoxDecoration(
            color: _pending ? kTint : kFill,
            borderRadius: BorderRadius.circular(13),
            border: Border.all(color: _pending ? kPrimary : kLine),
          ),
          child: Row(children: [
            SizedBox(
              width: 24, height: 24,
              child: Checkbox(
                value: _pending,
                onChanged: (v) => setState(() { _pending = v ?? false; if (_pending) _applyPending(); }),
                activeColor: kPrimary,
                visualDensity: VisualDensity.compact,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('รอตรวจสอบ', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: _pending ? kPrimary : kInk)),
                const Text('คู่กรณีหลบหนี / ยังไม่มีรายละเอียด — เติมช่องบังคับให้อัตโนมัติ แก้เองได้',
                    style: TextStyle(fontSize: 11, color: kMuted)),
              ]),
            ),
          ]),
        ),
      );

  Widget _scanBtns() {
    if (widget.onScan == null) return const SizedBox.shrink();
    Widget b(IconData i, String l, String kind) => Expanded(
          child: OutlinedButton.icon(
            onPressed: () => _scan(kind),
            icon: Icon(i, size: 17),
            label: Text(l, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
            style: OutlinedButton.styleFrom(foregroundColor: kPrimary, backgroundColor: kTint, side: BorderSide.none, padding: const EdgeInsets.symmetric(vertical: 12), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
          ),
        );
    return Row(children: [b(Icons.credit_card, 'สแกนบัตรประชาชน', 'idcard'), const SizedBox(width: 8), b(Icons.badge_outlined, 'สแกนใบขับขี่', 'license')]);
  }

  // คนไทย = 13 หลัก + checksum · ต่างชาติ = พิมพ์อิสระ ไม่เกิน 13 ตัว (เพดาน EMCS)
  Widget _cidField() => kCidField(_ctl('cid'),
      isThai: _cidThai,
      onTypeChanged: (v) => setState(() => _cidThai = v),
      checksum: cidChecksum,
      label: 'เลขบัตรประชาชน',
      onChanged: (_) => setState(() {}));

  @override
  Widget build(BuildContext context) {
    return EditorScaffold(
      title: 'คู่กรณีคันที่ ${widget.number}',
      subtitle: 'เจ้าของ · รถ · ผู้ขับ · ประกัน · ความเสียหาย',
      onSave: _save,
      onDelete: widget.isNew ? null : _delete,
      saveLabel: 'บันทึกคันนี้',
      children: [
        _pendingToggle(),
        kSubhead('เจ้าของ / รถ'),
        kText(_ctl('owner_name'), 'เจ้าของคู่กรณี', req: true),
        kText(_ctl('owner_address'), 'ที่อยู่เจ้าของรถ', maxLines: 2),
        kRow2(
          // เปลี่ยนประเภทรถ → ล้างยี่ห้อ (ลิสต์ยี่ห้อของ EMCS ผูกกับประเภทรถ)
          KPickerField(label: 'ประเภทรถ', value: _carType, options: kOpoCarTypes, req: true,
              onSelected: (v) => setState(() { if (v != _carType) _carBrand = ''; _carType = v; })),
          KPickerField(
              label: _carType.isEmpty ? 'ยี่ห้อ (เลือกประเภทรถก่อน)' : 'ยี่ห้อ',
              value: _carBrand, options: carBrandsFor(_carType),
              onSelected: (v) => setState(() => _carBrand = v)),
        ),
        // สีรถ = ตัวเลือกตรง master EMCS (เดิมพิมพ์เอง เช่น 'บรอนซ์เงิน' ไม่ตรงตัวเลือกไหนเลย)
        kRow2(
          kText(_ctl('car_model'), 'รุ่น'),
          KPickerField(label: 'สีรถ', value: _carColor, options: kCarColors, onSelected: (v) => setState(() => _carColor = v)),
        ),
        kRow2(
          kText(_ctl('plate'), 'ทะเบียน', req: true),
          // จังหวัด "ป้ายทะเบียน" ของรถคู่กรณี → ddlCar_Province บน EMCS (บังคับ)
          KPickerField(label: 'จังหวัด', value: _province, options: widget.provinces, req: true, onSelected: (v) => setState(() => _province = v)),
        ),
        // ⛔ เอาช่อง "เขต/อำเภอ" ออก 2026-07-27: EMCS ไม่มีที่ให้ลงเลย —
        // ddlDri_ProvinceID/DistrictID/Sub_DistrictID ของบล็อกคู่กรณีถูก display:none
        // + ไม่มี option ครบทั้ง 20 แผง (ยืนยันทั้งหน้าที่พนักงานกรอกเองและ draft จริง)
        // ที่อยู่คู่กรณีของ EMCS เป็นช่องข้อความเดียว → ให้พิมพ์อำเภอ/จังหวัดในช่อง "ที่อยู่" แทน
        // (ยังเก็บค่าเดิมใน _collect เพื่อไม่ให้ข้อมูลที่เคยกรอกไว้หาย)
        // ⚠️ 'เลข กม.' กับ 'ออกให้วันที่' มีดอกจันแดงบน EMCS แต่ **ไม่ได้บังคับจริง** —
        // vlidOpoCar() ตรวจ txtKm_No เฉพาะบริษัทรหัส 2 และไม่แตะ wuCale_Dri_DrvDate_Start เลย
        // (ยืนยัน 2026-08-01: ว่างไว้ก็กดบันทึกผ่าน) → ห้ามตั้ง req ไม่งั้นบล็อกพนักงานฟรี ๆ
        kRow2(kText(_ctl('reg_year'), 'ปีจดทะเบียน (พ.ศ.)'), kNum(_ctl('mileage'), 'เลข กม.')),
        // EMCS มีช่องนี้ให้คู่กรณีจริง (ddlEv_Type 6 ตัวเลือก) — เดิมแอปมีเฉพาะรถประกัน
        KPickerField(label: 'รถยนต์ไฟฟ้า (EV)', value: _evType,
            options: const ['BEV', 'HEV', 'PHEV', 'FCEV', 'MEV'],
            onSelected: (v) => setState(() => _evType = v)),
        kText(_ctl('vin'), 'หมายเลขตัวถัง (VIN)'),
        kSubhead('ผู้ขับขี่'),
        // ⛔ ไม่มีช่อง "จังหวัดภูมิลำเนา" (ddlDri_ProvinceID) เพราะบล็อกคู่กรณีของ EMCS ซ่อนไว้ —
        // หน้าจริงมีแค่ "ที่อยู่ปัจจุบันผู้ขับขี่" เป็นกล่องข้อความเดี่ยว (ยืนยันจากหน้าจอจริง 2026-08-01)
        // ค่ายังส่งผ่าน _collect เพื่อไม่ทับของที่นำเข้ามาจากไฟล์ XML ของ ISURVEY (ไฟล์นั้นมี
        // DRI_PROVINCEID จริง และ xmlExport ใช้ home_province ถ้ามี ไม่มีค่อย fallback เป็น province)
        _scanBtns(),
        // เพศ = radio บังคับบน EMCS (ผู้ขับขี่คู่กรณี *) — เดิมไม่มีป้าย ไม่มีจุดแดง
        kFieldLabel('เพศผู้ขับขี่', req: true),
        Row(children: [
          kChip('ชาย', _gender == 'ชาย', () => setState(() => _gender = 'ชาย'), grow: true),
          const SizedBox(width: 8),
          kChip('หญิง', _gender == 'หญิง', () => setState(() => _gender = 'หญิง'), grow: true),
        ]),
        kRow2(
          KPickerField(label: 'คำนำหน้า', value: _title, options: kTitles, req: true, onSelected: (v) => setState(() => _title = v)),
          // ไม่มีจุดแดง — EMCS ไม่ได้บังคับช่องนี้ในบล็อกคู่กรณี (ยืนยันจากหน้าจอจริง 2026-08-10)
          KPickerField(label: 'ความสัมพันธ์', value: _relation, options: kRelations, onSelected: (v) => setState(() => _relation = v)),
        ),
        kRow2(kText(_ctl('first_name'), 'ชื่อ', req: true), kText(_ctl('last_name'), 'นามสกุล', req: true)),
        kRow2(
          // เลือกวันเกิด → อายุคำนวณให้เอง (ยังพิมพ์ทับได้)
          KDateField(_ctl('birthdate'), 'วันเกิด (พ.ศ.)', req: true, defaultYearsAgo: 25, yearsAhead: 0,
              onChanged: (_) => setState(_syncAge)),
          kNum(_ctl('age'), 'อายุ', req: true),
        ),
        kPhone(_ctl('phone'), 'โทรศัพท์', req: true),
        kText(_ctl('address'), 'ที่อยู่ปัจจุบัน', req: true, maxLines: 2),
        _cidField(),
        // ── ใบขับขี่ (เปิด/ปิด — บางเคสไม่มีใบขับขี่) ──
        kSwitch('มีใบขับขี่', _hasLicense, (v) => setState(() {
              _hasLicense = v;
              if (!v) {
                _ctl('license_no').clear();
                _ctl('license_place').clear();
                _ctl('license_start').clear();
                _ctl('license_end').clear();
                _licenseType = 'ไม่มีใบขับขี่';
              } else if (_licenseType == 'ไม่มีใบขับขี่') {
                _licenseType = '';
              }
            })),
        if (_hasLicense) ...[
          KPickerField(label: 'ประเภทใบขับขี่', value: _licenseType, options: kLicenseTypes.where((t) => t != 'ไม่มีใบขับขี่').toList(), onSelected: (v) => setState(() => _licenseType = v)),
          // ⛔ เอา "ออกให้ที่" + "วันหมดอายุ" ออก 2026-07-27: บล็อกคู่กรณีของ EMCS
          // ไม่มี txtDri_DrvPlace และไม่มี wuCale_Dri_DrvDate_End (ฝั่งรถประกันมีครบ)
          // → กรอกไปก็ไม่มีที่ลง (OCR ยังเติมค่าให้เบื้องหลังเผื่อใช้ภายใน)
          kText(_ctl('license_no'), 'ใบอนุญาตขับขี่เลขที่', req: true),
          KDateField(_ctl('license_start'), 'ออกให้วันที่', yearsAhead: 0),
        ],
        kSubhead('ประกันภัยคู่กรณี'),
        KPickerField(label: 'มีประกันภัยที่', value: _insurer, options: kOpoInsurers, req: true, onSelected: (v) => setState(() {
              _insurer = v;
              _kfk = kKfkInsurers.contains(v);
              // เคยเป็น "ไม่มีประกัน" (เลขกรมธรรม์ = "-") แล้วเปลี่ยนเป็นบริษัทจริง → ล้างขีดให้กรอกเลขจริง
              if (v != 'ไม่มีบริษัทประกันภัย' && _ctl('policy_no').text.trim() == '-') _ctl('policy_no').clear();
            })),
        if (_hasInsurance) ...[
          kRow2(kText(_ctl('policy_no'), 'เลขกรมธรรม์', req: true), kText(_ctl('claim_no'), 'เลขเคลม', req: true)),
          // picker ชุดเดียวกับ ISURVEY (30/08/69) — เดิมเป็นช่องพิมพ์ ทำให้แต่ละคนเขียน
          // คนละแบบแล้วแปลงเป็นรหัสส่ง EMCS ไม่ได้ · KPickerField โชว์ค่าเดิมที่อยู่นอกลิสต์
          // ได้อยู่แล้ว (ไม่ล้างทิ้ง) เคสเก่าจึงไม่หาย
          KPickerField(label: 'ประเภทประกัน', value: _policyType, options: kPolicyTypes,
              req: true, onSelected: (v) => setState(() => _policyType = v)),
          GestureDetector(
            onTap: () => setState(() => _kfk = !_kfk),
            child: Row(children: [
              Icon(_kfk ? Icons.check_box : Icons.check_box_outline_blank, color: _kfk ? kPrimary : kMuted2, size: 22),
              const SizedBox(width: 8),
              const Expanded(child: Text('เข้าสัญญา KFK (Knock-for-Knock)', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: kInk))),
            ]),
          ),
        ],
        kSubhead('ความเสียหาย'),
        DamageDiagramField(items: _damage, onChanged: () => setState(() {})),
        DamagePartList(items: _damage, onChanged: () => setState(() {})),
        // ⛔ เอา "รายละเอียดความเสียหาย" ออก 2026-07-27: EMCS ไม่มีช่องรองรับ
        // (ความเสียหายลงเป็นรายการชิ้นส่วน+ระดับผ่าน popup เท่านั้น)
        kNum(_ctl('estimated_cost'), 'ค่าเสียหายประมาณ (บาท)', decimal: true),
      ],
    );
  }
}
