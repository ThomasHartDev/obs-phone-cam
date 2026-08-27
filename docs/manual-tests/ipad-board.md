# Manual test — iPad whiteboard into OBS

Automated E2E covers the WebRTC pipe with a headless Chrome board page. These steps cover Apple Pencil, iPad Safari, and compositing next to the iPhone camera in OBS.

Safari on iPad cannot share another app (no `getDisplayMedia`). The board page is the drawing surface.

## Prerequisites

- Laptop, iPhone, and iPad on the same Wi-Fi.
- Phone cam already running (`npm start`).
- OBS Browser Source for the phone already working.

## Tests

1. **Landing shows an iPad QR**
   - Action: open `https://localhost:8443/` on the laptop.
   - Expected: section "3. Draw on an iPad" with a QR, a `board.html` URL, and `http://localhost:8444/board-receiver.html`.
   - Pass / Fail:

2. **iPad opens the board**
   - Action: scan the iPad QR. Tap through the cert warning if needed.
   - Expected: a full-screen paper with a top toolbar (Pen, shapes, colors). Status reads "Waiting for OBS…".
   - Pass / Fail:

3. **OBS shows the board**
   - Action: Sources → + → Browser, URL `http://localhost:8444/board-receiver.html`, 1920×1080.
   - Expected: the paper appears in OBS; iPad status flips to "Live in OBS".
   - Pass / Fail:

4. **Pencil / finger drawing**
   - Action: draw a box, an arrow, and a handwritten word. Undo once.
   - Expected: strokes show on the iPad and in OBS with no multi-second lag. Undo removes the last mark.
   - Pass / Fail:

5. **Phone camera stays live**
   - Action: with the board live, look at the existing phone Browser Source.
   - Expected: the iPhone feed does not freeze or drop.
   - Pass / Fail:

6. **Chroma overlay (optional)**
   - Action: on the iPad pick Paper → Green (chroma). In OBS, filter the board source with Chroma Key (green).
   - Expected: only the ink sits over the camera.
   - Pass / Fail:

7. **Desktop window share (optional)**
   - Action: open the board page in laptop Chrome, click Share window, pick an Excalidraw tab.
   - Expected: that window appears in the same OBS board source. iPad Safari will not show this button.
   - Pass / Fail:
