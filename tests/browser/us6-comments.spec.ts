import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc, menuClick, menuRowText } from './harness';
import { listingHtml, nestedThreadHtml, threadComments } from '../fixtures/pages';

// US6 / quickstart scenarios 10-11: comment-thread power tools on Reddit's own layout.
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
const LISTING = 'https://www.reddit.com/r/all/';
const HOUR = 3_600_000;

const TABLE =
  '<table><thead><tr><th>Name</th><th>Score</th></tr></thead><tbody>' +
  '<tr><td>bravo</td><td>10</td></tr><tr><td>alpha</td><td>9</td></tr><tr><td>charlie</td><td>100</td></tr>' +
  '</tbody></table>';

// Depths: c0(0) c1(1) c2(2) c3(1) c4(0) c5(1) c6(0) c7(0) c8(1) c9(2) c10(3) c11(0).
// OP rockpaperblr wrote c1, c5, c9. Comments c0 and c4 are newer than an hour; the rest are older.
function threadPage(): string {
  const now = Date.now();
  const comments = threadComments().map((c, i) => ({
    ...c,
    created: new Date(now - (i === 0 || i === 4 ? HOUR / 2 : 3 * HOUR)).toISOString(),
    ...(i === 6 ? { bodyHtml: TABLE } : {}),
  }));
  return htmlDoc(nestedThreadHtml(comments, false, true));
}

let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const pages: Record<string, string> = {
    [THREAD]: threadPage(),
    [LISTING]: htmlDoc(listingHtml()),
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

const comment = (page: Page, id: string) => page.locator(`shreddit-comment[thingid="${id}"]`);

type Area = {
  chrome: { storage: { local: { get(k: null): Promise<unknown>; set(v: object): Promise<void> } } };
};

async function worker() {
  return ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
}

interface Stored {
  read?: Record<string, { lastVisit: number; commentCountAtVisit: number }>;
  savedComments?: Record<string, { bodyText: string }>;
  collapsed?: Record<string, number>;
  settings?: { modules?: Record<string, { options?: { tags?: unknown } }> };
}

/** Everything in extension storage. */
async function stored(): Promise<Stored> {
  const sw = await worker();
  return sw.evaluate(async () => {
    const api = (globalThis as unknown as Area).chrome;
    return (await api.storage.local.get(null)) as Stored;
  });
}

async function seed(items: Record<string, unknown>) {
  const sw = await worker();
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set(v),
    items,
  );
}

test('hide child comments: a top-level comment’s replies hide and show, and so does the whole thread', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const toggle = comment(page, 't1_c0').locator(
    '> details > summary [slot="commentMeta"] .rescue-hide-children',
  );
  await expect(toggle).toHaveText('hide child comments');
  await expect(
    comment(page, 't1_c6').locator(
      '> details > summary [slot="commentMeta"] .rescue-hide-children',
    ),
  ).toBeHidden();

  await toggle.click();
  await expect(comment(page, 't1_c1')).toBeHidden();
  await expect(comment(page, 't1_c2')).toBeHidden(); // nested inside c1
  await expect(comment(page, 't1_c3')).toBeHidden();
  await expect(comment(page, 't1_c0')).toBeVisible();
  await expect(comment(page, 't1_c5')).toBeVisible(); // another top-level comment's reply
  await expect(toggle).toHaveText('show 3 child comments');

  await toggle.click();
  await expect(comment(page, 't1_c1')).toBeVisible();
  await expect(comment(page, 't1_c2')).toBeVisible();

  expect(await menuRowText(page, 'hideAllReplies')).toBe('Hide all replies');
  await menuClick(page, 'hideAllReplies');
  for (const id of ['t1_c1', 't1_c3', 't1_c5', 't1_c8'])
    await expect(comment(page, id)).toBeHidden();
  expect(await menuRowText(page, 'hideAllReplies')).toBe('Show all replies');
  await menuClick(page, 'hideAllReplies');
  await expect(comment(page, 't1_c8')).toBeVisible();
});

test('show parent: hovering a reply’s “↑ parent” shows the parent comment, clicking selects it', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await expect(
    comment(page, 't1_c0').locator('> details > summary [slot="commentMeta"] .rescue-show-parent'),
  ).toHaveCount(0);
  const link = comment(page, 't1_c2').locator(
    '> details > summary [slot="commentMeta"] .rescue-show-parent',
  );
  await link.hover();
  const preview = page.locator('.rescue-hover .rescue-parent-preview').first();
  await expect(preview).toBeVisible();
  await expect(preview).toContainText('u/rockpaperblr');
  await expect(preview).toContainText('comment 1 body');
  await page.mouse.move(2, 2);
  await expect(preview).toHaveCount(0);

  await link.click();
  await expect(comment(page, 't1_c1')).toHaveAttribute('data-rescue-selected', '');
});

