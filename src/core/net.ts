/**
 * THE ONLY NETWORK ENTRY POINT (SC-006, constitution Principle IV). Lint bans fetch and
 * XMLHttpRequest everywhere else. The only allowed destination is the page's own Reddit origin
 * (hover-card partials and the read-only JSON endpoints in the contracts module, through
 * redditJson.ts), with the user's existing session. Every destination is listed in PRIVACY.md.
 * Every request is a GET without a body (anything else is refused before it leaves), and an
 * answer that was redirected to any other origin is thrown away unread.
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
