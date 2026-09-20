import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

// ── Design tokens (ตรงกับ survey_form_screen) ──
const kBg = Color(0xFFEEF0F4);
const kCardBg = Color(0xFFFFFFFF);
const kFill = Color(0xFFF4F6F9);
const kLine = Color(0xFFE8EBF1);
const kLineStrong = Color(0xFFDDE1E9);
const kInk = Color(0xFF1E2330);
const kMuted = Color(0xFF737D90);
const kMuted2 = Color(0xFF9AA3B4);
const kPrimary = Color(0xFF2F6BD8);
const kTint = Color(0xFFEAF1FD);
const kOk = Color(0xFF1F9D6B);
const kOkTint = Color(0xFFE4F6EE);
const kDanger = Color(0xFFDC2626);

InputDecoration kDec(String label, {String? hint, Widget? suffixIcon, bool req = false}) {
  OutlineInputBorder b(Color c) => OutlineInputBorder(borderRadius: BorderRadius.circular(13), borderSide: BorderSide(color: c, width: 1.5));
  const labelStyle = TextStyle(fontSize: 12.5, fontWeight: FontWeight.w500, color: kMuted);
  return InputDecoration(
    label: req
        ? Text.rich(TextSpan(text: label, children: const [TextSpan(text: ' ●', style: TextStyle(color: kDanger))]), style: labelStyle)
        : null,
    labelText: req ? null : label,
    hintText: hint,
    floatingLabelBehavior: FloatingLabelBehavior.always,
    labelStyle: labelStyle,
    hintStyle: const TextStyle(fontSize: 13, color: kMuted2),
    filled: true,
    fillColor: kFill,
    isDense: true,
    contentPadding: const EdgeInsets.fromLTRB(13, 10, 13, 10),
    suffixIcon: suffixIcon,
    suffixIconConstraints: const BoxConstraints(minWidth: 36, minHeight: 36),
    border: b(Colors.transparent),
    enabledBorder: b(Colors.transparent),
    focusedBorder: b(kPrimary),
    errorBorder: b(kDanger),
    focusedErrorBorder: b(kDanger),
  );
}

Widget kText(TextEditingController c, String label,
    {TextInputType? keyboardType, int maxLines = 1, void Function(String)? onChanged, String? Function(String?)? validator, Widget? suffixIcon, List<TextInputFormatter>? formatters, bool req = false}) {
  return TextFormField(
    controller: c,
    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: kInk),
    decoration: kDec(label, suffixIcon: suffixIcon, req: req),
    keyboardType: keyboardType,
    maxLines: maxLines,
    onChanged: onChanged,
    validator: validator,
    inputFormatters: formatters,
    textInputAction: maxLines == 1 ? TextInputAction.next : TextInputAction.newline,
  );
}

// ── ช่องเบอร์โทร ────────────────────────────────────────────────────────────
// ช่องเบอร์โทรของระบบประกันเป็น varchar(10) รับเฉพาะตัวเลข — ยาวกว่านั้น importer
// **ตีกลับทั้งไฟล์** ("ข้อมูลนำเข้ามีขนาดเกิน") ไม่ใช่แค่ตัดช่องนั้นทิ้ง
// เจอจริง 2026-08-10 เคส #124: เลขบัตรประชาชน 13 หลักถูกกรอกลงช่องโทรศัพท์
// (ช่องเลขบัตรปล่อยว่าง) → นำเข้าไม่ผ่านทั้งเคส กันตั้งแต่ตอนพิมพ์จะรู้ตัวทันที
const int kPhoneMaxLen = 10;

final List<TextInputFormatter> kPhoneFormatters = [
  FilteringTextInputFormatter.digitsOnly,
  LengthLimitingTextInputFormatter(kPhoneMaxLen),
];

Widget kPhone(TextEditingController c, String label, {bool req = false}) =>
    kText(c, label, keyboardType: TextInputType.phone, req: req, formatters: kPhoneFormatters);

