// The v5 diorama: a cut-away hostel block (4 floors x 6 rooms, front wall open) standing at the front edge of a slab of
// city cut like a cake, so the basement shows in cross-section. The block sits on a dark table; the street, trees,
// lamps, a utility pole and the skyline stand on the slab.
//
// One cable system, drawn and travelled by packets the same way:
//   laptop -> wall jack -> drop up the back wall -> ceiling run along the back of the floor (through sleeves in the
//   side walls) -> riser in the back-right corner (through sleeves in the slabs) -> basement ceiling -> switch (rack)
//   -> router -> ONT on the basement wall -> out through the left end wall, up a conduit on the outside of the
//   building -> aerial drop to the utility pole -> a long span to the ISP mast on the skyline.
// Everything is procedural (primitives only); nothing is downloaded.
//
// Units are metres-ish: +x right, +y up, +z toward the viewer. `project()` maps a 3D point to screen pixels through the
// same camera, so crisp 2D labels can be pinned to 3D things.

import React from 'react';
import { Mesh, Group3D } from 'remotion';

export type V3 = [number, number, number];
export type Cam = { pos: V3; target: V3; fov: number };

export const W = 1920;
export const H = 1080;

// ---------------------------------------------------------------- vector maths

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const mix3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Screen position (pixels) of world point `p` seen by `cam`; `z` is the distance along the view, `ok` is in front. */
export const project = (cam: Cam, p: V3) => {
  const f = norm(sub(cam.target, cam.pos));
  const r = norm(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub(p, cam.pos);
  const z = dot(d, f);
  const t = Math.tan((cam.fov * Math.PI) / 360);
  const x = dot(d, r) / (z * t * (W / H));
  const y = dot(d, u) / (z * t);
  return { x: ((x + 1) / 2) * W, y: ((1 - y) / 2) * H, z, ok: z > 0.1 };
};

/** Smooth value noise in [-1, 1] (for handheld drift). */
export const wobble = (t: number, seed: number) =>
  0.6 * Math.sin(t * 0.71 + seed * 1.3) + 0.3 * Math.sin(t * 1.37 + seed * 2.1) + 0.1 * Math.sin(t * 2.93 + seed * 0.7);

/** A camera with a little handheld drift added (amount in world units). */
export const handheld = (cam: Cam, t: number, amt = 0.03): Cam => ({
  ...cam,
  pos: add(cam.pos, [wobble(t, 1) * amt, wobble(t, 2) * amt * 0.7, wobble(t, 3) * amt * 0.5]),
  target: add(cam.target, [wobble(t, 4) * amt * 0.5, wobble(t, 5) * amt * 0.4, 0]),
});

/** Deterministic 0..1 hash of two integers. */
const hash = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

// ---------------------------------------------------------------- layout

export const FLOORS = 4;
export const COLS = 6;
export const RW = 2.0;   // room width (x)
export const RH = 1.5;   // room height (y)
export const RD = 2.0;   // room depth (z)
export const BW = COLS * RW;
export const X0 = -BW / 2;
export const BASE = -1.4; // basement floor
const CUT = RD / 2 + 0.06; // the slab's front cut face
const TABLE = BASE - 0.9;  // the table the slab stands on

/** Floor centre of room (floor, col). */
export const room = (fl: number, col: number): V3 => [X0 + RW * (col + 0.5), fl * RH, 0];

/** Why a camera can't see its target, or null when it can. Only targets inside a room are checked: the camera must be in
 *  that room, or look in through that room's open front, clear of the pillars and slab lips (the walls between rooms
 *  hide everything else). Wide shots (camera more than 6 m from its target) look at the whole block and are skipped. */
export const sightBlocked = (cam: Cam): string | null => {
  const [tx, ty, tz] = cam.target;
  if (dist(cam.pos, cam.target) > 6 || ty < 0 || ty >= FLOORS * RH || Math.abs(tz) >= RD / 2 || tx <= X0 || tx >= X0 + BW) return null;
  const col = Math.floor((tx - X0) / RW), fl = Math.floor(ty / RH);
  const inCell = (x: number, y: number, m: number, mt: number) =>
    x > X0 + col * RW + m && x < X0 + (col + 1) * RW - m && y > fl * RH + mt && y < fl * RH + RH - mt;
  const [px, py, pz] = cam.pos;
  if (pz <= RD / 2) return inCell(px, py, 0.04, 0.04) ? null : `camera outside room ${fl},${col}`;
  const s = (pz - RD / 2) / (pz - tz);
  const x = px + s * (tx - px), y = py + s * (ty - py);
  return inCell(x, y, 0.1, 0.06) ? null : `enters front at x ${(x - X0 - col * RW).toFixed(2)} y ${(y - fl * RH).toFixed(2)} (room ${fl},${col})`;
};

/** Which rooms matter (floor, col). */
export const ROOMS = {
  mine: [1, 1] as const,
  attacker: [2, 4] as const,
  friend: [1, 4] as const,
  morning: [[3, 1], [0, 3]] as const,                 // the two other devices at 05:34, in data `victims1` order ([3,1] = 10.255.23.47)
  afternoon: [[0, 0], [2, 1], [3, 1], [3, 5]] as const, // the four at 15:28, in data `victims2` order ([3,1] again)
};
const isRoom = (fl: number, col: number, k: readonly [number, number]) => fl === k[0] && col === k[1];
const VICTIMS: (readonly [number, number])[] = [...ROOMS.morning, ...ROOMS.afternoon].filter((k, i, a) => a.findIndex((x) => x[0] === k[0] && x[1] === k[1]) === i);

/** Desk top centre in room (floor, col): against the back wall, right of the bed. */
export const desk = (fl: number, col: number): V3 => add(room(fl, col), [0.45, 0.42, -0.5]);
export const laptopAt = (fl: number, col: number): V3 => add(desk(fl, col), [0, 0.02, 0.05]);

// the cable system
export const RUN_Z = -0.86;                                     // ceiling runs, risers and wall drops sit at this depth
export const CEIL = (fl: number) => fl * RH + RH - 0.14;        // ceiling run height on floor fl
export const RISER_X = X0 + BW - 0.16;                          // riser in the back-right corner of the column-5 rooms
const BCEIL = -0.2;                                             // basement ceiling run
export const RACK: V3 = [-0.6, BASE, -0.5];
export const ROUTER: V3 = add(RACK, [0, 0.5, 0]);
export const SWITCH: V3 = add(RACK, [0, 0.92, 0]);
export const ONT: V3 = [X0 + 1.5, BASE + 0.95, -RD / 2 + 0.08];
export const POLE: V3 = [X0 - 2.6, 0, RUN_Z];
export const POLE_TOP: V3 = add(POLE, [0, 4.6, 0]);
export const MAST_TOP: V3 = [-30, 15.5, -26];
const BRACKET: V3 = [X0 - 0.07, 3.2, RUN_Z];
const jack = (fl: number, col: number): V3 => add(room(fl, col), [0.82, 0.5, -0.93]);

// ---------------------------------------------------------------- colours

export const COL = {
  wall: '#1a1e29', wallLit: '#2a2f3d', floor: '#22283a', frame: '#0e1118',
  window: '#ffb35c', cable: '#3aa0ff', packet: '#7fd3ff', bad: '#ff3b30', ok: '#30d158', gold: '#ffd60a',
  screen: '#9ecbff', ink: '#ffffff',
};

/** Linear blend of two #rrggbb colours. */
export const mixHex = (a: string, b: string, t: number) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const k = Math.max(0, Math.min(1, t));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0')).join('');
};

