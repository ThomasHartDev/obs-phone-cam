using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;

internal static class PhoneCam
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

    static void Open(string url)
    {
        Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
    }

    static void Main()
    {
        string dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            "obs-phone-cam");
        if (!PortOpen(8443))
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "cmd.exe";
                psi.Arguments =
                    "/c title Phone Cam for OBS & set OBS_NO_OPEN=1&& node server.mjs & pause";
                psi.WorkingDirectory = dir;
                psi.UseShellExecute = true;
                psi.CreateNoWindow = false;
                Process.Start(psi);
            }
            catch (Exception e)
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = "/c echo " + e.Message + " & pause",
                    UseShellExecute = true,
                });
                return;
            }
            for (int i = 0; i < 40; i++)
            {
                if (PortOpen(8443) && PortOpen(8444)) break;
                Thread.Sleep(250);
            }
        }

        Open("https://localhost:8443/");
        Thread.Sleep(400);
        Open("http://localhost:8444/receiver.html");
        Thread.Sleep(400);
        Open("http://localhost:8444/board-receiver.html");
    }
}
