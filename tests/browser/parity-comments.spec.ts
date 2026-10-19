import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc, menuClick } from './harness';
import { listingHtml, nestedThreadHtml, threadComments } from '../fixtures/pages';

// ui-parity batch 5b: the comment tools' RES-parity UI, on Reddit's own layout.
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
const LISTING = 'https://www.reddit.com/r/all/';
const HOUR = 3_600_000;

// Depths: c0(0) c1(1) c2(2) c3(1) c4(0) c5(1) c6(0) c7(0) c8(1) c9(2) c10(3) c11(0).
// OP rockpaperblr wrote c1, c5, c9. Comments c0 and c4 are newer than an hour; the rest are older.
function threadPage(): string {
  const now = Date.now();
  const comments = threadComments().map((c, i) => ({
    ...c,
    created: new Date(now - (i === 0 || i === 4 ? HOUR / 2 : 3 * HOUR)).toISOString(),
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
const meta = (page: Page, id: string, sel: string) =>
  comment(page, id).locator(`> details > summary [slot="commentMeta"] ${sel}`);

type Chrome = {
  chrome: {
    storage: { local: { set(v: object): Promise<void> } };
    tabs: { query(q: object): Promise<unknown[]> };
  };
};

async function worker() {
  return ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
}

async function seed(items: Record<string, unknown>) {
  const sw = await worker();
  await sw.evaluate(
    async (v) => (globalThis as unknown as Chrome).chrome.storage.local.set(v),
    items,
  );
}

/** Turn modules on, with options, before the page loads. */
async function configure(modules: Record<string, Record<string, unknown>>) {
  const settings = {
    modules: Object.fromEntries(
      Object.entries(modules).map(([id, options]) => [id, { enabled: true, options }]),
    ),
  };
  await seed({ settings });
}

/** Tabs the browser has open; the extension's tabs.open requests show up here. */
async function tabCount(): Promise<number> {
  const sw = await worker();
  return sw.evaluate(
    async () => (await (globalThis as unknown as Chrome).chrome.tabs.query({})).length,
  );
}

test('comment navigator: shows the position, closes, comes back with N, and steps with Shift+arrows', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const nav = page.locator('.rescue-comment-nav');
  const position = nav.locator('.rescue-nav-count');
  await expect(nav).toBeHidden(); // closed by default, as in RES
  await page.keyboard.press('Shift+N');
  await expect(nav).toBeVisible();
  await nav.locator('select').selectOption('op');
  await expect(position).toHaveText('0/3');
  await nav.locator('.rescue-nav-next').click();
  await expect(position).toHaveText('1/3');
  await expect(comment(page, 't1_c1')).toHaveAttribute('data-rescue-selected', '');

  await nav.locator('.rescue-nav-close').click();
  await expect(nav).toBeHidden();
  await page.keyboard.press('Shift+N');
  await expect(nav).toBeVisible();
  await page.keyboard.press('Shift+ArrowDown');
  await expect(position).toHaveText('2/3');
  await expect(comment(page, 't1_c5')).toHaveAttribute('data-rescue-selected', '');
  await page.keyboard.press('Shift+ArrowUp');
  await expect(position).toHaveText('1/3');

  await nav.locator('select').selectOption('answered'); // OP replied to c0, c4 and c8
  await expect(position).toHaveText('0/3');
  await nav.locator('select').selectOption('all');
  await expect(nav.locator('select option')).toContainText([
    'All comments',
    'OP',
    'Answered by OP',
    'Me',
  ]);
});

test('comment navigator: skip read leaves out the comments that were there at the last visit', async () => {
  await seed({ read: { t3_text1: { lastVisit: Date.now() - HOUR, commentCountAtVisit: 1100 } } });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const nav = page.locator('.rescue-comment-nav');
  await menuClick(page, 'commentNavigator');
  await nav.locator('select').selectOption('all');
  await nav.locator('.rescue-nav-skip-read').check();
  await expect(nav.locator('.rescue-nav-count')).toHaveText('0/2'); // c0 and c4 are new
  await nav.locator('.rescue-nav-next').click();
  await expect(comment(page, 't1_c0')).toHaveAttribute('data-rescue-selected', '');
  await nav.locator('.rescue-nav-next').click();
  await expect(comment(page, 't1_c4')).toHaveAttribute('data-rescue-selected', '');
});

test('show parent: the popup lists the whole chain with goto comment, and Shift+P opens it', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await meta(page, 't1_c2', '.rescue-show-parent').hover(); // c2 replies to c1, which replies to c0
  const entries = page.locator('.rescue-hover .rescue-parent-preview');
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0)).toContainText('comment 1 body');
  await expect(entries.nth(1)).toContainText('comment 0 body');
  await expect(page.locator('.rescue-hover .rescue-parent-arrow')).toHaveText(
    'the comment above replies to the one below ↓',
  );
  await entries.nth(1).locator('.rescue-parent-goto').click();
  await expect(comment(page, 't1_c0')).toHaveAttribute('data-rescue-selected', '');
  await expect(page.locator('.rescue-hover')).toHaveCount(0);

  await comment(page, 't1_c2').locator('[slot="comment"]').first().click(); // selects c2
  await page.mouse.move(2, 2);
  await page.keyboard.press('Shift+P');
  await expect(page.locator('.rescue-hover .rescue-parent-preview')).toHaveCount(2);
});