Widget kNum(TextEditingController c, String label, {bool decimal = false, bool req = false}) {
  return TextFormField(
    controller: c,
    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: kInk),
    decoration: kDec(label, req: req),
    keyboardType: TextInputType.numberWithOptions(decimal: decimal),
    inputFormatters: decimal ? [FilteringTextInputFormatter.allow(RegExp(r'[\d.]'))] : [FilteringTextInputFormatter.digitsOnly],
  );
}

// ── ช่องวันที่ (แตะเปิด date picker พ.ศ.) + ไอคอนปฏิทิน ──
class KDateField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final bool req;
  final int defaultYearsAgo;
  final int yearsAhead;
  final ValueChanged<String>? onChanged;   // เลือกวันแล้วเรียกต่อ (เช่น วันเกิด → คำนวณอายุ)
  const KDateField(this.controller, this.label, {super.key, this.req = false, this.defaultYearsAgo = 0, this.yearsAhead = 5, this.onChanged});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () async {
        final r = await showKDate(context, title: label, current: controller.text, defaultYearsAgo: defaultYearsAgo, yearsAhead: yearsAhead);
        if (r != null) { controller.text = r; onChanged?.call(r); }
      },
      child: AbsorbPointer(
        child: TextFormField(
          controller: controller,
          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: kInk),
          decoration: kDec(label, req: req, hint: 'วว/ดด/ปปปป', suffixIcon: const Icon(Icons.calendar_month_outlined, size: 18, color: kMuted)),
        ),
      ),
    );
  }
}

// normalize ปีของวันที่ "d/m/y" เป็น พ.ศ. — OCR อ่านฝั่งอังกฤษของใบขับขี่/บัตรได้ปี ค.ศ.
// (ปี ค.ศ. หลุดเข้า wheel พ.ศ. แล้ว initialItem ติดลบ/ล้อว่าง + era ปนกันในข้อมูล)
String kNormThaiDateEra(String s) {
  final parts = s.trim().split('/');
  if (parts.length != 3) return s.trim();
  final y = int.tryParse(parts[2].trim());
  if (y == null || y < 1900 || y >= 2100) return s.trim(); // ไม่ใช่ ค.ศ. ชัดเจน → คงเดิม
  return '${parts[0].trim()}/${parts[1].trim()}/${y + 543}';
}

// อายุ (ปีเต็ม) จากวันเกิด "d/m/yyyy" — รับทั้ง พ.ศ. และ ค.ศ.; อ่านไม่ออก/ไม่สมเหตุผล = ''
String kAgeFromThaiDate(String s) {
  final p = s.trim().split('/');
  if (p.length != 3) return '';
  final d = int.tryParse(p[0].trim()), m = int.tryParse(p[1].trim()), y = int.tryParse(p[2].trim());
  if (d == null || m == null || y == null) return '';
  final yearAd = y > 2200 ? y - 543 : y;   // ปี > 2200 = พ.ศ. แน่นอน
  final now = DateTime.now();
  var age = now.year - yearAd;
  if (now.month < m || (now.month == m && now.day < d)) age--;
  return (age < 0 || age > 120) ? '' : '$age';
}

