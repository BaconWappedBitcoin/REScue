import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc, waitForRescue } from './harness';
import { POSTS, postHtml } from '../fixtures/pages';

/**
 * nightMode (RES nightMode): REScue flips Reddit's own `theme-dark` class on <html> for the tab,
 * never the account setting; re-applies when Reddit puts its own class back; leaves Reddit's choice
 * alone for a while after the reader uses Reddit's own switch; restores the original class when off.
 */
const LIGHT = 'https://www.reddit.com/r/science/';
const DARK = 'https://www.reddit.com/r/science/?dark=1';

const doc = (dark: boolean) =>
  htmlDoc(
    `<shreddit-app><div id="main-content"><p id="elsewhere">Some text</p><li id="darkmode-list-item"><shreddit-theme-switcher><button id="reddit-switch">Display Mode</button></shreddit-theme-switcher></li>` +
      `<shreddit-feed>${POSTS.slice(0, 2).map(postHtml).join('')}</shreddit-feed></div></shreddit-app>` +
      // Reddit's own theme switch, and a stand-in for Reddit re-rendering with its own setting.
      `<script>
        document.getElementById('reddit-switch').addEventListener('click', () =>
          document.documentElement.classList.toggle('theme-dark'));
        window.__redditRerender = (dark) => document.documentElement.classList.toggle('theme-dark', dark);
      </script>`,
    dark ? '<script>document.documentElement.classList.add("theme-dark")</script>' : '',
  );

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const pages: Record<string, string> = { [LIGHT]: doc(false), [DARK]: doc(true) };
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) => {
    const body = pages[route.request().url()];
    return body
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
      : route.abort();
  });
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = {
  chrome: {
    storage: { local: { set(v: object): Promise<void> } };
    tabs: {
      query(q: object): Promise<Array<{ id?: number }>>;
      sendMessage(id: number, m: object): Promise<unknown>;
    };
  };
};
/** Writes the settings; with `live`, tells open Reddit tabs, as the settings console does. */
async function configure(module: Record<string, unknown> | null, live = false) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async ({ v, live }) => {
      const { chrome } = globalThis as unknown as Area;
      await chrome.storage.local.set({ settings: v });
      if (!live) return;
      for (const t of await chrome.tabs.query({ url: 'https://www.reddit.com/*' }))
        if (t.id !== undefined)
          await chrome.tabs.sendMessage(t.id, { type: 'settings.changed' }).catch(() => {});
    },
    { v: { modules: module ? { nightMode: module } : {} }, live },
  );
}
async function open(url: string, mode: string | null): Promise<Page> {
  await configure(mode ? { enabled: true, options: { automaticNightMode: mode } } : null);
  const page = await ctx.newPage();
  await page.goto(url);
  await waitForRescue(page);
  return page;
}
const html = (p: Page) => p.locator('html');
const isDark = (p: Page) =>
  p.evaluate(() => document.documentElement.classList.contains('theme-dark'));

test('"always dark" darkens a light page, and REScue’s own colours follow', async () => {
  const p = await open(LIGHT, 'always');
  await expect(html(p)).toHaveClass(/theme-dark/);
  await expect(html(p)).toHaveAttribute('data-rescue-theme', 'dark');
});

test('"never dark" lightens a dark page', async () => {
  const p = await open(DARK, 'never');
  await expect.poll(() => isDark(p)).toBe(false);
  await expect(html(p)).toHaveAttribute('data-rescue-theme', 'light');
});

test('"off" leaves Reddit’s own setting alone', async () => {
  const p = await open(DARK, 'none');
  await p.waitForTimeout(500);
  expect(await isDark(p)).toBe(true);
});

test('Reddit putting its own theme back is undone; turning the module off restores Reddit’s', async () => {
  const p = await open(LIGHT, 'always');
  await expect.poll(() => isDark(p)).toBe(true);
  await p.evaluate(() =>
    (window as unknown as { __redditRerender(d: boolean): void }).__redditRerender(false),
  );
  await expect.poll(() => isDark(p)).toBe(true);
  await configure({ enabled: false, options: { automaticNightMode: 'always' } }, true);
  await expect.poll(() => isDark(p)).toBe(false);
  await expect(html(p)).toHaveAttribute('data-rescue-theme', 'light');
});

test('a click elsewhere followed by Reddit re-rendering does not stand night mode down', async () => {
  const p = await open(LIGHT, 'always');
  await expect.poll(() => isDark(p)).toBe(true);
  await p.locator('#elsewhere').click();
  await p.evaluate(() =>
    (window as unknown as { __redditRerender(d: boolean): void }).__redditRerender(false),
  );
  await expect.poll(() => isDark(p)).toBe(true);
});

test('after the reader uses Reddit’s own switch, Reddit’s choice is left alone', async () => {
  const p = await open(LIGHT, 'always');
  await expect.poll(() => isDark(p)).toBe(true);
  await p.locator('#reddit-switch').click(); // Reddit's switch: light
  await p.waitForTimeout(800);
  expect(await isDark(p)).toBe(false);
});
