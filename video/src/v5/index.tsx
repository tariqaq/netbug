// Incident explainer v5: every incident (05:34 and 15:28 on 10-28, the friend's laptop to 11-01), the fix (netbug),
// how it works, and prevention, told in a 3D diorama of the hostel that goes from night to dawn.
//
// Timing comes from public/vo5/timing.json (scripts/tts5.py): every narration line starts at a fixed frame and lasts
// until its last word ends, and cameras, story events, sound and score are keyed to lines and to single words
// (`at('a1_3', 'zero')` is the frame where "Zero" is spoken). MACs come from the composition props:
// data.example.json (redacted, the default) or data.local.json (real values, gitignored).
//
// The world is in world.tsx, the 2D look (sky, haze, captions, labels) in look.tsx, sound in sound.ts and score.ts.
// Render: see README.md in this folder.

import React from 'react';
import {
  Audio, Composition, Ellipse, Layer, Path, Rect, Sequence, Text, interpolate, registerRoot, staticFile, useCurrentFrame, spring,
  Scene3D, Camera3D, AmbientLight, DirectionalLight, PointLight, Mesh, Group3D, glow, chromaticAberration, blur, motionBlur,
} from 'remotion';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import timing from '../../public/vo5/timing.json';
import example from '../../data.example.json';
import qr from './qr.json';
import {
  W, H, type V3, type Cam, type WorldState, type RoomState, add, mix3, project, handheld, sightBlocked, room, laptopAt, ROOMS, ROUTER, SWITCH,
  Building, Ground, Router, Switch, Laptop, Impostor, Packet, Ring, Skyline, along, pathToRouter, pathToRoom, pathToInternet, COL, mixHex,
} from './world';
import { Sky, Haze, Vignette, Letterbox, Tag, Captions, type CapPage, SANS, MONO, clamp, ease, prog, fadeOut } from './look';
import { cue, setDuck, soloMutes, type Sfx } from './sound';
import { scoreSection, type Mood } from './score';

loadInter('normal', { weights: ['400', '600', '700', '800'] });
loadMono('normal', { weights: ['500', '700', '800'] });

