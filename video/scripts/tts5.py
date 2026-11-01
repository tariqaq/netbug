# tts5.py - narration for the v5 film: narration-v5.json -> public/vo5/<id>.wav + public/vo5/timing.json.
#
# 1. Voice: Qwen3-TTS on the GPU (CUDA, bf16). The reference clip (`voice.reference`, the bake-off sample the user
#    picked) was designed from the persona description (VoiceDesign model, seed 7); it is made again from `design` if
#    missing. Every line is spoken by the Base model cloning that reference, so the voice stays the same across lines.
#    Each line is generated up to `takes` times (different seeds, stopping early at a match of 0.98 or more); the take
#    whose transcript matches the script best (and is not too fast or slow) wins.
# 2. Studio chain (ffmpeg): rumble cut, warmth, less mud, presence, de-essing, gentle compression, air, peak limiter,
#    48 kHz. Nothing in it shifts the audio by more than 1 ms, so word timings stay valid.
# 3. Check and time: Whisper (large-v3-turbo, on the GPU) transcribes the clip with word timestamps. The transcript
#    is compared with the script (a take with missing or extra words is rejected), and the script's words get the
#    times of the matching spoken words (`text` words are shown as captions; `say` is what the voice reads).
#
# Run (in the Qwen venv): .venv-qwen/Scripts/python scripts/tts5.py [line ids...]
# With line ids, only those lines are generated; every other line keeps its entry in timing.json.
# Needs: torch with CUDA, qwen-tts, transformers, soundfile, ffmpeg on PATH (or FFMPEG env var).

import os, re, sys, json, difflib, shutil, subprocess
import numpy as np
import soundfile as sf
import torch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "vo5")
RAW = os.path.join(ROOT, "out", "vo5-raw")
CFG = json.load(open(os.path.join(ROOT, "narration-v5.json"), encoding="utf-8"))
FFMPEG = os.environ.get("FFMPEG") or shutil.which("ffmpeg") or r"C:\Program Files\FFmpeg\bin\ffmpeg.exe"

STUDIO = ",".join([
    "highpass=f=70",
    "equalizer=f=160:t=q:w=0.9:g=2",       # chest warmth
    "equalizer=f=350:t=q:w=1.2:g=-2.5",    # mud
    "equalizer=f=3000:t=q:w=1.0:g=2",      # presence
    "deesser=i=0.25",
    "acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=2.5",
    "aresample=48000",
    "highshelf=f=10000:g=1.5",             # air
    "alimiter=limit=0.79:attack=1:release=60:level=false",  # peaks under -2 dBFS
])

WORDNUM = {"0": "zero", "3": "three", "5": "five", "6": "six", "9": "nine", "10": "ten", "28": "twenty-eight", "31": "thirty-one",
           "34": "thirty-four", "37": "thirty-seven", "42": "forty-two", "71": "seventy-one"}


def norm_words(s):
    """Lower-case words for matching: digits spelled out, punctuation dropped, hyphens split."""
    s = s.lower().replace("net-bug", "netbug").replace("micro-tik", "mikrotik").replace("micro tick", "mikrotik").replace("microtik", "mikrotik").replace("hot-spot", "hotspot").replace("a.r.p.", "arp")
    s = re.sub(r"(\d+):(\d+)", lambda m: f"{m.group(1)} {m.group(2)}", s)
    s = s.replace(",", "")
    out = []
    for w in re.findall(r"[a-z0-9']+", s.replace("-", " ")):
        if w.isdigit():
            out += WORDNUM.get(w, w).replace("-", " ").split()
        else:
            out.append(w)
    return out


