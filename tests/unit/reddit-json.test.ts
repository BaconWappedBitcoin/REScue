import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CONTRACTS, contractUsable } from '../../src/contracts/reddit';
import {
  BACKOFF_MS,
  RedditJsonClient,
  buildRequest,
  jsonFor,
  jsonHealth,
  readOnlyInit,
  type JsonResponse,
} from '../../src/core/redditJson';
import { blockedList, commentsDoc, infoListing, meDoc, minePage } from '../fixtures/redditJson';

const reply = (body: unknown, status = 200, type = 'application/json'): JsonResponse => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (n) => (n.toLowerCase() === 'content-type' ? type : null) },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

function rig(
  answer: (url: string) => JsonResponse | Promise<JsonResponse> = () => reply(minePage([])),
) {
  const clock = { t: 1_000_000 };
  const fetchJson = vi.fn(async (url: string, _init: RequestInit) => answer(url));
  const sleep = vi.fn(async (ms: number) => void (clock.t += ms));
  const notify = vi.fn();
  const client = new RedditJsonClient({ fetchJson, now: () => clock.t, sleep });
  return { clock, fetchJson, sleep, notify, client };
}

describe('request building', () => {
  it('builds the contract paths with raw_json and validated parameters', () => {
    expect(buildRequest('mine', { limit: 100, after: 't5_abc' })).toBe(
      '/subreddits/mine.json?raw_json=1&limit=100&after=t5_abc',
    );
    expect(buildRequest('info', { id: ['t3_a', 't3_b'] })).toBe(
      '/api/info.json?raw_json=1&id=t3_a%2Ct3_b',
    );
    expect(buildRequest('comments', { id: 't3_AbC1', limit: 1, depth: 1 })).toBe(
      '/comments/abc1.json?raw_json=1&limit=1&depth=1',
    );
    expect(buildRequest('comments', { id: 't3_p1', limit: 1, depth: 0 })).toBe(
      '/comments/p1.json?raw_json=1&limit=1&depth=0',
    );
    expect(
      buildRequest('comments', { id: 'p1', comment: 't1_19RFviy114w00', limit: 1, depth: 1 }),
    ).toBe('/comments/p1/_/19rfviy114w00.json?raw_json=1&limit=1&depth=1');
    expect(buildRequest('me', {})).toBe('/api/me.json?raw_json=1');
    expect(buildRequest('blocked', {})).toBe('/prefs/blocked.json?raw_json=1');
  });

  it('refuses anything that is not on the allow-list', () => {
    expect(buildRequest('mine', { limit: 101 })).toBeNull();
    expect(buildRequest('mine', { after: '../../etc' })).toBeNull();
    expect(buildRequest('mine', { sneaky: 1 })).toBeNull();
    expect(buildRequest('info', { id: [] })).toBeNull();
    expect(buildRequest('info', { id: 't3_a,../x' })).toBeNull();
    expect(
      buildRequest('info', { id: Array.from({ length: 101 }, (_, i) => `t3_a${i}`) }),
    ).toBeNull();
    expect(buildRequest('comments', { id: 'abc/../../x' })).toBeNull();
    expect(buildRequest('comments', { id: 'p1', comment: '../x' })).toBeNull();
    expect(buildRequest('comments', { id: 'p1', comment: 't3_abc' })).toBeNull();
    expect(buildRequest('comments', { id: 'p1', comment: 'a'.repeat(17) })).toBeNull();
    expect(buildRequest('comments', { id: 'p1', comment: 5 } as never)).toBeNull();
    expect(buildRequest('comments', { id: 'p1', limit: 0 })).toBeNull();
    expect(buildRequest('comments', { id: 'p1', depth: -1 })).toBeNull();
    expect(buildRequest('me', { x: 1 })).toBeNull();
  });

  it('only ever builds a GET', () => {
    const init = readOnlyInit();
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.credentials).toBe('include');
  });
});

