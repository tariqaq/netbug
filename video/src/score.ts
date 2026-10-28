// The score: synthesized, in D minor, resolving to F major at the fix. The film cuts it into sections
// (`scoreSection(from, to, mood)`), each a few layers (drone, pad, pulse, plucks, clock) that fade in and out on
// their own, so a section can start and stop exactly on a scene. Under the narration the bus ducks (src/sound.ts).

import { music, env, osc, send, type Bus } from './sound';

const FPS = 30;
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
// note numbers
const D1 = 26, D2 = 38, F2 = 41, A2 = 45, Bb1 = 34, Bb2 = 46, C3 = 48, D3 = 50, E3 = 52, F3 = 53, A3 = 57,
  Bb3 = 58, C4 = 60, D4 = 62, E4 = 64, F4 = 65, G4 = 67, A4 = 69, C5 = 72;

export type Mood = 'dark' | 'calm' | 'tension' | 'clock' | 'wait' | 'tension2' | 'build' | 'resolve' | 'end';

/** A gain that fades in over `fi` and out over `fo`, spanning t..t+len, into the music bus. */
const section = (b: Bus, t: number, len: number, level: number, fi = 0.8, fo = 0.8) => {
  const g = b.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(level, t + fi);
  g.gain.setValueAtTime(level, t + Math.max(fi, len - fo));
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  g.connect(b.music);
  return g;
};

/** Low detuned saws through a slowly breathing low-pass. */
const drone = (b: Bus, out: ReturnType<Bus['ctx']['createGain']>, t: number, len: number, notes: number[], cutoff = 220) => {
  const { ctx } = b;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(cutoff * 0.7, t);
  for (let x = 0; x < len; x += 4) lp.frequency.linearRampToValueAtTime(cutoff * (x % 8 === 0 ? 1.25 : 0.7), t + Math.min(len, x + 4));
  const g = ctx.createGain(); g.gain.value = 0.22;
  for (const n of notes) for (const d of [-7, 7]) osc(ctx, 'sawtooth', hz(n), t, len, d).connect(lp);
  for (const n of notes.slice(0, 1)) { const s = osc(ctx, 'sine', hz(n), t, len); s.connect(g); }
  lp.connect(g); g.connect(out);
};

/** Soft chord: triangle + detuned saw, filtered, slow attack. */
const pad = (b: Bus, out: ReturnType<Bus['ctx']['createGain']>, t: number, len: number, notes: number[], cutoff = 900, level = 0.05) => {
  const { ctx } = b;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.5;
  const g = ctx.createGain(); g.gain.value = level;
  for (const n of notes) {
    osc(ctx, 'triangle', hz(n), t, len).connect(lp);
    osc(ctx, 'sawtooth', hz(n), t, len, 5).connect(lp);
  }
  lp.connect(g); g.connect(out); send(b, g, 0.5, 'music');
};

