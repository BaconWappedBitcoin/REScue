import { afterEach, describe, expect, it } from 'vitest';
import {
  addRow,
  deleteRow,
  groupMembers,
  hasSubreddit,
  migrateRows,
  moveRow,
  removeSubreddit,
  shortcutHref,
  shortcutItems,
  sortRows,
  staticLinks,
  updateRow,
  type RawRow,
} from '../../src/modules/appearance/shortcutModel';
import { subredditManager } from '../../src/modules/appearance/subredditManager';
import {
  accountKey,
  mayRecordVisit,
  recordVisit,
  releaseAccounts,
  switchAccount,
} from '../../src/modules/appearance/shortcutVisits';
import { bootModules } from './module-harness';

afterEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((s) => s.remove());
});

const row = (target: string, label = '', addedAt = 1): RawRow => ({ target, label, addedAt });
const targets = (rows: RawRow[]) => rows.map((r) => r.target);

describe('shortcut model', () => {
  it('reads a+b as a group and keeps single subreddits and paths as before', () => {
    expect(shortcutHref('a_b+cd')).toBe('/r/a_b+cd/');
    expect(shortcutHref('r/aa+bb+cc')).toBe('/r/aa+bb+cc/');
    expect(shortcutHref('aa+')).toBeNull();
    expect(shortcutHref('aa+https://x.test')).toBeNull();
    expect(groupMembers('r/aa+bb')).toEqual(['aa', 'bb']);
    expect(groupMembers('aa')).toBeNull();
    const [item] = shortcutItems([row('aa+bb')]);
    expect(item).toMatchObject({ href: '/r/aa+bb/', text: 'aa+bb', members: ['aa', 'bb'] });
  });

  it('migrates rows without a date, keeping their order, and leaves dated rows alone', () => {
    const { rows, changed } = migrateRows([{ target: 'aa' }, row('bb', '', 5), { target: 'cc' }], 100);
    expect(changed).toBe(true);
    expect(rows.map((r) => r.addedAt)).toEqual([100, 5, 101]);
    const again = migrateRows(rows, 999);
    expect(again.changed).toBe(false);
    expect(again.rows).toEqual(rows);
  });

  it('adds, edits, deletes and moves rows without touching the input', () => {
    const start = [row('aa', '', 1), row('bb', '', 2), row('cc', '', 3)];
    const added = addRow(start, ' dd ', ' Dee ', 9);
    expect(added[3]).toEqual({ target: 'dd', label: 'Dee', addedAt: 9 });
    expect(updateRow(start, 1, 'xx', 'X')[1]).toEqual({ target: 'xx', label: 'X', addedAt: 2 });
    expect(targets(deleteRow(start, 0))).toEqual(['bb', 'cc']);
    expect(targets(moveRow(start, 0, 2))).toEqual(['bb', 'cc', 'aa']);
    expect(targets(moveRow(start, 2, 0))).toEqual(['cc', 'aa', 'bb']);
    expect(targets(moveRow(start, 1, 1))).toEqual(['aa', 'bb', 'cc']);
    expect(targets(start)).toEqual(['aa', 'bb', 'cc']);
  });

  it('sorts by name either way or by date added, with unusable rows last', () => {
    const rows = [row('Charlie', '', 3), row('https://x.test', '', 0), row('alpha', '', 9), row('Bravo', 'Zed', 1)];
    expect(targets(sortRows(rows, 'nameAsc'))).toEqual(['alpha', 'Charlie', 'Bravo', 'https://x.test']);
    expect(targets(sortRows(rows, 'nameDesc'))).toEqual(['Bravo', 'Charlie', 'alpha', 'https://x.test']);
    expect(targets(sortRows(rows, 'dateAsc'))).toEqual(['Bravo', 'Charlie', 'alpha', 'https://x.test']);
  });

  it('finds and removes a subreddit by exact match only', () => {
    const rows = [row('Pics'), row('pics+aww'), row('r/aww')];
    expect(hasSubreddit(rows, 'pics')).toBe(true);
    expect(hasSubreddit(rows, 'AWW')).toBe(true);
    expect(hasSubreddit(rows, 'cats')).toBe(false);
    expect(targets(removeSubreddit(rows, 'pics'))).toEqual(['pics+aww', 'r/aww']);
  });

  it('lists the static links that are on, and the signed-in ones only when signed in', () => {
    const on = {
      showDefaults: true,
      linkRandom: true,
      linkFriends: true,
      linkMod: true,
      linkModqueue: true,
      linkSaved: true,
    };
    const out = staticLinks(on, { signedIn: false, username: null });
    expect(out.map((l) => l.href)).toEqual(['/', '/r/all/', '/r/popular/', '/r/random/']);
    const me = staticLinks(on, { signedIn: true, username: 'some user' });
    expect(me.map((l) => l.href).slice(4)).toEqual([
      '/r/friends/',
      '/r/mod/',
      '/r/mod/about/modqueue/',
      '/user/some%20user/saved/',
    ]);
    expect(staticLinks({ ...on, showDefaults: false, linkRandom: false }, { signedIn: true, username: null }).map((l) => l.text)).toEqual(['Friends', 'Mod', 'Modqueue']);
  });
});

