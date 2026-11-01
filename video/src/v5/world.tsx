// The v5 diorama: a cut-away hostel block at night (4 floors x 6 rooms, front wall open), a basement with the switch
// and the MikroTik, cable runs, packets, the impostor device, and the laptops. Everything is procedural (primitives,
// extruded SVG and 3D text); nothing is downloaded.
//
// Units are metres-ish: +x right, +y up, +z toward the viewer (the open side of the building). `project()` maps a 3D
// point to screen pixels through the same camera, so crisp 2D labels can be pinned to 3D things.

import React from 'react';
import { Mesh, Group3D, Text3D } from 'remotion';

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

// ---------------------------------------------------------------- layout

export const FLOORS = 4;
export const COLS = 6;
export const RW = 2.0;   // room width (x)
export const RH = 1.5;   // room height (y)
export const RD = 2.0;   // room depth (z)
export const BW = COLS * RW;
export const X0 = -BW / 2;
export const BASE = -1.4; // basement floor

/** Floor centre of room (floor, col). */
export const room = (fl: number, col: number): V3 => [X0 + RW * (col + 0.5), fl * RH, 0];

/** Which rooms matter (floor, col). */
export const ROOMS = {
  mine: [1, 1] as const,
  attacker: [2, 4] as const,
  friend: [1, 4] as const,
  morning: [[0, 3], [3, 1]] as const,                 // the two other devices at 05:34 ([3,1] = 10.255.23.47)
  afternoon: [[0, 0], [2, 1], [3, 1], [3, 5]] as const, // the four at 15:28 ([3,1] again)
};

export const desk = (fl: number, col: number): V3 => add(room(fl, col), [0.25, 0.42, -0.35]);
export const laptopAt = (fl: number, col: number): V3 => add(desk(fl, col), [0, 0.03, 0]);
export const ROUTER: V3 = [-2.2, BASE + 0.35, 0.1];
export const SWITCH: V3 = [1.6, BASE + 0.3, 0.1];
/** The riser: a vertical cable run at the building's right edge. */
export const RISER_X = X0 + BW + 0.35;
export const CEIL = (fl: number) => fl * RH + RH - 0.12;

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

// ---------------------------------------------------------------- the building

export type RoomState = { red?: number; green?: number; dim?: number };
export type WorldState = {
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
};

const box = (w: number, h: number, d: number) => ({ kind: 'box' as const, width: w, height: h, depth: d });

