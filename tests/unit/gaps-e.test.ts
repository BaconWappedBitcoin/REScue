import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMenu } from '../../src/layout/native/menu';
import { headerAnchor, hoverCardContent, userHoverCards } from '../../src/model/chromeAnchors';
import { headerButton, HEADER_ATTR } from '../../src/modules/appearance/headerButton';
import { feedPause, loadWithRetry } from '../../src/modules/listings/feedPause';
import { hoverCardActions } from '../../src/modules/users/hoverCardActions';
import { userTagger } from '../../src/modules/users/userTagger';
import { userHighlight } from '../../src/modules/users/userHighlight';
import { POSTS, headerStripHtml, listingHtml, mount } from '../fixtures/pages';
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

describe('header button', () => {
  it('finds the strip around a#create-post, and nothing without it', () => {
    mount(headerStripHtml());
    const a = headerAnchor()!;
    expect(a.strip.id).toBe('header-icons');
    expect(a.before.tagName.toLowerCase()).toBe('create-post-entry-point-wrapper');
    mount('<reddit-header-large></reddit-header-large>');
    expect(headerAnchor()).toBeNull();
    mount('<a id="create-post" href="/submit">Create</a>');
    expect(headerAnchor()).toBeNull(); // would be the body: fail safe
  });

  it('puts a REScue word button before Create, hides the corner gear, and opens the menu', async () => {
    mount(headerStripHtml());
    await boot([headerButton], { route: { kind: 'front', path: '/' } });
    const btn = document.getElementById('rescue-header-button') as HTMLButtonElement;
    expect(btn.textContent).toBe('REScue');
    expect(btn.title).toMatch(/^REScue: open the REScue menu/);
    expect(btn.nextElementSibling?.tagName.toLowerCase()).toBe('create-post-entry-point-wrapper');
    expect(document.documentElement.hasAttribute(HEADER_ATTR)).toBe(true);
    expect(document.getElementById('rescue-header-button-css')!.textContent).toContain(
      '#rescue-gear',
    );
    btn.click();
    expect(document.getElementById('rescue-menu')).not.toBeNull();
  });

  it('adds nothing when the anchor is missing, and gives the corner button back when it drifts', async () => {
    mount('<reddit-header-large></reddit-header-large>');
    await boot([headerButton]);
    expect(document.getElementById('rescue-header-button')).toBeNull();
    expect(document.documentElement.hasAttribute(HEADER_ATTR)).toBe(false);

    mount(headerStripHtml());
    booted!.dispose();
    await boot([headerButton]);
    expect(document.getElementById('rescue-header-button')).not.toBeNull();
    document.getElementById('create-post')!.remove();
    await wait(700);
    expect(document.getElementById('rescue-header-button')).toBeNull();
    expect(document.documentElement.hasAttribute(HEADER_ATTR)).toBe(false);
  });

  it('is on by default', () => {
    expect(headerButton.enabledByDefault).toBe(true);
  });
});

describe('menu placement', () => {
  it('opens downward from an anchor in the top half of the window', () => {
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: 1200,
      configurable: true,
    });
    const anchor = document.createElement('button');
    document.body.append(anchor);
    anchor.getBoundingClientRect = () =>
      ({ top: 20, bottom: 50, right: 1000, left: 900, width: 100, height: 30 }) as DOMRect;
    const menu = createMenu();
    menu.add({ id: 'a', label: 'A', order: 1, onClick: () => {} });
    menu.open(anchor);
    const box = document.getElementById('rescue-menu')!;
    expect(box.style.top).toBe('54px');
    expect(box.style.bottom).toBe('');
    menu.close();
  });
});

