# Incident video v5: plan, storyboard and tracker

Resume point for any new session: read this file top to bottom, then continue from the first unchecked box in **Progress**. Tick boxes and add a log line (system-clock time) after every finished step.

- Created: 2026-11-01 19:50 MYT
- Base: v4 (`src/`, 2:22, 30 fps, 2D). v4 stays as it is; v5 is a new film in `src/v5/`.

## Brief (user, 2026-11-01)

- Cover **all** incidents: 05:34 and 15:28 on 10-28 (this laptop), and the friend's laptop (10-28 to 11-01).
- Story: what happened, then the fix (netbug), then how netbug solves it, then prevention.
- **Full 3D scenes**, full creative freedom.
- ~3:00, a few seconds more if the pacing needs it.
- A realistic voice with personality, clear audio, not computer-sounding.
- 1080p, 60 fps, H.265 (unless H.264 is better), rendered fully on the RTX 4060.

## Decisions (user answers, 2026-11-01)

| Question | Answer |
|---|---|
| 3D style | **Night-to-dawn diorama**: the hostel as a glowing miniature at night; attacks red and dark; the fix brings sunrise |
| Voice | First cut: Qwen3-TTS "host" clone (bake-off sample 03). After watching it, the user found it too high and asked for the v4 narrator back with more personality → **Edge `en-US-AndrewMultilingualNeural`, directed per line** (`rate`/`pitch` in `narration-v5.json`). |
| Music | **Upgraded synth score** (code-synthesized, cut to the picture) |
| Publish | **Local only for now** (`video/out/`); nothing pushed until the user has watched it |
| Length (revision) | **Hard cap under 3:30**; slower pacing so every panel can be read |
| Tone | **Wry documentary**: serious and gripping, with a dry human edge; credible for the RCC |
| Attacker | **A device, not a person**: a dark faceted object in a red room that swallows light, labelled MAC/IP (redacted in the public cut) |
| Prevention | All four: residents run netbug, hostel IT fixes, quick self-help, honest limits |
| End card | Repo URL + **QR** to the latest release |

## Engine facts (checked on this machine, kinetograph 0.2.5)

- `<Scene3D>` is native: perspective camera, ambient/directional/point lights (max 8), shadows (directional `castShadow`), PBR materials (`metallic`, `roughness`, `emissive`, `opacity`, `unlit`), primitives (box, sphere, plane, cylinder, torus), `<Text3D>` with bevel, `<Extrude>` (SVG path), `<Group3D>`, glTF `<Model>`, equirectangular `environment` (IBL). Layer effects (`glow`, `chromaticAberration`, `motionBlur`) apply to the 3D layer.
- Not in the React wrapper: fog, spot lights. Haze is faked with 2D gradient layers and point-light `range`.
- Root must be `<Layer>`, not `<AbsoluteFill>` (AbsoluteFill lays children out as a flex column).
- Test scene (24 shadowed boxes, torus, 3D text, extrude, glow), 1080p60: **~15 ms/frame**, `hevc_nvenc` in `.mp4` tagged `hvc1`. A 3:10 film (~11,400 frames) ≈ 3 min.
- GPU for the picture: frames by Skia GPU (Vulkan), encode by `hevc_nvenc`. The CPU only builds the scene graph per frame.
- System ffmpeg `C:\Program Files\FFmpeg\bin\ffmpeg.exe` has `hevc_nvenc` (set `KINETOGRAPH_FFMPEG`).

## Story (target ~3:05)

Storyboard below; line ids in brackets. The narration here is the draft: the final wording is in `narration-v5.json`.

### Cold open (~0:00–0:14)
Black. Wind and room tone. The camera drifts down through darkness onto the hostel diorama at night: a cut-away block of rooms, warm windows, glowing cable runs to a basement router. A clock ticks from 05:33:59 to **05:34:03**.
- [cold1] "Five thirty-four in the morning. The hostel is asleep. And somewhere in this building, one device is about to tell a lie."
- Hit. Title (2D, per-character reveal, red rule): **WHO'S THE ROUTER?** with a small subtitle "the netbug incident files".

### Act I: How it should work (~0:14–0:38)
Camera pushes into your room (a desk, a laptop as a lit slab). The laptop sends a broadcast: a ring of light expands across the whole floor ("who has 10.255.31.254?"). The basement MikroTik (dark box, blinking LEDs) answers with a beam; a note label pins to the laptop: `router = xx-xx-…` (real MAC only in the full cut). Packets (glowing orbs) flow down the cable to the router and up into the sky.
- [how1] "Before your laptop sends anything to the internet, it asks the whole network one question: who's the router?"
- [how2] "The real one, a MikroTik downstairs, answers with its hardware address. Your laptop writes it down, and sends everything there."
- [how3] "Here's the catch. Nobody checks that answer. Whoever replies... gets believed."

