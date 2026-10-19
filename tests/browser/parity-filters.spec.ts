import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc } from './harness';
import { listingHtml, nestedThreadHtml, threadComments } from '../fixtures/pages';

// UI parity batch 1: filter UI completeness. Power switch, reason chips, the everything-filtered
// notice, placeholder mode, the always-on filter bar, comment filters, more post rule types and
// the NSFW allow-list, all on Reddit's own layout.
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

/** Settings for filteReddit, written before the page loads. */
async function configure(options: Record<string, unknown>) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules: { filteReddit: { enabled: true, options } } },
  );
}

const keyword = (pattern: string) => ({
  type: 'keyword',
  pattern,
  scope: 'everywhere',
  subreddits: '',
  enabled: true,
  toggle: '',
});
const rule = (type: string, pattern = '') => ({ ...keyword(pattern), type });

const wrapper = (page: Page, id: string) => page.locator(`article:has(shreddit-post#${id})`);
const banner = (page: Page) => page.locator('#rescue-tools .rescue-filter-banner');
const comment = (page: Page, id: string) => page.locator(`shreddit-comment[thingid="${id}"]`);

async function open(url: string, options: Record<string, unknown>): Promise<Page> {
  await configure(options);
  const page = await ctx.newPage();
  await page.goto(url);
  return page;
}

test('power switch: off shows what filtering hid, on hides it again, and a reload starts on', async () => {
  const page = await open(LISTING, { rules: [keyword('laid')] });
  await expect(wrapper(page, 't3_text1')).toBeHidden();
  const power = banner(page).getByRole('button', { name: 'Filters on' });
  await expect(power).toHaveAttribute('title', /not saved/);

  await power.click();
  await expect(wrapper(page, 't3_text1')).toBeVisible();
  await expect(banner(page)).toContainText('Filters off · 1 item would be filtered');
  await banner(page).getByRole('button', { name: 'Filters off' }).click();
  await expect(wrapper(page, 't3_text1')).toBeHidden();
  await expect(banner(page)).toContainText('1 post filtered');

  // Off is not saved: a reload filters again.
  await banner(page).getByRole('button', { name: 'Filters on' }).click();
  await expect(wrapper(page, 't3_text1')).toBeVisible();
  await page.reload();
  await expect(wrapper(page, 't3_text1')).toBeHidden();
});

test('a revealed post shows a visible chip naming the rule that matched', async () => {
  const page = await open(LISTING, { rules: [keyword('laid')] });
  await expect(wrapper(page, 't3_text1')).toBeHidden();
  await banner(page).getByRole('button', { name: 'show', exact: true }).click();
  const chip = wrapper(page, 't3_text1').locator('.rescue-filter-reason');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('Filtered: keyword: laid');
  await expect(wrapper(page, 't3_link1').locator('.rescue-filter-reason')).toBeHidden();
  await banner(page).getByRole('button', { name: 'hide', exact: true }).click();
  await expect(wrapper(page, 't3_text1')).toBeHidden();
});

test('everything filtered: a notice offers Show filtered and Show reasons', async () => {
  const page = await open(LISTING, { rules: [keyword('/./')] });
  await expect(wrapper(page, 't3_text1')).toBeHidden();
  await expect(page.getByText('Every post on this page is filtered.')).toBeVisible();
  await page.getByRole('button', { name: 'Show reasons' }).click();
  // Reasons are listed as placeholders; the posts stay out of view.
  await expect(page.locator('.rescue-filter-placeholder')).toHaveCount(7);
  await expect(wrapper(page, 't3_text1')).toBeHidden();
  await expect(page.locator('.rescue-filter-placeholder').first()).toContainText(
    'Filtered: keyword',
  );
});

test('everything filtered: Show filtered reveals the posts', async () => {
  const page = await open(LISTING, { rules: [keyword('/./')] });
  await page.getByRole('button', { name: 'Show filtered' }).click();
  await expect(wrapper(page, 't3_text1')).toBeVisible();
  await expect(wrapper(page, 't3_link1')).toBeVisible();
});

