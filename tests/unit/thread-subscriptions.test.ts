import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { sharedJsonClient } from '../../src/core/redditJson';
import {
  addSub,
  applyCounts,
  clearNew,
  markSeen,
  pruneExpired,
  removeSub,
  sanitizeSubs,
  threadPath,
  totalNew,
  type SubMap,
} from '../../src/modules/comments/subscriptionModel';
import {
  ROUND_MAX,
  SUBS_KEY,
  roundOf,
  runCheck,
  storageCursor,
  storageLock,
  type CheckLock,
  type PollDeps,
} from '../../src/modules/comments/subscriptionPoller';
import { threadSubscriptions } from '../../src/modules/comments/threadSubscriptions';
import { commentsDoc } from '../fixtures/redditJson';
import { mount, nestedThreadHtml } from '../fixtures/pages';
import { bootModules, tick } from './module-harness';

vi.mock('../../src/core/net', async (orig) => ({
  ...(await orig<typeof import('../../src/core/net')>()),
  netFetch: vi.fn(),
}));
import { netFetch } from '../../src/core/net';

const DAY = 86_400_000;
const POST = {
  id: 't3_text1',
  title: 'Got laid off',
  permalink: '/r/Layoffs/comments/text1/got_laid_off/',
  subreddit: 'Layoffs',
  commentCount: 1115,
};
const route = {
  kind: 'thread',
  path: '/r/Layoffs/comments/text1/got_laid_off',
  postId: 't3_text1',
};

const jsonOk = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  sharedJsonClient.reset();
  vi.mocked(netFetch).mockReset();
  fakeBrowser.reset();
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('subscription model', () => {
  it('starts a watch with the current count as baseline and an expiry', () => {
    const subs = addSub({}, POST, 2, 1000);
    expect(subs.t3_text1).toMatchObject({
      lastCount: 1115,
      newCount: 0,
      expiresAt: 1000 + 2 * DAY,
      permalink: '/r/Layoffs/comments/text1/got_laid_off/',
    });
  });

  it('refuses a post id or a link that is not a thread', () => {
    expect(addSub({}, { ...POST, id: 'x' }, 2, 0)).toEqual({});
    expect(addSub({}, { ...POST, permalink: 'https://evil.test/x' }, 2, 0)).toEqual({});
    expect(threadPath('https://evil.test/r/a/comments/b/')).toBe('/r/a/comments/b/');
    expect(threadPath('javascript:alert(1)')).toBeNull();
  });

  it('renewing keeps the first date and the unseen comments', () => {
    const first = addSub({}, POST, 2, 1000);
    const grown = applyCounts(first, [{ ...info('t3_text1', 1120) }]).subs;
    const renewed = addSub(grown, { ...POST, commentCount: 1120 }, 5, 9000);
    expect(renewed.t3_text1).toMatchObject({
      subscribedAt: 1000,
      expiresAt: 9000 + 5 * DAY,
      newCount: 5,
    });
  });

  it('counts growth, moves the baseline down when comments are deleted, ignores strangers', () => {
    const start: SubMap = addSub(
      addSub({}, POST, 2, 0),
      { ...POST, id: 't3_b', commentCount: 10 },
      2,
      0,
    );
    const r = applyCounts(start, [info('t3_text1', 1118), info('t3_b', 8), info('t3_zzz', 99)]);
    expect(r.grew).toHaveLength(1);
    expect(r.grew[0]).toMatchObject({ added: 3 });
    expect(r.subs.t3_text1).toMatchObject({ lastCount: 1118, newCount: 3 });
    expect(r.subs.t3_b).toMatchObject({ lastCount: 8, newCount: 0 });
    expect(r.subs.t3_zzz).toBeUndefined();
    expect(totalNew(r.subs)).toBe(3);
    expect(applyCounts(r.subs, [info('t3_b', 9)]).subs.t3_b!.newCount).toBe(1);
  });

  it('opening a thread clears its badge, but an older cached page does not', () => {
    const grown = applyCounts(addSub({}, POST, 2, 0), [info('t3_text1', 1120)]).subs;
    expect(markSeen(grown, 't3_text1', 1100)).toBe(grown);
    expect(markSeen(grown, 't3_text1', 1120).t3_text1).toMatchObject({
      newCount: 0,
      lastCount: 1120,
    });
    expect(markSeen(grown, 't3_none', 5)).toBe(grown);
    expect(totalNew(clearNew(grown))).toBe(0);
  });

  it('drops ended watches and repairs stored data', () => {
    const subs = addSub(addSub({}, POST, 1, 0), { ...POST, id: 't3_b' }, 3, 0);
    expect(Object.keys(pruneExpired(subs, 2 * DAY))).toEqual(['t3_b']);
    expect(pruneExpired(subs, 1)).toBe(subs);
    expect(removeSub(subs, 't3_b')).not.toHaveProperty('t3_b');
    expect(
      sanitizeSubs({ a: { id: 't3_x', permalink: '/r/a/comments/x/' }, b: 5, c: { id: 'bad' } }),
    ).toEqual({
      t3_x: expect.objectContaining({ id: 't3_x', lastCount: 0 }),
    });
  });
});

