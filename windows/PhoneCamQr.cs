using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32;

internal static class PhoneCamQr
{
    const string PairUrl = "http://localhost:8444/pair.html";
    const int Width = 520;
    const int Height = 700;

    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
    [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr hwnd, int x, int y, int w, int h, bool repaint);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);

    static string FindChrome()
    {
        foreach (RegistryKey root in new[] { Registry.CurrentUser, Registry.LocalMachine })
        {
            using (RegistryKey key = root.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"))
            {
                string path = key == null ? null : key.GetValue(null) as string;
                if (path != null && File.Exists(path)) return path;
            }
        }
        return null;
    }

    // An app window's title is exactly the page title; the server console is also called "Phone Cam ...".
    static IntPtr FindPairWindow()
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hwnd, l) =>
        {
            if (!IsWindowVisible(hwnd)) return true;
            StringBuilder title = new StringBuilder(256);
            GetWindowText(hwnd, title, title.Capacity);
            if (title.ToString() != "Phone Cam \u2014 iPhone" && title.ToString() != "Phone Cam \u2014 Pair") return true;
            StringBuilder cls = new StringBuilder(64);
            GetClassName(hwnd, cls, cls.Capacity);
            if (cls.ToString() != "Chrome_WidgetWin_1") return true;
            found = hwnd;
            return false;
        }, IntPtr.Zero);
        return found;
    }

    static void Show(IntPtr hwnd)
    {
        int x = (GetSystemMetrics(0) - Width) / 2;
        int y = (GetSystemMetrics(1) - Height) / 2;
        MoveWindow(hwnd, Math.Max(0, x), Math.Max(0, y), Width, Height, true);
        PhoneCamServer.BringToFront(hwnd);
    }

    static void Main()
    {
        ShowPairWindow();
    }

    public static void ShowPairWindow()
    {
        if (!PhoneCamServer.EnsureRunning(ProcessWindowStyle.Minimized)) return;

        IntPtr open = FindPairWindow();
        if (open != IntPtr.Zero)
        {
            Show(open);
            return;
        }

        string chrome = FindChrome();
        if (chrome == null)
        {
            PhoneCamServer.Open(PairUrl);
            return;
        }
        Process.Start(new ProcessStartInfo
        {
            FileName = chrome,
            Arguments = "--app=" + PairUrl,
            UseShellExecute = false,
        });

        // Chrome ignores --window-size when it is already running, so size the window ourselves.
        for (int i = 0; i < 40; i++)
        {
            IntPtr hwnd = FindPairWindow();
            if (hwnd != IntPtr.Zero)
            {
                Show(hwnd);
                return;
            }
            Thread.Sleep(150);
        }
    }
}
