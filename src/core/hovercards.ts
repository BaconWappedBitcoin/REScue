/**
 * User and community hover-card data from Reddit's own same-origin hovercard partials
 * (research R4/R5). Parsed with DOMParser (scripts never run), cached 30 min, LRU 500 entries,
 * one request in flight per name, 5-minute global back-off on 429/5xx/network errors.
 */
import { C } from '../contracts/reddit';
import { netFetch } from './net';
import { parseDate, parseNumber } from './dom';

export interface UserCard {
  username: string;
  found: boolean;
  displayName?: string;
  cakeDay?: Date;
  postKarma?: number;
  commentKarma?: number;
  verified?: boolean;
}

export interface CommunityCard {
  name: string;
  found: boolean;
  description?: string;
  weeklyVisitors?: number;
  weeklyContributions?: number;
}

export type HoverResult<T> =
  { state: 'ready'; card: T } | { state: 'notFound'; card: T } | { state: 'unavailable' };

const H = C.hover;
const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;
const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

/**
 * Label pairing: climb from a value element to the nearest ancestor holding exactly one value,
 * and return that ancestor's text. The caller matches the label, so a reordered or relabelled
 * card yields undefined instead of a mislabelled number.
 */
function labelFor(valueEl: Element, valueSel: string): string {
  let anc: Element | null = valueEl.parentElement;
  for (let i = 0; anc && i < 4; i++, anc = anc.parentElement) {
    if (anc.querySelectorAll(valueSel).length > 1) break;
    const text = (anc.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length > (valueEl.textContent ?? '').trim().length) return text;
  }
  return '';
}

function pairedNumber(
  root: ParentNode,
  valueSel: string,
  label: RegExp,
  read: (el: Element) => string | null,
): number | undefined {
  for (const el of root.querySelectorAll(valueSel)) {
    if (label.test(labelFor(el, valueSel))) return parseNumber(read(el)) ?? undefined;
  }
  return undefined;
}

export function parseUserCard(username: string, html: string): UserCard {
  const card = parse(html).querySelector(H.userCard);
  if (!card) return { username, found: false };
  const cake = parseDate(card.querySelector(H.cakeDay)?.getAttribute('datetime'));
  const name = card.querySelector(H.nameplate)?.textContent?.replace(/\s+/g, ' ').trim();
  const out: UserCard = { username, found: true };
  if (name) out.displayName = name;
  if (cake) out.cakeDay = cake;
  const text = (el: Element) => el.textContent;
  const pk = pairedNumber(card, H.karma, H.postKarmaLabel, text);
  const ck = pairedNumber(card, H.karma, H.commentKarmaLabel, text);
  if (pk !== undefined) out.postKarma = pk;
  if (ck !== undefined) out.commentKarma = ck;
  out.verified = !!card.querySelector(H.verified);
  return out;
}

export function parseCommunityCard(name: string, html: string): CommunityCard {
  const doc = parse(html);
  const numberAttr = (el: Element) => el.getAttribute(H.communityNumberAttr);
  const weeklyVisitors = pairedNumber(doc, H.communityNumber, H.weeklyVisitorsLabel, numberAttr);
  const weeklyContributions = pairedNumber(
    doc,
    H.communityNumber,
    H.weeklyContributionsLabel,
    numberAttr,
  );
  const description = doc.querySelector('p')?.textContent?.replace(/\s+/g, ' ').trim();
  const found = weeklyVisitors !== undefined || weeklyContributions !== undefined || !!description;
  const out: CommunityCard = { name, found };
  if (description) out.description = description;
  if (weeklyVisitors !== undefined) out.weeklyVisitors = weeklyVisitors;
  if (weeklyContributions !== undefined) out.weeklyContributions = weeklyContributions;
  return out;
}

interface FetchResult {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface HovercardDeps {
  fetchText?: (url: string, init: RequestInit) => Promise<FetchResult>;
  now?: () => number;
  maxEntries?: number;
}

const TTL_MS = 30 * 60_000;
const BACKOFF_MS = 5 * 60_000;

export class HovercardService {
  private readonly cache = new Map<string, { at: number; result: HoverResult<unknown> }>();
  private readonly inflight = new Map<string, Promise<HoverResult<unknown>>>();
  private backoffUntil = 0;
  private readonly fetchText: NonNullable<HovercardDeps['fetchText']>;
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(deps: HovercardDeps = {}) {
    this.fetchText = deps.fetchText ?? ((url, init) => netFetch(url, init));
    this.now = deps.now ?? Date.now;
    this.maxEntries = deps.maxEntries ?? 500;
  }

  size(): number {
    return this.cache.size;
  }

  user(username: string): Promise<HoverResult<UserCard>> {
    if (!USERNAME.test(username)) return Promise.resolve({ state: 'unavailable' });
    return this.lookup(
      `u:${username.toLowerCase()}`,
      H.userEndpoint + encodeURIComponent(username),
      (html) => parseUserCard(username, html),
    ) as Promise<HoverResult<UserCard>>;
  }

  community(name: string): Promise<HoverResult<CommunityCard>> {
    if (!SUBREDDIT.test(name)) return Promise.resolve({ state: 'unavailable' });
    return this.lookup(
      `r:${name.toLowerCase()}`,
      H.communityEndpoint + encodeURIComponent(name),
      (html) => parseCommunityCard(name, html),
    ) as Promise<HoverResult<CommunityCard>>;
  }

  private lookup<T extends { found: boolean }>(
    key: string,
    url: string,
    parser: (html: string) => T,
  ): Promise<HoverResult<unknown>> {
    const t = this.now();
    const hit = this.cache.get(key);
    if (hit && t - hit.at < TTL_MS) {
      this.cache.delete(key); // refresh LRU position
      this.cache.set(key, hit);
      return Promise.resolve(hit.result);
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;
    if (t < this.backoffUntil) return Promise.resolve({ state: 'unavailable' });

    const p = (async (): Promise<HoverResult<unknown>> => {
      try {
        const res = await this.fetchText(url, {
          headers: { Accept: H.accept },
          credentials: 'include',
        });
        if (res.status === 429 || res.status >= 500 || !res.ok) {
          if (res.status === 429 || res.status >= 500) this.backoffUntil = this.now() + BACKOFF_MS;
          return { state: 'unavailable' };
        }
        const card = parser(await res.text());
        const result: HoverResult<T> = card.found
          ? { state: 'ready', card }
          : { state: 'notFound', card };
        this.store(key, result);
        return result;
      } catch {
        this.backoffUntil = this.now() + BACKOFF_MS;
        return { state: 'unavailable' };
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  private store(key: string, result: HoverResult<unknown>): void {
    this.cache.delete(key);
    this.cache.set(key, { at: this.now(), result });
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