/** One room: floor slab, back wall with a window, side walls, a bed or a desk. */
const Room: React.FC<{ fl: number; col: number; s: RoomState; w: WorldState }> = ({ fl, col, s, w }) => {
  const c = room(fl, col);
  const green = s.green ?? 0;
  const red = (s.red ?? 0) * (1 - green);
  const dim = s.dim ?? 0;
  const wall = mixHex(mixHex(COL.wall, '#3a3430', w.dawn * 0.6), '#3a0d0d', red * 0.8);
  const seed = (fl * 7 + col * 3) % 5;
  const lit = (seed === 0 || seed === 3 ? 1 : 0.25) * w.windows * (1 - dim);
  const win = red > 0.01 ? mixHex(COL.window, COL.bad, red) : COL.window;
  const isKey = (fl === ROOMS.mine[0] && col === ROOMS.mine[1]) || (fl === ROOMS.friend[0] && col === ROOMS.friend[1]);
  return (
    <Group3D position={c}>
      {/* back wall */}
      <Mesh receiveShadow position={[0, RH / 2, -RD / 2]} geometry={box(RW, RH, 0.08)} material={{ color: wall, roughness: 0.9 }} />
      {/* window: frame, glass glow, mullions */}
      <Mesh position={[-0.45, RH * 0.6, -RD / 2 + 0.045]} geometry={box(0.62, 0.5, 0.02)} material={{ color: '#0b0d12', roughness: 0.6 }} />
      <Mesh position={[-0.45, RH * 0.6, -RD / 2 + 0.058]} geometry={box(0.54, 0.42, 0.01)}
        material={{ color: '#000000', emissive: win, emissiveIntensity: 0.08 + 0.75 * Math.max(lit, red) }} />
      <Mesh position={[-0.45, RH * 0.6, -RD / 2 + 0.066]} geometry={box(0.025, 0.42, 0.01)} material={{ color: '#0b0d12' }} />
      <Mesh position={[-0.45, RH * 0.6, -RD / 2 + 0.066]} geometry={box(0.54, 0.025, 0.01)} material={{ color: '#0b0d12' }} />
      {/* ceiling lamp */}
      <Mesh position={[0.1, RH - 0.1, 0.1]} geometry={{ kind: 'cylinder', radiusTop: 0.06, radiusBottom: 0.14, height: 0.08, segments: 20 }}
        material={{ color: '#000000', emissive: red > 0.01 ? COL.bad : '#ffcf8a', emissiveIntensity: 0.05 + 1.2 * Math.max(lit * 0.8, red) }} />
      {/* side wall (right) */}
      <Mesh receiveShadow castShadow position={[RW / 2 - 0.03, RH / 2, 0]} geometry={box(0.06, RH, RD)} material={{ color: wall, roughness: 0.9 }} />
      {/* floor slab */}
      <Mesh receiveShadow castShadow position={[0, -0.04, 0]} geometry={box(RW, 0.08, RD)} material={{ color: mixHex(COL.floor, '#4a4038', w.dawn * 0.5), roughness: 0.7 }} />
      {/* bed */}
      <Mesh castShadow receiveShadow position={[-0.45, 0.14, -0.2]} geometry={box(0.8, 0.2, 1.4)} material={{ color: '#2b3245', roughness: 0.95 }} />
      {!isKey && <Mesh castShadow receiveShadow position={[0.55, 0.36, -0.55]} geometry={box(0.6, 0.04, 0.5)} material={{ color: '#3b3226', roughness: 0.8 }} />}
      {/* red glow on the floor when cut off */}
      {red > 0.01 && (
        <Mesh position={[0, 0.005, 0]} rotation={[-90, 0, 0]} geometry={{ kind: 'plane', width: RW * 0.9, height: RD * 0.9 }}
          material={{ color: '#000000', emissive: COL.bad, emissiveIntensity: 0.35 * red, opacity: 0.9 }} />
      )}
      {green > 0.01 && (
        <Mesh position={[0, 0.006, 0]} rotation={[-90, 0, 0]} geometry={{ kind: 'plane', width: RW * 0.9, height: RD * 0.9 }}
          material={{ color: '#000000', emissive: COL.ok, emissiveIntensity: 0.22 * green, opacity: 0.9 }} />
      )}
      {/* glass isolation wall (left side) */}
      {w.isolation > 0.01 && (
        <Mesh position={[-RW / 2 + 0.02, (RH / 2) * w.isolation, 0.0]} scale={[1, w.isolation, 1]} geometry={box(0.04, RH, RD)}
          material={{ color: '#9fd8ff', emissive: '#4fb4ff', emissiveIntensity: 0.35, opacity: 0.16, roughness: 0.05, metallic: 0.2 }} />
      )}
    </Group3D>
  );
};