export const FPS = 60;
/** Motion-blur samples for the 3D layer (camera moves and packets smear like a 180 degree shutter). NETBUG_MB=0 turns it off for drafts. */
const MB = Number((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NETBUG_MB ?? 4);
type Data = typeof example;

// ---------------------------------------------------------------- timeline

type Word = { text: string; start: number; end: number };
type Line = { id: string; text: string; ms: number; speech: number; words: Word[] };
type Placed = Line & { from: number; frames: number };
type SceneDef = { id: string; lines: string[]; lead?: number; card?: [string, string] };

const CARD = 96;        // chapter card length (frames)
const SCENES: SceneDef[] = [
  { id: 'cold', lines: ['cold1'], lead: 120 },
  { id: 'title', lines: [], lead: 170 },
  { id: 'how', lines: ['how1', 'how2', 'how3'], lead: 24 },
  { id: 'a1', lines: ['a1_1', 'a1_2', 'a1_3'], lead: CARD + 16, card: ['I', '05:34 · the first attack'] },
  { id: 'sym', lines: ['sym1', 'sym2'] },
  { id: 'unplug', lines: ['a1_end', 'a1_rec'] },
  { id: 'a2', lines: ['a2_1', 'a2_dev', 'a2_addr', 'a2_lie', 'a2_count', 'a2_hunt', 'a2_verdict'], lead: CARD + 16, card: ['II', '15:28 · it came back'] },
  { id: 'friend', lines: ['f1', 'f2'], lead: CARD + 16, card: ['III', 'four days, down the hall'] },
  { id: 'fix', lines: ['fix0', 'fix1', 'fix2', 'fix3', 'fix4'], lead: CARD + 16, card: ['IV', 'the fix'] },
  { id: 'prev', lines: ['prev1', 'prev2', 'prev3', 'prev4'], lead: 36 },
  { id: 'end', lines: ['end'], lead: 40 },
];

const LEAD = 16;        // frames from a scene's start to its first line
const TAIL = 14;        // after a line's last word
const GAP = 16;         // between lines of a scene
const SCENE_TAIL = 30;  // after a scene's last line
const OUTRO = 300;      // end card after the last line
/** Held silences after a line (frames): for weight, and for reading what is on screen. */
const PAUSE: Record<string, number> = {
  cold1: 30, how1: 20, how2: 30, how3: 40, a1_1: 24, a1_2: 20, a1_3: 50, sym1: 30, sym2: 50, a1_end: 20, a1_rec: 90, a2_1: 24,
  a2_dev: 14, a2_addr: 14, a2_lie: 30, a2_count: 40, a2_hunt: 60, a2_verdict: 54, f1: 10, f2: 70, fix0: 24, fix1: 30, fix2: 50,
  fix3: 40, fix4: 60, prev1: 50, prev2: 50, prev3: 18, prev4: 60,
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
  sceneFrom.end_ = cursor;
}
export const TOTAL = sceneFrom.end_ + OUTRO;
const lineOf = (id: string) => { const l = placed.find((p) => p.id === id); if (!l) throw new Error('no line ' + id); return l; };
const sceneTo = (id: string) => {
  const i = SCENES.findIndex((s) => s.id === id);
  return i < SCENES.length - 1 ? sceneFrom[SCENES[i + 1].id] : TOTAL;
};
const norm = (s: string) => s.toLowerCase().replace(/[^\w:'-]/g, '').replace(/[:'-]+$/, '');
/** Absolute frame of a line's start, or of word `w` in it (index, or the word's text; `n`th match). */
const at = (id: string, w?: number | string, n = 0): number => {
  const l = lineOf(id);
  if (w === undefined) return l.from;
  let idx = -1;
  if (typeof w === 'number') idx = w;
  else { let k = 0; for (let i = 0; i < l.words.length; i++) if (norm(l.words[i].text) === norm(w) && k++ === n) { idx = i; break; } }
  if (idx < 0 || idx >= l.words.length) throw new Error(`word "${w}" not in ${id}`);
  return l.from + sec(l.words[idx].start);
};
const endOf = (id: string) => lineOf(id).from + lineOf(id).frames;
const cardAt = (id: string) => sceneFrom[id];

// ---------------------------------------------------------------- helpers

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const between = (f: number, a: number, b: number) => f >= a && f < b;
/** 0..1 on from `a` (fade `d`), back to 0 from `b`. */
const span = (f: number, a: number, b: number, d = 16) => Math.min(prog(f, a, d), fadeOut(f, b, d));
const pop = (f: number, a: number) => (f < a ? 0 : spring({ frame: f - a, fps: FPS, config: { damping: 14, stiffness: 140 } }));
const slam = (f: number, a: number) => (f < a ? 0 : spring({ frame: f - a, fps: FPS, config: { damping: 20, stiffness: 300 } }));
const smooth = (t: number) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------- cameras

type Key = [number, Cam];
const C = (pos: V3, target: V3, fov = 38): Cam => ({ pos, target, fov });
const mixCam = (a: Cam, b: Cam, t: number): Cam => ({ pos: mix3(a.pos, b.pos, t), target: mix3(a.target, b.target, t), fov: lerp(a.fov, b.fov, t) });

const MINE = laptopAt(...ROOMS.mine);
const FRIEND = laptopAt(...ROOMS.friend);
const ATT = laptopAt(...ROOMS.attacker);
const ATTC = add(ATT, [0, 0.45, 0]);
const HUNTED = room(3, 1);
const TRAP = add(room(...ROOMS.attacker), [0.25, 0.8, -0.35]);

const SHOT = {
  sky: C([0, 24, 30], [0, 6, 0], 32),
  wide: C([0, 3.6, 16.5], [0, 2.4, 0], 38),
  wideLow: C([-2, 1.2, 13], [0, 2.6, 0], 40),
  mine: C(add(MINE, [-1.5, 0.55, 2.6]), add(MINE, [0.1, 0.05, 0]), 40),
  mineClose: C(add(MINE, [-0.55, 0.28, 1.1]), add(MINE, [0, 0.1, -0.05]), 38),
  mineFloor: C(add(MINE, [-4.5, 1.6, 6.5]), add(MINE, [1.5, -0.2, 0]), 40),
  router: C(add(ROUTER, [1.6, 0.7, 3.2]), add(ROUTER, [0, 0.1, 0]), 38),
  basementWide: C([1.9, -0.25, 5.6], add(ROUTER, [-0.2, 0.15, 0]), 40),
  att: C(add(ATTC, [-0.3, 0.3, 3.0]), ATTC, 38),
  // the trap: the impostor's whole room, front-on, so packets are seen coming down the drop and into the gem
  trap: C(add(TRAP, [-0.15, 0.2, 3.4]), TRAP, 40),
  trapIn: C(add(TRAP, [-0.1, 0.1, 2.7]), TRAP, 40),
  // the three slams of 15:28, all through the room's open front
  slamDev: C(add(ATTC, [0.2, 0.1, 2.2]), ATTC, 34),
  slamAddr: C(add(ATTC, [-0.45, 0.35, 2.6]), ATTC, 30),
  slamLie: C(add(ATTC, [0.35, -0.25, 2.0]), add(ATTC, [0, 0.12, 0]), 34),
  verdict: C(add(ATTC, [-0.3, 0.2, 3.6]), ATTC, 38),
  verdictIn: C(add(ATTC, [-0.15, 0.1, 2.0]), ATTC, 34),
  victims: C([0, 3.0, 13.5], [0, 2.6, 0], 40),
  attMine: C([-1.5, 3.4, 9.5], [0.8, 2.3, 0], 40),
  hunt: C([-0.6, 4.9, 11.5], [-0.4, 4.0, 0], 38),
  corridor: C(add(FRIEND, [-1.6, 0.8, 6.2]), add(FRIEND, [-0.6, 0.2, 0]), 40),
  friend: C(add(FRIEND, [-1.2, 0.6, 2.4]), add(FRIEND, [0.1, 0.05, 0]), 40),
  dawnWide: C([4, 3.0, 17], [0, 2.6, 0], 38),
  end: C([0, 6, 21], [0, 3.4, 0], 36),
};

/** Camera keyframes for the whole film: [frame, camera], eased between neighbours; two keys on one frame make a cut. */
const KEYS: Key[] = (() => {
  const k: Key[] = [];
  const push = (f: number, c: Cam) => k.push([Math.round(f), c]);
  // cold open: descend from the sky onto the building
  push(0, SHOT.sky);
  push(sceneFrom.title - 20, C([0, 7.5, 21], [0, 3.2, 0], 36));
  // title: slow drift
  push(sceneFrom.how - 10, C([1.5, 5.2, 18], [0, 3.0, 0], 36));
  // how: into my room, out to the floor (broadcast), down to the router, back wide
  push(at('how1', 'asks') - 30, SHOT.mine);
  push(at('how1', 'router'), SHOT.mineFloor);
  push(at('how2', 'answers') - 20, SHOT.basementWide);
  push(at('how2', 'writes') - 10, SHOT.mine);
  push(at('how3') - 10, SHOT.mine);
  push(endOf('how3') + 30, SHOT.wide);
  // attack 1
  push(sceneFrom.a1 + CARD, C([3, 4.5, 15], [1.5, 3.2, 0], 36));
  push(at('a1_1', 'replying') - 10, SHOT.att);
  push(at('a1_1', 'router') + 30, SHOT.attMine);
  push(at('a1_2', 'others'), C([0, 3.2, 14.5], [0, 2.4, 0], 38));
  // 71 out: packets leave my laptop (my room), then the trap: they go down into the gem and never come back
  push(at('a1_3') - 1, C([0, 3.2, 14.5], [0, 2.4, 0], 38));
  push(at('a1_3'), SHOT.mine);
  push(at('a1_3', 'zero') - 1, mixCam(SHOT.mine, SHOT.mineClose, 0.25));
  push(at('a1_3', 'zero'), SHOT.trap);
  push(sceneFrom.sym - 1, SHOT.trapIn);
  // symptoms: close on the laptop
  push(sceneFrom.sym, SHOT.mineClose);
  push(sceneFrom.sym, SHOT.mineClose);
  push(endOf('sym2'), C(add(MINE, [-0.7, 0.4, 1.5]), add(MINE, [0, 0.12, 0]), 38));
  // unplug: pull back to the room, then wide
  push(sceneFrom.unplug, SHOT.mine);
  push(at('a1_end', 'cable') - 20, C(add(MINE, [-0.75, 0.32, 1.35]), add(MINE, [0.15, 0.0, -0.2]), 40));
  push(at('a1_end', 'hotspot'), C(add(MINE, [-0.9, 0.55, 1.9]), add(MINE, [0.2, 0.1, 0]), 42));
  push(at('a1_rec'), SHOT.mine);
  push(sceneTo('unplug'), SHOT.mineFloor);
  // attack 2: clock, three slams (cuts), the count, the hunt, the verdict
  push(sceneFrom.a2 + CARD, SHOT.wide);
  push(at('a2_dev') - 1, SHOT.wide);
  push(at('a2_dev'), SHOT.slamDev);
  push(at('a2_addr') - 1, mixCam(SHOT.slamDev, SHOT.slamAddr, 0.12));
  push(at('a2_addr'), SHOT.slamAddr);
  push(at('a2_lie') - 1, mixCam(SHOT.slamAddr, SHOT.slamLie, 0.12));
  push(at('a2_lie'), SHOT.slamLie);
  push(at('a2_count') - 1, mixCam(SHOT.slamLie, SHOT.trap, 0.1));
  // 42 out: the trap again, then the four other rooms that lost the router
  push(at('a2_count'), SHOT.trap);
  push(at('a2_count', 'four') - 1, SHOT.trapIn);
  push(at('a2_count', 'four'), SHOT.victims);
  push(at('a2_hunt'), C([0.5, 4.0, 14], [0, 3.2, 0], 38));
  push(at('a2_hunt', 'looking'), SHOT.hunt);
  push(at('a2_verdict') - 1, SHOT.hunt);
  push(at('a2_verdict'), SHOT.verdict);
  push(sceneFrom.friend - 1, SHOT.verdictIn);
  // friend: the friend's floor, then into the room
  push(sceneFrom.friend, SHOT.corridor);
  push(sceneFrom.friend + CARD, SHOT.corridor);
  push(at('f1', 'friend'), SHOT.friend);
  push(endOf('f2'), C(add(FRIEND, [-1.6, 0.9, 3.4]), add(FRIEND, [0.1, 0.2, 0]), 40));
  // fix: dawn; my room, test and pin, announce, the friend's result
  push(sceneFrom.fix + CARD, C([-2, 3.2, 13], [-0.5, 2.2, 0], 40));
  push(at('fix0', 'teeth') + 10, C(add(MINE, [-1.6, 0.9, 3.6]), add(MINE, [0, 0.3, 0]), 40));
  push(at('fix1', 'logs'), SHOT.mine);
  push(at('fix2'), C(add(MINE, [-0.4, 0.7, 2.8]), add(MINE, [0.2, 0.2, 0.4]), 40));
  push(at('fix2', 'pinned'), C(add(MINE, [-0.6, 0.6, 2.2]), add(MINE, [0.1, 0.15, 0.3]), 38));
  push(at('fix2', 'bounce'), SHOT.attMine);
  push(at('fix3') - 10, SHOT.attMine);
  push(at('fix3', 'router'), C(add(ROUTER, [-0.25, 0.45, 2.7]), add(ROUTER, [0.05, 0.2, 0]), 40));
  push(at('fix4') - 1, C(add(ROUTER, [-0.2, 0.42, 2.45]), add(ROUTER, [0.05, 0.2, 0]), 40));
  push(at('fix4'), SHOT.friend);
  push(endOf('fix4') + 30, C(add(FRIEND, [-1.4, 1.0, 3.2]), add(FRIEND, [0.1, 0.2, 0]), 40));
  // prevention: daylight wide, isolation walls, the switch
  push(sceneFrom.prev, SHOT.dawnWide);
  push(at('prev3'), SHOT.wide);
  push(at('prev4', 'isolation') - 20, C([-3, 2.4, 12.5], [0, 2.0, 0], 40));
  push(at('prev4', 'inspection'), C([2.5, 0.4, 7.5], add(SWITCH, [0, 0.3, 0]), 40));
  push(sceneFrom.end, SHOT.dawnWide);
  push(TOTAL, SHOT.end);
  return k.sort((a, b) => a[0] - b[0]);
})();

const camAt = (f: number): Cam => {
  let i = 0;
  while (i < KEYS.length - 1 && KEYS[i + 1][0] <= f) i++;
  if (i >= KEYS.length - 1) return KEYS[KEYS.length - 1][1];
  const [a, ca] = KEYS[i], [b, cb] = KEYS[i + 1];
  const t = b > a ? Math.min(1, Math.max(0, (f - a) / (b - a))) : 1;
  const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  return mixCam(ca, cb, e);
};

// NETBUG_CAMCHECK=1: print every frame range where the camera can't see its target (see sightBlocked in world.tsx).
if ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NETBUG_CAMCHECK) {
  let from = -1, why = '';
  for (let f = 0; f <= KEYS[KEYS.length - 1][0] + 1; f++) {
    const b = f <= KEYS[KEYS.length - 1][0] ? sightBlocked(camAt(f)) : null;
    if (b && from < 0) { from = f; why = b; }
    if (!b && from >= 0) { console.log(`camcheck ${from}..${f - 1} (${(from / FPS).toFixed(1)}s): ${why}`); from = -1; }
  }
  console.log('camcheck done');
}

// ---------------------------------------------------------------- story state

const DAWN = (f: number) => smooth(interpolate(f, [at('fix0'), sceneFrom.prev + 60], [0, 1], clamp));

