import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc } from './harness';
import { listingHtml, type FixturePost } from '../fixtures/pages';

// Neutrality filter: hides link posts by the audience-partisanship score of their domain, through
// filteReddit's banner. Scores used (src/data/neutrality-scores.json): breitbart.com 0.733 (Eady),
// vox.com -0.61 (Eady), infowars.com 0.782 (Robertson).
const LISTING = 'https://www.reddit.com/r/politics/';
const THREAD = 'https://www.reddit.com/r/politics/comments/right1/story/';
const OLD = 'https://www.reddit.com/r/news/';
let ctx: BrowserContext;

const link = (id: string, domain: string): FixturePost => ({
  id: `t3_${id}`,
  type: 'link',
  title: `Story ${id}`,
  permalink: `/r/politics/comments/${id}/story/`,
  contentHref: `https://${domain}/story`,
  domain,
  score: '10',
  comments: '1',
  author: 'someone',
  sub: 'politics',
});
const POSTS: FixturePost[] = [
  link('right1', 'breitbart.com'),
  link('left1', 'vox.com'),
  link('plain1', 'no-such-site.example'),
];

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const pages: Record<string, string> = {
    [LISTING]: htmlDoc(listingHtml(POSTS)),
    [THREAD]: htmlDoc(listingHtml([POSTS[0]!])),
    [OLD]: htmlDoc(listingHtml([link('old1', 'infowars.com')])),
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

/** Settings written before the page loads; the module is on unless `enabled` says otherwise. */
async function configure(options: Record<string, unknown>, enabled = true) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    {
      modules: {
        filteReddit: { enabled: true, options: {} },
        neutralityFilter: { enabled, options },
      },
    },
  );
}

async function open(url: string, options: Record<string, unknown>, enabled = true): Promise<Page> {
  await configure(options, enabled);
  const page = await ctx.newPage();
  await page.goto(url);
  return page;
}

const wrapper = (page: Page, id: string) => page.locator(`article:has(shreddit-post#${id})`);
const banner = (page: Page) => page.locator('#rescue-tools .rescue-filter-banner');