function info(id: string, numComments: number) {
  return {
    id,
    title: null,
    numComments,
    locked: false,
    saved: false,
    hidden: false,
    likes: null,
    score: 1,
  };
}

describe('runCheck', () => {
  function rig(subs: SubMap, over: Partial<PollDeps> = {}) {
    let stored = subs;
    const getJson = vi.fn(async (_k: string, p: { id: string }) => ({
      ok: true as const,
      cached: false,
      data: { post: info(p.id, (subs[p.id]?.lastCount ?? 0) + 2), comments: [] },
    }));
    const onGrew = vi.fn();
    const deps: PollDeps = {
      load: async () => stored,
      save: (s) => void (stored = s),
      getJson: getJson as never,
      lock: { tryAcquire: async () => true },
      now: () => 5000,
      onGrew,
      ...over,
    };
    return { deps, getJson, onGrew, saved: () => stored };
  }

  it('does nothing, and takes no lock, when nothing is watched', async () => {
    const tryAcquire = vi.fn(async () => true);
    const { deps, getJson } = rig({}, { lock: { tryAcquire } });
    expect(await runCheck(deps)).toBe('idle');
    expect(tryAcquire).not.toHaveBeenCalled();
    expect(getJson).not.toHaveBeenCalled();
  });

  it('asks once per watched thread (post only) and reports the ones that grew', async () => {
    const subs = addSub(
      addSub({}, POST, 2, 0),
      { ...POST, id: 't3_b', title: 'B', commentCount: 4 },
      2,
      0,
    );
    const { deps, getJson, onGrew, saved } = rig(subs);
    expect(await runCheck(deps)).toBe('ok');
    expect(getJson).toHaveBeenCalledTimes(2);
    expect(getJson).toHaveBeenCalledWith(
      'comments',
      { id: 't3_text1', limit: 1, depth: 0 },
      { fresh: true },
    );
    expect(getJson).toHaveBeenCalledWith(
      'comments',
      { id: 't3_b', limit: 1, depth: 0 },
      { fresh: true },
    );
    expect(onGrew).toHaveBeenCalledTimes(1);
    expect(onGrew.mock.calls[0]![0]).toHaveLength(2);
    expect(saved().t3_text1).toMatchObject({ lastCount: 1117, newCount: 2 });
  });

  it('asks about at most ROUND_MAX threads a round, and carries on where it stopped', async () => {
    expect(ROUND_MAX).toBeLessThan(30);
    let subs: SubMap = {};
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) {
      const id = `t3_p${String(i).padStart(2, '0')}`;
      ids.push(id);
      subs = addSub(subs, { ...POST, id }, 2, 0);
    }
    let last: string | null = null;
    const cursor = { get: async () => last, set: async (id: string) => void (last = id) };
    const first = rig(subs, { cursor });
    await runCheck(first.deps);
    const asked1 = first.getJson.mock.calls.map((c) => c[1].id);
    expect(asked1).toEqual(ids.slice(0, ROUND_MAX));
    const second = rig(subs, { cursor });
    await runCheck(second.deps);
    const asked2 = second.getJson.mock.calls.map((c) => c[1].id);
    expect(asked2).toEqual([...ids.slice(ROUND_MAX), ...ids].slice(0, ROUND_MAX));
    expect(new Set([...asked1, ...asked2]).size).toBe(40);
  });

  it('skips a thread Reddit has no page for, and ends the round on a pause', async () => {
    const subs = addSub(
      addSub(addSub({}, { ...POST, id: 't3_a' }, 2, 0), { ...POST, id: 't3_b' }, 2, 0),
      { ...POST, id: 't3_c' },
      2,
      0,
    );
    const asked: string[] = [];
    const answers: Record<string, unknown> = {
      t3_a: { ok: false, reason: 'http', message: 'Reddit answered 404.' },
      t3_b: { ok: true, cached: false, data: { post: info('t3_b', 9), comments: [] } },
      t3_c: { ok: false, reason: 'backoff', message: 'paused' },
    };
    let last: string | null = null;
    const { deps, saved } = rig(subs, {
      getJson: (async (_k: string, p: { id: string }) => (
        asked.push(p.id),
        answers[p.id]
      )) as never,
      cursor: { get: async () => last, set: async (id) => void (last = id) },
    });
    expect(await runCheck(deps)).toBe('ok');
    expect(asked).toEqual(['t3_a', 't3_b', 't3_c']);
    expect(saved().t3_b).toMatchObject({ lastCount: 9 });
    expect(last).toBe('t3_b'); // the paused thread is asked first next round
  });

  it('picks rounds in id order, wrapping round', () => {
    expect(roundOf(['c', 'a', 'b'], null, 5)).toEqual(['a', 'b', 'c']);
    expect(roundOf(['a', 'b', 'c', 'd'], 'b', 2)).toEqual(['c', 'd']);
    expect(roundOf(['a', 'b', 'c', 'd'], 'd', 2)).toEqual(['a', 'b']);
    expect(roundOf(['a', 'b', 'c', 'd'], 'c', 3)).toEqual(['d', 'a', 'b']);
  });

  it('keeps the round cursor in extension storage', async () => {
    const mem: Record<string, unknown> = {};
    const c = storageCursor({
      get: async (k) => ({ [k]: mem[k] }),
      set: async (items) => void Object.assign(mem, items),
    });
    expect(await c.get()).toBeNull();
    await c.set('t3_x');
    expect(await c.get()).toBe('t3_x');
  });

  it('stands down when another tab holds the lock, and when Reddit refuses', async () => {
    const subs = addSub({}, POST, 2, 0);
    const locked = rig(subs, { lock: { tryAcquire: async () => false } });
    expect(await runCheck(locked.deps)).toBe('skipped');
    expect(locked.getJson).not.toHaveBeenCalled();

    const refused = rig(subs, {
      getJson: (async () => ({ ok: false, reason: 'backoff', message: 'paused' })) as never,
    });
    expect(await runCheck(refused.deps)).toBe('failed');
    expect(refused.onGrew).not.toHaveBeenCalled();
    expect(refused.saved()).toBe(subs);
  });

  it('keeps a thread the reader subscribed to while the request was running', async () => {
    const first = addSub({}, POST, 2, 0);
    const second = addSub(first, { ...POST, id: 't3_new', commentCount: 1 }, 2, 0);
    let calls = 0;
    const { deps, saved } = rig(first, { load: async () => (calls++ === 0 ? first : second) });
    await runCheck(deps);
    expect(Object.keys(saved()).sort()).toEqual(['t3_new', 't3_text1']);
  });

  it('drops watches that ended', async () => {
    const subs = addSub({}, POST, 1, 0);
    const { deps, getJson } = rig(subs, { now: () => 3 * DAY });
    expect(await runCheck(deps)).toBe('idle');
    expect(getJson).not.toHaveBeenCalled();
  });
});