const roomsAt = (f: number): Record<string, RoomState> => {
  const r: Record<string, RoomState> = {};
  const set = (k: readonly [number, number] | readonly number[], s: RoomState) => { const key = `${k[0]},${k[1]}`; r[key] = { ...(r[key] ?? {}), ...s }; };
  // the impostor's room is red from the first reply to the end of the fix
  set(ROOMS.attacker, { red: Math.min(prog(f, at('a1_1', 'replying'), 30), 1 - 0.6 * prog(f, at('prev4', 'isolation'), 60)) });
  // my laptop: cut off in both attacks
  const mine = Math.max(span(f, at('a1_2', 'believed'), at('a1_end', 'straight'), 24), span(f, at('a2_1', 'again'), sceneFrom.friend, 24));
  set(ROOMS.mine, { red: mine, green: prog(f, at('fix2', 'pinned'), 30) });
  // the other victims
  ROOMS.morning.forEach((k, i) => set(k, { red: span(f, at('a1_2', 'two') + i * 10, sceneFrom.unplug + 60, 30) * (0.75 + 0.25 * Math.sin(f * 0.21 + i)) }));
  ROOMS.afternoon.forEach((k, i) => {
    const prev = r[`${k[0]},${k[1]}`]?.red ?? 0;
    set(k, { red: Math.max(prev, span(f, at('a2_count', 'four') + i * 9, sceneFrom.friend, 30) * (0.75 + 0.25 * Math.sin(f * 0.19 + i * 2))) });
  });
  // friend: six red flashes (one per wired join), then green after the pin
  const flashes = FRIEND_JOINS.map((_, i) => at('f2', 'outages') + i * 16);
  let fr = 0;
  for (const a of flashes) fr = Math.max(fr, f >= a ? Math.exp(-(f - a) / 20) : 0);
  fr = Math.max(fr, span(f, at('f2', 'longest'), sceneFrom.fix, 20) * 0.9);
  set(ROOMS.friend, { red: fr, green: prog(f, at('fix4', 'pinned'), 30) });
  return r;
};

/** The friend's six cut-off wired joins (incident report §12). */
const FRIEND_JOINS = ['10-28 22:55', '10-28 23:10', '10-29 01:32', '11-01 07:06', '11-01 17:45', '11-01 18:28'];

const worldAt = (f: number): WorldState => {
  const dawn = DAWN(f);
  return {
    t: f / FPS,
    dawn,
    windows: interpolate(f, [0, sceneFrom.how, sceneFrom.how + 60], [0.25, 0.3, 0.6], clamp) * (1 - 0.7 * dawn),
    cables: interpolate(f, [sceneFrom.how, at('how2', 'sends')], [0.25, 0.7], clamp),
    isolation: prog(f, at('prev4', 'isolation'), 50),
    unplugged: span(f, at('a1_end', 'cable'), sceneFrom.a2 + CARD, 8),
    rooms: roomsAt(f),
  };
};

/** Packets travelling a path: `n` evenly spaced, one lap every `period` frames, shown with fade `a`. */
const Flow: React.FC<{ f: number; pts: V3[]; a: number; n?: number; period?: number; color?: string; size?: number; swallow?: boolean; phase?: number }> =
  ({ f, pts, a, n = 6, period = 150, color = COL.packet, size = 0.045, swallow = false, phase = 0 }) => {
    if (a <= 0.01) return null;
    return (
      <Group3D>
        {Array.from({ length: n }, (_, i) => {
          const t = (((f + phase) / period + i / n) % 1 + 1) % 1;
          const s = swallow ? size * Math.min(1, (1 - t) * 6) : size;
          return <Packet key={i} p={along(pts, t)} color={color} size={s * a} />;
        })}
      </Group3D>
    );
  };

// my wires
const P_MINE_ROUTER = pathToInternet(...ROOMS.mine);
const P_MINE_ATT = [...pathToRoom(...ROOMS.mine, ...ROOMS.attacker), add(ATTC, [0, -0.3, 0])];
/** The last stretch into the impostor (riser top on its floor -> ceiling run -> drop -> the gem): a denser flow here,
 *  so the trap shot shows packets going in. */
const P_TRAP = P_MINE_ATT.slice(-6);
const P_FRIEND_ATT = [...pathToRoom(...ROOMS.friend, ...ROOMS.attacker), add(ATTC, [0, -0.3, 0])];
const P_ROUTER_MINE = [...pathToRouter(...ROOMS.mine)].reverse();
const PHONE: V3 = add(MINE, [0.28, 0.0, 0.1]);
const P_HOTSPOT: V3[] = [MINE, add(PHONE, [0, 0.05, 0]), add(PHONE, [0.6, 0.9, 2.2]), add(PHONE, [3, 6, 6]), add(PHONE, [6, 14, 8])];

/** The 3D card a candidate MAC sits on during "Test and pin" (fix2). */
const CAND: V3[] = [add(MINE, [-0.27, 0.02, 0.12]), add(MINE, [0.3, 0.32, 0.25])];

// ---------------------------------------------------------------- the 3D world

