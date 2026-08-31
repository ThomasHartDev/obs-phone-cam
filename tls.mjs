import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import selfsigned from "selfsigned";

export function certHostnames(ips) {
  const out = ["localhost", "127.0.0.1", "::1"];
  for (const ip of ips || []) {
    if (ip && !out.includes(ip)) out.push(ip);
  }
  return out;
}

export function pemToDerB64(pem) {
  return String(pem)
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
}

export function buildMobileConfig(caPem) {
  const der = pemToDerB64(caPem);
  const id = randomUUID();
  const caId = randomUUID();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>PayloadCertificateFileName</key>
      <string>phone-cam-ca.pem</string>
      <key>PayloadContent</key>
      <data>${der}</data>
      <key>PayloadDescription</key>
      <string>Trust Phone Cam on this Wi-Fi so Safari stops warning.</string>
      <key>PayloadDisplayName</key>
      <string>Phone Cam</string>
      <key>PayloadIdentifier</key>
      <string>dev.thomashart.phonecam.ca</string>
      <key>PayloadType</key>
      <string>com.apple.security.root</string>
      <key>PayloadUUID</key>
      <string>${caId}</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
    </dict>
  </array>
  <key>PayloadDisplayName</key>
  <string>Phone Cam</string>
  <key>PayloadIdentifier</key>
  <string>dev.thomashart.phonecam</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>${id}</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
}

function findMkcert(certDir) {
  const candidates = [
    process.env.MKCERT_BIN,
    path.join(certDir, "mkcert.exe"),
    path.join(certDir, "mkcert"),
    "mkcert",
  ].filter(Boolean);
  for (const bin of candidates) {
    const r = spawnSync(bin, ["-help"], { encoding: "utf8" });
    if (r.error) continue;
    if ((r.status ?? 1) === 0 || (r.stderr || r.stdout || "").includes("CAROOT"))
      return bin;
  }
  return null;
}

function runMkcert(bin, args, extra = {}) {
  return spawnSync(bin, args, {
    encoding: "utf8",
    windowsHide: true,
    ...extra,
  });
}

export function loadTls({ certDir, ips }) {
  fs.mkdirSync(certDir, { recursive: true });
  const keyPath = path.join(certDir, "key.pem");
  const certPath = path.join(certDir, "cert.pem");
  const caPath = path.join(certDir, "rootCA.pem");
  const names = certHostnames(ips);
  const mkcert = findMkcert(certDir);

  if (mkcert) {
    runMkcert(mkcert, ["-install"]);
    const caroot = (runMkcert(mkcert, ["-CAROOT"]).stdout || "").trim();
    const mkArgs = ["-cert-file", certPath, "-key-file", keyPath, ...names];
    const made = runMkcert(mkcert, mkArgs);
    if ((made.status ?? 1) === 0 && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      if (caroot) {
        const src = path.join(caroot, "rootCA.pem");
        if (fs.existsSync(src)) fs.copyFileSync(src, caPath);
      }
      return {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
        ca: fs.existsSync(caPath) ? fs.readFileSync(caPath) : null,
        source: "mkcert",
      };
    }
  }

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    return {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      ca: fs.existsSync(caPath) ? fs.readFileSync(caPath) : null,
      source: "certs/",
    };
  }

  const altNames = [
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    ...(ips || []).map((ip) => ({ type: 7, ip })),
  ];
  const pems = selfsigned.generate(
    [{ name: "commonName", value: "obs-phone-cam" }],
    {
      days: 3650,
      keySize: 2048,
      extensions: [{ name: "subjectAltName", altNames }],
    },
  );
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(certPath, pems.cert);
  return {
    key: pems.private,
    cert: pems.cert,
    ca: null,
    source: "self-signed",
  };
}
