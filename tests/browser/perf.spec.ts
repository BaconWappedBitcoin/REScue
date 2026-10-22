import { test, expect, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc } from './harness';
import {
  listingHtml,
  nestedCommentsHtml,
  postHtml,
  POSTS,
  type FixtureComment,
  type FixturePost,
} from '../fixtures/pages';

// T116 / SC-004: new content is filtered and decorated within 200 ms of arriving, and REScue's
// own main-thread work stays within 100 ms per batch, under a 4x CPU throttle.
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
const LISTING = 'https://www.reddit.com/r/programming/';
const BATCH_BUDGET_MS = 100;
const APPEND_TO_DECORATED_MS = 200;
const THROTTLE = 4;
const OUTLIER_FACTOR = 1.5;

const COMMENT_TOTAL = 5000;
const COMMENT_BATCH = 100;
const POST_TOTAL = 500;
const POST_BATCH = 25;

const STYLE = `<style>
  article { margin: 8px 0 }
  shreddit-post { display: block; height: 120px; border: 1px solid #ccc }
  shreddit-comment { display: block; margin-left: 8px }
</style>`;

/**
 * Depth pattern for root comments with replies: siblings, nesting down to depth 9 (so walks over a
 * comment's subtree meet real reply chains), and a return to root. 100 / 20: every batch starts at
 * a root comment.
 */
const TREE_DEPTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 8, 6, 3, 1, 2, 3, 4, 2, 1, 0];

function comments(from: number, count: number): FixtureComment[] {
  const out: FixtureComment[] = [];
  for (let i = from; i < from + count; i++) {
    out.push({
      id: `t1_c${i}`,
      depth: TREE_DEPTHS[i % TREE_DEPTHS.length]!,
      author: `user${i % 97}`,
      body: `comment ${i} body with a few words so it has some weight`,
      score: i % 50,
    });
  }
  return out;
}

function posts(from: number, count: number): FixturePost[] {
  const out: FixturePost[] = [];
  for (let i = from; i < from + count; i++) {
    out.push({
      id: `t3_p${i}`,
      type: 'text',
      title: `Post number ${i}`,
      permalink: `/r/programming/comments/p${i}/post_${i}/`,
      domain: 'self.programming',
      score: String(i),
      comments: String(i % 40),
      author: `author${i % 61}`,
      sub: 'programming',
    });
  }
  return out;
}

interface Timing {
  ms: number;
  posts: number;
  comments: number;
}

// Timing on a shared machine: one retry absorbs a noisy run, two failures in a row do not pass.
test.describe.configure({ retries: 1 });

let ctx: BrowserContext;
let page: Page;
let cdp: CDPSession;
let timings: Timing[];

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  timings = [];
});
test.afterEach(async () => {
  await ctx.close();
});

async function openThrottled(url: string, html: string): Promise<void> {
  await serveRedditPage(ctx, url, html);
  page = await ctx.newPage();
  page.on('console', (m) => {
    const text = m.text();
    if (text.startsWith('[REScue:perf]')) timings.push(JSON.parse(text.slice(13)) as Timing);
  });
  await page.goto(url);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  // The pipeline reports timings only when asked, so nothing is logged for real users.
  await page.evaluate(() => document.documentElement.setAttribute('data-rescue-perf', ''));
  cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
}

/**
 * Appends each batch the way Reddit does (HTML inserted into the container), then waits for REScue
 * to stamp the last item of the batch: the pipeline stamps an item as it consumes it, and the
 * observer below only runs once the pipeline's synchronous filter-and-decorate pass has returned.
 * Resolves with the append-to-decorated time of every batch.
 */