describe('hover-card actions', () => {
  const withCards = () =>
    mount(listingHtml(POSTS.slice(0, 2).map((p) => ({ ...p, hoverCard: true }))));

  it('finds a post author’s card and its content slot', () => {
    withCards();
    const cards = userHoverCards();
    expect(cards).toHaveLength(2);
    expect(hoverCardContent(cards[0]!)).not.toBeNull();
  });

  it('adds tag, ignore and highlight words, and puts them back when the card reloads', async () => {
    withCards();
    await boot([userTagger, userHighlight, hoverCardActions], {
      route: { kind: 'front', path: '/' },
      username: 'me_the_reader',
    });
    const box = () => document.querySelector('.rescue-hover-actions')!;
    expect([...box().querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'tag user',
      'ignore',
      'highlight',
    ]);
    for (const b of box().querySelectorAll('button')) expect(b.title).toMatch(/^REScue: /);
    // Reddit swaps the card's content: the actions come back.
    box().remove();
    document.querySelector('[slot="content"]')!.append(document.createElement('span'));
    await wait(450);
    expect(document.querySelectorAll('.rescue-hover-actions')).toHaveLength(2);
  });

  it('"tag" opens the tag editor, "ignore" and "highlight" flip their flags', async () => {
    withCards();
    const m = await boot([userTagger, userHighlight, hoverCardActions], {
      route: { kind: 'front', path: '/' },
      username: 'me_the_reader',
    });
    const [tag, ignore, highlight] = [
      ...document.querySelectorAll('.rescue-hover-actions')[0]!.querySelectorAll('button'),
    ];
    tag!.click();
    expect(document.querySelector('.rescue-tag-save')).not.toBeNull();

    ignore!.click();
    await wait(20);
    expect((m.store.userTags as Record<string, { ignored: boolean }>).rockpaperblr?.ignored).toBe(
      true,
    );
    expect(ignore!.getAttribute('aria-pressed')).toBe('true');
    ignore!.click();
    await wait(20);
    expect(ignore!.getAttribute('aria-pressed')).toBe('false');

    highlight!.click();
    await wait(20);
    const profile = m.ctxs.get('hoverCardActions')!.settings.profile();
    expect(profile.modules.userHighlight?.options?.highlighted).toEqual(['rockpaperblr']);
    expect(highlight!.getAttribute('aria-pressed')).toBe('true');
    highlight!.click();
    await wait(20);
    expect(
      m.ctxs.get('hoverCardActions')!.settings.profile().modules.userHighlight?.options
        ?.highlighted ?? [],
    ).toEqual([]);
  });

  it('omits a word whose feature is off', async () => {
    withCards();
    await boot([userHighlight, hoverCardActions], {
      route: { kind: 'front', path: '/' },
      profileModules: { userHighlight: { options: {} } },
    });
    const words = [...document.querySelectorAll('.rescue-hover-actions button')].map(
      (b) => b.textContent,
    );
    expect(words).toEqual(['highlight', 'highlight']);
  });
});

