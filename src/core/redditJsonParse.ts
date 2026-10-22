/**
 * The shapes REScue expects from Reddit's same-origin JSON endpoints, and the checks that read
 * them (split out of redditJson.ts, which does the requests). A parser returns null when the
 * answer does not have the expected shape; the client turns that into a visible warning.
 */
import type { C } from '../contracts/reddit';

export type JsonEndpoint = keyof typeof C.json;

export interface MineSub {
  /** `display_name`, e.g. "aww" (or "u_name" for a profile). */
  name: string;
  /** `display_name_prefixed`, e.g. "r/aww" or "u/name". */
  prefixed: string;
  url: string;
  over18: boolean;
  subscribers: number | null;
}
export interface MineResult {
  subs: MineSub[];
  /** The `after` cursor for the next page, or null on the last page. */
  after: string | null;
}

export interface InfoPost {
  /** Full name, e.g. "t3_abc123". */
  id: string;
  title: string | null;
  numComments: number;
  locked: boolean;
  saved: boolean;
  hidden: boolean;
  /** true = upvoted, false = downvoted, null = no vote. */
  likes: boolean | null;
  score: number | null;
  /** The picture's original pixels (width, height) from `preview.images[0].source`, when it has one. */
  sourceSize?: readonly [number, number];
  /** The post's own text as raw Markdown (`selftext`; "" for a link post), when Reddit sent it. */
  selftext?: string;
  /** When the post was last edited (ms since 1970); absent when it was not (or Reddit said nothing). */
  edited?: number;
}
/** A comment from the retired `info` endpoint (kept for the shape; nothing asks it any more). */
export interface InfoComment {
  /** Full name, e.g. "t1_abc123". */
  id: string;
  /** The comment's raw Markdown (`body`; every request asks raw_json=1), or null if Reddit sent none. */
  body: string | null;
}
export interface InfoResult {
  posts: InfoPost[];
  comments: InfoComment[];
}

/** One comment from a thread's JSON (`/comments/<post>.json` or one comment's own thread). */
export interface ThreadComment {
  /** Full name, e.g. "t1_abc123". */
  id: string;
  controversiality: number;
  gilded: number;
  scoreHidden: boolean;
  score: number | null;
  /** The comment's raw Markdown (`body`; every request asks raw_json=1), or null if Reddit sent none. */
  body: string | null;
  /** When the comment was last edited (ms since 1970), or null when it was not. */
  edited: number | null;
}
export interface CommentsResult {
  post: InfoPost;
  comments: ThreadComment[];
}

export interface MeResult {
  signedIn: boolean;
  name: string | null;
}
export interface BlockedResult {
  names: string[];
}
export interface MultiFeed {
  /** `display_name`, e.g. "News". */
  name: string;
  /** The feed's own page, always `/user/<name>/m/<feed>/` with a trailing slash. */
  path: string;
}
export interface FeedsResult {
  feeds: MultiFeed[];
}

export interface Endpoints {
  mine: { params: { limit?: number; after?: string }; data: MineResult };
  info: { params: { id: string | string[] }; data: InfoResult };
  comments: {
    /**
     * `id` is the post (with or without `t3_`). With `comment` (with or without `t1_`) the answer
     * is that one comment's thread (`/comments/<post>/_/<comment>.json`), the comment first.
     */
    params: { id: string; comment?: string; limit?: number; depth?: number };
    data: CommentsResult;
  };
  me: { params: Record<string, never>; data: MeResult };
  blocked: { params: Record<string, never>; data: BlockedResult };
  multis: { params: Record<string, never>; data: FeedsResult };
}
export type JsonParams<K extends JsonEndpoint> = Endpoints[K]['params'];
export type JsonData<K extends JsonEndpoint> = Endpoints[K]['data'];

// --- shape checks --------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const numOr = (v: unknown, d: number): number => (typeof v === 'number' && isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

/** The children of a Listing (`{kind:'Listing', data:{children:[…]}}`), or null if it is not one. */
function listing(v: unknown): { children: unknown[]; after: string | null } | null {
  if (!isObj(v) || !isObj(v.data) || !Array.isArray(v.data.children)) return null;
  return { children: v.data.children, after: str(v.data.after) };
}
const childData = (c: unknown): Obj | null => (isObj(c) && isObj(c.data) ? c.data : null);

function postFrom(d: Obj): InfoPost | null {
  const id = str(d.name);
  if (!id || typeof d.num_comments !== 'number') return null;
  const edited = editedOf(d.edited);
  return {
    id,
    title: str(d.title),
    numComments: d.num_comments,
    locked: d.locked === true,
    saved: d.saved === true,
    hidden: d.hidden === true,
    likes: typeof d.likes === 'boolean' ? d.likes : null,
    score: numOrNull(d.score),
    ...sourceSizeOf(d),
    ...(typeof d.selftext === 'string' ? { selftext: d.selftext } : {}),
    ...(edited !== null ? { edited } : {}),
  };
}

