using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

internal static class PhoneCamStudio
{
    const string DefaultScene = "Browser";

    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);

    static string FindObs()
    {
        using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\OBS Studio"))
        {
            string dir = key == null ? null : key.GetValue(null) as string;
            string exe = dir == null ? null : Path.Combine(dir, @"bin\64bit\obs64.exe");
            if (exe != null && File.Exists(exe)) return exe;
        }
        string fallback = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"obs-studio\bin\64bit\obs64.exe");
        return File.Exists(fallback) ? fallback : null;
    }

    static Process RunningObs()
    {
        Process[] running = Process.GetProcessesByName("obs64");
        return running.Length > 0 ? running[0] : null;
    }

    static string PickScene(string[] args)
    {
        string scene = args.Length > 0 ? args[0] : Environment.GetEnvironmentVariable("PHONE_CAM_SCENE");
        if (string.IsNullOrWhiteSpace(scene)) scene = DefaultScene;
        return scene.Replace("\"", "").TrimEnd('\\');
    }

    static void BringForward(Process obs, int waitMs)
    {
        for (int waited = 0; waited < waitMs && obs.MainWindowHandle == IntPtr.Zero; waited += 200)
        {
            Thread.Sleep(200);
            obs.Refresh();
        }
        IntPtr hwnd = obs.MainWindowHandle;
        if (hwnd == IntPtr.Zero) return;
        if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
        PhoneCamServer.BringToFront(hwnd);
    }

    const string AppUserModelId = "ThomasHart.PhoneCamStudio";

    static void Main(string[] args)
    {
        if (args.Length > 0 && args[0] == "--install")
        {
            string lnk = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Phone Cam Studio.lnk");
            AppId.WriteShortcut(lnk, Application.ExecutablePath, Application.ExecutablePath, AppUserModelId, "Phone cam server, OBS and the pairing QR in one click");
            return;
        }
        // A double-click would otherwise start OBS twice and trip its "already running" dialog.
        bool first;
        using (new Mutex(true, "PhoneCamStudio", out first))
        {
            if (first) Run(args);
        }
    }

    static void Run(string[] args)
    {
        // The camera browser source loads its page once, so the server must be up before OBS starts.
        if (!PhoneCamServer.EnsureRunning(ProcessWindowStyle.Minimized)) return;

        Process obs = RunningObs();
        if (obs != null)
        {
            BringForward(obs, 1000);
        }
        else
        {
            string exe = FindObs();
            if (exe == null)
            {
                MessageBox.Show("Couldn't find OBS Studio (obs64.exe). Install it or reinstall it to the default folder.", "Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            try
            {
                obs = Process.Start(new ProcessStartInfo
                {
                    FileName = exe,
                    Arguments = "--scene \"" + PickScene(args) + "\" --disable-shutdown-check --disable-missing-files-check",
                    WorkingDirectory = Path.GetDirectoryName(exe),
                    UseShellExecute = false,
                });
            }
            catch (Exception e)
            {
                MessageBox.Show("OBS didn't start: " + e.Message, "Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            BringForward(obs, 20000);
        }

        PhoneCamQr.ShowPairWindow();
    }
}
