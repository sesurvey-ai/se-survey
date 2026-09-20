// กติกาเลขบัตรตาม "ชนิดบัตรที่คนเลือก" — ต้องตรงกับเว็บ (web/src/components/cases/RecordEditors.tsx cidIssue)
// และตัวดึงงาน ISURVEY v1.1.27 (user เคาะ 21/09/69) · แก้ที่หนึ่งต้องแก้ทุกที่
import 'package:flutter_test/flutter_test.dart';
import 'package:se_survey/data/survey_master.dart';

void main() {
  const good = '1310200041822'; // ผ่านหลักตรวจสอบ (เคส #504 หลังแก้)
  const badSum = '1310200041823'; // หลักตรวจสอบผิด

  test('ว่าง / "-" / "รอตรวจสอบ" = ไม่ทราบ ไม่ใช่เลขผิด (ทุกชนิด)', () {
    for (final v in ['', '  ', '-', '--', 'รอตรวจสอบ']) {
      expect(cidIssue(v, thai: true), '');
      expect(cidIssue(v, thai: false), '');
      expect(cidIssue(v, thai: false, injured: true), '');
    }
  });

  test('ยาวเกิน 13 ตัว กั้นทุกชนิด (EMCS รับ 13)', () {
    expect(cidIssue('11310200041822', thai: true), contains('ยาว 14'));
    expect(cidIssue('AB123456789012', thai: false), contains('ยาว 14'));
    expect(cidIssue('AB123456789012', thai: false, injured: true), contains('ยาว 14'));
  });

  test('คนไทย: ต้องเป็นเลข 13 หลักผ่านหลักตรวจสอบ', () {
    expect(cidIssue(good, thai: true), '');
    expect(cidIssue(badSum, thai: true), contains('หลักตรวจสอบ'));
    expect(cidIssue('131020004182', thai: true), contains('ไม่ครบ 13 หลัก (12 หลัก)'));
    expect(cidIssue('E12345678', thai: true), contains('ตัวเลข 13 หลัก'));
  });

  test('ต่างชาติ (ผู้ขับขี่/คู่กรณี): ผ่านหมด ไม่ว่าจะสั้น/มีตัวอักษร/หลักตรวจสอบผิด', () {
    expect(cidIssue('E12345678', thai: false), '');
    expect(cidIssue('1234567', thai: false), '');
    expect(cidIssue(badSum, thai: false), '');
  });

  test('ต่างชาติ + ผู้บาดเจ็บ: ตามฟอร์ม EMCS (เลขล้วน/อักษรล้วนสั้นกว่า 13 ไม่รับ · ครบ 13 ต้องผ่านหลักตรวจสอบ)', () {
    expect(cidIssue('1234567', thai: false, injured: true), contains('สั้นกว่า 13'));
    expect(cidIssue('ABCDEFG', thai: false, injured: true), contains('สั้นกว่า 13'));
    expect(cidIssue('E12345678', thai: false, injured: true), ''); // ผสมตัวอักษร+เลข ผ่าน
    expect(cidIssue(badSum, thai: false, injured: true), contains('ไม่ผ่าน'));
    expect(cidIssue(good, thai: false, injured: true), '');
  });
}
