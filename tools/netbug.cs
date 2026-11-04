// netbug - lightweight always-on network health logger.
//
// Probes every second (gateway ping, 1.1.1.1 + 8.8.8.8 ping, packet counters), the active
// interface on Windows network events (every second while failing, else every 10 s), DNS via the
// gateway every 2 s (a failed query is retried the next second), a TCP connect +
// UDP port usage + gateway MAC every 10 s (a failed TCP connect is retried every
// second), and the public IP every 5 min.
// Background threads keep one long-lived TLS connection (HEAD every 15 s) and one
// long-lived UDP socket doing STUN every 2 s (UDP RTT + NAT mapping).
// Writes a CSV row every 5 s while healthy and every 1 s during (and 60 s after)
// any failure. Outage/LAG start/end, link, interface, gateway MAC, public IP, NAT
// mapping, TCP-connection deaths and UDP-usage changes go to events.log. An outage,
// 5 s of lag, high UDP usage, a gateway MAC change or detected ARP spoofing triggers
// snapshot.ps1, at most once per 60 s.
// ARP spoofing defence: every 10 s the gateway's ARP entry type is read (static = pinned,
// dynamic = learned). A MAC for the gateway IP other than the trusted one (the first seen
// for that IP, or the pinned one) is logged as GATEWAY MAC CHANGED.
// A continuous ARP-only capture (pktmon, read by netbug every 60 s, last 15 min kept in memory) runs
// all the time. Every 5 min, and when a snapshot starts, its new frames are judged: any other MAC
// claiming the gateway IP or this laptop's IP is ARP SPOOFING DETECTED, even while a pinned entry makes
// Windows ignore it. A snapshot saves the ARP from the 15 min before it (<snapshot>.ring.txt). See the
// "ARP watch" section.
// MAC announce: about once a second this laptop sends an ARP request (sender = its own IP and MAC),
// so a router told a fake MAC for this laptop learns the real one again within a second. See the
// "MAC announce" section.
// logs/ is kept under 30 days and 500 MB. An hourly health line is written, and the
// process restarts itself past 200 MB private memory / 5000 handles / 100 threads.
// A dashboard (tools/dashboard.html + its font + /api/state + /api/events) is served on port 8787,
// read-only, on all interfaces (localhost only for a lone exe, see below).
// Router check and pin (the dashboard's "Router protection" panel, for the person at this laptop
// only): finds the real router MAC by testing every MAC that claims the gateway IP (or tests one known
// or typed MAC), and can pin it as a permanent ARP entry. See the "router check and pin" section.
//
// Started without admin rights (a double-click), netbug asks for UAC, starts an elevated copy and
// opens the dashboard in the default browser. The first elevated start sets up the "netbug" logon task
// (see the "install" section). A lone netbug.exe (no dashboard.html next to it, e.g. a GitHub release
// download) installs itself to %ProgramData%\netbug, runs from there, unpacks its page, font and
// scripts from its own resources and serves the dashboard on localhost only.
// netbug.exe --uninstall removes the task and the router pin (and, for a lone exe, its program files in
// %ProgramData%\netbug). The logs always stay.
// Export and updates (the page's "Logs and updates" panel, this laptop only): one zip of everything in
// logs/ plus the in-memory ARP ring, nothing redacted, downloaded through the browser. Every 6 h (and on
// the page's button) netbug asks GitHub for the latest release; a lone exe installs a newer one by itself,
// a repo copy only reports it. See "export and updates".
//
// Build (in tools/): csc /target:winexe /optimize /out:netbug.exe /r:System.IO.Compression.dll /resource:dashboard.html,netbug.dashboard.html
//   /resource:fonts\inter.woff2,netbug.inter.woff2 /resource:arpwatch.ps1,netbug.arpwatch.ps1
//   /resource:snapshot.ps1,netbug.snapshot.ps1 [/resource:routers.local.txt,netbug.routers.txt] netbug.cs
// (routers.local.txt, gitignored: known router MACs offered on the page, see "router check and pin")

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.IO.Compression;

[assembly: System.Reflection.AssemblyTitle("netbug")]
[assembly: System.Reflection.AssemblyVersion(NetBug.Version)]
[assembly: System.Reflection.AssemblyFileVersion(NetBug.Version)]

class NetBug
{
    // the release version: an update is a GitHub release with a higher tag (see "export and updates")
    public const string Version = "1.0.5";

    [DllImport("iphlpapi.dll")]
    static extern int GetExtendedUdpTable(IntPtr table, ref int size, bool sort, int af, int tableClass, int reserved);

    [DllImport("iphlpapi.dll")]
    static extern int SendARP(int destIp, int srcIp, byte[] mac, ref int macLen);

    [DllImport("iphlpapi.dll")]
    static extern int GetIpNetTable(IntPtr table, ref int size, bool order);

    [DllImport("iphlpapi.dll")]
    static extern int ResolveIpNetEntry2(IntPtr row, IntPtr sourceAddress);

    [DllImport("iphlpapi.dll")]
    static extern int DeleteIpNetEntry2(IntPtr row);

    [DllImport("iphlpapi.dll", SetLastError = true)]
    static extern IntPtr IcmpCreateFile();

    [DllImport("iphlpapi.dll")]
    static extern bool IcmpCloseHandle(IntPtr handle);

    [DllImport("iphlpapi.dll", SetLastError = true)]
    static extern int IcmpSendEcho2Ex(IntPtr handle, IntPtr ev, IntPtr apc, IntPtr apcContext, uint source, uint dest,
        byte[] data, short dataSize, ref IpOptions options, IntPtr reply, int replySize, int timeout);

