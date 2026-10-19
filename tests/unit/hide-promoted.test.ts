import { afterEach, describe, expect, it } from 'vitest';
import { resolveOptions } from '../../src/core/settings';
import { hidePromoted } from '../../src/modules/listings/hidePromoted';
import { isPromotedLabel } from '../../src/modules/listings/hidePromoted/hider';
import {
  POSTS,
  adPostHtml,
  commentsPageAdHtml,
  labelledPostHtml,
  mount,
  postHtml,
  sidebarAdHtml,
} from '../fixtures/pages';
import { bootModules } from './module-harness';

const MARK = 'data-rescue-promoted';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let booted: Awaited<ReturnType<typeof bootModules>> | null = null;

afterEach(() => {
  booted?.dispose();
  booted = null;
  document.body.innerHTML = '';
  for (const s of document.head.querySelectorAll('style')) s.remove();
});

/** happy-dom has no layout: give these elements a box, as a rendered ad has. */
function render(...sels: string[]): void {
  for (const el of document.querySelectorAll<HTMLElement>(sels.join(','))) {
    el.getBoundingClientRect = () => ({ width: 300, height: 90 }) as DOMRect;
  }
}

const page = (inner: string) =>
  `<shreddit-app><div id="main-content"><shreddit-feed>${inner}</shreddit-feed></div></shreddit-app>`;

async function boot(options: Record<string, boolean> = {}) {
  booted = await bootModules([hidePromoted], {
    route: { kind: 'front', path: '/' },
    options: { hidePromoted: options },
  });
  booted.flush();
  await wait(5);
  return booted;
}

const marked = () => [...document.querySelectorAll(`[${MARK}]`)];
const banner = () => document.querySelector<HTMLElement>('.rescue-promoted-banner')!;
/** The bar is only put on the page once there is something to count. */
const noBanner = () => !banner() || banner().hidden;
const toggle = () => banner().querySelector<HTMLButtonElement>('.rescue-promoted-toggle')!;
const styleText = () => document.getElementById('rescue-hide-promoted')?.textContent ?? '';

/** What the registry does when the settings change: new resolved options, then onSettings. */
function changeOptions(m: Awaited<ReturnType<typeof boot>>, options: Record<string, boolean>) {
  const ctx = m.ctxs.get('hidePromoted')!;
  const profile = {
    schemaVersion: 1,
    keybindings: {},
    syncEnabled: false,
    modules: { hidePromoted: { options } },
  };
  (ctx as { options: unknown }).options = resolveOptions(hidePromoted, profile as never);
  hidePromoted.onSettings!(ctx as never);
}

describe('hidePromoted: defaults', () => {
  it('is off by default, a REScue extra with no RES module behind it', () => {
    expect(hidePromoted.enabledByDefault).toBe(false);
    expect(hidePromoted.resId).toBeUndefined();
    const o = resolveOptions(hidePromoted, { schemaVersion: 1, modules: {} } as never);
    expect(o).toMatchObject({ posts: true, comments: true, sidebar: true, showBanner: true });
  });

  it('says plainly that the ad is still loaded and that a real blocker does more', () => {
    expect(hidePromoted.description).toMatch(/still loads/i);
    expect(hidePromoted.description).toMatch(/uBlock Origin/);
  });
});

