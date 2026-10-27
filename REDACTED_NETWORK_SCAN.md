# Network Scan — xxx (Win 11)

Scan date: 2026-10-28, ~02:35–03:10 MYT. Machine had rebooted at 02:32.
Location: hostel room, wired via room wall port. Kuala Lumpur, Malaysia.

---

## TL;DR — key findings

| # | Finding | Severity |
|---|---------|----------|
| 1 | **Not double CGNAT.** Only one NAT layer (hostel MikroTik). The public IP `xxx` is a real TM public IP shared by the whole hostel. | Info |
| 2 | **Hostel router blocks all third-party DNS**: UDP/TCP 53, DoT 853, and even TCP 443/80 to `1.1.1.1`, `8.8.8.8`, `9.9.9.9`, `cloudflare-dns.com`, `dns.google`. Only the router's own resolver (`10.255.31.254`) works. | High (explains random "no internet" / DNS timeouts) |
| 3 | **DNS timeouts observed**: event 1014 at 02:56 ("none of the configured DNS servers responded"). During one test burst every hostname lookup failed for ~20 s, then recovered. | High |
| 4 | ~~Upload capped~~. **Correction:** Ookla multi-stream gets **940 down / 900 up** (Uni5G Kepong, 1 ms), so the line is really 1 Gbps. Single-stream curl only reached ~450–600 / 50–100. Both Ookla and fast.com sit at 0 for ~30 s before starting, which points to slow setup of the first connection. | Info |
| 5 | **Ethernet goes through a USB dongle/dock** (Realtek RTL8153B, Ugreen) behind a chain of USB hubs. The driver is from **2018**, and USB power saving is enabled. | Medium (possible drop/stall source) |
| 6 | **Windows Firewall is OFF for the Private profile**, and the hostel LAN is marked *Private*. MySQL (3306/33060), SMB (445), RPC and spacedesk (28252) are open to every device on the hostel LAN. | **High (security)** |
| 7 | Tcpip event 4266: **UDP ephemeral ports exhausted** 20+ times since 2026-09-24, every 1–4 days. That matches the frequency of the Discord/Valorant outages. | **High** |
| 8 | Path MTU = **1492** (TM Unifi PPPoE). The router handles PMTUD correctly. | Info |

---

## 1. System

| Field | Value |
|---|---|
| Hostname | `xxx` |
| OS | Windows 11 Pro, 10.0.26200 (build 26200) |
| Power plan | Balanced |

## 2. ISP / public identity

| Field | Value |
|---|---|
| Public IPv4 | `xxx` |
| Public IPv6 | none (no IPv6 connectivity) |
| ISP | TM Technology Services Sdn Bhd (TM **Unifi Home**) |
| ASN | AS4788 (TTSSB-MY) |
| Geo (ipinfo) | Kuala Lumpur, MY, xxx — `xxx` |
| Geo (ip-api) | xxx, MY |
| Flags | not mobile, not proxy, not hosting |
| Upstream resolver (seen by Google) | `2001:e68::b:89` (TM DNS). The router forwards to TM. |

### NAT layers (from traceroute)

```
PC 10.255.19.148
 └─ hop1  10.255.31.254   hostel MikroTik (NAT #1, DHCP, DNS)    <1 ms
     └─ hop2  xxx   TM BRAS / PPPoE gateway (public)   ~1 ms
         └─ hop3+ 10.55.x.x   TM internal core (not NAT, just private-addressed transit)
             └─ 210.57.x.x    TM backbone → peering
```

Hop 2 is already public and sits in the same block as our public IP. **So there is only one NAT.** The `10.55.x.x` hops are TM core routers with private addresses. They are not a CGNAT.

## 3. Local network

