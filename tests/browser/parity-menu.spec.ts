import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc, waitForRescue } from './harness';
import { listingHtml } from '../fixtures/pages';

// ui-parity batch 3: gear menu, quick toggle, notices with a settings link, command line.
const URL = 'https://www.reddit.com/r/programming/';
let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, URL, htmlDoc(listingHtml()));
});
test.afterEach(async () => {
  await ctx.close();
});

const open = async (): Promise<Page> => {
  const page = await ctx.newPage();
  await page.goto(URL);
  await waitForRescue(page);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  return page;
};

const menu = (page: Page) => page.locator('#rescue-menu');

test('the gear opens a menu with the console, command line and quick toggles', async () => {
  const page = await open();
  await page.locator('#rescue-gear').click();
  await expect(menu(page)).toBeVisible();
  for (const id of ['settings', 'commandLine', 'quick:hideNsfw', 'about'])
    await expect(menu(page).locator(`[data-menu-id="${id}"]`)).toBeVisible();

  // Escape closes it, and an outside click does too.
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveCount(0);
  await page.locator('#rescue-gear').click();
  await expect(menu(page)).toBeVisible();
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'outside';
    p.textContent = 'outside';
    document.body.prepend(p);
  });
  await page.locator('#outside').click();
  await expect(menu(page)).toHaveCount(0);

  // Arrow keys move through the rows; Enter on "Settings console" opens it.
  await page.locator('#rescue-gear').click();
  await expect(menu(page).locator('[data-menu-id="settings"]')).toBeFocused();
  await page.keyboard.press('ArrowDown'); // the settings row’s search icon
  await page.keyboard.press('ArrowDown');
  await expect(menu(page).locator('[data-menu-id="commandLine"]')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(
    page.locator('#rescue-settings').getByRole('heading', { name: 'REScue settings' }),
  ).toBeVisible();
});

test('the menu’s command line item opens the command line', async () => {
  const page = await open();
  await page.locator('#rescue-gear').click();
  await page.locator('#rescue-menu [data-menu-id="commandLine"]').click();
  await expect(page.locator('#rescue-cmdline input')).toBeFocused();
});

test('Hide NSFW is a quick toggle that persists, with a notice that links to the settings', async () => {
  const page = await open();
  await page.locator('#rescue-gear').click();
  const row = menu(page).locator('[data-menu-id="quick:hideNsfw"]');
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await row.click();
  await expect(row).toHaveAttribute('aria-checked', 'true');
  // Applies at once: the fixture's NSFW post is hidden without a reload.
  await expect(page.locator('shreddit-post#t3_nsfw1')).toBeHidden();

  const notice = page.locator('#rescue-notices .n', { hasText: 'Hide NSFW posts is on' });
  await expect(notice).toBeVisible();
  await expect(notice.locator('.head')).toContainText('filteReddit');
  await notice.locator('a[href="#rescue:settings/filteReddit"]').click();
  const consoleRoot = page.locator('#rescue-settings');
  await expect(consoleRoot.getByRole('heading', { name: 'REScue settings' })).toBeVisible();
  await expect(consoleRoot.getByText('Hide all NSFW posts', { exact: true }).first()).toBeVisible();

  // It is the same switch as in filteReddit’s settings, so it survives a reload.
  await page.reload();
  await page.locator('#rescue-gear').click();
  await expect(menu(page).locator('[data-menu-id="quick:hideNsfw"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('a #rescue:settings link anywhere on the page opens the console', async () => {
  const page = await open();
  await page.evaluate(() => {
    const a = document.createElement('a');
    a.id = 'deep';
    a.href = '#rescue:settings/quarantineHide';
    a.textContent = 'deep link';
    document.body.prepend(a);
  });
  await page.locator('#deep').click();
  await expect(
    page.locator('#rescue-settings [data-module-toggle="quarantineHide"]'),
  ).toBeVisible();
});

test('a command opens its URL: sort shorthand with a period', async () => {
  const page = await open();
  await page.keyboard.press('.');
  await expect(page.locator('#rescue-cmdline input')).toBeFocused();
  await page.keyboard.type('/t week');
  const request = page.waitForRequest((r) => r.url().includes('/r/programming/top/?t=week'));
  await page.keyboard.press('Enter');
  await request;
});

test('? lists the commands and Shift+Enter opens the result in a new tab', async () => {
  const page = await open();
  await page.keyboard.press('.');
  await page.keyboard.type('?');
  await page.keyboard.press('Enter');
  await expect(
    page.locator('#rescue-cmdline li', { hasText: 'm - go to your inbox' }),
  ).toBeVisible();

  await page.locator('#rescue-cmdline input').fill('r/rust');
  const tab = ctx.waitForEvent('page');
  const requested: string[] = [];
  ctx.on('request', (r) => requested.push(r.url()));
  await page.keyboard.press('Shift+Enter');
  const opened = await tab;
  await expect
    .poll(() => requested.some((u) => u.startsWith('https://www.reddit.com/r/rust/')))
    .toBe(true)
    .catch((e: unknown) => {
      console.log(
        '[diag] new tab url:',
        opened.url(),
        'reddit requests:',
        requested.filter((u) => u.includes('reddit.com')),
      );
      throw e;
    });
  // The command line closes and the first page stays where it was.
  await expect(page.locator('#rescue-cmdline')).toHaveCount(0);
  expect(page.url()).toBe(URL);
});
