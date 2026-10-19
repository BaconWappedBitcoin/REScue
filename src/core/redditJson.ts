/**
 * Read-only client for the few same-origin Reddit JSON endpoints REScue may use (constitution
 * Principle V, research R20 item 4; the paths are in C.json). It exists so every feature gets the
 * same safety rules instead of each rolling its own:
 *
 * - GET only, enforced here: there is no way to pass a method, a body or a path of your own.
 * - Every request goes through net.ts (same origin, the reader's own session, no oauth host).
 * - Every response is shape-checked. A mismatch is a visible warning, never a silent empty list.
 * - At most one request per second per endpoint, a small cache, and one request in flight per key.
 * - A kill switch: HTTP 403 or 429, or an HTML page where JSON was expected, pauses ALL reads for
 *   ten minutes and says so.
 */
import { C } from '../contracts/reddit';
import { BlockedRequestError, netFetch } from './net';
import type { NoticeApi } from './types';

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
}
export interface InfoResult {
  posts: InfoPost[];
}

export interface CommentsResult {
  post: InfoPost;
  comments: Array<{
    id: string;
    controversiality: number;
    gilded: number;
    scoreHidden: boolean;
    score: number | null;
  }>;
}

export interface MeResult {
  signedIn: boolean;
  name: string | null;
}
export interface BlockedResult {
  names: string[];
}

interface Endpoints {
  mine: { params: { limit?: number; after?: string }; data: MineResult };
  info: { params: { id: string | string[] }; data: InfoResult };
  comments: { params: { id: string; limit?: number; depth?: number }; data: CommentsResult };
  me: { params: Record<string, never>; data: MeResult };
  blocked: { params: Record<string, never>; data: BlockedResult };
}
export type JsonParams<K extends JsonEndpoint> = Endpoints[K]['params'];
export type JsonData<K extends JsonEndpoint> = Endpoints[K]['data'];

export type JsonFailure = 'params' | 'backoff' | 'blocked' | 'network' | 'http' | 'html' | 'shape';
export type JsonResult<K extends JsonEndpoint> =
  | { ok: true; data: JsonData<K>; cached: boolean }
  | { ok: false; reason: JsonFailure; message: string };

export interface JsonCallOptions {
  /** How long a cached answer for the same request may be reused. */
  ttlMs?: number;
  /** Skip the cache and ask Reddit again. */
  fresh?: boolean;
  /** Told about things the reader should know (a pause, a changed format). */
  notify?: (message: string, kind: 'warning' | 'error', id: string) => void;
}

/** The slice of a Response this file reads (tests supply a stand-in). */
export interface JsonResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}
export interface JsonDeps {
  fetchJson?: (url: string, init: RequestInit) => Promise<JsonResponse>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const MIN_GAP_MS = 1000;
export const BACKOFF_MS = 10 * 60_000;
const MAX_CACHE = 60;
const DEFAULT_TTL: Record<JsonEndpoint, number> = {
  mine: 60 * 60_000,
  info: 60_000,
  comments: 60_000,
  me: 5 * 60_000,
  blocked: 5 * 60_000,
};

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
  };
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

const PARSERS: { [K in JsonEndpoint]: (raw: unknown) => JsonData<K> | null } = {
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
    for (const c of l.children) {
      const d = childData(c);
      if (!d) return null;
      if (isObj(c) && c.kind !== 't3') continue;
      const p = postFrom(d);
      if (!p) return null;
      posts.push(p);
    }
    return { posts };
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
};

// --- request building ----------------------------------------------------------------------

const POST_FULLNAME = /^t3_[a-z0-9]{1,10}$/i;
const POST_ID = /^(?:t3_)?([a-z0-9]{1,10})$/i;
const AFTER = /^t5_[a-z0-9]{1,12}$/i;
export const INFO_MAX_IDS = 100;

