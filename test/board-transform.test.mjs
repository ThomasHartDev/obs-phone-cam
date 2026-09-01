import { test } from "node:test";
import assert from "node:assert/strict";
import {
  translateItem,
  rotateItem,
  hitItem,
  hitTop,
  itemCenter,
  rotateHandle,
  bringToFront,
  sendToBack,
  zoomAt,
  applyPinchView,
  resetView,
} from "../public/board-transform.js";

test("translateItem moves a rect", () => {
  const item = {
    kind: "shape",
    tool: "rect",
    a: { x: 0, y: 0 },
    b: { x: 40, y: 20 },
  };
  translateItem(item, 10, 5);
  assert.equal(item.a.x, 10);
  assert.equal(item.b.y, 25);
});

test("rotateItem then hit uses rotated space", () => {
  const item = {
    kind: "shape",
    tool: "rect",
    a: { x: 0, y: 40 },
    b: { x: 80, y: 50 },
    rot: 0,
  };
  const c = itemCenter(item);
  assert.ok(hitItem(item, c.x, c.y));
  rotateItem(item, Math.PI / 2);
  assert.ok(hitItem(item, c.x, c.y));
  assert.equal(Math.abs((item.rot || 0) - Math.PI / 2) < 1e-9, true);
});

test("rotate handle sits above the box", () => {
  const item = {
    kind: "shape",
    tool: "rect",
    a: { x: 0, y: 0 },
    b: { x: 40, y: 40 },
  };
  const h = rotateHandle(item);
  const c = itemCenter(item);
  assert.ok(h.y < c.y);
  assert.ok(Math.abs(h.x - c.x) < 0.01);
});

test("line hits the stroke, not the empty bbox", () => {
  const item = {
    kind: "shape",
    tool: "line",
    width: 4,
    a: { x: 0, y: 0 },
    b: { x: 200, y: 0 },
  };
  assert.equal(hitItem(item, 100, 0), true);
  assert.equal(hitItem(item, 100, 80), false);
});

test("circle hits the rim, not the hollow middle", () => {
  const item = {
    kind: "shape",
    tool: "ellipse",
    width: 4,
    a: { x: 0, y: 0 },
    b: { x: 200, y: 200 },
  };
  assert.equal(hitItem(item, 100, 0), true);
  assert.equal(hitItem(item, 100, 100), false);
});

test("text moves and still hits", () => {
  const item = { kind: "text", text: "Hello", size: 24, x: 10, y: 20 };
  translateItem(item, 40, 10);
  assert.equal(item.x, 50);
  assert.equal(item.y, 30);
  assert.equal(hitItem(item, 55, 35), true);
  rotateItem(item, 0.4);
  assert.ok(Math.abs(item.rot - 0.4) < 1e-9);
});

test("hitTop picks the later layer on the same stroke", () => {
  const back = {
    kind: "shape",
    tool: "line",
    width: 4,
    a: { x: 0, y: 10 },
    b: { x: 100, y: 10 },
  };
  const front = {
    kind: "shape",
    tool: "line",
    width: 4,
    a: { x: 0, y: 10 },
    b: { x: 100, y: 10 },
  };
  assert.equal(hitTop([back, front], 50, 10), front);
});

test("bringToFront / sendToBack reorder layers", () => {
  const a = { id: "a" };
  const b = { id: "b" };
  const c = { id: "c" };
  const items = [a, b, c];
  bringToFront(items, a);
  assert.equal(items[2], a);
  sendToBack(items, a);
  assert.equal(items[0], a);
});

test("zoomAt keeps the world point under the cursor", () => {
  const view = { panX: 0, panY: 0, scale: 1, w: 800, h: 600 };
  zoomAt(view, 2, 200, 100);
  assert.equal(view.scale, 2);
  assert.equal((200 - view.panX) / view.scale, 200);
  assert.equal((100 - view.panY) / view.scale, 100);
});

test("pinch zooms around the finger midpoint", () => {
  const view = { panX: 0, panY: 0, scale: 1 };
  const pinch = { dist: 100, panX: 0, panY: 0, scale: 1, cx: 120, cy: 80 };
  applyPinchView(view, pinch, { x: 70, y: 80 }, { x: 170, y: 80 });
  assert.equal(view.scale, 1);
  applyPinchView(view, pinch, { x: 20, y: 80 }, { x: 220, y: 80 });
  assert.equal(view.scale, 2);
  assert.equal((120 - view.panX) / view.scale, 120);
});

test("resetView returns to 1x at the origin", () => {
  const view = { panX: 40, panY: -12, scale: 2.5 };
  resetView(view);
  assert.equal(view.scale, 1);
  assert.equal(view.panX, 0);
  assert.equal(view.panY, 0);
});
