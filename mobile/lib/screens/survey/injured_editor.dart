import 'package:flutter/material.dart';
import '../../widgets/form_kit.dart';
import '../../data/survey_master.dart';
import 'opponent_editor.dart' show OpponentEditor;   // addrHasData — กติกาที่อยู่เดียวกับคู่กรณี

/// Editor ผู้บาดเจ็บ (Phase 3) — คืน {'action':'save','data':{...}} หรือ {'action':'delete'}
class InjuredEditor extends StatefulWidget {
  final Map<String, dynamic> data;
  final List<String> provinces;
  final Map<String, List<String>> provincesData;                 // จังหวัด → อำเภอ (21/09/69 ที่อยู่ผู้บาดเจ็บแยกช่อง)
  final Map<String, Map<String, List<String>>> tumbonsData;      // จังหวัด → อำเภอ → ตำบล
  final int number;
  final bool isNew;
  final Future<Map<String, dynamic>?> Function(String kind)? onScan;
  // เรียกทันทีหลังสแกน OCR สำเร็จ → ส่ง snapshot ปัจจุบันให้ parent เซฟ draft (กันข้อมูลหายถ้าถูก kill ก่อนกด "บันทึก")
  final void Function(Map<String, dynamic> data)? onDraft;
  const InjuredEditor({super.key, required this.data, required this.provinces, this.provincesData = const {}, this.tumbonsData = const {}, required this.number, this.isNew = false, this.onScan, this.onDraft});

  @override
  State<InjuredEditor> createState() => _InjuredEditorState();
}

class _InjuredEditorState extends State<InjuredEditor> {
  late final Map<String, TextEditingController> _c;
  String _personType = '', _gender = '', _wound = '', _relation = '';
  String _title = '';   // คำนำหน้าแยกช่อง (21/09/69) → บอท/XML รวมเป็น "นาย สมชาย ใจดี"
  String _homeProvince = '', _district = '', _subdistrict = '';   // ที่อยู่แยกช่อง (21/09/69) สูตรเดียวกับคู่กรณี
  bool _cidThai = true;   // true = คนไทย (13 หลัก+checksum) / false = ต่างชาติ

  TextEditingController _ctl(String k) => _c[k]!;

  @override
  void initState() {
    super.initState();
    _c = {
      for (final k in ['name', 'age', 'cid', 'car_reg', 'occupation', 'work_place', 'position', 'income', 'address', 'moo', 'phone', 'hospital', 'treat_from', 'treat_to', 'treat_cost', 'symptom'])
        k: TextEditingController(text: (widget.data[k] ?? '').toString()),
    };
    _personType = (widget.data['person_type'] ?? '').toString();
    _title = (widget.data['title'] ?? '').toString();
    _homeProvince = (widget.data['home_province'] ?? '').toString();
    _district = (widget.data['district'] ?? '').toString();
    _subdistrict = (widget.data['subdistrict'] ?? '').toString();
    // ชนิดบัตร: ค่าที่เคยเลือก; ไม่มี = คนไทย (พฤติกรรมเดิม)
    _cidThai = '${widget.data['id_type'] ?? ''}'.trim() != 'foreign';
    _gender = (widget.data['gender'] ?? '').toString();
    _wound = (widget.data['wound_level'] ?? '').toString();
    _relation = (widget.data['relation'] ?? '').toString();
  }

  @override
  void dispose() {
    for (final c in _c.values) { c.dispose(); }
    super.dispose();
  }

