-- 061: เติม users.supervisor_id ให้ตรงกับทีมที่สังกัด (staff_groups) — ครั้งเดียว (14/09/69)
--
-- คอลัมน์ "หัวหน้า" ในหน้าทะเบียนพนักงานสำรวจอ่านจาก users.supervisor_id ซึ่งเดิมมีแต่ตัวนำเข้าไฟล์ตารางเวรเขียน
-- ส่วนหน้าจัดการผู้ใช้/จัดการทีมเขียนลง staff_groups → ช่างที่ถูกย้ายทีมแล้วยังโชว์หัวหน้าเก่า
-- ตั้งแต่ตอนนี้ staffGroup.service ซิงก์ให้ทุกครั้งที่เปลี่ยนทีม ไฟล์นี้เก็บของเดิมให้ตรงกัน
-- (เฉพาะช่างที่มีทีม · ทีมที่ยังไม่มีบัญชีผู้ตรวจได้ NULL · ช่างที่ไม่มีทีมไม่แตะ)
--
-- รันด้วยมือบน production: psql "$DATABASE_URL" -f 061_supervisor_from_team.sql

UPDATE users u
   SET supervisor_id = sub.checker_id
  FROM (SELECT DISTINCT ON (m.surveyor_id) m.surveyor_id, g.checker_id
          FROM staff_group_members m JOIN staff_groups g ON g.id = m.group_id
         WHERE m.surveyor_id IS NOT NULL
         ORDER BY m.surveyor_id, m.id DESC) sub
 WHERE u.id = sub.surveyor_id
   AND u.supervisor_id IS DISTINCT FROM sub.checker_id;