test('hide child comments: nested controls, and C / Shift+C from the keyboard', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const nested = meta(page, 't1_c1', '.rescue-hide-children'); // c1 has a reply of its own (c2)
  await expect(nested).toHaveText('hide child comments');
  await nested.click();
  await expect(comment(page, 't1_c2')).toBeHidden();
  await expect(comment(page, 't1_c1')).toBeVisible();
  await nested.click();
  await expect(comment(page, 't1_c2')).toBeVisible();

  await comment(page, 't1_c0').locator('[slot="comment"]').first().click(); // selects c0
  await page.keyboard.press('c');
  await expect(comment(page, 't1_c1')).toBeHidden();
  await expect(comment(page, 't1_c3')).toBeHidden();
  expect(page.url()).toBe(THREAD); // C did not also open the comment's page
  await page.keyboard.press('c');
  await expect(comment(page, 't1_c1')).toBeVisible();

  await page.keyboard.press('Shift+C');
  await expect(comment(page, 't1_c5')).toBeHidden();
  await expect(meta(page, 't1_c0', '.rescue-hide-children')).toHaveText('show 3 child comments');
  await page.keyboard.press('Shift+C');
  await expect(comment(page, 't1_c5')).toBeVisible();
});

test('save-RES: new wording, a one-time explainer, and “saved N ago” in the list', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const save = meta(page, 't1_c1', '.rescue-save-comment');
  await expect(save).toHaveText('save-RES');
  await save.click();
  await expect(save).toHaveText('saved-RES');
  const notice = page.locator('#rescue-notices [data-rescue-notice="saveRES-explainer"]');
  await expect(notice).toContainText('keeps a copy of the text on this device');

  await page.reload();
  await meta(page, 't1_c3', '.rescue-save-comment').click();
  await expect(meta(page, 't1_c3', '.rescue-save-comment')).toHaveText('saved-RES');
  await expect(
    page.locator('#rescue-notices [data-rescue-notice="saveRES-explainer"]'),
  ).toHaveCount(0);

  await menuClick(page, 'savedComments');
  const list = page.locator('#rescue-saved-comments');
  await expect(list.locator('.rescue-saved-item').first()).toContainText(
    /saved (just now|\d+ seconds? ago)/,
  );
  await expect(list.getByRole('button', { name: /unsave-RES/ })).toHaveCount(2);
});

test('read comments: a revisit offers to hide the read ones, and to unhide them', async () => {
  await seed({ read: { t3_text1: { lastVisit: Date.now() - HOUR, commentCountAtVisit: 1100 } } });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const notice = page.locator('#rescue-notices [data-rescue-notice="readComments-hide"]');
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Hide read comments' }).click();
  // c0 and c4 are new. Their read replies hide; a read comment with a new one below it stays.
  await expect(comment(page, 't1_c3')).toBeHidden();
  await expect(comment(page, 't1_c5')).toBeHidden();
  await expect(comment(page, 't1_c6')).toBeHidden();
  await expect(comment(page, 't1_c11')).toBeHidden();
  await expect(comment(page, 't1_c0')).toBeVisible();
  await expect(comment(page, 't1_c4')).toBeVisible();

  await notice.getByRole('button', { name: 'Unhide' }).click();
  await expect(comment(page, 't1_c5')).toBeVisible();
  await expect(comment(page, 't1_c11')).toBeVisible();
});


test('single click: [l=c] on text posts when asked, and Ctrl or middle click open background tabs', async () => {
  await configure({ singleClick: { hideLEC: false } });
  const page = await ctx.newPage();
  await page.goto(LISTING);
  const text = page.locator('shreddit-post#t3_text1 a.rescue-single-click');
  await expect(text).toHaveText('[l=c]');
  const both = page.locator('shreddit-post#t3_link1 a.rescue-single-click');
  await expect(both).toHaveText('[l+c]');

  let tabs = await tabCount();
  await text.click();
  await expect.poll(tabCount).toBe(tabs + 1);
  tabs = await tabCount();
  await both.click({ modifiers: ['Control'] });
  await expect.poll(tabCount).toBe(tabs + 2);
  tabs = await tabCount();
  await both.click({ button: 'middle' });
  await expect.poll(tabCount).toBe(tabs + 2);
  expect(page.url()).toBe(LISTING);
});
