import { test, expect, type BrowserContext } from '@playwright/test';
import { launchWithExtension, htmlDoc, menuRowText, waitForRescue } from './harness';
import { nestedThreadHtml, sessionHtml, threadComments } from '../fixtures/pages';

// Gap build H1 (T146): comment boxes, scrollbar, title case, selected-entry fill, username reveal
// on hover and the jump-to-comment-box menu row, on Reddit's own layout.
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
const ME = 'rockpaperblr';

let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const body = htmlDoc(sessionHtml(true, ME) + nestedThreadHtml(threadComments(), false, true));
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) =>
    route.request().url().split('#')[0] === THREAD
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
      : route.abort(),
  );
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };

async function configure(modules: Record<string, Record<string, unknown>>) {
  const settings = {
    modules: Object.fromEntries(
      Object.entries(modules).map(([id, options]) => [id, { enabled: true, options }]),
    ),
  };
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    settings,
  );
}

test('comment boxes, an always-on scrollbar and the hover border are drawn on the comment host', async () => {
  await configure({
    commentStyle: { commentBoxes: true, commentRounded: true, commentHoverBorder: true },
    styleTweaks: { permanentVerticalScrollbar: true },
  });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const first = page.locator('shreddit-comment').first();
  await expect(first).toHaveCSS('border-top-width', '1px');
  await expect(first).toHaveCSS('border-top-left-radius', '4px');
  await expect(page.locator('html')).toHaveCSS('overflow-y', 'scroll');
  // Only the innermost comment under the pointer is marked, never the comments it sits inside.
  const leaf = page.locator('shreddit-comment:not(:has(shreddit-comment))').first();
  await leaf.hover();
  await expect(leaf).toHaveCSS('border-top-color', 'rgb(255, 69, 0)');
  const parents = page.locator('shreddit-comment:has(shreddit-comment:hover)');
  for (const parent of await parents.all())
    await expect(parent).not.toHaveCSS('border-top-color', 'rgb(255, 69, 0)');
});

test('the selected item gets a soft fill and a bar down its right side', async () => {
  await configure({ keyboardNav: { fillSelected: true, addLine: true } });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await page.locator('shreddit-comment').first().waitFor();
  await waitForRescue(page);
  await page.keyboard.press('j');
  const box = page.locator('#rescue-selection');
  await expect(box).toBeVisible();
  await expect(box).toHaveCSS('background-color', 'rgba(240, 243, 252, 0.35)');
  expect(await box.evaluate((el) => (el as HTMLElement).style.boxShadow)).toContain('inset');
});

test('username reveal on hover, and a jump-to-comment-box row in the menu', async () => {
  await configure({ usernameHider: { showUsernameOnHover: true } });
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const link = page.locator(`shreddit-comment a[href="/user/${ME}/"]`).first();
  await expect(link).toHaveText('u/~anon~');
  await link.hover();
  await expect(link).toHaveText(`u/${ME}`);
  await page.mouse.move(0, 0);
  await expect(link).toHaveText('u/~anon~');
  expect(await menuRowText(page, 'jumpToCommentBox')).toBe('Jump to comment box');
});
