import { Signal, RTC_CONFIG } from "/signal.js";
import {
  createBoard,
  beginInk,
  addPoint,
  beginShape,
  setShapeEnd,
  addText,
  eraseAt,
  undo,
  redo,
  clearBoard,
  setPaper,
  checkpoint,
  snapshotExcluding,
  renderBoard,
} from "/board-engine.js";
import {
  createDoc,
  applyDocToScene,
  sceneToDoc,
  metaOf,
} from "/board-docs.js";
import {
  shouldIgnoreTouch,
  shouldStartPinch,
  dropTouches,
} from "/board-pointers.js";
import { recognizeStroke } from "/board-recognize.js";
import {
  hitTop,
  rotateHandle,
  itemCenter,
  translateItem,
  localBounds,
  bringToFront,
  sendToBack,
  zoomAt,
  resetView,
  applyPinchView,
} from "/board-transform.js";
import { attachLogPanel, log, getLogs, refreshLogPanel } from "/board-log.js";
import { enqueue } from "/board-jobs.js";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d", { alpha: false });
const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");

const TOOLS = ["select", "pen", "highlighter", "eraser", "line", "rect", "ellipse", "arrow", "text"];
const COLORS = ["#1a1d23", "#e24a3b", "#2f6fed", "#1f9d55", "#f0a202", "#ffffff"];

const scene = createBoard();
const view = { panX: 0, panY: 0, scale: 1, w: 1, h: 1 };
let tool = "pen";
let color = COLORS[0];
let width = 4;
let eraserDiameter = 48;
let eraseMode = "pixel";
let live = false;
let peerPresent = false;
let pc = null;
let outStream = null;
let sharing = false;
let current = null;
let selected = null;
let pointers = new Map();
let pinch = null;
const OPEN_KEY = "obscam.board.openTabs";
let catalog = [];
let trash = [];
let openIds = [];
let active = null;
let dirty = false;
let saveTimer = 0;
let frameDirty = true;
let saving = false;
let textAt = null;

const setStatus = (t, cls = "") => {
  statusEl.textContent = t;
  statusEl.className = "status " + cls;
};

function cssSize() {
  return { w: window.innerWidth, h: window.innerHeight };
}

function resizeCanvas() {
  const { w, h } = cssSize();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.w = w;
  view.h = h;
  paint();
}

function paint() {
  frameDirty = true;
}

function drawIfDirty() {
  if (!frameDirty || sharing) return;
  frameDirty = false;
  const t0 = performance.now();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderBoard(ctx, scene, view);
  drawSelection(ctx);
  const ms = performance.now() - t0;
  if (ms > 24) log("warn", "paint_slow", { ms: Math.round(ms), items: scene.items.length });
}

function screenToWorld(sx, sy) {
  return {
    x: (sx - view.panX) / view.scale,
    y: (sy - view.panY) / view.scale,
  };
}

function pressure(e) {
  if (e.pointerType === "pen" && e.pressure > 0) return e.pressure;
  return 0.55;
}

function startCapture() {
  if (outStream && outStream.getVideoTracks().some((t) => t.readyState === "live"))
    return;
  outStream = canvas.captureStream(30);
  for (const t of outStream.getVideoTracks()) t.contentHint = "detail";
}

async function tuneSender(connection) {
  const s = connection.getSenders().find((x) => x.track && x.track.kind === "video");
  if (!s) return;
  try {
    const p = s.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = 8_000_000;
    p.encodings[0].maxFramerate = 30;
    p.degradationPreference = "maintain-resolution";
    await s.setParameters(p);
  } catch {
    /* older browsers keep the default cap */
  }
}

function buildPeer() {
  if (pc) pc.close();
  pc = new RTCPeerConnection(RTC_CONFIG);
  for (const t of outStream.getVideoTracks()) pc.addTrack(t, outStream);
  tuneSender(pc);
  pc.onicecandidate = (e) => {
    if (e.candidate) sig.send({ type: "ice", candidate: e.candidate });
  };
  pc.onconnectionstatechange = () => {
    const s = pc.connectionState;
    live = s === "connected";
    if (s === "connected") setStatus("Live in OBS ●", "live");
    else if (s === "connecting") setStatus("Connecting…");
    else if (s === "failed" || s === "disconnected")
      setStatus("Reconnecting…", "warn");
    document.body.dataset.live = live ? "1" : "0";
  };
}