/** The building shell: rooms, roof, basement, riser and corridor cable runs. */
export const Building: React.FC<{ w: WorldState }> = ({ w }) => {
  const rooms = [];
  for (let fl = 0; fl < FLOORS; fl++) for (let col = 0; col < COLS; col++)
    rooms.push(<Room key={`${fl},${col}`} fl={fl} col={col} s={w.rooms[`${fl},${col}`] ?? {}} w={w} />);
  const cableMat = { color: '#0b1a2a', emissive: COL.cable, emissiveIntensity: 0.15 + 0.9 * w.cables };
  return (
    <Group3D>
      {rooms}
      {/* front pillars and slab lips: the dollhouse frame */}
      {Array.from({ length: COLS + 1 }, (_, i) => (
        <Mesh key={'p' + i} castShadow position={[X0 + i * RW, (FLOORS * RH + BASE) / 2, RD / 2 - 0.04]} geometry={box(0.09, FLOORS * RH - BASE, 0.09)}
          material={{ color: mixHex('#2a3042', '#6a5a4a', w.dawn * 0.6), roughness: 0.6 }} />
      ))}
      {Array.from({ length: FLOORS + 1 }, (_, fl) => (
        <Mesh key={'s' + fl} position={[0, fl * RH - 0.04, RD / 2 - 0.04]} geometry={box(BW + 0.09, 0.1, 0.1)}
          material={{ color: mixHex('#2a3042', '#6a5a4a', w.dawn * 0.6), roughness: 0.6 }} />
      ))}
      {/* left end wall */}
      <Mesh castShadow receiveShadow position={[X0 + 0.03, (FLOORS * RH) / 2, 0]} geometry={box(0.06, FLOORS * RH, RD)} material={{ color: COL.wall, roughness: 0.9 }} />
      {/* roof */}
      <Mesh castShadow receiveShadow position={[0, FLOORS * RH + 0.05, 0]} geometry={box(BW + 0.3, 0.12, RD + 0.2)} material={{ color: '#12151d', roughness: 0.8 }} />
      {/* basement: slab, back wall */}
      <Mesh receiveShadow position={[0, BASE - 0.05, 0]} geometry={box(BW + 1.2, 0.1, RD)} material={{ color: '#151922', roughness: 0.8 }} />
      <Mesh receiveShadow position={[0, BASE / 2, -RD / 2]} geometry={box(BW + 1.2, -BASE, 0.08)} material={{ color: '#11141b', roughness: 0.9 }} />
      {/* riser */}
      <Mesh position={[RISER_X, (FLOORS * RH + BASE) / 2, -0.6]} geometry={{ kind: 'cylinder', radiusTop: 0.035, radiusBottom: 0.035, height: FLOORS * RH - BASE }} material={cableMat} />
      {/* ceiling runs, one per floor, from the riser along the back of the rooms */}
      {Array.from({ length: FLOORS }, (_, fl) => (
        <Mesh key={fl} position={[(X0 + RISER_X) / 2, CEIL(fl), -0.6]} rotation={[0, 0, 90]}
          geometry={{ kind: 'cylinder', radiusTop: 0.025, radiusBottom: 0.025, height: RISER_X - X0 }} material={cableMat} />
      ))}
      {/* basement run: riser -> switch -> router */}
      <Mesh position={[(ROUTER[0] + RISER_X) / 2, BASE + 0.12, -0.6]} rotation={[0, 0, 90]}
        geometry={{ kind: 'cylinder', radiusTop: 0.035, radiusBottom: 0.035, height: RISER_X - ROUTER[0] }} material={cableMat} />
      {/* ground plane far out, catches the moonlight */}
      <Mesh receiveShadow position={[0, BASE - 0.11, 4]} rotation={[-90, 0, 0]} geometry={{ kind: 'plane', width: 80, height: 40 }}
        material={{ color: mixHex('#020305', '#16120f', w.dawn * 0.8), roughness: 1 }} />
    </Group3D>
  );
};

/** The MikroTik: a dark box with a row of blinking LEDs; `t` seconds, `on` 0..1 traffic, `bad` 0..1 poisoned. */
export const Router: React.FC<{ t: number; on: number; bad?: number; glowUp?: number }> = ({ t, on, bad = 0, glowUp = 0 }) => (
  <Group3D position={ROUTER}>
    <Mesh castShadow receiveShadow geometry={box(1.1, 0.22, 0.55)} material={{ color: '#1c1f26', metallic: 0.5, roughness: 0.35 }} />
    <Mesh position={[0, 0.115, 0]} geometry={box(1.0, 0.01, 0.45)} material={{ color: '#2a2e38', metallic: 0.6, roughness: 0.3 }} />
    {Array.from({ length: 8 }, (_, i) => {
      const blink = on * (0.5 + 0.5 * Math.sin(t * (9 + i * 1.7) + i * 2.1)) ;
      const c = bad > 0.5 && i % 3 === 0 ? COL.bad : COL.ok;
      return <Mesh key={i} position={[-0.42 + i * 0.12, 0.02, 0.28]} geometry={box(0.05, 0.03, 0.01)} material={{ color: '#000000', emissive: c, emissiveIntensity: 0.3 + 2.5 * blink + glowUp }} />;
    })}
  </Group3D>
);

