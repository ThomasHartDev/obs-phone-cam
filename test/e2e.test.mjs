// End-to-end proof the WebRTC path works: a headless Chrome "phone" with a fake
// camera streams to the receiver page, and we assert real video frames arrive.
// The physical-iPhone leg can't be automated (real camera); see docs/manual-tests.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = 8788;
const HTTPS_BASE = `https://localhost:${PORT}`;
const HTTP_BASE = `http://localhost:${PORT + 1}`;
const DRAW_DIR = path.join(os.tmpdir(), "obscam-drawings-e2e");

let server;
let browser;

describe("obs-phone-cam e2e", { concurrency: 1 }, () => {
before(async () => {
  fs.mkdirSync(DRAW_DIR, { recursive: true });
  server = spawn("node", ["server.mjs"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      OBS_NO_OPEN: "1",
      DRAWINGS_DIR: DRAW_DIR,
    },
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
  try {
    const receiver = await ctx.newPage();
    await receiver.goto(`${HTTP_BASE}/receiver.html`);

    const senderA = await ctx.newPage();
    await senderA.goto(`${HTTPS_BASE}/sender.html`);
    await senderA.waitForFunction(
      () => (document.getElementById("status")?.textContent || "").length > 5,
      null,
      { timeout: 20000 },
    );
    const senderB = await ctx.newPage();
    await senderB.goto(`${HTTPS_BASE}/sender.html`);

    await senderA.waitForFunction(
      () =>
        (document.getElementById("status")?.textContent || "").includes(
          "Another tab",
        ),
      null,
      { timeout: 15000 },
    );

    await senderA.waitForTimeout(2000);
    const aStatus = await senderA.evaluate(
      () => document.getElementById("status").textContent,
    );
    assert.ok(
      aStatus.includes("Another tab"),
      `superseded tab should stay parked, got: ${aStatus}`,
    );

    await receiver.waitForFunction(
      () => {
        const v = document.getElementById("feed");
        return v && v.srcObject && v.videoWidth > 0;
      },
      null,
      { timeout: 20000 },
    );
  } finally {
    await ctx.close();
  }
});

test("Rotate flips the frame the receiver gets from landscape to portrait", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
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
  } finally {
    await ctx.close();
  }
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

test("background blur: masked background loses detail, subject stays sharp", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(`${HTTPS_BASE}/`);

  const r = await page.evaluate(async () => {
    const { CameraFilter, DEFAULT_PARAMS } = await import("/filters.js");
    const S = 256;
    // high-frequency checkerboard everywhere so "blur" = measurable detail loss
    const src = document.createElement("canvas");
    src.width = S;
    src.height = S;
    const sx = src.getContext("2d");
    for (let y = 0; y < S; y += 8)
      for (let x = 0; x < S; x += 8) {
        sx.fillStyle = ((x / 8 + y / 8) & 1) === 0 ? "#fff" : "#000";
        sx.fillRect(x, y, 8, 8);
      }
    // mask: left half = subject (255), right half = background (0)
    const mask = new Uint8Array(S * S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) mask[y * S + x] = x < S / 2 ? 255 : 0;

    const target = document.createElement("canvas");
    const f = new CameraFilter(target);
    f.setSize(S, S);
    f.setMask(mask, S, S);
    f.render(src, 0, { ...DEFAULT_PARAMS, blur: 1 }, S, S);

    const rd = document.createElement("canvas");
    rd.width = S;
    rd.height = S;
    const rx = rd.getContext("2d");
    rx.drawImage(target, 0, 0);
    // horizontal detail energy in a column band, averaged over middle rows
    const detail = (x0f, x1f) => {
      const x0 = Math.floor(S * x0f),
        x1 = Math.floor(S * x1f);
      let e = 0;
      for (let y = S * 0.3; y < S * 0.7; y++) {
        const row = rx.getImageData(x0, y, x1 - x0, 1).data;
        for (let i = 0; i < row.length - 4; i += 4)
          e += Math.abs(row[i] - row[i + 4]);
      }
      return e;
    };
    return { subject: detail(0.15, 0.35), background: detail(0.65, 0.85) };
  });

  assert.ok(r.subject > 1000, `subject side should keep detail, got ${r.subject}`);
  assert.ok(
    r.background < r.subject * 0.6,
    `background should be blurred vs subject (subject ${r.subject}, background ${r.background})`,
  );
  await ctx.close();
});

test("MediaPipe segmentation assets are served with the right MIME", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const check = async (path) =>
    page.evaluate(async (p) => {
      const r = await fetch(p);
      return { ok: r.ok, ct: r.headers.get("content-type") };
    }, path);
  await page.goto(`${HTTPS_BASE}/`);
  const wasm = await check("/vendor/mediapipe/wasm/vision_wasm_internal.wasm");
  const model = await check("/vendor/mediapipe/selfie_segmenter.tflite");
  const bundle = await check("/vendor/mediapipe/vision_bundle.mjs");
  assert.equal(wasm.ok, true, "wasm should serve");
  assert.match(wasm.ct, /application\/wasm/, `wasm MIME was ${wasm.ct}`);
  assert.equal(model.ok, true, "model should serve");
  assert.equal(bundle.ok, true, "vision bundle should serve");
  assert.match(bundle.ct, /javascript/, `bundle MIME was ${bundle.ct}`);
  await ctx.close();
});

test("MediaPipe selfie segmentation loads and returns a mask in-browser", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(`${HTTPS_BASE}/`);
  const info = await page.evaluate(async () => {
    const vision = await import("/vendor/mediapipe/vision_bundle.mjs");
    const fileset = await vision.FilesetResolver.forVisionTasks(
      "/vendor/mediapipe/wasm",
    );
    const seg = await vision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "/vendor/mediapipe/selfie_segmenter.tflite",
      },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 256;
    const g = c.getContext("2d");
    g.fillStyle = "#888";
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = "#c98";
    g.beginPath();
    g.arc(128, 128, 60, 0, 7);
    g.fill();
    const res = seg.segmentForVideo(c, performance.now());
    const m = res.confidenceMasks && res.confidenceMasks[0];
    const out = m ? { w: m.width, h: m.height } : null;
    if (res.close) res.close();
    if (seg.close) seg.close();
    return out;
  });
  assert.ok(
    info && info.w > 0 && info.h > 0,
    `expected a real mask from the model, got ${JSON.stringify(info)}`,
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

// --- laptop remote control ---
// Controller role on the landing page drives the phone over WS without
// stealing the OBS receiver slot.

test("laptop controller can set exposure and mirror on the phone", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  // Phone + OBS path first so the sender is live.
  const receiver = await ctx.newPage();
  await receiver.goto(`${HTTP_BASE}/receiver.html`);
  const sender = await ctx.newPage();
  await sender.goto(`${HTTPS_BASE}/sender.html`);
  await sender.waitForFunction(
    () => document.getElementById("preview").width > 0,
    { timeout: 20000 },
  );

  // Laptop landing page = controller role.
  const control = await ctx.newPage();
  await control.goto(`${HTTPS_BASE}/`);
  await control.waitForFunction(
    () => window.__obscamRemote && window.__obscamRemote.phonePresent,
    { timeout: 15000 },
  );
  // Wait for the first state dump from the phone.
  await control.waitForFunction(
    () => window.__obscamRemote.lastState?.params,
    { timeout: 10000 },
  );

  // Drive exposure remotely and assert the phone's live params update.
  await control.evaluate(() =>
    window.__obscamRemote.send({
      type: "control",
      op: "params",
      params: { exposure: 0.55 },
    }),
  );
  await sender.waitForFunction(
    () => window.__obscam?.params?.exposure === 0.55,
    { timeout: 8000 },
  );

  // Mirror toggle from the laptop quick-access button.
  await control.click("#rcMirror");
  await sender.waitForFunction(() => window.__obscam?.params?.mirror === true, {
    timeout: 8000,
  });
  // Laptop UI should reflect the phone's state broadcast.
  await control.waitForFunction(
    () => window.__obscamRemote.lastState?.params?.mirror === true,
    { timeout: 8000 },
  );

  // Controller must NOT have stolen the OBS receiver: frames still flow.
  await receiver.waitForFunction(
    () => {
      const v = document.getElementById("feed");
      return v && v.srcObject && v.videoWidth > 0;
    },
    { timeout: 10000 },
  );

  await ctx.close();
});

test("laptop rotate + resolution controls reach the sender", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const receiver = await ctx.newPage();
  await receiver.goto(`${HTTP_BASE}/receiver.html`);
  const sender = await ctx.newPage();
  await sender.goto(`${HTTPS_BASE}/sender.html`);
  await sender.waitForFunction(
    () => document.getElementById("preview").width > 0,
    { timeout: 20000 },
  );

  const control = await ctx.newPage();
  await control.goto(`${HTTPS_BASE}/`);
  await control.waitForFunction(
    () => window.__obscamRemote?.lastState?.params,
    { timeout: 15000 },
  );

  const before = await sender.evaluate(() => window.__obscam.rotationOffset);
  await control.click("#rcRotate");
  await sender.waitForFunction(
    (prev) => window.__obscam.rotationOffset === (prev + 90) % 360,
    before,
    { timeout: 8000 },
  );

  await control.selectOption("#rcRes", "1280x720");
  await sender.waitForFunction(() => window.__obscam.res === "1280x720", {
    timeout: 10000,
  });

  await ctx.close();
});

