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

**Windows:** double-click **`Start Phone Cam.bat`**. It installs on first run, starts the server, and opens your browser to the QR page automatically.

**Or from a terminal (any OS):**

```bash
npm install
npm start
```

Then:

1. Open `https://localhost:8443/` on the laptop — it shows a QR code, the OBS URL, and a **control panel**.
2. Scan the QR with your iPhone (same Wi-Fi). Tap through the one-time cert warning, allow the camera.
3. In OBS: **Sources → + → Browser**, URL `http://localhost:8444/receiver.html` (plain http), size = your canvas.
4. After the phone is live, leave it alone. Use the laptop control panel for everything else.

## Laptop remote control

The landing page connects as a **controller** (not the OBS receiver), so you can change every option without touching the phone:

- **Mirror** — horizontal flip (selfie-style)
- **Flip V** — vertical flip (upside-down mount / orientation fix)
- **Rotate 90°**, **Front/Back** camera, resolution, mic
- All filter presets + sliders (exposure, temp, lens fix, slim, zoom, blur, …)
- A/B hold (raw vs graded), calibrate wipe, reset

Phone HUD still works; both stay in sync over the signaling WebSocket.

## Certificate

By default the server generates a self-signed cert, so Safari shows a one-time warning you tap through. To make the warning disappear for good, install [mkcert](https://github.com/FiloSottile/mkcert) once — the Windows launcher then auto-runs `mkcert -install` and mints a trusted cert on next start. Manual equivalent:

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
