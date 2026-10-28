# tts.py - turns narration.json into one MP3 per line (public/vo/<id>.mp3) plus
# public/vo/timing.json: each line's duration, where its speech ends, and its words with start/end times in ms.
# The video reads timing.json, so scene lengths and subtitles follow the real speech.
# Uses Microsoft Edge's neural voices through edge-tts (needs internet). Each line can override the voice's `rate` and
# `pitch` for tone. The raw voice (24 kHz, 48 kbit/s) then goes through STUDIO, an ffmpeg chain that makes it sound like
# a close studio mic: rumble cut, warmth, less mud, presence, de-essing, gentle compression, restored highs, a peak
# limiter, 48 kHz. Nothing in it delays the audio by more than 1 ms, so the word timings stay valid.
# Run: .venv/Scripts/python scripts/tts.py

import asyncio, json, os, re, subprocess, shutil
import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "vo")


STUDIO = ",".join([
    "highpass=f=75",
    "equalizer=f=170:t=q:w=0.9:g=2.5",     # chest warmth
    "equalizer=f=380:t=q:w=1.2:g=-2.5",    # boxy/mud
    "equalizer=f=3200:t=q:w=1.0:g=2.5",    # presence
    "deesser=i=0.3",
    "acompressor=threshold=-21dB:ratio=3:attack=6:release=90:makeup=3",
    "aresample=48000",
    "aexciter=amount=1.5:drive=6:freq=6000",  # rebuilds the highs the 24 kHz source lacks
    "highshelf=f=9000:g=2",                # air
    "volume=-1dB",
    "alimiter=limit=0.75:attack=1:release=50:level=false",  # peaks under -2.5 dBFS (1 ms look-ahead)
])


def studio(raw, out):
    subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-y", "-i", raw, "-af", STUDIO, "-ar", "48000",
                    "-c:a", "libmp3lame", "-b:a", "192k", out], check=True)


def duration_ms(path):
    probe = shutil.which("ffprobe")
    out = subprocess.run([probe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout
    return round(float(out.strip()) * 1000)


async def speak(line, voice, rate, pitch):
    spoken = line.get("say", line["text"])
    comm = edge_tts.Communicate(spoken, voice, rate=line.get("rate", rate), pitch=line.get("pitch", pitch), boundary="WordBoundary")
    path = os.path.join(OUT, line["id"] + ".mp3")
    raw = path + ".raw.mp3"
    tokens = []
    with open(raw, "wb") as f:
        async for chunk in comm.stream():
            if chunk["type"] == "audio":
                f.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 10000          # 100 ns units -> ms
                tokens.append((chunk["text"], start, start + chunk["duration"] / 10000))
    # Subtitles show `text`, the voice reads `say` (same words, respelled for pronunciation). A token
    # can hold several words ("October 28th"): it takes that many subtitle words, sharing its time.
    shown = re.findall(r"\S+", line["text"])
    words, i = [], 0
    for tok, start, end in tokens:
        n = len(tok.split())
        step = (end - start) / n
        for k in range(n):
            if i >= len(shown):
                raise SystemExit(f"{line['id']}: the voice read more words than the subtitle has")
            words.append({"text": shown[i], "start": round(start + k * step), "end": round(start + (k + 1) * step)})
            i += 1
    if i != len(shown):
        raise SystemExit(f"{line['id']}: {len(shown)} subtitle words but the voice read {i}; make 'say' match 'text' word for word")
    studio(raw, path)
    os.remove(raw)
    # ms: the clip's length; speech: where the last word ends (the clip has ~0.8 s of silence after it)
    return {"id": line["id"], "text": line["text"], "ms": duration_ms(path), "speech": words[-1]["end"], "words": words}


async def main():
    with open(os.path.join(ROOT, "narration.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    os.makedirs(OUT, exist_ok=True)
    timing = [await speak(l, cfg["voice"], cfg["rate"], cfg.get("pitch", "+0Hz")) for l in cfg["lines"]]
    with open(os.path.join(OUT, "timing.json"), "w", encoding="utf-8") as f:
        json.dump({"voice": cfg["voice"], "lines": timing}, f, indent=1)
    total = sum(t["speech"] for t in timing)
    print(f"{len(timing)} lines, {total / 1000:.1f} s of speech")
    for t in timing:
        print(f"  {t['id']:<9} {t['speech'] / 1000:5.2f} s  {len(t['words'])} words")


asyncio.run(main())
