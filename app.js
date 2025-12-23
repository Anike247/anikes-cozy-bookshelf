// Anike's Cozy Reading Shelf — v3.1 (Firebase Sync, NO paid Storage)
// ✅ Email/password auth
// ✅ Firestore for books + stickers + handwriting (vector strokes)
// ✅ Real-time sync across iPad + phone + laptop
//
// Your Firebase console requires billing upgrade for Firebase Storage in this project.
// So this build avoids Storage entirely.

import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const el = (id) => document.getElementById(id);

const shelfEl = el("shelf");
const searchInput = el("searchInput");
const countLabel = el("countLabel");

const form = el("bookForm");
const titleInput = el("titleInput");
const linkInput = el("linkInput");
const statusInput = el("statusInput");
const dateInput = el("dateInput");
const notesInput = el("notesInput");
const ratingPicker = el("ratingPicker");

const exportBtn = el("exportBtn");
const importInput = el("importInput");
const demoBtn = el("demoBtn");
const logoutBtn = el("logoutBtn");

const notesDialog = el("notesDialog");
const modalTitle = el("modalTitle");
const modalMeta = el("modalMeta");
const modalNotes = el("modalNotes");
const modalRating = el("modalRating");
const modalStatus = el("modalStatus");
const saveNotesBtn = el("saveNotesBtn");
const deleteBtn = el("deleteBtn");

const stickerUpload = el("stickerUpload");
const stickerTray = el("stickerTray");
const modalStickerTray = el("modalStickerTray");
const removeStickerBtn = el("removeStickerBtn");

const drawDialog = el("drawDialog");
const drawCanvas = el("drawCanvas");
const penSize = el("penSize");
const penColor = el("penColor");
const openDrawBtn = el("openDrawBtn");
const clearDrawBtn = el("clearDrawBtn");
const saveDrawBtn = el("saveDrawBtn");
const wipeDrawBtn = el("wipeDrawBtn");
const drawThumb = el("drawThumb");

const authOverlay = el("auth");
const authEmail = el("authEmail");
const authPassword = el("authPassword");
const signInBtn = el("signInBtn");
const signUpBtn = el("signUpBtn");
const authError = el("authError");

let userId = null;
let unsubBooks = null;
let unsubStickers = null;

let state = { books: [], stickers: [] };
let currentModalId = null;
let currentFilter = "all";

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }
function normalize(s){ return (s || "").toString().trim().toLowerCase(); }
function uid(){ return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16); }

function showAuth(on){
  if(!authOverlay) return;
  authOverlay.classList.toggle("on", !!on);
}
function showError(msg){
  if(!authError) return;
  authError.style.display = msg ? "block" : "none";
  authError.textContent = msg || "";
}

function makeStars(container, value, onChange){
  if(!container) return;
  container.innerHTML = "";
  const v = clamp(Number(value || 0), 0, 5);
  for(let i=1;i<=5;i++){
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "star-btn" + (i <= v ? " on" : "");
    btn.textContent = "★";
    btn.addEventListener("click", () => onChange(i));
    container.appendChild(btn);
  }
}

function fallbackNode(title){
  const d = document.createElement("div");
  d.className = "fallback";
  d.textContent = title;
  return d;
}

function getStickerDataUrl(stickerId){
  if(!stickerId) return null;
  const s = state.stickers.find(x => x.id === stickerId);
  return s?.dataUrl || null;
}

function bookCoverNode(book){
  const src = book.fetchedCoverUrl || "";
  if(src){
    const img = document.createElement("img");
    img.alt = book.title;
    img.loading = "lazy";
    img.src = src;
    img.addEventListener("error", () => img.replaceWith(fallbackNode(book.title)));
    return img;
  }
  return fallbackNode(book.title);
}

function bookMatchesQuery(book, q){
  if(!q) return true;
  const hay = [book.title, book.notes, book.status, book.finishedAt, book.link].map(normalize).join(" ");
  return hay.includes(q);
}