  Future<void> _scan() async {
    if (widget.onScan == null) return;
    final fields = await widget.onScan!('idcard');
    if (fields == null || fields.isEmpty || !mounted) return;
    String f(String k) => (fields[k] ?? '').toString().trim();
    setState(() {
      // 21/09/69: คำนำหน้าแยกช่อง (ช่องชื่อเก็บ ชื่อ นามสกุล) — บอท/XML รวมเป็น "นาย สมชาย ใจดี" · ตัวย่อจากบัตรแปลงเป็นคำเต็มในลิสต์
      final name = [f('first_name'), f('last_name')].where((s) => s.isNotEmpty).join(' ');
      if (name.isNotEmpty) _ctl('name').text = name;
      if (f('cid').isNotEmpty) _ctl('cid').text = f('cid');
      if (f('address').isNotEmpty) _ctl('address').text = f('address');
      final p = f('prefix');
      const canon = {'น.ส.': 'นางสาว', 'นส.': 'นางสาว', 'เด็กชาย': 'ด.ช.', 'เด็กหญิง': 'ด.ญ.'};
      final pt = canon[p] ?? p;
      if (kTitles.contains(pt)) _title = pt;
      if (const ['นาย', 'ด.ช.'].contains(p)) {
        _gender = 'ชาย';
      } else if (const ['นาง', 'นางสาว', 'ด.ญ.'].contains(p)) {
        _gender = 'หญิง';
      }
      final bd = f('birthdate').split('/');
      if (bd.length == 3) {
        final by = int.tryParse(bd[2]);
        if (by != null && by > 2400) {
          final age = (DateTime.now().year + 543) - by;
          if (age > 0 && age < 130) _ctl('age').text = '$age';
        }
      }
    });
    widget.onDraft?.call(_collect());   // autosave ทันทีหลังสแกน — กันข้อมูลหายถ้าแอปถูก kill ก่อนกด "บันทึก"
  }

