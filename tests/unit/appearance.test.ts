import { afterEach, describe, expect, it, vi } from 'vitest';
import { hint } from '../../src/core/hints';
import { resolveOptions } from '../../src/core/settings';
import type { ModuleContext, ModuleDefinition, Route } from '../../src/core/types';
import { customCss, USER_CSS_ID } from '../../src/modules/appearance/customCss';
import { chatCss, disableChat } from '../../src/modules/appearance/disableChat';
import { formatLocalDate, localDate } from '../../src/modules/appearance/localDate';
import { logoLink, logoTarget, safeLocalPath } from '../../src/modules/appearance/logoLink';
import { pageNavigator } from '../../src/modules/appearance/pageNavigator';
import { searchHelper } from '../../src/modules/appearance/searchHelper';
import { tweaksCss, styleTweaks } from '../../src/modules/appearance/styleTweaks';
import {
  shortcutHref,
  shortcutLabel,
  subredditManager,
} from '../../src/modules/appearance/subredditManager';
import {
  cleanMask,
  maskText,
  namesToHide,
  usernameHider,
} from '../../src/modules/appearance/usernameHider';
import { searchWithDefaults, subredditSearchHref } from '../../src/model/appearance';
import { MODULES } from '../../src/modules';
import { mount, nestedThreadHtml, postHtml, POSTS, sessionHtml } from '../fixtures/pages';
import { bootModules, tick } from './module-harness';

afterEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((s) => s.remove());
});

const route = (r: Partial<Route> = {}): Route => ({ kind: 'thread', path: '/', ...r }) as Route;

/** The module's context after the settings changed to `options`. */
function changed(
  def: ModuleDefinition,
  ctx: ModuleContext,
  options: Record<string, unknown>,
): ModuleContext {
  const profile = { modules: { [def.id]: { enabled: true, options } } } as never;
  return { ...ctx, options: resolveOptions(def, profile) } as ModuleContext;
}

describe('stylesheet (custom CSS)', () => {
  it('injects one style element with the CSS as text, follows settings, and goes away', async () => {
    const m = await bootModules([customCss], {
      options: { stylesheet: { css: 'a { color: red }' } },
    });
    const style = () => document.querySelectorAll(`style#${USER_CSS_ID}`);
    expect(style()).toHaveLength(1);
    expect(style()[0]!.textContent).toBe('a { color: red }');

    const ctx = m.ctxs.get('stylesheet')!;
    customCss.onSettings!(changed(customCss, ctx, { css: 'b { color: blue }' }) as never);
    expect(style()).toHaveLength(1);
    expect(style()[0]!.textContent).toBe('b { color: blue }');

    customCss.onSettings!(changed(customCss, ctx, { css: '  ' }) as never);
    expect(style()).toHaveLength(0);

    customCss.onSettings!(changed(customCss, ctx, { css: 'i { x: y }' }) as never);
    m.dispose();
    expect(style()).toHaveLength(0);
  });

  it('never treats the CSS as markup', async () => {
    const css = '</style><img src=x onerror="window.pwned=1">';
    await bootModules([customCss], { options: { stylesheet: { css } } });
    expect(document.querySelector('img')).toBeNull();
    expect(document.getElementById(USER_CSS_ID)!.textContent).toBe(css);
  });
});

