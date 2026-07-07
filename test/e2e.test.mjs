// End-to-end proof the WebRTC path works: a headless Chrome "phone" with a fake
// camera streams to the receiver page, and we assert real video frames arrive.
// The physical-iPhone leg can't be automated (real camera); see docs/manual-tests.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = 8788;
const BASE = `https://localhost:${PORT}`;

let server;
let browser;

before(async () => {
  server = spawn("node", ["server.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) } });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 10000);
    server.stdout.on("data", (d) => {
      if (d.toString().includes("is running")) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on("data", (d) => process.stderr.write(d));
  });
  browser = await chromium.launch({
    channel: "chrome",
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--ignore-certificate-errors",
    ],
  });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

test("phone sender streams live frames into the OBS receiver page", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });

  // OBS Browser Source loads first and waits.
  const receiver = await ctx.newPage();
  await receiver.goto(`${BASE}/receiver.html`);

  // Phone opens the sender page; fake camera auto-grants.
  const sender = await ctx.newPage();
  await sender.goto(`${BASE}/sender.html`);

  // The receiver's <video> should get a live track with real dimensions.
  await receiver.waitForFunction(
    () => {
      const v = document.getElementById("feed");
      return v && v.srcObject && v.videoWidth > 0 && v.videoHeight > 0;
    },
    { timeout: 20000 },
  );

  const dims = await receiver.evaluate(() => {
    const v = document.getElementById("feed");
    return { w: v.videoWidth, h: v.videoHeight, hidden: document.getElementById("hint").classList.contains("hidden") };
  });
  assert.ok(dims.w > 0 && dims.h > 0, `expected real frame dimensions, got ${dims.w}x${dims.h}`);
  assert.equal(dims.hidden, true, "waiting hint should be hidden once frames arrive");

  // Confirm the peer connection actually reached "connected", not just a stale srcObject.
  const state = await sender.evaluate(async () => {
    // give ICE a moment, then read the RTCPeerConnection state the page exposes
    return new Promise((resolve) => {
      const check = () => {
        const el = document.getElementById("status");
        if (el.textContent.includes("Live")) resolve("connected");
      };
      const iv = setInterval(check, 250);
      setTimeout(() => {
        clearInterval(iv);
        resolve(document.getElementById("status").textContent);
      }, 8000);
    });
  });
  assert.equal(state, "connected", `sender never reported Live, last status: ${state}`);

  await ctx.close();
});
