export function localBounds(item) {
  if (!item) return null;
  if (item.kind === "ink" && item.points && item.points.length) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of item.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }
  if (item.kind === "shape" && item.a && item.b) {
    const minX = Math.min(item.a.x, item.b.x);
    const minY = Math.min(item.a.y, item.b.y);
    const maxX = Math.max(item.a.x, item.b.x);
    const maxY = Math.max(item.a.y, item.b.y);
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }
  if (item.kind === "text") {
    const w = Math.max(12, String(item.text || "").length * item.size * 0.55);
    const h = item.size * 1.2;
    return { minX: item.x, minY: item.y, maxX: item.x + w, maxY: item.y + h, w, h };
  }
  return null;
}

export function itemCenter(item) {
  const b = localBounds(item);
  if (!b) return { x: 0, y: 0 };
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function worldToLocal(item, x, y) {
  const rot = item.rot || 0;
  if (!rot) return { x, y };
  const c = itemCenter(item);
  const dx = x - c.x;
  const dy = y - c.y;
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function localToWorld(item, x, y) {
  const rot = item.rot || 0;
  if (!rot) return { x, y };
  const c = itemCenter(item);
  const dx = x - c.x;
  const dy = y - c.y;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function translateItem(item, dx, dy) {
  if (item.kind === "ink" && item.points) {
    for (const p of item.points) {
      p.x += dx;
      p.y += dy;
    }
    return;
  }
  if (item.kind === "shape" && item.a && item.b) {
    item.a.x += dx;
    item.a.y += dy;
    item.b.x += dx;
    item.b.y += dy;
    return;
  }
  if (item.kind === "text") {
    item.x += dx;
    item.y += dy;
  }
}

export function rotateItem(item, delta) {
  item.rot = (item.rot || 0) + delta;
}

function distToSeg(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function distToRectOutline(p, minX, minY, maxX, maxY) {
  const inside = p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
  if (inside) {
    return Math.min(p.x - minX, maxX - p.x, p.y - minY, maxY - p.y);
  }
  const cx = Math.max(minX, Math.min(maxX, p.x));
  const cy = Math.max(minY, Math.min(maxY, p.y));
  return Math.hypot(p.x - cx, p.y - cy);
}

function distToEllipseOutline(p, cx, cy, rx, ry) {
  const ax = Math.max(rx, 1);
  const ay = Math.max(ry, 1);
  const nx = (p.x - cx) / ax;
  const ny = (p.y - cy) / ay;
  const r = Math.hypot(nx, ny);
  if (r < 1e-6) return Math.min(ax, ay);
  return Math.abs(r - 1) * Math.min(ax, ay);
}

function distToShape(item, p) {
  const tool = item.tool;
  if (tool === "line" || tool === "arrow") return distToSeg(p, item.a, item.b);
  const minX = Math.min(item.a.x, item.b.x);
  const minY = Math.min(item.a.y, item.b.y);
  const maxX = Math.max(item.a.x, item.b.x);
  const maxY = Math.max(item.a.y, item.b.y);
  if (tool === "ellipse") {
    return distToEllipseOutline(
      p,
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (maxX - minX) / 2,
      (maxY - minY) / 2,
    );
  }
  return distToRectOutline(p, minX, minY, maxX, maxY);
}

function distToInk(item, p) {
  const pts = item.points || [];
  if (!pts.length) return Infinity;
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const d = distToSeg(p, pts[i - 1], pts[i]);
    if (d < best) best = d;
  }
  return best;
}

export function hitItem(item, x, y, pad = 12) {
  const p = worldToLocal(item, x, y);
  const tol = pad + (item.width || 0);
  if (item.kind === "text") {
    const b = localBounds(item);
    if (!b) return false;
    return (
      p.x >= b.minX - pad &&
      p.x <= b.maxX + pad &&
      p.y >= b.minY - pad &&
      p.y <= b.maxY + pad
    );
  }
  if (item.kind === "ink") return distToInk(item, p) <= tol;
  if (item.kind === "shape") return distToShape(item, p) <= tol;
  return false;
}

export function hitTop(items, x, y, pad) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (hitItem(items[i], x, y, pad)) return items[i];
  }
  return null;
}

export function rotateHandle(item) {
  const b = localBounds(item);
  if (!b) return null;
  const c = itemCenter(item);
  return localToWorld(item, c.x, b.minY - 28);
}

export function bringToFront(items, item) {
  const i = items.indexOf(item);
  if (i < 0 || i === items.length - 1) return false;
  items.splice(i, 1);
  items.push(item);
  return true;
}

export function sendToBack(items, item) {
  const i = items.indexOf(item);
  if (i <= 0) return false;
  items.splice(i, 1);
  items.unshift(item);
  return true;
}

export function bringForward(items, item) {
  const i = items.indexOf(item);
  if (i < 0 || i >= items.length - 1) return false;
  const next = items[i + 1];
  items[i + 1] = item;
  items[i] = next;
  return true;
}

export function sendBackward(items, item) {
  const i = items.indexOf(item);
  if (i <= 0) return false;
  const prev = items[i - 1];
  items[i - 1] = item;
  items[i] = prev;
  return true;
}

export const VIEW_SCALE_MIN = 0.25;
export const VIEW_SCALE_MAX = 4;

export function clampScale(s) {
  return Math.max(VIEW_SCALE_MIN, Math.min(VIEW_SCALE_MAX, s));
}

export function zoomAt(view, factor, sx, sy) {
  const scale0 = view.scale || 1;
  const wx = (sx - view.panX) / scale0;
  const wy = (sy - view.panY) / scale0;
  view.scale = clampScale(scale0 * factor);
  view.panX = sx - wx * view.scale;
  view.panY = sy - wy * view.scale;
  return view;
}

export function resetView(view) {
  view.panX = 0;
  view.panY = 0;
  view.scale = 1;
  return view;
}

export function applyPinchView(view, pinch, a, b) {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const scale = clampScale(pinch.scale * (dist / (pinch.dist || 1)));
  const wx = (pinch.cx - pinch.panX) / (pinch.scale || 1);
  const wy = (pinch.cy - pinch.panY) / (pinch.scale || 1);
  view.scale = scale;
  view.panX = cx - wx * scale;
  view.panY = cy - wy * scale;
  return view;
}