async function offer() {
  startCapture();
  paint();
  if (!outStream || !peerPresent) return;
  buildPeer();
  const desc = await pc.createOffer();
  await pc.setLocalDescription(desc);
  sig.send({ type: "offer", sdp: pc.localDescription });
  setStatus("Connecting…");
}

const sig = new Signal("board");
sig.addEventListener("msg", async ({ detail: msg }) => {
  if (msg.type === "peer") {
    peerPresent = !!msg.present;
    if (peerPresent) await offer();
    else {
      live = false;
      setStatus("Waiting for OBS…", "warn");
    }
  } else if (msg.type === "answer" && pc) {
    await pc.setRemoteDescription(msg.sdp);
  } else if (msg.type === "ice" && pc) {
    try {
      await pc.addIceCandidate(msg.candidate);
    } catch {}
  }
});
sig.addEventListener("superseded", () => {
  setStatus("Another tab took over this iPad board", "warn");
});

function bindTap(el, fn) {
  if (!el) return;
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    fn(e);
  });
}

function bindToolbar() {
  for (const name of TOOLS) {
    const btn = document.querySelector(`[data-tool="${name}"]`);
    if (!btn) continue;
    bindTap(btn, () => {
      if (name !== "text") commitTextPad();
      tool = name;
      if (name !== "select") selected = null;
      canvas.style.cursor = name === "select" ? "grab" : "crosshair";
      for (const el of document.querySelectorAll("[data-tool]"))
        el.setAttribute("aria-pressed", String(el.dataset.tool === tool));
      syncEraseUi();
      paint();
    });
  }
  const swatches = document.getElementById("swatches");
  for (const hex of COLORS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.style.background = hex;
    b.title = hex;
    b.setAttribute("aria-pressed", String(hex === color));
    bindTap(b, () => {
      color = hex;
      for (const el of swatches.children)
        el.setAttribute("aria-pressed", String(el === b));
    });
    swatches.appendChild(b);
  }
  const widthEl = document.getElementById("width");
  widthEl.oninput = () => {
    const n = Number(widthEl.value);
    if (tool === "eraser") {
      eraserDiameter = n;
      const cur = document.getElementById("eraseCursor");
      if (cur && !cur.hidden) {
        cur.style.width = n + "px";
        cur.style.height = n + "px";
      }
    } else width = n;
  };
  const modeEl = document.getElementById("eraseMode");
  if (modeEl) modeEl.hidden = true;
  bindTap(document.getElementById("undoBtn"), () => runUndo("tap"));
  bindTap(document.getElementById("redoBtn"), () => runRedo("tap"));
  bindTap(document.getElementById("clearBtn"), () => {
    log("info", "clear_tap", { items: scene.items.length });
    clearBoard(scene);
    afterEdit();
  });
  const logBtn = document.getElementById("logBtn");
  const logPanel = document.getElementById("boardLog");
  if (logBtn && logPanel) {
    attachLogPanel(logPanel);
    bindTap(logBtn, () => {
      logPanel.hidden = !logPanel.hidden;
      logBtn.setAttribute("aria-pressed", String(!logPanel.hidden));
      if (!logPanel.hidden) refreshLogPanel();
    });
  }
  document.getElementById("paper").onchange = (e) => {
    setPaper(scene, e.target.value);
    afterEdit();
  };
  bindTap(document.getElementById("refreshBtn"), () => location.reload());
  bindTap(document.getElementById("layerUpBtn"), () => {
    if (!selected) return;
    const i = scene.items.indexOf(selected);
    if (i < 0 || i === scene.items.length - 1) return;
    checkpoint(scene);
    bringToFront(scene.items, selected);
    afterEdit();
  });
  bindTap(document.getElementById("layerDownBtn"), () => {
    if (!selected) return;
    const i = scene.items.indexOf(selected);
    if (i <= 0) return;
    checkpoint(scene);
    sendToBack(scene.items, selected);
    afterEdit();
  });
  bindTap(document.getElementById("zoomOutBtn"), () => {
    zoomAt(view, 1 / 1.25, view.w / 2, view.h / 2);
    paint();
  });
  bindTap(document.getElementById("zoomInBtn"), () => {
    zoomAt(view, 1.25, view.w / 2, view.h / 2);
    paint();
  });
  bindTap(document.getElementById("zoomResetBtn"), () => {
    resetView(view);
    paint();
  });
  bindTap(document.getElementById("libBtn"), () => {
    const el = document.getElementById("library");
    el.hidden = !el.hidden;
    if (!el.hidden) {
      loadTrash().then(() => renderLibrary());
    }
  });
  bindTap(document.getElementById("libClose"), () => {
    document.getElementById("library").hidden = true;
  });
  bindTap(document.getElementById("libNew"), () => newTab());
  bindTap(document.getElementById("tabNew"), () => newTab());
  if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    shareBtn.hidden = false;
    bindTap(shareBtn, () => toggleShare());
  }
  const dock = document.querySelector(".board-draw-dock");
  if (dock) dock.addEventListener("pointerdown", (e) => e.stopPropagation());
  bindTextPad();
  syncEraseUi();
}