/** Reddit's `edited`: false, or the edit time in seconds since 1970. As ms, or null. */
function editedOf(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) && v > 0 ? Math.round(v * 1000) : null;
}

/** The original picture size Reddit lists for a post, as `{ sourceSize }`, or nothing. */
function sourceSizeOf(d: Obj): { sourceSize: readonly [number, number] } | Record<string, never> {
  const images = isObj(d.preview) ? d.preview.images : null;
  const src = Array.isArray(images) && isObj(images[0]) ? images[0].source : null;
  if (!isObj(src)) return {};
  const w = numOrNull(src.width);
  const h = numOrNull(src.height);
  return w && h && w > 0 && h > 0 ? { sourceSize: [w, h] as const } : {};
}

export const PARSERS: { [K in JsonEndpoint]: (raw: unknown) => JsonData<K> | null } = {
  mine(raw) {
    const l = listing(raw);
    if (!l) return null;
    const subs: MineSub[] = [];
    for (const c of l.children) {
      const d = childData(c);
      const name = d && str(d.display_name);
      if (!d || !name) return null;
      subs.push({
        name,
        prefixed: str(d.display_name_prefixed) ?? `r/${name}`,
        url: str(d.url) ?? `/r/${name}/`,
        over18: d.over18 === true,
        subscribers: numOrNull(d.subscribers),
      });
    }
    return { subs, after: l.after };
  },
  info(raw) {
    const l = listing(raw);
    if (!l) return null;
    const posts: InfoPost[] = [];
    const comments: InfoComment[] = [];
    for (const c of l.children) {
      const d = childData(c);
      if (!d) return null;
      const kind = isObj(c) ? c.kind : null;
      if (kind === 't1') {
        const id = str(d.name);
        if (!id) return null;
        comments.push({ id, body: typeof d.body === 'string' ? d.body : null });
        continue;
      }
      if (kind !== 't3') continue;
      const p = postFrom(d);
      if (!p) return null;
      posts.push(p);
    }
    return { posts, comments };
  },
  comments(raw) {
    if (!Array.isArray(raw) || raw.length < 1) return null;
    const first = listing(raw[0]);
    const d = first && childData(first.children[0]);
    const post = d && postFrom(d);
    if (!post) return null;
    const rest = raw[1] === undefined ? { children: [] } : listing(raw[1]);
    if (!rest) return null;
    const comments: CommentsResult['comments'] = [];
    for (const c of rest.children) {
      const cd = childData(c);
      if (!cd) return null;
      if (isObj(c) && c.kind !== 't1') continue;
      const id = str(cd.name);
      if (!id) return null;
      comments.push({
        id,
        controversiality: numOr(cd.controversiality, 0),
        gilded: numOr(cd.gilded, 0),
        scoreHidden: cd.score_hidden === true,
        score: numOrNull(cd.score),
        body: typeof cd.body === 'string' ? cd.body : null,
        edited: editedOf(cd.edited),
      });
    }
    return { post, comments };
  },
  me(raw) {
    if (!isObj(raw)) return null;
    const name = str(isObj(raw.data) ? raw.data.name : raw.name);
    return { signedIn: !!name, name };
  },
  blocked(raw) {
    const l = listing(raw);
    if (!l) return null;
    const names: string[] = [];
    for (const c of l.children) {
      const name = isObj(c) ? str(c.name) : null;
      if (!name) return null;
      names.push(name);
    }
    return { names };
  },
  multis(raw) {
    // A bare array of `{kind:'LabeledMulti', data:{display_name, path, …}}`; `path` has no
    // trailing slash. A feed whose path is not one of the reader's own feed pages is left out.
    if (!Array.isArray(raw)) return null;
    const feeds: MultiFeed[] = [];
    for (const c of raw) {
      const d = childData(c);
      if (!d) return null;
      const name = str(d.display_name) ?? str(d.name);
      const path = feedPath(d.path);
      if (name && path) feeds.push({ name, path });
    }
    return { feeds };
  },
};

const FEED_PATH = /^\/user\/[A-Za-z0-9_-]{1,40}\/m\/[A-Za-z0-9_]{1,64}\/$/;

/** A custom feed's path with a trailing slash, or null unless it is a same-origin `/user/…/m/…/`. */
export function feedPath(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const p = v.endsWith('/') ? v : `${v}/`;
  return FEED_PATH.test(p) ? p : null;
}
