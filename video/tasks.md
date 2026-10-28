# Incident video: task tracker (v3 cinematic cut, v4 revision)

Resume point for any new session: read this file top to bottom, then continue from the first unchecked box in **v4 progress** (v3 is done). Update this file **immediately** after every finished step (tick the box, add a log line with system-clock time).

- Created: 2026-10-28 17:13 MYT
- Status: **v4 IN PROGRESS** (v3 done and pushed as `68d877a`)
- Base: v2 (`eac8d45`), `src/index.tsx`, 3582 frames (1:59.4), 18 narration lines

## Goal

Same facts as v2 (both attacks of 2026-10-28 in full detail, the pin fix, the RCC ask), told like a true-crime documentary: darker, tenser, with real camera motion, impact moments, silence before reveals, a scored soundtrack and layered sound design. Must stay readable for the RCC: drama supports the facts, never hides them.

## Decisions (user answers, 2026-10-28)

- **Q1 = (a)** synthesized score. If it doesn't feel good, the user will say so and we switch to a royalty-free track.
- **Q2 = keep ~2:00.** Longer gets boring/skipped. Cold open and chapter cards must be short; trim pauses to fit.
- **Q3 = different voice.** Tell the user which voice was used.
- **Q4 = tasteful documentary:** only *slightly* more cinematic and dramatic than v2.

## Original questions

- **Q1 Music:** (a) synthesized score in Web Audio, cut exactly to the picture, no download or licence (recommended); (b) a downloaded royalty-free track (needs a download OK per file, plus licence check); (c) both: synth hits and drones over a downloaded bed.
- **Q2 Length:** keep ~2:00, or allow ~2:15–2:30 for pauses and silence before the big moments.
- **Q3 Voice:** keep Andrew, slower and graver (rate +0%, lines split for pauses), or try another Edge voice (Christopher, Guy, Ryan en-GB). Samples can be made first.
- **Q4 Intensity:** "true-crime documentary" (tasteful: grain, slow push-ins, a few hard hits; recommended for the RCC) or "full trailer" (heavy braams, shake, glitch on every beat).

## Toolbox (checked in kinetograph 0.2.0 on this machine)

- Visual effects (`@kinetographdev/scene`): `grain`, `chromaticAberration`, `blur`, `glow`, `brightness`, `contrast`, `saturate`, `gradientMap`, `lut`, `displace`, `shader`, `motionBlur`; core: `Camera` (perspective, x, y), `CameraMotionBlur`, `Trail`, `Noise`, `MeshGradient`, `lightLeak`, `starburst`, datamosh, `GlslShader`.
- Audio: `<Audio volume={(f) => …}>` (per-frame volume, so music ducking under the voice works), `loop`, `trimBefore`; `onFrame` gives a node-web-audio-api `OfflineAudioContext` (oscillators, filters, gain, buffer sources; convolver, compressor and waveshaper to be verified in P2).
- Bundled `sfx` exports are remote meme/UI wavs on remotion.media: **not used** (licence unclear, tone wrong).

## Creative plan

### Look
1. Grade: pure black stays; add subtle animated film `grain`, a soft vignette, and a slight `contrast` lift. `chromaticAberration` only on impact frames.
2. Letterbox bars (2.39:1) slide in for the cold open, both attack reveals and the "Same lie" beat, then slide out.
3. Camera: slow push-in on every scene (2–4%), deterministic noise shake on impacts (decays in ~10 frames), whip-pan transitions with motion blur between chapters.
4. Depth: a dim parallax dot grid and drifting dust (`Noise`) behind the network map.
5. Transitions: hard cut to black on hits, whip pans between chapters, a short datamosh/RGB-split glitch when the impostor says "I am the router".

