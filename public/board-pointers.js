/** Palm vs pinch rules for the iPad board. No DOM. */

export function pointerKind(type) {
  return type === "pen" ? "pen" : type === "touch" ? "touch" : "mouse";
}

export function hasPen(pointers) {
  for (const p of pointers.values()) if (p.type === "pen") return true;
  return false;
}

export function touchCount(pointers) {
  let n = 0;
  for (const p of pointers.values()) if (p.type === "touch") n++;
  return n;
}

/** Palm resting on glass while the Pencil is down. */
export function shouldIgnoreTouch(pointerType, pointers, drawing) {
  if (pointerType !== "touch") return false;
  if (drawing) return true;
  return hasPen(pointers);
}

/** Two fingers only. Never Pencil + palm. */
export function shouldStartPinch(pointers) {
  if (hasPen(pointers)) return false;
  return touchCount(pointers) >= 2;
}

export function dropTouches(pointers) {
  for (const [id, p] of pointers) {
    if (p.type === "touch") pointers.delete(id);
  }
}
