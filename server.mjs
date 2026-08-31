#!/usr/bin/env node
// obs-phone-cam — HTTPS static server + WebSocket signaling relay.
// Runs on the laptop that has OBS. The phone opens the sender page in Safari,
// OBS loads the receiver page as a Browser Source, and they connect P2P over the LAN.

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import QRCode from "qrcode";
import { createDrawingsStore, isDocId } from "./drawings-store.mjs";
import { launchUrls, openLaunchTabs } from "./launch.mjs";
import { loadTls, buildMobileConfig } from "./tls.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const CERT_DIR = path.join(__dirname, "certs");
const DRAWINGS_DIR =
  process.env.DRAWINGS_DIR || path.join(__dirname, "data", "drawings");
const drawings = createDrawingsStore(DRAWINGS_DIR);
const BOARD_LOG = path.join(__dirname, "data", "board.log");
const boardLogMem = [];
const PORT = Number(process.env.PORT || 8443);

// Rank an interface by how likely the phone can actually reach it.
// Real Wi-Fi/Ethernet first; VPN/WSL/Hyper-V/virtual/loopback last —
// the phone on the same Wi-Fi can't route to a 100.x CGNAT or 172.x WSL IP.
function ifaceRank(name, ip) {
  const n = name.toLowerCase();
  if (
    /vethernet|wsl|tailscale|virtual|loopback|bluetooth|vmware|vbox|docker/.test(
      n,
    )
  )
    return 3;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return 3; // CGNAT 100.64/10
  if (/wi-?fi|wlan|wireless/.test(n)) return 0;
  if (/ethernet|^en|^eth/.test(n)) return 1;
  return 2;
}

function lanIps() {
  const entries = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal)
        entries.push({ ip: a.address, rank: ifaceRank(name, a.address) });
    }
  }
  entries.sort((x, y) => x.rank - y.rank);
  return entries.map((e) => e.ip);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm", // Safari streaming-compiles only with the right MIME
  ".tflite": "application/octet-stream",
  ".json": "application/json; charset=utf-8",
};

// Laptop UIs fetch QR / lan.json / control cross-origin.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type",
};

/** Last phone state broadcast (HTTP clients poll this — no browser→WS needed). */
let lastPhoneState = null;

function serveStatic(req, res) {
  const url = new URL(req.url, "https://x");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  // path traversal guard
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    res
      .writeHead(200, {
        "content-type":
          MIME[path.extname(filePath)] || "application/octet-stream",
        ...CORS,
      })
      .end(data);
  });
}

function readBody(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res, status, obj) {
  res
    .writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...CORS,
    })
    .end(JSON.stringify(obj));
}

async function handleBoardLogs(url, req, res) {
  if (url.pathname !== "/board-logs") return false;
  if (req.method === "GET") {
    json(res, 200, { logs: boardLogMem.slice(-200) });
    return true;
  }
  if (req.method !== "POST") return false;
  let body;
  try {
    body = JSON.parse(await readBody(req, 200_000));
  } catch {
    json(res, 400, { error: "invalid json" });
    return true;
  }
  const rows = Array.isArray(body?.logs) ? body.logs : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    boardLogMem.push(row);
  }
  if (boardLogMem.length > 500) boardLogMem.splice(0, boardLogMem.length - 500);
  json(res, 200, { ok: true, n: rows.length });
  const lines = rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  if (lines) {
    fsp
      .mkdir(path.dirname(BOARD_LOG), { recursive: true })
      .then(() => fsp.appendFile(BOARD_LOG, lines, "utf8"))
      .catch(() => {});
  }
  return true;
}

async function handleDrawings(url, req, res) {
  const pathname = url.pathname;
  if (pathname === "/drawings" && req.method === "GET") {
    json(res, 200, { drawings: await drawings.list() });
    return true;
  }
  const m = pathname.match(/^\/drawings\/([^/]+)$/);
  if (!m) return false;
  const id = decodeURIComponent(m[1]);
  if (!isDocId(id)) {
    json(res, 400, { error: "bad id" });
    return true;
  }
  if (req.method === "GET") {
    const doc = await drawings.get(id);
    if (!doc) json(res, 404, { error: "not found" });
    else json(res, 200, { drawing: doc });
    return true;
  }
  if (req.method === "PUT") {
    let body;
    try {
      body = JSON.parse(await readBody(req, 2_000_000));
    } catch {
      json(res, 400, { error: "invalid json" });
      return true;
    }
    if (!body || typeof body !== "object") {
      json(res, 400, { error: "object required" });
      return true;
    }
    body.id = id;
    try {
      const doc = await drawings.put(body);
      json(res, 200, { drawing: doc });
    } catch (e) {
      json(res, 400, { error: e instanceof Error ? e.message : "save failed" });
    }
    return true;
  }
  if (req.method === "DELETE") {
    const ok = await drawings.remove(id);
    json(res, ok ? 200 : 404, { ok });
    return true;
  }
  return false;
}

