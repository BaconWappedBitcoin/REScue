import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedJsonClient, type BoundGetJson, type MineSub } from '../../src/core/redditJson';
import { subredditManager } from '../../src/modules/appearance/subredditManager';
import {
  fetchSubscriptions,
  filterSubs,
  forgetMine,
  importRows,
  targetOf,
  MINE_TTL_MS,
} from '../../src/modules/appearance/shortcutMine';
import { addSub, applyCounts, type SubMap } from '../../src/modules/comments/subscriptionModel';
import {
  closeSubscriptions,
  openSubscriptions,
} from '../../src/modules/comments/subscriptionPanel';
import { planImport, runImportBlocked } from '../../src/modules/users/blockedImport';
import { userTagger } from '../../src/modules/users/userTagger';
import { sanitizeTags, type UserTags } from '../../src/modules/users/tagStore';
import { blockedList, minePage } from '../fixtures/redditJson';
import { bootModules, tick } from './module-harness';

vi.mock('../../src/core/net', async (orig) => ({
  ...(await orig<typeof import('../../src/core/net')>()),
  netFetch: vi.fn(),
}));
import { netFetch } from '../../src/core/net';

const jsonOk = (body: unknown) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  text: async () => JSON.stringify(body),
});
const settle = async (n = 6) => {
  for (let i = 0; i < n; i++) await tick();
};

beforeEach(() => {
  sharedJsonClient.reset();
  forgetMine();
  vi.mocked(netFetch).mockReset();
});
afterEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((s) => s.remove());
});

const sub = (name: string, extra: Partial<MineSub> = {}): MineSub => ({
  name,
  prefixed: `r/${name}`,
  url: `/r/${name}/`,
  over18: false,
  subscribers: 100,
  ...extra,
});

describe('Subscriptions panel', () => {
  const POST = {
    id: 't3_a',
    title: 'First thread',
    permalink: '/r/x/comments/a/first/',
    subreddit: 'x',
    commentCount: 10,
  };

  function host(initial: SubMap) {
    let subs = initial;
    return {
      load: async () => subs,
      unsubscribe: vi.fn(async (id: string) => void delete (subs = { ...subs })[id]),
      clearNew: vi.fn(
        async () =>
          void (subs = Object.fromEntries(
            Object.entries(subs).map(([k, v]) => [k, { ...v, newCount: 0 }]),
          )),
      ),
    };
  }

  it('lists threads with a badge for new comments, newest news first, and hover texts', async () => {
    let subs = addSub(addSub({}, POST, 2, 0), { ...POST, id: 't3_b', title: 'Second' }, 2, 0);
    subs = applyCounts(subs, [
      {
        id: 't3_b',
        title: null,
        numComments: 14,
        locked: false,
        saved: false,
        hidden: false,
        likes: null,
        score: 0,
      },
    ]).subs;
    openSubscriptions(host(subs));
    await settle();
    const rows = [...document.querySelectorAll('.rescue-subs-row')];
    expect(rows.map((r) => r.getAttribute('data-sub'))).toEqual(['t3_b', 't3_a']);
    const badge = rows[0]!.querySelector('.rescue-subs-badge')!;
    expect(badge.textContent).toBe('4 new comments');
    expect(badge.getAttribute('title')).toMatch(/^REScue: 4 new comments since you last opened/);
    expect(rows[1]!.querySelector('.rescue-subs-badge')).toBeNull();
    const link = rows[0]!.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('/r/x/comments/a/first/');
    expect(link.title).toMatch(/^REScue: open “Second”/);
    closeSubscriptions();
    expect(document.getElementById('rescue-subscriptions')).toBeNull();
  });

  it('unsubscribe and clear go through the host, and Escape closes', async () => {
    const h = host(
      applyCounts(addSub({}, POST, 2, 0), [
        {
          id: 't3_a',
          title: null,
          numComments: 12,
          locked: false,
          saved: false,
          hidden: false,
          likes: null,
          score: 0,
        },
      ]).subs,
    );
    openSubscriptions(h);
    await settle();
    expect(document.querySelector('.rescue-subs-badge')).not.toBeNull();
    [...document.querySelectorAll<HTMLButtonElement>('#rescue-subscriptions button')]
      .find((b) => b.textContent === 'clear')!
      .click();
    await settle();
    expect(h.clearNew).toHaveBeenCalled();
    expect(document.querySelector('.rescue-subs-badge')).toBeNull();
    [...document.querySelectorAll<HTMLButtonElement>('#rescue-subscriptions button')]
      .find((b) => b.textContent === 'unsubscribe')!
      .click();
    await settle();
    expect(h.unsubscribe).toHaveBeenCalledWith('t3_a');
    expect(document.querySelector('.rescue-subs-row')).toBeNull();
    expect(document.getElementById('rescue-subscriptions')!.textContent).toMatch(/not subscribed/);
    document
      .getElementById('rescue-subscriptions')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('rescue-subscriptions')).toBeNull();
  });
});

