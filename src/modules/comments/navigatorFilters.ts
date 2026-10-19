/**
 * Comment navigator logic (RES commentNavigator, US6): which comments belong to a category, and
 * which one the next/previous step lands on. Pure; the module wires it to the selection.
 * Ported in spirit from RES lib/modules/commentNavigator.js (GPL-3.0, the RES contributors,
 * commit 4defffc); the code is new.
 */
import type { Comment } from '../../model/types';

export const NAV_CATEGORIES = [
  { value: 'all', label: 'All comments' },
  { value: 'op', label: 'OP' },
  { value: 'answered', label: 'Answered by OP' },
  { value: 'me', label: 'Me' },
  { value: 'moderator', label: 'Moderators' },
  { value: 'admin', label: 'Admins' },
  { value: 'friend', label: 'Friends' },
  { value: 'tagged', label: 'Tagged users' },
  { value: 'popular', label: 'Popular' },
  { value: 'image', label: 'With images' },
  { value: 'video', label: 'With videos' },
  { value: 'upvoted', label: 'Upvoted' },
  { value: 'new', label: 'New' },
  { value: 'highlighted', label: 'Highlighted users' },
  { value: 'custom', label: 'Custom' },
] as const;

export type NavCategory = (typeof NAV_CATEGORIES)[number]['value'];

export interface NavSets {
  /** Lower-cased usernames. */
  friends: ReadonlySet<string>;
  tagged: ReadonlySet<string>;
  /** Comments with at least this score count as popular. */
  popularScore: number;
  /** Replaces the score test for "popular" (the popularConditions option), when it is set. */
  isPopular?(c: Comment): boolean;
  /** Users the hover card's "highlight" word marked (User highlighting's highlighted list, lower-cased). */
  highlighted?: ReadonlySet<string>;
  /** The "custom" category's test (the customConditions option); absent when not set. */
  custom?(c: Comment): boolean;
  /** The reader upvoted this comment (read live from the action row's own upvote button). */
  upvoted?(c: Comment): boolean;
  /** Created after the previous visit (empty without read tracking). */
  isNew(c: Comment): boolean;
  /** The signed-in user's name, lower-cased (null when signed out). */
  me?: string | null;
  /** Ids of comments the thread author replied to directly (RES "IAmA"). */
  answered?: ReadonlySet<string>;
  /** Already there at the previous visit (the "skip read" box; absent without read tracking). */
  isRead?(c: Comment): boolean;
}

const IMAGE_HOSTS =
  /^(?:i\.redd\.it|preview\.redd\.it|(?:i\.)?imgur\.com|giphy\.com|media\.giphy\.com)$/i;
const VIDEO_HOSTS =
  /^(?:v\.redd\.it|youtu\.be|(?:www\.|m\.)?youtube\.com|gfycat\.com|streamable\.com|redgifs\.com|www\.redgifs\.com)$/i;
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/i;
const VIDEO_FILE = /\.(?:gifv|mp4|webm|mov)(?:[?#]|$)/i;

function linksMatch(bodyHtml: string, file: RegExp, hosts: RegExp): boolean {
  for (const m of bodyHtml.matchAll(/href="([^"]+)"/gi)) {
    const href = m[1]!.replace(/&amp;/g, '&');
    if (file.test(href)) return true;
    try {
      if (hosts.test(new URL(href, 'https://www.reddit.com').hostname)) return true;
    } catch {
      /* not a URL */
    }
  }
  return false;
}

/** Does the (sanitized) comment body embed or link to an image? */
export const hasImage = (bodyHtml: string): boolean =>
  /<img\b/i.test(bodyHtml) || linksMatch(bodyHtml, IMAGE_FILE, IMAGE_HOSTS);

/** Does the (sanitized) comment body embed or link to a video? */
export const hasVideo = (bodyHtml: string): boolean =>
  /<video\b/i.test(bodyHtml) || linksMatch(bodyHtml, VIDEO_FILE, VIDEO_HOSTS);

/** Image or video. */
export const hasMedia = (bodyHtml: string): boolean => hasImage(bodyHtml) || hasVideo(bodyHtml);

/** Ids of the comments that have a direct reply written by the thread author. */
export function answeredByOp(
  comments: ReadonlyArray<Pick<Comment, 'parentId' | 'isOp'>>,
): Set<string> {
  const out = new Set<string>();
  for (const c of comments) if (c.isOp && c.parentId) out.add(c.parentId);
  return out;
}

export function matchesCategory(c: Comment, cat: NavCategory, sets: NavSets): boolean {
  const author = c.author?.toLowerCase() ?? '';
  switch (cat) {
    case 'all':
      return true;
    case 'me':
      return !!author && !!sets.me && author === sets.me;
    case 'answered':
      return !!sets.answered?.has(c.id);
    case 'image':
      return hasImage(c.bodyHtml);
    case 'video':
      return hasVideo(c.bodyHtml);
    case 'op':
      return c.isOp;
    case 'moderator':
      return c.distinguished === 'moderator';
    case 'admin':
      return c.distinguished === 'admin';
    case 'friend':
      return !!author && sets.friends.has(author);
    case 'tagged':
      return !!author && sets.tagged.has(author);
    case 'popular':
      return sets.isPopular ? sets.isPopular(c) : c.score !== null && c.score >= sets.popularScore;
    case 'highlighted':
      return !!author && !!sets.highlighted?.has(author);
    case 'upvoted':
      return !!sets.upvoted?.(c);
    case 'custom':
      return !!sets.custom?.(c);
    case 'new':
      return sets.isNew(c);
  }
}

/**
 * "3/12": where the last comment the navigator landed on sits among the matches. A leading "~"
 * means the reader has moved elsewhere since (clicking the label jumps back); "none" when empty.
 */
export function positionLabel(
  matchIds: readonly string[],
  lastId: string | null,
  selectedId: string | null,
): string {
  if (!matchIds.length) return 'none';
  const at = lastId === null ? -1 : matchIds.indexOf(lastId);
  const moved = at >= 0 && selectedId !== lastId ? '~' : '';
  return `${moved}${at + 1}/${matchIds.length}`;
}

export interface NavItem {
  id: string;
  match: boolean;
}

/**
 * The id the next (+1) or previous (-1) step lands on, wrapping around the ends. `items` is in
 * document order; a current id that is not in it (a post, or nothing selected) starts from the top
 * going forward and from the bottom going back. Null when no other item matches.
 */
export function stepTarget(
  items: readonly NavItem[],
  currentId: string | null,
  delta: 1 | -1,
): string | null {
  const n = items.length;
  if (!n) return null;
  const at = currentId === null ? -1 : items.findIndex((i) => i.id === currentId);
  const start = at === -1 ? (delta === 1 ? -1 : n) : at;
  for (let step = 1; step <= n; step++) {
    const item = items[(((start + delta * step) % n) + n) % n]!;
    if (item.id === currentId) continue;
    if (item.match) return item.id;
  }
  return null;
}
