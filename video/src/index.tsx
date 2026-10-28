// Incident explainer: the two ARP-spoofing attacks of 2026-10-28 and the gateway pin fix.
//
// Timing comes from public/vo/timing.json (written by scripts/tts.py): every narration line
// starts at a fixed frame, and scenes and animations are keyed to lines and to single words,
// so what's on screen happens when it is said. MACs come from the composition props:
// data.example.json (redacted, the default) or data.local.json (real values, gitignored).
//
// Render: see README.md in this folder.

import React from 'react';
import {
  AbsoluteFill, Audio, Composition, Ellipse, Layer, Path, Rect, Sequence, Text,
  interpolate, registerRoot, spring, staticFile, useCurrentFrame, Easing, glow,
} from 'remotion';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { onFrame } from '@kinetographdev/audio';
import timing from '../public/vo/timing.json';
import example from '../data.example.json';

loadInter('normal', { weights: ['400', '600', '800'] });
loadMono('normal', { weights: ['500'] });
const SANS = 'Inter';
const MONO = 'JetBrains Mono';

const FPS = 30;
const W = 1920;
const H = 1080;

const C = {
  bg: '#000000', ink: '#ffffff', line: '#2c2c2e', panel: '#111113',
  router: '#0a84ff', ok: '#30d158', bad: '#ff453a', warn: '#ff9f0a', hi: '#ffd60a',
};

type Data = typeof example;

// ---------------------------------------------------------------- timeline

type Word = { text: string; start: number; end: number };
type Line = { id: string; text: string; ms: number; words: Word[] };
type Placed = Line & { from: number; frames: number };

const SCENES: { id: string; lines: string[] }[] = [
  { id: 'title', lines: ['title1', 'title2'] },
  { id: 'normal', lines: ['normal1', 'normal2'] },
  { id: 'attack1', lines: ['a1_1', 'a1_2', 'a1_3'] },
  { id: 'symptoms', lines: ['sym1', 'sym2'] },
  { id: 'timeline1', lines: ['a1_end'] },
  { id: 'test', lines: ['test1', 'test2'] },
  { id: 'attack2', lines: ['a2_1', 'a2_2'] },
  { id: 'compare', lines: ['cmp'] },
  { id: 'fix', lines: ['fix1', 'fix2'] },
  { id: 'rcc', lines: ['rcc'] },
];

const LEAD = 15;        // frames before the first line
const GAP = 10;         // between lines of a scene
const SCENE_GAP = 20;   // between scenes
const OUTRO = 120;      // end card after the last line

const sec = (ms: number) => Math.round((ms / 1000) * FPS);
const byId = new Map((timing.lines as Line[]).map((l) => [l.id, l]));

const placed: Placed[] = [];
const sceneFrom: Record<string, number> = {};
{
  let cursor = LEAD;
  SCENES.forEach((s, si) => {
    if (si > 0) cursor += SCENE_GAP - GAP;
    sceneFrom[s.id] = cursor - (si === 0 ? LEAD : 8);
    for (const id of s.lines) {
      const l = byId.get(id);
      if (!l) throw new Error('timing.json has no line ' + id);
      const frames = sec(l.ms);
      placed.push({ ...l, from: cursor, frames });
      cursor += frames + GAP;
    }
  });
  sceneFrom.end = cursor - GAP + 12;
}
const TOTAL = sceneFrom.end + OUTRO;
const lineOf = (id: string) => placed.find((p) => p.id === id)!;