function bindTextPad() {
  const pad = document.getElementById("textPad");
  const input = document.getElementById("textInput");
  if (!pad || !input) return;
  pad.addEventListener("pointerdown", (e) => e.stopPropagation());
  pad.addEventListener("submit", (e) => {
    e.preventDefault();
    commitTextPad();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeTextPad();
    }
  });
}

function openTextPad(screen, world) {
  const pad = document.getElementById("textPad");
  const input = document.getElementById("textInput");
  if (!pad || !input) return;
  commitTextPad();
  textAt = world;
  pad.hidden = false;
  pad.style.left = screen.x + "px";
  pad.style.top = screen.y + "px";
  input.value = "";
  input.focus();
}

function closeTextPad() {
  const pad = document.getElementById("textPad");
  const input = document.getElementById("textInput");
  if (pad) pad.hidden = true;
  if (input) input.blur();
  textAt = null;
}

function commitTextPad() {
  const pad = document.getElementById("textPad");
  const input = document.getElementById("textInput");
  if (!pad || pad.hidden || !textAt) return;
  const text = input ? input.value : "";
  const at = textAt;
  closeTextPad();
  if (!String(text).trim()) return;
  selected = addText(scene, color, Math.max(18, width * 6), at.x, at.y, text);
  paint();
  enqueue(() => scheduleSave());
}

function syncEraseUi() {
  const erasing = tool === "eraser";
  const modeEl = document.getElementById("eraseMode");
  if (modeEl) modeEl.hidden = true;
  const widthEl = document.getElementById("width");
  if (erasing) {
    widthEl.min = "12";
    widthEl.max = "180";
    widthEl.value = String(eraserDiameter);
    const noun = document.getElementById("widthNoun");
    if (noun) noun.textContent = "Eraser";
    canvas.style.cursor = "none";
  } else {
    widthEl.min = "2";
    widthEl.max = "18";
    widthEl.value = String(width);
    const noun = document.getElementById("widthNoun");
    if (noun) noun.textContent = "Size";
    canvas.style.cursor = tool === "select" ? "grab" : "crosshair";
    hideEraseCursor();
  }
}

function eraserRadiusWorld() {
  return eraserDiameter / 2 / view.scale;
}

function showEraseCursor(clientX, clientY) {
  const el = document.getElementById("eraseCursor");
  if (!el || tool !== "eraser") return;
  el.hidden = false;
  el.style.width = eraserDiameter + "px";
  el.style.height = eraserDiameter + "px";
  el.style.left = clientX + "px";
  el.style.top = clientY + "px";
}

function hideEraseCursor() {
  const el = document.getElementById("eraseCursor");
  if (el) el.hidden = true;
}

function afterEdit() {
  paint();
  scheduleSave();
}

