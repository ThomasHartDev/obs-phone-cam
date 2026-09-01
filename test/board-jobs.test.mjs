import { test } from "node:test";
import assert from "node:assert/strict";
import { enqueue, pendingCount, resetJobs } from "../public/board-jobs.js";
import { createBoard, beginInk, snapshotExcluding, undo } from "../public/board-engine.js";

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

test("enqueue does not run the job on the calling stack", async () => {
  resetJobs();
  let ran = 0;
  enqueue(() => {
    ran += 1;
  });
  assert.equal(ran, 0);
  assert.ok(pendingCount() >= 1);
  await flush();
  assert.equal(ran, 1);
});

test("jobs run in order, one after another", async () => {
  resetJobs();
  const order = [];
  enqueue(() => order.push("a"));
  enqueue(() => order.push("b"));
  enqueue(() => order.push("c"));
  await flush();
  assert.deepEqual(order, ["a", "b", "c"]);
});

test("deferred snapshot still undoes the live stroke", () => {
  const board = createBoard();
  const ink = beginInk(board, "pen", "#000", 4, 1, 1, 1, false);
  assert.equal(board.history.length, 0);
  assert.equal(board.items.length, 1);
  snapshotExcluding(board, ink);
  assert.equal(undo(board), true);
  assert.equal(board.items.length, 0);
});