test("Flip V reverses top/bottom of a synthetic frame", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(`${HTTPS_BASE}/`);

  const r = await page.evaluate(async () => {
    const { CameraFilter, DEFAULT_PARAMS } = await import("/filters.js");
    const S = 200;
    const src = document.createElement("canvas");
    src.width = S;
    src.height = S;
    const sx = src.getContext("2d");
    // top half white, bottom half black — flipV should invert that
    sx.fillStyle = "#fff";
    sx.fillRect(0, 0, S, S / 2);
    sx.fillStyle = "#000";
    sx.fillRect(0, S / 2, S, S / 2);

    const target = document.createElement("canvas");
    const f = new CameraFilter(target);
    const readback = document.createElement("canvas");
    readback.width = S;
    readback.height = S;
    const rx = readback.getContext("2d");
    const measure = (flipV) => {
      f.setSize(S, S);
      f.render(src, 0, { ...DEFAULT_PARAMS, flipV }, S, S);
      rx.clearRect(0, 0, S, S);
      rx.drawImage(target, 0, 0);
      const top = rx.getImageData(S / 2, 10, 1, 1).data[0];
      const bot = rx.getImageData(S / 2, S - 10, 1, 1).data[0];
      return { top, bot };
    };
    return { base: measure(false), flipped: measure(true) };
  });

  assert.ok(
    r.base.top > 200 && r.base.bot < 50,
    `base should be white-top/black-bot, got top=${r.base.top} bot=${r.base.bot}`,
  );
  assert.ok(
    r.flipped.top < 50 && r.flipped.bot > 200,
    `flipV should invert, got top=${r.flipped.top} bot=${r.flipped.bot}`,
  );
  await ctx.close();
});