describe('my subreddits: reading, filtering, importing', () => {
  it('reads every page, de-duplicates, sorts, and keeps the list for an hour', async () => {
    const pages = [
      {
        ok: true as const,
        cached: false,
        data: { subs: [sub('zeta'), sub('Alpha')], after: 't5_next' },
      },
      {
        ok: true as const,
        cached: false,
        data: { subs: [sub('alpha'), sub('beta')], after: null },
      },
    ];
    const getJson = vi.fn(async () => pages.shift()!) as unknown as BoundGetJson &
      ReturnType<typeof vi.fn>;
    const clock = { t: 0 };
    const first = await fetchSubscriptions(getJson, false, () => clock.t);
    expect(first.ok && first.subs.map((s) => s.name)).toEqual(['Alpha', 'beta', 'zeta']);
    expect(getJson).toHaveBeenNthCalledWith(1, 'mine', { limit: 100 }, expect.anything());
    expect(getJson).toHaveBeenNthCalledWith(
      2,
      'mine',
      { limit: 100, after: 't5_next' },
      expect.anything(),
    );
    await fetchSubscriptions(getJson, false, () => clock.t + MINE_TTL_MS - 1);
    expect(getJson).toHaveBeenCalledTimes(2);
    pages.push({ ok: true, cached: false, data: { subs: [sub('only')], after: null } });
    const later = await fetchSubscriptions(getJson, false, () => clock.t + MINE_TTL_MS + 1);
    expect(later.ok && later.subs.map((s) => s.name)).toEqual(['only']);
  });

  it('returns the failure message when Reddit refuses a page', async () => {
    const getJson = vi.fn(async () => ({
      ok: false,
      reason: 'backoff',
      message: 'paused until 10:10',
    })) as never;
    expect(await fetchSubscriptions(getJson)).toEqual({ ok: false, message: 'paused until 10:10' });
  });

  it('filters by name, ignoring case and a leading r/', () => {
    const subs = [sub('aww'), sub('AskScience'), sub('pics')];
    expect(filterSubs(subs, 'AS').map((s) => s.name)).toEqual(['AskScience']);
    expect(filterSubs(subs, 'r/aw').map((s) => s.name)).toEqual(['aww']);
    expect(filterSubs(subs, '  ')).toHaveLength(3);
  });

  it('import adds only what the bar lacks, and keeps profiles as u/name', () => {
    const rows = [{ target: 'r/Pics', label: '', addedAt: 1 }];
    const prof = sub('u_me', { prefixed: 'u/me', url: '/user/me/' });
    expect(targetOf(prof)).toBe('u/me');
    const res = importRows(rows, [sub('pics'), sub('aww'), prof, sub('aww')], 100);
    expect(res).toMatchObject({ added: 2, skipped: 2 });
    expect(res.rows.map((r) => r.target)).toEqual(['r/Pics', 'aww', 'u/me']);
    expect(res.rows[1]).toMatchObject({ label: '', addedAt: 101 });
  });
});

