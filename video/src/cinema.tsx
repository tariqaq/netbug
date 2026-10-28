// The film look: vignette, letterbox bars, chapter cards, and the camera (slow push-in, shake and colour fringing on
// hits). Kept apart from the scenes so every scene gets the same treatment.

import React from 'react';
import { Layer, Rect, Text, interpolate, Easing } from 'remotion';

export const W = 1920;
export const H = 1080;
/** Bar height for 2.39:1 inside 16:9. */
export const BAR = Math.round((H - W / 2.39) / 2);

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(0.2, 0.8, 0.2, 1);

/** Darkens the corners. */
export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.55 }) => {
  const k = (H / W) * 1.2;
  return (
    <Rect width={W} height={H} fill={{
      type: 'radial', cx: W / 2, cy: H / 2, r: W * 0.62, transform: [1, 0, 0, k, 0, (H / 2) * (1 - k)],
      stops: [{ offset: 0, color: 'rgba(0,0,0,0)' }, { offset: 0.6, color: 'rgba(0,0,0,0)' }, { offset: 1, color: `rgba(0,0,0,${strength})` }],
    }} />
  );
};

/** Black bars top and bottom; `amt` 0..1 slides them in. */
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

export type Hit = { f: number; shake: number; fringe: number };

/** Camera offset and colour fringe at frame `f` from the hits so far: a decaying, deterministic wobble. */
export const camera = (f: number, hits: Hit[]) => {
  let x = 0, y = 0, fringe = 0;
  for (const h of hits) {
    const d = f - h.f;
    if (d < 0 || d > 24) continue;
    const k = Math.exp(-d / 5);
    x += h.shake * k * Math.sin(d * 2.9 + h.f);
    y += h.shake * k * Math.cos(d * 3.7 + h.f * 0.5) * 0.7;
    fringe += h.fringe * Math.exp(-d / 3);
  }
  return { x, y, fringe };
};

/** "PART I" over black, a red rule drawing out under it, then the subtitle. `from` is the card's first frame. */
export const ChapterCard: React.FC<{ f: number; from: number; len: number; part: string; sub: string; red: string; ink: string; sans: string; mono: string }> =
  ({ f, from, len, part, sub, red, ink, sans, mono }) => {
    const d = f - from;
    if (d < 0 || d >= len) return null;
    const inn = interpolate(d, [0, 10], [0, 1], { ...clamp, easing: ease });
    const out = interpolate(d, [len - 8, len], [1, 0], clamp);
    const rule = interpolate(d, [4, 22], [0, 1], { ...clamp, easing: ease });
    const subIn = interpolate(d, [10, 22], [0, 1], { ...clamp, easing: ease });
    const chars = Array.from(part).map((_, i) => {
      const p = interpolate(d, [i * 1.5, i * 1.5 + 12], [0, 1], { ...clamp, easing: ease });
      return { opacity: p, y: (1 - p) * 18 };
    });
    return (
      <Layer opacity={out}>
        <Rect width={W} height={H} fill="#000" opacity={Math.min(1, inn * 2)} />
        <Text x={0} y={H / 2 - 92} maxWidth={W} align="center" font={mono} weight={500} size={30} color={red} chars={chars}>{part}</Text>
        <Rect x={W / 2 - 160 * rule} y={H / 2 - 36} width={320 * rule} height={3} fill={red} />
        <Text x={0} y={H / 2 - 6} maxWidth={W} align="center" font={sans} weight={800} size={58} color={ink} opacity={subIn}>{sub}</Text>
      </Layer>
    );
  };
