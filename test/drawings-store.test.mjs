import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createDrawingsStore,
  isDocId,
} from "../drawings-store.mjs";
import { createDoc, sanitizeTitle, sceneToDoc, applyDocToScene } from "../public/board-docs.js";
import { createBoard, beginInk } from "../public/board-engine.js";

test("sanitizeTitle and ids", () => {
  assert.equal(sanitizeTitle("  Hello   board  "), "Hello board");
  assert.equal(sanitizeTitle("x".repeat(200)).length, 80);
  assert.equal(isDocId("d_abc_123"), true);
  assert.equal(isDocId("../etc"), false);
  assert.equal(isDocId("a"), false);
});

test("store put/list/get/remove round trip", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "obscam-draw-"));
  const store = createDrawingsStore(dir);
  const a = await store.put(
    createDoc({ id: "d_test_aaaaaa", title: "Intro", items: [{ kind: "text", color: "#000", size: 12, x: 1, y: 2, text: "hi" }] }),
  );
  const b = await store.put(createDoc({ id: "d_test_bbbbbb", title: "Second" }));
  const listed = await store.list();
  assert.equal(listed.length, 2);
  assert.equal(listed[0].id, b.id);
  const loaded = await store.get(a.id);
  assert.equal(loaded.title, "Intro");
  assert.equal(loaded.items[0].text, "hi");
  assert.equal(await store.remove(a.id), true);
  assert.equal((await store.list()).length, 1);
  assert.equal(await store.get(a.id), null);
});

test("scene round trip keeps ink", () => {
  const scene = createBoard();
  beginInk(scene, "pen", "#e24a3b", 4, 10, 10, 1);
  const doc = sceneToDoc(createDoc({ title: "Take" }), scene);
  const next = createBoard();
  applyDocToScene(doc, next);
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].color, "#e24a3b");
  assert.equal(next.history.length, 0);
});
