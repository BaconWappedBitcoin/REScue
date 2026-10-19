import { test, expect, type BrowserContext } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc } from './harness';
import {
  POSTS,
  type FixturePost,
  headerStripHtml,
  listingHtml,
  nestedThreadHtml,
  threadComments,
} from '../fixtures/pages';

// Build E: header button, hover-card actions, feed pause, CSS hooks, new-tab links, x-post links,
// the search-box fix and the new keys, all against fixtures (no live Reddit).
const LISTING = 'https://www.reddit.com/r/programming/';
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
let ctx: BrowserContext;

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };

test.beforeEach(async () => {
  ctx = await launchWithExtension();
});
test.afterEach(async () => {
  await ctx.close();
});

async function configure(modules: Record<string, { enabled?: boolean; options?: object }>) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules },
  );
}

const loader = `<script>
  const p = document.querySelector('faceplate-partial[slot="load-after"]');
  p.loadContent = () => {
    document.querySelector('shreddit-feed').insertAdjacentHTML('afterbegin',
      '<shreddit-post id="t3_more' + Date.now() + '" post-title="More" permalink="/r/a/comments/more/x/" author="u" subreddit-name="a"></shreddit-post>');
  };
</script>`;

async function openListing(
  extra = '',
  posts: FixturePost[] = POSTS.map((p) => ({ ...p, hoverCard: true })),
) {
  await serveRedditPage(ctx, LISTING, htmlDoc(headerStripHtml() + listingHtml(posts) + extra));
  const page = await ctx.newPage();
  await page.goto(LISTING);
  return page;
}

test('the header button sits in the icon strip, replaces the corner gear, and opens the menu', async () => {
  const page = await openListing();
  const btn = page.locator('#rescue-header-button');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveText('REScue');
  await expect(btn).toHaveAttribute('title', /^REScue: open the REScue menu/);
  await expect(
    page.locator('#header-icons > #rescue-header-button + create-post-entry-point-wrapper'),
  ).toHaveCount(1);
  await expect(page.locator('#rescue-gear')).toBeHidden();

  await btn.click();
  const menu = page.locator('#rescue-menu');
  await expect(menu).toBeVisible();
  const [b, m] = [await btn.boundingBox(), await menu.boundingBox()];
  expect(m!.y).toBeGreaterThanOrEqual(b!.y + b!.height); // opens downward from the header
  await page.keyboard.press('Escape');

  // Reddit's header changes: the corner button comes back.
  await page.evaluate(() => document.querySelector('create-post-entry-point-wrapper')!.remove());
  await expect(btn).toHaveCount(0, { timeout: 3000 });
  await expect(page.locator('#rescue-gear')).toBeVisible();
});

test('the header button is optional', async () => {
  await configure({ headerButton: { enabled: false } });
  const page = await openListing();
  await expect(page.locator('#rescue-gear')).toBeVisible();
  await expect(page.locator('#rescue-header-button')).toHaveCount(0);
});