const BLANKETS = ['#3b5b8c', '#8c3b4a', '#3b7a5e', '#7a6a3b', '#5b3b8c', '#2f6f7a', '#8a5a2f'];
const POSTERS = ['#8a5a55', '#a08a5a', '#5a7a95', '#5f8a66', '#7d6a95', '#9a6a4a'];

// ---------------------------------------------------------------- primitives

const box = (w: number, h: number, d: number) => ({ kind: 'box' as const, width: w, height: h, depth: d });

/** A straight rod (cylinder) from `a` to `b`. */
type Mat = React.ComponentProps<typeof Mesh>['material'];
export const Rod: React.FC<{ a: V3; b: V3; r: number; mat: Mat }> = ({ a, b, r, mat }) => {
  const d = sub(b, a);
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len < 1e-4) return null;
  const yaw = (Math.atan2(d[0], d[2]) * 180) / Math.PI;
  const pitch = (Math.acos(Math.max(-1, Math.min(1, d[1] / len))) * 180) / Math.PI;
  return (
    <Group3D position={mix3(a, b, 0.5)} rotation={[0, yaw, 0]}>
      <Mesh rotation={[pitch, 0, 0]} geometry={{ kind: 'cylinder', radiusTop: r, radiusBottom: r, height: len, segments: 10 }} material={mat} />
    </Group3D>
  );
};

/** A cable along a polyline. */
export const Wire: React.FC<{ pts: V3[]; r: number; mat: Mat }> = ({ pts, r, mat }) => (
  <Group3D>{pts.slice(1).map((p, i) => <Rod key={i} a={pts[i]} b={p} r={r} mat={mat} />)}</Group3D>
);

/** Points of a hanging cable from `a` to `b` that sags `sag` at the middle. */
export const catenary = (a: V3, b: V3, sag: number, n = 14): V3[] =>
  Array.from({ length: n + 1 }, (_, i) => { const t = i / n; const p = mix3(a, b, t); return [p[0], p[1] - sag * 4 * t * (1 - t), p[2]] as V3; });

const cableMat = (glow: number): Mat => ({ color: '#0b1a2a', emissive: COL.cable, emissiveIntensity: glow, roughness: 0.5 });
const SLEEVE: Mat = { color: '#3a3f4a', roughness: 0.6, metallic: 0.3 };

// ---------------------------------------------------------------- the building

export type RoomState = { red?: number; green?: number; dim?: number };
export type WorldState = {
  /** seconds, for fans, flickers and traffic. */
  t: number;
  /** 0 night .. 1 morning: walls and floors warm up. */
  dawn: number;
  /** Per room "fl,col" -> state. */
  rooms: Record<string, RoomState>;
  /** 0..1 how lit the windows are (the hostel asleep = low). */
  windows: number;
  /** 0..1 cables glowing. */
  cables: number;
  /** 0..1 glass isolation walls raised between rooms (prevention). */
  isolation: number;
  /** 0..1 my laptop's cable pulled out (the end drops off the desk). */
  unplugged?: number;
};

/** One room: floor, back wall with a window and curtains, right side wall, bed, desk and chair, poster, shelf, rug,
 *  ceiling fan, wall jack and the cable drop to the ceiling run. */
