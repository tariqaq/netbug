// Sound for the film, all synthesized with Web Audio (nothing downloaded).
//
// `onFrame` callbacks share one OfflineAudioContext per render, so the first one builds a bus that the rest reuse:
//   music (+ its reverb) -> stem level -> duck gain -> master;  sfx (+ its reverb) -> stem level -> master;
//   master -> compressor -> destination. The reverb is a convolver with a generated impulse response.
// The narration clips (<Audio>) go straight to the destination, past this bus.
//
// `cue(frame, kind)` places one effect; `music(frame, ...)` places one stretch of score (src/score.ts). Every noise
// source is seeded, so a render always sounds the same.

import { onFrame } from '@kinetographdev/audio';
import type { AudioContextLike } from '@kinetographdev/audio';

type Ctx = AudioContextLike;
type Node = ReturnType<Ctx['createGain']>;
export type Bus = { music: Node; sfx: Node; musicVerb: Node; sfxVerb: Node; ctx: Ctx };

const FPS = 30;
const buses = new WeakMap<object, Bus>();

/** Seeded uniform noise in -1..1. */
const rng = (seed: number) => {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return (s / 4294967296) * 2 - 1; };
};

const noiseBuffer = (ctx: Ctx, secs: number, seed: number) => {
  const len = Math.max(1, Math.floor(ctx.sampleRate * secs));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const r = rng(seed * 7 + c + 1);
    const ch = buf.getChannelData(c);
    for (let i = 0; i < len; i++) ch[i] = r();
  }
  return buf;
};

/** Stem levels. NETBUG_SOLO=music|sfx|voice in the environment mutes the other stems, for measuring the mix. */
const SOLO = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NETBUG_SOLO;
export const soloMutes = (stem: 'music' | 'sfx' | 'voice') => !!SOLO && SOLO !== stem;
const MUSIC_LEVEL = 0.2;
const SFX_LEVEL = 0.35;

/** Ducking: music drops to `depth` while the narrator speaks. Spans in seconds; set by the film before rendering. */
let duckSpans: [number, number][] = [];
export const setDuck = (spans: [number, number][]) => { duckSpans = spans; };
const DUCK = 0.42;     // about -7.5 dB under the voice

export const bus = (ctx: Ctx, t0 = 0): Bus => {
  const have = buses.get(ctx);
  if (have) return have;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20; comp.ratio.value = 3; comp.knee.value = 8;
  comp.attack.value = 0.008; comp.release.value = 0.25;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(comp); comp.connect(ctx.destination);
  // reverb: 3 s of decaying stereo noise, darker as it fades
  const len = Math.floor(ctx.sampleRate * 3);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const r = rng(99 + c);
    const ch = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const k = i / len;
      lp += (r() - lp) * (0.9 - 0.75 * k);
      ch[i] = lp * Math.pow(1 - k, 3.2);
    }
  }
  // one stem: dry input and reverb send, summed after the reverb, then the stem level
  const stem = (level: number, out: Node) => {
    const dry = ctx.createGain();
    const verb = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    const lvl = ctx.createGain();
    lvl.gain.value = level;
    dry.connect(lvl); verb.connect(conv); conv.connect(wet); wet.connect(lvl); lvl.connect(out);
    return { dry, verb };
  };
  const duck = ctx.createGain();
  duck.connect(master);
  const m = stem(soloMutes('music') ? 0 : MUSIC_LEVEL, duck);
  const x = stem(soloMutes('sfx') ? 0 : SFX_LEVEL, master);
  // ducking automation for the whole render (times are relative to the render's first frame)
  // (anchored linear ramps: setTargetAtTime misbehaves in node-web-audio-api)
  const spans: [number, number][] = [];
  for (const [a, e] of duckSpans) {
    const last = spans[spans.length - 1];
    if (last && a - last[1] < 0.8) last[1] = e;   // lines close together stay ducked between them
    else spans.push([a, e]);
  }
  duck.gain.setValueAtTime(1, 0);
  for (const [a, e] of spans) {
    const s = a - t0, end = e - t0;
    if (end <= 0) continue;
    const down = Math.max(0, s - 0.15);
    duck.gain.setValueAtTime(s - 0.15 > 0 ? 1 : DUCK, down);
    duck.gain.linearRampToValueAtTime(DUCK, Math.max(down, s));
    duck.gain.setValueAtTime(DUCK, end + 0.1);
    duck.gain.linearRampToValueAtTime(1, end + 0.6);
  }
  const b: Bus = { music: m.dry, sfx: x.dry, musicVerb: m.verb, sfxVerb: x.verb, ctx };
  buses.set(ctx, b);
  return b;
};

