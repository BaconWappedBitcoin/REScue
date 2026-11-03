/**
 * THE ONLY NETWORK ENTRY POINT (SC-006, constitution Principle IV). Lint bans fetch and
 * XMLHttpRequest everywhere else. The only allowed destination is the page's own Reddit origin
 * (hover-card partials and the read-only JSON endpoints in the contracts module, through
 * redditJson.ts), with the user's existing session. Every destination is listed in PRIVACY.md.
 * Every request is a GET without a body (anything else is refused before it leaves), and an
 * answer that was redirected to any other origin is thrown away unread.
 * The one exception is cloudFetch below: the opt-in cloud sync, from the background only, to the
 * storage provider the user connected (also listed in PRIVACY.md).
 */
const REDDIT_ORIGIN = /^https:\/\/(www\.|sh\.)?reddit\.com$/;

export type Destination = 'same-origin' | 'blocked';

export function classify(
  url: string,
  pageOrigin: string = location.origin,
): { url: URL; dest: Destination } {
  const u = new URL(url, pageOrigin);
  if (u.protocol === 'https:' && u.origin === pageOrigin && REDDIT_ORIGIN.test(pageOrigin))
    return { url: u, dest: 'same-origin' };
  return { url: u, dest: 'blocked' };
}

export class BlockedRequestError extends Error {}

/** Data files shipped inside the extension (copied by wxt.config.ts), by name. */
export type BundledFile = 'neutrality-scores.json';

/**
 * Read one of the extension's own bundled data files. This is not a network request: the address
 * is the extension's own origin, the name must be on the list above, and nothing leaves the device.
 * Background only (a page cannot read it, because the file is not web-accessible).
 */
export async function readBundledJson(file: BundledFile): Promise<unknown> {
  const res = await fetch(browser.runtime.getURL(`/${file}` as never));
  if (!res.ok) throw new Error(`bundled file ${file}: HTTP ${res.status}`);
  return res.json();
}

/**
 * The cloud sync path (opt-in "Sync across browsers", src/core/cloudSync/): a SEPARATE, narrow
 * gate used only by extension contexts (the background). Content scripts run on a Reddit page, so
 * their `location` is https://…reddit.com and every call from them is refused before it leaves.
 * Allowed: HTTPS to the exact provider API hosts in src/contracts/cloud.ts, never with cookies,
 * never following a redirect. A OneDrive pre-authenticated download URL (a few provider-owned host
 * suffixes) is allowed only as a plain GET without an Authorization header. The Reddit rule above
 * is not touched by any of this. Addresses are logged by host name only (never path or query).
 */
const EXTENSION_PROTOCOLS = new Set(['chrome-extension:', 'moz-extension:']);

export function classifyCloud(
  url: string,
  init: RequestInit,
  contextProtocol: string,
  hosts: readonly string[],
  downloadSuffixes: readonly string[],
): 'api' | 'download' | 'blocked' {
  if (!EXTENSION_PROTOCOLS.has(contextProtocol)) return 'blocked';
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'blocked';
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return 'blocked';
  if (hosts.includes(u.hostname)) return 'api';
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (
    method === 'GET' &&
    init.body == null &&
    !headers.has('authorization') &&
    downloadSuffixes.some((s) => u.hostname.endsWith(s) && u.hostname.length > s.length)
  )
    return 'download';
  return 'blocked';
}

export interface CloudGate {
  hosts: readonly string[];
  downloadSuffixes: readonly string[];
  /** The calling context's protocol; defaults to this context's own `location`. */
  contextProtocol?: string;
}

export async function cloudFetch(
  url: string,
  init: RequestInit,
  gate: CloudGate,
): Promise<Response> {
  const proto = gate.contextProtocol ?? globalThis.location?.protocol ?? '';
  const kind = classifyCloud(url, init, proto, gate.hosts, gate.downloadSuffixes);
  if (kind === 'blocked') {
    let host = '?';
    try {
      host = new URL(url).hostname;
    } catch {
      /* not an address */
    }
    console.error('[REScue] cloud sync blocked a request to', host);
    throw new BlockedRequestError(`REScue cloud sync does not contact ${host}`);
  }
  return fetch(url, { ...init, credentials: 'omit', redirect: 'error', cache: 'no-store' });
}

export async function netFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const { url: u, dest } = classify(url);
  if (dest === 'blocked') {
    console.error('[REScue] blocked request to', u.href);
    throw new BlockedRequestError(`REScue does not contact ${u.hostname}`);
  }
  if ((init.method ?? 'GET').toUpperCase() !== 'GET' || init.body != null) {
    throw new BlockedRequestError('REScue only reads from Reddit (GET, no body)');
  }
  const res = await fetch(u.href, {
    ...init,
    method: 'GET',
    credentials: init.credentials ?? 'include',
    redirect: 'follow',
  });
  // A same-origin redirect (a renamed path) is fine; one that left Reddit is not read.
  // (`url` is the address the answer finally came from; empty only for a synthetic Response.)
  if ((res.redirected || res.url) && classify(res.url || 'about:blank').dest !== 'same-origin') {
    console.error('[REScue] answer redirected away from Reddit, ignored:', res.url);
    throw new BlockedRequestError('Reddit redirected the request to another site');
  }
  return res;
}
