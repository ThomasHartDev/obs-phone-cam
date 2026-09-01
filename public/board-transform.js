export function localBounds(item) {
  if (!item) return null;
  if (item.kind === "ink" && item.points && item.points.length) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const p of item.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }
  if (item.kind === "shape" && item.a && item.b) {
    const minX = Math.min(item.a.x, item.b.x);
    const minY = Math.min(item.a.y, item.b.y);
    const maxX = Math.max(item.a.x, item.b.x);
    const maxY = Math.max(item.a.y, item.b.y);
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }
  if (item.kind === "text") {
    const w = Math.max(12, String(item.text || "").length * item.size * 0.55);
    const h = item.size * 1.2;
    return { minX: item.x, minY: item.y, maxX: item.x + w, maxY: item.y + h, w, h };
  }
  return null;
}

export function itemCenter(item) {
  const b = localBounds(item);
  if (!b) return { x: 0, y: 0 };
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

export function worldToLocal(item, x, y) {
  const rot = item.rot || 0;
  if (!rot) return { x, y };
  const c = itemCenter(item);
  const dx = x - c.x;
  const dy = y - c.y;
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function localToWorld(item, x, y) {
  const rot = item.rot || 0;
  if (!rot) return { x, y };
  const c = itemCenter(item);
  const dx = x - c.x;
  const dy = y - c.y;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

export function translateItem(item, dx, dy) {
  if (item.kind === "ink" && item.points) {
    for (const p of item.points) {
      p.x += dx;
      p.y += dy;
    }
    return;
  }
  if (item.kind === "shape" && item.a && item.b) {
    item.a.x += dx;
    item.a.y += dy;
    item.b.x += dx;
    item.b.y += dy;
    return;
  }
  if (item.kind === "text") {
    item.x += dx;
    item.y += dy;
  }
}

export function rotateItem(item, delta) {
  item.rot = (item.rot || 0) + delta;
}

export function hitItem(item, x, y, pad = 12) {
  const p = worldToLocal(item, x, y);
  const b = localBounds(item);
  if (!b) return false;
  return (
    p.x >= b.minX - pad &&
    p.x <= b.maxX + pad &&
    p.y >= b.minY - pad &&
    p.y <= b.maxY + pad
  );
}

export function hitTop(items, x, y, pad) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (hitItem(items[i], x, y, pad)) return items[i];
  }
  return null;
}

export function rotateHandle(item) {
  const b = localBounds(item);
  if (!b) return null;
  const c = itemCenter(item);
  return localToWorld(item, c.x, b.minY - 28);
}
