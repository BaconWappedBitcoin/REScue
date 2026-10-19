/**
 * Score colouring (RES voteEnhancements colorLinkScore / colorCommentScore): the colour for a score
 * comes from the reader's own table of "score, colour" rows. A score takes the colour of the highest
 * row at or below it; below the lowest row it gets no colour. With interpolation on, a score between
 * two rows gets a blend of their colours in proportion to where it falls. Only #rgb and #rrggbb
 * colours are accepted (the table is user input that ends up in a style attribute).
 */
export interface ColorStop {
  score: number;
  /** Lower-case #rrggbb. */
  color: string;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const WHOLE = /^-?\d{1,9}$/;

/** #rgb or #rrggbb as lower-case #rrggbb, or null. */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string' || !HEX.test(value.trim())) return null;
  const v = value.trim().toLowerCase();
  return v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v;
}

/** Rows of a coloration table as stops sorted by score; rows that are not valid are dropped. */
export function parseStops(rows: unknown): ColorStop[] {
  if (!Array.isArray(rows)) return [];
  const stops: ColorStop[] = [];
  for (const row of rows as Array<Record<string, unknown>>) {
    const score = String(row?.score ?? '').trim();
    const color = normalizeColor(row?.color);
    if (WHOLE.test(score) && color) stops.push({ score: Number(score), color });
  }
  return stops.sort((a, b) => a.score - b.score);
}

/** Message for a table row the reader is editing, or null when it is acceptable. */
export function validateStopRow(row: Record<string, unknown>): string | null {
  const score = String(row.score ?? '').trim();
  const color = String(row.color ?? '').trim();
  if (!score && !color) return null;
  if (!WHOLE.test(score)) return 'Score must be a whole number.';
  return normalizeColor(color) ? null : 'Colour must look like #aa3300.';
}

const channels = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const mix = (a: string, b: string, t: number): string => {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, '0');
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
};

/** The colour for `score`, or null for no colour (unknown score, or below every row). */
export function scoreColor(
  score: number | null | undefined,
  stops: ColorStop[],
  interpolate: boolean,
): string | null {
  if (typeof score !== 'number' || !Number.isFinite(score) || !stops.length) return null;
  let at = -1;
  for (let i = 0; i < stops.length; i++) if (stops[i]!.score <= score) at = i;
  if (at < 0) return null;
  const low = stops[at]!;
  const high = stops[at + 1];
  if (!interpolate || !high || high.score === low.score) return low.color;
  return mix(low.color, high.color, (score - low.score) / (high.score - low.score));
}