const World: React.FC<{ f: number; cam: Cam; d: Data }> = ({ f, cam }) => {
  const t = f / FPS;
  const w = worldAt(f);
  const imp = prog(f, at('a1_1', 'replying') - 6, 40);
  const routerBad = span(f, at('fix3', 'lie'), at('fix3', 'reminds') + 50, 20);
  // flows
  const normal = Math.max(span(f, at('how2', 'sends'), at('a1_2', 'believed'), 20), prog(f, at('fix2', 'pinned') + 30, 30));
  const attack1 = span(f, at('a1_2', 'believed'), at('a1_end', 'ended'), 14);
  const attack2 = span(f, at('a2_1', 'again'), sceneFrom.friend, 14);
  const hotspot = span(f, at('a1_end', 'hotspot'), sceneFrom.a2, 20);
  const friendAtt = span(f, at('f2'), at('fix4'), 20);
  // broadcast and reply
  const bc = at('how1', 'asks');
  const reply = at('how2', 'answers');
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const a0 = bc + i * 22;
    const k = interpolate(f, [a0, a0 + 110], [0, 1], clamp);
    if (k > 0 && k < 1) rings.push(<Ring key={'b' + i} p={add(MINE, [0, -0.4, 0.2])} r={0.2 + k * 9} a={(1 - k) * 0.9} color={COL.packet} />);
  }
  // the impostor's lies: red rings from the gem while it is active
  const lying = Math.max(span(f, at('a1_1', 'replying'), at('a1_end', 'ended'), 20), span(f, at('a2_1', 'again'), sceneFrom.friend, 20),
    span(f, at('f2'), at('fix4'), 20), span(f, at('fix2', 'bounce') - 20, at('fix3'), 20));
  if (lying > 0.01) for (let i = 0; i < 3; i++) {
    const k = ((f / 70 + i / 3) % 1);
    rings.push(<Ring key={'r' + i} p={add(ATTC, [0, 0, 0.1])} r={0.3 + k * 0.42} a={(1 - k) * lying} color={COL.bad} vertical />);
  }
  // reply packet: router -> laptop (gold)
  const rp = interpolate(f, [reply, reply + 60], [0, 1], clamp);
  // test and pin (fix2)
  const test0 = at('fix2', 'real') - 10, test1 = at('fix2', 'impostor');
  const tA = interpolate(f, [test0, test0 + 50], [0, 1], clamp);          // to the router and back
  const tB = interpolate(f, [test1, test1 + 40], [0, 1], clamp);          // into the impostor
  const pinned = at('fix2', 'pinned');
  const pinDrop = slam(f, pinned);
  const shield = prog(f, pinned + 10, 30);
  // fake replies bouncing off the shield
  const bounce = at('fix2', 'bounce');
  const fakes = [];
  for (let i = 0; i < 4; i++) {
    const a0 = bounce - 30 + i * 26;
    const k = interpolate(f, [a0, a0 + 50], [0, 1], clamp);
    if (k <= 0 || k >= 1) continue;
    const hit = add(MINE, [0, 0.15, 0.0]);
    const pos = k < 0.6 ? mix3(ATTC, add(hit, [0.4, 0.3, 0.6]), k / 0.6) : mix3(add(hit, [0.4, 0.3, 0.6]), add(hit, [2.4, 1.6, 3.5]), (k - 0.6) / 0.4);
    fakes.push(<Packet key={'fk' + i} p={pos} color={COL.bad} size={0.05 * (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4)} />);
  }
  // announce: one green pulse a second from the laptop to the router (fix3 on)
  const announce = span(f, at('fix3', 'reminds'), sceneFrom.end + 200, 20);
  const ann = [];
  if (announce > 0.01) {
    const path = pathToRouter(...ROOMS.mine);
    for (let i = 0; i < 4; i++) {
      const k = ((f / FPS + i) % 4) / 4;
      ann.push(<Packet key={'an' + i} p={along(path, k)} color={COL.ok} size={0.05 * announce} k={3} />);
    }
  }
  // phone (hotspot)
  const phoneOn = Math.max(span(f, at('a1_end', 'hotspot') - 10, sceneFrom.a2, 20), span(f, at('prev1', 'switch'), at('prev2'), 20));
  // radar under the laptop (fix1)
  const radar = span(f, at('fix1') + 10, at('fix2', 'impostor'), 20);
  // isolation is in the world state; the switch gate:
  const gate = prog(f, at('prev4', 'inspection'), 40);
  // the searchlight
  const hunt = span(f, at('a2_hunt', 'looking') - 10, at('a2_verdict'), 20);
  const huntDir = add(HUNTED, [0, 0.5, 0.3]);
  const len = Math.hypot(huntDir[0] - ATTC[0], huntDir[1] - ATTC[1], huntDir[2] - ATTC[2]);
  const yaw = (Math.atan2(huntDir[0] - ATTC[0], huntDir[2] - ATTC[2]) * 180) / Math.PI;
  const pitch = (Math.asin((huntDir[1] - ATTC[1]) / len) * 180) / Math.PI;
  // lights
  const red = Math.max(imp * (1 - 0.6 * w.dawn), 0) * (0.8 + 0.2 * Math.sin(t * 5));
  return (
    <Scene3D width={W} height={H} msaa={4} effects={[glow({ radius: 18, intensity: 0.45 })]}
      environment={{ src: staticFile('v5/env.png'), intensity: lerp(0.45, 0.9, w.dawn), rotation: 30 }}>
      <Camera3D fov={cam.fov} position={cam.pos} target={cam.target} near={0.05} far={120} />
      <AmbientLight intensity={lerp(0.2, 0.35, w.dawn)} color={mixHex('#6f86c8', '#ffd6b0', w.dawn)} />
      <DirectionalLight direction={[lerp(0.4, -0.8, w.dawn), lerp(-1, -0.45, w.dawn), -0.6]} intensity={lerp(0.85, 2.0, w.dawn)}
        color={mixHex('#a9bfff', '#ffc890', w.dawn)} castShadow shadow={{ mapSize: 2048 }} />
      <PointLight position={add(ATTC, [0, 0.5, 0.6])} color="#ff3b30" intensity={3.5 * red} range={4.5} />
      <PointLight position={add(MINE, [0, 0.5, 0.5])} color={w.rooms[`${ROOMS.mine[0]},${ROOMS.mine[1]}`]?.red ? mixHex('#9ecbff', '#ff453a', w.rooms[`${ROOMS.mine[0]},${ROOMS.mine[1]}`]!.red!) : '#9ecbff'} intensity={0.9} range={2.5} />
      <PointLight position={add(ROUTER, [0, 0.6, 1.0])} color="#6fb6ff" intensity={2.2} range={3.6} />
      <PointLight position={add(FRIEND, [0, 0.5, 0.5])} color="#9ecbff" intensity={0.7} range={2.2} />
      <Building w={w} />
      <Ground w={w} uplink={Math.max(normal, 0.25)} />
      <Skyline dawn={w.dawn} t={t} />
      <Router t={t} on={0.4 + 0.6 * normal} bad={routerBad} />
      <Switch t={t} gate={gate} />
      <Laptop p={MINE} screen={mixHex('#9ecbff', '#ff6b5e', w.rooms[`${ROOMS.mine[0]},${ROOMS.mine[1]}`]?.red ?? 0)} glow={1.4} />
      <Laptop p={FRIEND} screen={mixHex('#9ecbff', '#ff6b5e', w.rooms[`${ROOMS.friend[0]},${ROOMS.friend[1]}`]?.red ?? 0)} glow={1.1} />
      {imp > 0.01 && <Impostor p={ATT} t={t} on={imp} />}
      {rings}
      <Flow f={f} pts={P_MINE_ROUTER} a={normal} n={9} period={260} />
      <Flow f={f} pts={P_MINE_ATT} a={Math.max(attack1, attack2)} n={10} period={180} color={COL.packet} size={0.065} swallow />
      <Flow f={f} pts={P_FRIEND_ATT} a={friendAtt} n={6} period={150} swallow phase={40} />
      <Flow f={f} pts={P_TRAP} a={Math.max(attack1, attack2)} n={5} period={100} color={COL.packet} size={0.065} swallow phase={17} />
      <Flow f={f} pts={P_HOTSPOT} a={hotspot} n={7} period={140} color={COL.ok} />
      {rp > 0 && rp < 1 && <Packet p={along(P_ROUTER_MINE, rp)} color={COL.gold} size={0.07} k={4} />}
      {/* phone on the desk */}
      <Mesh position={PHONE} rotation={[0, -20, 0]} geometry={{ kind: 'box', width: 0.07, height: 0.012, depth: 0.14 }}
        material={{ color: '#111', emissive: COL.ok, emissiveIntensity: 1.6 * phoneOn }} />
      {tA > 0 && tA < 1 && <Packet p={tA < 0.5 ? along(pathToRouter(...ROOMS.mine), tA * 2) : along(P_ROUTER_MINE, (tA - 0.5) * 2)} color={tA < 0.5 ? COL.packet : COL.gold} size={0.06} k={4} />}
      {tB > 0 && tB < 1 && <Packet p={along(P_MINE_ATT, tB)} size={0.06 * Math.min(1, (1 - tB) * 5)} k={4} />}
      {/* the pin: a pushpin driving into the desk beside the laptop */}
      {f >= pinned - 2 && span(f, pinned - 2, at('fix3'), 16) > 0.01 && (
        <Group3D position={add(CAND[0], [0, 0.45 * (1 - pinDrop) - 0.01, 0])}>
          <Mesh position={[0, 0.12, 0]} geometry={{ kind: 'sphere', radius: 0.07, segments: 24, rings: 16 }} material={{ color: COL.gold, metallic: 0.6, roughness: 0.25, emissive: COL.gold, emissiveIntensity: 0.4 }} />
          <Mesh position={[0, 0.04, 0]} geometry={{ kind: 'cylinder', radiusTop: 0.012, radiusBottom: 0.002, height: 0.14 }} material={{ color: '#d8dde6', metallic: 1, roughness: 0.2 }} />
        </Group3D>
      )}
      {/* the shield: a glass dome over my desk */}
      {shield > 0.01 && (
        <Mesh position={add(MINE, [0, -0.02, 0.05])} scale={[1.1 * shield, 0.9 * shield, 1.1 * shield]}
          geometry={{ kind: 'sphere', radius: 0.62, segments: 48, rings: 24 }}
          material={{ color: '#bfe6ff', emissive: '#4fb4ff', emissiveIntensity: 0.25 + 0.5 * Math.exp(-Math.max(0, f - bounce) / 30) * (f > bounce ? 1 : 0), opacity: 0.16, roughness: 0.05, doubleSided: true }} />
      )}
      {fakes}
      {ann}
      {/* radar under my laptop */}
      {radar > 0.01 && (
        <Group3D position={add(MINE, [-0.3, -0.43, 0.3])}>
          {[0.5, 0.9, 1.3].map((r) => <Ring key={r} p={[0, 0, 0]} r={r} a={0.5 * radar} color={COL.ok} />)}
          <Mesh position={[0, 0.005, 0]} rotation={[-90, 0, -(f * 3) % 360]}
            geometry={{ kind: 'box', width: 1.3, height: 0.02, depth: 0.002 }} material={{ color: '#000', emissive: COL.ok, emissiveIntensity: 2.5 * radar }} />
        </Group3D>
      )}
      {/* the searchlight */}
      {hunt > 0.01 && (
        <Group3D position={ATTC} rotation={[-pitch + 90, yaw, 0]}>
          <Mesh position={[0, -len / 2, 0]} rotation={[180, 0, 0]}
            geometry={{ kind: 'cylinder', radiusTop: 0.0, radiusBottom: 0.55, height: len, segments: 32, capped: false }}
            material={{ color: '#000', emissive: COL.bad, emissiveIntensity: 1.6 * hunt, opacity: 0.32 * hunt, doubleSided: true }} />
        </Group3D>
      )}
    </Scene3D>
  );
};

/** The netbug bug icon as SVG path data (body, head, six legs, two feelers) in a 100x100 box. */
const BUG = [
  'M30 58 A20 26 0 1 0 70 58 A20 26 0 1 0 30 58 Z',
  'M40 27 A10 10 0 1 0 60 27 A10 10 0 1 0 40 27 Z',
  'M12 42 L31 49 L31 54 L12 47 Z', 'M88 42 L69 49 L69 54 L88 47 Z',
  'M8 60 L30 60 L30 65 L8 65 Z', 'M92 60 L70 60 L70 65 L92 65 Z',
  'M12 82 L32 72 L33 77 L14 87 Z', 'M88 82 L68 72 L67 77 L86 87 Z',
  'M43 19 L34 5 L38 3 L47 17 Z', 'M57 19 L66 5 L62 3 L53 17 Z',
].join(' ');

// ---------------------------------------------------------------- 2D overlays

const LABEL_ROUTER = (d: Data) => d.gwMac;
const LABEL_ATT = (d: Data) => d.attMac;