// date picker พ.ศ. (wheel) → คืน "dd/mm/yyyy" หรือ null
Future<String?> showKDate(BuildContext context, {String title = 'เลือกวันที่', String? current, int defaultYearsAgo = 0, int yearsAhead = 5}) {
  FocusManager.instance.primaryFocus?.unfocus();
  final now = DateTime.now();
  const thaiMonths = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  int selDay = now.day, selMonth = now.month, selYear = now.year + 543 - defaultYearsAgo;
  final ex = (current ?? '').trim();
  if (ex.isNotEmpty) {
    final p = ex.split('/');
    if (p.length == 3) {
      selDay = int.tryParse(p[0]) ?? selDay;
      selMonth = int.tryParse(p[1]) ?? selMonth;
      selYear = int.tryParse(p[2]) ?? selYear;
      // ค่าเก่าอาจเป็นปี ค.ศ. (OCR อ่านฝั่งอังกฤษของเอกสาร) → แปลงเป็น พ.ศ.
      if (selYear >= 1900 && selYear < 2100) selYear += 543;
    }
  }
  final minYear = now.year + 543 - 100;
  // clamp เข้าช่วงของ wheel — ปีนอกช่วงทำ initialItem ติดลบ/เกิน childCount
  // (ล้อว่าง + ค่าที่โชว์ไม่ตรงค่าที่คืน)
  final maxYear = minYear + 100 + yearsAhead;
  if (selYear < minYear) selYear = minYear;
  if (selYear > maxYear) selYear = maxYear;
  return showModalBottomSheet<String>(
    context: context,
    builder: (ctx) => StatefulBuilder(builder: (ctx, setSt) {
      final maxDay = DateTime(selYear - 543, selMonth + 1, 0).day;
      if (selDay > maxDay) selDay = maxDay;
      Widget wheel(int count, int initial, ValueChanged<int> onSel, String Function(int) label, {int flex = 2}) => Expanded(
            flex: flex,
            child: ListWheelScrollView.useDelegate(
              itemExtent: 36,
              diameterRatio: 1.5,
              physics: const FixedExtentScrollPhysics(),
              controller: FixedExtentScrollController(initialItem: initial),
              onSelectedItemChanged: onSel,
              childDelegate: ListWheelChildBuilderDelegate(childCount: count, builder: (ctx, i) => Center(child: Text(label(i), style: const TextStyle(fontSize: 17)))),
            ),
          );
      return SizedBox(
        height: 320,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(children: [
            Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              TextButton(
                onPressed: () => Navigator.pop(ctx, '${selDay.toString().padLeft(2, '0')}/${selMonth.toString().padLeft(2, '0')}/$selYear'),
                child: const Text('ตกลง', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
              ),
            ]),
            const SizedBox(height: 8),
            Expanded(child: Row(children: [
              wheel(maxDay, selDay - 1, (i) => setSt(() => selDay = i + 1), (i) => '${i + 1}'),
              wheel(12, selMonth - 1, (i) => setSt(() => selMonth = i + 1), (i) => thaiMonths[i], flex: 4),
              wheel(101 + yearsAhead, selYear - minYear, (i) => setSt(() => selYear = minYear + i), (i) => '${minYear + i}', flex: 3),
            ])),
          ]),
        ),
      );
    }),
  );
}

// req: true = จุดแดงท้ายป้าย เหมือนช่องกรอกทั่วไป (ใช้กับกลุ่มปุ่มเลือกที่ไม่มี label ในตัว)
Widget kFieldLabel(String t, {bool req = false}) => Padding(
      padding: const EdgeInsets.only(top: 2, bottom: 2),
      child: Text.rich(
        TextSpan(text: t, children: req ? const [TextSpan(text: ' ●', style: TextStyle(color: kDanger))] : null),
        style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: kInk),
      ),
    );

Widget kSubhead(String t) => Padding(
      padding: const EdgeInsets.only(top: 10, bottom: 2),
      child: Row(children: [
        Text(t, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: kMuted)),
        const SizedBox(width: 8),
        Expanded(child: Container(height: 1, color: kLine)),
      ]),
    );

Widget kRow2(Widget a, Widget b) =>
    Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(child: a), const SizedBox(width: 10), Expanded(child: b)]);

// แถวสวิตช์ (progressive disclosure — เปิดแล้วโผล่ช่องเพิ่ม)
Widget kSwitch(String label, bool value, ValueChanged<bool> onChanged) => Container(
      padding: const EdgeInsets.fromLTRB(13, 2, 8, 2),
      decoration: BoxDecoration(color: kFill, borderRadius: BorderRadius.circular(13), border: Border.all(color: kLine)),
      child: Row(children: [
        Expanded(child: Text(label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: kInk))),
        Switch(value: value, activeThumbColor: kPrimary, onChanged: onChanged),
      ]),
    );

