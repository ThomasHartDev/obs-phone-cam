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

1. Open `https://localhost:8443/` on the laptop — it shows a QR code and the OBS URL.
2. Scan the QR with your iPhone (same Wi-Fi). Tap through the one-time cert warning, allow the camera.
3. In OBS: **Sources → + → Browser**, URL `https://localhost:8443/receiver.html`, size = your canvas.

The phone's HUD lets you flip front/back camera, pick a resolution, and toggle the mic.

## Camera filters

Tap **Adjust** on the phone to open a real-time filter pipeline that runs on the phone's GPU before the frame ever leaves it, so OBS receives an already-corrected feed. It is one WebGL fragment shader per pixel: undo the capture rotation, apply geometry (mirror, zoom, lens-undistort for the front cam's wide-angle bulge, a subtle central slim), then grade color (exposure, white balance, tint, contrast, saturation, selective skin warmth). Background blur uses MediaPipe selfie segmentation when the runtime is present.

There are named presets, and a calibration mode that splits the frame raw vs graded so you can tune "true to life" against the untouched image. Filter math, presets, A/B, and the calibration split are covered by `npm test`; whether the corrected feed actually looks like your face is the one leg a headless browser can't judge, so that's in `docs/manual-tests/camera-filters.md`.

The MediaPipe runtime is populated on `postinstall` (`scripts/setup-mediapipe.mjs`), which is fail-soft: no network just means background blur stays inert, the rest works.

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

## Stack

- Node.js HTTPS server + `ws` for WebRTC signaling (`server.mjs`), no framework
- WebRTC peer-to-peer over the LAN (Google STUN, no TURN)
- WebGL fragment-shader filter pipeline (`public/filters.js`) + MediaPipe tasks-vision for segmentation
- `qrcode` for the pairing QR, `selfsigned` for the fallback cert, `mkcert` for a trusted one
- Playwright (`channel: 'chrome'`) for the fake-camera E2E
