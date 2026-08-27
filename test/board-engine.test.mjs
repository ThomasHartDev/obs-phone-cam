import { test } from "node:test";
import assert from "node:assert/strict";
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
} from "../public/board-engine.js";

test("ink stroke records points and undo/redo restores it", () => {
  const board = createBoard();
  const ink = beginInk(board, "pen", "#e24a3b", 6, 10, 10, 1);
  addPoint(ink, 40, 12, 1);
  addPoint(ink, 80, 18, 0.8);
  assert.equal(board.items.length, 1);
  assert.ok(ink.points.length >= 2);
  assert.equal(undo(board), true);
  assert.equal(board.items.length, 0);
  assert.equal(redo(board), true);
  assert.equal(board.items[0].color, "#e24a3b");
});

test("eraser removes a nearby stroke and leaves a distant one", () => {
  const board = createBoard();
  beginInk(board, "pen", "#000", 4, 10, 10, 1);
  beginInk(board, "pen", "#000", 4, 400, 400, 1);
  assert.equal(eraseAt(board, 12, 12, 20), true);
  assert.equal(board.items.length, 1);
  assert.equal(board.items[0].points[0].x, 400);
  assert.equal(eraseAt(board, 12, 12, 20), false);
});

test("shape + text + clear + paper", () => {
  const board = createBoard();
  const shape = beginShape(board, "arrow", "#2f6fed", 3, 0, 0);
  setShapeEnd(shape, 100, 40);
  addText(board, "#1a1d23", 24, 8, 50, "hello");
  assert.equal(board.items.length, 2);
  assert.equal(setPaper(board, "green"), true);
  assert.equal(board.paper, "green");
  assert.equal(setPaper(board, "nope"), false);
  assert.equal(clearBoard(board), true);
  assert.equal(board.items.length, 0);
});
