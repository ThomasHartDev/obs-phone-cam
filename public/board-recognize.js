export const TEXT_IDLE_MS = 2000;

export const SNAP = {
  maxGap: 28,
  minOverlap: 0.4,
  pad: 8,
};

export function bboxOf(points) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function pathLength(points) {
  let n = 0;
  for (let i = 1; i < points.length; i++) {
    n += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return n;
}

export function resample(points, n) {
  const len = pathLength(points);
  if (!points || points.length < 2 || len < 1) return (points || []).slice();
  const I = len / (n - 1);
  const out = [{ x: points[0].x, y: points[0].y }];
  let d = 0;
  let i = 1;
  let prev = points[0];
  while (out.length < n && i < points.length) {
    const cur = points[i];
    const step = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    if (d + step >= I) {
      const t = (I - d) / (step || 1);
      const nx = prev.x + t * (cur.x - prev.x);
      const ny = prev.y + t * (cur.y - prev.y);
      out.push({ x: nx, y: ny });
      prev = { x: nx, y: ny };
      d = 0;
    } else {
      d += step;
      prev = cur;
      i++;
    }
  }
  while (out.length < n) {
    const last = points[points.length - 1];
    out.push({ x: last.x, y: last.y });
  }
  return out;
}

export function shoelaceArea(points) {
  if (!points || points.length < 3) return 0;
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return Math.abs(a) / 2;
}

function solve3(A, b) {
  const m = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    }
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    const tmp = m[col];
    m[col] = m[piv];
    m[piv] = tmp;
    const div = m[col][col];
    for (let c = col; c < 4; c++) m[col][c] /= div;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col];
      for (let c = col; c < 4; c++) m[r][c] -= f * m[col][c];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

export function fitCircleKasa(points) {
  let sxx = 0,
    syy = 0,
    sxy = 0,
    sx = 0,
    sy = 0;
  let sxz = 0,
    syz = 0,
    sz = 0;
  const n = points.length;
  for (const p of points) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x;
    sy += p.y;
    sxx += p.x * p.x;
    syy += p.y * p.y;
    sxy += p.x * p.y;
    sxz += p.x * z;
    syz += p.y * z;
    sz += z;
  }
  const sol = solve3(
    [
      [sxx, sxy, sx],
      [sxy, syy, sy],
      [sx, sy, n],
    ],
    [sxz, syz, sz],
  );
  if (!sol) return null;
  const cx = sol[0] / 2;
  const cy = sol[1] / 2;
  const r2 = sol[2] + cx * cx + cy * cy;
  if (!(r2 > 4)) return null;
  const r = Math.sqrt(r2);
  let err = 0;
  for (const p of points) err += Math.abs(Math.hypot(p.x - cx, p.y - cy) - r);
  return { cx, cy, r, rms: err / n };
}

export function ellipseAxes(points, cx, cy) {
  let xx = 0;
  let yy = 0;
  const n = points.length || 1;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    xx += dx * dx;
    yy += dy * dy;
  }
  return {
    rx: Math.sqrt(Math.max(1, (2 * xx) / n)),
    ry: Math.sqrt(Math.max(1, (2 * yy) / n)),
  };
}

function ellipseResidual(points, cx, cy, rx, ry) {
  const n = points.length || 1;
  let err = 0;
  for (const p of points) {
    err += Math.abs(Math.hypot((p.x - cx) / (rx || 1), (p.y - cy) / (ry || 1)) - 1);
  }
  return err / n;
}

export function angularCoverage(points, cx, cy) {
  const angs = points.map((p) => Math.atan2(p.y - cy, p.x - cx)).sort((a, b) => a - b);
  if (angs.length < 4) return 0;
  let maxGap = 0;
  for (let i = 1; i < angs.length; i++) maxGap = Math.max(maxGap, angs[i] - angs[i - 1]);
  maxGap = Math.max(maxGap, angs[0] + Math.PI * 2 - angs[angs.length - 1]);
  return Math.max(0, Math.PI * 2 - maxGap);
}