// ---------------------------------------------------------------- building blocks

/** A gain envelope: 0 -> peak in `a` s, holds, then down to 0 over `r` s, ending at t + len. */
const env = (ctx: Ctx, t: number, peak: number, a: number, len: number, r: number) => {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + Math.max(0.002, a));
  g.gain.setValueAtTime(peak, t + Math.max(a, len - r));
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  return g;
};

/** Reverb send from a node; `stem` picks the music or the effects reverb. */
const send = (b: Bus, from: Node, amount: number, stem: 'music' | 'sfx' = 'sfx') => {
  if (amount <= 0) return;
  const s = b.ctx.createGain();
  s.gain.value = amount;
  from.connect(s); s.connect(stem === 'music' ? b.musicVerb : b.sfxVerb);
};

const noiseSrc = (ctx: Ctx, t: number, secs: number, seed: number) => {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, secs, seed);
  src.start(t); src.stop(t + secs);
  return src;
};

const osc = (ctx: Ctx, type: 'sine' | 'square' | 'sawtooth' | 'triangle', f: number, t: number, len: number, detune = 0) => {
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
  o.start(t); o.stop(t + len + 0.05);
  return o;
};

const shaper = (ctx: Ctx, drive: number) => {
  const ws = ctx.createWaveShaper();
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); }
  ws.curve = curve;
  return ws;
};

// ---------------------------------------------------------------- effects

export type Sfx =
  | 'impact' | 'bigImpact' | 'braam' | 'riser' | 'whoosh' | 'glitch' | 'tick' | 'tock' | 'type' | 'heartbeat'
  | 'beep' | 'flatline' | 'lock' | 'tink' | 'thud' | 'pop' | 'subdrop' | 'stamp';

type Opt = { len?: number; gain?: number; seed?: number };