test('a post author’s hover card gets tag, ignore and highlight words that work', async () => {
  const page = await openListing();
  const actions = page
    .locator(
      'faceplate-hovercard[data-id="user-hover-card"] [slot="content"] .rescue-hover-actions',
    )
    .first();
  await expect(actions.locator('button')).toHaveText(['tag user', 'ignore', 'highlight']);

  await actions.getByRole('button', { name: 'highlight' }).click();
  await expect(page.locator('shreddit-post#t3_text1 a.rescue-highlighted-author')).toHaveCount(1);
  await expect(actions.getByRole('button', { name: 'highlight' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await actions.getByRole('button', { name: 'tag' }).click();
  await expect(page.locator('.rescue-tag-save')).toBeVisible();
  await page.keyboard.press('Escape');

  await actions.getByRole('button', { name: 'ignore' }).click();
  await expect(page.locator('article:has(shreddit-post#t3_text1)')).toBeHidden();

  // Reddit reloads the card's content: the words come back.
  await page.evaluate(() => {
    const c = document.querySelector('faceplate-hovercard [slot="content"]')!;
    c.replaceChildren(document.createElement('span'));
  });
  await expect(
    page.locator('faceplate-hovercard [slot="content"] .rescue-hover-actions').first(),
  ).toBeVisible();
});

test('feed pause: auto-load off hides the native loader and load more drives it', async () => {
  await configure({ feedPause: { options: { autoLoad: false } } });
  // A full first screen (a few posts would still be Reddit filling page one, which is left alone).
  const many = Array.from({ length: 12 }, (_, i) => ({
    ...POSTS[i % POSTS.length]!,
    id: `t3_fill${i}`,
    hoverCard: false,
  }));
  const page = await openListing(loader, many);
  const native = page.locator('faceplate-partial[slot="load-after"]');
  await expect(native).toHaveCSS('display', 'none');
  await expect(native).toHaveAttribute('data-rescue-held', /.*/);
  const more = page.locator('.rescue-feed-load-more');
  await expect(more).toBeVisible();
  await expect(more).toHaveText('load more');
  const before = await page.locator('shreddit-post').count();
  await more.click();
  await expect(page.locator('shreddit-post')).toHaveCount(before + 1);

  // Menu: resume brings Reddit's loader back and removes the button.
  await page.locator('#rescue-gear, #rescue-header-button').first().click();
  const item = page.locator('#rescue-menu [data-menu-id="feed:pause"]');
  await expect(item).toContainText('resume');
  await item.click();
  await expect(native).not.toHaveCSS('display', 'none');
  await expect(more).toBeHidden();
  await page.locator('#rescue-gear, #rescue-header-button').first().click();
  await expect(page.locator('#rescue-menu [data-menu-id="feed:pause"]')).toContainText('pause');
});

test('by default Reddit’s loader is left alone', async () => {
  const page = await openListing(loader);
  await expect(page.locator('faceplate-partial[slot="load-after"]')).not.toHaveCSS('display', 'none');
  await expect(page.locator('.rescue-feed-load-more')).toBeHidden();
});

test('CSS hooks: route classes, listed classes and a toggle-tied snippet', async () => {
  await configure({
    stylesheet: {
      options: {
        bodyClasses: [{ classes: 'mine', applyTo: 'include', subreddits: 'programming' }],
        snippets: [
          {
            snippet: 'body.mine { outline: 3px solid rgb(1, 2, 3); }',
            applyTo: 'everywhere',
            customToggle: 'loud',
          },
        ],
      },
    },
    customToggles: { options: { toggles: [{ name: 'loud', enabled: true }] } },
  });
  const page = await openListing();
  await expect(page.locator('html')).toHaveClass(/res-r-programming/);
  await expect(page.locator('body')).toHaveClass(/mine/);
  expect(await page.evaluate(() => getComputedStyle(document.body).outlineColor)).toBe(
    'rgb(1, 2, 3)',
  );
});

test('x-post titles get a link to the subreddit', async () => {
  const page = await openListing('', [
    { ...POSTS[0]!, title: 'Nice one (x-post from r/rust)' },
    POSTS[1]!,
  ]);
  const link = page.locator('a.rescue-xpost-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/r/rust/');
});

test('links in comments open in a new tab when the option is on', async () => {
  await configure({ linksNewTab: { enabled: true } });
  const comments = threadComments();
  comments[0]!.bodyHtml = '<p><a id="out" href="https://example.com/x">out</a></p>';
  await serveRedditPage(ctx, THREAD, htmlDoc(nestedThreadHtml(comments)));
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const out = page.locator('#out');
  await expect(out).toHaveAttribute('target', '_blank');
  await expect(out).toHaveAttribute('rel', 'noopener noreferrer');
});

test('Shift+S saves the selected comment and Ctrl+Shift+Y opens its permalink in a new tab', async () => {
  await serveRedditPage(ctx, THREAD, htmlDoc(nestedThreadHtml(threadComments())));
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await page.locator('shreddit-comment[thingid="t1_c0"] [slot="comment"]').first().click();
  await page.keyboard.press('Shift+S');
  await expect(
    page.locator('shreddit-comment[thingid="t1_c0"] .rescue-save-comment').first(),
  ).toHaveText('saved-RES');
  const opened = ctx.waitForEvent('page');
  await page.keyboard.press('Control+Shift+Y');
  expect((await opened).url()).toContain('/comments/text1/got_laid_off/c0/');
});

test('Alt+/ focuses the visible search box, not its hidden twin', async () => {
  const header =
    '<reddit-header-large><form action="/search"><input name="q" id="ghost" style="display:none"></form>' +
    '<reddit-search-large><input name="q" id="real"></reddit-search-large></reddit-header-large>';
  await serveRedditPage(ctx, LISTING, htmlDoc(header + listingHtml()));
  const page = await ctx.newPage();
  await page.goto(LISTING);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Alt+/');
  await expect(page.locator('#real')).toBeFocused();
});