test("viewer role receives the same live frames without kicking OBS receiver", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const receiver = await ctx.newPage();
  await receiver.goto(`${HTTP_BASE}/receiver.html`);
  const sender = await ctx.newPage();
  await sender.goto(`${HTTPS_BASE}/sender.html`);
  await receiver.waitForFunction(
    () => {
      const v = document.getElementById("feed");
      return v && v.srcObject && v.videoWidth > 0;
    },
    { timeout: 20000 },
  );

  // extra watcher — must not replace the OBS receiver slot.
  const viewer = await ctx.newPage();
  await viewer.goto(`${HTTPS_BASE}/viewer.html`);
  await viewer.waitForFunction(
    () => {
      const v = document.getElementById("feed");
      return v && v.srcObject && v.videoWidth > 0;
    },
    { timeout: 20000 },
  );

  // OBS path still live after the viewer joined.
  const obsStill = await receiver.evaluate(() => {
    const v = document.getElementById("feed");
    return !!(v && v.srcObject && v.videoWidth > 0);
  });
  assert.equal(obsStill, true, "OBS receiver must keep frames after viewer joins");

  await ctx.close();
});

test("pair pages show iPhone and iPad QRs without opening live slots", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const phone = await ctx.newPage();
    await phone.goto(`${HTTPS_BASE}/pair.html?for=phone`);
    await phone.waitForFunction(
      () => document.body.dataset.for === "phone" && document.getElementById("deviceUrl")?.textContent.includes("sender.html"),
      null,
      { timeout: 10000 },
    );
    const ipad = await ctx.newPage();
    await ipad.goto(`${HTTPS_BASE}/pair.html?for=ipad`);
    await ipad.waitForFunction(
      () => document.body.dataset.for === "ipad" && document.getElementById("deviceUrl")?.textContent.includes("board.html"),
      null,
      { timeout: 10000 },
    );
    const phoneQr = await phone.getAttribute("#qr", "src");
    const ipadQr = await ipad.getAttribute("#qr", "src");
    assert.match(phoneQr || "", /sender\.html/);
    assert.match(ipadQr || "", /board\.html/);
  } finally {
    await ctx.close();
  }
});