const play: Record<Sfx, (b: Bus, t: number, o: Opt) => void> = {
  // sub thump + short crack + room
  impact: (b, t, { gain = 1, seed = 1 }) => {
    const { ctx } = b;
    const s = osc(ctx, 'sine', 70, t, 1.1);
    s.frequency.exponentialRampToValueAtTime(32, t + 0.9);
    const g1 = env(ctx, t, 0.55 * gain, 0.004, 1.1, 0.9);
    s.connect(g1); g1.connect(b.sfx); send(b, g1, 0.25);
    const n = noiseSrc(ctx, t, 0.25, seed);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(300, t + 0.2);
    const g2 = env(ctx, t, 0.22 * gain, 0.002, 0.25, 0.22);
    n.connect(lp); lp.connect(g2); g2.connect(b.sfx); send(b, g2, 0.6);
  },
  bigImpact: (b, t, o) => {
    play.impact(b, t, { ...o, gain: (o.gain ?? 1) * 1.25 });
    play.subdrop(b, t, { gain: (o.gain ?? 1) * 0.8 });
  },
  // the trailer horn, kept low and short: detuned saws on D, distorted, the filter opening and closing
  braam: (b, t, { len = 2.6, gain = 1 }) => {
    const { ctx } = b;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 3;
    lp.frequency.setValueAtTime(140, t);
    lp.frequency.exponentialRampToValueAtTime(1100, t + 0.35);
    lp.frequency.exponentialRampToValueAtTime(220, t + len);
    const ws = shaper(ctx, 2.2);
    const g = env(ctx, t, 0.16 * gain, 0.06, len, len * 0.7);
    for (const [f, d] of [[36.71, -9], [36.71, 9], [73.42, -5], [73.42, 6], [110, 3], [87.31, -4]] as const) {
      osc(ctx, 'sawtooth', f, t, len, d).connect(lp);
    }
    lp.connect(ws); ws.connect(g); g.connect(b.sfx); send(b, g, 0.5);
  },
  // noise sweep plus a climbing tone, ending at t + len (cue it `len` before the hit)
  riser: (b, t, { len = 1.6, gain = 1, seed = 3 }) => {
    const { ctx } = b;
    const n = noiseSrc(ctx, t, len, seed);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(250, t); bp.frequency.exponentialRampToValueAtTime(7000, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13 * gain, t + len - 0.02); g.gain.linearRampToValueAtTime(0.0001, t + len);
    n.connect(bp); bp.connect(g); g.connect(b.sfx); send(b, g, 0.4);
    const o = osc(ctx, 'sawtooth', 110, t, len);
    o.frequency.exponentialRampToValueAtTime(440, t + len);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.03 * gain, t + len - 0.02); g2.gain.linearRampToValueAtTime(0.0001, t + len);
    o.connect(lp); lp.connect(g2); g2.connect(b.sfx);
  },
  // air moving past, panned left to right
  whoosh: (b, t, { len = 0.55, gain = 1, seed = 5 }) => {
    const { ctx } = b;
    const n = noiseSrc(ctx, t, len, seed);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(2600, t + len * 0.55); bp.frequency.exponentialRampToValueAtTime(700, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1 * gain, t + len * 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(-0.7, t); p.pan.linearRampToValueAtTime(0.7, t + len);
    n.connect(bp); bp.connect(g); g.connect(p); p.connect(b.sfx); send(b, g, 0.3);
  },
  // digital stutter: gated square bursts at random pitches, crushed
  glitch: (b, t, { len = 0.32, gain = 1, seed = 7 }) => {
    const { ctx } = b;
    const r = rng(seed);
    const ws = shaper(ctx, 6);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 250;
    const out = ctx.createGain(); out.gain.value = 0.055 * gain;
    ws.connect(hp); hp.connect(out); out.connect(b.sfx); send(b, out, 0.2);
    for (let x = 0; x < len; x += 0.028) {
      if (r() < -0.3) continue;
      const o = osc(ctx, 'square', 180 + Math.abs(r()) * 1800, t + x, 0.022);
      const g = env(ctx, t + x, 1, 0.001, 0.022, 0.006);
      o.connect(g); g.connect(ws);
    }
    const n = noiseSrc(ctx, t, len, seed + 1);
    const gn = env(ctx, t, 0.4, 0.002, len, len * 0.5);
    n.connect(gn); gn.connect(ws);
  },
  // clock: a bright tick and a duller tock
  tick: (b, t, { gain = 1, seed = 11 }) => {
    const { ctx } = b;
    const n = noiseSrc(ctx, t, 0.03, seed);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200; bp.Q.value = 6;
    const g = env(ctx, t, 0.5 * gain, 0.001, 0.03, 0.025);
    n.connect(bp); bp.connect(g); g.connect(b.sfx); send(b, g, 0.15);
  },
  tock: (b, t, { gain = 1, seed = 12 }) => {
    const { ctx } = b;
    const n = noiseSrc(ctx, t, 0.04, seed);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 6;
    const g = env(ctx, t, 0.45 * gain, 0.001, 0.04, 0.035);
    n.connect(bp); bp.connect(g); g.connect(b.sfx); send(b, g, 0.15);
  },
  type: (b, t, { gain = 1, seed = 13 }) => {
    const { ctx } = b;
    const n = noiseSrc(ctx, t, 0.018, seed);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const g = env(ctx, t, 0.16 * gain, 0.001, 0.018, 0.014);
    n.connect(hp); hp.connect(g); g.connect(b.sfx);
    const o = osc(ctx, 'sine', 140, t, 0.05);
    const g2 = env(ctx, t, 0.08 * gain, 0.001, 0.05, 0.045);
    o.connect(g2); g2.connect(b.sfx);
  },
  // lub-dub
  heartbeat: (b, t, { gain = 1 }) => {
    const { ctx } = b;
    for (const [dt, k] of [[0, 1], [0.22, 0.7]] as const) {
      const o = osc(ctx, 'sine', 62, t + dt, 0.3);
      o.frequency.exponentialRampToValueAtTime(38, t + dt + 0.25);
      const g = env(ctx, t + dt, 0.5 * gain * k, 0.006, 0.28, 0.24);
      o.connect(g); g.connect(b.sfx);
    }
  },
  // patient monitor
  beep: (b, t, { gain = 1 }) => {
    const { ctx } = b;
    const o = osc(ctx, 'sine', 988, t, 0.14);
    const g = env(ctx, t, 0.06 * gain, 0.004, 0.14, 0.05);
    o.connect(g); g.connect(b.sfx); send(b, g, 0.25);
  },
  flatline: (b, t, { len = 1.6, gain = 1 }) => {
    const { ctx } = b;
    const o = osc(ctx, 'sine', 988, t, len);
    const g = env(ctx, t, 0.045 * gain, 0.01, len, len * 0.6);
    o.connect(g); g.connect(b.sfx); send(b, g, 0.35);
  },
  // a latch closing: click, then a heavier clunk
  lock: (b, t, { gain = 1, seed = 17 }) => {
    const { ctx } = b;
    play.type(b, t, { gain: 1.6 * gain, seed });
    const n = noiseSrc(ctx, t + 0.07, 0.08, seed + 1);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 2;
    const g = env(ctx, t + 0.07, 0.6 * gain, 0.001, 0.08, 0.07);
    n.connect(bp); bp.connect(g); g.connect(b.sfx); send(b, g, 0.3);
    const o = osc(ctx, 'sine', 160, t + 0.07, 0.2);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.25);
    const g2 = env(ctx, t + 0.07, 0.3 * gain, 0.002, 0.2, 0.18);
    o.connect(g2); g2.connect(b.sfx);
  },
  // a fake reply bouncing off
  tink: (b, t, { gain = 1 }) => {
    const { ctx } = b;
    const o = osc(ctx, 'triangle', 2100, t, 0.18);
    o.frequency.exponentialRampToValueAtTime(1500, t + 0.15);
    const g = env(ctx, t, 0.035 * gain, 0.002, 0.18, 0.16);
    o.connect(g); g.connect(b.sfx); send(b, g, 0.4);
  },
  thud: (b, t, { gain = 1 }) => {
    const { ctx } = b;
    const o = osc(ctx, 'sine', 95, t, 0.45);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.4);
    const g = env(ctx, t, 0.3 * gain, 0.003, 0.45, 0.4);
    o.connect(g); g.connect(b.sfx); send(b, g, 0.2);
  },
  pop: (b, t, { gain = 1 }) => {
    const { ctx } = b;
    const o = osc(ctx, 'sine', 700, t, 0.12);
    o.frequency.exponentialRampToValueAtTime(1050, t + 0.07);
    const g = env(ctx, t, 0.05 * gain, 0.002, 0.12, 0.1);
    o.connect(g); g.connect(b.sfx); send(b, g, 0.2);
  },
  subdrop: (b, t, { len = 1.6, gain = 1 }) => {
    const { ctx } = b;
    const o = osc(ctx, 'sine', 55, t, len);
    o.frequency.exponentialRampToValueAtTime(24, t + len);
    const g = env(ctx, t, 0.5 * gain, 0.01, len, len * 0.85);
    o.connect(g); g.connect(b.sfx);
  },
  // a row of evidence stamped: short muted knock
  stamp: (b, t, { gain = 1, seed = 19 }) => {
    const { ctx } = b;
    const n = noiseSrc(ctx, t, 0.06, seed);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = env(ctx, t, 0.35 * gain, 0.001, 0.06, 0.05);
    n.connect(lp); lp.connect(g); g.connect(b.sfx); send(b, g, 0.25);
    const o = osc(ctx, 'sine', 120, t, 0.16);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.14);
    const g2 = env(ctx, t, 0.25 * gain, 0.002, 0.16, 0.14);
    o.connect(g2); g2.connect(b.sfx);
  },
};

/** Place an effect at a (possibly fractional) frame. */
export const cue = (frame: number, kind: Sfx, o: Opt = {}) => {
  onFrame(Math.max(0, frame), (ctx, t) => play[kind](bus(ctx, (Math.max(0, frame) / FPS) - t), t, { seed: Math.round(frame), ...o }));
};

/** Place a stretch of music: `write` schedules notes into the music bus from time `t` (seconds, render-relative). */
export const music = (frame: number, write: (b: Bus, t: number) => void) => {
  onFrame(Math.max(0, frame), (ctx, t) => write(bus(ctx, (Math.max(0, frame) / FPS) - t), t));
};

export { env, osc, noiseSrc, send, shaper, rng };
