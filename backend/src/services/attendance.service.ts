import { db } from '../config/database';

// เวลาท้องถิ่นไทย — "วันนี้" และเวลาเข้า/ออก อิงเขตเวลา Asia/Bangkok ไม่ขึ้นกับ TZ ของ server
const BKK = "(NOW() AT TIME ZONE 'Asia/Bangkok')";
const BKK_DATE = `${BKK}::date`;

// "รอบทิ้งร้าง" = เปิดค้าง (check_out_at IS NULL) นานเกิน STALE_OPEN_HOURS ชม. (เวลาไทย)
// กะยาวสุดจริง = FIX 14:00–23:00 = 9 ชม. (เวรดึก 23:00–07:00 = 8 ชม.) → 16 = 9 + เผื่อลืมเช็คเอาท์ ~7 ชม.
// และ < 24 ชม. จึงไม่มีทางไปแตะกะที่ยังทำงานจริง (โดยเฉพาะเวรดึกที่ข้ามคืนโดยชอบธรรม)
// ใช้ค่านี้ร่วมกันทั้ง auto-close (checkIn) และเกณฑ์ "รอบเปิดยังสด" (today) ให้ตรงกันเป๊ะ
export const STALE_OPEN_HOURS = 16;

// คืนเวลาเป็น string HH:MM (เวลาไทย) และวันที่ YYYY-MM-DD — แสดงผลได้ตรง ๆ ไม่ต้องแปลง timezone ฝั่ง client
const RET = `
  id, user_id,
  to_char(work_date,    'YYYY-MM-DD') AS work_date,
  to_char(check_in_at,  'HH24:MI')    AS check_in_time,
  to_char(check_out_at, 'HH24:MI')    AS check_out_time,
  check_in_lat, check_in_lng, check_out_lat, check_out_lng, check_in_photo`;