/** The path and query for a call, or null when the parameters are not acceptable. */
export function buildRequest(endpoint: JsonEndpoint, params: object): string | null {
  const p = params as Record<string, unknown>;
  const base: string = C.json[endpoint];
  const q = new URLSearchParams({ raw_json: '1' });
  const only = (...allowed: string[]) => Object.keys(p).every((k) => allowed.includes(k));
  const int = (v: unknown, lo: number, hi: number): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

  switch (endpoint) {
    case 'mine': {
      if (!only('limit', 'after')) return null;
      if (p.limit !== undefined) {
        const n = int(p.limit, 1, 100);
        if (n === null) return null;
        q.set('limit', String(n));
      }
      if (p.after !== undefined) {
        if (typeof p.after !== 'string' || !AFTER.test(p.after)) return null;
        q.set('after', p.after);
      }
      return `${base}?${q}`;
    }
    case 'info': {
      if (!only('id')) return null;
      const ids = Array.isArray(p.id) ? p.id : typeof p.id === 'string' ? p.id.split(',') : [];
      if (!ids.length || ids.length > INFO_MAX_IDS) return null;
      if (!ids.every((i) => typeof i === 'string' && POST_FULLNAME.test(i))) return null;
      q.set('id', ids.join(','));
      return `${base}?${q}`;
    }
    case 'comments': {
      if (!only('id', 'limit', 'depth')) return null;
      const m = typeof p.id === 'string' ? POST_ID.exec(p.id) : null;
      if (!m) return null;
      for (const k of ['limit', 'depth'] as const) {
        if (p[k] === undefined) continue;
        const n = int(p[k], 1, 500);
        if (n === null) return null;
        q.set(k, String(n));
      }
      return `${base.replace('{id}', m[1]!.toLowerCase())}?${q}`;
    }
    default:
      return only() ? `${base}?${q}` : null;
  }
}

/** The one place a method is chosen. Anything but GET is refused before it can leave. */
export function readOnlyInit(): RequestInit {
  const init: RequestInit = {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'include',
  };
  if (init.method !== 'GET') throw new Error('REScue only reads from Reddit');
  return init;
}