describe('localDate', () => {
  const when = new Date('2026-10-15T10:30:05.000Z');

  it('formats the instant in the reader’s zone', () => {
    const iso = formatLocalDate(when, 'iso');
    expect(iso).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    const d = new Date(iso.replace(' ', 'T'));
    expect(d.getTime()).toBe(when.getTime());
    expect(formatLocalDate(when, 'locale')).not.toBe('');
  });

  it('puts a tooltip on the time element and restores it, reading ts and datetime', async () => {
    mount(
      `<shreddit-app>${postHtml(POSTS[0]!).replace(
        '<faceplate-timeago><time>1h</time></faceplate-timeago>',
        '<faceplate-timeago ts="2026-10-15T10:30:05.000Z" title="old"><time>1h</time></faceplate-timeago>',
      )}</shreddit-app>`,
    );
    const m = await bootModules([localDate], {
      options: { localDate: { format: 'iso' } },
    });
    m.flush();
    const el = document.querySelector('faceplate-timeago')!;
    expect(el.getAttribute('title')).toBe(hint.localDate(formatLocalDate(when, 'iso')));
    expect(document.querySelector('.rescue-local-date')).toBeNull(); // tooltip only
    m.dispose();
    expect(el.getAttribute('title')).toBe('old');
  });

  it('adds an inline label on posts and comments, from the model when the page has no datetime', async () => {
    mount(nestedThreadHtml());
    const m = await bootModules([localDate], {
      options: { localDate: { display: 'inline', format: 'iso' } },
    });
    m.flush();
    const labels = [...document.querySelectorAll('.rescue-local-date')];
    expect(labels).toHaveLength(13); // the post and twelve comments
    expect(labels[1]!.textContent).toBe(
      formatLocalDate(new Date('2026-10-15T11:00:00.000Z'), 'iso'),
    );
    expect(document.querySelector('faceplate-timeago')!.hasAttribute('title')).toBe(false);
    m.dispose();
    expect(document.querySelectorAll('.rescue-local-date')).toHaveLength(0);
  });
});

describe('usernameHider', () => {
  it('masks whole names only, any case, and falls back to the default mask', () => {
    const hide = namesToHide('Me_Reader', true, ['/u/spez', 'bad name', 'user/other']);
    expect([...hide].sort()).toEqual(['me_reader', 'other', 'spez']);
    expect(maskText('u/me_reader and Me_Readers', hide, '~x~')).toBe('u/~x~ and Me_Readers');
    expect(cleanMask('   ')).toBe('~anon~');
    expect(cleanMask('x'.repeat(100))).toHaveLength(40);
    expect(namesToHide(null, true, [])).toEqual(new Set());
    expect(namesToHide('me', false, [])).toEqual(new Set());
  });

  it('masks author links, profile links and the menu text, and reverts every swap', async () => {
    mount(
      sessionHtml(true, 'rockpaperblr').replace(
        '<reddit-header-large></reddit-header-large>',
        '<reddit-header-large><a href="/user/rockpaperblr/">u/rockpaperblr</a><span id="menu">rockpaperblr</span></reddit-header-large>',
      ) + nestedThreadHtml(),
    );
    const before = document.body.innerHTML;
    const m = await bootModules([usernameHider], {
      username: 'rockpaperblr',
      options: { usernameHider: { hideUsers: ['user2'] } },
    });
    expect(document.querySelector('shreddit-post a[href^="/user/"]')!.textContent).toBe('u/~anon~');
    expect(document.querySelector('#menu')!.textContent).toBe('~anon~');
    expect(document.querySelector('reddit-header-large a')!.textContent).toBe('u/~anon~');
    const links = (name: string) =>
      [...document.querySelectorAll(`shreddit-comment a[href="/user/${name}/"]`)].map(
        (a) => a.textContent,
      );
    expect(links('rockpaperblr')).toEqual(['u/~anon~', 'u/~anon~', 'u/~anon~']);
    expect(links('user2')).toEqual(['u/~anon~']); // listed
    expect(links('user3')).toEqual(['u/user3']); // untouched
    expect(document.querySelector('a[href="/user/rockpaperblr/"]')!.getAttribute('href')).toBe(
      '/user/rockpaperblr/',
    );

    // A later render is masked too.
    document
      .querySelector('shreddit-comment')!
      .insertAdjacentHTML(
        'beforeend',
        '<a id="late" href="/user/rockpaperblr/">u/rockpaperblr</a>',
      );
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('#late')!.textContent).toBe('u/~anon~');

    m.dispose();
    document.querySelector('#late')!.remove();
    expect(document.body.innerHTML).toBe(before);
  });

  it('follows settings live: a new mask, and nothing masked when signed out', async () => {
    mount(sessionHtml(false) + nestedThreadHtml());
    const m = await bootModules([usernameHider], { username: null });
    expect(document.body.textContent).toContain('u/rockpaperblr'); // nobody to hide
    const ctx = m.ctxs.get('usernameHider')!;
    usernameHider.onSettings!(
      changed(usernameHider, ctx, { hideUsers: ['rockpaperblr'], mask: 'X' }) as never,
    );
    expect(document.querySelector('shreddit-post a[href^="/user/"]')!.textContent).toBe('u/X');
    usernameHider.onSettings!(changed(usernameHider, ctx, { hideUsers: [] }) as never);
    expect(document.querySelector('shreddit-post a[href^="/user/"]')!.textContent).toBe(
      'u/rockpaperblr',
    );
    m.dispose();
  });
});

