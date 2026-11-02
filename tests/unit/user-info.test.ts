import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { userOfHref, userInfoTarget } from '../../src/model/userInfoTarget';
import { setTaggerApi, type TaggerApi } from '../../src/modules/users/taggerApi';
import { cleanDelay, userInfo } from '../../src/modules/users/userInfo';
import {
  NOT_FOUND_TEXT,
  UNAVAILABLE_TEXT,
  karmaText,
  placeCard,
  sinceText,
  yearsSince,
} from '../../src/modules/users/userInfoCard';
import { nestedThreadHtml, threadComments, authorNameHtml, mount } from '../fixtures/pages';
import { bootModules } from './module-harness';

vi.mock('../../src/core/net', async (orig) => ({
  ...(await orig<typeof import('../../src/core/net')>()),
  netFetch: vi.fn(),
}));
import { netFetch } from '../../src/core/net';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures/hovercards', name), 'utf8');
const SAMPLE = fixture('user-sample.html');
const MISSING = fixture('user-missing.html');

const reply = (body: string, status = 200) => ({
  ok: status < 400,
  status,
  text: async () => body,
});

/** A comment whose body links to a user, next to the normal thread comments. */
const THREAD = nestedThreadHtml(
  threadComments().map((c, i) =>
    i === 0 ? { ...c, bodyHtml: '<p>see <a href="/user/inbody1/">u/inbody1</a></p>' } : c,
  ),
);

type Booted = Awaited<ReturnType<typeof bootModules>>;
let booted: Booted | null = null;

async function boot(
  options: Record<string, never> | Record<string, unknown> = {},
  me = 'me_the_reader',
) {
  mount(THREAD);
  booted = await bootModules([userInfo], {
    route: { kind: 'thread', path: '/' },
    username: me,
    options: { userInfo: options as never },
  });
  return booted;
}

const authorLink = (name: string): HTMLAnchorElement =>
  document.querySelector<HTMLAnchorElement>(`[slot="commentMeta"] a[href="/user/${name}/"]`)!;

function pointer(
  type: string,
  target: Element,
  pointerType = 'mouse',
  related: Element | null = null,
) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerType, relatedTarget: related }),
  );
}
const over = (el: Element, pointerType = 'mouse', from: Element | null = null) =>
  pointer('pointerover', el, pointerType, from);
const out = (el: Element, to: Element | null = null, pointerType = 'mouse') =>
  pointer('pointerout', el, pointerType, to);
const card = (): HTMLElement | null => document.querySelector('.rescue-userinfo');
const part = (name: string): string | undefined =>
  card()?.querySelector(`[data-part="${name}"]`)?.textContent ?? undefined;
const word = (name: string): HTMLButtonElement | null =>
  card()?.querySelector<HTMLButtonElement>(`button[data-action="${name}"]`) ?? null;
const settle = () => vi.advanceTimersByTimeAsync(0);

/** Hover a user's comment author link until the card has opened and loaded. */
async function open(name = 'user0'): Promise<HTMLAnchorElement> {
  const link = authorLink(name);
  over(link);
  await vi.advanceTimersByTimeAsync(800);
  await settle();
  return link;
}

let ignored: Set<string>;
let tagger: TaggerApi;
let edit: ReturnType<typeof vi.fn<TaggerApi['edit']>>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-02T12:00:00Z'));
  vi.mocked(netFetch).mockReset();
  vi.mocked(netFetch).mockResolvedValue(reply(SAMPLE) as never);
  ignored = new Set();
  edit = vi.fn<TaggerApi['edit']>();
  tagger = {
    edit,
    setText: vi.fn(async () => {}),
    isIgnored: (u: string) => ignored.has(u),
    toggleIgnore: async (u: string) => void (ignored.delete(u) || ignored.add(u)),
  };
  setTaggerApi(tagger);
});