const Room: React.FC<{ fl: number; col: number; s: RoomState; w: WorldState }> = ({ fl, col, s, w }) => {
  const c = room(fl, col);
  const green = s.green ?? 0;
  const red = (s.red ?? 0) * (1 - green);
  const h = (k: number) => hash(fl * 13 + col * 7, k);
  const wall = mixHex(mixHex(mixHex(COL.wall, '#2a2733', h(1) * 0.6), '#4a4038', w.dawn * 0.6), '#3a0d0d', red * 0.8);
  // windows: about a third of the rooms awake at night; a few switch on and off as time passes
  const awake = h(2) < 0.32 || (h(3) < 0.25 && Math.floor(w.t / (6 + h(4) * 9) + h(5) * 3) % 2 === 0);
  const lit = (awake ? 1 : 0.12) * w.windows;
  const win = red > 0.01 ? mixHex(COL.window, COL.bad, red) : mixHex(COL.window, '#ffe2b8', h(6) * 0.5);
  const sleeper = h(7) < 0.55 && !isRoom(fl, col, ROOMS.attacker);
  const fanSpeed = h(8) < 0.7 ? 260 + h(9) * 160 : 0;
  const monitor = !isRoom(fl, col, ROOMS.mine) && !isRoom(fl, col, ROOMS.friend) && !isRoom(fl, col, ROOMS.attacker) && h(10) < 0.3;
  const flicker = 0.6 + 0.4 * Math.sin(w.t * (9 + h(11) * 6)) * Math.sin(w.t * 2.3 + h(12) * 10);
  const blanket = BLANKETS[Math.floor(h(13) * BLANKETS.length)];
  const poster = POSTERS[Math.floor(h(14) * POSTERS.length)];
  const local = (p: V3): V3 => sub(p, c);
  const jk = local(jack(fl, col));
  const lp = local(laptopAt(fl, col));
  const hasDevice = isRoom(fl, col, ROOMS.mine) || isRoom(fl, col, ROOMS.friend) || isRoom(fl, col, ROOMS.attacker) || VICTIMS.some((k) => isRoom(fl, col, k));
  const cg = 0.15 + 0.9 * w.cables;
  return (
    <Group3D position={c}>
      {/* back wall, side wall, floor */}
      <Mesh receiveShadow position={[0, RH / 2, -RD / 2]} geometry={box(RW, RH, 0.08)} material={{ color: wall, roughness: 0.9 }} />
      <Mesh receiveShadow castShadow position={[RW / 2 - 0.03, RH / 2, 0]} geometry={box(0.06, RH, RD)} material={{ color: wall, roughness: 0.9 }} />
      <Mesh receiveShadow castShadow position={[0, -0.04, 0]} geometry={box(RW, 0.08, RD)} material={{ color: mixHex(mixHex(COL.floor, '#3a3226', h(15) * 0.5), '#5a4a3a', w.dawn * 0.5), roughness: 0.7 }} />
      {/* window: frame, glow, mullions, curtains */}
      <Mesh position={[-0.45, RH * 0.6, -RD / 2 + 0.045]} geometry={box(0.62, 0.5, 0.02)} material={{ color: '#0b0d12', roughness: 0.6 }} />
      <Mesh position={[-0.45, RH * 0.6, -RD / 2 + 0.058]} geometry={box(0.54, 0.42, 0.01)}
        material={{ color: '#000000', emissive: win, emissiveIntensity: 0.06 + 0.7 * Math.max(lit, red) + 0.25 * w.dawn }} />
      <Mesh position={[-0.45, RH * 0.6, -RD / 2 + 0.066]} geometry={box(0.025, 0.42, 0.01)} material={{ color: '#0b0d12' }} />
      <Mesh position={[-0.45, RH * 0.6, -RD / 2 + 0.066]} geometry={box(0.54, 0.025, 0.01)} material={{ color: '#0b0d12' }} />
      <Mesh position={[-0.8, RH * 0.6, -RD / 2 + 0.08]} geometry={box(0.12, 0.62, 0.02)} material={{ color: mixHex(blanket, '#222222', 0.4), roughness: 1 }} />
      <Mesh position={[-0.1, RH * 0.6, -RD / 2 + 0.08]} geometry={box(0.12, 0.62, 0.02)} material={{ color: mixHex(blanket, '#222222', 0.4), roughness: 1 }} />
      {/* poster above the desk */}
      <Mesh position={[0.3, 1.05, -RD / 2 + 0.05]} geometry={box(0.28, 0.36, 0.01)} material={{ color: poster, roughness: 0.9, emissive: poster, emissiveIntensity: 0.02 + 0.05 * lit }} />
      {/* bed: frame, mattress, blanket, pillow, maybe a sleeper */}
      <Mesh castShadow receiveShadow position={[-0.45, 0.1, -0.2]} geometry={box(0.82, 0.16, 1.45)} material={{ color: '#2a2219', roughness: 0.8 }} />
      <Mesh castShadow receiveShadow position={[-0.45, 0.21, -0.2]} geometry={box(0.76, 0.07, 1.4)} material={{ color: '#c9c3b8', roughness: 1 }} />
      <Mesh castShadow receiveShadow position={[-0.45, 0.255, 0.05]} geometry={box(0.78, 0.03, 0.95)} material={{ color: blanket, roughness: 1 }} />
      <Mesh castShadow position={[-0.45, 0.27, -0.75]} geometry={box(0.5, 0.07, 0.22)} material={{ color: '#e8e4dc', roughness: 1 }} />
      {sleeper && w.dawn < 0.95 && <Mesh castShadow position={[-0.45, 0.3, 0.0]} scale={[1, 0.45 * (1 - w.dawn * 0.6), 1]} geometry={{ kind: 'sphere', radius: 0.26, segments: 12, rings: 8 }} material={{ color: blanket, roughness: 1 }} />}
      {/* desk, leg, chair */}
      <Mesh castShadow receiveShadow position={add(local(desk(fl, col)), [0, -0.02, 0])} geometry={box(0.7, 0.04, 0.5)} material={{ color: '#3b3226', roughness: 0.8 }} />
      <Mesh castShadow position={add(local(desk(fl, col)), [0.3, -0.22, 0])} geometry={box(0.04, 0.4, 0.44)} material={{ color: '#2a241c', roughness: 0.8 }} />
      <Mesh castShadow receiveShadow position={add(local(desk(fl, col)), [-0.05, -0.17, 0.42])} geometry={box(0.3, 0.03, 0.3)} material={{ color: '#23262d', roughness: 0.7 }} />
      <Mesh castShadow position={add(local(desk(fl, col)), [-0.05, -0.31, 0.42])} geometry={box(0.03, 0.26, 0.03)} material={{ color: '#23262d' }} />
      {monitor && (
        <Group3D position={add(local(desk(fl, col)), [-0.05, 0.14, -0.08])}>
          <Mesh castShadow geometry={box(0.36, 0.22, 0.02)} material={{ color: '#111' }} />
          <Mesh position={[0, 0, 0.012]} geometry={box(0.32, 0.18, 0.002)} material={{ color: '#000', emissive: '#6fa8ff', emissiveIntensity: (0.3 + 1.2 * flicker) * lit }} />
        </Group3D>
      )}
      {/* low shelf on the side wall, a few books */}
      <Mesh castShadow receiveShadow position={[RW / 2 - 0.2, 0.25, 0.45]} geometry={box(0.28, 0.5, 0.5)} material={{ color: '#2e2a26', roughness: 0.8 }} />
      {[0, 1, 2].map((i) => <Mesh key={i} position={[RW / 2 - 0.2, 0.55, 0.3 + i * 0.12]} geometry={box(0.18, 0.11 + h(20 + i) * 0.05, 0.05)} material={{ color: mixHex(POSTERS[(i + Math.floor(h(16) * 6)) % 6], '#15171c', 0.35), roughness: 0.95 }} />)}
      {/* rug */}
      <Mesh position={[0.25, 0.004, 0.35]} rotation={[-90, 0, 0]} geometry={{ kind: 'plane', width: 0.8, height: 0.55 }} material={{ color: mixHex(blanket, '#111111', 0.3), roughness: 1 }} />
      {/* ceiling fan with a light */}
      <Group3D position={[0, RH - 0.08, 0.1]}>
        <Mesh position={[0, 0.03, 0]} geometry={{ kind: 'cylinder', radiusTop: 0.01, radiusBottom: 0.01, height: 0.08 }} material={{ color: '#888' }} />
        <Mesh geometry={{ kind: 'cylinder', radiusTop: 0.05, radiusBottom: 0.07, height: 0.05, segments: 16 }}
          material={{ color: '#d8d2c4', emissive: red > 0.01 ? COL.bad : '#ffcf8a', emissiveIntensity: 0.05 + 1.0 * Math.max(lit * 0.8, red) }} />
        <Group3D rotation={[0, (w.t * fanSpeed + h(17) * 120) % 360, 0]}>
          {[0, 120, 240].map((a) => <Mesh key={a} rotation={[0, a, 4]} position={[0, -0.01, 0]} geometry={box(0.04, 0.006, 0.42)} material={{ color: '#cfc8b8', roughness: 0.6 }} />)}
        </Group3D>
      </Group3D>
      {/* wall jack and the drop up to the ceiling run; a patch cable to the device if there is one */}
      <Mesh position={jk} geometry={box(0.08, 0.1, 0.02)} material={{ color: '#e6e6e6', roughness: 0.5 }} />
      <Rod a={add(jk, [0, 0.05, -0.005])} b={[jk[0], CEIL(fl) - fl * RH, RUN_Z]} r={0.012} mat={cableMat(cg * 0.8)} />
      {hasDevice && !isRoom(fl, col, ROOMS.attacker) && (() => {
        const u = isRoom(fl, col, ROOMS.mine) ? w.unplugged ?? 0 : 0;
        const end = mix3(add(lp, [0.12, 0.0, -0.13]), [jk[0] - 0.06, lp[1] - 0.34, -0.62], u);
        return <Wire pts={[add(jk, [0, -0.02, 0.012]), mix3([jk[0], lp[1] - 0.01, -0.7], [jk[0], lp[1] - 0.2, -0.78], u), end]} r={0.008} mat={cableMat(cg * 0.8 * (1 - 0.8 * u))} />;
      })()}
      {isRoom(fl, col, ROOMS.attacker) && <Wire pts={[add(jk, [0, -0.02, 0.012]), [jk[0], lp[1] - 0.01, -0.7], add(lp, [0.0, 0.03, -0.05])]} r={0.008} mat={{ color: '#200', emissive: COL.bad, emissiveIntensity: 0.8 }} />}
      {/* red or green glow on the floor */}
      {red > 0.01 && (
        <Mesh position={[0, 0.006, 0]} rotation={[-90, 0, 0]} geometry={{ kind: 'plane', width: RW * 0.9, height: RD * 0.9 }}
          material={{ color: '#000000', emissive: COL.bad, emissiveIntensity: 0.3 * red, opacity: 0.85 }} />
      )}
      {green > 0.01 && (
        <Mesh position={[0, 0.007, 0]} rotation={[-90, 0, 0]} geometry={{ kind: 'plane', width: RW * 0.9, height: RD * 0.9 }}
          material={{ color: '#000000', emissive: COL.ok, emissiveIntensity: 0.2 * green, opacity: 0.85 }} />
      )}
      {/* glass isolation wall (left side) */}
      {w.isolation > 0.01 && (
        <Mesh position={[-RW / 2 + 0.02, (RH / 2) * w.isolation, 0.0]} scale={[1, w.isolation, 1]} geometry={box(0.04, RH, RD)}
          material={{ color: '#9fd8ff', emissive: '#4fb4ff', emissiveIntensity: 0.35, opacity: 0.16, roughness: 0.05, metallic: 0.2 }} />
      )}
    </Group3D>
  );
};

