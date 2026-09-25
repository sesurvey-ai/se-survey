/**
 * Contract test — จำ "ครั้งที่" ของเคลมจาก ISURVEY ให้หน้า "รอตรวจ ISURVEY" ขึ้นพร้อมตาราง (user สั่ง 25/09/69)
 *
 * ล็อกกติกา:
 *  1) /rounds ถาม ISURVEY แล้วจำคำตอบลง isurvey_claim_rounds (migration 068) · โหลดรายการใส่ครั้งที่จากที่จำไว้ (อ่าน DB อย่างเดียว)
 *  2) ใช้ที่จำไว้ได้เฉพาะเคลมที่เลขเซอร์เวย์ทุกใบในรายงานอยู่ในรายการที่จำไว้ — มีใบใหม่ = ไม่ใส่ทั้งเคลม ให้หน้าเว็บถามใหม่
 *  3) อายุที่จำ 7 วัน · อ่าน/จำพัง (เช่นยังไม่รัน 068) = ทำงานแบบเดิม ไม่ล้มทั้งรายการ
 *  4) ครั้งก่อนหน้าที่ยังไม่มีในระบบเรา (earlier_missing) คิดสดจาก DB ทุกครั้ง ไม่จำ
 *
 * รัน: npm test   (backend/)
 */
import fs from 'fs';
import path from 'path';

let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`[${status}] ${name}` + (detail ? `  (${detail})` : ''));
  if (!cond) failed++;
}
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const mig = read('src', 'db', 'migrations', '068_isurvey_claim_rounds.sql');
check('migration 068: ตาราง isurvey_claim_rounds (claim_no PK · rounds JSONB · fetched_at)',
  /CREATE TABLE IF NOT EXISTS isurvey_claim_rounds \(\s*claim_no\s+TEXT PRIMARY KEY,\s*rounds\s+JSONB NOT NULL,\s*fetched_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)\s*\);/.test(mig));
const svc = read('src', 'services', 'isurveyPull.service.ts');
check('โหลดรายการ: ใส่ครั้งที่จากที่จำไว้ก่อนส่งให้หน้าเว็บ', /return \{ cases: await this\.withCachedRounds\(cases\), filter \};/.test(svc));
check('/rounds: จำคำตอบก่อนคิดครั้งที่ของแต่ละแถว', svc.indexOf('await this.rememberRounds(r.rounds);') > 0
  && svc.indexOf('await this.rememberRounds(r.rounds);') < svc.indexOf('out[key] = roundOf(claim, row.survey_no, info, have);'));
check('อายุที่จำ 7 วัน · อ่าน/จำพัง = คืนแถวเดิม (ไม่ throw)',
  /const ROUNDS_TTL_DAYS = 7;/.test(svc) && /fetched_at > NOW\(\) - INTERVAL '\$\{ROUNDS_TTL_DAYS\} days'/.test(svc)
  && /อ่านครั้งที่ที่จำไว้ไม่ได้:[\s\S]{0,80}return rows;/.test(svc) && /จำครั้งที่ไม่ได้:/.test(svc));
check('จำเฉพาะคำตอบที่เป็นรายการจริง (ไม่จำ error/รายการว่าง) · upsert ต่อเคลม',
  /Array\.isArray\(v\) && v\.length > 0/.test(svc) && /ON CONFLICT \(claim_no\) DO UPDATE SET rounds = EXCLUDED\.rounds, fetched_at = NOW\(\)/.test(svc));

async function functional() {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x:y@localhost/z';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'contract-test-secret-0123456789';
  const { applyCachedRounds, roundOf } = await import('../src/services/isurveyPull.service');
  const cache = new Map([
    ['A', [{ survey_no: 'SEABI-110260900001', round: 1 }, { survey_no: 'SEABI-310260900002', round: 2 }]],
    ['B', [{ survey_no: 'SEABI-110260900003', round: 1 }]],
  ]);
  const rows = [
    { claim_no: 'A', survey_no: 'seabi-310260900002' },          // ตัวพิมพ์เล็ก = ใบเดียวกัน
    { claim_no: 'B', survey_no: 'SEABI-110260900003' },
    { claim_no: 'B', survey_no: 'SEABI-310260900004' },          // ใบใหม่ของเคลม B ที่ยังไม่อยู่ในรายการที่จำไว้
    { claim_no: 'C', survey_no: 'SEABI-110260900005' },          // ไม่เคยถาม
  ];
  const out = applyCachedRounds(rows, cache, new Set<string>());
  check('เคลมที่จำไว้ครบ: ใส่ครั้งที่ N จาก M + ครั้งก่อนหน้าที่ยังไม่มีในระบบเรา',
    out[0].visit_no === 2 && out[0].visit_total === 2 && JSON.stringify(out[0].earlier_missing) === JSON.stringify(['SEABI-110260900001']),
    JSON.stringify(out[0]));
  check('เคลมที่มีใบใหม่ในรายงาน: ไม่ใส่ทั้งเคลม (ให้หน้าเว็บถามใหม่)', out[1].visit_no === undefined && out[2].visit_no === undefined);
  check('เคลมที่ไม่เคยถาม: ไม่แตะ', out[3].visit_no === undefined && out[3] === rows[3]);
  const have = new Set(['A|SEABI-110260900001']);
  check('ครั้งก่อนหน้าที่ดึงเข้าระบบแล้ว ไม่นับเป็นค้าง', JSON.stringify(roundOf('A', 'SEABI-310260900002', cache.get('A')!, have).earlier_missing) === '[]');
}

functional().then(() => {
  console.log(failed ? `\nFAILED ❌: ${failed}` : '\nALL PASS ✅');
  process.exit(failed ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
