import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc, waitForRescue } from './harness';
import { IGNORED_USER } from '../../src/core/hints';
import { listingHtml, nestedThreadHtml, POSTS, sessionHtml } from '../fixtures/pages';

// Post ignore button: quick ignore/unignore straight from a post author area in listings and threads.
const LISTING_URL = 'https://www.reddit.com/r/all/';
const THREAD_URL = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
const ME = 'me_the_reader';

// Build a listing where posts 1 and 3 share an author and post 0 is the reader's own.
const LISTING_POSTS = POSTS.map((p, i) => ({
  ...p,
  author:
    i === 0
      ? ME
      : i === 1 || i === 3
        ? 'repeater'
        : i === 2
          ? 'dogperson'
          : p.author,
}));
const LISTING_HTML = htmlDoc(
  sessionHtml(true, ME)
    .replace(/^<shreddit-app[^>]*>/, `<shreddit-app user-logged-in="true">`)
    .replace(/<\/shreddit-app>$/, '') +
    listingHtml(LISTING_POSTS).replace(/^<shreddit-app>/, '').replace(/<\/shreddit-app>$/, '') +
    '</shreddit-app>',
);

// Thread page: the post is POSTS[0] (t3_text1) by 'rockpaperblr'.
const THREAD_BODY = nestedThreadHtml()
  .replace(/^<shreddit-app>/, '')
  .replace(/<\/shreddit-app>$/, '');
const THREAD_HTML = htmlDoc(
  `<shreddit-app user-logged-in="true">${sessionHtml(true, ME).replace(/^<shreddit-app[^>]*>/, '').replace(/<\/shreddit-app>$/, '')}${THREAD_BODY}</shreddit-app>`,
);

let ctx: BrowserContext;

const post = (page: Page, id: string) => page.locator(`shreddit-post#${id}`);
const ignoreBtn = (page: Page, id: string) =>
  post(page, id).locator('.rescue-author-extras .rescue-ignore-user');
const article = (page: Page, id: string) => page.locator(`article:has(shreddit-post#${id})`);
const banner = (page: Page) => page.locator('#rescue-tools .rescue-filter-banner');

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };

async function configure(modules: Record<string, { enabled: boolean; options?: Record<string, unknown> }>) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules },
  );
}

type Tabs = {
  chrome: {
    tabs: {
      query(q: object): Promise<Array<{ id?: number }>>;
      sendMessage(id: number, m: object): Promise<void>;
    };
  };
};

async function sendSettingsChanged() {
  const sw = ctx.serviceWorkers()[0]!;
  await sw.evaluate(async () => {
    const c = (globalThis as unknown as Tabs).chrome;
    for (const t of await c.tabs.query({ url: '*://www.reddit.com/*' }))
      if (t.id !== undefined) await c.tabs.sendMessage(t.id, { type: 'settings.changed' });
  });
}

async function open(options: Record<string, unknown> | null = null): Promise<Page> {
  await configure({
    userTagger: { enabled: true, options: options ?? {} },
  });
  const page = await ctx.newPage();
  await page.goto(LISTING_URL);
  await waitForRescue(page);
  return page;
}

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) => {
    const url = route.request().url();
    if (url === LISTING_URL) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: LISTING_HTML });
    }
    if (url === THREAD_URL) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: THREAD_HTML });
    }
    if (url === `${LISTING_URL}#rescue:settings/filteReddit`) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: LISTING_HTML });
    }
    return route.abort();
  });
});
test.afterEach(async () => {
  await ctx.close();
});

test('ignore button appears on others’ posts, not the reader’s own', async () => {
  const page = await open();
  await expect(ignoreBtn(page, 't3_text1')).toHaveCount(0);
  await expect(ignoreBtn(page, 't3_link1')).toBeVisible();
  await expect(ignoreBtn(page, 't3_image1')).toBeVisible();
});