const BAR = '#rescue-subreddit-bar';
const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(`${BAR} ${sel}`);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(`${BAR} ${sel}`)];
const texts = () => qa('.rescue-sc a').map((a) => a.textContent);
const popup = () => document.getElementById('rescue-shortcut-popup');

async function boot(
  rows: RawRow[],
  extra: Record<string, boolean | number> = {},
  opts: {
    route?: Record<string, string>;
    username?: string;
    stored?: Record<string, unknown>;
    /** Leave the first draw (from init) as it is: no redraw with the unchanged options. */
    raw?: boolean;
  } = {},
) {
  const m = await bootModules([subredditManager], {
    route: { kind: 'front', path: '/', ...opts.route },
    username: opts.username ?? null,
    moduleStored: { subredditManager: opts.stored ?? {} },
    options: { subredditManager: { showDefaults: false, ...extra, subreddits: rows } },
  });
  await new Promise((r) => setTimeout(r, 0)); // what the bar remembered is read after its first draw
  const base = m.ctxs.get('subredditManager')!;
  const saves: RawRow[][] = [];
  const profile = { schemaVersion: 1, keybindings: {}, syncEnabled: false, modules: {} };
  const settings = {
    profile: () => profile,
    save: async (p: { modules: Record<string, { options?: { subreddits?: RawRow[] } }> }) => {
      saves.push(p.modules.subredditManager?.options?.subreddits ?? []);
    },
  };
  /** The settings come back with these rows, as they do after a real save. */
  const redraw = (next: RawRow[]) =>
    subredditManager.onSettings!({
      ...base,
      settings,
      options: { ...base.options, subreddits: next },
    } as never);
  if (!opts.raw) redraw(rows);
  saves.length = 0;
  return { m, saves, redraw, last: () => saves[saves.length - 1]! };
}

