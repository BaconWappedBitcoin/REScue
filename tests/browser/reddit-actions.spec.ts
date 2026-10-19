import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc } from './harness';
import { POSTS, listingHtml, nestedThreadHtml, sessionHtml, threadComments } from '../fixtures/pages';

// Save / Hide (this lane): s saves the selected post on Reddit through its overflow menu (again to
// unsave), h hides it, and Ctrl+S saves the selected comment. Every action goes through the item's
// OWN menu: the fixture menus are the live shapes (a post's `shreddit-post-overflow-menu` and a
// comment's `shreddit-overflow-menu[slot=overflow]`, both open shadow roots), and the rows are found
// by TEXT, so the fixture flips Save<->Unsave in place and removes a post's <article> on Hide.
const LISTING = 'https://www.reddit.com/r/science/';
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';

// Room for the selection to move between items: posts need a size to be "shown" for keyboard nav.
const STYLE = `<style>
  article { margin: 8px 0 }
  shreddit-post { display: block; height: 220px; border: 1px solid #ccc }
  shreddit-comment { display: block; margin-left: 16px }
</style>`;

/** Reddit-ish hydration for posts: a light-DOM menu with an open root holding the rows. */
const postScript = (noSave: boolean) => `<script>
window.__clicks = [];
const NO_SAVE = ${noSave};
for (const post of document.querySelectorAll('shreddit-post')) {
  const id = post.getAttribute('id');
  const menu = document.createElement('shreddit-post-overflow-menu');
  const root = menu.attachShadow({ mode: 'open' });
  root.innerHTML = '<button id="overflow-trigger" aria-label="Open user actions" aria-expanded="false">…</button>'
    + '<ul class="items" hidden>'
    + '<li role="presentation">Follow post</li>'
    + (NO_SAVE && id === '${POSTS[0]!.id}' ? '' : '<li role="presentation">Save</li>')
    + '<li role="presentation">Hide</li>'
    + '<li role="presentation">Report</li>'
    + '</ul>';
  const trigger = root.querySelector('#overflow-trigger');
  const items = root.querySelector('.items');
  trigger.addEventListener('click', () => {
    const open = items.hidden;
    items.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    window.__clicks.push(id + ':menu-' + (open ? 'open' : 'close'));
  });
  for (const item of root.querySelectorAll('li[role=presentation]')) {
    item.addEventListener('click', () => {
      const text = item.textContent;
      window.__clicks.push(id + ':item-' + text);
      items.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (text === 'Save') item.textContent = 'Unsave';
      else if (text === 'Unsave') item.textContent = 'Save';
      else if (text === 'Hide') { const a = post.closest('article'); (a || post).remove(); }
    });
  }
  post.appendChild(menu);
}
</script>`;

/** Reddit-ish hydration for comments: an action row carrying a menu with an open root. */
const commentScript = `<script>
window.__clicks = [];
for (const c of document.querySelectorAll('shreddit-comment')) {
  const id = c.getAttribute('thingid');
  const row = document.createElement('shreddit-comment-action-row');
  row.setAttribute('slot', 'actionRow');
  row.setAttribute('comment-id', id);
  const menu = document.createElement('shreddit-overflow-menu');
  menu.setAttribute('slot', 'overflow');
  const root = menu.attachShadow({ mode: 'open' });
  root.innerHTML = '<button id="overflow-trigger" aria-label="Open user actions" aria-expanded="false">…</button>'
    + '<div class="items" hidden>'
    + '<div role="menuitem">Follow comment</div>'
    + '<div role="menuitem">Save</div>'
    + '<div role="menuitem">Report</div>'
    + '</div>';
  const trigger = root.querySelector('#overflow-trigger');
  const items = root.querySelector('.items');
  trigger.addEventListener('click', () => {
    const open = items.hidden;
    items.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    window.__clicks.push(id + ':menu-' + (open ? 'open' : 'close'));
  });
  for (const item of root.querySelectorAll('[role=menuitem]')) {
    item.addEventListener('click', () => {
      const text = item.textContent;
      window.__clicks.push(id + ':item-' + text);
      items.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (text === 'Save') item.textContent = 'Unsave';
      else if (text === 'Unsave') item.textContent = 'Save';
    });
  }
  row.appendChild(menu);
  c.appendChild(row);
}
</script>`;

const listingPage = (signedIn = true, noSave = false) =>
  htmlDoc(sessionHtml(signedIn) + listingHtml() + postScript(noSave), STYLE);
