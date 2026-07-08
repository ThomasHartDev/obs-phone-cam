#!/usr/bin/env node
// obs-phone-cam — HTTPS static server + WebSocket signaling relay.
// Runs on the laptop that has OBS. The phone opens the sender page in Safari,
// OBS loads the receiver page as a Browser Source, and they connect P2P over the LAN.

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import selfsigned from "selfsigned";
import QRCode from "qrcode";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const CERT_DIR = path.join(__dirname, "certs");
const PORT = Number(process.env.PORT || 8443);

// getUserMedia on iOS Safari requires a secure context. On a LAN IP that means
// real HTTPS — localhost's secure-context exemption does NOT extend to 192.168.x.x.
// Prefer an mkcert-generated cert (no browser warning); fall back to self-signed.
function loadTls() {
  const key = path.join(CERT_DIR, "key.pem");
  const cert = path.join(CERT_DIR, "cert.pem");
  if (fs.existsSync(key) && fs.existsSync(cert)) {
    return {
      key: fs.readFileSync(key),
      cert: fs.readFileSync(cert),
      source: "certs/ (mkcert or provided)",
    };
  }
  // Generate a self-signed cert covering localhost + every LAN IP so the phone can trust-on-first-use.
  const altNames = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    ...lanIps().map((ip) => ({ type: 7, ip })),
  ];
  const pems = selfsigned.generate(
    [{ name: "commonName", value: "obs-phone-cam" }],
    {
      days: 3650,
      keySize: 2048,
      extensions: [{ name: "subjectAltName", altNames }],
    },
  );
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(key, pems.private);
  fs.writeFileSync(cert, pems.cert);
  return {
    key: pems.private,
    cert: pems.cert,
    source: "self-signed (tap through the browser warning once)",
  };
}

// Rank an interface by how likely the phone can actually reach it.
// Real Wi-Fi/Ethernet first; Tailscale/WSL/Hyper-V/virtual/loopback last —
// the phone on the same Wi-Fi can't route to a 100.x Tailscale or 172.x WSL IP.
function ifaceRank(name, ip) {
  const n = name.toLowerCase();
  if (
    /vethernet|wsl|tailscale|virtual|loopback|bluetooth|vmware|vbox|docker/.test(
      n,
    )
  )
    return 3;
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return 3; // Tailscale CGNAT 100.64/10
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
};

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
      })
      .end(data);
  });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, "https://x");
  // QR PNG for the sender URL so the phone can scan instead of typing an IP.
  if (url.pathname === "/qr") {
    const target = url.searchParams.get("url") || "";
    try {
      const png = await QRCode.toBuffer(target, { width: 320, margin: 1 });
      res.writeHead(200, { "content-type": "image/png" }).end(png);
    } catch {
      res.writeHead(400).end("bad url");
    }
    return;
  }
  if (url.pathname === "/lan.json") {
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify({ ips: lanIps(), port: PORT, httpPort: HTTP_PORT }));
    return;
  }
  serveStatic(req, res);
}

const HTTP_PORT = PORT + 1;
const tls = loadTls();

// --- Signaling: relay offer/answer/ICE between the two roles in a single room. ---
/** @type {Record<string, import('ws').WebSocket|null>} */
const peers = { sender: null, receiver: null };

function otherRole(role) {
  return role === "sender" ? "receiver" : "sender";
}
function notifyPresence() {
  for (const role of ["sender", "receiver"]) {
    const sock = peers[role];
    if (sock && sock.readyState === sock.OPEN) {
      sock.send(
        JSON.stringify({ type: "peer", present: !!peers[otherRole(role)] }),
      );
    }
  }
}

function handleWs(ws, req) {
  const url = new URL(req.url, "https://x");
  const role = url.searchParams.get("role");
  if (role !== "sender" && role !== "receiver") {
    ws.close(1008, "role required");
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

  ws.on("message", (data) => {
    // Blind relay of signaling payloads to the other role.
    const target = peers[otherRole(role)];
    if (target && target.readyState === target.OPEN)
      target.send(data.toString());
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

// HTTPS for the phone: iOS Safari needs a secure context on a LAN IP to grant the camera.
const httpsServer = https.createServer(
  { key: tls.key, cert: tls.cert },
  makeRequestHandler,
);
new WebSocketServer({ server: httpsServer, path: "/ws" }).on(
  "connection",
  handleWs,
);

// Plain HTTP for OBS: its CEF Browser Source silently refuses a self-signed cert (no prompt),
// which renders black. The receiver page uses no camera, and http://localhost is a secure
// context by spec, so OBS loads it over http with zero cert friction.
const httpServer = http.createServer(makeRequestHandler);
new WebSocketServer({ server: httpServer, path: "/ws" }).on(
  "connection",
  handleWs,
);

httpsServer.listen(PORT, "0.0.0.0", () => {
  const ips = lanIps();
  console.log("\n  obs-phone-cam is running.");
  console.log(`  TLS: ${tls.source}\n`);
  console.log("  On the laptop, open this to get the QR code + OBS URL:");
  console.log(`    https://localhost:${PORT}/\n`);
  console.log("  On the iPhone (same Wi-Fi), open the sender page:");
  for (const ip of ips) console.log(`    https://${ip}:${PORT}/sender.html`);
  console.log(
    "\n  In OBS: add a Browser Source pointing at (plain http — no cert warning):",
  );
  console.log(`    http://localhost:${HTTP_PORT}/receiver.html\n`);
  openBrowser(`https://localhost:${PORT}/`);
});
httpServer.listen(HTTP_PORT, "0.0.0.0", () => {});

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
