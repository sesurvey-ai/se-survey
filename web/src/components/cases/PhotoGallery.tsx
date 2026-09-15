'use client';

import { useEffect, useRef, useState } from 'react';
import api, { getPhotoUrl } from '@/lib/api';

interface Photo { id: number; file_path?: string; filename?: string; category?: string | null; }

/** หมวดรูป — ต้องตรงกับ CATS ฝั่ง backend (case.controller.addPhotos) และหมวดที่บอทรู้จัก */
const UPLOAD_CATS = [
  'รูปรถประกัน', 'รูปรถคู่กรณี', 'รูปผู้บาดเจ็บ', 'รูปทรัพย์สิน',
  'รูปแผนที่เกิดเหตุ', 'รูปประกอบ',
];

/**
 * แถบเพิ่มรูปของผู้ตรวจสอบ
 *
 * จำเป็นเพราะรูปมาไม่ครบตั้งแต่ต้นทางบ่อย: งานที่ดึงจากระบบเก่าตอนยัง "รอตรวจข้อมูล"
 * มักมีรูป 1-5 ใบ (ช่างทยอยอัปทีหลัง) และบางรูปหัวหน้าได้มาทาง LINE/อีเมล
 * ซึ่งไม่มีวันไปโผล่ที่ระบบต้นทางให้ดึงได้เลย
 */
function PhotoUploader({ caseId, onUploaded }: { caseId: number; onUploaded?: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cat, setCat] = useState(UPLOAD_CATS[0]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const submit = async () => {
    if (!files.length) return;
    setBusy(true); setMsg('');
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('photos', f));
      fd.append('category', cat);
      const res = await api.post(`/api/cases/${caseId}/photos`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180000,
      });
      setMsg(`เพิ่มแล้ว ${res.data?.data?.added ?? files.length} รูป`);
      setFiles([]);
      if (inputRef.current) inputRef.current.value = '';
      onUploaded?.();
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { message?: string } } };
      // 423 = อนุมัติไปแล้ว (ชุดรูปถูกรับรองแล้ว) — บอกให้ชัดว่าต้องให้แอดมินปลดล็อกก่อน
      setMsg(err.response?.status === 423
        ? 'เคสนี้อนุมัติแล้ว — เพิ่มรูปไม่ได้จนกว่าแอดมินจะปลดล็อก'
        : (err.response?.data?.message || 'อัปโหลดไม่สำเร็จ'));
    } finally { setBusy(false); }
  };

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-none border border-gray-200 bg-gray-50 px-3 py-2">
      <span className="text-sm font-medium text-gray-700">เพิ่มรูป :</span>
      <select value={cat} onChange={(e) => setCat(e.target.value)}
        className="rounded-none border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800">
        {UPLOAD_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple
        onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setMsg(''); }}
        className="text-sm text-gray-700" />
      <button type="button" onClick={submit} disabled={busy || !files.length}
        className="rounded-none bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300">
        {busy ? 'กำลังอัปโหลด...' : `อัปโหลด${files.length ? ` ${files.length} รูป` : ''}`}
      </button>
      {msg && <span className="text-sm text-gray-600">{msg}</span>}
    </div>
  );
}