const Labels: React.FC<{ f: number; cam: Cam; d: Data }> = ({ f, cam, d }) => {
  const P = (p: V3) => project(cam, p);
  const out: React.ReactNode[] = [];
  const tag = (key: string, p: V3, a: number, text: string, sub?: string, color?: string, dx = 40, dy = -70, size = 24) => {
    const s = P(p);
    if (!s.ok || a <= 0.01 || s.x < 20 || s.x > W - 20 || s.y < 30 || s.y > H - 200) return;
    out.push(<Tag key={key} x={s.x} y={s.y} a={a} text={text} sub={sub} color={color} dx={dx} dy={dy} size={size} />);
  };
  // how: the broadcast question, the router's answer, the laptop's note
  tag('ask', add(MINE, [0, 0.3, 0]), span(f, at('how1', 'asks'), at('how2'), 12), `who has ${d.gwIp}?`, 'asked to everyone on the LAN', COL.packet, 50, -110);
  tag('ans', add(ROUTER, [0.25, 0.04, 0.28]), span(f, at('how2', 'answers'), at('how2', 'writes') + 20, 12), `${d.gwIp} is at ${LABEL_ROUTER(d)}`, 'the real MikroTik', COL.gold, 60, -120);
  // the laptop's note of who the router is
  const believed = at('a1_2', 'believed');
  const noteA = Math.max(span(f, at('how2', 'writes'), at('how3') + 90, 12), span(f, at('a1_2') - 30, at('a1_3'), 12));
  const fake = f >= believed;
  tag('note', add(MINE, [0, 0.3, 0]), noteA, `router = ${fake ? LABEL_ATT(d) : LABEL_ROUTER(d)}`, fake ? 'the impostor' : 'the real MikroTik', fake ? COL.bad : COL.ok, -40, -120);
  // the impostor's identity
  tag('att', ATTC, span(f, at('a1_1', 'device') + 10, at('a1_2') + 30, 12), `${LABEL_ATT(d)} · ${d.attIp}`, 'claims to be the router', COL.bad, 70, -90);
  // victims (morning)
  ROOMS.morning.forEach((k, i) => tag('v1' + i, add(room(k[0], k[1]), [0, 0.8, 0]), span(f, at('a1_2', 'others') + i * 10, at('a1_3'), 12), d.victims1[i], 'lost the router too', COL.bad, i ? -40 : 40, -60, 20));
  // the trap: packets go in, nothing comes out (counts match the capture HUD)
  const trapCount = (from: number, total: number) => Math.round(total * interpolate(f, [from, from + 70], [0, 1], { ...clamp, easing: ease }));
  tag('trap1', add(ATTC, [0, -0.2, 0.1]), span(f, at('a1_3', 'zero') + 4, sceneFrom.sym - 8, 12), `in ${trapCount(at('a1_3'), 71)}  ·  out 0`, 'takes every packet, forwards none', COL.bad, 150, -70, 26);
  tag('trap2', add(ATTC, [0, -0.2, 0.1]), span(f, at('a2_count') + 4, at('a2_count', 'four') - 4, 12), `in ${trapCount(at('a2_count'), 42)}  ·  out 0`, 'takes every packet, forwards none', COL.bad, 150, -70, 26);
  tag('me2', add(MINE, [0, 0.25, 0]), span(f, at('a2_count', 'four'), at('a2_hunt', 'looking') - 6, 12), 'this laptop', 'cut off again', COL.packet, -40, 60, 20);
  // 15:28: the four other devices that lost the router ([3,1] is the morning victim the impostor goes looking for)
  ROOMS.afternoon.forEach((k, i) => tag('v2' + i, add(room(k[0], k[1]), [0.45, 0.7, -0.4]), span(f, at('a2_count', 'four') + i * 9, at('a2_hunt', 'looking') - 6, 12),
    d.victims2[i], k[0] === 3 && k[1] === 1 ? 'lost the router again' : 'lost the router', COL.bad, k[1] < 3 ? -40 : 40, -70, 20));
  // the hunt
  tag('hunt', add(HUNTED, [0, 0.7, 0]), span(f, at('a2_hunt', 'looking'), at('a2_verdict'), 12), `who has ${d.victims2[2]}?`, `asked by ${d.attIp}  ·  cut off at 05:34 too`, COL.bad, -60, -110, 26);
  // fix: candidates
  tag('cA', CAND[0], span(f, at('fix2') + 6, at('fix3'), 12), LABEL_ROUTER(d), f > at('fix2', 'real') + 40 ? 'answers as itself: real' : 'testing…', f > at('fix2', 'real') + 40 ? COL.ok : '#ffffff', -60, -130, 22);
  tag('cB', CAND[1], span(f, at('fix2') + 14, at('fix3'), 12), LABEL_ATT(d), f > at('fix2', 'impostor') + 40 ? 'nothing gets through: fake' : 'testing…', f > at('fix2', 'impostor') + 40 ? COL.bad : '#ffffff', 60, -130, 22);
  tag('pin', add(MINE, [0, 0.35, 0]), span(f, at('fix2', 'pinned') + 20, at('fix3'), 12), 'PINNED', `router = ${LABEL_ROUTER(d)}`, COL.gold, -60, -160);
  // fix3: the router's entry for this laptop
  const fixed = f > at('fix3', 'second') + 10;
  tag('rt', add(ROUTER, [0.25, 0.04, 0.28]), span(f, at('fix3', 'lie'), at('fix4'), 12), `${d.laptopIp} is at ${fixed ? 'the laptop' : LABEL_ATT(d)}`, fixed ? 'corrected by the announce, about once a second' : "the router's entry, poisoned", fixed ? COL.ok : COL.bad, 60, -130, 22);
  // fix4: the friend's result
  tag('fr', add(FRIEND, [0, 0.3, 0]), span(f, at('fix4', 'pinned'), sceneFrom.prev, 12), 'pinned 18:31', 'next 9 min: 0 failures', COL.ok, 40, -120);
  // prevention
  tag('iso', add(room(2, 2), [-1, 0.8, 0.6]), span(f, at('prev4', 'isolation'), sceneFrom.end, 12), 'client isolation', 'rooms can’t send to each other', '#9fd8ff', -40, -90, 22);
  tag('dai', add(SWITCH, [0.2, 0.03, 0.26]), span(f, at('prev4', 'inspection'), sceneFrom.end, 12), 'ARP inspection', 'DHCP snooping + DAI drop fake replies', COL.gold, 50, -110, 22);
  tag('find', add(ROUTER, [0.25, 0.04, 0.28]), span(f, at('prev4', 'find'), at('prev4', 'isolation'), 12), `find ${LABEL_ATT(d)}`, `/ip arp print where mac-address=…`, COL.bad, 60, -110, 22);
  return <Layer>{out}</Layer>;
};

/** All the big type, in 2D so it stays crisp: the cold-open clock, the title, the impostor's speech bubble, the packet
 *  counters, the jump to 15:28 and the verdict. */
