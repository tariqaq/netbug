# Changelog

All times are the user's system time: Kuala Lumpur, MYT (UTC+08:00). Newest first.
Entries cover repo changes (with commit hash) and changes made to the machine itself.

## 2026-10-28

### 06:09: `cc48fa7` docs: missing symptoms and the 02:56 curl failure
- README "The problem":
  - frequency is about once every 4 days
  - the whole internet hangs silently (Spotify, grey loading pages, no error page)
  - the hotspot workaround, marked as uncertain
- Scan report:
  - finding #3 linked to the ARP-spoofing pattern
  - §10b: the ~02:56 incident row, the raw curl failure output with a reading, and the reported frequency
- Incident report §6: silent hang explained (a blackhole sends no error back), frequency, hotspot (uncertain), and the 02:56 curl failure as a likely earlier occurrence (not proven).

### 06:03: `d159f7b` AGENTS log-analysis checklist; Tailscale notes
- `AGENTS.md`: new **LOG ANALYSIS** section. Every analysis checks that the hostel gateway ARP pin is still `static` and tells the user first if it's gone, with the re-pin command. It also lists every `ARP SPOOFING DETECTED` / `GATEWAY MAC CHANGED` event.
- README: dashboard over Tailscale (MagicDNS), and when it survives an outage. Scan report: Tailscale section.
- **Machine (by user), 05:48:** installed Tailscale (default settings, no exit node, local network access allowed). Verified the dashboard answers on the Tailscale IP and that netbug ignores the adapter (no default route).

### 05:59: `fb2f9ab` ARP spoofing: incident report, RCC report, gateway pin, netbug detection
- **Root cause found:** at 05:34:03 a LAN device (`10.255.18.145`, randomized MAC) ARP-spoofed the gateway `10.255.31.254` and blackholed all traffic for 150 s.
  - Full write-up: `INCIDENT_2026-10-28_ARP_SPOOFING.md` (local) / `REDACTED_INCIDENT_2026-10-28_ARP_SPOOFING.md`
  - Hostel report: `RCC_REPORT.md` (local) / `REDACTED_RCC_REPORT.md`
  - Both originals are gitignored (they contain MACs).
- **Machine (user-approved), 05:50:** pinned the gateway MAC with `netsh interface ipv4 add neighbors "Ethernet 7" 10.255.31.254 <MikroTik MAC> store=persistent`. Verified Permanent in the active and persistent stores.
- netbug:
  - `GATEWAY MAC CHANGED, possible ARP spoofing` event plus an immediate snapshot when the same gateway IP gets a new real MAC
  - new `gw_arp` CSV column (static/dynamic from `GetIpNetTable`), with change events
  - outage events include `gw_arp`, plus a stale-pin hint with the unpin command when the pinned gateway is unreachable
  - every 5 min, `tools/arpwatch.ps1` (new) runs a 10 s ARP-only pktmon capture. Any other MAC claiming the gateway IP gives `ARP SPOOFING DETECTED` plus a snapshot. It works even while the pin hides attacks from Windows.
- `snapshot.ps1`: lists every MAC that claimed the gateway in its capture; the neighbor table includes the pinned gateway entry.
- Dashboard:
  - "Possible ARP spoofing" red state for 30 min
  - pin status and ARP watch result under Gateway MAC
  - headline colored by state (red / orange)
  - stronger outage and lag bands with a solid strip on top
  - spoofing lines red in the log
- Verified:
  - arpwatch parser on the real incident capture: 2 spoofed replies from the attacker
  - live arpwatch: clean, 11 s, ~0.3 s CPU
  - mocked alert rendering
- Scan report: finding #9, §10c, §11 and §12 updated. README: problem note, flow, checks, logs, dashboard, pinning how-to, footprint, layout.