export default function PhotoGallery(
  { photos, caseId, onUploaded }: { photos: Photo[]; caseId?: number; onUploaded?: () => void },
) {
  const [selected, setSelected] = useState<Photo | null>(null);
  const [zoom, setZoom] = useState(1);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [rotating, setRotating] = useState<number | null>(null);
  /** รูปที่เพิ่งหมุน → เวลาที่หมุน · ต่อท้าย URL ให้เบราว์เซอร์โหลดไฟล์ใหม่ (ชื่อไฟล์เดิม แคชจะโชว์รูปเก่า) */
  const [rev, setRev] = useState<Record<number, number>>({});

  const winRef = useRef<Window | null>(null);
  /** กล่องทับจอ (ทางถอยเมื่อป๊อปอัปถูกบล็อก): ลากรูปที่ซูมเพื่อเลื่อนดู (user ขอ 15/09/69) — เลื่อน scroll ของกล่องตามระยะลาก */
  const panBoxRef = useRef<HTMLDivElement>(null);
  const panState = useRef<{ x: number; y: number; l: number; t: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const catLabelOf = (c?: string | null) => (c && c.trim()) ? c.trim() : 'ไม่ระบุหมวด';
  const srcOf = (p: Photo) => {
    const u = getPhotoUrl(p.file_path || p.filename || '');
    return rev[p.id] ? `${u}${u.includes('?') ? '&' : '?'}r=${rev[p.id]}` : u;
  };
  const viewerList = () => photos.map((x) => ({ id: x.id, src: srcOf(x), label: catLabelOf(x.category) }));
  /** ส่งรายการรูปล่าสุดเข้าหน้าต่างดูรูป (ถ้ายังเปิดอยู่) */
  const pushToViewer = () => {
    const w = winRef.current;
    if (!w || w.closed) return;
    const fn = (w as unknown as { __seSetPhotos?: (l: unknown[]) => void }).__seSetPhotos;
    if (typeof fn === 'function') fn(viewerList());
  };

  /**
   * หมุนรูป 90° — เซิร์ฟเวอร์เขียนทับไฟล์เดิม จึง "เป็นแบบนั้นเลย" ทุกที่ที่ใช้รูปต่อ (user 04/09/69)
   * เสร็จแล้วเปลี่ยน rev ให้ทุก <img> ของรูปนั้นโหลดใหม่ (แกลเลอรี, กล่องทับจอ, หน้าต่างดูรูป)
   */
  const rotatePhoto = async (p: Photo, deg: 90 | -90) => {
    if (!caseId || rotating !== null) return;
    setRotating(p.id);
    try {
      await api.post(`/api/cases/${caseId}/photos/${p.id}/rotate`, { deg }, { timeout: 60000 });
      setRev((m) => ({ ...m, [p.id]: Date.now() }));
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { message?: string } } };
      window.alert(err.response?.status === 423
        ? 'เคสนี้อนุมัติแล้ว — หมุนรูปไม่ได้จนกว่าแอดมินจะปลดล็อก'
        : (err.response?.data?.message || 'หมุนรูปไม่สำเร็จ'));
      pushToViewer();   // ปลดปุ่มในหน้าต่างดูรูป (มันรอรายการใหม่อยู่)
    } finally { setRotating(null); }
  };

  /**
   * ส่งรายการรูปล่าสุดเข้าไปในหน้าต่างดูรูปทุกครั้งที่รายการเปลี่ยน (ลบ/เพิ่มรูป)
   *
   * ⛔ ต้องมี ไม่งั้นลบรูปจากหน้าต่างแล้วรูปที่ลบไปยังค้างอยู่ในแถบซ้าย กดดูได้อีก
   *    (หน้าเว็บแม่รีเฟรชเอง แต่หน้าต่างที่เปิดค้างไว้ไม่มีทางรู้)
   */
  useEffect(() => {
    pushToViewer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, rev]);

  /** ลบรูปทีละใบ — ถามยืนยันก่อนเพราะกดแล้วไฟล์หายจริง ไม่มีถังขยะให้กู้ */
  const removePhoto = async (p: Photo, skipConfirm = false) => {
    if (!caseId) return;
    if (!skipConfirm && !window.confirm('ลบรูปนี้ออกจากเคส?\n\nลบแล้วกู้คืนไม่ได้ — ถ้าเป็นรูปจากระบบเดิม ดึงใหม่ได้จากโปรแกรมผู้ตรวจ')) return;
    setDeleting(p.id);
    try {
      await api.delete(`/api/cases/${caseId}/photos/${p.id}`);
      if (selected?.id === p.id) setSelected(null);
      onUploaded?.();          // โหลดเคสใหม่ทั้งก้อน — รายการรูปมาจากพ่อ ไม่ได้เก็บ state เอง
    } catch (e) {
      const err = e as { response?: { status?: number; data?: { message?: string } } };
      window.alert(err.response?.status === 423
        ? 'เคสนี้อนุมัติแล้ว — ลบรูปไม่ได้จนกว่าแอดมินจะปลดล็อก'
        : (err.response?.data?.message || 'ลบรูปไม่สำเร็จ'));
    } finally { setDeleting(null); }
  };

  /**
   * เปิดรูปใน "หน้าต่างแยก" — user สั่ง 01/09/69
   *
   * ทำไมไม่ใช้กล่องทับกลางจอแบบเดิม: ผู้ตรวจต้องอ่านรูปเทียบกับช่องข้อมูลบนหน้าเว็บ
   * ไปพร้อมกัน กล่องทับจอบังฟอร์มทั้งหน้า ต้องปิด-เปิดสลับไปมาทุกช่องที่ตรวจ
   *
   * ⛔ **ห้ามเปิด URL รูปตรง ๆ** ด้วย window.open(url) — URL มี token ติดอยู่
   *    (getPhotoUrl ส่ง token ทาง query เพราะ <img> แนบ header ไม่ได้) เปิดตรง ๆ
   *    = token ไปโผล่บน address bar และค้างในประวัติเบราว์เซอร์
   *    → เปิดหน้าต่างเปล่าแล้วเขียน <img> ลงไปแทน token อยู่แค่ในคำขอรูปเหมือนเดิม
   *
   * ⛔ ตั้งชื่อหน้าต่างไว้ (se_photo_viewer) เพื่อ **ใช้ซ้ำ** — ไม่ตั้งชื่อ เคสรูป 40 ใบ
   *    จะเปิดหน้าต่างใหม่ 40 บาน
   */
  const openInWindow = (p: Photo) => {
    const w = window.open('', 'se_photo_viewer', 'width=1180,height=920,scrollbars=yes,resizable=yes');
    // เบราว์เซอร์บล็อกป๊อปอัป → ถอยไปใช้กล่องทับจอแบบเดิม ดีกว่ากดแล้วไม่มีอะไรเกิดขึ้น
    if (!w) { setSelected(p); return; }
    /**
     * เปิดครั้งแรกให้เต็มพื้นที่จอ (user ทัก 15/09/69: หน้าต่าง 1180×920 บนจอกว้างเหลือที่ข้าง ๆ ปุ่มในแถบถูกบีบ)
     * — ทำเฉพาะหน้าต่างใหม่ (ยังไม่มี __seSetPhotos) หน้าต่างที่เปิดค้างและผู้ใช้ปรับขนาดเองแล้วไม่ไปยุ่ง
     */
    if (!(w as unknown as { __seSetPhotos?: unknown }).__seSetPhotos) {
      try { w.moveTo(0, 0); w.resizeTo(window.screen.availWidth, window.screen.availHeight); } catch { /* บางเบราว์เซอร์ไม่ให้ปรับ — ใช้ขนาดเดิม */ }
    }
    winRef.current = w;

    /**
     * สะพานลบรูปจากหน้าต่างดูรูป — หน้าต่างเรียกกลับมาที่หน้าเว็บแม่
     *
     * ⛔ ไม่ให้หน้าต่างยิง API เอง: จะต้องส่ง token เข้าไปเก็บไว้ในนั้น และต้องมีตัวจัดการ
     *    error/รีเฟรชซ้ำอีกชุด · ให้หน้าแม่ทำเหมือนตอนกดลบในตารางทุกอย่าง แล้วผลลัพธ์
     *    (รายการรูปใหม่) ไหลกลับเข้าหน้าต่างผ่าน __seSetPhotos เอง
     * ยืนยันที่หน้าต่างแล้ว (confirm ของหน้าแม่จะไปโผล่หลังหน้าต่าง มองไม่เห็น)
     */
    (window as unknown as { __seDeletePhoto?: (id: number) => void }).__seDeletePhoto = (id: number) => {
      const target = photos.find((x) => x.id === id);
      if (target) void removePhoto(target, true);
    };
    // สะพานหมุนรูป — หน้าแม่ยิง API แล้วส่งรายการ (URL ใหม่) กลับเข้าหน้าต่างเหมือนตอนลบ
    (window as unknown as { __seRotatePhoto?: (id: number, deg: 90 | -90) => void }).__seRotatePhoto = (id: number, deg: 90 | -90) => {
      const target = photos.find((x) => x.id === id);
      if (target) void rotatePhoto(target, deg);
    };

    // ค่าที่ฝังลงหน้าต่างใหม่ผ่าน JSON.stringify ทั้งหมด — ไม่ต้อง escape HTML เอง
    const list = viewerList();
    const start = photos.findIndex((x) => x.id === p.id);
    const canDelete = Boolean(caseId);

    w.document.open();
    w.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8">
<title>รูปเคส</title><style>
html,body{margin:0;height:100%;background:#111;color:#eee;font-family:system-ui,sans-serif}
#wrap{height:100%;display:flex}
#side{flex:none;width:190px;min-width:130px;max-width:70vw;display:flex;flex-direction:column;background:#181818}
#grip{flex:none;width:6px;cursor:col-resize;background:#2a2a2a}
#grip:hover,#grip.on{background:#4da3ff}
#filter{margin:8px;padding:6px;background:#2a2a2a;color:#eee;border:0;border-radius:6px;font-size:13px}
#strip{flex:1;min-height:0;overflow-y:auto;padding:0 8px 8px;display:grid;gap:8px;
  grid-template-columns:repeat(auto-fill,minmax(160px,1fr));align-content:start}
#strip .t{width:100%;aspect-ratio:4/3;height:auto;object-fit:cover;border-radius:6px;cursor:pointer;
  border:2px solid transparent;opacity:.55;display:block}
