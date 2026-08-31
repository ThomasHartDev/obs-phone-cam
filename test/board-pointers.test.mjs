import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shouldIgnoreTouch,
  shouldStartPinch,
  dropTouches,
  hasPen,
} from "../public/board-pointers.js";

test("palm touch is ignored while the pencil is down", () => {
  const pointers = new Map([
    [1, { type: "pen", x: 10, y: 10 }],
  ]);
  assert.equal(shouldIgnoreTouch("touch", pointers, false), true);
  assert.equal(shouldIgnoreTouch("pen", pointers, false), false);
  assert.equal(shouldIgnoreTouch("touch", new Map(), true), true);
  assert.equal(shouldIgnoreTouch("touch", new Map(), false), false);
});

test("pinch starts only with two fingers, not pencil plus palm", () => {
  const palmAndPen = new Map([
    [1, { type: "pen" }],
    [2, { type: "touch" }],
  ]);
  assert.equal(shouldStartPinch(palmAndPen), false);
  const twoFingers = new Map([
    [3, { type: "touch" }],
    [4, { type: "touch" }],
  ]);
  assert.equal(shouldStartPinch(twoFingers), true);
  assert.equal(shouldStartPinch(new Map([[5, { type: "touch" }]])), false);
});

test("dropTouches keeps the pen pointer", () => {
  const pointers = new Map([
    [1, { type: "pen" }],
    [2, { type: "touch" }],
  ]);
  dropTouches(pointers);
  assert.equal(hasPen(pointers), true);
  assert.equal(pointers.size, 1);
});
