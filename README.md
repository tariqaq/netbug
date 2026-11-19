# netbug

An always-on Windows tool that logs network drops the second they happen, shows where the problem is, and protects the laptop against **ARP spoofing** on a shared LAN.

It was built for a hostel connection that kept dying every few days. The cause turned out to be another device on the LAN pretending to be the router (2026-10-28, 05:34 and 15:28). Details: [incident report](REDACTED_INCIDENT_2026-10-28_ARP_SPOOFING.md), [report for the hostel](REDACTED_RCC_REPORT.md), [explainer video](video/incident-v4-redacted.mp4).

## Install

1. Download `netbug.exe` from [Releases](https://github.com/tariqaq/netbug/releases/latest).
2. Double-click it and accept the admin prompt. It isn't code-signed: if SmartScreen says "Windows protected your PC", click **More info**, then **Run anyway**.
3. The dashboard opens at **http://localhost:8787/**. Pin the router (see [Router protection](#router-protection)).

netbug installs itself to `C:\ProgramData\netbug`, starts at every logon, and restarts by itself if it crashes. It needs Windows 10 2004+ or Windows 11.

## The dashboard

| Part | What it tells you |
|---|---|
| Headline | **Network is healthy**, **Local network is lagging** (orange), **Cloudflare route is degraded** (orange), **Connection is down** (red), **Possible ARP spoofing** (red, for 30 min after an alert), or **netbug isn't answering** |
| Chart | Last 5 minutes of gateway, Cloudflare and UDP times. Red bands are outages, orange bands are lag or a slow Cloudflare route. |
| Readings | Interface and Wi-Fi network, VPN, IPs, router MAC and whether it's pinned, packets, UDP ports |
| Event log | Everything netbug noticed. Red = outages, attacks and netbug errors; orange = lag. |
| Router protection | Pin the real router (laptop only) |
| Logs and updates | Version, updates, export of all logs (laptop only) |

What the states mean:

- **Outage**: no internet for 2 seconds or more (both test pings, DNS, TCP or UDP failing). netbug saves a snapshot of the network state.
- **Lag**: the router itself answers slowly (15 ms+) or drops pings along with the internet.
- **Cloudflare route degraded**: 1.1.1.1 is losing pings or running twice as slow as usual while Google is fine. Discord, Claude and other sites behind Cloudflare suffer, everything else works. It's your ISP's route to Cloudflare, not your network.
- **VPN shown in red**: a VPN carries your traffic, so the internet readings measure the VPN, not your ISP.
- **"Windows network name, SSID hidden"** next to Wi-Fi: Windows 11 24H2+ hides the Wi-Fi name from apps without location access, so netbug shows the name Windows gave the network instead. Usually the same, but it can be renamed or end in " 2".

Other devices on the network can open the page at `http://<laptop-ip>:8787/` (read-only) only after you allow inbound TCP 8787 in Windows Firewall. They'd see your public IP, router MAC and process names.

## Router protection

The attack: another device tells your laptop "I'm the router" and swallows your traffic. The fix is to pin the real router's address so Windows ignores fake claims.

1. If **Router MAC** lists a router, click **Test and pin**. It pins only if the test proves it's the real router.
2. Otherwise click **Check now**. The connection drops for a few seconds while it tests each candidate. When it finds the real router, turn on **Pin it permanently**.
3. Leave **Keep the router updated** on. The pin protects only your laptop; this also corrects the router about once a second if someone lies to it about you.

The dropdown only lists a built-in router when it's actually on your current network, plus whatever you've pinned and the last check's result.

Moving the adapter to a different network that uses the same router IP? Turn the pin off first.

If the router is replaced, the pin goes stale and the internet stops working. The outage line in the log prints the command to remove it, or turn the pin off on the page.

## Updates

netbug checks GitHub every 15 minutes and installs new releases by itself. **Install update now** under **Logs and updates** does it at once and shows a progress bar and the current step. netbug restarts for a few seconds and the page reloads.

The download must match the SHA-256 GitHub lists and be a real netbug build, or it's thrown away. The previous version is kept as `netbug.old.exe`. If an update fails, the page says why and netbug keeps running. Automatic retries wait an hour.

## Logs

Logs are in `C:\ProgramData\netbug\logs`, kept 30 days and capped at 500 MB.

| File | Contents |
|---|---|
| `events.log` | The timeline: outages, lag, Cloudflare route, router MAC changes, ARP spoofing, interface, Wi-Fi, network profile and VPN changes, public IP and NAT changes, hourly health |
| `netbug-<date>.csv` | One row every 5 s (every 1 s around problems) with every reading. `ssid` is the Wi-Fi name from Windows' Wi-Fi API (empty without location access); `net_profile` is Windows' name for the network, on any adapter |
| `snapshots\` | Per incident: full network state, a packet capture (`.etl`) and the ARP traffic from the 15 minutes before |

**Export all logs** downloads one zip of everything. It isn't redacted (MACs, IPs, network names), so only send it to someone you trust.

## Uninstall

Click **Uninstall netbug** on the page (twice), or run `netbug.exe --uninstall`. It removes the program, the startup task and the router pin. Logs stay.

## Footprint

About 1% of one CPU core at low priority, ~30–45 MB of RAM, plus ~515 MB for the `pktmon` packet capture (a fixed buffer, mostly paged out). Network use is under 1 KB/s. Disk: a few MB a day.

---

## For developers

### Build

```powershell
pwsh -File tools\build.ps1            # -> tools\netbug.exe; -Out <path> to write elsewhere
```

It uses the C# compiler that ships with Windows (.NET Framework 4.x) and embeds the page, font and scripts. Known routers go in `tools\routers.local.txt` (gitignored), one per line: `<gateway ip> <MAC> [label]`. The script embeds the file when it exists; the release exe is built with it.

A repo build (with `dashboard.html` next to it) runs from `tools\` and registers the logon task on first run if none exists. It doesn't update itself: it reports new releases. To update it:

```powershell
git pull
Stop-ScheduledTask netbug; Get-Process netbug -ErrorAction SilentlyContinue | Stop-Process -Force
pwsh -File tools\build.ps1
Start-ScheduledTask netbug
```

`tools\dashboard.html` is read from disk on every request, so page edits need no rebuild.

### How it works

- **Every second:** pings to the gateway, 1.1.1.1 and 8.8.8.8, plus packet counters. DNS (every 2 s), a TCP connect (every 10 s) and the router MAC (every 10 s) run in the background so a slow probe never delays a round.
- **Always:**
  - one TLS connection (checked every 15 s)
  - a UDP socket doing STUN every 2 s (UDP time and NAT mapping)
  - an ARP-only `pktmon` capture that flags any other device claiming the router's or the laptop's IP (`ARP SPOOFING DETECTED`)
- **Interface:** the network adapter carrying the traffic. VPN adapters are never picked, but logged when they carry the traffic.
- **Restarts:** updates and health restarts (past 200 MB, 5000 handles or 100 threads) go through the logon task.
- **Control API:** `/api/fix…` accepts requests only from the laptop itself, with the page's per-run token.

Every timestamp carries the date and UTC offset (`2026-11-04 08:01:02 +08:00`). A snapshot capture opens as text with `pktmon etl2txt <file>.etl --out <file>.txt` (admin).

### Repo layout

| Path | What |
|---|---|
| `tools/netbug.cs` | The program |
| `tools/dashboard.html` | The page |
| `tools/build.ps1` | Build script |
| `tools/snapshot.ps1` | Incident snapshot, run by netbug |
| `tools/arpwatch.ps1` | Reads a snapshot capture: who claimed the router's or the laptop's IP |
| `tools/redact.ps1` | Builds the `REDACTED_*.md` reports from gitignored originals |
| `tools/fonts/` | Inter font (SIL Open Font License) |
| `REDACTED_*.md` | Incident report, hostel report, network scan, attacker handoff |
| `video/` | The explainer video (its source is kept locally, not on GitHub) |
| `CHANGELOG.md` | Every change, newest first |