/** The uplink: from the router along the basement to the building's left edge, then up into the sky. */
export const UPLINK: V3[] = [[ROUTER[0] - 0.55, BASE + 0.12, -0.6], [X0 - 0.45, BASE + 0.12, -0.6], [X0 - 0.45, 14, -0.6]];
export const Uplink: React.FC<{ on: number }> = ({ on }) => {
  const m = { color: '#0b1a2a', emissive: COL.cable, emissiveIntensity: 0.15 + 1.1 * on };
  return (
    <Group3D>
      <Mesh position={[(UPLINK[0][0] + UPLINK[1][0]) / 2, BASE + 0.12, -0.6]} rotation={[0, 0, 90]}
        geometry={{ kind: 'cylinder', radiusTop: 0.035, radiusBottom: 0.035, height: UPLINK[0][0] - UPLINK[1][0] }} material={m} />
      <Mesh position={[X0 - 0.45, (BASE + 14) / 2, -0.6]} geometry={{ kind: 'cylinder', radiusTop: 0.02, radiusBottom: 0.035, height: 14 - BASE }} material={m} />
    </Group3D>
  );
};

/** Far-off city blocks with a few lit windows, for depth (deterministic layout). */
export const Skyline: React.FC<{ dawn: number }> = ({ dawn }) => {
  const out = [];
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 28; i++) {
    const x = -42 + i * 3.1 + rnd() * 1.5;
    const h = 2 + rnd() * 9;
    const z = -18 - rnd() * 14;
    const w = 1.8 + rnd() * 1.8;
    out.push(<Mesh key={'b' + i} position={[x, BASE + h / 2, z]} geometry={box(w, h, 1.5)}
      material={{ color: mixHex('#080b14', '#3a3a48', dawn * 0.8), roughness: 0.9 }} />);
    const n = Math.floor(rnd() * 6);
    for (let k = 0; k < n; k++)
      out.push(<Mesh key={`w${i}-${k}`} position={[x - w / 2 + 0.3 + rnd() * (w - 0.6), BASE + 0.6 + rnd() * (h - 1), z + 0.76]}
        geometry={box(0.22, 0.28, 0.01)} material={{ color: '#000000', emissive: '#ffb35c', emissiveIntensity: (0.4 + rnd() * 0.6) * (1 - dawn * 0.8) }} />);
  }
  return <Group3D>{out}</Group3D>;
};

/** The switch: a flat box with port LEDs. */
export const Switch: React.FC<{ t: number; gate?: number }> = ({ t, gate = 0 }) => (
  <Group3D position={SWITCH}>
    <Mesh castShadow receiveShadow geometry={box(1.4, 0.12, 0.5)} material={{ color: '#20242c', metallic: 0.4, roughness: 0.4 }} />
    {Array.from({ length: 12 }, (_, i) => (
      <Mesh key={i} position={[-0.6 + i * 0.11, 0.0, 0.255]} geometry={box(0.06, 0.04, 0.01)}
        material={{ color: '#000000', emissive: COL.ok, emissiveIntensity: 0.3 + 1.5 * (0.5 + 0.5 * Math.sin(t * 7 + i * 1.9)) }} />
    ))}
    {gate > 0.01 && (
      <Mesh position={[0, 0.5 * gate, 0]} scale={[1, gate, 1]} geometry={box(1.5, 1.0, 0.04)}
        material={{ color: '#ffd60a', emissive: '#ffd60a', emissiveIntensity: 0.5, opacity: 0.25 }} />
    )}
  </Group3D>
);

/** A laptop on its desk: base, screen (emissive `screen` colour), at `p`. */
export const Laptop: React.FC<{ p: V3; screen: string; glow: number; open?: number; scale?: number }> = ({ p, screen, glow, open = 1, scale = 1 }) => (
  <Group3D position={p} scale={scale}>
    <Mesh castShadow receiveShadow position={[0, -0.02, 0]} geometry={box(0.9, 0.04, 0.6)} material={{ color: '#3b3226', roughness: 0.8 }} />
    <Mesh castShadow receiveShadow position={[0, -0.22, 0]} geometry={box(0.06, 0.4, 0.06)} material={{ color: '#2a241c', roughness: 0.8 }} />
    <Mesh castShadow receiveShadow position={[0, 0.012, 0.05]} geometry={box(0.42, 0.018, 0.29)} material={{ color: '#9aa0aa', metallic: 0.8, roughness: 0.3 }} />
    <Group3D position={[0, 0.02, -0.095]} rotation={[-90 + 105 * open, 0, 0]}>
      <Mesh castShadow position={[0, 0.14, 0]} geometry={box(0.42, 0.28, 0.012)} material={{ color: '#9aa0aa', metallic: 0.8, roughness: 0.3 }} />
      <Mesh position={[0, 0.14, 0.007]} geometry={box(0.38, 0.24, 0.002)} material={{ color: '#000000', emissive: screen, emissiveIntensity: glow }} />
    </Group3D>
  </Group3D>
);