function runUndo(from) {
  const t0 = performance.now();
  log("info", "undo", {
    from,
    history: scene.history.length,
    items: scene.items.length,
  });
  try {
    const ok = undo(scene);
    log("info", "undo_done", {
      ok,
      ms: Math.round(performance.now() - t0),
      items: scene.items.length,
    });
    afterEdit();
    return ok;
  } catch (err) {
    log("error", "undo_throw", { message: String(err && err.message ? err.message : err) });
    return false;
  }
}

function runRedo(from) {
  const t0 = performance.now();
  try {
    const ok = redo(scene);
    log("info", "redo_done", {
      from,
      ok,
      ms: Math.round(performance.now() - t0),
    });
    afterEdit();
  } catch (err) {
    log("error", "redo_throw", { message: String(err && err.message ? err.message : err) });
  }
}

function persistOpen() {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(openIds));
  } catch {}
}

function scheduleSave() {
  if (!active) return;
  dirty = true;
  renderTabs();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushSave().catch(() => {});
  }, 600);
}

async function flushSave() {
  if (!active || !dirty || saving) return active;
  saving = true;
  const t0 = performance.now();
  try {
    const doc = sceneToDoc(active, scene);
    const packed = JSON.stringify(doc);
    log("info", "save_start", {
      bytes: packed.length,
      items: scene.items.length,
      packMs: Math.round(performance.now() - t0),
    });
    const r = await fetch("/drawings/" + encodeURIComponent(doc.id), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: packed,
    });
    if (!r.ok) throw new Error("save failed");
    const { drawing } = await r.json();
    active = drawing;
    dirty = false;
    upsertCatalog(metaOf(drawing));
    renderTabs();
    const lib = document.getElementById("library");
    if (lib && !lib.hidden) renderLibrary();
    log("info", "save_done", { ms: Math.round(performance.now() - t0) });
    return drawing;
  } catch (err) {
    log("error", "save_fail", { message: String(err && err.message ? err.message : err) });
    throw err;
  } finally {
    saving = false;
    if (dirty) scheduleSave();
  }
}

function upsertCatalog(meta) {
  const i = catalog.findIndex((d) => d.id === meta.id);
  if (i >= 0) catalog[i] = meta;
  else catalog.unshift(meta);
  catalog.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function switchTo(id, { skipSave } = {}) {
  if (!id) return;
  if (!skipSave && active && active.id !== id) await flushSave().catch(() => {});
  const r = await fetch("/drawings/" + encodeURIComponent(id));
  if (!r.ok) return;
  const { drawing } = await r.json();
  active = drawing;
  dirty = false;
  applyDocToScene(drawing, scene);
  selected = null;
  const paperEl = document.getElementById("paper");
  if (paperEl) paperEl.value = scene.paper;
  if (!openIds.includes(id)) openIds.push(id);
  persistOpen();
  paint();
  renderTabs();
}

async function newTab() {
  try {
    await flushSave().catch(() => {});
    const doc = await putDrawing(
      createDoc({ title: "Drawing " + (catalog.length + 1) }),
    );
    upsertCatalog(metaOf(doc));
    if (!openIds.includes(doc.id)) openIds.push(doc.id);
    persistOpen();
    await switchTo(doc.id, { skipSave: true });
    const lib = document.getElementById("library");
    if (lib) lib.hidden = true;
    log("info", "new_drawing", { id: doc.id });
  } catch (err) {
    log("error", "new_drawing_fail", {
      message: String(err && err.message ? err.message : err),
    });
    setStatus("Could not create drawing", "warn");
  }
}

async function putDrawing(doc) {
  const r = await fetch("/drawings/" + encodeURIComponent(doc.id), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(doc),
  });
  if (!r.ok) throw new Error("save failed");
  const { drawing } = await r.json();
  return drawing;
}

async function closeTab(id) {
  if (active && active.id === id) await flushSave().catch(() => {});
  openIds = openIds.filter((x) => x !== id);
  if (!openIds.length) {
    await newTab();
    return;
  }
  persistOpen();
  if (active && active.id === id) await switchTo(openIds[0], { skipSave: true });
  else renderTabs();
}