### Act II: 05:34 (~0:38–1:12)
Chapter card: **I · 05:34**. A room two floors over turns red. In it, the impostor: a black faceted gem that eats light. Red rings pulse out; a red speech bubble pops above it: "I am the router." The laptop's note flips red (`router =` the impostor's MAC, redacted in the public cut). Packets now bend away from the basement and fall into the gem; they vanish. Two more rooms flicker red (other victims). A capture panel: **71 out · 0 back**.
- [a1_1] "At five thirty-four and three seconds, a device on this network started replying: I am the router."
- [a1_2] "The laptop believed it. So did two others nearby."
- [a1_3] "Seventy-one packets went out. Zero came back."
Symptoms: floating glass panels around the laptop: Discord ping 5000 ms, a mic icon (you can hear them, they can't hear you), a browser spinner that never stops.
- [sym1] "From the inside, it looks like this. Discord at five thousand milliseconds. Your friends talk; you hear them. They can't hear you. Pages load... forever."
- [sym2] "No error message, either. An error needs a reply. Nothing replies."
The cable is pulled (its end drops off the desk); a phone hotspot lights up beside the laptop; packets flow again.
- [a1_end] "Pulling the cable ended it: the laptop jumped to a phone hotspot, a different network, and the internet came straight back. A little monitor called netbug had recorded every second."

### Act III: 15:28 (~1:12–1:42)
A digital clock runs from 05:36 to 15:28. Chapter card **II · 15:28**.
- [a2_1] "Ten hours later, at three twenty-eight in the afternoon, it happened again."
Three slams, each a hard cut and a stamp: the MAC tag, the IP tag, the speech bubble.
- [a2_dev] "Same device." [a2_addr] "Same address." [a2_lie] "Same lie."
- [a2_count] "Forty-two packets out. Zero back. Four more devices lost the router."
A red searchlight sweeps the building and stops on a room that was hit in the morning; a label "who has 10.255.23.47?" hangs in the beam.
- [a2_hunt] "And this time, the capture caught it shopping for a victim: looking up a device it had already cut off that morning."
- [a2_verdict] "Not a broken router. Not a bad cable. Someone is doing this. On purpose."

### Act IV: The friend's laptop (~1:42–2:02)
Chapter card **III · four days**. Camera glides down the corridor to another room: a second laptop. A five-day timeline (10-28 → 11-01) fills with six red outages; the longest is bracketed: **37 min**.
- [f1] "It wasn't just one laptop. A friend's laptop down the hall ran netbug too, for four days."
- [f2] "Every time it plugged in, the impostor was already waiting. Six outages. The longest: thirty-seven minutes."

### Act V: The fix, netbug (~2:02–2:42)
Dawn begins: the key light warms and rises, the sky gradient goes from navy to amber. The netbug badge pops up over the desk.
- [fix0] "So netbug grew teeth."
1. **Watch:** a radar ring sweeps under the laptop, logging every claim.
   - [fix1] "It watches every second, and logs any device claiming to be the router, even while you're protected."
2. **Test and pin:** A test packet runs to each candidate. The real router answers "TTL expired" as itself (green); the impostor can't (red). A pushpin drives into the desk beside the laptop; fake replies now bounce off a glass shield.
   - [fix2] "Press Test and pin. A real router passes traffic and answers as itself; the impostor can't. The real address gets pinned, and fake replies just bounce off."
3. **Announce:** a heartbeat pulse runs from the laptop to the router once a second; the router's poisoned card for the laptop flips back to green.
   - [fix3] "The attacker can also lie to the router about you. So netbug reminds the router who you are. Every second."
4. **Result:** on the friend's laptop, the timeline turns green.
   - [fix4] "On the friend's laptop: pinned at six thirty-one that evening. The next nine minutes: zero failures."

### Act VI: Prevention (~2:42–3:05)
Full daylight. Quick panels:
- [prev1] "If the internet freezes with no error, and everyone around you drops too: switch to a hotspot. The impostor can't follow you there."
- [prev2] "Better: run netbug, and press Test and pin."
- [prev3] "But a pin protects one laptop. The real fix belongs to the hostel."
Glass walls rise between every room (client isolation); a gate at the switch scans each ARP reply (ARP inspection).
- [prev4] "Find this device on the MikroTik. Then turn on client isolation and ARP inspection, so a lie like this never gets through again."
End card: the diorama in morning light, dimmed; `github.com/tariqaq/netbug` and a flat 2D QR code (so it scans) to `/releases/latest`.
- [end] "Know who your router is."

### Fact check (sources: incident report §1, §5, §6, §11, §12; README Router protection)
- 05:34:03, 71 out/0 back, 2 other devices, unplug 05:36:35 → Wi-Fi: §1, §5.3. 150 s.
- 15:28:44–54 change, 42 out/0 back, 3 spoofed replies, 4 other devices, victim lookup of 10.255.23.47 (a 05:34 victim): §11.
- Friend: 6 wired joins cut off (10-28 22:55, 23:10; 10-29 01:32; 11-01 07:06, 17:45, 18:28), longest 2,228 s (37 min), pinned 18:31:06, then 18:31:10–18:40:13 zero gateway/Google/DNS/TCP failures: §12. Note: netbug's old `delete neighbors interface=` bug made some of those outages longer (§12 bug 1); the attack itself caused them. The film doesn't go into it.
- "Answers as itself" = the TTL-1 ping comes back "TTL expired" from the gateway IP (README, Check now).
- Announce ≈ 1/s (README, Keep the router updated). Limits: one laptop; the router side needs the switch (README, Limits).
- Hotspot is a different network, so the spoofer can't reach it: §6.

## Look

- **World:** a 4-storey cut-away block (6 rooms per floor, front wall removed) on a slab of city cut like a cake, so the basement (MikroTik, switch, ONT) shows in cross-section. Furnished rooms (bed, desk, chair, shelf, rug, curtains, ceiling fan), a roof with tank, AC units and aerial, a street with lamps, trees, parked and passing cars, a utility pole, and an ISP mast on the skyline. One cable system runs from every desk through the ceiling runs and riser to the switch and router, out through the ONT and a conduit to the pole and the mast. All procedural primitives; no downloaded models.
- **Type:** all titles, chapter cards, the speech bubble, counters and the netbug badge are 2D layers (crisp), never 3D text.
- **Light:** night = navy ambient, cool moon key from above, warm window glow (emissive), red point lights for attacks. Dawn = an amber key that rises, ambient goes warm, sky gradient behind (2D layer) and a generated equirectangular environment for reflections (written by a script, not downloaded).
- **Camera:** every shot moves (dolly, crane, orbit), eased; a slight handheld drift from smooth noise; a long-lens push for reveals. Hard cuts on slams.
- **Labels:** small crisp 2D text pinned to 3D points by projecting through the same camera (one `project()` helper), so labels stay sharp and readable.
- **Captions:** word-highlighted, bottom centre, as v4.
- **Grade:** vignette, a little bloom (`glow`) on emissives, `chromaticAberration` only on hits.

## Sound

- **Voice:** Microsoft Edge `en-US-AndrewMultilingualNeural` via edge-tts, per-line rate and pitch; studio chain (as v4), 48 kHz 24-bit. Word timings from the voice's own word boundaries, matched to the caption words.
- **Score:** new synth score (`src/v5/score.ts`): night = low drones, sparse piano-like plucks, ticking; attacks = sub pulses and braams; friend = a held, lonely pad; fix = rising arpeggio and a warm major resolve at the sunrise; end = open chord. Ducks under the voice.
- **SFX:** synthesized (`src/v5/sound.ts`): broadcast ping, packet ticks, swallow (reverse whoosh), card flip, stamp hits, clock spin, cable unplug, pin drive (metal thunk), glass shatter, radar sweep, heartbeat announce, walls rising.
- **Mix:** the render's PCM mix goes through a 2-pass ffmpeg `loudnorm` (linear) to -14 LUFS integrated, true peak -1.4 dBTP measured; AAC 320 kbit/s, 48 kHz stereo.

## Output

- `out/incident-v5-redacted.mp4` (public-safe MACs) and `out/incident-v5-full.mp4` (real MACs, `data.local.json`).
- H.265 via `hevc_nvenc` (`--crf 18`, constant quality), 1080p60, 8-bit yuv420p (NVENC rejects `yuv420p10le` as passed by kinetograph), `hvc1` tag. ~15.7 Mbit/s, ~405 MB per file. H.265 over H.264: half the size at the same quality for this kind of picture, and it plays in all current browsers, Windows, macOS, iOS and Android.
- Local only until the user OKs publishing.

## Files

| File | What |
|---|---|
| `src/v5/index.tsx` | The film: timeline, shots, captions, cues |
| `src/v5/world.tsx` | The diorama (building, rooms, laptop, router, impostor, cables, packets) and `project()` |
| `src/v5/look.tsx` | Sky, haze, vignette, letterbox, label chips, captions (chapter cards and the end card are in `index.tsx`) |
| `src/v5/sound.ts`, `src/v5/score.ts` | SFX and score |
| `narration-v5.json` | Script and per-line delivery |
| `scripts/tts5.py` | Edge Andrew Multilingual, studio chain, word-boundary timings → `public/vo5/` |
| `public/vo5/` | Narration clips and `timing.json` |
| `scripts/render5.ps1` | Final renders (redacted + full), loudnorm, AAC, hvc1 mux |

## Progress

- [x] Engine check: 3D, 60 fps, `hevc_nvenc` (19:40)
- [x] Questions answered (19:45)
- [x] TTS installs: Qwen venv (`.venv-qwen`, torch 2.11 cu128). Chatterbox dropped after the pick (its torch download stalled; venv removed).
- [x] Voice bake-off → user picked **03 Qwen host** (20:20)
- [x] Final script + TTS + alignment → `public/vo5/timing.json`
- [x] World build: building, rooms, router, laptop, impostor, cables, packets
- [x] Shots per act (stills reviewed per act)
- [x] Sound design + score
- [x] Full contact sheet review, pacing pass
- [x] Render redacted + full, loudness check, watch-through checks
- [x] Docs: `video/README.md`, CHANGELOG

Revision 1 (after the user watched the first cut):

- [x] Voice: back to Edge Andrew, `en-US-AndrewMultilingualNeural`, directed per line; script trims
- [x] World rebuilt: one consistent cable system (no wall clipping), furnished rooms, street, traffic, roof, sky with moon and clouds
- [x] Type: titles, bubble, counters and the netbug badge in 2D; friend timeline realigned; label chips clamped above captions
- [x] Slower pacing (longer pauses) under the 3:30 cap
- [x] Render, checks, docs, CHANGELOG

Revision 2 (camera and readability):

- [x] Sightline check (`NETBUG_CAMCHECK=1`, `sightBlocked()` in `world.tsx`); every close shot of the impostor reframed through the room's open front; glides through the building replaced by cuts
- [x] The trap shot (71 and 42 out): the impostor's room front-on, a dense packet flow down the drop into the gem, an `in N · out 0` tag
- [x] 15:28: the four other rooms and this laptop labelled; morning victim labels matched to `victims1` order
- [x] Render, checks, docs, CHANGELOG

## Log

- 19:40 3D test scene renders on the 4060 (~15 ms/frame at 1080p60, hevc_nvenc).
- 19:45 User answers recorded above.
- 20:05 Bake-off: Edge Andrew (v4), Edge Andrew Multilingual, Qwen baritone/host/alto/Ryan; Whisper check: all say the script word for word.
- 20:20 User picked 03 Qwen host. Narration generation started (`scripts/tts5.py`, 3 takes max per line, Whisper picks the best).
- 20:00 Film skeleton renders end to end on placeholder timing (`src/v5/`).
- 20:25 BSOD (vgk.sys, Riot Vanguard, while VALORANT ran) stopped TTS after 2 lines; files checked intact, TTS resumed.
- 21:05 All 30 lines generated: 154 s of speech; every miss is an ASR spelling (micro tick, imposter, 5,000). All word cues resolve.
- 21:10 Film re-timed on real speech: 12,173 frames (3:22.9). Contact sheets reviewed.
- 21:21 Rendered redacted and full (~4.3 min each on the 4060); -14.0 LUFS, true peak -1.3 dBTP; redaction checked on a decoded frame.
- 22:25 Revision 1 done. User feedback on the first cut: narrator too high, friend timeline misaligned, world half-built, cable through a wall, too fast to read, 3D title text looks off; cap under 3:30. Narration regenerated with Edge Andrew Multilingual (30 lines, all words matched, 150.6 s of speech); world, type and pacing reworked; stills and contact sheets reviewed. Rendered redacted and full (~11 min each, heavier world): 12,350 frames (3:25.9), -14.0 LUFS, true peak -1.4 dBTP; redaction checked on a decoded frame.
- 23:04 Revision 2 done. User feedback: close shots of the impostor stared at walls (0:41, 1:28, 1:51), the 71/42 shots didn't show packets going in and nothing out, the 15:28 wide shot was too far, and the four other victims weren't identifiable. Added the sightline check, reframed every impostor shot front-on, cut instead of gliding through the building, added the trap shot and victim labels. Rendered both cuts (~14.5 min each): 3:25.9, -14.0 LUFS, true peak -1.4 dBTP; redaction checked on a decoded frame.
