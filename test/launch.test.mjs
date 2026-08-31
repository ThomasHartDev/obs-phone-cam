import { test } from "node:test";
import assert from "node:assert/strict";
import { launchUrls, openLaunchTabs } from "../launch.mjs";

test("launch opens phone and iPad pair pages, not live sender/board slots", () => {
  const urls = launchUrls(8443);
  assert.equal(urls.length, 2);
  assert.equal(urls[0], "https://localhost:8443/pair.html?for=phone");
  assert.equal(urls[1], "https://localhost:8443/pair.html?for=ipad");
  assert.equal(
    urls.some((u) => u.includes("sender.html") || u.includes("board.html")),
    false,
  );
});

test("openLaunchTabs staggers calls and no-ops without a function", () => {
  const hits = [];
  openLaunchTabs((u) => hits.push(u), ["a", "b"], 0);
  assert.equal(hits.length, 0);
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.deepEqual(hits, ["a", "b"]);
      openLaunchTabs(null, ["x"]);
      resolve();
    }, 20);
  });
});
