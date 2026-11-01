// The v5 look around the 3D layer: the sky behind it (night to dawn), haze, vignette, letterbox, label chips and the
// word-highlighted captions. All 2D; kept apart from the scenes so every shot gets the same treatment.

import React from 'react';
import { Layer, Rect, Text, Ellipse, interpolate, Easing } from 'remotion';
import { W, H, mixHex } from './world';

export const SANS = 'Inter';
export const MONO = 'JetBrains Mono';
export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
export const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
/** 0 -> 1 from frame `a` over `d` frames, eased. */
export const prog = (f: number, a: number, d = 20) => interpolate(f, [a, a + d], [0, 1], { ...clamp, easing: ease });
/** 1 -> 0 from frame `a` over `d` frames. */
export const fadeOut = (f: number, a: number, d = 20) => 1 - interpolate(f, [a, a + d], [0, 1], clamp);

/** Sky gradient behind the 3D layer. `dawn` 0 = night navy, 1 = warm morning. `stars` 0..1. */
export const Sky: React.FC<{ dawn: number; stars: number; red?: number }> = ({ dawn, stars, red = 0 }) => {
  const top = mixHex(mixHex('#02040a', '#3d6ea8', dawn), '#1a0204', red * 0.6);
  const mid = mixHex(mixHex('#070d1e', '#e6a26a', dawn), '#2a0508', red * 0.6);
  const low = mixHex(mixHex('#0d1630', '#ffd9a0', dawn), '#3a0a0c', red * 0.6);
  const dots = [];
  if (stars > 0.01) {
    let s = 777;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W, y = rnd() * H * 0.55, r = 0.8 + rnd() * 1.6;
      dots.push(<Ellipse key={i} x={x} y={y} width={r * 2} height={r * 2} fill="#ffffff" opacity={stars * (0.25 + rnd() * 0.6)} />);
    }
  }
  return (
    <Layer>
      <Rect width={W} height={H} fill={{ type: 'linear', x0: 0, y0: 0, x1: 0, y1: H, stops: [{ offset: 0, color: top }, { offset: 0.62, color: mid }, { offset: 1, color: low }] }} />
      {dots}
      {/* the sun rising behind the city at dawn */}
      {dawn > 0.01 && (
        <Rect width={W} height={H} opacity={dawn} fill={{ type: 'radial', cx: W * 0.72, cy: H * (0.82 - 0.2 * dawn), r: W * 0.55,
          stops: [{ offset: 0, color: 'rgba(255,214,150,0.95)' }, { offset: 0.18, color: 'rgba(255,170,90,0.45)' }, { offset: 1, color: 'rgba(255,140,60,0)' }] }} />
      )}
    </Layer>
  );
};

/** Low haze in front of the 3D layer: thickens toward the bottom, tinted like the sky. */
export const Haze: React.FC<{ dawn: number; amt?: number }> = ({ dawn, amt = 1 }) => {
  const c = mixHex('#0b1430', '#f0c08a', dawn);
  const rgb = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).join(',');
  return <Rect width={W} height={H} opacity={amt} fill={{ type: 'linear', x0: 0, y0: H * 0.45, x1: 0, y1: H,
    stops: [{ offset: 0, color: `rgba(${rgb},0)` }, { offset: 1, color: `rgba(${rgb},0.35)` }] }} />;
};

/** Darkens the corners. */
export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.6 }) => {
  const k = (H / W) * 1.2;
  return (
    <Rect width={W} height={H} fill={{
      type: 'radial', cx: W / 2, cy: H / 2, r: W * 0.62, transform: [1, 0, 0, k, 0, (H / 2) * (1 - k)],
      stops: [{ offset: 0, color: 'rgba(0,0,0,0)' }, { offset: 0.55, color: 'rgba(0,0,0,0)' }, { offset: 1, color: `rgba(0,0,0,${strength})` }],
    }} />
  );
};

/** Bar height for 2.39:1 inside 16:9. */
export const BAR = Math.round((H - W / 2.39) / 2);
export const Letterbox: React.FC<{ amt: number }> = ({ amt }) => {
  if (amt <= 0.001) return null;
  const h = BAR * amt;
  return (
    <Layer>
      <Rect width={W} height={h} fill="#000" />
      <Rect y={H - h} width={W} height={h} fill="#000" />
    </Layer>
  );
};

/** A small label pinned at screen point (x, y): a dot, a leader line and a dark chip with mono text. */
export const Tag: React.FC<{ x: number; y: number; text: string; sub?: string; color?: string; a: number; dx?: number; dy?: number; size?: number }> =
  ({ x, y, text, sub, color = '#ffffff', a, dx = 40, dy = -60, size = 24 }) => {
    if (a <= 0.01) return null;
    const w = Math.max(text.length, (sub ?? '').length * 0.82) * size * 0.62 + 32;
    const h = sub ? size * 2.5 + 8 : size + 22;
    // keep the chip inside the frame and above the captions
    const ty = Math.max(40, Math.min(H - 250 - h, y + dy));
    const left = Math.max(30, Math.min(W - 30 - w, dx < 0 ? x + dx - w : x + dx));
    const tx = dx < 0 ? left + w : left;
    return (
      <Layer opacity={a}>
        <Rect x={Math.min(x, tx)} y={Math.min(y, ty + h / 2)} width={1} height={1} fill="rgba(0,0,0,0)" />
        <Ellipse x={x - 5} y={y - 5} width={10} height={10} fill={color} />
        <Rect x={Math.min(x, dx < 0 ? left + w : left)} y={ty + h / 2 - 1} width={Math.abs((dx < 0 ? left + w : left) - x)} height={2} fill={color} opacity={0.7} />
        <Rect x={x - 1} y={Math.min(y, ty + h / 2)} width={2} height={Math.abs(y - (ty + h / 2))} fill={color} opacity={0.7} />
        <Rect x={left} y={ty} width={w} height={h} radius={10} fill="rgba(8,10,16,0.82)" stroke={{ color, width: 1.5 }} />
        <Text x={left + 16} y={ty + 10} font={MONO} weight={500} size={size} color={color}>{text}</Text>
        {sub && <Text x={left + 16} y={ty + 10 + size * 1.3} font={SANS} weight={600} size={size * 0.78} color="#c9d1e0">{sub}</Text>}
      </Layer>
    );
  };

export type CapWord = { text: string; at: number };
export type CapPage = { from: number; to: number; words: CapWord[] };

/** Captions: up to ~11 words a page, the spoken word highlighted. */
export const Captions: React.FC<{ f: number; pages: CapPage[]; hi?: string; y?: number }> = ({ f, pages, hi = '#ffd60a', y = H - 150 }) => {
  const p = pages.find((pg) => f >= pg.from && f < pg.to);
  if (!p) return null;
  const text = p.words.map((w) => w.text).join(' ');
  let active = -1;
  p.words.forEach((w, i) => { if (f >= w.at) active = i; });
  const styles: ({ color: string } | null)[] = [];
  p.words.forEach((w, i) => {
    for (const _ of Array.from(w.text)) styles.push(i === active ? { color: hi } : null);
    if (i < p.words.length - 1) styles.push(null);
  });
  const a = Math.min(prog(f, p.from, 6), fadeOut(f, p.to - 6, 6));
  return (
    <Layer y={y} opacity={a}>
      <Text x={180} y={0} maxWidth={W - 360} align="center" font={SANS} weight={600} size={42} color="#ffffff" lineHeight={1.25} chars={styles}
        effects={[]}>{text}</Text>
    </Layer>
  );
};