/** A small laptop (victims' rooms), screen red when cut off. */
const SmallLaptop: React.FC<{ p: V3; red: number; lit: number }> = ({ p, red, lit }) => (
  <Laptop p={p} screen={mixHex('#9ecbff', '#ff6b5e', red)} glow={0.3 + 0.9 * Math.max(lit, red)} />
);

/** The building, the slab it stands in, the cable system inside it, the rack and the basement. */
export const Building: React.FC<{ w: WorldState }> = ({ w }) => {
  const rooms = [];
  for (let fl = 0; fl < FLOORS; fl++) for (let col = 0; col < COLS; col++)
    rooms.push(<Room key={`${fl},${col}`} fl={fl} col={col} s={w.rooms[`${fl},${col}`] ?? {}} w={w} />);
  const cg = 0.15 + 0.9 * w.cables;
  const trunk = cableMat(cg);
  const frame = mixHex('#2a3042', '#6a5a4a', w.dawn * 0.6);
  return (
    <Group3D>
      {rooms}
      {VICTIMS.map((k) => <SmallLaptop key={`v${k[0]},${k[1]}`} p={laptopAt(k[0], k[1])} red={w.rooms[`${k[0]},${k[1]}`]?.red ?? 0} lit={w.windows} />)}
      {/* front pillars and slab lips: the dollhouse frame */}
      {Array.from({ length: COLS + 1 }, (_, i) => (
        <Mesh key={'p' + i} castShadow position={[X0 + i * RW, (FLOORS * RH + BASE) / 2, RD / 2 - 0.04]} geometry={box(0.09, FLOORS * RH - BASE, 0.09)}
          material={{ color: frame, roughness: 0.6 }} />
      ))}
      {Array.from({ length: FLOORS + 1 }, (_, fl) => (
        <Mesh key={'s' + fl} position={[0, fl * RH - 0.04, RD / 2 - 0.04]} geometry={box(BW + 0.09, 0.1, 0.1)} material={{ color: frame, roughness: 0.6 }} />
      ))}
      {/* left end wall */}
      <Mesh castShadow receiveShadow position={[X0 + 0.03, (FLOORS * RH) / 2, 0]} geometry={box(0.06, FLOORS * RH, RD)} material={{ color: COL.wall, roughness: 0.9 }} />
      {/* roof: slab, parapet, water tank, AC units, aerial with a blinking light */}
      <Mesh castShadow receiveShadow position={[0, FLOORS * RH + 0.05, 0]} geometry={box(BW + 0.3, 0.12, RD + 0.2)} material={{ color: mixHex('#12151d', '#4a4440', w.dawn * 0.5), roughness: 0.8 }} />
      {[[0, -RD / 2 - 0.05, BW + 0.3, 0.1], [0, RD / 2 + 0.05, BW + 0.3, 0.1]].map(([x, z, wd, d], i) => (
        <Mesh key={'pp' + i} position={[x, FLOORS * RH + 0.22, z]} geometry={box(wd, 0.22, d)} material={{ color: frame, roughness: 0.7 }} />
      ))}
      <Group3D position={[3.6, FLOORS * RH + 0.11, -0.3]}>
        {[[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]].map(([x, z], i) => <Mesh key={i} position={[x, 0.25, z]} geometry={box(0.05, 0.5, 0.05)} material={{ color: '#555b66', metallic: 0.6 }} />)}
        <Mesh castShadow position={[0, 0.9, 0]} geometry={{ kind: 'cylinder', radiusTop: 0.5, radiusBottom: 0.5, height: 0.8, segments: 24 }} material={{ color: mixHex('#3a4a5a', '#8a9aa8', w.dawn), metallic: 0.4, roughness: 0.4 }} />
      </Group3D>
      {[-2.2, -1.1, 0.8].map((x, i) => (
        <Group3D key={'ac' + i} position={[x, FLOORS * RH + 0.31, -0.45]}>
          <Mesh castShadow geometry={box(0.7, 0.4, 0.4)} material={{ color: '#b9bec7', roughness: 0.5 }} />
          <Mesh position={[0.12, 0, 0.205]} rotation={[0, 0, (w.t * 400 + i * 50) % 360]} geometry={{ kind: 'cylinder', radiusTop: 0.14, radiusBottom: 0.14, height: 0.01, segments: 6 }} material={{ color: '#3a3f48' }} />
        </Group3D>
      ))}
      <Mesh position={[-4.6, FLOORS * RH + 0.8, -0.5]} geometry={{ kind: 'cylinder', radiusTop: 0.015, radiusBottom: 0.03, height: 1.5 }} material={{ color: '#777' }} />
      <Mesh position={[-4.6, FLOORS * RH + 1.57, -0.5]} geometry={{ kind: 'sphere', radius: 0.05, segments: 10, rings: 8 }}
        material={{ color: '#000', emissive: COL.bad, emissiveIntensity: Math.sin(w.t * 2.4) > 0.6 ? 4 : 0.2 }} />

      {/* ---- the cable system ---- */}
      {Array.from({ length: FLOORS }, (_, fl) => (
        <Group3D key={'run' + fl}>
          <Rod a={[X0 + 0.1, CEIL(fl), RUN_Z]} b={[RISER_X, CEIL(fl), RUN_Z]} r={0.022} mat={trunk} />
          {Array.from({ length: COLS - 1 }, (_, c) => (
            <Rod key={c} a={[X0 + RW * (c + 1) - 0.1, CEIL(fl), RUN_Z]} b={[X0 + RW * (c + 1) + 0.04, CEIL(fl), RUN_Z]} r={0.04} mat={SLEEVE} />
          ))}
        </Group3D>
      ))}
      <Rod a={[RISER_X, CEIL(FLOORS - 1), RUN_Z]} b={[RISER_X, BCEIL, RUN_Z]} r={0.03} mat={trunk} />
      {Array.from({ length: FLOORS }, (_, fl) => <Rod key={'rs' + fl} a={[RISER_X, fl * RH - 0.11, RUN_Z]} b={[RISER_X, fl * RH + 0.04, RUN_Z]} r={0.05} mat={SLEEVE} />)}
      <Wire pts={P_RISER_SWITCH.slice(P_RISER_SWITCH.length - 4)} r={0.03} mat={trunk} />
      {/* switch to router patch, in front of the rack */}
      <Wire pts={[add(SWITCH, [-0.42, 0, 0.26]), add(SWITCH, [-0.42, -0.06, 0.34]), add(ROUTER, [-0.42, 0.06, 0.34]), add(ROUTER, [-0.42, 0, 0.28])]} r={0.012} mat={cableMat(0.6 + cg)} />
      <Wire pts={P_ROUTER_OUT.slice(0, 6)} r={0.026} mat={trunk} />
      <Rod a={[X0 + 0.04, ONT[1], RUN_Z]} b={[X0 + 0.16, ONT[1], RUN_Z]} r={0.045} mat={SLEEVE} />
      {/* the rack */}
      {[[-0.68, -0.27], [0.68, -0.27], [-0.68, 0.27], [0.68, 0.27]].map(([x, z], i) => (
        <Mesh key={'rk' + i} castShadow position={add(RACK, [x, 0.65, z])} geometry={box(0.05, 1.3, 0.05)} material={{ color: '#2a2e36', metallic: 0.6, roughness: 0.4 }} />
      ))}
      <Mesh castShadow receiveShadow position={add(RACK, [0, 1.3, 0])} geometry={box(1.42, 0.04, 0.6)} material={{ color: '#2a2e36', metallic: 0.6, roughness: 0.4 }} />
      <Mesh receiveShadow position={add(RACK, [0, 0.04, 0])} geometry={box(1.42, 0.04, 0.6)} material={{ color: '#2a2e36', metallic: 0.6, roughness: 0.4 }} />
      {/* the ONT on the basement wall */}
      <Group3D position={ONT}>
        <Mesh castShadow geometry={box(0.34, 0.22, 0.06)} material={{ color: '#e9e9ea', roughness: 0.4 }} />
        {[0, 1, 2].map((i) => <Mesh key={i} position={[-0.09 + i * 0.07, -0.05, 0.032]} geometry={box(0.03, 0.02, 0.005)} material={{ color: '#000', emissive: COL.ok, emissiveIntensity: 1.5 + Math.sin(w.t * (5 + i * 3)) }} />)}
      </Group3D>
      {/* basement: back wall, floor, fluorescent tube, pipes, boxes, a bike */}
      <Mesh receiveShadow position={[0, BASE / 2, -RD / 2]} geometry={box(BW, -BASE, 0.08)} material={{ color: '#191c23', roughness: 0.9 }} />
      <Mesh receiveShadow position={[0, BASE - 0.05, 0]} geometry={box(BW, 0.1, RD)} material={{ color: '#20242c', roughness: 0.8 }} />
      <Mesh position={[2.5, -0.13, 0]} geometry={box(1.2, 0.04, 0.08)} material={{ color: '#fff', emissive: '#d8ecff', emissiveIntensity: 0.9 + 0.2 * Math.sin(w.t * 31) * (Math.sin(w.t * 0.7) > 0.95 ? 1 : 0) }} />
      <Mesh position={[-2.6, -0.13, 0.1]} geometry={box(1.2, 0.04, 0.08)} material={{ color: '#fff', emissive: '#d8ecff', emissiveIntensity: 0.8 }} />
      <Rod a={[X0 + 0.1, -0.32, -0.7]} b={[X0 + BW - 0.1, -0.32, -0.7]} r={0.05} mat={{ color: '#6b6f78', metallic: 0.5, roughness: 0.4 }} />
      {[[3.4, 0.2, -0.6, 0.5], [3.9, 0.15, -0.55, 0.4], [3.6, 0.5, -0.6, 0.3], [-4.2, 0.2, -0.5, 0.45]].map(([x, y, z, s], i) => (
        <Mesh key={'bx' + i} castShadow receiveShadow position={[x, BASE + y, z]} geometry={box(s, s * 0.7, s * 0.8)} material={{ color: '#6a5236', roughness: 0.95 }} />
      ))}
      <Group3D position={[1.6, BASE + 0.3, 0.2]} rotation={[0, 15, 0]}>
        {[-0.32, 0.32].map((x) => <Mesh key={x} position={[x, 0, 0]} rotation={[0, 90, 0]} geometry={{ kind: 'torus', radius: 0.26, tube: 0.02, ringSegments: 24 }} material={{ color: '#1c1c1c' }} />)}
        <Rod a={[-0.32, 0, 0]} b={[0.05, 0.3, 0]} r={0.018} mat={{ color: '#c0392b', metallic: 0.5 }} />
        <Rod a={[0.32, 0, 0]} b={[0.05, 0.3, 0]} r={0.018} mat={{ color: '#c0392b', metallic: 0.5 }} />
        <Rod a={[0.05, 0.3, 0]} b={[0.3, 0.38, 0]} r={0.018} mat={{ color: '#c0392b', metallic: 0.5 }} />
      </Group3D>
    </Group3D>
  );
};