afterEach(() => {
  booted?.dispose();
  booted = null;
  setTaggerApi(null);
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('userInfo: timing', () => {
  it('asks for nothing and shows nothing before the delay', async () => {
    await boot();
    over(authorLink('user0'));
    await vi.advanceTimersByTimeAsync(799);
    expect(netFetch).not.toHaveBeenCalled();
    expect(card()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(card()).not.toBeNull();
    expect(netFetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(netFetch).mock.calls[0]![0]).toBe('/svc/shreddit/user-hover-card/user0');
  });

  it('leaving the link early cancels the request and the card', async () => {
    await boot();
    const link = authorLink('user0');
    over(link);
    await vi.advanceTimersByTimeAsync(400);
    out(link);
    await vi.advanceTimersByTimeAsync(5000);
    expect(netFetch).not.toHaveBeenCalled();
    expect(card()).toBeNull();
  });

  it('shows "loading…" first, then the karma and cake day from Reddit’s card', async () => {
    await boot();
    let finish!: (r: ReturnType<typeof reply>) => void;
    vi.mocked(netFetch).mockReturnValue(new Promise((r) => (finish = r as never)) as never);
    over(authorLink('user0'));
    await vi.advanceTimersByTimeAsync(800);
    expect(card()!.textContent).toContain('loading…');
    expect(card()!.getAttribute('aria-label')).toBe('REScue user info: user0');
    expect(card()!.getAttribute('role')).toBe('region');
    finish(reply(SAMPLE));
    await settle();
    expect(card()!.textContent).not.toContain('loading…');
    expect(part('since')).toBe('redditor since Jan 19, 2021 (5 years)');
    expect(part('karma')).toBe('1,308 post karma · 184 comment karma');
    const name = card()!.querySelector<HTMLAnchorElement>('[data-part="name"]')!;
    expect(name.getAttribute('href')).toBe('/user/user0/');
    expect(name.textContent).toBe('u/user0');
    const profile = card()!.querySelector<HTMLAnchorElement>('[data-action="profile"]')!;
    expect(profile.getAttribute('href')).toBe('/user/user0/');
  });

  it('says so when Reddit has no such user, or sends no card', async () => {
    await boot();
    vi.mocked(netFetch).mockResolvedValue(reply(MISSING) as never);
    await open('user0');
    expect(part('status')).toBe(NOT_FOUND_TEXT);
    expect(word('tag')).toBeNull();

    booted!.dispose();
    document.body.innerHTML = '';
    await boot();
    vi.mocked(netFetch).mockResolvedValue(reply('', 503) as never);
    await open('user0');
    expect(part('status')).toBe(UNAVAILABLE_TEXT);
    // The words that need no answer from Reddit are still there.
    expect(word('tag')).not.toBeNull();
  });

  it('hides after the fade delay, and moving from the link into the card keeps it', async () => {
    await boot();
    const link = await open('user0');
    out(link);
    await vi.advanceTimersByTimeAsync(199);
    expect(card()).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(card()).toBeNull();

    const again = await open('user0');
    out(again, card()!);
    over(card()!, 'mouse', again);
    await vi.advanceTimersByTimeAsync(2000);
    expect(card()).not.toBeNull();
    out(card()!.querySelector('[data-part="karma"]')!, document.body);
    await vi.advanceTimersByTimeAsync(200);
    expect(card()).toBeNull();
  });

  it('Escape hides the card and a pending hover, and nothing else', async () => {
    await boot();
    await open('user0');
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(esc);
    expect(card()).toBeNull();
    expect(esc.defaultPrevented).toBe(false);

    over(authorLink('user4'));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.advanceTimersByTimeAsync(2000);
    expect(card()).toBeNull();
    expect(netFetch).toHaveBeenCalledTimes(1);
  });

  it('scrolling and a route change hide the card; only one card is open at a time', async () => {
    const m = await boot();
    await open('user0');
    window.dispatchEvent(new Event('scroll'));
    expect(card()).toBeNull();

    await open('user0');
    m.goTo({ kind: 'thread', path: '/other' });
    expect(card()).toBeNull();

    await open('user0');
    over(authorLink('user4'));
    await vi.advanceTimersByTimeAsync(800);
    await settle();
    expect(document.querySelectorAll('.rescue-userinfo')).toHaveLength(1);
    expect(card()!.getAttribute('aria-label')).toBe('REScue user info: user4');
  });

  it('a late answer for a closed card is dropped', async () => {
    await boot();
    let finish!: (r: ReturnType<typeof reply>) => void;
    vi.mocked(netFetch).mockReturnValue(new Promise((r) => (finish = r as never)) as never);
    over(authorLink('user0'));
    await vi.advanceTimersByTimeAsync(800);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    finish(reply(SAMPLE));
    await settle();
    expect(card()).toBeNull();
  });
});

describe('userInfo: what it reacts to', () => {
  it('ignores touch and pen pointers', async () => {
    await boot();
    for (const kind of ['touch', 'pen', '']) over(authorLink('user0'), kind);
    await vi.advanceTimersByTimeAsync(3000);
    expect(card()).toBeNull();
    expect(netFetch).not.toHaveBeenCalled();
  });

  it('ignores user links inside a comment body', async () => {
    await boot();
    const inBody = document.querySelector<HTMLAnchorElement>(
      '[slot="comment"] a[href="/user/inbody1/"]',
    )!;
    expect(inBody).not.toBeNull();
    over(inBody);
    await vi.advanceTimersByTimeAsync(3000);
    expect(netFetch).not.toHaveBeenCalled();
  });

  it('ignores Reddit’s own user card and REScue’s own popups', async () => {
    await boot();
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div slot="commentMeta">${authorNameHtml('cardhost', true)}</div>` +
        `<div class="rescue-overlay"><div slot="commentMeta"><a href="/user/inpopup/">u/inpopup</a></div></div>`,
    );
    over(document.querySelector('a[href="/user/cardhost/"]')!);
    over(document.querySelector('a[href="/user/inpopup/"]')!);
    await vi.advanceTimersByTimeAsync(3000);
    expect(netFetch).not.toHaveBeenCalled();
  });

  it('opens over a comment author link whose wrapper is a plain hovercard (comment authors have no card)', async () => {
    await boot();
    expect(authorLink('user0').closest('faceplate-hovercard')).not.toBeNull();
    await open('user0');
    expect(card()).not.toBeNull();
  });

  it('opens over the Old Reddit look’s post author link, unless that option is off', async () => {
    await boot();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<a class="rescue-oauthor" href="/user/op_user/">op_user</a>',
    );
    const op = document.querySelector('a.rescue-oauthor')!;
    over(op);
    await vi.advanceTimersByTimeAsync(800);
    await settle();
    expect(card()!.getAttribute('aria-label')).toBe('REScue user info: op_user');

    booted!.dispose();
    document.body.innerHTML = '';
    await boot({ postAuthors: false });
    document.body.insertAdjacentHTML(
      'beforeend',
      '<a class="rescue-oauthor" href="/user/op_user/">op_user</a>',
    );
    over(document.querySelector('a.rescue-oauthor')!);
    await vi.advanceTimersByTimeAsync(3000);
    expect(card()).toBeNull();
  });

  it('works out the name from the href only', () => {
    expect(userOfHref('/user/abc_1/', 'https://www.reddit.com')).toBe('abc_1');
    expect(userOfHref('https://www.reddit.com/user/abc/', 'https://www.reddit.com')).toBe('abc');
    expect(userOfHref('/user/abc/comments/', 'https://www.reddit.com')).toBeNull();
    expect(userOfHref('/user/ab/', 'https://www.reddit.com')).toBeNull();
    expect(userOfHref('https://evil.example/user/abc/', 'https://www.reddit.com')).toBeNull();
    expect(userOfHref(null, 'https://www.reddit.com')).toBeNull();
    const stray = document.createElement('a');
    stray.setAttribute('href', '/user/abc/');
    document.body.append(stray);
    expect(userInfoTarget(stray, true)).toBeNull(); // not a comment author link, not rescue-oauthor
  });
});

describe('userInfo: the words', () => {
  it('tag opens the tagger’s editor anchored on the card and closes the card', async () => {
    await boot();
    await open('user0');
    const root = card()!;
    word('tag')!.click();
    expect(edit).toHaveBeenCalledWith('user0', root);
    expect(card()).toBeNull();
  });

  it('ignore / unignore flips the tagger’s flag and the word', async () => {
    await boot();
    await open('user0');
    expect(word('ignore')!.textContent).toBe('ignore');
    word('ignore')!.click();
    await settle();
    expect(ignored.has('user0')).toBe(true);
    expect(word('ignore')!.textContent).toBe('unignore');
    expect(word('ignore')!.title).toMatch(/^REScue: /);
    word('ignore')!.click();
    await settle();
    expect(ignored.has('user0')).toBe(false);
    expect(word('ignore')!.textContent).toBe('ignore');
  });

  it('highlight / unhighlight edits User highlighting’s highlighted users', async () => {
    const m = await boot();
    await open('user0');
    const highlighted = () =>
      m.ctxs.get('userInfo')!.settings.profile().modules.userHighlight?.options?.highlighted;
    word('highlight')!.click();
    await settle();
    expect(highlighted()).toEqual(['user0']);
    expect(word('highlight')!.textContent).toBe('unhighlight');
    word('highlight')!.click();
    await settle();
    expect(highlighted() ?? []).toEqual([]);
    expect(word('highlight')!.textContent).toBe('highlight');
  });

  it('every control says what it does, starting with "REScue: "', async () => {
    await boot();
    await open('user0');
    const controls = card()!.querySelectorAll<HTMLElement>('button, a');
    expect(controls.length).toBeGreaterThanOrEqual(5);
    for (const c of controls) expect(c.title, c.textContent ?? '').toMatch(/^REScue: /);
  });

  it('leaves out tag and ignore when the user tagger is off, and on your own name', async () => {
    setTaggerApi(null);
    await boot();
    await open('user0');
    expect(word('tag')).toBeNull();
    expect(word('ignore')).toBeNull();
    expect(word('highlight')).not.toBeNull();

    booted!.dispose();
    document.body.innerHTML = '';
    setTaggerApi(tagger);
    await boot({}, 'user4');
    await open('user4');
    expect(word('tag')).toBeNull();
    expect(word('highlight')).not.toBeNull();
  });

  it('leaves out highlight when the option is off', async () => {
    await boot({ highlightButton: false });
    await open('user0');
    expect(word('highlight')).toBeNull();
    expect(word('tag')).not.toBeNull();
  });
});

describe('userInfo: options and clean-up', () => {
  it('clamps the delays to 0..5000 ms and falls back to the default for non-numbers', () => {
    expect(cleanDelay(800, 1)).toBe(800);
    expect(cleanDelay(-20, 1)).toBe(0);
    expect(cleanDelay(99999, 1)).toBe(5000);
    expect(cleanDelay(12.6, 1)).toBe(13);
    expect(cleanDelay('300', 1)).toBe(300);
    for (const bad of ['', '  ', 'soon', NaN, Infinity, null, undefined, {}]) {
      expect(cleanDelay(bad, 42)).toBe(42);
    }
  });

  it('follows hoverDelay and fadeDelay, also when they change while the page is open', async () => {
    const m = await boot({ hoverDelay: 100, fadeDelay: 50 });
    const link = authorLink('user0');
    over(link);
    await vi.advanceTimersByTimeAsync(100);
    await settle();
    expect(card()).not.toBeNull();
    out(link);
    await vi.advanceTimersByTimeAsync(50);
    expect(card()).toBeNull();

    const ctx = {
      ...m.ctxs.get('userInfo')!,
      options: { ...m.ctxs.get('userInfo')!.options, hoverDelay: 9_999_999 },
    };
    userInfo.onSettings!(ctx as never);
    over(link);
    await vi.advanceTimersByTimeAsync(4999);
    expect(card()).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(card()).not.toBeNull();
  });

  it('dispose removes the card, the listeners and the timers', async () => {
    await boot();
    const link = await open('user0');
    over(authorLink('user4'));
    booted!.dispose();
    booted = null;
    expect(card()).toBeNull();
    await vi.advanceTimersByTimeAsync(5000);
    expect(netFetch).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
    over(link);
    await vi.advanceTimersByTimeAsync(5000);
    expect(card()).toBeNull();
    expect(netFetch).toHaveBeenCalledTimes(1);
  });

  it('is on by default, with the options the brief names', () => {
    expect(userInfo.enabledByDefault).toBe(true);
    expect(userInfo.resId).toBe('userInfo');
    expect(Object.keys(userInfo.options)).toEqual([
      'hoverDelay',
      'fadeDelay',
      'highlightButton',
      'postAuthors',
    ]);
  });
});

describe('userInfoCard helpers', () => {
  it('counts whole years from the cake day', () => {
    const cake = new Date('2021-01-19T00:00:00Z');
    expect(yearsSince(cake, new Date('2026-01-18T00:00:00Z'))).toBe(4);
    expect(yearsSince(cake, new Date('2026-01-19T00:00:00Z'))).toBe(5);
    expect(yearsSince(cake, new Date('2020-01-01T00:00:00Z'))).toBe(0);
    expect(sinceText(cake, new Date('2022-02-01T00:00:00Z'))).toBe(
      'redditor since Jan 19, 2021 (1 year)',
    );
    expect(sinceText(cake, new Date('2021-06-01T00:00:00Z'))).toBe(
      'redditor since Jan 19, 2021 (less than a year)',
    );
  });

  it('formats karma with thousands separators and leaves out what is missing', () => {
    expect(karmaText({ postKarma: 1234567, commentKarma: 8 })).toBe(
      '1,234,567 post karma · 8 comment karma',
    );
    expect(karmaText({ postKarma: 0 })).toBe('0 post karma');
    expect(karmaText({})).toBe('');
  });

  it('places the card below the link, above it when there is no room, always inside the window', () => {
    const vp = { w: 1000, h: 800 };
    const size = { w: 280, h: 120 };
    const link = (left: number, top: number) => ({ left, top, right: left + 60, bottom: top + 16 });
    expect(placeCard(link(100, 100), size, vp)).toEqual({ left: 100, top: 122 });
    expect(placeCard(link(100, 700), size, vp)).toEqual({ left: 100, top: 574 });
    expect(placeCard(link(900, 100), size, vp)).toEqual({ left: 712, top: 122 });
    expect(placeCard(link(-50, 100), size, vp).left).toBe(8);
    // No room either way: pinned inside the window rather than off it.
    expect(placeCard(link(100, 40), { w: 280, h: 790 }, vp).top).toBe(8);
  });
});
