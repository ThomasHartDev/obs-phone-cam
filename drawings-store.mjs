import fs from "node:fs/promises";
import path from "node:path";

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;

export function isDocId(id) {
  return typeof id === "string" && ID_RE.test(id);
}

function sanitizeTitle(t) {
  return String(t || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function normalize(raw, fallbackId) {
  const id = isDocId(raw?.id) ? raw.id : fallbackId;
  if (!isDocId(id)) return null;
  return {
    id,
    title: sanitizeTitle(raw?.title) || "Untitled",
    paper: typeof raw?.paper === "string" ? raw.paper : "white",
    items: Array.isArray(raw?.items) ? raw.items : [],
    updatedAt: Number(raw?.updatedAt) || Date.now(),
  };
}

export function createDrawingsStore(dir) {
  const fileFor = (id) => path.join(dir, `${id}.json`);

  async function ensure() {
    await fs.mkdir(dir, { recursive: true });
  }

  async function list() {
    await ensure();
    const names = await fs.readdir(dir);
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!isDocId(id)) continue;
      try {
        const doc = await get(id);
        if (doc)
          out.push({
            id: doc.id,
            title: doc.title,
            paper: doc.paper,
            updatedAt: doc.updatedAt,
          });
      } catch {
        /* skip bad file */
      }
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }

  async function get(id) {
    if (!isDocId(id)) return null;
    await ensure();
    try {
      const raw = JSON.parse(await fs.readFile(fileFor(id), "utf8"));
      return normalize(raw, id);
    } catch (e) {
      if (e && e.code === "ENOENT") return null;
      throw e;
    }
  }

  async function put(raw) {
    await ensure();
    const doc = normalize(raw, raw?.id);
    if (!doc) throw new Error("invalid drawing");
    doc.updatedAt = Date.now();
    await fs.writeFile(fileFor(doc.id), JSON.stringify(doc), "utf8");
    return doc;
  }

  async function remove(id) {
    if (!isDocId(id)) return false;
    try {
      await fs.unlink(fileFor(id));
      return true;
    } catch (e) {
      if (e && e.code === "ENOENT") return false;
      throw e;
    }
  }

  return { list, get, put, remove };
}
