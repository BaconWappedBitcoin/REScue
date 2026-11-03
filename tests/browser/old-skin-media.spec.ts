import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, waitForRescue } from './harness';
import { LISTING, THREAD, listing, thread } from './old-skin-fixture';

/**
 * Pictures you can see bigger without leaving the page: the Old Reddit look's "show image" word
 * on a feed post (RES's expando), and a click on a picture in a comment, which shows it full size
 * where it is instead of opening preview.redd.it in a new tab (that address bounces through
 * reddit.com/media and can loop in LibreWolf).
 */
const svg = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="teal"/></svg>`;
const PIC = 'data:image/svg+xml,' + encodeURIComponent(svg(900, 600));
/** Reddit loads a small copy of a comment picture. */
const SMALL = 'data:image/svg+xml,' + encodeURIComponent(svg(320, 213));
const PREVIEW =
  'https://preview.redd.it/a-picture-v0-abc123.jpeg?width=1284&format=pjpg&auto=webp&s=0123';

/** The listing with Reddit's own media container on the first post. */
/**
 * A control inside the media under a click-through overlay, as Reddit draws a gallery's arrows
 * (live 2026-11-03: a `pointer-events-none` layer covers the carousel).
 */
const MEDIA_CONTROL =
  '<button id="media-btn" style="position:absolute;left:10px;top:10px" onclick="this.dataset.hit=1">next</button>' +
  '<style>.pointer-events-none{pointer-events:none}</style>' +
  '<div class="pointer-events-none" style="position:absolute;inset:0"></div>';

/** The listing with Reddit's own media container on the first and third posts (the second is text). */
const listingWithMedia = () => {
  let n = 0;
  return listing().replace(/<\/shreddit-post>/g, (end) => {
    n++;
    const id = n === 1 ? 'post-pic' : n === 3 ? 'post-pic-3' : null;
    return id
      ? `<div slot="post-media-container" style="position:relative"><img id="${id}" src="${PIC}" width="900" height="600">${n === 1 ? MEDIA_CONTROL : ''}</div>${end}`
      : end;
  });
};

/** The thread with a picture in the first comment, drawn as Reddit draws it (240px wide at most). */
const threadWithPicture = () =>
  thread().replace(
    '<div slot="comment">',
    `<div slot="comment"><figure class="rte-media"><a href="${PREVIEW}" target="_blank"><img id="cpic" alt="Comment Image" style="max-width:240px" src="${SMALL}"></a></figure>`,
  );

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) => {
    const url = route.request().url().split('#')[0];
    const body = url === LISTING ? listingWithMedia() : url === THREAD ? threadWithPicture() : null;
    return body
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
      : route.abort();
  });
  // The full-size copy a comment picture's link points to (a page visit there is never served).
  await ctx.route(/^https:\/\/preview\.redd\.it\//, (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(1284, 856) })
      : route.abort(),
  );
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };
async function open(url: string, modules: Record<string, unknown>): Promise<Page> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules },
  );
  const page = await ctx.newPage();
  await page.goto(url);
  await waitForRescue(page);
  return page;
}
const width = (p: Page, sel: string) =>
  p.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().width));

test('"show image" on a feed post shows its picture full size under the row, and "hide image" puts it back', async () => {
  const p = await open(LISTING, { oldRedditSkin: { enabled: true, options: {} } });
  const post = p.locator('shreddit-post').first();
  await expect(post).toHaveAttribute('data-rescue-ov', '1');
  const word = post.locator('.rescue-oexpand');
  await expect(word).toHaveText('show image');
  await expect(word).toHaveAttribute('aria-expanded', 'false');
  // The other posts have no media of their own, so no word.
  await expect(p.locator('shreddit-post').nth(1).locator('.rescue-oexpand')).toBeHidden();
  expect(await width(p, '#post-pic')).toBeLessThan(150);

  await word.click();
  await expect(word).toHaveText('hide image');
  await expect(post).toHaveAttribute('data-rescue-oexp', '');
  await expect.poll(() => width(p, '#post-pic')).toBeGreaterThan(400);
  // The row's own words stay where they were, above the picture.
  const titleBottom = await post
    .locator('.rescue-otitle')
    .evaluate((e) => e.getBoundingClientRect().bottom);
  const picTop = await p.locator('#post-pic').evaluate((e) => e.getBoundingClientRect().top);
  expect(picTop).toBeGreaterThan(titleBottom);
  // Reddit's own parked pieces (here the shadow root's vote row) stay out of sight, below the post.
  const spill = await post.evaluate((el) => {
    const row = el.shadowRoot!.querySelector('#row')!.getBoundingClientRect();
    return {
      rowTop: Math.round(row.top),
      postBottom: Math.round(el.getBoundingClientRect().bottom),
    };
  });
  expect(spill.rowTop).toBeGreaterThanOrEqual(spill.postBottom - 1);

  await word.click();
  await expect(word).toHaveText('show image');
  await expect.poll(() => width(p, '#post-pic')).toBeLessThan(150);
});

test('"show images" in the tab row expands every post with media, and "hide images" puts them back', async () => {
  const p = await open(LISTING, { oldRedditSkin: { enabled: true, options: {} } });
  const posts = p.locator('shreddit-post');
  await expect(posts.first()).toHaveAttribute('data-rescue-ov', '1');
  const all = p.locator('.rescue-otabs .rescue-oshowall');
  await expect(all).toHaveText('show images');
  await expect(all).toHaveAttribute('title', /^REScue: /);
  await all.click();
  await expect(all).toHaveText('hide images');
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(posts.nth(0)).toHaveAttribute('data-rescue-oexp', '');
  await expect(posts.nth(2)).toHaveAttribute('data-rescue-oexp', '');
  await expect(posts.nth(1)).not.toHaveAttribute('data-rescue-oexp', ''); // a text post
  await expect(posts.nth(0).locator('.rescue-oexpand')).toHaveText('hide image');
  await expect.poll(() => width(p, '#post-pic-3')).toBeGreaterThan(400);
  // One post can still be put back on its own.
  await posts.nth(0).locator('.rescue-oexpand').click();
  await expect(posts.nth(0)).not.toHaveAttribute('data-rescue-oexp', '');
  await all.click();
  await expect(all).toHaveText('show images');
  await expect(posts.nth(2)).not.toHaveAttribute('data-rescue-oexp', '');
  await expect(posts.nth(0)).not.toHaveAttribute('data-rescue-oexp', '');
});

test('with links opening in a new tab, a click inside expanded media stays with the media; the thumbnail still opens a tab', async () => {
  const p = await open(LISTING, {
    oldRedditSkin: { enabled: true, options: {} },
    linksNewTab: { enabled: true, options: { postLinks: true } },
  });
  const post = p.locator('shreddit-post').first();
  await expect(post).toHaveAttribute('data-rescue-ov', '1');
  // Collapsed, the picture is the thumbnail: a click opens the post in a new tab.
  const first = ctx.waitForEvent('page');
  await p.locator('#post-pic').click({ force: true });
  await (await first).close();

  await post.locator('.rescue-oexpand').click();
  await expect.poll(() => width(p, '#post-pic')).toBeGreaterThan(400);
  const pages = ctx.pages().length;
  // A click inside the expanded media (a gallery arrow, the player) is the media's own, and
  // reaches a control under Reddit's click-through overlay.
  await p.locator('#media-btn').click({ timeout: 3000 });
  await expect(p.locator('#media-btn')).toHaveAttribute('data-hit', '1');
  await p.locator('#post-pic').click();
  await p.waitForTimeout(600);
  expect(ctx.pages().length).toBe(pages);
  expect(p.url()).toBe(LISTING);
});

test('a click on a picture in a comment shows it full size in place; Ctrl+click is left to Reddit', async () => {
  const p = await open(THREAD, {});
  const pic = p.locator('#cpic');
  await expect(pic).toBeVisible();
  expect(await width(p, '#cpic')).toBeLessThanOrEqual(240);
  const pages = ctx.pages().length;

  await pic.click();
  await expect(p.locator('figure.rte-media')).toHaveAttribute('data-rescue-czoom', '');
  // Reddit's small copy is swapped for the full-size one the link points to.
  await expect(pic).toHaveAttribute('src', PREVIEW);
  await expect.poll(() => width(p, '#cpic')).toBeGreaterThan(320);
  expect(ctx.pages().length).toBe(pages); // no new tab
  expect(p.url()).toBe(THREAD);

  await pic.click();
  await expect(p.locator('figure.rte-media')).not.toHaveAttribute('data-rescue-czoom', '');
  await expect(pic).toHaveAttribute('src', SMALL);
  await expect.poll(() => width(p, '#cpic')).toBeLessThanOrEqual(240);

  // Ctrl+click is not taken over: Reddit's own new-tab link handles it.
  const tab = ctx.waitForEvent('page');
  await pic.click({ modifiers: ['Control'] });
  await tab;
  await expect(p.locator('figure.rte-media')).not.toHaveAttribute('data-rescue-czoom', '');
});

test('with the option off, a comment picture keeps Reddit’s own click', async () => {
  const p = await open(THREAD, {
    inlineMedia: { enabled: true, options: { zoomCommentPictures: false } },
  });
  const tab = ctx.waitForEvent('page');
  await p.locator('#cpic').click();
  await tab;
  await expect(p.locator('figure.rte-media')).not.toHaveAttribute('data-rescue-czoom', '');
});