test('placeholder mode leaves a one-line row where the post was; show opens just that post', async () => {
  const page = await open(LISTING, { rules: [keyword('laid')], filteredDisplay: 'placeholder' });
  await expect(wrapper(page, 't3_text1')).toBeHidden();
  const row = page.locator('.rescue-filter-placeholder');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Filtered: keyword: laid');
  // The row is right where the post is, and the rest of the feed is untouched.
  await expect(wrapper(page, 't3_text1').locator('xpath=preceding-sibling::*[1]')).toHaveClass(
    /rescue-filter-placeholder/,
  );
  await expect(wrapper(page, 't3_link1')).toBeVisible();
  await row.getByRole('button', { name: /^show/i }).click();
  await expect(wrapper(page, 't3_text1')).toBeVisible();
  await row.getByRole('button', { name: /^hide/i }).click();
  await expect(wrapper(page, 't3_text1')).toBeHidden();
});

test('the filter bar can stay visible with nothing filtered, and links to the rules', async () => {
  const page = await open(LISTING, { showFilterline: true });
  await expect(banner(page)).toBeVisible();
  await expect(banner(page)).toContainText('No posts filtered');
  await expect(banner(page).getByRole('link', { name: 'rules' })).toHaveAttribute(
    'href',
    '#rescue:settings/filteReddit',
  );
  await banner(page).getByRole('link', { name: 'rules' }).click();
  await expect(page.locator('#rescue-settings [data-option="filteReddit.rules"]')).toBeVisible();

  const quiet = await ctx.newPage();
  await configure({});
  await quiet.goto(LISTING);
  await expect(wrapper(quiet, 't3_text1')).toBeVisible();
  await expect(banner(quiet)).toHaveCount(0);
});

test('more post rules: score, comment count and post type', async () => {
  const page = await open(LISTING, {
    rules: [
      rule('score-above', '40000'),
      rule('comments-below', '2'),
      rule('post-type', 'gallery'),
    ],
  });
  await expect(wrapper(page, 't3_image1')).toBeHidden(); // 43110 points
  await expect(wrapper(page, 't3_safeflag1')).toBeHidden(); // 1 comment
  await expect(wrapper(page, 't3_gallery1')).toBeHidden();
  await expect(wrapper(page, 't3_text1')).toBeVisible();
  await expect(wrapper(page, 't3_link1')).toBeVisible();
});

test('NSFW allow-list: hide all NSFW posts, but not in a listed subreddit', async () => {
  const page = await open(LISTING, { hideNsfw: true });
  await expect(wrapper(page, 't3_nsfw1')).toBeHidden();
  await page.close();
  const allowed = await open(LISTING, { hideNsfw: true, nsfwAllowList: [{ subreddit: 'war' }] });
  await expect(wrapper(allowed, 't3_nsfw1')).toBeVisible();
});

test('comment filters: collapse keeps replies, hide takes the comment out; both listed in the bar', async () => {
  const page = await open(THREAD, {
    commentRules: [
      { type: 'keyword', pattern: 'comment 0 body', action: 'collapse', enabled: true },
      { type: 'keyword', pattern: 'comment 4 body', action: 'hide', enabled: true },
    ],
  });
  await expect(comment(page, 't1_c4')).toBeHidden();
  await expect(comment(page, 't1_c0').locator('[slot=comment]').first()).toBeHidden();
  await expect(comment(page, 't1_c1')).toBeVisible(); // a reply to the collapsed comment
  await expect(comment(page, 't1_c0').locator('.rescue-filter-reason').first()).toContainText(
    'Collapsed: comment keyword: comment 0 body',
  );
  await expect(banner(page)).toContainText('2 comments filtered');

  // The power switch puts both back.
  await banner(page).getByRole('button', { name: 'Filters on' }).click();
  await expect(comment(page, 't1_c4')).toBeVisible();
  await expect(comment(page, 't1_c0').locator('[slot=comment]').first()).toBeVisible();
});

test('comment filters: by author and by depth', async () => {
  const page = await open(THREAD, {
    commentRules: [
      { type: 'user', pattern: 'user6', action: 'hide', enabled: true },
      { type: 'depth', pattern: '3', action: 'collapse', enabled: true },
    ],
  });
  await expect(comment(page, 't1_c6')).toBeHidden();
  await expect(comment(page, 't1_c10').locator('[slot=comment]').first()).toBeHidden(); // depth 3
  await expect(comment(page, 't1_c9').locator('[slot=comment]').first()).toBeVisible(); // depth 2
});
