import 'package:flutter/material.dart';
import '../../widgets/form_kit.dart';
import '../../data/survey_master.dart' show kTitles;
import 'opponent_editor.dart' show OpponentEditor;   // addrHasData — กติกาที่อยู่เดียวกับคู่กรณี

/// Editor ทรัพย์สินเสียหาย (Phase 3) — คืน {'action':'save','data':{...}} หรือ {'action':'delete'}
class PropertyEditor extends StatefulWidget {
  final Map<String, dynamic> data;
  final List<String> provinces;                                   // ที่อยู่เจ้าของแยกช่อง (21/09/69)
  final Map<String, List<String>> provincesData;
  final Map<String, Map<String, List<String>>> tumbonsData;
  final int number;
  final bool isNew;
  const PropertyEditor({super.key, required this.data, this.provinces = const [], this.provincesData = const {}, this.tumbonsData = const {}, required this.number, this.isNew = false});

  @override
  State<PropertyEditor> createState() => _PropertyEditorState();
}

class _PropertyEditorState extends State<PropertyEditor> {
  late final Map<String, TextEditingController> _c;
  String _ownerTitle = '';   // คำนำหน้าเจ้าของ (21/09/69) — บริษัทเว้นว่าง → บอท/XML รวม "นาย สมศักดิ์ มั่นคง"
  String _ownerProvince = '', _ownerDistrict = '', _ownerSubdistrict = '';   // ที่อยู่เจ้าของแยกช่อง
  TextEditingController _ctl(String k) => _c[k]!;

  @override
  void initState() {
    super.initState();
    _c = {
      for (final k in ['item', 'cause', 'detail', 'estimated_cost', 'owner_name', 'owner_address', 'owner_moo', 'owner_phone'])
        k: TextEditingController(text: (widget.data[k] ?? '').toString()),
    };
    _ownerTitle = (widget.data['owner_title'] ?? '').toString();
    _ownerProvince = (widget.data['owner_province'] ?? '').toString();
    _ownerDistrict = (widget.data['owner_district'] ?? '').toString();
    _ownerSubdistrict = (widget.data['owner_subdistrict'] ?? '').toString();
  }

  // ที่อยู่เจ้าของ (21/09/69): มีส่วนใดส่วนหนึ่ง → จังหวัด/อำเภอ/ตำบล ต้องครบ (กติกาเดียวกับคู่กรณี · เว็บ propertyHasAddress)
  bool get _hasAddr => OpponentEditor.addrHasData(_ctl('owner_address').text, _ctl('owner_moo').text, _ownerProvince, _ownerDistrict, _ownerSubdistrict);

  @override
  void dispose() {
    for (final c in _c.values) { c.dispose(); }
    super.dispose();
  }

  Map<String, dynamic> _collect() => {
        'item': _ctl('item').text.trim(),
        'cause': _ctl('cause').text.trim(),
        'detail': _ctl('detail').text.trim(),
        'estimated_cost': _ctl('estimated_cost').text.trim(),
        'owner_title': _ownerTitle,
        'owner_name': _ctl('owner_name').text.trim(),
        'owner_address': _ctl('owner_address').text.trim(),
        'owner_moo': _ctl('owner_moo').text.trim(),
        'owner_province': _ownerProvince,
        'owner_district': _ownerDistrict,
        'owner_subdistrict': _ownerSubdistrict,
        'owner_phone': _ctl('owner_phone').text.trim(),
      };

