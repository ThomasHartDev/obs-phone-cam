import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchUrls, openLaunchTabs } from "../launch.mjs";

test("launch opens controls plus phone and iPad feed viewers", () => {
  const urls = launchUrls(8443, 8444);
  assert.deepEqual(urls, [
    "http://localhost:8444/",
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

test("Phone Cam QR points at the pairing page", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cs = fs.readFileSync(
    path.join(here, "..", "windows", "PhoneCamQr.cs"),
    "utf8",
  );
  assert.ok(cs.includes("http://localhost:8444/pair.html"));
  assert.ok(
    fs.existsSync(path.join(here, "..", "public", "pair.html")),
    "pair page must exist",
  );
});

test("Studio starts the server before OBS, then shows the pairing QR", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cs = fs.readFileSync(
    path.join(here, "..", "windows", "PhoneCamStudio.cs"),
    "utf8",
  );
  const main = cs.slice(cs.indexOf("static void Main"));
  const server = main.indexOf("PhoneCamServer.EnsureRunning");
  const obs = main.indexOf("Process.Start");
  const qr = main.indexOf("PhoneCamQr.ShowPairWindow");
  assert.ok(server >= 0 && obs > server, "server must start before OBS");
  assert.ok(qr > obs, "QR must open after OBS so it lands on top");
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
