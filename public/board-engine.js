/** Vector whiteboard scene. No DOM. Used by the iPad page and unit tests. */

export const PAPERS = {
  white: { fill: "#f7f4ee", grid: false, chroma: false },
  grid: { fill: "#f7f4ee", grid: true, chroma: false },
  green: { fill: "#00b140", grid: false, chroma: true },
  dark: { fill: "#161a20", grid: true, chroma: false },
};

const HISTORY_CAP = 100;

export function createBoard() {
  return {
    items: [],
    history: [],
    future: [],
    paper: "white",
  };
}

export function cloneItems(items) {
  return JSON.parse(JSON.stringify(items));
}

export function checkpoint(board) {
  board.history.push(cloneItems(board.items));
  board.future.length = 0;
  if (board.history.length > HISTORY_CAP) board.history.shift();
}

export function beginInk(board, tool, color, width, x, y, p) {
  checkpoint(board);
  const item = {
    kind: "ink",
    tool,
    color,
    width,
    points: [{ x, y, p: clamp01(p) }],
  };
  board.items.push(item);
  return item;
}

export function addPoint(item, x, y, p) {
  const last = item.points[item.points.length - 1];
  const dx = x - last.x;
  const dy = y - last.y;
  if (dx * dx + dy * dy < 0.36) return false;
  item.points.push({ x, y, p: clamp01(p ?? last.p) });
  return true;
}

export function beginShape(board, tool, color, width, x, y) {
  checkpoint(board);
  const item = {
    kind: "shape",
    tool,
    color,
    width,
    a: { x, y },
    b: { x, y },
  };
  board.items.push(item);
  return item;
}

export function setShapeEnd(item, x, y) {
  item.b = { x, y };
}

export function addText(board, color, size, x, y, text) {
  const t = String(text || "").trim();
  if (!t) return null;
  checkpoint(board);
  const item = { kind: "text", color, size, x, y, text: t };
  board.items.push(item);
  return item;
}

export function eraseAt(board, x, y, radius, mode = "pixel") {
  if (mode === "element") return eraseElements(board, x, y, radius);
  return erasePixels(board, x, y, radius);
}

function sampleSeg(a, b, step) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(2, Math.ceil(len / step));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      p: 0.5,
    });
  }
  return pts;
}

export function outlinePoints(item) {
  if (item.kind === "ink") return item.points || [];
  if (item.kind === "shape" && item.a && item.b) {
    const step = 5;
    if (item.tool === "line" || item.tool === "arrow") {
      return sampleSeg(item.a, item.b, step);
    }
    const x0 = Math.min(item.a.x, item.b.x);
    const y0 = Math.min(item.a.y, item.b.y);
    const x1 = Math.max(item.a.x, item.b.x);
    const y1 = Math.max(item.a.y, item.b.y);
    if (item.tool === "ellipse") {
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const rx = (x1 - x0) / 2 || 1;
      const ry = (y1 - y0) / 2 || 1;
      const n = Math.max(24, Math.ceil((Math.PI * 2 * Math.max(rx, ry)) / step));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = (i / n) * Math.PI * 2;
        pts.push({
          x: cx + rx * Math.cos(t),
          y: cy + ry * Math.sin(t),
          p: 0.5,
        });
      }
      return pts;
    }
    const tl = { x: x0, y: y0 };
    const tr = { x: x1, y: y0 };
    const br = { x: x1, y: y1 };
    const bl = { x: x0, y: y1 };
    return [
      ...sampleSeg(tl, tr, step).slice(0, -1),
      ...sampleSeg(tr, br, step).slice(0, -1),
      ...sampleSeg(br, bl, step).slice(0, -1),
      ...sampleSeg(bl, tl, step),
    ];
  }
  if (item.kind === "text") {
    const w = Math.max(12, String(item.text || "").length * item.size * 0.55);
    const h = item.size * 1.2;
    const pts = [];
    const step = 5;
    for (let x = item.x; x <= item.x + w; x += step) {
      for (let y = item.y; y <= item.y + h; y += step) {
        pts.push({ x, y, p: 0.5 });
      }
    }
    return pts;
  }
  return [];
}

function eraseElements(board, x, y, radius) {
  const keep = [];
  let hit = false;
  for (const item of board.items) {
    if (itemHits(item, x, y, radius)) hit = true;
    else keep.push(item);
  }
  if (!hit) return false;
  board.items = keep;
  return true;
}

function asInk(item) {
  if (item.kind === "ink") return item;
  return {
    kind: "ink",
    tool: "pen",
    color: item.color || "#1a1d23",
    width: item.width || 4,
    points: outlinePoints(item),
  };
}