function renderTabs() {
  const root = document.getElementById("tabs");
  if (!root) return;
  root.replaceChildren();
  for (const id of openIds) {
    const meta = catalog.find((d) => d.id === id);
    const title = meta?.title || active?.title || "Untitled";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tab" + (dirty && active && active.id === id ? " dirty" : "");
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(!!(active && active.id === id)));
    btn.dataset.id = id;
    const name = document.createElement("span");
    name.className = "tab-title";
    name.textContent = title;
    const x = document.createElement("span");
    x.className = "tab-x";
    x.textContent = "×";
    x.title = "Close tab";
    x.onclick = (e) => {
      e.stopPropagation();
      closeTab(id);
    };
    btn.onclick = () => {
      if (active && active.id === id) return;
      switchTo(id);
    };
    btn.append(name, x);
    root.appendChild(btn);
  }
}

function renderLibrary() {
  const ul = document.getElementById("libList");
  if (!ul) return;
  ul.replaceChildren();
  for (const meta of catalog) {
    const li = document.createElement("li");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "lib-open";
    open.textContent = meta.title;
    open.onclick = () => {
      switchTo(meta.id);
      document.getElementById("library").hidden = true;
    };
    const date = document.createElement("span");
    date.className = "lib-date";
    date.textContent = new Date(meta.updatedAt).toLocaleString();
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "lib-rename";
    rename.textContent = "Rename";
    rename.onclick = () => {
      const input = document.createElement("input");
      input.type = "text";
      input.value = meta.title || "Untitled";
      input.setAttribute("aria-label", "Rename drawing");
      open.replaceWith(input);
      input.focus();
      input.select();
      const done = () => {
        input.onblur = null;
        applyRename(meta.id, input.value);
      };
      input.onblur = done;
      input.onkeydown = (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          input.blur();
        }
      };
    };
    const del = document.createElement("button");
    del.type = "button";
    del.className = "lib-del";
    del.textContent = "Delete";
    del.onclick = () => deleteDoc(meta.id);
    li.append(open, date, rename, del);
    ul.appendChild(li);
  }
  const trashUl = document.getElementById("trashList");
  if (!trashUl) return;
  trashUl.replaceChildren();
  if (!trash.length) {
    const empty = document.createElement("li");
    empty.className = "lib-date";
    empty.textContent = "Empty";
    trashUl.appendChild(empty);
    return;
  }
  for (const meta of trash) {
    const li = document.createElement("li");
    const open = document.createElement("span");
    open.className = "lib-open";
    open.textContent = meta.title;
    const rest = document.createElement("button");
    rest.type = "button";
    rest.className = "lib-rename";
    rest.textContent = "Restore";
    rest.onclick = () => restoreDoc(meta.id);
    const gone = document.createElement("button");
    gone.type = "button";
    gone.className = "lib-del";
    gone.textContent = "Delete forever";
    gone.onclick = () => purgeDoc(meta.id);
    li.append(open, rest, gone);
    trashUl.appendChild(li);
  }
}

async function loadTrash() {
  try {
    const r = await fetch("/drawings?trash=1");
    const j = await r.json();
    trash = Array.isArray(j.drawings) ? j.drawings : [];
  } catch {
    trash = [];
  }
}

async function applyRename(id, title) {
  const name = String(title || "").trim();
  if (!name) return;
  if (active && active.id === id) {
    active.title = name;
    dirty = true;
    enqueue(() => {
      flushSave().catch(() => {});
    });
  } else {
    const r = await fetch("/drawings/" + encodeURIComponent(id));
    if (!r.ok) return;
    const { drawing } = await r.json();
    drawing.title = name;
    const saved = await putDrawing(drawing);
    upsertCatalog(metaOf(saved));
  }
  renderTabs();
  renderLibrary();
}

async function deleteDoc(id) {
  if (!window.confirm("Move this drawing to Recently deleted?")) return;
  await fetch("/drawings/" + encodeURIComponent(id), { method: "DELETE" });
  catalog = catalog.filter((d) => d.id !== id);
  if (openIds.includes(id)) await closeTab(id);
  await loadTrash();
  renderLibrary();
  renderTabs();
}