  Widget _scanBtn() {
    if (widget.onScan == null) return const SizedBox.shrink();
    return SizedBox(
      width: double.infinity,
      child: OutlinedButton.icon(
        onPressed: _scan,
        icon: const Icon(Icons.credit_card, size: 17),
        label: const Text('สแกนบัตรประชาชน (เติมชื่อ/เลขบัตร/ที่อยู่)', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
        style: OutlinedButton.styleFrom(foregroundColor: kPrimary, backgroundColor: kTint, side: BorderSide.none, padding: const EdgeInsets.symmetric(vertical: 12), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
      ),
    );
  }

  // ช่องที่ EMCS บังคับต่อผู้บาดเจ็บ 1 คน (vlidInjPerson) — ไม่ครบ = กด "บันทึกผู้บาดเจ็บ"
  // บน EMCS ไม่ผ่าน "ทั้งบล็อก" (ไม่ใช่แค่คนนี้) หัวหน้าต้องมานั่งเติมเองทุกเคส
  // เดิม req: true เป็นแค่ดาวแดงตกแต่ง — onSave pop ทันทีโดยไม่ตรวจอะไรเลย
  /// EMCS บังคับเลขทะเบียนทุกประเภท ยกเว้น 'บุคคลภายนอกรถ' (รหัส 05)
  bool get _carRegRequired => _personType.isNotEmpty && _personType != 'บุคคลภายนอกรถ';
  // ที่อยู่ผู้บาดเจ็บ (21/09/69): มีส่วนใดส่วนหนึ่ง → จังหวัด/อำเภอ/ตำบล ต้องครบ (กติกาเดียวกับคู่กรณี · เว็บ injuredHasAddress)
  bool get _hasAddr => OpponentEditor.addrHasData(_ctl('address').text, _ctl('moo').text, _homeProvince, _district, _subdistrict);

  List<String> _missing() => [
        if (_personType.trim().isEmpty) 'ประเภทผู้บาดเจ็บ',
        if (_hasAddr && _homeProvince.isEmpty) 'จังหวัด (ที่อยู่)',
        if (_hasAddr && _district.isEmpty) 'เขต/อำเภอ (ที่อยู่)',
        if (_hasAddr && _subdistrict.isEmpty) 'ตำบล/แขวง (ที่อยู่)',
        if (_gender.trim().isEmpty) 'เพศ',
        if (_ctl('name').text.trim().isEmpty) 'ชื่อ-นามสกุล',
        if (_ctl('cid').text.trim().isEmpty) 'เลขบัตรประชาชน',
        if (_carRegRequired && _ctl('car_reg').text.trim().isEmpty) 'เลขทะเบียน',
        if (_ctl('hospital').text.trim().isEmpty) 'โรงพยาบาล',
        if (_ctl('symptom').text.trim().isEmpty) 'อาการบาดเจ็บ',
      ];

  void _save() {
    // เลขบัตรผิดตามชนิดบัตรที่เลือก = กั้นแข็ง (ไทย 13 หลัก+หลักตรวจสอบ · ต่างชาติตามที่ฟอร์ม EMCS ตรวจ) — ชุดเดียวกับเว็บ (user สั่ง 21/09/69)
    final cidBad = cidIssue(_ctl('cid').text, thai: _cidThai, injured: true);
    if (cidBad.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('เลขบัตรประชาชนไม่ถูกต้อง — $cidBad'),
        backgroundColor: Colors.red.shade700,
        duration: const Duration(seconds: 5)));
      return;
    }
    final miss = _missing();
    if (miss.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text('กรอกไม่ครบ: ${miss.join(", ")}'),
        backgroundColor: Colors.red.shade700,
        duration: const Duration(seconds: 4)));
      return;
    }
    Navigator.pop(context, {'action': 'save', 'data': _collect()});
  }

  Map<String, dynamic> _collect() => {
        'person_type': _personType,
        'relation': _relation,
        'gender': _gender,
        'title': _title,
        'name': _ctl('name').text.trim(),
        'age': _ctl('age').text.trim(),
        'cid': _ctl('cid').text.trim(),
        'id_type': _cidThai ? 'thai' : 'foreign',
        'car_reg': _ctl('car_reg').text.trim(),
        'occupation': _ctl('occupation').text.trim(),
        'work_place': _ctl('work_place').text.trim(),
        'position': _ctl('position').text.trim(),
        'income': _ctl('income').text.trim(),
        'address': _ctl('address').text.trim(),
        'moo': _ctl('moo').text.trim(),
        'home_province': _homeProvince,
        'district': _district,
        'subdistrict': _subdistrict,
        'phone': _ctl('phone').text.trim(),
        'hospital': _ctl('hospital').text.trim(),
        'treat_from': _ctl('treat_from').text.trim(),
        'treat_to': _ctl('treat_to').text.trim(),
        'treat_cost': _ctl('treat_cost').text.trim(),
        'wound_level': _wound,
        'symptom': _ctl('symptom').text.trim(),
      };

  @override
  Widget build(BuildContext context) {
    return EditorScaffold(
      title: 'ผู้บาดเจ็บคนที่ ${widget.number}',
      subtitle: 'ข้อมูลผู้บาดเจ็บ + การรักษา',
      onSave: _save,
      onDelete: widget.isNew ? null : () => Navigator.pop(context, {'action': 'delete'}),
      children: [
        _scanBtn(),
        KPickerField(label: 'ประเภทผู้บาดเจ็บ', value: _personType, options: kPersonTypes, req: true, onSelected: (v) => setState(() => _personType = v)),
        KPickerField(label: 'ความสัมพันธ์ของผู้บาดเจ็บ', value: _relation, options: kRelations, onSelected: (v) => setState(() => _relation = v)),
        // คำนำหน้า (21/09/69 user สั่ง) — แยกช่อง บอท/XML รวมกับชื่อเป็น "นาย สมชาย ใจดี" · ไม่บังคับ (งานเก่าพิมพ์รวมในชื่อ)
        Align(alignment: Alignment.centerLeft, child: SizedBox(width: 180,
            child: KPickerField(label: 'คำนำหน้า', value: _title, options: kTitles, onSelected: (v) => setState(() => _title = v)))),
        // ชื่อผู้บาดเจ็บ + เพศ (ชาย/หญิง อยู่ซ้ายชื่อ ตาม prototype)
        Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          SizedBox(width: 148, child: Row(children: [
            kChip('ชาย', _gender == 'ชาย', () => setState(() => _gender = 'ชาย'), grow: true),
            const SizedBox(width: 6),
            kChip('หญิง', _gender == 'หญิง', () => setState(() => _gender = 'หญิง'), grow: true),
          ])),
          const SizedBox(width: 8),
          Expanded(child: kText(_ctl('name'), 'ชื่อ-นามสกุล', req: true)),
        ]),
        Align(alignment: Alignment.centerLeft, child: SizedBox(width: 150, child: kNum(_ctl('age'), 'อายุ (ปี)'))),
        // คนไทย = 13 หลัก + checksum · ต่างชาติ = พิมพ์อิสระ (บัตรต่างด้าว/หนังสือเดินทาง)
        kCidField(_ctl('cid'),
            isThai: _cidThai,
            onTypeChanged: (v) => setState(() => _cidThai = v),
            checksum: cidChecksum,
            label: 'เลขบัตรประชาชน',
            issue: cidIssue(_ctl('cid').text, thai: _cidThai, injured: true),   // เหตุผลใต้ช่อง + กั้นบันทึก (21/09/69)
            onChanged: (_) => setState(() {})),
        // เลขทะเบียน: EMCS เติมให้เองแบบ readOnly (setDefault_CarRegNo ดึงจากรถประกัน/รถคู่กรณี
        // ตามประเภทผู้บาดเจ็บ) — เลิกบังคับพนักงานพิมพ์เอง
        // เลขทะเบียน: EMCS บังคับ **ยกเว้น** ประเภท = '05 บุคคลภายนอกรถ' (คนนอกรถไม่มีทะเบียน)
        // vlidInjPerson: if (strPerson_Type != 05 && != 0) → CheckInputBoxValid(txtCar_RegNo)
        kRow2(kText(_ctl('occupation'), 'อาชีพ'),
            kText(_ctl('car_reg'), 'เลขทะเบียน', req: _carRegRequired)),
        // ที่อยู่ผู้บาดเจ็บ (21/09/69 user สั่ง): บ้านเลขที่/ถนน + หมู่ · จังหวัด · เขต/อำเภอ · ตำบล/แขวง — EMCS มีช่องเดียว
        // บอท/XML ประกอบ "46/23 ม.7 ต.ท้ายบ้าน อ.เมือง จ.สมุทรปราการ" (สูตรคู่กรณี) · มีส่วนใดส่วนหนึ่ง → 3 ช่องบังคับ
        kText(_ctl('address'), 'ที่อยู่ (บ้านเลขที่ / ถนน)', maxLines: 2, onChanged: (_) => setState(() {})),
        kRow2(
          kText(_ctl('moo'), 'หมู่', keyboardType: TextInputType.number, onChanged: (_) => setState(() {})),
          KPickerField(label: 'จังหวัด (ที่อยู่)', value: _homeProvince, options: widget.provinces, req: _hasAddr,
              onSelected: (v) => setState(() { if (v != _homeProvince) { _district = ''; _subdistrict = ''; } _homeProvince = v; })),
        ),
        kRow2(
          KPickerField(label: 'เขต / อำเภอ', value: _district, options: widget.provincesData[_homeProvince] ?? const <String>[], req: _hasAddr,
              onSelected: (v) => setState(() { if (v != _district) _subdistrict = ''; _district = v; })),
          KPickerField(label: 'ตำบล / แขวง', value: _subdistrict, options: widget.tumbonsData[_homeProvince]?[_district] ?? const <String>[], req: _hasAddr,
              onSelected: (v) => setState(() => _subdistrict = v)),
        ),
        kPhone(_ctl('phone'), 'โทรศัพท์'),
        kText(_ctl('work_place'), 'ทำงานที่'),
        kText(_ctl('position'), 'ตำแหน่ง'),
        kNum(_ctl('income'), 'รายได้ประจำเดือน/วันละ (บาท)', decimal: true),
        kText(_ctl('hospital'), 'เข้ารักษาตัวที่โรงพยาบาล', req: true),
        kRow2(KDateField(_ctl('treat_from'), 'เมื่อวันที่', yearsAhead: 0), KDateField(_ctl('treat_to'), 'ถึงวันที่', yearsAhead: 0)),
        kNum(_ctl('treat_cost'), 'ค่ารักษาพยาบาล (บาท)', decimal: true),
        kFieldLabel('ลักษณะอาการบาดเจ็บ'),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final w in kWounds)
            kChip(w['label'] as String, _wound == w['label'], () => setState(() => _wound = w['label'] as String), color: Color(w['color'] as int)),
        ]),
        kText(_ctl('symptom'), 'อาการบาดเจ็บ', maxLines: 4, req: true),
      ],
    );
  }
}