Widget kChip(String label, bool selected, VoidCallback onTap, {Color? color, bool grow = false}) {
  final c = color ?? kPrimary;
  final chip = GestureDetector(
    onTap: onTap,
    child: AnimatedContainer(
      duration: const Duration(milliseconds: 120),
      padding: EdgeInsets.symmetric(horizontal: grow ? 8 : 14, vertical: 9),
      alignment: grow ? Alignment.center : null,
      decoration: BoxDecoration(
        color: selected ? c : Colors.white,
        borderRadius: BorderRadius.circular(11),
        border: Border.all(color: selected ? c : kLineStrong, width: 1.5),
      ),
      child: Text(label, style: TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: selected ? Colors.white : (color ?? kMuted))),
    ),
  );
  return grow ? Expanded(child: chip) : chip;
}

// ── ช่องเลขบัตร + ตัวเลือก คนไทย/ต่างชาติ (ใช้ร่วมกันทั้งผู้ขับขี่/คู่กรณี/ผู้บาดเจ็บ) ──
//
// คนไทย   = ตัวเลข 13 หลัก + ตรวจ checksum (ไอคอน ✓/⚠ ท้ายช่อง) เหมือนที่เคยเป็น
// ต่างชาติ = พิมพ์อะไรก็ได้ ไม่ตรวจ checksum (บัตรต่างด้าว/หนังสือเดินทาง)
//
// ⚠️ จำกัด 13 ตัวทั้งสองแบบ เพราะช่องบน EMCS (txtDri_CardID) เป็น maxlength=13
// พิมพ์ยาวกว่านั้นเบราว์เซอร์จะตัดทิ้งเงียบ ๆ ตอนบอทกรอก ไม่มี error ให้เห็น
// (ช่องผู้บาดเจ็บบน EMCS รับ 20 แต่คุมเท่ากันหมดเพื่อไม่ให้พนักงานต้องจำเป็นช่อง ๆ)
const int kCidMaxLen = 13;

Widget kCidField(
  TextEditingController c, {
  required bool isThai,
  required ValueChanged<bool> onTypeChanged,
  required bool Function(String) checksum,
  String label = 'บัตรประชาชนเลขที่',
  String foreignLabel = 'เลขบัตรต่างด้าว/หนังสือเดินทาง',
  bool req = true,
  ValueChanged<String>? onChanged,
  // เหตุที่เลขนี้ไม่ผ่านตามชนิดบัตรที่เลือก (cidIssue ใน survey_master.dart) — '' = ผ่าน (21/09/69)
  // โชว์เป็นข้อความแดงใต้ช่อง ให้พนักงานรู้ก่อนกดบันทึกว่าต้องพิมพ์ใหม่หรือเอาติ๊ก "ไทย" ออก
  String issue = '',
}) {
  final digits = c.text.replaceAll(RegExp(r'\D'), '');
  final ok = digits.length == kCidMaxLen && checksum(c.text);
  // ⚠️ สลับชนิดคีย์บอร์ดของช่องที่ "กำลังโฟกัสอยู่" ไม่มีผล — Flutter ตั้งชนิดคีย์บอร์ด
  // ตอนเปิด input connection ครั้งแรก rebuild เฉย ๆ ไม่เปลี่ยนให้ (เจอจริง 2026-08-06:
  // เอาติ๊ก "ไทย" ออกแล้วคีย์บอร์ดยังเป็นตัวเลข พิมพ์ตัวอักษรไม่ได้)
  // → ปิดคีย์บอร์ดก่อนสลับ + ใส่ key ให้ TextFormField ถูกสร้างใหม่ทั้งตัว
  void toggle(bool v) {
    FocusManager.instance.primaryFocus?.unfocus();
    onTypeChanged(v);
  }

  return Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
    // ติ๊ก "ไทย" = บัตรประชาชน (ค่าเริ่มต้น) · เอาติ๊กออก = ต่างชาติ
    // (เดิมเป็น chip 2 ตัว กินที่จนคำว่า "ต่างชาติ" ตกบรรทัด — user เสนอเปลี่ยน 2026-08-06)
    GestureDetector(
      onTap: () => toggle(!isThai),
      behavior: HitTestBehavior.opaque,
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        SizedBox(
          width: 24, height: 24,
          child: Checkbox(
            value: isThai,
            onChanged: (v) => toggle(v ?? true),
            activeColor: kPrimary,
            visualDensity: VisualDensity.compact,
            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
        ),
        const SizedBox(width: 6),
        Text('ไทย', style: TextStyle(
            fontSize: 14, fontWeight: FontWeight.w600,
            color: isThai ? kInk : kMuted)),
      ]),
    ),
    const SizedBox(width: 10),
    Expanded(
      child: TextFormField(
        // key ผูกกับชนิดบัตร → สลับติ๊กแล้ว widget ถูกสร้างใหม่ ได้คีย์บอร์ดชนิดใหม่จริง
        key: ValueKey('cid_${isThai ? 'th' : 'fo'}_${identityHashCode(c)}'),
        controller: c,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500, color: kInk),
        decoration: kDec(isThai ? label : foreignLabel, req: req,
            suffixIcon: (isThai && digits.length == kCidMaxLen)
                ? Icon(ok ? Icons.check_circle : Icons.error_outline,
                    size: 18, color: ok ? kOk : kDanger)
                : null)
            .copyWith(errorText: issue.isEmpty ? null : issue, errorMaxLines: 3,
                errorStyle: const TextStyle(fontSize: 11.5, color: kDanger, height: 1.25)),
        keyboardType: isThai ? TextInputType.number : TextInputType.text,
        textCapitalization:
            isThai ? TextCapitalization.none : TextCapitalization.characters,
        inputFormatters: [
          LengthLimitingTextInputFormatter(kCidMaxLen),
          if (isThai) FilteringTextInputFormatter.digitsOnly,
        ],
        onChanged: onChanged,
      ),
    ),
  ]);
}