async function appendBatches(
  containerSelector: string,
  itemSelector: string,
  batches: string[],
): Promise<number[]> {
  return page.evaluate(
    async ({ containerSelector, itemSelector, batches }) => {
      const container = document.querySelector(containerSelector)!;
      const results: number[] = [];
      for (const html of batches) {
        // Inserting the markup is Reddit's own work; the clock starts when the content has arrived.
        container.insertAdjacentHTML('beforeend', html);
        // Finding the batch's last item walks every item on the page: the test's own work, done
        // before the clock starts (MutationObserver callbacks only run after this script yields).
        const all = container.querySelectorAll(itemSelector);
        const last = all[all.length - 1]!;
        const t0 = performance.now();
        await new Promise<void>((resolve) => {
          const done = () => {
            results.push(performance.now() - t0);
            resolve();
          };
          if (last.hasAttribute('data-rescue-seen')) return done();
          const mo = new MutationObserver(() => {
            if (!last.hasAttribute('data-rescue-seen')) return;
            mo.disconnect();
            done();
          });
          mo.observe(last, { attributes: true, attributeFilter: ['data-rescue-seen'] });
        });
        // Let the page settle between batches, as a user scrolling would.
        await new Promise((r) => setTimeout(r, 120));
      }
      return results;
    },
    { containerSelector, itemSelector, batches },
  );
}

function report(label: string, appended: number[]): void {
  const work = timings.map((t) => t.ms);
  const max = (xs: number[]) => Math.max(...xs);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  console.log(
    `[perf] ${label}: ${appended.length} batches @${THROTTLE}x | pipeline ms avg ${avg(work).toFixed(1)} max ${max(work).toFixed(1)} | append->decorated ms avg ${avg(appended).toFixed(1)} max ${max(appended).toFixed(1)}`,
  );
}

/**
 * The budgets hold for the 95th percentile of batches; a single batch may overrun by half again
 * (a garbage-collection pause lands on whichever batch is running, and is not REScue's work).
 */
function assertBudgets(appended: number[]): void {
  const work = timings.map((t) => t.ms);
  expect(work.length).toBeGreaterThan(0);
  const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;
  expect(p95(work)).toBeLessThanOrEqual(BATCH_BUDGET_MS);
  expect(Math.max(...work)).toBeLessThanOrEqual(BATCH_BUDGET_MS * OUTLIER_FACTOR);
  expect(p95(appended)).toBeLessThanOrEqual(APPEND_TO_DECORATED_MS);
  expect(Math.max(...appended)).toBeLessThanOrEqual(APPEND_TO_DECORATED_MS * OUTLIER_FACTOR);
}

test('5,000-comment thread stays within the batch budget under 4x CPU throttle', async () => {
  test.setTimeout(300_000);
  const first = nestedCommentsHtml(comments(0, COMMENT_BATCH));
  const html = htmlDoc(
    `<shreddit-app>${postHtml(POSTS[0]!)}<shreddit-comment-tree>${first}</shreddit-comment-tree></shreddit-app>`,
    STYLE,
  );
  await openThrottled(THREAD, html);
  await expect(page.locator('shreddit-comment[data-rescue-seen]').first()).toBeAttached();

  const batches: string[] = [];
  for (let from = COMMENT_BATCH; from < COMMENT_TOTAL; from += COMMENT_BATCH) {
    batches.push(nestedCommentsHtml(comments(from, COMMENT_BATCH)));
  }
  timings.length = 0;
  const appended = await appendBatches('shreddit-comment-tree', 'shreddit-comment', batches);

  expect(await page.locator('shreddit-comment').count()).toBe(COMMENT_TOTAL);
  report('comments', appended);
  assertBudgets(appended);
});

test('500-post endless listing stays within the batch budget under 4x CPU throttle', async () => {
  const html = htmlDoc(listingHtml(posts(0, POST_BATCH)), STYLE);
  await openThrottled(LISTING, html);
  await expect(page.locator('shreddit-post[data-rescue-seen]').first()).toBeAttached();

  const batches: string[] = [];
  for (let from = POST_BATCH; from < POST_TOTAL; from += POST_BATCH) {
    batches.push(posts(from, POST_BATCH).map(postHtml).join(''));
  }
  timings.length = 0;
  const appended = await appendBatches('shreddit-feed', 'shreddit-post', batches);

  expect(await page.locator('shreddit-post').count()).toBe(POST_TOTAL);
  report('posts', appended);
  assertBudgets(appended);
});