const submit = () => popup()!.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
const fill = (name: string, value: string) => {
  popup()!.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value = value;
};
const fire = (el: Element, type: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(new (type === 'keydown' ? KeyboardEvent : Event)(type, { bubbles: true, cancelable: true, ...init }));
const wrap = (i: number) => q(`.rescue-sc[data-index="${i}"]`)!;

const THREE = [row('aa', '', 1), row('bb', 'Bee', 2), row('cc', '', 3)];

describe('shortcut bar: edit, add and delete', () => {
  it('the hover edit control opens the popup, and saving writes the table option', async () => {
    const t = await boot(THREE);
    q('.rescue-sc-edit')!.click();
    expect(popup()).not.toBeNull();
    expect(popup()!.querySelector<HTMLInputElement>('input[name="target"]')!.value).toBe('aa');
    fill('target', 'r/newname');
    fill('label', 'New');
    submit();
    expect(popup()).toBeNull();
    expect(t.last()).toEqual([{ target: 'r/newname', label: 'New', addedAt: 1 }, THREE[1], THREE[2]]);
    t.redraw(t.last());
    expect(texts()).toEqual(['New', 'Bee', 'cc']);
    t.m.dispose();
  });

  it('right-clicking a link opens the same popup, with its values', async () => {
    const t = await boot(THREE);
    const ev = new Event('contextmenu', { bubbles: true, cancelable: true });
    q('.rescue-sc[data-index="1"] a')!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(popup()!.querySelector<HTMLInputElement>('input[name="label"]')!.value).toBe('Bee');
    t.m.dispose();
  });

  it('refuses a bad or duplicate target and keeps the popup open with a message', async () => {
    const t = await boot(THREE);
    q('.rescue-sc-edit')!.click();
    fill('target', 'https://evil.example');
    submit();
    expect(popup()!.querySelector('[role="alert"]')!.textContent).toMatch(/subreddit name/);
    fill('target', 'bb');
    submit();
    expect(popup()!.querySelector('[role="alert"]')!.textContent).toMatch(/already/);
    fill('target', 'aa'); // its own value is fine
    submit();
    expect(t.saves).toHaveLength(1);
    t.m.dispose();
  });

  it('+ opens an empty popup and adds a dated row', async () => {
    const t = await boot(THREE);
    q('[data-rescue-new]')!.click();
    expect(popup()!.querySelector<HTMLInputElement>('input[name="target"]')!.value).toBe('');
    expect(popup()!.querySelector('[data-rescue-delete]')).toBeNull();
    fill('target', 'pics+aww');
    fill('label', 'Cute');
    submit();
    const added = t.last()[3]!;
    expect(added).toMatchObject({ target: 'pics+aww', label: 'Cute' });
    expect(typeof added.addedAt).toBe('number');
    expect(t.last()).toHaveLength(4);
    t.m.dispose();
  });

  it('the popup closes on Escape without saving', async () => {
    const t = await boot(THREE);
    q('[data-rescue-new]')!.click();
    fire(popup()!.querySelector('input')!, 'keydown', { key: 'Escape' });
    expect(popup()).toBeNull();
    expect(t.saves).toHaveLength(0);
    t.m.dispose();
  });

  it('delete in the popup removes just that row', async () => {
    const t = await boot(THREE);
    wrap(1).querySelector<HTMLElement>('.rescue-sc-edit')!.click();
    popup()!.querySelector<HTMLElement>('[data-rescue-delete]')!.click();
    expect(popup()).toBeNull();
    expect(targets(t.last())).toEqual(['aa', 'cc']);
    t.m.dispose();
  });

  it('deleting the last shortcut leaves the bar with its + so another can be added', async () => {
    const t = await boot([row('aa')]);
    q('.rescue-sc-edit')!.click();
    popup()!.querySelector<HTMLElement>('[data-rescue-delete]')!.click();
    expect(t.last()).toEqual([]);
    t.redraw([]);
    expect(q('[data-rescue-new]')).not.toBeNull();
    t.m.dispose();
  });

  it('puts typed text in as text, never as markup', async () => {
    const t = await boot([row('aa', '<img src=x onerror=alert(1)>')]);
    expect(document.querySelector('img')).toBeNull();
    expect(q('.rescue-sc a')!.textContent).toBe('<img src=x onerror=alert(1)>');
    q('.rescue-sc-edit')!.click();
    expect(document.querySelector('img')).toBeNull();
    t.m.dispose();
  });
});

describe('shortcut bar: reorder, sort, groups and the rest', () => {
  it('dragging a link onto another moves it there', async () => {
    const t = await boot(THREE);
    fire(wrap(0), 'dragstart');
    expect(q('.rescue-sc-trash')!.hasAttribute('hidden')).toBe(false);
    fire(wrap(2), 'dragover');
    fire(wrap(2), 'drop');
    fire(wrap(0), 'dragend');
    expect(targets(t.last())).toEqual(['bb', 'cc', 'aa']);
    expect(q('.rescue-sc-trash')!.hasAttribute('hidden')).toBe(true);
    t.m.dispose();
  });

  it('dropping a link on the delete zone deletes it', async () => {
    const t = await boot(THREE);
    fire(wrap(1), 'dragstart');
    fire(q('.rescue-sc-trash')!, 'dragover');
    fire(q('.rescue-sc-trash')!, 'drop');
    expect(targets(t.last())).toEqual(['aa', 'cc']);
    t.m.dispose();
  });

  it('a drop with nothing being dragged does nothing', async () => {
    const t = await boot(THREE);
    fire(wrap(1), 'drop');
    fire(q('.rescue-sc-trash')!, 'drop');
    expect(t.saves).toHaveLength(0);
    t.m.dispose();
  });

  it('Alt+arrows move the focused link, which keeps the focus after the redraw', async () => {
    const t = await boot(THREE);
    const second = q('.rescue-sc[data-index="1"] a')!;
    fire(second, 'keydown', { key: 'ArrowRight', altKey: true });
    expect(targets(t.last())).toEqual(['aa', 'cc', 'bb']);
    t.redraw(t.last());
    expect(texts()).toEqual(['aa', 'cc', 'Bee']);
    expect(document.activeElement).toBe(q('.rescue-sc[data-index="2"] a'));
    fire(q('.rescue-sc[data-index="0"] a')!, 'keydown', { key: 'ArrowLeft', altKey: true });
    expect(t.saves).toHaveLength(1); // already first: nothing to do
    fire(q('.rescue-sc[data-index="0"] a')!, 'keydown', { key: 'ArrowRight' });
    expect(t.saves).toHaveLength(1); // Alt is needed
    t.m.dispose();
  });

  it('the sort menu orders by name either way or by date added', async () => {
    const rows = [row('cc', '', 5), row('aa', '', 9), row('bb', '', 1)];
    const t = await boot(rows);
    const pick = (mode: string) => {
      q('[data-rescue-sort]')!.click();
      expect(q('[data-rescue-sort-menu]')!.hasAttribute('hidden')).toBe(false);
      q(`[data-sort="${mode}"]`)!.click();
      expect(q('[data-rescue-sort-menu]')!.hasAttribute('hidden')).toBe(true);
      return targets(t.last());
    };
    expect(pick('nameAsc')).toEqual(['aa', 'bb', 'cc']);
    expect(pick('nameDesc')).toEqual(['cc', 'bb', 'aa']);
    expect(pick('dateAsc')).toEqual(['bb', 'cc', 'aa']);
    t.m.dispose();
  });

  it('a group link lists its subreddits on hover, and hides them after', async () => {
    const t = await boot([row('aa'), row('pics+aww+cats', 'Mix')], { shortcutDropdownDelay: 20 });
    const menu = () => q('.rescue-sc-menu[role="menu"]:not([data-rescue-sort-menu])')!;
    expect(menu().hasAttribute('hidden')).toBe(true);
    expect(wrap(0).className).not.toContain('rescue-sc-group');
    fire(wrap(1), 'mouseenter');
    // Hovering waits for the dropdown delay (RES shortcutDropdownDelay); the keyboard does not.
    expect(menu().hasAttribute('hidden')).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(menu().hasAttribute('hidden')).toBe(false);
    expect([...menu().querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['r/pics', '/r/pics/'],
      ['r/aww', '/r/aww/'],
      ['r/cats', '/r/cats/'],
    ]);
    fire(menu(), 'mouseleave');
    expect(menu().hasAttribute('hidden')).toBe(true);
    t.m.dispose();
  });

  it('the on-page button toggles: add when absent, remove when present', async () => {
    const route = { kind: 'subreddit', path: '/r/pics', subreddit: 'pics' };
    const t = await boot([row('aa')], {}, { route });
    const btn = () => q('[data-rescue-toggle]')!;
    expect(btn().textContent).toBe('+shortcut');
    btn().click();
    expect(t.last().map((r) => r.target)).toEqual(['aa', 'r/pics']);
    t.redraw(t.last());
    expect(btn().textContent).toBe('−shortcut');
    expect(btn().getAttribute('data-rescue-toggle')).toBe('remove');
    btn().click();
    expect(targets(t.last())).toEqual(['aa']);
    t.m.dispose();
  });

  it('the toggle can be switched off, and is absent outside subreddits', async () => {
    const route = { kind: 'subreddit', path: '/r/pics', subreddit: 'pics' };
    const off = await boot([row('aa')], { showAddCurrent: false }, { route });
    expect(q('[data-rescue-toggle]')).toBeNull();
    off.m.dispose();
    const front = await boot([row('aa')]);
    expect(q('[data-rescue-toggle]')).toBeNull();
    front.m.dispose();
  });

  it('shows the optional static links before your own, with Saved from the session name', async () => {
    const t = await boot(
      [row('aa')],
      { showDefaults: true, linkRandom: true, linkFriends: true, linkMod: true, linkModqueue: true, linkSaved: true },
      { username: 'rockpaperblr' },
    );
    const hrefs = qa('.rescue-sc-viewport > a').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/',
      '/r/all/',
      '/r/popular/',
      '/r/random/',
      '/r/friends/',
      '/r/mod/',
      '/r/mod/about/modqueue/',
      '/user/rockpaperblr/saved/',
    ]);
    expect(qa('.rescue-sc-edit')).toHaveLength(1); // only your own links are editable
    t.m.dispose();
  });

  it('shows scroll arrows only while the list overflows', async () => {
    const t = await boot(THREE);
    const vp = q('.rescue-sc-viewport')!;
    const left = q('[data-dir="left"]')!;
    const right = q('[data-dir="right"]')!;
    expect(left.hasAttribute('hidden') && right.hasAttribute('hidden')).toBe(true);
    Object.defineProperty(vp, 'clientWidth', { configurable: true, value: 100 });
    Object.defineProperty(vp, 'scrollWidth', { configurable: true, value: 400 });
    fire(vp, 'scroll');
    expect(left.hasAttribute('hidden')).toBe(true);
    expect(right.hasAttribute('hidden')).toBe(false);
    right.click();
    expect(vp.scrollLeft).toBeGreaterThan(0);
    fire(vp, 'scroll');
    expect(left.hasAttribute('hidden')).toBe(false);
    t.m.dispose();
  });
});

