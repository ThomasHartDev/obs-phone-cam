# obs-phone-cam

Use your iPhone as a low-latency camera source in OBS over your local network. No app to install on the phone, no monthly fee. The phone just opens a page in Safari.

This is a free replacement for the Camo / Iriun / EpocCam class of apps, built on WebRTC + an OBS Browser Source.

## How it works

```
iPhone (Safari)                     Laptop (OBS)
 sender.html                         receiver.html  ──► OBS Browser Source
 getUserMedia(camera) ──WebRTC P2P over your LAN──►  <video> fullscreen
        │                                   │
        └──────── WS signaling relay ───────┘
                  (server.mjs, HTTPS)
```

- **`server.mjs`** serves the pages over HTTPS and relays WebRTC signaling. HTTPS is required: iOS Safari blocks camera access on a LAN IP unless it's a secure context.
- The phone and OBS connect **peer to peer** on your Wi-Fi (Google STUN for ICE, no TURN needed on the same network), so the video never round-trips through a server.
- OBS renders the receiver page as a **Browser Source**. Click **Start Virtual Camera** in OBS to also use it as a webcam in Zoom/Teams.

## Run it

On the laptop that has OBS:

```bash
npm install
npm start
```

Then:

1. Open `https://localhost:8443/` on the laptop — it shows a QR code and the OBS URL.
2. Scan the QR with your iPhone (same Wi-Fi). Tap through the one-time cert warning, allow the camera.
3. In OBS: **Sources → + → Browser**, URL `https://localhost:8443/receiver.html`, size = your canvas.

The phone's HUD lets you flip front/back camera, pick a resolution, and toggle the mic.

## Certificate

By default the server generates a self-signed cert, so Safari shows a one-time warning you tap through. For a clean, warning-free cert install [mkcert](https://github.com/FiloSottile/mkcert):

```bash
mkcert -install
mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost <your-lan-ip>
```

The server auto-uses `certs/key.pem` + `certs/cert.pem` if present.

## Tests

```bash
npm test
```

Runs a headless-Chrome E2E (Playwright, `channel: 'chrome'`) with a fake camera: a simulated "phone" streams to the receiver page and the test asserts real video frames arrive and the connection reaches `connected`. The physical-iPhone + OBS legs are covered by `docs/manual-tests/iphone-obs.md`.

## Config

- `PORT` (default `8443`) — HTTPS port. Plain HTTP on `PORT+1` 301-redirects to HTTPS.
