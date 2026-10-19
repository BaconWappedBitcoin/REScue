import { afterEach, describe, expect, it } from 'vitest';
import { HEADER_ATTR } from '../../src/modules/appearance/headerButton';
import { resolveOptions } from '../../src/core/settings';
import type { ModuleContext } from '../../src/core/types';
import {
  classTokens,
  routeClasses,
  rowApplies,
  subredditList,
} from '../../src/modules/appearance/cssHooks';
import { customCss } from '../../src/modules/appearance/customCss';
import { linksNewTab } from '../../src/modules/comments/linksNewTab';
import { parseXPostSubreddit, xPostLinks } from '../../src/modules/listings/xPostLinks';
import { autoHide } from '../../src/modules/listings/autoHide';
import { autoBucket, mentionsUser, shade } from '../../src/modules/users/highlightExtras';
import {
  FIRST_CLASS,
  FRIEND_CLASS,
  OP_CLASS,
  OP_MENTION_CLASS,
  highlightCss,
  userHighlight,
} from '../../src/modules/users/userHighlight';
import { POSTS, listingHtml, mount, nestedThreadHtml, threadComments } from '../fixtures/pages';
import { bootModules } from './module-harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let booted: Awaited<ReturnType<typeof bootModules>> | null = null;
const boot = async (...args: Parameters<typeof bootModules>) =>
  (booted = await bootModules(...args));

afterEach(() => {
  booted?.dispose();
  booted = null;
  document.body.innerHTML = '';
  document.documentElement.className = '';
  document.documentElement.removeAttribute(HEADER_ATTR);
  for (const id of document.head.querySelectorAll('style')) id.remove();
});