### Story beats (narration mostly as v2, re-timed with pauses)
1. **Cold open (new):** black, a clock ticks, "05:34:03" types in, a single heartbeat, the connection line flatlines. Hit. Title: "Two attacks in one day."
2. **Chapter card:** "PART I — 05:34" with a riser and hit.
3. **Normal network:** calm pad, packets as light streaks with `Trail`, camera drifts.
4. **Attack 1:** the lights dim, a red spotlight on the impostor, "I am the router" bubble with a glitch, a braam; victims turn red one by one with low thuds.
5. **71 out / 0 back:** a big counter, an EKG line that flatlines, a sustained tone, then silence.
6. **Symptoms:** Discord 5000 ms, pages loading forever (spinner), ticking clock bed.
7. **Timeline 1:** 2.5 minutes as a scrubbing timecode, cable pulled with a cut-to-black hit.
8. **Test:** quiet, "we removed the protection and waited", a clock montage from 05:50 to 15:28.
9. **Chapter card:** "PART II — 15:28". Riser, hit.
10. **Attack 2:** "Same device." "Same address." "Same lie." as three slams with hard cuts and hits; 42 out, 0 back; 4 victims; the attacker's lookup of a morning victim as a "callback" reveal.
11. **Compare:** split screen 05:34 vs 15:28, each matching row stamps "MATCH" with a hit; the final "on purpose" line lands in silence.
12. **Fix:** the pin locks in (lock click, then a shield), red resolves to green, the music resolves to a major chord; honest caveat beat (only this laptop, outgoing only).
13. **RCC call to action + end card:** steady pulse, clear steps, a fade on a held chord.

### Sound
- **Score (if Q1 = a or c):** synthesized, cut to scenes: low detuned drone pad, a ticking/pulse ostinato in the attack scenes, braams (distorted low saws), risers (noise sweep plus a pitch climb) into hits, sub drops, a resolving chord at the fix. Reverb from a generated impulse response.
- **SFX:** layered impacts (sub thump, noise crack, reverb tail), filtered-noise whooshes, glitch bursts (bit-crush), packet ticks, heartbeat and EKG flatline, typewriter clicks on timestamps, lock click, faint room tone.
- **Mix:** music ducks ~8 dB under the narration (from word timings), silence before big hits, master compression. Target -16 LUFS integrated, true peak ≤ -1.5 dB, checked with `kinetograph audio analyze`.

## Build plan (files)

- `src/index.tsx`: the film (v3 replaces v2 in place; v2 stays in git history, tag `video-v2` on `eac8d45`).
- `src/sound.ts` (new): SFX synth library (impact, braam, riser, whoosh, glitch, tick, heartbeat, flatline, lock, reverb IR).
- `src/score.ts` (new): the score, built from scene start frames.
- `src/cinema.tsx` (new): grade layer, letterbox, camera rig and shake, whip-pan and glitch transitions, chapter cards.
- `narration.json` and `public/vo/*`: re-voiced if Q3 changes the voice or rate.
- If Q1 = b/c: `public/music/<file>` plus a licence note in `video/README.md`.

## v4 (requested 2026-10-28 18:06)

User feedback on v3, all to do:
1. Remove the film grain (barely noticeable).
2. Slower pacing, a bit longer is fine, so title screens and cards don't fly by.
3. Back to the previous narrator (en-US-AndrewNeural). Make him sound like a good studio mic, not computer-generated, with more tone and personality.
4. Background music a bit louder.
5. Don't say "we removed the protection": the protection isn't established at that point in the film. Say we waited for it to happen again.
6. Make clear that when Ethernet is pulled, the laptop switches to a Wi-Fi hotspot and gets internet back (incident report: 05:36:35 and 15:31:31, Wi-Fi took over).

Approach:
- Grain: drop the `grain` effect from the root layer.
- Pacing: longer cold open, title hold, chapter cards (40 -> 60 frames), line gaps and scene tails; target ~2:15-2:25.
- Voice: Andrew, a little slower; per-line `rate`/`pitch` overrides in narration.json for tone (slower and lower on dramatic lines). Studio-mic processing in tts.py with ffmpeg (high-pass, warmth, mud cut, presence, air, de-ess, gentle compression, exciter, 48 kHz). The filters add no delay, so word timings stay valid (check durations).
- Music: MUSIC_LEVEL +3 dB.
- Script: test1 becomes "Then we waited, to see if it would come back."; the PART II card and test chip no longer mention removing protection; the clock runs 05:36 -> 15:28.
- Hotspot: new line after a1_end plus a visual (Ethernet cut, then Wi-Fi hotspot connected, internet back).

