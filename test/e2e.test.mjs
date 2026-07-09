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
const HTTPS_BASE = `https://localhost:${PORT}`;
const HTTP_BASE = `http://localhost:${PORT + 1}`;

let server;
let browser;

before(async () => {
  server = spawn("node", ["server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), OBS_NO_OPEN: "1" },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("server did not start")),
      10000,
    );
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

  // OBS Browser Source loads the receiver over plain http (its real-world path).
  const receiver = await ctx.newPage();
  await receiver.goto(`${HTTP_BASE}/receiver.html`);

  // Phone opens the sender page over https; fake camera auto-grants.
  const sender = await ctx.newPage();
  await sender.goto(`${HTTPS_BASE}/sender.html`);

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
    return {
      w: v.videoWidth,
      h: v.videoHeight,
      hidden: document.getElementById("hint").classList.contains("hidden"),
    };
  });
  assert.ok(
    dims.w > 0 && dims.h > 0,
    `expected real frame dimensions, got ${dims.w}x${dims.h}`,
  );
  assert.equal(
    dims.hidden,
    true,
    "waiting hint should be hidden once frames arrive",
  );

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
  assert.equal(
    state,
    "connected",
    `sender never reported Live, last status: ${state}`,
  );

  await ctx.close();
});

test("a second sender tab supersedes the first without a reconnect war", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const receiver = await ctx.newPage();
  await receiver.goto(`${HTTP_BASE}/receiver.html`);

  // Two sender tabs open (the exact repro: sender page in two Safari tabs),
  // a beat apart like a real second tab.
  const senderA = await ctx.newPage();
  await senderA.goto(`${HTTPS_BASE}/sender.html`);
  await senderA.waitForTimeout(1500);
  const senderB = await ctx.newPage();
  await senderB.goto(`${HTTPS_BASE}/sender.html`);

  // The newer tab (B) wins the single sender slot; the older (A) is told it was
  // superseded and must NOT keep reconnecting.
  await senderA.waitForFunction(
    () => document.getElementById("status").textContent.includes("Another tab"),
    { timeout: 10000 },
  );

  // Give any reconnect war time to manifest, then assert A stayed superseded
  // (a war would flip A back to a connecting/live state).
  await senderA.waitForTimeout(3000);
  const aStatus = await senderA.evaluate(
    () => document.getElementById("status").textContent,
  );
  assert.ok(
    aStatus.includes("Another tab"),
    `superseded tab should stay parked, got: ${aStatus}`,
  );

  // The winning tab still delivers live frames to the receiver.
  await receiver.waitForFunction(
    () => {
      const v = document.getElementById("feed");
      return v && v.srcObject && v.videoWidth > 0;
    },
    { timeout: 20000 },
  );

  await ctx.close();
});

test("Rotate flips the frame the receiver gets from landscape to portrait", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const receiver = await ctx.newPage();
  await receiver.goto(`${HTTP_BASE}/receiver.html`);
  const sender = await ctx.newPage();
  await sender.goto(`${HTTPS_BASE}/sender.html`);

  await receiver.waitForFunction(
    () => {
      const v = document.getElementById("feed");
      return v && v.videoWidth > 0 && v.videoHeight > 0;
    },
    { timeout: 20000 },
  );
  const before = await receiver.evaluate(() => {
    const v = document.getElementById("feed");
    return { w: v.videoWidth, h: v.videoHeight };
  });
  assert.ok(
    before.w > before.h,
    `expected landscape first, got ${before.w}x${before.h}`,
  );

  // One Rotate tap rotates the sent canvas 90°, which must swap the receiver's dims.
  await sender.click("#rotate");
  await receiver.waitForFunction(
    () => {
      const v = document.getElementById("feed");
      return v.videoHeight > v.videoWidth;
    },
    { timeout: 8000 },
  );
  const after = await receiver.evaluate(() => {
    const v = document.getElementById("feed");
    return { w: v.videoWidth, h: v.videoHeight };
  });
  assert.ok(
    after.h > after.w,
    `expected portrait after Rotate, got ${after.w}x${after.h}`,
  );

  await ctx.close();
});