describe('my subreddits on the shortcut bar', () => {
  async function boot(username: string | null, extra: Record<string, boolean> = {}) {
    const rows = [{ target: 'pics', label: '', addedAt: 1 }];
    const m = await bootModules([subredditManager], {
      route: { kind: 'front', path: '/' },
      username,
      options: { subredditManager: { showDefaults: false, subreddits: rows, ...extra } },
    });
    const base = m.ctxs.get('subredditManager')!;
    const saves: Array<Array<Record<string, unknown>>> = [];
    const settings = {
      profile: () => ({ schemaVersion: 1, keybindings: {}, syncEnabled: false, modules: {} }),
      save: async (p: { modules: { subredditManager: { options: { subreddits: never[] } } } }) => {
        saves.push(p.modules.subredditManager.options.subreddits);
      },
    };
    subredditManager.onSettings!({ ...base, settings } as never);
    return { m, saves };
  }
  const mineBtn = () => document.querySelector<HTMLButtonElement>('[data-rescue-mine]');
  const popup = () => document.getElementById('rescue-mine-popup');

  it('lists subscriptions from one read-only request, with a search box and hover texts', async () => {
    vi.mocked(netFetch).mockResolvedValue(
      jsonOk(
        minePage([
          { name: 'aww', subscribers: 5000 },
          { name: 'AskScience' },
          { name: 'pics', over18: false },
        ]),
      ) as never,
    );
    const t = await boot('me_the_reader');
    expect(mineBtn()!.textContent).toBe('my subreddits');
    expect(mineBtn()!.disabled).toBe(false);
    expect(mineBtn()!.title).toMatch(/^REScue: list the subreddits you subscribe to/);
    mineBtn()!.click();
    await settle();
    expect(netFetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(netFetch).mock.calls[0]!;
    expect(url).toBe('/subreddits/mine.json?raw_json=1&limit=100');
    expect(init?.method).toBe('GET');
    expect(
      [...popup()!.querySelectorAll('.rescue-mine-row')].map((r) => r.getAttribute('data-sub')),
    ).toEqual(['AskScience', 'aww', 'pics']);
    expect(popup()!.querySelector('a')!.title).toBe('REScue: go to r/AskScience');
    const search = popup()!.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'ask';
    search.dispatchEvent(new Event('input'));
    expect(popup()!.querySelectorAll('.rescue-mine-row')).toHaveLength(1);
    expect(popup()!.textContent).toMatch(/1 of 3 match/);
    t.m.dispose();
  });

  it('imports the ticked subreddits that are not in the bar yet', async () => {
    vi.mocked(netFetch).mockResolvedValue(
      jsonOk(minePage([{ name: 'aww' }, { name: 'pics' }, { name: 'space' }])) as never,
    );
    const t = await boot('me_the_reader');
    mineBtn()!.click();
    await settle();
    const tick1 = (name: string) =>
      popup()!.querySelector<HTMLInputElement>(`[data-sub="${name}"] input`)!.click();
    const importBtn = () =>
      [...popup()!.querySelectorAll('button')].find((b) => b.textContent!.startsWith('import'))!;
    expect(importBtn().disabled).toBe(true);
    expect(importBtn().title).toMatch(/tick subreddits first/);
    tick1('aww');
    tick1('pics');
    tick1('space');
    expect(importBtn().disabled).toBe(false);
    expect(importBtn().textContent).toBe('import (3)');
    expect(importBtn().title).toBe('REScue: add the 3 selected subreddits to this bar');
    importBtn().click();
    await settle();
    expect(t.saves).toHaveLength(1);
    expect(t.saves[0]!.map((r) => r.target)).toEqual(['pics', 'aww', 'space']);
    expect(popup()!.textContent).toMatch(/Added 2, 1 already in the bar/);
    t.m.dispose();
  });

  it('is disabled with a sign-in hint when signed out and sends no request', async () => {
    const t = await boot(null);
    expect(mineBtn()!.disabled).toBe(true);
    expect(mineBtn()!.title).toMatch(/sign in/i);
    mineBtn()!.click();
    await settle();
    expect(popup()).toBeNull();
    expect(netFetch).not.toHaveBeenCalled();
    t.m.dispose();
  });

  it('can be switched off, and shows Reddit’s refusal in the dropdown', async () => {
    const off = await boot('me_the_reader', { showMySubreddits: false });
    expect(mineBtn()).toBeNull();
    off.m.dispose();
    vi.mocked(netFetch).mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => null },
      text: async () => '',
    } as never);
    const on = await boot('me_the_reader');
    mineBtn()!.click();
    await settle();
    expect(popup()!.textContent).toMatch(/Reddit answered 429/);
    on.m.dispose();
  });
});