describe('feed pause', () => {
  const postHtml = (id: string) =>
    `<shreddit-post id="${id}" post-title="t" permalink="/r/a/comments/${id}/x/" author="u" subreddit-name="a"></shreddit-post>`;
  const bridge = () => {
    const calls: unknown[] = [];
    return {
      calls,
      ref: () => 'r1',
      async request(body: unknown) {
        calls.push(body);
        document
          .querySelector('shreddit-feed')!
          .insertAdjacentHTML('afterbegin', postHtml(`t3_new${calls.length}`));
        return { ok: true };
      },
    };
  };
  const loadBtn = () => document.querySelector<HTMLButtonElement>('.rescue-feed-load-more')!;
  const scrolledTo = (y: number) =>
    Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
  // Scrolled a little: the page's first loader then counts as a scroll-triggered page, not the fill.
  beforeEach(() => scrolledTo(300));
  afterEach(() => scrolledTo(0));

  it('holds the loader while paused: hidden, its id set aside, and everything put back on resume', async () => {
    mount(listingHtml());
    const m = await boot([feedPause], {
      route: { kind: 'front', path: '/' },
      options: { feedPause: { autoLoad: false } },
    });
    const loader = document.querySelector('shreddit-feed > faceplate-partial[slot="load-after"]')!;
    expect(loader.hasAttribute('data-rescue-held')).toBe(true);
    // Reddit's own code finds the subreddit loader by this id, so nothing can load it by itself.
    expect(document.getElementById('partial-more-posts-x')).toBeNull();
    expect(loader.id).toBe('rescue-held-partial-more-posts-x');
    // The hover-card partial is never held.
    expect(document.querySelectorAll('[data-rescue-held]')).toHaveLength(1);
    m.menu('feed:pause');
    expect(loader.hasAttribute('data-rescue-held')).toBe(false);
    expect(loader.id).toBe('partial-more-posts-x');
    expect(document.getElementById('rescue-feed-pause')).toBeNull();
    m.menu('feed:pause');
    expect(loader.id).toBe('rescue-held-partial-more-posts-x');
  });

  it('leaves the first loader alone when the page only has a few posts and was not scrolled', async () => {
    scrolledTo(0);
    mount(listingHtml());
    await boot([feedPause], {
      route: { kind: 'front', path: '/' },
      options: { feedPause: { autoLoad: false } },
    });
    expect(document.querySelectorAll('[data-rescue-held]')).toHaveLength(0);
    expect(loadBtn().hidden).toBe(true);
    // The next loader (after the fill) is held.
    document.querySelector('[slot="load-after"]')!.remove();
    document
      .querySelector('shreddit-feed')!
      .insertAdjacentHTML(
        'beforeend',
        '<faceplate-partial slot="load-after" id="partial-more-posts-z" loading="programmatic" src="/svc/shreddit/community-more-posts/hot/?after=t3_z"></faceplate-partial>',
      );
    await wait(30);
    expect(document.getElementById('rescue-held-partial-more-posts-z')).not.toBeNull();
    expect(loadBtn().hidden).toBe(false);
  });

  it('holds a home-feed loader (one id for every page) by hiding it, keeping its id', async () => {
    mount(
      listingHtml().replace(
        'id="partial-more-posts-x"',
        'id="feed-next-page-partial"',
      ),
    );
    await boot([feedPause], {
      route: { kind: 'front', path: '/' },
      options: { feedPause: { autoLoad: false } },
    });
    const loader = document.getElementById('feed-next-page-partial')!;
    expect(loader.hasAttribute('data-rescue-held')).toBe(true);
  });

  it('keeps Reddit’s normal behaviour by default', async () => {
    mount(listingHtml());
    await boot([feedPause], { route: { kind: 'front', path: '/' } });
    expect(document.getElementById('rescue-feed-pause')).toBeNull();
    expect(loadBtn().hidden).toBe(true);
  });

  it('with auto-load off hides Reddit’s loader and shows a load more button that drives the paginator', async () => {
    mount(listingHtml());
    const b = bridge();
    await boot([feedPause], {
      route: { kind: 'front', path: '/' },
      options: { feedPause: { autoLoad: false } },
      bridge: b,
    });
    expect(document.getElementById('rescue-feed-pause')!.textContent).toContain('display:none');
    expect(document.getElementById('rescue-feed-pause')!.textContent).toContain('load-after');
    expect(loadBtn().hidden).toBe(false);
    expect(loadBtn().textContent).toBe('load more');
    expect(loadBtn().title).toMatch(/^REScue: /);
    const before = document.querySelectorAll('shreddit-post').length;
    loadBtn().click();
    expect(loadBtn().textContent).toBe('loading…');
    await wait(80);
    expect(b.calls[0]).toMatchObject({ op: 'partial.load' });
    expect(document.querySelectorAll('shreddit-post').length).toBe(before + 1);
    expect(loadBtn().textContent).toBe('load more');
  });

  it('pauses after N pages loaded automatically', async () => {
    mount(listingHtml());
    const m = await boot([feedPause], {
      route: { kind: 'front', path: '/' },
      options: { feedPause: { pauseAfterEvery: 1 } },
    });
    expect(document.getElementById('rescue-feed-pause')).toBeNull();
    // Reddit loaded a page: its loader is replaced by the next one.
    document
      .querySelector('shreddit-feed')!
      .insertAdjacentHTML(
        'beforeend',
        '<faceplate-partial slot="load-after" id="partial-more-posts-y" loading="programmatic" src="/svc/shreddit/community-more-posts/hot/?after=t3_y"></faceplate-partial>',
      );
    await wait(400);
    expect(document.getElementById('rescue-feed-pause')).not.toBeNull();
    expect(m.notices.some((n) => /Paused after 1 page/.test(n.message))).toBe(true);
    expect(loadBtn().hidden).toBe(false);
  });

  it('retries while Reddit’s loader ignores the call (research R3)', async () => {
    const results = ['failed', 'failed', 'loaded'] as const;
    let n = 0;
    const p = { loadMorePosts: async () => results[n++]! };
    expect(await loadWithRetry(p, 4, 1)).toBe('loaded');
    expect(n).toBe(3);
    n = 0;
    expect(await loadWithRetry({ loadMorePosts: async () => (n++, 'failed' as const) }, 3, 1)).toBe(
      'failed',
    );
    expect(n).toBe(3);
    expect(await loadWithRetry({ loadMorePosts: async () => 'no-more' as const }, 3, 1)).toBe(
      'no-more',
    );
  });
});
