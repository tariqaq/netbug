// netbug - lightweight always-on network health logger.
//
// Probes every second (gateway ping, 1.1.1.1 + 8.8.8.8 ping), DNS via the
// gateway every 2 s, a TCP connect + UDP port usage + gateway MAC every 10 s,
// and the public IP every 5 min. Writes a CSV row every 5 s while healthy and
// every 1 s during (and 60 s after) any failure. Outage start/end, link,
// interface, gateway MAC, public IP and UDP-usage changes go to an events log,
// and every outage start triggers snapshot.ps1 for a detailed dump.
//
// Build: csc /target:winexe /optimize /out:netbug.exe netbug.cs

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

class NetMon
{
    [DllImport("iphlpapi.dll")]
    static extern int GetExtendedUdpTable(IntPtr table, ref int size, bool sort, int af, int tableClass, int reserved);

    [DllImport("iphlpapi.dll")]
    static extern int SendARP(int destIp, int srcIp, byte[] mac, ref int macLen);

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

    static void Main()
    {
        using (var self = Process.GetCurrentProcess()) self.PriorityClass = ProcessPriorityClass.BelowNormal;
        ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;   // TLS 1.2; .NET 4.0 defaults to TLS 1.0

        baseDir = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, ".."));
        logDir = Path.Combine(baseDir, "logs");
        snapDir = Path.Combine(logDir, "snapshots");
        Directory.CreateDirectory(snapDir);

        bool created;
        using (new Mutex(true, "Global\\netbug", out created))
        {
            if (!created) return;   // already running
            Event("netbug started");
            new Thread(PersistentTcpLoop) { IsBackground = true, Priority = ThreadPriority.BelowNormal }.Start();
            Run();
        }
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

                // pings in parallel
                var pGw = gw != null ? PingAsync(gw) : Task.FromResult(-1L);
                var pCf = PingAsync(IPAddress.Parse("1.1.1.1"));
                var pG = PingAsync(IPAddress.Parse("8.8.8.8"));
                Task.WaitAll(pGw, pCf, pG);
                long gwMs = pGw.Result, cfMs = pCf.Result, gMs = pG.Result;

                if (tick % 2 == 0) dnsMs = gw != null ? DnsProbe(gw) : -1;
                if (tcpMs < 0 && tick % 10 != 0) tcpMs = TcpProbe();   // re-check a failed probe every second
                if (tick % 10 == 0)
                {
                    tcpMs = TcpProbe();
                    UdpUsage(out udpTotal, out udpTop);
                    gwMac = gw != null && ip != null ? Arp(gw, ip) : "";
                }
                if (tick % 300 == 5) RefreshPublicIp();

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
                if (tcpMs < 0) fails.Add("tcp");
                if (udpTotal >= UdpWarnThreshold) fails.Add("udp_high");
                string failStr = string.Join("|", fails);

                // ---- transitions ----
                if (ifaceName != lastIface) { Event(string.Format("active interface: '{0}' -> '{1}' ip={2} gw={3}", lastIface, ifaceName, ip, gw)); lastIface = ifaceName; lastTx = -1; }
                if (ethLink != lastEthLink) { Event(string.Format("USB ethernet link: {0} -> {1}", lastEthLink == "" ? "?" : lastEthLink, ethLink)); lastEthLink = ethLink; }
                if (gwMac != "" && gwMac != lastGwMac) { Event(string.Format("gateway MAC: {0} -> {1}", lastGwMac == "" ? "?" : lastGwMac, gwMac)); lastGwMac = gwMac; }
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

                // gw-only ICMP loss is not an outage (the MikroTik rate-limits ICMP); require 2 bad seconds in a row
                var realFails = fails.Where(f => f != "udp_high" && f != "gw" && f != "lag").ToList();
                failStreak = realFails.Count > 0 ? failStreak + 1 : 0;
                if (fails.Count > 0) fastUntil = DateTime.Now.AddSeconds(60);
                if (failStreak >= 2)
                {
                    if (!inOutage)
                    {
                        inOutage = true; outageStart = DateTime.Now; outageWhat = failStr;
                        Event(string.Format("OUTAGE START [{0}] iface='{1}' gw_ms={2} cf_ms={3} g_ms={4} dns_ms={5} tcp_ms={6} tx/rx pkts last s={7}/{8} gw_mac={9}",
                            failStr, ifaceName, gwMs, cfMs, gMs, dnsMs, tcpMs, txDelta, rxDelta, gwMac));
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
                        DateTime.Now.ToString("HH:mm:ss"), Csv(ifaceName), ethLink, ip == null ? "" : ip.ToString(), gw == null ? "" : gw.ToString(), gwMac,
                        gwMs.ToString(), cfMs.ToString(), gMs.ToString(), dnsMs.ToString(), tcpMs.ToString(),
                        txDelta.ToString(), rxDelta.ToString(), udpTotal.ToString(), Csv(udpTop), pubIp, failStr }));
                    lastRow = DateTime.Now;
                }
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
                foreach (var label in new[] { "nm" + rng.Next(100000000), "example", "com" })
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
            // google closes idle/old keep-alive connections itself; only clean closes after
            // a long life are expected, everything else is worth a line
            // collapse repeated reconnect failures (e.g. every 5 s while the cable is out) into one line
            if (requests == 0 && reason == lastTcpReason) tcpRepeats++;
            else
            {
                if (tcpRepeats > 0) Event(string.Format("persistent TCP: previous failure repeated {0} more times", tcpRepeats));
                tcpRepeats = 0;
                if (!(reason.StartsWith("server") && life > 200))
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
        if ((DateTime.Now - lastSnapshot).TotalSeconds < 60) return;
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
    }

    static void RotateIfNewDay()
    {
        string day = DateTime.Now.ToString("yyyy-MM-dd");
        if (day == currentDay) return;
        currentDay = day;
        string csv = CsvPath();
        if (!File.Exists(csv))
            File.WriteAllText(csv, "time,iface,eth_link,ip,gw,gw_mac,gw_ms,cf_ms,g_ms,dns_ms,tcp_ms,tx_pkts,rx_pkts,udp_total,udp_top,public_ip,fail\r\n");
        foreach (var f in Directory.GetFiles(logDir).Concat(Directory.GetFiles(snapDir)))
            if (File.GetLastWriteTime(f) < DateTime.Now.AddDays(-RetentionDays)) { try { File.Delete(f); } catch { } }
    }

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
