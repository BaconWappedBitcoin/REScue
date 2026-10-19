import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc, waitForRescue } from './harness';
import { nestedThreadHtml, threadComments } from '../fixtures/pages';

// Lane comment-tweaks: thread line colour/width, reply indent, score highlighting, the “upvoted”
// navigator category and the “load more replies” key, on Reddit’s own layout.
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';

let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const page = htmlDoc(nestedThreadHtml(threadComments()));
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) =>
    route.request().url() === THREAD
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: page })
      : route.abort(),
  );
});
test.afterEach(async () => {
  await ctx.close();
});

type Chrome = {
  chrome: { storage: { local: { set(v: object): Promise<void> } } };
};

async function worker() {
  return ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
}

/** Turn modules on, with options, before the page loads. */
async function configure(modules: Record<string, Record<string, unknown>>) {
  const sw = await worker();
  await sw.evaluate(
    async (v) => (globalThis as unknown as Chrome).chrome.storage.local.set(v),
    {
      settings: {
        modules: Object.fromEntries(
          Object.entries(modules).map(([id, options]) => [id, { enabled: true, options }]),
        ),
      },
    },
  );
}

const comment = (page: Page, id: string) => page.locator(`shreddit-comment[thingid="${id}"]`);

/** Give a comment Reddit’s action row with an open shadow root holding vote buttons. */
async function addRow(
  page: Page,
  id: string,
  opts: { score?: number; upvoted?: boolean } = {},
): Promise<void> {
  await page.evaluate(
    ({ id, opts }) => {
      const host = document.querySelector(`shreddit-comment[thingid="${id}"]`);
      if (!host) return;
      const row = document.createElement('shreddit-comment-action-row');
      row.setAttribute('slot', 'actionRow');
      row.setAttribute('comment-id', id);
      if (opts.score !== undefined) row.setAttribute('score', String(opts.score));
      row.setAttribute('vote-state', opts.upvoted ? 'up' : 'none');
      const root = row.attachShadow({ mode: 'open' });
      root.innerHTML =
        `<button upvote aria-pressed="${opts.upvoted ? 'true' : 'false'}"></button>` +
        `<button downvote aria-pressed="false"></button>`;
      host.appendChild(row);
    },
    { id, opts },
  );
}

const prop = (page: Page, selector: string, name: string): Promise<string> =>
  page.locator(selector).evaluate((el, n) => getComputedStyle(el).getPropertyValue(n as never), name);

test('quick collapse: thread line colour/width, and the collapsed colour', async () => {
  await configure({
    commentQuickCollapse: {
      scrollOnCollapse: false,
      leftEdgeColor: '#ff0000',
      leftEdgeWidth: 5,
      leftEdgeCollapsedColor: '#0000ff',
    },
  });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  // Mark c1 collapsed so its thread line uses the collapsed colour.
  await comment(page, 't1_c1').evaluate((el) => el.setAttribute('collapsed', ''));

  const plain = 'shreddit-comment[thingid="t1_c0"] > .threadline-strip';
  const collapsed = 'shreddit-comment[thingid="t1_c1"] > .threadline-strip';
  await expect.poll(() => prop(page, plain, 'background-color')).toBe('rgb(255, 0, 0)');
  await expect.poll(() => prop(page, plain, 'width')).toBe('5px');
  await expect.poll(() => prop(page, collapsed, 'background-color')).toBe('rgb(0, 0, 255)');
});

test('comment style: nested replies get the extra indent, the top level does not', async () => {
  await configure({
    commentStyle: {
      commentBoxes: false,
      commentRounded: false,
      commentHoverBorder: false,
      commentIndent: 24,
    },
  });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await expect
    .poll(() => prop(page, 'shreddit-comment[thingid="t1_c1"]', 'margin-left'))
    .toBe('24px');
  await expect
    .poll(() => prop(page, 'shreddit-comment[thingid="t1_c0"]', 'margin-left'))
    .not.toBe('24px');
});

test('highlight scores: REScue’s own score chip is bold', async () => {
  await configure({ voteEnhancements: { highlightScores: true, colorCommentScore: true } });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await waitForRescue(page);
  await addRow(page, 't1_c0', { score: 30 });
  const chip = comment(page, 't1_c0').locator('.rescue-score-chip').first();
  await expect(chip).toBeVisible();
  await expect.poll(() => chip.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('700');
});

test('comment navigator: the “Upvoted” category steps to a comment whose upvote is pressed', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await waitForRescue(page);
  await addRow(page, 't1_c0', { upvoted: true });
  const nav = page.locator('.rescue-comment-nav');
  await page.keyboard.press('Shift+N');
  await expect(nav).toBeVisible();
  await nav.locator('select').selectOption('upvoted');
  await nav.locator('.rescue-nav-next').click();
  await expect(comment(page, 't1_c0')).toHaveAttribute('data-rescue-selected', '');
});

test('load more replies: N clicks the selected comment’s own “more replies” control', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await waitForRescue(page);
  await page.evaluate(() => {
    const host = document.querySelector('shreddit-comment[thingid="t1_c0"]');
    if (!host) return;
    const b = document.createElement('button');
    b.id = 'more-replies-fixture';
    b.textContent = '3 more replies';
    b.addEventListener('click', () => b.setAttribute('data-clicked', ''));
    host.appendChild(b);
  });
  await comment(page, 't1_c0').locator('[slot="comment"]').first().click(); // selects c0
  await expect(comment(page, 't1_c0')).toHaveAttribute('data-rescue-selected', '');
  await page.keyboard.press('n');
  await expect(page.locator('#more-replies-fixture')).toHaveAttribute('data-clicked', '');
});
