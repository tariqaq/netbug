# 🎬 Incident explainer video

A 2-minute narrated explainer (1920×1080, 30 fps, 2:04) of the two ARP-spoofing attacks on 2026-10-28 (05:34 and 15:28) and the gateway-pin fix, for residents and the hostel RCC. The v3 cut is a restrained true-crime documentary: cold open, chapter cards, a synthesized score and layered sound design.

Rendered with [kinetograph](https://github.com/0xS4N4TG/kinetograph) 0.2.0 (TypeScript/React video engine, GPU renderer).

| File | What |
|---|---|
| `incident-v3-redacted.mp4` | 🔒 The committed render (v3): MACs shown as `xx-…` |
| `src/index.tsx` | The film: timeline, scenes, captions, hits, sound cues, score sections |
| `src/cinema.tsx` | The look: vignette, letterbox bars, camera shake and colour fringe on hits, chapter cards |
| `src/sound.ts` | Synthesized sound effects (impacts, horn hits, risers, whooshes, glitches, clock, heartbeat, flatline, lock…) and the mix bus: per-stem levels and reverb, music ducking under the voice, compressor |
| `src/score.ts` | The synthesized score (D minor, resolving to F major at the fix), cut into mood sections that start and stop on scenes |
| `narration.json` | The narration script: voice, rate and one entry per line (`say` = respelling for pronunciation) |
| `scripts/tts.py` | Turns `narration.json` into `public/vo/<id>.mp3` + `public/vo/timing.json` (word timings and where each line's speech ends) |
| `public/vo/` | Generated narration audio and timings |
| `data.example.json` | Values shown on screen, redacted (the default props) |
| `data.local.json` | The same with real MACs: **gitignored**, used for the full local render that goes to the RCC |
| `tasks.md` | Build tracker for the v3 cut: plan, decisions, progress log |

## How it stays in sync

`timing.json` gives every narration line its words' start times and `speech`, where its last word ends (each clip has ~0.8 s of silence after that). `src/index.tsx` places each line at a fixed frame and keys animations, sound effects and score sections to words (`at('a1_3', 'zero')` is the frame where "Zero" is spoken). Captions show up to ~11 words at a time and highlight the word being spoken. Changing the script and re-running `tts.py` re-times the whole film, sound included.

## Look and sound

- **Look:** pure black, a fixed film-grain texture, vignette, a 3% push-in over every scene. Hits shake the camera briefly and fringe the colours (`chromaticAberration`). Letterbox bars for the cold open, title, chapter cards and end card.
- **Voice:** Microsoft Edge neural voice `en-US-ChristopherNeural` (news/documentary style) at +10%.
- **Score:** synthesized pads, drones, a muted bass pulse, plucks and a clock, per scene mood: dark, calm, tension, clock, wait, tension2, build, resolve, end. It ducks about 7.5 dB under the narration.
- **Effects:** all synthesized with Web Audio in `src/sound.ts`, nothing downloaded. Every noise source is seeded, so a render always sounds the same.
- **Mix:** -17.3 LUFS integrated, peak -1.1 dBFS. To measure one stem, set `NETBUG_SOLO=music`, `sfx` or `voice` when rendering (the other stems are muted).

kinetograph features used: native shapes and text (per-character reveals and caption styling), springs and eased interpolation, `glow`, `grain` and `chromaticAberration` effects, radial gradient fills, `motionBlur` on moving packets, `<Audio>` narration clips, Web Audio synthesis through `onFrame` (oscillators, filters, convolver reverb, waveshaper, compressor, stereo panner), Google Fonts loading, and the `check` / `lint` / `strip` / `still` loop.

## Build

```sh
npm ci                                            # kinetograph + types (node_modules is gitignored)
python -m venv .venv && .venv/Scripts/python -m pip install edge-tts
.venv/Scripts/python scripts/tts.py               # narration: Microsoft Edge neural voice (en-US-ChristopherNeural), needs internet

npx kinetograph check src/index.tsx               # types
npx kinetograph strip src/index.tsx -n 24 -o out/strip.png   # contact sheet

# render on the NVIDIA GPU: frames via Vulkan, H.264 via NVENC (the bundled ffmpeg has no NVENC, so point at one that does)
export KINETOGRAPH_FFMPEG="C:\path\to\ffmpeg.exe"
npx kinetograph render src/index.tsx -o out/incident-v3-redacted.mp4 --encoder h264_nvenc --video-bitrate 3M --concurrency 2
npx kinetograph render src/index.tsx -o out/incident-v3-full.mp4 --encoder h264_nvenc --video-bitrate 3M --concurrency 2 --props "$(tr -d '\n' < data.local.json)"
```

On an RTX 4060 Laptop GPU, a full render takes ~54 s (~14 ms per frame, grain, motion blur and the synthesized audio included) with little CPU. At 3 Mbit/s the file is ~49 MB. The bitrate cap matters: the slow push-in changes every pixel every frame, and a 12 Mbit/s cap with animated grain made a 190 MB file (GitHub's limit is 100 MB).

Fonts (Inter, JetBrains Mono) are downloaded from Google Fonts on the first render and cached by kinetograph.

The v2 cut (Andrew voice, no score) is tagged `video-v2` in git.