| Field | Value |
|---|---|
| Active adapter | `Ethernet 7` — Realtek USB GbE Family Controller #3 |
| MAC | `xx-xx-xx-xx-xx-xx` (OUI: Ugreen Group Limited) |
| IPv4 | `10.255.19.148/20` (255.255.240.0) — DHCP |
| Subnet | `10.255.16.0 – 10.255.31.255` (~4094 hosts, one flat L2 segment) |
| Gateway / DHCP / DNS | `10.255.31.254` |
| Gateway MAC | `xx-xx-xx-xx-xx-xx` (OUI: **Routerboard.com = MikroTik**) |
| Gateway open TCP ports | 53 only (21/22/23/80/443/8080/8291/8728/2000 closed) |
| DHCP lease | 8 h (02:32 → 10:32) |
| IPv6 | link-local only `xxx%16`, no RA, no global v6 |
| Link | 1 Gbps full duplex, MTU 1500 |
| Network profile | name `xxx`, category **Private** |
| Proxy | none (WinHTTP direct, no IE proxy/PAC) |
| Error counters | 0 rx/tx errors, 0 discards (since boot) |

Wi-Fi DNS (last network): `192.168.50.1`.

## 4. Performance tests

| Test | Result |
|---|---|
| Ping gateway (20x) | 0 ms, 0% loss. One later burst showed 75% loss, likely ICMP rate-limit. |
| Ping 1.1.1.1 | 7–8 ms, 0% loss |
| Ping 8.8.8.8 | 1–2 ms, 0% loss (Google KL edge) |
| 90 s monitor (169 samples: gw + 1.1.1.1 + DNS) | 0 loss, no DNS > 1 s |
| Router DNS | 2–4 ms cached, ~200 ms uncached |
| Download (Cloudflare 25 MB x3) | 458 / 564 / 449 Mbps |
| Download (Hetzner SG 100 MB) | **606 Mbps** |
| Upload (Cloudflare, 3 runs) | **50 / 103 / 66 Mbps** |
| Path MTU | 1492 (1464 B ICMP payload OK, 1472 rejected by gw) |

Note: these are single-stream curl tests. Multi-stream tests could push download higher. The upload cap is still clear.

## 5. Firewalling done by the hostel network

| Target | Result |
|---|---|
| `8.8.8.8`, `1.1.1.1`, `9.9.9.9` UDP 53 | timeout |
| same, TCP 53 | blocked |
| same, TCP 853 (DoT) | blocked |
| `1.1.1.1:443`, `8.8.8.8:443`, `9.9.9.9:443`, `1.1.1.1:80` | blocked |
| `cloudflare-dns.com` (104.16.248.249:443), `dns.google:443` | blocked (21 s timeout) |
| `github.com:443`, `google.com`, `speed.cloudflare.com` | OK |
| ICMP to those DNS IPs | allowed |

So the MikroTik forces all DNS through itself. The Windows DoH config (Quad9/Google/Cloudflare templates) is useless here. When the router's resolver hiccups, **everything** looks offline even though the link is up.

## 6. Hardware & drivers

### Active wired NIC (USB)

| Field | Value |
|---|---|
| Chip | Realtek **RTL8153B** (USB\VID_0BDA&PID_8153&REV_31FD) |
| Bus desc | "USB 10/100/1000 LAN" |
| Vendor | Ugreen (by MAC OUI) |
| Driver | `rtucx22x64` **11.19.20.602 (2018-03-30)**, `oem131.inf` |
| Also in driver store | 11.15.327.2024 (2016), 10.19.705.2017, and 1030.52.731.2025 (2025, Realtek Net) |
| USB path | Intel USB 3.20 xHCI → Root hub → **VIA hub 2109:0817** → **Genesys GL3523 hub 05E3:0625** → RTL8153 (port 3) |
| Other filter drivers in stack | **USBPcap** |
| Previous instance | "Controller #2" (serial xxx), now absent. This is the second dongle/port seen. |

Power settings (Ethernet 7):

| Setting | Value |
|---|---|
| Allow computer to turn off device | **Enabled** |
| Selective suspend | **Enabled** |
| USB selective suspend (power plan) | AC: Disabled / **DC (battery): Enabled** |
| Wake on Magic / Pattern / Link change | Enabled |
| EEE / Green Ethernet / Advanced EEE / Idle power saving | Disabled |
| Flow control | Rx & Tx Enabled |
| LSO v2, RSC, checksum offloads | Enabled |
| Jumbo frame | Disabled |
| Rx / Tx URBs | 6 / 3 |
| Rx / Tx buffers | 16 / 18 |