export function circleScore(points) {
  if (!points || points.length < 10) return { score: 0, fit: null };
  const b = bboxOf(points);
  if (Math.min(b.w, b.h) < 36) return { score: 0, fit: null };
  const kasa = fitCircleKasa(points);
  if (!kasa || kasa.r < 24) return { score: 0, fit: null };
  const { rx, ry } = ellipseAxes(points, kasa.cx, kasa.cy);
  if (Math.min(rx, ry) < 24) return { score: 0, fit: null };
  if (Math.max(rx, ry) / Math.min(rx, ry) > 2.2) return { score: 0, fit: null };
  const rel = ellipseResidual(points, kasa.cx, kasa.cy, rx, ry);
  const cover = angularCoverage(points, kasa.cx, kasa.cy);
  const peri = pathLength(points);
  const gap = Math.hypot(
    points[0].x - points[points.length - 1].x,
    points[0].y - points[points.length - 1].y,
  );
  const closedPeri = peri + gap;
  const area = shoelaceArea(points.concat([points[0]]));
  const circ = closedPeri > 1 ? (4 * Math.PI * area) / (closedPeri * closedPeri) : 0;
  if (cover < 4.0) return { score: 0, fit: null };
  if (rel > 0.22) return { score: 0, fit: null };
  if (circ < 0.55) return { score: 0, fit: null };
  if (rel > 0.045 && rectScore(points) >= 0.8) return { score: 0, fit: null };
  const quality = clamp01(
    (1 - rel / 0.22) * 0.5 +
      clamp01((circ - 0.55) / 0.4) * 0.25 +
      clamp01((cover - 4.0) / 2.2) * 0.25,
  );
  return {
    score: 0.56 + 0.44 * quality,
    fit: { cx: kasa.cx, cy: kasa.cy, r: kasa.r, rx, ry, rms: rel },
  };
}

function distToSeg(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy || 1;
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

function smoothPoints(points) {
  if (!points || points.length < 5) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    out.push({
      x: (points[i - 1].x + points[i].x + points[i + 1].x) / 3,
      y: (points[i - 1].y + points[i].y + points[i + 1].y) / 3,
    });
  }
  out.push(points[points.length - 1]);
  return out;
}

export const CLOSED_SHAPE_MIN = 56;
export const LINE_MIN = 56;

export function lineScore(points) {
  if (!points || points.length < 4) return 0;
  const a = points[0];
  const b = points[points.length - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < LINE_MIN) return 0;
  const travel = pathLength(points);
  if (travel > len * 1.75) return 0;
  let maxd = 0;
  let sum = 0;
  for (const p of points) {
    const d = distToSeg(p, a, b);
    if (d > maxd) maxd = d;
    sum += d;
  }
  const mean = sum / points.length;
  const s = 1 - Math.max(maxd / (len * 0.28 + 18), mean / (len * 0.14 + 10));
  return clamp01(s);
}

export function arrowScore(points) {
  if (!points || points.length < 10) return 0;
  const cut = Math.max(5, Math.floor(points.length * 0.68));
  const shaft = points.slice(0, cut);
  const head = points.slice(cut);
  const a = shaft[0];
  const b = shaft[shaft.length - 1];
  const shaftLen = Math.hypot(b.x - a.x, b.y - a.y);
  if (shaftLen < LINE_MIN) return 0;
  const shaftScore = lineScore(shaft);
  if (shaftScore < 0.55) return 0;
  const whole = lineScore(points);
  if (whole > 0.88) return 0;
  if (shaftScore - whole < 0.08) return 0;
  let maxTurn = 0;
  for (let i = 2; i < points.length; i++) {
    const a1 = Math.atan2(
      points[i - 1].y - points[i - 2].y,
      points[i - 1].x - points[i - 2].x,
    );
    const a2 = Math.atan2(
      points[i].y - points[i - 1].y,
      points[i].x - points[i - 1].x,
    );
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (i >= cut - 1 && d > maxTurn) maxTurn = d;
  }
  let maxOff = 0;
  for (const p of head) {
    const d = distToSeg(p, a, b);
    if (d > maxOff) maxOff = d;
  }
  if (maxTurn < 0.55) return 0;
  if (maxOff < Math.max(12, shaftLen * 0.08)) return 0;
  return clamp01(0.5 * shaftScore + 0.5);
}

function sharpTurns(points) {
  let n = 0;
  for (let i = 2; i < points.length; i++) {
    const a = Math.atan2(
      points[i - 1].y - points[i - 2].y,
      points[i - 1].x - points[i - 2].x,
    );
    const b = Math.atan2(
      points[i].y - points[i - 1].y,
      points[i].x - points[i - 1].x,
    );
    let d = Math.abs(b - a);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 0.7) n++;
  }
  return n;
}