const Titles: React.FC<{ f: number; cam: Cam }> = ({ f, cam }) => {
  const out: React.ReactNode[] = [];
  const chars = (from: number, n: number, step = 1.6, d = 18) =>
    Array.from({ length: n }, (_, i) => { const p = prog(f, from + i * step, d); return { opacity: p, y: (1 - p) * 18 }; });
  // a clock with a date line above it
  const clock = (key: string, a: number, time: string, line: string, sub?: string) => {
    if (a <= 0.01) return;
    out.push(
      <Layer key={key} opacity={a}>
        <Rect width={W} height={H} fill={{ type: 'radial', cx: W / 2, cy: 300, r: 700, stops: [{ offset: 0, color: 'rgba(0,0,0,0.5)' }, { offset: 1, color: 'rgba(0,0,0,0)' }] }} />
        <Text x={0} y={200} maxWidth={W} align="center" font={MONO} weight={500} size={26} color="#9aa3b5">{line}</Text>
        <Text x={0} y={244} maxWidth={W} align="center" font={MONO} weight={700} size={140} color="#f2f5fb">{time}</Text>
        {sub && <Text x={0} y={420} maxWidth={W} align="center" font={MONO} weight={500} size={30} color={COL.bad}>{sub}</Text>}
      </Layer>,
    );
  };
  // cold open: 05:33:59 ticking to 05:34:03
  const c0 = 40;
  const secs = Math.min(3, Math.max(-1, Math.floor((f - c0) / 50) - 1));
  clock('cold', span(f, c0, sceneFrom.title - 16, 30), `05:${secs < 0 ? '33:59' : '34:0' + secs}`, 'WED 28 OCT 2026  ·  HOSTEL LAN');
  // the title
  const ta = span(f, sceneFrom.title, sceneFrom.how + 4, 20);
  if (ta > 0.01) {
    const t0 = sceneFrom.title;
    const rule = prog(f, t0 + 30, 36);
    out.push(
      <Layer key="title" opacity={ta}>
        <Rect width={W} height={H} fill={{ type: 'radial', cx: W / 2, cy: H / 2, r: 900, stops: [{ offset: 0, color: 'rgba(2,4,10,0.72)' }, { offset: 1, color: 'rgba(2,4,10,0.15)' }] }} />
        <Text x={0} y={H / 2 - 120} maxWidth={W} align="center" font={SANS} weight={800} size={132} color="#ffffff" chars={chars(t0, 17, 1.5)}>WHO'S THE ROUTER?</Text>
        <Rect x={W / 2 - 260 * rule} y={H / 2 + 52} width={520 * rule} height={3} fill={COL.bad} />
        <Text x={0} y={H / 2 + 80} maxWidth={W} align="center" font={MONO} weight={500} size={32} color="#aab3c5" opacity={prog(f, t0 + 50, 24)}>the netbug incident files</Text>
      </Layer>,
    );
  }
  // the netbug badge, pinned above my desk
  const logo = slam(f, at('fix0', 'teeth')) * fadeOut(f, at('fix1', 'logs'), 30);
  if (logo > 0.01) {
    const s = project(cam, add(MINE, [-0.05, 0.62, 0.3]));
    if (s.ok) {
      out.push(
        <Layer key="logo" x={s.x} y={s.y} scale={logo} opacity={Math.min(1, logo * 1.5)}>
          <Ellipse x={-110} y={-110} width={220} height={220} fill={{ type: 'radial', cx: 0, cy: 0, r: 110, stops: [{ offset: 0, color: 'rgba(48,209,88,0.35)' }, { offset: 1, color: 'rgba(48,209,88,0)' }] }} />
          <Ellipse x={-64} y={-64} width={128} height={128} fill="rgba(8,12,16,0.9)" stroke={{ color: COL.ok, width: 3 }} />
          <Path x={-38} y={-40} scale={0.76} d={BUG} fill={COL.ok} />
          <Rect x={-78} y={76} width={156} height={44} radius={22} fill="rgba(8,12,16,0.9)" />
          <Text x={-78} y={82} maxWidth={156} align="center" font={SANS} weight={800} size={28} color={COL.ok}>netbug</Text>
        </Layer>,
      );
    }
  }
  // the impostor's speech bubble, pinned above it
  const bubble = Math.max(span(f, at('a1_1', 'I'), at('a1_2') + 20, 10), span(f, at('a2_lie'), at('a2_count'), 6));
  if (bubble > 0.01) {
    const s = project(cam, add(ATTC, [0, 0.42, 0]));
    if (s.ok) {
      const text = 'I am the router.';
      const size = 40, w = text.length * size * 0.56 + 56, h = size + 34;
      const x = Math.max(40, Math.min(W - 40 - w, s.x - w / 2)), y = Math.max(40, s.y - h - 34);
      const p = pop(f, f < at('a2_lie') ? at('a1_1', 'I') : at('a2_lie'));
      out.push(
        <Layer key="bubble" opacity={bubble} y={(1 - p) * 20}>
          <Rect x={x} y={y} width={w} height={h} radius={h / 2} fill={COL.bad} />
          <Path d={`M ${Math.max(x + h / 2, Math.min(x + w - h / 2, s.x)) - 14} ${y + h - 1} L ${s.x} ${y + h + 22} L ${Math.max(x + h / 2, Math.min(x + w - h / 2, s.x)) + 14} ${y + h - 1} Z`} fill={COL.bad} />
          <Text x={x} y={y + 15} maxWidth={w} align="center" font={SANS} weight={800} size={size} color="#ffffff">{text}</Text>
        </Layer>,
      );
    }
  }
  // packet counters: a capture HUD at the left
  const hud = (key: string, a: number, from: number, outN: number, zeroAt: number, extra?: { text: string; at: number }) => {
    if (a <= 0.01) return;
    const n = Math.round(outN * interpolate(f, [from, from + 70], [0, 1], { ...clamp, easing: ease }));
    const zero = prog(f, zeroAt, 12);
    out.push(
      <Layer key={key} x={110} y={330} opacity={a}>
        <Rect width={430} height={extra ? 300 : 250} radius={22} fill="rgba(8,10,16,0.82)" stroke={{ color: 'rgba(255,255,255,0.14)', width: 1.5 }} />
        <Text x={34} y={26} font={MONO} weight={500} size={22} color="#8b93a7">CAPTURE · this laptop</Text>
        <Text x={34} y={70} font={SANS} weight={600} size={30} color="#c9d1e0">out</Text>
        <Text x={34} y={58} maxWidth={360} align="right" font={MONO} weight={700} size={64} color={COL.packet}>{String(n)}</Text>
        <Text x={34} y={150} font={SANS} weight={600} size={30} color="#c9d1e0" opacity={zero}>back</Text>
        <Text x={34} y={138} maxWidth={360} align="right" font={MONO} weight={700} size={64} color={COL.bad} opacity={zero}>0</Text>
        {extra && <Text x={34} y={236} font={SANS} weight={600} size={26} color={COL.bad} opacity={prog(f, extra.at, 14)}>{extra.text}</Text>}
      </Layer>,
    );
  };
  hud('c1', span(f, at('a1_3') - 6, sceneFrom.sym - 6, 12), at('a1_3'), 71, at('a1_3', 'zero'));
  hud('c2', span(f, at('a2_count') - 6, at('a2_count', 'four') - 4, 12), at('a2_count'), 42, at('a2_count', 'zero'));
  // jump from 05:36 to 15:28
  const j0 = sceneFrom.a2 + CARD - 30;
  const minutes = interpolate(f, [j0, at('a2_1', 'afternoon')], [5 * 60 + 36, 15 * 60 + 28], { ...clamp, easing: ease });
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0'), mm = String(Math.floor(minutes % 60)).padStart(2, '0');
  clock('jump', span(f, j0, at('a2_dev') - 4, 10), `${hh}:${mm}`, 'SAME DAY', f > at('a2_1', 'again') ? 'again' : undefined);
  // the verdict
  const v0 = at('a2_verdict', 'purpose');
  const va = slam(f, v0) * fadeOut(f, sceneFrom.friend - 24, 24);
  if (va > 0.01) out.push(
    <Layer key="purpose" opacity={Math.min(1, va * 1.4)}>
      <Rect width={W} height={H} fill="rgba(0,0,0,0.35)" />
      <Text x={0} y={H / 2 - 90 + (1 - va) * 30} maxWidth={W} align="center" font={SANS} weight={800} size={150} color={COL.bad}>ON PURPOSE.</Text>
    </Layer>,
  );
  return <Layer>{out}</Layer>;
};

/** Floating glass panels for the symptoms (sym1, sym2), and the netbug log (a1_rec). */
const Panels: React.FC<{ f: number; d: Data }> = ({ f, d }) => {
  const cards: { id: string; from: number; to: number; x: number; y: number; title: string; body: string; color: string }[] = [
    { id: 'discord', from: at('sym1', 'discord'), to: endOf('sym2') + 20, x: 150, y: 170, title: 'Discord voice', body: '5000 ms', color: COL.bad },
    { id: 'hear', from: at('sym1', 'hear'), to: endOf('sym2') + 20, x: 1290, y: 190, title: 'Voice chat', body: 'in: fine   out: dead', color: '#ff9f0a' },
    { id: 'pages', from: at('sym1', 'forever'), to: endOf('sym2') + 20, x: 170, y: 560, title: 'reddit.com', body: 'Loading…', color: '#9ecbff' },
    { id: 'err', from: at('sym2', 'error'), to: endOf('sym2') + 20, x: 1300, y: 560, title: 'Error page', body: 'none. nothing replies.', color: '#c9d1e0' },
  ];
  const log = [
    `05:34:03  gateway ${d.gwIp}  ${d.gwMac} → ${d.attMac}`,
    '05:34:04  pings fail: gateway, 1.1.1.1, 8.8.8.8',
    '05:34:06  DNS fails',
    '05:34:54  capture: 71 packets out, 0 back',
    '05:36:35  Ethernet unplugged → Wi-Fi',
    '05:36:37  OUTAGE END after 150 s',
  ];
  const logA = span(f, at('a1_rec', 'recorded') - 20, sceneFrom.a2 - 10, 16);
  return (
    <Layer>
      {cards.map((c) => {
        const a = span(f, c.from, c.to, 14);
        if (a <= 0.01) return null;
        const p = pop(f, c.from);
        const spin = c.id === 'pages';
        return (
          <Layer key={c.id} x={c.x} y={c.y + (1 - p) * 30} opacity={a}>
            <Rect width={460} height={170} radius={22} fill="rgba(14,18,28,0.72)" stroke={{ color: 'rgba(255,255,255,0.18)', width: 1.5 }} />
            <Text x={30} y={26} font={SANS} weight={600} size={26} color="#c9d1e0">{c.title}</Text>
            <Text x={30} y={70} font={c.id === 'discord' ? MONO : SANS} weight={800} size={c.id === 'discord' ? 62 : 40} color={c.color}>{c.body}</Text>
            {spin && Array.from({ length: 8 }, (_, i) => {
              const ang = (i / 8) * Math.PI * 2 + f * 0.12;
              return <Rect key={i} x={380 + Math.cos(ang) * 30 - 5} y={95 + Math.sin(ang) * 30 - 5} width={10} height={10} radius={5} fill="#9ecbff" opacity={0.15 + 0.85 * (i / 8)} />;
            })}
          </Layer>
        );
      })}
      {logA > 0.01 && (
        <Layer x={110} y={150} opacity={logA}>
          <Rect width={1000} height={70 + log.length * 46} radius={20} fill="rgba(6,8,12,0.82)" stroke={{ color: 'rgba(48,209,88,0.5)', width: 1.5 }} />
          <Text x={30} y={22} font={MONO} weight={700} size={24} color={COL.ok}>netbug · events.log</Text>
          {log.map((l, i) => (
            <Text key={i} x={30} y={70 + i * 46} font={MONO} weight={500} size={23} color={i === 0 ? COL.bad : '#d6dbe6'} opacity={prog(f, at('a1_rec', 'recorded') - 20 + i * 8, 10)}>{l}</Text>
          ))}
        </Layer>
      )}
    </Layer>
  );
};