describe('CSS hooks', () => {
  const cust = (
    over: Record<string, unknown>,
    route: Record<string, unknown>,
    toggles: Array<{ name: string; enabled: boolean }> = [],
    username: string | null = null,
  ) =>
    boot([customCss], {
      route: route as never,
      options: { stylesheet: over as never },
      username,
      profileModules: { customToggles: { options: { toggles } as never } },
    });

  it('names the classes for subreddits, feeds, profiles and the signed-in user', () => {
    const flags = {
      subredditClass: true,
      multiredditClass: true,
      usernameClass: true,
      loggedInUserClass: true,
    };
    expect(
      routeClasses({ kind: 'subreddit', path: '/r/Aww', subreddit: 'Aww' }, 'me', flags),
    ).toEqual(['res-r-Aww', 'res-user-me']);
    expect(
      routeClasses({ kind: 'customFeed', path: '/user/bob/m/cool', username: 'bob' }, null, flags),
    ).toEqual(['res-m-cool']);
    expect(
      routeClasses({ kind: 'profile', path: '/user/bob', username: 'bob' }, null, flags),
    ).toEqual(['res-u-bob']);
    expect(
      routeClasses({ kind: 'subreddit', path: '/r/a', subreddit: 'a' }, 'me', {
        ...flags,
        subredditClass: false,
        loggedInUserClass: false,
      }),
    ).toEqual([]);
    expect(
      routeClasses({ kind: 'subreddit', path: '/r/x', subreddit: 'x"><b' }, null, flags),
    ).toEqual(['res-r-xb']);
  });

  it('matches rows by subreddit and custom toggle', () => {
    const profile = {
      modules: { customToggles: { options: { toggles: [{ name: 'dark', enabled: false }] } } },
    } as never;
    const route = { kind: 'subreddit', path: '/r/Aww', subreddit: 'Aww' } as const;
    expect(subredditList('r/Aww, /r/pics/ foo')).toEqual(['aww', 'pics', 'foo']);
    expect(rowApplies({ applyTo: 'include', subreddits: 'aww' }, route, profile)).toBe(true);
    expect(rowApplies({ applyTo: 'include', subreddits: 'pics' }, route, profile)).toBe(false);
    expect(rowApplies({ applyTo: 'exclude', subreddits: 'aww' }, route, profile)).toBe(false);
    expect(rowApplies({}, route, profile)).toBe(true);
    expect(rowApplies({ customToggle: 'dark' }, route, profile)).toBe(false);
    expect(rowApplies({ customToggle: 'unlisted' }, route, profile)).toBe(true);
    expect(classTokens('a b,c <x>')).toEqual(['a', 'b', 'c', 'x']);
  });

  it('puts the route classes on <html> and <body>, and removes them with the module', async () => {
    await cust(
      { loggedInUserClass: true },
      { kind: 'subreddit', path: '/r/aww', subreddit: 'aww' },
      [],
      'me_the_reader',
    );
    for (const el of [document.documentElement, document.body]) {
      expect(el.classList.contains('res-r-aww')).toBe(true);
      expect(el.classList.contains('res-user-me_the_reader')).toBe(true);
    }
    booted!.dispose();
    expect(document.documentElement.classList.contains('res-r-aww')).toBe(false);
  });

  it('adds listed classes and snippets, honouring the subreddit rule and a custom toggle', async () => {
    const rows = [
      { classes: 'wide dense', applyTo: 'include', subreddits: 'aww', customToggle: '' },
      { classes: 'never', applyTo: 'exclude', subreddits: 'aww', customToggle: '' },
      { classes: 'toggled', applyTo: 'everywhere', subreddits: '', customToggle: 'dark' },
    ];
    const snippets = [
      { snippet: '.a{color:red}', applyTo: 'everywhere', subreddits: '', customToggle: '' },
      { snippet: '.b{color:blue}', applyTo: 'everywhere', subreddits: '', customToggle: 'dark' },
    ];
    await cust(
      { bodyClasses: rows, snippets },
      { kind: 'subreddit', path: '/r/aww', subreddit: 'aww' },
      [{ name: 'dark', enabled: false }],
    );
    const cls = document.body.classList;
    expect(cls.contains('wide') && cls.contains('dense')).toBe(true);
    expect(cls.contains('never') || cls.contains('toggled')).toBe(false);
    const css = document.getElementById('rescue-user-snippets')!.textContent;
    expect(css).toContain('.a{');
    expect(css).not.toContain('.b{');
    // Turning the toggle on applies the tied row and snippet.
    const ctx = booted!.ctxs.get('stylesheet')!;
    const profile = ctx.settings.profile();
    profile.modules.customToggles = {
      options: { toggles: [{ name: 'dark', enabled: true }] as never },
    };
    customCss.onSettings!({
      ...ctx,
      options: resolveOptions(customCss, profile),
    } as ModuleContext as never);
    expect(document.body.classList.contains('toggled')).toBe(true);
    expect(document.getElementById('rescue-user-snippets')!.textContent).toContain('.b{');
  });
});

describe('links open in a new tab', () => {
  const thread = () => {
    const comments = threadComments();
    comments[0]!.bodyHtml =
      '<p><a href="https://example.com/x">out</a> <a href="#top">jump</a> <a href="mailto:a@b.c">mail</a></p>';
    mount(nestedThreadHtml(comments));
  };

  it('is off by default', () => {
    expect(linksNewTab.enabledByDefault).toBe(false);
  });

  it('sets target and rel on web links in comment and post bodies only, and restores them', async () => {
    thread();
    const m = await boot([linksNewTab], { route: { kind: 'thread', path: '/r/x/comments/y' } });
    m.pipeline.flush();
    const links = [...document.querySelectorAll('[slot="comment"] a')] as HTMLAnchorElement[];
    const out = links.find((a) => a.textContent === 'out')!;
    expect(out.target).toBe('_blank');
    expect(out.rel).toBe('noopener noreferrer');
    for (const t of ['jump', 'mail'])
      expect(links.find((a) => a.textContent === t)!.hasAttribute('target')).toBe(false);
    expect(document.querySelector('[slot="credit-bar"] a')?.hasAttribute('target')).toBe(false);
    m.dispose();
    expect(out.hasAttribute('target')).toBe(false);
    expect(out.hasAttribute('rel')).toBe(false);
  });
});

