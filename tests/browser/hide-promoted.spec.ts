import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc } from './harness';
import {
  POSTS,
  adPostHtml,
  commentsPageAdHtml,
  labelledPostHtml,
  nestedThreadHtml,
  postHtml,
  sidebarAdHtml,
  threadComments,
} from '../fixtures/pages';

// hidePromoted (a REScue extra): off by default; on, it hides the feed ad, a post labelled
// promoted, the comment-page ad and the sidebar ad, counts them in a bar, and "show" brings them
// back for the page. Ad shapes are the live ones from research R21.
const LISTING = 'https://www.reddit.com/r/science/';
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
let ctx: BrowserContext;

const listing = () =>
  htmlDoc(
    `<shreddit-app><div id="main-content"><shreddit-feed>` +
      `${postHtml(POSTS[0]!)}${adPostHtml('t3_ad1', 'Buy things')}` +
      `${labelledPostHtml(POSTS[1]!)}${postHtml(POSTS[2]!)}</shreddit-feed></div>${sidebarAdHtml()}</shreddit-app>`,
  );
const thread = () =>
  htmlDoc(
    nestedThreadHtml(threadComments(), false, true).replace(
      '<shreddit-app>',
      `<shreddit-app>${commentsPageAdHtml()}`,
    ),
  );

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const pages: Record<string, string> = { [LISTING]: listing(), [THREAD]: thread() };
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) => {
    const body = pages[route.request().url().split('#')[0]!];
    return body
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
      : route.abort();
  });
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };

async function configure(options: Record<string, unknown> | null) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules: options ? { hidePromoted: { enabled: true, options } } : {} },
  );
}

type Tabs = {
  chrome: {
    tabs: {
      query(q: object): Promise<Array<{ id?: number }>>;
      sendMessage(id: number, m: object): Promise<void>;
    };
  };
};

/** Change the settings while the page is open; the message is what the console's save sends. */
async function change(options: Record<string, unknown>) {
  await configure(options);
  const sw = ctx.serviceWorkers()[0]!;
  await sw.evaluate(async () => {
    const c = (globalThis as unknown as Tabs).chrome;
    for (const t of await c.tabs.query({ url: '*://www.reddit.com/*' }))
      if (t.id !== undefined) await c.tabs.sendMessage(t.id, { type: 'settings.changed' });
  });
}

async function open(url: string, options: Record<string, unknown> | null): Promise<Page> {
  await configure(options);
  const page = await ctx.newPage();
  await page.goto(url);
  return page;
}

const bar = (page: Page) => page.locator('#rescue-tools .rescue-promoted-banner');
const feedAd = (page: Page) => page.locator('shreddit-ad-post');
const sidebarAd = (page: Page) => page.locator('shreddit-sidebar-ad');
const labelled = (page: Page) => page.locator(`article:has(shreddit-post#${POSTS[1]!.id})`);
const ordinary = (page: Page, id: string) => page.locator(`article:has(shreddit-post#${id})`);

test('is off by default: every ad is shown and there is no bar', async () => {
  const page = await open(LISTING, null);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  await expect(feedAd(page)).toBeVisible();
  await expect(sidebarAd(page)).toBeVisible();
  await expect(labelled(page)).toBeVisible();
  await expect(bar(page)).toHaveCount(0);
});

test('on: hides the ad, the labelled post and the sidebar ad, keeps the rest, and counts them', async () => {
  const page = await open(LISTING, {});
  await expect(bar(page)).toContainText('3 promoted hidden');
  await expect(feedAd(page)).toBeHidden();
  await expect(sidebarAd(page)).toBeHidden();
  await expect(labelled(page)).toBeHidden();
  await expect(ordinary(page, POSTS[0]!.id)).toBeVisible();
  await expect(ordinary(page, POSTS[2]!.id)).toBeVisible();
  await expect(bar(page).locator('.rescue-promoted-count')).toHaveAttribute('title', /^REScue: /);
});

test('"show" brings them back for this page, "hide" puts them away, a reload starts hidden', async () => {
  const page = await open(LISTING, {});
  await expect(bar(page)).toContainText('3 promoted hidden');
  await bar(page).getByRole('button', { name: 'show' }).click();
  await expect(bar(page)).toContainText('3 promoted shown');
  await expect(feedAd(page)).toBeVisible();
  await expect(labelled(page)).toBeVisible();
  await expect(sidebarAd(page)).toBeVisible();
  await bar(page).getByRole('button', { name: 'hide' }).click();
  await expect(feedAd(page)).toBeHidden();
  await bar(page).getByRole('button', { name: 'show' }).click();
  await page.reload();
  await expect(bar(page)).toContainText('3 promoted hidden');
  await expect(feedAd(page)).toBeHidden();
});

test('options apply live: turning one kind off shows it again without a reload', async () => {
  const page = await open(LISTING, {});
  await expect(bar(page)).toContainText('3 promoted hidden');
  await change({ sidebar: false });
  await expect(sidebarAd(page)).toBeVisible();
  await expect(bar(page)).toContainText('2 promoted hidden');
  await expect(feedAd(page)).toBeHidden();
  await change({ posts: false, sidebar: false });
  await expect(feedAd(page)).toBeVisible();
  await expect(labelled(page)).toBeVisible();
  await expect(bar(page)).toBeHidden();
  await change({ showBanner: false });
  await expect(feedAd(page)).toBeHidden();
  await expect(bar(page)).toBeHidden();
});

test('on a thread page it hides the ad above the comments and leaves the comments', async () => {
  const page = await open(THREAD, {});
  await expect(bar(page)).toContainText('1 promoted hidden');
  await expect(page.locator('shreddit-comments-page-ad')).toBeHidden();
  await expect(page.locator('shreddit-comment').first()).toBeVisible();
  await change({ comments: false });
  await expect(page.locator('shreddit-comments-page-ad')).toBeVisible();
});