describe('subredditManager', () => {
  it('turns a subreddit, a profile feed or a path into a same-origin link, and refuses the rest', () => {
    expect(shortcutHref('askscience')).toBe('/r/askscience/');
    expect(shortcutHref(' r/aww ')).toBe('/r/aww/');
    expect(shortcutHref('/r/all/top/')).toBe('/r/all/top/');
    expect(shortcutHref('u/spez/m/feed')).toBe('/user/spez/m/feed/');
    expect(shortcutHref('https://evil.example/x')).toBeNull();
    expect(shortcutHref('//evil.example')).toBeNull();
    expect(shortcutHref('javascript:alert(1)')).toBeNull();
    expect(shortcutHref('')).toBeNull();
    expect(shortcutLabel('r/aww', 'Cute')).toBe('Cute');
    expect(shortcutLabel('u/spez', '')).toBe('u/spez');
    expect(shortcutLabel('askscience', undefined)).toBe('askscience');
  });

  it('shows the chosen links in order, then rebuilds when the settings change', async () => {
    const m = await bootModules([subredditManager], {
      route: { kind: 'front', path: '/' },
      options: {
        subredditManager: {
          showDefaults: false,
          subreddits: [
            { target: 'askscience', label: '' },
            { target: 'r/aww', label: 'Cute' },
            { target: 'https://evil.example', label: 'bad' },
            { target: 'u/spez/m/feed', label: '' },
          ],
        },
      },
    });
    const items = () =>
      [...document.querySelectorAll('#rescue-subreddit-bar a')].map((a) => [
        a.textContent,
        a.getAttribute('href'),
      ]);
    expect(items()).toEqual([
      ['askscience', '/r/askscience/'],
      ['Cute', '/r/aww/'],
      ['u/spez/m/feed', '/user/spez/m/feed/'],
    ]);
    const ctx = m.ctxs.get('subredditManager')!;
    subredditManager.onSettings!(
      changed(subredditManager, ctx, { showDefaults: true, subreddits: [] }) as never,
    );
    expect(items().map((i) => i[0])).toEqual(['Home', 'all', 'popular']);
    subredditManager.onSettings!(
      changed(subredditManager, ctx, { showDefaults: false, subreddits: [] }) as never,
    );
    // No links, but the bar stays so the first shortcut can be added with its "+".
    expect(items()).toEqual([]);
    expect(document.querySelector('#rescue-subreddit-bar [data-rescue-new]')).not.toBeNull();
    m.dispose();
    expect(document.getElementById('rescue-subreddit-bar-style')).toBeNull();
  });

  it('offers to add the subreddit you are in, once', async () => {
    const m = await bootModules([subredditManager], {
      route: { kind: 'subreddit', path: '/r/pics', subreddit: 'pics' },
      options: { subredditManager: { showDefaults: false } },
    });
    const add = document.querySelector('#rescue-subreddit-bar [data-rescue-toggle]');
    expect(add?.textContent).toBe('+shortcut');
    m.dispose();
    const again = await bootModules([subredditManager], {
      route: { kind: 'subreddit', path: '/r/pics', subreddit: 'pics' },
      options: {
        subredditManager: { showDefaults: false, subreddits: [{ target: 'Pics', label: '' }] },
      },
    });
    // Already there: the same button now removes it.
    expect(document.querySelector('#rescue-subreddit-bar [data-rescue-toggle]')?.textContent).toBe(
      '−shortcut',
    );
    again.dispose();
  });

  it('rejects a bad row at input', () => {
    const spec = subredditManager.options.subreddits;
    expect(spec.validateRow?.({ target: 'https://x.test' })).toMatch(/subreddit name/);
    expect(spec.validateRow?.({ target: '' })).toBeNull();
    expect(spec.validateRow?.({ target: 'r/aww' })).toBeNull();
  });
});

