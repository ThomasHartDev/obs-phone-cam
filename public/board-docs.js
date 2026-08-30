import { cloneItems } from "./board-engine.js";

export function newDocId() {
  return (
    "d_" +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

export function sanitizeTitle(t) {
  return String(t || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function isDocId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{6,64}$/.test(id);
}

export function createDoc(partial = {}) {
  const title = sanitizeTitle(partial.title);
  return {
    id: isDocId(partial.id) ? partial.id : newDocId(),
    title: title || "Untitled",
    paper: typeof partial.paper === "string" ? partial.paper : "white",
    items: Array.isArray(partial.items) ? partial.items : [],
    updatedAt: Number(partial.updatedAt) || Date.now(),
  };
}

export function applyDocToScene(doc, scene) {
  scene.items = cloneItems(doc.items || []);
  scene.history = [];
  scene.future = [];
  scene.paper = doc.paper || "white";
}

export function sceneToDoc(doc, scene) {
  return {
    id: doc.id,
    title: doc.title,
    paper: scene.paper || "white",
    items: cloneItems(scene.items),
    updatedAt: Date.now(),
  };
}

export function metaOf(doc) {
  return {
    id: doc.id,
    title: doc.title,
    paper: doc.paper,
    updatedAt: doc.updatedAt,
  };
}