// ── ช่องเลือก (เปิด searchable picker) ──
class KPickerField extends StatelessWidget {
  final String label;
  final String value;
  final String hint;
  final List<String> options;
  final ValueChanged<String> onSelected;
  final bool req;
  const KPickerField({super.key, required this.label, required this.value, required this.options, required this.onSelected, this.hint = 'เลือก', this.req = false});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () async {
        final r = await showKPicker(context, label, options, current: value);
        if (r != null) onSelected(r);
      },
      child: InputDecorator(
        decoration: kDec(label, req: req, suffixIcon: const Icon(Icons.expand_more, color: kMuted, size: 20)),
        child: Text(
          // แสดง placeholder เฉพาะช่องบังคับ; ช่องไม่บังคับปล่อยว่าง (label ลอยด้านบนพออยู่แล้ว)
          value.isNotEmpty ? value : (req ? hint : ''),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontSize: value.isNotEmpty ? 15 : 13, fontWeight: FontWeight.w500, color: value.isNotEmpty ? kInk : kMuted2),
        ),
      ),
    );
  }
}

Future<String?> showKPicker(BuildContext context, String title, List<String> options, {String? current}) {
  // ระยะเผื่อแถบปุ่มล่างของเครื่อง — ต้องอ่านจาก context ของ "หน้า" ไม่ใช่ของ sheet
  // (ข้างใน showModalBottomSheet ค่า viewPadding.bottom ถูกหักเป็น 0 ตัวเลือกท้ายลิสต์
  //  เลยไปนอนอยู่ใต้แถบปุ่ม กดไม่โดน — เจอจริงกับ "บริษัท ไอโออิ กรุงเทพ ประกันภัย"
  //  ซึ่งเป็นตัวสุดท้ายของลิสต์ประกันคู่กรณี 22/08/69)
  final safeBottom = MediaQuery.of(context).viewPadding.bottom;
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(18))),
    builder: (ctx) {
      final q = ValueNotifier<String>('');
      return DraggableScrollableSheet(
        initialChildSize: 0.7,
        minChildSize: 0.4,
        maxChildSize: 0.92,
        expand: false,
        builder: (ctx, scroll) => Padding(
          padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
          child: Column(children: [
            const SizedBox(height: 8),
            Container(width: 40, height: 4, decoration: BoxDecoration(color: kLineStrong, borderRadius: BorderRadius.circular(2))),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 10, 16, 8),
              child: Row(children: [
                Expanded(child: Text(title, style: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w700, color: kInk))),
                GestureDetector(onTap: () => Navigator.pop(ctx), child: const Icon(Icons.close, color: kMuted)),
              ]),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                autofocus: false,
                onChanged: (v) => q.value = v,
                decoration: kDec('ค้นหา', hint: 'พิมพ์เพื่อค้นหา').copyWith(prefixIcon: const Icon(Icons.search, size: 20, color: kMuted)),
              ),
            ),
            const SizedBox(height: 6),
            Expanded(
              child: ValueListenableBuilder<String>(
                valueListenable: q,
                builder: (ctx, query, _) {
                  final filtered = query.isEmpty ? options : options.where((o) => o.toLowerCase().contains(query.toLowerCase())).toList();
                  return ListView.builder(
                    controller: scroll,
                    padding: EdgeInsets.only(bottom: safeBottom + 24), // ตัวเลือกท้ายลิสต์ไม่โดน nav bar บัง
                    itemCount: filtered.length,
                    itemBuilder: (ctx, i) {
                      final o = filtered[i];
                      final sel = o == current;
                      return ListTile(
                        dense: true,
                        title: Text(o, style: TextStyle(fontSize: 14.5, fontWeight: sel ? FontWeight.w700 : FontWeight.w500, color: sel ? kPrimary : kInk)),
                        trailing: sel ? const Icon(Icons.check, color: kPrimary, size: 20) : null,
                        onTap: () => Navigator.pop(ctx, o),
                      );
                    },
                  );
                },
              ),
            ),
          ]),
        ),
      );
    },
  );
}