const threadPage = (signedIn = true) =>
  htmlDoc(sessionHtml(signedIn) + nestedThreadHtml(threadComments()) + commentScript, STYLE);

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
});
test.afterEach(async () => {
  await ctx.close();
});

async function open(url: string, body: string): Promise<Page> {
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) =>
    route.request().url() === url
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
      : route.abort(),
  );
  const page = await ctx.newPage();
  await page.goto(url);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  return page;
}

const clicks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __clicks: string[] }).__clicks);
const postRows = (page: Page, id: string) =>
  page
    .locator(`shreddit-post#${id} > shreddit-post-overflow-menu`)
    .evaluate((menu) =>
      [...menu.shadowRoot!.querySelectorAll('li')].map((n) => n.textContent),
    );
const selectedPost = (page: Page) =>
  page.evaluate(
    () => document.querySelector('shreddit-post[data-rescue-selected]')?.getAttribute('id') ?? null,
  );

/** Press j until the first post is selected: the extension may not have indexed the posts yet. */
async function selectFirst(page: Page): Promise<void> {
  await expect
    .poll(async () => {
      if ((await selectedPost(page)) === null) await page.keyboard.press('j');
      return selectedPost(page);
    })
    .toBe(POSTS[0]!.id);
}

test('s saves the selected post through its menu, and again unsaves it', async () => {
  const page = await open(LISTING, listingPage());
  await selectFirst(page);
  await page.keyboard.press('s');
  await expect.poll(() => postRows(page, POSTS[0]!.id)).toContain('Unsave');
  expect((await clicks(page)).filter((c) => c.includes(':item-'))).toEqual([
    `${POSTS[0]!.id}:item-Save`,
  ]);
  await expect(page.getByText(/could not find|did not confirm|Sign in/)).toHaveCount(0);
  await page.waitForTimeout(800); // let the save action finish before the next press
  await page.keyboard.press('s'); // the same key unsaves
  await expect.poll(() => postRows(page, POSTS[0]!.id)).toContain('Save');
});

test('h hides the selected post, which leaves the page, and the selection moves down', async () => {
  const page = await open(LISTING, listingPage());
  await selectFirst(page);
  await page.keyboard.press('h');
  await expect(page.locator(`article:has(shreddit-post#${POSTS[0]!.id})`)).toHaveCount(0);
  await expect.poll(() => selectedPost(page)).toBe(POSTS[1]!.id);
  expect(await clicks(page)).toContain(`${POSTS[0]!.id}:item-Hide`);
  await expect(page.getByText(/could not find|did not confirm/)).toHaveCount(0);
});

test('signed out: s and h say to sign in and touch no menu', async () => {
  const page = await open(LISTING, listingPage(false));
  await selectFirst(page);
  await page.keyboard.press('s');
  await expect(page.getByText('Sign in to Reddit to save this.')).toBeVisible();
  await page.keyboard.press('h');
  await expect(page.getByText('Sign in to Reddit to hide this.')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await clicks(page)).toEqual([]);
});

test('Ctrl+S saves the selected comment; plain s does nothing on a comment', async () => {
  const page = await open(THREAD, threadPage());
  await page.locator('shreddit-comment[thingid="t1_c0"] [slot="comment"]').first().click();
  await expect(
    page.locator('shreddit-comment[thingid="t1_c0"][data-rescue-selected]'),
  ).toHaveCount(1);
  await page.keyboard.press('s');
  await page.waitForTimeout(400);
  expect(await clicks(page)).toEqual([]); // a post-only key: nothing happens on a comment
  await page.keyboard.press('Control+s');
  await expect
    .poll(() =>
      page
        .locator('shreddit-comment[thingid="t1_c0"] > shreddit-comment-action-row > shreddit-overflow-menu')
        .evaluate((menu) =>
          [...menu.shadowRoot!.querySelectorAll('[role=menuitem]')].map((n) => n.textContent),
        ),
    )
    .toContain('Unsave');
  await expect(page.getByText(/could not find|did not confirm/)).toHaveCount(0);
});

test('a menu without a Save row is never clicked: it says so instead', async () => {
  const page = await open(LISTING, listingPage(true, true));
  await selectFirst(page);
  await page.keyboard.press('s');
  // REScue waits up to ~4 s for a lazily drawn menu row before saying it is not there.
  await expect(page.getByText(/could not find Reddit.s Save item/)).toBeVisible({ timeout: 12000 });
  await page.waitForTimeout(400);
  // The menu was opened and closed to look, but no row was ever pressed.
  expect((await clicks(page)).some((c) => c.includes(':item-'))).toBe(false);
});
