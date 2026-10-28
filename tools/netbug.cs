// netbug - lightweight always-on network health logger.
//
// Probes every second (gateway ping, 1.1.1.1 + 8.8.8.8 ping), DNS via the
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
// Every 5 min arpwatch.ps1 captures 10 s of ARP and reports any other MAC claiming the
// gateway IP (ARP SPOOFING DETECTED), even while a pinned entry makes Windows ignore it.
// logs/ is kept under 30 days and 500 MB. An hourly health line is written, and the
// process restarts itself past 200 MB private memory / 5000 handles / 100 threads.
// A read-only dashboard (tools/dashboard.html + its font + /api/state + /api/events) is served
// on port 8787 on all interfaces.
// Router check and pin (the dashboard's "Router protection" panel, for the person at this laptop
// only): finds the real router MAC by testing every MAC that claims the gateway IP, and can pin it
// as a permanent ARP entry. See the "router check and pin" section.
//
// Started without admin rights (a double-click), netbug asks for UAC, starts an elevated copy and
// opens the dashboard in the default browser. A lone netbug.exe (no dashboard.html next to it, e.g.
// sent to a friend) runs from %ProgramData%\netbug: it unpacks its page, font and scripts from its
// own resources and serves the dashboard on localhost only.
//
// Build (in tools/): csc /target:winexe /optimize /out:netbug.exe /resource:dashboard.html,netbug.dashboard.html
//   /resource:fonts\inter.woff2,netbug.inter.woff2 /resource:arpwatch.ps1,netbug.arpwatch.ps1
//   /resource:snapshot.ps1,netbug.snapshot.ps1 netbug.cs

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
using System.Threading;
using System.Threading.Tasks;

class NetBug
{
    [DllImport("iphlpapi.dll")]
    static extern int GetExtendedUdpTable(IntPtr table, ref int size, bool sort, int af, int tableClass, int reserved);

    [DllImport("iphlpapi.dll")]
    static extern int SendARP(int destIp, int srcIp, byte[] mac, ref int macLen);

    [DllImport("iphlpapi.dll")]
    static extern int GetIpNetTable(IntPtr table, ref int size, bool order);

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
    // a loud alert when the gateway MAC changes while the gateway IP stays the same, and a
    // 10 s ARP-only capture every 5 min (arpwatch.ps1) that reports anyone else claiming the gateway IP.
    // The trusted MAC is the first one seen for a gateway IP (or the pinned one). It is not replaced
    // by a changed MAC, so a poisoned ARP cache can't make the impostor "trusted".
    static string gwArp = "", lastGwArp = "", trustedGwMac = "", trustedGwIp = "";
    static volatile string gwAlert = "";
    static DateTime gwAlertAt = DateTime.MinValue;
    static volatile bool arpWatchRunning;
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
    const string CsvHeader = "time,iface,eth_link,ip,gw,gw_mac,gw_arp,gw_ms,cf_ms,g_ms,dns_ms,tcp_ms,udp_ms,udp_map,tx_pkts,rx_pkts,udp_total,udp_top,public_ip,fail";

    static void Main(string[] args)
    {
        string exeDir = AppDomain.CurrentDomain.BaseDirectory;
        portable = !File.Exists(Path.Combine(exeDir, "dashboard.html"));
        if (!IsAdmin()) { Launch(); return; }
        // opened by hand as admin (UAC off, or "Run as administrator"): show the page too. Not when
        // started by the launcher (it opens the page itself), the logon task or a self-restart.
        bool openPage = !args.Contains("--from-launcher") && ParentName() == "explorer";

        using (var self = Process.GetCurrentProcess()) self.PriorityClass = ProcessPriorityClass.BelowNormal;
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;   // TLS 1.2; .NET 4.0 defaults to TLS 1.0

        if (portable)
        {
            baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "netbug");
            Unpack();
        }
        else baseDir = Path.GetFullPath(Path.Combine(exeDir, ".."));
        logDir = Path.Combine(baseDir, "logs");
        snapDir = Path.Combine(logDir, "snapshots");
        Directory.CreateDirectory(snapDir);
        LoadSettings();