test('new comments: marked beside the author after a second visit, with "(N new)" on the listing', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  // First visit: nothing is new, and the visit is recorded.
  await expect(page.locator('shreddit-comment')).toHaveCount(12);
  await expect(page.locator('.rescue-new-comment')).toHaveCount(0);
  await expect.poll(async () => (await stored()).read?.t3_text1?.commentCountAtVisit).toBe(1115);

  // Time passes: the last visit was an hour ago, when the thread had 1,100 comments.
  const secondVisit = Date.now();
  await seed({ read: { t3_text1: { lastVisit: secondVisit - HOUR, commentCountAtVisit: 1100 } } });
  await page.goto(THREAD);
  const marks = page.locator('.rescue-new-comment');
  await expect(marks).toHaveCount(2); // c0 and c4 are newer than the visit
  await expect(
    comment(page, 't1_c0').locator(
      '> details > summary [slot="commentMeta"] a[href*="/user/"] ~ .rescue-new-comment',
    ),
  ).toHaveCount(1);
  await expect(
    comment(page, 't1_c4').locator('> details > summary [slot="commentMeta"] .rescue-new-comment'),
  ).toHaveCount(1);
  await expect(comment(page, 't1_c1').locator('.rescue-new-comment')).toHaveCount(0);
  await expect(page.locator('#rescue-tools .rescue-new-banner')).toHaveText(
    '2 new comments since your last visit',
  );

  // The listing shows how many comments the thread gained since that visit. Wait for this visit
  // to be recorded first, so the seeded record is not overwritten by it.
  await expect
    .poll(async () => (await stored()).read?.t3_text1?.lastVisit ?? 0)
    .toBeGreaterThanOrEqual(secondVisit);
  await seed({ read: { t3_text1: { lastVisit: Date.now() - HOUR, commentCountAtVisit: 1100 } } });
  await page.goto(LISTING);
  const post = page.locator('shreddit-post#t3_text1');
  await expect(post.locator('.rescue-new-count')).toHaveText('(15 new)');
  await expect(page.locator('.rescue-new-count')).toHaveCount(1);
  await expect(post.locator('faceplate-timeago ~ .rescue-new-count')).toHaveCount(1);
});

test('saved comments: save one, see it in the list, keep it across a reload, remove it', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const save = comment(page, 't1_c1').locator(
    '> details > summary [slot="commentMeta"] .rescue-save-comment',
  );
  await expect(save).toHaveText('save-RES');
  await save.click();
  await expect(save).toHaveText('saved-RES');
  await expect.poll(() => menuRowText(page, 'savedComments')).toBe('Saved comments (1)');
  await expect
    .poll(async () => (await stored()).savedComments?.t1_c1?.bodyText)
    .toBe('comment 1 body');

  await page.reload();
  await expect(comment(page, 't1_c1').locator('.rescue-save-comment').first()).toHaveText(
    'saved-RES',
  );
  await menuClick(page, 'savedComments');
  const list = page.locator('#rescue-saved-comments');
  await expect(list.locator('.rescue-saved-item')).toHaveCount(1);
  await expect(list).toContainText('u/rockpaperblr');
  await expect(list).toContainText('comment 1 body');
  await expect(list.locator('a.rescue-saved-open')).toHaveAttribute('href', /\/c1\/$/);

  await list.getByRole('button', { name: /unsave-RES/ }).click();
  await expect(list.locator('.rescue-saved-empty')).toBeVisible();
  await expect.poll(async () => JSON.stringify((await stored()).savedComments)).toBe('{}');
});

