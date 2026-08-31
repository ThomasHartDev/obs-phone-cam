# obs-phone-cam

Use your iPhone as a low-latency camera source in OBS, and an iPad as a live whiteboard, over your local network. No app to install, no monthly fee. Each device just opens a page in Safari.

This is a free replacement for the Camo / Iriun / EpocCam class of apps, built on WebRTC + OBS Browser Sources.

## How it works

```
iPhone Safari  sender.html   ──WebRTC──►  OBS  receiver.html        (camera)
iPad   Safari  board.html    ──WebRTC──►  OBS  board-receiver.html  (whiteboard)
                     │                          │
                     └──── WS signaling relay ──┘
                           (server.mjs, HTTPS)
```

- **`server.mjs`** serves the pages over HTTPS and relays WebRTC signaling. HTTPS is required: iOS Safari blocks camera access on a LAN IP unless it's a secure context.
- The phone and OBS connect **peer to peer** on your Wi-Fi (Google STUN for ICE, no TURN needed on the same network), so the video never round-trips through a server.
- OBS renders each receiver page as a **Browser Source**. Click **Start Virtual Camera** in OBS to also use the phone as a webcam in Zoom/Teams. The iPad board is a second source you can chroma-key or place beside the camera.

## Run it

On the laptop that has OBS:

**Windows:** double-click **`Start Phone Cam.bat`**. It installs on first run, starts the server, and opens the laptop controls plus the iPhone and iPad feed tabs.

**Or from a terminal (any OS):**

```bash
npm install
npm start
```

Then:

1. Double-click the app (or `npm start`). Three tabs open: **laptop controls**, the **iPhone feed**, and the **iPad board feed**. Scan the QRs on the controls page with each device.
2. Scan the iPhone tab with your iPhone (same Wi-Fi). Tap through the one-time cert warning, allow the camera. Scan the iPad tab with your iPad.
3. In OBS: **Sources → + → Browser**, URL `http://localhost:8444/receiver.html` (plain http), size = your canvas.
4. After the phone is live, leave it alone. Use the laptop control panel for everything else.
5. In OBS add a second Browser Source at `http://localhost:8444/board-receiver.html` for the iPad board.

Safari on iPad cannot share another app's screen, so the board page itself is the drawing surface. Pick **Green (chroma)** paper if you want to key the drawing over the camera in OBS. On a desktop browser that supports window share, the board page also has **Share window** for a real Excalidraw tab.

Drawings save on the laptop (`data/drawings/`). Use **+** for a new tab, tap a tab to switch (OBS follows the active tab), and **Drawings** to open, rename, or delete saved boards. Closing a tab does not delete the drawing.

Apple Pencil: rest your palm, write. If strokes still vanish, iPad Settings → Apple Pencil → Scribble off (Safari can steal handwriting).

## Laptop remote control

The landing page connects as a **controller** (not the OBS receiver), so you can change every option without touching the phone:

- **Mirror** — horizontal flip (selfie-style)
- **Flip V** — vertical flip (upside-down mount / orientation fix)
- **Rotate 90°**, **Front/Back** camera, resolution, mic
- All filter presets + sliders (exposure, temp, lens fix, zoom, blur, …)
- A/B hold (raw vs graded), calibrate wipe, reset

Phone HUD still works; both stay in sync over the signaling WebSocket.

## Camera filters

Tap **Adjust** on the phone to open a real-time filter pipeline that runs on the phone's GPU before the frame ever leaves it, so OBS receives an already-corrected feed. It is one WebGL fragment shader per pixel: undo the capture rotation, apply geometry (mirror, zoom, lens-undistort for the front cam's wide-angle bulge), then grade color (exposure, white balance, tint, contrast, saturation, selective skin warmth). The front camera defaults to mirrored, same as the iPhone Camera app. Background blur uses MediaPipe selfie segmentation when the runtime is present.

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
