import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc, waitForRescue } from './harness';
import { listingHtml, nestedThreadHtml, POSTS } from '../fixtures/pages';

// US3 / quickstart scenario 7: keyboard navigation over Reddit's own posts and comments.
const LISTING = 'https://www.reddit.com/r/programming/';
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';

const STYLE = `<style>
  article { margin: 8px 0 }
  shreddit-post { display: block; height: 300px; border: 1px solid #ccc }
  shreddit-comment { display: block; margin-left: 16px }
  .thread shreddit-post { height: 120px }
</style>`;

/**
 * Stands in for Reddit: a shadow-root rich-text editor, and a loader that appends three posts to
 * the feed once the page is scrolled to its bottom (as Reddit's own IntersectionObserver would).
 */
const SCRIPT = `<script>
customElements.define('fake-rte', class extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = '<div contenteditable="true" data-lexical-editor="true" style="min-height:20px;border:1px solid"></div>';
  }
});
window.__clicks = 0;
document.addEventListener('click', (e) => { window.__clicks++; window.__prevented = e.defaultPrevented; });
let loaded = false;
addEventListener('scroll', () => {
  const feed = document.querySelector('shreddit-feed');
  if (loaded || !feed || innerHeight + scrollY < document.documentElement.scrollHeight - 20) return;
  loaded = true;
  setTimeout(() => {
    let html = '';
    for (let i = 1; i <= 3; i++) {
      const id = 't3_new' + i;
      html += '<article><shreddit-post id="' + id + '" post-title="Loaded ' + i + '" permalink="/r/programming/comments/new' + i +
        '/x/" post-type="text" domain="self.programming" author="someone" subreddit-name="programming" score="1" comment-count="0"></shreddit-post></article>';
    }
    feed.insertAdjacentHTML('beforeend', html);
  }, 50);
});
</script>`;

const TAIL = '<fake-rte></fake-rte><div style="height:200px"></div>';
const listingPage = () => htmlDoc(listingHtml() + TAIL + SCRIPT, STYLE);
const threadPage = () =>
  htmlDoc(`<div class="thread">${nestedThreadHtml()}</div>${TAIL}${SCRIPT}`, STYLE);

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

async function open(url: string, html: string): Promise<Page> {
  await serveRedditPage(ctx, url, html);
  const page = await ctx.newPage();
  await page.goto(url);
  await waitForRescue(page);
  await expect(page.locator('shreddit-post').first()).toBeVisible();
  // Extension is ready once its gear is on the page.
  await expect(page.locator('#rescue-gear')).toBeVisible();
  return page;
}

/** Tabs the browser has open; the extension's tab.open requests show up here, not as Page events. */
async function tabCount(): Promise<number> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  return sw.evaluate(async () => {
    const api = (
      globalThis as unknown as { chrome: { tabs: { query(q: object): Promise<unknown[]> } } }
    ).chrome;
    return (await api.tabs.query({})).length;
  });
}

/**
 * Everything in extension storage, as JSON. The console's "saved" indicator can be left over from
 * an earlier edit, so tests wait for the stored value itself before reloading.
 */
async function stored(): Promise<string> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  return sw.evaluate(async () => {
    const api = (
      globalThis as unknown as {
        chrome: { storage: { local: { get(k: null): Promise<unknown> } } };
      }
    ).chrome;
    return JSON.stringify(await api.storage.local.get(null));
  });
}

const selectedPost = (page: Page) =>
  page.locator('shreddit-post[data-rescue-selected]').first().getAttribute('id');
const selectedComment = (page: Page) =>
  page.locator('shreddit-comment[data-rescue-selected]').first().getAttribute('thingid');
const box = (page: Page) => page.locator('#rescue-selection');

async function expectBoxOver(page: Page, target: ReturnType<Page['locator']>) {
  const b = (await box(page).boundingBox())!;
  const t = (await target.boundingBox())!;
  expect(Math.abs(b.x - t.x)).toBeLessThan(3);
  expect(Math.abs(b.y - t.y)).toBeLessThan(3);
  expect(Math.abs(b.width - t.width)).toBeLessThan(3);
  expect(Math.abs(b.height - t.height)).toBeLessThan(3);
}

test('j/k move the selection over Reddit’s posts, outlined by REScue’s own box and kept in view', async () => {
  const page = await open(LISTING, listingPage());
  await page.keyboard.press('j');
  expect(await selectedPost(page)).toBe(POSTS[0]!.id);
  await expectBoxOver(page, page.locator(`article:has(shreddit-post#${POSTS[0]!.id})`));
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  expect(await selectedPost(page)).toBe(POSTS[2]!.id);
  await page.keyboard.press('k');
  expect(await selectedPost(page)).toBe(POSTS[1]!.id);
  for (let i = 0; i < 4; i++) await page.keyboard.press('j');
  expect(await selectedPost(page)).toBe(POSTS[5]!.id);
  await expect(box(page)).toBeInViewport();
  await expectBoxOver(page, page.locator(`article:has(shreddit-post#${POSTS[5]!.id})`));
  // Reddit's own element is only marked, never restyled with an outline.
  const host = page.locator(`shreddit-post#${POSTS[5]!.id}`);
  expect(await host.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-rescue-selected]')).toHaveCount(0);
  await expect(box(page)).toHaveCount(0);
});

