using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

internal static class PhoneCamServer
{
    static bool PortOpen(int port)
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

    public static bool EnsureRunning(ProcessWindowStyle windowStyle)
    {
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
}
