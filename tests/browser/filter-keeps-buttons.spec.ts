import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc, waitForRescue } from './harness';
import { listingHtml } from '../fixtures/pages';

// Regression (buttons-vanish): after filtering a subreddit from the inline menu, the posts that
// stay visible must keep their REScue controls. The same must hold after a settings change made
// from the settings console, and no post may end up with duplicate controls.
const ALL = 'https://www.reddit.com/r/all/';
let ctx: BrowserContext;

function visiblePosts(page: Page) {
  return page.locator('article:has(shreddit-post):not([data-rescue-hidden])');
}

async function assertOneControlPerVisiblePost(page: Page) {
  const posts = visiblePosts(page);
  const count = await posts.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    const post = posts.nth(i);
    await expect(post.locator('.rescue-filter-btn')).toHaveCount(1);
    await expect(post.locator('.rescue-filter-btn')).toBeVisible();
  }
}

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) =>
    route.request().url() === ALL
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: htmlDoc(listingHtml()) })
      : route.abort(),
  );
});

test.afterEach(async () => {
  await ctx.close();
});

test('filtering a subreddit keeps REScue controls on the remaining posts', async () => {
  const page = await ctx.newPage();
  await page.goto(ALL);
  await waitForRescue(page);

  // Sanity: every visible post starts with exactly one inline filter button.
  await assertOneControlPerVisiblePost(page);

  // Filter the nottheonion post; it disappears, the rest keep their controls.
  await page.locator('article:has(shreddit-post#t3_link1) .rescue-filter-btn').click();
  await page.getByRole('menuitem', { name: 'Filter r/nottheonion' }).click();
  await expect(page.locator('article:has(shreddit-post#t3_link1)')).toBeHidden();
  await assertOneControlPerVisiblePost(page);

  // A settings change from the console must not strip controls either. Turning on inline media
  // should add a visible media toggle to image posts while leaving the filter buttons in place.
  await page.goto(`${ALL}#rescue:settings/inlineMedia`);
  await page.locator('[data-option="inlineMedia.collapseMedia"]').check();
  await page.locator('[data-option="inlineMedia.collapsePostMedia"]').check();
  await expect(page.locator('#rescue-settings [data-save-state="saved"]')).toHaveCount(1);

  // Close the console and let REScue apply the new options to the same listing.
  await page.evaluate(() => history.pushState(null, '', window.location.pathname + window.location.search));
  await waitForRescue(page);

  // The filtered post is still hidden and the rest still have exactly one filter button.
  await expect(page.locator('article:has(shreddit-post#t3_link1)')).toBeHidden();
  await assertOneControlPerVisiblePost(page);

  // The image post now also has a visible media toggle, and still only one filter button.
  const image = page.locator('article:has(shreddit-post#t3_image1)');
  await expect(image.locator('.rescue-media-toggle')).toBeVisible();
  await expect(image.locator('.rescue-filter-btn')).toHaveCount(1);
});
