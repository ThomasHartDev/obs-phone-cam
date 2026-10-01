using System.Diagnostics;
using System.Threading;

internal static class PhoneCam
{
    static void Main()
    {
        if (!PhoneCamServer.EnsureRunning(ProcessWindowStyle.Normal)) return;

        PhoneCamServer.Open("http://localhost:8444/");
        Thread.Sleep(400);
        PhoneCamServer.Open("http://localhost:8444/receiver.html");
        Thread.Sleep(400);
        PhoneCamServer.Open("http://localhost:8444/board-receiver.html");
    }
}
