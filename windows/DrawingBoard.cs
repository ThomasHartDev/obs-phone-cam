using System;
using System.Diagnostics;
using System.Management;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class DrawingBoard
{
    const string AppUserModelId = "ThomasHart.DrawingBoard";
    const int SwMaximize = 3;
    const string Url = "https://excalidraw.com/";
    static readonly string Profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "FreeCodeBoard");
    static readonly string ProfileArg = "--user-data-dir=\"" + Profile + "\"";

    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    static bool IsBoardProfile(uint pid)
    {
        string query = "SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + pid + " AND Name = 'chrome.exe'";
        try
        {
            using (ManagementObjectSearcher search = new ManagementObjectSearcher(query))
            {
                foreach (ManagementObject p in search.Get())
                {
                    string cmd = p["CommandLine"] as string;
                    if (cmd != null && cmd.IndexOf(ProfileArg, StringComparison.OrdinalIgnoreCase) >= 0) return true;
                }
            }
        }
        catch (ManagementException) { }
        return false;
    }

    // Only the board profile's Excalidraw window counts, so another app's Excalidraw window never gets the pin's ID.
    static IntPtr FindBoardWindow()
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, l) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            StringBuilder title = new StringBuilder(256);
            GetWindowText(hwnd, title, title.Capacity);
            string t = title.ToString();
            if (!t.Contains("Excalidraw") || t.EndsWith(" - Google Chrome")) return true;
            StringBuilder cls = new StringBuilder(64);
            GetClassName(hwnd, cls, cls.Capacity);
            if (cls.ToString() != "Chrome_WidgetWin_1") return true;
            uint pid;
            GetWindowThreadProcessId(hwnd, out pid);
            if (!IsBoardProfile(pid)) return true;
            found = hwnd;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    static void Install(string exe)
    {
        string description = "Excalidraw in its own Chrome profile, maximized for the OBS Excalidraw scene";
        foreach (Environment.SpecialFolder folder in new[] { Environment.SpecialFolder.Programs, Environment.SpecialFolder.DesktopDirectory })
        {
            AppId.WriteShortcut(Path.Combine(Environment.GetFolderPath(folder), "Drawing Board.lnk"), exe, exe, AppUserModelId, description);
        }
    }

    static void Main(string[] args)
    {
        string exe = Application.ExecutablePath;
        if (args.Length > 0 && args[0] == "--install")
        {
            Install(exe);
            return;
        }
        // A double-click would otherwise open two board windows, and OBS only captures one.
        bool first;
        using (new Mutex(true, "DrawingBoard", out first))
        {
            if (first) Open(exe);
        }
    }

    static void Open(string exe)
    {
        IntPtr hwnd = FindBoardWindow();
        if (hwnd == IntPtr.Zero)
        {
            string chrome = PhoneCamQr.FindChrome();
            if (chrome == null)
            {
                MessageBox.Show("Couldn't find Chrome.", "Drawing Board", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            // The separate profile keeps the board's drawings and keeps it out of the everyday Chrome window.
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = chrome,
                    Arguments = ProfileArg + " --no-first-run --no-default-browser-check --app=" + Url,
                    UseShellExecute = false,
                });
            }
            catch (Exception e)
            {
                MessageBox.Show("Chrome didn't start: " + e.Message, "Drawing Board", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            for (int i = 0; i < 200 && hwnd == IntPtr.Zero; i++)
            {
                Thread.Sleep(150);
                hwnd = FindBoardWindow();
            }
            if (hwnd == IntPtr.Zero)
            {
                MessageBox.Show("The board window didn't open within 30 seconds. Chrome may still be starting it.", "Drawing Board", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
        }

        AppId.TagWindow(hwnd, AppUserModelId, exe, "Drawing Board", exe);
        // OBS's Excalidraw view captures the screen (the board's title keeps changing), so the board has to fill it.
        ShowWindow(hwnd, SwMaximize);
        PhoneCamServer.BringToFront(hwnd);
    }
}
