/**
 * The audience-lean chip: words and colours for a domain's score. Pure; no page access.
 *
 * The words use the same cut-offs as the hiding levels (min 0.7, mid 0.5, max 0.3), so "far left"
 * is what `left: min` hides, "left" what `mid` adds, and "lean left" what `max` adds. The colour is
 * a continuous diverging scale (blue for the left, as in US convention; grey in the middle; red for
 * the right) so two domains with the same word can still be told apart. The chip paints its own
 * background and text, so it reads the same in Reddit's light and dark themes.
 */
import { contrastRatio, readableText } from '../../users/tagStore';
import { THRESHOLDS, SOURCE_CITE, type Lean } from './scoring';

/** Ends of the colour scale: score -1, 0 and +1. Mid-tones that stand out on white and on near-black. */
export const LEAN_COLORS = { left: '#2563eb', centre: '#9ca3af', right: '#dc2626' } as const;

/** Smallest contrast ratio between chip text and chip background (WCAG AA for small text). */
export const MIN_CONTRAST = 4.5;

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

/** "far left", "left", "lean left", "neutral", "lean right", "right" or "far right". */
export function leanWord(score: number): string {
  const s = clamp1(score);
  const a = Math.abs(s);
  const side = s < 0 ? 'left' : 'right';
  if (a >= THRESHOLDS.min) return `far ${side}`;
  if (a >= THRESHOLDS.mid) return side;
  if (a >= THRESHOLDS.max) return `lean ${side}`;
  return 'neutral';
}

const toRgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];
const toHex = (rgb: readonly number[]): string =>
  '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

/** The chip background for a score: a straight blend from grey (0) toward blue (-1) or red (+1). */
export function leanColor(score: number): string {
  const s = clamp1(Number.isFinite(score) ? score : 0);
  const from = toRgb(LEAN_COLORS.centre);
  const to = toRgb(s < 0 ? LEAN_COLORS.left : LEAN_COLORS.right);
  const t = Math.abs(s);
  return toHex(from.map((v, i) => v + (to[i]! - v) * t));
}

/** Black or white, whichever reads better on `bg`; either way at least 4.5:1 on any background. */
export const leanTextColor = (bg: string): string => readableText(bg);

export interface LeanChipStyle {
  background: string;
  color: string;
  contrast: number;
}

export function chipStyle(score: number): LeanChipStyle {
  const background = leanColor(score);
  const color = leanTextColor(background);
  return { background, color, contrast: contrastRatio(color, background) };
}

/** "right 0.62", or just "0.00" when the score is exactly balanced. */
export function scoreText(score: number): string {
  const a = Math.abs(score).toFixed(2);
  return score === 0 ? a : `${score < 0 ? 'left' : 'right'} ${a}`;
}

/** The chip's visible text: the word, plus the number when the reader asked for it. */
export function chipText(lean: Pick<Lean, 'score'>, withScore: boolean): string {
  const word = leanWord(lean.score);
  return withScore
    ? `${word} ${lean.score < 0 ? '-' : lean.score > 0 ? '+' : ''}${Math.abs(lean.score).toFixed(2)}`
    : word;
}

/** What the chip's hover says, without the "REScue: " prefix (hints.ts adds it). */
export function chipDetail(lean: Lean): string {
  const parts = [
    lean.source ? SOURCE_CITE[lean.source] : '',
    lean.matched !== lean.domain ? `matched ${lean.matched}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const cite = parts ? ` (${parts})` : '';
  return `${lean.domain} audience lean ${scoreText(lean.score)} — who shares it on social media, not a rating of its content${cite}`;
}
