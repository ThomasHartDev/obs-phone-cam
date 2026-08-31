let workerPromise = null;

async function getWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng");
    return worker;
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

export async function recognizeInkImage(dataUrl) {
  const m = /^data:image\/png;base64,(.+)$/i.exec(String(dataUrl || ""));
  if (!m) return "";
  const buf = Buffer.from(m[1], "base64");
  if (buf.length < 80) return "";
  try {
    const worker = await getWorker();
    const out = await worker.recognize(buf);
    return String(out.data?.text || "")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}