export const attendanceService = {
  // ลงเวลาเข้างาน — เปิด "รอบใหม่" (1 แถว) ได้ก็ต่อเมื่อไม่มีรอบที่ยังไม่ลงเวลาออกค้างอยู่
  // INSERT ... WHERE NOT EXISTS: ถ้ามีรอบเปิดค้าง จะ insert 0 แถว → คืน null ให้ controller แจ้งเตือน
  async checkIn(userId: number, lat: number | null, lng: number | null, photo: string | null) {
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      // 1) ปิด "รอบทิ้งร้าง" ก่อน: ตั้ง check_out_at = เวลาเข้างานเดิม (duration 0 ไม่ให้นับชั่วโมงเกินจริง) ไม่มี GPS ออก
      //    เทียบเวลาไทยทั้งสองฝั่ง (check_in_at เก็บเป็น naive เวลาไทย) — ห้ามใช้ NOW() ดิบ (UTC คลาด +7 ชม. = บั๊กของ _close_old_rounds.js)
      await client.query(
        `UPDATE attendance_records
            SET check_out_at = check_in_at
          WHERE user_id = $1
            AND check_out_at IS NULL
            AND check_in_at < ${BKK} - INTERVAL '${STALE_OPEN_HOURS} hours'`,
        [userId]
      );
      // 2) เปิดรอบใหม่ได้เมื่อไม่เหลือรอบเปิดค้าง (รอบที่ยัง < STALE_OPEN_HOURS ชม. = ทำงานจริง/เวรดึก → ยังบล็อกถูกต้อง)
      const { rows } = await client.query(
        `INSERT INTO attendance_records (user_id, work_date, check_in_at, check_in_lat, check_in_lng, check_in_photo)
         SELECT $1, ${BKK_DATE}, ${BKK}, $2, $3, $4
         WHERE NOT EXISTS (
           SELECT 1 FROM attendance_records WHERE user_id = $1 AND check_out_at IS NULL
         )
         RETURNING ${RET}`,
        [userId, lat, lng, photo]
      );
      await client.query('COMMIT');
      return rows[0] ?? null;
    } catch (err) {
      await client.query('ROLLBACK');
      // แข่งกดเข้างานพร้อมกัน 2 อุปกรณ์: ตัวที่แพ้ชน partial unique index (user_id, work_date) WHERE check_out_at IS NULL → 23505
      //   → คืน null ให้ controller แจ้งเตือน 400 เป็นมิตร (ไม่ปล่อยให้หลุดเป็น 500)
      if ((err as { code?: string })?.code === '23505') return null;
      throw err;
    } finally {
      client.release();
    }
  },

  // ลงเวลาออกงาน — ปิดรอบที่ยังเปิดค้างอยู่ล่าสุดของพนักงาน (ถ้าไม่มี → คืน null)
  async checkOut(userId: number, lat: number | null, lng: number | null) {
    const { rows } = await db.query(
      `UPDATE attendance_records
          SET check_out_at  = ${BKK},
              check_out_lat = $2,
              check_out_lng = $3
        WHERE id = (
          SELECT id FROM attendance_records
            WHERE user_id = $1 AND check_out_at IS NULL
            ORDER BY check_in_at DESC
            LIMIT 1
        )
        RETURNING ${RET}`,
      [userId, lat, lng]
    );
    return rows[0] ?? null;
  },

  // สถานะวันนี้ — รายการรอบของวันนี้ (เรียงตามเวลาเข้า) + รอบที่เปิดค้าง (ถ้ามี) ไว้กำหนดปุ่มเข้า/ออก
  async today(userId: number) {
    const { rows: sessions } = await db.query(
      `SELECT ${RET} FROM attendance_records
        WHERE user_id = $1 AND work_date = ${BKK_DATE}
        ORDER BY check_in_at ASC`,
      [userId]
    );
    // เฉพาะรอบเปิดที่ยัง "สด" (< STALE_OPEN_HOURS ชม.) จึงนับว่า open →
    // รอบทิ้งร้างจะไม่ขึ้นเป็น open ทำให้ปุ่มมือถือกลับเป็น "ลงเวลาเข้า" (กดแล้วไป checkIn ซึ่ง auto-close ให้เอง)
    const { rows: open } = await db.query(
      `SELECT ${RET} FROM attendance_records
        WHERE user_id = $1 AND check_out_at IS NULL
          AND check_in_at >= ${BKK} - INTERVAL '${STALE_OPEN_HOURS} hours'
        ORDER BY check_in_at DESC LIMIT 1`,
      [userId]
    );
    return { sessions, open: open[0] ?? null };
  },

  // ประวัติของฉัน (รอบล่าสุดก่อน)
  async listMine(userId: number, limit = 50) {
    const lim = Math.min(Math.max(limit, 1), 200);
    const { rows } = await db.query(
      `SELECT ${RET} FROM attendance_records
        WHERE user_id = $1
        ORDER BY check_in_at DESC LIMIT $2`,
      [userId, lim]
    );
    return rows;
  },

  // รายงานสำหรับ admin/callcenter — แบ่งหน้า (limit/offset) + สรุปยอด + รายชื่อพนักงานในช่วง
  // มุมมองรายเดือนฝั่งเว็บส่ง from/to เป็นขอบเดือน → โหลดทีละหน้า ไม่ดึงทั้งประวัติมากองในหน้าเดียว
  async report(q: Record<string, unknown>) {
    // range = เฉพาะช่วงวัน (ใช้กับ dropdown รายชื่อพนักงาน — ไม่ผูกตัวกรองคน/ค้นหา จะได้สลับคนได้)
    const range: string[] = [];
    const rangeParams: unknown[] = [];
    let p = 1;
    const from = String(q.from || '');
    const to = String(q.to || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { range.push(`ar.work_date >= $${p++}`); rangeParams.push(from); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { range.push(`ar.work_date <= $${p++}`); rangeParams.push(to); }
    // full = range + ตัวกรองพนักงาน/ค้นหา (ใช้กับ rows + total + summary)
    const full = [...range];
    const fullParams: unknown[] = [...rangeParams];
    if (q.user_id && Number.isFinite(Number(q.user_id))) { full.push(`ar.user_id = $${p++}`); fullParams.push(Number(q.user_id)); }
    const term = String(q.q || '').trim();
    if (term) {
      const digits = term.replace(/\D/g, '');
      const nameExpr = `TRIM(COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,''))`;
      if (digits) {
        full.push(`(u.code ILIKE $${p} OR ${nameExpr} ILIKE $${p} OR regexp_replace(u.code, '\\D', '', 'g') LIKE $${p + 1})`);
        fullParams.push(`%${term}%`, `%${digits}%`); p += 2;
      } else {
        full.push(`(u.code ILIKE $${p} OR ${nameExpr} ILIKE $${p})`);
        fullParams.push(`%${term}%`); p += 1;
      }
    }
    const rangeSql = range.length ? `WHERE ${range.join(' AND ')}` : '';
    const fullSql = full.length ? `WHERE ${full.join(' AND ')}` : '';

    // ไม่ส่ง limit มา = พฤติกรรมเดิม (สูงสุด 5000 แถว) — บอร์ดเข้างานพึ่งการดึงทั้งช่วง; หน้ารายเดือนส่ง limit=50 เพื่อแบ่งหน้า
    const rawLimit = Number(q.limit);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 5000) : 5000;
    const offset = Math.max(Number(q.offset) || 0, 0);

    // สรุป + total (ตามตัวกรอง full) — JOIN users เพราะ term อาจอ้าง u.*
    const agg = await db.query(
      `SELECT count(*)::int AS total,
              count(DISTINCT ar.user_id)::int AS staff,
              count(*) FILTER (WHERE ar.check_out_at IS NOT NULL)::int AS complete,
              count(*) FILTER (WHERE ar.check_out_at IS NULL)::int AS open_out
         FROM attendance_records ar JOIN users u ON u.id = ar.user_id ${fullSql}`,
      fullParams
    );
    const s = agg.rows[0] || { total: 0, staff: 0, complete: 0, open_out: 0 };

    const { rows } = await db.query(
      `SELECT ar.id, ar.user_id,
              to_char(ar.work_date,    'YYYY-MM-DD') AS work_date,
              to_char(ar.check_in_at,  'HH24:MI')    AS check_in_time,
              to_char(ar.check_out_at, 'HH24:MI')    AS check_out_time,
              ar.check_in_lat, ar.check_in_lng, ar.check_out_lat, ar.check_out_lng, ar.check_in_photo,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS user_name, u.username, u.code
         FROM attendance_records ar
         JOIN users u ON u.id = ar.user_id
         ${fullSql}
        ORDER BY ar.work_date DESC, user_name ASC, ar.check_in_at ASC
        LIMIT ${limit} OFFSET ${offset}`,
      fullParams
    );

    // รายชื่อพนักงานที่มีข้อมูลในช่วง (สำหรับ dropdown) — เรียงตามชื่อ
    const emps = await db.query(
      `SELECT DISTINCT ar.user_id, u.code,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS name
         FROM attendance_records ar JOIN users u ON u.id = ar.user_id ${rangeSql}
        ORDER BY name ASC`,
      rangeParams
    );

    return {
      rows,
      total: s.total,
      summary: { records: s.total, staff: s.staff, complete: s.complete, openOut: s.open_out },
      employees: emps.rows,
      limit,
      offset,
    };
  },

  // รูปลงเวลาล่าสุดของแต่ละคน (คนละ 1 แถว) — บอร์ดเข้างานใช้เป็นรูปของคนที่ยังไม่ได้ลงเวลาในวันที่ดู
  // ตัวลบรูป (utils/photoRetention.ts) เก็บรูปล่าสุดของทุกคนไว้เสมอ รูปนี้จึงค้างจนกว่าจะถ่ายใหม่ (user เคาะ 25/09/69)
  async latestPhotos() {
    const { rows } = await db.query(
      `SELECT DISTINCT ON (ar.user_id)
              ar.user_id, u.username, u.code,
              TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS user_name,
              ar.check_in_photo,
              to_char(ar.work_date,   'YYYY-MM-DD') AS work_date,
              to_char(ar.check_in_at, 'HH24:MI')    AS check_in_time
         FROM attendance_records ar
         JOIN users u ON u.id = ar.user_id
        WHERE ar.check_in_photo IS NOT NULL
        ORDER BY ar.user_id, ar.check_in_at DESC, ar.id DESC`
    );
    return { rows };
  },

  // เวลาปัจจุบันฝั่ง server (เวลาไทย) — ให้บอร์ดยึดเวลานี้แทนนาฬิกาเครื่อง client (กันเบราว์เซอร์ TZ อื่นคำนวณ "วันนี้"/อาสาเพี้ยน)
  // today = วันที่ไทย, nowMinutes = นาทีจากเที่ยงคืน(ไทย), epochMs = เวลา UTC absolute ไว้คำนวณ offset ฝั่ง client
  async now() {
    const { rows } = await db.query(
      `SELECT to_char(${BKK_DATE}, 'YYYY-MM-DD') AS today,
              (EXTRACT(HOUR FROM ${BKK}) * 60 + EXTRACT(MINUTE FROM ${BKK}))::int AS now_minutes,
              (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint AS epoch_ms`
    );
    return { today: rows[0].today, nowMinutes: rows[0].now_minutes, epochMs: Number(rows[0].epoch_ms) };
  },
};