function erasePixels(board, x, y, radius) {
  const next = [];
  let hit = false;
  for (const item of board.items) {
    const ink = asInk(item);
    if (!ink.points.length) {
      next.push(item);
      continue;
    }
    const parts = splitInkOutside(ink, x, y, radius);
    if (parts == null) {
      next.push(item);
      continue;
    }
    hit = true;
    next.push(...parts);
  }
  if (!hit) return false;
  board.items = next;
  return true;
}

function splitInkOutside(item, x, y, radius) {
  const r2 = radius * radius;
  const pts = item.points;
  let anyHit = false;
  const keep = pts.map((pt) => {
    const ok = dist2(pt.x, pt.y, x, y) > r2;
    if (!ok) anyHit = true;
    return ok;
  });
  if (!anyHit) return null;
  const parts = [];
  let run = [];
  const flush = () => {
    if (run.length) {
      parts.push({
        kind: "ink",
        tool: item.tool,
        color: item.color,
        width: item.width,
        points: run,
      });
    }
    run = [];
  };
  for (let i = 0; i < pts.length; i++) {
    if (keep[i]) run.push(pts[i]);
    else flush();
  }
  flush();
  return parts;
}

export function undo(board) {
  if (!board.history.length) return false;
  board.future.push(board.items);
  board.items = board.history.pop();
  return true;
}

export function redo(board) {
  if (!board.future.length) return false;
  board.history.push(board.items);
  board.items = board.future.pop();
  return true;
}

export function clearBoard(board) {
  if (!board.items.length) return false;
  checkpoint(board);
  board.items = [];
  return true;
}

export function setPaper(board, paper) {
  if (!PAPERS[paper]) return false;
  board.paper = paper;
  return true;
}

export function renderBoard(ctx, board, view) {
  const w = view.w;
  const h = view.h;
  const paper = PAPERS[board.paper] || PAPERS.white;
  ctx.fillStyle = paper.fill;
  ctx.fillRect(0, 0, w, h);
  if (paper.grid) {
    const step = 48 * (view.scale || 1);
    const originX = ((view.panX % step) + step) % step;
    const originY = ((view.panY % step) + step) % step;
    ctx.strokeStyle =
      board.paper === "dark" ? "rgba(255,255,255,0.06)" : "rgba(20,24,30,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = originX; x <= w; x += step) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = originY; y <= h; y += step) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(view.panX, view.panY);
  ctx.scale(view.scale, view.scale);
  for (const item of board.items) drawItem(ctx, item);
  ctx.restore();
}

function drawItem(ctx, item) {
  if (item.kind === "ink") {
    drawInk(ctx, item);
    return;
  }
  if (item.kind === "shape") {
    drawShape(ctx, item);
    return;
  }
  if (item.kind === "text") {
    ctx.fillStyle = item.color;
    ctx.font = `${item.size}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(item.text, item.x, item.y);
  }
}

function drawInk(ctx, item) {
  const pts = item.points;
  if (!pts.length) return;
  const highlight = item.tool === "highlighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = item.color;
  ctx.globalAlpha = highlight ? 0.32 : 1;
  if (pts.length === 1) {
    ctx.lineWidth = item.width * widthMul(pts[0].p, highlight);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[0].x + 0.01, pts[0].y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    return;
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    ctx.lineWidth = item.width * widthMul((a.p + b.p) / 2, highlight);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawShape(ctx, item) {
  const { a, b, tool, color, width } = item;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 1;
  if (tool === "line") {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    return;
  }
  if (tool === "arrow") {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const len = Math.max(14, width * 3.2);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - len * Math.cos(ang - 0.42),
      b.y - len * Math.sin(ang - 0.42),
    );
    ctx.lineTo(
      b.x - len * Math.cos(ang + 0.42),
      b.y - len * Math.sin(ang + 0.42),
    );
    ctx.closePath();
    ctx.fill();
    return;
  }
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (tool === "rect") {
    ctx.strokeRect(x, y, w, h);
    return;
  }
  if (tool === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2 || 0.5, h / 2 || 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function itemHits(item, x, y, radius) {
  if (item.kind === "ink") {
    const r = radius + item.width;
    const r2 = r * r;
    return item.points.some((pt) => dist2(pt.x, pt.y, x, y) <= r2);
  }
  if (item.kind === "shape") {
    return distToSegment(x, y, item.a, item.b) <= radius + item.width;
  }
  if (item.kind === "text") {
    const w = item.text.length * item.size * 0.55;
    const h = item.size * 1.2;
    return (
      x >= item.x - radius &&
      x <= item.x + w + radius &&
      y >= item.y - radius &&
      y <= item.y + h + radius
    );
  }
  return false;
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function distToSegment(px, py, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  let t = ((px - a.x) * vx + (py - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a.x + t * vx), py - (a.y + t * vy));
}

function widthMul(p, highlight) {
  if (highlight) return 4;
  return 0.45 + 0.7 * clamp01(p);
}

function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0.05, Math.min(1, v));
}
