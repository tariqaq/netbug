// The v5 score: synthesized, in D minor for the night and the attacks, opening into F major at dawn (the fix).
// The film cuts it into sections (`scoreSection(from, to, mood)`); each is a few layers (drone, wide pad, pulse,
// keys, clock) that fade in and out on their own, so a section starts and stops exactly on a scene. Every voice is
// a detuned pair panned apart, for stereo width. Under the narration the bus ducks (sound.ts).

import { music, env, osc, send, type Bus } from './sound';

const FPS = 60;
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
// note numbers
const D1 = 26, F1 = 29, A1 = 33, Bb1 = 34, C2 = 36, D2 = 38, F2 = 41, G2 = 43, A2 = 45, Bb2 = 46, C3 = 48, D3 = 50,
  E3 = 52, F3 = 53, G3 = 55, A3 = 57, Bb3 = 58, C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, C5 = 72, D5 = 74, E5 = 76;

export type Mood = 'night' | 'calm' | 'tension' | 'wait' | 'relief' | 'tension2' | 'lonely' | 'build' | 'resolve' | 'end';

type G = ReturnType<Bus['ctx']['createGain']>;

/** A gain that fades in over `fi` and out over `fo`, spanning t..t+len, into the music bus. */
const section = (b: Bus, t: number, len: number, level: number, fi = 0.8, fo = 0.8) => {
  const g = b.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + Math.min(fi, len * 0.45));
  g.gain.setValueAtTime(level, t + Math.max(Math.min(fi, len * 0.45), len - fo));
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  g.connect(b.music);
  return g;
};

/** One oscillator panned to `pan`. */
const wideOsc = (b: Bus, out: G | ReturnType<Bus['ctx']['createBiquadFilter']>, type: 'sine' | 'triangle' | 'sawtooth' | 'square', f: number, t: number, len: number, detune: number, pan: number) => {
  const o = osc(b.ctx, type, f, t, len, detune);
  const p = b.ctx.createStereoPanner(); p.pan.value = pan;
  o.connect(p); p.connect(out);
};

/** Low detuned saws through a slowly breathing low-pass, plus a sine sub. */
const drone = (b: Bus, out: G, t: number, len: number, notes: number[], cutoff = 220, level = 0.2) => {
  const { ctx } = b;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.1;
  lp.frequency.setValueAtTime(cutoff * 0.7, t);
  for (let x = 0; x < len; x += 4) lp.frequency.linearRampToValueAtTime(cutoff * (x % 8 === 0 ? 1.3 : 0.7), t + Math.min(len, x + 4));
  const g = ctx.createGain(); g.gain.value = level;
  for (const n of notes) { wideOsc(b, lp, 'sawtooth', hz(n), t, len, -8, -0.5); wideOsc(b, lp, 'sawtooth', hz(n), t, len, 8, 0.5); }
  osc(ctx, 'sine', hz(notes[0]), t, len).connect(g);
  lp.connect(g); g.connect(out);
};

/** Wide, soft chord: triangles and detuned saws, filtered, slow attack. */
const pad = (b: Bus, out: G, t: number, len: number, notes: number[], cutoff = 900, level = 0.045, attack = 1.5) => {
  const { ctx } = b;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + Math.min(attack, len * 0.5));
  notes.forEach((n, i) => {
    const pan = ((i % 2) * 2 - 1) * 0.6;
    wideOsc(b, lp, 'triangle', hz(n), t, len, 0, pan * 0.5);
    wideOsc(b, lp, 'sawtooth', hz(n), t, len, 7, pan);
    wideOsc(b, lp, 'sawtooth', hz(n), t, len, -7, -pan);
  });
  lp.connect(g); g.connect(out); send(b, g, 0.6, 'music');
};

