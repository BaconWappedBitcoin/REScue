import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, waitForRescue } from './harness';
import { LISTING, listing } from './old-skin-fixture';

/**
 * Old Reddit look option "Let the top bars scroll away" (RES pinHeader "none"): Reddit's header
 * (fixed by Reddit, live shape 2026-11-02: `reddit-header-large.fixed`) and REScue's subreddit strip
 * stay at the top of the page but scroll away with it, instead of staying in the window.
 */
const HEADER =
  '<reddit-header-large class="fixed top-0 start-0 end-0" style="position:fixed;top:0;left:0;right:0;height:56px;z-index:4;background:#333">header</reddit-header-large>';
const TALL = '<div style="height:3000px"></div>';

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const body = listing(true, HEADER + TALL);
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) =>
    route.request().url().split('#')[0] === LISTING
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
      : route.abort(),
  );
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };
async function open(options: Record<string, unknown>): Promise<Page> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    {
      modules: {
        oldRedditSkin: { enabled: true, options },
        subredditManager: { enabled: true, options: { showDefaults: true } },
      },
    },
  );
  const page = await ctx.newPage();
  await page.goto(LISTING);
  await waitForRescue(page);
  await expect(page.locator('#rescue-subreddit-bar')).toBeVisible();
  return page;
}
const tops = (p: Page) =>
  p.evaluate(() => ({
    header: Math.round(document.querySelector('reddit-header-large')!.getBoundingClientRect().top),
    strip: Math.round(document.getElementById('rescue-subreddit-bar')!.getBoundingClientRect().top),
  }));

test('by default the header and the subreddit strip stay at the top while you scroll', async () => {
  const p = await open({});
  expect(await tops(p)).toEqual({ header: 18, strip: 0 });
  await p.evaluate(() => window.scrollTo(0, 800));
  await expect.poll(() => tops(p)).toEqual({ header: 18, strip: 0 });
});

test('with "Let the top bars scroll away" they start in the same place and scroll off with the page', async () => {
  const p = await open({ headerScrollsAway: true });
  expect(await tops(p)).toEqual({ header: 18, strip: 0 });
  await p.evaluate(() => window.scrollTo(0, 800));
  await expect.poll(() => tops(p)).toEqual({ header: 18 - 800, strip: -800 });
  await p.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => tops(p)).toEqual({ header: 18, strip: 0 });
});