async function restoreDoc(id) {
  const r = await fetch("/drawings/" + encodeURIComponent(id) + "/restore", {
    method: "POST",
  });
  if (!r.ok) return;
  const { drawing } = await r.json();
  upsertCatalog(metaOf(drawing));
  trash = trash.filter((d) => d.id !== id);
  await switchTo(drawing.id, { skipSave: true });
  renderLibrary();
  renderTabs();
}

async function purgeDoc(id) {
  if (!window.confirm("Delete forever? This cannot be undone.")) return;
  await fetch("/drawings/" + encodeURIComponent(id) + "?hard=1", {
    method: "DELETE",
  });
  trash = trash.filter((d) => d.id !== id);
  renderLibrary();
}

async function bootDocs() {
  try {
    const r = await fetch("/drawings");
    const j = await r.json();
    catalog = Array.isArray(j.drawings) ? j.drawings : [];
  } catch {
    catalog = [];
  }
  let open = [];
  try {
    open = JSON.parse(localStorage.getItem(OPEN_KEY) || "[]");
  } catch {
    open = [];
  }
  open = open.filter((id) => catalog.some((d) => d.id === id));
  if (!open.length) {
    if (catalog.length) open = [catalog[0].id];
    else {
      const doc = await putDrawing(createDoc({ title: "Drawing 1" }));
      upsertCatalog(metaOf(doc));
      open = [doc.id];
    }
  }
  openIds = open;
  persistOpen();
  await switchTo(openIds[0], { skipSave: true });
}

async function toggleShare() {
  if (sharing) {
    stopShare();
    return;
  }
  let ds;
  try {
    ds = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });
  } catch {
    return;
  }
  sharing = true;
  shareBtn.setAttribute("aria-pressed", "true");
  shareBtn.textContent = "Stop share";
  setStatus("Sharing a window…", "live");
  outStream = ds;
  ds.getVideoTracks()[0].addEventListener("ended", () => stopShare());
  if (peerPresent) await offer();
}

function stopShare() {
  if (!sharing) return;
  sharing = false;
  shareBtn.setAttribute("aria-pressed", "false");
  shareBtn.textContent = "Share window";
  outStream = null;
  startCapture();
  paint();
  if (peerPresent) offer();
}

function eventPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function onDown(e) {
  if (sharing) return;
  e.preventDefault();
  if (shouldIgnoreTouch(e.pointerType, pointers, current && current.pointerType))
    return;
  if (e.pointerType === "pen") {
    dropTouches(pointers);
    pinch = null;
  }
  const pos = eventPos(e);
  pointers.set(e.pointerId, { ...pos, type: e.pointerType });
  if (shouldStartPinch(pointers)) {
    current = null;
    const pts = [...pointers.values()].filter((p) => p.type === "touch");
    pinch = {
      dist: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
      panX: view.panX,
      panY: view.panY,
      scale: view.scale,
      cx: (pts[0].x + pts[1].x) / 2,
      cy: (pts[0].y + pts[1].y) / 2,
    };
    return;
  }
  const world = screenToWorld(pos.x, pos.y);
  if (tool === "select") {
    startSelect(world, e);
    return;
  }
  if (tool === "eraser") {
    showEraseCursor(e.clientX, e.clientY);
    checkpoint(scene);
    current = { kind: "erase", dirty: false, pointerType: e.pointerType, pointerId: e.pointerId };
    if (eraseAt(scene, world.x, world.y, eraserRadiusWorld(), "pixel"))
      current.dirty = true;
    paint();
    return;
  }
  if (tool === "text") {
    openTextPad(pos, world);
    return;
  }
  commitTextPad();
  if (tool === "pen" || tool === "highlighter") {
    selected = null;
    current = beginInk(scene, tool, color, width, world.x, world.y, pressure(e), false);
    current.pointerType = e.pointerType;
    current.pointerId = e.pointerId;
    const live = current;
    enqueue(() => snapshotExcluding(scene, live));
    paint();
    return;
  }
  selected = null;
  current = beginShape(scene, tool, color, width, world.x, world.y, false);
  current.pointerType = e.pointerType;
  current.pointerId = e.pointerId;
  const live = current;
  enqueue(() => snapshotExcluding(scene, live));
  paint();
}