test('collapsed comments are remembered and collapsed again on the next visit', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const own = (id: string) => comment(page, id).locator('> details');
  const summary = (id: string) => own(id).locator('> summary');
  // Our buttons inside the summary never toggle Reddit's collapse.
  await comment(page, 't1_c0').locator('> details > summary .rescue-hide-children').click();
  await expect(own('t1_c0')).toHaveJSProperty('open', true);
  await comment(page, 't1_c0').locator('> details > summary .rescue-hide-children').click();

  // The reader collapses a comment with Reddit's own summary.
  await summary('t1_c3').evaluate((el) => (el as HTMLElement).click());
  await expect(own('t1_c3')).toHaveJSProperty('open', false);
  await expect.poll(async () => (await stored()).collapsed).toEqual({ t1_c3: 1 });

  await page.reload();
  await expect(own('t1_c3')).toHaveJSProperty('open', false);
  await expect(own('t1_c2')).toHaveJSProperty('open', true);
  await expect(own('t1_c0')).toHaveJSProperty('open', true);
  expect((await stored()).collapsed).toEqual({ t1_c3: 1 });

  // Re-opening it later is remembered too: wait out the grace period after our own collapse.
  await page.waitForTimeout(2300);
  await summary('t1_c3').evaluate((el) => (el as HTMLElement).click());
  await expect(own('t1_c3')).toHaveJSProperty('open', true);
  await expect.poll(async () => (await stored()).collapsed).toEqual({});
});

test('a table in a comment sorts when its heading is clicked', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const table = comment(page, 't1_c6').locator('table');
  const names = () => table.locator('tbody tr td:first-child').allTextContents();
  expect(await names()).toEqual(['bravo', 'alpha', 'charlie']);
  await table.locator('th', { hasText: 'Name' }).click();
  expect(await names()).toEqual(['alpha', 'bravo', 'charlie']);
  await table.locator('th', { hasText: 'Name' }).click();
  expect(await names()).toEqual(['charlie', 'bravo', 'alpha']);
  await table.locator('th', { hasText: 'Score' }).click();
  expect(await names()).toEqual(['alpha', 'bravo', 'charlie']); // 9, 10, 100
});

test('the comment navigator steps through OP comments and the outline follows', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const nav = page.locator('.rescue-comment-nav');
  await expect(nav).toBeHidden(); // closed until opened
  await menuClick(page, 'commentNavigator');
  await expect(nav.locator('.rescue-nav-count')).toHaveText('0/3');
  await nav.locator('select').selectOption('op');
  await nav.locator('.rescue-nav-next').click();
  await expect(comment(page, 't1_c1')).toHaveAttribute('data-rescue-selected', '');
  await nav.locator('.rescue-nav-next').click();
  await expect(comment(page, 't1_c5')).toHaveAttribute('data-rescue-selected', '');
  await nav.locator('.rescue-nav-prev').click();
  await expect(comment(page, 't1_c1')).toHaveAttribute('data-rescue-selected', '');
  await expect(page.locator('#rescue-selection')).toBeVisible();
});

test('subreddit tags: two cells typed in a row in the console both save, and the tag shows on the listing', async () => {
  const page = await ctx.newPage();
  await page.goto(`${LISTING}#rescue:settings/subredditTagger`);
  const table = page.locator('#rescue-settings [data-option="subredditTagger.tags"]');
  await table.locator('button[data-action=add]').click();
  const row = table.locator('tbody tr').first();
  // Type into the second cell right after the first: the first cell's save must not wipe it.
  await row.locator('input[data-col=subreddit]').fill('aww');
  await row.locator('input[data-col=tag]').fill('cute');
  await row.locator('input[data-col=tag]').press('Tab');
  await expect(row.locator('input[data-col=subreddit]')).toHaveValue('aww');
  await expect(row.locator('input[data-col=tag]')).toHaveValue('cute');
  await expect(page.locator('#rescue-settings [data-save-state="saved"]')).toHaveCount(1);
  await expect
    .poll(async () =>
      JSON.stringify((await stored()).settings?.modules?.subredditTagger?.options?.tags),
    )
    .toContain('cute');

  await page.goto(LISTING);
  await page.reload();
  const tag = page.locator('shreddit-post#t3_image1 .rescue-sub-tag');
  await expect(tag).toHaveText('cute');
  await expect(page.locator('.rescue-sub-tag')).toHaveCount(1);
  await expect(
    page.locator('shreddit-post#t3_image1 faceplate-timeago ~ .rescue-sub-tag'),
  ).toHaveCount(1);
});

test('thread-only menu items are listed on threads and not on listings', async () => {
  const page = await ctx.newPage();
  await page.goto(LISTING);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  expect(await menuRowText(page, 'commentNavigator')).toBeNull();
  expect(await menuRowText(page, 'hideAllReplies')).toBeNull();
  await page.goto(THREAD);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  expect(await menuRowText(page, 'commentNavigator')).toBe('Comment navigator');
  expect(await menuRowText(page, 'hideAllReplies')).toBe('Hide all replies');
});
