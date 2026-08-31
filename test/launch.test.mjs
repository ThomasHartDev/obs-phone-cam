import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchUrls, openLaunchTabs } from "../launch.mjs";

test("launch opens controls plus phone and iPad feed viewers", () => {
  const urls = launchUrls(8443, 8444);
  assert.deepEqual(urls, [
    "https://localhost:8443/",
    "http://localhost:8444/receiver.html",
    "http://localhost:8444/board-receiver.html",
  ]);
  assert.equal(
    urls.some((u) => u.includes("sender.html") || u.includes("board.html")),
    false,
    "must not open live sender/board slots on the laptop",
  );
});

test("Phone Cam.exe opens the same three URLs as launchUrls", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cs = fs.readFileSync(
    path.join(here, "..", "windows", "PhoneCam.cs"),
    "utf8",
  );
  for (const url of launchUrls(8443, 8444)) {
    assert.ok(cs.includes(url), "exe source missing " + url);
  }
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
