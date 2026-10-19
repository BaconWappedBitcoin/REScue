import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc } from './harness';
import { listingHtml, nestedThreadHtml, threadComments } from '../fixtures/pages';

// Gap build F: custom filter conditions and "only when browsing", the comment navigator's custom
// category and the nav / fp / fl commands, all on Reddit's own layout.
const LISTING = 'https://www.reddit.com/r/all/';
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const pages: Record<string, string> = {
    [LISTING]: htmlDoc(listingHtml()),
    [THREAD]: htmlDoc(nestedThreadHtml(threadComments(), false, true)),
  };
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

async function configure(modules: Record<string, unknown>) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules },
  );
}

const row = (type: string, pattern: string, when = '') => ({
  type,
  pattern,
  scope: 'everywhere',
  subreddits: '',
  enabled: true,
  toggle: '',
  when,
});

const wrapper = (page: Page, id: string) => page.locator(`article:has(shreddit-post#${id})`);
const banner = (page: Page) => page.locator('#rescue-tools .rescue-filter-banner');

async function open(url: string, modules: Record<string, unknown>): Promise<Page> {
  await configure(modules);
  const page = await ctx.newPage();
  await page.goto(url);
  return page;
}

async function runCommand(page: Page, text: string) {
  await page.locator('#rescue-gear').click();
  await page.locator('#rescue-menu [data-menu-id="commandLine"]').click();
  const input = page.locator('#rescue-cmdline input');
  await expect(input).toBeFocused();
  await input.fill(text);
  await input.press('Enter');
}

test('a custom filter joins conditions with and / or / not', async () => {
  const page = await open(LISTING, {
    filteReddit: {
      enabled: true,
      options: { rules: [row('custom', 'keyword:laid and not (nsfw or spoiler)')] },
    },
  });
  await expect(wrapper(page, 't3_text1')).toBeHidden();
  await expect(wrapper(page, 't3_link1')).toBeVisible();
});

test('“only when browsing” limits a rule to where you are', async () => {
  const hidden = await open(LISTING, {
    filteReddit: { enabled: true, options: { rules: [row('keyword', 'laid', 'onsub:all')] } },
  });
  await expect(wrapper(hidden, 't3_text1')).toBeHidden();
  await hidden.close();

  const shown = await open(LISTING, {
    filteReddit: {
      enabled: true,
      options: { rules: [row('keyword', 'laid', 'front or onmulti:news')] },
    },
  });
  await expect(wrapper(shown, 't3_link1')).toBeVisible();
  await expect(wrapper(shown, 't3_text1')).toBeVisible();
});

test('a bad condition is reported and the rule stays off', async () => {
  const page = await open(LISTING, {
    filteReddit: { enabled: true, options: { rules: [row('custom', 'score<')] } },
  });
  await expect(page.getByText(/turned off because they are invalid/)).toBeVisible();
  await expect(wrapper(page, 't3_text1')).toBeVisible();
});

test('fp switches the filters off for the page view and fl keeps the bar showing', async () => {
  const page = await open(LISTING, {
    filteReddit: { enabled: true, options: { rules: [row('keyword', 'laid')] } },
  });
  await expect(wrapper(page, 't3_text1')).toBeHidden();
  await runCommand(page, 'fp');
  await expect(wrapper(page, 't3_text1')).toBeVisible();
  await expect(banner(page)).toContainText('Filters off');
  await runCommand(page, 'fp');
  await expect(wrapper(page, 't3_text1')).toBeHidden();

  await page.reload();
  await runCommand(page, 'fl');
  await expect(banner(page)).toBeVisible();
});

test('nav opens the comment navigator on the named category', async () => {
  const page = await open(THREAD, { commentNavigator: { enabled: true, options: {} } });
  const nav = page.locator('.rescue-comment-nav');
  await expect(nav).toBeHidden();
  await runCommand(page, 'nav op');
  await expect(nav).toBeVisible();
  await expect(nav.locator('select')).toHaveValue('op');
  await expect(nav.locator('.rescue-nav-count')).toHaveText('0/3');
});

test('the custom category steps through comments that match its conditions', async () => {
  const page = await open(THREAD, {
    commentNavigator: { enabled: true, options: { customConditions: 'attr:op and depth>=1' } },
  });
  await runCommand(page, 'nav custom');
  const nav = page.locator('.rescue-comment-nav');
  await expect(nav.locator('select')).toHaveValue('custom');
  await expect(nav.locator('.rescue-nav-count')).toHaveText('0/3');
  await nav.locator('.rescue-nav-next').click();
  await expect(page.locator('shreddit-comment[thingid="t1_c1"]')).toHaveAttribute(
    'data-rescue-selected',
    '',
  );
});
