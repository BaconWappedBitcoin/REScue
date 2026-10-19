import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseUserCard, parseCommunityCard, HovercardService } from '../../src/core/hovercards';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures/hovercards', name), 'utf8');

describe('hovercard parsing', () => {
  it('parses the user card: label-paired karma and cake day', () => {
    const card = parseUserCard('spez', fixture('user-spez.html'));
    expect(card.found).toBe(true);
    expect(card.postKarma).toBe(184553);
    expect(card.commentKarma).toBe(756509);
    expect(card.cakeDay?.toISOString()).toBe('2005-06-06T00:00:00.000Z');
  });

  it('returns undefined, never a mislabelled number, when labels do not match', () => {
    const html = fixture('user-spez.html').replace('Post karma', 'Mystery number');
    const card = parseUserCard('spez', html);
    expect(card.postKarma).toBeUndefined();
    expect(card.commentKarma).toBe(756509);
  });

  it('reports a missing user as found: false', () => {
    expect(parseUserCard('nobody', fixture('user-missing.html'))).toMatchObject({
      username: 'nobody',
      found: false,
    });
  });

  it('parses the community card', () => {
    const card = parseCommunityCard('programming', fixture('community-programming.html'));
    expect(card).toMatchObject({
      name: 'programming',
      found: true,
      weeklyVisitors: 202086,
      weeklyContributions: 1921,
    });
    expect(card.description).toBe('Computer Programming');
  });

  it('can find the card inside a full page (fallback path)', () => {
    const page = `<html><head><style>x{}</style></head><body><div>${fixture('user-spez.html')}</div></body></html>`;
    expect(parseUserCard('spez', page).postKarma).toBe(184553);
  });
});

describe('HovercardService', () => {
  const ok = (body: string) => ({ ok: true, status: 200, text: async () => body });

  function service(
    fetcher: (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>,
    now = { t: 0 },
  ) {
    return {
      now,
      svc: new HovercardService({ fetchText: fetcher as never, now: () => now.t, maxEntries: 500 }),
    };
  }

  it('makes one request for concurrent lookups of the same name', async () => {
    const f = vi.fn(async () => ok(fixture('user-spez.html')));
    const { svc } = service(f);
    const [a, b] = await Promise.all([svc.user('spez'), svc.user('SPEZ')]);
    expect(f).toHaveBeenCalledOnce();
    expect(a).toBe(b);
  });

  it('sends the partial Accept header to the same-origin endpoint', async () => {
    const f = vi.fn(async (_url: string, _init?: unknown) => ok(fixture('user-spez.html')));
    const { svc } = service(f as never);
    await svc.user('spez');
    expect(f.mock.calls[0]![0]).toBe('/svc/shreddit/user-hover-card/spez');
    expect(f.mock.calls[0]![1]).toMatchObject({
      headers: { Accept: 'text/vnd.reddit.partial+html, text/html;q=0.9' },
      credentials: 'include',
    });
  });

  it('caches for 30 minutes, then refetches', async () => {
    const f = vi.fn(async () => ok(fixture('user-spez.html')));
    const { svc, now } = service(f);
    await svc.user('spez');
    now.t = 29 * 60_000;
    await svc.user('spez');
    expect(f).toHaveBeenCalledTimes(1);
    now.t = 31 * 60_000;
    await svc.user('spez');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('evicts least-recently-used beyond 500 entries', async () => {
    // Read the fixture once: 501 synchronous disk reads made this test time out on a busy machine.
    const body = fixture('user-missing.html');
    const f = vi.fn(async () => ok(body));
    const { svc } = service(f);
    for (let i = 0; i < 501; i++) await svc.user(`user${i}`);
    expect(svc.size()).toBe(500);
    await svc.user('user0');
    expect(f).toHaveBeenCalledTimes(502);
  });

  it('backs off globally for 5 minutes after a 429', async () => {
    const f = vi.fn(async () => ({ ok: false, status: 429, text: async () => '' }));
    const { svc, now } = service(f);
    expect(await svc.user('alice')).toMatchObject({ state: 'unavailable' });
    expect(await svc.community('books')).toMatchObject({ state: 'unavailable' });
    expect(f).toHaveBeenCalledOnce();
    now.t = 5 * 60_000 + 1;
    await svc.user('alice');
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('rejects names that are not valid Reddit names (no path injection)', async () => {
    const f = vi.fn(async () => ok(''));
    const { svc } = service(f);
    expect(await svc.user('../../api/me')).toMatchObject({ state: 'unavailable' });
    expect(f).not.toHaveBeenCalled();
  });
});
