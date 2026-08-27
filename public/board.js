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
  renderBoard,
} from "/board-engine.js";

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d", { alpha: false });
const statusEl = document.getElementById("status");
const shareBtn = document.getElementById("shareBtn");

const TOOLS = ["pen", "highlighter", "eraser", "line", "rect", "ellipse", "arrow", "text"];
const COLORS = ["#1a1d23", "#e24a3b", "#2f6fed", "#1f9d55", "#f0a202", "#ffffff"];

const scene = createBoard();
const view = { panX: 0, panY: 0, scale: 1, w: 1, h: 1 };
let tool = "pen";
let color = COLORS[0];
let width = 4;
let live = false;
let peerPresent = false;
let pc = null;
let outStream = null;
let sharing = false;
let current = null;
let pointers = new Map();
let pinch = null;

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
  if (sharing) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderBoard(ctx, scene, view);
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

function bindToolbar() {
  for (const name of TOOLS) {
    const btn = document.querySelector(`[data-tool="${name}"]`);
    if (!btn) continue;
    btn.onclick = () => {
      tool = name;
      for (const el of document.querySelectorAll("[data-tool]"))
        el.setAttribute("aria-pressed", String(el.dataset.tool === tool));
    };
  }
  const swatches = document.getElementById("swatches");
  for (const hex of COLORS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.style.background = hex;
    b.title = hex;
    b.setAttribute("aria-pressed", String(hex === color));
    b.onclick = () => {
      color = hex;
      for (const el of swatches.children)
        el.setAttribute("aria-pressed", String(el === b));
    };
    swatches.appendChild(b);
  }
  const widthEl = document.getElementById("width");
  widthEl.value = String(width);
  widthEl.oninput = () => {
    width = Number(widthEl.value);
  };
  document.getElementById("undoBtn").onclick = () => {
    undo(scene);
    paint();
  };
  document.getElementById("redoBtn").onclick = () => {
    redo(scene);
    paint();
  };
  document.getElementById("clearBtn").onclick = () => {
    clearBoard(scene);
    paint();
  };
  document.getElementById("paper").onchange = (e) => {
    setPaper(scene, e.target.value);
    paint();
  };
  if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    shareBtn.hidden = false;
    shareBtn.onclick = toggleShare;
  }
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
  canvas.setPointerCapture(e.pointerId);
  const pos = eventPos(e);
  pointers.set(e.pointerId, { ...pos, type: e.pointerType });
  if (pointers.size === 2) {
    current = null;
    const pts = [...pointers.values()];
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
  if (tool === "eraser") {
    eraseAt(scene, world.x, world.y, Math.max(16, width * 3) / view.scale);
    current = { kind: "erase" };
    paint();
    return;
  }
  if (tool === "text") {
    const text = window.prompt("Text");
    if (text) addText(scene, color, Math.max(18, width * 6), world.x, world.y, text);
    paint();
    return;
  }
  if (tool === "pen" || tool === "highlighter") {
    current = beginInk(scene, tool, color, width, world.x, world.y, pressure(e));
    paint();
    return;
  }
  current = beginShape(scene, tool, color, width, world.x, world.y);
  paint();
}

function onMove(e) {
  if (sharing) return;
  if (!pointers.has(e.pointerId)) return;
  const pos = eventPos(e);
  pointers.set(e.pointerId, { ...pos, type: e.pointerType });
  if (pinch && pointers.size >= 2) {
    const pts = [...pointers.values()];
    const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    const scale = Math.max(0.4, Math.min(4, pinch.scale * (dist / (pinch.dist || 1))));
    const cx = (pts[0].x + pts[1].x) / 2;
    const cy = (pts[0].y + pts[1].y) / 2;
    view.scale = scale;
    view.panX = pinch.panX + (cx - pinch.cx);
    view.panY = pinch.panY + (cy - pinch.cy);
    paint();
    return;
  }
  if (!current) return;
  const world = screenToWorld(pos.x, pos.y);
  if (current.kind === "erase") {
    eraseAt(scene, world.x, world.y, Math.max(16, width * 3) / view.scale);
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
  if (pointers.size < 2) pinch = null;
  current = null;
}

canvas.addEventListener("pointerdown", onDown);
canvas.addEventListener("pointermove", onMove);
canvas.addEventListener("pointerup", onUp);
canvas.addEventListener("pointercancel", onUp);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === "z") {
    e.preventDefault();
    if (e.shiftKey) redo(scene);
    else undo(scene);
    paint();
  } else if ((e.metaKey || e.ctrlKey) && key === "y") {
    e.preventDefault();
    redo(scene);
    paint();
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
  paint();
  requestAnimationFrame(loop);
})();
setStatus("Waiting for OBS…", "warn");
if (peerPresent) offer();
document.body.dataset.boardReady = "1";

Object.defineProperty(window, "__board", {
  get: () => ({
    scene,
    tool,
    live,
    peerPresent,
    drawTestStroke() {
      const ink = beginInk(scene, "pen", "#e24a3b", 8, 80, 80, 1);
      for (let i = 1; i <= 40; i++) addPoint(ink, 80 + i * 8, 80 + Math.sin(i / 4) * 24, 1);
      paint();
      return scene.items.length;
    },
  }),
});