function render(){
  if(!shelfEl) return;
  const q = normalize(searchInput?.value || "");

  const books = state.books.slice().sort((a,b) =>
    (b.finishedAt || "").localeCompare(a.finishedAt || "") || (b.createdAtMs || 0) - (a.createdAtMs || 0)
  );

  const filtered = books.filter(b => {
    const statusOk = (currentFilter === "all") ? true : (b.status || "read") === currentFilter;
    return statusOk && bookMatchesQuery(b, q);
  });

  shelfEl.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "books";

  filtered.forEach(book => {
    const wrap = document.createElement("div");
    wrap.className = "book-wrap";

    const card = document.createElement("div");
    card.className = "book";
    card.title = "Click to view/edit";

    card.appendChild(bookCoverNode(book));

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.innerHTML = `<span>★</span><span>${book.rating || 0}</span>`;
    card.appendChild(badge);

    const stickerUrl = getStickerDataUrl(book.stickerId);
    if(stickerUrl){
      const st = document.createElement("img");
      st.className = "sticker";
      st.alt = "Sticker";
      st.src = stickerUrl;
      card.appendChild(st);
    }

    card.addEventListener("click", () => openModal(book.id));

    const cap = document.createElement("div");
    cap.className = "caption";
    cap.textContent = book.title;

    wrap.appendChild(card);
    wrap.appendChild(cap);
    grid.appendChild(wrap);
  });

  shelfEl.appendChild(grid);
  const edge = document.createElement("div");
  edge.className = "shelf-edge";
  shelfEl.appendChild(edge);

  if(countLabel){
    countLabel.textContent = `${filtered.length} book${filtered.length === 1 ? "" : "s"}${q ? " (filtered)" : ""}`;
  }
}

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

function booksCol(){ return collection(db, "users", userId, "books"); }
function stickersCol(){ return collection(db, "users", userId, "stickers"); }
function bookDoc(id){ return doc(db, "users", userId, "books", id); }
function stickerDoc(id){ return doc(db, "users", userId, "stickers", id); }

async function addBook(payload){
  const id = uid();
  const title = payload.title.trim();

  await setDoc(bookDoc(id), {
    id,
    title,
    link: payload.link?.trim() || "",
    finishedAt: payload.finishedAt || "",
    rating: clamp(Number(payload.rating || 0), 0, 5),
    notes: payload.notes || "",
    status: payload.status || "read",
    fetchedCoverUrl: "",
    createdAt: serverTimestamp(),
    createdAtMs: Date.now(),
    stickerId: null,
    doodle: { strokes: [], w: 900, h: 600, updatedAtMs: null }
  });

  const cover = await fetchCoverByTitle(title);
  if(cover) await updateDoc(bookDoc(id), { fetchedCoverUrl: cover });
}

function refreshThumbFromBook(book){
  if(!drawThumb) return;
  const doodle = book?.doodle;
  const has = doodle && Array.isArray(doodle.strokes) && doodle.strokes.length > 0;
  if(!has){
    drawThumb.style.display = "none";
    drawThumb.removeAttribute("src");
    return;
  }
  const off = document.createElement("canvas");
  off.width = 900; off.height = 600;
  const c = off.getContext("2d");
  c.lineCap = "round"; c.lineJoin = "round";
  doodle.strokes.forEach(s => {
    c.strokeStyle = s.color;
    c.lineWidth = s.width;
    c.beginPath();
    const pts = s.points || [];
    if(pts.length === 0) return;
    c.moveTo(pts[0].x, pts[0].y);
    for(let i=1;i<pts.length;i++) c.lineTo(pts[i].x, pts[i].y);
    c.stroke();
  });
  drawThumb.src = off.toDataURL("image/png");
  drawThumb.style.display = "block";
}