### 05:39: `87367ed` dashboard readability + render efficiency; 05:34 incident analysed
- Labels are bold with a colon (readouts, details, header meta); values are regular weight.
- Health lines are shown by default, in cyan. Only `health:` lines count as health lines now (startup lines show normally).
- Bold timestamps in the log.
- DOM is written only when content changes; chart colors are read once; resize redraws are throttled to one per frame.
- Outage shading spans back to the previous sample, so it no longer leaves stripes when samples are 2-3 s apart. Edges are whole pixels to avoid seams.
- The log re-pins to the bottom after the web font loads.
- Server stress test: 7000 requests (1000 concurrent). Private memory 28.5 to 28.6 MB; handles and threads flat.
- Scan report: finding #9 and §10c, the 05:34 gateway ARP-spoofing incident, with the timeline, the capture evidence and open actions.

### 05:30: `a998f6a` dashboard redesign + server CPU fix
- Pure black (AMOLED) and white text. Apple system colors for status and traces. SF Pro on Apple devices, Inter elsewhere.
- Inter is bundled in `tools/fonts/` (SIL OFL) and served at `/fonts/inter.woff2` with a 1-year cache, so the page still makes no external requests.
- Details are a 3-column grid of label-over-value cells, so no value is cut off:
  - 2 columns under 600 px, with UDP ports full width
  - the NAT mapping and per-process UDP list are shown in full
- Phone layout: the event log puts the time above each line.
- The status line re-renders as soon as events load, so "last problem" no longer lags a second behind.
- `/api/state` caches the memory figure for 10 s (reading it enumerated every process). Measured CPU per request: ~1.7 ms before, ~0.15 ms after. Idle CPU is unchanged at ~1.4% of one core.
- **Machine:** rebuilt `netbug.exe` and restarted the `netbug` task.

### 05:19: `5220988` live LAN dashboard
- netbug serves a read-only dashboard on port 8787 on all interfaces from its own thread (`HttpListener`, GET only):
  - `/`: `tools/dashboard.html`
  - `/api/state`: latest sample + 300 s history
  - `/api/events`: incremental `events.log` tail
- `tools/dashboard.html`:
  - status line, 5 min latency trace with failure bands, live readings, scrolling event log
  - no external requests; polls only while the tab is visible
- README: dashboard section, flow diagram, footprint, admin note, layout. Scan report: dashboard note.
- **Machine:** rebuilt `netbug.exe` and restarted the `netbug` task (05:17). Port 8787 is open to the LAN through the Private profile, which has the firewall off. No firewall rule was added.

### 05:04: `0af7180` AGENTS.md compressed
- Went from 29 lines / 530 words to 20 lines / 213 words (~800 → ~350 tokens) with no rule dropped.
- Old rules 3 (code = truth), 4 (docs current) and 6 (comments current) are merged into new rule 3. The old changelog rule 5 is now rule 4. Rule numbers in older entries below refer to the old numbering.

### 05:02: `f6d2c22` AGENTS rule 6: keep code comments current
- New rule: update comments with every code change, describe current behavior only, search old names case-insensitively after renames, and fix (and report) stale comments found anywhere.

### 05:00: `1e79c6c` README rewrite + full stale pass
- README rewritten: problem summary, mermaid flow diagram of how netbug works, check/interval/catches table, log file guide, footprint, build/install, repo layout.
- `netbug.cs` comments fixed:
  - the header now lists every snapshot trigger (outage, 5 s lag, high UDP usage)
  - the outage-rule comment now covers lag and UDP-high
  - the persistent-TCP logging comment is merged and reworded
  - the DNS probe label prefix changed from `nm` to `nb` (leftover from the netmon name)
- `snapshot.ps1`: the header lists all triggers + the 60 s limit, and the capture section title matches its filters (ARP + gateway + 1.1.1.1).
- Scan report: the upload-cap note is corrected, and the driver/power tables are marked "at scan time" with current values.
- **Machine:** rebuilt `netbug.exe` and restarted the `netbug` task.

### 04:57: `231b6ca` changelog timestamp fix
- The changelog's own entry was set to the exact system time (04:57) and its commit hash.

### 04:57: `75774e5` changelog + docs rules
- Added `CHANGELOG.md`, reconstructed from git history and session actions.
- `AGENTS.md` rule 4: keep all docs/`.md` files up to date. Rule 5: log every change here with a system-clock timestamp.

### 04:56: `0f26fad` README: document redact.ps1
- Added the `tools/redact.ps1` row to the README tools table.

