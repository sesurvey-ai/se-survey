/**
 * ค่ารูปถ่าย — **เหมาตายตัว ไม่อิงจำนวนรูปจริง** (กติกา user 20/08/69 · เคาะลงมือ 31/08/69)
 *
 * ทำไมต้องเหมา: หัวหน้ากรอกบน ISURVEY แค่ "จำนวนเงินอนุมัติ = 50" ช่องเดียว แต่ EMCS
 * บังคับกรอก **จำนวน** กับ **ราคา/หน่วย** แยกกัน → ต้องแตกเป็น 10 × 5 ให้ผลรวมเท่าเดิม
 *
 * ⛔ **ค่ารูปมีฝั่งเดียว** — เป็นของฝั่งเรียกเก็บประกัน (`survey_expenses`)
 *    ฝั่งพนักงาน (`survey_pay`) **ไม่มีค่ารูป** อย่าเอาสูตรนี้ไปใช้ที่นั่น
 */

/** เหมา 10 รูป × 5 บาท = 50 — ตัวเลขจาก user โดยตรง ห้ามคำนวณจากจำนวนรูปจริง */
export const PHOTO_FEE_COUNT = 10;
export const PHOTO_FEE_PRICE = 5;

export interface PhotoFee {
  count: number;
  price: number;
  /** เหตุผลที่ได้/ไม่ได้ — โชว์ให้หัวหน้าเห็นว่าเลขนี้มาจากไหน */
  reason: string;
}

const norm = (v: unknown) => String(v ?? '').replace(/\s|ฯ|\./g, '');

/**
 * จังหวัดที่ "ออกสำรวจ" — ตัวตัดสินข้อ 3 (งานกรุงเทพไม่มีค่ารูป)
 *
 * ลำดับความน่าเชื่อ:
 *   1. เลขเซอร์เวย์ SEABI — หลักที่ 2-3 คือรหัสจังหวัดมาตรฐาน ('10' = กรุงเทพฯ)
 *      นี่คือตัวจริงตามเอกสาร ใช้ก่อนเสมอเมื่อมีเลข
 *   2. `arrival_province` — จังหวัดที่ผู้สำรวจ **ยืนยันเอง** ตอนกดถึงที่เกิดเหตุ
 *      แนวคิดเดียวกันเป๊ะ ("จังหวัดออกสำรวจ") · ใช้กับงานเส้นมือถือที่ยังไม่มีเลข
 *   ⛔ ไม่ถอยไปใช้ `acc_province` (จังหวัดที่เกิดเหตุ) — คนละอย่างกับจังหวัดออกสำรวจ
 *      สถิติ 34,753 ใบ: รหัสตรงกับจังหวัดที่ตรวจสอบ 99.3% แต่ตรงกับที่เกิดเหตุแค่ 93.8%
 *      เดาผิด = เรียกเก็บค่ารูปที่ไม่ควรเรียก (หรือไม่เรียกทั้งที่ควร)
 */
function isBangkokSurvey(row: Record<string, unknown>): boolean | null {
  const job = String(row.survey_job_no ?? '').trim().toUpperCase();
  const m = job.match(/^SEABI-?\d(\d{2})/);
  if (m) return m[1] === '10';
  const prov = norm(row.arrival_province);
  if (prov) return prov === norm('กรุงเทพ ฯ') || prov === 'กรุงเทพมหานคร';
  return null;   // ยังบอกไม่ได้ — ผู้เรียกต้องไม่เดาแทน
}

/** ไทยไพบูลย์ไหม — จากเลขเซอร์เวย์ก่อน ถ้าไม่มีค่อยดูชื่อบริษัท (สะกดหลายแบบ) */
function isThaiPaiboon(row: Record<string, unknown>): boolean {
  const job = String(row.survey_job_no ?? '').trim().toUpperCase();
  if (job.startsWith('SETP')) return true;
  if (job.startsWith('SEABI')) return false;
  return norm(row.insurance_company).includes(norm('ไทยไพบูลย์'));
}

/**
 * ค่ารูปตามกติกา — ไล่ 4 ชั้นตามลำดับ หยุดที่ชั้นแรกที่เข้าเงื่อนไข
 * คืน null = **ตัดสินไม่ได้** (ยังไม่รู้จังหวัดออกสำรวจ) — ผู้เรียกต้องปล่อยให้คนกรอกเอง
 * ⛔ ห้ามเดาเป็น 0 หรือ 50 เมื่อไม่รู้ — ทั้งสองทางคือตัวเงินที่ผิดโดยไม่มีใครรู้
 */
export function standardPhotoFee(row: Record<string, unknown>): PhotoFee | null {
  // 0. งานครั้งที่ 2 ขึ้นไป (งานต่อเนื่อง/ติดตาม) → ไม่มีค่ารูป — ค่ารูปเบิกได้เฉพาะครั้งที่ 1 (user เคาะ 22/09/69
  //    ตรวจกับ ISURVEY เคลม 2026013136010 ทั้ง 4 ครั้ง: รูป 50 เฉพาะครั้งที่ 1) · ค่าคัดประจำวันไม่เกี่ยว แล้วแต่งาน
  //    row.visit_no = ครั้งที่ของใบนี้ (ผู้เรียกใส่มาจาก cases.visit_no หรือลำดับสร้าง) · ไม่ส่งมา = ถือเป็นครั้งที่ 1
  const visit = Number(row.visit_no ?? 0);
  if (Number.isFinite(visit) && visit >= 2) {
    return { count: 0, price: 0, reason: `งานครั้งที่ ${visit} — ไม่มีค่ารูป (ค่ารูปเบิกเฉพาะครั้งที่ 1)` };
  }
  // 1. ไทยไพบูลย์ → ไม่มีค่ารูปทุกกรณี (จบตั้งแต่ข้อนี้ ไม่ต้องดูอย่างอื่น)
  if (isThaiPaiboon(row)) return { count: 0, price: 0, reason: 'งานไทยไพบูลย์ — ไม่มีค่ารูป' };

  // 2. "ไปถึงแล้วไม่พบ" → ไม่เบิกทุกกรณี แม้เป็นงานต่างจังหวัด
  //    (ค่าที่เก็บมี 2 แบบ — มี/ไม่มีเว้นวรรค ตามที่หน้าเว็บกับแอปรับไว้)
  if (norm(row.acc_fault) === norm('ไปถึงแล้วไม่พบ')) {
    return { count: 0, price: 0, reason: 'ไปถึงแล้วไม่พบ — ไม่มีค่ารูป' };
  }

  // 3. งานกรุงเทพ → ไม่มีค่ารูป
  const bkk = isBangkokSurvey(row);
  if (bkk === null) return null;
  if (bkk) return { count: 0, price: 0, reason: 'งานกรุงเทพ — ไม่มีค่ารูป' };

  // 4. นอกนั้น (ไอโออิ ต่างจังหวัด และไม่ใช่ "ไปถึงแล้วไม่พบ") → เหมา 10 × 5 = 50
  return {
    count: PHOTO_FEE_COUNT,
    price: PHOTO_FEE_PRICE,
    reason: `งานต่างจังหวัด — เหมา ${PHOTO_FEE_COUNT} รูป × ${PHOTO_FEE_PRICE} = ${PHOTO_FEE_COUNT * PHOTO_FEE_PRICE}`,
  };
}