describe('userHighlight extras', () => {
  const ownLink = (el: Element) =>
    [...el.querySelectorAll('a[href^="/user/"]')].find(
      (l) => l.closest('shreddit-comment') === el,
    )!;
  const comment = (id: string) => document.querySelector(`shreddit-comment[thingid="${id}"]`)!;

  const run = async (options: Record<string, unknown>) => {
    const comments = threadComments();
    comments[4]!.author = 'user0'; // a second top-level comment by the first commenter
    comments[2]!.bodyHtml = '<p>thanks <a href="/user/rockpaperblr/">u/rockpaperblr</a></p>';
    comments[1]!.bodyHtml = '<p>talking to myself, u/rockpaperblr</p>'; // the OP's own comment
    mount(nestedThreadHtml(comments));
    const m = await boot([userHighlight], {
      route: { kind: 'thread', path: '/r/x/comments/y' },
      options: { userHighlight: options as never },
    });
    m.flush();
    return m;
  };

  it('colours the OP (from isOp) only when asked', async () => {
    await run({});
    expect(document.querySelector(`.${OP_CLASS}`)).toBeNull();
    booted!.dispose();
    await run({ highlightOp: true });
    expect(ownLink(comment('t1_c1')).classList.contains(OP_CLASS)).toBe(true);
    expect(ownLink(comment('t1_c2')).classList.contains(OP_CLASS)).toBe(false);
  });

  it('highlights commenters who mention the OP, but not the OP', async () => {
    await run({ highlightOpMentions: true });
    expect(ownLink(comment('t1_c2')).classList.contains(OP_MENTION_CLASS)).toBe(true);
    expect(ownLink(comment('t1_c1')).classList.contains(OP_MENTION_CLASS)).toBe(false);
    expect(mentionsUser('see /u/Foo.bar now', 'foo.bar')).toBe(true);
    expect(mentionsUser('see u/foobar', 'foo')).toBe(false);
  });

  it('highlights the first commenter, and can leave out the first comment itself', async () => {
    await run({ highlightFirstCommenter: true });
    expect(ownLink(comment('t1_c0')).classList.contains(FIRST_CLASS)).toBe(false);
    expect(ownLink(comment('t1_c4')).classList.contains(FIRST_CLASS)).toBe(true);
    booted!.dispose();
    await run({ highlightFirstCommenter: true, dontHighlightFirstComment: false });
    expect(ownLink(comment('t1_c0')).classList.contains(FIRST_CLASS)).toBe(true);
  });

  it('gives every name a stable colour class, with the colour rules in the stylesheet', async () => {
    await run({ autoColorUsernames: true });
    const cls = (id: string) =>
      [...ownLink(comment(id)).classList].find((c) => c.startsWith('rescue-auto-'));
    expect(cls('t1_c0')).toMatch(/^rescue-auto-\d+$/);
    expect(cls('t1_c4')).toBe(cls('t1_c0'));
    expect(autoBucket('Alice')).toBe(autoBucket('alice'));
    expect(document.getElementById('rescue-user-highlight')!.textContent).toContain(
      'rescue-auto-0',
    );
  });

  it('applies font and hover colours to the stylesheet, validated', () => {
    const base = { mod: '', admin: '', friend: '#ff0000', tagged: '' };
    expect(highlightCss({ ...base, hover: true })).toContain(
      `a.${FRIEND_CLASS}:hover{background:#bf0000}`,
    );
    expect(highlightCss(base)).not.toContain(':hover');
    expect(highlightCss({ ...base, font: '#123456' })).toContain('color:#123456 !important');
    expect(highlightCss({ ...base, font: 'red;}' })).not.toContain('red;}');
    expect(shade('#ffffff')).toBe('#bfbfbf');
  });

  it('follows settings changes: a new friend is marked, and removed when the list empties', async () => {
    const m = await run({});
    const ctx = m.ctxs.get('userHighlight')!;
    const profile = ctx.settings.profile();
    const withFriends = (friends: string[]) => {
      profile.modules.userHighlight = { options: { friends } };
      return { ...ctx, options: resolveOptions(userHighlight, profile) } as never;
    };
    await userHighlight.onSettings!(withFriends(['user0']));
    expect(ownLink(comment('t1_c0')).classList.contains(FRIEND_CLASS)).toBe(true);
    await userHighlight.onSettings!(withFriends([]));
    expect(ownLink(comment('t1_c0')).classList.contains(FRIEND_CLASS)).toBe(false);
  });
});