function openModal(id){
  const book = state.books.find(b => b.id === id);
  if(!book || !notesDialog) return;
  currentModalId = id;
  modalTitle.textContent = book.title;

  const parts = [];
  if(book.status) parts.push(`Status: ${book.status}`);
  if(book.finishedAt) parts.push(`Finished: ${book.finishedAt}`);
  if(book.link) parts.push(`Link: ${book.link}`);
  modalMeta.textContent = parts.join(" • ") || "No date/link saved yet.";

  modalNotes.value = book.notes || "";
  modalStatus.value = book.status || "read";

  makeStars(modalRating, book.rating || 0, async (v) => {
    await updateDoc(bookDoc(currentModalId), { rating: v });
  });

  renderStickerTrays();
  refreshThumbFromBook(book);

  notesDialog.showModal();
}

async function saveModalNotes(){
  if(!currentModalId) return;
  await updateDoc(bookDoc(currentModalId), {
    notes: modalNotes.value || "",
    status: modalStatus.value || "read"
  });
  currentModalId = null;
  if(notesDialog.open) notesDialog.close();
}

async function deleteCurrent(){
  if(!currentModalId) return;
  await deleteDoc(bookDoc(currentModalId));
  currentModalId = null;
  if(notesDialog.open) notesDialog.close();
}

function exportJSON(){
  const data = JSON.stringify({ version: 31, books: state.books, stickers: state.stickers }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "anike-bookshelf-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function importJSONToCloud(file){
  const parsed = JSON.parse(await file.text());
  if(!parsed || !Array.isArray(parsed.books)) throw new Error("Invalid export format");

  const batch = writeBatch(db);

  if(Array.isArray(parsed.stickers)){
    for(const s of parsed.stickers){
      if(s?.dataUrl){
        const id = uid();
        batch.set(stickerDoc(id), { id, dataUrl: s.dataUrl, createdAt: serverTimestamp(), createdAtMs: Date.now() });
      }
    }
  }

  for(const b of parsed.books){
    const id = uid();
    batch.set(bookDoc(id), {
      id,
      title: b.title || "Untitled",
      link: b.link || "",
      finishedAt: b.finishedAt || "",
      rating: clamp(Number(b.rating || 0), 0, 5),
      notes: b.notes || "",
      status: b.status || "read",
      fetchedCoverUrl: b.fetchedCoverUrl || "",
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      stickerId: null,
      doodle: (b.doodle && Array.isArray(b.doodle.strokes)) ? b.doodle : { strokes: [], w: 900, h: 600, updatedAtMs: null }
    });
  }

  await batch.commit();
}

function renderStickerTrays(){
  const trays = [stickerTray, modalStickerTray].filter(Boolean);
  trays.forEach(tray => {
    tray.innerHTML = "";
    if(state.stickers.length === 0){
      const p = document.createElement("div");
      p.className = "hint";
      p.textContent = "No stickers yet — upload one!";
      tray.appendChild(p);
      return;
    }
    state.stickers.forEach(s => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "sticker-item";
      const img = document.createElement("img");
      img.alt = "Sticker";
      img.src = s.dataUrl;
      item.appendChild(img);

      if(tray === modalStickerTray){
        item.addEventListener("click", async () => {
          if(!currentModalId) return;
          await updateDoc(bookDoc(currentModalId), { stickerId: s.id });
        });
      }
      tray.appendChild(item);
    });
  });
}