export function isLikelyWriting(points) {
  if (!points || points.length < 6) return false;
  const b = bboxOf(points);
  const closed =
    Math.hypot(
      points[0].x - points[points.length - 1].x,
      points[0].y - points[points.length - 1].y,
    ) < 0.5 * Math.min(b.w, b.h);
  if (closed && Math.min(b.w, b.h) >= CLOSED_SHAPE_MIN) return false;
  const turns = sharpTurns(points);
  if (turns >= 10 && Math.min(b.w, b.h) < CLOSED_SHAPE_MIN) return true;
  if (b.h < 48 && b.w > b.h * 2.2 && turns >= 5) return true;
  if (Math.min(b.w, b.h) < 32 && turns >= 4) return true;
  return false;
}

export function rectScore(points) {
  if (!points || points.length < 12) return 0;
  const b = bboxOf(points);
  if (b.w < CLOSED_SHAPE_MIN || b.h < CLOSED_SHAPE_MIN) return 0;
  const closed =
    Math.hypot(
      points[0].x - points[points.length - 1].x,
      points[0].y - points[points.length - 1].y,
    ) < 0.28 * Math.min(b.w, b.h);
  const travel = pathLength(points);
  const peri = 2 * (b.w + b.h);
  if (travel < peri * 0.55) return 0;
  const tol = Math.max(5, 0.11 * Math.min(b.w, b.h));
  const sides = [0, 0, 0, 0];
  let hit = 0;
  for (const p of points) {
    const dt = Math.abs(p.y - b.minY);
    const db = Math.abs(p.y - b.maxY);
    const dl = Math.abs(p.x - b.minX);
    const dr = Math.abs(p.x - b.maxX);
    const m = Math.min(dt, db, dl, dr);
    if (m > tol) continue;
    hit++;
    if (m === dt) sides[0]++;
    else if (m === dr) sides[1]++;
    else if (m === db) sides[2]++;
    else sides[3]++;
  }
  const coverage = hit / points.length;
  if (coverage < 0.62) return 0;
  const sideOk = sides.every((s) => s >= Math.max(3, points.length * 0.07));
  if (!sideOk) return 0;
  return clamp01(coverage + (closed ? 0.08 : 0));
}

export function ellipseScore(points) {
  if (!points || points.length < 14) return 0;
  const b = bboxOf(points);
  if (b.w < CLOSED_SHAPE_MIN || b.h < CLOSED_SHAPE_MIN) return 0;
  const closed =
    Math.hypot(
      points[0].x - points[points.length - 1].x,
      points[0].y - points[points.length - 1].y,
    ) < 0.55 * Math.min(b.w, b.h);
  if (!closed) return 0;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const rx = b.w / 2 || 1;
  const ry = b.h / 2 || 1;
  let err = 0;
  for (const p of points) {
    err += Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1);
  }
  err /= points.length;
  const s = 1 - err / 0.42;
  if (s < 0.62) return 0;
  const r = rectScore(points);
  if (r > s + 0.08) return 0;
  return clamp01(s);
}

export function recognizeStroke(raw) {
  if (!raw || raw.length < 6) return null;
  const points = resample(smoothPoints(raw), 64);
  const cir = circleScore(points);
  if (cir.score >= 0.52 && cir.fit) {
    const { cx, cy, rx, ry } = cir.fit;
    const round = Math.max(rx, ry) / Math.min(rx, ry) < 1.14;
    const ax = round ? (rx + ry) / 2 : rx;
    const ay = round ? ax : ry;
    return {
      kind: "shape",
      tool: "ellipse",
      a: { x: cx - ax, y: cy - ay },
      b: { x: cx + ax, y: cy + ay },
      score: cir.score,
    };
  }
  if (isLikelyWriting(points)) return null;
  const line = lineScore(points);
  const arrow = arrowScore(points);
  const rect = rectScore(points);
  const ellipse = ellipseScore(points);
  const ranked = [
    { tool: "arrow", score: arrow },
    { tool: "rect", score: rect },
    { tool: "ellipse", score: ellipse },
    { tool: "line", score: line },
  ].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const second = ranked[1];
  const need = best.tool === "rect" ? 0.8 : 0.72;
  if (best.score < need) return null;
  if (second && best.score - second.score < 0.03 && best.score < 0.88) return null;
  const b = bboxOf(points);
  if (best.tool === "line" || best.tool === "arrow") {
    return {
      kind: "shape",
      tool: best.tool,
      a: { x: points[0].x, y: points[0].y },
      b: { x: points[points.length - 1].x, y: points[points.length - 1].y },
      score: best.score,
    };
  }
  return {
    kind: "shape",
    tool: best.tool,
    a: { x: b.minX, y: b.minY },
    b: { x: b.maxX, y: b.maxY },
    score: best.score,
  };
}

