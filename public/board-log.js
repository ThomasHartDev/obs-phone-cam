const RING = 120;
const lines = [];
const pending = [];
let panel = null;
let flushTimer = 0;

export function attachLogPanel(el) {
  panel = el;
  paintPanel();
}

export function log(level, event, data) {
  const row = {
    t: Date.now(),
    level,
    event,
    ...(data && typeof data === "object" ? data : {}),
  };
  lines.push(row);
  if (lines.length > RING) lines.shift();
  pending.push(row);
  paintPanel();
  if (!flushTimer) flushTimer = setTimeout(flushLogs, 350);
}

export function getLogs() {
  return lines.slice();
}

function paintPanel() {
  if (!panel || panel.hidden) return;
  panel.textContent = lines
    .slice(-50)
    .map((r) => {
      const dt = new Date(r.t).toISOString().slice(11, 23);
      const extra = Object.entries(r)
        .filter(([k]) => k !== "t" && k !== "level" && k !== "event")
        .map(([k, v]) => k + "=" + v)
        .join(" ");
      return dt + " " + r.level + " " + r.event + (extra ? " " + extra : "");
    })
    .join("\n");
  panel.scrollTop = panel.scrollHeight;
}

function flushLogs() {
  flushTimer = 0;
  if (!pending.length) return;
  const batch = pending.splice(0, pending.length);
  fetch("/board-logs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ logs: batch }),
    keepalive: true,
  }).catch(() => {});
}

export function refreshLogPanel() {
  paintPanel();
}
