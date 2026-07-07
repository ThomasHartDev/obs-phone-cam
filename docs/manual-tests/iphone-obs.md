# Manual test — real iPhone into OBS

The automated E2E (`npm test`) proves the WebRTC pipe with a fake camera in headless Chrome.
These steps cover the two legs that can't be automated: a physical iPhone camera and OBS itself.

**Covered by automation:** signaling, offer/answer, ICE, live frames reaching the receiver page, sender reaching `connected`.
**Manual (this doc):** real iOS Safari `getUserMedia`, the TLS trust-on-first-use, OBS Browser Source render, OBS Virtual Camera.

## Prerequisites
- Laptop and iPhone on the **same Wi-Fi**.
- Node 18+ on the laptop.
- OBS 28+ (Browser Source ships built in).
- From the repo: `npm install` then `npm start`.

## Tests

1. **Server boots with HTTPS**
   - Action: run `npm start`, read the printed URLs.
   - Expected: it lists a `https://<lan-ip>:8443/sender.html` line and a `https://localhost:8443/receiver.html` line.
   - Pass / Fail:

2. **Landing page + QR on the laptop**
   - Action: open `https://localhost:8443/` in the laptop browser.
   - Expected: title, a QR code, the sender URL with your real `192.168.x.x` IP, and the OBS receiver URL.
   - Pass / Fail:

3. **iPhone opens the sender page**
   - Action: scan the QR with the iPhone camera, open in Safari. On the cert warning tap **Show details → visit this website**. Allow camera access.
   - Expected: the phone shows its live camera full-screen with a bottom HUD (Flip camera, resolution, Mic). Status reads "Camera ready — waiting for OBS…".
   - Pass / Fail:

4. **OBS Browser Source shows the phone**
   - Action: in OBS add **Sources → + → Browser**, URL = `https://localhost:8443/receiver.html`, width/height = your canvas (1920×1080). OK.
   - Expected: within ~2s the phone feed appears in OBS; the phone status flips to green "Live in OBS ●".
   - Pass / Fail:

5. **Flip / resolution / mic renegotiate without a stall**
   - Action: on the phone tap Flip camera, then change resolution.
   - Expected: OBS keeps showing the feed (brief flicker at most); front/back and resolution actually change.
   - Pass / Fail:

6. **Refresh resilience**
   - Action: in OBS right-click the Browser Source → Refresh (or restart OBS).
   - Expected: the feed comes back on its own; the phone need not be touched.
   - Pass / Fail:

7. **(Optional) Webcam in Zoom/Teams**
   - Action: in OBS click **Start Virtual Camera**. In Zoom/Teams pick "OBS Virtual Camera".
   - Expected: the phone feed is usable as a webcam anywhere.
   - Pass / Fail:

## Notes
- If Safari refuses the camera: confirm you're on **https** (not http) and that you tapped through the cert warning. `getUserMedia` is blocked on a plain-http LAN IP.
- For a warning-free cert, install [mkcert](https://github.com/FiloSottile/mkcert) on the laptop, run `mkcert -install` then `mkcert -key-file certs/key.pem -cert-file certs/cert.pem localhost <your-lan-ip>`, and restart. The server auto-picks up `certs/`.
