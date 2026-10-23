using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

internal static class PhoneCamServer
{
    internal static bool PortOpen(int port)
    {
        try
        {
            using (TcpClient c = new TcpClient())
            {
                IAsyncResult ar = c.BeginConnect("127.0.0.1", port, null, null);
                if (!ar.AsyncWaitHandle.WaitOne(250)) return false;
                c.EndConnect(ar);
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    static string FindDir()
    {
        string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        string[] candidates =
        {
            Environment.GetEnvironmentVariable("PHONE_CAM_DIR") ?? "",
            Path.GetFullPath(Path.Combine(exeDir, "..")),
            Path.Combine(desktop, "projects", "obs-phone-cam"),
            Path.Combine(desktop, "obs-phone-cam"),
        };
        foreach (string dir in candidates)
        {
            if (dir.Length > 0 && File.Exists(Path.Combine(dir, "server.mjs"))) return dir;
        }
        return null;
    }

    static void Fail(string message)
    {
        MessageBox.Show(message, "Phone Cam", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    static string Warp(string warpCli, string args)
    {
        try
        {
            using (Process p = Process.Start(new ProcessStartInfo
            {
                FileName = warpCli,
                Arguments = args,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
            }))
            {
                string output = p.StandardOutput.ReadToEnd();
                p.WaitForExit(5000);
                return output;
            }
        }
        catch
        {
            return "";
        }
    }

    // Without camera permission Chrome (and OBS's browser source) offers WebRTC only the
    // interface that routes to these probe addresses. Through Cloudflare WARP that's the
    // tunnel, which the phone can't reach, so keep them on the Wi-Fi.
    static readonly string[] ChromeRouteProbes = { "8.8.8.8/32", "2001:4860:4860::8888/128" };

    static void KeepWebRtcOnLan()
    {
        string warpCli = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Cloudflare\Cloudflare WARP\warp-cli.exe");
        if (!File.Exists(warpCli)) return;
        string routes = Warp(warpCli, "tunnel ip list --no-paginate");
        if (!routes.StartsWith("Excluded")) return;
        foreach (string probe in ChromeRouteProbes)
        {
            if (!routes.Contains(probe)) Warp(warpCli, "tunnel ip add " + probe.Substring(0, probe.IndexOf('/')));
        }
    }

    public static bool EnsureRunning(ProcessWindowStyle windowStyle)
    {
        KeepWebRtcOnLan();
        if (PortOpen(8443) || PortOpen(8444)) return WaitForPorts();

        string dir = FindDir();
        if (dir == null)
        {
            Fail("Could not find obs-phone-cam. Set PHONE_CAM_DIR to the folder that has server.mjs.");
            return false;
        }
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = "/c title Phone Cam for OBS & set OBS_NO_OPEN=1&& node server.mjs & pause",
                WorkingDirectory = dir,
                UseShellExecute = true,
                WindowStyle = windowStyle,
            });
        }
        catch (Exception e)
        {
            Fail(e.Message);
            return false;
        }
        return WaitForPorts();
    }

    static bool WaitForPorts()
    {
        for (int i = 0; i < 40; i++)
        {
            if (PortOpen(8443) && PortOpen(8444)) return true;
            Thread.Sleep(250);
        }
        Fail("The server didn't come up on ports 8443 and 8444. Check the Phone Cam for OBS window in the taskbar for the error.");
        return false;
    }

    public static void Open(string url)
    {
        Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);

    // Windows refuses SetForegroundWindow once this process has handed focus to another window
    // (OBS, then Chrome); a synthetic Alt tap lifts that lock, so it's only the fallback.
    public static void BringToFront(IntPtr hwnd)
    {
        if (SetForegroundWindow(hwnd)) return;
        keybd_event(0x12, 0, 0, UIntPtr.Zero);
        keybd_event(0x12, 0, 2, UIntPtr.Zero);
        SetForegroundWindow(hwnd);
    }
}