function onMove(e) {
  if (sharing) return;
  const tracking =
    pointers.has(e.pointerId) || (current && current.pointerId === e.pointerId);
  if (!tracking) return;
  e.preventDefault();
  if (shouldIgnoreTouch(e.pointerType, pointers, current && current.pointerType))
    return;
  applyMove(e);
}

function applyMove(e) {
  const pos = eventPos(e);
  pointers.set(e.pointerId, { ...pos, type: e.pointerType || "pen" });
  if (pinch && shouldStartPinch(pointers)) {
    const pts = [...pointers.values()].filter((p) => p.type === "touch");
    if (pts.length < 2) return;
    applyPinchView(view, pinch, pts[0], pts[1]);
    paint();
    return;
  }
  if (!current) return;
  const world = screenToWorld(pos.x, pos.y);
  if (current.kind === "move") {
    translateItem(current.item, world.x - current.lx, world.y - current.ly);
    current.lx = world.x;
    current.ly = world.y;
    paint();
    return;
  }
  if (current.kind === "rotate") {
    const ang = Math.atan2(world.y - current.cy, world.x - current.cx);
    current.item.rot = current.rot0 + (ang - current.start);
    paint();
    return;
  }
  if (current.kind === "erase") {
    showEraseCursor(e.clientX, e.clientY);
    if (eraseAt(scene, world.x, world.y, eraserRadiusWorld(), "pixel"))
      current.dirty = true;
    paint();
    return;
  }
  if (current.kind === "ink") {
    addPoint(current, world.x, world.y, pressure(e));
    paint();
    return;
  }
  setShapeEnd(current, world.x, world.y);
  paint();
}

function onUp(e) {
  pointers.delete(e.pointerId);
  if (!shouldStartPinch(pointers)) pinch = null;
  const penStillDown = [...pointers.values()].some((p) => p.type === "pen");
  if (penStillDown && current) return;
  const finished = current;
  current = null;
  if (!finished) return;
  if (finished.kind === "shape" || finished.kind === "text") selected = finished;
  paint();
  log("info", "stroke_up", {
    kind: finished.kind,
    tool: finished.tool || "",
    points: finished.points ? finished.points.length : 0,
  });
  enqueue(() => commitFinished(finished));
}

function commitFinished(finished) {
  if (finished.kind === "erase" && !finished.dirty) {
    if (scene.history.length) scene.history.pop();
    return;
  }
  scheduleSave();
  if (finished.kind === "ink" && finished.tool === "pen") beautifyInk(finished);
}

function startSelect(world, e) {
  const handle = selected && rotateHandle(selected);
  const hs = 16 / view.scale;
  if (handle && Math.hypot(world.x - handle.x, world.y - handle.y) <= hs) {
    checkpoint(scene);
    const c = itemCenter(selected);
    current = {
      kind: "rotate",
      item: selected,
      cx: c.x,
      cy: c.y,
      start: Math.atan2(world.y - c.y, world.x - c.x),
      rot0: selected.rot || 0,
      pointerType: e.pointerType,
      pointerId: e.pointerId,
    };
    paint();
    return;
  }
  const hit = hitTop(scene.items, world.x, world.y, 16 / view.scale);
  selected = hit;
  if (hit) {
    checkpoint(scene);
    current = {
      kind: "move",
      item: hit,
      lx: world.x,
      ly: world.y,
      pointerType: e.pointerType,
      pointerId: e.pointerId,
    };
  }
  paint();
}