describe('blocked users import', () => {
  const tagsOf = (names: Record<string, boolean>): UserTags =>
    sanitizeTags(
      Object.fromEntries(
        Object.entries(names).map(([n, ignored]) => [
          n.toLowerCase(),
          { username: n, ignored, votesUp: 0, votesDown: 0, updatedAt: 1 },
        ]),
      ),
    );

  it('plans only users that are not ignored yet, leaving out yourself and repeats', () => {
    const plan = planImport(
      tagsOf({ Spammer: true, Friend: false }),
      ['spammer', 'Troll', 'troll', 'Me', 'Friend'],
      'me',
    );
    expect(plan).toEqual({ toIgnore: ['Troll', 'Friend'], already: 1 });
  });

  const preview = () => document.getElementById('rescue-blocked-preview');
  const press = (cls: string) => preview()!.querySelector<HTMLButtonElement>(cls)!.click();

  async function flow(
    username: string | null,
    names: string[],
    stored: Record<string, unknown> = {},
  ) {
    vi.mocked(netFetch).mockResolvedValue(jsonOk(blockedList(names)) as never);
    const m = await bootModules([userTagger], { username, stored });
    const ctx = m.ctxs.get('userTagger')!;
    const ignore = vi.fn(async () => {});
    const done = runImportBlocked(ctx, ignore);
    return { m, ignore, done, ctx };
  }

  it('shows a preview and ignores nobody until the reader confirms', async () => {
    const t = await flow('me_the_reader', ['troll', 'spam']);
    await settle();
    expect(preview()!.textContent).toMatch(/You blocked 2 users on Reddit/);
    expect([...preview()!.querySelectorAll('li')].map((l) => l.textContent)).toEqual([
      'u/troll',
      'u/spam',
    ]);
    expect(preview()!.querySelector('.rescue-blocked-confirm')!.getAttribute('title')).toBe(
      'REScue: ignore 2 users in REScue (Reddit itself is not changed)',
    );
    expect(t.ignore).not.toHaveBeenCalled();
    press('.rescue-blocked-confirm');
    await t.done;
    expect(t.ignore).toHaveBeenCalledWith(t.ctx, ['troll', 'spam']);
    expect(t.m.notices.at(-1)!.message).toMatch(/2 blocked users are now ignored/);
    t.m.dispose();
  });

  it('cancel changes nothing', async () => {
    const t = await flow('me_the_reader', ['troll']);
    await settle();
    press('.rescue-blocked-cancel');
    await t.done;
    expect(t.ignore).not.toHaveBeenCalled();
    expect(preview()).toBeNull();
    t.m.dispose();
  });

  it('says so when there is nothing to do, or when signed out (no request)', async () => {
    const none = await flow('me_the_reader', []);
    await none.done;
    expect(none.m.notices.at(-1)!.message).toMatch(/not blocked anyone/);
    none.m.dispose();
    const all = await flow('me_the_reader', ['troll'], { userTags: tagsOf({ troll: true }) });
    await all.done;
    expect(all.m.notices.at(-1)!.message).toMatch(/already ignored/);
    all.m.dispose();
    vi.mocked(netFetch).mockClear();
    const out = await flow(null, ['troll']);
    await out.done;
    expect(out.m.notices.at(-1)!.message).toMatch(/sign in/);
    expect(netFetch).not.toHaveBeenCalled();
    expect(preview()).toBeNull();
    out.m.dispose();
  });

  it('reports a read failure instead of changing anything', async () => {
    vi.mocked(netFetch).mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => null },
      text: async () => '',
    } as never);
    const m = await bootModules([userTagger], { username: 'me_the_reader' });
    const ignore = vi.fn();
    await runImportBlocked(m.ctxs.get('userTagger')!, ignore);
    expect(ignore).not.toHaveBeenCalled();
    expect(m.notices.some((n) => n.opts?.kind === 'error')).toBe(true);
    m.dispose();
  });

  it('the userTagger action sets ignored on the new users only, after the confirm', async () => {
    vi.mocked(netFetch).mockResolvedValue(
      jsonOk(blockedList(['Troll', 'me_the_reader', 'Old'])) as never,
    );
    const m = await bootModules([userTagger], {
      username: 'me_the_reader',
      stored: { userTags: tagsOf({ Old: true }) },
    });
    const action = userTagger.actions!.find((a) => a.id === 'importBlocked')!;
    expect(action.label).toMatch(/blocked users as ignored/);
    const done = action.run(m.ctxs.get('userTagger')!);
    await settle();
    expect(preview()!.querySelectorAll('li')).toHaveLength(1);
    press('.rescue-blocked-confirm');
    await done;
    const tags = m.store.userTags as UserTags;
    expect(tags.troll).toMatchObject({ username: 'Troll', ignored: true });
    expect(tags.old!.ignored).toBe(true);
    expect(tags.me_the_reader).toBeUndefined();
    m.dispose();
  });

  it('the tagged-users manager has the button, disabled with a sign-in hint when signed out', async () => {
    for (const [user, enabled] of [
      ['me_the_reader', true],
      [null, false],
    ] as const) {
      const m = await bootModules([userTagger], { username: user });
      const manage = userTagger.actions!.find((a) => a.id === 'manage')!;
      await manage.run(m.ctxs.get('userTagger')!);
      await settle();
      const btn = document.querySelector<HTMLButtonElement>('.rescue-tags-import-blocked')!;
      expect(btn.textContent).toBe('import blocked');
      expect(btn.disabled).toBe(!enabled);
      expect(btn.title).toMatch(enabled ? /read the users you blocked/ : /sign in/);
      document.querySelector<HTMLButtonElement>('.rescue-tags-close')!.click();
      m.dispose();
    }
  });
});