/** The slab of city the block stands in (cut at the front, earth in cross-section), the table under it, the street
 *  furniture around the block, the utility pole and the uplink to the ISP mast. */
export const Ground: React.FC<{ w: WorldState; uplink: number }> = ({ w, uplink }) => {
  const earth = { color: mixHex('#1a140f', '#3a2c20', w.dawn * 0.7), roughness: 1 };
  const top = { color: mixHex('#10140f', '#3d4a32', w.dawn * 0.8), roughness: 1 };
  const strata = { color: mixHex('#241b13', '#4d3a29', w.dawn * 0.7), roughness: 1 };
  const B = 34;                   // half-width of the slab
  const zb = -34;                 // back of the slab
  const depthY = -TABLE;          // slab height (table to street level)
  const slab = (x0: number, x1: number, z0: number, z1: number, y0 = TABLE, y1 = 0) => ({ position: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2] as V3, geometry: box(x1 - x0, y1 - y0, z1 - z0) });
  const road = { color: mixHex('#0d0f13', '#3b3d42', w.dawn * 0.7), roughness: 0.85 };
  const t = w.t;
  // a car drives along the road behind the block every 14 s, alternating direction
  const lap = Math.floor(t / 14), k = (t % 14) / 14, dir = lap % 2 ? -1 : 1;
  const carX = dir * (-30 + 60 * k);
  const lamps: V3[] = [[X0 - 1.2, 0, 0.55], [X0 + BW + 1.2, 0, 0.55], [X0 - 7, 0, -4.4], [X0 + BW + 7, 0, -4.4]];
  const trees: [number, number, number][] = [[X0 - 5, -1.6, 1.1], [X0 - 9.5, -0.4, 0.9], [X0 + BW + 4.2, -1.2, 1.2], [X0 + BW + 9, -2.4, 1.0], [X0 - 3.8, -9, 1.3], [X0 + BW + 2.2, -9.5, 1.1]];
  const glowLamp = 0.4 + 1.6 * (1 - w.dawn);
  return (
    <Group3D>
      {/* table */}
      <Mesh receiveShadow position={[0, TABLE - 0.01, 10]} rotation={[-90, 0, 0]} geometry={{ kind: 'plane', width: 120, height: 90 }}
        material={{ color: mixHex('#040507', '#1d1916', w.dawn * 0.8), roughness: 0.55, metallic: 0.2 }} />
      {/* the slab: left, right, behind and under the block */}
      <Mesh receiveShadow castShadow {...slab(-B, X0, zb, CUT)} material={earth} />
      <Mesh receiveShadow castShadow {...slab(X0 + BW, B, zb, CUT)} material={earth} />
      <Mesh receiveShadow castShadow {...slab(X0, X0 + BW, zb, -RD / 2 - 0.04)} material={earth} />
      <Mesh receiveShadow castShadow {...slab(X0, X0 + BW, -RD / 2 - 0.04, CUT, TABLE, BASE - 0.1)} material={earth} />
      {/* a lighter layer in the cut face, and the topsoil */}
      <Mesh position={[(-B + X0) / 2, -0.75, CUT + 0.003]} geometry={box(B + X0, 0.12, 0.006)} material={strata} />
      <Mesh position={[(B + X0 + BW) / 2, -0.75, CUT + 0.003]} geometry={box(B - X0 - BW, 0.12, 0.006)} material={strata} />
      <Mesh position={[0, TABLE + 0.35, CUT + 0.003]} geometry={box(2 * B, 0.08, 0.006)} material={strata} />
      <Mesh receiveShadow position={[-B / 2 + X0 / 2, 0.015, (zb + CUT) / 2]} geometry={box(B + X0, 0.03, CUT - zb)} material={top} />
      <Mesh receiveShadow position={[B / 2 + (X0 + BW) / 2, 0.015, (zb + CUT) / 2]} geometry={box(B - X0 - BW, 0.03, CUT - zb)} material={top} />
      <Mesh receiveShadow position={[0, 0.015, (zb - RD / 2) / 2]} geometry={box(BW, 0.03, -zb - RD / 2)} material={top} />
      {/* road behind the block, with a dashed centre line, and the pavement in front of it */}
      <Mesh receiveShadow position={[0, 0.035, -5]} geometry={box(2 * B, 0.02, 2.4)} material={road} />
      {Array.from({ length: 22 }, (_, i) => <Mesh key={'d' + i} position={[-B + 1.5 + i * 3.1, 0.047, -5]} geometry={box(1.2, 0.005, 0.08)} material={{ color: '#d9d4c0', emissive: '#d9d4c0', emissiveIntensity: 0.05 }} />)}
      <Mesh receiveShadow position={[0, 0.05, -3.4]} geometry={box(2 * B, 0.06, 0.7)} material={{ color: mixHex('#22252b', '#6b6862', w.dawn * 0.7), roughness: 0.9 }} />
      {/* the car on the road */}
      <Group3D position={[carX, 0.05, -5 + dir * 0.55]} rotation={[0, dir > 0 ? 90 : -90, 0]}>
        <Mesh castShadow position={[0, 0.2, 0]} geometry={box(0.8, 0.22, 1.7)} material={{ color: '#2d5f8a', metallic: 0.6, roughness: 0.3 }} />
        <Mesh castShadow position={[0, 0.4, -0.1]} geometry={box(0.7, 0.2, 0.9)} material={{ color: '#1a2633', metallic: 0.6, roughness: 0.2 }} />
        {[-0.3, 0.3].map((x) => <Mesh key={'hl' + x} position={[x, 0.22, 0.86]} geometry={box(0.14, 0.06, 0.01)} material={{ color: '#000', emissive: '#fff4d6', emissiveIntensity: 3 * (1 - w.dawn * 0.7) }} />)}
        {[-0.3, 0.3].map((x) => <Mesh key={'tl' + x} position={[x, 0.22, -0.86]} geometry={box(0.14, 0.06, 0.01)} material={{ color: '#000', emissive: COL.bad, emissiveIntensity: 2 }} />)}
        {[[-0.4, 0.55], [0.4, 0.55], [-0.4, -0.55], [0.4, -0.55]].map(([x, z], i) => <Mesh key={'wh' + i} position={[x, 0.1, z]} rotation={[0, 0, 90]} geometry={{ kind: 'cylinder', radiusTop: 0.1, radiusBottom: 0.1, height: 0.08, segments: 12 }} material={{ color: '#111' }} />)}
      </Group3D>
      {/* a parked car beside the block */}
      <Group3D position={[X0 + BW + 2.3, 0.03, -0.3]} rotation={[0, 8, 0]}>
        <Mesh castShadow receiveShadow position={[0, 0.2, 0]} geometry={box(0.8, 0.22, 1.7)} material={{ color: '#8a2d2d', metallic: 0.6, roughness: 0.35 }} />
        <Mesh castShadow position={[0, 0.4, -0.1]} geometry={box(0.7, 0.2, 0.9)} material={{ color: '#2a1a1a', metallic: 0.6, roughness: 0.2 }} />
        {[[-0.4, 0.55], [0.4, 0.55], [-0.4, -0.55], [0.4, -0.55]].map(([x, z], i) => <Mesh key={'pw' + i} position={[x, 0.1, z]} rotation={[0, 0, 90]} geometry={{ kind: 'cylinder', radiusTop: 0.1, radiusBottom: 0.1, height: 0.08, segments: 12 }} material={{ color: '#111' }} />)}
      </Group3D>
      {/* a glowing vending machine by the entrance */}
      <Group3D position={[X0 + BW + 0.55, 0.03, 0.4]}>
        <Mesh castShadow receiveShadow position={[0, 0.45, 0]} geometry={box(0.5, 0.9, 0.4)} material={{ color: '#c8102e', roughness: 0.5 }} />
        <Mesh position={[0, 0.52, 0.205]} geometry={box(0.4, 0.6, 0.005)} material={{ color: '#000', emissive: '#e8f4ff', emissiveIntensity: 0.9 * (1 - w.dawn * 0.5) }} />
      </Group3D>
      {/* street lamps */}
      {lamps.map((p, i) => (
        <Group3D key={'lp' + i} position={p}>
          <Mesh castShadow position={[0, 0.9, 0]} geometry={{ kind: 'cylinder', radiusTop: 0.025, radiusBottom: 0.04, height: 1.8 }} material={{ color: '#3a3f48', metallic: 0.5 }} />
          <Mesh position={[0, 1.82, 0]} geometry={{ kind: 'sphere', radius: 0.09, segments: 12, rings: 8 }} material={{ color: '#000', emissive: '#ffcf8a', emissiveIntensity: glowLamp * 2 }} />
          <Mesh position={[0, 0.04, 0]} rotation={[-90, 0, 0]} geometry={{ kind: 'plane', width: 1.6, height: 1.6 }} material={{ color: '#000', emissive: '#ffb35c', emissiveIntensity: 0.18 * glowLamp, opacity: 0.35 }} />
        </Group3D>
      ))}
      {/* trees, swaying a little */}
      {trees.map(([x, z, s], i) => (
        <Group3D key={'tr' + i} position={[x, 0.03, z]} scale={s} rotation={[Math.sin(t * 0.8 + i) * 1.5, 0, Math.sin(t * 0.6 + i * 2) * 1.5]}>
          <Mesh castShadow position={[0, 0.5, 0]} geometry={{ kind: 'cylinder', radiusTop: 0.06, radiusBottom: 0.1, height: 1.0, segments: 8 }} material={{ color: '#3b2a1e', roughness: 1 }} />
          <Mesh castShadow position={[0, 1.25, 0]} geometry={{ kind: 'sphere', radius: 0.62, segments: 7, rings: 5 }} material={{ color: mixHex('#0f2a1a', '#3f6a35', w.dawn), roughness: 1 }} />
          <Mesh castShadow position={[0.25, 1.6, 0.1]} geometry={{ kind: 'sphere', radius: 0.42, segments: 7, rings: 5 }} material={{ color: mixHex('#12321f', '#4d7a3e', w.dawn), roughness: 1 }} />
        </Group3D>
      ))}
      {/* the utility pole: pole, crossarm, the conduit up the end wall, the drop and the span to the ISP mast */}
      <Mesh castShadow position={add(POLE, [0, 2.4, 0])} geometry={{ kind: 'cylinder', radiusTop: 0.06, radiusBottom: 0.09, height: 4.8, segments: 10 }} material={{ color: '#4a3a2c', roughness: 0.9 }} />
      <Mesh castShadow position={add(POLE_TOP, [0, 0.05, 0])} geometry={box(1.1, 0.07, 0.08)} material={{ color: '#4a3a2c', roughness: 0.9 }} />
      {[-0.45, 0.45].map((x) => <Mesh key={'ins' + x} position={add(POLE_TOP, [x, 0.13, 0])} geometry={{ kind: 'cylinder', radiusTop: 0.025, radiusBottom: 0.035, height: 0.09 }} material={{ color: '#d8d0c0' }} />)}
      <Wire pts={P_ROUTER_OUT.slice(6)} r={0.024} mat={cableMat(0.25 + 1.0 * uplink)} />
      <Mesh position={BRACKET} geometry={box(0.12, 0.1, 0.12)} material={{ color: '#5a5f68', metallic: 0.5 }} />
      {/* power lines between poles, for the street (not network) */}
      <Wire pts={catenary(add(POLE_TOP, [-0.45, 0.17, 0]), [-B + 1, 4.8, RUN_Z - 6], 0.5, 10)} r={0.008} mat={{ color: '#111' }} />
      <Wire pts={catenary(add(POLE_TOP, [0.45, 0.17, 0]), [X0 + BW + 3, 4.6, -6], 0.6, 12)} r={0.008} mat={{ color: '#111' }} />
      {/* the ISP mast on the skyline, with blinking lights */}
      <Group3D position={[MAST_TOP[0], 0, MAST_TOP[2]]}>
        <Mesh position={[0, MAST_TOP[1] / 2, 0]} geometry={{ kind: 'cylinder', radiusTop: 0.08, radiusBottom: 0.45, height: MAST_TOP[1], segments: 4 }} material={{ color: mixHex('#2a2e36', '#8a8f98', w.dawn), metallic: 0.5, roughness: 0.5 }} />
        {[0.35, 0.65, 1].map((k, i) => (
          <Mesh key={i} position={[0, MAST_TOP[1] * k, 0]} geometry={{ kind: 'sphere', radius: 0.14, segments: 10, rings: 8 }}
            material={{ color: '#000', emissive: COL.bad, emissiveIntensity: Math.sin(w.t * 2 + i * 0.7) > 0.3 ? 5 : 0.4 }} />
        ))}
      </Group3D>
    </Group3D>
  );
};

