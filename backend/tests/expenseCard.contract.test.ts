/**
 * การ์ดของ "ช่องที่การ์ดค่าใช้จ่ายเติมให้เอง" — user เคาะ 01/09/69
 *
 * ทำไมต้องมี: ทุกช่องในการ์ดนี้เป็นตัวเงินจริง (ฝั่งจ่ายพนักงาน + ฝั่งเรียกเก็บประกัน)
 * "เติมให้" ผิดจะไม่มีอะไรฟ้อง — หัวหน้าเห็นเลขในช่องก็เชื่อว่าถูกแล้วกดบันทึกต่อ
 *
 * 2 กติกาที่คุมไว้ที่นี่
 *   1. ค่าบริการเติม "1 ครั้ง" ให้เลย — เรทที่ระบบเสนอคือเรทของ 1 ครั้งอยู่แล้ว
 *   2. ข้อเสนอค่ารูปที่เป็น 0 ห้ามเขียนเลข 0 ลงช่อง — ปล่อยว่าง
 */
import * as fs from 'fs';
import * as path from 'path';

let failed = 0;
const check = (label: string, ok: boolean, note = '') => {
  if (!ok) failed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${note ? `  (${note})` : ''}`);
};
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const ui = read('..', 'web', 'src', 'components', 'cases', 'CaseDetail.tsx');

console.log('\n── ค่าบริการ: เติมจำนวนครั้งให้เลย ──');
check('ยังไม่เคยกรอก → เติม 1 ครั้ง',
      ui.includes(`name="service_fee_count" defaultValue={exV.service_fee_count || (previewing ? '' : '1')}`));
/**
 * ⛔ ต้องเป็น `||` ไม่ใช่เติมทับ — หัวหน้าที่แก้เป็น 2 ครั้ง (ไปซ้ำรอบ) แล้วบันทึก
 *    ถ้าเติมทับตอนเปิดหน้าใหม่ ยอดจะเด้งกลับเป็น 1 เงียบ ๆ
 */
check('ไม่ทับค่าที่บันทึกไว้แล้ว', /exV\.service_fee_count \|\|/.test(ui));
/**
 * ⛔ ดูครั้งอื่นอยู่ = อ่านอย่างเดียว ห้ามเติม — ครั้งที่ยังไม่ได้กรอกจะดูเหมือน
 *    กรอกไว้แล้ว 1 ครั้ง ทั้งที่ในฐานข้อมูลว่าง (ยอดสะสมทั้งเคลมจะอ่านผิดตาม)
 */
check('ดูครั้งอื่นอยู่ → ไม่เติม', ui.includes(`(previewing ? '' : '1')`));

console.log('\n── ค่ารูปถ่าย: ข้อเสนอ 0 = ปล่อยว่าง ──');
/**
 * งานกรุงเทพ / ไทยไพบูลย์ / ไปถึงแล้วไม่พบ → กติกาเหมาตอบ 0 (ดู photoFee.contract.test.ts)
 * String(0) = "0" ทำให้ช่องขึ้นเลข 0 ทั้งที่ความหมายคือ "ไม่มีค่ารูป" (user แจ้ง 01/09/69)
 */
check('จำนวนรูป: 0 → ไม่เขียนลงช่อง',
      ui.includes(`(photoFee?.count ? String(photoFee.count) : '')`)
      && !ui.includes(`(photoFee ? String(photoFee.count) : '')`));
check('ราคาประกัน: 0 → ไม่เขียนลงช่อง',
      ui.includes(`(photoFee?.price ? String(photoFee.price) : '')`)
      && !ui.includes(`(photoFee ? String(photoFee.price) : '')`));
/**
 * ⛔ บรรทัดกรณี "ไม่มีค่ารูป" ถอดออกแล้ว (user เคาะ 02/09/69) — งานกรุงเทพซึ่งเป็นงานส่วนใหญ่
 *    ไม่มีค่ารูป บรรทัดนั้นจึงขึ้นแทบทุกเคสโดยไม่ได้บอกอะไรใหม่
 *    เหลือเฉพาะตอน **เติมเลขให้จริง** ซึ่งจำเป็น ไม่งั้นหัวหน้าเห็น 10/5 โผล่มาเองแล้วไม่รู้ที่มา
 */
check('⛔ ไม่มีบรรทัดกรณีไม่มีค่ารูปแล้ว', !ui.includes('ค่ารูปตามกติกาเหมา:'));
check('เติมจริงเมื่อไหร่ยังบอกที่มา', ui.includes('ค่ารูปเติมให้ตามกติกาเหมา:')
      && ui.includes('photoFee.count > 0'));

console.log('\n── รวมยอดของแต่ละฝั่ง (แสดงสด) ──');
/**
 * user ขอ 01/09/69: กรอกไปแล้วต้องเห็นยอดรวมของทั้ง 2 ฝั่งเลย ไม่ต้องกดบันทึกก่อน
 *
 * ⛔ **ยอดรวมนี้ห้ามหลุดออกจากหน้าเว็บ** — EMCS คิดยอดรวมเอง (บอทกรอกแต่ช่องรายแถว
 *    ฝั่งเสนอ แล้วกด Tab ให้ EMCS รวมให้ ดู fill_fee_table ใน se-autokey) ถ้าเราส่ง
 *    ยอดรวมไปด้วยจะกลายเป็นเลข 2 ชุดที่ไม่มีอะไรรับประกันว่าตรงกัน
 */
check('มีแถวรวมยอดท้ายตาราง', ui.includes('<tfoot>') && ui.includes('>รวมยอด</td>'));
check('แสดงยอดทั้ง 2 ฝั่ง', ui.includes('{baht(liveSum.pay)}') && ui.includes('{baht(liveSum.ins)}'));
/**
 * ⛔ การ์ดนี้อยู่ใน <form> เดียวกับฟอร์มหลัก — ช่องที่มี name จะถูก FormData เก็บไปด้วย
 *    ยอดรวมมี name เมื่อไหร่ = ยอดที่ "คำนวณให้ดู" กลายเป็นยอดที่ถูกบันทึก แล้วไหลต่อ
 *    ไปถึง XML และหน้าค่าใช้จ่าย EMCS
 */
const tfoot = (ui.match(/<tfoot>[\s\S]*?<\/tfoot>/) ?? [''])[0];
check('⛔ ยอดรวมเป็นตัวอ่านอย่างเดียว ไม่มี name (ไม่ถูกบันทึก / ไม่ไป EMCS)',
      tfoot.length > 0 && !/<input/.test(tfoot) && !/\bname=/.test(tfoot));

console.log('\n── สูตรยอดรวมต้องตรงกับ backend ──');
const paySvc = read('src', 'services', 'pay.service.ts');
const names = (t: string) => (t.match(/'([a-z_]+)'/g) ?? []).map((x) => x.replace(/'/g, ''));
const backPay = names((paySvc.match(/PAY_MONEY_FIELDS = \[([^\]]+)\]/) ?? [])[1] ?? '');
const frontPay = names((ui.match(/PAY_MONEY_INPUTS = \[([\s\S]*?)\];/) ?? [])[1] ?? '')
  .map((x) => x.replace(/^pay_/, ''));
check('ช่องเงินฝั่งพนักงานตรงกับ backend ครบ 8 ช่อง',
      backPay.length === 8 && backPay.join(',') === frontPay.join(','),
      `${backPay.join(',')} | ${frontPay.join(',')}`);
/** ยอดนอกพื้นที่/นอกเวลาเป็นค่าคงที่ฝั่ง backend — หน้าเว็บส่งแค่ติ๊ก/ไม่ติ๊ก */
check('นอกพื้นที่ +50 ตรงกับ backend',
      /out_of_area_amt\) \?\? 50/.test(paySvc) && ui.includes('OUT_OF_AREA_AMT = 50;'));
check('นอกเวลา +100 ตรงกับ backend',
      /out_of_hours_amt\) \?\? 100/.test(paySvc) && ui.includes('OUT_OF_HOURS_AMT = 100;'));
check('หักเงินเป็นลบออกจากยอด', ui.includes('+ area + hours - deduct'));
check('ฝั่งประกันใช้ชุดช่องเดียวกับยอดสะสมทั้งเคลม', ui.includes('const INS = INS_MONEY_INPUTS;'));
/**
 * ⛔ รางขวามี key={viewVisit} = สลับ "ครั้งที่" แล้ว DOM ถูกสร้างใหม่ทั้งราง
 *    ตัวฟัง input ต้องผูกใหม่ ไม่งั้นค้างอยู่กับ node เก่าที่หลุดจากจอ → ยอดค้างเลขครั้งก่อน
 */
// 07/09/69: ตัวฟังเดียวกัน sync ช่องค่ารูป 2 ช่อง (syncPhotoFee) ก่อนคิดยอด — deps จึงมี 3 ตัว แต่ viewVisit ยังอยู่
check('สลับครั้งที่แล้วผูกตัวฟังใหม่', ui.includes('}, [recalcSums, syncPhotoFee, viewVisit]);'));
/**
 * ⛔ ตัวปรับเรท (นอกพื้นที่/นอกเวลา/ตำบลพิเศษ/ค่าคัดประจำวัน) ต้องอยู่ **เหนือ** แถวรวมยอด
 *    (user ขอ 01/09/69) — มันบวก/ลบเข้ายอดฝั่งพนักงาน อ่านไล่ลงมาแล้วต้องจบที่ยอดรวม
 *    และเมื่อย้ายเข้ามาในตารางแล้วต้องห่อด้วย <tr><td colSpan> ไม่ใช่ <div> ลอย ๆ
 *    (เบราว์เซอร์ดีด node ที่ไม่ใช่แถวออกไปนอก <table> เอง แล้วเลย์เอาต์เพี้ยน)
 */
check('ตัวปรับเรทอยู่ในตาราง ห่อด้วยแถว ไม่ใช่ div ลอย',
      // เส้นคั่นเปลี่ยนจาก border-gray-200 เป็นตัวแปรสีชุดใหม่ 02/09/69 — ข้อบังคับคือ "อยู่ใน <td colSpan={4}>"
      /<td colSpan=\{4\}[^>]*>\s*[\s\S]{0,80}?border-t border-\[var\(--md-line\)\]/.test(ui));
check('ตัวปรับเรทอยู่เหนือแถวรวมยอด',
      ui.indexOf('name="out_of_area"') < ui.indexOf('<tfoot>')
      && ui.indexOf('<tfoot>') > 0);



console.log('\n── พับ 3 ช่องที่แทบไม่ได้ใช้ ──');
/**
 * user ขอ 01/09/69: ค่าโทรศัพท์ / ค่าประกันตัว แทบไม่ได้ใช้เลย
 * แต่ยังต้องมีช่องไว้ → พับเก็บ กดกางเอา
 *
 * ⛔ "ค่าใช้จ่ายอื่นๆ" ถูกย้ายออกจากกลุ่มนี้แล้ว (user เคาะ 02/09/69) — ใช้จริงบ่อยกว่า
 *    ต้องเห็นตลอด ห้ามเอากลับเข้าไปพับรวม
 */
check('มีปุ่มพับ/กางคุม 2 ช่องนี้',
      ui.includes('setExtraOpen((v) => !v)')
      && ui.includes('ค่าโทรศัพท์ · ค่าประกันตัว')
      && !ui.includes('ค่าโทรศัพท์ · ค่าประกันตัว · ค่าใช้จ่ายอื่นๆ'));
check('⛔ "ค่าใช้จ่ายอื่นๆ" ไม่ถูกพับ (ต้องเห็นตลอด)',
      // ดู <tr> ที่ครอบแถวนี้ ต้องไม่มีสวิตช์ซ่อนอยู่ในนั้น
      !ui.slice(Math.max(0, ui.indexOf('>ค่าใช้จ่ายอื่นๆ</td>') - 200),
               ui.indexOf('>ค่าใช้จ่ายอื่นๆ</td>')).includes("'hidden'")
      && ui.includes('>ค่าใช้จ่ายอื่นๆ</td>'));
check('⛔ hasExtra ไม่นับค่าใช้จ่ายอื่นๆ (ไม่งั้นกลุ่มนี้กางเองแทบทุกเคส)',
      !/hasExtra =[\s\S]{0,220}?other_fee/.test(ui));
/**
 * ⛔ **ข้อสำคัญที่สุดของบล็อกนี้** — ต้องซ่อนด้วย CSS ห้ามถอด <tr> ออกจาก DOM
 *    ตอนบันทึกอ่านจาก FormData ของฟอร์มทั้งใบ (ดู handleSave: วนคีย์ที่ขึ้นต้น pay_)
 *    ช่องที่ไม่อยู่ใน DOM = ไม่มีคีย์ใน payload → pay.service เขียนทับเป็น null
 *    = ยอดที่เคยกรอกไว้หายเงียบ ๆ โดยไม่มีอะไรฟ้อง
 */
const hiddenRows = (ui.match(/\$\{extraOpen \? '' : 'hidden'\}/g) ?? []).length;
check('⛔ ซ่อนด้วย CSS ครบทั้ง 2 แถว (ไม่ถอดออกจาก DOM = ยอดไม่ถูกล้างตอนบันทึก)',
      hiddenRows === 2, `เจอ ${hiddenRows} แถว`);
check('⛔ ไม่มีการ render แบบมีเงื่อนไข (extraOpen && <tr>)', !/extraOpen && \(?\s*<tr/.test(ui));
/** ⛔ ปุ่มในฟอร์มที่ไม่ระบุชนิด เบราว์เซอร์ถือเป็น submit — กดดูช่อง = สั่งบันทึกทั้งเคส */
check('⛔ ปุ่มพับเป็น type="button" ไม่ใช่ submit',
      /<button type="button" onClick=\{\(\) => setExtraOpen/.test(ui));
/** ซ่อนทื่อ ๆ = เงินที่กรอกไว้หายจากสายตาผู้ตรวจ ทั้งที่ยังนับรวมอยู่ในยอด */
check('เคสที่มีกรอกไว้ กางให้เอง', ui.includes('if (hasExtra) setExtraOpen(true);'));
check('ตอนพับยังบอกว่ามีข้อมูลอยู่ข้างใน', ui.includes("{hasExtra && <span className=\"text-amber-700\">— มีกรอกไว้</span>}"));
/** 0 กับ "0" = ยังไม่กรอก · ข้อความล้วน (รายละเอียดค่าใช้จ่ายอื่น) = กรอกแล้ว */
check('เช็คว่ามีข้อมูลจริง ไม่นับ 0 เป็นกรอกแล้ว', ui.includes('return Number.isNaN(n) ? true : n !== 0;'));

console.log('\n── ป้ายเหตุผลหักเงิน ──');
/** user เปลี่ยนคำ 01/09/69 — คอลัมน์ยังชื่อ deduct_docs เหมือนเดิม เปลี่ยนแค่คำที่คนอ่าน */
{
  const audit = read('src', 'services', 'moneyAudit.ts');
  const payExp = read('src', 'services', 'payExport.service.ts');
  const paySv = read('src', 'services', 'pay.service.ts');
  const all = [ui, audit, payExp, paySv];
  check('เปลี่ยนเป็น "งานไม่เรียบร้อย" ครบทุกที่ที่คนเห็น',
        all.every((t) => t.includes('งานไม่เรียบร้อย')));
  check('⛔ ไม่เหลือคำเดิมค้างอยู่ที่ไหน', all.every((t) => !t.includes('เอกสารไม่ครบ')));
  /** ⛔ ห้ามเปลี่ยนชื่อคอลัมน์ — ข้อมูลเก่าทั้งหมดผูกกับชื่อนี้ */
  check('ชื่อคอลัมน์ยังเป็น deduct_docs เหมือนเดิม',
        paySv.includes('deduct_docs=EXCLUDED.deduct_docs') && ui.includes('name="deduct_docs"'));
}


console.log('\n── นอกพื้นที่/นอกเวลา: กรอกยอดเองได้ ──');
/**
 * user แจ้ง 01/09/69: 50/100 เป็นแค่ยอดปกติ บางเคสจ่ายมากกว่านั้น
 * คอลัมน์ out_of_area_amt / out_of_hours_amt กับตัวรับฝั่ง backend **มีอยู่แล้ว**
 * (migration 037) — ที่ขาดคือช่องกรอกบนหน้าเว็บกับการส่งค่าไป
 */
check('มีช่องกรอกยอดทั้ง 2 ตัว',
      ui.includes('name="out_of_area_amt"') && ui.includes('name="out_of_hours_amt"'));
/**
 * ⛔ ช่องยอดต้องอยู่ **นอก** <label> ของช่องติ๊ก — <label> ส่งคลิกต่อให้ control ตัวแรก
 *    คลิกเพื่อพิมพ์ยอดจะกลายเป็นสลับช่องติ๊กแทน
 */
check('⛔ ช่องยอดอยู่นอก <label> ของช่องติ๊ก',
      !/<label[^>]*>[\s\S]{0,400}?name="out_of_(area|hours)_amt"[\s\S]{0,200}?<\/label>/.test(ui));
/**
 * ⛔ key จำเป็น — ยอดเงินโหลดมาทีหลัง (async) React ไม่เอา defaultValue มาใส่ซ้ำเมื่อ props
 *    เปลี่ยน ช่องจะว่างค้าง แล้วกดบันทึกทีเดียวทับยอดที่กรอกเองด้วยค่าตั้งต้น
 *    (แกนเดียวกับบั๊ก daily_check / deduct_late ที่เคยเจอ 19/08/69)
 */
check('ช่องยอดมี key ผูกกับทั้งช่องติ๊กและยอดที่โหลดมา',
      ui.includes("ooa-${String(payV?.saved?.out_of_area ?? '')}-${String(payV?.saved?.out_of_area_amt ?? '')}")
      && ui.includes("ooh-${String(payV?.saved?.out_of_hours ?? '')}-${String(payV?.saved?.out_of_hours_amt ?? '')}"));
/** ว่าง = ใช้ค่าตั้งต้น (กติกาเดียวกับ num() ?? 50 ฝั่ง backend) */
check('ว่างไว้ = ใช้ค่าตั้งต้น ทั้งตอนคิดยอดสดและตอนบันทึก',
      ui.includes("amt('out_of_area_amt', OUT_OF_AREA_AMT)")
      && ui.includes("amt('out_of_hours_amt', OUT_OF_HOURS_AMT)")
      && /if \(t === ''\) return dflt;/.test(ui));
/**
 * ⛔ survey_pay เป็น upsert ทั้งแถว — ไม่ส่งช่องยอด = เขียนทับเป็น null
 *    ยอดที่หัวหน้ากรอกเองหายเงียบตอนบันทึกครั้งถัดไป
 */
check('⛔ ส่งยอดทุกครั้งที่บันทึก แม้ค่าว่าง',
      ui.includes("for (const f of ['out_of_area_amt', 'out_of_hours_amt']) {"));
/** สลับดู "ครั้งอื่น" ต้องเห็นยอดของครั้งนั้น ไม่ใช่ช่องว่าง */
{
  const svc = read('src', 'services', 'case.service.ts');
  check('query "ครั้งที่" ดึงยอดตัวปรับมาด้วย',
        svc.includes('sp.out_of_area_amt, sp.out_of_hours_amt'));
  check('หน้าเว็บแมปยอดของครั้งอื่นมาใส่ช่อง',
        ui.includes('out_of_area_amt: pvv.out_of_area_amt'));
}

console.log('\n── หักเงินต้องมีเหตุผล ──');
/**
 * user ขอ 01/09/69 — หักเงินโดยไม่มีเหตุผลกำกับ ผู้สำรวจถามกลับมาก็ตอบไม่ได้
 * และย้อนดูทีหลังไม่รู้ว่าหักเพราะอะไร
 */
check('ใส่ยอดแล้วไม่มีเหตุผล → เตือน',
      ui.includes('{liveSum.deduct > 0 && !liveSum.reasoned && (')
      && ui.includes(String.raw`{'⚠ เลือกเหตุผล "หักเงิน"'}`));
/**
 * ขากลับก็ต้องเตือน (user ขอ 01/09/69) — เลือกเหตุผลไว้แล้วแต่ลืมใส่ยอด
 * = ตั้งใจจะหักแต่ยอดเป็น 0 ทั้งที่เหตุผลหักเงินค้างอยู่ในบันทึก
 */
check('มีเหตุผลแล้วไม่ใส่ยอด → เตือน',
      ui.includes('{liveSum.deduct === 0 && liveSum.reasoned && (')
      && ui.includes(String.raw`{'⚠ กรอกยอด "หักเงิน"'}`));
/** พิมพ์ "เหตุผลอื่น" เองก็ถือว่าระบุแล้ว — ไม่บังคับว่าต้องติ๊ก 2 ข้อนี้เท่านั้น */
check('ช่องเหตุผลอื่นที่พิมพ์เองก็นับ',
      ui.includes("on('deduct_late') || on('deduct_docs') || txt('deduct_reason') !== ''"));
/** เตือนเฉย ๆ — user ขอแค่ "แจ้งเตือน" ไม่ได้ขอให้บล็อก */
check('เป็นคำเตือน ไม่บล็อกการบันทึก',
      !/reasoned[\s\S]{0,200}?(return false|setSaveMsg\('บันทึกไม่)/.test(ui));


console.log('\n── ช่องยอดตัวปรับ: ไม่ติ๊ก = ว่าง · ติ๊ก = เลขจริง ──');
/**
 * user ขอ 01/09/69: เลขจาง ๆ (placeholder) อ่านแล้วไม่รู้ว่าเป็นค่าที่ใช้จริงหรือแค่ตัวอย่าง
 * → ไม่ติ๊ก = ช่องว่างเปล่า · ติ๊ก = เติมเลขจริงลงช่อง แก้ทับได้
 */
check('ไม่มี placeholder ตัวจางในช่องยอดแล้ว',
      !/name="out_of_(area|hours)_amt"[sS]{0,300}?placeholder=/.test(ui));
check('ติ๊กแล้วเติมเลขจริง · เอาติ๊กออกแล้วล้างช่อง',
      ui.includes(String.raw`amt.value = e.currentTarget.checked ? (amt.value.trim() || String(OUT_OF_AREA_AMT)) : ''`)
      && ui.includes(String.raw`amt.value = e.currentTarget.checked ? (amt.value.trim() || String(OUT_OF_HOURS_AMT)) : ''`));
/** แถวที่บันทึกไว้ก่อนมีช่องนี้: ติ๊กไว้แต่ไม่มียอด → ต้องโชว์ค่าตั้งต้น ไม่ใช่ช่องว่าง */
check('งานเก่าที่ติ๊กไว้แต่ยังไม่มียอด โชว์ค่าตั้งต้น',
      ui.includes(String.raw`|| (payV?.saved?.out_of_area ? String(OUT_OF_AREA_AMT) : '')`));
/**
 * ⛔ ตัวฟัง input ที่ผูกไว้กับ<div>รางทำงาน **ก่อน** onChange ของ React เสมอ
 *    (native event bubble ถึง div ก่อนถึง root ที่ React ดัก) — ถ้าไม่เรียก recalcSums
 *    เองหลังแก้ค่า ยอดรวมจะช้าไปหนึ่งจังหวะ (ติ๊กแล้วยอดยังไม่ขยับจนกว่าจะแตะช่องอื่น)
 */
check('⛔ onChange เรียก recalcSums เองหลังเติม/ล้างยอด',
      ui.split('recalcSums();').length - 1 >= 4);


console.log('\n── ค่าคัดประจำวัน: ผลอยู่แถวเดียวกับยอด + เติมเรทให้ ──');
/**
 * user ขอ 01/09/69 — เดิม dropdown ผลคัดประจำวันอยู่ในแถวตัวปรับใต้ตาราง
 * คนละที่กับยอดของมันเอง · ย้ายมาอยู่คอลัมน์ "จำนวน" ของแถวค่าคัดประจำวัน
 */
const dailyRow = (ui.match(/>ค่าคัดประจำวัน<\/td>[\s\S]*?<\/tr>/) ?? [''])[0];
check('dropdown อยู่ในแถวค่าคัดประจำวันแล้ว',
      dailyRow.includes('name="daily_check"')
      && dailyRow.includes('name="pay_daily_fee"')
      && dailyRow.includes('name="daily_record_fee"'));
/** เหลือที่เดียว — ถ้ามี 2 ที่ FormData จะเก็บตัวหลังทับตัวแรกเงียบ ๆ */
check('⛔ ไม่เหลือ dropdown ตัวเดิมในแถวตัวปรับ',
      (ui.match(/name="daily_check"/g) ?? []).length === 1);
check('ป้ายตัวเลือกเป็น "ไม่มี" ไม่ใช่ "— ไม่มี —"',
      ui.includes('<option value="">ไม่มี</option>') && !ui.includes('— ไม่มี —'));
/** เรทที่ user เคาะ 01/09/69 — ฝั่งพนักงาน 50 ทุกผล · ฝั่งประกัน ถูก 100 · ผิด/รอผล 50 */
check('เรทฝั่งพนักงาน 50 ทุกผล', ui.includes('const DAILY_FEE_PAY = 50;'));
check('เรทฝั่งประกัน ถูก 100 · ผิด 50 · รอผล 50',
      ui.includes("{ 'ถูก': 100, 'ผิด': 50, 'รอผล': 50 }"));
check('เลือกผลแล้วเติมยอดให้ทั้ง 2 ฝั่ง',
      ui.includes("put('pay_daily_fee', v ? String(DAILY_FEE_PAY) : '')")
      && ui.includes("put('daily_record_fee', v ? String(DAILY_FEE_INS[v] ?? '') : '')"));
/**
 * ⛔ เติมตอน "เลือก" เท่านั้น ห้ามเติมตอนเปิดหน้า — เคสที่หัวหน้าแก้ยอดเองไว้จะถูก
 *    เขียนทับทุกครั้งที่เปิดดู (แกนเดียวกับกติกาค่ารูปเหมา: ไม่ทับของที่บันทึกไว้)
 */
check('⛔ เติมตอนเลือกเท่านั้น ไม่เติมตอนเปิดหน้า',
      !/DAILY_FEE_(PAY|INS)[\s\S]{0,120}?defaultValue/.test(ui));
/** เลือก "ไม่มี" = ล้างยอดทั้ง 2 ฝั่ง ไม่ใช่ค้างเลขของผลก่อนหน้า */
check('เลือก "ไม่มี" แล้วล้างยอด', ui.includes("v ? String(DAILY_FEE_PAY) : ''"));


console.log('\n── เรทฝั่งเรียกเก็บประกัน: เติมให้เอง ──');
/**
 * user สั่งเปิดใช้ 01/09/69 — ตารางเรทรู้คำตอบครบ 337/337 อำเภอ แต่เดิมคำนวณแล้วทิ้ง
 * หัวหน้าจึงพิมพ์มือทุกช่องทุกเคส
 */
{
  const paySvc2 = read('src', 'services', 'pay.service.ts');
  check('backend ส่งเรทฝั่งประกันไปให้หน้าเว็บ',
        paySvc2.includes('ins_service_fee:') && paySvc2.includes('ins_travel_fee:'));
  /**
   * ⛔ งานที่นำเข้าจากไฟล์ ISURVEY ยอดกรอกจบที่ต้นทางและติดมากับไฟล์ — เติมทับ = เขียนทับของจริง
   *    (กติกาเดียวกับค่ารูปเหมา)
   */
  check('⛔ ไม่เสนอกับงานที่นำเข้าจากไฟล์ ISURVEY',
        paySvc2.includes("const fromIsurveyFile = r.source === 'isurvey_xml';")
        && paySvc2.includes('fromIsurveyFile ? null : pay.insInvest'));
  /** ต้อง join cases มาด้วย ไม่งั้นไม่รู้ที่มาของงาน */
  check('อ่านที่มาของงานมาจริง', paySvc2.includes('JOIN cases c ON c.id = sr.case_id'));
}
check('หน้าเว็บเติมช่องค่าบริการ/ค่าเดินทางฝั่งประกัน',
      ui.includes("insFill('ins_service_fee', exV.service_fee_price)")
      && ui.includes("insFill('ins_travel_fee', exV.travel_fee_price)")
      && ui.includes("(insService ? String(insService) : '')")
      && ui.includes("(insTravel ? String(insTravel) : '')"));
/** ⛔ กติกาเดียวกับค่ารูปเหมา — ไม่ทับของที่บันทึกไว้ · ดูครั้งอื่นอยู่ไม่เติม */
check('⛔ เติมเฉพาะช่องที่ยังว่าง ไม่ทับของที่บันทึกไว้',
      ui.includes("return Number(String(cur ?? '').replace(/,/g, '')) ? null : v;"));
check('⛔ ดูครั้งอื่นอยู่ → ไม่เติม', ui.includes('if (previewing) return null;'));
/** เรทเป็น 0 หรือติดลบ = ข้อมูลเสีย ไม่ใช่ "ฟรี" — อย่าเติมลงช่องเงิน */
check('เรท 0 ไม่ถือเป็นเรท', ui.includes("if (typeof v !== 'number' || v <= 0) return null;"));
check('บอกที่มาของเลขที่เติมให้', ui.includes('เรทฝั่งประกันเติมให้จากตารางเรท'));
/**
 * ⛔ ค่ารูปห้ามเอาเรทตารางมาเติม — มีกติกาเหมาของตัวเองที่ user เคาะไว้ (10×5=50)
 *    ins_photo_12 ในตารางเป็นคนละฐาน เอามาปนแล้วยอดเรียกเก็บเพี้ยนโดยไม่มีอะไรฟ้อง
 */
check('⛔ ไม่แตะช่องค่ารูป (มีกติกาเหมาของตัวเองแล้ว)',
      !ui.includes('ins_photo') && !/insFill\([^)]*photo/.test(ui));


console.log('\n── ตัวเลือก "ตำบล" ในหมวดอุบัติเหตุ ──');
/**
 * user ขอ 01/09/69 — ขึ้นช่องตำบลเฉพาะอำเภอที่มีตำบลคิดเรทไม่เท่าอำเภอแม่
 * (ตอนนี้ ศรีราชา→บ่อวิน · สัตหีบ→พลูตาหลวง) · เรทยังไม่ต่อ ทำให้เห็นตัวเลือกก่อน
 */
{
  const svc3 = read('src', 'services', 'billingRates.service.ts');
  const caseSvc = read('src', 'services', 'case.service.ts');
  /**
   * ⛔ **รายชื่อตำบลต้องมาจากตารางเรทเท่านั้น** — เขียนไว้ในหน้าเว็บซ้ำเมื่อไหร่
   *    เพิ่มเรทตำบลใหม่ในหน้าแอดมินแล้วตัวเลือกไม่โผล่ (หรือโผล่แต่ไม่มีเรท)
   *    เป็นบั๊กชนิดเดียวกับที่เคยเผลอทำกับค่าคัดประจำวันมาแล้ว
   */
  check('รายชื่อตำบลมาจากตารางเรท ไม่ใช่รายชื่อในโค้ด',
        svc3.includes('FROM billing_tumbon_rates')
        && caseSvc.includes('tumbon_options: await tumbonOptions()')
        // ชื่อตำบลปรากฏได้เฉพาะในคอมเมนต์ — เป็น "ข้อมูล" (มีเครื่องหมายคำพูด) เมื่อไหร่ = เขียนซ้ำแล้ว
        && !/['"](บ่อวิน|พลูตาหลวง)['"]/.test(ui)
        && ui.includes('tumbonOptions ?? []'));
  check('แปลงรหัสอำเภอเป็นชื่อ (ฟอร์มเก็บเป็นชื่อ ไม่ใช่รหัส)',
        svc3.includes('TH_AMPHURS[r.parent_amphur]') && svc3.includes('TH_PROVINCES[r.parent_amphur.slice(0, 2)]'));
}
check('มีช่องติ๊กตำบลผูกกับคอลัมน์เดิม acc_subdistrict',
      ui.includes('name="acc_subdistrict"')
      && ui.includes('checked={accTumbon === t}'));
/**
 * ⛔ ช่องติ๊กที่ไม่ได้ติ๊กจะไม่ติดไปกับ FormData เลย — ถ้าให้ค่าไปกับช่องติ๊กตรง ๆ
 *    เอาติ๊กออกแล้วค่าเดิมจะค้างในฐานข้อมูลตลอดไป ล้างไม่ได้
 */
check('⛔ ส่งค่าผ่านช่องซ่อน ไม่ใช่ช่องติ๊ก (ไม่งั้นเอาติ๊กออกแล้วล้างค่าไม่ได้)',
      ui.includes('<input type="hidden" disabled={d} name="acc_subdistrict" value={accTumbon} />')
      && !/type="checkbox"[^>]*name="acc_subdistrict"/.test(ui));
/** ฟอร์มเก็บ "อำเภอศรีราชา"/"กรุงเทพ ฯ" ตารางเก็บ "ศรีราชา"/"กรุงเทพฯ" — ต้องตัดคำนำหน้าก่อนเทียบ */
check('เทียบชื่อพื้นที่โดยตัดคำนำหน้า/ช่องว่าง/ฯ',
      ui.includes("const areaKey = (v: unknown) =>")
      && ui.includes('areaKey(t.province) === areaKey(accProv)')
      && ui.includes('areaKey(t.district) === areaKey(accDist)'));
/** อำเภออื่นไม่มีตำบลที่คิดเรทต่าง → ไม่ต้องโชว์ช่องให้รก */
check('ขึ้นเฉพาะอำเภอที่มีตำบล', ui.includes('{tumbonChoices.length > 0 && ('));
/** เปลี่ยนจังหวัด/อำเภอแล้วตำบลเดิมค้างอยู่ = ตำบลไม่ตรงอำเภอ */
check('เปลี่ยนจังหวัดหรืออำเภอแล้วล้างตำบล',
      ui.includes("setAccDist('-- เขต --'); setAccTumbon('');")
      && ui.includes("setAccDist(e.target.value); setAccTumbon('');"));

console.log('\n── ชื่อแท็บในหน้าเรท ──');
{
  const rp = read('..', 'web', 'src', 'app', 'admin', 'billing-rates', 'page.tsx');
  /** user เคาะ 01/09/69: ไม่ได้ "พิเศษ" อะไร แค่เป็นตำบลที่มีเรทของตัวเอง */
  check('เปลี่ยนเป็น "เรทรายตำบล"', rp.includes("label: 'เรทรายตำบล'") && !rp.includes('ตำบลพิเศษ'));
}


console.log('\n── ปุ่มขยายช่องความเห็น ──');
/**
 * user ขอ 01/09/69 — 3 ช่องความเห็นสูงแค่ 4 บรรทัด แต่ข้อความจริงยาว 10-20 บรรทัด
 * เดิมต้องลากมุมขวาล่างขยายเองทุกครั้ง
 */
for (const [label, name] of [
  ['ผลการดำเนินงาน', 'survey_result'],
  ['ความเห็นของผู้ตรวจสอบ', 'review_comment'],
  ['ความเห็นของเซอร์เวย์', 'surveyor_comment'],
  // เพิ่ม 02/09/69 — ช่องยาวที่สุดในฟอร์มหลัก (เนื้อความจริง 15-25 บรรทัด กล่องสูง 4 บรรทัด)
  ['รายละเอียดการเกิดเหตุ', 'acc_detail'],
  ['ความเสียหายรถประกันภัย', 'damage_description'],
]) {
  check(`"${label}" มีปุ่มขยาย`, ui.includes(`openBig('${name}', '${label}')`));
}
/**
 * ⛔ ปุ่มขยายของ "รายละเอียดการเกิดเหตุ" นั่งอยู่บนแถวป้ายของ <F>
 *    ซึ่งใช้ร่วมกับอีกเกือบ 200 ช่อง — ต้องห่อ flex เฉพาะตอนมีปุ่ม
 *    ถ้าห่อทุกช่อง ป้ายกลายเป็น flex item แล้วการตัดบรรทัดของป้ายยาวเปลี่ยนไปทั้งหน้า
 */
check('<F> ห่อ flex เฉพาะช่องที่มีปุ่ม', ui.includes('{right ? (') && ui.includes(') : ('));
/** ⛔ CTL มี h-9 ติดมาด้วย — textarea ที่ใช้ CTL ต้องมี min-h มาทับ ไม่งั้นเหลือบรรทัดเดียว */
check('⛔ textarea ที่ใช้ CTL มี min-h ทับความสูง 36px',
      !/<textarea[^>]*className=\{CTL\(d\)\}/.test(ui));
/** เขียนค่ากลับแล้วต้องยิง input event — ไม่งั้นกรอบแดง/เส้นใต้ของช่องนั้นค้างสถานะเดิม */
check('เขียนค่ากลับแล้วยิง input event (กรอบแดง/เส้นใต้อัปเดตตาม)',
      ui.includes("el.dispatchEvent(new Event('input', { bubbles: true }))"));
/**
 * ⛔ ปุ่มในฟอร์มที่ไม่ระบุชนิด เบราว์เซอร์ถือเป็น submit — กดขยายกลายเป็นสั่งบันทึกทั้งเคส
 */
check('⛔ ปุ่มขยายเป็น type="button"',
      /<button type="button" disabled=\{previewing\}\s*\n?\s*onClick=\{\(\) => openBig/.test(ui)
      || ui.includes('<button type="button" disabled={previewing}'));
/**
 * ⛔ textarea ในกล่องใหญ่อยู่ใน <form> เดียวกับฟอร์มหลัก — มี name เมื่อไหร่ FormData
 *    จะเก็บ 2 ค่าชื่อเดียวกัน แล้วตัวหลังทับตัวแรกเงียบ ๆ (บั๊กเดียวกับที่การ์ด
 *    inspectorForm ห้ามไว้เรื่อง "ความเห็นของผู้ตรวจสอบมีที่เดียวเท่านั้น")
 */
{
  const dlg = (ui.match(/\{bigEdit && \([\s\S]*?\n      \)\}/) ?? [''])[0];
  check('⛔ textarea ในกล่องใหญ่ไม่มี name (ไม่งั้นค่าทับกันตอนบันทึก)',
        dlg.length > 0 && dlg.includes('<textarea autoFocus') && !/name=/.test(dlg));
  check('ปุ่มในกล่องใหญ่เป็น type="button" ทุกตัว',
        dlg.length > 0 && (dlg.match(/<button/g) ?? []).length === (dlg.match(/<button type="button"/g) ?? []).length);
}
/**
 * ⛔ ช่องความเห็นเป็น uncontrolled (defaultValue) — เขียนกลับต้องแตะ .value ของ DOM
 *    เปลี่ยนเป็น controlled จะพิมพ์หน่วงทั้งฟอร์มเพราะ re-render ทุกตัวอักษร
 */
check('เขียนค่ากลับเข้าช่องเดิมผ่าน DOM', ui.includes('el.value = bigDraft;'));
check('ช่องความเห็นยังเป็น uncontrolled เหมือนเดิม',
      ui.includes('<textarea name="survey_result" disabled={previewing} defaultValue='));
/** ดูครั้งอื่นอยู่ = อ่านอย่างเดียว ห้ามเปิดให้แก้ */
check('ดูครั้งอื่นอยู่ → ปุ่มขยายกดไม่ได้', ui.includes('<button type="button" disabled={previewing}'));

console.log('\n── แยกสี 2 คอลัมน์เงิน ──');
/**
 * user เคาะ 02/09/69: "ราคาพนักงาน" กับ "ราคาประกัน" ต้องดูออกว่าคนละฝั่ง
 * น้ำเงินทั้งคู่แต่คนละน้ำหนัก — **อ่อน = จ่ายพนักงาน · เข้ม = เรียกเก็บประกัน**
 * ต่างกันแค่ตัวหนังสือไม่พอ (ของเดิมทำแบบนั้นแล้วดูเหมือนคอลัมน์เดียวกัน)
 * ต้องต่างที่ "พื้นคอลัมน์" ด้วย
 *
 * ⛔ พื้นสีทาที่ <col> ไม่ใช่ที่ <td> — ถ้าแถวไหนมีพื้นหลังของตัวเอง
 *    (bg-* บน <tr>/<td>) จะทับพื้นคอลัมน์ทันที ลายสลับสีจึงต้องไม่กลับมา
 */
check('พื้นคอลัมน์เงินทาที่ <col> ทั้ง 2 ฝั่ง',
      ui.includes('bg-[#f4f7ff]') && ui.includes('bg-[#d7e4fb]'));
check('⛔ ไม่มีลายสลับสีมาทับพื้นคอลัมน์',
      !ui.includes('border-b border-gray-100 bg-[var(--md-tint)]'));
check('⛔ แถวรวมยอดไม่มีพื้นหลังทั้งแถว (จะทับพื้นคอลัมน์)', !ui.includes('bg-blue-50/50'));
check('ช่องเงินฝั่งพนักงาน = น้ำเงินอ่อน',
      ui.includes("'bg-white border-blue-300 text-blue-800'"));
check('ช่องเงินฝั่งประกัน = น้ำเงินเข้ม',
      ui.includes('border border-blue-600 rounded-none px-2 py-1 text-blue-950'));
/** ⛔ 2 ฝั่งใช้ชุดสีเดียวกันเมื่อไหร่ = แยกไม่ออกอีก */
check('⛔ 2 ฝั่งไม่ใช้ขอบ/ตัวหนังสือชุดเดียวกัน',
      ui.includes('border-blue-300') && ui.includes('border-blue-600')
      && ui.includes('text-blue-800') && ui.includes('text-blue-950'));

console.log('\n── ลำดับแถวในตารางค่าใช้จ่าย ──');
/** user เคาะ 02/09/69: กลุ่มที่พับย้ายลงไปใต้ "นอกพื้นที่ / นอกเวลา" */
{
  const at = (s: string) => ui.indexOf(s);
  const other = at('text-gray-700">ค่าใช้จ่ายอื่นๆ');
  const deduct = at('name="deduct_late"');
  const area = at('name="out_of_area"');
  const fold = at('setExtraOpen((v) => !v)');
  const total = at('{baht(liveSum.pay)}');
  check('ค่าใช้จ่ายอื่นๆ → หักเงิน → นอกพื้นที่ → กลุ่มที่พับ → รวมยอด',
        other > 0 && other < deduct && deduct < area && area < fold && fold < total,
        `other=${other} deduct=${deduct} area=${area} fold=${fold} total=${total}`);
}

console.log('\n── ตัวสลับฟอนต์ ──');
/**
 * user ขอ 02/09/69 ระหว่างตัดสินใจเลือกฟอนต์ — เลือกได้ 3 แบบ จำไว้ในเครื่องของคนเลือก
 *
 * ⛔ ของ 4 ชิ้นนี้ต้องตรงกันหมด ถ้าหลุดชิ้นเดียวทั้งเว็บตกไปใช้ฟอนต์สำรองของเครื่องเงียบ ๆ
 *    ไม่มี error ให้เห็น: ตัวแปรบน <html> · ค่าตั้งต้นใน :root · สคริปต์ท้าย <head> · ตัวสลับ
 */
{
  const lay = read('..', 'web', 'src', 'app', 'layout.tsx');
  const css = read('..', 'web', 'src', 'app', 'globals.css');
  const sw = read('..', 'web', 'src', 'components', 'layout', 'AppearanceControls.tsx');
  const hdr = read('..', 'web', 'src', 'components', 'layout', 'Header.tsx');

  check('โหลดฟอนต์ครบ 3 แบบ',
        ['Noto_Sans_Thai', 'IBM_Plex_Sans_Thai', 'Sarabun'].every((f) => lay.includes(f)));
  check('⛔ ตัวแปรฟอนต์อยู่บน <html> ไม่ใช่ <body> (ไม่งั้น var() หาไม่เจอ)',
        /<html[^>]*className=\{`\$\{notoThai\.variable\}/.test(lay)
        && !/<body className=\{`\$\{/.test(lay));
  check('ทั้งเว็บอ่าน var(--font-thai)', css.includes('font-family: var(--font-thai)'));
  check('เลือกฟอนต์ก่อนหน้าถูกวาด (ไม่แวบเปลี่ยนทุกครั้งที่เปิดหน้า)',
        lay.includes("localStorage.getItem('ui_font')") && lay.includes('dangerouslySetInnerHTML'));
  check('⛔ คีย์ที่จำไว้ตรงกันทั้งสคริปต์บูตกับตัวสลับ',
        lay.includes("'ui_font'") && sw.includes("localStorage.setItem('ui_font', id)"));
  check('⛔ อ่านค่าที่จำไว้แบบกันค่าขยะ (ค่านี้ถูกยัดลง setProperty ตรง ๆ)',
        lay.includes('/^[a-z-]+$/.test(f)'));
  check('ตัวสลับเขียนทับที่ documentElement',
        sw.includes("documentElement.style.setProperty('--font-thai', `var(--font-${id})`)"));
    check('⛔ localStorage ห่อ try/catch (โหมดส่วนตัวเข้าถึงแล้ว throw)',
        (sw.match(/catch/g) ?? []).length >= 3 && lay.includes('catch(e){}'));

  const nav = read('..', 'web', 'src', 'components', 'layout', 'Sidebar.tsx');

  check('ค่าตั้งต้นเป็น Sarabun', css.includes('--font-thai: var(--font-sarabun)'));
  check('ฟอนต์สำรองในสายชื่อฟอนต์ตรงกับค่าตั้งต้น',
        /font-family: var\(--font-thai\), Sarabun,/.test(css));
  check('ตัวตั้งค่าอยู่ท้ายเมนูข้าง ไม่ใช่แถบบน',
        nav.includes('<AppearanceControls />') && nav.includes('<AppearanceControls compact />')
        && !hdr.includes('AppearanceControls') && !hdr.includes('FontSwitcher'));
  check('ตอนเมนูยุบก็ยังปรับขนาดได้ (ดันลงล่างสุด)',
        nav.includes('<div className="flex-1" />'));

  check('ขนาดตัวอักษร 5 ระดับ', sw.includes('const SCALES = [100, 110, 120, 130, 140]'));
  check('ปรับขนาดด้วย font-size ของ <html> (ทั้งเว็บวัดเป็น rem จึงโตตามกัน)',
        sw.includes("documentElement.style.fontSize = pct === 100 ? '' : `${(16 * pct) / 100}px`"));
  check('⛔ ช่วงค่าที่สคริปต์บูตยอมรับ ครอบคลุมทุกระดับ', lay.includes('s>=100&&s<=140'));
  check('⛔ คีย์ขนาดตรงกันทั้งสองที่',
        lay.includes("localStorage.getItem('ui_scale')") && sw.includes("localStorage.setItem('ui_scale'"));
  /**
   * ⛔ ขนาดตัวอักษรจะโตทั้งหน้าได้ ต่อเมื่อหน้าวัดเป็น rem — ค่า px ตายตัว
   *    จะค้างขนาดเดิมแล้วหน้าเพี้ยน (ตัวหนังสือโตแต่กล่องไม่โต)
   *    ยกเว้น 2 อย่างที่ต้องเป็น px: จุดสลับเลย์เอาต์ min-[1500px] (ผูกกับจอจริง)
   *    และความหนาเส้นขอบ (เส้นบางไม่ควรโตตามตัวหนังสือ)
   */
  {
    const files = ['RecordEditors', 'DamageDialog', 'DamageEditor', 'PhotoGallery']
      .map((f) => read('..', 'web', 'src', 'components', 'cases', `${f}.tsx`)).concat(ui);
    const stray = files.flatMap((f) => (f.match(/(?<![\w-])(-?(?:text|w|h|min-h|min-w|max-w|top|py|mt|left))-\[\d+(?:\.\d+)?px\]/g) ?? []));
    check('⛔ ไม่มีขนาด px ตายตัวหลงเหลือ (ยกเว้น breakpoint กับความหนาเส้น)',
          stray.length === 0, stray.slice(0, 5).join(' '));
  }
}

console.log('\n── ค่าเรียกร้อง: เติม % และราคาพนักงานให้เอง (user เคาะ 08/09/69) ──');
/**
 * กติกาเดียวกับ extension se-billing บน ISURVEY: ผู้สำรวจภัยขึ้นต้น SE = พนักงานเรา → 5% ของ "รับเงินจำนวน"
 * ช่างนอก (ชื่ออื่น) → 10% (user สั่งเพิ่ม 08/09/69) · ช่องผู้สำรวจภัยว่าง → ไม่เติม · ฝั่งเรียกเก็บประกันไม่เติม (user สั่ง)
 */
check('ผู้สำรวจภัยขึ้นต้น SE → 5% · ช่างนอก → 10% · ว่าง → ไม่เติม',
      ui.includes('const pct = company2 ? 5 : isSE ? 5 : surveyor ? 10 : null;'));
/** user เคาะ 09/09/69: ช่างนอกไม่ได้รับเงินผ่านใบเบิกนี้ → ฝั่งพนักงานของช่างนอกเป็นตัวเทา ไม่รวมยอด ไม่บันทึก */
check('เติมเป็นค่าจริงเฉพาะพนักงาน SE', ui.includes('const auto = hasAmt && isSE ? { claim_fee_percent: String(pct), pay_claim_fee: feeStr } : null;'));
check('ช่างนอก → ราคาพนักงาน + % เป็น placeholder สีเทา',
      ui.includes("['pay_claim_fee', hasAmt && !isSE ? feeStr : ''") && ui.includes("['claim_fee_percent', hasAmt && !isSE ? String(pct) : ''"));
check('ช่อง % โชว์ "10" ไม่ใช่ "10.00" (pctBlank)', ui.includes('defaultValue={pctBlank(exV.claim_fee_percent)}'));
/** #241: รุ่นก่อนเติม 10% เป็นค่าจริงแล้วบันทึกไว้ (300) → รุ่นใหม่ต้องล้างค่าที่เท่ากับตัวเทาเป๊ะ ไม่งั้นยังรวมยอดอยู่ */
check('ช่างนอก: ค่าที่บันทึกไว้เท่ากับตัวเทาเป๊ะ → ล้างให้เป็นตัวเทา (ค่าที่ต่างออกไป = ตั้งใจจ่าย ปล่อยไว้)',
      ui.includes("!isSE && ossHint !== '' && cur !== '' && Number(cur.replace(/,/g, '')) === Number(ossHint)"));
check('บริษัท 2 (เลขเซอร์เวย์ SETP/SEMS) → 5% เสมอ ไม่ว่าช่างใคร',
      ui.includes("const company2 = /^(SETP|SEMS)/i.test(String(report?.survey_job_no ?? '').trim());"));
check('เติมเมื่อมียอดรับเงินจำนวน (ไม่ต้องรอติ๊กกล่อง — user เจอ 09/09/69 พิมพ์ยอดแล้ว % ไม่ขึ้น)',
      ui.includes('const hasAmt = pct !== null && Number.isFinite(amtNum) && amtNum > 0;'));
check('ราคาพนักงาน = ยอด × % ปัดทศนิยม 2 ตำแหน่ง', ui.includes('Math.round(amtNum * pct) / 100'));
check('⛔ ไม่ทับค่าที่หัวหน้าพิมพ์เอง (จำค่าที่ระบบเติมใน data-auto)', ui.includes('cur === el.dataset.auto'));
check('⛔ ฝั่งเรียกเก็บประกัน (claim_fee_price) ไม่ถูกเติมเป็นค่าจริง', !ui.includes("['claim_fee_price', auto"));
/**
 * user เคาะ 08/09/69: โชว์ 10% ฝั่งประกันเป็นตัวจาง ๆ ให้เห็นว่ามียอด แต่ห้ามรวมยอดฝั่งประกัน
 * → ใส่เป็น placeholder (ไม่ใช่ value) จึงไม่ถูกรวม ไม่ถูกบันทึก ไม่ไป XML/se-billing
 */
check('ฝั่งประกันโชว์ 10% เป็น placeholder สีเทา ไม่ใช่ค่าจริง',
      ui.includes("['claim_fee_price', hasAmt ? String(Math.round(amtNum * 10) / 100) : ''")
      && ui.includes('text-right placeholder:text-gray-400"'));
check('เลิกติ๊ก/ล้างยอด → ล้างเฉพาะค่าที่ระบบเติม', ui.includes("el.value = ''; delete el.dataset.auto; touched = true;"));
check('เติมแล้วคิดยอดรวมใหม่', ui.includes('if (touched) recalcSums();'));

console.log('\n── ยังอนุมัติไม่ได้: บอกให้เห็นว่าข้อไหน ช่องไหน (user ทัก 09/09/69) ──');
/**
 * ป้าย "ยังอนุมัติไม่ได้ 2 ข้อ" เคยบอกแค่จำนวน — ช่องราคาที่ขาดไม่แดง และไม่มีรายการให้ดู คนหาไม่เจอ
 */
check('แจกแจงทุกข้อเป็นรายการ (ชุดเดียวกับที่ปุ่มอนุมัติใช้ตัดสิน)',
      ui.includes('{approvalBlockers.map((b, i) => <li key={i}>{b}</li>)}'));
check('ช่องราคาที่ยังขาดทาแดงที่ช่องจริง (ค่าบริการ ฝั่งพนักงาน / ฝั่งประกัน)',
      ui.includes("[['pay_service_fee', payMissing], ['service_fee_price', insMissing]] as const"));
check('⛔ ถอดขอบสีเดิมของช่องเงิน (ฟ้า) ตอนทาแดง ไม่งั้นสีตีกัน', ui.includes("el.classList.toggle(el.dataset.border0, !on);"));
check('พิมพ์ค่าบริการพนักงานแล้วกรอบแดงหายทันที ไม่ต้องรอบันทึก', ui.includes("const liveService = Number(val('input[name=pay_service_fee]')"));
/** user เจอ 09/09/69: ค่าเรียกร้องที่ระบบเติมให้ทำกรอบแดงค่าบริการหาย → ต้องดูช่องค่าบริการเอง ไม่ใช่ "มีเงินช่องไหนก็ได้" */
check('⛔ กรอบแดงค่าบริการดูเฉพาะช่องค่าบริการ ไม่หายเพราะช่องเงินอื่น (เช่น ค่าเรียกร้องที่เติมให้)',
      ui.includes("!(Number(pay?.saved?.service_fee ?? 0) > 0) && !liveService") && !ui.includes('const livePay ='));

console.log('\n── กล่องติ๊ก "รับเงินจำนวน": มียอดแต่ยังไม่ติ๊ก → กรอบแดง (user ขอ 09/09/69) ──');
check('มียอดแต่ยังไม่ติ๊ก → tickHl แดง', ui.includes("setTickHl(!moneyTick && Number(amt) > 0 ? 'red' : 'none');"));
check('กรอบแดงอยู่ที่ label ของกล่องติ๊ก (ตัวกล่องเล็กเกินจะเห็น)',
      ui.includes("${tickHl === 'red' ? `px-1 border rounded-none ${HL_CLS.red}` : ''}"));
check('นับเป็นข้อที่ยังอนุมัติไม่ได้ + ป้ายไม่ช้า 1 จังหวะ (อยู่ใน deps)',
      ui.includes("tickHl === 'red' ? ['กรอกยอด \"รับเงินจำนวน\" แล้วแต่ยังไม่ติ๊กกล่อง']") && ui.includes('payHl, tickHl, payOver'));

console.log('\n── เรทตำบลพิเศษ (บ่อวิน/พลูตาหลวง) ต้องถูกใช้ (user เจอ #252 09/09/69) ──');
{
  const pay = read('src', 'services', 'pay.service.ts');
  check('getCasePay ส่ง tumbonId ที่จับคู่จากชื่อตำบลในรายงานให้ calcPay',
        pay.includes('tumbonCode(rateProvince, rateDistrict, rateSubdistrict)') && pay.includes('tumbonId: tumbon,'));
  check('หน้าเคสบอกว่าเรทมาจากตำบลพิเศษ', ui.includes("rate_from === 'tumbon_by_team'"));
}

console.log('\n── เรทแนะนำตามพื้นที่ที่กำลังเลือก ไม่ใช่ที่บันทึกไว้ (user เจอ #252 09/09/69) ──');
{
  const pay = read('src', 'services', 'pay.service.ts');
  const ctl = read('src', 'controllers', 'case.controller.ts');
  check('getCasePay รับ override จังหวัด/อำเภอ/ตำบล/ประเภทเคลม', pay.includes('override: PayLocationOverride = {}') && pay.includes('tumbonCode(rateProvince, rateDistrict, rateSubdistrict)'));
  check('GET /pay รับ ?province=&district=&subdistrict=', ctl.includes("q('subdistrict')"));
  check('snapshot ตอนบันทึกคิดจากพื้นที่ที่ส่งมารอบนี้', pay.includes("acc_subdistrict: str('acc_subdistrict')"));
  check('หน้าเคส: เปลี่ยนตำบลแล้วขอเรทใหม่ (หน่วง 350ms)', ui.includes('params.subdistrict = tb;') && ui.includes('}, 350);'));
  check('หน้าเคส: เรทใหม่เติมทับเฉพาะช่องว่าง/ค่าที่ระบบเติมไว้ (ไม่ทับที่พิมพ์เอง)', ui.includes('lastSuggestRef') && ui.includes("['pay_service_fee', sg.service_fee]"));
  check('บันทึกส่งพื้นที่ไปกับยอดเงิน', ui.includes("acc_subdistrict: data['acc_subdistrict'] ?? null, claim_type: data['claim_type'] ?? null"));
}

console.log('\n── เรทคิดจาก "สถานที่ออกตรวจสอบ" ก่อนสถานที่เกิดเหตุ (user ขอ 09/09/69 เคลม 2026013072661) ──');
{
  const pay = read('src', 'services', 'pay.service.ts');
  const ctl = read('src', 'controllers', 'case.controller.ts');
  const bill = read('src', 'services', 'sebilling.service.ts');
  const mig = read('src', 'db', 'migrations', '058_survey_location.sql');
  check('migration 058 เพิ่ม 4 คอลัมน์สถานที่ออกตรวจสอบ',
        ['survey_place', 'survey_province', 'survey_district', 'survey_subdistrict'].every((c) => mig.includes(`ADD COLUMN IF NOT EXISTS ${c} TEXT`)));
  check('getCasePay อ่าน survey_province/district/subdistrict จากรายงาน', pay.includes('sr.survey_province, sr.survey_district, sr.survey_subdistrict'));
  check('มีจังหวัดที่ตรวจสอบ = ใช้ชุดนั้นทั้งชุด ไม่มีค่อยถอยไปสถานที่เกิดเหตุ', pay.includes("from: 'survey' }") && pay.includes("from: 'accident' }"));
  check('หน้าเว็บส่งจังหวัดมา = ใช้ชุดที่ส่งมาทั้งชุด (อำเภอ/ตำบลว่างได้ ไม่ผสมกับที่บันทึกไว้)', pay.includes('fromPage ? cleanArea(override.district) : savedLoc.district'));
  check('area บอกที่มาของพื้นที่ (rate_location)', pay.includes('rate_location: rateLocation'));
  check('snapshot ตอนบันทึกใช้ชุดเดียวกัน + จดที่มา', pay.includes("survey_province: str('survey_province')") && pay.includes('rate_location: loc.from'));
  check('GET /pay รับ ?location=', ctl.includes("location: q('location')"));
  check('captures se-billing ใช้พื้นที่ชุดเดียวกับเรท', bill.includes('rateLocationOf({') && !bill.includes("provinceCode(s('acc_province'))"));
  check('หน้าเคสมีช่องสถานที่ออกตรวจสอบ 4 ช่องใต้สถานที่เกิดเหตุ',
        ['name="survey_place"', 'name="survey_province"', 'name="survey_district"', 'name="survey_subdistrict"'].every((n) => ui.includes(n)));
  check('หน้าเคส: เรทแนะนำตามชุดที่ตรวจสอบก่อน', ui.includes('const useSurvey = isProv(survProv);') && ui.includes("params.location = useSurvey ? 'survey' : 'accident';"));
  check('หน้าเคส: เอาติ๊กตำบลออกแล้วส่งค่าว่างไป (ไม่ค้างของที่บันทึกไว้)', ui.includes("params.district = isDist(dd) ? dd : '';"));
  check('หน้าเคส: บันทึกส่งสถานที่ออกตรวจสอบไปกับยอดเงิน', ui.includes("survey_subdistrict: data['survey_subdistrict'] ?? null"));
  check('บรรทัดเรทบอกว่าคิดจากสถานที่ออกตรวจสอบหรือที่เกิดเหตุ', ui.includes("rate_location === 'survey'"));
}

console.log('\n── 0 บาท = ไม่มีเรท + บอกสาเหตุเมื่อหาเรทฝั่งพนักงานไม่ได้ (user เจอ #267 10/09/69) ──');
{
  const pay = read('src', 'services', 'pay.service.ts');
  check('เรทฐาน 0 ทุกชั้นถือว่าไม่มีเรท (pos)', pay.includes('pos(num(province?.sur_invest))') && pay.includes('pos(num(amphur?.sur_invest))') && pay.includes('return pos(num(map[team]));'));
  check('snapshot บอกว่าติดเพราะช่างไม่มีทีม + ทีมที่พื้นที่รู้จัก', pay.includes('team_needed: teamNeeded') && pay.includes('team_rates: teamRates'));
  check('area ส่งรหัสช่าง (SEC) ให้หน้าเว็บ', pay.includes('surveyor_code:'));
  check('หน้าเคสบอกสาเหตุ + ชี้ไปหน้ากำหนดทีม', ui.includes('ยังไม่ได้กำหนดทีม') && ui.includes('เรทค่าตอบแทน › ทีมผู้สำรวจ') && ui.includes("snapshot?.rate_from === 'ไม่พบเรท'"));
}

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด' : `\n❌ ไม่ผ่าน ${failed} ข้อ`);
process.exit(failed === 0 ? 0 : 1);
