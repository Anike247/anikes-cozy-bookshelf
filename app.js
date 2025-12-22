// Anike's Cozy Reading Shelf — v2 (LocalStorage, iPad-friendly)
const STORAGE_KEY = "anike_bookshelf_v2";

const qs = (sel) => document.querySelector(sel);
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
const clearBtn = el("clearBtn");
const demoBtn = el("demoBtn");

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
const clearStickersBtn = el("clearStickersBtn");
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

let state = { version: 2, books: [], stickers: [] };
let currentModalId = null;

function uid(){ return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16); }
function clamp(n,a,b){ return Math.max(a, Math.min(b, n)); }
function normalize(s){ return (s||"").toString().trim().toLowerCase(); }

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      if(parsed && Array.isArray(parsed.books)) state = { ...state, ...parsed };
    }else{
      const v1 = localStorage.getItem("niks_bookshelf_v1");
      if(v1){
        const parsed = JSON.parse(v1);
        if(parsed && Array.isArray(parsed.books)){
          state.books = parsed.books.map(b => ({...b, status: b.status||"read", stickerId:null, doodle:null, fetchedCoverUrl:b.fetchedCoverUrl||""}));
          save();
        }
      }
    }
  }catch(e){ console.warn("Load failed", e); }
}
function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

function makeStars(container, value, onChange){
  if(!container) return;
  container.innerHTML = "";
  const v = clamp(Number(value||0),0,5);
  for(let i=1;i<=5;i++){
    const btn = document.createElement("button");
    btn.type="button";
    btn.className = "star-btn" + (i<=v ? " on":"");
    btn.textContent = "★";
    btn.setAttribute("aria-label", `${i} star${i===1?"":"s"}`);
    btn.addEventListener("click", () => onChange(i));
    container.appendChild(btn);
  }
}
function fallbackNode(title){
  const d=document.createElement("div");
  d.className="fallback";
  d.textContent=title;
  return d;
}
function getStickerDataUrl(stickerId){
  if(!stickerId) return null;
  const s = state.stickers.find(x=>x.id===stickerId);
  return s?.dataUrl || null;
}
function bookCoverNode(book){
  const src = book.coverUrl || book.fetchedCoverUrl || "";
  if(src){
    const img=document.createElement("img");
    img.alt=book.title;
    img.loading="lazy";
    img.src=src;
    img.addEventListener("error", () => img.replaceWith(fallbackNode(book.title)));
    return img;
  }
  return fallbackNode(book.title);
}
function bookMatchesQuery(book,q){
  if(!q) return true;
  const hay=[book.title, book.notes, book.status, book.finishedAt, book.link].map(normalize).join(" ");
  return hay.includes(q);
}
function currentFilter(){
  const on=qs(".chip.on");
  return on?.dataset?.filter || "all";
}