/** Muted bass eighths with a filter pluck. */
const pulse = (b: Bus, out: G, t: number, len: number, note: number, bpm: number, every = 0.5, level = 0.11) => {
  const { ctx } = b;
  const step = (60 / bpm) * every;
  for (let x = 0, i = 0; x < len - 0.05; x += step, i++) {
    const tt = t + x;
    const o = osc(ctx, 'sawtooth', hz(note), tt, step);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(i % 4 === 0 ? 1100 : 700, tt); lp.frequency.exponentialRampToValueAtTime(140, tt + step * 0.9);
    const g = env(ctx, tt, level * (i % 4 === 0 ? 1 : 0.7), 0.004, step * 0.95, step * 0.8);
    o.connect(lp); lp.connect(g); g.connect(out);
  }
};

/** An electric-piano-like key: sine plus a soft bell partial, panned a little. */
const key = (b: Bus, out: G, t: number, note: number, level = 0.045, decay = 2.2, pan = 0) => {
  const { ctx } = b;
  const p = ctx.createStereoPanner(); p.pan.value = pan; p.connect(out);
  const g = env(ctx, t, level, 0.004, decay, decay * 0.95);
  osc(ctx, 'sine', hz(note), t, decay).connect(g);
  const g2 = env(ctx, t, level * 0.35, 0.002, decay * 0.35, decay * 0.33);
  osc(ctx, 'sine', hz(note) * 3.01, t, decay * 0.35).connect(g2);
  const g3 = env(ctx, t, level * 0.25, 0.003, decay * 0.6, decay * 0.55);
  osc(ctx, 'triangle', hz(note + 12) * 1.002, t, decay * 0.6).connect(g3);
  g.connect(p); g2.connect(p); g3.connect(p); send(b, g, 0.7, 'music');
};

/** Soft tick-tock on every beat. */
const clock = (b: Bus, out: G, t: number, len: number, bpm: number, level = 0.3) => {
  const { ctx } = b;
  const step = 60 / bpm;
  for (let x = 0, i = 0; x < len; x += step, i++) {
    const o = osc(ctx, 'sine', i % 2 ? 1800 : 2400, t + x, 0.03);
    const g = env(ctx, t + x, level * 0.05, 0.001, 0.03, 0.028);
    o.connect(g); g.connect(out);
  }
};

/** Arpeggio over `notes`, `step` seconds apart, rising in level over the section. */
const arp = (b: Bus, out: G, t: number, len: number, notes: number[], step: number, level = 0.035, grow = false) => {
  for (let x = 0.2, i = 0; x < len - 0.3; x += step, i++) {
    const k = grow ? 0.4 + 0.6 * (x / len) : 1;
    key(b, out, t + x, notes[i % notes.length], level * k, 1.4, ((i % 3) - 1) * 0.45);
  }
};

