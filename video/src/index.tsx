// Incident explainer (v4): the two ARP-spoofing attacks of 2026-10-28 and the gateway pin fix.
//
// Timing comes from public/vo/timing.json (written by scripts/tts.py): every narration line starts at a fixed frame
// and lasts until its last word ends (`speech`), and scenes, sound and animations are keyed to lines and to single
// words, so what's on screen and what you hear happen when it is said. MACs come from the composition props:
// data.example.json (redacted, the default) or data.local.json (real values, gitignored).
//
// The look (vignette, letterbox, camera, chapter cards) is in cinema.tsx; sound effects in sound.ts; music in score.ts.
// Render: see README.md in this folder.

import React from 'react';
import {
  AbsoluteFill, Audio, Composition, Ellipse, Layer, Path, Rect, Sequence, Text,
  interpolate, registerRoot, spring, staticFile, useCurrentFrame, Easing, glow, chromaticAberration,
} from 'remotion';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import timing from '../public/vo/timing.json';
import example from '../data.example.json';
import { W, H, Vignette, Letterbox, ChapterCard, camera, type Hit } from './cinema';
import { cue, setDuck, soloMutes, type Sfx } from './sound';
import { scoreSection, type Mood } from './score';

loadInter('normal', { weights: ['400', '600', '800'] });
loadMono('normal', { weights: ['500'] });
const SANS = 'Inter';
const MONO = 'JetBrains Mono';

const FPS = 30;

const C = {
  bg: '#000000', ink: '#ffffff', line: '#2c2c2e', panel: '#111113',
  router: '#0a84ff', ok: '#30d158', bad: '#ff453a', warn: '#ff9f0a', hi: '#ffd60a',
};

type Data = typeof example;

// ---------------------------------------------------------------- timeline

type Word = { text: string; start: number; end: number };
type Line = { id: string; text: string; ms: number; speech: number; words: Word[] };
type Placed = Line & { from: number; frames: number };
type SceneDef = { id: string; lines: string[]; lead?: number; card?: [string, string] };

const CARD = 60;        // chapter card length (frames)
const SCENES: SceneDef[] = [
  { id: 'cold', lines: [], lead: 124 },
  { id: 'title', lines: ['title1', 'title2'], lead: 4 },
  { id: 'normal', lines: ['normal1', 'normal2'] },
  { id: 'attack1', lines: ['a1_1', 'a1_2', 'a1_3'], lead: CARD + 6, card: ['PART I', '05:34 · the first attack'] },
  { id: 'symptoms', lines: ['sym1', 'sym2'] },
  { id: 'timeline1', lines: ['a1_end', 'a1_wifi'] },
  { id: 'test', lines: ['test1', 'test2'], lead: CARD + 6, card: ['PART II', 'the second attack'] },
  { id: 'attack2', lines: ['a2_dev', 'a2_addr', 'a2_lie', 'a2_count', 'a2_more'] },
  { id: 'compare', lines: ['cmp1', 'cmp2'] },
  { id: 'fix', lines: ['fix1', 'fix2'], lead: CARD + 6, card: ['PART III', 'the fix'] },
  { id: 'rcc', lines: ['rcc'] },
];

const LEAD = 10;        // frames from a scene's start to its first line
const TAIL = 8;         // after a line's last word
const GAP = 10;         // between lines of a scene
const SCENE_TAIL = 18;  // after a scene's last line, before the next scene
const OUTRO = 120;      // end card after the last line
// held silences after a line, for weight (and so titles get read)
const PAUSE: Record<string, number> = {
  title1: 14, title2: 24, normal2: 10, a1_1: 6, a1_3: 26, sym2: 10, a1_end: 6, a1_wifi: 16, test1: 12, test2: 8,
  a2_dev: 8, a2_addr: 8, a2_lie: 14, a2_count: 8, a2_more: 10, cmp1: 10, cmp2: 30, fix2: 12,
};

const sec = (ms: number) => Math.round((ms / 1000) * FPS);
const byId = new Map((timing.lines as Line[]).map((l) => [l.id, l]));

const placed: Placed[] = [];
const sceneFrom: Record<string, number> = {};
{
  let cursor = 0;
  for (const s of SCENES) {
    sceneFrom[s.id] = cursor;
    cursor += s.lead ?? LEAD;
    s.lines.forEach((id, i) => {
      const l = byId.get(id);
      if (!l) throw new Error('timing.json has no line ' + id);
      const frames = sec(l.speech);
      placed.push({ ...l, from: cursor, frames });
      cursor += frames + TAIL + (PAUSE[id] ?? 0) + (i < s.lines.length - 1 ? GAP : 0);
    });
    if (s.lines.length) cursor += SCENE_TAIL;
  }
  sceneFrom.end = cursor;
}
const TOTAL = sceneFrom.end + OUTRO;
const lineOf = (id: string) => placed.find((p) => p.id === id)!;
const sceneTo = (id: string) => {
  const i = SCENES.findIndex((s) => s.id === id);
  return i < SCENES.length - 1 ? sceneFrom[SCENES[i + 1].id] : TOTAL;
};

