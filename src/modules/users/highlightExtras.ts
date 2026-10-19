/**
 * userHighlight extras (RES userHighlight: OP colour, first commenter, OP mentions, auto-colour,
 * font colour, hover colours). Pure helpers, kept apart from the module. Ideas from RES
 * lib/modules/userHighlight.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import { readableText, tagKey, validColor } from './tagStore';

export const OP_CLASS = 'rescue-op-author';
export const OP_MENTION_CLASS = 'rescue-opmention-author';
export const FIRST_CLASS = 'rescue-first-author';
export const AUTO_BUCKETS = 36;
export const autoClass = (bucket: number): string => `rescue-auto-${bucket}`;

/** A stable 0..35 bucket for a user name (djb2 hash), so one user always gets one colour. */
export function autoBucket(user: string): number {
  let hash = 5381;
  for (const ch of tagKey(user)) hash = ((hash << 5) + hash + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % AUTO_BUCKETS;
}

/** RES autoColorUsing: how a name's colour is worked out (we hash the name; no user id is shown). */
export const AUTO_MODES = ['hash-notbright', 'hash-bright'] as const;
export type AutoMode = (typeof AUTO_MODES)[number];
export const asAutoMode = (v: unknown): AutoMode =>
  (AUTO_MODES as readonly unknown[]).includes(v) ? (v as AutoMode) : 'hash-notbright';

/**
 * The text-colour rules for the auto-coloured names: 36 hues. "notbright" keeps a mid lightness so
 * both themes read; "bright" uses the full-strength hue.
 */
export function autoColorCss(mode: AutoMode = 'hash-notbright'): string {
  const tone = mode === 'hash-bright' ? '90% 55%' : '60% 45%';
  return Array.from(
    { length: AUTO_BUCKETS },
    (_, i) => `a.${autoClass(i)}{color:hsl(${i * 10} ${tone}) !important}`,
  ).join('\n');
}

/** `#rrggbb` darkened by `amount` (0..1). Anything else comes back unchanged. */
export function shade(color: string, amount = 0.25): string {
  const c = validColor(color);
  if (!c || c.length !== 7) return color;
  const part = (i: number): string =>
    Math.round(parseInt(c.slice(i, i + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${part(1)}${part(3)}${part(5)}`;
}

/** One highlight rule: background pill, readable (or chosen) text, optional hover shade. */
export function pillCss(
  cls: string,
  bg: string,
  font: string | undefined,
  hover: boolean,
  hoverBg?: string,
): string {
  const text = validColor(font) ?? readableText(bg);
  const base = `a.${cls}{background:${bg};color:${text} !important;padding:0 3px;border-radius:3px}`;
  // A colour chosen for the hover always applies; otherwise the shared "darker on hover" switch.
  const over = validColor(hoverBg);
  if (over) return `${base}\na.${cls}:hover{background:${over}}`;
  return hover ? `${base}\na.${cls}:hover{background:${shade(bg)}}` : base;
}

/** Does the comment body (sanitised HTML) mention `user` as u/name, /u/name or a profile link? */
export function mentionsUser(bodyHtml: string, user: string): boolean {
  const name = user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^\\w/])/?u(?:ser)?/${name}(?![\\w-])`, 'i').test(bodyHtml);
}