/** The impostor: a black faceted gem that eats light, ringed in red. */
export const Impostor: React.FC<{ p: V3; t: number; on: number; scale?: number }> = ({ p, t, on, scale = 1 }) => (
  <Group3D position={p} scale={scale * on}>
    <Mesh castShadow position={[0, 0.45 + 0.04 * Math.sin(t * 1.6), 0]} rotation={[20, t * 25, 10]}
      geometry={{ kind: 'sphere', radius: 0.28, segments: 6, rings: 3 }} material={{ color: '#050505', metallic: 0.9, roughness: 0.18 }} />
    <Mesh position={[0, 0.45, 0]} rotation={[90, 0, t * 40]} geometry={{ kind: 'torus', radius: 0.42, tube: 0.008, ringSegments: 64 }}
      material={{ color: '#000000', emissive: COL.bad, emissiveIntensity: 2.2 }} />
    <Mesh position={[0, 0.45, 0]} rotation={[60, t * 30, 0]} geometry={{ kind: 'torus', radius: 0.5, tube: 0.005, ringSegments: 64 }}
      material={{ color: '#000000', emissive: COL.bad, emissiveIntensity: 1.2 }} />
  </Group3D>
);

/** A glowing packet. */
export const Packet: React.FC<{ p: V3; color?: string; size?: number; k?: number }> = ({ p, color = COL.packet, size = 0.05, k = 2.5 }) => (
  <Mesh position={p} geometry={{ kind: 'sphere', radius: size, segments: 12, rings: 8 }} material={{ color: '#000000', emissive: color, emissiveIntensity: k }} />
);

/** An expanding ring on the floor (an ARP broadcast or a reply), `r` radius, `a` 0..1 fade. */
export const Ring: React.FC<{ p: V3; r: number; a: number; color: string; vertical?: boolean }> = ({ p, r, a, color, vertical }) =>
  a <= 0.01 ? null : (
    <Mesh position={p} rotation={vertical ? [0, 0, 0] : [90, 0, 0]} scale={Math.max(0.001, r)}
      geometry={{ kind: 'torus', radius: 1, tube: 0.012, ringSegments: 96, tubeSegments: 6 }}
      material={{ color: '#000000', emissive: color, emissiveIntensity: 2 * a, opacity: a }} />
  );

// ---------------------------------------------------------------- paths

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

/** The wire path from a room's laptop to the router: up to the ceiling run, along it to the riser, down, across. */
export const pathToRouter = (fl: number, col: number): V3[] => {
  const l = laptopAt(fl, col);
  return [
    l, [l[0], l[1], -0.6], [l[0], CEIL(fl), -0.6], [RISER_X, CEIL(fl), -0.6], [RISER_X, BASE + 0.12, -0.6],
    [ROUTER[0] + 0.3, BASE + 0.12, -0.6], add(ROUTER, [0.3, 0, -0.2]),
  ];
};

/** The wire path from a laptop to another room (the impostor's), through the same ceiling run. */
export const pathToRoom = (fl: number, col: number, tf: number, tc: number): V3[] => {
  const l = laptopAt(fl, col);
  const t = add(room(tf, tc), [0, 0.45, 0]);
  return [l, [l[0], l[1], -0.6], [l[0], CEIL(fl), -0.6], [RISER_X, CEIL(fl), -0.6], [RISER_X, CEIL(tf), -0.6], [t[0], CEIL(tf), -0.6], t];
};

/** Big extruded 3D text. */
export const Title3D: React.FC<{ text: string; p: V3; size: number; color?: string; emissive?: number; rot?: V3; depth?: number; font?: string; opacity?: number }> =
  ({ text, p, size, color = COL.ink, emissive = 0.25, rot = [0, 0, 0], depth = 0.12, font = 'Inter', opacity = 1 }) => (
    <Text3D font={font} weight={800} size={size} depth={depth} position={p} rotation={rot} castShadow
      bevel={{ thickness: depth * 0.15, size: size * 0.012, segments: 3 }}
      material={{ color, emissive: color, emissiveIntensity: emissive, metallic: 0.3, roughness: 0.35, opacity }}>{text}</Text3D>
  );
