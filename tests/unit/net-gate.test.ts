/**
 * The network gate (src/core/net.ts): which addresses netFetch lets through from which page, and
 * what it sends. `fetch` is stubbed; a blocked address never reaches it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockedRequestError, classify, netFetch } from '../../src/core/net';

const setPage = (url: string): void =>
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);

/** A stubbed fetch that answers from the address it was asked for (no redirect). */
const stubFetch = (answer?: (url: string) => Partial<Response>) => {
  const f = vi.fn(
    async (url: string, _init: RequestInit) =>
      ({ ok: true, status: 200, url, redirected: false, ...answer?.(url) }) as Response,
  );
  vi.stubGlobal('fetch', f);
  return f;
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('netFetch allow / block matrix', () => {
  it.each([
    ['https://www.reddit.com/r/aww/', '/api/me.json', 'https://www.reddit.com/api/me.json'],
    ['https://www.reddit.com/', 'https://www.reddit.com/r/x/', 'https://www.reddit.com/r/x/'],
    ['https://sh.reddit.com/r/aww/', '/r/x/about.json', 'https://sh.reddit.com/r/x/about.json'],
    ['https://reddit.com/r/aww/', 'https://reddit.com/user/x', 'https://reddit.com/user/x'],
    // Not an address: a bare name is a path on the page's own origin (resolved against its root).
    ['https://www.reddit.com/r/aww/', 'reddit.com.evil', 'https://www.reddit.com/reddit.com.evil'],
  ])('from %s lets %s through as %s', async (page, url, sent) => {
    setPage(page);
    const f = stubFetch();
    await expect(netFetch(url)).resolves.toMatchObject({ ok: true });
    expect(f).toHaveBeenCalledOnce();
    expect(f.mock.calls[0]![0]).toBe(sent);
  });

  it.each([
    ['https://www.reddit.com/r/aww/', '//evil.com/x'],
    ['https://www.reddit.com/r/aww/', 'https://evil.com/?https://www.reddit.com'],
    ['https://www.reddit.com/r/aww/', 'https://reddit.com.evil/'],
    ['https://www.reddit.com/r/aww/', 'https://www.reddit.com.evil.com/'],
    ['https://www.reddit.com/r/aww/', 'https://www.reddit.com@evil.com/'],
    ['https://www.reddit.com/r/aww/', 'http://www.reddit.com/api/me.json'],
    // Another Reddit origin than the page's own is not same-origin either.
    ['https://www.reddit.com/r/aww/', 'https://sh.reddit.com/api/me.json'],
    ['https://www.reddit.com/r/aww/', 'https://old.reddit.com/api/me.json'],
    // A page that is not Reddit (or not https) may not use the gate at all.
    ['http://www.reddit.com/r/aww/', '/api/me.json'],
    ['https://evil.com/', '/api/me.json'],
    ['https://old.reddit.com/', '/api/me.json'],
  ])('from %s blocks %s before anything leaves', async (page, url) => {
    setPage(page);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const f = stubFetch();
    await expect(netFetch(url)).rejects.toBeInstanceOf(BlockedRequestError);
    expect(f).not.toHaveBeenCalled();
  });

  it('classify names the resolved address and its destination', () => {
    const r = classify('//evil.com/x', 'https://www.reddit.com');
    expect(r.dest).toBe('blocked');
    expect(r.url.hostname).toBe('evil.com');
    expect(classify('/x', 'https://sh.reddit.com').dest).toBe('same-origin');
  });
});

describe('netFetch request shape', () => {
  it('sends a GET with the reader’s cookies, following redirects', async () => {
    setPage('https://www.reddit.com/r/aww/');
    const f = stubFetch();
    await netFetch('/api/me.json', { method: 'get', headers: { Accept: 'application/json' } });
    expect(f.mock.calls[0]![1]).toEqual({
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      redirect: 'follow',
    });
  });

  it('keeps a caller’s own credentials choice and overrides its redirect mode', async () => {
    setPage('https://www.reddit.com/r/aww/');
    const f = stubFetch();
    await netFetch('/r/x.json', { credentials: 'omit', redirect: 'manual' });
    expect(f.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', redirect: 'follow' });
  });

  it.each([
    [{ method: 'POST' }],
    [{ method: 'delete' }],
    [{ method: 'PUT', body: '{}' }],
    [{ body: 'x' }],
    [{ method: 'GET', body: new URLSearchParams('a=1') }],
  ])('refuses %j before anything leaves', async (init) => {
    setPage('https://www.reddit.com/r/aww/');
    const f = stubFetch();
    await expect(netFetch('/api/vote', init as RequestInit)).rejects.toThrow(/GET, no body/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('netFetch answers that came from elsewhere', () => {
  it.each([
    ['https://evil.example/steal', true],
    ['http://www.reddit.com/r/aww/', true],
    ['https://sh.reddit.com/r/aww/', true],
    // Not flagged as redirected, but the answer's own address is elsewhere: still not read.
    ['https://evil.example/', false],
  ])('throws away an answer from %s (redirected: %s)', async (url, redirected) => {
    setPage('https://www.reddit.com/r/aww/');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch(() => ({ url, redirected }));
    await expect(netFetch('/r/aww.json')).rejects.toThrow(/redirected/);
  });

  it('reads a same-origin redirect and a synthetic answer without an address', async () => {
    setPage('https://www.reddit.com/r/aww/');
    stubFetch(() => ({ url: 'https://www.reddit.com/r/Aww/', redirected: true }));
    await expect(netFetch('/r/aww')).resolves.toMatchObject({ ok: true });
    stubFetch(() => ({ url: '', redirected: false }));
    await expect(netFetch('/r/aww')).resolves.toMatchObject({ ok: true });
  });

  it('refuses a redirect flag with no final address', async () => {
    setPage('https://www.reddit.com/r/aww/');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubFetch(() => ({ url: '', redirected: true }));
    await expect(netFetch('/r/aww')).rejects.toBeInstanceOf(BlockedRequestError);
  });
});