test('clicking ignore hides every post by that author and leaves others visible', async () => {
  const page = await open();
  await expect(ignoreBtn(page, 't3_link1')).toHaveText('ignore');
  await ignoreBtn(page, 't3_link1').click();

  await expect(article(page, 't3_link1')).toBeHidden();
  await expect(article(page, 't3_gallery1')).toBeHidden();
  await expect(article(page, 't3_text1')).toBeVisible();
  await expect(article(page, 't3_image1')).toBeVisible();
  await expect(ignoreBtn(page, 't3_link1')).toHaveText('unignore');
  await expect(ignoreBtn(page, 't3_gallery1')).toHaveText('unignore');
});

test('revealing hidden posts shows unignore, and clicking it restores them', async () => {
  await configure({
    userTagger: { enabled: true },
    filteReddit: { enabled: true, options: { showFilterline: true } },
  });
  const page = await ctx.newPage();
  await page.goto(LISTING_URL);
  await waitForRescue(page);

  // Add a filter that matches a post by a different author so the banner gets a reveal toggle.
  await page.goto(`${LISTING_URL}#rescue:settings/filteReddit`);
  const table = page.locator('#rescue-settings [data-option="filteReddit.rules"]');
  await table.locator('button[data-action=add]').click();
  await table.locator('tbody tr').first().locator('input[data-col=pattern]').fill('dog');
  await table.locator('tbody tr').first().locator('input[data-col=pattern]').press('Tab');
  await expect(page.locator('#rescue-settings [data-save-state="saved"]')).toHaveCount(1);

  await page.goto(LISTING_URL);
  await waitForRescue(page);
  await ignoreBtn(page, 't3_link1').click();
  await expect(article(page, 't3_link1')).toBeHidden();
  await expect(article(page, 't3_gallery1')).toBeHidden();

  await banner(page).getByRole('button', { name: 'show' }).click();
  await expect(article(page, 't3_link1')).toBeVisible();
  await expect(article(page, 't3_gallery1')).toBeVisible();
  await expect(article(page, 't3_link1')).toHaveAttribute('data-rescue-hidden', IGNORED_USER);
  await expect(ignoreBtn(page, 't3_link1')).toHaveText('unignore');

  await ignoreBtn(page, 't3_link1').click();
  await banner(page).getByRole('button', { name: 'hide' }).click();
  await expect(article(page, 't3_link1')).toBeVisible();
  await expect(article(page, 't3_gallery1')).toBeVisible();
  await expect(ignoreBtn(page, 't3_link1')).toHaveText('ignore');
  await expect(ignoreBtn(page, 't3_gallery1')).toHaveText('ignore');
});

test('turning the option off removes all buttons and back on leaves one per post', async () => {
  const page = await open();
  const count = LISTING_POSTS.length - 1;
  await expect(page.locator('.rescue-ignore-user')).toHaveCount(count);

  await configure({ userTagger: { enabled: true, options: { ignoreButtonOnPosts: false } } });
  await sendSettingsChanged();
  await expect(page.locator('.rescue-ignore-user')).toHaveCount(0);

  await configure({ userTagger: { enabled: true, options: { ignoreButtonOnPosts: true } } });
  await sendSettingsChanged();
  await expect(page.locator('.rescue-ignore-user')).toHaveCount(count);
  for (const p of LISTING_POSTS) {
    if (p.author === ME) await expect(ignoreBtn(page, p.id)).toHaveCount(0);
    else await expect(ignoreBtn(page, p.id)).toHaveCount(1);
  }
});

test('thread post toggles ignore without hiding', async () => {
  await configure({ userTagger: { enabled: true } });
  const page = await ctx.newPage();
  await page.goto(THREAD_URL);
  await waitForRescue(page);

  const btn = ignoreBtn(page, 't3_text1');
  await expect(btn).toHaveText('ignore');
  await btn.click();
  await expect(btn).toHaveText('unignore');
  await expect(post(page, 't3_text1')).toBeVisible();
  await btn.click();
  await expect(btn).toHaveText('ignore');
});
