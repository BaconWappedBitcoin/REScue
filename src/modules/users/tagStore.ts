/**
 * Pure logic for the `userTags` storage key (contracts/storage-schema.md): a record keyed by
 * lower-cased username. Nothing here touches storage or the DOM, and nothing prunes: a tag stays
 * until the user deletes it (data-model.md UserTag).
 */
export interface UserTag {
  /** Display casing, as last seen. */
  username: string;
  text?: string;
  /** #rrggbb */
  color?: string;
  /** http(s) only */
  link?: string;
  /** Upvotes the user has given this account (RES votesUp). A non-negative integer. */
  votesUp: number;
  /** Downvotes the user has given this account (RES votesDown). A non-negative integer. */
  votesDown: number;
  /** Net votes, always votesUp - votesDown. Kept for records and backups written before the split. */
  voteTally: number;
  ignored: boolean;
  updatedAt: number;
}

export type UserTags = Record<string, UserTag>;

export const tagKey = (username: string): string =>
  username
    .trim()
    .replace(/^\/?u\//i, '')
    .toLowerCase();

const HEX = /^#[0-9a-f]{6}$/i;

/** A valid #rrggbb colour (lower-cased), or undefined. */
export function validColor(value: unknown): string | undefined {
  return typeof value === 'string' && HEX.test(value.trim())
    ? value.trim().toLowerCase()
    : undefined;
}

/** An http/https URL (normalised), or undefined. `javascript:` and every other scheme fail. */
export function validLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** An absolute http(s) URL for a (possibly relative) permalink, or null. */
export function absoluteLink(permalink: string | null | undefined, origin: string): string | null {
  if (!permalink) return null;
  try {
    return validLink(new URL(permalink, origin).href) ?? null;
  } catch {
    return null;
  }
}

const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (r: number, g: number, b: number): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const rgbOf = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/** WCAG contrast ratio of two #rrggbb colours (1 to 21). Invalid input counts as no contrast. */
export function contrastRatio(fg: string, bg: string): number {
  const f = validColor(fg);
  const b = validColor(bg);
  if (!f || !b) return 1;
  const lf = luminance(...rgbOf(f));
  const lb = luminance(...rgbOf(b));
  return (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
}

/** Black or white, whichever reads better on `bg` (WCAG relative luminance). */
export function readableText(bg: string): string {
  const c = validColor(bg);
  if (!c) return '#000000';
  return contrastRatio('#000000', c) >= contrastRatio('#ffffff', c) ? '#000000' : '#ffffff';
}

/**
 * Text colour for a pill tinted with `rgba(r, g, b, a)` (see voteWeightColor) sitting on a page of
 * colour `pageBg` (#rrggbb): the tint is blended over the page first, then black or white wins by
 * contrast. Anything unparseable gives black.
 */
export function pillTextColor(tint: string, pageBg: string): string {
  const m = /^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\s*\)$/.exec(tint.trim());
  const page = validColor(pageBg) ?? '#ffffff';
  if (!m) return '#000000';
  const a = m[4] === undefined ? 1 : Math.min(1, Math.max(0, Number(m[4])));
  const [pr, pg, pb] = rgbOf(page);
  const mix = (t: string, p: number): number => Math.round(Number(t) * a + p * (1 - a));
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  const blended = `#${hex(mix(m[1]!, pr))}${hex(mix(m[2]!, pg))}${hex(mix(m[3]!, pb))}`;
  return readableText(blended);
}

export const formatTally = (n: number): string => `[${n > 0 ? '+' : ''}${n}]`;

/** "+3 −1": the separate up and down counts. */
export const formatVotes = (up: number, down: number): string => `+${up} −${down}`;

const count = (v: unknown): number =>
  Number.isFinite(v) ? Math.max(0, Math.trunc(v as number)) : 0;

/**
 * RES getVoteWeightStyle (userTagger.js, GPL-3.0): the pill colour for a vote count. Green when the
 * reader has upvoted the account more than downvoted, red when it is the other way round, white
 * when level; the more one-sided (and the larger the net), the more saturated and opaque.
 */
export function voteWeightColor(votesUp: number, votesDown: number): string {
  const votes = votesUp - votesDown;
  let red = 255;
  let green = 255;
  let blue = 255;
  let alpha = 1;
  if (votesUp > votesDown) {
    red = blue = Math.max(0, 255 - 8 * votes);
    alpha = Math.abs(votes) / (votesUp + votesDown);
  } else if (votesUp < votesDown) {
    green = blue = Math.max(0, 255 - Math.abs(8 * votes));
    alpha = Math.abs(votes) / (votesUp + votesDown);
  }
  return `rgba(${red}, ${green}, ${blue}, ${Math.round((0.2 + alpha * 0.8) * 1000) / 1000})`;
}

/** Coerce whatever storage holds into UserTags. Entries are repaired, never dropped. */
export function sanitizeTags(raw: unknown): UserTags {
  const out: UserTags = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [key, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    // Records written before the split hold only the net tally: it becomes upvotes or downvotes.
    const split = Number.isFinite(r.votesUp) || Number.isFinite(r.votesDown);
    const net = Number.isFinite(r.voteTally) ? Math.trunc(r.voteTally as number) : 0;
    const votesUp = split ? count(r.votesUp) : Math.max(net, 0);
    const votesDown = split ? count(r.votesDown) : Math.max(-net, 0);
    const tag: UserTag = {
      username: typeof r.username === 'string' ? r.username : key,
      votesUp,
      votesDown,
      voteTally: votesUp - votesDown,
      ignored: r.ignored === true,
      updatedAt: Number.isFinite(r.updatedAt) ? (r.updatedAt as number) : 0,
    };
    if (typeof r.text === 'string' && r.text) tag.text = r.text;
    const color = validColor(r.color);
    if (color) tag.color = color;
    const link = validLink(r.link);
    if (link) tag.link = link;
    out[key] = tag;
  }
  return out;
}

/** True when the record carries something worth keeping. */
const meaningful = (t: UserTag) => !!t.text || t.votesUp > 0 || t.votesDown > 0 || t.ignored;

function put(tags: UserTags, username: string, change: (t: UserTag) => UserTag, now: number) {
  const key = tagKey(username);
  const prev = tags[key] ?? {
    username,
    votesUp: 0,
    votesDown: 0,
    voteTally: 0,
    ignored: false,
    updatedAt: now,
  };
  const changed = change({ ...prev, username });
  // voteTally is derived, so it can never disagree with the two counts.
  const next = { ...changed, voteTally: changed.votesUp - changed.votesDown, updatedAt: now };
  const out = { ...tags };
  // An entirely empty record is not stored; there is nothing in it to prune later.
  if (meaningful(next)) out[key] = next;
  else delete out[key];
  return out;
}

export interface TagPatch {
  text?: string;
  color?: string;
  link?: string;
}

/**
 * Set the visible tag. Colour and link belong to the text, so clearing the text clears them too.
 * Invalid colours and links are ignored (the caller validates first to show an error).
 */
export function setTag(tags: UserTags, username: string, patch: TagPatch, now: number): UserTags {
  return put(
    tags,
    username,
    (t) => {
      const { text: _t, color: _c, link: _l, ...rest } = t;
      const text = (patch.text ?? '').trim();
      if (!text) return rest;
      const color = validColor(patch.color);
      const link = validLink(patch.link);
      return { ...rest, text, ...(color ? { color } : {}), ...(link ? { link } : {}) };
    },
    now,
  );
}

export function setIgnored(tags: UserTags, username: string, ignored: boolean, now: number) {
  return put(tags, username, (t) => ({ ...t, ignored }), now);
}

/** Set both counts (negative or fractional input is clamped to a whole number, 0 or more). */
export function setVotes(tags: UserTags, username: string, up: number, down: number, now: number) {
  return put(tags, username, (t) => ({ ...t, votesUp: count(up), votesDown: count(down) }), now);
}

/** Add to (or take from) the counts; neither goes below 0. */
export function adjustVotes(
  tags: UserTags,
  username: string,
  deltaUp: number,
  deltaDown: number,
  now: number,
) {
  return put(
    tags,
    username,
    (t) => ({
      ...t,
      votesUp: count(t.votesUp + (Math.trunc(deltaUp) || 0)),
      votesDown: count(t.votesDown + (Math.trunc(deltaDown) || 0)),
    }),
    now,
  );
}

/** Set the net tally: a positive value is stored as upvotes, a negative one as downvotes. */
export function setTally(tags: UserTags, username: string, tally: number, now: number) {
  const net = Math.trunc(tally) || 0;
  return setVotes(tags, username, Math.max(net, 0), Math.max(-net, 0), now);
}

/** Record `delta` net votes in one direction: + counts as upvotes, - as downvotes. */
export function adjustTally(tags: UserTags, username: string, delta: number, now: number) {
  const d = Math.trunc(delta) || 0;
  return adjustVotes(tags, username, Math.max(d, 0), Math.max(-d, 0), now);
}

/** Delete the user's whole record (tag, tally and ignore flag). */
export function removeTag(tags: UserTags, username: string): UserTags {
  const out = { ...tags };
  delete out[tagKey(username)];
  return out;
}

/**
 * Drop the records that carry nothing but a vote tally (no tag text, not ignored): RES troubleshooter
 * "clear tags". Tags you wrote and users you ignore stay, with their tallies.
 */
export function removeTallyOnlyTags(tags: UserTags): { tags: UserTags; removed: number } {
  const out: UserTags = {};
  let removed = 0;
  for (const [key, t] of Object.entries(tags)) {
    if (t.text || t.ignored) out[key] = t;
    else removed++;
  }
  return { tags: out, removed };
}