function drawSelection(ctx) {
  if (!selected || !scene.items.includes(selected)) {
    selected = null;
    return;
  }
  const b = localBounds(selected);
  if (!b) return;
  const c = itemCenter(selected);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(view.panX, view.panY);
  ctx.scale(view.scale, view.scale);
  ctx.translate(c.x, c.y);
  ctx.rotate(selected.rot || 0);
  ctx.translate(-c.x, -c.y);
  const lw = 1.5 / view.scale;
  ctx.strokeStyle = "#2f6fed";
  ctx.lineWidth = lw;
  ctx.strokeRect(b.minX - 6, b.minY - 6, b.w + 12, b.h + 12);
  const hx = c.x;
  const hy = b.minY - 28;
  ctx.beginPath();
  ctx.moveTo(c.x, b.minY - 6);
  ctx.lineTo(hx, hy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(hx, hy, 9 / view.scale, 0, Math.PI * 2);
  ctx.fillStyle = "#2f6fed";
  ctx.fill();
  ctx.restore();
}

function beautifyInk(item) {
  const rec = recognizeStroke(item.points);
  if (!rec) return false;
  checkpoint(scene);
  const idx = scene.items.indexOf(item);
  if (idx < 0) return false;
  const next = {
    kind: "shape",
    tool: rec.tool,
    color: item.color,
    width: item.width,
    a: rec.a,
    b: rec.b,
    rot: item.rot || 0,
  };
  scene.items[idx] = next;
  selected = next;
  afterEdit();
  return true;
}




function onCancel(e) {
  if (current && current.pointerId === e.pointerId) return;
  pointers.delete(e.pointerId);
  if (!shouldStartPinch(pointers)) pinch = null;
}

canvas.addEventListener("pointerdown", onDown, { passive: false });
canvas.addEventListener(
  "pointermove",
  (e) => {
    if (tool === "eraser") showEraseCursor(e.clientX, e.clientY);
  },
  { passive: true },
);
window.addEventListener("pointermove", onMove, { passive: false });
window.addEventListener("pointerup", onUp);
window.addEventListener("pointercancel", onCancel);
canvas.addEventListener("pointerleave", () => {
  if (!pointers.size) hideEraseCursor();
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === "z") {
    e.preventDefault();
    if (e.shiftKey) runRedo("keys");
    else runUndo("keys");
  } else if ((e.metaKey || e.ctrlKey) && key === "y") {
    e.preventDefault();
    runRedo("keys");
  }
});

try {
  navigator.wakeLock?.request("screen");
} catch {}

window.addEventListener("resize", resizeCanvas);
bindToolbar();
resizeCanvas();
startCapture();
paint();
(function loop() {
  try {
    drawIfDirty();
  } catch (err) {
    log("error", "paint_throw", { message: String(err && err.message ? err.message : err) });
  }
  requestAnimationFrame(loop);
})();
window.addEventListener("error", (e) => {
  log("error", "window_error", { message: String(e.message || e.error || "error") });
});
window.addEventListener("unhandledrejection", (e) => {
  log("error", "unhandled", { message: String(e.reason && e.reason.message ? e.reason.message : e.reason) });
});
log("info", "boot", { href: location.href });
setStatus("Waiting for OBS…", "warn");
if (peerPresent) offer();
bootDocs()
  .catch(() => {})
  .finally(() => {
    document.body.dataset.boardReady = "1";
  });

Object.defineProperty(window, "__board", {
  get: () => ({
    scene,
    tool,
    view,
    selected,
    live,
    peerPresent,
    eraseMode,
    eraserDiameter,
    get activeId() {
      return active && active.id;
    },
    get catalog() {
      return catalog.slice();
    },
    get openIds() {
      return openIds.slice();
    },
    flushSave,
    newTab,
    switchTo,
    drawTestStroke() {
      const ink = beginInk(scene, "pen", "#e24a3b", 8, 80, 80, 1);
      for (let i = 1; i <= 40; i++) addPoint(ink, 80 + i * 8, 80 + Math.sin(i / 4) * 24, 1);
      afterEdit();
      return scene.items.length;
    },
    getLogs,
    undoLast() {
      return runUndo("test");
    },
    punch(x, y, r, mode) {
      checkpoint(scene);
      const ok = eraseAt(scene, x, y, r, mode || "pixel");
      afterEdit();
      return { ok, n: scene.items.length };
    },
  }),
});
