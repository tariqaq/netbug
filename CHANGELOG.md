# Changelog

All times are the user's system time: Kuala Lumpur, MYT (UTC+08:00). Newest first.
Entries cover repo changes (with commit hash) and changes made to the machine itself.

## 2026-11-04

### 08:09: stale-doc sweep after v1.0.5
- `tools/netbug.cs` header: the dashboard is on all interfaces for every copy (two lines still said localhost only for a lone exe).
- `README.md`: the page reloads after any netbug restart (not only a version change); the CSV row has the date and UTC offset; repo layout lists the Logs and updates panel and `exports/`.

### 08:06: release v1.0.5; this laptop updated itself to it
- GitHub release `v1.0.5` (tag on `acd0263`).
- **Machine:** this laptop's netbug (release exe) updated itself 1.0.4 -> 1.0.5 through **Install update now** in 3 s: download, swap to `netbug.old.exe`, restart. The installed exe is byte-identical to the release. Checked after: the gateway is still pinned; the page from the LAN address has no token and `/api/export` and `/api/fix` return 403 there; the CSV has the new columns (the earlier part of today is in `netbug-2026-11-04-old-080614.csv`).

### 08:05: `acd0263` v1.0.5: dashboard on every interface, uninstall keeps logs, UTC offset on every timestamp
- `tools/netbug.cs`:
  - The dashboard listens on all interfaces (`http://+:8787/`, Tailscale included) for the release exe too. Other devices get the page read-only: no control token, so no Router protection, update or export controls, and those APIs refuse them.
  - Uninstall (button or `--uninstall`) on a lone exe removes the task, the router pin and the program files in `%ProgramData%\netbug` (`RemoveProgram`), and keeps `logs\`. It's logged in `events.log` for both kinds of copy.
  - Timestamps: `events.log` lines are `yyyy-MM-dd HH:mm:ss zzz` (`Stamp`); CSV rows gain `date,utc_offset` at the end (today's CSV with the old header is kept as `-old-<HHmmss>`); `.ring.txt`, `arp-ring-memory.txt` and the export manifest use `yyyy-MM-dd HH:mm:ss.fff zzz` (`StampMs`).
  - `Version` 1.0.5.
- `tools/snapshot.ps1`: the snapshot header and capture line carry the date and UTC offset.
- `tools/dashboard.html`: reads event lines with or without the offset.
- `README.md`: the release exe's differences, uninstall, timestamps, the LAN and firewall note.

### 07:56: release v1.0.4; this laptop now runs the release exe
- GitHub release `v1.0.4` (tag on `772df36`) with `netbug.exe` built from it: log export, self-update, the in-place exe swap.
- **Machine:** this laptop switched from the repo copy (`tools\netbug.exe`) to the v1.0.4 release exe, the same install as the friend's. The download is byte-identical to the build. Its logs (`logs\`) were copied to `C:\ProgramData\netbug\logs` first, so the history continues there. The logon task `netbug` now runs `C:\ProgramData\netbug\netbug.exe`; its dashboard is localhost-only. The gateway pin and settings are unchanged. `logs\` in the repo is left as it was at 07:55.

### 07:54: `772df36` self-update swaps the exe in place; the page reloads after any restart
- `tools/netbug.cs` `InstallUpdate`: the downloaded `netbug.new.exe` must be assembly `netbug` of at least the release's version. The running exe is renamed to `netbug.old.exe`, the new file takes its name and starts like a health restart, and the old process exits. Before, the new file was started to install itself, and its `schtasks /End` could end it along with the old task process.
- `tools/dashboard.html`: the page reloads when `/api/state` shows a new start time, or when its token is refused (403). Before, a tab opened before a netbug restart kept the old token: **Export all logs** got a silent 403 and stayed on "Preparing the zip…".
- `README.md`: how an update installs.

### 07:46: `e7b1a75` log export and self-update (v1.0.4)
- `tools/netbug.cs`:
  - `Version` constant (1.0.4), also set as the assembly version.
  - **Export:** `POST /api/export` (the page token in the form body, localhost only, one at a time) streams a zip of every file in `logs/`, the in-memory ARP ring (read up to that moment), `state.json` and `EXPORT_MANIFEST.txt`, nothing redacted. A `CountingStream` wrapper lets .NET Framework's `ZipArchive` write to the response stream. Logged as `logs exported to the browser: …` or `log export failed: …`.
  - **Updates:** `UpdateLoop` checks `api.github.com/repos/tariqaq/netbug/releases/latest` 2 min after start and then every 6 h, and on `POST /api/fix/update/check`. A lone exe installs a newer release by itself (after any running router check), or at once on `POST /api/fix/update/install`: it downloads `netbug.exe` to `%ProgramData%\netbug\netbug.new.exe`, accepts it only as assembly `netbug` of at least the release's version, starts it (it installs itself as a newer build) and exits. The new copy deletes the leftover files after 30 s. A repo copy only logs that a release is out.
  - `/api/state` and `/api/fix` report the version, `/api/fix` the update and export state.
  - Build needs `/r:System.IO.Compression.dll`.
- `tools/dashboard.html`: **Logs and updates** panel (laptop only): version, update status, **Check for updates**, **Install update now**, **Export all logs** (a form post into a hidden frame, so the browser streams the download). The page reloads when the version changes.
- `README.md`: build command, Updating, self-update for a lone exe, the checks table, the dashboard panel.
- Tested on this laptop (repo copy): export gave a valid zip of 197 files (64.7 MB before compression) with ARP up to the cutoff; a wrong token gets 403; the update check found 1.0.3, not newer. The self-install path wasn't run: it needs a lone exe and a release newer than 1.0.4.
- **Machine:** this laptop's netbug rebuilt and restarted on this build.

### 07:35: release v1.0.3
- GitHub release `v1.0.3` (tag on `c7fc2ee`) with `netbug.exe` built from `99e7c5b`: the UDP probe reset.
- **Machine:** this laptop's netbug rebuilt and restarted on the new build at 07:34:43 (pinned, UDP probe answering).

### 07:32: `99e7c5b` UDP probe opens a new socket after 3 failures in a row
- `tools/netbug.cs` `StunLoop`/`StunProbe`: after 3 failed STUN probes in a row, the socket is closed and reopened (new local port, so a new NAT mapping), and the STUN servers are resolved again (the cached address is kept if that lookup fails). This happens once per failure streak, so a real UDP outage still shows. Events: `UDP probe failed 3 times in a row: opening a new socket…` and `UDP probe works again on the new socket`. Before, a dead mapping for the one long-lived socket failed the probe until netbug restarted: the friend's laptop showed UDP down for 2 h+ on 11-04 while its other UDP apps worked.
- `README.md`: the STUN row in the checks table.

### 07:22: `de49855` log exports moved to `exports/`
- `.gitignore`: `exports/` replaces the per-file zip entries.
- **Machine:** the friend's three exports moved from the repo root to `exports/friend/` and renamed by export time (`2026-11-01_18-40_friend-netbug-logs.zip`, `2026-11-03_02-00_friend-netbug-logs.zip`, `2026-11-04_07-11_friend-netbug-full-logs.zip`). A full export of this laptop's `logs/` saved as `exports/mine/2026-11-04_07-20_my-netbug-full-logs.zip`.
- Analyzed the friend's 11-04 export against this laptop's logs (same hostel LAN, same public IP). The friend's "UDP down" from 11-04 05:08:57 to the export (2 h+) affects only netbug's own STUN probe. This laptop's STUN probe had zero failures in the same window, and the friend's ping, DNS and TCP stayed fine, as did other UDP apps. Both laptops stayed pinned with no ARP spoofing alerts.

## 2026-11-03

### 07:21: `1d888b0` friend's laptop, second export: clean after the fix
- Analyzed the friend's second netbug export (11-01 18:40 to 11-03 02:00, v1.0.2). Gateway pinned to the real router in all 15,540 Ethernet samples. No ARP spoofing alerts after 11-01 18:31:16 and no sign of the attacker. No outage matches the ARP-spoofing signature: the 10 h gap on 11-02 is the laptop asleep, and the rest are short blips (NAT port change, own heavy traffic, evening upstream latency).
- Incident report §12 (and its REDACTED copy): new "After the fix" section, date range to 11-03.
- `.gitignore`: `samefrnd_netbug-logs-*.zip` (the raw export holds PII).

## 2026-11-01

### 23:04: `3729bfb` video: v5 revision 2 (camera sightlines, the trap shot, victim labels)
- `video/src/v5/world.tsx`: `sightBlocked()` reports when a close camera can't see its target through a room's open front (walls, pillars, slab lips). `ROOMS.morning` reordered to match `victims1`, so the 05:34 labels name the right rooms ([3,1] is 10.255.23.47).
- `video/src/v5/index.tsx`:
  - `NETBUG_CAMCHECK=1` prints every frame range where the camera's view is blocked.
  - Every close shot of the impostor (05:34 reveal, the three 15:28 slams, the verdict) now looks in through the room's open front.
  - Glides that crossed the building (into the symptoms, into the friend's chapter) are now cuts.
  - New trap shot for "71 out" and "42 out": the impostor's room front-on, with a dense packet flow down the drop into the gem and an `in N · out 0` tag.
  - 15:28: the four other rooms are labelled with their IPs, plus "this laptop"; the capture panel hands over to them.
- Rendered locally, not published: both cuts, 12,350 frames (3:25.9). -14.0 LUFS, true peak -1.4 dBTP. About 14.5 min per render; ~405 MB each. Redaction checked on a decoded frame.
- `video/README.md`, `video/PLAN-v5.md`: the camera check, render numbers, log.
- **Machine:** removed `video/.venv-qwen` and the Hugging Face models `Qwen3-TTS-12Hz-1.7B-Base` and `whisper-large-v3-turbo` (unused since the switch to Edge Andrew); 11.1 GB freed, C: at 115 GB free. Other Hugging Face cache entries were left alone.
### 22:25: `e1dea99` video: v5 revision 1 (Andrew voice, rebuilt world, 2D type, slower pacing)
- Narration: `video/scripts/tts5.py` now uses Microsoft Edge `en-US-AndrewMultilingualNeural` through edge-tts (the `.venv` from v4), with per-line `rate`/`pitch` in `video/narration-v5.json`, the v4 studio chain and word timings from the voice's word boundaries. Script trimmed (how1, a2_1, f1, fix1, sym1, a1_end). 30 lines, every word matched, 150.6 s of speech. `public/vo5/reference.wav` removed (Qwen clone source, no longer used).
- `video/src/v5/world.tsx` rebuilt:
  - the block stands on a slab of city cut like a cake, with the basement in cross-section
  - one cable system from every desk through the ceiling runs, riser, switch and router, out through the ONT and a conduit to the utility pole and ISP mast, with no section through a wall
  - furnished rooms with a ceiling fan, a roof with a tank, AC fans and an aerial, plus a street with lamps, trees, and parked and passing cars
  - the cable end drops off the desk when it is pulled
- `video/src/v5/look.tsx`: sky with a setting moon and drifting clouds; label chips with straight leaders, kept inside the frame and above the captions.
- `video/src/v5/index.tsx`:
  - The title, chapter cards, the impostor's speech bubble, capture counters, the 15:28 jump clock, "ON PURPOSE." and the netbug badge are all 2D now; no 3D text.
  - The friend timeline is realigned, cameras reframed, and pauses are longer so every panel can be read.
  - 12,350 frames (3:25.9).
- Rendered locally, not committed or published: `video/out/incident-v5-redacted.mp4` and `incident-v5-full.mp4`.
  - HEVC (`hevc_nvenc`, hvc1), 1080p60.
  - -14.0 LUFS, true peak -1.4 dBTP.
  - About 11 min per render; ~399 MB each.
  - Redaction checked on a decoded frame.
- `video/README.md`, `video/PLAN-v5.md`: voice, world, render numbers, log.
### 21:30: `5293326` video: `scripts/render5.ps1`; disk cleanup
- `video/scripts/render5.ps1`: the final v5 renders in one command (redacted, plus the full cut when `data.local.json` exists): NVENC HEVC, 2-pass loudnorm, AAC 320k, hvc1 mux. `video/README.md` and `PLAN-v5.md` name it and list what narration regeneration needs.
- **Machine:** freed 13.9 GB on C: (95.1 GB free after):
  - removed the Hugging Face models `Qwen3-TTS-12Hz-1.7B-CustomVoice` and `-VoiceDesign` (bake-off only)
  - purged the pip and uv caches
  - removed the stalled `pip-unpack` torch download in `%TEMP%`
  - removed draft stills, raw takes, bake-off samples and solo stems from `video/out/`
- Kept: `.venv-qwen`, Qwen3-TTS Base, Whisper large-v3-turbo, `node_modules`, and every `incident-v*.mp4` render.
### 21:21: `82b0a35` video: v5, a 3D film of every incident (1080p60, 3:23)
- New film in `video/src/v5/` (`world.tsx`, `look.tsx`, `index.tsx`, `sound.ts`, `score.ts`, `qr.json`): a night-to-dawn 3D diorama of the hostel covering 05:34, 15:28, the friend's laptop, the fix (watch, Test and pin, announce) and prevention, with an end card and a QR code to the latest release. Plan, storyboard, fact checks and log in `video/PLAN-v5.md`.
- Narration: `video/scripts/tts5.py` + `video/narration-v5.json`. Qwen3-TTS 1.7B clones the picked bake-off voice (`public/vo5/reference.wav`) on CUDA; for each line, the best of up to 3 takes by Whisper large-v3-turbo transcript match; studio chain; Whisper word timings into `public/vo5/timing.json`. 154 s of speech, all word cues resolve.
- Rendered locally, not committed or published: `video/out/incident-v5-redacted.mp4` and `incident-v5-full.mp4`.
  - HEVC (`hevc_nvenc`, CRF 18, hvc1), 12,173 frames at 60 fps.
  - Audio normalized by a 2-pass `loudnorm` to -14.0 LUFS, true peak -1.3 dBTP; AAC 320k, 48 kHz.
  - About 4.3 min per render on the RTX 4060; ~308 MB each.
  - Redaction checked on a decoded frame.
- `video/README.md`: v5 section (files, build, render). `.gitignore`: `video/.venv-qwen/`, `video/scripts/__pycache__/`.
- **Machine:** `video/.venv-qwen` (Python 3.11, torch 2.11 cu128, qwen-tts 0.1.1) plus the Qwen3-TTS and Whisper models in the Hugging Face cache.
### 19:03: `6519af9` video: kinetograph 0.2.0 -> 0.2.5
- `video/package.json` and the lockfile: kinetograph 0.2.5, the latest release (`main` is ahead but unreleased).
- Checked:
  - `check` reports no type errors.
  - `lint` gives 0 errors and the same 13 off-canvas warnings as before.
  - The GPU render (h264_nvenc, 3 Mbit/s) took 92 s.
- Compared with the committed 0.2.0 render:
  - same length (4251 frames, 141.7 s)
  - **bit-identical audio** (same MD5, -14.8 LUFS, peak -0.9 dBFS)
  - frames at SSIM 0.99997 / PSNR 70 dB (worst frame 55.7 dB), so no visible change
- The committed `incident-v4-redacted.mp4` stays as it is (no need for another 55 MB in git history).
- `video/README.md` names 0.2.5 and the comparison.
- **Machine:** `npm install kinetograph@0.2.5` in `video/` (local only). The test render is in `video/out/` (gitignored).

### 18:48: `4ee190b` friend's laptop analysis; trusted-MAC, mid-check and adapter-switch fixes (release v1.0.2)
- Analyzed a friend's netbug export (10-28 22:55 to 11-01 18:40, same hostel LAN). It shows the **same attacker** (`10.255.18.145`, randomized MAC) blackholing that laptop on every wired session, for 4 days:
  - outages of 94 s, 232 s, 525 s and 37 min
  - a victim lookup by the attacker's own IP at 18:28:52
  - 8 fake gateway replies in the capture
- After the v1.0.1 install, the MAC announce and **Test and pin** of the known router ended it: 9 min with zero failures.
- Written up in the incident report §12 and the RCC report ("Another resident"). `REDACTED_*` regenerated.
- The export also showed the pre-v1.0.0 netsh bug in action: each router check left the last tested MAC (usually the attacker's) as a static entry, which locked the laptop onto it.
- `netbug.cs` fixes:
  - **Trusted gateway MAC:** a pin or a router check that proves the real router now replaces it. Before, the first MAC seen stayed trusted, which was the attacker on a laptop already under attack, so the real router got flagged. The ARP entry type is now judged before a MAC change, so a new pin is trusted first.
  - **Router check:** throws its result away (nothing picked or pinned) when the gateway or adapter changes during it.
  - **Adapter switch:** the gateway MAC and ARP type are read at once (they showed the previous adapter's for up to 10 s), and the packet counters restart (they went negative).
- Harness: 6 new fake-network tests (trust after a proven check; network change mid-test). All 34 pass.
- `.gitignore`: `anotherdeviceexample.zip` (the export, kept locally).
- **Machine:** rebuilt `tools\netbug.exe` and restarted the task. No ARP changes.

### 18:19: `ddef4b3` stale-doc sweep
- README status table: **Not pinned** now also points to testing a router MAC, matching `dashboard.html`.
- `netbug.cs` header: the router check summary mentions testing one known or typed MAC. Comment-only, so the v1.0.1 exe is unchanged.

### 18:18: `01dc2d6` known router dropdown with Test and pin, stop any netbug* on install (release v1.0.1)
- Router protection panel: a **Router MAC** dropdown with the known routers for the current gateway IP, plus **Other MAC…** to type one. **Test and pin** (`POST /api/fix/trypin?mac=`):
  - runs the Check now test on that one MAC, without the 10 s listen
  - pins it only when it passes
  - a failed test changes nothing (the pin and the last check's result stay)
  - The button reads **Already pinned** when that MAC is the pin.
- Known routers come from the gitignored `tools/routers.local.txt` (`<gateway ip> <MAC> [label]`). It is embedded as `netbug.routers.txt`, so router MACs stay out of git. Check now also tests them.
- MACs typed on the page are normalised (`:`/`-`/none). Multicast, broadcast and all-zero MACs are refused.
- Install and uninstall stop every process named `netbug*`, not only `netbug`: a second download is saved as `netbug (1).exe`.
- Tested with a fake netsh/ping harness (scratch copy of `netbug.cs`; nothing touched the real ARP table):
  - MAC parsing
  - known-router loading
  - pin/no-pin for the real router, a blackhole, a device in the middle, a no-hop router and a random-style MAC
  - restore of the previous pin or entry
  - Unpin and re-pin
  - The page was rendered with the fake state for a screenshot.
- README: protect-the-laptop steps, the Router protection table, the build step for `routers.local.txt`, repo layout.
- **Machine:** rebuilt `tools\netbug.exe` (with the known-router list) and restarted the task. No ARP changes.

### 05:35: `bca06da` self-install, uninstall, netsh delete fix, first GitHub release
- `netbug.cs` install section: the first elevated start sets up the `netbug` logon task. The settings match the task on this laptop: logon trigger, highest privileges, no time limit, restart 999 x 1 min, on battery, IgnoreNew.
  - **Lone exe:** copies itself to `%ProgramData%\netbug\netbug.exe` and locks that folder (Administrators/SYSTEM full, Users read). It then registers the task, starts it and exits.
  - **Same lone exe run again:** only opens the page.
  - **A different build:** replaces the installed copy and restarts it (update).
  - **Repo copy:** registers a task only when none exists, so this laptop's task is untouched.
- `--uninstall` and the page's **Uninstall netbug** button (lone exe only; replaces **Stop netbug**) remove the task, the router pin and, for a lone exe, `%ProgramData%\netbug`.
- Fix: every `netsh interface ipv4 delete neighbors` call used `interface=`, which that command rejects (it takes `name=`). So the page's Unpin and the router check's "put the entry back" step never deleted anything.
- README: Quick install from Releases, the self-registering task, `--uninstall`, and the friend section rewritten for the installer.
- Tested here, with the lone exe:
  - install, then the same exe again with no reinstall
  - update with a different build
  - uninstall from the page and with `--uninstall`: task, pin and files removed
  - The empty folder is removed at the next restart.
  - This laptop's task and pin were backed up and restored after each run.
- **Machine:** rebuilt `tools\netbug.exe` and restarted the task. During the tests the `netbug` task and the gateway pin were briefly replaced/removed, then restored (task XML from backup; pin back to the same MAC). An empty `C:\ProgramData\netbug` is queued for deletion at the next restart.

### 05:19: `1d1dd4c` README: Router protection status labels
- README explains the panel's status labels (Protected, Not pinned, Pin differs, Checking…, No network), matching `renderFix` in `dashboard.html`.

### 04:44: `7f17eb2` dashboard hides Cloudflare-only ping loss
- Log analysis: since 03:40, 63 of 1154 one-second 1.1.1.1 pings were lost, in 1-3 s bursts every 30 s to 3 min. In those seconds DNS, UDP (STUN to `stun.cloudflare.com`) and Google stayed fine. This is ICMP rate limiting on the path, not an outage.
- `dashboard.html`: a lost Cloudflare ping while Google answers no longer shows as **lost**. The readout keeps the last answered value and the chart line doesn't break. The CSV still logs `-1`, and outage detection is unchanged (it already needed Cloudflare and Google both lost).
- README dashboard section notes this.
- **Machine:** rebuilt `netbug.exe` and restarted the `netbug` task.

### 03:46: `5f5e997` README rewrite, doc sync, stale comments
- README rewritten: problem and finding up top, then **Setup** (requirements, build, register the logon task with the exact settings in use, open the dashboard, protect the laptop, update, uninstall), friend mode, Router protection table, checks, logs, dashboard, footprint, repo layout.
- Incident report: dated 2026-11-01 update note under §9 (continuous ARP capture, MAC announce, what it narrows in §8); `REDACTED_*` regenerated.
- Stale code comments fixed in `netbug.cs`: header (interface scan cadence, dashboard localhost-only in portable mode), unpack timing, router-check candidates (now from the ARP ring), ARP watch notes; long comment lines wrapped.

### 03:37: `547a129` full-code review fixes
- Interface scan (~7 ms CPU) now runs on Windows network-change events, every second while anything fails, else every 10 s (was every second). netbug CPU 1.74% -> 0.83% of one core.
- Console tools run by netbug (pktmon, netsh) are killed after 30 s instead of possibly hanging the ARP capture or router check.
- ARP watch shows "no ARP captured" instead of "clean" when the capture got no frames.
- Portable mode unpacks its files only once it is the running instance.
- `snapshot.ps1` no longer pings a hardcoded ISP hop (it was this network's, useless elsewhere, and PII in git since `4ebf18e`; the traceroute shows that hop anyway). Git history still contains it.
- **Machine:** netbug restarted with the new build.

### 03:28: `a0c88ac` router-side ARP defence: MAC announce and a continuous ARP capture
- Why: three short drops (02:34, 02:35, 02:38; 3-8 s) while pinned. The gateway didn't answer, rx fell to 0, the link stayed up and the pin held. That fits someone poisoning the router about this laptop, which the pin can't stop. The snapshot captures started after each drop had ended, so they couldn't show it.
- **MAC announce** (new thread, switch "Keep the router updated", on by default, kept in `logs/netbug.settings`): about once a second `ResolveIpNetEntry2` re-resolves a neighbor next to the gateway. Each ARP request broadcasts this laptop's real IP and MAC, so the router replaces a fake entry within about a second. API: POST `/api/fix/announce?on=0|1`; `/api/fix` reports sent count, target and how many of the laptop's ARP requests the last capture saw.
- **Continuous ARP capture:** an ARP-only pktmon capture runs all the time into `logs/arpring-a.etl`/`-b.etl`. Every 60 s netbug stops it, starts the other file at once and reads the stopped one; the last 15 min of ARP frames stay in memory. Every 5 min the new frames are checked (before: a 10 s sample every 5 min). A snapshot pauses it first, judges what came in and saves the ARP about the gateway or this laptop as `<snapshot>.ring.txt`. The router check reads its 10 s from it too.
  - Tested and dropped: circular pktmon files with `--file-size` 8 or 64 MB silently kept about a third of the frames (11 of 30 announces in 30 s); the default size kept 30 of 30. Real-time mode was lossless too but cost ~1 GB RAM (512 MB kernel + ~500 MB `pktmon.exe`); file mode costs the 512 MB kernel reservation only (user's choice).
  - `arpwatch.ps1` is now only the parser for snapshot captures. Its dedup no longer merges identical frames more than 5 ms apart (it counted back-to-back repeats as one).
- netbug and its child processes are locked to the 4 highest-numbered logical processors.
- ARP SPOOFING DETECTED now also fires when another MAC claims **this laptop's IP**.
- `snapshot.ps1`: the capture starts before the probes and runs until they finish (at least 15 s). It also lists who claimed this laptop's IP.
- One lock (`pktmonLock`) orders the ring and snapshots; if anything else stops pktmon, the next rotation restarts it. Stop netbug (portable) stops pktmon too.
- `snapshot.ps1` capture uses pktmon's default file size again (a small one loses frames).
- README, AGENTS.md log-analysis rule and code comments updated.
- Verified live: announces reach the wire about once a second (121 of the laptop's ARP requests in ~120 s of capture); ring rotation, snapshot.ps1 capture and the panel (headless screenshot) checked. Not live-tested: a real outage snapshot through netbug, a router check.
- **Machine:** netbug restarted with the new build (scheduled task, old exe kept as `tools/netbug.old.exe`, gitignored).

## 2026-10-28

### 22:48: `4e0503d` router protection panel and a self-contained exe for friends
- **Router protection** panel on the dashboard, only on the laptop itself:
  - **Check now:** finds the real router MAC. Candidates are the ARP entry, the pin, and every MAC answering for the gateway in a 10 s pktmon capture, during which the router is asked again. Each candidate is tested as a temporary static entry (active store only): internet pings must pass **and** a TTL-1 ping must come back from the gateway IP itself. The entry is then restored.
  - **Auto-detect** switch: now, every 30 min, on a gateway change and after spoofing alerts. Kept in `logs/netbug.settings`.
  - **Pin it permanently** switch: netsh persistent store, verified MAC only.
- Control API `/api/fix` (GET status, POST `check`/`pin`/`unpin`/`auto`/`stop`): loopback only, Host `localhost`/`127.0.0.1` only, and a per-run token the page gets only on localhost. Tested: no token, LAN address, spoofed Host and GET on actions all get 403/405.
- While a check runs, its test MACs aren't reported as GATEWAY MAC CHANGED, and snapshots and ARP watch are paused.
- `arpwatch.ps1` parsing moved into `ArpCapture`, shared by ARP watch and the check.
- Double-clicking netbug.exe without admin asks for UAC, starts an elevated copy and opens the page in the normal (non-admin) browser. If netbug already runs, it only opens the page.
- Portable mode for a lone exe:
  - page, font and scripts are embedded as resources and unpacked to `%ProgramData%\netbug`
  - dashboard on localhost only
  - **Stop netbug** button
- Build command now embeds the resources (README, netbug.cs header).
- Live tests (a real check, the portable run) were **not** done, at the user's choice. Done: build, deploy, API gating, panel render, TTL-1 test (the hostel router answers "TTL expired" from 10.255.31.254).
- **Machine:** netbug restarted with the new build (scheduled task, same as before).

### 18:17: `b43d5ec` incident video v4
- Film grain removed (barely visible).
- Slower pacing: 2:04 to 2:22. Longer cold open, chapter cards (40 to 60 frames), gaps between lines and scenes, and held pauses after key lines and titles.
- Narrator back to `en-US-AndrewNeural`, with per-line rate and pitch for tone (slower and lower on the dramatic lines; new `rate`/`pitch` fields in `narration.json`).
- `scripts/tts.py` now runs every clip through a studio-mic chain in ffmpeg: rumble cut, warmth, mud cut, presence, de-essing, compression, exciter, air shelf, peak limiter, 48 kHz. Checked: speech onsets move by only a few ms.
- Script:
  - "we removed the protection" is gone (the pin isn't introduced yet at that point). It now says "Then we kept watching, and waited for it to come back."
  - The PART II card reads "the second attack". The clock in that scene runs 05:36 to 15:28.
  - New line and visual after attack 1: pulling the cable switched the laptop to a Wi-Fi hotspot, a different network, and the internet came straight back (Ethernet ×, then Wi-Fi hotspot ✓, "internet back at once"), with a calm music cue.
- Music +3 dB (`MUSIC_LEVEL` 0.14 to 0.2).
- Mix -14.8 LUFS, peak -0.9 dBFS. 3 Mbit/s, ~55 MB.
- The committed copy is now `video/incident-v4-redacted.mp4`, replacing v3. v3 is tagged `video-v3` (`68d877a`). Local renders: `out/incident-v4-full.mp4` (real MACs) and `out/incident-v4-redacted.mp4`.

### 17:44: `68d877a` incident video v3: cinematic cut
- Restrained true-crime documentary style, still ~2 minutes (2:04).
- New voice: `en-US-ChristopherNeural` (news/documentary) at +10%, replacing Andrew. The script is tightened, with present tense for the attack and "Same device. Same address. Same lie." as three separate lines.
- `scripts/tts.py` now records `speech`, where each line's last word ends. The film times lines from that, not from the clip length (~0.8 s of trailing silence).
- Look:
  - a cold open (05:34:03 types in, a heartbeat trace goes flat)
  - chapter cards (PART I/II/III)
  - a fixed film-grain texture, vignette, letterbox bars on the open, cards and end card
  - a 3% push-in per scene, camera shake and colour fringe on hits
  - a soft red spotlight on the impostor, slams for the second attack, checkmarks stamping in the comparison
- Sound, all synthesized (nothing downloaded): a score per scene mood (D minor, resolving to F major at the fix) and new effects (impacts, horn hits, risers, whooshes, glitches, clock, heartbeat, flatline, lock, stamps). Shared reverb and compressor bus; music ducks ~7.5 dB under the voice.
- Mix -17.3 LUFS, peak -1.1 dBFS. `NETBUG_SOLO=music|sfx|voice` mutes the other stems for measuring.
- Ducking uses anchored linear ramps: `setTargetAtTime` on the duck gain misbehaves in node-web-audio-api (the first test render hit 0.2 LUFS).
- New: `video/src/cinema.tsx`, `video/src/sound.ts`, `video/src/score.ts`, and `video/tasks.md` (build tracker).
- The committed copy is now `video/incident-v3-redacted.mp4`, replacing v2. v2 is tagged `video-v2` (`eac8d45`). Local renders: `out/incident-v3-full.mp4` (real MACs) and `out/incident-v3-redacted.mp4`, ~54 s each on the RTX 4060.
- Rendered at 3 Mbit/s (~49 MB). The first push was rejected: a 12 Mbit/s cap with animated grain gave a 181 MB file, over GitHub's 100 MB limit. The grain is now a fixed texture, and the bitrate cap is lower.

### 16:14: `eac8d45` incident video v2: softer glow
- Every glow is reduced to roughly a third or half of its strength, with smaller radii:
  - headlines: 14 px, x0.45
  - device borders: 16 px, x0.6
  - bubbles: 12 px, x0.3
  - packets: 6 px, x0.4
  - "0 came back": 10 px, x0.45
- New renders: `out/incident-v2-full.mp4` (local, real MACs) and `out/incident-v2-redacted.mp4`. The committed copy is now `incident-v2-redacted.mp4` (replaces v1; v1 stays in git history and locally in `out/`).

### 16:11: `60ba315` incident video v1
- Fixed the title misalignment: the 110 px headline was wider than its 1400 px box, and kinetograph falls back to left alignment for text that overflows. Centred text now gets a near-full-width box.
- Chip labels (times, notes) are vertically centred in their pills.
- More of kinetograph in use:
  - `glow` on the impostor, red bubbles, the "0 came back" counter and the red headlines
  - real `motionBlur` (6 samples) plus a soft glow on moving packets
- Renders renamed to v1: `out/incident-v1-full.mp4` (local, real MACs) and `incident-v1-redacted.mp4` (committed; replaces `incident-redacted.mp4`). Old renders deleted.
- Lint: no issues. Audio unchanged (-17.3 LUFS, peak -2.2 dB). ~29 s per render on the RTX 4060.

### 15:55: GitHub contributor cache refresh
- **GitHub (user-approved):** the sidebar still listed "claude" as a contributor, from the first push before its co-author trailer was rewritten away. The contributors API already showed only `tariqaq` (41 commits).
- To force a refresh, the default branch was switched to a temporary `tmp-refresh` (a copy of `main`) and back to `main`, then `tmp-refresh` was deleted. Only `main` remains.
- The old rewritten commit still exists on GitHub (reachable by its hash, on no branch) until GitHub Support garbage-collects the repo.

### 15:49: `71f297f` incident explainer video
- `video/`: a 2-minute (1:59.4) narrated explainer of both attacks (05:34 and 15:28), the symptoms, the confirmation test and the pin fix, for residents and the RCC. Built with kinetograph 0.2.0.
  - Narrator: Edge neural voice `en-US-AndrewNeural` via `edge-tts`, generated by `scripts/tts.py` with word timings.
  - Captions highlight each spoken word. Scenes and animations are keyed to the narration's words.
  - Sound effects are synthesized (Web Audio). Audio: -17.3 LUFS, peak -2.2 dB.
- Rendered on the RTX 4060 (Vulkan frames + NVENC H.264, ~27 s per render).
- Committed: the source and `incident-redacted.mp4` (MACs as `xx`).
- Kept local (gitignored): `data.local.json` with the real MACs, and `out/incident-full.mp4` for the RCC.
- **Machine:** in `video/` only, installed kinetograph 0.2.0 and `@types/react` (npm, local) plus a Python venv with `edge-tts`. Nothing global.
- README: link and layout row.

### 15:38: `ae19b4d` gateway pin re-applied
- **Machine (user-approved: "yes, re-pin the gateway MAC"), 15:37:57:** `netsh interface ipv4 add neighbors "Ethernet 7" 10.255.31.254 <MikroTik MAC> store=persistent`.
  - Before, the cache still held the impostor's MAC (Unreachable). After: Permanent in the active and persistent stores.
  - The user replugged Ethernet after the pin.
- Docs: incident report §8/§11, scan report §11/§12, README, RCC report and `AGENTS.md` (expect `static`; a drop while pinned means the router side is poisoned too).

### 15:35: `82c38dd` second ARP-spoofing attack (15:28) confirmed; netbug trusted gateway MAC
- **Incident #2:**
  - At 15:28:54 netbug logged `GATEWAY MAC CHANGED` (`2C-C8-…` to `7A-EC-…`) plus a snapshot. The 155 s outage ended when the user unplugged at 15:31:31.
  - Same device and IP as 05:34: 42 packets out, 0 back, 3 spoofed replies, 4 other victims, and the attacker caught looking up a victim.
  - Matches the 05:34 signature on every check. Write-up: incident report §11. Also added to the RCC report, scan report finding #9 and §10b, and the README.
- netbug fix:
  - ARP watch compared against the *current* (poisoned) cache MAC, so it would accept the impostor. A **trusted** gateway MAC is now kept: the first MAC seen for a gateway IP, or the pinned one, never replaced by a changed MAC.
  - `GATEWAY MAC CHANGED` and ARP watch both compare against it.
- **Machine:** rebuilt `netbug.exe` and restarted the `netbug` task.
- Re-pin: the user agreed, but Claude Code's permission safeguard blocked the persistent `netsh` change. **Not applied** yet. `AGENTS.md` rule 1 updated.
- `.gitignore`: `video/node_modules/`, `video/out/`, `video/.venv/`, `video/data.local.json` (incident video in progress).

### 15:14: `f47a67b` gateway pin removed; 3 netbug log fixes
- **Machine (user's request), 15:12:** removed the gateway ARP pin (`netsh interface ipv4 delete neighbors "Ethernet 7" 10.255.31.254`).
  - Verified: the entry is dynamic/Reachable with the real MikroTik MAC, the PersistentStore is empty, and netbug logs `gw_arp=dynamic`.
  - Reason: confirm the next drop is the same ARP-spoofing issue before applying any fix. All spoofing detection stays on.
- netbug fixes (found in the overnight log review):
  - A server closing the long-lived TLS connection after 200+ s is no longer logged, matching the comment. The check looked for a reason *starting* with "server", but the reason reads `EndOfStreamException: server asked to close`, so Google's hourly close was logged every hour.
  - `UDP NAT mapping changed` is logged only when the public ip:port changes, not when only the STUN server tag flips (`cf=` to `g=` with the same address).
  - A failed DNS probe is re-checked the next second (like TCP), so one lost DNS reply no longer counts as a 2 s outage.
- **Machine:** rebuilt `netbug.exe` and restarted the `netbug` task.
- `AGENTS.md` LOG ANALYSIS: no fix is applied on purpose; expect `gw_arp=dynamic`. Each outage is compared with the 05:34 signature, and a fix is proposed and applied only with the user's OK.
- Docs: incident report §1/§8, RCC report, scan report (finding #9, §11 removal entry, §12), and README (pin not applied, DNS retry).

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