/** Absolute frame of a line's start, or of word `w` in it (`w` may be the word's text). */
const at = (id: string, w?: number | string): number => {
  const l = lineOf(id);
  if (w === undefined) return l.from;
  const idx = typeof w === 'number' ? w : l.words.findIndex((x) => x.text.replace(/[^\w:']/g, '').replace(/:$/, '').toLowerCase() === w.toLowerCase());
  if (idx < 0) throw new Error(`word "${w}" not in ${id}`);
  return l.from + sec(l.words[idx].start);
};
const endOf = (id: string) => lineOf(id).from + lineOf(id).frames;

// ---------------------------------------------------------------- helpers

const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
/** 0 -> 1 from frame `a` over `d` frames. */
const prog = (f: number, a: number, d = 12) => interpolate(f, [a, a + d], [0, 1], { ...clamp, easing: ease });
const pop = (f: number, a: number) => (f < a ? 0 : spring({ frame: f - a, fps: FPS, config: { damping: 15, stiffness: 160 } }));
/** Lands hard: a spring with almost no bounce, for slams. */
const slam = (f: number, a: number) => (f < a ? 0 : spring({ frame: f - a, fps: FPS, config: { damping: 22, stiffness: 320 } }));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Text centred on (cx, y). Text wider than `w` would fall back to left alignment, so `w` defaults to almost the full width. */
const CText: React.FC<{ cx: number; y: number; w?: number; size: number; color?: string; weight?: number; font?: string; opacity?: number; glowAmt?: number; children: React.ReactNode }> =
  ({ cx, y, w = W - 160, size, color = C.ink, weight = 400, font = SANS, opacity = 1, glowAmt = 0, children }) => (
    <Text x={cx - w / 2} y={y} maxWidth={w} align="center" font={font} weight={weight} size={size} color={color} opacity={opacity} lineHeight={1.2}
          effects={glowAmt > 0 ? [glow({ radius: 14, color, intensity: 0.45 * glowAmt })] : []}>{children}</Text>
  );

/** Centred text whose letters rise in one after another from frame `from`. */
const Reveal: React.FC<{ f: number; from: number; y: number; size: number; text: string; color?: string; weight?: number; font?: string; stagger?: number }> =
  ({ f, from, y, size, text, color = C.ink, weight = 800, font = SANS, stagger = 1.2 }) => {
    const chars = Array.from(text).map((_, i) => {
      const p = prog(f, from + i * stagger, 14);
      return { opacity: p, y: (1 - p) * size * 0.25 };
    });
    return <Text x={80} y={y} maxWidth={W - 160} align="center" font={font} weight={weight} size={size} color={color} lineHeight={1.2} chars={chars}>{text}</Text>;
  };

/** A device card centred on (cx, cy). */
const Device: React.FC<{ cx: number; cy: number; title: string; sub: string; color: string; show?: number; glow?: number; w?: number }> =
  ({ cx, cy, title, sub, color, show = 1, glow: glowOn = 0, w = 300 }) => {
    const h = 150;
    return (
      <Layer x={cx} y={cy} scale={lerp(0.85, 1, show)} opacity={show} origin="center">
        <Layer x={-w / 2} y={-h / 2}>
          <Rect width={w} height={h} radius={24} fill={C.panel} stroke={{ color, width: 3 }}
                effects={glowOn > 0 ? [glow({ radius: 16, color, intensity: 0.6 * glowOn })] : []} />
          <Text x={0} y={34} maxWidth={w} align="center" font={SANS} weight={800} size={34} color={C.ink}>{title}</Text>
          <Text x={0} y={90} maxWidth={w} align="center" font={MONO} weight={500} size={22} color={color}>{sub}</Text>
        </Layer>
      </Layer>
    );
  };

/** A speech bubble centred on (cx, cy). */
const Bubble: React.FC<{ cx: number; cy: number; text: string; sub?: string; color: string; show: number; w?: number }> =
  ({ cx, cy, text, sub, color, show, w = 520 }) => {
    const h = sub ? 112 : 72;
    return (
      <Layer x={cx} y={cy} scale={lerp(0.6, 1, show)} opacity={Math.min(1, show * 1.5)} origin="center">
        <Layer x={-w / 2} y={-h / 2}>
          <Rect width={w} height={h} radius={h / 2} fill={color} effects={[glow({ radius: 12, color, intensity: 0.3 * show })]} />
          <Text x={0} y={sub ? 16 : 18} maxWidth={w} align="center" font={SANS} weight={800} size={30} color="#000">{text}</Text>
          {sub && <Text x={0} y={62} maxWidth={w} align="center" font={MONO} weight={500} size={24} color="#000">{sub}</Text>}
        </Layer>
      </Layer>
    );
  };

/** Dots travelling from a to b, starting at frame `start`; `drop` fades them out at the end (swallowed). */
const Packets: React.FC<{ f: number; a: [number, number]; b: [number, number]; start: number; color: string; every?: number; travel?: number; drop?: boolean; until?: number }> =
  ({ f, a, b, start, color, every = 6, travel = 24, drop = false, until = 1e9 }) => {
    const dots: React.ReactNode[] = [];
    for (let s = start; s <= Math.min(f, until); s += every) {
      const t = (f - s) / travel;
      if (t < 0 || t > (drop ? 1.25 : 1)) continue;
      const tt = Math.min(1, t);
      const o = drop ? interpolate(t, [0.85, 1.25], [1, 0], clamp) : interpolate(t, [0, 0.1, 0.9, 1], [0, 1, 1, 0]);
      dots.push(<Ellipse key={s} x={lerp(a[0], b[0], tt) - 9} y={lerp(a[1], b[1], tt) - 9} width={18} height={18} fill={color} opacity={o} />);
    }
    return <Layer motionBlur={{ samples: 6, shutter: 0.8 }} effects={[glow({ radius: 6, color, intensity: 0.4 })]}>{dots}</Layer>;
  };

/** A straight link line between two points. */
const Link: React.FC<{ a: [number, number]; b: [number, number]; color?: string; opacity?: number; dash?: boolean }> =
  ({ a, b, color = C.line, opacity = 1 }) => (
    <Path d={`M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`} opacity={opacity} stroke={{ color, width: 4 }} />
  );

/** The laptop's ARP table card under the laptop. */
const ArpCard: React.FC<{ cx: number; y: number; ip: string; mac: string; color: string; flash?: number; lock?: number }> =
  ({ cx, y, ip, mac, color, flash = 0, lock = 0 }) => (
    <Layer x={cx - 190} y={y}>
      <Rect width={380} height={122} radius={18} fill={C.panel} stroke={{ color: flash > 0 ? color : C.line, width: 2 }} />
      <Text x={22} y={16} font={SANS} weight={600} size={20} color={C.ink}>Laptop's address book:</Text>
      <Text x={22} y={48} font={MONO} weight={500} size={21} color={C.ink}>{`router ${ip}`}</Text>
      <Text x={22} y={80} font={MONO} weight={500} size={21} color={color}>{`is at ${mac}`}</Text>
      {lock > 0 && (
        <Layer x={318} y={44} opacity={lock} scale={lerp(1.6, 1, lock)} origin="center">
          <Rect x={4} y={18} width={34} height={28} radius={6} fill={C.ok} />
          <Rect x={10} y={0} width={22} height={30} radius={11} fill="transparent" stroke={{ color: C.ok, width: 5 }} />
        </Layer>
      )}
    </Layer>
  );

const Counter: React.FC<{ x: number; y: number; sent: number; back: number; show: number; zero: number }> = ({ x, y, sent, back, show, zero }) => (
  <Layer x={x} y={y} opacity={show}>
    <Rect width={420} height={130} radius={22} fill={C.panel} stroke={{ color: zero > 0 ? C.bad : C.line, width: 2 }} />
    <Text x={0} y={18} maxWidth={210} align="center" font={SANS} weight={800} size={60} color={C.ink}>{String(sent)}</Text>
    <Text x={0} y={92} maxWidth={210} align="center" font={SANS} weight={600} size={20} color={C.ink}>packets sent</Text>
    <Layer x={315} y={50} scale={lerp(1, 1.18, zero * (1 - zero) * 4)} origin={[0, 0]}>
      <Text x={-105} y={-32} maxWidth={210} align="center" font={SANS} weight={800} size={60} color={C.bad} effects={[glow({ radius: 10, color: C.bad, intensity: 0.45 * show })]}>{String(back)}</Text>
    </Layer>
    <Text x={210} y={92} maxWidth={210} align="center" font={SANS} weight={600} size={20} color={C.bad}>came back</Text>
  </Layer>
);

const Chip: React.FC<{ x: number; y: number; text: string; color: string; show: number; w?: number; font?: string; size?: number }> =
  ({ x, y, text, color, show, w = 220, font = MONO, size = 26 }) => (
    <Layer x={x} y={y} opacity={Math.min(1, show)} scale={lerp(1.25, 1, Math.min(1, show))} origin="center">
      <Rect width={w} height={52} radius={26} fill="transparent" stroke={{ color, width: 2 }} />
      <Text x={0} y={(52 - size) / 2} maxWidth={w} align="center" font={font} weight={font === MONO ? 500 : 600} size={size} color={color} lineHeight={1}>{text}</Text>
    </Layer>
  );

/** A soft pool of coloured light under a point. */
const Spot: React.FC<{ cx: number; cy: number; r: number; color: string; amt: number }> = ({ cx, cy, r, color, amt }) =>
  amt <= 0.001 ? null : (
    <Rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} opacity={amt} fill={{
      type: 'radial', cx: r, cy: r, r, stops: [{ offset: 0, color }, { offset: 1, color: 'rgba(0,0,0,0)' }],
    }} />
  );

/** Faint drifting dot grid behind the network diagrams. */
const Field: React.FC<{ f: number; amt?: number }> = ({ f, amt = 1 }) => {
  const dots: React.ReactNode[] = [];
  const ox = (f * 0.25) % 80;
  for (let x = 0; x < W; x += 80) for (let y = 40; y < H; y += 80) {
    dots.push(<Ellipse key={`${x}:${y}`} x={((x + ox) % W) - 2} y={y - 2} width={4} height={4} fill="#ffffff" opacity={0.07 * amt} />);
  }
  return <Layer>{dots}</Layer>;
};

// diagram positions (card centres)
const LAP: [number, number] = [330, 300];
const RT: [number, number] = [960, 300];
const NET: [number, number] = [1590, 300];
const ATT: [number, number] = [960, 620];
// laptop corner -> impostor corner, clear of the address-book card
const HOP_A: [number, number] = [480, 372];
const HOP_B: [number, number] = [802, 598];

// ---------------------------------------------------------------- cold open

const COLD = {
  type: 14,                 // "05:34:03" types in from here, 3 frames a character
  line: 34, lineEnd: 98,    // the monitor line draws across
  beats: [0.3, 0.55],       // heartbeats along the line
  flat: 0.66,               // where it goes flat
};
const coldFlatAt = Math.round(lerp(COLD.line, COLD.lineEnd, COLD.flat));

/** The monitor trace: y offset at u (0..1). */
const ecg = (u: number) => {
  for (const c of COLD.beats) {
    const d = (u - c) * 100;
    if (d > -2 && d < -1) return -8;
    if (d >= -0.4 && d < 0) return 16;
    if (d >= 0 && d < 0.5) return -110;
    if (d >= 0.5 && d < 1.1) return 46;
  }
  return 0;
};

const ColdOpen: React.FC<{ f: number }> = ({ f }) => {
  const text = '05:34:03';
  const n = Math.max(0, Math.min(text.length, Math.floor((f - COLD.type) / 3) + 1));
  const p = interpolate(f, [COLD.line, COLD.lineEnd], [0, 1], clamp);
  const x0 = 360, x1 = 1560, y0 = 720;
  const pts = (a: number, b: number) => {
    const out: string[] = [];
    for (let i = 0; i <= 600; i++) {
      const u = i / 600;
      if (u < a || u > b) continue;
      out.push(`${out.length ? 'L' : 'M'} ${(x0 + (x1 - x0) * u).toFixed(1)} ${(y0 + ecg(u)).toFixed(1)}`);
    }
    return out.join(' ');
  };
  const dead = f >= coldFlatAt;
  return (
    <Layer>
      <Text x={0} y={330} maxWidth={W} align="center" font={MONO} weight={500} size={150} color={dead ? C.bad : C.ink}>{text.slice(0, n)}</Text>
      <Text x={0} y={500} maxWidth={W} align="center" font={SANS} weight={600} size={26} color={C.ink} opacity={prog(f, COLD.line, 12)}>Hostel internet, 28 October 2026</Text>
      {p > 0 && <Path d={pts(0, Math.min(p, COLD.flat))} stroke={{ color: C.ok, width: 4 }} effects={[glow({ radius: 8, color: C.ok, intensity: 0.35 })]} />}
      {p > COLD.flat && <Path d={pts(COLD.flat, p)} stroke={{ color: C.bad, width: 4 }} effects={[glow({ radius: 8, color: C.bad, intensity: 0.35 })]} />}
      <CText cx={W / 2} y={790} size={30} weight={800} color={C.bad} opacity={prog(f, coldFlatAt + 6, 8)}>no reply</CText>
    </Layer>
  );
};

// ---------------------------------------------------------------- scenes

const Title: React.FC<{ f: number }> = ({ f }) => {
  const a = at('title1');
  const t1 = pop(f, at('title2', 'twice'));
  const t2 = pop(f, at('title2', 'twice') + 8);
  return (
    <Layer>
      <Reveal f={f} from={a} y={300} size={120} text="Two attacks. One day." />
      <CText cx={W / 2} y={460} size={32} weight={600} opacity={prog(f, at('title1') + 20, 16)}>Hostel LAN, 28 October 2026</CText>
      <Chip x={W / 2 - 300} y={560} w={260} text="05:34" color={C.bad} show={t1} size={36} />
      <Chip x={W / 2 + 40} y={560} w={260} text="15:28" color={C.bad} show={t2} size={36} />
      <CText cx={W / 2 - 170} y={640} w={300} size={24} weight={600} opacity={t1}>morning</CText>
      <CText cx={W / 2 + 170} y={640} w={300} size={24} weight={600} opacity={t2}>afternoon</CText>
    </Layer>
  );
};

const Normal: React.FC<{ f: number; d: Data }> = ({ f, d }) => {
  const show = prog(f, at('normal1') - 6, 14);
  const ask = pop(f, at('normal1', 'asks'));
  const reply = pop(f, at('normal2', 'answers'));
  const flow = at('normal2', 'traffic');
  const ripple = (f - at('normal1', 'asks')) / 30;
  return (
    <Layer>
      <Field f={f} amt={show} />
      <Link a={LAP} b={RT} opacity={show} />
      <Link a={RT} b={NET} opacity={show} />
      <Device cx={LAP[0]} cy={LAP[1]} title="Laptop" sub={d.laptopIp} color={C.ink} show={show} />
      <Device cx={RT[0]} cy={RT[1]} title="Hostel router" sub={`MikroTik ${d.gwIp}`} color={C.router} show={show} w={340} glow={reply} />
      <Device cx={NET[0]} cy={NET[1]} title="Internet" sub="TM Unifi fibre" color={C.ok} show={show} />
      {ripple > 0 && ripple < 1.5 && [0, 0.35].map((o) => {
        const r = Math.max(0, ripple - o) * 520;
        return <Ellipse key={o} x={LAP[0] - r} y={LAP[1] - r} width={2 * r} height={2 * r} fill="transparent" stroke={{ color: C.ink, width: 3 }} opacity={interpolate(ripple - o, [0, 1], [0.5, 0], clamp)} />;
      })}
      <Bubble cx={LAP[0] + 40} cy={140} text="Who is the router?" color={C.ink} show={ask} w={380} />
      <Bubble cx={RT[0]} cy={140} text="That's me" sub={d.gwMac} color={C.router} show={reply} w={400} />
      <ArpCard cx={LAP[0]} y={420} ip={d.gwIp} mac={d.gwMac} color={C.router} flash={reply} />
      <Packets f={f} a={[LAP[0] + 150, LAP[1]]} b={[RT[0] - 170, RT[1]]} start={flow} color={C.ok} />
      <Packets f={f} a={[RT[0] + 170, RT[1]]} b={[NET[0] - 150, NET[1]]} start={flow + 24} color={C.ok} />
      <Packets f={f} a={[NET[0] - 150, NET[1] + 30]} b={[LAP[0] + 150, LAP[1] + 30]} start={flow + 48} color={C.router} travel={50} every={8} />
    </Layer>
  );
};

/** Word anchors for the two attacks. */
const A1 = () => ({
  base: at('a1_1'), att: at('a1_1', 'another'), lie: at('a1_1', 'message'), flip: at('a1_2', 'believed'),
  victims: at('a1_2', 'two'), swallow: at('a1_3', 'every'), count: at('a1_3', '71'), zero: at('a1_3', 'zero'),
});
const A2 = () => ({
  base: at('a2_dev'), att: at('a2_dev'), addr: at('a2_addr'), lie: at('a2_lie'), flip: at('a2_lie') + 4,
  victims: at('a2_more', 'four'), swallow: at('a2_lie') + 6, count: at('a2_count'), zero: at('a2_count', 'zero'), scan: at('a2_more', 'looking'),
});

const Attack: React.FC<{ f: number; d: Data; second?: boolean }> = ({ f, d, second }) => {
  const k = second ? A2() : A1();
  const show = prog(f, k.base - 8, 14);
  const att = second ? slam(f, k.att) : pop(f, k.att);
  const lie = pop(f, k.lie);
  const flip = prog(f, k.flip, 8);
  const dim = prog(f, k.att, 16);
  const victims = second ? d.victims2 : d.victims1;
  const total = second ? 42 : 71;
  const sent = Math.round(interpolate(f, [k.count - 30, k.count], [0, total], clamp));
  const scan = second ? pop(f, A2().scan) : 0;
  const mac = flip > 0.5 ? d.attMac : d.gwMac;
  const macChip = second ? slam(f, A2().addr) : att;
  const rest = 1 - 0.45 * dim;
  return (
    <Layer>
      <Field f={f} amt={show * rest} />
      <Spot cx={ATT[0]} cy={ATT[1]} r={380} color="rgba(255,69,58,0.035)" amt={dim} />
      <Layer opacity={rest}>
        <Link a={LAP} b={RT} opacity={show * (1 - flip * 0.75)} />
        <Link a={RT} b={NET} opacity={show} />
        <Device cx={RT[0]} cy={RT[1]} title="Hostel router" sub={`MikroTik ${d.gwIp}`} color={C.router} show={show} w={340} />
        <Device cx={NET[0]} cy={NET[1]} title="Internet" sub="TM Unifi fibre" color={C.ok} show={show} />
      </Layer>
      <Link a={HOP_A} b={HOP_B} color={C.bad} opacity={flip} />
      <Device cx={LAP[0]} cy={LAP[1]} title="Laptop" sub={d.laptopIp} color={C.ink} show={show} />
      <Device cx={ATT[0]} cy={ATT[1]} title="Impostor" sub={`${d.attIp}`} color={C.bad} show={Math.min(1, att)} glow={lie} w={320} />
      <Chip x={ATT[0] - 160} y={ATT[1] + 90} w={320} text={d.attMac} color={C.bad} show={macChip} size={22} />
      <Bubble cx={ATT[0]} cy={462} text={`"I am ${d.gwIp}"`} sub={d.attMac} color={C.bad} show={lie} w={430} />
      <ArpCard cx={LAP[0]} y={420} ip={d.gwIp} mac={mac} color={flip > 0.5 ? C.bad : C.router} flash={flip} />
      <Chip x={60} y={40} w={250} text={second ? '15:28:54' : '05:34:03'} color={C.bad} show={pop(f, k.base - 4)} size={30} />
      {second && (
        <>
          <Chip x={330} y={40} w={250} text="same device" color={C.bad} show={slam(f, A2().att)} font={SANS} size={24} />
          <Chip x={600} y={40} w={270} text="same address" color={C.bad} show={slam(f, A2().addr)} font={SANS} size={24} />
          <Chip x={890} y={40} w={210} text="same lie" color={C.bad} show={slam(f, A2().lie)} font={SANS} size={24} />
        </>
      )}
      {/* other victims */}
      {victims.map((ip, i) => {
        const vx = 1330 + (i % 2) * 300;
        const vy = 560 + Math.floor(i / 2) * 140;
        const on = pop(f, k.victims + i * 5);
        const target = second && ip === '10.255.23.47';
        return (
          <Layer key={ip} opacity={on}>
            <Rect x={vx} y={vy} width={260} height={92} radius={18} fill={C.panel} stroke={{ color: C.bad, width: 2 }} />
            <Text x={vx} y={14 + vy} maxWidth={260} align="center" font={SANS} weight={600} size={20} color={C.ink}>{target && scan > 0.5 ? 'victim, also hit 05:34' : 'lost the router'}</Text>
            <Text x={vx} y={48 + vy} maxWidth={260} align="center" font={MONO} weight={500} size={22} color={C.bad}>{ip}</Text>
          </Layer>
        );
      })}
      {second && <Bubble cx={1490} cy={460} text="who-has 10.255.23.47?" sub={`from ${d.attIp}`} color={C.warn} show={scan} w={460} />}
      <Packets f={f} a={HOP_A} b={HOP_B} start={k.swallow} color={C.ok} drop every={5} travel={22} />
      <Counter x={70} y={590} sent={sent} back={0} show={prog(f, k.count - 34, 10)} zero={prog(f, k.zero, 10)} />
    </Layer>
  );
};

const Symptoms: React.FC<{ f: number }> = ({ f }) => {
  const c1 = pop(f, at('sym1', 'discord'));
  const c2 = pop(f, at('sym1', 'friends'));
  const c3 = pop(f, at('sym1', 'pages'));
  const big = pop(f, at('sym2'));
  const spin = (f / 30) * 360;
  const ping = Math.round(interpolate(f, [at('sym1', 'discord'), at('sym1', 'milliseconds')], [38, 5000], clamp));
  const card = (x: number, show: number, head: string, body: React.ReactNode) => (
    <Layer x={x} y={130} opacity={show} scale={lerp(0.9, 1, show)} origin="center">
      <Rect width={500} height={360} radius={28} fill={C.panel} stroke={{ color: C.line, width: 2 }} />
      <Text x={0} y={36} maxWidth={500} align="center" font={SANS} weight={600} size={26} color={C.ink}>{head}</Text>
      {body}
    </Layer>
  );
  return (
    <Layer>
      {card(130, c1, 'Discord voice:', <>
        <Text x={0} y={130} maxWidth={500} align="center" font={SANS} weight={800} size={92} color={C.bad}>{`${ping} ms`}</Text>
        <Text x={0} y={262} maxWidth={500} align="center" font={SANS} weight={400} size={24} color={C.ink}>red, then endless reconnecting</Text>
      </>)}
      {card(710, c2, 'Your friends:', <>
        <Text x={0} y={130} maxWidth={500} align="center" font={SANS} weight={800} size={52} color={C.bad}>"Can't hear you"</Text>
        <Text x={0} y={240} maxWidth={500} align="center" font={SANS} weight={400} size={24} color={C.ink} lineHeight={1.3}>{'but you still hear them:\nincoming traffic skips the impostor'}</Text>
      </>)}
      {card(1290, c3, 'Every website:', <>
        <Layer x={250} y={190} rotation={spin} origin="center">
          <Path d="M 0 -44 A 44 44 0 0 1 44 0" stroke={{ color: C.ink, width: 8 }} />
        </Layer>
        <Text x={0} y={270} maxWidth={500} align="center" font={SANS} weight={400} size={24} color={C.ink}>loading forever, no error page</Text>
      </>)}
      <CText cx={W / 2} y={600} size={48} weight={800} opacity={big}>No reply means no error, just waiting.</CText>
    </Layer>
  );
};

const Timeline1: React.FC<{ f: number }> = ({ f }) => {
  const s = at('a1_end');
  const pulled = at('a1_end', 'pulled');
  // positions are spread for reading, not to scale (the first three are 17 s apart, the last 2.5 min)
  const marks: [string, string, number, string, number][] = [
    ['05:34:03', 'router address swapped', 0, C.bad, s + 6],
    ['05:34:06', 'outage starts', 0.22, C.bad, s + 16],
    ['05:34:20', 'everything dead', 0.44, C.bad, s + 26],
    ['05:36:35', 'cable pulled, 150 s later', 1, C.ok, pulled],
  ];
  const x0 = 200, x1 = 1720;
  const fill = prog(f, s, pulled - s);
  return (
    <Layer>
      <CText cx={W / 2} y={120} size={44} weight={800} opacity={prog(f, s - 6)}>Attack 1: 150 seconds offline</CText>
      <Rect x={x0} y={400} width={x1 - x0} height={10} radius={5} fill={C.line} />
      <Rect x={x0} y={400} width={(x1 - x0) * fill} height={10} radius={5} fill={C.bad} />
      {marks.map(([t, label, off, col, when], i) => {
        const x = x0 + (x1 - x0) * off;
        const show = prog(f, when, 10);
        const up = i % 2 === 0;
        return (
          <Layer key={t} opacity={show}>
            <Ellipse x={x - 14} y={391} width={28} height={28} fill={col} />
            <Text x={x - 160} y={up ? 260 : 450} maxWidth={320} align="center" font={MONO} weight={500} size={28} color={col}>{t}</Text>
            <Text x={x - 160} y={up ? 304 : 494} maxWidth={320} align="center" font={SANS} weight={600} size={24} color={C.ink}>{label}</Text>
          </Layer>
        );
      })}
      <CText cx={W / 2} y={186} size={28} weight={600} opacity={pop(f, at('a1_end', 'netbug'))}>netbug logged the swap, the outage and the fake replies, second by second</CText>
      <Hotspot f={f} />
    </Layer>
  );
};

/** Unplugging moves the laptop to Wi-Fi: Ethernet crossed out, then the hotspot, then the internet back. */
const Hotspot: React.FC<{ f: number }> = ({ f }) => {
  const eth = pop(f, at('a1_wifi', 'cable'));
  const wifi = pop(f, at('a1_wifi', 'hotspot'));
  const back = pop(f, at('a1_wifi', 'back'));
  const arrow = prog(f, at('a1_wifi', 'switched'), 14);
  const card = (x: number, show: number, title: string, sub: string, color: string, mark: string) => (
    <Layer x={x + 170} y={655} opacity={Math.min(1, show)} scale={lerp(0.85, 1, Math.min(1, show))}>
      <Layer x={-170} y={-65}>
        <Rect width={340} height={130} radius={22} fill={C.panel} stroke={{ color, width: 3 }} />
        <Text x={0} y={26} maxWidth={340} align="center" font={SANS} weight={800} size={32} color={C.ink}>{title}</Text>
        <Text x={0} y={78} maxWidth={340} align="center" font={SANS} weight={600} size={22} color={color}>{`${mark}  ${sub}`}</Text>
      </Layer>
    </Layer>
  );
  return (
    <Layer>
      {card(470, eth, 'Ethernet', 'unplugged', C.bad, '\u00d7')}
      <Rect x={830} y={652} width={260 * arrow} height={6} radius={3} fill={C.ink} opacity={arrow} />
      <Path d="M 1078 638 L 1100 655 L 1078 672" stroke={{ color: C.ink, width: 6 }} opacity={arrow > 0.95 ? 1 : 0} />
      {card(1110, wifi, 'Wi-Fi hotspot', 'different network', C.ok, '\u2713')}
      <CText cx={1280} y={740} w={500} size={26} weight={800} color={C.ok} opacity={back}>internet back at once</CText>
    </Layer>
  );
};

/** The clock runs from the end of attack 1 (05:36) to 15:28 between "waited" and "3:28". */
const testClock = () => ({ from: at('test1', 'waited') + 6, to: at('test2', '3:28') });
const CLOCK_FROM = 5 * 60 + 36, CLOCK_TO = 15 * 60 + 28;

const Test: React.FC<{ f: number }> = ({ f }) => {
  const a = pop(f, at('test1', 'watching'));
  const { from, to } = testClock();
  const b = prog(f, from - 8, 10);
  const again = pop(f, at('test2', 'again'));
  const m = Math.round(interpolate(f, [from, to], [CLOCK_FROM, CLOCK_TO], { ...clamp, easing: Easing.inOut(Easing.cubic) }));
  const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return (
    <Layer>
      <Chip x={W / 2 - 320} y={180} w={640} text="netbug kept logging, every second" color={C.ink} show={a} font={SANS} size={26} />
      <CText cx={W / 2} y={300} size={200} weight={800} font={SANS} opacity={b} color={again > 0.5 ? C.bad : C.ink}>{hhmm}</CText>
      <CText cx={W / 2} y={560} size={80} weight={800} color={C.bad} opacity={again} glowAmt={again}>It happened again.</CText>
    </Layer>
  );
};

const Compare: React.FC<{ f: number; d: Data }> = ({ f, d }) => {
  const rows: [string, string, string][] = [
    ['Router address swapped to', d.attMac, d.attMac],
    ['Impostor IP', d.attIp, d.attIp],
    ['Packets out / back', '71 / 0', '42 / 0'],
    ['Fake "I am the router" replies', '2', '3'],
    ['Real router seen', 'never', 'never'],
    ['Other devices hit', '2', '4'],
  ];
  const fin = slam(f, at('cmp2', 'purpose'));
  return (
    <Layer>
      <Text x={160} y={70} font={SANS} weight={600} size={26} color={C.ink} opacity={prog(f, at('cmp1') - 6)}>Check:</Text>
      <Text x={860} y={70} maxWidth={400} align="center" font={SANS} weight={800} size={30} color={C.ink} opacity={prog(f, at('cmp1') - 6)}>05:34</Text>
      <Text x={1260} y={70} maxWidth={400} align="center" font={SANS} weight={800} size={30} color={C.ink} opacity={prog(f, at('cmp1') - 6)}>15:28</Text>
      {rows.map(([k, a, b], i) => {
        const when = compareRow(i);
        const show = prog(f, when, 8);
        const tick = slam(f, when + 3);
        const y = 140 + i * 74;
        return (
          <Layer key={k} opacity={show}>
            <Rect x={150} y={y - 12} width={1620} height={2} fill={C.line} />
            <Text x={160} y={y + 10} font={SANS} weight={600} size={26} color={C.ink}>{k}</Text>
            <Text x={860} y={y + 10} maxWidth={400} align="center" font={MONO} weight={500} size={26} color={C.bad}>{a}</Text>
            <Text x={1260} y={y + 10} maxWidth={400} align="center" font={MONO} weight={500} size={26} color={C.bad}>{b}</Text>
            <Layer x={1697} y={y + 25} scale={lerp(1.8, 1, Math.min(1, tick))} opacity={Math.min(1, tick)} origin={[0, 0]}>
              <Text x={-17} y={-21} font={SANS} weight={800} size={34} color={C.ok}>✓</Text>
            </Layer>
          </Layer>
        );
      })}
      <Layer x={W / 2} y={650} scale={lerp(1.3, 1, Math.min(1, fin))} opacity={Math.min(1, fin)} origin={[0, 0]}>
        <CText cx={0} y={-31} size={52} weight={800} color={C.bad} glowAmt={fin}>Same device. On purpose.</CText>
      </Layer>
    </Layer>
  );
};
/** Frame each comparison row lands: spread over the first line. */
const compareRow = (i: number) => at('cmp1') + 4 + Math.round(i * (lineOf('cmp1').frames - 10) / 6);

const fixShots = () => {
  const out: number[] = [];
  for (let s = at('fix1', 'fake'); s < at('fix2') + 12; s += 22) out.push(s);
  return out;
};

const Fix: React.FC<{ f: number; d: Data }> = ({ f, d }) => {
  const show = prog(f, at('fix1') - 8, 14);
  const lock = pop(f, at('fix1', 'pin'));
  const att = pop(f, at('fix1', 'fake'));
  const flow = at('fix2', 'reconnecting');
  const c1 = pop(f, at('fix2', 'only'));
  const c2 = pop(f, at('fix2', 'outgoing'));
  // fake replies bounce off the laptop's locked entry
  const shots = fixShots().filter((s) => s < f).map((s) => {
    const t = (f - s) / 26;
    if (t > 1.6) return null;
    const go = Math.min(1, t);
    const back = Math.max(0, t - 1);
    const x = lerp(HOP_B[0], HOP_A[0] + 40, go) + back * 160;
    const y = lerp(HOP_B[1], HOP_A[1] + 60, go) + back * 120;
    return <Ellipse key={s} x={x - 10} y={y - 10} width={20} height={20} fill={C.bad} opacity={interpolate(t, [0, 0.1, 1, 1.6], [0, 1, 1, 0])} />;
  });
  return (
    <Layer>
      <Field f={f} amt={show} />
      <Spot cx={LAP[0]} cy={LAP[1] + 120} r={380} color="rgba(48,209,88,0.05)" amt={lock} />
      <Link a={LAP} b={RT} opacity={show} />
      <Link a={RT} b={NET} opacity={show} />
      <Device cx={LAP[0]} cy={LAP[1]} title="Laptop" sub={d.laptopIp} color={C.ink} show={show} />
      <Device cx={RT[0]} cy={RT[1]} title="Hostel router" sub={`MikroTik ${d.gwIp}`} color={C.router} show={show} w={340} />
      <Device cx={NET[0]} cy={NET[1]} title="Internet" sub="TM Unifi fibre" color={C.ok} show={show} />
      <Device cx={ATT[0]} cy={ATT[1]} title="Impostor" sub={d.attIp} color={C.bad} show={att} w={320} />
      <Bubble cx={ATT[0]} cy={462} text={`"I am ${d.gwIp}"`} color={C.bad} show={att * (1 - prog(f, at('fix2'), 12))} w={430} />
      <ArpCard cx={LAP[0]} y={420} ip={d.gwIp} mac={d.gwMac} color={C.ok} flash={lock} lock={lock} />
      <Chip x={LAP[0] - 160} y={560} w={320} text="pinned: fakes ignored" color={C.ok} show={lock} font={SANS} size={22} />
      {shots}
      <Packets f={f} a={[LAP[0] + 150, LAP[1]]} b={[RT[0] - 170, RT[1]]} start={flow} color={C.ok} />
      <Packets f={f} a={[RT[0] + 170, RT[1]]} b={[NET[0] - 150, NET[1]]} start={flow + 24} color={C.ok} />
      <Chip x={1240} y={560} w={560} text="protects only this laptop" color={C.warn} show={c1} font={SANS} size={26} />
      <Chip x={1240} y={630} w={560} text="and only its outgoing traffic" color={C.warn} show={c2} font={SANS} size={26} />
    </Layer>
  );
};

const Rcc: React.FC<{ f: number; d: Data }> = ({ f, d }) => {
  const s = at('rcc');
  const steps: [string, string][] = [
    ['find', '1. Find it on the MikroTik: DHCP lease + bridge host table'],
    ['isolation', '2. Turn on client isolation (residents can\'t reach each other)'],
    ['arp', '3. Turn on ARP protection (DHCP-only ARP, ARP inspection)'],
  ];
  const endIn = prog(f, sceneFrom.end, 20);
  return (
    <Layer>
      <Layer opacity={1 - endIn}>
        <CText cx={W / 2} y={70} size={52} weight={800} opacity={pop(f, s)}>For the hostel team</CText>
        <Layer x={460} y={180} opacity={pop(f, at('rcc', 'device'))}>
          <Rect width={1000} height={150} radius={26} fill={C.panel} stroke={{ color: C.bad, width: 3 }} />
          <Text x={0} y={28} maxWidth={1000} align="center" font={SANS} weight={600} size={26} color={C.ink}>Device to look for:</Text>
          <Text x={0} y={76} maxWidth={1000} align="center" font={MONO} weight={500} size={40} color={C.bad}>{`${d.attIp}   ${d.attMac}`}</Text>
        </Layer>
        {steps.map(([w, text], i) => (
          <Text key={w} x={360} y={400 + i * 78} maxWidth={1200} font={SANS} weight={600} size={32} color={C.ink} opacity={pop(f, at('rcc', w))}>{text}</Text>
        ))}
      </Layer>
      <Layer opacity={endIn}>
        <Reveal f={f} from={sceneFrom.end + 6} y={330} size={96} text="netbug" stagger={2} />
        <CText cx={W / 2} y={470} size={32} weight={600} opacity={prog(f, sceneFrom.end + 24, 16)}>Full report, logs and packet captures available on request</CText>
        <CText cx={W / 2} y={530} size={28} font={MONO} weight={500} color={C.router} opacity={prog(f, sceneFrom.end + 34, 16)}>github.com/tariqaq/netbug</CText>
      </Layer>
    </Layer>
  );
};

// ---------------------------------------------------------------- captions

type Page = { from: number; to: number; words: { text: string; at: number }[] };
const PAGES: Page[] = [];
for (const l of placed) {
  let cur: Page | null = null;
  l.words.forEach((w, i) => {
    if (!cur) { cur = { from: l.from + sec(w.start), to: 0, words: [] }; PAGES.push(cur); }
    cur.words.push({ text: w.text, at: l.from + sec(w.start) });
    const last = i === l.words.length - 1;
    const brk = /[.,:;?!]$/.test(w.text) && cur.words.length >= 4;
    if (last || brk || cur.words.length >= 11) { cur.to = last ? l.from + l.frames + 4 : l.from + sec(l.words[i + 1].start); cur = null; }
  });
}

const Captions: React.FC<{ f: number }> = ({ f }) => {
  const p = PAGES.find((pg) => f >= pg.from && f < pg.to);
  if (!p) return null;
  const text = p.words.map((w) => w.text).join(' ');
  let active = -1;
  p.words.forEach((w, i) => { if (f >= w.at) active = i; });
  const styles: ({ color: string } | null)[] = [];
  p.words.forEach((w, i) => {
    for (const _ of Array.from(w.text)) styles.push(i === active ? { color: C.hi } : null);
    if (i < p.words.length - 1) styles.push(null);
  });
  return (
    <Layer y={H - 170}>
      <Text x={160} y={0} maxWidth={W - 320} align="center" font={SANS} weight={600} size={44} color={C.ink} lineHeight={1.25} chars={styles}>{text}</Text>
    </Layer>
  );
};

// ---------------------------------------------------------------- hits, sound and score

/** Moments that hit: each shakes the camera, fringes the picture and plays a sound. */
const HITS: (Hit & { sfx?: Sfx[]; gain?: number })[] = [];
const hit = (f: number, shake: number, fringe: number, sfx: Sfx[] = [], gain = 1) => HITS.push({ f, shake, fringe, sfx, gain });
const fx = (f: number, kind: Sfx, gain = 1, len?: number) => cue(f, kind, { gain, ...(len ? { len } : {}) });
{
  // cold open: clock ticks while the time types in, two heartbeats on the trace, then it flatlines
  [4, 30, 56, 82, 108].forEach((t, i) => fx(t, i % 2 ? 'tock' : 'tick', 0.8));
  for (let i = 0; i < 8; i++) fx(COLD.type + i * 3, 'type', 0.9);
  for (const c of COLD.beats) {
    const t = lerp(COLD.line, COLD.lineEnd, c);
    fx(t - 1, 'heartbeat', 0.9); fx(t, 'beep', 1);
  }
  fx(coldFlatAt, 'flatline', 1, 1.5);
  fx(at('title1') - 32, 'riser', 0.8, 32 / FPS);
  hit(at('title1'), 10, 4, ['bigImpact']);

  // title chips, then into the network
  fx(at('title2', 'twice'), 'stamp', 0.8); fx(at('title2', 'twice') + 8, 'stamp', 0.8);
  fx(sceneFrom.normal, 'whoosh', 0.8);
  fx(at('normal1', 'asks'), 'pop'); fx(at('normal2', 'answers'), 'pop');

  // part I
  const a1 = A1();
  fx(sceneFrom.attack1, 'whoosh', 0.7); hit(sceneFrom.attack1 + 8, 0, 0, ['impact'], 0.5);
  hit(a1.att, 4, 0, ['braam'], 1);
  hit(a1.lie, 6, 6, ['glitch']);
  fx(a1.flip, 'glitch', 0.6);
  for (let i = 0; i < 2; i++) fx(a1.victims + i * 5, 'thud', 0.8);
  hit(a1.zero, 8, 3, ['impact']); fx(a1.zero + 4, 'flatline', 0.8, 1.2);

  fx(sceneFrom.timeline1, 'whoosh', 0.6);
  hit(at('a1_end', 'pulled'), 6, 2, ['impact'], 0.8);
  fx(at('a1_wifi', 'cable'), 'stamp', 0.7);
  fx(at('a1_wifi', 'hotspot'), 'pop', 1.2);
  fx(at('a1_wifi', 'back'), 'pop', 1.4);

  // part II
  fx(sceneFrom.test, 'whoosh', 0.7); hit(sceneFrom.test + 8, 0, 0, ['impact'], 0.5);
  {
    const { from, to } = testClock();
    for (let m = 1; m <= 20; m++) fx(lerp(from, to, m / 20), m % 2 ? 'tick' : 'tock', 0.7);
  }
  hit(at('test2', 'again'), 8, 4, ['bigImpact']);
  const a2 = A2();
  hit(a2.att, 7, 2, ['impact']);
  hit(a2.addr, 7, 2, ['impact']);
  hit(a2.lie, 9, 6, ['braam', 'glitch']);
  fx(a2.count, 'stamp', 0.7);
  hit(a2.zero, 6, 2, ['impact'], 0.8);
  for (let i = 0; i < 4; i++) fx(a2.victims + i * 5, 'thud', 0.7);
  fx(a2.scan, 'pop', 1.2);

  // the comparison: each row stamps, the last line lands in silence
  fx(sceneFrom.compare, 'whoosh', 0.6);
  for (let i = 0; i < 6; i++) fx(compareRow(i) + 3, 'stamp', 0.6);
  fx(at('cmp2', 'purpose') - 40, 'riser', 0.7, 40 / FPS);
  hit(at('cmp2', 'purpose'), 10, 5, ['bigImpact'], 0.6);

  // part III
  fx(sceneFrom.fix, 'whoosh', 0.7); hit(sceneFrom.fix + 8, 0, 0, ['impact'], 0.4);
  hit(at('fix1', 'pin'), 3, 0, ['lock']);
  for (const s of fixShots()) fx(s + 26, 'tink', 1);
  fx(sceneFrom.rcc, 'whoosh', 0.6);
  hit(sceneFrom.end + 6, 0, 0, ['impact'], 0.5);

  for (const h of HITS) for (const s of h.sfx ?? []) fx(h.f, s, h.gain);

  // the score, scene by scene
  const S: [number, number, Mood][] = [
    [60, sceneFrom.normal, 'dark'],
    [sceneFrom.normal, sceneFrom.attack1 + 4, 'calm'],
    [a1.base, a1.zero, 'tension'],
    [sceneFrom.symptoms, at('a1_end', 'pulled'), 'clock'],
    [at('a1_wifi'), sceneFrom.test + 6, 'calm'],
    [at('test1'), at('test2', 'again'), 'wait'],
    [a2.att, sceneFrom.compare + 4, 'tension2'],
    [sceneFrom.compare, at('cmp2', 'purpose'), 'build'],
    [at('fix1'), sceneFrom.rcc + 6, 'resolve'],
    [sceneFrom.rcc, TOTAL, 'end'],
  ];
  for (const [a, b, m] of S) scoreSection(a, b, m);
  setDuck(placed.map((l) => [l.from / FPS + 0.08, (l.from + l.frames) / FPS] as [number, number]));
}

// ---------------------------------------------------------------- composition

const SCENE_VIEWS: Record<string, React.FC<{ f: number; d: Data }>> = {
  cold: ({ f }) => <ColdOpen f={f} />,
  title: ({ f }) => <Title f={f} />,
  normal: Normal,
  attack1: ({ f, d }) => <Attack f={f} d={d} />,
  symptoms: ({ f }) => <Symptoms f={f} />,
  timeline1: ({ f }) => <Timeline1 f={f} />,
  test: ({ f }) => <Test f={f} />,
  attack2: ({ f, d }) => <Attack f={f} d={d} second />,
  compare: Compare,
  fix: Fix,
  rcc: Rcc,
};

/** Hard cuts (no fade) into these scenes. */
const CUT_IN = new Set(['title']);

const Film: React.FC<Data> = (d) => {
  const f = useCurrentFrame();
  const cam = camera(f, HITS);
  const card = SCENES.find((s) => s.card && f >= sceneFrom[s.id] && f < sceneFrom[s.id] + CARD);
  // bars: in for the cold open and title, each chapter card and the end card; out over 18 frames after each
  const bars = Math.max(
    1 - prog(f, sceneFrom.normal, 18),
    prog(f, sceneFrom.end, 24),
    ...SCENES.filter((s) => s.card && f >= sceneFrom[s.id]).map((s) => 1 - prog(f, sceneFrom[s.id] + CARD - 4, 18)),
  );
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      <Layer>
        <Layer x={cam.x} y={cam.y} effects={cam.fringe > 0.05 ? [chromaticAberration(cam.fringe)] : []}>
          {SCENES.map((s, i) => {
            const from = sceneFrom[s.id];
            const to = sceneTo(s.id);
            if (f < from - 1 || f >= to) return null;
            const fadeIn = CUT_IN.has(s.id) ? 1 : prog(f, from, 10);
            const fadeOut = i < SCENES.length - 1 && !CUT_IN.has(SCENES[i + 1].id) ? 1 - prog(f, to - 10, 10) : 1;
            const push = 1 + 0.03 * interpolate(f, [from, to], [0, 1], clamp);
            const View = SCENE_VIEWS[s.id];
            return (
              <Layer key={s.id} opacity={Math.min(fadeIn, fadeOut)} x={W / 2} y={H / 2} scale={push}>
                <Layer x={-W / 2} y={-H / 2}><View f={f} d={d} /></Layer>
              </Layer>
            );
          })}
        </Layer>
        <Vignette />
        {card?.card && <ChapterCard f={f} from={sceneFrom[card.id]} len={CARD} part={card.card[0]} sub={card.card[1]} red={C.bad} ink={C.ink} sans={SANS} mono={MONO} />}
        <Letterbox amt={bars} />
      </Layer>
      <Captions f={f} />
      {placed.map((l) => (
        <Sequence key={l.id} from={l.from}>
          <Audio src={staticFile(`vo/${l.id}.mp3`)} muted={soloMutes('voice')} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

registerRoot(() => (
  <Composition id="Incident" component={Film} durationInFrames={TOTAL} fps={FPS} width={W} height={H} background={C.bg} defaultProps={example} />
));