### Wi-Fi

| Field | Value |
|---|---|
| Card | Intel Wi-Fi 6E **AX211** 160 MHz (PCI 8086:51F1) |
| MAC | `xx-xx-xx-xx-xx-xx` |
| Driver | Netwtw14 **24.50.0.4 (2026-05-20)** |
| Status | Disconnected (wired in use) |
| Supports | 802.11ax, 2.4/5/6 GHz, WPA3, OWE |

### Other adapters

| Name | Desc | MAC | Status | Driver |
|---|---|---|---|---|
| Ethernet 3 | VirtualBox Host-Only | `xx-xx-xx-xx-xx-xx` | Up, `169.254.148.116` (APIPA) | Oracle 7.2.22 |
| Local Area Connection | ExpressVPN TUN | — | Disconnected | 0.8.0.0 |
| Local Area Connection 2 | ExpressVPN TAP | `xx-xx-xx-xx-xx-xx` | Disconnected | 9.27.0.0 |
| Local Area Connection 3 | OpenVPN DCO (ExpressVPN) | — | Disconnected | 1.4.0.0 |
| Bluetooth Network Connection | BT PAN | `xx-xx-xx-xx-xx-xx` | Disconnected | MS |
| Local Area Connection* 9 / 10 | Wi-Fi Direct virtual | `xx-xx-xx-xx-xx-xx` / `xx-xx-xx-xx-xx-xx` | Disconnected | MS |
| Ethernet (Kernel Debugger), Teredo, 6to4, IP-HTTPS | — | — | Not present | — |

### Bindings on Ethernet 7

Enabled: TCP/IPv4, TCP/IPv6, LLDP, Client for MS Networks, **VMware Bridge**, **Npcap**, File & Printer Sharing, LLTD mapper/responder, MS Bridge, **VirtualBox NDIS6 Bridge**, Nested Network Virtualization, QoS Packet Scheduler.
Disabled: ExpressVPN packet filter, Hyper-V vSwitch, Multiplexor.

## 7. Host settings

### TCP global

RSS on · autotuning normal · congestion provider default · ECN off · RFC1323 timestamps allowed · initial RTO 1000 · RSC on · TCP Fast Open on · HyStart on · PRR on · pacing off.

### DNS client

- Interface DNS: `10.255.31.254`
- DoH templates registered: Quad9, Google, Cloudflare (v4+v6). These are **unreachable on this network**.
- NRPT: none
- Hosts file: about 60 fake-FitGirl domains sinkholed to `109.94.209.70`, `aki-game.net` telemetry → `0.0.0.0`, `checkhost.local` → 127.0.0.1, `gw.grp.lab` → `10.250.41.178`.

### Windows Firewall

| Profile | Enabled |
|---|---|
| Domain | **Off** |
| Private | **Off** ← active on hostel LAN |
| Public | On |

### Listening services (reachable from LAN because firewall is off)

| Port | Proc | Bind |
|---|---|---|
| 135 | RPC (svchost) | all |
| 139 / 137 / 138 | NetBIOS | 10.255.19.148 |
| 445 | SMB | all (v6 any) |
| **3306, 33060** | **mysqld** | all |
| 5040 | svchost (CDP) | all |
| 5357 | WSD | all |
| **28252 TCP+UDP** | **spacedeskService** | all |
| 49664–49685 | RPC dynamic (lsass, wininit, spoolsv, services…) | all |
| 57621 | Spotify | all |
| 1900, 5353, 5355, 3702 | SSDP/mDNS/LLMNR/WSD | all |
| 6463, 7768, 26822, 32683, 33683 | Discord PTB, Spotify, MSI Center | localhost only |

## 8. Event log (last 7 days)

- `DNS-Client 1014` x4: name resolution timed out, no DNS server responded (latest 2026-10-28 02:56).
- `Tcpip 4266` x2: **UDP ephemeral port space exhausted**.
- `Netwtw14 8000`: Wi-Fi miniport halt (x1).
- Many network flaps on 2026-10-26 19:41–20:25. Connected/disconnected cycling between `xxx`, `xxx`, `xxx`, `xxx`. The Wi-Fi and wired networks were hopping every few minutes.

