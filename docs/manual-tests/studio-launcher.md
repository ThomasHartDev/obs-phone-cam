# Manual test: Phone Cam Studio launcher

`launch.test.mjs` checks that Studio starts the server before OBS and reuses the
pairing window. Launching OBS, window focus and the taskbar pin can only be
checked on the Windows laptop.

## Prerequisites

- Run `windows\build-phone-cam-exe.bat`. It adds **Phone Cam Studio** (camera icon) to the
  Start menu. Right-click it and choose **Pin to taskbar**.
- OBS Studio installed, with a scene named `Screen + Face`.

## Tests

1. **Cold start.** Close OBS and stop the server, then click the pinned Phone Cam Studio
   icon. Expected: a minimized "Phone Cam for OBS" window appears in the
   taskbar, OBS opens on `Screen + Face` with no pop-ups, and the "Phone Cam —
   iPhone" QR window ends up in front of OBS. Pass / Fail: ____
2. **OBS already open.** With OBS open behind other windows, click the icon.
   Expected: OBS comes forward within a second and the QR window opens on top.
   Pass / Fail: ____
3. **Scan.** Scan the QR with the iPhone. Expected: the camera shows up in the
   desktop face box and the vertical strip without touching OBS.
   Pass / Fail: ____
4. **Other scene.** Run `setx PHONE_CAM_SCENE "Code"`, close OBS, click the
   icon. Expected: OBS opens on `Code`. Run `setx PHONE_CAM_SCENE ""` after.
   Pass / Fail: ____
5. **No OBS.** On a machine without OBS, click the icon. Expected: a message
   says OBS Studio couldn't be found, and the server is still running.
   Pass / Fail: ____
6. **Studio pin stays put.** Pin Phone Cam Studio from the Start menu and
   click it twice. Expected: the pin keeps the camera icon and doesn't turn into
   Chrome, and every click reruns the setup (OBS forward, QR on top).
   Pass / Fail: ____
7. **Existing pin gets the new icon.** With Phone Cam Studio already pinned
   (old OBS icon), rerun `windows\build-phone-cam-exe.bat`. Expected: the pin
   switches to the camera icon without unpinning, and clicking it still runs
   the full setup. Pass / Fail: ____