/** The friend's four days as a strip: six cut-off joins and the longest outage. */
const FriendStrip: React.FC<{ f: number }> = ({ f }) => {
  const a = span(f, at('f1', 'friend'), sceneFrom.fix, 16);
  if (a <= 0.01) return null;
  // panel and track geometry: five days, 10-28 00:00 to 11-02 00:00
  const px = 190, py = 96, pw = W - 380, ph = 220;
  const x0 = px + 60, x1 = px + pw - 60, ty = py + 128;
  const day = (x1 - x0) / 5;
  const hrs = (s: string) => { const [d, t] = s.split(' '); const k = ['10-28', '10-29', '10-30', '10-31', '11-01'].indexOf(d); const [h, m] = t.split(':').map(Number); return k * 24 + h + m / 60; };
  const X = (h: number) => x0 + (h / 24) * day;
  const n = FRIEND_JOINS.filter((_, i) => f >= at('f2', 'outages') + i * 14).length;
  const lp = prog(f, at('f2', 'longest'), 24);
  const ls = X(hrs('11-01 17:45')), le = X(hrs('11-01 18:22'));
  return (
    <Layer opacity={a}>
      <Rect x={px} y={py} width={pw} height={ph} radius={22} fill="rgba(8,10,16,0.88)" stroke={{ color: 'rgba(255,255,255,0.14)', width: 1.5 }} />
      <Text x={x0} y={py + 26} font={SANS} weight={700} size={28} color="#e8eefc">Friend's laptop: every wired connection cut off</Text>
      <Text x={x1 - 300} y={py + 24} maxWidth={300} align="right" font={MONO} weight={700} size={30} color={COL.bad} opacity={n ? 1 : 0}>{`${n} outage${n === 1 ? '' : 's'}`}</Text>
      {/* track, midnight ticks, day labels centred in each day */}
      <Rect x={x0} y={ty - 1.5} width={x1 - x0} height={3} fill="rgba(255,255,255,0.3)" />
      {Array.from({ length: 6 }, (_, i) => <Rect key={'tk' + i} x={x0 + i * day - 1} y={ty - 10} width={2} height={20} fill="rgba(255,255,255,0.3)" />)}
      {['10-28', '10-29', '10-30', '10-31', '11-01'].map((dd, i) => (
        <Text key={dd} x={x0 + i * day} y={ty + 22} maxWidth={day} align="center" font={MONO} weight={500} size={22} color="#9aa3b5">{dd}</Text>
      ))}
      {/* one red mark per cut-off join, centred on the track */}
      {FRIEND_JOINS.map((j, i) => {
        const p = pop(f, at('f2', 'outages') + i * 14);
        return p > 0.01 ? <Rect key={j} x={X(hrs(j)) - 6} y={ty - 18 * p} width={12} height={36 * p} radius={6} fill={COL.bad} /> : null;
      })}
      {/* the longest outage, bracketed and labelled above its mark */}
      {lp > 0.01 && (
        <Layer opacity={lp}>
          <Rect x={ls - 8} y={ty - 30} width={Math.max(16, le - ls + 16)} height={60} radius={10} stroke={{ color: COL.bad, width: 2 }} />
          <Text x={x1 - 420} y={ty - 72} maxWidth={le + 8 - (x1 - 420)} align="right" font={MONO} weight={700} size={26} color={COL.bad}>longest: 37 min</Text>
        </Layer>
      )}
    </Layer>
  );
};

/** Self-help checklist (prev1) and the netbug prompt (prev2). */
const Advice: React.FC<{ f: number }> = ({ f }) => {
  const a = span(f, at('prev1'), at('prev3'), 16);
  const b = span(f, at('prev2'), at('prev3') + 20, 16);
  const rows = [
    { t: 'Internet frozen, no error page', at: at('prev1', 'freezes') },
    { t: 'Everyone around you drops too', at: at('prev1', 'everyone') },
    { t: 'Switch to a hotspot', at: at('prev1', 'switch'), hi: true },
  ];
  return (
    <Layer>
      {a > 0.01 && (
        <Layer x={110} y={150} opacity={a}>
          <Rect width={720} height={250} radius={22} fill="rgba(10,12,18,0.72)" stroke={{ color: 'rgba(255,255,255,0.15)', width: 1.5 }} />
          <Text x={34} y={28} font={SANS} weight={800} size={30} color="#ffffff">Spot it</Text>
          {rows.map((r, i) => (
            <Text key={i} x={34} y={84 + i * 52} font={SANS} weight={r.hi ? 800 : 600} size={30} color={r.hi ? COL.ok : '#d6dbe6'} opacity={prog(f, r.at, 12)}>{(r.hi ? '→  ' : '•  ') + r.t}</Text>
          ))}
        </Layer>
      )}
      {b > 0.01 && (
        <Layer x={W - 830} y={150} opacity={b}>
          <Rect width={720} height={180} radius={22} fill="rgba(10,12,18,0.72)" stroke={{ color: 'rgba(48,209,88,0.5)', width: 1.5 }} />
          <Text x={34} y={28} font={SANS} weight={800} size={30} color={COL.ok}>Run netbug</Text>
          <Text x={34} y={84} font={SANS} weight={600} size={28} color="#d6dbe6">Router protection → Test and pin</Text>
          <Text x={34} y={126} font={MONO} weight={500} size={22} color="#9aa3b5">github.com/tariqaq/netbug/releases</Text>
        </Layer>
      )}
    </Layer>
  );
};

/** Chapter cards: the frame behind blurs and darkens, then a numeral and a subtitle. */
const Card: React.FC<{ f: number }> = ({ f }) => {
  for (const s of SCENES) {
    if (!s.card) continue;
    const from = sceneFrom[s.id];
    const d = f - from;
    if (d < 0 || d >= CARD) continue;
    const a = Math.min(prog(f, from, 14), fadeOut(f, from + CARD - 18, 18));
    const chars = Array.from(s.card[1]).map((_, i) => { const p = prog(f, from + 12 + i * 1.2, 16); return { opacity: p, y: (1 - p) * 16 }; });
    const rule = prog(f, from + 8, 30);
    return (
      <Layer opacity={a}>
        <Rect width={W} height={H} fill="rgba(0,0,0,0.55)" />
        <Text x={0} y={H / 2 - 120} maxWidth={W} align="center" font={SANS} weight={800} size={96} color="#ffffff">{s.card[0]}</Text>
        <Rect x={W / 2 - 170 * rule} y={H / 2 - 4} width={340 * rule} height={3} fill={s.id === 'fix' ? COL.ok : COL.bad} />
        <Text x={0} y={H / 2 + 26} maxWidth={W} align="center" font={MONO} weight={500} size={34} color="#d6dbe6" chars={chars}>{s.card[1]}</Text>
      </Layer>
    );
  }
  return null;
};

const cardBlur = (f: number) => {
  for (const s of SCENES) if (s.card) {
    const from = sceneFrom[s.id];
    if (f >= from && f < from + CARD) return Math.min(prog(f, from, 14), fadeOut(f, from + CARD - 18, 18));
  }
  return 0;
};

/** End card: the tagline, the repo and a QR code to the latest release (flat, so it scans), over a dimmed shot. */
const EndCard: React.FC<{ f: number }> = ({ f }) => {
  const a0 = at('end');
  const dim = prog(f, a0 - 20, 40);
  if (dim <= 0.01) return null;
  const tag = prog(f, a0, 30);
  const info = prog(f, a0 + 70, 30);
  const m = qr.matrix as number[][];
  const n = m.length, cell = 9, size = n * cell, pad = cell * 4;   // 4-module quiet zone
  const qx = W - 260 - size, qy = H / 2 - size / 2 - 60;
  const mods: React.ReactNode[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!m[y][x]) continue;
    const k = prog(f, a0 + 90 + ((x * 7 + y * 13) % 23), 10);
    if (k > 0.01) mods.push(<Rect key={`${x},${y}`} x={qx + x * cell} y={qy + y * cell} width={cell} height={cell} fill="#0b0d12" opacity={k} />);
  }
  return (
    <Layer>
      <Rect width={W} height={H} fill={{ type: 'linear', x0: 0, y0: 0, x1: W, y1: 0, stops: [{ offset: 0, color: 'rgba(5,6,10,0.78)' }, { offset: 0.65, color: 'rgba(5,6,10,0.55)' }, { offset: 1, color: 'rgba(5,6,10,0.35)' }] }} opacity={dim} />
      <Text x={180} y={H / 2 - 150 + (1 - tag) * 20} font={SANS} weight={800} size={84} color="#ffffff" opacity={tag}>Know who your router is.</Text>
      <Layer opacity={info} y={(1 - info) * 16}>
        <Text x={184} y={H / 2 - 20} font={SANS} weight={800} size={44} color={COL.ok}>netbug</Text>
        <Text x={184} y={H / 2 + 44} font={MONO} weight={500} size={32} color="#e8eefc">github.com/tariqaq/netbug</Text>
        <Text x={184} y={H / 2 + 96} font={SANS} weight={600} size={26} color="#aab3c5">Free and open source, for Windows. Download it from Releases.</Text>
      </Layer>
      <Rect x={qx - pad} y={qy - pad} width={size + pad * 2} height={size + pad * 2} radius={18} fill="#ffffff" opacity={prog(f, a0 + 80, 20)} />
      {mods}
      <Text x={qx - pad} y={qy + size + pad + 18} maxWidth={size + pad * 2} align="center" font={SANS} weight={600} size={22} color="#d6dbe6" opacity={prog(f, a0 + 120, 20)}>scan: latest release</Text>
    </Layer>
  );
};

// ---------------------------------------------------------------- captions

const PAGES: CapPage[] = (() => {
  const pages: CapPage[] = [];
  for (const l of placed) {
    const words = l.words.map((w) => ({ text: w.text, at: l.from + sec(w.start) }));
    let i = 0;
    while (i < words.length) {
      let j = Math.min(words.length, i + 11);
      // break after punctuation if one is near
      for (let k = j - 1; k > i + 5; k--) if (/[.,:;?!]$/.test(words[k].text)) { j = k + 1; break; }
      if (words.length - j <= 2) j = words.length;
      const chunk = words.slice(i, j);
      const to = j < words.length ? words[j].at : l.from + l.frames + 10;
      pages.push({ from: chunk[0].at - 4, to, words: chunk });
      i = j;
    }
  }
  return pages;
})();

// ---------------------------------------------------------------- hits, sound and score

