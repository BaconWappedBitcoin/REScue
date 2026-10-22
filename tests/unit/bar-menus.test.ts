import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RedditJsonClient,
  buildRequest,
  type FeedsResult,
  type JsonResponse,
} from '../../src/core/redditJson';
import {
  DEFAULT_MAIL_LINKS,
  closeMenus,
  forgetMenus,
  mailHref,
  menuWords,
  sectionPath,
  type MenuHost,
} from '../../src/modules/appearance/barMenus';
import { subredditManager } from '../../src/modules/appearance/subredditManager';
import { maskText, ownMask, usernameHider } from '../../src/modules/appearance/usernameHider';
import { bootModules } from './module-harness';

afterEach(() => {
  vi.useRealTimers();
  forgetMenus();
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((s) => s.remove());
});

const reply = (body: unknown): JsonResponse => ({
  ok: true,
  status: 200,
  headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'application/json' : null) },
  text: async () => JSON.stringify(body),
});
const multi = (display_name: string, path: unknown) => ({
  kind: 'LabeledMulti',
  data: { display_name, name: display_name.toLowerCase(), path, can_edit: true, subreddits: [] },
});

describe('custom feeds from /api/multi/mine.json', () => {
  const client = (body: unknown) =>
    new RedditJsonClient({ fetchJson: async () => reply(body), sleep: async () => {} });

  it('asks the contract path and reads feeds with a trailing slash', async () => {
    expect(buildRequest('multis', {})).toBe('/api/multi/mine.json?raw_json=1');
    expect(buildRequest('multis', { x: 1 } as never)).toBeNull();
    const res = await client([
      multi('News', '/user/someone/m/newz'),
      multi('Art', '/user/a_b/m/art/'),
    ]).get('multis', {});
    expect(res.ok && res.data.feeds).toEqual([
      { name: 'News', path: '/user/someone/m/newz/' },
      { name: 'Art', path: '/user/a_b/m/art/' },
    ]);
  });

  it('leaves out feeds whose path is not a same-origin /user/…/m/… path', async () => {
    const res = await client([
      multi('Off', 'https://evil.test/user/x/m/y'),
      multi('Proto', '//evil.test/user/x/m/y'),
      multi('Sub', '/r/pics/'),
      multi('Dots', '/user/x/m/../../r/x'),
      multi('NoPath', 7),
      multi('Ok', '/user/x/m/ok'),
    ]).get('multis', {});
    expect(res.ok && res.data.feeds.map((f) => f.name)).toEqual(['Ok']);
  });

  it('treats a wrong shape as a failure', async () => {
    const notify = vi.fn();
    const res = await client({ kind: 'Listing', data: { children: [] } }).get(
      'multis',
      {},
      { notify },
    );
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe('shape');
    expect(notify).toHaveBeenCalled();
    expect((await client(['x']).get('multis', {})).ok).toBe(false);
  });
});

describe('menu link checks', () => {
  it('allows same-origin paths and mod.reddit.com only', () => {
    expect(mailHref('/message/unread/')).toBe('/message/unread/');
    expect(mailHref('https://mod.reddit.com/mail/all')).toBe('https://mod.reddit.com/mail/all');
    for (const bad of [
      '//evil.test/x',
      '/\\evil.test',
      'https://evil.test/',
      'http://mod.reddit.com/',
      'javascript:alert(1)',
      'message/inbox',
      7,
    ]) {
      expect(mailHref(bad)).toBeNull();
    }
    expect(sectionPath('')).toBe('');
    expect(sectionPath('/new/')).toBe('new/');
    expect(sectionPath('top/?t=week')).toBe('top/?t=week');
    expect(sectionPath('../../r/x')).toBeNull();
    expect(sectionPath('//evil.test')).toBe(null);
  });

  it('rejects a long hostile section path at once (no catastrophic backtracking)', () => {
    const start = performance.now();
    expect(sectionPath(`${'a'.repeat(40)}!`)).toBeNull();
    expect(sectionPath(`${'a/'.repeat(40)}`)).toBeNull(); // over the length cap
    expect(performance.now() - start).toBeLessThan(50);
  });
});