async function handleRequest(req, res) {
  const url = new URL(req.url, "https://x");
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }
  // QR PNG for the sender URL so the phone can scan instead of typing an IP.
  if (url.pathname === "/qr") {
    const target = url.searchParams.get("url") || "";
    try {
      const png = await QRCode.toBuffer(target, { width: 320, margin: 1 });
      res
        .writeHead(200, { "content-type": "image/png", ...CORS })
        .end(png);
    } catch {
      res.writeHead(400).end("bad url");
    }
    return;
  }
  if (url.pathname === "/ca.pem") {
    if (!tls.ca) {
      res.writeHead(404).end("no CA (mkcert not installed)");
      return;
    }
    res
      .writeHead(200, {
        "content-type": "application/x-pem-file",
        "content-disposition": "attachment; filename=\"phone-cam-ca.pem\"",
        "cache-control": "no-store",
      })
      .end(tls.ca);
    return;
  }
  if (url.pathname === "/ca.mobileconfig") {
    if (!tls.ca) {
      res.writeHead(404).end("no CA (mkcert not installed)");
      return;
    }
    res
      .writeHead(200, {
        "content-type": "application/x-apple-aspen-config",
        "content-disposition": "attachment; filename=\"phone-cam.mobileconfig\"",
        "cache-control": "no-store",
      })
      .end(buildMobileConfig(tls.ca.toString("utf8")));
    return;
  }
  if (url.pathname === "/lan.json") {
    res
      .writeHead(200, {
        "content-type": "application/json",
        ...CORS,
      })
      .end(JSON.stringify({ ips: lanIps(), port: PORT, httpPort: HTTP_PORT }));
    return;
  }
  // HTTP control path. Browsers on a public HTTPS origin cannot open
  // wss://localhost (Chrome Private Network Access), so they POST here instead.
  if (url.pathname === "/control" && req.method === "POST") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      res.writeHead(400, { "content-type": "application/json", ...CORS }).end(
        JSON.stringify({ ok: false, error: "invalid json" }),
      );
      return;
    }
    if (!body || typeof body !== "object") {
      res.writeHead(400, { "content-type": "application/json", ...CORS }).end(
        JSON.stringify({ ok: false, error: "object required" }),
      );
      return;
    }
    // Accept either a full control envelope or a bare {op, ...} payload.
    const msg =
      body.type === "control"
        ? body
        : { type: "control", ...body };
    if (!isOpen(peers.sender)) {
      res.writeHead(503, { "content-type": "application/json", ...CORS }).end(
        JSON.stringify({
          ok: false,
          error: "phone not connected — open sender on the iPhone",
          phonePresent: false,
        }),
      );
      return;
    }
    peers.sender.send(JSON.stringify(msg));
    res.writeHead(200, { "content-type": "application/json", ...CORS }).end(
      JSON.stringify({ ok: true, phonePresent: true }),
    );
    return;
  }
  if (await handleBoardLogs(url, req, res)) return;
  if (await handleDrawings(url, req, res)) return;
  if (url.pathname === "/state" && req.method === "GET") {
    res
      .writeHead(200, {
        "content-type": "application/json",
        ...CORS,
        "cache-control": "no-store",
      })
      .end(
        JSON.stringify({
          ok: true,
          phonePresent: !!peers.sender,
          boardPresent: !!peers.board,
          state: lastPhoneState,
        }),
      );
    return;
  }
  serveStatic(req, res);
}

const HTTP_PORT = PORT + 1;
const tls = loadTls({ certDir: CERT_DIR, ips: lanIps() });

// --- Signaling: WebRTC offer/answer/ICE between sender↔receiver, plus
// laptop "controller" sockets and multi "viewer" sockets (live preview).
// Viewers never replace the OBS receiver slot. ---
/** @type {Record<string, import('ws').WebSocket|null>} */
const peers = { sender: null, receiver: null, board: null, boardReceiver: null };
const PAIR = {
  sender: "receiver",
  receiver: "sender",
  board: "boardReceiver",
  boardReceiver: "board",
};
/** @type {Set<import('ws').WebSocket>} */
const controllers = new Set();
/** @type {Map<string, import('ws').WebSocket>} */
const viewers = new Map();
let nextViewerId = 1;

