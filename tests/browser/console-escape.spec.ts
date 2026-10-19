import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc } from './harness';
import { listingHtml } from '../fixtures/pages';

// Escape inside the console: the search box clears first, then the console closes.
const URL = 'https://www.reddit.com/r/programming/';
let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, URL, htmlDoc(listingHtml()));
});
test.afterEach(async () => {
  await ctx.close();
});

const openConsole = async (): Promise<Page> => {
  const page = await ctx.newPage();
  await page.goto(URL);
  await page.locator('#rescue-gear').click();
  await page.locator('#rescue-menu [data-menu-id="settings"]').click();
  await expect(page.locator('#rescue-settings .console')).toBeVisible();
  return page;
};

test('Escape clears the search box, and a second Escape closes the console', async () => {
  const page = await openConsole();
  const search = page.locator('#rescue-settings input.search');
  await search.fill('hover');
  await expect(page.locator('#rescue-settings [data-search-results]')).toBeVisible();

  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(page.locator('#rescue-settings [data-search-results]')).toHaveCount(0);
  await expect(page.locator('#rescue-settings .console')).toBeVisible();

  await search.press('Escape');
  await expect(page.locator('#rescue-settings')).toHaveCount(0);
});

test('Escape from another console field closes the console', async () => {
  const page = await ctx.newPage();
  await page.goto(`${URL}#rescue:settings/showParent`);
  const root = page.locator('#rescue-settings');
  await expect(root.locator('#mod-showParent')).toBeVisible();
  await root.locator('input[data-setting="showAdvanced"]').check();
  const field = root.locator('[data-option="showParent.hoverDelay"]');
  await expect(field).toBeVisible();
  await field.focus();
  await field.press('Escape');
  await expect(page.locator('#rescue-settings')).toHaveCount(0);
});