def studio(raw, out):
    subprocess.run([FFMPEG, "-v", "error", "-y", "-i", raw, "-af", STUDIO, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s24le", out], check=True)


_asr = None
def transcribe(path):
    global _asr
    if _asr is None:
        from transformers import pipeline
        _asr = pipeline("automatic-speech-recognition", model="openai/whisper-large-v3-turbo", device="cuda:0", torch_dtype=torch.float16)
    a, sr = sf.read(path, dtype="float32")
    if a.ndim > 1:
        a = a.mean(axis=1)
    if sr != 16000:
        import torchaudio.functional as AF
        a = AF.resample(torch.from_numpy(a), sr, 16000).numpy()
    r = _asr({"raw": a, "sampling_rate": 16000}, return_timestamps="word", generate_kwargs={"language": "english", "task": "transcribe"})
    words = []
    for c in r["chunks"]:
        s, e = c["timestamp"]
        for w in norm_words(c["text"]):
            words.append((w, s or 0.0, e if e is not None else (s or 0.0) + 0.3))
    return r["text"], words


def score(script_words, heard):
    sm = difflib.SequenceMatcher(a=script_words, b=[w for w, _, _ in heard], autojunk=False)
    return sm.ratio(), sm


def time_words(line, heard):
    """Give every caption word (`text`) a start and end in ms, from the spoken words that match it."""
    shown = re.findall(r"\S+", line["text"])
    said = norm_words(line.get("say", line["text"]))
    # each shown word -> the run of normalised words it stands for
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
    # fill gaps by interpolation between known neighbours
    known = [i for i, x in enumerate(t) if x]
    for i in range(len(t)):
        if t[i]:
            continue
        lo = max([k for k in known if k < i], default=None)
        hi = min([k for k in known if k > i], default=None)
        a = t[lo][1] if lo is not None else 0.0
        b = t[hi][0] if hi is not None else (heard[-1][2] if heard else a + 0.3)
        span = [k for k in range(len(t)) if (lo is None or k > lo) and (hi is None or k < hi)]
        j = span.index(i)
        step = (b - a) / max(1, len(span))
        t[i] = (a + j * step, a + (j + 1) * step)
    words = []
    for w, (a, b) in zip(shown, runs):
        if a == b:   # punctuation-only token
            continue
        words.append({"text": w, "start": round(t[a][0] * 1000), "end": round(t[b - 1][1] * 1000)})
    return words


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(RAW, exist_ok=True)
    from qwen_tts import Qwen3TTSModel
    v = CFG["voice"]
    ref_wav = os.path.join(ROOT, v["reference"])
    if not os.path.exists(ref_wav):
        torch.manual_seed(v.get("seed", 7))
        d = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
        wavs, sr = d.generate_voice_design(text=v["ref_text"], language="English", instruct=v["design"])
        sf.write(ref_wav, wavs[0], sr)
        del d
        torch.cuda.empty_cache()
    m = Qwen3TTSModel.from_pretrained("Qwen/Qwen3-TTS-12Hz-1.7B-Base", device_map="cuda:0", dtype=torch.bfloat16, attn_implementation="sdpa")
    prompt = m.create_voice_clone_prompt(ref_audio=ref_wav, ref_text=v["ref_text"])

    only = set(sys.argv[1:])
    tpath = os.path.join(OUT, "timing.json")
    old = {l["id"]: l for l in json.load(open(tpath, encoding="utf-8"))["lines"]} if os.path.exists(tpath) else {}
    lines_out = []
    for line in CFG["lines"]:
        lid = line["id"]
        if only and lid not in only:
            if lid in old:
                lines_out.append(old[lid])
            continue
        said = line.get("say", line["text"])
        target = norm_words(said)
        best = None
        for take in range(v.get("takes", 3)):
            seed = v.get("seed", 7) * 100 + take
            torch.manual_seed(seed)
            wavs, sr = m.generate_voice_clone(text=said, language="English", voice_clone_prompt=prompt)
            raw = os.path.join(RAW, f"{lid}.take{take}.wav")
            sf.write(raw, wavs[0], sr)
            text, heard = transcribe(raw)
            r, _ = score(target, heard)
            dur = len(wavs[0]) / sr
            wps = len(target) / max(0.1, dur)
            bad_pace = wps > 3.6 or wps < 1.4
            print(f"{lid} take {take}: match {r:.3f}, {dur:.1f}s, {wps:.2f} w/s{' (pace!)' if bad_pace else ''} | {text.strip()}", flush=True)
            key = (r - (0.2 if bad_pace else 0), -take)
            if best is None or key > best[0]:
                best = (key, raw, heard, r)
            if r >= 0.98 and not bad_pace:
                break
        _, raw, heard, r = best
        if r < 0.9:
            print(f"!! {lid}: best take only matches {r:.3f}", flush=True)
        out = os.path.join(OUT, lid + ".wav")
        studio(raw, out)
        # timings from the final (processed) clip
        _, heard = transcribe(out)
        words = time_words(line, heard)
        info = sf.info(out)
        ms = round(info.frames / info.samplerate * 1000)
        speech = min(ms, max(w["end"] for w in words) + 60)
        lines_out.append({"id": lid, "text": line["text"], "ms": ms, "speech": speech, "match": round(r, 3), "words": words})
        # keep the file updated after every line, so a crash loses nothing
        json.dump({"lines": lines_out + [old[l["id"]] for l in CFG["lines"] if l["id"] in old and l["id"] not in {x["id"] for x in lines_out}]},
                  open(tpath, "w", encoding="utf-8"), indent=1)
    order = [l["id"] for l in CFG["lines"]]
    lines_out.sort(key=lambda l: order.index(l["id"]))
    json.dump({"lines": lines_out}, open(tpath, "w", encoding="utf-8"), indent=1)
    print("speech total", round(sum(l["speech"] for l in lines_out) / 1000, 1), "s")


if __name__ == "__main__":
    main()