## v4 progress

- [x] V4.0 Log the requests and plan here
- [ ] V4.1 narration.json: Andrew, script changes (test1, hotspot line), per-line tone
- [ ] V4.2 tts.py: per-line rate/pitch, studio-mic chain; re-voice; check durations and timing
- [ ] V4.3 index.tsx: no grain, slower pacing, PART II card + test scene text, hotspot visual, new line wiring
- [ ] V4.4 sound.ts: music +3 dB
- [x] V4.5 check, lint, strip, stills (check clean, lint 0 errors; strip + stills reviewed)
- [x] V4.6 Render v4 full + redacted (3 Mbit/s), loudness, spot-check (2:22, -14.8 LUFS, peak -0.9 dBFS, ~55 MB each; redaction checked; voice limiter added after a first render peaked at 0 dBFS)
- [x] V4.7 Docs (video/README, root README, CHANGELOG), commit, push
- [ ] V4.8 Report to the user

## v3 progress

- [x] P0.1 Check the kinetograph effect, camera and audio APIs (17:13)
- [x] P0.2 Write this plan, then stand by (17:13)
- [x] P0.3 Get answers to Q1–Q4 and the go-ahead
- [x] P0.4 Tag v2 (`video-v2` on `eac8d45`, local until the v3 push); v2 renders already in `out/`
- [x] P1.1 Script tightened in `narration.json`: present-tense attack, `a2_dev`/`a2_addr`/`a2_lie`/`a2_count`/`a2_more` slams, `cmp1`/`cmp2`
- [x] P1.2 Voice: **en-US-ChristopherNeural** (news/documentary, "Reliable, Authority") at +10%. Samples of 5 voices in `out/voices/`. `tts.py` now writes `speech` (last word end) per line; 99.5 s of speech
- [x] P2.1 `src/sound.ts` written (all nodes verified in node-web-audio-api; one shared bus per render: reverb, compressor, music ducking). SFX: impact, bigImpact, braam, riser, whoosh, glitch, tick, tock, type, heartbeat, beep, flatline, lock, tink, thud, pop, subdrop, stamp
- [x] P2.2 Stems measured with NETBUG_SOLO quarter-size renders: music -31.4 LUFS, sfx -21.4, mix -17.3 LUFS
- [x] P2.3 `src/score.ts` written: moods dark, calm, tension, clock, wait, tension2, build, resolve, end (D minor to F major); ducking in sound.ts via `setDuck`
- [x] P3.1 `src/cinema.tsx`: vignette, letterbox, camera shake/fringe, ChapterCard (grain goes on the root layer in index.tsx)
- [x] P3.2 Camera: 3% push-in per scene, shake + chromatic fringe on hits (whip pans dropped: tasteful brief)
- [x] P3.3 Chapter cards (PART I/II/III), cold open (ECG flatline), glitch via fringe + sfx
- [x] P4.1 Scenes 1–3 (cold open, Part I card, normal): stills check
- [x] P4.2 Scenes 4–5 (attack 1, 71/0 flatline): stills check
- [x] P4.3 Scenes 6–8 (symptoms, timeline 1, test): stills check
- [x] P4.4 Scenes 9–11 (Part II, attack 2 slams, compare): stills check
- [x] P4.5 Scenes 12–13 (fix, RCC, end card): stills check
- [x] P5.1 Mix: -17.3 LUFS (same as v2; kept rather than limiting up to -16), peak -1.1 dBFS
- [x] P5.2 `check` clean, `lint` 0 errors (13 harmless off-canvas warnings at frame 3195), strip and stills reviewed
- [x] P6.1 GPU render: `out/incident-v3-full.mp4` (data.local.json) and `out/incident-v3-redacted.mp4`
- [x] P6.2 Spot-check frames from both renders (MACs redacted in the redacted one)
- [x] P7.1 Copy the redacted render to `video/incident-v3-redacted.mp4` (git mv from v2)
- [x] P7.2 Update `video/README.md`, the root `README.md` link, and CHANGELOG (system-clock time, hashes)
- [x] P7.3 Commit and push (no co-author): `68d877a`, CHANGELOG hash follow-up; tag `video-v2` pushed
- [x] P7.4 Report to the user: paths, what changed

