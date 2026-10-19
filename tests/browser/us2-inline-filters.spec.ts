import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc, menuClick, menuRowText } from './harness';
import { listingHtml } from '../fixtures/pages';

// US2 (T132): filter a subreddit, user or domain straight from a post, with Undo, as RES does.
const ALL = 'https://www.reddit.com/r/all/';
const SUB = 'https://www.reddit.com/r/nottheonion/';
let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  // Both listings from one handler: a later route would shadow an earlier one (serveRedditPage).
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) =>
    [ALL, SUB].includes(route.request().url())
      ? route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: htmlDoc(listingHtml()),
        })
      : route.abort(),
  );
});
test.afterEach(async () => {
  await ctx.close();
});

const wrapper = (page: Page, id: string) => page.locator(`article:has(shreddit-post#${id})`);
const button = (page: Page, id: string) => wrapper(page, id).locator('.rescue-filter-btn');
const item = (page: Page, name: RegExp | string) => page.getByRole('menuitem', { name });

async function filterFrom(page: Page, id: string, name: RegExp | string) {
  await button(page, id).click();
  await item(page, name).click();
}

test('⊘ on a post: filter its subreddit, posts vanish without a reload, Undo brings them back', async () => {
  const page = await ctx.newPage();
  await page.goto(ALL);
  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
  await expect(button(page, 't3_link1')).toBeVisible();
  await expect(button(page, 't3_link1')).toHaveCSS('opacity', '1'); // subtle by colour, never by opacity (contrast)
  // The button sits in the credit bar, after the time.
  await expect(
    wrapper(page, 't3_link1').locator('faceplate-timeago ~ .rescue-filter-btn'),
  ).toHaveCount(1);

  await filterFrom(page, 't3_link1', 'Filter r/nottheonion');
  await expect(wrapper(page, 't3_link1')).toBeHidden();
  await expect(wrapper(page, 't3_text1')).toBeVisible();
  await expect(page.getByText('Filtered r/nottheonion.')).toBeVisible();
  // No reload happened.
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(wrapper(page, 't3_link1')).toBeVisible();

  // The rule is in the settings console table once added.
  await filterFrom(page, 't3_link1', 'Filter r/nottheonion');
  await expect(wrapper(page, 't3_link1')).toBeHidden();
  await page.goto(`${ALL}#rescue:settings/filteReddit`);
  const rows = page.locator('#rescue-settings [data-option="filteReddit.rules"] tbody tr');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('input[data-col=pattern]')).toHaveValue('nottheonion');
  await expect(rows.first().locator('[data-col=type]')).toHaveValue('subreddit');
  await expect(rows.first().locator('[data-col=scope]')).toHaveValue('except');
  await expect(rows.first().locator('input[data-col=subreddits]')).toHaveValue('nottheonion');
});

test('⊘ on a post: filter the author', async () => {
  const page = await ctx.newPage();
  await page.goto(ALL);
  await filterFrom(page, 't3_image1', 'Filter u/dogperson');
  await expect(wrapper(page, 't3_image1')).toBeHidden();
  await expect(wrapper(page, 't3_link1')).toBeVisible();
  await expect(page.locator('#rescue-tools .rescue-filter-banner')).toContainText(
    '1 post filtered',
  );
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(wrapper(page, 't3_image1')).toBeVisible();
});

test('⊘ on a link post: filter its domain', async () => {
  const page = await ctx.newPage();
  await page.goto(ALL);
  await filterFrom(page, 't3_link1', 'Filter example.co.uk');
  await expect(wrapper(page, 't3_link1')).toBeHidden();
});

test('the menu is keyboard operable, closes on Escape, and does not navigate the page', async () => {
  const page = await ctx.newPage();
  await page.goto(ALL);
  await button(page, 't3_text1').focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Filter this post' });
  await expect(menu).toBeVisible();
  await expect(item(page, 'Filter r/Layoffs')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(item(page, 'Filter u/rockpaperblr')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(button(page, 't3_text1')).toBeFocused();
  expect(page.url()).toBe(ALL);
  // Enter on an item applies it.
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(wrapper(page, 't3_text1')).toBeHidden();
});

test('subreddit page: the toggle adds and removes the same rule; posts hide elsewhere', async () => {
  const page = await ctx.newPage();
  await page.goto(SUB);
  const label = () => menuRowText(page, 'filterSubreddit');
  expect(await label()).toBe('Filter r/nottheonion');
  await menuClick(page, 'filterSubreddit');
  await expect.poll(label).toBe('Stop filtering r/nottheonion');
  await expect(page.getByText('Filtered r/nottheonion.')).toBeVisible();
  // On its own page the subreddit still shows.
  await expect(wrapper(page, 't3_link1')).toBeVisible();

  await page.goto(ALL);
  await page.reload();
  await expect(wrapper(page, 't3_link1')).toBeHidden();

  await page.goto(SUB);
  await page.reload();
  await expect.poll(label).toBe('Stop filtering r/nottheonion');
  await menuClick(page, 'filterSubreddit');
  await expect.poll(label).toBe('Filter r/nottheonion');
  await expect(page.getByText('Unfiltered r/nottheonion.')).toBeVisible();
  await page.goto(ALL);
  await page.reload();
  await expect(wrapper(page, 't3_link1')).toBeVisible();
});

test('the toggle is not offered on r/all', async () => {
  const page = await ctx.newPage();
  await page.goto(ALL);
  await expect(button(page, 't3_link1')).toBeVisible();
  expect(await menuRowText(page, 'filterSubreddit')).toBeNull();
});