test("laptop control panel is usable (not disabled) even before the phone links", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const control = await ctx.newPage();
  await control.goto(`${HTTPS_BASE}/`);
  // Options must render immediately and stay clickable — greying them out
  // looked like "no options" to the user.
  await control.waitForSelector("#rcMirror:not([disabled])", { timeout: 10000 });
  await control.waitForSelector('#rcPanel input[data-p="exposure"]:not([disabled])', {
    timeout: 5000,
  });
  const labels = await control.evaluate(() =>
    [...document.querySelectorAll("#rcPanel .sliders label")].map((l) =>
      l.childNodes[0].textContent.trim(),
    ),
  );
  assert.ok(labels.includes("Exposure"), `expected Exposure slider, got ${labels}`);
  assert.ok(labels.includes("Zoom"), `expected Zoom slider, got ${labels}`);
  // Clicking Mirror with no phone must not throw; status should mention phone.
  await control.click("#rcMirror");
  await control.waitForFunction(
    () =>
      document.getElementById("remoteStatus").textContent.toLowerCase().includes(
        "phone",
      ),
    { timeout: 3000 },
  );
  await ctx.close();
});

test("iPad board streams drawn frames into its OBS receiver without kicking the phone", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
  const phoneRx = await ctx.newPage();
  await phoneRx.goto(`${HTTP_BASE}/receiver.html`);
  const phone = await ctx.newPage();
  await phone.goto(`${HTTPS_BASE}/sender.html`);
  await phoneRx.waitForFunction(
    () => {
      const v = document.getElementById("feed");
      return v && v.srcObject && v.videoWidth > 0;
    },
    { timeout: 20000 },
  );

  const boardRx = await ctx.newPage();
  await boardRx.goto(`${HTTP_BASE}/board-receiver.html`);
  const board = await ctx.newPage();
  await board.goto(`${HTTPS_BASE}/board.html`);
  await board.waitForFunction(
    () => document.body.dataset.boardReady === "1" && window.__board,
    { timeout: 15000 },
  );
  await board.evaluate(() => window.__board.drawTestStroke());

  await boardRx.waitForFunction(
    () => {
      const v = document.getElementById("feed");
      return v && v.srcObject && v.videoWidth > 0 && v.videoHeight > 0;
    },
    { timeout: 25000 },
  );
  const hintHidden = await boardRx.evaluate(() =>
    document.getElementById("hint").classList.contains("hidden"),
  );
  assert.equal(hintHidden, true, "board waiting hint should hide once frames arrive");

  const phoneStill = await phoneRx.evaluate(() => {
    const v = document.getElementById("feed");
    return !!(v && v.srcObject && v.videoWidth > 0);
  });
  assert.equal(phoneStill, true, "phone OBS source must stay live while the iPad board is connected");

  const landing = await ctx.newPage();
  await landing.goto(`${HTTPS_BASE}/`);
  const boardQr = await landing.evaluate(() => {
    const img = document.getElementById("boardQr");
    return {
      src: img?.getAttribute("src") || "",
      url: document.getElementById("boardUrl")?.textContent || "",
      obs: document.getElementById("obsBoardUrl")?.textContent || "",
    };
  });
  assert.match(boardQr.src, /\/qr\?url=/, "landing should show an iPad QR");
  assert.match(boardQr.url, /board\.html/, `expected board.html URL, got ${boardQr.url}`);
  assert.match(
    boardQr.obs,
    /board-receiver\.html/,
    `expected board-receiver OBS URL, got ${boardQr.obs}`,
  );
  } finally {
    await ctx.close();
  }
});

