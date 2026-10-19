import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc } from './harness';
import { listingHtml, postHtml } from '../fixtures/pages';

// US2 / quickstart scenario 5: filters hide matches before display on Reddit’s own layout.
const URL = 'https://www.reddit.com/r/all/';
let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, URL, htmlDoc(listingHtml()));
});
test.afterEach(async () => {
  await ctx.close();
});

async function addKeywordFilter(page: Page, keyword: string) {
  await page.goto(`${URL}#rescue:settings/filteReddit`);
  const table = page.locator('#rescue-settings [data-option="filteReddit.rules"]');
  await table.locator('button[data-action=add]').click();
  await table.locator('tbody tr').first().locator('input[data-col=pattern]').fill(keyword);
  await table.locator('tbody tr').first().locator('input[data-col=pattern]').press('Tab');
  await expect(page.locator('#rescue-settings [data-save-state="saved"]')).toHaveCount(1);
}

/** Simulates Reddit appending a later batch to the feed. */
async function appendPost(page: Page, id: string, title: string) {
  const html = postHtml({
    id,
    type: 'text',
    title,
    permalink: `/r/x/comments/${id}/y/`,
    domain: 'self.x',
    author: 'someone',
    sub: 'x',
    score: '1',
    comments: '0',
  });
  await page.evaluate(
    (h) => document.querySelector('shreddit-feed')!.insertAdjacentHTML('beforeend', h),
    html,
  );
}

test('native: the same filter hides Reddit’s own post wrappers, including later batches', async () => {
  const page = await ctx.newPage();
  await addKeywordFilter(page, 'laid');
  await expect(page.locator('#rescue-settings [data-save-state="saved"]')).toHaveCount(1);
  await page.goto(URL);
  await page.reload();
  await expect(page.locator('#rescue-root')).toHaveCount(0);
  await expect(page.locator('article:has(shreddit-post#t3_text1)')).toBeHidden();
  await expect(page.locator('article:has(shreddit-post#t3_link1)')).toBeVisible();
  await appendPost(page, 't3_late1', 'laid off, part two');
  await expect(page.locator('article:has(shreddit-post#t3_late1)')).toBeHidden();
});

test('the filter banner counts hidden posts and reveals them on demand', async () => {
  const page = await ctx.newPage();
  await addKeywordFilter(page, 'laid');
  await page.goto(URL);
  await page.reload();
  const wrapper = page.locator('article:has(shreddit-post#t3_text1)');
  const banner = page.locator('#rescue-tools .rescue-filter-banner');
  await expect(banner).toContainText('1 post filtered');
  await banner.getByRole('button', { name: 'show' }).click();
  await expect(wrapper).toBeVisible();
  await expect(wrapper).toHaveAttribute('data-rescue-hidden', /keyword/);
  await banner.getByRole('button', { name: 'hide' }).click();
  await expect(wrapper).toBeHidden();
});

test('an invalid regular expression is rejected at input', async () => {
  const page = await ctx.newPage();
  await page.goto(`${URL}#rescue:settings/filteReddit`);
  const table = page.locator('#rescue-settings [data-option="filteReddit.rules"]');
  await table.locator('button[data-action=add]').click();
  const input = table.locator('tbody tr').first().locator('input[data-col=pattern]');
  await input.fill('/(broken/');
  await input.press('Tab');
  await expect(page.locator('#rescue-settings [role=alert]')).toContainText(/regular expression/i);
});