  // ช่องที่ EMCS บังคับต่อทรัพย์สิน 1 ชิ้น (vlidAsset) — ไม่ครบ = บันทึกบล็อกทรัพย์สินไม่ผ่าน
  List<String> _missing() => [
        if (_ctl('item').text.trim().isEmpty) 'รายการทรัพย์สิน',
        if (_ctl('cause').text.trim().isEmpty) 'สาเหตุที่ทรัพย์สินเสียหาย',
        if (_ctl('detail').text.trim().isEmpty) 'รายละเอียด/ลักษณะความเสียหาย',
        if (_ctl('owner_name').text.trim().isEmpty) 'ชื่อเจ้าของทรัพย์สิน',
        if (_hasAddr && _ownerProvince.isEmpty) 'จังหวัด (ที่อยู่เจ้าของ)',
        if (_hasAddr && _ownerDistrict.isEmpty) 'เขต/อำเภอ (ที่อยู่เจ้าของ)',
        if (_hasAddr && _ownerSubdistrict.isEmpty) 'ตำบล/แขวง (ที่อยู่เจ้าของ)',
      ];

  void _save() {
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

  @override
  Widget build(BuildContext context) {
    return EditorScaffold(
      title: 'ทรัพย์สินชิ้นที่ ${widget.number}',
      subtitle: 'ทรัพย์สินบุคคลภายนอกที่เสียหาย',
      onSave: _save,
      onDelete: widget.isNew ? null : () => Navigator.pop(context, {'action': 'delete'}),
      children: [
        kText(_ctl('item'), 'รายการทรัพย์สิน', req: true),
        kText(_ctl('cause'), 'สาเหตุที่ทรัพย์สินเสียหาย', maxLines: 3, req: true),
        kText(_ctl('detail'), 'รายละเอียด/ลักษณะความเสียหาย', maxLines: 3, req: true),
        kNum(_ctl('estimated_cost'), 'ค่าความเสียหายประมาณ (บาท)', decimal: true),
        kSubhead('เจ้าของทรัพย์สิน'),
        // คำนำหน้าเจ้าของ (21/09/69 user สั่ง) — เฉพาะที่เป็นคน บริษัทเว้นว่าง · บอท/XML รวมกับชื่อ "นาย สมศักดิ์ มั่นคง"
        Align(alignment: Alignment.centerLeft, child: SizedBox(width: 180,
            child: KPickerField(label: 'คำนำหน้า (เว้นว่างถ้าเป็นบริษัท)', value: _ownerTitle, options: kTitles, onSelected: (v) => setState(() => _ownerTitle = v)))),
        kText(_ctl('owner_name'), 'ชื่อเจ้าของทรัพย์สิน', req: true),
        // ที่อยู่เจ้าของแยกช่อง (21/09/69): บ้านเลขที่/ถนน + หมู่ · จังหวัด · เขต/อำเภอ · ตำบล/แขวง — EMCS ช่องเดียว บอท/XML ประกอบด้วยเว้นวรรค (สูตรคู่กรณี)
        kText(_ctl('owner_address'), 'ที่อยู่ (บ้านเลขที่ / ถนน)', maxLines: 2, onChanged: (_) => setState(() {})),
        kRow2(
          kText(_ctl('owner_moo'), 'หมู่', keyboardType: TextInputType.number, onChanged: (_) => setState(() {})),
          KPickerField(label: 'จังหวัด (ที่อยู่)', value: _ownerProvince, options: widget.provinces, req: _hasAddr,
              onSelected: (v) => setState(() { if (v != _ownerProvince) { _ownerDistrict = ''; _ownerSubdistrict = ''; } _ownerProvince = v; })),
        ),
        kRow2(
          KPickerField(label: 'เขต / อำเภอ', value: _ownerDistrict, options: widget.provincesData[_ownerProvince] ?? const <String>[], req: _hasAddr,
              onSelected: (v) => setState(() { if (v != _ownerDistrict) _ownerSubdistrict = ''; _ownerDistrict = v; })),
          KPickerField(label: 'ตำบล / แขวง', value: _ownerSubdistrict, options: widget.tumbonsData[_ownerProvince]?[_ownerDistrict] ?? const <String>[], req: _hasAddr,
              onSelected: (v) => setState(() => _ownerSubdistrict = v)),
        ),
        kText(_ctl('owner_phone'), 'โทรศัพท์ที่ติดต่อได้', keyboardType: TextInputType.phone),
      ],
    );
  }
}
