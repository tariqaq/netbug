# tts5.py - narration for the v5 film: narration-v5.json -> public/vo5/<id>.wav + public/vo5/timing.json.
#
# 1. Voice: Microsoft Edge neural voice `voice` (en-US-AndrewMultilingualNeural) through edge-tts (needs internet).
#    Each line can set its own `rate` and `pitch` to direct the delivery (slower and lower on the heavy beats).
# 2. Studio chain (ffmpeg): rumble cut, warmth, less mud, presence, de-essing, gentle compression, an exciter to rebuild
#    the highs the 24 kHz source lacks, air, a peak limiter, 48 kHz 24-bit. Nothing in it shifts the audio by more than
#    1 ms, so word timings stay valid.
# 3. Timing: the voice reports where every spoken word starts and ends (WordBoundary). Spoken words (`say`) are matched
#    to the caption words (`text`) after normalising both (digits spelled out, respellings undone), so a caption word
#    like "5:34" gets the times of "five thirty-four".
#
# Run: .venv/Scripts/python scripts/tts5.py [line ids...]
# With line ids, only those lines are generated; every other line keeps its entry in timing.json.
# Needs: edge-tts, ffmpeg and ffprobe on PATH (or the FFMPEG / FFPROBE env vars).

import asyncio, os, re, sys, json, difflib, shutil, subprocess
import edge_tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "vo5")
CFG = json.load(open(os.path.join(ROOT, "narration-v5.json"), encoding="utf-8"))
FFMPEG = os.environ.get("FFMPEG") or shutil.which("ffmpeg") or r"C:\Program Files\FFmpeg\bin\ffmpeg.exe"
FFPROBE = os.environ.get("FFPROBE") or shutil.which("ffprobe") or r"C:\Program Files\FFmpeg\bin\ffprobe.exe"

STUDIO = ",".join([
    "highpass=f=75",
    "equalizer=f=170:t=q:w=0.9:g=2.5",       # chest warmth
    "equalizer=f=380:t=q:w=1.2:g=-2.5",      # mud
    "equalizer=f=3200:t=q:w=1.0:g=2.5",      # presence
    "deesser=i=0.3",
    "acompressor=threshold=-21dB:ratio=3:attack=6:release=90:makeup=3",
    "aresample=48000",
    "aexciter=amount=1.5:drive=6:freq=6000",  # rebuilds the highs the 24 kHz source lacks
    "highshelf=f=9000:g=2",                  # air
    "volume=-1dB",
    "alimiter=limit=0.75:attack=1:release=50:level=false",  # peaks under -2.5 dBFS
])

WORDNUM = {"0": "zero", "3": "three", "5": "five", "6": "six", "9": "nine", "10": "ten", "28": "twenty-eight", "31": "thirty-one",
           "34": "thirty-four", "37": "thirty-seven", "42": "forty-two", "71": "seventy-one", "5000": "five thousand"}


def norm_words(s):
    """Lower-case words for matching: digits spelled out, respellings undone, punctuation dropped, hyphens split."""
    s = s.lower().replace("net-bug", "netbug").replace("micro-tik", "mikrotik").replace("hot-spot", "hotspot").replace("a.r.p.", "arp")
    s = re.sub(r"(\d+):(\d+)", lambda m: f"{m.group(1)} {m.group(2)}", s)
    s = s.replace(",", "")
    out = []
    for w in re.findall(r"[a-z0-9']+", s.replace("-", " ")):
        out += WORDNUM.get(w, w).replace("-", " ").split() if w.isdigit() else [w]
    return out


def time_words(line, heard):
    """Give every caption word (`text`) a start and end in ms from the spoken words that match it."""
    shown = re.findall(r"\S+", line["text"])
    runs, flat = [], []
    for w in shown:
        n = norm_words(w)
        runs.append((len(flat), len(flat) + len(n)))
        flat += n
    sm = difflib.SequenceMatcher(a=flat, b=[w for w, _, _ in heard], autojunk=False)
    t = [None] * len(flat)
    for blk in sm.get_matching_blocks():
        for k in range(blk.size):
            t[blk.a + k] = heard[blk.b + k][1:]
    known = [i for i, x in enumerate(t) if x]
    for i in range(len(t)):      # unmatched words: spread evenly between their matched neighbours
        if t[i]:
            continue
        lo = max([k for k in known if k < i], default=None)
        hi = min([k for k in known if k > i], default=None)
        a = t[lo][1] if lo is not None else 0.0
        b = t[hi][0] if hi is not None else (heard[-1][2] if heard else a + 300)
        span = [k for k in range(len(t)) if (lo is None or k > lo) and (hi is None or k < hi)]
        j, step = span.index(i), (b - a) / max(1, len(span))
        t[i] = (a + j * step, a + (j + 1) * step)
    words = []
    for w, (a, b) in zip(shown, runs):
        if a != b:
            words.append({"text": w, "start": round(t[a][0]), "end": round(t[b - 1][1])})
    return words, sm.ratio()


async def speak(line):
    said = line.get("say", line["text"])
    comm = edge_tts.Communicate(said, CFG["voice"], rate=line.get("rate", CFG["rate"]), pitch=line.get("pitch", CFG["pitch"]), boundary="WordBoundary")
    raw = os.path.join(OUT, line["id"] + ".raw.mp3")
    heard = []
    with open(raw, "wb") as f:
        async for ch in comm.stream():
            if ch["type"] == "audio":
                f.write(ch["data"])
            elif ch["type"] == "WordBoundary":
                s = ch["offset"] / 10000                      # 100 ns units -> ms
                toks = norm_words(ch["text"])
                step = ch["duration"] / 10000 / max(1, len(toks))
                heard += [(w, s + k * step, s + (k + 1) * step) for k, w in enumerate(toks)]
    out = os.path.join(OUT, line["id"] + ".wav")
    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", raw, "-af", STUDIO, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s24le", out], check=True)
    os.remove(raw)
    words, match = time_words(line, heard)
    ms = round(float(subprocess.run([FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out],
                                    capture_output=True, text=True, check=True).stdout) * 1000)
    speech = min(ms, words[-1]["end"] + 60)
    print(f"{line['id']:<10} {speech / 1000:5.2f} s  match {match:.3f}", flush=True)
    if match < 0.95:
        print(f"!! {line['id']}: spoken words don't match the caption well ({match:.3f})", flush=True)
    return {"id": line["id"], "text": line["text"], "ms": ms, "speech": speech, "match": round(match, 3), "words": words}


async def main():
    os.makedirs(OUT, exist_ok=True)
    only = set(sys.argv[1:])
    tpath = os.path.join(OUT, "timing.json")
    old = {l["id"]: l for l in json.load(open(tpath, encoding="utf-8"))["lines"]} if os.path.exists(tpath) else {}
    lines = []
    for line in CFG["lines"]:
        if only and line["id"] not in only:
            if line["id"] in old:
                lines.append(old[line["id"]])
            continue
        lines.append(await speak(line))
    json.dump({"voice": CFG["voice"], "lines": lines}, open(tpath, "w", encoding="utf-8"), indent=1)
    print("speech total", round(sum(l["speech"] for l in lines) / 1000, 1), "s")


asyncio.run(main())