/** The MikroTik in the rack: a dark box with a row of blinking LEDs; `t` seconds, `on` 0..1 traffic, `bad` 0..1 poisoned. */
export const Router: React.FC<{ t: number; on: number; bad?: number }> = ({ t, on, bad = 0 }) => (
  <Group3D position={ROUTER}>
    <Mesh castShadow receiveShadow geometry={box(1.1, 0.22, 0.55)} material={{ color: '#343b48', metallic: 0.25, roughness: 0.45 }} />
    <Mesh position={[0, 0.115, 0]} geometry={box(1.0, 0.01, 0.45)} material={{ color: '#2a2e38', metallic: 0.6, roughness: 0.3 }} />
    <Mesh position={[0.36, 0.0, 0.278]} geometry={box(0.26, 0.07, 0.004)} material={{ color: '#000', emissive: '#e8eefc', emissiveIntensity: 0.25 }} />
    {Array.from({ length: 8 }, (_, i) => {
      const blink = on * (0.5 + 0.5 * Math.sin(t * (9 + i * 1.7) + i * 2.1));
      const c = bad > 0.5 && i % 3 === 0 ? COL.bad : COL.ok;
      return <Mesh key={i} position={[-0.42 + i * 0.08, 0.02, 0.28]} geometry={box(0.04, 0.03, 0.01)} material={{ color: '#000000', emissive: c, emissiveIntensity: 0.3 + 2.5 * blink }} />;
    })}
  </Group3D>
);