        using (var mutex = new Mutex(false, "Global\\netbug"))
        {
            // wait a little so a self-restart (see Health) can take over from the exiting instance
            try { if (!mutex.WaitOne(15000)) { if (openPage) OpenPage(); return; } }   // another instance is running
            catch (AbandonedMutexException) { }
            Event("netbug started" + (portable ? " (portable, files in " + baseDir + ")" : ""));
            new Thread(PersistentTcpLoop) { IsBackground = true, Priority = ThreadPriority.BelowNormal }.Start();
            new Thread(StunLoop) { IsBackground = true, Priority = ThreadPriority.BelowNormal }.Start();
            new Thread(DashboardLoop) { IsBackground = true, Priority = ThreadPriority.BelowNormal }.Start();
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

    // Not elevated: if netbug already runs, just open its page. Otherwise start an elevated copy (UAC
    // prompt), wait for its dashboard and open it here, so the browser itself doesn't run as admin.
    static void Launch()
    {
        if (PageUp()) { OpenPage(); return; }
        try
        {
            string exe;
            using (var me = Process.GetCurrentProcess()) exe = me.MainModule.FileName;
            Process.Start(new ProcessStartInfo(exe, "--from-launcher") { UseShellExecute = true, Verb = "runas" });
        }
        catch (System.ComponentModel.Win32Exception)
        {
            MessageBox(IntPtr.Zero, "netbug needs administrator rights to watch the network and to pin the router's address.\n\nRun it again and choose Yes.", "netbug", 0x30);
            return;
        }
        for (int i = 0; i < 60 && !PageUp(); i++) Thread.Sleep(500);
        OpenPage();
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
        try
        {
            var info = new ProcessInfo(); int returned;
            using (var me = Process.GetCurrentProcess())
                if (NtQueryInformationProcess(me.Handle, 0, ref info, Marshal.SizeOf(info), out returned) != 0) return "";
            using (var parent = Process.GetProcessById(info.ParentPid.ToInt32())) return parent.ProcessName.ToLowerInvariant();
        }
        catch { return ""; }
    }

    // A lone netbug.exe writes its page, font and scripts (embedded resources) to %ProgramData%\netbug\tools
    // on every start, so the rest of netbug finds them where it always does.
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

    // The page's "auto-detect" switch, kept across restarts in logs/netbug.settings.
    static void LoadSettings()
    {
        try { string f = Path.Combine(logDir, "netbug.settings"); autoDetect = File.Exists(f) && File.ReadAllText(f).Contains("auto=1"); } catch { }
    }

    static void SaveSettings()
    {
        try { File.WriteAllText(Path.Combine(logDir, "netbug.settings"), "auto=" + (autoDetect ? "1" : "0") + "\r\n"); } catch { }
    }

    static void Run()
    {
        long tick = 0;
        DateTime lastRow = DateTime.MinValue;
        while (true)
        {
            var loopStart = DateTime.Now;
            try
            {
                RotateIfNewDay();

                IPAddress ip, gw;
                string ifaceName, ethLink;
                NetworkInterface ni = PickInterface(out ip, out gw, out ifaceName, out ethLink);
                curNi = ni; curIp = ip; curGw = gw;

                // pings in parallel
                var pGw = gw != null ? PingAsync(gw) : Task.FromResult(-1L);
                var pCf = PingAsync(IPAddress.Parse("1.1.1.1"));
                var pG = PingAsync(IPAddress.Parse("8.8.8.8"));
                Task.WaitAll(pGw, pCf, pG);
                long gwMs = pGw.Result, cfMs = pCf.Result, gMs = pG.Result;

                if (tick % 2 == 0 || dnsMs < 0) dnsMs = gw != null ? DnsProbe(gw) : -1;   // a failed probe is re-checked the next second
                if (tcpMs < 0 && tick % 10 != 0) tcpMs = TcpProbe();   // re-check a failed probe every second
                if (tick % 10 == 0)
                {
                    tcpMs = TcpProbe();
                    UdpUsage(out udpTotal, out udpTop);
                    gwMac = gw != null && ip != null ? Arp(gw, ip) : "";
                    gwArp = gw != null && ni != null ? ArpEntryType(gw, ni) : "";
                }
                if (tick % 300 == 150 && gw != null && trustedGwIp == gw.ToString()) ArpWatchStart(gw, trustedGwMac);
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
                if (ifaceName != lastIface) { Event(string.Format("active interface: '{0}' -> '{1}' ip={2} gw={3}", lastIface, ifaceName, ip, gw)); lastIface = ifaceName; lastTx = -1; }
                if (ethLink != lastEthLink) { Event(string.Format("USB ethernet link: {0} -> {1}", lastEthLink == "" ? "?" : lastEthLink, ethLink)); lastEthLink = ethLink; }
                if (gwMac != "" && gwMac != lastGwMac && !fixBusy)   // a router check swaps the entry on purpose
                {
                    // same gateway IP, a real MAC other than the trusted one: someone else is answering for the router
                    string gwIp = gw == null ? "" : gw.ToString();
                    if (gwMac.Length == 17 && gwIp != trustedGwIp) { trustedGwMac = gwMac; trustedGwIp = gwIp; }
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
                if (gwArp != "" && gwArp != lastGwArp && !fixBusy)
                {
                    Event(string.Format("gateway ARP entry for {0}: {1} -> {2}{3}", gw, lastGwArp == "" ? "?" : lastGwArp, gwArp,
                        gwArp == "static" ? " (pinned to " + gwMac + ", spoofed ARP replies are ignored)" : ""));
                    if (gwArp == "static" && gwMac.Length == 17 && gw != null) { trustedGwMac = gwMac; trustedGwIp = gw.ToString(); }   // the pin is the truth
                    lastGwArp = gwArp;
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
                        udpMs.ToString(), udpMap, txDelta.ToString(), rxDelta.ToString(), udpTotal.ToString(), Csv(udpTop), pubIp, failStr }));
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

    // Runs tools/arpwatch.ps1 (needs admin for pktmon): a 10 s ARP-only capture on the NICs. Returns
    // every MAC that claimed the gateway IP, with how often.
    static Dictionary<string, int> ArpCapture(IPAddress gw)
    {
        var claims = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        string script = Path.Combine(baseDir, "tools", "arpwatch.ps1");
        if (!File.Exists(script)) return claims;
        var psi = new ProcessStartInfo("powershell.exe",
            string.Format("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{0}\" -Gw {1} -Work \"{2}\"", script, gw, Path.Combine(logDir, "arpwatch")))
        { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true };
        string output;
        using (var p = Process.Start(psi))
        {
            try { p.PriorityClass = ProcessPriorityClass.BelowNormal; } catch { }
            output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(60000);
        }
        foreach (var line in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = line.Trim().Split(' ');
            int n;
            if (parts.Length != 2 || parts[0].Length != 17 || !int.TryParse(parts[1], out n)) continue;
            string mac = parts[0].ToUpperInvariant();
            claims[mac] = (claims.ContainsKey(mac) ? claims[mac] : 0) + n;
        }
        return claims;
    }

    // Every 5 min in the background: any MAC other than the trusted gateway MAC claiming the gateway IP
    // is logged as ARP spoofing. Skipped while a snapshot or a router check may be using pktmon.
    static void ArpWatchStart(IPAddress gw, string expectMac)
    {
        if (arpWatchRunning || fixBusy || (DateTime.Now - lastSnapshot).TotalSeconds < 90) return;
        arpWatchRunning = true;
        Task.Run(() =>
        {
            try
            {
                var rogue = new List<string>();
                int good = 0;
                foreach (var kv in ArpCapture(gw))
                {
                    if (string.Equals(kv.Key, expectMac, StringComparison.OrdinalIgnoreCase)) good += kv.Value;
                    else rogue.Add(kv.Key + " x" + kv.Value);
                }
                if (rogue.Count > 0)
                {
                    arpWatch = string.Format("spoofing seen {0:HH:mm}: {1}", DateTime.Now, string.Join(", ", rogue));
                    SetGwAlert(string.Format("ARP spoofing seen at {0:HH:mm:ss}: {1} claimed to be gateway {2}", DateTime.Now, string.Join(", ", rogue), gw));
                    Event(string.Format("ARP SPOOFING DETECTED: gateway {0} claimed by {1} in a 10 s capture (trusted {2}: {3} claims, ARP entry {4})",
                        gw, string.Join(", ", rogue), expectMac, good, gwArp));
                    Snapshot("arp_spoof");
                    autoKick = true;
                }
                else arpWatch = string.Format("clean at {0:HH:mm}", DateTime.Now);
            }
            catch (Exception ex) { arpWatch = "error: " + ex.Message; }
            finally { arpWatchRunning = false; }
        });
    }

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

    static void Snapshot(string reason)
    {
        if (fixBusy || (DateTime.Now - lastSnapshot).TotalSeconds < 60) return;   // a router check breaks the link on purpose
        lastSnapshot = DateTime.Now;
        string script = Path.Combine(baseDir, "tools", "snapshot.ps1");
        if (!File.Exists(script)) return;
        string outFile = Path.Combine(snapDir, DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss") + "_" + reason + ".txt");
        try
        {
            var psi = new ProcessStartInfo("powershell.exe",
                string.Format("-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{0}\" -Out \"{1}\"", script, outFile))
            { CreateNoWindow = true, UseShellExecute = false };
            using (var p = Process.Start(psi)) { p.PriorityClass = ProcessPriorityClass.BelowNormal; }
        }
        catch (Exception ex) { Event("snapshot failed: " + ex.Message); }
        EnforceSizeCap();
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
    static void StunLoop()
    {
        while (true)
        {
            var sw = Stopwatch.StartNew();
            string m;
            int ms = StunProbe(out m);
            udpMs = ms;
            if (ms >= 0) udpMap = m;
            int sleep = 2000 - (int)sw.ElapsedMilliseconds;
            if (sleep > 0) Thread.Sleep(sleep);
        }
    }

    // Returns RTT in ms (or -1) and "<server tag>=<public ip:port>" as seen by that server.
    static int StunProbe(out string mapped)
    {
        mapped = "";
        foreach (var server in StunServers)
        {
            try
            {
                if (stunSock == null) { stunSock = new UdpClient(0); stunSock.Client.ReceiveTimeout = 1500; }
                var parts = server.Split(':');
                IPAddress ip;
                // resolve once and cache, so a DNS outage isn't mistaken for a UDP path outage
                if (!stunIps.TryGetValue(server, out ip))
                {
                    ip = Dns.GetHostAddresses(parts[0]).First(a => a.AddressFamily == AddressFamily.InterNetwork);
                    stunIps[server] = ip;
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
    // returns only newer samples), /api/events new events.log lines (?from=<byte offset>, or the
    // last 64 KB when omitted). /api/fix* is the router check and pin (see FixApi). One request at a
    // time on its own thread; the page polls only while it is visible. The "+" prefix (all
    // interfaces) needs admin, which netbug always has; a lone (portable) netbug listens on localhost only.
    static void DashboardLoop()
    {
        var listener = new HttpListener();
        try
        {
            if (portable)
            {
                listener.Prefixes.Add("http://localhost:" + DashPort + "/");
                listener.Prefixes.Add("http://127.0.0.1:" + DashPort + "/");
            }
            else listener.Prefixes.Add("http://+:" + DashPort + "/");
            listener.Start();
            Event("dashboard listening on port " + DashPort + (portable ? " (this laptop only)" : ""));
        }
        catch (Exception ex) { Event("dashboard failed to start: " + ex.Message); return; }
        while (listener.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); }
            catch { Thread.Sleep(1000); continue; }
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
            body = string.Format("{{\"now\":{0},\"started\":{1},\"memMb\":{2:F1},\"port\":{3},\"sample\":{4},\"hist\":[{5}]}}",
                Unix(DateTime.Now), Unix(started), dashMemMb, DashPort, sampleJson, string.Join(",", rows));
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

    // ---------------------------------------------------------------- router check and pin
    //
    // Check: finds the real router MAC for the current gateway IP. Candidates are the ARP table entry, a
    // pinned entry and every MAC that answers for the gateway IP in a 10 s capture (the laptop asks for
    // the router 3 times during it, unless the entry is pinned, so the real router answers too). Each
    // candidate is then set for a moment as a temporary static ARP entry (active store only) and tested:
    // it is the real router when pings to 1.1.1.1/8.8.8.8 get through it AND a TTL-1 ping comes back
    // "TTL expired" from the gateway IP itself. A blackholing impostor passes nothing; a device in the
    // middle that forwards traffic answers the TTL-1 ping with its own IP. The entry is then put back as
    // it was (pinned again, or deleted and learned again).
    // Pin: the verified MAC becomes a permanent ARP entry (netsh, persistent store), so Windows ignores
    // fake replies. Unpin removes it from both stores.
    // Control: GET /api/fix (status) and POST /api/fix/{check,pin,unpin,auto,stop}, only from this laptop
    // (loopback, Host localhost/127.0.0.1, against DNS rebinding) with the per-run token the page was
    // served (X-Netbug-Token: other websites can't read it, and the custom header can't be sent cross-site
    // without a CORS preflight, which netbug never answers).

    class Candidate { public string Mac, From = "", Hop = "", Verdict = ""; public bool Works, Random; }

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
            case "/api/fix/unpin": error = Unpin(); break;
            case "/api/fix/auto":
                autoDetect = ctx.Request.QueryString["on"] == "1";
                SaveSettings();
                Event("router auto-detect " + (autoDetect ? "on" : "off"));
                if (autoDetect && !fixBusy) StartDetect("auto");
                break;
            case "/api/fix/stop":
                if (!portable) { error = "This netbug runs as a scheduled task; stop it there."; break; }
                Event("netbug stopped from the page");
                Task.Run(() => { Thread.Sleep(500); Environment.Exit(0); });
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
        return string.Format("{{\"busy\":{0},\"step\":{1},\"auto\":{2},\"portable\":{3},\"iface\":{4},\"gw\":{5},\"arpMac\":{6},\"arpType\":{7},\"pinned\":{8},\"verified\":{9},\"result\":{10},\"error\":{11}}}",
            fixBusy ? "true" : "false", J(fixStep), autoDetect ? "true" : "false", portable ? "true" : "false", J(iface), J(gw == null ? "" : gw.ToString()),
            J(gwMac), J(gwArp), J(pinned), J(verifiedHere ? verifiedMac : ""), fixJson, J(error));
    }

    static int IfIndex(NetworkInterface ni)
    {
        try { return ni == null ? -1 : ni.GetIPProperties().GetIPv4Properties().Index; } catch { return -1; }
    }

    static string Netsh(string args)
    {
        var psi = new ProcessStartInfo("netsh.exe", args) { CreateNoWindow = true, UseShellExecute = false, RedirectStandardOutput = true };
        using (var p = Process.Start(psi))
        {
            string output = p.StandardOutput.ReadToEnd();
            p.WaitForExit(15000);
            return output;
        }
    }

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
        Netsh(string.Format("interface ipv4 delete neighbors interface={0} address={1} store=active", ifIndex, gw));
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

    static void StartDetect(string why)
    {
        lock (fixLock) { if (fixBusy) return; fixBusy = true; }
        lastDetect = DateTime.Now; autoKick = false;
        Task.Run(() => Detect(why));
    }

    static void Detect(string why)
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
            string arpType = ArpEntryType(gw, ni), pinned = PersistentPin(idx, gw);
            add(Arp(gw, ip), "ARP table (" + (arpType == "" ? "?" : arpType) + ")");
            add(pinned, "pinned");

            fixStep = "Listening for who answers as the router (10 s)";
            for (int i = 0; i < 40 && arpWatchRunning; i++) Thread.Sleep(500);
            arpWatchRunning = true;
            Dictionary<string, int> claims;
            try
            {
                var capture = Task.Run(() => ArpCapture(gw));
                Thread.Sleep(2500);
                // ask for the router again so the real one answers too (a pinned entry is never asked about)
                if (arpType != "static")
                    for (int i = 0; i < 3; i++) { SetActive(idx, gw, ""); Arp(gw, ip); Thread.Sleep(1500); }
                claims = capture.Result;
            }
            finally { arpWatchRunning = false; }
            foreach (var kv in claims) add(kv.Key, string.Format("answered as the router {0}x", kv.Value));

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

            string gwIp = gw.ToString();
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
            lock (fixLock)
            {
                verifiedMac = real.Count == 1 ? real[0].Mac : "";
                verifiedGw = gwIp; verifiedIf = idx;
            }
            fixJson = string.Format("{{\"at\":{0},\"chosen\":{1},\"note\":{2},\"cands\":[{3}]}}", Unix(DateTime.Now), J(verifiedMac), J(note),
                string.Join(",", cands.Select(c => string.Format("{{\"mac\":{0},\"from\":{1},\"works\":{2},\"hop\":{3},\"random\":{4},\"verdict\":{5}}}",
                    J(c.Mac), J(c.From), c.Works ? "true" : "false", J(c.Hop), c.Random ? "true" : "false", J(c.Verdict)))));
            Event(string.Format("router check: {0} ({1})", verifiedMac != "" ? "real router is " + verifiedMac : "no MAC picked",
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
        Netsh(string.Format("interface ipv4 delete neighbors interface={0} address={1}", idx, gw));
        string output = Netsh(string.Format("interface ipv4 add neighbors interface={0} address={1} neighbor={2} store=persistent", idx, gw, mac));
        lock (pinLock) pinCacheAt = DateTime.MinValue;
        if (PersistentPin(idx, gw) != mac) return "Pinning failed: " + output.Trim();
        Event(string.Format("gateway {0} pinned to {1} on '{2}' from the page", gw, mac, ni.Name));
        return "";
    }

    static string Unpin()
    {
        NetworkInterface ni = curNi; IPAddress gw = curGw;
        int idx = IfIndex(ni);
        if (gw == null || idx < 0) return "No network with a router right now.";
        if (fixBusy) return "Wait for the check to finish.";
        Netsh(string.Format("interface ipv4 delete neighbors interface={0} address={1}", idx, gw));
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

    static readonly object eventLock = new object();
    static void Event(string msg)
    {
        lock (eventLock)   // called from the main loop and the persistent TCP thread
            File.AppendAllText(Path.Combine(logDir, "events.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + msg + "\r\n");
    }
}
