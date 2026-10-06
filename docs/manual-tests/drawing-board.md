# Manual test: Drawing Board launcher

`launch.test.mjs` checks that the launcher tags its shortcut and its window with
the same taskbar ID. Opening Chrome, focus and pinning can only be checked on
the Windows laptop.

## Prerequisites

- Run `windows\build-phone-cam-exe.bat`. It writes **Drawing Board** to the
  Start menu and the desktop with the whiteboard icon.
- Chrome installed.

## Tests

1. **Cold start.** Close the board window, then click Drawing Board.
   Expected: Excalidraw opens as its own window (no tabs or address bar) in the
   `FreeCodeBoard` profile and comes to the front. Pass / Fail: ____
2. **Already open.** With the board behind other windows, click it again.
   Expected: the same window comes forward and no second one opens.
   Pass / Fail: ____
3. **Pin.** Right-click Drawing Board in the Start menu, Pin to taskbar, then
   click the pin. Expected: the pin keeps the whiteboard icon, the board window
   shows up under that pin and not under Chrome, and the pin still works after
   closing and reopening the board. Pass / Fail: ____
4. **Your own Excalidraw tab.** Open excalidraw.com in normal Chrome, then click
   the pin. Expected: the board profile window opens anyway and the normal tab
   stays under Chrome. Pass / Fail: ____
5. **OBS.** Switch OBS to the Board scene. Expected: it captures the board
   window. Pass / Fail: ____
