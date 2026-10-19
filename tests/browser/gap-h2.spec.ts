import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc, menuClick, menuRowText } from './harness';
import { listingHtml, sessionHtml } from '../fixtures/pages';

// T147 (gap build H2): the dashboard panel and its shortcut-bar word, the last visited sort and the
// remembered visit, a remembered feed pause, hiding Reddit's author card, and turning REScue off in
// one tab.
const LISTING = 'https://www.reddit.com/r/programming/';
const ME = 'rockpaperblr';

let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const body = htmlDoc(sessionHtml(true, ME) + listingHtml());
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) =>
    route.request().url().split('#')[0] === LISTING
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
      : route.abort(),
  );
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = {
  chrome: { storage: { local: { set(v: object): Promise<void>; get(k: string): Promise<never> } } };
};
const worker = async () => ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));

async function configure(modules: Record<string, { enabled?: boolean; options?: object }>) {
  const sw = await worker();
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules },
  );
}

async function open(): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(LISTING);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  return page;
}

test('dashboard: a word in the shortcut bar and a menu row open a panel of cards, Escape closes it', async () => {
  await configure({
    subredditManager: {
      enabled: true,
      options: { showDefaults: false, subreddits: [{ target: 'pics', label: '', addedAt: 1 }] },
    },
    dashboard: {
      enabled: true,
      options: { widgets: [{ kind: 'search', target: 'cat videos' }] },
    },
  });
  const page = await open();
  const word = page.locator('#rescue-subreddit-bar a[href="#rescue:dashboard"]');
  await expect(word).toHaveText('Dashboard');
  await word.click();
  const panel = page.locator('#rescue-dashboard');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.rescue-dashboard-card')).toHaveCount(2);
  await expect(panel.locator('a[href="/search/?q=cat%20videos&sort=relevance"]').first()).toBeVisible();
  await expect(panel.locator('a[href="/r/pics/hot/"]').first()).toHaveAttribute('title', /^REScue: /);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await menuClick(page, 'dashboard');
  await expect(panel).toBeVisible();
});

test('the shortcut bar remembers the subreddit page and sorts by last visited', async () => {
  await configure({
    subredditManager: {
      enabled: true,
      options: {
        showDefaults: false,
        linkRandNSFW: true,
        subreddits: [
          { target: 'aaa', label: '', addedAt: 1 },
          { target: 'programming', label: '', addedAt: 2 },
        ],
      },
    },
  });
  const page = await open();
  await expect(page.locator('#rescue-subreddit-bar a[href="/r/randnsfw/"]')).toHaveText('RandNSFW');
  await page.locator('#rescue-subreddit-bar [data-rescue-sort]').click();
  await page.locator('#rescue-subreddit-bar [data-sort="visitDesc"]').click();
  await expect
    .poll(async () => {
      const sw = await worker();
      return sw.evaluate(async () => {
        const got = (await (globalThis as unknown as Area).chrome.storage.local.get(
          'settings',
        )) as unknown as {
          settings: { modules: { subredditManager: { options: { subreddits: Array<{ target: string }> } } } };
        };
        return got.settings.modules.subredditManager.options.subreddits.map((r) => r.target);
      });
    })
    .toEqual(['programming', 'aaa']);
});

test('a pause chosen in the menu is still there after the page is reloaded', async () => {
  await configure({ feedPause: { enabled: true, options: { reversePauseIcon: true } } });
  const page = await open();
  expect(await menuRowText(page, 'feed:pause')).toBe('auto-loading');
  await menuClick(page, 'feed:pause');
  await expect(page.locator('#rescue-feed-pause')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#rescue-gear')).toBeVisible();
  await expect(page.locator('#rescue-feed-pause')).toHaveCount(1);
  expect(await menuRowText(page, 'feed:pause')).toBe('paused');
});

test('hiding Reddit’s author card is opt-in and has a switch in the menu to show it again', async () => {
  await configure({ redditUserInfo: { enabled: true, options: { hideAuthorTooltip: true } } });
  const page = await open();
  await expect(page.locator('#rescue-hide-author-card')).toHaveCount(1);
  await menuClick(page, 'redditUserInfo:cards');
  await expect(page.locator('#rescue-hide-author-card')).toHaveCount(0);
});

test('REScue off in this tab: nothing runs, one button turns it back on', async () => {
  const page = await ctx.newPage();
  // Set once, so the reload after "turn back on" is not switched off again by this script.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    sessionStorage.setItem('rescue:tabDisabled', '1');
  });
  await page.goto(LISTING);
  await expect(page.locator('#rescue-tab-disabled')).toHaveCount(1);
  await expect(page.locator('#rescue-gear')).toHaveCount(0);
  await page.locator('#rescue-tab-disabled button').click();
  await expect(page.locator('#rescue-gear')).toBeVisible();
  await expect(page.locator('#rescue-tab-disabled')).toHaveCount(0);
});