describe('hidePromoted: selectors', () => {
  it('hides the feed ad, the comment-page ad and the sidebar ad, and nothing else', async () => {
    mount(
      page(
        `${postHtml(POSTS[0]!)}${adPostHtml()}${postHtml(POSTS[1]!)}` +
          `${commentsPageAdHtml()}${sidebarAdHtml()}`,
      ),
    );
    render('shreddit-ad-post', 'shreddit-comments-page-ad', 'shreddit-sidebar-ad', 'article');
    await boot();
    expect(marked().map((e) => e.localName)).toEqual([
      'shreddit-ad-post',
      'shreddit-comments-page-ad',
      'shreddit-sidebar-ad',
    ]);
    expect(document.querySelectorAll('article[data-rescue-promoted]').length).toBe(0);
    expect(styleText()).toContain('display:none');
    expect(banner().hidden).toBe(false);
    expect(banner().textContent).toBe('3 promoted hidden · show');
    expect(banner().querySelector('.rescue-promoted-count')!.getAttribute('title')).toMatch(
      /^REScue: /,
    );
  });

  it('counts only elements that were rendered, so ads another tool already removed are skipped', async () => {
    mount(page(`${adPostHtml('t3_a')}${adPostHtml('t3_b')}`));
    render('#t3_a'); // t3_b has no box: a blocker hid it
    await boot();
    expect(marked().map((e) => e.id)).toEqual(['t3_a']);
    expect(banner().textContent).toBe('1 promoted hidden · show');
  });

  it('shows no banner and hides nothing when none of it is rendered', async () => {
    mount(page(`${adPostHtml()}`));
    await boot();
    expect(marked()).toEqual([]);
    expect(noBanner()).toBe(true);
  });

  it('fails safe on a page with no promoted slot at all', async () => {
    mount(page(`${postHtml(POSTS[0]!)}${postHtml(POSTS[1]!)}`));
    render('article', 'shreddit-post');
    await boot();
    expect(marked()).toEqual([]);
    expect(noBanner()).toBe(true);
  });

  it('picks up an ad that Reddit adds later, once it has a box', async () => {
    mount(page(postHtml(POSTS[0]!)));
    await boot();
    document.querySelector('shreddit-feed')!.insertAdjacentHTML('beforeend', adPostHtml('t3_late'));
    render('#t3_late');
    await wait(250);
    expect(marked().map((e) => e.id)).toEqual(['t3_late']);
    expect(banner().textContent).toBe('1 promoted hidden · show');
  });

  it('does not count an ad twice when one match sits inside another', async () => {
    mount(page(`${adPostHtml('t3_outer')}`));
    document
      .querySelector('shreddit-ad-post')!
      .insertAdjacentHTML('beforeend', adPostHtml('t3_inner'));
    render('shreddit-ad-post');
    await boot();
    expect(marked().map((e) => e.id)).toEqual(['t3_outer']);
  });
});

describe('hidePromoted: label fallback', () => {
  const POST_A = POSTS[0]!;
  const POST_B = POSTS[1]!;

  it('hides a post whose credit bar says Promoted, by hiding its feed wrapper', async () => {
    mount(page(`${labelledPostHtml(POST_A)}${postHtml(POST_B)}`));
    render('article');
    await boot();
    const hiddenOnes = marked();
    expect(hiddenOnes.length).toBe(1);
    expect(hiddenOnes[0]!.localName).toBe('article');
    expect(hiddenOnes[0]!.querySelector('shreddit-post')!.id).toBe(POST_A.id);
    expect(banner().textContent).toBe('1 promoted hidden · show');
  });

  it.each(['promoted', 'PROMOTED', 'Sponsored', 'Ad'])('matches the word "%s"', async (word) => {
    mount(page(labelledPostHtml(POST_A, word)));
    render('article');
    await boot();
    expect(marked().length).toBe(1);
  });

  it('needs the exact word on the label: titles, bodies and longer text never match', async () => {
    mount(
      page(
        labelledPostHtml(POST_A, 'Promoted by the mods') +
          postHtml({ ...POST_B, id: 't3_t', title: 'Promoted', body: '<p>Ad</p>' }) +
          postHtml({ ...POST_B, id: 't3_u', author: 'Ad' }),
      ),
    );
    render('article');
    await boot();
    expect(marked()).toEqual([]);
  });

  it('takes the label inside the advertiser link, but not a user or community that is just called Ad', () => {
    mount(
      '<div><a href="/user/Ad/"><span id="x">Ad</span></a><a href="/r/promoted/"><span id="z">Promoted</span></a>' +
        '<a href="/user/Roblox/"><span id="w">Ad</span></a><span id="y">Ad</span></div>',
    );
    expect(isPromotedLabel(document.getElementById('x')!)).toBe(false);
    expect(isPromotedLabel(document.getElementById('z')!)).toBe(false);
    expect(isPromotedLabel(document.getElementById('w')!)).toBe(true);
    expect(isPromotedLabel(document.getElementById('y')!)).toBe(true);
  });

  it('does not hide a labelled post that has no box', async () => {
    mount(page(labelledPostHtml(POST_A)));
    await boot();
    expect(marked()).toEqual([]);
    expect(noBanner()).toBe(true);
  });
});