## Log

Times come from the system clock (`Get-Date`). Entries marked "between 17:13 and 17:43" were not clock-stamped when written.


- 2026-10-28 17:13: plan written; waiting for the user's answers to Q1–Q4.
- 2026-10-28 (between 17:13 and 17:43): user answered: synth score, ~2:00, new voice, tasteful documentary. Go.
- 2026-10-28 (between 17:13 and 17:43): P0–P1 done. Film must schedule lines by `speech` (+ short tail), not `ms` (clips have ~0.83 s trailing silence). Line ids changed: update anchors in `src/index.tsx` (a2_1/a2_2/cmp gone).
- 2026-10-28 (between 17:13 and 17:43): sound.ts, score.ts, cinema.tsx written, not yet type-checked. Next: rewrite src/index.tsx (scenes, timeline with `speech`, hits, score sections, cues), then `npx kinetograph check`.
- 2026-10-28 (between 17:13 and 17:43): src/index.tsx rewritten for v3 (cold open, chapter cards, hits/shake/fringe, grain, vignette, letterbox, score sections, ducking). `kinetograph check` passes. Next: lint, strip, stills, audio test render.
- 2026-10-28 (between 17:13 and 17:43): strip + stills reviewed (`out/strip-v3.png`, `out/stills3/`). Fixed: spotlight too strong, cold-open label over the ECG spike, counter zero in wrong column, off-canvas grid dots. Frame map: scratchpad frames.py. Total 3729 frames = 2:04. Next: first full GPU render `out/v3-test.mp4` for audio check.
- 2026-10-28 (between 17:13 and 17:43): first full render was 0.2 LUFS: (1) synth layers too hot, (2) `setTargetAtTime` on the duck gain blows up in node-web-audio-api. Fixed: per-stem levels (MUSIC_LEVEL, SFX_LEVEL) with per-stem reverb, ducking via anchored linear ramps over merged spans, `NETBUG_SOLO=music|sfx|voice` env to measure stems. Stems: voice -17.4 LUFS, music -42.4 (too quiet, raised ~11 dB), sfx -19.4 (lowered 3 dB). Probe scripts in out/probe/. Next: full mix render + loudness.
- 2026-10-28 (between 17:13 and 17:43): P4 scenes all done and checked in strip/stills. Peak outlier at 'purpose' big impact lowered (0.6). Next: P5.2 check/lint, P6.1 full-res renders.
- 2026-10-28 17:43: final v3 renders done (`out/incident-v3-full.mp4`, `out/incident-v3-redacted.mp4`, -17.3 LUFS, peak -1.1 dBFS, ~54 s each on the GPU); spotlight softened to 0.035; frames checked (redaction correct). Writing docs, then commit and push.
- 2026-10-28 17:44: commit `f70fdc4` push REJECTED: video 181 MB > GitHub 100 MB. Undid the 2 local commits (soft reset). Cause: continuous push-in + animated grain at a 12 Mbit/s cap. Fix: grain is a fixed texture, render at 3 Mbit/s: 49 MB, text still sharp.
- 2026-10-28 17:49: both v3 renders redone at 3 Mbit/s (-17.3 LUFS, peak -1.1 dBFS). Committing and pushing again.
- 2026-10-28 17:49: committed `68d877a`, pushed with tag `video-v2`. Delivered.
- If the user dislikes the synth score: switch to a royalty-free track (ask before downloading; check licence).
- 2026-10-28 18:06: v4 requested (see v4 section). Started.
