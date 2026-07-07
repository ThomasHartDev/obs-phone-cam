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
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert), source: "certs/ (mkcert or provided)" };
  }
  // Generate a self-signed cert covering localhost + every LAN IP so the phone can trust-on-first-use.
  const altNames = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    ...lanIps().map((ip) => ({ type: 7, ip })),
  ];
  const pems = selfsigned.generate([{ name: "commonName", value: "obs-phone-cam" }], {
    days: 3650,
    keySize: 2048,
    extensions: [{ name: "subjectAltName", altNames }],
  });
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(key, pems.private);
  fs.writeFileSync(cert, pems.cert);
  return { key: pems.private, cert: pems.cert, source: "self-signed (tap through the browser warning once)" };
}

function lanIps() {
  const out = [];
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push(a.address);
    }
  }
  return out;
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
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" }).end(data);
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
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ips: lanIps(), port: PORT }));
    return;
  }
  serveStatic(req, res);
}

const tls = loadTls();
const server = https.createServer({ key: tls.key, cert: tls.cert }, (req, res) => {
  handleRequest(req, res).catch(() => res.writeHead(500).end("error"));
});

// --- Signaling: relay offer/answer/ICE between the two roles in a single room. ---
const wss = new WebSocketServer({ server, path: "/ws" });
/** @type {Record<string, import('ws').WebSocket|null>} */
const peers = { sender: null, receiver: null };

function otherRole(role) {
  return role === "sender" ? "receiver" : "sender";
}
function notifyPresence() {
  for (const role of ["sender", "receiver"]) {
    const sock = peers[role];
    if (sock && sock.readyState === sock.OPEN) {
      sock.send(JSON.stringify({ type: "peer", present: !!peers[otherRole(role)] }));
    }
  }
}

wss.on("connection", (ws, req) => {
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
    if (target && target.readyState === target.OPEN) target.send(data.toString());
  });

  ws.on("close", () => {
    if (peers[role] === ws) peers[role] = null;
    console.log(`[ws] ${role} disconnected`);
    notifyPresence();
  });
  ws.on("error", () => {});
});

server.listen(PORT, "0.0.0.0", () => {
  const ips = lanIps();
  const primary = ips[0] || "localhost";
  console.log("\n  obs-phone-cam is running.");
  console.log(`  TLS: ${tls.source}\n`);
  console.log("  On the laptop, open this to get the QR code + OBS URL:");
  console.log(`    https://localhost:${PORT}/\n`);
  console.log("  On the iPhone (same Wi-Fi), open the sender page:");
  for (const ip of ips) console.log(`    https://${ip}:${PORT}/sender.html`);
  console.log("\n  In OBS: add a Browser Source pointing at:");
  console.log(`    https://localhost:${PORT}/receiver.html`);
  console.log(`    (or https://${primary}:${PORT}/receiver.html)\n`);
});

// Also redirect plain HTTP → HTTPS so a mistyped http:// URL still lands.
http
  .createServer((req, res) => {
    const host = (req.headers.host || "").replace(/:\d+$/, "");
    res.writeHead(301, { location: `https://${host}:${PORT}${req.url}` }).end();
  })
  .listen(PORT + 1, "0.0.0.0", () => {});
