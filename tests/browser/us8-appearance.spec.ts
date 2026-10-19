import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc, menuClick } from './harness';
import { listingHtml, nestedThreadHtml, sessionHtml, threadComments } from '../fixtures/pages';

// US8 / quickstart scenario 14: custom CSS, local dates, username hiding, the shortcut bar,
// back-to-top and the logo link, all on Reddit's own layout.
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
const LISTING = 'https://www.reddit.com/r/programming/';
const ME = 'rockpaperblr'; // the post's author and the author of c1, c5 and c9

const HEADER =
  `<reddit-header-large><a id="reddit-logo" href="/">Reddit</a>` +
  `<button id="header-action-item-chat-button" aria-label="Open chat">Chat</button>` +
  `<a id="me-link" href="/user/${ME}/"><span>u/${ME}</span></a><span id="me-text">${ME}</span>` +
  `</reddit-header-large>`;

function signedIn(body: string): string {
  return (
    sessionHtml(true, ME).replace('<reddit-header-large></reddit-header-large>', HEADER) + body
  );
}

const tall = '<div style="height:6000px"></div>';

let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const pages: Record<string, string> = {
    [THREAD]: htmlDoc(signedIn(nestedThreadHtml(threadComments(), false, true)) + tall),
    [LISTING]: htmlDoc(signedIn(listingHtml())),
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

type Area = {
  chrome: { storage: { local: { set(v: object): Promise<void> } } };
};

async function worker() {
  return ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
}

/** Turn modules on, with options, before the page loads. */
async function configure(modules: Record<string, Record<string, unknown>>) {
  const settings = {
    modules: Object.fromEntries(
      Object.entries(modules).map(([id, options]) => [id, { enabled: true, options }]),
    ),
  };
  const sw = await worker();
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    settings,
  );
}

const consoleRoot = (page: Page) => page.locator('#rescue-settings');

/** Opens the console from the gear and goes to one module's page by searching for it. */
async function openModule(page: Page, id: string) {
  await page.locator('#rescue-gear').click();
  await page.locator('#rescue-menu [data-menu-id="settings"]').click();
  await expect(consoleRoot(page).getByRole('heading', { name: 'REScue settings' })).toBeVisible();
  await consoleRoot(page).locator('input.search').fill(id);
  await consoleRoot(page)
    .locator('[data-result-module="' + id + '"]')
    .click();
}

const comment = (page: Page, id: string) => page.locator(`shreddit-comment[thingid="${id}"]`);

test('username hiding masks your name in posts, comments and the header, and restores it live', async () => {
  await configure({ usernameHider: { hideUsers: ['user2'] } });
  const page = await ctx.newPage();
  await page.goto(THREAD);

  const postAuthor = page.locator('shreddit-post [slot="authorName"] a');
  await expect(postAuthor).toHaveText('u/~anon~');
  await expect(comment(page, 't1_c1').locator('a[href="/user/rockpaperblr/"]')).toHaveText(
    'u/~anon~',
  );
  await expect(page.locator('#me-link')).toHaveText('u/~anon~');
  await expect(page.locator('#me-text')).toHaveText('~anon~');
  await expect(comment(page, 't1_c2').locator('a[href="/user/user2/"]')).toHaveText('u/~anon~'); // listed
  await expect(comment(page, 't1_c3').locator('a[href="/user/user3/"]')).toHaveText('u/user3');
  // The page text is changed, not the address.
  await expect(page.locator('#me-link')).toHaveAttribute('href', `/user/${ME}/`);
  await expect(page.locator('body')).not.toContainText(`u/${ME}`);

  // Turning the module off puts every name back without a reload.
  await openModule(page, 'usernameHider');
  await consoleRoot(page).locator('[data-module-toggle="usernameHider"]').uncheck();
  await expect(postAuthor).toHaveText(`u/${ME}`);
  await expect(page.locator('#me-text')).toHaveText(ME);
  await expect(comment(page, 't1_c2').locator('a[href="/user/user2/"]')).toHaveText('u/user2');
});

