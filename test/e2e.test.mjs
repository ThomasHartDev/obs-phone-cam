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

// --- filter pipeline ---
// Read the mean RGB of a horizontal slice of the sent WebGL canvas by copying
// it into a 2D canvas (preserveDrawingBuffer makes that reliable).
async function readMean(page, x0f = 0, x1f = 1) {
  return page.evaluate(
    ({ x0f, x1f }) => {
      const src = document.getElementById("preview");
      const w = src.width,
        h = src.height;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const cx = c.getContext("2d");
      cx.drawImage(src, 0, 0);
      const x0 = Math.floor(w * x0f);
      const x1 = Math.max(x0 + 1, Math.floor(w * x1f));
      const d = cx.getImageData(x0, 0, x1 - x0, h).data;
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let i = 0; i < d.length; i += 4) {
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
      return [r / n, g / n, b / n];
    },
    { x0f, x1f },
  );
}
const setParam = (page, p, v) =>
  page.evaluate(
    ({ p, v }) => {
      const el = document.querySelector(`input[data-p="${p}"]`);
      el.value = String(v);
      el.dispatchEvent(new Event("input"));
    },
    { p, v },
  );
const spread = ([r, g, b]) => Math.abs(r - g) + Math.abs(g - b);
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
async function avg(fn, times = 6) {
  let s = 0;
  for (let i = 0; i < times; i++) {
    s += await fn();
    await new Promise((r) => setTimeout(r, 60));
  }
  return s / times;
}

test("the color grade actually alters the sent frame (and A/B bypasses it)", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const sender = await ctx.newPage();
  await sender.goto(`${HTTPS_BASE}/sender.html`);
  await sender.waitForFunction(
    () => document.getElementById("preview").width > 0,
    { timeout: 20000 },
  );

  // Desaturate fully: the graded frame should be near-grayscale (r≈g≈b),
  // independent of the moving test pattern's content.
  await setParam(sender, "saturation", 0);
  const gradedSpread = await avg(() => readMean(sender).then(spread));

  // Hold A/B: renders the raw frame, which is colored -> much higher spread.
  await sender.evaluate(() =>
    document
      .getElementById("ab")
      .dispatchEvent(new Event("pointerdown", { bubbles: true })),
  );
  const rawSpread = await avg(() => readMean(sender).then(spread));

  assert.ok(
    gradedSpread < 6,
    `desaturated grade should be near-grayscale, got spread ${gradedSpread.toFixed(2)}`,
  );
  assert.ok(
    rawSpread > gradedSpread + 8,
    `A/B raw should be more colored than the grade (raw ${rawSpread.toFixed(2)} vs graded ${gradedSpread.toFixed(2)})`,
  );
  await ctx.close();
});

test("exposure slider changes overall brightness", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const sender = await ctx.newPage();
  await sender.goto(`${HTTPS_BASE}/sender.html`);
  await sender.waitForFunction(
    () => document.getElementById("preview").width > 0,
    { timeout: 20000 },
  );

  await setParam(sender, "exposure", 1);
  const bright = await avg(() => readMean(sender).then(luma));
  await setParam(sender, "exposure", -1);
  const dark = await avg(() => readMean(sender).then(luma));

  assert.ok(
    bright > dark + 20,
    `+1 stop should be clearly brighter than -1 (bright ${bright.toFixed(1)} vs dark ${dark.toFixed(1)})`,
  );
  await ctx.close();
});

test("Slim face narrows a centered subject (deterministic, synthetic frame)", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(`${HTTPS_BASE}/`); // same origin so we can import the module

  const w = await page.evaluate(async () => {
    const { CameraFilter, DEFAULT_PARAMS } = await import("/filters.js");
    const S = 400,
      barHalf = 40; // 80px white bar centered on black
    const src = document.createElement("canvas");
    src.width = S;
    src.height = S;
    const sx = src.getContext("2d");
    sx.fillStyle = "#000";
    sx.fillRect(0, 0, S, S);
    sx.fillStyle = "#fff";
    sx.fillRect(S / 2 - barHalf, 0, barHalf * 2, S);

    const target = document.createElement("canvas");
    const f = new CameraFilter(target);
    const readback = document.createElement("canvas");
    readback.width = S;
    readback.height = S;
    const rx = readback.getContext("2d");
    const measure = (slim) => {
      f.setSize(S, S);
      f.render(src, 0, { ...DEFAULT_PARAMS, slim }, S, S);
      rx.clearRect(0, 0, S, S);
      rx.drawImage(target, 0, 0);
      const row = rx.getImageData(0, S / 2, S, 1).data;
      let n = 0;
      for (let i = 0; i < row.length; i += 4) if (row[i] > 128) n++;
      return n; // white pixels across the middle row = subject width
    };
    return { base: measure(0), slim: measure(0.3) };
  });

  assert.ok(w.base > 40, `bar should be visible at slim 0, got ${w.base}px`);
  assert.ok(
    w.slim < w.base * 0.88,
    `slim should narrow the subject (base ${w.base}px -> slim ${w.slim}px)`,
  );
  await ctx.close();
});

test("sender raises the encode bitrate well above the WebRTC default", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const receiver = await ctx.newPage();
  await receiver.goto(`${HTTP_BASE}/receiver.html`);
  const sender = await ctx.newPage();
  await sender.goto(`${HTTPS_BASE}/sender.html`);

  await sender.waitForFunction(() => !!document.body.dataset.maxBitrate, {
    timeout: 20000,
  });
  const bitrate = await sender.evaluate(() =>
    Number(document.body.dataset.maxBitrate),
  );
  // Default WebRTC caps ~2.5 Mbps; 1080p should be lifted to 14 Mbps.
  assert.ok(
    bitrate >= 10_000_000,
    `expected a raised bitrate ceiling, got ${bitrate}`,
  );

  await ctx.close();
});