const WRITE: Record<Mood, (b: Bus, t: number, len: number) => void> = {
  night: (b, t, len) => {
    const o = section(b, t, len, 1, 2.5, 0.3);
    drone(b, o, t, len, [D1, A1], 150, 0.17);
    pad(b, o, t, len, [D3, F3, A3, E4], 650, 0.03, 4);
    const seq = [A4, F4, D4, E4];
    for (let x = 2.4, i = 0; x < len - 1; x += 2.8, i++) key(b, o, t + x, seq[i % seq.length], 0.03, 3, i % 2 ? 0.4 : -0.4);
  },
  calm: (b, t, len) => {
    const o = section(b, t, len, 1, 1.2, 0.8);
    pad(b, o, t, len, [D3, A3, C4, E4, F4], 1300, 0.05);
    const seq = [A4, F4, E4, D4, C5, A4];
    for (let x = 0.6, i = 0; x < len - 1; x += 1.6, i++) key(b, o, t + x, seq[i % seq.length], 0.045, 2.4, ((i % 3) - 1) * 0.4);
    pulse(b, o, t + 2, Math.max(0, len - 2), D2, 84, 1, 0.05);
  },
  tension: (b, t, len) => {
    const o = section(b, t, len, 1, 0.3, 0.5);
    drone(b, o, t, len, [D1, D2], 280);
    pulse(b, o, t, len, D2, 100);
    pad(b, o, t, len, [D3, 51 /* Eb3: the wrong note */, A3], 700, 0.022);
  },
  wait: (b, t, len) => {
    const o = section(b, t, len, 1, 0.6, 0.6);
    drone(b, o, t, len, [D1], 140);
    clock(b, o, t, len, 60, 0.45);
    const seq = [D4, A3, F3, E3];
    for (let x = 0.4, i = 0; x < len - 1; x += 2, i++) key(b, o, t + x, seq[i % seq.length], 0.03, 2.2, i % 2 ? 0.3 : -0.3);
  },
  relief: (b, t, len) => {
    const o = section(b, t, len, 1, 0.8, 0.6);
    pad(b, o, t, len, [Bb2, D3, F3, A3], 1100, 0.04);
    const seq = [F4, A4, D5, A4];
    for (let x = 0.5, i = 0; x < len - 1; x += 1.2, i++) key(b, o, t + x, seq[i % seq.length], 0.035, 1.8, ((i % 3) - 1) * 0.4);
  },
  tension2: (b, t, len) => {
    const o = section(b, t, len, 1, 0.2, 0.6);
    drone(b, o, t, len, [Bb1, D2], 320);
    pulse(b, o, t, len, D2, 108);
    pad(b, o, t, len, [D3, 51, Bb3], 800, 0.024);
  },
  lonely: (b, t, len) => {
    const o = section(b, t, len, 1, 1, 0.8);
    drone(b, o, t, len, [D1], 120, 0.12);
    pad(b, o, t, len, [F3, A3, D4], 800, 0.03);
    const seq = [D5, C5, A4, F4, E4, D4];
    for (let x = 0.8, i = 0; x < len - 1; x += 1.9, i++) key(b, o, t + x, seq[i % seq.length], 0.035, 3, i % 2 ? 0.5 : -0.5);
  },
  build: (b, t, len) => {
    const o = section(b, t, len, 1, 1, 0.3);
    drone(b, o, t, len, [F1, C2], 200, 0.14);
    const { ctx } = b;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t); lp.frequency.exponentialRampToValueAtTime(2600, t + len);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.01, t); g.gain.exponentialRampToValueAtTime(0.05, t + len);
    [F3, A3, C4, E4].forEach((n, i) => { wideOsc(b, lp, 'sawtooth', hz(n), t, len, 6, i % 2 ? 0.5 : -0.5); });
    lp.connect(g); g.connect(o); send(b, g, 0.5, 'music');
    arp(b, o, t, len, [F4, A4, C5, E5, C5, A4], 0.32, 0.03, true);
    pulse(b, o, t + 2, Math.max(0, len - 2), F2, 96, 0.5, 0.06);
  },
  resolve: (b, t, len) => {
    const o = section(b, t, len, 1, 1.2, 0.8);
    const half = len / 2;
    pad(b, o, t, half + 0.6, [Bb2, D3, F3, A3, C4], 1600, 0.05);
    pad(b, o, t + half, len - half, [F2, C3, A3, C4, G4], 1800, 0.05);
    arp(b, o, t, len, [F4, A4, C5, G4], 0.45, 0.035);
    pulse(b, o, t, len, F2, 88, 1, 0.06);
  },
  end: (b, t, len) => {
    const o = section(b, t, len, 1, 0.8, 3);
    pad(b, o, t, len, [F2, C3, F3, A3, G4], 1500, 0.06);
    for (const [x, n] of [[0.5, C5], [2.1, A4], [3.7, G4], [5.3, F4]] as const) if (x < len - 1) key(b, o, t + x, n, 0.045, 3, 0);
  },
};

/** One stretch of score from frame `from` to frame `to`. */
export const scoreSection = (from: number, to: number, mood: Mood) => {
  const len = (to - from) / FPS;
  if (len <= 0.2) return;
  music(from, (b, t) => WRITE[mood](b, t, len));
};