#strip .t:hover{opacity:.85}
#strip .t.on{opacity:1;border-color:#4da3ff}
#main{flex:1;min-width:0;display:flex;flex-direction:column}
/* แถบปุ่ม: ห่อบรรทัดได้ + ปุ่มไม่หด (user ทัก 15/09/69 ปุ่มถูกบีบเมื่อแถบรูปซ้ายกว้าง/หน้าต่างแคบ) */
#bar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 12px;background:#1c1c1c;font-size:13px}
#bar button{background:#333;color:#eee;border:0;border-radius:6px;padding:6px 12px;font-size:14px;cursor:pointer;white-space:nowrap;flex:none}
#bar button:hover{background:#444}
#bar button:disabled{opacity:.35;cursor:default}
#del{background:#a12b1e !important}
#del:hover{background:#c2321f !important}
#lgrp,#rgrp{flex:1 1 auto;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
#rgrp{justify-content:flex-end}
#cap{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:#bbb;white-space:nowrap;padding:0 10px}
#view{flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:8px}
/* ซูมแล้วต้องสลับเป็น block — flex ที่จัดกึ่งกลางจะตัดขอบบน/ซ้ายทิ้ง เลื่อนไปดูไม่ได้ */
#view.zoomed{display:block;text-align:center}
#zlab{min-width:44px;text-align:center;color:#bbb}
#img{max-width:100%;max-height:100%;object-fit:contain;cursor:zoom-in}
/* ซูมแล้วลากรูปเพื่อเลื่อนดูได้ (user ขอ 15/09/69) — touch-action:none ให้นิ้วลากบนจอสัมผัสใช้ตัวลากของเรา ไม่ใช่ scroll ของเบราว์เซอร์ */
#img.zoomed{cursor:grab;touch-action:none}
#img.zoomed.panning{cursor:grabbing}
#empty{color:#888;font-size:14px}
</style></head><body><div id="wrap">
<div id="side"><select id="filter"></select><div id="strip"></div></div>
<div id="grip" title="ลากเพื่อปรับความกว้าง"></div>
<div id="main">
<div id="bar"><div id="lgrp"><button id="prev">‹ ก่อนหน้า</button><button id="next">ถัดไป ›</button>
<button id="zout" title="ย่อ">−</button><span id="zlab">100%</span><button id="zin" title="ขยาย">+</button>
${canDelete ? '<button id="rotl" title="หมุนซ้าย 90° (ปุ่ม L) — บันทึกลงไฟล์เลย">↺ หมุนซ้าย</button><button id="rotr" title="หมุนขวา 90° (ปุ่ม R) — บันทึกลงไฟล์เลย">หมุนขวา ↻</button>' : ''}</div>
<span id="cap"></span>
<div id="rgrp">${canDelete ? '<button id="del">ลบรูปนี้</button>' : ''}</div></div>
<div id="view"><img id="img" alt=""><span id="empty" style="display:none">ไม่มีรูปในหมวดนี้</span></div>
</div></div>
<script>
var ALL=${JSON.stringify(list)},cat='',L=[],i=${start};
var img=document.getElementById('img'),cap=document.getElementById('cap'),empty=document.getElementById('empty');
var prev=document.getElementById('prev'),next=document.getElementById('next');
var strip=document.getElementById('strip'),filter=document.getElementById('filter');
var del=document.getElementById('del');
var rotl=document.getElementById('rotl'),rotr=document.getElementById('rotr');
function setRot(on){if(rotl){rotl.disabled=!on;rotr.disabled=!on;}}
function rot(d){if(!L.length||!rotl||rotl.disabled)return;setRot(false);cap.textContent='กำลังหมุน…';
  try{window.opener.__seRotatePhoto(L[i].id,d);}catch(e){alert('หมุนไม่สำเร็จ — หน้าเว็บหลักถูกปิดไปแล้ว');setRot(true);}}