test('off by default: nothing is hidden and no filter bar appears', async () => {
  const page = await open(LISTING, {});
  await expect(wrapper(page, 't3_right1')).toBeVisible();
  await expect(wrapper(page, 't3_left1')).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test('right=mid hides the right-leaning domain with its reason and leaves the left one', async () => {
  const page = await open(LISTING, { right: 'mid' });
  await expect(wrapper(page, 't3_right1')).toBeHidden();
  await expect(wrapper(page, 't3_left1')).toBeVisible();
  await expect(wrapper(page, 't3_plain1')).toBeVisible();
  await expect(banner(page)).toContainText('1 post filtered');

  await banner(page).getByRole('button', { name: 'show', exact: true }).click();
  await expect(wrapper(page, 't3_right1')).toBeVisible();
  await expect(wrapper(page, 't3_right1')).toHaveAttribute(
    'data-rescue-hidden',
    'audience lean right 0.73',
  );
  await expect(wrapper(page, 't3_right1').locator('.rescue-filter-reason')).toHaveText(
    'Filtered: audience lean right 0.73',
  );
  await expect(wrapper(page, 't3_right1').locator('.rescue-filter-reason')).toHaveAttribute(
    'title',
    'REScue: filtered: neutrality filter, ' + BREITBART_HOVER.replace('REScue: ', ''),
  );
  await banner(page).getByRole('button', { name: 'hide', exact: true }).click();
  await expect(wrapper(page, 't3_right1')).toBeHidden();
});

test('left boundaries: -0.61 stays at min, is hidden at mid', async () => {
  let page = await open(LISTING, { left: 'min' });
  await expect(wrapper(page, 't3_left1')).toBeVisible();
  await expect(wrapper(page, 't3_right1')).toBeVisible();
  await page.close();

  page = await open(LISTING, { left: 'mid' });
  await expect(wrapper(page, 't3_left1')).toBeHidden();
  await expect(wrapper(page, 't3_right1')).toBeVisible();
});

test('right boundaries: 0.733 is hidden at min, mid and max', async () => {
  for (const level of ['min', 'mid', 'max']) {
    const page = await open(LISTING, { right: level });
    await expect(wrapper(page, 't3_right1'), level).toBeHidden();
    await page.close();
  }
});

test('a domain only in the 2018 data names that source in its reason', async () => {
  const page = await open(OLD, { right: 'mid' });
  await expect(wrapper(page, 't3_old1')).toBeHidden();
  await banner(page).getByRole('button', { name: 'show', exact: true }).click();
  await expect(wrapper(page, 't3_old1')).toHaveAttribute(
    'data-rescue-hidden',
    'audience lean right 0.78',
  );
});

test('the allow-list overrides the score', async () => {
  const page = await open(LISTING, { left: 'max', right: 'max', allowDomains: ['breitbart.com'] });
  await expect(wrapper(page, 't3_left1')).toBeHidden();
  await expect(wrapper(page, 't3_right1')).toBeVisible();
  await expect(wrapper(page, 't3_plain1')).toBeVisible();
});

test('switched off, the module does nothing even with a side set', async () => {
  const page = await open(LISTING, { right: 'max' }, false);
  await expect(wrapper(page, 't3_right1')).toBeVisible();
});

const chip = (page: Page, id: string) => wrapper(page, id).locator('.rescue-lean-chip');
const BREITBART_HOVER =
  'REScue: breitbart.com audience lean right 0.73 — who shares it on social media, not a rating of its content (Eady et al. 2025)';

test('on the post’s own page it is not hidden and, with showLean, carries a lean chip', async () => {
  const page = await open(THREAD, { right: 'max', showLean: true });
  await expect(wrapper(page, 't3_right1')).toBeVisible();
  await expect(chip(page, 't3_right1')).toHaveText('far right');
  await expect(chip(page, 't3_right1')).toHaveAttribute('title', BREITBART_HOVER);
});

test('no chips unless showLean is on, even with a side set', async () => {
  const page = await open(THREAD, { right: 'max' });
  await expect(wrapper(page, 't3_right1')).toBeVisible();
  await expect(page.locator('.rescue-lean-chip')).toHaveCount(0);
});

test('showLean marks scored link posts with words and colours, with both sides off', async () => {
  const page = await open(LISTING, { showLean: true });
  await expect(chip(page, 't3_right1')).toHaveText('far right');
  await expect(chip(page, 't3_right1')).toHaveCSS('background-color', 'rgb(203, 71, 75)');
  await expect(chip(page, 't3_left1')).toHaveText('left');
  await expect(chip(page, 't3_left1')).toHaveCSS('background-color', 'rgb(83, 124, 212)');
  await expect(chip(page, 't3_plain1')).toHaveCount(0); // unknown domain
  await expect(banner(page)).toHaveCount(0); // nothing hidden
  const color = await chip(page, 't3_left1').evaluate((e) => getComputedStyle(e).color);
  expect(['rgb(0, 0, 0)', 'rgb(255, 255, 255)']).toContain(color);
});

test('a hidden post gets no chip, a visible one does; the number is optional', async () => {
  const page = await open(LISTING, { right: 'mid', showLean: true, showLeanScore: true });
  await expect(wrapper(page, 't3_right1')).toBeHidden();
  await expect(chip(page, 't3_left1')).toHaveText('left -0.61');
});

test('the settings console toggles the chips live, without a reload', async () => {
  const page = await open(LISTING, {});
  await expect(wrapper(page, 't3_right1')).toBeVisible();
  await expect(page.locator('.rescue-lean-chip')).toHaveCount(0);
  await page.goto(`${LISTING}#rescue:settings/neutralityFilter`);
  const toggle = page.locator('#rescue-settings [data-option="neutralityFilter.showLean"]');
  await expect(page.locator('#rescue-settings')).toContainText('Show each post’s audience lean');
  await toggle.check();
  await expect(chip(page, 't3_right1')).toHaveText('far right');
  await toggle.uncheck();
  await expect(page.locator('.rescue-lean-chip:visible')).toHaveCount(0);
});

test('the settings console changes it live, without a reload', async () => {
  const page = await open(LISTING, {});
  await expect(wrapper(page, 't3_right1')).toBeVisible();
  await page.goto(`${LISTING}#rescue:settings/neutralityFilter`);
  const right = page.locator('#rescue-settings [data-option="neutralityFilter.right"]');
  await expect(right.locator('option')).toHaveText([
    'off: do not hide anything',
    'min: only the most one-sided right audiences (≥0.7)',
    'mid: clearly one-sided right audiences (≥0.5)',
    'max: any noticeably one-sided right audience (≥0.3)',
  ]);
  await right.selectOption('mid');
  await expect(wrapper(page, 't3_right1')).toBeHidden();
  await right.selectOption('off');
  await expect(wrapper(page, 't3_right1')).toBeVisible();
});

test('the settings console explains the measure and credits the dataset', async () => {
  const page = await open(LISTING, {});
  await page.goto(`${LISTING}#rescue:settings/neutralityFilter`);
  const section = page.locator('#rescue-settings');
  await expect(section).toContainText('who SHARES a domain');
  await expect(section).toContainText('does not mean a site is neutral');
  await expect(section).toContainText('10.7910/DVN/QAN5VX');
  await expect(section).toContainText('10.7910/DVN/1QMLOV');
  await expect(section).toContainText('about 180 major outlets');
  await expect(
    section.locator('a[href="https://doi.org/10.7910/DVN/1QMLOV"]').first(),
  ).toBeVisible();
  await expect(section).toContainText('no network requests');
  await expect(
    section.locator('a[href="https://doi.org/10.7910/DVN/QAN5VX"]').first(),
  ).toBeVisible();
});