describe('hidePromoted: show and hide again', () => {
  it('"show" reveals the slots for this page, outlined, and "hide" puts them away again', async () => {
    mount(page(`${adPostHtml()}${labelledPostHtml(POSTS[0]!)}`));
    render('shreddit-ad-post', 'article');
    await boot();
    expect(banner().textContent).toBe('2 promoted hidden · show');
    toggle().click();
    expect(banner().textContent).toBe('2 promoted shown · hide');
    expect(styleText()).not.toContain('display:none');
    expect(styleText()).toContain('outline');
    expect(marked().length).toBe(2); // still known, so the count stays right
    toggle().click();
    expect(banner().textContent).toBe('2 promoted hidden · show');
    expect(styleText()).toContain('display:none');
    expect(toggle().title).toMatch(/^REScue: /);
  });

  it('forgets the reveal on the next page', async () => {
    mount(page(adPostHtml()));
    render('shreddit-ad-post');
    const m = await boot();
    toggle().click();
    m.goTo({ kind: 'subreddit', path: '/r/aww/', subreddit: 'aww' });
    await wait(5);
    expect(banner().textContent).toBe('1 promoted hidden · show');
    expect(styleText()).toContain('display:none');
  });
});

describe('hidePromoted: options change live', () => {
  it('stops hiding a kind the moment its option is turned off, and resumes when turned on', async () => {
    mount(page(`${adPostHtml()}${commentsPageAdHtml()}${sidebarAdHtml()}`));
    render('shreddit-ad-post', 'shreddit-comments-page-ad', 'shreddit-sidebar-ad');
    const m = await boot();
    expect(marked().length).toBe(3);
    changeOptions(m, { comments: false });
    expect(marked().map((e) => e.localName)).toEqual(['shreddit-ad-post', 'shreddit-sidebar-ad']);
    expect(banner().textContent).toBe('2 promoted hidden · show');
    expect(styleText()).not.toContain('shreddit-comments-page-ad');
    changeOptions(m, { sidebar: false, comments: false, posts: false });
    expect(marked()).toEqual([]);
    expect(noBanner()).toBe(true);
    expect(document.getElementById('rescue-hide-promoted')).toBeNull();
    changeOptions(m, {});
    expect(marked().length).toBe(3);
  });

  it('applies the label option live too', async () => {
    mount(page(labelledPostHtml(POSTS[0]!)));
    render('article');
    const m = await boot();
    expect(marked().length).toBe(1);
    changeOptions(m, { posts: false });
    expect(marked()).toEqual([]);
    changeOptions(m, { posts: true });
    expect(marked().length).toBe(1);
  });

  it('showBanner off removes the bar but keeps hiding', async () => {
    mount(page(adPostHtml()));
    render('shreddit-ad-post');
    const m = await boot();
    expect(banner().hidden).toBe(false);
    changeOptions(m, { showBanner: false });
    expect(noBanner()).toBe(true);
    expect(marked().length).toBe(1);
  });

  it('puts every slot back when the module is turned off', async () => {
    mount(page(`${adPostHtml()}${labelledPostHtml(POSTS[0]!)}`));
    render('shreddit-ad-post', 'article');
    const m = await boot();
    expect(marked().length).toBe(2);
    m.dispose();
    expect(marked()).toEqual([]);
    expect(document.getElementById('rescue-hide-promoted')).toBeNull();
    expect(document.querySelector('.rescue-promoted-banner')).toBeNull();
  });
});
