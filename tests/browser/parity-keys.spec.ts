import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc } from './harness';
import { nestedThreadHtml, threadComments } from '../fixtures/pages';

// UI parity batch 4: the keyboard layer (link numbers, Enter collapse, undo move, Alt+J, copy
// permalink, focus search) against Reddit-shaped fixtures, with the real extension.
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';

const STYLE = `<style>
  shreddit-post { display: block; height: 120px; border: 1px solid #ccc }
  shreddit-comment { display: block; margin-left: 16px }
</style>`;

const comments = () => {
  const cs = threadComments();
  cs[0]!.bodyHtml =
    '<p>See <a href="https://example.co.uk/first">the first</a> and <a href="#top">jump</a> ' +
    'and <a href="https://example.co.uk/second">the second</a>.</p>';
  cs[1]!.bodyHtml = '<p><a href="https://example.co.uk/reply">a reply link</a></p>';
  return cs;
};

const page_ = () =>
  htmlDoc(
    `<form action="/search"><input name="q" placeholder="Search"></form>` +
      `<div class="thread">${nestedThreadHtml(comments(), false, true)}</div>`,
    STYLE,
  );

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await ctx.route('https://example.co.uk/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>external</title>' }),
  );
});
test.afterEach(async () => {
  await ctx.close();
});

async function open(): Promise<Page> {
  await serveRedditPage(ctx, THREAD, page_());
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: 'https://www.reddit.com',
  });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await expect(page.locator('shreddit-post').first()).toBeVisible();
  await expect(page.locator('#rescue-gear')).toBeVisible();
  return page;
}

async function tabCount(): Promise<number> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  return sw.evaluate(async () => {
    const api = (
      globalThis as unknown as { chrome: { tabs: { query(q: object): Promise<unknown[]> } } }
    ).chrome;
    return (await api.tabs.query({})).length;
  });
}

const selectedComment = (page: Page) =>
  page.locator('shreddit-comment[data-rescue-selected]').first().getAttribute('thingid');

test('link numbers are drawn in a REScue layer beside the selected comment’s own links', async () => {
  const page = await open();
  await page.keyboard.press('j'); // the post
  await page.keyboard.press('j'); // c0
  expect(await selectedComment(page)).toBe('t1_c0');

  const layer = page.locator('#rescue-link-numbers');
  await expect(layer.locator('span')).toHaveText(['[1]', '[2]']);
  // Reddit's markup is untouched: no REScue node inside any comment.
  await expect(
    page.locator('shreddit-comment [id^="rescue-"], shreddit-comment .rescue-overlay'),
  ).toHaveCount(0);
  const first = (await page
    .locator('shreddit-comment[thingid="t1_c0"] > details > [slot="comment"] a')
    .first()
    .boundingBox())!;
  const badge = (await layer.locator('span').first().boundingBox())!;
  expect(badge.x).toBeGreaterThanOrEqual(first.x + first.width - 1);
  expect(Math.abs(badge.y - first.y)).toBeLessThan(12);

  // A reply's links are not numbered while its parent is selected; selecting it numbers its own.
  await page.keyboard.press('j'); // c1
  await expect(layer.locator('span')).toHaveText(['[1]']);
  await page.keyboard.press('Escape');
  await expect(layer).toHaveCount(0);
});

test('a number key opens that link in a new tab; Alt+number does the opposite', async () => {
  const page = await open();
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  const tabs = await tabCount();
  await page.keyboard.press('2');
  await expect.poll(tabCount).toBe(tabs + 1);
  expect(page.url()).toBe(THREAD);

  const nav = page.waitForURL('https://example.co.uk/first');
  await page.keyboard.press('Alt+1');
  await nav;
});

test('Enter collapses and expands the selected comment through Reddit’s own details', async () => {
  const page = await open();
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  const details = page.locator('shreddit-comment[thingid="t1_c0"] > details');
  await expect(details).toHaveJSProperty('open', true);
  await page.keyboard.press('Enter');
  await expect(details).toHaveJSProperty('open', false);
  expect(await selectedComment(page)).toBe('t1_c0');
  await expect(page.locator('#rescue-selection')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(details).toHaveJSProperty('open', true);
});

test('Ctrl+Z undoes a move and Alt+J skips to the parent’s next sibling', async () => {
  const page = await open();
  for (let i = 0; i < 4; i++) await page.keyboard.press('j'); // post, c0, c1, c2
  expect(await selectedComment(page)).toBe('t1_c2');
  await page.keyboard.press('Alt+j'); // c2's parent is c1; its next sibling is c3
  expect(await selectedComment(page)).toBe('t1_c3');
  await page.keyboard.press('Control+z');
  expect(await selectedComment(page)).toBe('t1_c2');
  await page.keyboard.press('Control+z');
  expect(await selectedComment(page)).toBe('t1_c1');
});

test('y copies the permalink and says so; Alt+/ focuses the search box', async () => {
  const page = await open();
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.keyboard.press('y');
  await expect(page.locator('[data-rescue-notice="copy-result"]')).toContainText(
    'Copied the permalink',
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/c0/',
  );

  await page.keyboard.press('Alt+/');
  await expect(page.locator('input[name="q"]')).toBeFocused();
  await page.keyboard.type('jjj'); // typing in the box never moves the selection
  expect(await selectedComment(page)).toBe('t1_c0');
});

test('? lists the keys by section, including the link-number keys', async () => {
  const page = await open();
  await page.keyboard.press('?');
  const help = page.locator('#rescue-keyhelp');
  await expect(help).toBeVisible();
  for (const heading of ['Move', 'Open', 'Link numbers', 'Go to', 'Vote', 'General'])
    await expect(help.locator('th', { hasText: new RegExp(`^${heading}$`) })).toHaveCount(1);
  await expect(help).toContainText('1 – 9, 0');
  await expect(help).toContainText('Go back to the previously selected item');
  await expect(help).toContainText('Modmail');
});