    [StructLayout(LayoutKind.Sequential)]
    struct IpOptions { public byte Ttl, Tos, Flags, OptionsSize; public IntPtr OptionsData; }

    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr process, int infoClass, ref ProcessInfo info, int size, out int returned);

    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo { public IntPtr Reserved1, Peb, Reserved2, Reserved3, Pid, ParentPid; }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern bool MoveFileEx(string existing, string newName, int flags);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBox(IntPtr owner, string text, string caption, uint type);

    const int UdpWarnThreshold = 3000;   // Windows has 16384 dynamic UDP ports
    const string TcpProbeHost = "github.com";
    const int RetentionDays = 30;

    static string baseDir, logDir, snapDir;
    static readonly Random rng = new Random();

    // state carried between iterations
    static bool inOutage;
    static DateTime outageStart, fastUntil, lastSnapshot = DateTime.MinValue;
    static string outageWhat = "";
    static string lastIface = "", lastEthLink = "", lastGwMac = "", lastPubIp = "", pubIp = "";
    static int udpTotal = -1;
    static string udpTop = "";
    static int tcpMs = 0, dnsMs = 0;
    static string gwMac = "";
    // ARP spoofing defence: the gateway's ARP entry type (static = pinned, dynamic = learned),
    // a loud alert when the gateway MAC changes while the gateway IP stays the same, and the
    // continuous ARP capture (see "ARP watch"), which reports anyone else claiming the gateway IP or
    // this laptop's IP.
    // The trusted MAC is the first one seen for a gateway IP, replaced by a pin or by a MAC a router check
    // proved (the first one seen can be an impostor already answering at start). It is not replaced by a
    // changed MAC, so a poisoned ARP cache can't make the impostor "trusted".
    static string gwArp = "", lastGwArp = "", trustedGwMac = "", trustedGwIp = "";
    static volatile string gwAlert = "";
    static DateTime gwAlertAt = DateTime.MinValue;
    static volatile string arpWatch = "";
    static bool udpWarned;
    static int failStreak;
    const int LagGwMs = 15;
    static bool inLag, lagSnapped;
    static DateTime lagStart, lagLastBad;
    static long lagMaxGw;
    static int lagLoss, lagSamples;
    static string lastTcpReason = "";
    static int tcpRepeats;
    static IPAddress tcpProbeIp;
    static long lastTx = -1, lastRx = -1;
    static string currentDay = "";

    // UDP path check: one long-lived UDP socket (like a Discord/Valorant voice flow) sends a
    // STUN binding request every 2 s and reads back the public ip:port the NAT mapped it to.
    static readonly string[] StunServers = { "stun.cloudflare.com:3478", "stun.l.google.com:19302" };
    static UdpClient stunSock;
    static readonly Dictionary<string, IPAddress> stunIps = new Dictionary<string, IPAddress>();
    static bool stunReresolve;   // StunLoop thread only: resolve the STUN servers again on the next probe
    static volatile int udpMs = 0;
    static volatile string udpMap = "";
    static string lastUdpMap = "";

    // dashboard: the main loop publishes its latest sample and keeps the last 300 s for the chart
    const int DashPort = 8787;
    static readonly DateTime started = DateTime.Now;
    static volatile string sampleJson = "null";
    static readonly string[] hist = new string[300];
    static int histPos, histCount;
    static double dashMemMb;
    static DateTime dashMemAt = DateTime.MinValue;

    const long LogCapBytes = 500L * 1024 * 1024;   // hard cap for logs/, oldest snapshots then CSVs go first
    const string CsvHeader = "time,iface,eth_link,ip,gw,gw_mac,gw_arp,gw_ms,cf_ms,g_ms,dns_ms,tcp_ms,udp_ms,udp_map,tx_pkts,rx_pkts,udp_total,udp_top,public_ip,fail,date,utc_offset";

    static void Main(string[] args)
    {
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        portable = !File.Exists(Path.Combine(exeDir, "dashboard.html"));
        if (portable) baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "netbug");
        else baseDir = Path.GetFullPath(Path.Combine(exeDir, ".."));
        logDir = Path.Combine(baseDir, "logs");
        snapDir = Path.Combine(logDir, "snapshots");
        bool uninstall = args.Contains("--uninstall");
        if (!IsAdmin()) { if (uninstall) Elevate("--uninstall"); else Launch(); return; }
        if (uninstall)
        {
            Uninstall(Process.GetCurrentProcess().Id);
            MessageBox(IntPtr.Zero, "netbug is removed: its scheduled task, the router pin" + (portable ? " and its program files" : "") +
                ". The logs stay in " + logDir + ".", "netbug", 0x40);
            return;
        }
        // opened by hand as admin (UAC off, or "Run as administrator"): show the page too. Not when
        // started by the launcher (it opens the page itself), the logon task or a self-restart.
        bool openPage = !args.Contains("--from-launcher") && ParentName() == "explorer";

        using (var self = Process.GetCurrentProcess())
        {
            self.PriorityClass = ProcessPriorityClass.BelowNormal;
            // at most 4 logical processors: the 4 highest-numbered (core 0 takes most interrupts). Child
            // processes (pktmon, PowerShell, netsh) inherit it. netbug needs far less than one core.
            int n = Environment.ProcessorCount;
            if (n > 4 && n <= 64) self.ProcessorAffinity = (IntPtr)(0xFL << (n - 4));
        }
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;   // TLS 1.2; .NET 4.0 defaults to TLS 1.0

        Directory.CreateDirectory(snapDir);
        if (Install(openPage)) return;   // the scheduled task's copy runs instead of this one
        LoadSettings();

        using (var mutex = new Mutex(false, "Global\\netbug"))
        {
            // wait a little so a self-restart (see Health) can take over from the exiting instance
            try { if (!mutex.WaitOne(15000)) { if (openPage) OpenPage(); return; } }   // another instance is running
            catch (AbandonedMutexException) { }
            if (portable) Unpack();   // only once this is the running instance: never under a running one's feet
            Event("netbug started" + (portable ? " (portable, files in " + baseDir + ")" : ""));
            new Thread(PersistentTcpLoop) { IsBackground = true, Priority = ThreadPriority.BelowNormal }.Start();
            new Thread(StunLoop) { IsBackground = true, Priority = ThreadPriority.BelowNormal }.Start();
            new Thread(DashboardLoop) { IsBackground = true, Priority = ThreadPriority.BelowNormal }.Start();
            new Thread(AnnounceLoop) { IsBackground = true, Priority = ThreadPriority.BelowNormal }.Start();
            new Thread(RingLoop) { IsBackground = true, Priority = ThreadPriority.BelowNormal }.Start();
            new Thread(UpdateLoop) { IsBackground = true, Priority = ThreadPriority.BelowNormal }.Start();
            if (portable) Task.Run(() => { Thread.Sleep(30000); DeleteUpdateFiles(); });   // left by a failed update
            if (openPage) Task.Run(() => { for (int i = 0; i < 60 && !PageUp(); i++) Thread.Sleep(500); OpenPage(); });
            Run();
        }
    }

    // ---------------------------------------------------------------- start-up

    static readonly string PageUrl = "http://localhost:" + DashPort + "/";

    static bool IsAdmin()
    {
        using (var id = WindowsIdentity.GetCurrent()) return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
    }

    // Not elevated: if netbug already runs (and, for a lone exe, this copy is the installed one), just
    // open its page. Otherwise start an elevated copy (UAC prompt), which installs or updates netbug and
    // starts it, then wait for the dashboard and open it here, so the browser itself doesn't run as admin.
    static void Launch()
    {
        if (PageUp() && !(portable && !InstalledCopyMatches())) { OpenPage(); return; }
        if (!Elevate("--from-launcher")) return;
        for (int i = 0; i < 60 && !PageUp(); i++) Thread.Sleep(500);
        OpenPage();
    }

    static bool Elevate(string arg)
    {
        try
        {
            Process.Start(new ProcessStartInfo(SelfPath(), arg) { UseShellExecute = true, Verb = "runas" });
            return true;
        }
        catch (System.ComponentModel.Win32Exception)
        {
            MessageBox(IntPtr.Zero, "netbug needs administrator rights to watch the network and to pin the router's address.\n\nRun it again and choose Yes.", "netbug", 0x30);
            return false;
        }
    }

    static string SelfPath()
    {
        using (var me = Process.GetCurrentProcess()) return Path.GetFullPath(me.MainModule.FileName);
    }

    static bool PageUp()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(PageUrl + "api/state");
            req.Timeout = 1000; req.Proxy = null;
            using (req.GetResponse()) return true;
        }
        catch { return false; }
    }

    static void OpenPage()
    {
        try { Process.Start(new ProcessStartInfo(PageUrl) { UseShellExecute = true }); } catch { }
    }

    static string ParentName()
    {
        try { using (var parent = Process.GetProcessById(ParentPid())) return parent.ProcessName.ToLowerInvariant(); }
        catch { return ""; }
    }

    static int ParentPid()
    {
        var info = new ProcessInfo(); int returned;
        using (var me = Process.GetCurrentProcess())
            return NtQueryInformationProcess(me.Handle, 0, ref info, Marshal.SizeOf(info), out returned) == 0 ? info.ParentPid.ToInt32() : -1;
    }

    // ---------------------------------------------------------------- install
    // netbug runs from a logon task named "netbug" (elevated, no time limit, restarted every minute
    // after a crash, also on battery). The first elevated start sets it up:
    // - lone exe: copies itself to %ProgramData%\netbug\netbug.exe (Administrators and SYSTEM write,
    //   Users read), registers the task for that copy, starts it and exits. A different build run later
    //   replaces the installed copy the same way (update).
    // - repo copy (tools\netbug.exe): registers the task for this exe only when no "netbug" task exists,
    //   and keeps running.
    // --uninstall (or the page's Uninstall button, lone exe only) removes the task, the router pin and,
    // for a lone exe, everything in %ProgramData%\netbug except logs\ (the exe, the unpacked page and
    // scripts). The logs always stay; a later install appends to them.

    const string TaskName = "netbug";

    static string InstalledExe() { return Path.Combine(baseDir, "netbug.exe"); }

    static bool PathEq(string a, string b) { return string.Equals(a, b, StringComparison.OrdinalIgnoreCase); }

    // a lone exe: true when this process is the installed copy or byte-identical to it
    static bool InstalledCopyMatches()
    {
        string self = SelfPath(), inst = InstalledExe();
        if (PathEq(self, inst)) return true;
        try { return File.Exists(inst) && File.ReadAllBytes(self).SequenceEqual(File.ReadAllBytes(inst)); }
        catch { return false; }
    }

    // the exe the "netbug" task runs, "" when there is no such task
    static string TaskCommand()
    {
        var m = Regex.Match(Run("schtasks.exe", "/Query /TN " + TaskName + " /XML").Replace("\0", ""), "<Command>([^<]*)</Command>");
        return m.Success ? System.Security.SecurityElement.FromString("<c>" + m.Groups[1].Value + "</c>").Text.Trim('"') : "";
    }

    // Returns true when this process should exit because the task's copy runs instead.
    static bool Install(bool openPage)
    {
        try
        {
            string self = SelfPath(), cmd = TaskCommand();
            if (!portable)
            {
                if (cmd != "") return false;
                RegisterTask(self);
                Event("netbug installed: logon task '" + TaskName + "' runs " + self);
                return false;
            }
            string inst = InstalledExe();
            bool isInstalled = PathEq(self, inst);
            if (PathEq(cmd, inst) && InstalledCopyMatches())
            {
                if (isInstalled) return false;
                Run("schtasks.exe", "/Run /TN " + TaskName);   // already installed: make sure it runs
            }
            else
            {
                Event((cmd == "" ? "installing netbug: " : "updating netbug: ") + inst);
                if (cmd != "") Run("schtasks.exe", "/End /TN " + TaskName);
                StopOthers();
                if (!isInstalled)
                    for (int i = 0; ; i++)
                    {
                        try { File.Copy(self, inst, true); break; }
                        catch (IOException) { if (i == 10) throw; Thread.Sleep(500); }
                    }
                // %ProgramData% lets every user add files to new folders; an elevated task must not load
                // anything a non-admin could drop next to it
                Run("icacls.exe", "\"" + baseDir + "\" /inheritance:r /grant:r *S-1-5-32-544:(OI)(CI)F *S-1-5-18:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX /Q");   // the folder only: its contents inherit this (with /T, files got an empty ACL)
                RegisterTask(inst);
                Event("netbug installed: logon task '" + TaskName + "' runs " + inst);
                if (isInstalled) return false;
                Run("schtasks.exe", "/Run /TN " + TaskName);
            }
            if (openPage) { for (int i = 0; i < 60 && !PageUp(); i++) Thread.Sleep(500); OpenPage(); }
            return true;
        }
        catch (Exception ex) { Event("install failed, running without the task: " + ex.Message); return false; }
    }

    // the same settings as the task set up by hand on the original laptop
    static void RegisterTask(string exe)
    {
        string user, sid;
        using (var id = WindowsIdentity.GetCurrent()) { user = id.Name; sid = id.User.Value; }
        Func<string, string> x = System.Security.SecurityElement.Escape;
        string xml = "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\r\n" +
            "<Task version=\"1.3\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">" +
            "<RegistrationInfo><Description>netbug: lightweight network outage logger</Description></RegistrationInfo>" +
            "<Principals><Principal id=\"Author\"><UserId>" + x(sid) + "</UserId><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>" +
            "<Settings><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>" +
            "<ExecutionTimeLimit>PT0S</ExecutionTimeLimit><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>" +
            "<RestartOnFailure><Count>999</Count><Interval>PT1M</Interval></RestartOnFailure></Settings>" +
            "<Triggers><LogonTrigger><UserId>" + x(user) + "</UserId></LogonTrigger></Triggers>" +
            "<Actions Context=\"Author\"><Exec><Command>" + x(exe) + "</Command><WorkingDirectory>" + x(Path.GetDirectoryName(exe)) + "</WorkingDirectory></Exec></Actions></Task>";
        string file = Path.Combine(Path.GetTempPath(), "netbug-task.xml");
        File.WriteAllText(file, xml, Encoding.Unicode);
        try { Run("schtasks.exe", "/Create /TN " + TaskName + " /XML \"" + file + "\" /F"); }
        finally { File.Delete(file); }
        if (!PathEq(TaskCommand(), exe)) throw new Exception("schtasks /Create did not register the task");
    }

    // Ends every other netbug except this process and the launcher that started it (it opens the page).
    // Any process named netbug*: a browser saves a second download as "netbug (1).exe".
    static void StopOthers()
    {
        KillNetbugs(Process.GetCurrentProcess().Id, ParentPid());
        Run("pktmon.exe", "stop");   // the killed copy's ARP capture would keep running
    }

    static void KillNetbugs(int keep, int keep2)
    {
        foreach (var p in Process.GetProcesses())
            using (p)
                if (p.Id != keep && p.Id != keep2 && p.ProcessName.StartsWith("netbug", StringComparison.OrdinalIgnoreCase))
                    try { p.Kill(); p.WaitForExit(5000); } catch { }
    }

    // `keep`: a process to spare (the uninstalling one, which exits right after)
    static void Uninstall(int keep)
    {
        Event("netbug uninstalled: logon task removed, router pin removed" + (portable ? ", program files removed (logs kept)" : ""));
        Run("schtasks.exe", "/Delete /TN " + TaskName + " /F");   // not /End: that would end `keep` when the task runs it
        KillNetbugs(keep, ParentPid());
        Run("pktmon.exe", "stop");
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            int idx = IfIndex(ni);
            if (idx < 0) continue;
            foreach (var g in ni.GetIPProperties().GatewayAddresses)
                if (g.Address.AddressFamily == AddressFamily.InterNetwork && PersistentPin(idx, g.Address) != "")
                {
                    Netsh(string.Format("interface ipv4 delete neighbors name={0} address={1}", idx, g.Address));
                    lock (pinLock) pinCacheAt = DateTime.MinValue;
                }
        }
        if (portable) RemoveProgram();
    }

    // A lone exe's folder without its logs: every file and folder in %ProgramData%\netbug except logs\.
    static void RemoveProgram()
    {
        Directory.SetCurrentDirectory(Path.GetTempPath());   // the task starts netbug with baseDir as its working folder
        foreach (var d in Directory.GetDirectories(baseDir))
            if (!PathEq(Path.GetFileName(d), "logs")) RemoveDir(d);
        foreach (var f in Directory.GetFiles(baseDir)) DeleteOrLater(f);
    }

    // Deletes a file; one still in use (the running exe) is moved to the temp folder and deleted at the next restart.
    static void DeleteOrLater(string f)
    {
        for (int i = 0; i < 10; i++)   // a just-killed copy may still hold it for a moment
            try { File.Delete(f); return; } catch { Thread.Sleep(300); }
        string tmp = Path.Combine(Path.GetTempPath(), "netbug-removed-" + Guid.NewGuid().ToString("N") + Path.GetExtension(f));
        try { File.Move(f, tmp); } catch { tmp = f; }
        MoveFileEx(tmp, null, 4);   // 4 = MOVEFILE_DELAY_UNTIL_REBOOT
    }

    // Deletes a folder of a lone exe's program files (tools\). A file still in use is moved to the temp
    // folder and deleted at the next restart, so the folder goes now and a later reinstall isn't deleted
    // with it. A helper process can't do this: it would die with the task's process.
    static void RemoveDir(string dir)
    {
        Directory.SetCurrentDirectory(Path.GetTempPath());
        for (int i = 0; i < 10; i++)   // a just-killed copy may still hold files for a moment
            try { Directory.Delete(dir, true); return; } catch { Thread.Sleep(500); }
        foreach (var f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
            try { File.Delete(f); }
            catch
            {
                string tmp = Path.Combine(Path.GetTempPath(), "netbug-removed-" + Guid.NewGuid().ToString("N") + Path.GetExtension(f));
                try { File.Move(f, tmp); } catch { tmp = f; }
                MoveFileEx(tmp, null, 4);   // 4 = MOVEFILE_DELAY_UNTIL_REBOOT
            }
        foreach (var d in Directory.GetDirectories(dir, "*", SearchOption.AllDirectories).OrderByDescending(d => d.Length).Concat(new[] { dir }))
            try { Directory.Delete(d); } catch { MoveFileEx(d, null, 4); }
    }

    // A lone netbug.exe writes its page, font and scripts (embedded resources) to %ProgramData%\netbug\tools
    // each time it becomes the running instance, so the rest of netbug finds them where it always does.
    static void Unpack()
    {
        string tools = Path.Combine(baseDir, "tools");
        Directory.CreateDirectory(Path.Combine(tools, "fonts"));
        var asm = System.Reflection.Assembly.GetExecutingAssembly();
        foreach (var f in new[] { "dashboard.html", "inter.woff2", "arpwatch.ps1", "snapshot.ps1" })
            using (var res = asm.GetManifestResourceStream("netbug." + f))
            using (var file = File.Create(Path.Combine(tools, f == "inter.woff2" ? @"fonts\inter.woff2" : f)))
                res.CopyTo(file);
    }

    // The page's "auto-detect" (off by default) and "keep the router updated" (on by default) switches,
    // kept across restarts in logs/netbug.settings.
    static void LoadSettings()
    {
        try
        {
            string f = Path.Combine(logDir, "netbug.settings"), s = File.Exists(f) ? File.ReadAllText(f) : "";
            autoDetect = s.Contains("auto=1");
            announce = !s.Contains("announce=0");
        }
        catch { }
    }

    static void SaveSettings()
    {
        try { File.WriteAllText(Path.Combine(logDir, "netbug.settings"), "auto=" + (autoDetect ? "1" : "0") + "\r\nannounce=" + (announce ? "1" : "0") + "\r\n"); } catch { }
    }

    static volatile bool ifDirty = true;
    static NetworkInterface scanNi;
    static IPAddress scanIp, scanGw;
    static string scanName = "", scanLink = "absent";

    static void Run()
    {
        NetworkChange.NetworkAddressChanged += (s, e) => ifDirty = true;
        NetworkChange.NetworkAvailabilityChanged += (s, e) => ifDirty = true;
        long tick = 0;
        DateTime lastRow = DateTime.MinValue;
        while (true)
        {
            var loopStart = DateTime.Now;
            try
            {
                RotateIfNewDay();

                // the interface scan costs ~7 ms of CPU: redo it when Windows reports an address or
                // availability change, while anything is failing, and every 10 s as a backstop
                if (ifDirty || failStreak > 0 || tick % 10 == 0)
                {
                    ifDirty = false;
                    scanNi = PickInterface(out scanIp, out scanGw, out scanName, out scanLink);
                }
                IPAddress ip = scanIp, gw = scanGw;
                string ifaceName = scanName, ethLink = scanLink;
                NetworkInterface ni = scanNi;
                curNi = ni; curIp = ip; curGw = gw;

                // pings in parallel
                var pGw = gw != null ? PingAsync(gw) : Task.FromResult(-1L);
                var pCf = PingAsync(IPAddress.Parse("1.1.1.1"));
                var pG = PingAsync(IPAddress.Parse("8.8.8.8"));
                Task.WaitAll(pGw, pCf, pG);
                long gwMs = pGw.Result, cfMs = pCf.Result, gMs = pG.Result;

                if (tick % 2 == 0 || dnsMs < 0) dnsMs = gw != null ? DnsProbe(gw) : -1;   // a failed probe is re-checked the next second
                if (tcpMs < 0 && tick % 10 != 0) tcpMs = TcpProbe();   // re-check a failed probe every second
                // a new interface: its gateway entry is read now, and its packet counters start fresh
                bool ifChanged = ifaceName != lastIface;
                if (ifChanged) lastTx = -1;
                if (tick % 10 == 0)
                {
                    tcpMs = TcpProbe();
                    UdpUsage(out udpTotal, out udpTop);
                }
                if (tick % 10 == 0 || ifChanged)
                {
                    gwMac = gw != null && ip != null ? Arp(gw, ip) : "";
                    gwArp = gw != null && ni != null ? ArpEntryType(gw, ni) : "";
                }
                if (tick % 300 == 150 && gw != null && ip != null) ArpWatchStart(gw, ip, trustedGwIp == gw.ToString() ? trustedGwMac : "");
                if (autoDetect && gw != null && tick >= 20 && !fixBusy)
                {
                    double since = (DateTime.Now - lastDetect).TotalSeconds;
                    if (gw.ToString() != lastDetectGw || since >= 1800 || (autoKick && since >= 300)) StartDetect("auto");
                }
                if (tick % 300 == 5) RefreshPublicIp();
                if (tick % 600 == 7) EnforceSizeCap();
                if (tick % 600 == 9) Health(tick % 3600 == 9);

                long txDelta = 0, rxDelta = 0;
                if (ni != null)
                {
                    var st = ni.GetIPv4Statistics();
                    long tx = st.UnicastPacketsSent, rx = st.UnicastPacketsReceived;
                    if (lastTx >= 0) { txDelta = tx - lastTx; rxDelta = rx - lastRx; }
                    lastTx = tx; lastRx = rx;
                }

                // ---- classify ----
                var fails = new List<string>();
                if (ni == null) fails.Add("no_iface");
                if (gw != null && gwMs < 0) fails.Add("gw");
                if (cfMs < 0 && gMs < 0) fails.Add("internet");
                if (dnsMs < 0) fails.Add("dns");
                if (udpMs < 0) fails.Add("udp");
                if (udpMap != "" && udpMap != lastUdpMap)
                {
                    // a changed public ip:port on the same local socket means the NAT dropped the
                    // old mapping: exactly what breaks a running voice/game UDP session. Only the
                    // server tag changing (Cloudflare missed once, Google answered) is not logged.
                    if (lastUdpMap != "" && MapAddr(udpMap) != MapAddr(lastUdpMap))
                        Event(string.Format("UDP NAT mapping changed: {0} -> {1}", lastUdpMap, udpMap));
                    lastUdpMap = udpMap;
                }
                if (tcpMs < 0) fails.Add("tcp");
                if (udpTotal >= UdpWarnThreshold) fails.Add("udp_high");
                string failStr = string.Join("|", fails);

                // ---- transitions ----
                if (ifChanged) { Event(string.Format("active interface: '{0}' -> '{1}' ip={2} gw={3}", lastIface, ifaceName, ip, gw)); lastIface = ifaceName; }
                if (ethLink != lastEthLink) { Event(string.Format("USB ethernet link: {0} -> {1}", lastEthLink == "" ? "?" : lastEthLink, ethLink)); lastEthLink = ethLink; }
                // the entry type first: a new pin makes its MAC the trusted one before the MAC change is judged
                if (gwArp != "" && gwArp != lastGwArp && !fixBusy)
                {
                    Event(string.Format("gateway ARP entry for {0}: {1} -> {2}{3}", gw, lastGwArp == "" ? "?" : lastGwArp, gwArp,
                        gwArp == "static" ? " (pinned to " + gwMac + ", spoofed ARP replies are ignored)" : ""));
                    if (gwArp == "static" && gwMac.Length == 17 && gw != null) TrustGateway(gw.ToString(), gwMac);   // the pin is the truth
                    lastGwArp = gwArp;
                }
                if (gwMac != "" && gwMac != lastGwMac && !fixBusy)   // a router check swaps the entry on purpose
                {
                    // same gateway IP, a real MAC other than the trusted one: someone else is answering for the router
                    string gwIp = gw == null ? "" : gw.ToString();
                    if (gwMac.Length == 17 && gwIp != trustedGwIp) TrustGateway(gwIp, gwMac);
                    if (gwMac.Length == 17 && gwIp == trustedGwIp && gwMac != trustedGwMac)
                    {
                        SetGwAlert(string.Format("gateway {0} changed MAC {1} -> {2} at {3:HH:mm:ss}", gwIp, trustedGwMac, gwMac, DateTime.Now));
                        Event(string.Format("GATEWAY MAC CHANGED, possible ARP spoofing: {0} {1} -> {2} (trusted {3}, ARP entry {4})", gwIp, lastGwMac, gwMac, trustedGwMac, gwArp));
                        Snapshot("gw_mac");
                        autoKick = true;
                    }
                    else Event(string.Format("gateway MAC: {0} -> {1}", lastGwMac == "" ? "?" : lastGwMac, gwMac));
                    lastGwMac = gwMac;
                }
                if (pubIp != "" && pubIp != lastPubIp) { Event(string.Format("public IP: {0} -> {1}", lastPubIp == "" ? "?" : lastPubIp, pubIp)); lastPubIp = pubIp; }
                if (udpTotal >= UdpWarnThreshold && !udpWarned) { Event(string.Format("UDP endpoints high: {0} (top: {1})", udpTotal, udpTop)); udpWarned = true; Snapshot("udp_high"); }
                if (udpTotal >= 0 && udpTotal < UdpWarnThreshold / 2) udpWarned = false;

                // LAN lag: the gateway is normally 0-1 ms away, so a slow or lost gateway ping
                // together with a slow/lost internet ping means the local segment is choking
                bool lagNow = ni != null && (gwMs >= LagGwMs || (gwMs < 0 && (cfMs < 0 || gMs < 0)));
                if (lagNow)
                {
                    if (!inLag) { inLag = true; lagStart = DateTime.Now; lagMaxGw = 0; lagLoss = 0; lagSamples = 0; lagSnapped = false; }
                    lagLastBad = DateTime.Now;
                    lagSamples++;
                    if (gwMs < 0) lagLoss++; else lagMaxGw = Math.Max(lagMaxGw, gwMs);
                    if (!lagSnapped && (DateTime.Now - lagStart).TotalSeconds >= 5)
                    {
                        Event(string.Format("LAG ongoing for {0:N0} s: gw max {1} ms, {2} lost gw pings", (DateTime.Now - lagStart).TotalSeconds, lagMaxGw, lagLoss));
                        Snapshot("lag"); lagSnapped = true;
                    }
                }
                else if (inLag && (DateTime.Now - lagLastBad).TotalSeconds >= 10)
                {
                    inLag = false;
                    double dur = (lagLastBad - lagStart).TotalSeconds + 1;
                    if (lagSamples >= 3)
                        Event(string.Format("LAG {0:HH:mm:ss}-{1:HH:mm:ss} ({2:N0} s): {3} bad s, gw max {4} ms, {5} lost gw pings", lagStart, lagLastBad, dur, lagSamples, lagMaxGw, lagLoss));
                }
                if (lagNow) fails.Add("lag");
                failStr = string.Join("|", fails);

                // An outage needs 2 bad seconds in a row. Gateway-only ICMP loss doesn't count (the
                // MikroTik rate-limits ICMP), and lag / high UDP usage have their own events.
                var realFails = fails.Where(f => f != "udp_high" && f != "gw" && f != "lag").ToList();
                failStreak = realFails.Count > 0 ? failStreak + 1 : 0;
                if (fails.Count > 0) fastUntil = DateTime.Now.AddSeconds(60);
                if (failStreak >= 2)
                {
                    if (!inOutage)
                    {
                        inOutage = true; outageStart = DateTime.Now; outageWhat = failStr;
                        Event(string.Format("OUTAGE START [{0}] iface='{1}' gw_ms={2} cf_ms={3} g_ms={4} dns_ms={5} tcp_ms={6} tx/rx pkts last s={7}/{8} gw_mac={9} gw_arp={10}",
                            failStr, ifaceName, gwMs, cfMs, gMs, dnsMs, tcpMs, txDelta, rxDelta, gwMac, gwArp));
                        if (gwArp == "static" && fails.Contains("gw"))
                            Event(string.Format("  gateway is pinned to {0}: if the hostel replaced its router, the pin is stale (remove it: netsh interface ipv4 delete neighbors \"{1}\" {2})", gwMac, ifaceName, gw));
                        Snapshot("outage");
                    }
                    else if (failStr != outageWhat)
                    {
                        Event(string.Format("  outage now [{0}] gw_ms={1} cf_ms={2} dns_ms={3} tcp_ms={4} tx/rx={5}/{6}", failStr, gwMs, cfMs, dnsMs, tcpMs, txDelta, rxDelta));
                        outageWhat = failStr;
                    }
                }
                else if (inOutage && failStreak == 0)
                {
                    inOutage = false;
                    Event(string.Format("OUTAGE END after {0:N0} s", (DateTime.Now - outageStart).TotalSeconds));
                }

                // ---- csv row ----
                bool fast = DateTime.Now < fastUntil;
                if (fast || (DateTime.Now - lastRow).TotalSeconds >= 5)
                {
                    Row(string.Join(",", new string[] {
                        DateTime.Now.ToString("HH:mm:ss"), Csv(ifaceName), ethLink, ip == null ? "" : ip.ToString(), gw == null ? "" : gw.ToString(), gwMac, gwArp,
                        gwMs.ToString(), cfMs.ToString(), gMs.ToString(), dnsMs.ToString(), tcpMs.ToString(),
                        udpMs.ToString(), udpMap, txDelta.ToString(), rxDelta.ToString(), udpTotal.ToString(), Csv(udpTop), pubIp, failStr,
                        DateTime.Now.ToString("yyyy-MM-dd"), DateTime.Now.ToString("zzz") }));
                    lastRow = DateTime.Now;
                }

                // ---- dashboard ----
                long now = Unix(DateTime.Now);
                lock (hist)
                {
                    hist[histPos] = string.Format("[{0},{1},{2},{3},{4},{5},{6},{7}]", now, gwMs, cfMs, gMs, udpMs, dnsMs, tcpMs, J(failStr));
                    histPos = (histPos + 1) % hist.Length;
                    if (histCount < hist.Length) histCount++;
                }
                if (gwAlert != "" && (DateTime.Now - gwAlertAt).TotalMinutes >= 30) gwAlert = "";   // alert shows for 30 min
                sampleJson = string.Format("{{\"t\":{0},\"iface\":{1},\"link\":{2},\"ip\":{3},\"gw\":{4},\"gwMac\":{5},\"tx\":{6},\"rx\":{7},\"udpMap\":{8},\"udpTotal\":{9},\"udpTop\":{10},\"pubIp\":{11},\"fail\":{12},\"outage\":{13},\"lag\":{14},\"gwArp\":{15},\"gwAlert\":{16},\"arpWatch\":{17}}}",
                    now, J(ifaceName), J(ethLink), J(ip == null ? "" : ip.ToString()), J(gw == null ? "" : gw.ToString()), J(gwMac),
                    txDelta, rxDelta, J(udpMap), udpTotal, J(udpTop), J(pubIp), J(failStr),
                    inOutage ? Unix(outageStart) : 0, inLag ? Unix(lagStart) : 0, J(gwArp), J(gwAlert), J(arpWatch));
            }
            catch (Exception ex)
            {
                Event("netbug error: " + ex.GetType().Name + ": " + ex.Message);
            }

            tick++;
            int sleep = 1000 - (int)(DateTime.Now - loopStart).TotalMilliseconds;
            if (sleep > 0) Thread.Sleep(sleep);
        }
    }

    // Prefer a wired interface with a default gateway, else any up interface with one.
    static NetworkInterface PickInterface(out IPAddress ip, out IPAddress gw, out string name, out string ethLink)
    {
        ip = null; gw = null; name = ""; ethLink = "absent";
        NetworkInterface best = null; int bestScore = -1;
        foreach (var n in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (n.Description.IndexOf("Realtek USB", StringComparison.OrdinalIgnoreCase) >= 0)
                ethLink = n.OperationalStatus == OperationalStatus.Up ? "up" : "down";
            if (n.OperationalStatus != OperationalStatus.Up) continue;
            if (n.NetworkInterfaceType == NetworkInterfaceType.Loopback || n.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;
            var props = n.GetIPProperties();
            var g = props.GatewayAddresses.Select(a => a.Address)
                .FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork && !a.Equals(IPAddress.Any));
            if (g == null) continue;
            int score = n.NetworkInterfaceType == NetworkInterfaceType.Ethernet ? 2 : 1;
            if (score > bestScore)
            {
                bestScore = score; best = n; gw = g;
                ip = props.UnicastAddresses.Select(a => a.Address).FirstOrDefault(a => a.AddressFamily == AddressFamily.InterNetwork);
                name = n.Name;
            }
        }
        return best;
    }

    static async Task<long> PingAsync(IPAddress target)
    {
        try
        {
            using (var p = new Ping())
            {
                var r = await p.SendPingAsync(target, 800);
                return r.Status == IPStatus.Success ? r.RoundtripTime : -1;
            }
        }
        catch { return -1; }
    }

    // Raw A query for a random name; any response (NXDOMAIN included) means the resolver is alive.
    static int DnsProbe(IPAddress server)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            using (var udp = new UdpClient())
            {
                udp.Client.ReceiveTimeout = 1500;
                var q = new List<byte> { (byte)rng.Next(256), (byte)rng.Next(256), 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0 };
                foreach (var label in new[] { "nb" + rng.Next(100000000), "example", "com" })
                {
                    q.Add((byte)label.Length);
                    q.AddRange(Encoding.ASCII.GetBytes(label));
                }
                q.AddRange(new byte[] { 0, 0, 1, 0, 1 });
                udp.Send(q.ToArray(), q.Count, new IPEndPoint(server, 53));
                var from = new IPEndPoint(IPAddress.Any, 0);
                udp.Receive(ref from);
                return (int)sw.ElapsedMilliseconds;
            }
        }
        catch { return -1; }
    }

    static int TcpProbe()
    {
        try
        {
            if (tcpProbeIp == null)
                tcpProbeIp = Dns.GetHostAddresses(TcpProbeHost).First(a => a.AddressFamily == AddressFamily.InterNetwork);
            var sw = Stopwatch.StartNew();
            using (var c = new TcpClient())
            {
                bool ok = c.ConnectAsync(tcpProbeIp, 443).Wait(2000);
                return ok ? (int)sw.ElapsedMilliseconds : -1;
            }
        }
        catch { tcpProbeIp = null; return -1; }
    }

    // Keeps one long-lived TLS connection open and sends a HEAD request on it every 15 s,
    // like Discord/Claude/game sessions do. Logs how and when the connection dies: a clean
    // server close (FIN), a reset (RST, often a middlebox killing the flow) or a silent stall.
    static void PersistentTcpLoop()
    {
        const string host = "www.google.com";
        byte[] req = Encoding.ASCII.GetBytes("HEAD / HTTP/1.1\r\nHost: " + host + "\r\nConnection: keep-alive\r\n\r\n");
        while (true)
        {
            var opened = DateTime.Now;
            int requests = 0;
            string reason;
            try
            {
                using (var tcp = new TcpClient())
                {
                    tcp.ReceiveTimeout = 5000; tcp.SendTimeout = 5000;
                    if (!tcp.ConnectAsync(host, 443).Wait(5000)) throw new TimeoutException("connect timed out");
                    using (var ssl = new System.Net.Security.SslStream(tcp.GetStream()))
                    {
                        ssl.ReadTimeout = 5000; ssl.WriteTimeout = 5000;
                        ssl.AuthenticateAsClient(host);
                        var buf = new byte[4096];
                        while (true)
                        {
                            var sw = Stopwatch.StartNew();
                            ssl.Write(req);
                            var head = new StringBuilder();
                            while (head.ToString().IndexOf("\r\n\r\n", StringComparison.Ordinal) < 0)
                            {
                                int n = ssl.Read(buf, 0, buf.Length);
                                if (n == 0) throw new EndOfStreamException("server closed (FIN)");
                                head.Append(Encoding.ASCII.GetString(buf, 0, n));
                            }
                            requests++;
                            if (sw.ElapsedMilliseconds > 1500)
                                Event(string.Format("persistent TCP: slow reply {0} ms on a {1:N0} s old connection", sw.ElapsedMilliseconds, (DateTime.Now - opened).TotalSeconds));
                            if (head.ToString().IndexOf("Connection: close", StringComparison.OrdinalIgnoreCase) >= 0)
                                throw new EndOfStreamException("server asked to close");
                            Thread.Sleep(15000);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                var se = (ex.InnerException as SocketException) ?? (ex as SocketException);
                if (se != null) reason = se.SocketErrorCode == SocketError.ConnectionReset ? "RESET (RST)" :
                                         se.SocketErrorCode == SocketError.TimedOut ? "TIMEOUT (no reply 5 s)" : "socket " + se.SocketErrorCode;
                else if (ex is IOException && ex.Message.IndexOf("timed out", StringComparison.OrdinalIgnoreCase) >= 0) reason = "TIMEOUT (no reply 5 s)";
                else reason = ex.GetType().Name + ": " + ex.Message;
            }
            double life = (DateTime.Now - opened).TotalSeconds;
            // Repeated reconnect failures (e.g. every 5 s while the cable is out) collapse into one
            // line. Google closes old keep-alive connections itself, so a clean server close after
            // 200+ s is expected and not logged; everything else is.
            if (requests == 0 && reason == lastTcpReason) tcpRepeats++;
            else
            {
                if (tcpRepeats > 0) Event(string.Format("persistent TCP: previous failure repeated {0} more times", tcpRepeats));
                tcpRepeats = 0;
                // reason is e.g. "EndOfStreamException: server asked to close" or "...: server closed (FIN)"
                bool serverClose = reason.IndexOf(": server ", StringComparison.Ordinal) >= 0;
                if (!(serverClose && life > 200))
                    Event(string.Format("persistent TCP died after {0:N0} s, {1} requests: {2}", life, requests, reason));
            }
            lastTcpReason = reason;
            Thread.Sleep(5000);
        }
    }

    static string Arp(IPAddress target, IPAddress src)
    {
        var mac = new byte[6]; int len = 6;
        int r = SendARP(BitConverter.ToInt32(target.GetAddressBytes(), 0), BitConverter.ToInt32(src.GetAddressBytes(), 0), mac, ref len);
        return r == 0 ? BitConverter.ToString(mac, 0, len) : "arp_fail";
    }

    // Type of the gateway's entry in the IPv4 ARP table of the active interface: "static" (pinned
    // with netsh, ignores ARP replies), "dynamic" (learned, can be poisoned), "invalid", "other" or "".
    static string ArpEntryType(IPAddress gw, NetworkInterface ni)
    {
        int ifIndex;
        try { ifIndex = ni.GetIPProperties().GetIPv4Properties().Index; } catch { return ""; }
        int target = BitConverter.ToInt32(gw.GetAddressBytes(), 0);
        int size = 0;
        GetIpNetTable(IntPtr.Zero, ref size, false);
        if (size <= 0) return "";
        IntPtr buf = Marshal.AllocHGlobal(size);
        try
        {
            if (GetIpNetTable(buf, ref size, false) != 0) return "";
            int n = Marshal.ReadInt32(buf);
            for (int i = 0; i < n; i++)
            {
                int row = 4 + i * 24;   // MIB_IPNETROW: index, physAddrLen, physAddr[8], addr, type
                if (Marshal.ReadInt32(buf, row) != ifIndex || Marshal.ReadInt32(buf, row + 16) != target) continue;
                switch (Marshal.ReadInt32(buf, row + 20))
                {
                    case 4: return "static";
                    case 3: return "dynamic";
                    case 2: return "invalid";
                    default: return "other";
                }
            }
            return "";
        }
        finally { Marshal.FreeHGlobal(buf); }
    }

    static void SetGwAlert(string text) { gwAlertAt = DateTime.Now; gwAlert = text; }

    // ---------------------------------------------------------------- ARP watch
    //
    // The ring: an ARP-only pktmon capture (all NICs) runs all the time, into logs/arpring-a.etl and
    // arpring-b.etl in turn. Every 60 s RingLoop stops it, starts the other file at once (blind for about
    // a second) and reads the stopped one with "pktmon etl2txt"; the ARP frames of the last 15 min are
    // kept in memory. Every 5 min the frames not judged yet are checked; the router check reads its 10 s
    // from the ring too. pktmon runs one capture at a time, so a snapshot (its own capture of ARP +
    // gateway + 1.1.1.1 traffic while its probes run) pauses the ring under pktmonLock and resumes it
    // afterwards. A pause stops and reads the current file first, so a snapshot judges and saves the ARP
    // from right up to the moment it started (<snapshot>.ring.txt), and the router check pauses the ring
    // for a moment to get its last seconds. If something else stops pktmon, the next rotation restarts it.
    // pktmon's default file size on purpose: with a small --file-size it silently loses most frames. Any
    // pktmon capture reserves 512 MB of kernel memory while it runs.
    // A claim of the gateway IP by any MAC other than the trusted gateway MAC, or of this laptop's IP by
    // any MAC other than this laptop's, is ARP SPOOFING DETECTED. The second kind is aimed at the router
    // (it then sends this laptop's traffic to that MAC); the pin can't stop it, the MAC announce makes it
    // short. A fake claim sent only to the router is unicast and never reaches this laptop, so a clean
    // capture doesn't rule it out.

    static readonly object pktmonLock = new object(), ringLock = new object();
    static readonly List<ArpFrame> ring = new List<ArpFrame>();
    static readonly ManualResetEvent ringIdle = new ManualResetEvent(true);   // set while no ring capture is being read
    static volatile bool ringPaused;
    static DateTime ringCheckedTo = DateTime.MinValue;   // frames up to here were already judged
    static volatile int announceSeen = -1;   // this laptop's own ARP requests in the last judged frames
    static DateTime announceSeenAt = DateTime.MinValue;

    struct ArpFrame { public DateTime T; public string Line; }

    class Claim
    {
        public string Mac, First, Last; public int N;
        public override string ToString() { return string.Format("{0} x{1} ({2}-{3})", Mac, N, First, Last); }
    }

    static readonly AutoResetEvent ringWake = new AutoResetEvent(false);   // set by RingPause: stop and read now

    static void RingLoop()
    {
        int n = 0;
        while (true)
        {
            try
            {
                while (ringPaused) Thread.Sleep(500);
                string etl;
                lock (pktmonLock)
                {
                    if (ringPaused) continue;
                    Run("pktmon.exe", "stop"); Run("pktmon.exe", "filter remove"); Run("pktmon.exe", "filter add arp -d ARP");
                    etl = RingFile(n++);
                    RingStartFile(etl);
                    ringIdle.Reset();
                }
                while (true)
                {
                    ringWake.WaitOne(60000);
                    // rotate: stop, start the next file at once (not while pausing: the pauser holds the lock),
                    // then read the stopped one
                    bool pausing = ringPaused;
                    Run("pktmon.exe", "stop");
                    string next = null;
                    if (!pausing && Monitor.TryEnter(pktmonLock))
                    {
                        try { if (!ringPaused) { next = RingFile(n++); RingStartFile(next); } }
                        finally { Monitor.Exit(pktmonLock); }
                    }
                    RingRead(etl);
                    if (next == null) { ringIdle.Set(); break; }
                    etl = next;
                }
            }
            catch (Exception ex) { ringIdle.Set(); Event("ARP capture error: " + ex.Message); Thread.Sleep(30000); }
        }
    }

    static string RingFile(int n) { return Path.Combine(logDir, n % 2 == 0 ? "arpring-a.etl" : "arpring-b.etl"); }

    static void RingStartFile(string etl)
    {
        if (File.Exists(etl)) File.Delete(etl);
        Run("pktmon.exe", string.Format("start --capture --comp nics --pkt-size 64 --file-name \"{0}\"", etl));
    }

    // Adds the ARP frames of a stopped capture file to the ring and deletes the file. In the text, a
    // header line ("[06]08FC.4F98::2026-11-01 02:35:31.450248500 [Microsoft-Windows-PktMon] ...") gives the
    // time of the frame line (tab-indented) after it. pktmon logs each frame at two driver components,
    // microseconds apart: an equal frame line within 5 ms is the same frame.
    static void RingRead(string etl)
    {
        if (!File.Exists(etl)) return;
        string txt = etl + ".txt";
        try
        {
            Run("pktmon.exe", string.Format("etl2txt \"{0}\" --out \"{1}\"", etl, txt));
            if (!File.Exists(txt)) return;
            var frames = new List<ArpFrame>();
            DateTime t = DateTime.MinValue, prevT = DateTime.MinValue;
            string prev = "";
            foreach (var line in File.ReadLines(txt))
            {
                if (line.StartsWith("\t"))
                {
                    if (t == DateTime.MinValue || line.IndexOf("ARP", StringComparison.Ordinal) < 0) continue;
                    if (line == prev && (t - prevT).TotalMilliseconds < 5) continue;
                    prev = line; prevT = t;
                    frames.Add(new ArpFrame { T = t, Line = line.Trim() });
                }
                else
                {
                    int i = line.IndexOf("::", StringComparison.Ordinal);
                    DateTime ht;
                    if (i >= 0 && line.Length >= i + 28 && DateTime.TryParseExact(line.Substring(i + 2, 26), "yyyy-MM-dd HH:mm:ss.ffffff",
                            System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out ht)) t = ht;
                }
            }
            lock (ringLock)
            {
                ring.AddRange(frames);
                int old = 0;
                while (old < ring.Count && (ring[old].T < DateTime.Now.AddMinutes(-15) || ring.Count - old > 50000)) old++;
                if (old > 0) ring.RemoveRange(0, old);
            }
        }
        finally { try { File.Delete(etl); File.Delete(txt); } catch { } }
    }

    // Stops the ring capture and waits until all its frames are read. The caller holds pktmonLock and
    // calls RingResume when done with pktmon.
    static void RingPause() { ringPaused = true; ringWake.Set(); ringIdle.WaitOne(30000); }
    static void RingResume() { ringPaused = false; }

    // The ring frames newer than ringCheckedTo (and marks them judged).
    static List<ArpFrame> RingTake()
    {
        lock (ringLock)
        {
            var since = ringCheckedTo;
            var frames = ring.Where(f => f.T > since).ToList();
            if (frames.Count > 0) ringCheckedTo = frames[frames.Count - 1].T;
            return frames;
        }
    }

    // Runs a console tool and returns its output. A tool that hangs is killed after 30 s, so the ring
    // capture and the router check never get stuck behind it.
    static string Run(string exe, string args)
    {
        var psi = new ProcessStartInfo(exe, args) { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true };
        using (var p = Process.Start(psi))
        {
            var output = p.StandardOutput.ReadToEndAsync();
            if (!p.WaitForExit(30000)) { try { p.Kill(); } catch { } }
            return output.Wait(5000) ? output.Result : "";
        }
    }

    const string MacRe = "((?:[0-9A-Fa-f]{2}-){5}[0-9A-Fa-f]{2})";

    // Same rules as arpwatch.ps1 (used by snapshot.ps1): a MAC claims an IP with an ARP reply
    // "<ip> is-at <mac>" or by sending an ARP request from that IP. Returns the frames that mention the
    // gateway or this laptop's IP.
    static List<ArpFrame> Analyze(List<ArpFrame> frames, IPAddress gw, IPAddress me, List<Claim> gwClaims, List<Claim> meClaims)
    {
        var mentioned = new List<ArpFrame>();
        var rules = new[] { gw, me }.Select(ip => Regex.Escape(ip.ToString())).Select(ip => new[] {
            new Regex("Reply " + ip + " is-at " + MacRe), new Regex("^" + MacRe + " > .*Request who-has \\S+ (?:\\(\\S+\\) )?tell " + ip + ","),
            new Regex("(?<![\\d.])" + ip + "(?![\\d.])") }).ToArray();
        var lists = new[] { gwClaims, meClaims };
        foreach (var f in frames)
        {
            bool hit = false;
            for (int i = 0; i < 2; i++)
            {
                var m = rules[i][0].Match(f.Line);
                if (!m.Success) m = rules[i][1].Match(f.Line);
                if (m.Success)
                {
                    string mac = m.Groups[1].Value.ToUpperInvariant(), at = f.T.ToString("HH:mm:ss");
                    var c = lists[i].FirstOrDefault(x => x.Mac == mac);
                    if (c == null) lists[i].Add(c = new Claim { Mac = mac, First = at });
                    c.N++; c.Last = at;
                }
                if (rules[i][2].IsMatch(f.Line)) hit = true;
            }
            if (hit) mentioned.Add(f);
        }
        return mentioned;
    }

    static string OwnMac(NetworkInterface ni)
    {
        try { var b = ni.GetPhysicalAddress().GetAddressBytes(); return b.Length == 6 ? BitConverter.ToString(b) : ""; }
        catch { return ""; }
    }

    // Judges ring frames: logs every foreign claim. expectMac "" = no trusted gateway MAC yet (the gateway
    // claims are then not judged). Returns true when spoofing was seen.
    static bool ReportClaims(List<ArpFrame> frames, IPAddress gw, IPAddress me, string expectMac, string where)
    {
        var g = new List<Claim>(); var m = new List<Claim>();
        Analyze(frames, gw, me, g, m);
        string own = OwnMac(curNi);
        Func<string, string, bool> same = (a, b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
        var rogueGw = expectMac == "" ? new List<Claim>() : g.Where(c => !same(c.Mac, expectMac)).ToList();
        var rogueMe = own == "" ? new List<Claim>() : m.Where(c => !same(c.Mac, own)).ToList();
        int mine = m.Where(c => same(c.Mac, own)).Sum(c => c.N);
        announceSeen = mine; announceSeenAt = DateTime.Now;
        if (rogueGw.Count > 0)
        {
            string who = string.Join(", ", rogueGw.Select(c => c.ToString()));
            SetGwAlert(string.Format("ARP spoofing seen at {0:HH:mm:ss}: {1} claimed to be gateway {2}", DateTime.Now, who, gw));
            Event(string.Format("ARP SPOOFING DETECTED: gateway {0} claimed by {1} in {2} (trusted {3}: {4} claims, ARP entry {5})",
                gw, who, where, expectMac, g.Where(c => same(c.Mac, expectMac)).Sum(c => c.N), gwArp));
            autoKick = true;
        }
        if (rogueMe.Count > 0)
        {
            string who = string.Join(", ", rogueMe.Select(c => c.ToString()));
            SetGwAlert(string.Format("ARP spoofing seen at {0:HH:mm:ss}: {1} claimed to be this laptop ({2})", DateTime.Now, who, me));
            Event(string.Format("ARP SPOOFING DETECTED: this laptop's IP {0} claimed by {1} in {2} (this laptop is {3}): the router may send this laptop's traffic there",
                me, who, where, own));
        }
        bool spoof = rogueGw.Count + rogueMe.Count > 0;
        // no frames at all: the capture isn't working (any LAN has some ARP every few minutes), not "clean"
        arpWatch = spoof
            ? string.Format("spoofing seen {0:HH:mm}: {1}", DateTime.Now, string.Join(", ", rogueGw.Concat(rogueMe).Select(c => c.Mac)))
            : frames.Count == 0 ? string.Format("no ARP captured by {0:HH:mm}: the capture may not be running", DateTime.Now)
            : string.Format("clean at {0:HH:mm} ({1} ARP frames, {2} from this laptop)", DateTime.Now, frames.Count, mine);
        return spoof;
    }

    // Every 5 min: judge the ring frames that arrived since the last check.
    static void ArpWatchStart(IPAddress gw, IPAddress me, string expectMac)
    {
        Task.Run(() =>
        {
            try { if (ReportClaims(RingTake(), gw, me, expectMac, "the continuous ARP capture")) Snapshot("arp_spoof"); }
            catch (Exception ex) { arpWatch = "error: " + ex.Message; }
        });
    }

    // ---------------------------------------------------------------- MAC announce
    //
    // Router-side ARP spoofing: someone tells the router that this laptop's IP belongs to their MAC, and
    // the router sends this laptop's traffic there until it learns the real MAC again. The pin can't stop
    // that: it only protects this laptop's own ARP table. So about once a second (switch "Keep the router
    // updated", on by default) netbug deletes Windows' entry for a neighbor address next to the gateway
    // and resolves it again (DeleteIpNetEntry2 + ResolveIpNetEntry2: a fresh ARP request). Each request
    // is a broadcast whose sender is this laptop's IP and MAC, and routers update an existing entry from any ARP they
    // hear from that IP (RFC 826; Linux-based routers after a 1 s lock time), so a fake entry for this
    // laptop lasts about a second. Which neighbor is asked doesn't matter. When nobody has that address,
    // one call sends a request about every second for ~3 s.

    static volatile bool announce = true;
    static int announceSent;   // ARP resolutions started since netbug started
    static volatile string announceTarget = "", announceErr = "";

    static void AnnounceLoop()
    {
        IntPtr row = Marshal.AllocHGlobal(88);   // MIB_IPNET_ROW2
        int lastCode = 0;
        while (true)
        {
            var sw = Stopwatch.StartNew();
            try
            {
                NetworkInterface ni = curNi; IPAddress ip = curIp, gw = curGw;
                int idx = IfIndex(ni);
                IPAddress t = announce && ip != null && gw != null && idx >= 0 ? AnnounceTarget(ni, ip, gw) : null;
                if (t != null)
                {
                    for (int i = 0; i < 88; i += 4) Marshal.WriteInt32(row, i, 0);
                    Marshal.WriteInt16(row, 0, 2);                          // Address: SOCKADDR_IN, AF_INET
                    Marshal.Copy(t.GetAddressBytes(), 0, row + 4, 4);       // sin_addr
                    Marshal.WriteInt32(row, 28, idx);                       // InterfaceIndex
                    DeleteIpNetEntry2(row);                                 // a cached entry would be returned without asking
                    int code = ResolveIpNetEntry2(row, IntPtr.Zero);        // returns on a reply, or after ~3 s of retries
                    Interlocked.Increment(ref announceSent);
                    announceTarget = t.ToString();
                    bool ok = code == 0 || code == 67 || code == 1168;      // answered / ERROR_BAD_NET_NAME / ERROR_NOT_FOUND: nobody has it
                    announceErr = ok ? "" : "ResolveIpNetEntry2 error " + code;
                    if (!ok && code != lastCode) Event(string.Format("MAC announce failing: ResolveIpNetEntry2 error {0} for {1} on '{2}'", code, t, ni.Name));
                    lastCode = ok ? 0 : code;
                }
            }
            catch (Exception ex) { announceErr = ex.Message; }
            int sleep = 1000 - (int)sw.ElapsedMilliseconds;
            Thread.Sleep(sleep > 0 ? sleep : 50);
        }
    }

    // A neighbor address next to the gateway in this laptop's subnet: not the gateway, not this laptop,
    // not the subnet's network or broadcast address. null if the subnet is too small.
    static IPAddress AnnounceTarget(NetworkInterface ni, IPAddress ip, IPAddress gw)
    {
        IPAddress mask = null;
        foreach (var a in ni.GetIPProperties().UnicastAddresses) if (a.Address.Equals(ip)) mask = a.IPv4Mask;
        if (mask == null) return null;
        uint m = HostOrder(mask), g = HostOrder(gw), me = HostOrder(ip);
        foreach (int d in new[] { -1, 1, -2, 2, -3, 3 })
        {
            uint t = unchecked((uint)(g + d));
            if ((t & m) != (g & m) || (t & ~m) == 0 || (t | m) == 0xFFFFFFFF || t == me) continue;
            return new IPAddress(new[] { (byte)(t >> 24), (byte)(t >> 16), (byte)(t >> 8), (byte)t });
        }
        return null;
    }

    static uint HostOrder(IPAddress a) { var b = a.GetAddressBytes(); return (uint)b[0] << 24 | (uint)b[1] << 16 | (uint)b[2] << 8 | b[3]; }

    // Counts UDP endpoints (IPv4 + IPv6) per owning process.
    static void UdpUsage(out int total, out string top)
    {
        var perPid = new Dictionary<int, int>();
        total = 0;
        foreach (var af in new[] { 2, 23 })
        {
            int rowSize = af == 2 ? 12 : 28, pidOffset = af == 2 ? 8 : 24;
            int size = 0;
            GetExtendedUdpTable(IntPtr.Zero, ref size, false, af, 1, 0);
            IntPtr buf = Marshal.AllocHGlobal(size);
            try
            {
                if (GetExtendedUdpTable(buf, ref size, false, af, 1, 0) != 0) continue;
                int n = Marshal.ReadInt32(buf);
                total += n;
                for (int i = 0; i < n; i++)
                {
                    int pid = Marshal.ReadInt32(buf, 4 + i * rowSize + pidOffset);
                    int c; perPid.TryGetValue(pid, out c); perPid[pid] = c + 1;
                }
            }
            finally { Marshal.FreeHGlobal(buf); }
        }
        top = string.Join(" ", perPid.OrderByDescending(kv => kv.Value).Take(3)
            .Select(kv => ProcName(kv.Key) + "=" + kv.Value));
    }

    static string ProcName(int pid)
    {
        try { using (var p = Process.GetProcessById(pid)) return p.ProcessName; }
        catch { return pid.ToString(); }
    }

    static void RefreshPublicIp()
    {
        Task.Run(() =>
        {
            try
            {
                using (var wc = new WebClient())
                {
                    string s = wc.DownloadString("https://ipinfo.io/ip").Trim();
                    if (s.Length > 0 && s.Length < 46) pubIp = s;
                }
            }
            catch { }
        });
    }

    // Runs snapshot.ps1 in the background. First the ARP ring is paused (which reads everything pktmon
    // still had buffered): its new frames are judged, and the last 15 min about the gateway or this laptop
    // are saved as <snapshot>.ring.txt. snapshot.ps1 then captures while it probes, and the ring is resumed
    // when it is done.
    static void Snapshot(string reason)
    {
        if (fixBusy || (DateTime.Now - lastSnapshot).TotalSeconds < 60) return;   // a router check breaks the link on purpose
        lastSnapshot = DateTime.Now;
        string script = Path.Combine(baseDir, "tools", "snapshot.ps1");
        if (!File.Exists(script)) return;
        string outFile = Path.Combine(snapDir, DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss") + "_" + reason + ".txt");
        IPAddress gw = curGw, me = curIp;
        string expect = gw != null && trustedGwIp == gw.ToString() ? trustedGwMac : "";
        Task.Run(() =>
        {
            bool havePktmon = Monitor.TryEnter(pktmonLock, 20000);
            try
            {
                if (havePktmon)
                {
                    RingPause();
                    if (gw != null && me != null)
                    {
                        List<ArpFrame> all;
                        lock (ringLock) all = ring.ToList();
                        var about = Analyze(all, gw, me, new List<Claim>(), new List<Claim>());
                        File.WriteAllLines(Path.ChangeExtension(outFile, ".ring.txt"), about.Select(f => StampMs(f.T) + "  " + f.Line));
                        ReportClaims(RingTake(), gw, me, expect, "the ARP capture before the " + reason + " snapshot");
                    }
                }
                var psi = new ProcessStartInfo("powershell.exe",
                    string.Format("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{0}\" -Out \"{1}\"{2}", script, outFile, havePktmon ? "" : " -NoCapture"))
                { CreateNoWindow = true, UseShellExecute = false };
                using (var p = Process.Start(psi))
                {
                    try { p.PriorityClass = ProcessPriorityClass.BelowNormal; } catch { }
                    p.WaitForExit(300000);
                }
            }
            catch (Exception ex) { Event("snapshot failed: " + ex.Message); }
            finally
            {
                if (havePktmon) { RingResume(); Monitor.Exit(pktmonLock); }
                EnforceSizeCap();
            }
        });
    }

    static void RotateIfNewDay()
    {
        string day = DateTime.Now.ToString("yyyy-MM-dd");
        if (day == currentDay) return;
        currentDay = day;
        string csv = CsvPath();
        if (File.Exists(csv) && File.ReadLines(csv).FirstOrDefault() != CsvHeader)
        {
            // columns changed (new netbug version): keep the old file under another name
            string old = Path.Combine(logDir, "netbug-" + currentDay + "-old-" + DateTime.Now.ToString("HHmmss") + ".csv");
            File.Move(csv, old);
        }
        if (!File.Exists(csv))
            File.WriteAllText(csv, CsvHeader + "\r\n");
        foreach (var f in Directory.GetFiles(logDir).Concat(Directory.GetFiles(snapDir)))
            if (File.GetLastWriteTime(f) < DateTime.Now.AddDays(-RetentionDays)) { try { File.Delete(f); } catch { } }
        EnforceSizeCap();
    }

    // Keeps logs/ under LogCapBytes: deletes the oldest snapshot files first, then the oldest
    // CSVs (never today's CSV or events.log).
    static void EnforceSizeCap()
    {
        try
        {
            var all = new DirectoryInfo(logDir).GetFiles("*", SearchOption.AllDirectories);
            long total = all.Sum(f => f.Length);
            if (total <= LogCapBytes) return;
            var victims = all.Where(f => f.DirectoryName == snapDir).OrderBy(f => f.LastWriteTime)
                .Concat(all.Where(f => f.DirectoryName != snapDir && f.Extension == ".csv" && f.FullName != CsvPath()).OrderBy(f => f.LastWriteTime));
            int deleted = 0;
            foreach (var f in victims)
            {
                if (total <= LogCapBytes * 9 / 10) break;
                try { long len = f.Length; f.Delete(); total -= len; deleted++; } catch { }
            }
            Event(string.Format("log size cap: deleted {0} oldest files, logs/ now {1:N0} MB", deleted, total / 1048576.0));
        }
        catch (Exception ex) { Event("size cap error: " + ex.Message); }
    }

    // Leak safety net: logs own RAM/handles/threads hourly, and if they ever grow past sane
    // limits, starts a fresh copy of itself and exits (the new copy waits for the mutex).
    const long MaxPrivateBytes = 200L * 1024 * 1024;
    const int MaxHandles = 5000, MaxThreads = 100;
    static void Health(bool logIt)
    {
        using (var p = Process.GetCurrentProcess())
        {
            long priv = p.PrivateMemorySize64; int handles = p.HandleCount, threads = p.Threads.Count;
            if (logIt) Event(string.Format("health: private {0:N1} MB, handles {1}, threads {2}, up {3:N1} h",
                priv / 1048576.0, handles, threads, (DateTime.Now - p.StartTime).TotalHours));
            if (priv > MaxPrivateBytes || handles > MaxHandles || threads > MaxThreads)
            {
                Event(string.Format("health limit exceeded (private {0:N0} MB, handles {1}, threads {2}): restarting netbug", priv / 1048576, handles, threads));
                Process.Start(new ProcessStartInfo(p.MainModule.FileName) { UseShellExecute = false, WorkingDirectory = AppDomain.CurrentDomain.BaseDirectory });
                Environment.Exit(0);
            }
        }
    }

    // Runs on its own thread so a dead UDP path (up to 2 x 1.5 s timeouts) never slows the 1 s main loop.
    // After StunResetAfter failed probes in a row it opens a new socket (a new local port, so a new NAT
    // mapping) and resolves the servers again, so one dead mapping can't fail the probe until a restart.
    // It does that once per failure streak: a real UDP outage still shows as failing.
    const int StunResetAfter = 3;
    static void StunLoop()
    {
        int failRun = 0;
        bool resetDone = false;
        while (true)
        {
            var sw = Stopwatch.StartNew();
            string m;
            int ms = StunProbe(out m);
            udpMs = ms;
            if (ms >= 0)
            {
                if (resetDone) Event("UDP probe works again on the new socket");
                udpMap = m;
                failRun = 0; resetDone = false;
            }
            else if (++failRun >= StunResetAfter && !resetDone)
            {
                Event(string.Format("UDP probe failed {0} times in a row: opening a new socket and resolving the STUN servers again", failRun));
                if (stunSock != null) { stunSock.Close(); stunSock = null; }
                stunReresolve = true;
                resetDone = true;
            }
            int sleep = 2000 - (int)sw.ElapsedMilliseconds;
            if (sleep > 0) Thread.Sleep(sleep);
        }
    }

    // Returns RTT in ms (or -1) and "<server tag>=<public ip:port>" as seen by that server.
    static int StunProbe(out string mapped)
    {
        mapped = "";
        bool reresolve = stunReresolve;
        stunReresolve = false;
        foreach (var server in StunServers)
        {
            try
            {
                if (stunSock == null) { stunSock = new UdpClient(0); stunSock.Client.ReceiveTimeout = 1500; }
                var parts = server.Split(':');
                IPAddress ip;
                // resolve once and cache, so a DNS outage isn't mistaken for a UDP path outage; after a
                // socket reset, resolve again but keep the cached address if that lookup fails
                bool cached = stunIps.TryGetValue(server, out ip);
                if (!cached || reresolve)
                {
                    try { ip = Dns.GetHostAddresses(parts[0]).First(a => a.AddressFamily == AddressFamily.InterNetwork); stunIps[server] = ip; }
                    catch { if (!cached) throw; }
                }
                var tid = new byte[12]; rng.NextBytes(tid);
                var req = new byte[] { 0, 1, 0, 0, 0x21, 0x12, 0xA4, 0x42 }.Concat(tid).ToArray();
                var sw = Stopwatch.StartNew();
                stunSock.Send(req, req.Length, new IPEndPoint(ip, int.Parse(parts[1])));
                while (sw.ElapsedMilliseconds < 1500)
                {
                    var from = new IPEndPoint(IPAddress.Any, 0);
                    byte[] r = stunSock.Receive(ref from);   // throws on timeout
                    if (r.Length < 20 || r[0] != 0x01 || r[1] != 0x01 || !r.Skip(8).Take(12).SequenceEqual(tid)) continue;   // stale reply
                    mapped = (server.StartsWith("stun.cloudflare") ? "cf=" : "g=") + ParseXorMapped(r);
                    return (int)sw.ElapsedMilliseconds;
                }
            }
            catch (SocketException se)
            {
                // timeouts are expected on a dead path; anything else means the socket is broken
                if (se.SocketErrorCode != SocketError.TimedOut && stunSock != null) { stunSock.Close(); stunSock = null; }
            }
            catch { }
        }
        return -1;
    }

    static string ParseXorMapped(byte[] r)
    {
        int i = 20;
        while (i + 4 <= r.Length)
        {
            int type = (r[i] << 8) | r[i + 1], len = (r[i + 2] << 8) | r[i + 3];
            if (type == 0x0020 && len >= 8 && r[i + 5] == 0x01)   // XOR-MAPPED-ADDRESS, IPv4
            {
                int port = ((r[i + 6] << 8) | r[i + 7]) ^ 0x2112;
                return string.Format("{0}.{1}.{2}.{3}:{4}", r[i + 8] ^ 0x21, r[i + 9] ^ 0x12, r[i + 10] ^ 0xA4, r[i + 11] ^ 0x42, port);
            }
            i += 4 + ((len + 3) & ~3);
        }
        return "";
    }

    // Dashboard, read-only for anyone on the LAN. GET: "/" serves tools/dashboard.html (read
    // from disk on each request), /fonts/inter.woff2 the page font (cached by the browser for a
    // year), /api/state the latest sample + chart history (?since=<unix s>
    // returns only newer samples) + netbug's version, /api/events new events.log lines (?from=<byte offset>, or the
    // last 64 KB when omitted). /api/fix* is the router check and pin plus the update check/install (see
    // FixApi). One request at a time on this thread, except POST /api/export (see "export and updates"),
    // which streams on its own; the page polls only while it is visible. The "+" prefix (all
    // interfaces, Tailscale included) needs admin, which netbug always has. Other devices see the page read-only:
    // only a request from this laptop gets the control token (see LocalHost), so they get no Router protection,
    // update or export controls, and those APIs refuse them.
    static void DashboardLoop()
    {
        var listener = new HttpListener();
        try
        {
            listener.Prefixes.Add("http://+:" + DashPort + "/");
            listener.Start();
            Event("dashboard listening on port " + DashPort + " (all interfaces; controls only on this laptop)");
        }
        catch (Exception ex) { Event("dashboard failed to start: " + ex.Message); return; }
        while (listener.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); }
            catch { Thread.Sleep(1000); continue; }
            if (ctx.Request.Url.AbsolutePath == "/api/export")   // can take a while: on its own thread, the page keeps polling
            {
                var c = ctx;
                Task.Run(() =>
                {
                    try { Export(c); }
                    catch (Exception ex) { Event("log export failed: " + ex.GetType().Name + ": " + ex.Message); }
                    finally { try { c.Response.Close(); } catch { } }
                });
                continue;
            }
            try { Serve(ctx); }
            catch { }
            finally { try { ctx.Response.Close(); } catch { } }
        }
    }

    static void Serve(HttpListenerContext ctx)
    {
        string path = ctx.Request.Url.AbsolutePath, body, type = "application/json";
        if (path.StartsWith("/api/fix", StringComparison.Ordinal)) body = FixApi(ctx, path);
        else if (ctx.Request.HttpMethod != "GET") { ctx.Response.StatusCode = 405; body = "{}"; }
        else if (path == "/")
        {
            // only the person at this laptop gets the control token (and so the Router protection panel)
            body = File.ReadAllText(Path.Combine(baseDir, "tools", "dashboard.html")).Replace("__NETBUG_TOKEN__", LocalHost(ctx) ? token : "");
            type = "text/html; charset=utf-8";
        }
        else if (path == "/fonts/inter.woff2")
        {
            var font = File.ReadAllBytes(Path.Combine(baseDir, "tools", "fonts", "inter.woff2"));
            ctx.Response.ContentType = "font/woff2";
            ctx.Response.AddHeader("Cache-Control", "public, max-age=31536000, immutable");
            ctx.Response.ContentLength64 = font.Length;
            ctx.Response.OutputStream.Write(font, 0, font.Length);
            return;
        }
        else if (path == "/api/state")
        {
            long since; long.TryParse(ctx.Request.QueryString["since"], out since);
            var rows = new List<string>();
            lock (hist)
                for (int i = 0; i < histCount; i++)
                {
                    string h = hist[(histPos - histCount + i + hist.Length) % hist.Length];
                    if (long.Parse(h.Substring(1, h.IndexOf(',') - 1)) > since) rows.Add(h);
                }
            // reading process memory makes Windows enumerate every process, so refresh it only every 10 s
            if ((DateTime.Now - dashMemAt).TotalSeconds >= 10)
            {
                using (var p = Process.GetCurrentProcess()) dashMemMb = p.PrivateMemorySize64 / 1048576.0;
                dashMemAt = DateTime.Now;
            }
            body = string.Format("{{\"now\":{0},\"started\":{1},\"memMb\":{2:F1},\"port\":{3},\"version\":{4},\"sample\":{5},\"hist\":[{6}]}}",
                Unix(DateTime.Now), Unix(started), dashMemMb, DashPort, J(Version), sampleJson, string.Join(",", rows));
        }
        else if (path == "/api/events")
        {
            long from;
            if (!long.TryParse(ctx.Request.QueryString["from"], out from)) from = -1;
            body = EventsJson(from);
        }
        else { ctx.Response.StatusCode = 404; body = "{}"; }
        var bytes = Encoding.UTF8.GetBytes(body);
        ctx.Response.ContentType = type;
        ctx.Response.AddHeader("Cache-Control", "no-store");
        ctx.Response.ContentLength64 = bytes.Length;
        ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
    }

    // ---------------------------------------------------------------- export and updates
    //
    // Export: POST /api/export with the page's token as a form field (token=...; a form can't send the
    // X-Netbug-Token header, and other websites can't read the token), from this laptop only. It first
    // stops the ARP ring's capture file and reads it into memory, so the zip has ARP up to that moment, then
    // streams one zip: every file in logs/ (events.log, the CSVs, netbug.settings, snapshots, ring files)
    // under netbug-logs/, the in-memory ARP ring (arp-ring-memory.txt, the last 15 min), the latest sample
    // and Router protection status (state.json) and EXPORT_MANIFEST.txt. Nothing is redacted. Files are
    // read while netbug keeps writing them (shared read). One export at a time.
    // Updates: 2 min after start and then every 6 h, and on the page's "Check for updates", netbug reads
    // the latest GitHub release of Repo. A higher tag than Version with a netbug.exe asset is an update.
    // A lone exe (the release exe, installed in %ProgramData%\netbug) installs it by itself (once no router
    // check runs) or on "Install update now" (see InstallUpdate). A repo copy (tools\netbug.exe, a developer
    // build) only reports it: its page and scripts are read from tools\, so it's updated with git pull and
    // a build.

    const string Repo = "tariqaq/netbug";
    static readonly object updLock = new object();
    static volatile bool updBusy, updChecking;
    static volatile string updLatest = "", updUrl = "", updError = "", updStep = "";
    static DateTime updCheckedAt = DateTime.MinValue;
    static int exporting;

    static void UpdateLoop()
    {
        Thread.Sleep(TimeSpan.FromMinutes(2));
        string told = "";
        while (true)
        {
            updChecking = true;
            try { CheckUpdate(); } finally { updChecking = false; }
            if (UpdateAvailable())
            {
                if (portable)
                {
                    while (fixBusy) Thread.Sleep(5000);   // never in the middle of a router check
                    InstallUpdate("automatic");
                }
                else if (told != updLatest)
                {
                    told = updLatest;
                    Event("netbug " + updLatest + " is out (this is " + Version + "). This copy runs from its repo: git pull and rebuild to update.");
                }
            }
            Thread.Sleep(TimeSpan.FromHours(6));
        }
    }

    static bool UpdateAvailable()
    {
        System.Version v;
        return updUrl != "" && System.Version.TryParse(updLatest, out v) && v > System.Version.Parse(Version);
    }

    static void CheckUpdate()
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create("https://api.github.com/repos/" + Repo + "/releases/latest");
            req.UserAgent = "netbug/" + Version; req.Accept = "application/vnd.github+json";
            req.Timeout = 15000; req.ReadWriteTimeout = 15000;
            string json;
            using (var resp = req.GetResponse())
            using (var r = new StreamReader(resp.GetResponseStream())) json = r.ReadToEnd();
            var tag = Regex.Match(json, "\"tag_name\"\\s*:\\s*\"(v?([0-9]+(?:\\.[0-9]+){1,3}))\"");
            if (!tag.Success) throw new Exception("GitHub's reply has no release version");
            var url = Regex.Match(json, "\"browser_download_url\"\\s*:\\s*\"(https://github\\.com/" + Regex.Escape(Repo) + "/releases/download/[^\"/]+/netbug\\.exe)\"");
            updUrl = url.Success ? url.Groups[1].Value : "";
            updLatest = tag.Groups[2].Value;
            updError = updUrl == "" ? "release " + updLatest + " has no netbug.exe" : "";
        }
        catch (Exception ex) { updError = "update check failed: " + ex.Message; }
        updCheckedAt = DateTime.Now;
    }

    // Starts installing the update found by the last check; returns an error for the page, "" when started.
    // Lone exe only. The release's netbug.exe is downloaded next to the running exe as netbug.new.exe and
    // must be an assembly named netbug of at least the release's version. The running exe is renamed to
    // netbug.old.exe (Windows allows renaming a running exe; the old build stays as a fallback),
    // netbug.new.exe takes its name and is started the way a health restart is, and this process exits.
    // The task's command doesn't change; the new copy unpacks its page and scripts when it takes over.
    static string InstallUpdate(string why)
    {
        if (!portable) return "This netbug runs from its repo (a developer build): update it with git pull and a rebuild.";
        string tag, url;
        lock (updLock)
        {
            if (updBusy) return "An update is already running.";
            if (!UpdateAvailable()) return "There is no newer release.";
            updBusy = true; tag = updLatest; url = updUrl; updError = "";
        }
        Task.Run(() =>
        {
            string self = SelfPath(), dir = Path.GetDirectoryName(self);
            string part = Path.Combine(dir, "netbug.new.exe.part"), exe = Path.Combine(dir, "netbug.new.exe"), old = Path.Combine(dir, "netbug.old.exe");
            try
            {
                Event("updating netbug " + Version + " -> " + tag + " (" + why + "): downloading " + url);
                if (File.Exists(exe)) File.Delete(exe);
                updStep = "Downloading " + tag;
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.UserAgent = "netbug/" + Version; req.Timeout = 60000; req.ReadWriteTimeout = 60000;
                using (var resp = req.GetResponse())
                using (var s = resp.GetResponseStream())
                using (var f = File.Create(part)) s.CopyTo(f);
                File.Move(part, exe);
                System.Reflection.AssemblyName an;
                try { an = System.Reflection.AssemblyName.GetAssemblyName(exe); }
                catch { throw new Exception("the new file isn't a netbug build"); }
                if (an.Name != "netbug" || an.Version < System.Version.Parse(tag))
                    throw new Exception("the new file is " + an.Name + " " + an.Version + ", not netbug " + tag);

                updStep = "Installing " + tag;
                if (File.Exists(old)) File.Delete(old);
                File.Move(self, old);
                try { File.Move(exe, self); }
                catch { File.Move(old, self); throw; }
                Event("installing netbug " + an.Version + ": " + self + " replaced (the previous build is " + old + "), restarting");
                if (Monitor.TryEnter(pktmonLock, 10000)) RingPause();
                Process.Start(new ProcessStartInfo(self) { UseShellExecute = false, WorkingDirectory = dir });   // takes the mutex once this exits, like a health restart
                Environment.Exit(0);
            }
            catch (Exception ex)
            {
                updError = "update failed: " + ex.Message;
                Event("update failed: " + ex.Message);
                foreach (var f in new[] { part, exe }) try { File.Delete(f); } catch { }
                updStep = ""; updBusy = false;
            }
        });
        return "";
    }

    static void DeleteUpdateFiles()
    {
        string dir = Path.GetDirectoryName(SelfPath());
        foreach (var f in new[] { "netbug.new.exe", "netbug.new.exe.part" })
        {
            string p = Path.Combine(dir, f);
            if (!PathEq(p, SelfPath())) try { File.Delete(p); } catch { }
        }
    }

    static void Export(HttpListenerContext ctx)
    {
        string form = "";
        if (ctx.Request.HttpMethod == "POST")
            using (var r = new StreamReader(ctx.Request.InputStream)) form = r.ReadToEnd();
        var tok = Regex.Match(form, "(?:^|&)token=([0-9a-f]{32})(?:&|$)");
        if (!LocalHost(ctx) || ctx.Request.HttpMethod != "POST" || !tok.Success || tok.Groups[1].Value != token) { ctx.Response.StatusCode = 403; return; }
        if (Interlocked.Exchange(ref exporting, 1) == 1) { ctx.Response.StatusCode = 409; return; }
        try
        {
            DateTime cut = DateTime.Now;
            if (Monitor.TryEnter(pktmonLock, 15000))
                try { RingPause(); } finally { RingResume(); Monitor.Exit(pktmonLock); }
            List<ArpFrame> frames;
            lock (ringLock) frames = ring.ToList();

            ctx.Response.ContentType = "application/zip";
            ctx.Response.AddHeader("Content-Disposition", "attachment; filename=\"netbug-full-logs-" + cut.ToString("yyyy-MM-dd_HH-mm-ss") + ".zip\"");
            ctx.Response.AddHeader("Cache-Control", "no-store");
            ctx.Response.SendChunked = true;
            var list = new StringBuilder();
            int files = 0; long bytes = 0;
            using (var zip = new ZipArchive(new CountingStream(ctx.Response.OutputStream), ZipArchiveMode.Create, true))
            {
                foreach (var f in Directory.GetFiles(logDir, "*", SearchOption.AllDirectories).OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
                {
                    string rel = f.Substring(logDir.Length).TrimStart('\\');
                    try
                    {
                        using (var src = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                        {
                            var e = zip.CreateEntry("netbug-logs/" + rel.Replace('\\', '/'), CompressionLevel.Optimal);
                            e.LastWriteTime = File.GetLastWriteTime(f);
                            long n = 0;
                            using (var dst = e.Open())
                            {
                                var buf = new byte[81920];
                                for (int k; (k = src.Read(buf, 0, buf.Length)) > 0; n += k) dst.Write(buf, 0, k);
                            }
                            list.AppendFormat("{0}\t{1}\r\n", rel, n);
                            files++; bytes += n;
                        }
                    }
                    catch (Exception ex) { if (ex is IOException || ex is UnauthorizedAccessException) list.AppendFormat("{0}\tskipped: {1}\r\n", rel, ex.Message); else throw; }
                }
                var ringText = new StringBuilder();
                foreach (var fr in frames) ringText.Append(StampMs(fr.T)).Append("  ").Append(fr.Line).Append("\r\n");
                ZipText(zip, "netbug-logs/arp-ring-memory.txt", ringText.ToString());
                ZipText(zip, "netbug-logs/state.json", "{\"version\":" + J(Version) + ",\"sample\":" + sampleJson + ",\"routerProtection\":" + FixStatus("") + "}");
                ZipText(zip, "netbug-logs/EXPORT_MANIFEST.txt",
                    "netbug " + Version + " full export. Nothing is redacted: it has MAC addresses, IPs and network names.\r\n" +
                    "Export cutoff (local): " + StampMs(cut) + "\r\n" +
                    "Source: " + logDir + "\r\n" +
                    "Also: arp-ring-memory.txt (ARP frames netbug held in memory, " + frames.Count + " frames), state.json (latest sample and Router protection status)\r\n" +
                    "Files (" + files + ", " + bytes.ToString("N0") + " bytes as read):\r\n" + list);
            }
            Event(string.Format("logs exported to the browser: {0} files, {1:N1} MB before compression", files, bytes / 1048576.0));
        }
        finally { Interlocked.Exchange(ref exporting, 0); }
    }

    // .NET Framework's ZipArchive reads Position while writing, which the HTTP response stream can't
    // answer: this forward-only wrapper counts the bytes written instead.
    class CountingStream : Stream
    {
        readonly Stream inner; long pos;
        public CountingStream(Stream s) { inner = s; }
        public override bool CanRead { get { return false; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return true; } }
        public override long Length { get { return pos; } }
        public override long Position { get { return pos; } set { throw new NotSupportedException(); } }
        public override void Write(byte[] b, int o, int n) { inner.Write(b, o, n); pos += n; }
        public override void Flush() { inner.Flush(); }
        public override int Read(byte[] b, int o, int n) { throw new NotSupportedException(); }
        public override long Seek(long o, SeekOrigin so) { throw new NotSupportedException(); }
        public override void SetLength(long v) { throw new NotSupportedException(); }
    }

    static void ZipText(ZipArchive zip, string name, string text)
    {
        var e = zip.CreateEntry(name, CompressionLevel.Optimal);
        using (var w = new StreamWriter(e.Open(), new UTF8Encoding(false))) w.Write(text);
    }

    // ---------------------------------------------------------------- router check and pin
    //
    // Check: finds the real router MAC for the current gateway IP. Candidates are the ARP table entry, a
    // pinned entry, the known routers for this gateway IP (see below) and every MAC that answers for the
    // gateway IP in 10 s of the ARP ring (the laptop asks
    // for the router 3 times meanwhile, unless the entry is pinned, so the real router answers too). Each
    // candidate is then set for a moment as a temporary static ARP entry (active store only) and tested:
    // it is the real router when pings to 1.1.1.1/8.8.8.8 get through it AND a TTL-1 ping comes back
    // "TTL expired" from the gateway IP itself. A blackholing impostor passes nothing; a device in the
    // middle that forwards traffic answers the TTL-1 ping with its own IP. The entry is then put back as
    // it was (pinned again, or deleted and learned again).
    // Pin: the verified MAC becomes a permanent ARP entry (netsh, persistent store), so Windows ignores
    // fake replies. Unpin removes it from both stores.
    // Test and pin (trypin?mac=): the same test for one MAC chosen on the page (a known router or typed in),
    // without the 10 s listen; it is pinned only when it passes. A failed test changes nothing.
    // Control: GET /api/fix (status, with the version and update state) and POST
    // /api/fix/{check,trypin,pin,unpin,auto,announce,update/check,update/install,uninstall}, only from this laptop
    // (loopback, Host localhost/127.0.0.1, against DNS rebinding) with the per-run token the page was
    // served (X-Netbug-Token: other websites can't read it, and the custom header can't be sent cross-site
    // without a CORS preflight, which netbug never answers).

    class Candidate { public string Mac, From = "", Hop = "", Verdict = ""; public bool Works, Random; }

    // Known routers: "<gateway ip> <MAC> [label]" lines, one per line, # for comments, in the optional
    // embedded resource netbug.routers.txt (built from the gitignored tools\routers.local.txt). The page
    // offers the ones for the current gateway IP, and Check now tests them too.
    class KnownRouter { public string Gw, Mac, Label; }
    static readonly List<KnownRouter> knownRouters = LoadKnownRouters();

    static List<KnownRouter> LoadKnownRouters()
    {
        var list = new List<KnownRouter>();
        try
        {
            using (var res = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream("netbug.routers.txt"))
            {
                if (res == null) return list;
                using (var r = new StreamReader(res))
                    for (string line; (line = r.ReadLine()) != null; )
                    {
                        line = line.Trim();
                        if (line == "" || line.StartsWith("#")) continue;
                        var p = line.Split(new[] { ' ', '\t' }, 3, StringSplitOptions.RemoveEmptyEntries);
                        IPAddress ip; string mac = p.Length >= 2 ? NormalizeMac(p[1]) : "";
                        if (mac != "" && IPAddress.TryParse(p[0], out ip) && ip.AddressFamily == AddressFamily.InterNetwork)
                            list.Add(new KnownRouter { Gw = ip.ToString(), Mac = mac, Label = p.Length > 2 ? p[2].Trim() : "" });
                    }
            }
        }
        catch { }
        return list;
    }

    // "aa:bb:cc:dd:ee:ff", "AA-BB-CC-DD-EE-FF" or "aabbccddeeff" -> "AA-BB-CC-DD-EE-FF"; "" when it isn't a
    // MAC a router can have (multicast/broadcast bit set, or all zeros)
    static string NormalizeMac(string s)
    {
        s = Regex.Replace((s ?? "").Trim().ToUpperInvariant(), "[:.\\-\\s]", "");
        if (!Regex.IsMatch(s, "^[0-9A-F]{12}$") || (Convert.ToInt32(s.Substring(0, 2), 16) & 1) != 0 || s == "000000000000") return "";
        return string.Join("-", Enumerable.Range(0, 6).Select(i => s.Substring(i * 2, 2)));
    }

    static volatile bool fixBusy, autoKick, autoDetect;
    static volatile string fixStep = "", fixJson = "null";
    static readonly object fixLock = new object(), pinLock = new object();
    static DateTime lastDetect = DateTime.MinValue;
    static volatile string lastDetectGw = "";
    static string verifiedMac = "", verifiedGw = "";
    static int verifiedIf = -1;
    static volatile NetworkInterface curNi;
    static volatile IPAddress curIp, curGw;
    static string pinCache = "", pinCacheKey = "";
    static DateTime pinCacheAt = DateTime.MinValue;
    static readonly string token = Guid.NewGuid().ToString("N");
    static bool portable;

    static bool LocalHost(HttpListenerContext ctx)
    {
        string host = (ctx.Request.UserHostName ?? "").Split(':')[0];
        return ctx.Request.IsLocal && (host == "localhost" || host == "127.0.0.1");
    }

    static string FixApi(HttpListenerContext ctx, string path)
    {
        if (!LocalHost(ctx) || ctx.Request.Headers["X-Netbug-Token"] != token) { ctx.Response.StatusCode = 403; return "{}"; }
        string method = ctx.Request.HttpMethod, error = "";
        if (path == "/api/fix" && method == "GET") return FixStatus("");
        if (method != "POST") { ctx.Response.StatusCode = 405; return "{}"; }
        switch (path)
        {
            case "/api/fix/check": if (fixBusy) error = "A check is already running."; else StartDetect("manual"); break;
            case "/api/fix/pin": error = Pin(); break;
            case "/api/fix/trypin":
            {
                string mac = NormalizeMac(ctx.Request.QueryString["mac"]);
                if (mac == "") error = "That isn't a router MAC address (format: AA-BB-CC-DD-EE-FF).";
                else if (fixBusy) error = "A check is already running.";
                else StartDetect("test and pin " + mac, mac);
                break;
            }
            case "/api/fix/unpin": error = Unpin(); break;
            case "/api/fix/auto":
                autoDetect = ctx.Request.QueryString["on"] == "1";
                SaveSettings();
                Event("router auto-detect " + (autoDetect ? "on" : "off"));
                if (autoDetect && !fixBusy) StartDetect("auto");
                break;
            case "/api/fix/announce":
                announce = ctx.Request.QueryString["on"] == "1";
                SaveSettings();
                Event("MAC announce (keep the router updated) " + (announce ? "on" : "off"));
                break;
            case "/api/fix/update/check":
                if (updBusy || updChecking) error = "An update check or install is already running.";
                else { updChecking = true; Task.Run(() => { try { CheckUpdate(); } finally { updChecking = false; } }); }
                break;
            case "/api/fix/update/install": error = InstallUpdate("from the page"); break;
            case "/api/fix/uninstall":
                if (!portable) { error = "This netbug runs from its repo; run netbug.exe --uninstall instead."; break; }
                Task.Run(() =>
                {
                    Thread.Sleep(500);   // let this reply reach the page first
                    if (Monitor.TryEnter(pktmonLock, 10000)) RingPause();
                    Uninstall(Process.GetCurrentProcess().Id);
                    Environment.Exit(0);
                });
                break;
            default: ctx.Response.StatusCode = 404; return "{}";
        }
        return FixStatus(error);
    }

    static string FixStatus(string error)
    {
        var ni = curNi; var gw = curGw;
        string iface = ni == null ? "" : ni.Name, pinned = "";
        int idx = IfIndex(ni);
        if (gw != null && idx >= 0) pinned = PersistentPin(idx, gw);
        bool verifiedHere = gw != null && verifiedMac != "" && verifiedGw == gw.ToString() && verifiedIf == idx;
        string known = gw == null ? "" : string.Join(",", knownRouters.Where(k => k.Gw == gw.ToString())
            .Select(k => string.Format("{{\"mac\":{0},\"label\":{1}}}", J(k.Mac), J(k.Label))));
        string ann = string.Format("{{\"on\":{0},\"target\":{1},\"sent\":{2},\"seen\":{3},\"seenAt\":{4},\"error\":{5}}}",
            announce ? "true" : "false", J(announceTarget), Thread.VolatileRead(ref announceSent), announceSeen,
            announceSeenAt == DateTime.MinValue ? 0 : Unix(announceSeenAt), J(announceErr));
        string upd = string.Format("{{\"latest\":{0},\"available\":{1},\"checkedAt\":{2},\"checking\":{3},\"busy\":{4},\"step\":{5},\"error\":{6}}}",
            J(updLatest), UpdateAvailable() ? "true" : "false", updCheckedAt == DateTime.MinValue ? 0 : Unix(updCheckedAt),
            updChecking ? "true" : "false", updBusy ? "true" : "false", J(updStep), J(updError));
        return string.Format("{{\"busy\":{0},\"step\":{1},\"auto\":{2},\"portable\":{3},\"iface\":{4},\"gw\":{5},\"arpMac\":{6},\"arpType\":{7},\"pinned\":{8},\"verified\":{9},\"result\":{10},\"error\":{11},\"announce\":{12},\"known\":[{13}],\"version\":{14},\"update\":{15},\"exporting\":{16}}}",
            fixBusy ? "true" : "false", J(fixStep), autoDetect ? "true" : "false", portable ? "true" : "false", J(iface), J(gw == null ? "" : gw.ToString()),
            J(gwMac), J(gwArp), J(pinned), J(verifiedHere ? verifiedMac : ""), fixJson, J(error), ann, known, J(Version), upd, exporting == 1 ? "true" : "false");
    }

    static int IfIndex(NetworkInterface ni)
    {
        try { return ni == null ? -1 : ni.GetIPProperties().GetIPv4Properties().Index; } catch { return -1; }
    }

    static string Netsh(string args) { return Run("netsh.exe", args); }

    // The gateway's MAC in the persistent ARP store of an interface ("" if none). Cached for 20 s:
    // the page asks every 2 s and netsh is a process start.
    static string PersistentPin(int ifIndex, IPAddress gw)
    {
        lock (pinLock)
        {
            string key = ifIndex + " " + gw;
            if (key == pinCacheKey && (DateTime.Now - pinCacheAt).TotalSeconds < 20) return pinCache;
            string mac = "";
            foreach (var line in Netsh(string.Format("interface ipv4 show neighbors interface={0} store=persistent", ifIndex)).Split('\n'))
            {
                var parts = line.Trim().Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 2 && parts[0] == gw.ToString() && parts[1].Length == 17) mac = parts[1].ToUpperInvariant();
            }
            pinCache = mac; pinCacheKey = key; pinCacheAt = DateTime.Now;
            return mac;
        }
    }

    // Replaces the gateway's entry in the active ARP store only: a static entry for `mac`, or none ("").
    static void SetActive(int ifIndex, IPAddress gw, string mac)
    {
        Netsh(string.Format("interface ipv4 delete neighbors name={0} address={1} store=active", ifIndex, gw));
        if (mac != "") Netsh(string.Format("interface ipv4 add neighbors interface={0} address={1} neighbor={2} store=active", ifIndex, gw, mac));
    }

    // ICMP echo from `src` (so it leaves through that interface) with the given TTL. Returns the IP Helper
    // status (0 = reply, 11013 = TTL expired in transit, 11010 = timed out) and who answered.
    static int PingFrom(IPAddress src, IPAddress dst, byte ttl, out IPAddress from)
    {
        from = null;
        IntPtr handle = IcmpCreateFile(), reply = Marshal.AllocHGlobal(256);
        try
        {
            var options = new IpOptions { Ttl = ttl };
            var data = new byte[32];
            int n = IcmpSendEcho2Ex(handle, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, BitConverter.ToUInt32(src.GetAddressBytes(), 0),
                BitConverter.ToUInt32(dst.GetAddressBytes(), 0), data, (short)data.Length, ref options, reply, 256, 1500);
            if (n == 0) return Marshal.GetLastWin32Error();
            from = new IPAddress(BitConverter.GetBytes(Marshal.ReadInt32(reply, 0)));   // ICMP_ECHO_REPLY: address, status, ...
            return Marshal.ReadInt32(reply, 4);
        }
        finally { Marshal.FreeHGlobal(reply); IcmpCloseHandle(handle); }
    }

    // `only`: test just this MAC (the page's "Test and pin") and pin it when it's the real router
    static void StartDetect(string why, string only = null)
    {
        lock (fixLock) { if (fixBusy) return; fixBusy = true; }
        lastDetect = DateTime.Now; autoKick = false;
        Task.Run(() => Detect(why, only));
    }

    static void Detect(string why, string only)
    {
        var cands = new List<Candidate>();
        Action<string, string> add = (mac, from) =>
        {
            if (mac == null || mac.Length != 17) return;
            mac = mac.ToUpperInvariant();
            var c = cands.FirstOrDefault(x => x.Mac == mac);
            if (c == null) cands.Add(c = new Candidate { Mac = mac, Random = (Convert.ToInt32(mac.Substring(0, 2), 16) & 2) != 0 });
            c.From += (c.From == "" ? "" : ", ") + from;
        };
        try
        {
            NetworkInterface ni = curNi; IPAddress ip = curIp, gw = curGw;
            int idx = IfIndex(ni);
            if (ni == null || ip == null || gw == null || idx < 0)
            {
                fixJson = string.Format("{{\"at\":{0},\"note\":{1},\"cands\":[]}}", Unix(DateTime.Now), J("No network with a router right now."));
                return;
            }
            lastDetectGw = gw.ToString();
            Event(string.Format("router check ({0}) on '{1}', gateway {2}", why, ni.Name, gw));
            string pinned = PersistentPin(idx, gw), gwIp = gw.ToString();
            if (only != null) add(only, "chosen on the page");
            else
            {
                string arpType = ArpEntryType(gw, ni);
                add(Arp(gw, ip), "ARP table (" + (arpType == "" ? "?" : arpType) + ")");
                add(pinned, "pinned");
                foreach (var k in knownRouters.Where(k => k.Gw == gwIp)) add(k.Mac, "known router" + (k.Label == "" ? "" : " (" + k.Label + ")"));

                // the ring captures all the time: ask for the router again so the real one answers too (a pinned
                // entry is never asked about), then pause the ring once so pktmon hands over what it buffered
                fixStep = "Listening for who answers as the router (10 s)";
                var t0 = DateTime.Now.AddSeconds(-1);
                if (arpType != "static")
                    for (int i = 0; i < 3; i++) { SetActive(idx, gw, ""); Arp(gw, ip); Thread.Sleep(1500); }
                Thread.Sleep(Math.Max(0, 10000 - (int)(DateTime.Now - t0).TotalMilliseconds));
                List<ArpFrame> heard;
                lock (pktmonLock) { RingPause(); RingResume(); }
                lock (ringLock) heard = ring.Where(f => f.T >= t0).ToList();
                var claims = new List<Claim>();
                Analyze(heard, gw, ip, claims, new List<Claim>());
                foreach (var c in claims) add(c.Mac, string.Format("answered as the router {0}x", c.N));
            }

            var cf = IPAddress.Parse("1.1.1.1"); var g = IPAddress.Parse("8.8.8.8");
            try
            {
                foreach (var c in cands)
                {
                    fixStep = "Testing " + c.Mac;
                    SetActive(idx, gw, c.Mac);
                    Thread.Sleep(500);
                    IPAddress from;
                    c.Works = PingFrom(ip, cf, 64, out from) == 0 || PingFrom(ip, g, 64, out from) == 0 || PingFrom(ip, cf, 64, out from) == 0;
                    int st = PingFrom(ip, g, 1, out from);
                    if (st != 11013) st = PingFrom(ip, cf, 1, out from);
                    c.Hop = st == 11013 && from != null ? from.ToString() : "";
                }
            }
            finally { SetActive(idx, gw, pinned); }   // as it was: pinned again, or learned again

            // the laptop moved to another network or adapter meanwhile: the results say nothing about it
            if (curGw == null || curGw.ToString() != gwIp || IfIndex(curNi) != idx)
            {
                fixJson = string.Format("{{\"at\":{0},\"note\":{1},\"cands\":[]}}", Unix(DateTime.Now),
                    J("The network changed during the check, so nothing was picked" + (only != null ? " or pinned" : "") + ". Run it again."));
                Event(string.Format("router check ({0}) dropped: the network changed during it", why));
                return;
            }

            foreach (var c in cands)
                c.Verdict = !c.Works ? "nothing gets through it: not the router"
                    : c.Hop == gwIp ? "the real router: traffic gets through and it answers as " + gwIp
                    : c.Hop != "" ? "passes traffic on through " + c.Hop + ": a device in the middle"
                    : "traffic gets through, but it didn't answer the hop test";
            var real = cands.Where(c => c.Works && c.Hop == gwIp).ToList();
            if (real.Count > 1 && real.Count(c => !c.Random) == 1) real = real.Where(c => !c.Random).ToList();
            string note;
            if (real.Count == 1) note = "";
            else if (real.Count > 1) note = "More than one MAC passed the test, so none was picked. Check again in a minute.";
            else
            {
                var works = cands.Where(c => c.Works && c.Hop == "").ToList();
                if (works.Count == 1 && !works[0].Random) { real = works; note = "Picked by traffic only: the router doesn't answer the hop test."; }
                else note = cands.Count == 0 ? "No MAC answered for the router." : "No MAC passed the test. The router may be down; try again later.";
            }
            // a failed single-MAC test leaves an earlier check's result alone
            if (only == null || real.Count == 1)
                lock (fixLock)
                {
                    verifiedMac = real.Count == 1 ? real[0].Mac : "";
                    verifiedGw = gwIp; verifiedIf = idx;
                }
            // a proven router replaces the trusted MAC, which is otherwise the first one seen (and that can be
            // an impostor already answering when netbug starts)
            if (real.Count == 1) TrustGateway(gwIp, real[0].Mac);
            bool pinnedNow = false;
            if (only != null)
            {
                if (real.Count == 1)
                {
                    string err = PinMac(ni, idx, gw, only, "after testing it from the page");
                    pinnedNow = err == "";
                    note = err == "" ? "It's the real router" + (note == "" ? "" : " (" + note.TrimEnd('.') + ")") + ", so it's pinned now." : err;
                }
                else note = "Not pinned: " + cands[0].Verdict + ". Nothing was changed. Use Check now to find the real router.";
            }
            fixJson = string.Format("{{\"at\":{0},\"chosen\":{1},\"note\":{2},\"cands\":[{3}]}}", Unix(DateTime.Now), J(verifiedMac), J(note),
                string.Join(",", cands.Select(c => string.Format("{{\"mac\":{0},\"from\":{1},\"works\":{2},\"hop\":{3},\"random\":{4},\"verdict\":{5}}}",
                    J(c.Mac), J(c.From), c.Works ? "true" : "false", J(c.Hop), c.Random ? "true" : "false", J(c.Verdict)))));
            if (only != null) Event(string.Format("router test of {0}: {1}; {2}", only, cands[0].Verdict, pinnedNow ? "pinned" : "not pinned"));
            else Event(string.Format("router check: {0} ({1})", verifiedMac != "" ? "real router is " + verifiedMac : "no MAC picked",
                string.Join("; ", cands.Select(c => c.Mac + ": " + c.Verdict))));
        }
        catch (Exception ex)
        {
            fixJson = string.Format("{{\"at\":{0},\"note\":{1},\"cands\":[]}}", Unix(DateTime.Now), J("Check failed: " + ex.Message));
            Event("router check failed: " + ex.Message);
        }
        finally { fixStep = ""; fixBusy = false; }
    }

    // Pins the MAC the last check verified, for the gateway and interface it was checked on.
    static string Pin()
    {
        NetworkInterface ni = curNi; IPAddress gw = curGw;
        int idx = IfIndex(ni);
        string mac;
        lock (fixLock)
        {
            if (fixBusy) return "Wait for the check to finish.";
            if (gw == null || verifiedMac == "" || verifiedGw != gw.ToString() || verifiedIf != idx) return "Run a check first: nothing is verified for this network yet.";
            mac = verifiedMac;
        }
        return PinMac(ni, idx, gw, mac, "from the page");
    }

    static string PinMac(NetworkInterface ni, int idx, IPAddress gw, string mac, string how)
    {
        Netsh(string.Format("interface ipv4 delete neighbors name={0} address={1}", idx, gw));
        string output = Netsh(string.Format("interface ipv4 add neighbors interface={0} address={1} neighbor={2} store=persistent", idx, gw, mac));
        lock (pinLock) pinCacheAt = DateTime.MinValue;
        if (PersistentPin(idx, gw) != mac) return "Pinning failed: " + output.Trim();
        TrustGateway(gw.ToString(), mac);
        Event(string.Format("gateway {0} pinned to {1} on '{2}' {3}", gw, mac, ni.Name, how));
        return "";
    }

    // the MAC that gateway MAC changes and the ARP watch are judged against
    static void TrustGateway(string gwIp, string mac)
    {
        lock (trustLock) { trustedGwMac = mac; trustedGwIp = gwIp; }
    }
    static readonly object trustLock = new object();

    static string Unpin()
    {
        NetworkInterface ni = curNi; IPAddress gw = curGw;
        int idx = IfIndex(ni);
        if (gw == null || idx < 0) return "No network with a router right now.";
        if (fixBusy) return "Wait for the check to finish.";
        Netsh(string.Format("interface ipv4 delete neighbors name={0} address={1}", idx, gw));
        lock (pinLock) pinCacheAt = DateTime.MinValue;
        if (PersistentPin(idx, gw) != "") return "Unpinning failed.";
        Event(string.Format("gateway {0} unpinned on '{1}' from the page", gw, ni.Name));
        return "";
    }

    // events.log lines after byte offset `from` (at most 256 KB). A missing or out-of-range offset
    // (e.g. the log was replaced) starts from the last 64 KB, cut to whole lines.
    static string EventsJson(long from)
    {
        string file = Path.Combine(logDir, "events.log");
        byte[] data; long len; bool tail = false;
        lock (eventLock)
        {
            if (!File.Exists(file)) return "{\"next\":0,\"lines\":[]}";
            using (var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                len = fs.Length;
                if (from < 0 || from > len) { from = Math.Max(0, len - 65536); tail = from > 0; }
                if (len - from > 262144) { from = len - 262144; tail = true; }
                data = new byte[len - from];
                fs.Position = from;
                int read = 0;
                while (read < data.Length) { int n = fs.Read(data, read, data.Length - read); if (n == 0) break; read += n; }
            }
        }
        var lines = Encoding.UTF8.GetString(data).Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries).AsEnumerable();
        if (tail) lines = lines.Skip(1);   // first line may be cut in half
        return string.Format("{{\"next\":{0},\"reset\":{1},\"lines\":[{2}]}}", len, from == 0 || tail ? "true" : "false",
            string.Join(",", lines.Select(J)));
    }

    static long Unix(DateTime local) { return (long)(local.ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds; }

    static string J(string s)
    {
        var sb = new StringBuilder("\"");
        foreach (char c in s ?? "")
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c < 0x20) sb.AppendFormat("\\u{0:x4}", (int)c);
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }

    // "cf=1.2.3.4:5678" -> "1.2.3.4:5678"
    static string MapAddr(string map) { return map.Substring(map.IndexOf('=') + 1); }

    static string CsvPath() { return Path.Combine(logDir, "netbug-" + currentDay + ".csv"); }
    static string Csv(string s) { return (s ?? "").Replace(",", ";"); }
    static void Row(string line) { File.AppendAllText(CsvPath(), line + "\r\n"); }

    // every log timestamp carries the date and the UTC offset in force then ("2026-11-04 08:01:02 +08:00"),
    // so a timeline across days, laptops and time zones lines up
    static string Stamp(DateTime t) { return t.ToString("yyyy-MM-dd HH:mm:ss zzz"); }
    static string StampMs(DateTime t) { return t.ToString("yyyy-MM-dd HH:mm:ss.fff zzz"); }

    static readonly object eventLock = new object();
    static void Event(string msg)
    {
        lock (eventLock)   // called from the main loop and the persistent TCP thread
            File.AppendAllText(Path.Combine(logDir, "events.log"), Stamp(DateTime.Now) + "  " + msg + "\r\n");
    }
}
