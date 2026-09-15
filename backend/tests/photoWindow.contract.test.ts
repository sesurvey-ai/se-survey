/**
 * การ์ดของ "กดดูรูปแล้วเปิดหน้าต่างแยก" — user สั่ง 01/09/69
 *
 * เหตุผล: ผู้ตรวจต้องอ่านรูปเทียบกับช่องข้อมูลบนหน้าเว็บไปพร้อมกัน กล่องทับกลางจอ
 * บังฟอร์มทั้งหน้า ต้องปิด-เปิดสลับทุกช่องที่ตรวจ
 */
import * as fs from 'fs';
import * as path from 'path';

let failed = 0;
const check = (label: string, ok: boolean, note = '') => {
  if (!ok) failed++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${note ? `  (${note})` : ''}`);
};
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

const gallery = read('..', 'web', 'src', 'components', 'cases', 'PhotoGallery.tsx');
const apiLib = read('..', 'web', 'src', 'lib', 'api.ts');

console.log('\n── เปิดรูปในหน้าต่างแยก ──');
check('กดรูปในตารางแล้วเปิดหน้าต่างแยก', /onClick=\{\(\) => openInWindow\(p\)\}/.test(gallery));
/** ระบุ width/height ถึงจะได้ "หน้าต่าง" จริง — ไม่ระบุ เบราว์เซอร์เปิดเป็นแท็บซึ่งบังหน้าเว็บอยู่ดี */
check('เปิดเป็นหน้าต่างจริง ไม่ใช่แท็บ', /window\.open\('', 'se_photo_viewer', 'width=\d+,height=\d+/.test(gallery));
/**
 * ⛔ ห้าม window.open(url) ตรง ๆ — URL รูปมี token ติดอยู่ (getPhotoUrl ส่งทาง query
 *    เพราะ <img> แนบ header ไม่ได้) เปิดตรง ๆ = token โผล่บน address bar + ค้างในประวัติ
 */
check('ไม่เปิด URL รูปตรง ๆ (token จะโผล่บน address bar)',
      /token=/.test(apiLib) && !/window\.open\(\s*getSrc/.test(gallery) && !/window\.open\(src/.test(gallery));
/** ไม่ตั้งชื่อหน้าต่าง = เคสรูป 40 ใบเปิดหน้าต่างใหม่ 40 บาน */
check('ใช้หน้าต่างเดิมซ้ำ (ตั้งชื่อไว้)', gallery.includes("'se_photo_viewer'"));
/** เบราว์เซอร์บล็อกป๊อปอัป → ต้องมีทางถอย ไม่ใช่กดแล้วเงียบ */
check('ป๊อปอัปถูกบล็อก → ถอยไปใช้กล่องทับจอเดิม', /if \(!w\) \{ setSelected\(p\); return; \}/.test(gallery));
/** ผู้ตรวจไล่ดูรูปทีละใบระหว่างกรอก — ไม่มีปุ่มถัดไปต้องกลับไปกดที่ตารางทุกใบ */
check('ในหน้าต่างมีปุ่มก่อนหน้า/ถัดไป', gallery.includes("id=\"prev\"") && gallery.includes("id=\"next\""));
check('กดรูปเพื่อซูมได้', gallery.includes("img.onclick=function(){setZoom(z===1?2:1);};"));
/** เดิมมีแค่คลิกที่รูปสลับ ไม่มีอะไรบอกว่ากดได้ ผู้ใช้หาปุ่มซูมไม่เจอ (user แจ้ง 01/09/69) */
check('มีปุ่มย่อ/ขยาย + บอกเปอร์เซ็นต์', /id="zin"/.test(gallery) && /id="zout"/.test(gallery) && /id="zlab"/.test(gallery));
/**
 * ⛔ ซูมแล้วต้องสลับ #view เป็น block — flex ที่จัดกึ่งกลางจะตัดขอบบน/ซ้ายของรูปที่
 *    ใหญ่กว่ากรอบทิ้ง แล้วเลื่อนไปดูส่วนที่ถูกตัดไม่ได้เลย (ซูมได้แต่ดูไม่ได้)
 */
check('ซูมแล้วเลื่อนดูได้ (ไม่ใช้ flex จัดกึ่งกลางตอนซูม)',
      gallery.includes('#view.zoomed{display:block;text-align:center}')
      && gallery.includes("view.className='zoomed'"));
/** เปลี่ยนรูปแล้วยังซูมค้างที่เดิม = รูปถัดไปโผล่มาครึ่งเดียวโดยไม่รู้สาเหตุ */
check('เปลี่ยนรูปแล้วกลับไปพอดีจอ', gallery.includes("img.src=it.src;z=1;applyZoom();"));
/** naturalWidth เป็น 0 ตอนรูปยังโหลดไม่เสร็จ — ซูมค้างไว้แล้วสลับรูปจะได้ความกว้าง 0 */
check('คำนวณซูมใหม่หลังรูปโหลดเสร็จ', gallery.includes("img.onload=function(){if(z!==1)applyZoom();};"));
/**
 * user ทัก 15/09/69: ซูมแล้วต้องเลื่อนจาก scroll bar ล่าง/ขวา → ลากรูปเลื่อนได้ (pointer events ครอบเมาส์+นิ้ว)
 * ลากแล้วปล่อยต้องไม่นับเป็นคลิก (ไม่งั้นทุกครั้งที่ลากจะเด้งกลับ 100%) · หน้าต่างเปิดครั้งแรกให้เต็มจอ + แถบปุ่มไม่บีบ
 */
check('ซูมแล้วลากรูปเพื่อเลื่อนดู (เลื่อน scroll ของ #view ตามระยะลาก)',
      gallery.includes("img.onpointerdown=function(e){if(z===1||e.button!==0)return;")
      && gallery.includes('view.scrollLeft=pan.l-dx;view.scrollTop=pan.t-dy;')
      && gallery.includes('#img.zoomed{cursor:grab;touch-action:none}'));
check('ลากแล้วปล่อยไม่นับเป็นคลิก (ดักชั้น capture ก่อนถึง img.onclick)',
      gallery.includes("view.addEventListener('click',function(e){if(dragged){dragged=false;e.stopPropagation();e.preventDefault();}},true);"));
check('เปิดครั้งแรกขยายเต็มพื้นที่จอ (หน้าต่างที่เปิดค้างไม่ถูกปรับ)',
      /if \(!\(w as unknown as \{ __seSetPhotos\?: unknown \}\)\.__seSetPhotos\) \{\s*try \{ w\.moveTo\(0, 0\); w\.resizeTo\(window\.screen\.availWidth, window\.screen\.availHeight\); \}/.test(gallery));
check('แถบปุ่มห่อบรรทัดได้ ปุ่มไม่หด คำบรรยายย่อได้', gallery.includes('#bar{flex:none;display:flex;flex-wrap:wrap;')
      && /#bar button\{[^}]*white-space:nowrap;flex:none\}/.test(gallery) && /#cap\{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;/.test(gallery));
check('กล่องทับจอ (ทางถอย): ลากรูปที่ซูมได้ + ใช้ความกว้างจอเกือบเต็ม',
      gallery.includes('const panBoxRef = useRef<HTMLDivElement>(null);') && /box\.scrollLeft = s\.l - dx; box\.scrollTop = s\.t - dy;/.test(gallery)
      && gallery.includes('className="relative max-w-[96vw] w-full px-14"'));

console.log('\n── แถบรูปซ้าย · ตัวกรอง · ลบรูป ──');
const winPart = gallery.split('w.document.write')[1] || '';
check('มีแถบรูปด้านซ้าย + ตัวกรองหมวด',
      /id="side"/.test(gallery) && /id="strip"/.test(gallery) && /id="filter"/.test(gallery));
check('ตัวกรองมี "ทั้งหมด" + นับจำนวนต่อหมวด',
      gallery.includes("ทั้งหมด ('+ALL.length+')") && gallery.includes("+' ('+n+')</option>'"));
check('กดรูปในแถบซ้ายแล้วเปลี่ยนรูปตรงกลาง',
      gallery.includes("i=+this.getAttribute('data-k');show();"));
check('มีปุ่มลบรูปที่กำลังดูอยู่', /id="del"/.test(gallery) && gallery.includes('__seDeletePhoto(L[i].id)'));
/**
 * ⛔ ปุ่มลบในหน้าต่างต้องเรียกกลับมาที่หน้าเว็บแม่ ห้ามยิง API เอง —
 *    ไม่งั้นต้องส่ง token เข้าไปเก็บในหน้าต่าง + เขียนตัวจัดการ error/รีเฟรชซ้ำอีกชุด
 */
check('ลบผ่านหน้าเว็บแม่ ไม่ยิง API จากในหน้าต่าง',
      winPart.includes('window.opener.__seDeletePhoto') && !/fetch\([^)]{0,40}\/api\/cases/.test(winPart));
/**
 * ⛔ ลบแล้วต้องดันรายการใหม่เข้าหน้าต่างด้วย — หน้าเว็บแม่รีเฟรชเอง แต่หน้าต่างที่เปิด
 *    ค้างไว้ไม่มีทางรู้ รูปที่ลบไปจะยังค้างในแถบซ้ายและกดดูได้อีก
 */
check('ลบแล้วรายการในหน้าต่างอัปเดตตาม',
      winPart.includes('window.__seSetPhotos=function')
      && /__seSetPhotos\b/.test(gallery.split('w.document.write')[0]));
check('ยืนยันก่อนลบที่ตัวหน้าต่างเอง (confirm ของหน้าแม่จะไปโผล่ข้างหลัง)',
      winPart.includes("confirm('ลบรูปนี้ออกจากเคส"));

console.log('\n── ลากขยายแถบรูปได้ ──');
check('มีที่จับสำหรับลาก', /id="grip"/.test(gallery) && /cursor:col-resize/.test(gallery));
/**
 * ⛔ ต้องเป็น grid + auto-fill — ถ้ายังเป็นรูปเรียงลงมาทีละใบ (width:100%)
 *    ลากให้กว้างแค่ไหนก็ได้คอลัมน์เดียว รูปยืดใหญ่ขึ้นเฉย ๆ ไม่ได้เห็นรูปมากขึ้น
 */
check('กว้างขึ้นแล้วรูปจัดหลายคอลัมน์เอง',
      gallery.includes('grid-template-columns:repeat(auto-fill,minmax(160px,1fr))'));
/** ลากจนแคบเกินจนไม่เหลือที่ให้รูป / กว้างจนกลืนพื้นที่ดูรูปทั้งหมด = ใช้งานต่อไม่ได้ */
check('จำกัดความกว้างต่ำสุด/สูงสุด', gallery.includes('Math.max(130,Math.min(px,Math.round(innerWidth*0.7)))'));
check('จำความกว้างไว้ใช้ครั้งถัดไป', gallery.includes("localStorage.setItem('seViewerW'"));
/** localStorage โยน error ได้ในบางบริบท — ล้มทั้งสคริปต์เพราะจำความกว้างไม่ได้ ไม่คุ้ม */
check('อ่าน/เขียนความกว้างมี try/catch', /try\{localStorage\.setItem\('seViewerW'[\s\S]{0,40}catch/.test(gallery));

console.log('\n── สคริปต์ในหน้าต่างต้องรันได้จริง ──');
/**
 * ⛔ **การ์ดสำคัญที่สุดของไฟล์นี้** — สคริปต์ของหน้าต่างดูรูปเป็น "สตริงซ้อนสองชั้น"
 *    (TS template literal → JS ในหน้าต่าง) ตัว escape ผิดตัวเดียวทั้งสคริปต์ตายเงียบ:
 *    หน้าต่างเปิดขึ้นมาโล่ง ๆ ไม่มีรูป ไม่มีปุ่มไหนทำงาน และ **TypeScript คอมไพล์ผ่าน**
 *
 *    เคยพลาดมาแล้วจริง 01/09/69: เขียน '...?\n\n...' ในข้อความยืนยันลบ → template literal
 *    แปลง \n เป็นขึ้นบรรทัดจริง → สตริงใน JS ของหน้าต่างขาดกลางคัน → SyntaxError
 *
 *    เทสนี้ประกอบสคริปต์แบบเดียวกับตอนรันจริงแล้วสั่ง parse — ไม่ผ่านคือพังแน่นอน
 */
const tplStart = gallery.indexOf('w.document.write(`') + 'w.document.write(`'.length;
const tplEnd = gallery.indexOf('</html>`);');
const rawTpl = gallery.slice(tplStart, tplEnd) + '</html>';
let genErr: string | null = null;
try {
  const build = new Function('list', 'start', 'canDelete', 'return `' + rawTpl + '`');
  const html = build(
    [{ id: 1, src: 'http://x/a.jpg?token=t', label: 'รูปรถประกัน' },
     { id: 2, src: 'http://x/b.jpg?token=t', label: 'รูปรถคู่กรณี' }],
    0, true,
  ) as string;
  const js = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
  if (!js.trim()) throw new Error('แกะสคริปต์ออกมาไม่ได้ — ปิดแท็ก </script> ถูกต้องไหม');
  new Function(js);
} catch (e) {
  genErr = (e as Error).message;
}
check('สคริปต์ที่ฝังลงหน้าต่าง parse ผ่าน', genErr === null, genErr ?? '');

console.log(failed === 0 ? '\n✅ ผ่านทั้งหมด' : `\n❌ ไม่ผ่าน ${failed} ข้อ`);
process.exit(failed === 0 ? 0 : 1);