if(rotl){rotl.onclick=function(){rot(-90);};rotr.onclick=function(){rot(90);};}
function cats(){var o=[],k;for(k=0;k<ALL.length;k++){if(o.indexOf(ALL[k].label)<0)o.push(ALL[k].label);}return o;}
function buildFilter(){var keep=cat,o='<option value="">ทั้งหมด ('+ALL.length+')</option>',c=cats(),k,n;
  for(k=0;k<c.length;k++){n=0;for(var j=0;j<ALL.length;j++)if(ALL[j].label===c[k])n++;
    o+='<option value="'+c[k].replace(/"/g,'&quot;')+'">'+c[k]+' ('+n+')</option>';}
  filter.innerHTML=o;if(c.indexOf(keep)>=0)filter.value=keep;else{filter.value='';cat='';}}
function buildStrip(){var h='',k;for(k=0;k<L.length;k++){
    h+='<img class="t'+(k===i?' on':'')+'" data-k="'+k+'" src="'+L[k].src+'" alt="">';}
  strip.innerHTML=h;
  var ts=strip.getElementsByTagName('img'),k2;
  for(k2=0;k2<ts.length;k2++)ts[k2].onclick=function(){i=+this.getAttribute('data-k');show();};}
function mark(){var ts=strip.getElementsByTagName('img'),k;
  for(k=0;k<ts.length;k++)ts[k].className='t'+(k===i?' on':'');
  if(ts[i])ts[i].scrollIntoView({block:'nearest'});}
function show(){
  if(!L.length){img.style.display='none';empty.style.display='';cap.textContent='0 / 0';
    prev.disabled=next.disabled=true;if(del)del.disabled=true;setRot(false);document.title='รูปเคส';return;}
  if(i<0)i=0;if(i>L.length-1)i=L.length-1;
  var it=L[i];img.style.display='';empty.style.display='none';img.src=it.src;z=1;applyZoom();
  cap.textContent=it.label+' · '+(i+1)+' / '+L.length;
  document.title=it.label+' '+(i+1)+'/'+L.length;
  prev.disabled=i<=0;next.disabled=i>=L.length-1;if(del)del.disabled=false;setRot(true);mark();}
function applyFilter(keepId){
  L=cat?ALL.filter(function(x){return x.label===cat;}):ALL.slice();
  var at=-1,k;if(keepId!=null)for(k=0;k<L.length;k++)if(L[k].id===keepId)at=k;
  i=at>=0?at:Math.min(i,Math.max(0,L.length-1));
  buildStrip();show();}
filter.onchange=function(){cat=filter.value;i=0;applyFilter();};
prev.onclick=function(){if(i>0){i--;show();}};
next.onclick=function(){if(i<L.length-1){i++;show();}};
var view=document.getElementById('view'),z=1;
var zin=document.getElementById('zin'),zout=document.getElementById('zout'),zlab=document.getElementById('zlab');
function applyZoom(){
  if(z===1){view.className='';img.className='';img.style.width='';img.style.maxWidth='';img.style.maxHeight='';}
  else{view.className='zoomed';img.className='zoomed';img.style.maxWidth='none';img.style.maxHeight='none';
    img.style.width=Math.round((img.naturalWidth||view.clientWidth)*z)+'px';}
  zlab.textContent=Math.round(z*100)+'%';}
function setZoom(v){z=Math.max(0.5,Math.min(5,Math.round(v*100)/100));applyZoom();}
zin.onclick=function(){setZoom(z+0.25);};
zout.onclick=function(){setZoom(z-0.25);};
// คลิกที่รูป = สลับพอดีจอ ↔ 200% (ทางลัด ไม่ต้องกดปุ่มหลายที)
img.onclick=function(){setZoom(z===1?2:1);};
img.onload=function(){if(z!==1)applyZoom();};
// ลากรูปที่ซูมเพื่อเลื่อนดู (user ขอ 15/09/69) — เดิมต้องเลื่อนจาก scroll bar ล่าง/ขวา · ใช้ pointer events ครอบทั้งเมาส์และนิ้ว
var pan=null,dragged=false;
img.ondragstart=function(){return false;};
img.onpointerdown=function(e){if(z===1||e.button!==0)return;
  pan={x:e.clientX,y:e.clientY,l:view.scrollLeft,t:view.scrollTop};dragged=false;img.className='zoomed panning';
  try{img.setPointerCapture(e.pointerId);}catch(err){}e.preventDefault();};
img.onpointermove=function(e){if(!pan)return;var dx=e.clientX-pan.x,dy=e.clientY-pan.y;
  if(Math.abs(dx)>3||Math.abs(dy)>3)dragged=true;view.scrollLeft=pan.l-dx;view.scrollTop=pan.t-dy;};
img.onpointerup=img.onpointercancel=function(e){if(!pan)return;pan=null;img.className=z===1?'':'zoomed';
  try{img.releasePointerCapture(e.pointerId);}catch(err){}};
// ลากแล้วปล่อยไม่นับเป็นคลิก (คลิกเฉย ๆ ยังสลับ 100%↔200% เหมือนเดิม) — ดักที่ชั้น capture ก่อนถึง img.onclick
view.addEventListener('click',function(e){if(dragged){dragged=false;e.stopPropagation();e.preventDefault();}},true);
if(del)del.onclick=function(){
  if(!L.length)return;
  if(!confirm('ลบรูปนี้ออกจากเคส? ลบแล้วกู้คืนไม่ได้'))return;
  del.disabled=true;
  try{window.opener.__seDeletePhoto(L[i].id);}catch(e){alert('ลบไม่สำเร็จ — หน้าเว็บหลักถูกปิดไปแล้ว');del.disabled=false;}};
// หน้าเว็บแม่ส่งรายการใหม่เข้ามาหลังลบ/เพิ่มรูป
window.__seSetPhotos=function(nl){var cur=L.length?L[i].id:null;ALL=nl;buildFilter();applyFilter(cur);};
// ลากขอบเพื่อขยายแถบรูป — กว้างขึ้นรูปจะจัดเป็น 2-3 คอลัมน์เองตามที่ว่าง
var side=document.getElementById('side'),grip=document.getElementById('grip'),drag=false;
function setW(px){var w=Math.max(130,Math.min(px,Math.round(innerWidth*0.7)));side.style.width=w+'px';
  try{localStorage.setItem('seViewerW',w);}catch(e){}}
try{var sw=parseInt(localStorage.getItem('seViewerW'),10);if(sw)setW(sw);}catch(e){}
grip.onmousedown=function(e){drag=true;grip.className='on';e.preventDefault();};
document.onmousemove=function(e){if(drag)setW(e.clientX);};
document.onmouseup=function(){if(drag){drag=false;grip.className='';}};
document.onkeydown=function(e){if(e.key==='ArrowLeft')prev.onclick();
  else if(e.key==='ArrowRight')next.onclick();else if(e.key==='Escape')window.close();
  else if(e.key==='r'||e.key==='R')rot(90);else if(e.key==='l'||e.key==='L')rot(-90);};
buildFilter();applyFilter(ALL.length?ALL[Math.min(i,ALL.length-1)].id:null);
<\/script></body></html>`);
    w.document.close();
    w.focus();
  };

  // แถบเพิ่มรูปต้องอยู่**นอก** early-return ของ "ไม่มีรูปภาพ" — เคสที่ต้นทางยังไม่ส่งรูปมาเลย
  // คือเคสที่ต้องเห็นปุ่มมากที่สุด แต่เดิมจะไม่เห็นเพราะจอว่าง
  if (!photos || photos.length === 0) {
    return (
      <div>
        {caseId ? <PhotoUploader caseId={caseId} onUploaded={onUploaded} /> : null}
        <div className="text-gray-500 text-center py-8">ไม่มีรูปภาพ</div>
      </div>
    );
  }

  const getSrc = srcOf;          // มี rev ต่อท้ายให้รูปที่เพิ่งหมุนโหลดใหม่
  const catLabel = (c?: string | null) => (c && c.trim()) ? c.trim() : 'ไม่ระบุหมวด';

  // จัดกลุ่มตามหมวด (ภาษาไทย) เรียงตามลำดับที่พบ — checker ดูรูปเป็นหมวดๆ ได้
  const groups: { category: string; items: Photo[] }[] = [];
  for (const p of photos) {
    const c = catLabel(p.category);
    const g = groups.find((x) => x.category === c);
    if (g) g.items.push(p); else groups.push({ category: c, items: [p] });
  }

  return (
    <>
      {caseId ? <PhotoUploader caseId={caseId} onUploaded={onUploaded} /> : null}
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.category}>
            <div className="text-sm font-semibold text-gray-700 mb-2">
              {g.category} <span className="text-gray-400 font-normal">({g.items.length})</span>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-3">
              {g.items.map((p) => (
                <div key={p.id} className="group relative cursor-pointer rounded-none overflow-hidden shadow-sm border border-gray-200 hover:shadow-md transition-shadow shrink-0 w-[calc(20%-13px)]" onClick={() => openInWindow(p)} title="เปิดรูปในหน้าต่างแยก — ดูรูปพร้อมกรอกข้อมูลได้">
                  <img src={getSrc(p)} alt={catLabel(p.category)} className="w-full h-48 object-cover" />
                  {/* ปุ่มลบโผล่ตอนชี้เมาส์ — ไม่โชว์ตลอดเพราะกดโดนง่ายตอนไล่ดูรูปเร็ว ๆ */}
                  {caseId ? (
                    <button type="button" title="ลบรูปนี้"
                      onClick={(e) => { e.stopPropagation(); void removePhoto(p); }}
                      disabled={deleting === p.id}
                      className="absolute top-1.5 right-1.5 hidden group-hover:flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-white text-lg leading-none hover:bg-red-600 disabled:opacity-50">
                      {deleting === p.id ? '…' : '×'}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {selected && (() => {
        const idx = photos.findIndex(p => p.id === selected.id);
        const hasPrev = idx > 0;
        const hasNext = idx < photos.length - 1;
        return (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-90 flex flex-col" onClick={() => { setSelected(null); setZoom(1); }}>
          {/* Zoom controls */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setZoom(z => Math.max(0.5, z - 0.25))} className="text-white bg-black bg-opacity-50 hover:bg-opacity-70 rounded-full w-9 h-9 flex items-center justify-center text-xl font-bold">−</button>
            {/* ปุ่มเรียงแถวเดียว ไม่ซ้อนกัน (เดิม "รีเซ็ต" ซ้อนใต้เปอร์เซ็นต์ แถบถูกบีบ — user ทัก 15/09/69) */}
            <span className="text-white text-sm min-w-[3.125rem] text-center whitespace-nowrap">{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="text-white bg-black bg-opacity-50 hover:bg-opacity-70 rounded-full w-9 h-9 flex items-center justify-center text-xl font-bold">+</button>
            {zoom !== 1 && <button onClick={() => setZoom(1)} className="text-white bg-black bg-opacity-50 hover:bg-opacity-70 rounded-none px-2 py-1 text-xs whitespace-nowrap">รีเซ็ต 100%</button>}
            {zoom !== 1 && <span className="text-white/70 text-xs whitespace-nowrap hidden sm:inline">ลากรูปเพื่อเลื่อนดู</span>}
          </div>
          {/* Main image area — ref ไว้ให้ตัวลากเลื่อน scroll ของกล่องนี้ตอนซูม */}
          <div ref={panBoxRef} className="flex-1 flex items-center justify-center relative min-h-0 overflow-auto">
            {hasPrev && (
              <button onClick={(e) => { e.stopPropagation(); setSelected(photos[idx - 1]); setZoom(1); }} className="absolute left-4 top-1/2 -translate-y-1/2 text-white text-5xl font-bold hover:text-gray-300 z-10 bg-black bg-opacity-40 rounded-full w-12 h-12 flex items-center justify-center">&lsaquo;</button>
            )}
            {/* ใช้ความกว้างจอเกือบเต็ม (เดิม max-w-4xl เหลือที่ข้าง ๆ เปล่า — user ทัก 15/09/69) */}
            <div className="relative max-w-[96vw] w-full px-14" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => { setSelected(null); setZoom(1); }} className="absolute -top-10 right-14 text-white text-3xl font-bold hover:text-gray-300">&times;</button>
              <img src={getSrc(selected)} alt={`รูปภาพ ${selected.id}`} draggable={false}
                className="w-full h-auto max-h-[82vh] object-contain rounded-none transition-transform duration-200 select-none"
                style={{ transform: `scale(${zoom})`, cursor: zoom > 1 ? 'grab' : 'default', touchAction: zoom > 1 ? 'none' : 'auto' }}
                onPointerDown={(e) => {
                  // ลากรูปที่ซูมเพื่อเลื่อนดู — เลื่อน scroll ของกล่อง (panBoxRef) ตามระยะที่ลาก
                  const box = panBoxRef.current;
                  if (zoom <= 1 || !box || e.button !== 0) return;
                  panState.current = { x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop, moved: false };
                  (e.currentTarget as HTMLElement).style.cursor = 'grabbing';
                  try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ไม่รองรับก็ลากได้ในกรอบ */ }
                  e.preventDefault();
                }}
                onPointerMove={(e) => {
                  const s = panState.current; const box = panBoxRef.current;
                  if (!s || !box) return;
                  const dx = e.clientX - s.x, dy = e.clientY - s.y;
                  if (Math.abs(dx) > 3 || Math.abs(dy) > 3) s.moved = true;
                  box.scrollLeft = s.l - dx; box.scrollTop = s.t - dy;
                }}
                onPointerUp={(e) => {
                  const s = panState.current;
                  if (!s) return;
                  if (s.moved) suppressClick.current = true;
                  panState.current = null;
                  (e.currentTarget as HTMLElement).style.cursor = zoom > 1 ? 'grab' : 'default';
                }}
                onPointerCancel={() => { panState.current = null; }}
                onClickCapture={(e) => { if (suppressClick.current) { suppressClick.current = false; e.stopPropagation(); e.preventDefault(); } }} />
              <div className="text-center text-white text-sm mt-2">
                <span className="font-semibold">{catLabel(selected.category)}</span> · {idx + 1} / {photos.length}
                {/* ลบจากจอเต็มด้วย — เคสรูป 40 ใบ คนไล่ดูทีละใบแล้วเจอรูปเสีย
                    ต้องลบได้ตรงนั้น ไม่ต้องจำว่าเป็นใบที่เท่าไหร่แล้วไปหาใน thumbnail */}
                {caseId ? (
                  <button type="button" onClick={() => { void removePhoto(selected); }}
                    disabled={deleting === selected.id}
                    className="ml-3 rounded-none bg-red-600/80 px-2 py-0.5 text-xs hover:bg-red-600 disabled:opacity-50">
                    {deleting === selected.id ? 'กำลังลบ...' : 'ลบรูปนี้'}
                  </button>
                ) : null}
                {caseId ? (
                  <>
                    <button type="button" onClick={() => { void rotatePhoto(selected, -90); }} disabled={rotating !== null}
                      title="หมุนซ้าย 90° — บันทึกลงไฟล์เลย"
                      className="ml-3 rounded-none bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30 disabled:opacity-50">↺ หมุนซ้าย</button>
                    <button type="button" onClick={() => { void rotatePhoto(selected, 90); }} disabled={rotating !== null}
                      title="หมุนขวา 90° — บันทึกลงไฟล์เลย"
                      className="ml-1 rounded-none bg-white/20 px-2 py-0.5 text-xs hover:bg-white/30 disabled:opacity-50">
                      {rotating === selected.id ? 'กำลังหมุน…' : 'หมุนขวา ↻'}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            {hasNext && (
              <button onClick={(e) => { e.stopPropagation(); setSelected(photos[idx + 1]); setZoom(1); }} className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-5xl font-bold hover:text-gray-300 z-10 bg-black bg-opacity-40 rounded-full w-12 h-12 flex items-center justify-center">&rsaquo;</button>
            )}
          </div>
          {/* Thumbnail strip */}
          <div className="shrink-0 py-3 px-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-2 overflow-x-auto pb-2 justify-center">
              {photos.map((p, i) => (
                <div key={p.id} onClick={() => setSelected(p)} className={`shrink-0 w-20 h-16 rounded-none cursor-pointer overflow-hidden border-2 transition-all ${i === idx ? 'border-white opacity-100 scale-105' : 'border-transparent opacity-50 hover:opacity-80'}`}>
                  <img src={getSrc(p)} alt={`thumb ${p.id}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>
        </div>
        );
      })()}
    </>
  );
}
