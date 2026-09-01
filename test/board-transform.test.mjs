import { test } from "node:test";
import assert from "node:assert/strict";
import {
  translateItem,
  rotateItem,
  hitItem,
  itemCenter,
  rotateHandle,
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
