# tts.py - turns narration.json into one MP3 per line (public/vo/<id>.mp3) plus
# public/vo/timing.json: each line's duration and its words with start/end times in ms.
# The video reads timing.json, so scene lengths and subtitles follow the real speech.
# Uses Microsoft Edge's neural voices through edge-tts (needs internet).
# Run: .venv/Scripts/python scripts/tts.py

import asyncio, json, os, re, subprocess, shutil
import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "vo")


def duration_ms(path):
    probe = shutil.which("ffprobe")
    out = subprocess.run([probe, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout
    return round(float(out.strip()) * 1000)


async def speak(line, voice, rate):
    spoken = line.get("say", line["text"])
    comm = edge_tts.Communicate(spoken, voice, rate=rate, boundary="WordBoundary")
    path = os.path.join(OUT, line["id"] + ".mp3")
    tokens = []
    with open(path, "wb") as f:
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
    return {"id": line["id"], "text": line["text"], "ms": duration_ms(path), "words": words}


async def main():
    with open(os.path.join(ROOT, "narration.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    os.makedirs(OUT, exist_ok=True)
    timing = [await speak(l, cfg["voice"], cfg["rate"]) for l in cfg["lines"]]
    with open(os.path.join(OUT, "timing.json"), "w", encoding="utf-8") as f:
        json.dump({"voice": cfg["voice"], "lines": timing}, f, indent=1)
    total = sum(t["ms"] for t in timing)
    print(f"{len(timing)} lines, {total / 1000:.1f} s of speech")
    for t in timing:
        print(f"  {t['id']:<9} {t['ms'] / 1000:5.2f} s  {len(t['words'])} words")


asyncio.run(main())