describe('cross-post links', () => {
  it('reads the subreddit from titles the way RES does', () => {
    expect(parseXPostSubreddit('Nice view (x-post from r/EarthPorn)')).toBe('EarthPorn');
    expect(parseXPostSubreddit('xpost r/foo')).toBe('foo');
    expect(parseXPostSubreddit('Look at this crosspost from /r/bar')).toBe('bar');
    expect(parseXPostSubreddit('[x-post] (r/baz)')).toBe('baz');
    expect(parseXPostSubreddit('x-post from games')).toBe('games');
    expect(parseXPostSubreddit('Just a title about r/foo')).toBeNull();
    expect(parseXPostSubreddit('post about postage')).toBeNull();
  });

  it('adds a link after the title, but not to the post’s own subreddit', async () => {
    mount(
      listingHtml([
        { ...POSTS[0]!, title: 'Cool (x-post from r/foo)' },
        { ...POSTS[1]!, title: 'Same (xpost r/nottheonion)' },
      ]),
    );
    const m = await boot([xPostLinks], { route: { kind: 'front', path: '/' } });
    m.flush();
    const links = document.querySelectorAll<HTMLAnchorElement>('a.rescue-xpost-link');
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute('href')).toBe('/r/foo/');
    expect(links[0]!.textContent).toBe('x-posted from r/foo');
    expect(links[0]!.title).toMatch(/^REScue: /);
  });
});

describe('autoHide by time on screen', () => {
  class FakeIO {
    static last: FakeIO | null = null;
    observed: Element[] = [];
    constructor(public cb: (e: Array<{ target: Element; isIntersecting: boolean }>) => void) {
      FakeIO.last = this;
    }
    observe(el: Element) {
      this.observed.push(el);
    }
    unobserve() {}
    disconnect() {}
  }
  const article = (id: string) => document.querySelector(`article:has(shreddit-post#${id})`)!;

  it('keeps the opened mode as the default', () => {
    expect(resolveOptions(autoHide, { modules: {} } as never).mode).toBe('opened');
  });

  it('records posts seen long enough, and hides them on the next visit but not in this one', async () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
    try {
      mount(listingHtml());
      const m = await boot([autoHide], {
        route: { kind: 'front', path: '/' },
        options: { autoHide: { mode: 'seen', mustBeVisibleDuration: 15 } },
      });
      m.flush();
      const io = FakeIO.last!;
      const target = io.observed.find((e) => e.id === 't3_text1')!;
      const other = io.observed.find((e) => e.id === 't3_link1')!;
      io.cb([
        { target, isIntersecting: true },
        { target: other, isIntersecting: true },
      ]);
      io.cb([{ target: other, isIntersecting: false }]); // scrolled past too fast
      await wait(60);
      const seen = m.moduleStore.autoHide!.seen as Record<string, number>;
      expect(Object.keys(seen)).toEqual(['t3_text1']);
      expect(article('t3_text1').hasAttribute('data-rescue-hidden')).toBe(false);
      m.dispose();

      mount(listingHtml());
      const next = await boot([autoHide], {
        route: { kind: 'front', path: '/' },
        options: { autoHide: { mode: 'seen' } },
        moduleStored: { autoHide: { seen } },
      });
      next.flush();
      expect(article('t3_text1').getAttribute('data-rescue-hidden')).toBe('autoHide');
      expect(article('t3_link1').hasAttribute('data-rescue-hidden')).toBe(false);
    } finally {
      delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    }
  });
});