/** Muted bass eighths with a filter pluck. */
const pulse = (b: Bus, out: ReturnType<Bus['ctx']['createGain']>, t: number, len: number, note: number, bpm: number, every = 0.5, level = 0.12) => {
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

/** A bell-like pluck. */
const pluck = (b: Bus, out: ReturnType<Bus['ctx']['createGain']>, t: number, note: number, level = 0.05, decay = 1.8) => {
  const { ctx } = b;
  const g = env(ctx, t, level, 0.004, decay, decay * 0.95);
  osc(ctx, 'sine', hz(note), t, decay).connect(g);
  const g2 = env(ctx, t, level * 0.3, 0.002, decay * 0.4, decay * 0.38);
  osc(ctx, 'sine', hz(note + 12) * 1.002, t, decay * 0.4).connect(g2);
  g.connect(out); g2.connect(out); send(b, g, 0.7, 'music');
};

/** The clock in the score: soft tick-tock on every beat. */
const clock = (b: Bus, out: ReturnType<Bus['ctx']['createGain']>, t: number, len: number, bpm: number, level = 0.3) => {
  const { ctx } = b;
  const step = 60 / bpm;
  for (let x = 0, i = 0; x < len; x += step, i++) {
    const tt = t + x;
    const o = osc(ctx, 'sine', i % 2 ? 1800 : 2400, tt, 0.03);
    const g = env(ctx, tt, level * 0.05, 0.001, 0.03, 0.028);
    o.connect(g); g.connect(out);
  }
};

const WRITE: Record<Mood, (b: Bus, t: number, len: number) => void> = {
  dark: (b, t, len) => {
    const o = section(b, t, len, 1, 1.5, 1.2);
    drone(b, o, t, len, [D1, D2], 160);
    pad(b, o, t, len, [D3, F3, A3], 600, 0.035);
  },
  calm: (b, t, len) => {
    const o = section(b, t, len, 1, 1.2, 1);
    pad(b, o, t, len, [D3, A3, C4, E4, F4], 1300, 0.06);
    const seq = [A4, F4, E4, D4, C5, A4];
    for (let x = 0.6, i = 0; x < len - 1; x += 1.6, i++) pluck(b, o, t + x, seq[i % seq.length], 0.05, 2.4);
  },
  tension: (b, t, len) => {
    const o = section(b, t, len, 1, 0.4, 0.5);
    drone(b, o, t, len, [D1, D2], 260);
    pulse(b, o, t, len, D2, 96);
    pad(b, o, t, len, [D3, 51 /* Eb3: the wrong note */, A3], 700, 0.022);
  },
  clock: (b, t, len) => {
    const o = section(b, t, len, 1, 0.6, 0.6);
    drone(b, o, t, len, [D1, A2], 180);
    clock(b, o, t, len, 80);
    pulse(b, o, t, len, D2, 80, 1, 0.07);
  },
  wait: (b, t, len) => {
    const o = section(b, t, len, 1, 0.8, 0.6);
    drone(b, o, t, len, [D1], 140);
    clock(b, o, t, len, 60, 0.4);
    const seq = [D4, A3, F3, E3];
    for (let x = 0.4, i = 0; x < len - 1; x += 2, i++) pluck(b, o, t + x, seq[i % seq.length], 0.03, 2.2);
  },
  tension2: (b, t, len) => {
    const o = section(b, t, len, 1, 0.2, 0.6);
    drone(b, o, t, len, [Bb1, D2], 300);
    pulse(b, o, t, len, D2, 104);
    pad(b, o, t, len, [D3, 51, Bb3], 800, 0.024);
  },
  build: (b, t, len) => {
    const o = section(b, t, len, 1, 0.6, 0.08);
    drone(b, o, t, len, [D1, D2, A2], 200);
    const { ctx } = b;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(2400, t + len);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.01, t); g.gain.exponentialRampToValueAtTime(0.06, t + len);
    for (const n of [D3, F3, A3, D4]) osc(ctx, 'sawtooth', hz(n), t, len, 6).connect(lp);
    lp.connect(g); g.connect(o); send(b, g, 0.4, 'music');
  },
  resolve: (b, t, len) => {
    const o = section(b, t, len, 1, 1.4, 0.8);
    const half = len / 2;
    pad(b, o, t, half + 0.6, [Bb2, D3, F3, A3], 1500, 0.06);
    pad(b, o, t + half, len - half, [F2, C3, A3, C4, G4], 1700, 0.06);
    const seq = [F4, A4, C5, G4];
    for (let x = 0.8, i = 0; x < len - 1; x += 0.9, i++) pluck(b, o, t + x, seq[i % seq.length], 0.045, 1.8);
  },
  end: (b, t, len) => {
    const o = section(b, t, len, 1, 0.8, 2.8);
    pad(b, o, t, len, [F2, C3, F3, A3, G4], 1400, 0.07);
    pulse(b, o, t, len - 2.5, F2, 72, 1, 0.08);
    for (const [x, n] of [[0.5, C5], [2.1, A4], [3.7, G4]] as const) if (x < len - 1) pluck(b, o, t + x, n, 0.05, 2.6);
  },
};

/** One stretch of score from frame `from` to frame `to`. */
export const scoreSection = (from: number, to: number, mood: Mood) => {
  const len = (to - from) / FPS;
  if (len <= 0.2) return;
  music(from, (b, t) => WRITE[mood](b, t, len));
};

