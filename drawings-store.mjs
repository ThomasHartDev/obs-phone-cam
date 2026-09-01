import fs from "node:fs/promises";
import path from "node:path";

const ID_RE = /^[a-zA-Z0-9_-]{6,64}$/;
export const TRASH_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

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
  const deletedAt = Number(raw?.deletedAt);
  return {
    id,
    title: sanitizeTitle(raw?.title) || "Untitled",
    paper: typeof raw?.paper === "string" ? raw.paper : "white",
    items: Array.isArray(raw?.items) ? raw.items : [],
    updatedAt: Number(raw?.updatedAt) || Date.now(),
    deletedAt: Number.isFinite(deletedAt) && deletedAt > 0 ? deletedAt : 0,
  };
}

function metaOf(doc) {
  return {
    id: doc.id,
    title: doc.title,
    paper: doc.paper,
    updatedAt: doc.updatedAt,
    deletedAt: doc.deletedAt || 0,
  };
}

export function createDrawingsStore(dir, opts = {}) {
  const keepMs = Number(opts.keepMs) > 0 ? Number(opts.keepMs) : TRASH_KEEP_MS;
  const fileFor = (id) => path.join(dir, `${id}.json`);

  async function ensure() {
    await fs.mkdir(dir, { recursive: true });
  }

  async function readDoc(id) {
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

  async function writeDoc(doc) {
    await fs.writeFile(fileFor(doc.id), JSON.stringify(doc), "utf8");
    return doc;
  }

  async function purgeExpired() {
    await ensure();
    const names = await fs.readdir(dir);
    const now = Date.now();
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!isDocId(id)) continue;
      try {
        const doc = await readDoc(id);
        if (doc && doc.deletedAt && now - doc.deletedAt > keepMs) {
          await fs.unlink(fileFor(id));
        }
      } catch {
        /* skip */
      }
    }
  }

  async function list(optsList = {}) {
    await purgeExpired();
    const trash = !!optsList.trash;
    const names = await fs.readdir(dir);
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!isDocId(id)) continue;
      try {
        const doc = await readDoc(id);
        if (!doc) continue;
        const inTrash = !!doc.deletedAt;
        if (trash !== inTrash) continue;
        out.push(metaOf(doc));
      } catch {
        /* skip */
      }
    }
    out.sort((a, b) => (trash ? b.deletedAt - a.deletedAt : b.updatedAt - a.updatedAt));
    return out;
  }

  async function get(id) {
    const doc = await readDoc(id);
    if (!doc || doc.deletedAt) return null;
    return doc;
  }

  async function getAny(id) {
    return readDoc(id);
  }

  async function put(raw) {
    await ensure();
    const doc = normalize(raw, raw?.id);
    if (!doc) throw new Error("invalid drawing");
    doc.updatedAt = Date.now();
    doc.deletedAt = 0;
    return writeDoc(doc);
  }

  async function remove(id) {
    const doc = await readDoc(id);
    if (!doc || doc.deletedAt) return false;
    doc.deletedAt = Date.now();
    doc.updatedAt = Date.now();
    await writeDoc(doc);
    return true;
  }

  async function restore(id) {
    const doc = await readDoc(id);
    if (!doc || !doc.deletedAt) return null;
    doc.deletedAt = 0;
    doc.updatedAt = Date.now();
    return writeDoc(doc);
  }

  async function purgeNow(id) {
    const doc = await readDoc(id);
    if (!doc || !doc.deletedAt) return false;
    await fs.unlink(fileFor(id));
    return true;
  }

  return { list, get, getAny, put, remove, restore, purgeNow, purgeExpired };
}