test('in a thread the outline covers a comment’s own text, not its replies', async () => {
  const page = await open(THREAD, threadPage());
  await page.keyboard.press('j'); // the post
  expect(await selectedPost(page)).toBe('t3_text1');
  await page.keyboard.press('j'); // c0, which has replies c1..c3
  expect(await selectedComment(page)).toBe('t1_c0');
  const c0 = page.locator('shreddit-comment[thingid="t1_c0"]');
  const c1 = page.locator('shreddit-comment[thingid="t1_c1"]');
  const b = (await box(page).boundingBox())!;
  const host = (await c0.boundingBox())!;
  const reply = (await c1.boundingBox())!;
  const meta = (await c0.locator(':scope > [slot="commentMeta"]').boundingBox())!;
  expect(b.height).toBeLessThan(host.height - 20);
  expect(b.y + b.height).toBeLessThanOrEqual(reply.y + 2);
  expect(Math.abs(b.y - meta.y)).toBeLessThan(3);
  // No outline on the comment element itself (it would wrap every reply).
  expect(await c0.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
});

test('comment navigation: siblings, threads and parents', async () => {
  const page = await open(THREAD, threadPage());
  for (let i = 0; i < 3; i++) await page.keyboard.press('j'); // post, c0, c1
  expect(await selectedComment(page)).toBe('t1_c1');
  await page.keyboard.press('Shift+J'); // next at the same level
  expect(await selectedComment(page)).toBe('t1_c3');
  await page.keyboard.press('p');
  expect(await selectedComment(page)).toBe('t1_c0');
  await page.keyboard.press('Shift+J'); // top-level: the next thread
  expect(await selectedComment(page)).toBe('t1_c4');
  await page.keyboard.press('j');
  await page.keyboard.press('j'); // c5, then c6
  expect(await selectedComment(page)).toBe('t1_c6');
  await page.keyboard.press('Shift+K');
  expect(await selectedComment(page)).toBe('t1_c4');
});

test('shortcuts never fire while typing in REScue’s textarea or a shadow-root editor', async () => {
  const page = await open(LISTING, listingPage());
  await page.keyboard.press('j');
  const before = await selectedPost(page);

  const editor = page.locator('fake-rte div[contenteditable]');
  await editor.scrollIntoViewIfNeeded();
  await editor.click();
  await page.keyboard.type('jjjk?');
  expect(await selectedPost(page)).toBe(before);
  await expect(editor).toHaveText('jjjk?');
  await expect(page.locator('#rescue-keyhelp')).toHaveCount(0);

  await page.goto(`${LISTING}#rescue:settings/userHighlight`);
  const area = page.locator('#rescue-settings textarea').first();
  await expect(area).toBeVisible();
  await area.click();
  await page.keyboard.type('jjj');
  await expect(area).toHaveValue('jjj');
  await expect(page.locator('[data-rescue-selected]')).toHaveCount(0); // fresh page, still nothing moved
});

test('the selection continues onto posts Reddit loads after scrolling to the bottom', async () => {
  const page = await open(LISTING, listingPage());
  for (let i = 0; i < POSTS.length; i++) await page.keyboard.press('j');
  const last = POSTS[POSTS.length - 1]!.id;
  expect(await selectedPost(page)).toBe(last);
  await expect(page.locator('shreddit-post#t3_new1')).toHaveCount(0);

  const before = await page.evaluate(() => scrollY);
  await page.keyboard.press('j'); // on the last loaded post: scroll to the bottom
  await expect(page.locator('shreddit-post[data-rescue-seen]')).toHaveCount(POSTS.length + 3);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(before);
  expect(await selectedPost(page)).toBe(last); // the keypress did not skip anything

  await page.keyboard.press('j');
  expect(await selectedPost(page)).toBe('t3_new1');
  await expect(box(page)).toBeInViewport();
  await expectBoxOver(page, page.locator('article:has(shreddit-post#t3_new1)'));
  await page.keyboard.press('k');
  expect(await selectedPost(page)).toBe(last);
});

test('a rebound key fires the action, and the old key no longer does', async () => {
  const page = await open(LISTING, listingPage());
  await page.goto(`${LISTING}#rescue:settings/keyboardNav`);
  const table = page.locator('#rescue-settings [data-option="keyboardNav.rebind"]');
  await table.locator('button[data-action=add]').click();
  const row = table.locator('tbody tr').first();
  await row.locator('input[data-col=command]').fill('moveDown');
  await row.locator('input[data-col=command]').press('Tab');
  // Commit one cell at a time, as a person would: a re-render after the first save otherwise
  // resets a cell whose edit has not been committed yet.
  await expect.poll(() => stored()).toContain('"command":"moveDown"');
  await row.locator('input[data-col=keys]').fill('n');
  await row.locator('input[data-col=keys]').press('Tab');
  await expect.poll(() => stored()).toContain('"keys":"n"');
  await page.goto(LISTING);
  await page.reload();
  await expect(page.locator('#rescue-gear')).toBeVisible();

  await page.keyboard.press('j');
  await expect(page.locator('[data-rescue-selected]')).toHaveCount(0);
  await page.keyboard.press('n');
  expect(await selectedPost(page)).toBe(POSTS[0]!.id);
  await page.keyboard.press('n');
  expect(await selectedPost(page)).toBe(POSTS[1]!.id);
});

test('? shows the shortcut list and Escape closes it', async () => {
  const page = await open(LISTING, listingPage());
  await page.keyboard.press('?');
  const help = page.locator('#rescue-keyhelp');
  await expect(help).toBeVisible();
  await expect(help).toContainText('Move down');
  await expect(help).toContainText('Open comments');
  await expect(help).toBeInViewport();
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
});

test('clicking a post selects it without interfering with Reddit’s own click handling', async () => {
  const page = await open(LISTING, listingPage());
  await page.locator(`shreddit-post#${POSTS[2]!.id}`).click({ position: { x: 500, y: 250 } });
  expect(await selectedPost(page)).toBe(POSTS[2]!.id);
  expect(await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(1);
  expect(
    await page.evaluate(() => (window as unknown as { __prevented: boolean }).__prevented),
  ).toBe(false);
  await page.keyboard.press('j');
  expect(await selectedPost(page)).toBe(POSTS[3]!.id);
});

test('enter follows a link post’s link, c opens its comments, shift+enter opens both in new tabs', async () => {
  const page = await open(LISTING, listingPage());
  await page.keyboard.press('j');
  await page.keyboard.press('j'); // t3_link1 (external link)
  expect(await selectedPost(page)).toBe('t3_link1');

  const tabs = await tabCount();
  await page.keyboard.press('Shift+Enter');
  await expect.poll(tabCount).toBe(tabs + 2);
  expect(page.url()).toBe(LISTING);

  // 'c' navigates this page to the comments; serve it so that navigation commits instead of
  // leaving an aborted-navigation error page that races (and interrupts) the next goto.
  await ctx.route(/\/r\/nottheonion\/comments\/link1\//, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>comments</title>' }),
  );
  const commentsRequest = page.waitForRequest(/\/r\/nottheonion\/comments\/link1\//);
  await page.keyboard.press('c');
  await commentsRequest;
  await page.waitForURL(/\/r\/nottheonion\/comments\/link1\//);
  await page.goto(LISTING);
  await expect(page.locator('#rescue-gear')).toBeVisible(); // REScue is running again
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await expect.poll(() => selectedPost(page)).toBe('t3_link1');
  await Promise.all([page.waitForURL('https://example.co.uk/nasa'), page.keyboard.press('Enter')]);
});

test('a text post has no [l+c]; a link post has it in its credit bar and it opens link and comments', async () => {
  const page = await open(LISTING, listingPage());
  await expect(page.locator('shreddit-post#t3_text1 a.rescue-single-click')).toHaveCount(0);
  const lc = page.locator('shreddit-post#t3_link1 a.rescue-single-click');
  await expect(lc).toHaveCount(1);
  await expect(lc).toHaveText('[l+c]');
  // Inline after the time in Reddit’s credit bar (renders on live listings without reflowing it).
  await expect(
    page.locator(
      'shreddit-post#t3_link1 [slot="credit-bar"] faceplate-timeago + a.rescue-single-click',
    ),
  ).toHaveCount(1);

  const tabs = await tabCount();
  await lc.click();
  await expect.poll(tabCount).toBe(tabs + 2);
  expect(page.url()).toBe(LISTING); // Reddit's card navigation did not also fire
});

test('wheelBrowse (when enabled) moves the selection only over its own control', async () => {
  const page = await open(LISTING, listingPage());
  await page.goto(`${LISTING}#rescue:settings/wheelBrowse`);
  await page.locator('#rescue-settings [data-module-toggle="wheelBrowse"]').check();
  await expect.poll(() => stored()).toContain('"wheelBrowse":{"enabled":true');
  await page.goto(LISTING);
  await page.reload();

  const pad = page.locator('#rescue-wheelbrowse');
  await expect(pad).toBeVisible();
  const p = (await pad.boundingBox())!;
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
  const selected = page.locator('shreddit-post[data-rescue-selected]');
  await page.mouse.wheel(0, 100);
  await expect(selected).toHaveAttribute('id', POSTS[0]!.id);
  await page.waitForTimeout(200); // one step per notch
  await page.mouse.wheel(0, 100);
  await expect(selected).toHaveAttribute('id', POSTS[1]!.id);
  // Both cards fit on screen, so the wheel over the control did not scroll the page itself.
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.waitForTimeout(200); // past the one-step-per-notch throttle
  await page.mouse.wheel(0, -100);
  await expect(selected).toHaveAttribute('id', POSTS[0]!.id);

  // Anywhere else the wheel just scrolls the page and the selection stays.
  await page.mouse.move(100, 300);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await expect(selected).toHaveAttribute('id', POSTS[0]!.id);
});