describe('RedditJsonClient', () => {
  it('sends one GET with the session and returns the parsed shape', async () => {
    const { client, fetchJson } = rig(() =>
      reply(minePage([{ name: 'aww', subscribers: 5 }], 't5_x')),
    );
    const res = await client.get('mine', { limit: 100 });
    expect(res).toMatchObject({
      ok: true,
      cached: false,
      data: {
        after: 't5_x',
        subs: [{ name: 'aww', prefixed: 'r/aww', url: '/r/aww/', subscribers: 5 }],
      },
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    const [url, init] = fetchJson.mock.calls[0]!;
    expect(url).toBe('/subreddits/mine.json?raw_json=1&limit=100');
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect(init.body).toBeUndefined();
  });

  it('returns a params failure without any request for a bad call', async () => {
    const { client, fetchJson } = rig();
    expect(await client.get('info', { id: 'not-a-post' })).toMatchObject({
      ok: false,
      reason: 'params',
    });
    expect(await client.get('nope' as never, {} as never)).toMatchObject({ reason: 'params' });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('caches an answer until its time is up, and fresh skips the cache', async () => {
    const { client, fetchJson, clock } = rig();
    await client.get('mine', { limit: 100 }, { ttlMs: 60_000 });
    expect(await client.get('mine', { limit: 100 }, { ttlMs: 60_000 })).toMatchObject({
      cached: true,
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    await client.get('mine', { limit: 100 }, { fresh: true });
    expect(fetchJson).toHaveBeenCalledTimes(2);
    clock.t += 61_000;
    await client.get('mine', { limit: 100 }, { ttlMs: 60_000 });
    expect(fetchJson).toHaveBeenCalledTimes(3);
  });

  it('shares one request between identical calls made together', async () => {
    const { client, fetchJson } = rig();
    const [a, b] = await Promise.all([client.get('me', {}), client.get('me', {})]);
    expect(a.ok && b.ok).toBe(true);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('spaces requests to one endpoint at least a second apart, not different endpoints', async () => {
    const { client, sleep, clock } = rig((url) =>
      url.startsWith('/api/me') ? reply(meDoc('me')) : reply(minePage([])),
    );
    const start = clock.t;
    await Promise.all([
      client.get('mine', { limit: 1 }),
      client.get('mine', { limit: 2 }),
      client.get('mine', { limit: 3 }),
      client.get('me', {}),
    ]);
    // Three calls to one endpoint take three slots a second apart (two waits); `me` waits for none.
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 1000]);
    expect(clock.t - start).toBe(2000);
  });

  it('pauses all reads for ten minutes after a 429 (rate limit) and says so', async () => {
    const status = 429;
    const { client, fetchJson, clock, notify } = rig(() => reply('{}', status));
    const res = await client.get('mine', { limit: 100 }, { notify });
    expect(res).toMatchObject({ ok: false, reason: 'http' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toMatch(/10 minutes/);
    expect(notify.mock.calls[0]![1]).toBe('warning');
    expect(client.pausedUntil()).toBe(clock.t + BACKOFF_MS);

    fetchJson.mockClear();
    const other = await client.get('me', {});
    expect(other).toMatchObject({ ok: false, reason: 'backoff' });
    expect(fetchJson).not.toHaveBeenCalled();
    expect(jsonHealth(client)).toMatchObject({
      status: 'degraded',
      failingContracts: ['json.paused'],
    });

    clock.t += BACKOFF_MS + 1;
    expect(client.pausedUntil()).toBe(0);
    await client.get('me', {});
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('pauses only the refused endpoint for ten minutes after a 403, and says so once', async () => {
    // Both refusals arrive only once both requests are out, as when two are in flight together.
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const { client, fetchJson, clock, notify } = rig((url) =>
      url.startsWith('/comments/')
        ? gate.then(() => reply('<html>', 403, 'text/html'))
        : reply(meDoc('me')),
    );
    const both = Promise.all([
      client.get('comments', { id: 'p1', limit: 1, depth: 0 }, { notify }),
      client.get('comments', { id: 'p2', limit: 1, depth: 0 }, { notify }),
    ]);
    await vi.waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2));
    release();
    const [a, b] = await both;
    expect(a).toMatchObject({ ok: false, reason: 'http' });
    expect(b).toMatchObject({ ok: false, reason: 'http' });
    // Two refusals in one pause: one notice, naming the address.
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toMatch(/\/comments\/\{id\}\.json for 10 minutes/);
    expect(notify.mock.calls[0]![2]).toBe('json-paused-comments');
    expect(client.pausedUntil()).toBe(0);
    expect(client.pausedUntil('comments')).toBeGreaterThan(clock.t);

    fetchJson.mockClear();
    expect(await client.get('comments', { id: 'p3' }, { notify })).toMatchObject({
      reason: 'backoff',
    });
    expect(fetchJson).not.toHaveBeenCalled();
    // Other endpoints still read.
    expect(await client.get('me', {})).toMatchObject({ ok: true });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(jsonHealth(client)).toMatchObject({
      status: 'degraded',
      failingContracts: ['json.comments'],
    });

    clock.t += BACKOFF_MS + 1;
    expect(client.pausedUntil('comments')).toBe(0);
    expect(jsonHealth(client).status).toBe('ok');
    await client.get('comments', { id: 'p3' }, { notify });
    expect(fetchJson).toHaveBeenCalledTimes(2);
    // A new pause gets its own notice.
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('treats an HTML page as a block of that endpoint, by content type or by content', async () => {
    const byType = rig(() => reply('<html></html>', 200, 'text/html; charset=utf-8'));
    expect(await byType.client.get('me', {}, { notify: byType.notify })).toMatchObject({
      reason: 'html',
    });
    expect(byType.client.pausedUntil('me')).toBeGreaterThan(0);
    expect(byType.client.pausedUntil('mine')).toBe(0);
    expect(byType.notify).toHaveBeenCalledTimes(1);

    const byBody = rig(() => reply('  <!doctype html><html>', 200, 'application/json'));
    expect(await byBody.client.get('me', {})).toMatchObject({ reason: 'html' });
    expect(byBody.client.pausedUntil('me')).toBeGreaterThan(0);
  });

  it('does not pause for a server error or a network failure', async () => {
    const down = rig(() => reply('oops', 503));
    expect(await down.client.get('me', {})).toMatchObject({ ok: false, reason: 'http' });
    expect(down.client.pausedUntil()).toBe(0);

    const offline = new RedditJsonClient({
      fetchJson: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    expect(await offline.get('me', {})).toMatchObject({ ok: false, reason: 'network' });
    expect(offline.pausedUntil()).toBe(0);
  });

  it('fails visibly on a changed shape and clears the failure on the next good answer', async () => {
    let good = false;
    const { client, notify } = rig(() =>
      reply(good ? minePage([{ name: 'aww' }]) : { surprise: true }),
    );
    const bad = await client.get('mine', { limit: 100 }, { notify });
    expect(bad).toMatchObject({ ok: false, reason: 'shape' });
    expect(notify).toHaveBeenCalledWith(
      expect.stringMatching(/subreddits\/mine\.json.*not in the expected format/),
      'warning',
      'json-shape-mine',
    );
    expect(jsonHealth(client)).toMatchObject({
      status: 'degraded',
      failingContracts: ['json.mine'],
    });
    // No pause for a shape problem: the next call asks again.
    good = true;
    expect((await client.get('mine', { limit: 100 })).ok).toBe(true);
    expect(jsonHealth(client).status).toBe('ok');
  });

  it('treats text that is not JSON as a shape failure', async () => {
    const { client, notify } = rig(() => reply('not json at all'));
    expect(await client.get('me', {}, { notify })).toMatchObject({ reason: 'shape' });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('goes through net.ts: a page that is not on Reddit gets no request', async () => {
    const client = new RedditJsonClient();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await client.get('me', {})).toMatchObject({ ok: false, reason: 'blocked' });
    spy.mockRestore();
  });
});

describe('response shapes', () => {
  async function data<T>(answer: unknown, run: (c: RedditJsonClient) => Promise<T>) {
    const { client } = rig(() => reply(answer));
    return run(client);
  }

  it('info: keeps t3 posts, ignores other kinds, and rejects a post without a count', async () => {
    const listing = infoListing([{ id: 't3_a', comments: 7 }]) as {
      data: { children: unknown[] };
    };
    listing.data.children.push({ kind: 't1', data: { name: 't1_zzz' } });
    expect(await data(listing, (c) => c.get('info', { id: 't3_a' }))).toMatchObject({
      ok: true,
      data: { posts: [{ id: 't3_a', numComments: 7, likes: null }] },
    });
    const broken = {
      kind: 'Listing',
      data: { children: [{ kind: 't3', data: { name: 't3_a' } }] },
    };
    expect(await data(broken, (c) => c.get('info', { id: 't3_a' }))).toMatchObject({
      reason: 'shape',
    });
  });

  it('info: reads the original picture size from the preview, when there is one', async () => {
    const withPreview = {
      kind: 'Listing',
      data: {
        children: [
          {
            kind: 't3',
            data: {
              name: 't3_a',
              num_comments: 1,
              preview: { images: [{ source: { url: 'x', width: 3024, height: 4032 } }] },
            },
          },
          { kind: 't3', data: { name: 't3_b', num_comments: 1, preview: { images: [] } } },
        ],
      },
    };
    const res = await data(withPreview, (c) => c.get('info', { id: ['t3_a', 't3_b'] }));
    expect(res).toMatchObject({ ok: true, data: { posts: [{ sourceSize: [3024, 4032] }, {}] } });
    const posts = (res as unknown as { data: { posts: Array<Record<string, unknown>> } }).data
      .posts;
    expect('sourceSize' in posts[1]!).toBe(false);
  });

  it('comments: reads the post and the comments with their flags', async () => {
    const doc = commentsDoc({ id: 't3_a', comments: 2 }, [
      { id: 't1_x', controversiality: 1 },
      { id: 't1_y' },
    ]);
    const res = await data(doc, (c) => c.get('comments', { id: 't3_a', limit: 1, depth: 1 }));
    expect(res).toMatchObject({
      ok: true,
      data: {
        post: { id: 't3_a', numComments: 2 },
        comments: [
          { id: 't1_x', controversiality: 1 },
          { id: 't1_y', controversiality: 0 },
        ],
      },
    });
    expect(await data({ not: 'an array' }, (c) => c.get('comments', { id: 'a' }))).toMatchObject({
      reason: 'shape',
    });
  });

  it('comments: the live post-only shape gives num_comments, selftext, the picture size and edited', async () => {
    // /comments/<post>.json?raw_json=1&limit=1&depth=0 (live 2026-10-21): [postListing, empty].
    const doc = [
      {
        kind: 'Listing',
        data: {
          children: [
            {
              kind: 't3',
              data: {
                name: 't3_p1',
                num_comments: 41,
                selftext: 'a &amp; b',
                edited: 1760667356.5,
                preview: { images: [{ source: { url: 'x', width: 3024, height: 4032 } }] },
              },
            },
          ],
        },
      },
      { kind: 'Listing', data: { children: [] } },
    ];
    const res = await data(doc, (c) => c.get('comments', { id: 't3_p1', limit: 1, depth: 0 }));
    expect(res).toMatchObject({
      ok: true,
      data: {
        post: {
          id: 't3_p1',
          numComments: 41,
          selftext: 'a &amp; b',
          edited: 1760667356500,
          sourceSize: [3024, 4032],
        },
        comments: [],
      },
    });
  });

  it('comments: one comment’s thread gives that comment’s body and edited, and skips "more"', async () => {
    const doc = [
      {
        kind: 'Listing',
        data: { children: [{ kind: 't3', data: { name: 't3_p1', num_comments: 3 } }] },
      },
      {
        kind: 'Listing',
        data: {
          children: [
            { kind: 't1', data: { name: 't1_c1', body: '*hi*', edited: false, score: 2 } },
            { kind: 'more', data: { count: 2, children: ['c2'] } },
          ],
        },
      },
    ];
    const res = await data(doc, (c) =>
      c.get('comments', { id: 'p1', comment: 'c1', limit: 1, depth: 1 }),
    );
    expect(res).toMatchObject({
      ok: true,
      data: { comments: [{ id: 't1_c1', body: '*hi*', edited: null, score: 2 }] },
    });
    expect((res as { data: { comments: unknown[] } }).data.comments).toHaveLength(1);
  });

  it('me: signed in with a name, signed out without one', async () => {
    expect(await data(meDoc('rockpaperblr'), (c) => c.get('me', {}))).toMatchObject({
      ok: true,
      data: { signedIn: true, name: 'rockpaperblr' },
    });
    expect(await data({}, (c) => c.get('me', {}))).toMatchObject({
      ok: true,
      data: { signedIn: false, name: null },
    });
  });

  it('blocked: reads names, rejects an entry without one', async () => {
    expect(await data(blockedList(['a', 'b']), (c) => c.get('blocked', {}))).toMatchObject({
      ok: true,
      data: { names: ['a', 'b'] },
    });
    const bad = { kind: 'UserList', data: { children: [{ id: 't2_1' }] } };
    expect(await data(bad, (c) => c.get('blocked', {}))).toMatchObject({ reason: 'shape' });
  });

  it('mine: rejects a subreddit without a name', async () => {
    const bad = { kind: 'Listing', data: { children: [{ kind: 't5', data: { url: '/r/x/' } }] } };
    expect(await data(bad, (c) => c.get('mine', { limit: 100 }))).toMatchObject({
      reason: 'shape',
    });
  });
});

describe('the retired /api/info.json', () => {
  it('is marked retired in the contracts, with nobody using it', () => {
    const entry = CONTRACTS.find((c) => c.key === 'json.info')!;
    expect(entry).toMatchObject({ status: 'retired', usedBy: [] });
    expect(contractUsable('json.info')).toBe(false);
  });

  it('is asked for nowhere in the source', () => {
    const root = join(__dirname, '../../src');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(root);
    const callers = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return /\bget(?:Json)?\(\s*['"]info['"]/.test(text) || /C\.json\.info\b/.test(text);
    });
    expect(callers.map((f) => f.slice(root.length + 1).replace(/\\/g, '/'))).toEqual([
      'contracts/reddit.ts',
    ]);
  });
});

describe('jsonFor', () => {
  it('reports through the module notices with the module header and a cooldown', async () => {
    const { client } = rig(() => reply('{}', 403));
    const show = vi.fn();
    const get = jsonFor({ show, dismiss: () => {} }, 'threadSubscriptions', client);
    await get('me', {});
    expect(show).toHaveBeenCalledTimes(1);
    expect(show.mock.calls[0]![1]).toMatchObject({
      kind: 'warning',
      id: 'json-paused-me',
      moduleId: 'threadSubscriptions',
      cooldownMs: 60_000,
    });
  });
});
