# Manual test: Phone Cam QR launcher

`launch.test.mjs` checks that the launcher points at the pairing page. Starting
the server and sizing a Chrome window can only be checked on the Windows laptop.

## Prerequisites

- Run `windows\build-phone-cam-exe.bat` once. It makes `Phone Cam QR` on the
  desktop with the Ctrl+Alt+Q shortcut.
- Chrome installed.

## Tests

1. **Server already running.** With the server up, press Ctrl+Alt+Q.
   Expected: a small window titled "Phone Cam — iPhone" opens in the middle of
   the screen with the QR and a `https://<wifi ip>:8443/sender.html` link.
   Pass / Fail: ____
2. **Server stopped.** Stop the server, then double-click Phone Cam QR on the
   desktop. Expected: a minimized "Phone Cam for OBS" window appears in the
   taskbar, then the QR window opens as in test 1. Pass / Fail: ____
3. **Scan.** Scan the QR with the iPhone on the same Wi-Fi. Expected: Safari
   opens the sender page and the feed shows up in OBS. Pass / Fail: ____
4. **Phone Cam.exe still works.** Double-click Phone Cam.exe on the desktop.
   Expected: controls, iPhone feed and iPad feed open as three tabs, starting
   the server first if it was stopped. Pass / Fail: ____
