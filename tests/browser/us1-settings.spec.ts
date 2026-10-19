import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc } from './harness';
import { listingHtml } from '../fixtures/pages';

// US1 acceptance 1, 3, 5 / quickstart scenarios 1, 2, 4.
const URL = 'https://www.reddit.com/r/programming/';
let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, URL, htmlDoc(listingHtml()));
});
test.afterEach(async () => {
  await ctx.close();
});

const open = async (hash = ''): Promise<Page> => {
  const page = await ctx.newPage();
  await page.goto(URL + hash);
  return page;
};

test('Reddit’s own layout stays visible and REScue adds only its tool strip', async () => {
  const page = await open();
  await expect(page.locator('shreddit-app')).toBeVisible();
  await expect(page.locator('shreddit-post')).toHaveCount(7);
  await expect(page.locator('#rescue-root')).toHaveCount(0);
  await expect(page.locator('#rescue-tools #rescue-gear')).toBeVisible();
});

test('the gear opens the settings console, and a module toggle persists across reload', async () => {
  const page = await open();
  await page.locator('#rescue-gear').click();
  await page.locator('#rescue-menu [data-menu-id="settings"]').click();
  const consoleRoot = page.locator('#rescue-settings');
  await expect(consoleRoot.getByRole('heading', { name: 'REScue settings' })).toBeVisible();
  await consoleRoot.getByRole('button', { name: 'Appearance', exact: true }).click();
  await consoleRoot.locator('[data-module-link="quarantineHide"]').click();
  const toggle = consoleRoot.locator('[data-module-toggle="quarantineHide"]');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(consoleRoot.locator('[data-save-state="saved"]')).toHaveCount(1);
  await page.reload();
  await page.goto(`${URL}#rescue:settings/quarantineHide`);
  await expect(
    page.locator('#rescue-settings [data-module-toggle="quarantineHide"]'),
  ).not.toBeChecked();
});