export function looksLikeHandwriting(points) {
  if (!points || points.length < 6) return false;
  if (isLikelyWriting(points)) return true;
  let turns = 0;
  for (let i = 2; i < points.length; i++) {
    const a = Math.atan2(
      points[i - 1].y - points[i - 2].y,
      points[i - 1].x - points[i - 2].x,
    );
    const b = Math.atan2(
      points[i].y - points[i - 1].y,
      points[i].x - points[i - 1].x,
    );
    let d = Math.abs(b - a);
    if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > 0.55) turns++;
  }
  const b = bboxOf(points);
  return turns >= 5 || (b.w > 40 && b.h > 10 && turns >= 3);
}

export function itemBounds(item) {
  if (!item) return null;
  if (item.kind === "ink" && item.points && item.points.length) return bboxOf(item.points);
  if (item.kind === "shape" && item.a && item.b) return bboxOf([item.a, item.b]);
  if (item.kind === "text") {
    const w = Math.max(12, String(item.text || "").length * item.size * 0.55);
    const h = item.size * 1.2;
    return { minX: item.x, minY: item.y, maxX: item.x + w, maxY: item.y + h, w, h };
  }
  return null;
}

function horizOverlap(a, b) {
  return Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX));
}

export function snapTextBox(inkBox, others, fontSize) {
  const maxGap = Math.max(SNAP.maxGap, fontSize * 1.15);
  const pad = SNAP.pad;
  let picked = null;
  for (const o of others) {
    const b = itemBounds(o);
    if (!b || b.w < 8 || b.h < 8) continue;
    const overlap = horizOverlap(inkBox, b);
    const base = Math.max(12, Math.min(inkBox.w, b.w));
    const overlapRatio = overlap / base;

    const inside =
      inkBox.minX >= b.minX - 6 &&
      inkBox.maxX <= b.maxX + 6 &&
      inkBox.minY >= b.minY - 6 &&
      inkBox.maxY <= b.maxY + 6;
    if (inside) {
      return {
        x: b.minX + pad,
        y: b.minY + pad,
        where: "inside",
      };
    }

    if (overlapRatio < SNAP.minOverlap) continue;
    const gapAbove = b.minY - inkBox.maxY;
    if (gapAbove >= -10 && gapAbove <= maxGap) {
      const cand = {
        x: b.minX + (b.w - inkBox.w) / 2,
        y: b.minY - fontSize - pad,
        where: "above",
        gap: gapAbove,
      };
      if (!picked || cand.gap < picked.gap) picked = cand;
    }
    const gapBelow = inkBox.minY - b.maxY;
    if (gapBelow >= -10 && gapBelow <= maxGap) {
      const cand = {
        x: b.minX + (b.w - inkBox.w) / 2,
        y: b.maxY + pad,
        where: "below",
        gap: gapBelow,
      };
      if (!picked || cand.gap < picked.gap) picked = cand;
    }
  }
  if (picked) return { x: picked.x, y: picked.y, where: picked.where };
  return { x: inkBox.minX, y: inkBox.minY, where: "origin" };
}

export function clusterInk(items, maxGap) {
  const inks = items.filter((it) => it.kind === "ink" && it.tool === "pen" && it.points);
  const used = new Set();
  const groups = [];
  const gap = maxGap ?? 36;
  for (let i = 0; i < inks.length; i++) {
    if (used.has(inks[i])) continue;
    const group = [inks[i]];
    used.add(inks[i]);
    let grew = true;
    while (grew) {
      grew = false;
      const gb = bboxOf(group.flatMap((g) => g.points));
      for (const other of inks) {
        if (used.has(other)) continue;
        const ob = bboxOf(other.points);
        const ox = Math.max(0, Math.min(gb.maxX, ob.maxX) - Math.max(gb.minX, ob.minX));
        const oy = Math.max(0, Math.min(gb.maxY, ob.maxY) - Math.max(gb.minY, ob.minY));
        const dx = ox > 0 ? 0 : Math.min(Math.abs(ob.minX - gb.maxX), Math.abs(gb.minX - ob.maxX));
        const dy = oy > 0 ? 0 : Math.min(Math.abs(ob.minY - gb.maxY), Math.abs(gb.minY - ob.maxY));
        if (dx <= gap && dy <= gap) {
          group.push(other);
          used.add(other);
          grew = true;
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