/** Absolute frame of a line's start, or of word `w` in it (`w` may be the word's text). */
const at = (id: string, w?: number | string): number => {
  const l = lineOf(id);
  if (w === undefined) return l.from;
  const idx = typeof w === 'number' ? w : l.words.findIndex((x) => x.text.replace(/[^\w:']/g, '').replace(/:$/, '').toLowerCase() === w.toLowerCase());
  if (idx < 0) throw new Error(`word "${w}" not in ${id}`);
  return l.from + sec(l.words[idx].start);
};

// ---------------------------------------------------------------- helpers

const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
/** 0 -> 1 from frame `a` over `d` frames. */
const prog = (f: number, a: number, d = 12) => interpolate(f, [a, a + d], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease });
const pop = (f: number, a: number) => (f < a ? 0 : spring({ frame: f - a, fps: FPS, config: { damping: 15, stiffness: 160 } }));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Text centred on (cx, y). Text wider than `w` would fall back to left alignment, so `w` defaults to almost the full width. */
const CText: React.FC<{ cx: number; y: number; w?: number; size: number; color?: string; weight?: number; font?: string; opacity?: number; glowAmt?: number; children: React.ReactNode }> =
  ({ cx, y, w = W - 160, size, color = C.ink, weight = 400, font = SANS, opacity = 1, glowAmt = 0, children }) => (
    <Text x={cx - w / 2} y={y} maxWidth={w} align="center" font={font} weight={weight} size={size} color={color} opacity={opacity} lineHeight={1.2}
          effects={glowAmt > 0 ? [glow({ radius: 14, color, intensity: 0.45 * glowAmt })] : []}>{children}</Text>
  );

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
      const o = drop ? interpolate(t, [0.85, 1.25], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : interpolate(t, [0, 0.1, 0.9, 1], [0, 1, 1, 0]);
      dots.push(<Ellipse key={s} x={lerp(a[0], b[0], tt) - 9} y={lerp(a[1], b[1], tt) - 9} width={18} height={18} fill={color} opacity={o} />);
    }
    return <Layer motionBlur={{ samples: 6, shutter: 0.8 }} effects={[glow({ radius: 6, color, intensity: 0.4 })]}>{dots}</Layer>;
  };

/** A straight link line between two points. */
const Link: React.FC<{ a: [number, number]; b: [number, number]; color?: string; opacity?: number; dash?: boolean }> =
  ({ a, b, color = C.line, opacity = 1, dash }) => (
    <Path d={`M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`} opacity={opacity}
          stroke={{ color, width: 4, ...(dash ? { dashArray: [12, 14] } : {}) }} />
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

const Counter: React.FC<{ x: number; y: number; sent: number; back: number; show: number }> = ({ x, y, sent, back, show }) => (
  <Layer x={x} y={y} opacity={show}>
    <Rect width={420} height={130} radius={22} fill={C.panel} stroke={{ color: C.line, width: 2 }} />
    <Text x={0} y={18} maxWidth={210} align="center" font={SANS} weight={800} size={60} color={C.ink}>{String(sent)}</Text>
    <Text x={0} y={92} maxWidth={210} align="center" font={SANS} weight={600} size={20} color={C.ink}>packets sent</Text>
    <Text x={210} y={18} maxWidth={210} align="center" font={SANS} weight={800} size={60} color={C.bad} effects={[glow({ radius: 10, color: C.bad, intensity: 0.45 * show })]}>{String(back)}</Text>
    <Text x={210} y={92} maxWidth={210} align="center" font={SANS} weight={600} size={20} color={C.bad}>came back</Text>
  </Layer>
);

const Chip: React.FC<{ x: number; y: number; text: string; color: string; show: number; w?: number; font?: string; size?: number }> =
  ({ x, y, text, color, show, w = 220, font = MONO, size = 26 }) => (
    <Layer x={x} y={y} opacity={show} scale={lerp(0.8, 1, show)} origin="center">
      <Rect width={w} height={52} radius={26} fill="transparent" stroke={{ color, width: 2 }} />
      <Text x={0} y={(52 - size) / 2} maxWidth={w} align="center" font={font} weight={font === MONO ? 500 : 600} size={size} color={color} lineHeight={1}>{text}</Text>
    </Layer>
  );

// diagram positions (card centres)
const LAP: [number, number] = [330, 300];
const RT: [number, number] = [960, 300];
const NET: [number, number] = [1590, 300];
const ATT: [number, number] = [960, 620];
// laptop corner -> impostor corner, clear of the address-book card
const HOP_A: [number, number] = [480, 372];
const HOP_B: [number, number] = [802, 598];

// ---------------------------------------------------------------- scenes

const Title: React.FC<{ f: number }> = ({ f }) => {
  const a = pop(f, at('title1'));
  const t1 = pop(f, at('title2', '5:34'));
  const t2 = pop(f, at('title2', '3:28'));
  const out = 1 - prog(f, at('title2', 'both'), 20) * 0.3;
  return (
    <Layer opacity={out}>
      <CText cx={W / 2} y={250} size={110} weight={800} opacity={a}>Two attacks in one day</CText>
      <CText cx={W / 2} y={400} size={34} weight={600} opacity={a}>Hostel LAN, 28 October 2026</CText>
      <Chip x={W / 2 - 300} y={520} w={260} text="05:34" color={C.bad} show={t1} size={36} />
      <Chip x={W / 2 + 40} y={520} w={260} text="15:28" color={C.bad} show={t2} size={36} />
      <CText cx={W / 2 - 170} y={600} w={300} size={24} weight={600} opacity={t1}>morning</CText>
      <CText cx={W / 2 + 170} y={600} w={300} size={24} weight={600} opacity={t2}>afternoon</CText>
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
      <Link a={LAP} b={RT} opacity={show} />
      <Link a={RT} b={NET} opacity={show} />
      <Device cx={LAP[0]} cy={LAP[1]} title="Laptop" sub={d.laptopIp} color={C.ink} show={show} />
      <Device cx={RT[0]} cy={RT[1]} title="Hostel router" sub={`MikroTik ${d.gwIp}`} color={C.router} show={show} w={340} glow={reply} />
      <Device cx={NET[0]} cy={NET[1]} title="Internet" sub="TM Unifi fibre" color={C.ok} show={show} />
      {ripple > 0 && ripple < 1.5 && [0, 0.35].map((o) => {
        const r = Math.max(0, ripple - o) * 520;
        return <Ellipse key={o} x={LAP[0] - r} y={LAP[1] - r} width={2 * r} height={2 * r} fill="transparent" stroke={{ color: C.ink, width: 3 }} opacity={interpolate(ripple - o, [0, 1], [0.5, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />;
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

const Attack: React.FC<{ f: number; d: Data; second?: boolean }> = ({ f, d, second }) => {
  const L = second ? { a: 'a2_1', b: 'a2_2' } : { a: 'a1_1', b: 'a1_2', c: 'a1_3' };
  const base = at(L.a);
  const show = prog(f, base - 8, 14);
  const att = second ? pop(f, at('a2_1', 'device')) : pop(f, at('a1_1', 'another'));
  const lie = second ? pop(f, at('a2_1', 'lie')) : pop(f, at('a1_1', 'message'));
  const flip = second ? prog(f, at('a2_1', 'lie'), 8) : prog(f, at('a1_2', 'believed'), 8);
  const victims = second ? d.victims2 : d.victims1;
  const vOn = second ? at('a2_2', 'four') : at('a1_2', 'two');
  const swallowFrom = second ? at('a2_1', '42') : at('a1_3', 'every');
  const countFrom = second ? at('a2_1', '42') : at('a1_3', '71');
  const total = second ? 42 : 71;
  const sent = Math.round(interpolate(f, [countFrom - 30, countFrom], [0, total], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const scan = second ? pop(f, at('a2_2', 'looking')) : 0;
  const clock = pop(f, base);
  const mac = flip > 0.5 ? d.attMac : d.gwMac;
  return (
    <Layer>
      <Link a={LAP} b={RT} opacity={show * (1 - flip * 0.75)} />
      <Link a={RT} b={NET} opacity={show} />
      <Link a={HOP_A} b={HOP_B} color={C.bad} opacity={flip} dash />
      <Device cx={LAP[0]} cy={LAP[1]} title="Laptop" sub={d.laptopIp} color={C.ink} show={show} />
      <Device cx={RT[0]} cy={RT[1]} title="Hostel router" sub={`MikroTik ${d.gwIp}`} color={C.router} show={show} w={340} />
      <Device cx={NET[0]} cy={NET[1]} title="Internet" sub="TM Unifi fibre" color={C.ok} show={show} />
      <Device cx={ATT[0]} cy={ATT[1]} title="Impostor" sub={`${d.attIp}`} color={C.bad} show={att} glow={lie} w={320} />
      <Chip x={ATT[0] - 160} y={ATT[1] + 90} w={320} text={d.attMac} color={C.bad} show={att} size={22} />
      <Bubble cx={ATT[0]} cy={462} text={`"I am ${d.gwIp}"`} sub={d.attMac} color={C.bad} show={lie} w={430} />
      <ArpCard cx={LAP[0]} y={420} ip={d.gwIp} mac={mac} color={flip > 0.5 ? C.bad : C.router} flash={flip} />
      <Chip x={60} y={40} w={250} text={second ? '15:28:54' : '05:34:03'} color={C.bad} show={clock} size={30} />
      {second && <Chip x={330} y={40} w={300} text="same device" color={C.bad} show={att} font={SANS} size={24} />}
      {/* other victims */}
      {victims.map((ip, i) => {
        const vx = 1330 + (i % 2) * 300;
        const vy = 560 + Math.floor(i / 2) * 140;
        const on = pop(f, vOn + i * 4);
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
      <Packets f={f} a={HOP_A} b={HOP_B} start={swallowFrom} color={C.ok} drop every={5} travel={22} />
      <Counter x={70} y={590} sent={sent} back={0} show={prog(f, countFrom - 34, 10)} />
    </Layer>
  );
};

const Symptoms: React.FC<{ f: number }> = ({ f }) => {
  const c1 = pop(f, at('sym1', 'discord'));
  const c2 = pop(f, at('sym1', 'friends'));
  const c3 = pop(f, at('sym1', 'pages'));
  const big = pop(f, at('sym2'));
  const spin = (f / 30) * 360;
  const ping = Math.round(interpolate(f, [at('sym1', 'discord'), at('sym1', 'milliseconds')], [38, 5000], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
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
  // positions are spread for reading, not to scale (the first three are 17 s apart, the last 2.5 min)
  const marks: [string, string, number, string][] = [
    ['05:34:03', 'router address swapped', 0, C.bad],
    ['05:34:06', 'outage starts', 0.22, C.bad],
    ['05:34:20', 'everything dead', 0.44, C.bad],
    ['05:36:35', 'cable pulled, 150 s later', 1, C.ok],
  ];
  const x0 = 200, x1 = 1720;
  const fill = prog(f, s, sec(lineOf('a1_end').ms) - 20);
  return (
    <Layer>
      <CText cx={W / 2} y={120} size={44} weight={800} opacity={prog(f, s - 6)}>Attack 1: 150 seconds offline</CText>
      <Rect x={x0} y={400} width={x1 - x0} height={10} radius={5} fill={C.line} />
      <Rect x={x0} y={400} width={(x1 - x0) * fill} height={10} radius={5} fill={C.bad} />
      {marks.map(([t, label, off, col], i) => {
        const x = x0 + (x1 - x0) * off;
        const show = prog(f, s + 8 + i * 22, 10);
        const up = i % 2 === 0;
        return (
          <Layer key={t} opacity={show}>
            <Ellipse x={x - 14} y={391} width={28} height={28} fill={col} />
            <Text x={x - 160} y={up ? 260 : 450} maxWidth={320} align="center" font={MONO} weight={500} size={28} color={col}>{t}</Text>
            <Text x={x - 160} y={up ? 304 : 494} maxWidth={320} align="center" font={SANS} weight={600} size={24} color={C.ink}>{label}</Text>
          </Layer>
        );
      })}
      <CText cx={W / 2} y={640} size={30} weight={600} opacity={pop(f, at('a1_end', 'netbug'))}>netbug logged the swap, the outage and the fake replies, second by second</CText>
    </Layer>
  );
};

const Test: React.FC<{ f: number }> = ({ f }) => {
  const a = pop(f, at('test1'));
  const b = pop(f, at('test2'));
  const again = pop(f, at('test2', 'again'));
  const t = interpolate(f, [at('test2') - 10, at('test2', '3:28')], [12, 28], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <Layer>
      <Chip x={W / 2 - 320} y={180} w={640} text="15:12  protection removed on purpose" color={C.warn} show={a} font={SANS} size={26} />
      <CText cx={W / 2} y={300} size={200} weight={800} font={SANS} opacity={b} color={again > 0.5 ? C.bad : C.ink}>{`15:${String(Math.round(t)).padStart(2, '0')}`}</CText>
      <CText cx={W / 2} y={560} size={80} weight={800} color={C.bad} opacity={again} glowAmt={again}>It happened again.</CText>
    </Layer>
  );
};

const Compare: React.FC<{ f: number; d: Data }> = ({ f, d }) => {
  const s = at('cmp');
  const rows: [string, string, string][] = [
    ['Router address swapped to', d.attMac, d.attMac],
    ['Impostor IP', d.attIp, d.attIp],
    ['Packets out / back', '71 / 0', '42 / 0'],
    ['Fake "I am the router" replies', '2', '3'],
    ['Real router seen', 'never', 'never'],
    ['Other devices hit', '2', '4'],
  ];
  const fin = pop(f, at('cmp', 'purpose'));
  return (
    <Layer>
      <Text x={160} y={70} font={SANS} weight={600} size={26} color={C.ink}>Check:</Text>
      <Text x={860} y={70} maxWidth={400} align="center" font={SANS} weight={800} size={30} color={C.ink}>05:34</Text>
      <Text x={1260} y={70} maxWidth={400} align="center" font={SANS} weight={800} size={30} color={C.ink}>15:28</Text>
      {rows.map(([k, a, b], i) => {
        const show = prog(f, s + 6 + i * 9, 8);
        const y = 140 + i * 74;
        return (
          <Layer key={k} opacity={show}>
            <Rect x={150} y={y - 12} width={1620} height={2} fill={C.line} />
            <Text x={160} y={y + 10} font={SANS} weight={600} size={26} color={C.ink}>{k}</Text>
            <Text x={860} y={y + 10} maxWidth={400} align="center" font={MONO} weight={500} size={26} color={C.bad}>{a}</Text>
            <Text x={1260} y={y + 10} maxWidth={400} align="center" font={MONO} weight={500} size={26} color={C.bad}>{b}</Text>
            <Text x={1680} y={y + 4} font={SANS} weight={800} size={34} color={C.ok}>✓</Text>
          </Layer>
        );
      })}
      <CText cx={W / 2} y={620} size={52} weight={800} color={C.bad} opacity={fin} glowAmt={fin}>Same device. On purpose.</CText>
    </Layer>
  );
};

const Fix: React.FC<{ f: number; d: Data }> = ({ f, d }) => {
  const show = prog(f, at('fix1') - 8, 14);
  const lock = pop(f, at('fix1', 'pin'));
  const att = pop(f, at('fix1', 'fake'));
  const flow = at('fix2', 'reconnecting');
  const c1 = pop(f, at('fix2', 'only'));
  const c2 = pop(f, at('fix2', 'outgoing'));
  // fake replies bounce off the laptop's locked entry
  const shots: React.ReactNode[] = [];
  for (let s = at('fix1', 'fake'); s < f; s += 22) {
    const t = (f - s) / 26;
    if (t > 1.6) continue;
    const go = Math.min(1, t);
    const back = Math.max(0, t - 1);
    const x = lerp(HOP_B[0], HOP_A[0] + 40, go) + back * 160;
    const y = lerp(HOP_B[1], HOP_A[1] + 60, go) + back * 120;
    shots.push(<Ellipse key={s} x={x - 10} y={y - 10} width={20} height={20} fill={C.bad} opacity={interpolate(t, [0, 0.1, 1, 1.6], [0, 1, 1, 0])} />);
  }
  return (
    <Layer>
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
        <CText cx={W / 2} y={300} size={96} weight={800}>netbug</CText>
        <CText cx={W / 2} y={440} size={32} weight={600}>Full report, logs and packet captures available on request</CText>
        <CText cx={W / 2} y={500} size={28} font={MONO} weight={500} color={C.router}>github.com/tariqaq/netbug</CText>
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

// ---------------------------------------------------------------- sound

// Subtle synthesized effects, well under the voice. Each is (frame, kind).
const SFX: [number, 'pop' | 'alarm' | 'thud' | 'lock' | 'whoosh'][] = [
  [at('normal1', 'asks'), 'pop'], [at('normal2', 'answers'), 'pop'],
  [at('a1_1', 'another'), 'alarm'], [at('a1_1', 'message'), 'pop'], [at('a1_3', 'zero'), 'thud'],
  [at('test2', 'again'), 'thud'],
  [at('a2_1', 'device'), 'alarm'], [at('a2_1', 'zero'), 'thud'], [at('a2_2', 'looking'), 'pop'],
  [at('fix1', 'pin'), 'lock'],
  ...SCENES.slice(1).map((s) => [sceneFrom[s.id] + 2, 'whoosh'] as [number, 'whoosh']),
];
for (const [frame, kind] of SFX) {
  onFrame(frame, (ctx, t) => {
    const g = ctx.createGain();
    g.connect(ctx.destination);
    if (kind === 'pop' || kind === 'lock') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(kind === 'pop' ? 760 : 1200, t);
      o.frequency.exponentialRampToValueAtTime(kind === 'pop' ? 1140 : 600, t + 0.07);
      g.gain.setValueAtTime(kind === 'pop' ? 0.06 : 0.09, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
      o.connect(g); o.start(t); o.stop(t + 0.13);
    } else if (kind === 'thud') {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
      g.gain.setValueAtTime(0.22, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.4);
      o.connect(g); o.start(t); o.stop(t + 0.42);
    } else if (kind === 'alarm') {
      const o = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 900;
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t);
      o.frequency.linearRampToValueAtTime(150, t + 0.5);
      g.gain.setValueAtTime(0.0005, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.55);
      o.connect(lp).connect(g); o.start(t); o.stop(t + 0.56);
    } else {
      const len = Math.floor(ctx.sampleRate * 0.35);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const ch = buf.getChannelData(0);
      let seed = frame * 9301 + 49297;
      for (let i = 0; i < len; i++) { seed = (seed * 9301 + 49297) % 233280; ch[i] = (seed / 233280) * 2 - 1; }
      const src = ctx.createBufferSource();
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass'; bp.Q.value = 0.8;
      bp.frequency.setValueAtTime(400, t);
      bp.frequency.exponentialRampToValueAtTime(2400, t + 0.3);
      src.buffer = buf;
      g.gain.setValueAtTime(0.0005, t);
      g.gain.exponentialRampToValueAtTime(0.035, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.34);
      src.connect(bp).connect(g); src.start(t); src.stop(t + 0.35);
    }
  });
}

// ---------------------------------------------------------------- composition

const SCENE_VIEWS: Record<string, React.FC<{ f: number; d: Data }>> = {
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

const Film: React.FC<Data> = (d) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg }}>
      {SCENES.map((s, i) => {
        const from = sceneFrom[s.id];
        const to = i < SCENES.length - 1 ? sceneFrom[SCENES[i + 1].id] : TOTAL;
        if (f < from - 1 || f >= to) return null;
        const fadeIn = prog(f, from, 10);
        const fadeOut = i < SCENES.length - 1 ? 1 - prog(f, to - 10, 10) : 1;
        const View = SCENE_VIEWS[s.id];
        return <Layer key={s.id} opacity={Math.min(fadeIn, fadeOut)}><View f={f} d={d} /></Layer>;
      })}
      <Captions f={f} />
      {placed.map((l) => (
        <Sequence key={l.id} from={l.from}>
          <Audio src={staticFile(`vo/${l.id}.mp3`)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

registerRoot(() => (
  <Composition id="Incident" component={Film} durationInFrames={TOTAL} fps={FPS} width={W} height={H} background={C.bg} defaultProps={example} />
));
