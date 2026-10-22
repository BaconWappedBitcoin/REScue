/**
 * Read-only client for the few same-origin Reddit JSON endpoints REScue may use (constitution
 * Principle V, research R20 item 4; the paths are in C.json). It exists so every feature gets the
 * same safety rules instead of each rolling its own:
 *
 * - GET only, enforced here: there is no way to pass a method, a body or a path of your own.
 * - Every request goes through net.ts (same origin, the reader's own session, no oauth host).
 * - Every response is shape-checked. A mismatch is a visible warning, never a silent empty list.
 * - At most one request per second per endpoint, a small cache, and one request in flight per key.
 * - A kill switch, and says so once per pause: HTTP 403, or an HTML page where JSON was expected,
 *   pauses reads from THAT endpoint for ten minutes (one address Reddit stops serving must not stop
 *   the others); HTTP 429 (rate limit) pauses ALL reads for ten minutes.
 */
import { C } from '../contracts/reddit';
import { BlockedRequestError, netFetch } from './net';
import { PARSERS, type JsonData, type JsonEndpoint, type JsonParams } from './redditJsonParse';
import type { NoticeApi } from './types';

export type {
  BlockedResult,
  CommentsResult,
  FeedsResult,
  InfoComment,
  InfoPost,
  InfoResult,
  JsonData,
  JsonEndpoint,
  JsonParams,
  MeResult,
  MineResult,
  MineSub,
  MultiFeed,
  ThreadComment,
} from './redditJsonParse';

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
  multis: 60 * 60_000,
};

// --- request building ----------------------------------------------------------------------

// Reddit's ids have grown (live 2026-10-21: comment t1_19rfviy114w00, 13 characters), so allow
// up to 16 for posts and comments alike.
const INFO_FULLNAME = /^(?:t3_|t1_)[a-z0-9]{1,16}$/i;
const POST_ID = /^(?:t3_)?([a-z0-9]{1,16})$/i;
const COMMENT_ID = /^(?:t1_)?([a-z0-9]{1,16})$/i;
const AFTER = /^t5_[a-z0-9]{1,12}$/i;
/** The most ids one `info` call took. `info` is retired (C.json); nothing calls it. */
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
      if (!ids.every((i) => typeof i === 'string' && INFO_FULLNAME.test(i))) return null;
      q.set('id', ids.join(','));
      return `${base}?${q}`;
    }
    case 'comments': {
      if (!only('id', 'comment', 'limit', 'depth')) return null;
      const m = typeof p.id === 'string' ? POST_ID.exec(p.id) : null;
      if (!m) return null;
      let thread = m[1]!.toLowerCase();
      if (p.comment !== undefined) {
        // One comment's own thread: /comments/<post>/_/<comment>.json (the "_" stands for the slug).
        const c = typeof p.comment === 'string' ? COMMENT_ID.exec(p.comment) : null;
        if (!c) return null;
        thread += `/_/${c[1]!.toLowerCase()}`;
      }
      for (const [k, lo] of [
        ['limit', 1],
        ['depth', 0],
      ] as const) {
        if (p[k] === undefined) continue;
        const n = int(p[k], lo, 500);
        if (n === null) return null;
        q.set(k, String(n));
      }
      return `${base.replace('{id}', thread)}?${q}`;
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
  /** Every read pauses until then (HTTP 429: Reddit's rate limit is for the whole session). */
  private backoffUntil = 0;
  /** One endpoint's reads pause until then (HTTP 403 or a web page from that endpoint). */
  private readonly endpointBackoff = new Map<JsonEndpoint, number>();
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
    this.endpointBackoff.clear();
  }

  /**
   * When reads resume, or 0 when not paused. Without an endpoint: the pause of every read (429).
   * With one: the later of that and the endpoint's own pause (403 or a web page).
   */
  pausedUntil(endpoint?: JsonEndpoint): number {
    const t = this.now();
    const all = this.backoffUntil > t ? this.backoffUntil : 0;
    const own = endpoint ? (this.endpointBackoff.get(endpoint) ?? 0) : 0;
    return Math.max(all, own > t ? own : 0);
  }

  /** Endpoints whose reads are paused on their own (403 or a web page), not counting a 429 pause. */
  pausedEndpoints(): JsonEndpoint[] {
    const t = this.now();
    return [...this.endpointBackoff].filter(([, until]) => until > t).map(([e]) => e);
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
    const until = this.pausedUntil(endpoint);
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

  /**
   * Pause reads for ten minutes: every endpoint when `endpoint` is null (429), else that one only.
   * The notice is shown once per pause: a request already in flight that is refused as well while
   * the pause stands only keeps it.
   */
  private trip(opts: JsonCallOptions, endpoint: JsonEndpoint | null, why: string): void {
    const t = this.now();
    const was = endpoint ? (this.endpointBackoff.get(endpoint) ?? 0) : this.backoffUntil;
    const until = t + BACKOFF_MS;
    if (endpoint) this.endpointBackoff.set(endpoint, until);
    else this.backoffUntil = until;
    if (was > t) return;
    const what = endpoint ? `Reddit for ${C.json[endpoint]}` : 'Reddit';
    opts.notify?.(
      `REScue: ${why} REScue stops asking ${what} for 10 minutes (until ${clock(until)}). Reddit itself is not affected.`,
      'warning',
      endpoint ? `json-paused-${endpoint}` : 'json-paused',
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
    const until = this.pausedUntil(endpoint);
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
      const scope = res.status === 429 ? null : endpoint;
      this.trip(opts, scope, `Reddit answered ${res.status} to a read-only request.`);
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
      this.trip(
        opts,
        endpoint,
        'Reddit answered with a web page instead of data (a login or block page).',
      );
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

/** The client every module shares, so the rate limit and the pauses apply across features. */
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

/**
 * For a module's `health()`: degraded while all reads are paused (`json.paused`), or while an
 * endpoint is paused on its own or its last answer had a new shape (`json.<endpoint>`).
 */
export function jsonHealth(client: RedditJsonClient = sharedJsonClient): {
  status: 'ok' | 'degraded';
  failingContracts: string[];
} {
  const failing = [...new Set([...client.brokenEndpoints(), ...client.pausedEndpoints()])].map(
    (e) => `json.${e}`,
  );
  if (client.pausedUntil()) failing.push('json.paused');
  return { status: failing.length ? 'degraded' : 'ok', failingContracts: failing };
}