### 04:55: `d16ce86` docs synced with code; AGENTS rule 3
- `netbug.cs` header comment now matches the code: TLS + UDP threads, snapshot limit, 500 MB cap, health/auto-restart.
- README: added the snapshot limit and health/auto-restart.
- Network scan report: marked ruled-out suspects and finished actions, and added status notes to the findings.
- `AGENTS.md` rule 3: code is the source of truth; report any doc/code mismatch to the user immediately.

### 04:52: `13faf83` netbug: health watchdog
- Hourly `health:` line in `events.log` (private memory, handles, threads, uptime).
- If netbug exceeds 200 MB private memory, 5000 handles or 100 threads, it starts a fresh copy and exits. The mutex now waits 15 s so the handover works.

### 04:47: `c4fd306` netbug: UDP path check + log size cap
- Background thread: one long-lived UDP socket sends STUN to Cloudflare (Google fallback) every 2 s. It logs the UDP RTT and NAT mapping, and writes `UDP NAT mapping changed` events.
- New CSV columns `udp_ms` and `udp_map`. A CSV with an old header is kept as `netbug-<date>-old-<time>.csv`.
- `logs/` capped at 500 MB: oldest snapshots go first, then the oldest CSVs.

### 04:42: `379368a` rename class `NetMon` → `NetBug`

### 04:40: `c59b19d` rename netmon → netbug
- `tools/netmon.cs` → `tools/netbug.cs`, mutex `Global\netbug`, log prefix `netbug-`.
- **Machine:** removed scheduled task `netbug-netmon` and registered task `netbug` (at logon, highest privileges). Deleted `netmon.exe` and renamed the existing CSV.

### 04:38: `3dc63ad` netbug fixes after the unplug test
- No LAG events while there's no network interface.
- Repeated persistent-TCP reconnect failures are collapsed into one line.
- Scan report: notes on the driver update and the unplug test.

### 04:33–04:35: driver update verified, unplug test
- **Machine (by user):** installed Realtek RTL8153 NetAdapterCx driver 1153.23.20.605 (WHQL-signed), then rebooted.
- netbug auto-started after logon. Unplug test (49 s) was logged as OUTAGE START/END with a snapshot.
- Checked that "Allow computer to turn off this device" is still Disabled after the driver update.

### 04:29: `0226d3b` redaction workflow
- Added `REDACTED_NETWORK_SCAN.md`, `tools/redact.ps1` and the gitignored `redact.local.txt`.
- `AGENTS.md` rule 2: never commit PII; publish only `REDACTED_*` copies.

### 04:27: `2c4c7f2` README: problem description and tools

### 04:17: `1b55977` netbug: LAG detection, persistent TCP, probe fixes
- LAG events (gateway ≥ 15 ms, or gateway + internet loss).
- Long-lived TLS connection to www.google.com (HEAD every 15 s); logs FIN, RST or timeout deaths.
- A failed TCP probe is re-checked every second.
- Snapshot uses `ping.exe` (`Test-Connection -TimeoutSeconds` is PS7-only).

### 03:41: `4ebf18e` logger + snapshot script added to repo

### 03:35: compiled C# logger
- Replaced the first PowerShell logger (241 MB RAM, 2.5% CPU) with a compiled C# exe (~35 MB, ~1% of one core, BelowNormal priority).
- **Machine:** registered the logon scheduled task (highest privileges, restart on failure).

### 03:20–03:23: power settings + first logger
- **Machine (user-approved):** Ethernet "Allow computer to turn off this device" → Disabled. Power plan USB selective suspend → Disabled (AC + DC).
- First PowerShell logger started (since replaced).

### 02:35–03:10: full network scan
- Adapters, drivers, IP/DNS/routes, ISP/geo, traceroute, MTU, DNS blocking, speed tests, elevated checks (firewall, listeners, event logs, Wi-Fi profiles). Report: `NETWORK_SCAN.md` (local) / `REDACTED_NETWORK_SCAN.md`.

### 02:43: `ce1d5dd` AGENTS.md rule 1: no co-author trailers
- Rewrote the initial commit to drop its co-author trailer, then force-pushed.

### 02:43: `28fb603` initial commit: public repo created