function otherRole(role) {
  return PAIR[role] || null;
}
function isOpen(sock) {
  return sock && sock.readyState === sock.OPEN;
}
function sendJson(sock, obj) {
  if (isOpen(sock)) sock.send(JSON.stringify(obj));
}
function notifyPresence() {
  for (const role of Object.keys(PAIR)) {
    const sock = peers[role];
    if (isOpen(sock)) {
      sock.send(
        JSON.stringify({ type: "peer", present: !!peers[otherRole(role)] }),
      );
    }
  }
  // Controllers care whether the phone (sender) is online.
  for (const c of controllers) {
    sendJson(c, {
      type: "peer",
      present: !!peers.sender,
      role: "sender",
    });
  }
}
function broadcastToControllers(raw) {
  for (const c of controllers) {
    if (isOpen(c)) c.send(raw);
  }
}
/** Tell the phone about every live viewer (used on phone connect + join). */
function syncViewersToSender() {
  if (!isOpen(peers.sender)) return;
  for (const id of viewers.keys()) {
    peers.sender.send(JSON.stringify({ type: "viewer", id, present: true }));
  }
}

function handleWs(ws, req) {
  const url = new URL(req.url, "https://x");
  const role = url.searchParams.get("role");
  if (
    role !== "sender" &&
    role !== "receiver" &&
    role !== "board" &&
    role !== "boardReceiver" &&
    role !== "controller" &&
    role !== "viewer"
  ) {
    ws.close(1008, "role required");
    return;
  }

  if (role === "controller") {
    controllers.add(ws);
    console.log(`[ws] controller connected (${controllers.size})`);
    // Immediate presence so the laptop panel can enable/disable controls.
    sendJson(ws, { type: "peer", present: !!peers.sender, role: "sender" });
    // Ask the phone for a full state dump so the panel paints current values.
    if (isOpen(peers.sender)) {
      peers.sender.send(JSON.stringify({ type: "control", op: "getState" }));
    }
    ws.on("message", (data) => {
      // Controllers only talk to the phone. Never touch the OBS receiver role.
      if (isOpen(peers.sender)) peers.sender.send(data.toString());
    });
    ws.on("close", () => {
      controllers.delete(ws);
      console.log(`[ws] controller disconnected (${controllers.size})`);
    });
    ws.on("error", () => {});
    return;
  }

  // Extra watchers. Many OK; never kick OBS.
  if (role === "viewer") {
    const id = String(nextViewerId++);
    viewers.set(id, ws);
    ws._viewerId = id;
    console.log(`[ws] viewer ${id} connected (${viewers.size})`);
    if (isOpen(peers.sender)) {
      peers.sender.send(JSON.stringify({ type: "viewer", id, present: true }));
    }
    ws.on("message", (data) => {
      // Tag answer/ICE with peerId so the phone routes to the right PeerConnection.
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      msg.peerId = id;
      if (isOpen(peers.sender)) peers.sender.send(JSON.stringify(msg));
    });
    ws.on("close", () => {
      if (viewers.get(id) === ws) viewers.delete(id);
      console.log(`[ws] viewer ${id} disconnected (${viewers.size})`);
      if (isOpen(peers.sender)) {
        peers.sender.send(
          JSON.stringify({ type: "viewer", id, present: false }),
        );
      }
    });
    ws.on("error", () => {});
    return;
  }

  // Newer connection of a role replaces the old one (e.g. phone reconnects).
  if (peers[role] && peers[role] !== ws) {
    try {
      peers[role].close(1000, "replaced");
    } catch {}
  }
  peers[role] = ws;
  console.log(`[ws] ${role} connected`);
  notifyPresence();
  // Fresh phone → push state to any open laptop panels + re-attach viewers.
  if (role === "sender") {
    if (controllers.size) {
      setTimeout(() => {
        if (isOpen(ws))
          ws.send(JSON.stringify({ type: "control", op: "getState" }));
      }, 200);
    }
    setTimeout(() => syncViewersToSender(), 250);
  }

  ws.on("message", (data) => {
    const raw = data.toString();
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (role === "sender") {
      if (msg.type === "state") {
        lastPhoneState = msg;
        broadcastToControllers(raw);
        return;
      }
      if (msg.peerId) {
        const v = viewers.get(String(msg.peerId));
        if (isOpen(v)) v.send(raw);
        return;
      }
      if (isOpen(peers.receiver)) peers.receiver.send(raw);
      return;
    }

    if (role === "board") {
      if (isOpen(peers.boardReceiver)) peers.boardReceiver.send(raw);
      return;
    }
    if (role === "boardReceiver") {
      if (isOpen(peers.board)) peers.board.send(raw);
      return;
    }

    if (isOpen(peers.sender)) peers.sender.send(raw);
  });

  ws.on("close", () => {
    if (peers[role] === ws) peers[role] = null;
    console.log(`[ws] ${role} disconnected`);
    notifyPresence();
  });
  ws.on("error", () => {});
}

