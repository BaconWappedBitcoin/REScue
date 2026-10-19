// The opt-in old Reddit look: which routes it covers, what its stylesheet contains for each option,
// and that the module switches the page attribute with the route and follows its settings live.
import { afterEach, describe, expect, it } from 'vitest';
import { resolveOptions } from '../../src/core/settings';
import { hint } from '../../src/core/hints';
import type { ModuleContext, Route } from '../../src/core/types';
import { classify } from '../../src/core/route';
import {
  oldSkinCss,
  ROOT,
  SKIN_ATTR,
  skinApplies,
  thumbPx,
  type OldSkinOptions,
} from '../../src/model/oldSkin';
import { MODULES } from '../../src/modules';
import {
  applySkinAttribute,
  oldRedditSkin,
  SKIN_STYLE_ID,
} from '../../src/modules/appearance/oldRedditSkin';
import { quickToggles } from '../../src/modules/core/quickToggles';
import { bootModules } from './module-harness';
import { applyEarlySkin, clearEarlySkin, EARLY_SKIN_ID, writeSkinMirror } from '../../src/modules/appearance/oldSkin/early';
import { HighlightRows, readHighlights } from '../../src/modules/appearance/oldSkin/highlights';
import { MARK as PROMOTED_MARK } from '../../src/modules/listings/hidePromoted/hider';
import { hostSlot, slotPieces } from '../../src/modules/appearance/oldSkin/shared';

const html = document.documentElement;
const route = (path: string): Route => classify(`https://www.reddit.com${path}`);

const DEFAULTS: OldSkinOptions = {
  thumbnails: 'normal',
  rankNumbers: true,
  hideLeftNav: true,
  hideBanner: true,
};

afterEach(() => {
  html.removeAttribute(SKIN_ATTR);
  document.getElementById(SKIN_STYLE_ID)?.remove();
  document.body.innerHTML = '';
});

describe('which pages get the look', () => {
  it.each([
    ['/', true],
    ['/r/science/', true],
    ['/r/science/top/', true],
    ['/r/popular/', true],
    ['/r/all/', true],
    ['/search/?q=x', true],
    ['/r/science/search/?q=x', true],
    ['/r/science/comments/abc123/a_title/', true],
    ['/user/spez/comments/abc123/a_title/', true],
    ['/user/spez/', false],
    ['/user/spez/submitted/', false],
    ['/r/science/wiki/index', false],
    ['/settings/account', false],
    ['/message/inbox', false],
  ])('%s -> %s', (path, expected) => {
    expect(skinApplies(route(path))).toBe(expected);
  });

  it('sets and removes the attribute on <html> with the route', () => {
    expect(applySkinAttribute(route('/r/science/'))).toBe(true);
    expect(html.getAttribute(SKIN_ATTR)).toBe('old');
    expect(applySkinAttribute(route('/user/spez/'))).toBe(false);
    expect(html.hasAttribute(SKIN_ATTR)).toBe(false);
  });
});

