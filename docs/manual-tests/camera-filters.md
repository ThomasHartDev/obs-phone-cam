# Manual test — camera filters (iPhone leg)

The color/geometry math, presets, A/B, calibration split, and the WebRTC→OBS
path are all covered by automated tests (`npm test`, 6 tests, run against a fake
camera in desktop Chrome). What a headless browser **cannot** judge is whether
the corrected feed actually looks like your real face. That's this document.

## Prerequisites

- The server is running on the OBS laptop (`npm start`).
- iPhone on the same Wi-Fi, sender page open in Safari, camera allowed.
- OBS has the Browser Source pointed at `receiver.html` so you can see the
  broadcast (un-mirrored) frame while you tune.

## Tests

1. **Panel opens.** Tap **Adjust**. → Expected: the settings panel slides up
   with 5 preset chips, 9 sliders, Mirror / Calibrate toggles, Reset.
   Pass / Fail: ____

2. **Preset applies live.** Tap **Warm Studio**. → Expected: feed warms and
   brightens immediately, no freeze/blip in OBS, sliders jump to the preset's
   values, the chip highlights blue. Pass / Fail: ____

3. **A/B compare.** Press and hold **A/B**. → Expected: feed snaps to the raw,
   unprocessed frame while held; releasing returns to your look. Pass / Fail: ___

4. **Calibration wipe.** Tap **Adjust → Calibrate (raw | you)**. → Expected: the
   feed splits vertically — left = untouched, right = your graded look — so you
   can compare the same instant. Pass / Fail: ____

5. **Face shape (the point).** With Calibrate on, watch the left (raw) vs right
   (corrected) halves of your face. Raise **Lens fix** until the wide-angle
   bulge (nose/forehead) on the right looks like the mirror. → Expected: the
   corrected half reads closer to real life than the raw half. Pass / Fail: ____
   - If the shader correction isn't enough: switch to the **rear camera**
     (Flip camera), use **Zoom ~1.3** and step back ~1m. The 3x tele is the
     physically-correct portrait lens; this is the strongest face-shape fix.

6. **Skin/color to life.** Turn Calibrate off. Adjust **Temp**, **Skin warmth**,
   **Exposure** until your skin on the OBS output matches what you see in a
   mirror / a photo you trust. → Expected: skin looks like you, not the iPhone's
   over-warm/over-processed default. Pass / Fail: ____

7. **Persistence.** Force-quit Safari, reopen the sender page. → Expected: your
   last settings are restored (saved to `localStorage`). Pass / Fail: ____

8. **No performance regression.** Film at 1080p for ~2 min. → Expected: smooth in
   OBS, no dropped-frame stutter, phone doesn't overheat. If 4K stutters or the
   phone gets hot, drop to 1080p (the shader is heavier at 4K/60). Pass / Fail: __

## Telephoto / background blur (the TikTok "zoom" look)

Background isolation uses on-device MediaPipe segmentation. The model loads the
first time you enable blur (~11MB, a one-time couple-second hitch). The WebGL
compositing, asset serving, and the model loading + returning a mask are all
covered by automated tests; what's manual is how it looks on your real face.

9. **Telephoto preset.** Tap **Adjust → Telephoto**. → Expected: after a brief
   load, the frame crops in slightly and the background softens while your face
   stays sharp. Should read like a longer lens, not an obvious cutout.
   Pass / Fail: ____

10. **Blur is subtle, not obvious.** Look at the edge around your hair/shoulders.
    → Expected: a soft feathered transition, no hard halo, no flicker as you
    move. If it looks like an obvious filter, drop **Background blur** lower.
    Pass / Fail: ____

11. **Polarity sanity check.** → Expected: the BACKGROUND is blurred and YOU are
    sharp. If it's inverted (your face blurred, background sharp), that's a
    one-line mask-polarity flip — report it. Pass / Fail: ____

12. **Blur off = no cost.** Set Background blur to 0 (or pick a non-Telephoto
    preset). → Expected: segmentation stops running, no perf/battery cost.
    Pass / Fail: ____

## Coverage summary

- Automated (desktop, fake camera): grade alters frame, A/B bypass, exposure,
  rotate through the shader, single-sender handoff, bitrate ceiling, WebRTC
  delivery to the receiver.
- Manual (this doc): real-face look match, on-device performance/heat, Safari
  `localStorage` persistence.