test('custom CSS applies, follows edits, and is removed when the module is off', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await expect(page.locator('style#rescue-user-css')).toHaveCount(0);

  await openModule(page, 'stylesheet');
  const box = consoleRoot(page).locator('[data-option="stylesheet.css"]');
  await box.fill('body { background-color: rgb(1, 2, 3) !important; }');
  await box.blur();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(1, 2, 3)');
  await expect(page.locator('style#rescue-user-css')).toHaveCount(1);

  await box.fill('body { background-color: rgb(4, 5, 6) !important; }');
  await box.blur();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(4, 5, 6)');
  await expect(page.locator('style#rescue-user-css')).toHaveCount(1);

  const toggle = consoleRoot(page).locator('[data-module-toggle="stylesheet"]');
  await toggle.uncheck();
  await expect(page.locator('style#rescue-user-css')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('background-color', 'rgb(4, 5, 6)');
  await toggle.check();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(4, 5, 6)');

  await box.fill('');
  await box.blur();
  await expect(page.locator('style#rescue-user-css')).toHaveCount(0);

  // The stored CSS survives a reload.
  await box.fill('body { background-color: rgb(7, 8, 9) !important; }');
  await box.blur();
  await expect(consoleRoot(page).locator('[data-save-state="saved"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(7, 8, 9)');
});

test('local date: a tooltip on the time by default, or a label after it', async () => {
  await configure({ localDate: { format: 'iso' } });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  // The browser runs on this machine, so it shares this process's time zone.
  const expected = (iso: string) => {
    const d = new Date(iso);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const tooltip = (iso: string) => `REScue: posted ${expected(iso)}, in your local time`;

  const postTime = page.locator('shreddit-post faceplate-timeago');
  await expect(postTime).toHaveAttribute('title', tooltip('2026-10-15T10:00:00.000Z'));
  await expect(comment(page, 't1_c0').locator('> details > summary time')).toHaveAttribute(
    'title',
    tooltip('2026-10-15T11:00:00.000Z'),
  );
  await expect(page.locator('.rescue-local-date')).toHaveCount(0);
  await page.close();

  await configure({ localDate: { format: 'iso', display: 'inline' } });
  const inline = await ctx.newPage();
  await inline.goto(THREAD);
  const label = inline.locator('shreddit-post .rescue-local-date');
  await expect(label).toHaveText(expected('2026-10-15T10:00:00.000Z'));
  await expect(inline.locator('.rescue-local-date')).toHaveCount(13);
  await expect(inline.locator('shreddit-post faceplate-timeago')).not.toHaveAttribute(
    'title',
    /.+/,
  );
  // The label sits right after the time, in the credit bar's left group (Reddit's layout intact).
  await expect(
    inline.locator('shreddit-post [slot="credit-bar"] faceplate-timeago + .rescue-local-date'),
  ).toHaveCount(1);
});

test('the shortcut bar lists the chosen subreddits in order, apart from Reddit’s header and the strip', async () => {
  await configure({
    subredditManager: {
      showDefaults: false,
      subreddits: [
        { target: 'askscience', label: '' },
        { target: 'r/aww', label: 'Cute' },
        { target: 'u/spez/m/feed', label: '' },
      ],
    },
  });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const bar = page.locator('#rescue-subreddit-bar');
  await expect(bar.locator('a')).toHaveText(['askscience', 'Cute', 'u/spez/m/feed']);
  await expect(bar.locator('a').nth(1)).toHaveAttribute('href', '/r/aww/');
  await expect(bar).toHaveCSS('position', 'fixed');

  const box = (await bar.boundingBox())!;
  const header = (await page.locator('reddit-header-large').boundingBox())!;
  const strip = (await page.locator('#rescue-tools').boundingBox())!;
  const overlaps = (a: typeof box, b: typeof box) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlaps(box, header)).toBe(false);
  expect(overlaps(box, strip)).toBe(false);
  expect(box.x).toBeLessThan(300); // bottom-left, clear of Reddit's left navigation
  // Reddit's layout does not move because of the bar.
  const flow = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(flow).toBeGreaterThan(6000);
  await page.evaluate(() => document.getElementById('rescue-subreddit-bar')!.remove());
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(flow);
});

test('the “+ r/name” button adds the subreddit you are in, live', async () => {
  await configure({ subredditManager: { showDefaults: false, subreddits: [{ target: 'aww' }] } });
  const page = await ctx.newPage();
  await page.goto(LISTING);
  const bar = page.locator('#rescue-subreddit-bar');
  await expect(bar.locator('a')).toHaveText(['aww']);
  await bar.getByRole('button', { name: '+shortcut' }).click();
  await expect(bar.locator('a')).toHaveText(['aww', 'programming']);
  // The same button now removes it (the toggle).
  await expect(bar.locator('[data-rescue-toggle="remove"]')).toHaveText('−shortcut');
  await expect(bar.locator('a[aria-current="page"]')).toHaveText('programming');
});

test('back to top scrolls the page to the top from the REScue menu', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await page.evaluate(() => window.scrollTo(0, 4000));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(3000);
  await menuClick(page, 'backToTop');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('the logo link points where you chose, follows the setting, and is restored when off', async () => {
  await configure({ logoLink: { destination: 'all' } });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const logo = page.locator('#reddit-logo');
  await expect(logo).toHaveAttribute('href', '/r/all/');

  // Reddit re-renders the link: it is set again.
  await logo.evaluate((a) => a.setAttribute('href', '/'));
  await expect(logo).toHaveAttribute('href', '/r/all/');

  await openModule(page, 'logoLink');
  await consoleRoot(page).locator('[data-option="logoLink.destination"]').selectOption('popular');
  await expect(logo).toHaveAttribute('href', '/r/popular/');
  await consoleRoot(page).locator('[data-module-toggle="logoLink"]').uncheck();
  await expect(logo).toHaveAttribute('href', '/');
});

test('hiding chat removes only the chat button; the style tweaks add their line', async () => {
  await configure({ disableChat: {}, styleTweaks: { topLevelSeparator: true } });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await expect(page.locator('#header-action-item-chat-button')).toBeHidden();
  await expect(page.locator('#reddit-logo')).toBeVisible();
  await expect(page.locator('shreddit-post')).toBeVisible();
  await expect(comment(page, 't1_c0')).toHaveCSS('border-top-width', '2px');
  await expect(comment(page, 't1_c1')).toHaveCSS('border-top-width', '0px'); // not top-level
});
