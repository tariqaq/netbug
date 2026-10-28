# 🎬 Incident explainer video

A 2-minute narrated explainer (1920×1080, 30 fps) of the two ARP-spoofing attacks on 2026-10-28 (05:34 and 15:28) and the gateway-pin fix, for residents and the hostel RCC.

Rendered with [kinetograph](https://github.com/0xS4N4TG/kinetograph) 0.2.0 (TypeScript/React video engine, GPU renderer).

| File | What |
|---|---|
| `incident-redacted.mp4` | 🔒 The committed render: MACs shown as `xx-…` |
| `src/index.tsx` | The whole film: scenes, captions, sound effects |
| `narration.json` | The narration script: voice, rate and one entry per line (`say` = respelling for pronunciation) |
| `scripts/tts.py` | Turns `narration.json` into `public/vo/<id>.mp3` + `public/vo/timing.json` (word timings) |
| `public/vo/` | Generated narration audio and timings |
| `data.example.json` | Values shown on screen, redacted (the default props) |
| `data.local.json` | The same with real MACs: **gitignored**, used for the full local render that goes to the RCC |

## How it stays in sync

`timing.json` gives every narration line its length and every word its start time. `src/index.tsx` places each line at a fixed frame and keys animations to words (`at('a1_3', '71')` is the frame where "71" is spoken). Captions show up to ~11 words at a time and highlight the word being spoken. Changing the script and re-running `tts.py` re-times the whole film.

## Build

```sh
npm ci                                            # kinetograph + types (node_modules is gitignored)
python -m venv .venv && .venv/Scripts/python -m pip install edge-tts
.venv/Scripts/python scripts/tts.py               # narration: Microsoft Edge neural voice (en-US-AndrewNeural), needs internet

npx kinetograph check src/index.tsx               # types
npx kinetograph strip src/index.tsx -n 24 -o out/strip.png   # contact sheet

# render on the NVIDIA GPU: frames via Vulkan, H.264 via NVENC (the bundled ffmpeg has no NVENC, so point at one that does)
export KINETOGRAPH_FFMPEG="C:\path\to\ffmpeg.exe"
npx kinetograph render src/index.tsx -o out/incident-redacted.mp4 --encoder h264_nvenc --video-bitrate 10M --concurrency 2
npx kinetograph render src/index.tsx -o out/incident-full.mp4 --encoder h264_nvenc --video-bitrate 10M --concurrency 2 --props "$(tr -d '\n' < data.local.json)"
```

On an RTX 4060 Laptop GPU, a full render takes ~27 s (~7.5 ms per frame) with little CPU. Audio: -17.3 LUFS integrated, true peak -2.2 dB, no clipping.

Fonts (Inter, JetBrains Mono) are downloaded from Google Fonts on the first render and cached by kinetograph. Sound effects are synthesized in `src/index.tsx` (Web Audio), nothing downloaded.