// ── โครงหน้า editor เต็มจอ (app bar + body scroll + bottom save/delete) ──
class EditorScaffold extends StatelessWidget {
  final String title;
  final String? subtitle;
  final List<Widget> children;
  final VoidCallback onSave;
  final VoidCallback? onDelete;
  final String saveLabel;
  const EditorScaffold({super.key, required this.title, this.subtitle, required this.children, required this.onSave, this.onDelete, this.saveLabel = 'บันทึก'});

  @override
  Widget build(BuildContext context) {
    // กันปุ่ม back / ปัดกลับ ทิ้งข้อมูลที่กรอกเงียบ ๆ — ปุ่มบันทึกใช้ Navigator.pop โดยตรง (ไม่โดน PopScope กั้น)
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        final leave = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('ออกโดยไม่บันทึก?'),
            content: const Text('ข้อมูลที่กรอกในหน้านี้จะไม่ถูกบันทึก'),
            actions: [
              TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('กรอกต่อ')),
              TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('ออก', style: TextStyle(color: kDanger))),
            ],
          ),
        );
        if (leave == true && context.mounted) Navigator.pop(context);
      },
      child: Scaffold(
      backgroundColor: kBg,
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        foregroundColor: kInk,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        titleSpacing: 0,
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(title, style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.w700, color: kInk)),
          if (subtitle != null) Text(subtitle!, style: const TextStyle(fontSize: 11, color: kMuted)),
        ]),
        actions: [
          if (onDelete != null)
            IconButton(tooltip: 'ลบ', onPressed: onDelete, icon: const Icon(Icons.delete_outline, color: kDanger)),
        ],
        bottom: PreferredSize(preferredSize: const Size.fromHeight(1), child: Container(height: 1, color: kLine)),
      ),
      bottomNavigationBar: Container(
        padding: EdgeInsets.fromLTRB(12, 10, 12, 10 + MediaQuery.of(context).padding.bottom),
        decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: kLine))),
        child: SizedBox(
          height: 50,
          child: ElevatedButton.icon(
            onPressed: onSave,
            icon: const Icon(Icons.check, size: 20),
            label: Text(saveLabel, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            style: ElevatedButton.styleFrom(backgroundColor: kPrimary, foregroundColor: Colors.white, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14))),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 16, 14, 28),
        children: [
          for (var i = 0; i < children.length; i++) ...[
            children[i],
            if (i < children.length - 1) const SizedBox(height: 10),
          ],
        ],
      ),
      ),
    );
  }
}
