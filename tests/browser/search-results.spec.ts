import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc } from './harness';
import { searchPageHtml } from '../fixtures/pages';

// Search results are search-telemetry-tracker elements, not shreddit-post (contracts: search.*).
const URL = 'https://www.reddit.com/search/?q=thing&type=posts';
const STYLE = `<style>search-telemetry-tracker[view-events] { display: block; height: 200px; border: 1px solid #ccc }</style>`;
let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, URL, htmlDoc(searchPageHtml(), STYLE));
});
test.afterEach(async () => {
  await ctx.close();
});

const result = (page: Page, id: string) =>
  page.locator(`search-telemetry-tracker[view-events][data-faceplate-tracking-context*='"${id}"']`);

async function addKeywordFilter(page: Page, keyword: string) {
  await page.goto(`${URL}#rescue:settings/filteReddit`);
  const table = page.locator('#rescue-settings [data-option="filteReddit.rules"]');
  await table.locator('button[data-action=add]').click();
  await table.locator('tbody tr').first().locator('input[data-col=pattern]').fill(keyword);
  await table.locator('tbody tr').first().locator('input[data-col=pattern]').press('Tab');
  await expect(page.locator('#rescue-settings [data-save-state="saved"]')).toHaveCount(1);
}

test('a filter hides a matching search result', async () => {
  const page = await ctx.newPage();
  await addKeywordFilter(page, 'borrow');
  await page.goto(URL);
  await page.reload();
  await expect(result(page, 't3_srch1')).toBeVisible();
  await expect(result(page, 't3_srch2')).toBeHidden();
});

test('a user tag shows on a search result, after its time', async () => {
  const page = await ctx.newPage();
  await page.goto(URL);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  // The author is only in the result's JSON; the tag button is placed in the credit row.
  await page.locator('button[aria-label="Tag sci_fan"]').first().click();
  const editor = page.locator('.rescue-tag-editor');
  await expect(editor).toBeVisible();
  await editor.locator('input[name=text]').fill('searcher');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toHaveCount(0);
  const tag = result(page, 't3_srch1').locator(
    '.post-credit-row faceplate-timeago + .rescue-author-extras .rescue-user-tag',
  );
  await expect(tag).toHaveText('searcher');
  await expect(result(page, 't3_srch2').locator('.rescue-user-tag')).toHaveCount(0);
});

test('j moves the selection through the results', async () => {
  const page = await ctx.newPage();
  await page.goto(URL);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  // Keys act on tracked items only: wait until the pipeline has taken in the results.
  await expect(
    page.locator('search-telemetry-tracker[view-events][data-rescue-seen]'),
  ).not.toHaveCount(0);
  const selected = () =>
    page
      .locator('search-telemetry-tracker[data-rescue-selected]')
      .first()
      .getAttribute('data-faceplate-tracking-context');
  await page.keyboard.press('j');
  await expect.poll(selected).toContain('t3_srch1');
  await page.keyboard.press('j');
  await expect.poll(selected).toContain('t3_srch2');
  await page.keyboard.press('k');
  await expect.poll(selected).toContain('t3_srch1');
});
