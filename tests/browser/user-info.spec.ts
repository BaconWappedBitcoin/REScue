import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { launchWithExtension, waitForRescue } from './harness';
import { LISTING, THREAD, listing, thread } from './old-skin-fixture';

/**
 * userInfo: hover a comment author (or, in the Old Reddit look, the post author) for about 0.8 s
 * and REScue's own card shows when they joined and their karma, from Reddit's user card partial
 * (here a fixture with a placeholder user). Escape and moving away close it.
 * NOT RUN BY ITS AUTHOR: written without a browser; run it before relying on it.
 */
const CARD = readFileSync(
  resolve(fileURLToPath(new URL('.', import.meta.url)), '../fixtures/hovercards/user-sample.html'),
  'utf8',
);

let ctx: BrowserContext;
let asked: string[];
test.beforeEach(async () => {
  asked = [];
  ctx = await launchWithExtension();
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) => {
    const url = route.request().url();
    const hovered = /\/svc\/shreddit\/user-hover-card\/([^/?#]+)/.exec(url);
    if (hovered) {
      asked.push(hovered[1]!);
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: CARD });
    }
    const page = url.split('#')[0];
    const body = page === LISTING ? listing() : page === THREAD ? thread() : null;
    return body
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
      : route.abort();
  });
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };
async function open(url: string, modules: Record<string, unknown>): Promise<Page> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules },
  );
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  await page.goto(url);
  await waitForRescue(page);
  return page;
}

const card = (p: Page) => p.locator('.rescue-userinfo');
const author = (p: Page, name: string) =>
  p.locator(`shreddit-comment [slot="commentMeta"] a[href="/user/${name}/"]`).first();

test('hovering a comment author shows the card with cake day and karma after the delay', async () => {
  const p = await open(THREAD, {});
  const link = author(p, 'user0');
  await expect(link).toBeVisible();
  await link.hover();
  // Nothing is asked for, and nothing shows, until the pointer has rested on the name.
  expect(asked).toEqual([]);
  await expect(card(p)).toBeVisible({ timeout: 3000 });
  await expect(card(p)).toContainText('1,308 post karma');
  await expect(card(p)).toContainText('184 comment karma');
  await expect(card(p)).toContainText('redditor since Jan 19, 2021');
  await expect(card(p).getByRole('button', { name: 'tag user' })).toBeVisible();
  await expect(card(p).getByRole('link', { name: 'profile' })).toHaveAttribute(
    'href',
    '/user/user0/',
  );
  expect(asked).toEqual(['user0']);
});

test('Escape closes the card, and so does moving the pointer away', async () => {
  const p = await open(THREAD, {});
  await author(p, 'user0').hover();
  await expect(card(p)).toBeVisible({ timeout: 3000 });
  await p.keyboard.press('Escape');
  await expect(card(p)).toHaveCount(0);

  // The pointer is still on the name: leave it and come back for a new card.
  await p.mouse.move(2, 2);
  await author(p, 'user0').hover();
  await expect(card(p)).toBeVisible({ timeout: 3000 });
  await p.mouse.move(2, 2);
  await expect(card(p)).toHaveCount(0);
});

test('moving from the name into the card keeps it open, and its words work', async () => {
  const p = await open(THREAD, {});
  await author(p, 'user0').hover();
  await expect(card(p)).toBeVisible({ timeout: 3000 });
  const ignore = card(p).getByRole('button', { name: 'ignore', exact: true });
  await ignore.hover();
  await p.waitForTimeout(600);
  await expect(card(p)).toBeVisible();
  await ignore.click();
  await expect(card(p).getByRole('button', { name: 'unignore' })).toBeVisible();
});

test('a quick pass over the name asks for nothing', async () => {
  const p = await open(THREAD, {});
  await author(p, 'user0').hover();
  await p.mouse.move(2, 2);
  await p.waitForTimeout(1500);
  await expect(card(p)).toHaveCount(0);
  expect(asked).toEqual([]);
});

test('works in the Old Reddit look too: comment authors and the post author', async () => {
  const p = await open(THREAD, { oldRedditSkin: { enabled: true, options: {} } });
  await expect(p.locator('shreddit-post')).toHaveAttribute('data-rescue-ov', '1');
  await author(p, 'user0').hover();
  await expect(card(p)).toBeVisible({ timeout: 3000 });
  await expect(card(p)).toContainText('1,308 post karma');
  await p.keyboard.press('Escape');
  await expect(card(p)).toHaveCount(0);

  await p.locator('shreddit-post a.rescue-oauthor').first().hover();
  await expect(card(p)).toBeVisible({ timeout: 3000 });
  await expect(card(p)).toContainText('184 comment karma');
});

test('the post author option can be turned off', async () => {
  const p = await open(THREAD, {
    oldRedditSkin: { enabled: true, options: {} },
    userInfo: { enabled: true, options: { postAuthors: false } },
  });
  await expect(p.locator('shreddit-post')).toHaveAttribute('data-rescue-ov', '1');
  await p.locator('shreddit-post a.rescue-oauthor').first().hover();
  await p.waitForTimeout(1500);
  await expect(card(p)).toHaveCount(0);
});