function makeRequestHandler(req, res) {
  handleRequest(req, res).catch(() => res.writeHead(500).end("error"));
}

// A port clash (usually a Phone Cam window already open) should read as a plain
// message, not a raw node stack trace.
let handledListenError = false;
function onListenError(err, port) {
  if (handledListenError) return;
  handledListenError = true;
  if (err && err.code === "EADDRINUSE") {
    console.error(
      `\n  Phone Cam looks like it's already running (port ${port} is in use).`,
    );
    console.error(
      "  Close the other Phone Cam window first, then start it again.\n",
    );
  } else {
    console.error(
      "\n  Phone Cam couldn't start:",
      err && err.message ? err.message : err,
      "\n",
    );
  }
  process.exit(1);
}

// HTTPS for the phone: iOS Safari needs a secure context on a LAN IP to grant the camera.
const httpsServer = https.createServer(
  { key: tls.key, cert: tls.cert },
  makeRequestHandler,
);
const httpsWss = new WebSocketServer({ server: httpsServer, path: "/ws" });
httpsWss.on("connection", handleWs);

// Plain HTTP for OBS: its CEF Browser Source silently refuses a self-signed cert (no prompt),
// which renders black. The receiver page uses no camera, and http://localhost is a secure
// context by spec, so OBS loads it over http with zero cert friction.
const httpServer = http.createServer(makeRequestHandler);
const httpWss = new WebSocketServer({ server: httpServer, path: "/ws" });
httpWss.on("connection", handleWs);

// A failed listen (e.g. port in use) surfaces on both the server and the ws layer;
// handle it in both places so it prints one friendly line instead of a raw stack.
httpsServer.on("error", (e) => onListenError(e, PORT));
httpServer.on("error", (e) => onListenError(e, HTTP_PORT));
httpsWss.on("error", (e) => onListenError(e, PORT));
httpWss.on("error", (e) => onListenError(e, HTTP_PORT));

let httpsUp = false;
let httpUp = false;
function maybeOpenLaunchTabs() {
  if (!httpsUp || !httpUp) return;
  openLaunchTabs(openBrowser, launchUrls(PORT, HTTP_PORT));
}

httpsServer.listen(PORT, "0.0.0.0", () => {
  httpsUp = true;
  const ips = lanIps();
  console.log("\n  obs-phone-cam is running.");
  console.log(`  TLS: ${tls.source}\n`);
  console.log("  Laptop tabs: controls, iPhone feed, iPad feed.");
  console.log(`    https://localhost:${PORT}/`);
  console.log(`    http://localhost:${HTTP_PORT}/receiver.html`);
  console.log(`    http://localhost:${HTTP_PORT}/board-receiver.html\n`);
  console.log("  On the iPhone (same Wi-Fi), open the sender page:");
  for (const ip of ips) console.log(`    https://${ip}:${PORT}/sender.html`);
  console.log("  On the iPad, open the whiteboard:");
  for (const ip of ips) console.log(`    https://${ip}:${PORT}/board.html`);
  console.log(
    "\n  In OBS: add a Browser Source pointing at (plain http — no cert warning):",
  );
  console.log(`    http://localhost:${HTTP_PORT}/receiver.html`);
  console.log(
    `    http://localhost:${HTTP_PORT}/board-receiver.html  (iPad board)\n`,
  );
  maybeOpenLaunchTabs();
});
httpServer.listen(HTTP_PORT, "0.0.0.0", () => {
  httpUp = true;
  maybeOpenLaunchTabs();
});

// Pop the QR/landing page in the default browser so the user never touches a URL.
// Skipped in tests/CI via OBS_NO_OPEN.
function openBrowser(url) {
  if (process.env.OBS_NO_OPEN) return;
  try {
    if (process.platform === "win32")
      spawn("cmd", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
      }).unref();
    else if (process.platform === "darwin")
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  } catch {}
}
