// Anike's Cozy Reading Shelf — v3.2 (Sync, NO paid Storage)
// - Firestore sync for books + stickers + handwriting + goals
// - Built-in cute pink stickers (some animated via CSS)
// - "Daily sticker" auto-adds one new sticker per day per user
// - Edit title/link/date after adding; copy cover from other saved books
// - Handwriting: more colors + eraser brush (not full wipe) + stickers on canvas

import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const qsa = (sel)=>Array.from(document.querySelectorAll(sel));
const el = (id)=>document.getElementById(id);
const on = (node, evt, fn)=>node?.addEventListener(evt, fn);

const page = location.pathname.split("/").pop() || "index.html";

// Shared auth elements (present on all pages)
const authOverlay = el("auth");
const authEmail = el("authEmail");
const authPassword = el("authPassword");
const signInBtn = el("signInBtn");
const signUpBtn = el("signUpBtn");
const authError = el("authError");
const logoutBtn = el("logoutBtn");

let userId=null;
let unsubBooks=null, unsubStickers=null, unsubGoals=null;

let state = { books:[], stickers:[], goals:[] };
let currentModalId=null;
let currentFilter="all";

// --- helpers ---
function clamp(n,a,b){ return Math.max(a, Math.min(b,n)); }
function normalize(s){ return (s||"").toString().trim().toLowerCase(); }
function uid(){ return Math.random().toString(16).slice(2)+"-"+Date.now().toString(16); }
function todayKey(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function showAuth(onIt){
  if(!authOverlay) return;
  authOverlay.classList.toggle("on", !!onIt);
}
function showError(msg){
  if(!authError) return;
  authError.style.display = msg ? "block":"none";
  authError.textContent = msg||"";
}

function booksCol(){ return collection(db,"users",userId,"books"); }
function stickersCol(){ return collection(db,"users",userId,"stickers"); }
function goalsCol(){ return collection(db,"users",userId,"goals"); }
function metaDoc(){ return doc(db,"users",userId,"meta","app"); }
function bookDoc(id){ return doc(db,"users",userId,"books",id); }
function stickerDoc(id){ return doc(db,"users",userId,"stickers",id); }
function goalDoc(id){ return doc(db,"users",userId,"goals",id); }

// --- built-in stickers (SVG data URLs) ---
function svgData(svg){
  const s = svg.replace(/\s+/g," ").trim();
  return "data:image/svg+xml;charset=utf-8,"+encodeURIComponent(s);
}
function builtinStickerPack(){
  const pink = "#ff70b8", black="#111111", blush="#ffd0e7";
  return [
    { name:"heart", dataUrl: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><path d="M64 112S10 78 10 44c0-14 10-26 24-26 10 0 19 5 24 13 5-8 14-13 24-13 14 0 24 12 24 26 0 34-54 68-54 68z" fill="${pink}"/><path d="M32 34c4-6 10-10 18-10" stroke="${blush}" stroke-width="8" stroke-linecap="round" opacity=".85"/></svg>`)},
    { name:"star", dataUrl: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><path d="M64 8l16 36 40 4-30 26 10 38-36-20-36 20 10-38L8 48l40-4 16-36z" fill="${black}"/><circle cx="50" cy="40" r="6" fill="${blush}"/></svg>`)},
    { name:"bow", dataUrl: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><path d="M64 60c-8 0-14-6-14-14s6-14 14-14 14 6 14 14-6 14-14 14z" fill="${black}"/><path d="M52 46c-20-20-40-8-40 8s20 28 40 8" fill="${pink}"/><path d="M76 46c20-20 40-8 40 8s-20 28-40 8" fill="${pink}"/><path d="M22 54c10 8 18 6 30-2" stroke="${blush}" stroke-width="7" stroke-linecap="round" opacity=".75"/></svg>`)},
    { name:"sparkle", dataUrl: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><path d="M64 10l10 34 34 10-34 10-10 34-10-34-34-10 34-10 10-34z" fill="${pink}"/><path d="M96 86l5 16 16 5-16 5-5 16-5-16-16-5 16-5 5-16z" fill="${black}"/></svg>`)},
    { name:"flower", dataUrl: svgData(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><g fill="${pink}"><circle cx="64" cy="34" r="18"/><circle cx="64" cy="94" r="18"/><circle cx="34" cy="64" r="18"/><circle cx="94" cy="64" r="18"/><circle cx="42" cy="42" r="16"/><circle cx="86" cy="42" r="16"/><circle cx="42" cy="86" r="16"/><circle cx="86" cy="86" r="16"/></g><circle cx="64" cy="64" r="16" fill="${black}"/><circle cx="58" cy="58" r="5" fill="${blush}"/></svg>`)},
  ];
}

// Add one "new sticker" per day (deterministic variant)
function dailyStickerForKey(key){
  const base = builtinStickerPack();
  // create a simple "variant" by picking one and tinting slightly with key hash
  let h=0; for(const ch of key) h=(h*31+ch.charCodeAt(0))>>>0;
  const pick = base[h % base.length];
  const hue = (h % 360);
  const svg = decodeURIComponent(pick.dataUrl.split(",")[1]);
  const tinted = svg.replace(/#ff70b8/gi, `hsl(${hue}, 85%, 65%)`);
  return { name:`daily-${key}`, dataUrl: svgData(tinted) };
}

async function ensureBuiltinStickers(){
  // If user has no stickers yet, add starter pack
  if(state.stickers.length === 0){
    const batch = writeBatch(db);
    const pack = builtinStickerPack();
    for(const s of pack){
      const id = uid();
      batch.set(stickerDoc(id), { id, name:s.name, dataUrl:s.dataUrl, createdAt: serverTimestamp(), createdAtMs: Date.now() });
    }
    await batch.commit();
  }
  // Add daily sticker once per day
  const key = todayKey();
  const mref = metaDoc();
  const snap = await getDoc(mref);
  const last = snap.exists() ? (snap.data().lastDailySticker||"") : "";
  if(last !== key){
    const s = dailyStickerForKey(key);
    const id = uid();
    await setDoc(stickerDoc(id), { id, name:s.name, dataUrl:s.dataUrl, createdAt: serverTimestamp(), createdAtMs: Date.now() });
    await setDoc(mref, { lastDailySticker: key }, { merge:true });
  }
}

// --- cover fetching ---
async function fetchCoverByTitle(title){
  const q = encodeURIComponent(title);
  const url = `https://openlibrary.org/search.json?title=${q}&limit=1`;
  try{
    const res = await fetch(url);
    if(!res.ok) return "";
    const data = await res.json();
    const doc0 = data?.docs?.[0];
    const coverI = doc0?.cover_i;
    if(coverI) return `https://covers.openlibrary.org/b/id/${coverI}-L.jpg`;
    const isbn = doc0?.isbn?.[0];
    if(isbn) return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
    return "";
  }catch(e){ return ""; }
}

// --- stars ---
function makeStars(container, value, onChange){
  if(!container) return;
  container.innerHTML="";
  const v=clamp(Number(value||0),0,5);
  for(let i=1;i<=5;i++){
    const btn=document.createElement("button");
    btn.type="button";
    btn.className="star-btn"+(i<=v?" on":"");
    btn.textContent="★";
    btn.addEventListener("click", ()=>onChange(i));
    container.appendChild(btn);
  }
}

// --- Stickers UI ---
function renderStickerTray(tray, onPick){
  if(!tray) return;
  tray.innerHTML="";
  state.stickers.forEach(s=>{
    const item=document.createElement("button");
    item.type="button";
    item.className="sticker-item";
    const img=document.createElement("img");
    img.alt=s.name||"Sticker";
    img.src=s.dataUrl;
    item.appendChild(img);
    item.addEventListener("click", ()=>onPick?.(s));
    tray.appendChild(item);
  });
  if(state.stickers.length===0){
    const p=document.createElement("div");
    p.className="hint";
    p.textContent="No stickers yet — they will appear after you sign in.";
    tray.appendChild(p);
  }
}

async function fileToDataUrlResized(file, maxW, maxH, quality){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onerror=reject;
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        const scale = Math.min(maxW/img.width, maxH/img.height, 1);
        const w = Math.round(img.width*scale);
        const h = Math.round(img.height*scale);
        const c=document.createElement("canvas");
        c.width=w; c.height=h;
        const ctx=c.getContext("2d");
        ctx.drawImage(img,0,0,w,h);
        const mime = file.type==="image/png" ? "image/png" : "image/jpeg";
        resolve(c.toDataURL(mime, quality));
      };
      img.onerror=reject;
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// --- bookshelf render (Manage + Shelf) ---
function fallbackNode(title){
  const d=document.createElement("div");
  d.className="fallback";
  d.textContent=title;
  return d;
}
function getStickerDataUrl(stickerId){
  const s=state.stickers.find(x=>x.id===stickerId);
  return s?.dataUrl||null;
}
function bookCoverNode(book){
  const src = book.coverUrl || book.fetchedCoverUrl || "";
  if(src){
    const img=document.createElement("img");
    img.alt=book.title;
    img.loading="lazy";
    img.src=src;
    img.addEventListener("error", ()=>img.replaceWith(fallbackNode(book.title)));
    return img;
  }
  return fallbackNode(book.title);
}
function bookMatchesQuery(book,q){
  if(!q) return true;
  const hay=[book.title, book.notes, book.status, book.finishedAt, book.link].map(normalize).join(" ");
  return hay.includes(q);
}

function bindChips(renderFn){
  qsa(".chip").forEach(btn=>{
    on(btn,"click", ()=>{
      qsa(".chip").forEach(b=>b.classList.remove("on"));
      btn.classList.add("on");
      currentFilter = btn.dataset.filter || "all";
      renderFn?.();
    });
  });
}

function renderShelf(){
  const shelfEl = el("shelf");
  if(!shelfEl) return;
  const search = normalize(el("searchInput")?.value||"");
  const countLabel = el("countLabel");

  const books = state.books.slice().sort((a,b)=>
    (b.finishedAt||"").localeCompare(a.finishedAt||"") || (b.createdAtMs||0)-(a.createdAtMs||0)
  );
  const filtered = books.filter(b=> (currentFilter==="all" ? true : (b.status||"read")===currentFilter) && bookMatchesQuery(b, search));

  shelfEl.innerHTML="";
  const grid=document.createElement("div");
  grid.className="books";

  filtered.forEach(book=>{
    const wrap=document.createElement("div");
    wrap.className="book-wrap";

    const card=document.createElement("div");
    card.className="book";
    card.appendChild(bookCoverNode(book));

    const badge=document.createElement("div");
    badge.className="badge";
    badge.innerHTML=`<span>★</span><span>${book.rating||0}</span>`;
    card.appendChild(badge);

    const stUrl=getStickerDataUrl(book.stickerId);
    if(stUrl){
      const st=document.createElement("img");
      st.className="sticker";
      st.alt="Sticker";
      st.src=stUrl;
      card.appendChild(st);
    }
    on(card,"click", ()=>openBookModal(book.id));

    const cap=document.createElement("div");
    cap.className="caption";
    cap.textContent=book.title;

    wrap.appendChild(card);
    wrap.appendChild(cap);
    grid.appendChild(wrap);
  });

  shelfEl.appendChild(grid);
  const edge=document.createElement("div");
  edge.className="shelf-edge";
  shelfEl.appendChild(edge);

  if(countLabel){
    countLabel.textContent = `${filtered.length} book${filtered.length===1?"":"s"}${search?" (filtered)":""}`;
  }
}

// --- Manage page: add book, export/import, upload stickers ---
async function addBook(payload){
  const id=uid();
  const title=payload.title.trim();

  await setDoc(bookDoc(id), {
    id,
    title,
    link: payload.link?.trim()||"",
    finishedAt: payload.finishedAt||"",
    rating: clamp(Number(payload.rating||0),0,5),
    notes: payload.notes||"",
    status: payload.status||"read",
    fetchedCoverUrl:"",
    coverUrl:"",
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
    stickerId:null,
    doodle: { strokes:[], elements:[], w:900, h:600, updatedAtMs:null }
  });

  const cover=await fetchCoverByTitle(title);
  if(cover) await updateDoc(bookDoc(id), { fetchedCoverUrl: cover });
}

function exportJSON(){
  const data=JSON.stringify({version:32, books:state.books, stickers:state.stickers, goals:state.goals}, null, 2);
  const blob=new Blob([data], {type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download="anike-bookshelf-export.json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function importJSONToCloud(file){
  const parsed = JSON.parse(await file.text());
  if(!parsed || !Array.isArray(parsed.books)) throw new Error("Invalid export format");
  const batch = writeBatch(db);

  if(Array.isArray(parsed.stickers)){
    for(const s of parsed.stickers){
      if(s?.dataUrl){
        const id=uid();
        batch.set(stickerDoc(id), { id, name:s.name||"imported", dataUrl:s.dataUrl, createdAt: serverTimestamp(), createdAtMs: Date.now() });
      }
    }
  }

  for(const b of parsed.books){
    const id=uid();
    batch.set(bookDoc(id), {
      id,
      title: b.title || "Untitled",
      link: b.link || "",
      finishedAt: b.finishedAt || "",
      rating: clamp(Number(b.rating||0),0,5),
      notes: b.notes || "",
      status: b.status || "read",
      fetchedCoverUrl: b.fetchedCoverUrl || "",
      coverUrl: b.coverUrl || "",
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      stickerId: null,
      doodle: b.doodle && (Array.isArray(b.doodle.strokes)||Array.isArray(b.doodle.elements)) ? {
        strokes: b.doodle.strokes || [],
        elements: b.doodle.elements || [],
        w: b.doodle.w || 900,
        h: b.doodle.h || 600,
        updatedAtMs: Date.now()
      } : {strokes:[], elements:[], w:900, h:600, updatedAtMs: Date.now()}
    });
  }

  if(Array.isArray(parsed.goals)){
    for(const g of parsed.goals){
      const id=uid();
      batch.set(goalDoc(id), {
        id,
        text: g.text || "Goal",
        due: g.due || "",
        done: !!g.done,
        rewardStickerId: null,
        createdAt: serverTimestamp(),
        createdAtMs: Date.now()
      });
    }
  }

  await batch.commit();
}

// --- Book modal editing ---
const notesDialog = el("notesDialog");
const modalTitle = el("modalTitle");
const modalMeta = el("modalMeta");
const modalNotes = el("modalNotes");
const modalRating = el("modalRating");
const modalStatus = el("modalStatus");
const saveNotesBtn = el("saveNotesBtn");
const deleteBtn = el("deleteBtn");

const modalEditTitle = el("modalEditTitle");
const modalEditDate = el("modalEditDate");
const modalEditLink = el("modalEditLink");
const modalCoverSource = el("modalCoverSource");
const modalCoverFromOther = el("modalCoverFromOther");
const modalCoverCustom = el("modalCoverCustom");

const stickerUpload = el("stickerUpload");
const stickerTray = el("stickerTray");
const modalStickerTray = el("modalStickerTray");
const removeStickerBtn = el("removeStickerBtn");

// Canvas UI
const drawDialog = el("drawDialog");
const drawCanvas = el("drawCanvas");
const penSize = el("penSize");
const penColor = el("penColor");
const openDrawBtn = el("openDrawBtn");
const clearDrawBtn = el("clearDrawBtn");
const saveDrawBtn = el("saveDrawBtn");
const wipeDrawBtn = el("wipeDrawBtn");
const eraserModeBtn = el("eraserModeBtn");
const drawThumb = el("drawThumb");

function buildMeta(book){
  const parts=[];
  if(book.status) parts.push(`Status: ${book.status}`);
  if(book.finishedAt) parts.push(`Finished: ${book.finishedAt}`);
  if(book.link) parts.push(`Link: ${book.link}`);
  return parts.join(" • ") || "No date/link saved yet.";
}

function populateCoverSelectors(currentId){
  if(!modalCoverFromOther) return;
  modalCoverFromOther.innerHTML="";
  const opt0=document.createElement("option");
  opt0.value="";
  opt0.textContent="Select a book…";
  modalCoverFromOther.appendChild(opt0);

  state.books.filter(b=>b.id!==currentId).forEach(b=>{
    const o=document.createElement("option");
    o.value=b.id;
    o.textContent=b.title;
    modalCoverFromOther.appendChild(o);
  });
}

function openBookModal(id){
  const book=state.books.find(b=>b.id===id);
  if(!book || !notesDialog) return;
  currentModalId=id;

  modalTitle.textContent=book.title;
  modalMeta.textContent=buildMeta(book);

  modalEditTitle.value = book.title || "";
  modalEditDate.value = book.finishedAt || "";
  modalEditLink.value = book.link || "";

  modalNotes.value = book.notes || "";
  modalStatus.value = book.status || "read";

  // Cover selector defaults
  modalCoverSource.value = "auto";
  modalCoverFromOther.disabled = true;
  modalCoverCustom.disabled = true;
  modalCoverFromOther.value="";
  modalCoverCustom.value = "";

  populateCoverSelectors(id);

  makeStars(modalRating, book.rating||0, async (v)=>{ await updateDoc(bookDoc(currentModalId), {rating:v}); });

  // Thumb
  refreshThumbFromBook(book);

  // Stickers
  renderStickerTray(modalStickerTray, async (s)=>{ await updateDoc(bookDoc(currentModalId), {stickerId:s.id}); });

  notesDialog.showModal();
}

async function saveBookEdits(){
  if(!currentModalId) return;
  const updates = {
    title: modalEditTitle.value.trim() || "Untitled",
    finishedAt: modalEditDate.value || "",
    link: modalEditLink.value.trim() || "",
    notes: modalNotes.value || "",
    status: modalStatus.value || "read"
  };

  // cover logic
  const mode = modalCoverSource?.value || "auto";
  if(mode === "custom"){
    updates.coverUrl = modalCoverCustom.value.trim();
  }else if(mode === "fromOther"){
    const otherId = modalCoverFromOther.value;
    const other = state.books.find(b=>b.id===otherId);
    updates.coverUrl = other ? (other.coverUrl || other.fetchedCoverUrl || "") : "";
  }else{
    // auto -> clear custom cover, and (re)fetch if needed
    updates.coverUrl = "";
    const existing = state.books.find(b=>b.id===currentModalId);
    if(existing && !existing.fetchedCoverUrl){
      const cover = await fetchCoverByTitle(updates.title);
      if(cover) updates.fetchedCoverUrl = cover;
    }
  }

  await updateDoc(bookDoc(currentModalId), updates);

  currentModalId=null;
  if(notesDialog.open) notesDialog.close();
}

async function deleteCurrentBook(){
  if(!currentModalId) return;
  await deleteDoc(bookDoc(currentModalId));
  currentModalId=null;
  if(notesDialog.open) notesDialog.close();
}

on(modalCoverSource,"change", ()=>{
  const v = modalCoverSource.value;
  modalCoverFromOther.disabled = v!=="fromOther";
  modalCoverCustom.disabled = v!=="custom";
});

on(saveNotesBtn,"click", saveBookEdits);
on(deleteBtn,"click", deleteCurrentBook);
on(removeStickerBtn,"click", async ()=>{ if(currentModalId) await updateDoc(bookDoc(currentModalId), {stickerId:null}); });

// --- Stickers upload ---
on(stickerUpload,"change", async (e)=>{
  const file = e.target.files?.[0];
  if(!file) return;
  try{
    const dataUrl = await fileToDataUrlResized(file, 128, 128, 0.9);
    const id = uid();
    await setDoc(stickerDoc(id), { id, name:"upload", dataUrl, createdAt: serverTimestamp(), createdAtMs: Date.now() });
  }catch(err){
    alert("Sticker upload failed: " + (err?.message||err));
  }finally{
    stickerUpload.value="";
  }
});

// --- Canvas: strokes + elements + eraser brush ---
let canvasCtx=null;
let drawing=false;
let currentStroke=null;
let eraser=false;
let sessionStrokes=[];
let sessionElements=[]; // stickers placed during this session

function ensureCanvas(){
  if(!drawCanvas) return;
  canvasCtx=drawCanvas.getContext("2d");
  canvasCtx.lineCap="round";
  canvasCtx.lineJoin="round";
}
function clearCanvas(){
  if(!canvasCtx) return;
  canvasCtx.clearRect(0,0,drawCanvas.width, drawCanvas.height);
}
function posFromEvent(e){
  const r=drawCanvas.getBoundingClientRect();
  return {
    x:(e.clientX-r.left)*(drawCanvas.width/r.width),
    y:(e.clientY-r.top)*(drawCanvas.height/r.height)
  };
}
function drawStroke(ctx, stroke){
  if(!stroke?.points?.length) return;
  ctx.save();
  if(stroke.type==="erase"){
    ctx.globalCompositeOperation="destination-out";
    ctx.strokeStyle="rgba(0,0,0,1)";
  }else{
    ctx.globalCompositeOperation="source-over";
    ctx.strokeStyle=stroke.color;
  }
  ctx.lineWidth=stroke.width;
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for(let i=1;i<stroke.points.length;i++) ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
  ctx.stroke();
  ctx.restore();
}
function drawElement(ctx, elmt){
  if(elmt?.type!=="sticker") return;
  const img=new Image();
  img.onload=()=>{
    ctx.drawImage(img, elmt.x-elmt.size/2, elmt.y-elmt.size/2, elmt.size, elmt.size);
  };
  img.src=elmt.dataUrl;
}

function loadBookDoodleToCanvas(book){
  clearCanvas();
  const doodle = book?.doodle || {};
  (doodle.strokes||[]).forEach(s=>drawStroke(canvasCtx, s));
  (doodle.elements||[]).forEach(e=>drawElement(canvasCtx, e));
}
function refreshThumbFromBook(book){
  if(!drawThumb) return;
  const doodle = book?.doodle || {};
  const has = (doodle.strokes?.length||0) + (doodle.elements?.length||0) > 0;
  if(!has){
    drawThumb.style.display="none";
    drawThumb.removeAttribute("src");
    return;
  }
  const off=document.createElement("canvas");
  off.width=900; off.height=600;
  const c=off.getContext("2d");
  c.lineCap="round"; c.lineJoin="round";
  (doodle.strokes||[]).forEach(s=>drawStroke(c, s));
  // render stickers synchronously (best effort): draw after load with simple loop
  (doodle.elements||[]).forEach(e=>{
    if(e.type==="sticker"){
      // draw placeholder circle if image not loaded in time
      c.save(); c.globalAlpha=.9;
      c.beginPath(); c.arc(e.x,e.y, e.size/2, 0, Math.PI*2); c.fillStyle="rgba(255,112,184,.25)"; c.fill();
      c.restore();
    }
  });
  drawThumb.src=off.toDataURL("image/png");
  drawThumb.style.display="block";
}

function setupCanvas(){
  if(!drawCanvas) return;
  ensureCanvas();

  on(drawCanvas,"pointerdown",(e)=>{
    drawCanvas.setPointerCapture(e.pointerId);
    drawing=true;
    const p=posFromEvent(e);
    const width = Number(penSize?.value||12);
    if(eraser){
      currentStroke={type:"erase", width: Math.max(12,width*2), points:[p]};
    }else{
      currentStroke={type:"pen", color: penColor?.value||"#111111", width, points:[p]};
    }
  });

  on(drawCanvas,"pointermove",(e)=>{
    if(!drawing || !currentStroke) return;
    const p=posFromEvent(e);
    currentStroke.points.push(p);
    // incremental draw
    drawStroke(canvasCtx, { ...currentStroke, points: currentStroke.points.slice(-2) });
  });

  function end(){
    if(currentStroke && currentStroke.points.length>1){
      sessionStrokes.push(currentStroke);
    }
    drawing=false;
    currentStroke=null;
  }
  on(drawCanvas,"pointerup", end);
  on(drawCanvas,"pointercancel", end);

  on(wipeDrawBtn,"click", ()=>{
    if(confirm("Wipe the whole canvas?")){ clearCanvas(); sessionStrokes=[]; sessionElements=[]; }
  });

  on(eraserModeBtn,"click", ()=>{
    eraser = !eraser;
    eraserModeBtn.textContent = eraser ? "Eraser (on)" : "Eraser";
  });

  // Sticker placement on canvas: tap places chosen sticker
  let selectedCanvasSticker = null;
  function renderCanvasStickerPicker(){
    // reuse modalStickerTray to pick sticker for canvas too
    renderStickerTray(modalStickerTray, async (s)=>{
      // If book modal open, clicking sticker assigns to book; so we add a toggle: holding Shift isn't possible on iPad.
      // We'll set selectedCanvasSticker and show a toast.
      selectedCanvasSticker = s;
      alert("Sticker selected for canvas ✅ Now tap on the canvas to place it.");
    });
  }

  // When draw dialog opens, refresh picker
  on(openDrawBtn,"click", ()=>{
    drawDialog?.showModal();
    const book=state.books.find(b=>b.id===currentModalId);
    clearCanvas();
    sessionStrokes=[]; sessionElements=[];
    if(book) loadBookDoodleToCanvas(book);
    selectedCanvasSticker = null;
    renderCanvasStickerPicker();
  });

  // Tap canvas to place sticker (if selected)
  on(drawCanvas,"click",(e)=>{
    if(!selectedCanvasSticker) return;
    const p=posFromEvent(e);
    const size = 64;
    const element = { type:"sticker", dataUrl:selectedCanvasSticker.dataUrl, x:p.x, y:p.y, size };
    sessionElements.push(element);
    // draw now
    const img=new Image();
    img.onload=()=>canvasCtx.drawImage(img, p.x-size/2, p.y-size/2, size, size);
    img.src=element.dataUrl;
  });

  on(saveDrawBtn,"click", async ()=>{
    if(!currentModalId) return;
    const book=state.books.find(b=>b.id===currentModalId);
    const existingStrokes = book?.doodle?.strokes || [];
    const existingElements = book?.doodle?.elements || [];
    const mergedStrokes = existingStrokes.concat(sessionStrokes);
    const mergedElements = existingElements.concat(sessionElements).slice(-60); // limit stickers
    // prune points
    let total=0;
    const pruned=[];
    for(let i=mergedStrokes.length-1;i>=0;i--){
      total += mergedStrokes[i].points?.length||0;
      if(total>12000) break;
      pruned.unshift(mergedStrokes[i]);
    }
    await updateDoc(bookDoc(currentModalId), {
      doodle: { strokes: pruned, elements: mergedElements, w:900, h:600, updatedAtMs: Date.now() }
    });
    sessionStrokes=[]; sessionElements=[];
    if(drawDialog?.open) drawDialog.close();
  });

  on(clearDrawBtn,"click", async ()=>{
    if(!currentModalId) return;
    if(!confirm("Clear this book's handwriting + canvas stickers?")) return;
    await updateDoc(bookDoc(currentModalId), { doodle:{strokes:[], elements:[], w:900, h:600, updatedAtMs: Date.now()} });
  });
}

// --- Goals page ---
function renderGoals(){
  const goalsList = el("goalsList");
  const tray = el("goalStickerTray");
  if(!goalsList) return;

  goalsList.innerHTML="";
  state.goals.slice().sort((a,b)=>(b.createdAtMs||0)-(a.createdAtMs||0)).forEach(g=>{
    const row=document.createElement("div");
    row.className="goal"+(g.done?" done":"");

    const tick=document.createElement("button");
    tick.className="tick";
    tick.type="button";
    tick.textContent = g.done ? "✓" : "";
    on(tick,"click", async ()=>{
      await updateDoc(goalDoc(g.id), { done: !g.done });
    });

    const body=document.createElement("div");
    body.className="body";
    const title=document.createElement("div");
    title.className="title";
    title.textContent=g.text;

    const meta=document.createElement("div");
    meta.className="meta";
    meta.textContent = g.due ? `Due: ${g.due}` : "No due date";

    const reward=document.createElement("div");
    reward.className="reward";
    const rlabel=document.createElement("div");
    rlabel.className="hint";
    rlabel.textContent="Reward:";
    reward.appendChild(rlabel);

    if(g.rewardStickerId){
      const img=document.createElement("img");
      img.alt="Reward sticker";
      img.src = getStickerDataUrl(g.rewardStickerId) || "";
      reward.appendChild(img);
    }else{
      const sp=document.createElement("span");
      sp.className="hint";
      sp.textContent="(none yet — click goal to add)";
      reward.appendChild(sp);
    }

    body.appendChild(title);
    body.appendChild(meta);
    body.appendChild(reward);

    const actions=document.createElement("div");
    actions.className="actions";
    const del=document.createElement("button");
    del.className="btn btn-ghost";
    del.type="button";
    del.textContent="Delete";
    on(del,"click", async ()=>{
      if(confirm("Delete this goal?")) await deleteDoc(goalDoc(g.id));
    });
    actions.appendChild(del);

    row.appendChild(tick);
    row.appendChild(body);
    row.appendChild(actions);

    // Click body to pick reward sticker
    on(body,"click", ()=>{
      if(!tray) return;
      alert("Pick a reward sticker below 👇");
      tray.scrollIntoView({behavior:"smooth", block:"center"});
      tray.dataset.goalPick = g.id;
    });

    goalsList.appendChild(row);
  });

  // tray
  renderStickerTray(tray, async (s)=>{
    const gid = tray?.dataset.goalPick;
    if(!gid) return;
    await updateDoc(goalDoc(gid), { rewardStickerId: s.id });
    tray.dataset.goalPick="";
  });
}

async function addGoal(text, due){
  const id=uid();
  await setDoc(goalDoc(id), { id, text, due: due||"", done:false, rewardStickerId:null, createdAt: serverTimestamp(), createdAtMs: Date.now() });
}

// --- subscribe ---
function subscribeAll(){
  unsubBooks?.(); unsubStickers?.(); unsubGoals?.();

  unsubBooks = onSnapshot(query(booksCol(), orderBy("createdAtMs","desc")), (snap)=>{
    state.books = snap.docs.map(d=>d.data());
    if(page==="index.html" || page==="shelf.html") renderShelf();
    // refresh cover dropdown if modal open
    if(currentModalId) populateCoverSelectors(currentModalId);
  });

  unsubStickers = onSnapshot(query(stickersCol(), orderBy("createdAtMs","desc")), (snap)=>{
    state.stickers = snap.docs.map(d=>d.data());
    // manage page tray
    renderStickerTray(el("stickerTray"), ()=>{});
    if(page==="goals.html") renderGoals();
    if(page==="index.html" || page==="shelf.html") renderShelf();
  });

  unsubGoals = onSnapshot(query(goalsCol(), orderBy("createdAtMs","desc")), (snap)=>{
    state.goals = snap.docs.map(d=>d.data());
    if(page==="goals.html") renderGoals();
  });
}

// --- page setup ---
function setDefaultDate(){
  const dateInput = el("dateInput");
  if(!dateInput) return;
  const t=new Date();
  dateInput.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
}

function bindManage(){
  const form = el("bookForm");
  const titleInput = el("titleInput");
  const linkInput = el("linkInput");
  const statusInput = el("statusInput");
  const dateInput = el("dateInput");
  const notesInput = el("notesInput");
  const ratingPicker = el("ratingPicker");

  let formRating=5;
  makeStars(ratingPicker, formRating, (v)=>{ formRating=v; makeStars(ratingPicker, v, ()=>{}); });

  on(form,"submit", async (e)=>{
    e.preventDefault();
    await addBook({
      title: titleInput.value,
      link: linkInput.value,
      status: statusInput.value,
      finishedAt: dateInput.value,
      rating: formRating,
      notes: notesInput.value
    });
    form.reset();
    setDefaultDate();
    statusInput.value="read";
    formRating=5;
    makeStars(ratingPicker, formRating, (v)=>{ formRating=v; makeStars(ratingPicker, v, ()=>{}); });
  });

  on(el("searchInput"),"input", renderShelf);
  bindChips(renderShelf);

  on(el("exportBtn"),"click", exportJSON);
  on(el("importInput"),"change", async (e)=>{
    const file=e.target.files?.[0];
    if(!file) return;
    try{
      if(!confirm("Import will ADD into your synced shelf. Continue?")) return;
      await importJSONToCloud(file);
      alert("Import complete ✅");
    }catch(err){ alert("Import failed: "+(err?.message||err)); }
    finally{ e.target.value=""; }
  });

  on(el("demoBtn"),"click", async ()=>{
    const demos=[
      {title:"Atomic Habits", link:"https://jamesclear.com/atomic-habits", finishedAt:"2025-12-20", rating:5, notes:"habits, identity, systems, consistency", status:"read"},
      {title:"Deep Work", link:"https://www.calnewport.com/books/deep-work/", finishedAt:"2025-11-28", rating:4, notes:"focus, productivity, leadership", status:"read"}
    ];
    for(const d of demos) await addBook(d);
  });
}

function bindShelfOnly(){
  on(el("searchInput"),"input", renderShelf);
  bindChips(renderShelf);
}

function bindGoals(){
  const form=el("goalForm");
  const text=el("goalText");
  const due=el("goalDue");
  on(form,"submit", async (e)=>{
    e.preventDefault();
    await addGoal(text.value.trim(), due.value);
    form.reset();
  });
}

// --- Auth bindings ---
on(signInBtn,"click", async ()=>{
  showError("");
  try{ await signInWithEmailAndPassword(auth, authEmail.value.trim(), authPassword.value); }
  catch(e){ showError(e?.message||"Sign in failed"); }
});
on(signUpBtn,"click", async ()=>{
  showError("");
  try{ await createUserWithEmailAndPassword(auth, authEmail.value.trim(), authPassword.value); }
  catch(e){ showError(e?.message||"Sign up failed"); }
});
on(logoutBtn,"click", async ()=>{ await signOut(auth); });

// Init per page
if(page==="index.html"){ bindManage(); setupCanvas(); }
if(page==="shelf.html"){ bindShelfOnly(); }
if(page==="goals.html"){ bindGoals(); }

onAuthStateChanged(auth, async (user)=>{
  if(user){
    userId=user.uid;
    showAuth(false);
    subscribeAll();
    // ensure stickers exist + daily sticker
    try{ await ensureBuiltinStickers(); }catch(e){}
    // initial render
    if(page==="index.html" || page==="shelf.html") renderShelf();
    if(page==="goals.html") renderGoals();
    setDefaultDate();
  }else{
    userId=null;
    state={books:[], stickers:[], goals:[]};
    showAuth(true);
    if(page==="index.html" || page==="shelf.html") renderShelf();
    if(page==="goals.html") renderGoals();
  }
});