/** The switch in the rack: a flat box with port LEDs; `gate` raises the ARP-inspection gate. */
export const Switch: React.FC<{ t: number; gate?: number }> = ({ t, gate = 0 }) => (
  <Group3D position={SWITCH}>
    <Mesh castShadow receiveShadow geometry={box(1.1, 0.12, 0.5)} material={{ color: '#2c323c', metallic: 0.25, roughness: 0.45 }} />
    {Array.from({ length: 12 }, (_, i) => (
      <Mesh key={i} position={[-0.46 + i * 0.075, 0.0, 0.255]} geometry={box(0.05, 0.04, 0.01)}
        material={{ color: '#000000', emissive: COL.ok, emissiveIntensity: 0.3 + 1.5 * (0.5 + 0.5 * Math.sin(t * 7 + i * 1.9)) }} />
    ))}
    {gate > 0.01 && (
      <Mesh position={[0, 0.06, 0.32]} scale={[1, gate, 1]} geometry={box(1.25, 0.5, 0.02)}
        material={{ color: '#ffd60a', emissive: '#ffd60a', emissiveIntensity: 0.6, opacity: 0.22 }} />
    )}
  </Group3D>
);

/** Far-off city blocks (on the slab, behind the road) with windows that come and go. */
export const Skyline: React.FC<{ dawn: number; t: number }> = ({ dawn, t }) => {
  const out = [];
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const x = -40 + i * 3.2 + rnd() * 1.5;
    const h = 3 + rnd() * 10;
    const z = -12 - rnd() * 16;
    const w = 1.8 + rnd() * 1.8;
    if (Math.abs(x - MAST_TOP[0]) < 2.5 && Math.abs(z - MAST_TOP[2]) < 3) continue;
    out.push(<Mesh key={'b' + i} castShadow receiveShadow position={[x, h / 2, z]} geometry={box(w, h, 1.6)}
      material={{ color: mixHex('#0a0d16', '#4a4650', dawn * 0.8), roughness: 0.9 }} />);
    const n = 3 + Math.floor(rnd() * 7);
    for (let k = 0; k < n; k++) {
      const on = rnd() < 0.7 ? 1 : (Math.floor(t / (5 + rnd() * 8) + k) % 2);
      out.push(<Mesh key={`w${i}-${k}`} position={[x - w / 2 + 0.3 + rnd() * (w - 0.6), 0.6 + rnd() * (h - 1), z + 0.81]}
        geometry={box(0.22, 0.28, 0.01)} material={{ color: '#000000', emissive: rnd() < 0.8 ? '#ffb35c' : '#9ecbff', emissiveIntensity: on * (0.4 + rnd() * 0.6) * (1 - dawn * 0.85) }} />);
    }
    if (h > 9) out.push(<Mesh key={'r' + i} position={[x, h + 0.1, z]} geometry={{ kind: 'sphere', radius: 0.08, segments: 8, rings: 6 }}
      material={{ color: '#000', emissive: COL.bad, emissiveIntensity: Math.sin(t * 1.7 + i) > 0.5 ? 3 : 0.2 }} />);
  }
  return <Group3D>{out}</Group3D>;
};

