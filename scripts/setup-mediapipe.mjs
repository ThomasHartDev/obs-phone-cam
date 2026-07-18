// Populates public/vendor/mediapipe/ with the MediaPipe tasks-vision runtime
// (copied from node_modules) + the selfie-segmentation model (downloaded once).
// Runs on postinstall. FAIL-SOFT by design: a missing network or package must
// never break `npm install` — the background-blur feature just stays inert
// until the assets are present, and the rest of the app works regardless.
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "node_modules", "@mediapipe", "tasks-vision");
const DEST = path.join(ROOT, "public", "vendor", "mediapipe");
const MODEL = path.join(DEST, "selfie_segmenter.tflite");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite";

function copyRuntime() {
  if (!fs.existsSync(SRC)) {
    console.warn("[mediapipe] tasks-vision not installed; skipping runtime copy");
    return false;
  }
  fs.mkdirSync(path.join(DEST, "wasm"), { recursive: true });
  fs.copyFileSync(
    path.join(SRC, "vision_bundle.mjs"),
    path.join(DEST, "vision_bundle.mjs"),
  );
  // SIMD build + nosimd fallback only (the pthreads variant isn't used)
  for (const f of [
    "vision_wasm_internal.js",
    "vision_wasm_internal.wasm",
    "vision_wasm_nosimd_internal.js",
    "vision_wasm_nosimd_internal.wasm",
  ]) {
    const from = path.join(SRC, "wasm", f);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(DEST, "wasm", f));
  }
  return true;
}

function downloadModel() {
  if (fs.existsSync(MODEL) && fs.statSync(MODEL).size > 100_000) return; // already there
  https
    .get(MODEL_URL, (r) => {
      if (r.statusCode !== 200) {
        console.warn("[mediapipe] model download HTTP", r.statusCode, "- blur will be inert until fetched");
        r.resume();
        return;
      }
      const f = fs.createWriteStream(MODEL);
      r.pipe(f);
      f.on("finish", () => f.close(() => console.log("[mediapipe] model ready")));
    })
    .on("error", (e) => console.warn("[mediapipe] model download failed:", e.message));
}

try {
  if (copyRuntime()) downloadModel();
} catch (e) {
  console.warn("[mediapipe] setup skipped:", e.message);
}