describe('shortcut bar: dated rows', () => {
  it('saves a date onto rows that have none, once, and shows them in their order', async () => {
    const m = await bootModules([subredditManager], {
      options: {
        subredditManager: { showDefaults: false, subreddits: [{ target: 'aa' }, { target: 'bb' }] },
      },
    });
    const base = m.ctxs.get('subredditManager')!;
    const saves: RawRow[][] = [];
    const settings = {
      profile: () => ({ schemaVersion: 1, keybindings: {}, syncEnabled: false, modules: {} }),
      save: async (p: { modules: Record<string, { options?: { subreddits?: RawRow[] } }> }) => {
        saves.push(p.modules.subredditManager!.options!.subreddits!);
      },
    };
    subredditManager.onSettings!({ ...base, settings } as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(saves).toHaveLength(1);
    expect(saves[0]!.map((r) => r.target)).toEqual(['aa', 'bb']);
    expect(saves[0]!.every((r) => typeof r.addedAt === 'number')).toBe(true);
    expect(saves[0]![0]!.addedAt as number).toBeLessThan(saves[0]![1]!.addedAt as number);
    expect(texts()).toEqual(['aa', 'bb']);
    // Dated rows come back from the save: no second save.
    subredditManager.onSettings!({
      ...base,
      settings,
      options: { ...base.options, subreddits: saves[0]! },
    } as never);
    await new Promise((r) => setTimeout(r, 0));
    expect(saves).toHaveLength(1);
    m.dispose();
  });
});

describe('T147 shortcut bar options', () => {
  const storeOf = (m: Awaited<ReturnType<typeof boot>>['m']) => m.moduleStore.subredditManager ?? {};

  it('lists RandNSFW and the dashboard word only when asked', () => {
    const base = { showDefaults: false, linkRandom: false, linkFriends: false, linkMod: false, linkModqueue: false, linkSaved: false };
    const none = { signedIn: false, username: null };
    expect(staticLinks(base, none)).toEqual([]);
    expect(staticLinks({ ...base, linkRandNSFW: true }, none)).toEqual([{ text: 'RandNSFW', href: '/r/randnsfw/' }]);
    expect(staticLinks({ ...base, linkDashboard: true }, none)).toEqual([{ text: 'Dashboard', href: '#rescue:dashboard' }]);
  });

  it('sorts by last visited, most recent first, never-visited ones after in their order', () => {
    const rows = [row('aa'), row('bb'), row('cc'), row('dd+ee')];
    const visits = { cc: 30, aa: 20, ee: 99 };
    expect(targets(sortRows(rows, 'visitDesc', visits))).toEqual(['dd+ee', 'cc', 'aa', 'bb']);
    expect(targets(sortRows(rows, 'visitDesc', {}))).toEqual(['aa', 'bb', 'cc', 'dd+ee']);
  });

  it('offers the last visited sort only while visits are remembered', async () => {
    const on = await boot([row('aa')]);
    q('[data-rescue-sort]')!.click();
    expect(q('[data-sort="visitDesc"]')).not.toBeNull();
    on.m.dispose();
    document.body.innerHTML = '';
    const off = await boot([row('aa')], { storeSubredditVisit: false });
    q('[data-rescue-sort]')!.click();
    expect(q('[data-sort="visitDesc"]')).toBeNull();
    off.m.dispose();
  });

  it('the last visited sort uses what was recorded', async () => {
    const t = await boot([row('aa'), row('bb'), row('cc')], {}, { stored: { visits: { cc: 30, aa: 20 } } });
    q('[data-rescue-sort]')!.click();
    q('[data-sort="visitDesc"]')!.click();
    expect(targets(t.last())).toEqual(['cc', 'aa', 'bb']);
    t.m.dispose();
  });

  it('records the subreddit on the page, and nothing when visits are off or it is not a subreddit', async () => {
    const route = { kind: 'subreddit', path: '/r/Pics', subreddit: 'Pics' };
    const on = await boot([row('aa')], {}, { route });
    expect(Object.keys((storeOf(on.m).visits ?? {}) as object)).toEqual(['pics']);
    on.m.dispose();
    const off = await boot([row('aa')], { storeSubredditVisit: false }, { route });
    expect(storeOf(off.m).visits).toBeUndefined();
    off.m.dispose();
    const front = await boot([row('aa')]);
    expect(storeOf(front.m).visits).toBeUndefined();
    front.m.dispose();
  });

  it('shows capitals when lowercase is not allowed, and sets the edit delay', async () => {
    const t = await boot([row('aa')], { allowLowercase: false, shortcutEditDropdownDelay: 700 });
    const bar = document.querySelector<HTMLElement>(BAR)!;
    expect(bar.hasAttribute('data-rescue-uppercase')).toBe(true);
    expect(bar.style.getPropertyValue('--rescue-sc-edit-delay')).toBe('700ms');
    t.m.dispose();
    document.body.innerHTML = '';
    const plain = await boot([row('aa')]);
    expect(document.querySelector(BAR)!.hasAttribute('data-rescue-uppercase')).toBe(false);
    plain.m.dispose();
  });

  it('keeps a list per account: another account gets its own, the first keeps what it had', async () => {
    // Bob was the last account; Alice signs in and has her own saved list.
    const t = await boot(
      [row('bobs')],
      {},
      { username: 'Alice', raw: true, stored: { accounts: { current: 'bob', lists: { alice: [row('alices')] } } } },
    );
    expect(texts()).toEqual(['alices']);
    const state = storeOf(t.m).accounts as { current: string; lists: Record<string, RawRow[]> };
    expect(state.current).toBe('alice');
    expect(targets(state.lists.bob!)).toEqual(['bobs']);
    t.m.dispose();
  });

  it('a new account starts empty, and with per-account lists off the list is shared', async () => {
    const t = await boot([row('bobs')], {}, { username: 'Cy', raw: true, stored: { accounts: { current: 'bob', lists: {} } } });
    expect(texts()).toEqual([]);
    t.m.dispose();
    document.body.innerHTML = '';
    const shared = await boot(
      [row('bobs')],
      { shortcutsPerAccount: false },
      { username: 'Cy', raw: true, stored: { accounts: { current: 'bob', lists: {} } } },
    );
    expect(texts()).toEqual(['bobs']);
    shared.m.dispose();
  });
});

describe('shortcutVisits', () => {
  it('records lower-cased subreddit names only and keeps the newest 500', () => {
    expect(recordVisit({}, 'Pics', 5)).toEqual({ pics: 5 });
    expect(recordVisit({ a: 1 }, 'a+b', 5)).toEqual({ a: 1 });
    expect(recordVisit({ a: 1 }, undefined, 5)).toEqual({ a: 1 });
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`s${i}`, i + 1]));
    const next = recordVisit(many, 'fresh', 9999);
    expect(Object.keys(next)).toHaveLength(500);
    expect(next.fresh).toBe(9999);
    expect(next.s0).toBeUndefined();
  });

  it('private windows need their own opt-in', () => {
    const o = { storeSubredditVisit: true, storeSubredditVisitIncognito: false };
    expect(mayRecordVisit(o, false)).toBe(true);
    expect(mayRecordVisit(o, true)).toBe(false);
    expect(mayRecordVisit({ ...o, storeSubredditVisitIncognito: true }, true)).toBe(true);
    expect(mayRecordVisit({ ...o, storeSubredditVisit: false }, false)).toBe(false);
  });

  it('switches accounts: first claims, a change swaps lists, the same account leaves the option alone', () => {
    const mine = [row('a')];
    const first = switchAccount({ lists: {} }, 'alice', mine);
    expect(first.rows).toBeNull();
    expect(first.state).toEqual({ current: 'alice', lists: { alice: mine } });
    const same = switchAccount(first.state, 'alice', [row('a'), row('b')]);
    expect(same.rows).toBeNull();
    expect(targets(same.state.lists.alice!)).toEqual(['a', 'b']);
    const other = switchAccount(same.state, 'bob', [row('a'), row('b')]);
    expect(other.rows).toEqual([]);
    expect(targets(other.state.lists.alice!)).toEqual(['a', 'b']);
    const back = switchAccount({ current: 'bob', lists: other.state.lists }, 'alice', [row('z')]);
    expect(targets(back.rows!)).toEqual(['a', 'b']);
    expect(targets(back.state.lists.bob!)).toEqual(['z']);
    expect(releaseAccounts(back.state)).toEqual({ lists: back.state.lists });
    expect(accountKey({ signedIn: true, username: 'Alice' })).toBe('alice');
    expect(accountKey({ signedIn: false, username: null })).toBe('');
  });
});

describe('shortcut bar style', () => {
  it('sizes the fixed bar from the viewport without the scrollbar (no vw units)', async () => {
    const { STYLE } = await import('../../src/modules/appearance/shortcutStyle');
    expect(STYLE).not.toMatch(/\dvw/);
    expect(STYLE).toContain('box-sizing:border-box');
  });
});