/** A laptop at `p` (on a desk top): base and screen (emissive `screen` colour). */
export const Laptop: React.FC<{ p: V3; screen: string; glow: number; open?: number; scale?: number }> = ({ p, screen, glow, open = 1, scale = 1 }) => (
  <Group3D position={p} scale={scale}>
    <Mesh castShadow receiveShadow position={[0, 0.009, 0]} geometry={box(0.42, 0.018, 0.29)} material={{ color: '#9aa0aa', metallic: 0.8, roughness: 0.3 }} />
    <Group3D position={[0, 0.018, -0.145]} rotation={[-90 + 105 * open, 0, 0]}>
      <Mesh castShadow position={[0, 0.14, 0]} geometry={box(0.42, 0.28, 0.012)} material={{ color: '#9aa0aa', metallic: 0.8, roughness: 0.3 }} />
      <Mesh position={[0, 0.14, 0.007]} geometry={box(0.38, 0.24, 0.002)} material={{ color: '#000000', emissive: screen, emissiveIntensity: glow }} />
    </Group3D>
  </Group3D>
);

/** The impostor: a small black box on the desk with a faceted gem above it that eats light, ringed in red. */
export const Impostor: React.FC<{ p: V3; t: number; on: number; scale?: number }> = ({ p, t, on, scale = 1 }) => (
  <Group3D position={p} scale={scale}>
    <Mesh castShadow position={[0, 0.03, -0.05]} geometry={box(0.24, 0.06, 0.16)} material={{ color: '#0a0a0a', metallic: 0.7, roughness: 0.3 }} />
    <Mesh position={[0.08, 0.035, 0.031]} geometry={box(0.03, 0.015, 0.003)} material={{ color: '#000', emissive: COL.bad, emissiveIntensity: 3 * on * (Math.sin(t * 12) > 0 ? 1 : 0.3) }} />
    <Group3D scale={Math.max(0.001, on)}>
      <Mesh castShadow position={[0, 0.45 + 0.04 * Math.sin(t * 1.6), 0]} rotation={[20, t * 25, 10]}
        geometry={{ kind: 'sphere', radius: 0.24, segments: 6, rings: 3 }} material={{ color: '#050505', metallic: 0.9, roughness: 0.18 }} />
      <Mesh position={[0, 0.45, 0]} rotation={[90, 0, t * 40]} geometry={{ kind: 'torus', radius: 0.36, tube: 0.008, ringSegments: 64 }}
        material={{ color: '#000000', emissive: COL.bad, emissiveIntensity: 2.2 }} />
      <Mesh position={[0, 0.45, 0]} rotation={[60, t * 30, 0]} geometry={{ kind: 'torus', radius: 0.43, tube: 0.005, ringSegments: 64 }}
        material={{ color: '#000000', emissive: COL.bad, emissiveIntensity: 1.2 }} />
    </Group3D>
  </Group3D>
);

/** A glowing packet. */
export const Packet: React.FC<{ p: V3; color?: string; size?: number; k?: number }> = ({ p, color = COL.packet, size = 0.05, k = 2.5 }) => (
  <Mesh position={p} geometry={{ kind: 'sphere', radius: size, segments: 12, rings: 8 }} material={{ color: '#000000', emissive: color, emissiveIntensity: k }} />
);

/** An expanding ring (an ARP broadcast or a reply), `r` radius, `a` 0..1 fade. */
export const Ring: React.FC<{ p: V3; r: number; a: number; color: string; vertical?: boolean }> = ({ p, r, a, color, vertical }) =>
  a <= 0.01 ? null : (
    <Mesh position={p} rotation={vertical ? [0, 0, 0] : [90, 0, 0]} scale={Math.max(0.001, r)}
      geometry={{ kind: 'torus', radius: 1, tube: 0.012, ringSegments: 96, tubeSegments: 6 }}
      material={{ color: '#000000', emissive: color, emissiveIntensity: 2 * a, opacity: a }} />
  );

// ---------------------------------------------------------------- paths (the same routes the cables take)

/** Point at fraction `t` along a polyline. */
export const along = (pts: V3[], t: number): V3 => {
  const lens = pts.slice(1).map((p, i) => dist(pts[i], p));
  const total = lens.reduce((a, b) => a + b, 0);
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i]) return mix3(pts[i], pts[i + 1], lens[i] ? d / lens[i] : 0);
    d -= lens[i];
  }
  return pts[pts.length - 1];
};

/** From a room's device to its jack, up the drop, along the ceiling run to the riser. */
const toRiser = (fl: number, col: number): V3[] => {
  const l = laptopAt(fl, col), j = jack(fl, col);
  return [add(l, [0.12, 0.0, -0.13]), [j[0], l[1] - 0.01, -0.7], add(j, [0, -0.02, 0.012]), [j[0], CEIL(fl), RUN_Z], [RISER_X, CEIL(fl), RUN_Z]];
};
/** Down the riser, along the basement ceiling, into the switch. */
const P_RISER_SWITCH: V3[] = [[RISER_X, CEIL(FLOORS - 1), RUN_Z], [RISER_X, BCEIL, RUN_Z], [SWITCH[0] + 0.3, BCEIL, RUN_Z], [SWITCH[0] + 0.3, SWITCH[1], RUN_Z], add(SWITCH, [0.3, 0, -0.25])];
/** Switch to router (front patch), router to the ONT, out through the end wall, up the conduit, the drop to the pole,
 *  the span to the ISP mast. */
const P_ROUTER_OUT: V3[] = [
  add(ROUTER, [-0.3, 0, -0.28]), [ROUTER[0] - 0.3, ROUTER[1], RUN_Z], [ROUTER[0] - 0.3, ONT[1], RUN_Z], add(ONT, [0.17, 0, RUN_Z - ONT[2]]),
  add(ONT, [-0.17, 0, RUN_Z - ONT[2]]), [X0 + 0.04, ONT[1], RUN_Z],
  [X0 - 0.07, ONT[1], RUN_Z], [X0 - 0.07, BRACKET[1], RUN_Z],
  ...catenary(BRACKET, add(POLE_TOP, [0, 0.12, 0]), 0.35, 10).slice(0),
  ...catenary(add(POLE_TOP, [0, 0.12, 0]), MAST_TOP, 2.2, 18).slice(1),
];

/** The wire path from a room's device to the router: through the switch. */
export const pathToRouter = (fl: number, col: number): V3[] => {
  const r = toRiser(fl, col);
  const down = P_RISER_SWITCH.map((p, i) => (i === 0 ? ([RISER_X, CEIL(fl), RUN_Z] as V3) : p));
  return [...r, ...down.slice(1), add(SWITCH, [-0.42, 0, 0.26]), add(SWITCH, [-0.42, -0.06, 0.34]), add(ROUTER, [-0.42, 0.06, 0.34]), add(ROUTER, [-0.42, 0, 0.28])];
};

/** From a room's device to the internet: to the router, then the uplink. */
export const pathToInternet = (fl: number, col: number): V3[] => [...pathToRouter(fl, col), ROUTER, ...P_ROUTER_OUT];

/** From a device to another room's device, through the switch (that is where a LAN forwards it). */
export const pathToRoom = (fl: number, col: number, tf: number, tc: number): V3[] => {
  const a = pathToRouter(fl, col).slice(0, 9);          // up to the switch's back
  const back = [...toRiser(tf, tc)].reverse();          // riser on the target floor -> its device
  const up: V3[] = [...[...P_RISER_SWITCH].reverse().slice(0, 4), [RISER_X, CEIL(tf), RUN_Z]];
  return [...a, ...up.slice(1), ...back.slice(1)];
};
