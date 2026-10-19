import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc } from './harness';
import { listingHtml, type FixturePost } from '../fixtures/pages';

// The console must persist neutralityFilter.showLeanScore ("Put the number in the chip") and
// showLean, whether reached from the module page or from search, even when it is closed at once.
const URL = 'https://www.reddit.com/r/politics/';
let ctx: BrowserContext;

const post: FixturePost = {
  id: 't3_right1',
  type: 'link',
  title: 'Story',
  permalink: '/r/politics/comments/right1/story/',
  contentHref: 'https://breitbart.com/story',
  domain: 'breitbart.com',
  score: '10',
  comments: '1',
  author: 'someone',
  sub: 'politics',
};

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, URL, htmlDoc(listingHtml([post])));
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = {
  chrome: { storage: { local: { get(k: string): Promise<Record<string, unknown>> } } };
};
async function storedOptions(): Promise<Record<string, unknown> | undefined> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const got = await sw.evaluate(async () =>
    (globalThis as unknown as Area).chrome.storage.local.get('settings'),
  );
  const s = got.settings as { modules?: Record<string, { options?: Record<string, unknown> }> };
  return s?.modules?.neutralityFilter?.options;
}

const root = (page: Page) => page.locator('#rescue-settings');
const chip = (page: Page) => page.locator('.rescue-lean-chip');

async function openModulePage(): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${URL}#rescue:settings/neutralityFilter`);
  await expect(root(page).locator('#mod-neutralityFilter')).toBeVisible();
  return page;
}

async function toggle(page: Page, key: string): Promise<void> {
  const box = root(page).locator(`input[data-option="neutralityFilter.${key}"]`);
  await box.check();
  await expect(box).toBeChecked();
}

test('module page: showLean then showLeanScore, console closed at once, both stored', async () => {
  const page = await openModulePage();
  const module = root(page).locator('input[data-module-toggle="neutralityFilter"]');
  await module.check();
  await toggle(page, 'showLean');
  await expect(chip(page)).toHaveText('far right'); // live, no reload
  await toggle(page, 'showLeanScore');
  await page.keyboard.press('Escape');
  await expect(root(page)).toHaveCount(0);
  await expect.poll(storedOptions).toMatchObject({ showLean: true, showLeanScore: true });
  await expect(chip(page)).toHaveText('far right +0.73'); // live, no reload
});

test('showLeanScore alone is stored even while showLean is off', async () => {
  const page = await openModulePage();
  await toggle(page, 'showLeanScore');
  await page.keyboard.press('Escape');
  await expect.poll(storedOptions).toMatchObject({ showLeanScore: true });
});

test('search result: toggle the option found by search, close at once, stored', async () => {
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.locator('#rescue-gear').click();
  await page.locator('#rescue-menu [data-menu-id="settings"]').click();
  const search = root(page).locator('input.search');
  await search.fill('number in the chip');
  const results = root(page).locator('[data-search-results]');
  await expect(results).toBeVisible();
  await results.getByText('Put the number in the chip').first().click();
  await toggle(page, 'showLeanScore');
  await page.keyboard.press('Escape');
  await expect(root(page)).toHaveCount(0);
  await expect.poll(storedOptions).toMatchObject({ showLeanScore: true });
});

test('two tabs: a console opened before another tab saved does not undo that save', async () => {
  const tabA = await openModulePage();
  const tabB = await openModulePage(); // B's console now holds the profile as it was before A saved
  await root(tabA).locator('input[data-module-toggle="neutralityFilter"]').check();
  await toggle(tabA, 'showLeanScore');
  await expect.poll(storedOptions).toMatchObject({ showLeanScore: true });

  await toggle(tabB, 'showLean'); // an unrelated change from the stale tab
  await expect.poll(storedOptions).toMatchObject({ showLean: true, showLeanScore: true });
  await tabB.keyboard.press('Escape');
  const sw = ctx.serviceWorkers()[0]!;
  const enabled = await sw.evaluate(async () => {
    const g = globalThis as unknown as Area;
    const s = (await g.chrome.storage.local.get('settings')).settings as {
      modules: Record<string, { enabled?: boolean }>;
    };
    return s.modules.neutralityFilter?.enabled;
  });
  expect(enabled).toBe(true);
});