type Hit = { f: number; shake: number; fringe: number };
const HITS: Hit[] = [];
const hit = (f: number, shake: number, fringe: number, sfx: Sfx[] = [], gain = 1) => { HITS.push({ f, shake, fringe }); sfx.forEach((s) => cue(f, s, { gain })); };
const fx = (f: number, kind: Sfx, gain = 1, len?: number) => cue(f, kind, { gain, ...(len ? { len } : {}) });
{
  // cold open: wind, a clock, the title hit
  fx(0, 'wind', 0.9, (sceneFrom.how + 60) / FPS);
  for (let s = 60; s < sceneFrom.title; s += 60) fx(s, s % 120 ? 'tock' : 'tick', 0.6);
  fx(sceneFrom.title - 6 - 90, 'riser', 0.8, 90 / FPS);
  hit(sceneFrom.title - 6, 0.05, 3, ['bigImpact']);
  // how: the broadcast, the answer, the stream starting
  fx(sceneFrom.how - 20, 'whoosh', 0.7);
  fx(at('how1', 'asks'), 'ping', 1); fx(at('how1', 'asks') + 22, 'ping', 0.6); fx(at('how1', 'asks') + 44, 'ping', 0.35);
  fx(at('how2', 'answers'), 'chime', 0.9); fx(at('how2', 'writes'), 'pop', 1);
  fx(at('how3', 'believed') + 8, 'thud', 0.8);
  // chapter cards
  for (const s of SCENES) if (s.card) { fx(sceneFrom[s.id] - 60, 'riser', 0.6, 1); fx(sceneFrom[s.id], s.id === 'fix' ? 'chime' : 'impact', 0.8); fx(sceneFrom[s.id] + CARD - 20, 'whoosh', 0.6); }
  // attack 1
  hit(at('a1_1', 'replying'), 0.03, 2, ['glitch']);
  fx(at('a1_1', 'I'), 'braam', 0.9, 2.6);
  fx(at('a1_2', 'believed'), 'flip', 1);
  fx(at('a1_2', 'two'), 'thud', 0.7); fx(at('a1_2', 'two') + 10, 'thud', 0.6);
  for (let i = 0; i < 6; i++) fx(at('a1_3') + i * 9, 'tick', 0.5);
  hit(at('a1_3', 'zero'), 0.06, 4, ['bigImpact']);
  fx(at('a1_3', 'zero') + 2, 'swallow', 0.8);
  // symptoms
  fx(at('sym1', 'discord'), 'glass', 0.9); fx(at('sym1', 'hear'), 'glass', 0.8); fx(at('sym1', 'forever'), 'glass', 0.7); fx(at('sym2', 'error'), 'glass', 0.6);
  // unplug
  fx(at('a1_end', 'cable'), 'unplug', 1);
  fx(at('a1_end', 'hotspot'), 'chime', 0.8);
  for (let i = 0; i < 6; i++) fx(at('a1_rec', 'recorded') - 20 + i * 8, 'type', 0.7);
  // attack 2
  fx(sceneFrom.a2 + CARD - 30, 'clockspin', 0.8, (at('a2_1', 'afternoon') - sceneFrom.a2 - CARD + 30) / FPS);
  hit(at('a2_dev'), 0.06, 4, ['stamp', 'impact']);
  hit(at('a2_addr'), 0.06, 4, ['stamp', 'impact']);
  hit(at('a2_lie'), 0.09, 6, ['stamp', 'bigImpact']);
  fx(at('a2_lie') + 4, 'braam', 0.8, 2.4);
  for (let i = 0; i < 4; i++) fx(at('a2_count', 'four') + i * 9, 'thud', 0.6);
  fx(at('a2_hunt', 'looking') - 10, 'sweep', 0.9);
  hit(at('a2_verdict', 'purpose'), 0.05, 4, ['bigImpact']);
  // friend
  for (let i = 0; i < 6; i++) fx(at('f2', 'outages') + i * 16, 'thud', 0.55);
  fx(at('f2', 'longest'), 'flatline', 0.7, 1.6);
  // fix
  hit(at('fix0', 'teeth'), 0.03, 0, ['lock']);
  fx(at('fix1') + 10, 'radar', 0.8, (at('fix2', 'impostor') - at('fix1')) / FPS);
  fx(at('fix2', 'real') + 40, 'chime', 0.8);
  fx(at('fix2', 'impostor') + 40, 'buzz', 0.8);
  hit(at('fix2', 'pinned'), 0.04, 0, ['pin']);
  for (let i = 0; i < 4; i++) fx(at('fix2', 'bounce') - 30 + i * 26 + 30, 'tink', 1);
  for (let s = at('fix3', 'reminds'); s < at('fix4'); s += FPS) fx(s, 'heartbeat', 0.45);
  fx(at('fix3', 'second') + 10, 'chime', 0.7);
  fx(at('fix4', 'zero'), 'chime', 1);
  // prevention
  fx(at('prev4', 'isolation'), 'rise', 0.9, 1.2);
  fx(at('prev4', 'inspection'), 'lock', 0.8);
  fx(at('end'), 'bigChord', 0.6);
  for (let i = 0; i < 14; i++) fx(at('end') + 40 + i * 6, 'tink', 0.25);

  // score sections, keyed to scenes
  const sections: [number, number, Mood][] = [
    [0, sceneFrom.title - 6, 'night'],
    [sceneFrom.title - 6, sceneFrom.a1, 'calm'],
    [sceneFrom.a1, sceneFrom.sym, 'tension'],
    [sceneFrom.sym, sceneFrom.unplug, 'wait'],
    [sceneFrom.unplug, sceneFrom.a2, 'relief'],
    [sceneFrom.a2, sceneFrom.friend, 'tension2'],
    [sceneFrom.friend, sceneFrom.fix, 'lonely'],
    [sceneFrom.fix, sceneFrom.prev, 'build'],
    [sceneFrom.prev, sceneFrom.end, 'resolve'],
    [sceneFrom.end, TOTAL, 'end'],
  ];
  for (const [a, b, m] of sections) scoreSection(a, b, m);
  setDuck(placed.map((l) => [l.from / FPS, (l.from + l.frames) / FPS]));
}

const shakeAt = (f: number) => {
  let x = 0, y = 0, fringe = 0;
  for (const h of HITS) {
    const d = f - h.f;
    if (d < 0 || d > 40) continue;
    const k = Math.exp(-d / 9);
    x += h.shake * k * Math.sin(d * 1.6 + h.f);
    y += h.shake * k * Math.cos(d * 2.1 + h.f * 0.5) * 0.7;
    fringe += h.fringe * Math.exp(-d / 6);
  }
  return { x, y, fringe };
};

// ---------------------------------------------------------------- film

const Film: React.FC<Data> = (d) => {
  const f = useCurrentFrame();
  const base = handheld(camAt(f), f / FPS, 0.025);
  const sh = shakeAt(f);
  const cam: Cam = { ...base, pos: add(base.pos, [sh.x, sh.y, 0]), target: add(base.target, [sh.x * 0.5, sh.y * 0.5, 0]) };
  const w = worldAt(f);
  const blurAmt = cardBlur(f);
  const redSky = Math.max(span(f, at('a1_1', 'replying'), sceneFrom.unplug, 40), span(f, at('a2_dev'), sceneFrom.friend, 40)) * 0.6;
  const bars = Math.max(span(f, 0, sceneFrom.how + 20, 40), span(f, at('a2_dev') - 2, at('a2_count') + 20, 6), span(f, at('a2_verdict'), sceneFrom.friend, 30), span(f, sceneFrom.end, TOTAL + 100, 50));
  const fadeIn = interpolate(f, [0, 50], [1, 0], clamp);
  const fadeEnd = interpolate(f, [TOTAL - 50, TOTAL - 1], [0, 1], clamp);
  return (
    <Layer>
      <Sky dawn={w.dawn} stars={1 - w.dawn} red={redSky} t={f / FPS} />
      <Layer effects={[...(blurAmt > 0.01 ? [blur(14 * blurAmt)] : []), ...(sh.fringe > 0.05 ? [chromaticAberration(sh.fringe)] : []), ...(MB > 1 ? [motionBlur({ samples: MB, shutter: 0.5 })] : [])]}>
        <World f={f} cam={cam} d={d} />
      </Layer>
      <Haze dawn={w.dawn} amt={0.5} />
      <Vignette strength={0.62 - 0.2 * w.dawn} />
      <Labels f={f} cam={cam} d={d} />
      <Titles f={f} cam={cam} />
      <Panels f={f} d={d} />
      <FriendStrip f={f} />
      <Advice f={f} />
      <EndCard f={f} />
      <Card f={f} />
      <Letterbox amt={bars} />
      <Rect y={H - 260} width={W} height={260} fill={{ type: 'linear', x0: 0, y0: H - 260, x1: 0, y1: H, stops: [{ offset: 0, color: 'rgba(0,0,0,0)' }, { offset: 1, color: 'rgba(0,0,0,0.55)' }] }} />
      <Captions f={f} pages={PAGES} />
      <Rect width={W} height={H} fill="#000" opacity={Math.max(fadeIn, fadeEnd)} />
      {placed.map((l) => (
        <Sequence key={l.id} from={l.from}>
          <Audio src={staticFile(`vo5/${l.id}.wav`)} muted={soloMutes('voice')} />
        </Sequence>
      ))}
    </Layer>
  );
};

registerRoot(() => (
  <Composition id="IncidentV5" component={Film} durationInFrames={TOTAL} fps={FPS} width={W} height={H} defaultProps={example} />
));