test("board undo restores a stroke after erase", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const board = await ctx.newPage();
    await board.goto(`${HTTPS_BASE}/board.html`);
    await board.waitForFunction(
      () => document.body.dataset.boardReady === "1" && window.__board,
      null,
      { timeout: 15000 },
    );
    const drawn = await board.evaluate(() => window.__board.drawTestStroke());
    assert.ok(drawn >= 1, "expected a test stroke");
    const erased = await board.evaluate(() => window.__board.punch(80, 80, 40, "element"));
    assert.equal(erased.ok, true);
    assert.equal(erased.n, 0);
    const restored = await board.evaluate(() => {
      const ok = window.__board.undoLast();
      return { ok, n: window.__board.scene.items.length };
    });
    assert.equal(restored.ok, true);
    assert.equal(restored.n, 1);
    await board.waitForFunction(
      async () => {
        const r = await fetch("/board-logs");
        const j = await r.json();
        return Array.isArray(j.logs) && j.logs.some((l) => l.event === "undo_done");
      },
      null,
      { timeout: 5000 },
    );
    await board.click('[data-tool="eraser"]');
    const ui = await board.evaluate(() => ({
      modeHidden: document.getElementById("eraseMode").hidden,
      cursor: getComputedStyle(document.getElementById("board")).cursor,
      min: document.getElementById("width").min,
    }));
    assert.equal(ui.modeHidden, false, "pixel/stroke toggle should show with eraser");
    assert.equal(ui.cursor, "none");
    assert.equal(ui.min, "12");
  } finally {
    await ctx.close();
  }
});

test("board tabs save a drawing and restore it after reload", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const board = await ctx.newPage();
    await board.goto(`${HTTPS_BASE}/board.html`);
    await board.waitForFunction(
      () => document.body.dataset.boardReady === "1" && window.__board,
      null,
      { timeout: 15000 },
    );
    await board.evaluate(() => window.__board.drawTestStroke());
    await board.evaluate(() => window.__board.flushSave());
    const firstId = await board.evaluate(() => window.__board.activeId);
    assert.ok(firstId, "expected an active drawing id");
    await board.evaluate(() => window.__board.newTab());
    await board.waitForFunction(
      (id) => window.__board.activeId && window.__board.activeId !== id,
      firstId,
      { timeout: 8000 },
    );
    const open = await board.evaluate(() => window.__board.openIds.length);
    assert.ok(open >= 2, `expected two tabs, got ${open}`);
    await board.reload();
    await board.waitForFunction(
      () => document.body.dataset.boardReady === "1" && window.__board?.activeId,
      null,
      { timeout: 15000 },
    );
    await board.evaluate((id) => window.__board.switchTo(id, { skipSave: true }), firstId);
    await board.waitForFunction(
      (id) =>
        window.__board.activeId === id && window.__board.scene.items.length >= 1,
      firstId,
      { timeout: 8000 },
    );
  } finally {
    await ctx.close();
  }
});

test("Mirror button on the phone toggles horizontal flip param", async () => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const sender = await ctx.newPage();
  await sender.goto(`${HTTPS_BASE}/sender.html`);
  await sender.waitForFunction(
    () => document.getElementById("preview").width > 0,
    { timeout: 20000 },
  );
  const before = await sender.evaluate(() => window.__obscam.params.mirror);
  await sender.click("#mirrorBtn");
  await sender.waitForFunction(
    (prev) => window.__obscam.params.mirror === !prev,
    before,
    { timeout: 5000 },
  );
  await ctx.close();
});
});