// --- the client ----------------------------------------------------------------------------

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export class RedditJsonClient {
  private readonly nextFree = new Map<JsonEndpoint, number>();
  private readonly cache = new Map<string, { at: number; data: unknown }>();
  private readonly inflight = new Map<string, Promise<JsonResult<JsonEndpoint>>>();
  private backoffUntil = 0;
  private readonly shapeFailures = new Set<JsonEndpoint>();
  private readonly fetchJson: NonNullable<JsonDeps['fetchJson']>;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: JsonDeps = {}) {
    this.fetchJson = deps.fetchJson ?? ((url, init) => netFetch(url, init));
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Forget the cache, the pause and the pacing (a fresh start; tests use it). */
  reset(): void {
    this.cache.clear();
    this.inflight.clear();
    this.nextFree.clear();
    this.shapeFailures.clear();
    this.backoffUntil = 0;
  }

  /** When reads resume after a 403/429/HTML pause, or 0 when not paused. */
  pausedUntil(): number {
    return this.backoffUntil > this.now() ? this.backoffUntil : 0;
  }

  /** Endpoints whose last answer did not have the expected shape. */
  brokenEndpoints(): JsonEndpoint[] {
    return [...this.shapeFailures];
  }

  async get<K extends JsonEndpoint>(
    endpoint: K,
    params: JsonParams<K>,
    opts: JsonCallOptions = {},
  ): Promise<JsonResult<K>> {
    const target = Object.prototype.hasOwnProperty.call(C.json, endpoint)
      ? buildRequest(endpoint, params)
      : null;
    if (!target) {
      return { ok: false, reason: 'params', message: `REScue: bad request for ${endpoint}.` };
    }
    const until = this.pausedUntil();
    if (until) return this.paused(until);

    const key = `${endpoint}|${target}`;
    const ttl = opts.ttlMs ?? DEFAULT_TTL[endpoint];
    const hit = this.cache.get(key);
    if (hit && !opts.fresh && this.now() - hit.at < ttl) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return { ok: true, data: hit.data as JsonData<K>, cached: true };
    }
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<JsonResult<K>>;

    const run = this.fetchOnce(endpoint, target, key, opts).finally(() =>
      this.inflight.delete(key),
    );
    this.inflight.set(key, run as Promise<JsonResult<JsonEndpoint>>);
    return run;
  }

  private paused<K extends JsonEndpoint>(until: number): JsonResult<K> {
    return {
      ok: false,
      reason: 'backoff',
      message: `REScue paused its reads from Reddit until ${clock(until)} because Reddit refused one.`,
    };
  }

  private trip(opts: JsonCallOptions, why: string): void {
    this.backoffUntil = this.now() + BACKOFF_MS;
    opts.notify?.(
      `REScue: ${why} REScue stops asking Reddit for 10 minutes (until ${clock(this.backoffUntil)}). Reddit itself is not affected.`,
      'warning',
      'json-paused',
    );
  }

  private async fetchOnce<K extends JsonEndpoint>(
    endpoint: K,
    target: string,
    key: string,
    opts: JsonCallOptions,
  ): Promise<JsonResult<K>> {
    // At most one request a second per endpoint: reserve the next free slot, then wait for it.
    const t = this.now();
    const slot = Math.max(t, this.nextFree.get(endpoint) ?? 0);
    this.nextFree.set(endpoint, slot + MIN_GAP_MS);
    if (slot > t) await this.sleep(slot - t);
    const until = this.pausedUntil();
    if (until) return this.paused(until);

    let res: JsonResponse;
    try {
      res = await this.fetchJson(target, readOnlyInit());
    } catch (err) {
      const blocked = err instanceof BlockedRequestError;
      return {
        ok: false,
        reason: blocked ? 'blocked' : 'network',
        message: 'Could not reach Reddit.',
      };
    }
    if (res.status === 403 || res.status === 429) {
      this.trip(opts, `Reddit answered ${res.status} to a read-only request.`);
      return { ok: false, reason: 'http', message: `Reddit answered ${res.status}.` };
    }
    if (!res.ok) {
      return { ok: false, reason: 'http', message: `Reddit answered ${res.status}.` };
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      return { ok: false, reason: 'network', message: 'Could not read the answer from Reddit.' };
    }
    const type = res.headers.get('content-type') ?? '';
    if (/html/i.test(type) || text.trimStart().startsWith('<')) {
      this.trip(opts, 'Reddit answered with a web page instead of data (a login or block page).');
      return { ok: false, reason: 'html', message: 'Reddit answered with a web page.' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return this.badShape(endpoint, opts);
    }
    const parse = PARSERS[endpoint] as (raw: unknown) => JsonData<K> | null;
    const data = parse(parsed);
    if (!data) return this.badShape(endpoint, opts);
    this.shapeFailures.delete(endpoint);
    this.store(key, data);
    return { ok: true, data, cached: false };
  }

  private badShape<K extends JsonEndpoint>(endpoint: K, opts: JsonCallOptions): JsonResult<K> {
    this.shapeFailures.add(endpoint);
    opts.notify?.(
      `REScue: Reddit's ${C.json[endpoint]} data is not in the expected format, so the feature that uses it is off until REScue is updated.`,
      'warning',
      `json-shape-${endpoint}`,
    );
    return { ok: false, reason: 'shape', message: 'Reddit sent data in an unexpected format.' };
  }

  private store(key: string, data: unknown): void {
    this.cache.delete(key);
    this.cache.set(key, { at: this.now(), data });
    while (this.cache.size > MAX_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}

/** The client every module shares, so the rate limit and the pause apply across features. */
export const sharedJsonClient = new RedditJsonClient();

export function getJson<K extends JsonEndpoint>(
  endpoint: K,
  params: JsonParams<K>,
  opts?: JsonCallOptions,
): Promise<JsonResult<K>> {
  return sharedJsonClient.get(endpoint, params, opts);
}

export type BoundGetJson = <K extends JsonEndpoint>(
  endpoint: K,
  params: JsonParams<K>,
  opts?: JsonCallOptions,
) => Promise<JsonResult<K>>;

/** `getJson` that reports through a module's notices (the "module health notice"). */
export function jsonFor(
  notices: NoticeApi,
  moduleId: string,
  client: RedditJsonClient = sharedJsonClient,
): BoundGetJson {
  return (endpoint, params, opts = {}) =>
    client.get(endpoint, params, {
      notify: (message, kind, id) =>
        notices.show(message, { kind, id, moduleId, type: id, cooldownMs: 60_000 }),
      ...opts,
    });
}

/** For a module's `health()`: degraded while reads are paused or an answer had a new shape. */
export function jsonHealth(client: RedditJsonClient = sharedJsonClient): {
  status: 'ok' | 'degraded';
  failingContracts: string[];
} {
  const failing = client.brokenEndpoints().map((e) => `json.${e}`);
  if (client.pausedUntil()) failing.push('json.paused');
  return { status: failing.length ? 'degraded' : 'ok', failingContracts: failing };
}