function render(){
  if(!shelfEl) return;
  const q = normalize(searchInput?.value || "");
  const filter = currentFilter();
  const books = state.books.slice().sort((a,b)=> (b.finishedAt||"").localeCompare(a.finishedAt||"") || (b.createdAt||0)-(a.createdAt||0));
  const filtered = books.filter(b => ((filter==="all") ? true : (b.status||"read")===filter) && bookMatchesQuery(b,q));

  shelfEl.innerHTML="";
  const grid=document.createElement("div");
  grid.className="books";

  filtered.forEach(book=>{
    const wrap=document.createElement("div");
    wrap.className="book-wrap";

    const card=document.createElement("div");
    card.className="book";
    card.title="Click to view/edit";
    card.appendChild(bookCoverNode(book));

    const badge=document.createElement("div");
    badge.className="badge";
    badge.innerHTML=`<span class="tiny-star">★</span><span>${book.rating||0}</span>`;
    card.appendChild(badge);

    const stickerUrl = getStickerDataUrl(book.stickerId);
    if(stickerUrl){
      const st=document.createElement("img");
      st.className="sticker";
      st.alt="Sticker";
      st.src=stickerUrl;
      card.appendChild(st);
    }

    card.addEventListener("click", ()=>openModal(book.id));

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
    countLabel.textContent = `${filtered.length} book${filtered.length===1?"":"s"}${q?" (filtered)":""}`;
  }
}

async function fetchCoverByTitle(title){
  const q = encodeURIComponent(title);
  const url = `https://openlibrary.org/search.json?title=${q}&limit=1`;
  try{
    const res = await fetch(url);
    if(!res.ok) return "";
    const data = await res.json();
    const doc = data?.docs?.[0];
    const coverI = doc?.cover_i;
    if(coverI) return `https://covers.openlibrary.org/b/id/${coverI}-L.jpg`;
    const isbn = doc?.isbn?.[0];
    if(isbn) return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`;
    return "";
  }catch(e){ return ""; }
}

async function addBook(payload){
  const title = payload.title.trim();
  const book = {
    id: uid(),
    title,
    link: payload.link?.trim() || "",
    finishedAt: payload.finishedAt || "",
    rating: clamp(Number(payload.rating||0),0,5),
    notes: payload.notes || "",
    status: payload.status || "read",
    createdAt: Date.now(),
    fetchedCoverUrl: "",
    stickerId: null,
    doodle: null
  };
  state.books.push(book);
  save();
  render();

  const cover = await fetchCoverByTitle(title);
  if(cover){
    const b = state.books.find(x=>x.id===book.id);
    if(b){
      b.fetchedCoverUrl = cover;
      save();
      render();
    }
  }
}

function renderStickerTrays(){
  const trays = [stickerTray, modalStickerTray].filter(Boolean);
  trays.forEach(tray=>{
    tray.innerHTML="";
    if(state.stickers.length===0){
      const p=document.createElement("div");
      p.className="hint";
      p.textContent="No stickers yet — upload one!";
      tray.appendChild(p);
      return;
    }
    state.stickers.forEach(s=>{
      const item=document.createElement("button");
      item.type="button";
      item.className="sticker-item";
      const img=document.createElement("img");
      img.alt="Sticker";
      img.src=s.dataUrl;
      item.appendChild(img);

      if(tray===modalStickerTray){
        item.addEventListener("click", ()=>{
          if(!currentModalId) return;
          const book=state.books.find(b=>b.id===currentModalId);
          if(!book) return;
          book.stickerId=s.id;
          save();
          render();
          renderStickerTrays();
        });
      }
      tray.appendChild(item);
    });
  });
}

function uploadSticker(file){
  const reader=new FileReader();
  reader.onload=()=>{
    state.stickers.push({id:uid(), dataUrl:reader.result});
    save();
    renderStickerTrays();
    render();
  };
  reader.readAsDataURL(file);
}
function clearStickers(){
  if(!confirm("Clear all stickers? (Books will lose their sticker.)")) return;
  state.stickers=[];
  state.books.forEach(b=>b.stickerId=null);
  save(); renderStickerTrays(); render();
}
function removeStickerFromBook(){
  if(!currentModalId) return;
  const book=state.books.find(b=>b.id===currentModalId);
  if(!book) return;
  book.stickerId=null;
  save(); render(); renderStickerTrays();
}

function openModal(id){
  const book=state.books.find(b=>b.id===id);
  if(!book || !notesDialog) return;
  currentModalId=id;
  modalTitle.textContent=book.title;

  const parts=[];
  if(book.status) parts.push(`Status: ${book.status}`);
  if(book.finishedAt) parts.push(`Finished: ${book.finishedAt}`);
  if(book.link) parts.push(`Link: ${book.link}`);
  modalMeta.textContent = parts.join(" • ") || "No date/link saved yet.";

  if(modalNotes) modalNotes.value = book.notes || "";
  if(modalStatus) modalStatus.value = book.status || "read";

  makeStars(modalRating, book.rating||0, (v)=>{
    const b=state.books.find(x=>x.id===currentModalId);
    if(!b) return;
    b.rating=v; save();
    makeStars(modalRating, v, ()=>{});
    render();
  });

  if(drawThumb){
    if(book.doodle){
      drawThumb.src=book.doodle;
      drawThumb.style.display="block";
    }else{
      drawThumb.removeAttribute("src");
      drawThumb.style.display="none";
    }
  }

  renderStickerTrays();

  if(book.link){
    modalMeta.style.cursor="pointer";
    modalMeta.title="Click to open link";
    modalMeta.onclick=()=>window.open(book.link, "_blank", "noopener,noreferrer");
  }else{
    modalMeta.style.cursor="default";
    modalMeta.title="";
    modalMeta.onclick=null;
  }

  notesDialog.showModal();
}
function closeModal(){ currentModalId=null; if(notesDialog?.open) notesDialog.close(); }
function deleteCurrent(){
  if(!currentModalId) return;
  state.books = state.books.filter(b=>b.id!==currentModalId);
  save(); render(); closeModal();
}
function saveModalNotes(){
  if(!currentModalId) return;
  const book=state.books.find(b=>b.id===currentModalId);
  if(!book) return;
  book.notes = modalNotes?.value || "";
  book.status = modalStatus?.value || book.status || "read";
  save(); render(); closeModal();
}
function exportJSON(){
  const data = JSON.stringify(state, null, 2);
  const blob=new Blob([data], {type:"application/json"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download="anike-bookshelf-export.json";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function importJSON(file){
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const parsed=JSON.parse(reader.result);
      if(!parsed || !Array.isArray(parsed.books)) throw new Error("Invalid format");

      if(Array.isArray(parsed.stickers)){
        const stickerIds=new Set(state.stickers.map(s=>s.id));
        parsed.stickers.forEach(s=>{
          if(s?.dataUrl){
            const id = stickerIds.has(s.id) ? uid() : (s.id||uid());
            state.stickers.push({id, dataUrl:s.dataUrl});
          }
        });
      }

      const existingIds=new Set(state.books.map(b=>b.id));
      const incoming = parsed.books.map(b=>({
        ...b,
        id: existingIds.has(b.id) ? uid() : (b.id||uid()),
        createdAt: b.createdAt || Date.now(),
        status: b.status || "read",
        fetchedCoverUrl: b.fetchedCoverUrl || "",
        stickerId: b.stickerId || null,
        doodle: b.doodle || null
      }));
      state.books=[...state.books, ...incoming];
      save(); render(); renderStickerTrays();
    }catch(e){ alert("Could not import: " + e.message); }
  };
  reader.readAsText(file);
}
function clearAll(){
  if(!confirm("Clear all saved books (and stickers) from this device/browser?")) return;
  localStorage.removeItem(STORAGE_KEY);
  state={version:2, books:[], stickers:[]};
  render(); renderStickerTrays();
}
function setDefaultDate(){
  if(!dateInput) return;
  const t=new Date();
  dateInput.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
}
function bindChips(){
  qsa(".chip").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      qsa(".chip").forEach(b=>b.classList.remove("on"));
      btn.classList.add("on");
      render();
    });
  });
}

// Handwriting
function setupCanvas(){
  if(!drawCanvas) return;
  const ctx = drawCanvas.getContext("2d");
  ctx.lineCap="round"; ctx.lineJoin="round";
  let drawing=false;

  function pos(e){
    const r=drawCanvas.getBoundingClientRect();
    return {
      x:(e.clientX-r.left)*(drawCanvas.width/r.width),
      y:(e.clientY-r.top)*(drawCanvas.height/r.height),
    };
  }
  function start(e){
    drawing=true;
    const p=pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x,p.y);
  }
  function move(e){
    if(!drawing) return;
    const p=pos(e);
    ctx.strokeStyle=penColor?.value || "#111111";
    ctx.lineWidth=Number(penSize?.value || 6);
    ctx.lineTo(p.x,p.y);
    ctx.stroke();
  }
  function end(){ drawing=false; }

  drawCanvas.addEventListener("pointerdown", (e)=>{ drawCanvas.setPointerCapture(e.pointerId); start(e); });
  drawCanvas.addEventListener("pointermove", move);
  drawCanvas.addEventListener("pointerup", end);
  drawCanvas.addEventListener("pointercancel", end);

  function wipe(){ ctx.clearRect(0,0,drawCanvas.width, drawCanvas.height); }

  function loadExisting(){
    if(!currentModalId) return;
    const book=state.books.find(b=>b.id===currentModalId);
    if(!book) return;
    wipe();
    if(book.doodle){
      const img=new Image();
      img.onload=()=>ctx.drawImage(img,0,0,drawCanvas.width, drawCanvas.height);
      img.src=book.doodle;
    }
  }

  openDrawBtn?.addEventListener("click", ()=>{
    if(!drawDialog) return;
    drawDialog.showModal();
    setTimeout(loadExisting, 0);
  });

  wipeDrawBtn?.addEventListener("click", wipe);

  saveDrawBtn?.addEventListener("click", ()=>{
    if(!currentModalId) return;
    const book=state.books.find(b=>b.id===currentModalId);
    if(!book) return;
    const dataUrl=drawCanvas.toDataURL("image/png");
    book.doodle=dataUrl;
    save();
    if(drawThumb){
      drawThumb.src=dataUrl;
      drawThumb.style.display="block";
    }
    if(drawDialog?.open) drawDialog.close();
  });

  clearDrawBtn?.addEventListener("click", ()=>{
    if(!confirm("Clear this book's handwriting?")) return;
    wipe();
    if(currentModalId){
      const book=state.books.find(b=>b.id===currentModalId);
      if(book){
        book.doodle=null; save();
        if(drawThumb){
          drawThumb.removeAttribute("src");
          drawThumb.style.display="none";
        }
      }
    }
  });
}

// Boot
load();
bindChips();
setupCanvas();

if(searchInput) searchInput.addEventListener("input", render);

if(form){
  let formRating=5;
  makeStars(ratingPicker, formRating, (v)=>{ formRating=v; makeStars(ratingPicker, formRating, ()=>{}); });

  form.addEventListener("submit", async (e)=>{
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

  demoBtn?.addEventListener("click", async ()=>{
    const demos=[
      {title:"Atomic Habits", link:"https://jamesclear.com/atomic-habits", finishedAt:"2025-12-20", rating:5, notes:"habits, identity, systems, consistency, discipline", status:"read"},
      {title:"The Psychology of Money", link:"https://www.harriman-house.com/psychologymoney", finishedAt:"2025-12-12", rating:4, notes:"money, behavior, long-term, patience, risk", status:"read"},
      {title:"Deep Work", link:"https://www.calnewport.com/books/deep-work/", finishedAt:"2025-11-28", rating:4, notes:"focus, productivity, leadership, time-blocking", status:"read"},
      {title:"Leaders Eat Last", link:"https://simonsinek.com/", finishedAt:"", rating:0, notes:"leadership, culture, trust, teams", status:"toread"},
    ];
    for(const d of demos){ await addBook(d); }
  });

  exportBtn?.addEventListener("click", exportJSON);
  importInput?.addEventListener("change", (e)=>{ const f=e.target.files?.[0]; if(f) importJSON(f); importInput.value=""; });
  clearBtn?.addEventListener("click", clearAll);

  stickerUpload?.addEventListener("change", (e)=>{ const f=e.target.files?.[0]; if(f) uploadSticker(f); stickerUpload.value=""; });
  clearStickersBtn?.addEventListener("click", clearStickers);
}

saveNotesBtn?.addEventListener("click", saveModalNotes);
deleteBtn?.addEventListener("click", deleteCurrent);
removeStickerBtn?.addEventListener("click", removeStickerFromBook);

setDefaultDate();
render();
renderStickerTrays();