describe('the stylesheet', () => {
  /** The selector part of every rule, including rules inside @media blocks. */
  function selectors(css: string): string[] {
    return [...css.matchAll(/([^{}]+){/g)]
      .map((m) => m[1]!.trim())
      .filter((head) => !head.startsWith('@') && !/^(?:from|to|\d+%)$/.test(head));
  }

  it('is balanced and every selector starts with the scoped root', () => {
    const css = oldSkinCss(DEFAULTS);
    expect((css.match(/{/g) ?? []).length).toBe((css.match(/}/g) ?? []).length);
    for (const group of selectors(css)) {
      for (const sel of group.split(/,\s*(?=html\[)/)) {
        expect(sel.trim().startsWith(ROOT), sel).toBe(true);
      }
    }
  });

  it('never leaves a stylesheet value behind from an unknown option', () => {
    const css = oldSkinCss({ ...DEFAULTS, thumbnails: 'bogus; } body { display: none' });
    expect(css).not.toContain('bogus');
    expect(css).toContain('grid-template-columns: 34px 46px 70px');
    expect(thumbPx('bogus')).toBe(70);
  });

  it('sizes the thumbnail column from the option', () => {
    expect(oldSkinCss({ ...DEFAULTS, thumbnails: 'small' })).toContain('34px 46px 50px minmax');
    expect(oldSkinCss({ ...DEFAULTS, thumbnails: 'large' })).toContain('34px 46px 100px minmax');
    const none = oldSkinCss({ ...DEFAULTS, thumbnails: 'none' });
    expect(none).toContain('34px 46px 0px minmax');
    expect(none).toContain('display: none;');
  });

  it('numbers the rows only when asked', () => {
    expect(oldSkinCss(DEFAULTS)).toContain('content: counter(osrank)');
    const off = oldSkinCss({ ...DEFAULTS, rankNumbers: false });
    expect(off).not.toContain('content: counter(osrank)');
    expect(off).toContain('grid-template-columns: 0px 46px 70px');
  });

  it('hides the left navigation and the banner only when asked', () => {
    const on = oldSkinCss(DEFAULTS);
    expect(on).toContain('#left-sidebar-container');
    expect(on).toContain('.subreddit-feed-masthead');
    const off = oldSkinCss({ ...DEFAULTS, hideLeftNav: false, hideBanner: false });
    expect(off).not.toContain('#left-sidebar-container');
    expect(off).not.toContain('.subreddit-feed-masthead');
  });

  it('has a dark variant keyed on REScue’s theme attribute and draws the vote arrows in the classic colours', () => {
    const css = oldSkinCss(DEFAULTS);
    expect(css).toContain(`${ROOT}[data-rescue-theme="dark"]`);
    expect(css).toContain('--os-arrow: #5a5d60');
    expect(css).toContain('.rescue-oup[aria-pressed="true"] { background: var(--os-up)');
  });
});

describe('the module', () => {
  it('is off by default, in the settings console and the menu, with a REScue hover hint', () => {
    expect(oldRedditSkin.enabledByDefault).toBe(false);
    expect(MODULES.some((d) => d.id === 'oldRedditSkin')).toBe(true);
    expect(oldRedditSkin.onSettings).toBeTypeOf('function'); // follows the on/off switch live
    expect(hint.menuOldLook(true).startsWith('REScue: ')).toBe(true);
    expect(hint.menuOldLook(false).startsWith('REScue: ')).toBe(true);
  });

  it('applies on a feed, drops off on a profile and comes back on a thread', async () => {
    const m = await bootModules([oldRedditSkin], {
      route: { kind: 'subreddit', path: '/r/science' },
    });
    expect(html.getAttribute(SKIN_ATTR)).toBe('old');
    expect(document.getElementById(SKIN_STYLE_ID)?.textContent).toContain(ROOT);
    m.goTo({ kind: 'profile', path: '/user/spez', username: 'spez' });
    expect(html.hasAttribute(SKIN_ATTR)).toBe(false);
    m.goTo({ kind: 'thread', path: '/r/science/comments/abc/x', subreddit: 'science' });
    expect(html.getAttribute(SKIN_ATTR)).toBe('old');
    m.dispose();
    expect(html.hasAttribute(SKIN_ATTR)).toBe(false);
    expect(document.getElementById(SKIN_STYLE_ID)).toBeNull();
  });

  it('does not touch a page it does not cover', async () => {
    const m = await bootModules([oldRedditSkin], { route: { kind: 'other', path: '/settings' } });
    expect(html.hasAttribute(SKIN_ATTR)).toBe(false);
    m.dispose();
  });

  it('rebuilds its stylesheet when an option changes', async () => {
    const m = await bootModules([oldRedditSkin], { route: { kind: 'front', path: '/' } });
    const before = document.getElementById(SKIN_STYLE_ID)?.textContent ?? '';
    const ctx = m.ctxs.get('oldRedditSkin')!;
    const profile = {
      modules: { oldRedditSkin: { enabled: true, options: { thumbnails: 'large' } } },
    };
    oldRedditSkin.onSettings!({
      ...ctx,
      options: resolveOptions(oldRedditSkin, profile as never),
    } as ModuleContext as never);
    const after = document.getElementById(SKIN_STYLE_ID)?.textContent ?? '';
    expect(after).not.toBe(before);
    expect(after).toContain('34px 46px 100px minmax');
    m.dispose();
  });
});

describe('the menu switch', () => {
  it('lists “Old Reddit look” and flips the module on and off', async () => {
    const m = await bootModules([quickToggles, oldRedditSkin], {
      route: { kind: 'front', path: '/' },
    });
    expect(m.menuText('quick:oldLook')).toBe('Old Reddit look');
    const profile = () => m.ctxs.get('quickToggles')!.settings.profile();
    expect(profile().modules.oldRedditSkin?.enabled).toBeUndefined();
    m.menu('quick:oldLook');
    await m.tick();
    expect(profile().modules.oldRedditSkin?.enabled).toBe(true);
    m.menu('quick:oldLook');
    await m.tick();
    expect(profile().modules.oldRedditSkin?.enabled).toBe(false);
    m.dispose();
  });
});

describe('second pass: REScue-drawn rows (R24)', () => {
  const css = oldSkinCss(DEFAULTS);

  it('lays Reddit’s own pieces out only for posts whose rows are mounted', () => {
    expect(css).toContain('shreddit-post[data-rescue-ov] {');
    // a post that has no mount mark keeps Reddit's own look: no rule styles a bare shreddit-post
    expect(css).not.toMatch(/shreddit-feed shreddit-post \{/);
  });

  it('parks the sealed shadow-root items in hidden rows below a filled first row', () => {
    expect(css).toContain('grid-auto-rows: 0');
    expect(css).toContain('overflow: clip');
    expect(css).toContain('::after { content: ""; grid-area: 1 / 1 / 2 / -1');
    expect(css).toContain('> *, ');
  });

  it('keeps Reddit’s comment action row alive for the bridge but shows it while replying', () => {
    expect(css).toContain(':not(:has(comment-composer-host))');
    expect(css).toContain('clip-path: inset(50%)');
  });

  it('styles the tabs, the top strip and the sidebar boxes', () => {
    expect(css).toContain('shreddit-sort-dropdown[sort-event="feed-sort-change"][data-rescue-tabs]');
    expect(css).toContain('.rescue-otab.rescue-oon');
    expect(css).toContain('#rescue-subreddit-bar { position: fixed; top: 0');
    expect(css).toContain('#right-sidebar-container aside');
  });
});

describe('pieces drawn through a slot (Firefox feed posts)', () => {
  const host = (slots: (string | null)[]): Element => {
    const el = document.createElement('div');
    const sr = el.attachShadow({ mode: 'open' });
    for (const name of slots) {
      const s = document.createElement('slot');
      if (name !== null) s.setAttribute('name', name);
      sr.append(s);
    }
    return el;
  };

  it('needs no slot with a default slot or no shadow root', () => {
    expect(hostSlot(host([null, 'title']))).toBeNull();
    expect(hostSlot(document.createElement('div'))).toBeNull();
  });

  it('picks a top-level named slot when there is no default one', () => {
    expect(hostSlot(host(['full-post-link', 'post-insights-panel']))).toBe('post-insights-panel');
    expect(hostSlot(host(['full-post-link']))).toBe('full-post-link');
    expect(hostSlot(host(['title']))).toBeNull();
  });

  it('puts the slot on REScue’s own pieces only', () => {
    const h = host(['full-post-link', 'post-insights-panel']);
    const a = document.createElement('div');
    const b = document.createElement('div');
    h.append(a, b);
    slotPieces(h, [a, b]);
    expect([a.getAttribute('slot'), b.getAttribute('slot')]).toEqual([
      'post-insights-panel',
      'post-insights-panel',
    ]);
  });
});

describe('the look from the first paint', () => {
  afterEach(() => {
    localStorage.clear();
    document.getElementById(EARLY_SKIN_ID)?.remove();
    document.documentElement.removeAttribute(SKIN_ATTR);
  });
  const opts = DEFAULTS;

  it('does nothing without a stored copy, or on a page the skin does not cover', () => {
    expect(applyEarlySkin('https://www.reddit.com/r/science/')).toBe(false);
    writeSkinMirror(opts);
    expect(applyEarlySkin('https://www.reddit.com/settings/')).toBe(false);
    expect(document.documentElement.hasAttribute(SKIN_ATTR)).toBe(false);
  });

  it('puts the look on at once and hands over to the module, or takes it all away', () => {
    writeSkinMirror(opts);
    expect(applyEarlySkin('https://www.reddit.com/r/science/')).toBe(true);
    expect(document.documentElement.getAttribute(SKIN_ATTR)).toBe('old');
    expect(document.getElementById(EARLY_SKIN_ID)!.textContent).toContain('rescue-os-reveal');
    clearEarlySkin('no-such-style');
    expect(document.getElementById(EARLY_SKIN_ID)).toBeNull();
    expect(document.documentElement.hasAttribute(SKIN_ATTR)).toBe(false);
  });

  it('forgets the copy when the skin is off', () => {
    writeSkinMirror(opts);
    writeSkinMirror(null);
    expect(applyEarlySkin('https://www.reddit.com/r/science/')).toBe(false);
  });

  it('veils items without REScue rows, with a timed reveal', () => {
    const css = oldSkinCss(opts);
    expect(css).toMatch(/:not\(\[data-rescue-ov\]\)[^{]*\{ visibility: hidden; animation: rescue-os-reveal 0s linear 3000ms forwards; \}/);
  });
});

describe('videos in feeds', () => {
  it('hides Reddit’s player in feeds only, so it never autoplays, and shows its poster instead', () => {
    const css = oldSkinCss(DEFAULTS);
    expect(css).toContain('shreddit-feed :is(shreddit-post, shreddit-ad-post) shreddit-player');
    expect(css).toMatch(/shreddit-player\)? > \.rescue-oth \{ display: block !important/);
    expect(css).not.toMatch(/main > shreddit-post shreddit-player/);
  });
});

describe('pinned posts (community highlights)', () => {
  const card = (id: string, title: string, votes: number, comments: number) => `
    <li><a href="/r/moderatepolitics/comments/${id}/x/"><community-highlight-card>
      <h2 slot="title">${title}</h2>
      <span slot="label"><span>u/AutoModerator</span></span>
      <span slot="upvotes-and-comments"><span><faceplate-number number="${votes}">${votes}</faceplate-number> votes • <faceplate-number number="${comments}">${comments}</faceplate-number> comments</span></span>
    </community-highlight-card></a></li>`;
  afterEach(() => document.body.replaceChildren());

  it('reads each card into an old-style green row and hides the carousel only while shown', () => {
    document.body.innerHTML = `<main id="main-content"><community-highlight-carousel><shreddit-gallery-carousel>${card('a1', '!clear', 4, 0)}${card('b2', 'Weekly thread', 1200, 37)}</shreddit-gallery-carousel></community-highlight-carousel></main>`;
    const carousel = document.querySelector('community-highlight-carousel')!;
    expect(readHighlights(carousel)).toEqual([
      { href: '/r/moderatepolitics/comments/a1/x/', title: '!clear', author: 'AutoModerator', score: 4, comments: 0 },
      { href: '/r/moderatepolitics/comments/b2/x/', title: 'Weekly thread', author: 'AutoModerator', score: 1200, comments: 37 },
    ]);
    const rows = new HighlightRows();
    rows.sync();
    expect(document.querySelectorAll('.rescue-ostick')).toHaveLength(2);
    expect(carousel.hasAttribute('data-rescue-hl')).toBe(true);
    rows.sync();
    expect(document.querySelectorAll('.rescue-osticky')).toHaveLength(1);
    rows.clear();
    expect(document.querySelector('.rescue-osticky')).toBeNull();
    expect(carousel.hasAttribute('data-rescue-hl')).toBe(false);
  });
});

describe('ads hidden by "Hide promoted posts"', () => {
  it('stay hidden under the row style, with the same marker the hider uses', () => {
    expect(oldSkinCss(DEFAULTS)).toContain(`[data-rescue-ov][${PROMOTED_MARK}] { display: none !important; }`);
  });
});

describe('the "Post to" bar', () => {
  it('is hidden only inside the main column, so Reddit’s Create Post buttons stay', () => {
    const css = oldSkinCss(DEFAULTS);
    expect(css).toContain('#main-content create-post-entry-point-wrapper { display: none !important; }');
    expect(css).not.toMatch(/"\] create-post-entry-point-wrapper \{/);
  });
});
