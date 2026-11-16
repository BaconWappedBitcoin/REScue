import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc } from './harness';
import { listingHtml, type FixturePost } from '../fixtures/pages';

// Topic filters: hide every post from a topic's subreddits, through filteReddit's banner. The
// topic data is bundled (src/modules/listings/topicFilters/topics.ts): nba and nfl are Sports,
// anime is Anime & manga, askreddit is in no topic.
const FRONT = 'https://www.reddit.com/';
const NBA = 'https://www.reddit.com/r/nba/';
let ctx: BrowserContext;

const post = (id: string, sub: string): FixturePost => ({
  id: `t3_${id}`,
  type: 'text',
  title: `Post ${id}`,
  permalink: `/r/${sub}/comments/${id}/post/`,
  score: '10',
  comments: '1',
  author: 'someone',
  sub,
});
const POSTS: FixturePost[] = [
  post('sport1', 'nba'),
  post('sport2', 'nfl'),
  post('toon1', 'anime'),
  post('plain1', 'askreddit'),
];

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const pages: Record<string, string> = {
    [FRONT]: htmlDoc(listingHtml(POSTS)),
    [NBA]: htmlDoc(listingHtml([POSTS[0]!, POSTS[1]!])),
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

/** Settings written before the page loads; filteReddit is on, as it is by default. */
async function configure(options: Record<string, unknown>) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    {
      modules: {
        filteReddit: { enabled: true, options: {} },
        topicFilters: { enabled: true, options },
      },
    },
  );
}

async function open(url: string, options: Record<string, unknown>): Promise<Page> {
  await configure(options);
  const page = await ctx.newPage();
  await page.goto(url);
  return page;
}

const wrapper = (page: Page, id: string) => page.locator(`article:has(shreddit-post#${id})`);
const banner = (page: Page) => page.locator('#rescue-tools .rescue-filter-banner');

test('nothing is hidden until a topic is on', async () => {
  const page = await open(FRONT, {});
  await expect(wrapper(page, 't3_sport1')).toBeVisible();
  await expect(wrapper(page, 't3_toon1')).toBeVisible();
  await expect(banner(page)).toHaveCount(0);
});

test('a topic that is on hides its subreddits, shows the banner, and reveals with the reason', async () => {
  const page = await open(FRONT, { topic_sports: true });
  await expect(wrapper(page, 't3_sport1')).toBeHidden();
  await expect(wrapper(page, 't3_sport2')).toBeHidden();
  await expect(wrapper(page, 't3_toon1')).toBeVisible();
  await expect(wrapper(page, 't3_plain1')).toBeVisible();
  await expect(banner(page)).toContainText('2 posts filtered');

  await banner(page).getByRole('button', { name: 'show', exact: true }).click();
  await expect(wrapper(page, 't3_sport1')).toBeVisible();
  await expect(wrapper(page, 't3_sport1').locator('.rescue-filter-reason')).toHaveText(
    'Filtered: topic: Sports',
  );
});

test('browsing a subreddit directly shows its posts', async () => {
  const page = await open(NBA, { topic_sports: true });
  await expect(wrapper(page, 't3_sport1')).toBeVisible(); // r/nba, the page being browsed
  await expect(wrapper(page, 't3_sport2')).toBeHidden(); // r/nfl is still hidden
});

test('the allow-list keeps a subreddit of a topic that is on', async () => {
  const page = await open(FRONT, { topic_sports: true, allowList: [{ subreddit: 'nba' }] });
  await expect(wrapper(page, 't3_sport1')).toBeVisible();
  await expect(wrapper(page, 't3_sport2')).toBeHidden();
});

test('the REScue menu panel checkbox hides and shows the topic at once', async () => {
  const page = await open(FRONT, {});
  await page.locator('#rescue-gear').click();
  const row = page.locator('#rescue-menu [data-menu-id="topicFilters"]');
  await expect(row).toContainText('Topic filters: none');
  await row.click();

  const panel = page.locator('.rescue-topic-panel');
  await expect(panel).toBeVisible();
  await panel.getByLabel('Anime & manga').check();
  await expect(wrapper(page, 't3_toon1')).toBeHidden();
  await expect(wrapper(page, 't3_sport1')).toBeVisible();
  await expect(banner(page)).toContainText('1 post filtered');

  await panel.getByLabel('Anime & manga').uncheck();
  await expect(wrapper(page, 't3_toon1')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});