describe('storageLock', () => {
  function area() {
    const mem: Record<string, unknown> = {};
    return {
      mem,
      get: async (k: string) => ({ [k]: mem[k] }),
      set: async (items: Record<string, unknown>) => void Object.assign(mem, items),
    };
  }

  it('lets one tab through and keeps the others out until the next period', async () => {
    const a = area();
    const one: CheckLock = storageLock('tab1', a, 0);
    const two: CheckLock = storageLock('tab2', a, 0);
    expect(await one.tryAcquire(100_000)).toBe(true);
    expect(await two.tryAcquire(100_500)).toBe(false);
    expect(await one.tryAcquire(200_000)).toBe(false); // it ran 100 s ago: not due yet
    expect(await two.tryAcquire(100_000 + 10 * 60_000)).toBe(true);
  });

  it('lets the later claim win when two tabs write together', async () => {
    const a = area();
    const one = storageLock('tab1', a, 5);
    const two = storageLock('tab2', a, 5);
    const results = await Promise.all([one.tryAcquire(1_000_000), two.tryAcquire(1_000_000)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe('threadSubscriptions module', () => {
  const stored = async (): Promise<SubMap | undefined> =>
    (await fakeBrowser.storage.local.get(SUBS_KEY))[SUBS_KEY] as SubMap | undefined;
  const button = () => document.querySelector<HTMLButtonElement>('.rescue-subscribe')!;

  it('adds a subscribe word to the post line and starts a watch when pressed', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([threadSubscriptions], { route, username: 'me_the_reader' });
    m.flush();
    await tick();
    expect(button().textContent).toBe('subscribe');
    expect(button().disabled).toBe(false);
    expect(button().title).toMatch(/^REScue: watch this thread for new comments for 2 days/);
    button().click();
    await tick();
    await tick();
    expect((await stored())!.t3_text1).toMatchObject({ lastCount: 1115, title: 'Got laid off' });
    expect((await stored())!.t3_text1!.expiresAt - Date.now()).toBeGreaterThan(2 * DAY - 5000);
    expect(button().textContent).toBe('unsubscribe');
    expect(button().title).toMatch(/stop watching/);
    button().click();
    await tick();
    await tick();
    expect(await stored()).toEqual({});
    m.dispose();
  });

  it('uses the subscription length option', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([threadSubscriptions], {
      route,
      username: 'me_the_reader',
      options: { threadSubscriptions: { subscriptionLength: 7 } },
    });
    m.flush();
    await tick();
    expect(button().title).toMatch(/for 7 days/);
    m.dispose();
  });

  it('is disabled with a sign-in hint when signed out, and the menu row says so', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([threadSubscriptions], { route, username: null });
    m.flush();
    await tick();
    expect(button().disabled).toBe(true);
    expect(button().title).toMatch(/sign in/i);
    button().click();
    await tick();
    expect(await stored()).toBeUndefined();
    expect(netFetch).not.toHaveBeenCalled();
    m.dispose();
  });

  it('shows nothing on a listing and when the option is off', async () => {
    mount(nestedThreadHtml());
    const off = await bootModules([threadSubscriptions], {
      route,
      username: 'me_the_reader',
      options: { threadSubscriptions: { showSubscribeButton: false } },
    });
    off.flush();
    await tick();
    expect(document.querySelector('.rescue-subscribe')).toBeNull();
    off.dispose();
    const listing = await bootModules([threadSubscriptions], {
      route: { kind: 'subreddit', path: '/r/x' },
      username: 'me_the_reader',
    });
    listing.flush();
    await tick();
    expect(document.querySelector('.rescue-subscribe')).toBeNull();
    listing.dispose();
  });

  it('checks on a timer, then says "N new comments in <title>" with an Open action and a badge', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'],
    });
    vi.mocked(netFetch).mockResolvedValue(
      jsonOk(commentsDoc({ id: 't3_text1', comments: 1120 }, [])) as never,
    );
    await fakeBrowser.storage.local.set({ [SUBS_KEY]: addSub({}, POST, 2, Date.now()) });
    const again = await bootModules([threadSubscriptions], {
      route: { kind: 'subreddit', path: '/r/x' },
      username: 'me_the_reader',
    });
    await vi.advanceTimersByTimeAsync(9000);
    await vi.advanceTimersByTimeAsync(1000);

    expect(netFetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(netFetch).mock.calls[0]!;
    expect(url).toBe('/comments/text1.json?raw_json=1&limit=1&depth=0');
    expect(init?.method).toBe('GET');
    const note = again.notices.find((n) => /new comments? in/.test(n.message));
    expect(note?.message).toBe('5 new comments in Got laid off');
    expect(note?.opts?.actions?.[0]?.label).toBe('Open');
    expect((await stored())!.t3_text1).toMatchObject({ lastCount: 1120, newCount: 5 });
    again.dispose();
  });

  it('sends no request when nothing is subscribed', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'],
    });
    const m = await bootModules([threadSubscriptions], { username: 'me_the_reader' });
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(netFetch).not.toHaveBeenCalled();
    m.dispose();
  });

  it('sends no request when signed out, even with a stored list', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'],
    });
    await fakeBrowser.storage.local.set({ [SUBS_KEY]: addSub({}, POST, 2, Date.now()) });
    const m = await bootModules([threadSubscriptions], { username: null });
    await vi.advanceTimersByTimeAsync(11 * 60_000);
    expect(netFetch).not.toHaveBeenCalled();
    m.dispose();
  });
});
