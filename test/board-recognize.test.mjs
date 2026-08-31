import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recognizeStroke,
  lineScore,
  rectScore,
  ellipseScore,
  looksLikeHandwriting,
  snapTextBox,
  clusterInk,
} from "../public/board-recognize.js";

function line(x0, y0, x1, y1, n = 20) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push({
      x: x0 + (x1 - x0) * t + (i % 2 === 0 ? 0.4 : -0.4),
      y: y0 + (y1 - y0) * t,
    });
  }
  return pts;
}

function rectPath(x, y, w, h) {
  return [
    ...line(x, y, x + w, y, 16).slice(0, -1),
    ...line(x + w, y, x + w, y + h, 16).slice(0, -1),
    ...line(x + w, y + h, x, y + h, 16).slice(0, -1),
    ...line(x, y + h, x, y, 16),
  ];
}

function ellipsePath(cx, cy, rx, ry, n = 48) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  }
  return pts;
}

test("straight ink scores as a line, not a box", () => {
  const pts = line(10, 10, 200, 24);
  assert.ok(lineScore(pts) > 0.85);
  assert.equal(recognizeStroke(pts).tool, "line");
});

test("freehand box becomes a rect", () => {
  const pts = rectPath(40, 40, 120, 80);
  assert.ok(rectScore(pts) > 0.8);
  const rec = recognizeStroke(pts);
  assert.equal(rec.tool, "rect");
  assert.ok(rec.b.x - rec.a.x > 100);
});

test("closed oval becomes an ellipse, not a rect", () => {
  const pts = ellipsePath(100, 80, 70, 40);
  assert.ok(ellipseScore(pts) > 0.75);
  assert.equal(recognizeStroke(pts).tool, "ellipse");
});

test("scribble is not a shape", () => {
  const pts = [];
  for (let i = 0; i < 40; i++) {
    pts.push({ x: 20 + i * 3, y: 40 + Math.sin(i * 1.7) * 18 + (i % 5) * 4 });
  }
  assert.equal(recognizeStroke(pts), null);
  assert.equal(looksLikeHandwriting(pts), true);
});

test("snap above when close, origin when far", () => {
  const box = {
    kind: "shape",
    tool: "rect",
    a: { x: 0, y: 100 },
    b: { x: 200, y: 180 },
  };
  const close = { minX: 20, minY: 60, maxX: 160, maxY: 85, w: 140, h: 25 };
  const far = { minX: 20, minY: 0, maxX: 160, maxY: 20, w: 140, h: 20 };
  assert.equal(snapTextBox(close, [box], 20).where, "above");
  assert.equal(snapTextBox(far, [box], 20).where, "origin");
});

test("snap inside a containing rect", () => {
  const box = {
    kind: "shape",
    tool: "rect",
    a: { x: 0, y: 0 },
    b: { x: 200, y: 120 },
  };
  const ink = { minX: 30, minY: 20, maxX: 90, maxY: 40, w: 60, h: 20 };
  assert.equal(snapTextBox(ink, [box], 18).where, "inside");
});

test("clusterInk groups nearby strokes and splits far ones", () => {
  const a = { kind: "ink", tool: "pen", points: line(0, 0, 20, 0, 4) };
  const b = { kind: "ink", tool: "pen", points: line(24, 2, 40, 2, 4) };
  const c = { kind: "ink", tool: "pen", points: line(200, 0, 220, 0, 4) };
  const groups = clusterInk([a, b, c], 20);
  assert.equal(groups.length, 2);
});