describe('pageNavigator', () => {
  it('adds a back-to-top item to the menu that scrolls to the top, and removes it', async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    const m = await bootModules([pageNavigator]);
    expect(document.querySelector('#rescue-tools .rescue-back-to-top')).toBeNull();
    expect(m.menu('backToTop')).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    m.dispose();
    expect(m.menu('backToTop')).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('logoLink', () => {
  it('chooses a destination and refuses anything off Reddit', () => {
    const o = (destination: string, customDestination = '/') => ({
      destination,
      customDestination,
    });
    expect(logoTarget(o('frontpage'), route(), 'me')).toBeNull();
    expect(logoTarget(o('all'), route(), 'me')).toBe('/r/all/');
    expect(logoTarget(o('popular'), route(), null)).toBe('/r/popular/');
    expect(logoTarget(o('subreddit'), route({ subreddit: 'pics' }), null)).toBe('/r/pics/');
    expect(logoTarget(o('subreddit'), route(), null)).toBeNull();
    expect(logoTarget(o('profile'), route(), 'me')).toBe('/user/me/');
    expect(logoTarget(o('profile'), route(), null)).toBeNull();
    expect(logoTarget(o('custom', '/r/pics/top/?t=week'), route(), null)).toBe(
      '/r/pics/top/?t=week',
    );
    expect(safeLocalPath('//evil.example')).toBeNull();
    expect(safeLocalPath('https://evil.example')).toBeNull();
    expect(safeLocalPath('javascript:alert(1)')).toBeNull();
  });

  it('rewrites the logo href, keeps it rewritten, and puts the original back', async () => {
    mount('<reddit-header-large><a id="reddit-logo" href="/">Reddit</a></reddit-header-large>');
    const logo = document.querySelector('a')!;
    const m = await bootModules([logoLink], { options: { logoLink: { destination: 'all' } } });
    expect(logo.getAttribute('href')).toBe('/r/all/');
    logo.setAttribute('href', '/'); // Reddit re-rendered the link
    await new Promise((r) => setTimeout(r, 50));
    expect(logo.getAttribute('href')).toBe('/r/all/');
    const ctx = m.ctxs.get('logoLink')!;
    logoLink.onSettings!(changed(logoLink, ctx, { destination: 'popular' }) as never);
    expect(logo.getAttribute('href')).toBe('/r/popular/');
    logoLink.onSettings!(changed(logoLink, ctx, { destination: 'frontpage' }) as never);
    expect(logo.getAttribute('href')).toBe('/');
    logoLink.onSettings!(changed(logoLink, ctx, { destination: 'all' }) as never);
    m.dispose();
    expect(logo.getAttribute('href')).toBe('/');
  });
});

describe('searchHelper', () => {
  const none = { sort: 'none', time: 'none' };
  it('adds the default sort and time only when the address has none', () => {
    const href = 'https://www.reddit.com/search/?q=cats';
    expect(searchWithDefaults(href, none)).toBeNull();
    expect(searchWithDefaults(href, { sort: 'top', time: 'year' })).toBe(
      '/search/?q=cats&sort=top&t=year',
    );
    expect(searchWithDefaults(`${href}&sort=new`, { sort: 'top', time: 'none' })).toBeNull();
    expect(
      searchWithDefaults('https://www.reddit.com/r/x/', { sort: 'top', time: 'none' }),
    ).toBeNull();
    expect(
      searchWithDefaults('https://www.reddit.com/search/', { sort: 'top', time: 'none' }),
    ).toBeNull();
    expect(
      searchWithDefaults('https://www.reddit.com/r/pics/search/?q=a', {
        sort: 'new',
        time: 'none',
      }),
    ).toBe('/r/pics/search/?q=a&sort=new');
  });

  it('builds a search inside a subreddit', () => {
    expect(subredditSearchHref('pics', 'a b', { sort: 'new', time: 'none' })).toBe(
      '/r/pics/search/?q=a+b&restrict_sr=1&sort=new',
    );
  });

  it('searches the subreddit you are in when the header form is reachable', async () => {
    mount(
      '<reddit-header-large><form action="/search/"><input name="q" value="cats"></form></reddit-header-large>',
    );
    const assign = vi.fn();
    vi.stubGlobal('location', {
      ...window.location,
      assign,
      href: 'https://www.reddit.com/r/pics/',
    });
    const m = await bootModules([searchHelper], {
      route: { kind: 'subreddit', path: '/r/pics', subreddit: 'pics' },
      options: { searchHelper: { searchInSubreddit: true } },
    });
    const form = document.querySelector('form')!;
    const ev = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(assign).toHaveBeenCalledWith('/r/pics/search/?q=cats&restrict_sr=1');
    m.dispose();
    const after = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('disableChat and styleTweaks', () => {
  it('hides chat entry points with one stylesheet that goes away, and never the whole page', async () => {
    expect(chatCss()).toContain('display: none !important');
    expect(chatCss()).not.toMatch(/(^|,)\s*(body|html|shreddit-app)\b/);
    const m = await bootModules([disableChat]);
    expect(document.getElementById('rescue-disable-chat')!.textContent).toBe(chatCss());
    m.dispose();
    expect(document.getElementById('rescue-disable-chat')).toBeNull();
  });

  it('hides suggested communities only when asked', () => {
    const base = {
      visitedLinks: false,
      visitedColor: '#8a5fb3',
      topLevelSeparator: false,
      separatorColor: '#8b0000',
      separatorSize: 2,
      reduceMotion: false,
    };
    expect(tweaksCss(base)).not.toContain('in-feed-community-recommendations');
    const css = tweaksCss({ ...base, hideSuggestedCommunities: true });
    expect(css).toContain('in-feed-community-recommendations');
    expect(css).toContain('display: none !important');
  });

  it('writes only validated colours and sizes into the tweaks stylesheet', () => {
    const base = {
      visitedLinks: false,
      visitedColor: '#112233',
      topLevelSeparator: false,
      separatorColor: '#445566',
      separatorSize: 3,
      reduceMotion: false,
    };
    expect(tweaksCss(base)).toBe('');
    const on = tweaksCss({
      ...base,
      visitedLinks: true,
      topLevelSeparator: true,
      reduceMotion: true,
    });
    expect(on).toContain('#112233');
    expect(on).toContain('3px solid #445566');
    expect(on).toContain('animation: none');
    const bad = tweaksCss({
      ...base,
      visitedLinks: true,
      visitedColor: 'red;} body{display:none',
      topLevelSeparator: true,
      separatorColor: 'url(x)',
      separatorSize: 9999,
    });
    expect(bad).not.toContain('body{display');
    expect(bad).not.toContain('url(');
    expect(bad).toContain('8px solid #8b0000');
  });

  it('applies and removes the tweaks stylesheet', async () => {
    const m = await bootModules([styleTweaks], {
      options: { styleTweaks: { topLevelSeparator: true } },
    });
    expect(document.getElementById('rescue-style-tweaks')).not.toBeNull();
    const ctx = m.ctxs.get('styleTweaks')!;
    styleTweaks.onSettings!(changed(styleTweaks, ctx, {}) as never);
    expect(document.getElementById('rescue-style-tweaks')).toBeNull(); // all tweaks off
    await tick();
    m.dispose();
  });
});

describe('registration', () => {
  it('registers every US8 module with its RES id and a unique module id', () => {
    const ids = MODULES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [
      'stylesheet',
      'localDate',
      'usernameHider',
      'subredditManager',
      'pageNavigator',
      'logoLink',
      'searchHelper',
      'disableChat',
      'styleTweaks',
    ]) {
      const def = MODULES.find((m) => m.id === id);
      expect(def, id).toBeDefined();
      expect(def!.resId).toBe(id);
      expect(def!.category).toBe('appearance');
    }
    // The ones that follow the settings live.
    for (const def of [
      customCss,
      usernameHider,
      subredditManager,
      logoLink,
      searchHelper,
      disableChat,
      styleTweaks,
    ])
      expect(def.onSettings, def.id).toBeTypeOf('function');
  });
});
