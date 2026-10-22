import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc, waitForRescue } from './harness';
import { listingHtml, sessionHtml } from '../fixtures/pages';

/**
 * The shortcut bar's "mail ▾" and "feeds ▾" menus (RES messageMenu, multiredditNavbar), in
 * REScue's own bar. The feeds come from Reddit's read-only /api/multi/mine.json (live shape
 * 2026-10-21: a bare array of LabeledMulti whose `path` has no trailing slash), read only when the
 * menu is first opened.
 */
const LISTING = 'https://www.reddit.com/r/programming/';
const ME = 'rockpaperblr';
const MULTIS = [
  {
    kind: 'LabeledMulti',
    data: { display_name: 'Newz', name: 'newz', path: `/user/${ME}/m/newz` },
  },
  // A path that is not one of the reader's feed pages is left out.
  {
    kind: 'LabeledMulti',
    data: { display_name: 'Evil', name: 'evil', path: 'https://evil.test/x' },
  },
];

let ctx: BrowserContext;
let multiCalls = 0;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
  multiCalls = 0;
  const body = htmlDoc(sessionHtml(true, ME) + listingHtml());
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) => {
    const url = route.request().url();
    if (url.split('#')[0] === LISTING)
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
    if (url.includes('/api/multi/mine.json')) {
      multiCalls++;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MULTIS),
      });
    }
    return route.abort();
  });
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };
async function open(
  options: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): Promise<Page> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    {
      modules: {
        subredditManager: { enabled: true, options: { showDefaults: false, ...options } },
        ...extra,
      },
    },
  );
  const p = await ctx.newPage();
  await p.goto(LISTING);
  await waitForRescue(p);
  return p;
}
const mail = (p: Page) => p.locator('#rescue-subreddit-bar [data-rescue-mail]');
const feeds = (p: Page) => p.locator('#rescue-subreddit-bar [data-rescue-feeds]');

test('mail ▾ opens RES’s mail links on a click and closes on Escape', async () => {
  const p = await open();
  await expect(mail(p)).toHaveText('mail ▾');
  await mail(p).click();
  const menu = p.locator('[data-rescue-mail-menu]');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'unread' })).toHaveAttribute(
    'href',
    '/message/unread/',
  );
  await expect(menu.getByRole('menuitem', { name: 'modmail' })).toHaveAttribute(
    'href',
    'https://mod.reddit.com/mail/all',
  );
  await menu.getByRole('menuitem').first().focus();
  await p.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('feeds ▾ reads the custom feeds once, on first open, and lists their sections', async () => {
  const p = await open();
  await p.waitForTimeout(500);
  expect(multiCalls).toBe(0); // nothing is asked on page load
  await feeds(p).click();
  const menu = p.locator('[data-rescue-feeds-menu]');
  const feed = menu.getByRole('menuitem', { name: 'Newz' });
  await expect(feed).toHaveAttribute('href', `/user/${ME}/m/newz/`);
  await expect(menu.getByRole('menuitem')).toHaveCount(1); // the off-site path was dropped
  await feed.hover();
  const sections = p.locator('[data-rescue-feed-sections]');
  await expect(sections.getByRole('menuitem', { name: 'top' })).toHaveAttribute(
    'href',
    `/user/${ME}/m/newz/top/`,
  );
  await feeds(p).click(); // close
  await feeds(p).click(); // open again: no second request
  await expect(feed).toBeVisible();
  expect(multiCalls).toBe(1);
});

test('the menus can be switched off', async () => {
  const p = await open({ linkMail: false, linkFeeds: false });
  await expect(p.locator('#rescue-subreddit-bar')).toBeVisible();
  await expect(mail(p)).toHaveCount(0);
  await expect(feeds(p)).toHaveCount(0);
});

test('in the Old Reddit look (bar at the top of the page) the menus open below the bar, on screen', async () => {
  const p = await open({}, { oldRedditSkin: { enabled: true, options: {} } });
  await mail(p).click();
  const menu = p.locator('[data-rescue-mail-menu]');
  await expect(menu).toBeVisible();
  const box = (await menu.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  const item = menu.getByRole('menuitem').first();
  expect(
    await item.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return (
        el.getRootNode() instanceof Document &&
        document.elementFromPoint(r.x + 4, r.y + r.height / 2) === el
      );
    }),
  ).toBe(true);
});

test('up and down arrows move through an open menu', async () => {
  const p = await open();
  await mail(p).focus();
  await p.keyboard.press('Enter');
  const items = p.locator('[data-rescue-mail-menu] [role="menuitem"]');
  await expect(items.first()).toBeFocused();
  await p.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('ArrowUp');
  await expect(items.last()).toBeFocused();
});

test('at a narrow window the bar’s words do not pile on top of each other', async () => {
  const p = await open({ linkFriends: true, linkMod: true, linkModqueue: true, linkSaved: true });
  await p.setViewportSize({ width: 420, height: 800 });
  const boxes = await p.evaluate(() =>
    [...document.querySelectorAll('#rescue-subreddit-bar > *:not([hidden])')]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => [r.left, r.right] as [number, number]),
  );
  for (let i = 1; i < boxes.length; i++)
    expect(boxes[i]![0]).toBeGreaterThanOrEqual(boxes[i - 1]![1] - 1);
});
