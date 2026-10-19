/**
 * Pure logic for the `savedComments` storage key (contracts/storage-schema.md): a record keyed by
 * comment id holding a TEXT snapshot, so a saved comment survives the original being edited or
 * deleted. Nothing prunes it; a comment stays saved until the reader removes it.
 */
import { ownBody } from '../../model/access';
import type { Comment } from '../../model/types';

export interface SavedComment {
  commentId: string;
  /** Path or URL of the comment's own page. */
  permalink: string;
  author: string;
  subreddit: string;
  /** Plain text of the comment when it was saved (never markup). */
  bodyText: string;
  savedAt: number;
}

export type SavedMap = Record<string, SavedComment>;

export const BODY_MAX = 10_000;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

export function sanitizeSaved(raw: unknown): SavedMap {
  const out: SavedMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    out[id] = {
      commentId: id,
      permalink: str(r.permalink, 500),
      author: str(r.author, 100),
      subreddit: str(r.subreddit, 100),
      bodyText: str(r.bodyText, BODY_MAX),
      savedAt: typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : 0,
    };
  }
  return out;
}

/** `/r/<name>/comments/...` -> name. */
export function subredditFromPermalink(permalink: string | null | undefined): string {
  return /\/r\/([A-Za-z0-9_]+)\//.exec(permalink ?? '')?.[1] ?? '';
}

/** The comment's own text: paragraphs separated by a blank line. */
export function bodyTextOf(c: Comment): string {
  const body = ownBody(c.source);
  if (!body) return '';
  const paras = [...body.querySelectorAll('p')]
    .map((p) => (p.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const text = paras.length ? paras.join('\n\n') : (body.textContent ?? '').replace(/\s+/g, ' ');
  return text.trim().slice(0, BODY_MAX);
}

export function snapshotOf(c: Comment, fallbackPath: string, now: number): SavedComment {
  const permalink = c.permalink ?? fallbackPath;
  return {
    commentId: c.id,
    permalink,
    author: c.author ?? '[deleted]',
    subreddit: subredditFromPermalink(permalink) || subredditFromPermalink(fallbackPath),
    bodyText: bodyTextOf(c),
    savedAt: now,
  };
}

export function withSaved(map: SavedMap, snap: SavedComment): SavedMap {
  return { ...map, [snap.commentId]: snap };
}

export function withoutSaved(map: SavedMap, id: string): SavedMap {
  const { [id]: _gone, ...rest } = map;
  return rest;
}

/** Newest first. */
export function savedList(map: SavedMap): SavedComment[] {
  return Object.values(map).sort((a, b) => b.savedAt - a.savedAt);
}
