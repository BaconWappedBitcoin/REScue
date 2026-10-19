/**
 * The tag colour presets of RES's tag editor (lib/modules/userTagger.js bgToTextColorMap, GPL-3.0,
 * the RES contributors, commit 4defffc): 21 named backgrounds ("none" plus 20 CSS colours), each
 * with the text colour RES paired with it. REScue stores colours as #rrggbb, so each name carries
 * its hex value. A colour outside this list (typed or picked by hand) falls back to a computed
 * black or white.
 */
import { contrastRatio, readableText, validColor } from './tagStore';

export interface ColorPreset {
  name: string;
  /** #rrggbb, or null for "none" (no background). */
  hex: string | null;
  /** The text colour RES used on this background. */
  text: string;
}

export const COLOR_PRESETS: readonly ColorPreset[] = [
  { name: 'none', hex: null, text: 'inherit' },
  { name: 'aqua', hex: '#00ffff', text: '#000000' },
  { name: 'black', hex: '#000000', text: '#ffffff' },
  { name: 'blue', hex: '#0000ff', text: '#ffffff' },
  { name: 'cornflowerblue', hex: '#6495ed', text: '#ffffff' },
  { name: 'fuchsia', hex: '#ff00ff', text: '#ffffff' },
  { name: 'gray', hex: '#808080', text: '#ffffff' },
  { name: 'green', hex: '#008000', text: '#ffffff' },
  { name: 'lime', hex: '#00ff00', text: '#000000' },
  { name: 'maroon', hex: '#800000', text: '#ffffff' },
  { name: 'navy', hex: '#000080', text: '#ffffff' },
  { name: 'olive', hex: '#808000', text: '#ffffff' },
  { name: 'orange', hex: '#ffa500', text: '#ffffff' },
  { name: 'orangered', hex: '#ff4500', text: '#ffffff' },
  { name: 'pink', hex: '#ffc0cb', text: '#000000' },
  { name: 'purple', hex: '#800080', text: '#ffffff' },
  { name: 'red', hex: '#ff0000', text: '#ffffff' },
  { name: 'silver', hex: '#c0c0c0', text: '#000000' },
  { name: 'teal', hex: '#008080', text: '#ffffff' },
  { name: 'white', hex: '#ffffff', text: '#000000' },
  { name: 'yellow', hex: '#ffff00', text: '#000000' },
];

const byName = new Map(COLOR_PRESETS.map((p) => [p.name, p]));
const byHex = new Map(COLOR_PRESETS.filter((p) => p.hex).map((p) => [p.hex!, p]));

export const presetByName = (name: unknown): ColorPreset | undefined =>
  typeof name === 'string' ? byName.get(name.trim().toLowerCase()) : undefined;

/** The preset a #rrggbb value equals, if any. */
export const presetForHex = (hex: unknown): ColorPreset | undefined => {
  const c = validColor(hex);
  return c ? byHex.get(c) : undefined;
};

/**
 * Text colour for a tag background: RES's pairing for a preset while it reads (4.5:1, WCAG AA),
 * else black or white by contrast. RES paired white with orange, which is only 2.1:1.
 */
export function tagTextColor(bg: string): string {
  const paired = presetForHex(bg)?.text;
  if (paired && paired !== 'inherit' && contrastRatio(paired, bg) >= 4.5) return paired;
  return readableText(bg);
}

export interface PresetTag {
  text: string;
  /** #rrggbb */
  color?: string;
}

/** Rows of the `presetTags` table option -> usable presets (rows without text are dropped). */
export function presetTagsFrom(rows: unknown): PresetTag[] {
  if (!Array.isArray(rows)) return [];
  const out: PresetTag[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const text = typeof r.text === 'string' ? r.text.trim().slice(0, 100) : '';
    if (!text) continue;
    const color = presetByName(r.color)?.hex ?? validColor(r.color);
    out.push(color ? { text, color } : { text });
  }
  return out;
}

/** A preset as a row of the `presetTags` table (the colour column holds #rrggbb or nothing). */
export function presetRow(p: PresetTag): { text: string; color: string } {
  return { text: p.text, color: p.color ?? '' };
}
