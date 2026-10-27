# netbug

Diagnosing intermittent network drops on a wired hostel connection (Windows 11, USB-C RTL8153 dongle, MikroTik-gatewayed LAN, TM Unifi upstream).

Symptom: every few days, outbound traffic dies while inbound keeps flowing for a bit. Discord voice goes to 5000 ms (friends can't hear you, you can still hear them), then Discord and games lose connection entirely. Replugging the cable shows "connected, no internet" until it recovers by itself minutes later.

## tools/

| File | What it does |
|---|---|
| `netmon.cs` | Always-on logger (~35 MB RAM, ~1% of one core, BelowNormal priority). Each second it pings the gateway, 1.1.1.1 and 8.8.8.8. It queries DNS via the gateway every 2 s. Every 10 s it does a TCP connect and records UDP port usage per process and the gateway MAC. It checks the public IP every 5 min. It keeps one long-lived TLS connection to see how connections die (FIN/RST/timeout). It logs OUTAGE and LAG events and triggers `snapshot.ps1`. |
| `snapshot.ps1` | Detailed dump at the moment of an outage: adapter counters, NCSI state, neighbors, ping/DNS/TCP probes, traceroute, UDP/TCP usage, recent system events, and a 15 s `pktmon` capture when run as admin. |

Build and install (admin PowerShell):

```powershell
C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /optimize /out:tools\netmon.exe tools\netmon.cs
# then register tools\netmon.exe as an "at logon, run with highest privileges" scheduled task
```

Output goes to `logs/` (gitignored): `netmon-<date>.csv`, `events.log`, `snapshots/`. Files older than 30 days are deleted automatically.