const BAR = '#rescue-subreddit-bar';
const q = <T extends Element = HTMLElement>(sel: string) =>
  document.querySelector<T>(`${BAR} ${sel}`);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(`${BAR} ${sel}`)];
const fire = (el: Element, type: string, init: KeyboardEventInit = {}) =>
  el.dispatchEvent(
    new (type === 'keydown' ? KeyboardEvent : Event)(type, {
      bubbles: true,
      cancelable: true,
      ...init,
    }),
  );

async function boot(extra: Record<string, unknown> = {}, username: string | null = 'reader') {
  const m = await bootModules([subredditManager], {
    route: { kind: 'front', path: '/' },
    username,
    options: { subredditManager: { showDefaults: false, subreddits: [], ...extra } as never },
  });
  await new Promise((r) => setTimeout(r, 0));
  return m;
}

describe('mail menu in the shortcut bar', () => {
  it('lists the mail links, and is absent signed out or when switched off', async () => {
    const m = await boot();
    const word = q('[data-rescue-mail]')!;
    expect(word.textContent).toBe('mail ▾');
    word.click();
    const menu = q('[data-rescue-mail-menu]')!;
    expect(menu.hidden).toBe(false);
    expect(word.getAttribute('aria-expanded')).toBe('true');
    expect([...menu.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(
      DEFAULT_MAIL_LINKS.map((l) => l.url),
    );
    word.click();
    expect(menu.hidden).toBe(true);
    m.dispose();

    const out = await boot({}, null);
    expect(q('[data-rescue-mail]')).toBeNull();
    expect(q('[data-rescue-feeds]')).toBeNull();
    out.dispose();
    const off = await boot({ linkMail: false });
    expect(q('[data-rescue-mail]')).toBeNull();
    expect(q('[data-rescue-feeds]')).not.toBeNull();
    off.dispose();
  });

  it('drops links that are not on Reddit and keeps them as text, never markup', async () => {
    const m = await boot({
      mailLinks: [
        { text: '<b>in</b>', url: '/message/inbox/' },
        { text: 'evil', url: 'https://evil.test/' },
      ],
    });
    q('[data-rescue-mail]')!.click();
    const links = qa('[data-rescue-mail-menu] a');
    expect(links.map((a) => a.textContent)).toEqual(['<b>in</b>']);
    expect(q('[data-rescue-mail-menu] b')).toBeNull();
    m.dispose();
  });

  it('opens on hover after the delay, closes after the pointer leaves, and on Escape', async () => {
    const m = await boot({ mailHoverDelay: 500 });
    vi.useFakeTimers();
    const word = q('[data-rescue-mail]')!;
    const wrap = word.parentElement!;
    const menu = q('[data-rescue-mail-menu]')!;
    fire(wrap, 'mouseenter');
    vi.advanceTimersByTime(499);
    expect(menu.hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(menu.hidden).toBe(false);
    fire(wrap, 'mouseleave');
    vi.advanceTimersByTime(150);
    fire(wrap, 'mouseenter'); // back in time: stays open
    vi.advanceTimersByTime(500);
    expect(menu.hidden).toBe(false);
    fire(wrap, 'mouseleave');
    vi.advanceTimersByTime(200);
    expect(menu.hidden).toBe(true);

    fire(word, 'keydown', { key: 'Enter' });
    expect(menu.hidden).toBe(false);
    expect(document.activeElement).toBe(menu.querySelector('a'));
    fire(menu.querySelector('a')!, 'keydown', { key: 'Escape' });
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(word);
    m.dispose();
  });

  it('sits after the fixed links and before your own shortcuts', async () => {
    const m = await boot({
      showDefaults: true,
      subreddits: [{ target: 'aa', label: '', addedAt: 1 }],
    });
    const kids = [...q('.rescue-sc-viewport')!.children].map((k) =>
      k.matches('.rescue-bm')
        ? k.querySelector('button')!.textContent
        : k.className || k.textContent,
    );
    expect(kids).toEqual(['Home', 'popular', 'mail ▾', 'feeds ▾', 'rescue-bar-sep', 'rescue-sc']);
    m.dispose();
  });
});

describe('custom-feeds menu', () => {
  const host = (load: () => Promise<FeedsResult | null>): MenuHost => ({
    signedIn: true,
    feeds: {
      hoverDelay: 0,
      load,
      sections: [
        { text: 'hot', path: '' },
        { text: 'new', path: 'new/' },
        { text: 'bad', path: '../x' },
      ],
    },
  });
  const mount = (h: MenuHost) => {
    const bar = document.createElement('nav');
    bar.id = 'rescue-subreddit-bar';
    bar.append(...menuWords(h));
    document.body.append(bar);
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('reads the feeds once, on first open, and lists each feed with its section links', async () => {
    const load = vi.fn(async () => ({ feeds: [{ name: 'News', path: '/user/me/m/news/' }] }));
    mount(host(load));
    expect(load).not.toHaveBeenCalled();
    const word = q('[data-rescue-feeds]')!;
    word.click();
    expect(q('[data-rescue-feeds-menu]')!.textContent).toMatch(/Loading/);
    await flush();
    const feed = q<HTMLAnchorElement>('[data-rescue-feeds-menu] a')!;
    expect(feed.textContent).toBe('News');
    expect(feed.getAttribute('href')).toBe('/user/me/m/news/');
    fire(feed, 'mouseenter');
    const sub = q('[data-rescue-feed-sections]')!;
    expect(sub.hidden).toBe(false);
    expect(
      [...sub.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['hot', '/user/me/m/news/'],
      ['new', '/user/me/m/news/new/'],
    ]);
    fire(sub.querySelector('a')!, 'keydown', { key: 'ArrowLeft' });
    expect(sub.hidden).toBe(true);
    expect(document.activeElement).toBe(feed);
    fire(feed, 'keydown', { key: 'ArrowRight' });
    expect(sub.hidden).toBe(false);
    expect(document.activeElement).toBe(sub.querySelector('a'));

    closeMenus();
    word.click();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('says so when the feeds cannot be read, or there are none', async () => {
    mount(host(async () => null));
    q('[data-rescue-feeds]')!.click();
    await flush();
    expect(q('[data-rescue-feeds-menu]')!.textContent).toBe('Could not load your custom feeds.');
    forgetMenus();
    document.body.innerHTML = '';
    mount(host(async () => ({ feeds: [] })));
    q('[data-rescue-feeds]')!.click();
    await flush();
    expect(q('[data-rescue-feeds-menu]')!.textContent).toBe('You have no custom feeds.');
  });
});

describe('usernameHider per-account display text', () => {
  it('uses the signed-in account’s own row, in any case, for that name only', () => {
    const rows = [
      { username: 'other', displayText: 'nope' },
      { username: 'u/Me_Reader', displayText: '  Captain  ' },
    ];
    const own = ownMask('me_reader', rows);
    expect([...own]).toEqual([['me_reader', 'Captain']]);
    expect(ownMask(null, rows).size).toBe(0);
    expect(ownMask('me_reader', [{ username: 'me_reader', displayText: '  ' }]).size).toBe(0);
    const hide = new Set(['me_reader', 'spez']);
    expect(maskText('ME_READER and spez', hide, '~x~', own)).toBe('Captain and ~x~');
  });

  it('masks the reader’s own name with it on the page', async () => {
    document.body.innerHTML =
      '<a id="me" href="/user/reader/">u/reader</a><a id="them" href="/user/user2/">u/user2</a>';
    const m = await bootModules([usernameHider], {
      username: 'reader',
      options: {
        usernameHider: {
          hideUsers: ['user2'],
          perAccountDisplayText: [{ username: 'READER', displayText: 'me' }],
        } as never,
      },
    });
    expect(document.getElementById('me')!.textContent).toBe('u/me');
    expect(document.getElementById('them')!.textContent).toBe('u/~anon~');
    m.dispose();
    expect(document.getElementById('me')!.textContent).toBe('u/reader');
  });
});