## 9. Saved Wi-Fi profiles

xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx, xxx.

---

## 10. Suspects for the 2-year problem (to confirm)

1. **Router DNS is a single point of failure.** All other DNS is blocked, so any resolver stall on the MikroTik looks like "internet down".
2. **Upload throttled** to ~50–100 Mbps per user.
3. **USB NIC chain**: a 2018 driver, selective suspend enabled, and two USB hubs. RTL8153 on old drivers is known to stall or drop silently.
4. **One big flat /20 with ~4k possible clients.** Broadcast/ARP noise and no client isolation. Everyone can reach everyone, which matters given finding #6.

## 10b. Outage history (from Discord PTB logs + Windows events)

| When | Discord evidence | Windows evidence |
|---|---|---|
| 10-19 21:26–21:37 | voice heartbeat missed, gateway WS closed x3, voice WS 1006 | user rebooted 21:21; DNS 1014 on msftconnecttest |
| 10-20 16:49–17:11 | gateway WS closed ~15x in 20 min | nothing network-related; Cloudflare WARP disconnect 17:11 |
| **10-24 03:13** | **voice heartbeat ACK took 13.7 s → reconnect code 4800 (heartbeat timeout)** | **nothing at all**: no link change, no DHCP, no NIC event |
| 10-26 19:44–20:21 | gateway WS closed ~12x, voice WS 1006 | user rebooted 20:23; DNS 1014 on msftconnecttest |
| 10-28 04:03:58–04:04:31 | (caught by netmon) | **LAN lag**: gateway RTT 0 → 10–65 ms with loss. Gateway, 1.1.1.1 and 8.8.8.8 often had *identical* RTTs (30/30/30, 65/65/65), so the delay sits on the local segment (hostel LAN or laptop/dongle), not upstream. Own traffic was low. |
| 10-28 04:13:25–04:13:32 | Claude Code "API Error: Connection lost mid-response" (other session) | netmon saw nothing: gw 0 ms, cf 8 ms, DNS 11 ms, no loss. Either one connection was killed or it was API-side. The persistent-TCP probe was added to catch this class. |

- Gateway WebSocket also dies (code 1006) several times a day outside these windows.
- **UDP exhaustion (4266) times do not match any of these outages.** It's a separate background leak, not the cause.
- 10-24 shows traffic silently black-holed for 14+ s while Windows saw the link as perfectly fine. That points at the path beyond the laptop (hostel switch/MikroTik) or a NIC TX stall. The netmon logger is set up to tell these apart.

## 11. Changes applied (2026-10-28, user-approved)

- Ethernet 7: "Allow computer to turn off this device" → **Disabled**.
- Power plan USB selective suspend → **Disabled** on AC and DC. The 2018 driver has no per-adapter selective-suspend keyword, so the power plan setting is what covers it.
- Logger `tools/netmon.exe` (C#, ~35 MB RAM, ~1% of one core, BelowNormal priority) runs as the scheduled task `netbug-netmon` at logon with highest privileges. It writes `logs/netmon-<date>.csv`, `logs/events.log` and `logs/snapshots/`, and keeps 30 days.
  - Since 04:17 it also logs `LAG` events (gateway ≥ 15 ms, or gateway + internet loss) and keeps a long-lived TLS connection to www.google.com (HEAD every 15 s). When that connection dies it logs FIN, RST or timeout.
  - Snapshot pings now use `ping.exe`. The first snapshot (03:57) showed false 0/3 results because `Test-Connection -TimeoutSeconds` is PS7-only.

## 12. Recommended next actions (not applied)

- **Turn the Private firewall back on**, or set the hostel network to *Public*. Bind MySQL to `127.0.0.1`.
- Update the RTL8153 driver to the current Realtek/Microsoft release. Disable "Allow computer to turn off this device" and selective suspend.
- Plug the dongle straight into a laptop USB-C/USB 3 port to rule out the hubs.
- Run a long-term monitor (gw ping + router DNS + external HTTPS) to timestamp the drops.
