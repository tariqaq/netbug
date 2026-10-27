# Changelog

All times are the user's system time: Kuala Lumpur, MYT (UTC+08:00). Newest first.
Entries cover repo changes (with commit hash) and changes made to the machine itself.

## 2026-10-28

### 04:58: changelog + docs rule
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