function fileToDataUrlResized(file, maxW, maxH, quality){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
        resolve(c.toDataURL(mime, quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadStickerToFirestore(file){
  const dataUrl = await fileToDataUrlResized(file, 128, 128, 0.9);
  const id = uid();
  await setDoc(stickerDoc(id), { id, dataUrl, createdAt: serverTimestamp(), createdAtMs: Date.now() });
}

async function removeStickerFromBook(){
  if(!currentModalId) return;
  await updateDoc(bookDoc(currentModalId), { stickerId: null });
}

/* Handwriting (vector strokes) */
let canvasCtx = null;
let drawing = false;
let currentStroke = null;
const sessionStrokes = [];

function ensureCanvas(){
  if(!drawCanvas) return;
  canvasCtx = drawCanvas.getContext("2d");
  canvasCtx.lineCap = "round";
  canvasCtx.lineJoin = "round";
}
function clearCanvas(){
  if(!canvasCtx) return;
  canvasCtx.clearRect(0,0,drawCanvas.width, drawCanvas.height);
}
function posFromEvent(e){
  const rect = drawCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (drawCanvas.width / rect.width),
    y: (e.clientY - rect.top) * (drawCanvas.height / rect.height)
  };
}
function strokeStyle(){
  return { color: penColor?.value || "#111111", width: Number(penSize?.value || 6) };
}
function drawStroke(ctx, stroke){
  if(!stroke?.points?.length) return;
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.beginPath();
  ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
  for(let i=1;i<stroke.points.length;i++){
    const p = stroke.points[i];
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}
function loadBookDoodleToCanvas(book){
  clearCanvas();
  const strokes = book?.doodle?.strokes || [];
  strokes.forEach(s => drawStroke(canvasCtx, s));
}

function pruneStrokes(strokes, maxPoints){
  let total = 0;
  for(let i=strokes.length-1;i>=0;i--){
    total += strokes[i].points?.length || 0;
    if(total > maxPoints) return strokes.slice(i+1);
  }
  return strokes;
}

function setupCanvasEvents(){
  if(!drawCanvas) return;

  drawCanvas.addEventListener("pointerdown", (e) => {
    drawCanvas.setPointerCapture(e.pointerId);
    drawing = true;
    const sty = strokeStyle();
    currentStroke = { color: sty.color, width: sty.width, points: [posFromEvent(e)] };
  });

  drawCanvas.addEventListener("pointermove", (e) => {
    if(!drawing || !currentStroke) return;
    const pt = posFromEvent(e);
    currentStroke.points.push(pt);

    const pts = currentStroke.points;
    if(pts.length < 2) return;
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];

    canvasCtx.strokeStyle = currentStroke.color;
    canvasCtx.lineWidth = currentStroke.width;
    canvasCtx.beginPath();
    canvasCtx.moveTo(a.x, a.y);
    canvasCtx.lineTo(b.x, b.y);
    canvasCtx.stroke();
  });

  function end(){
    drawing = false;
    if(currentStroke && currentStroke.points.length > 1){
      sessionStrokes.push(currentStroke);
    }
    currentStroke = null;
  }
  drawCanvas.addEventListener("pointerup", end);
  drawCanvas.addEventListener("pointercancel", end);

  wipeDrawBtn?.addEventListener("click", clearCanvas);

  openDrawBtn?.addEventListener("click", () => {
    const book = state.books.find(b => b.id === currentModalId);
    drawDialog?.showModal();
    ensureCanvas();
    clearCanvas();
    if(book) loadBookDoodleToCanvas(book);
    sessionStrokes.length = 0;
  });

  clearDrawBtn?.addEventListener("click", async () => {
    if(!currentModalId) return;
    if(!confirm("Clear this book's handwriting?")) return;
    await updateDoc(bookDoc(currentModalId), { doodle: { strokes: [], w: 900, h: 600, updatedAtMs: Date.now() } });
  });

  saveDrawBtn?.addEventListener("click", async () => {
    if(!currentModalId) return;
    const book = state.books.find(b => b.id === currentModalId);
    const existing = (book?.doodle?.strokes && Array.isArray(book.doodle.strokes)) ? book.doodle.strokes : [];
    const merged = existing.concat(sessionStrokes);
    const pruned = pruneStrokes(merged, 12000);
    await updateDoc(bookDoc(currentModalId), { doodle: { strokes: pruned, w: 900, h: 600, updatedAtMs: Date.now() } });
    sessionStrokes.length = 0;
    if(drawDialog?.open) drawDialog.close();
  });
}

/* Filters + defaults */
function bindChips(){
  qsa(".chip").forEach(btn => {
    btn.addEventListener("click", () => {
      qsa(".chip").forEach(b => b.classList.remove("on"));
      btn.classList.add("on");
      currentFilter = btn.dataset.filter || "all";
      render();
    });
  });
}

function setDefaultDate(){
  if(!dateInput) return;
  const t = new Date();
  dateInput.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
}

/* Subscriptions */
function subscribe(){
  unsubBooks?.();
  unsubStickers?.();

  unsubBooks = onSnapshot(query(booksCol(), orderBy("createdAtMs","desc")), (snap) => {
    state.books = snap.docs.map(d => d.data());
    render();
    if(currentModalId){
      const b = state.books.find(x => x.id === currentModalId);
      if(b) refreshThumbFromBook(b);
    }
  });

  unsubStickers = onSnapshot(query(stickersCol(), orderBy("createdAtMs","desc")), (snap) => {
    state.stickers = snap.docs.map(d => d.data());
    renderStickerTrays();
    render();
  });
}

/* UI */
searchInput?.addEventListener("input", render);

if(form){
  let formRating = 5;
  makeStars(ratingPicker, formRating, (v) => { formRating=v; makeStars(ratingPicker, formRating, ()=>{}); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await addBook({
      title: titleInput.value,
      link: linkInput.value,
      finishedAt: dateInput.value,
      rating: formRating,
      notes: notesInput.value,
      status: statusInput?.value || "read"
    });
    form.reset();
    setDefaultDate();
    if(statusInput) statusInput.value="read";
    formRating=5;
    makeStars(ratingPicker, formRating, (v)=>{ formRating=v; makeStars(ratingPicker, v, ()=>{}); });
  });

  demoBtn?.addEventListener("click", async () => {
    const demos = [
      { title: "Atomic Habits", link:"https://jamesclear.com/atomic-habits", finishedAt:"2025-12-20", rating:5, notes:"habits, identity, systems, consistency, discipline", status:"read" },
      { title: "Deep Work", link:"https://www.calnewport.com/books/deep-work/", finishedAt:"2025-11-28", rating:4, notes:"focus, productivity, leadership, time-blocking", status:"read" }
    ];
    for(const d of demos) await addBook(d);
  });

  exportBtn?.addEventListener("click", exportJSON);

  importInput?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if(!file) return;
    try{
      if(!confirm("Import will ADD books into your synced shelf. Continue?")) return;
      await importJSONToCloud(file);
      alert("Import complete ✅");
    }catch(err){
      alert("Import failed: " + (err?.message || err));
    }finally{
      importInput.value = "";
    }
  });

  stickerUpload?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if(file){
      try{ await uploadStickerToFirestore(file); }
      catch(err){ alert("Sticker upload failed: " + (err?.message || err)); }
    }
    stickerUpload.value = "";
  });
}

saveNotesBtn?.addEventListener("click", saveModalNotes);
deleteBtn?.addEventListener("click", deleteCurrent);
removeStickerBtn?.addEventListener("click", removeStickerFromBook);

/* Auth */
signInBtn?.addEventListener("click", async () => {
  showError("");
  try{ await signInWithEmailAndPassword(auth, authEmail.value.trim(), authPassword.value); }
  catch(e){ showError(e?.message || "Sign in failed"); }
});
signUpBtn?.addEventListener("click", async () => {
  showError("");
  try{ await createUserWithEmailAndPassword(auth, authEmail.value.trim(), authPassword.value); }
  catch(e){ showError(e?.message || "Sign up failed"); }
});
logoutBtn?.addEventListener("click", async () => { await signOut(auth); });

bindChips();
setDefaultDate();
ensureCanvas();
setupCanvasEvents();

/* Auth state */
onAuthStateChanged(auth, (user) => {
  if(user){
    userId = user.uid;
    showAuth(false);
    subscribe();
  }else{
    userId = null;
    state.books = [];
    state.stickers = [];
    render();
    renderStickerTrays();
    showAuth(true);
  }
});
