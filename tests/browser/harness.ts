/**
 * Playwright harness: launches Chromium with the built extension and answers every
 * www.reddit.com / sh.reddit.com request from fixtures, so browser suites never touch real Reddit.
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshProfileDir } from '../chromium-profile';

export const EXTENSION_DIR = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../.output/chrome-mv3',
);

export async function launchWithExtension(): Promise<BrowserContext> {
  const userDataDir = await freshProfileDir('rescue-pw-');
  return chromium.launchPersistentContext(userDataDir, {
    // Extensions need the new headless mode (channel 'chromium'), or headed.
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`],
  });
}

/** The same browser and profile shape as `launchWithExtension`, without REScue (SC-006 baseline). */
export async function launchWithout(): Promise<BrowserContext> {
  const userDataDir = await freshProfileDir('rescue-pw-base-');
  return chromium.launchPersistentContext(userDataDir, { channel: 'chromium', headless: true });
}

/** Serve `html` for the given Reddit URL; abort any other Reddit request. */
export async function serveRedditPage(
  ctx: BrowserContext,
  url: string,
  html: string,
): Promise<void> {
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) => {
    if (route.request().url() === url) {
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    }
    return route.abort();
  });
}

export function htmlDoc(body: string, headExtra = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8">${headExtra}</head><body>${body}</body></html>`;
}

export async function htmlClasses(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.className);
}

/**
 * Waits until REScue's content script has fully started: every module is running, the key
 * dispatcher is attached and the page's first batch of items is tracked. The extension sets
 * `data-rescue-ready` on <html> for this; waiting on it replaces fixed delays and the race where a
 * test pressed a key before REScue was listening. A reload or a fresh navigation re-runs the
 * content script and clears the attribute until the new startup finishes.
 */
export async function waitForRescue(page: Page): Promise<void> {
  await page.waitForSelector('html[data-rescue-ready="1"]', { state: 'attached' });
}

/** Opens REScue's menu from the gear (no-op if it is already open). */
export async function openRescueMenu(page: Page): Promise<void> {
  await waitForRescue(page);
  if (await page.locator('#rescue-menu').count()) return;
  await page.locator('#rescue-gear').click();
  await page.locator('#rescue-menu').waitFor();
}

/** Clicks a row of REScue's menu by its id (`hideAllReplies`, `savedComments`, ...). */
export async function menuClick(page: Page, id: string): Promise<void> {
  await openRescueMenu(page);
  await page.locator(`#rescue-menu [data-menu-id="${id}"]`).click();
}

/** The visible text of a menu row, or null when the page does not list it. Closes the menu. */
export async function menuRowText(page: Page, id: string): Promise<string | null> {
  await openRescueMenu(page);
  const row = page.locator(`#rescue-menu [data-menu-id="${id}"]`);
  const text = (await row.count()) ? ((await row.first().textContent()) ?? '').trim() : null;
  await page.locator('#rescue-gear').click(); // the gear toggles the menu closed
  await page.locator('#rescue-menu').waitFor({ state: 'detached' });
  return text;
}

/** A reply that is not a plain 200 JSON body (an HTTP error, or HTML where JSON was expected). */
export interface RawJsonReply {
  raw: true;
  status: number;
  body?: string;
  contentType?: string;
}
export const rawReply = (status: number, body = '', contentType = 'text/plain'): RawJsonReply => ({
  raw: true,
  status,
  body,
  contentType,
});
export type JsonReply = unknown | RawJsonReply;
export interface JsonRequest {
  method: string;
  /** Path and query, e.g. `/api/info.json?raw_json=1&id=t3_text1`. */
  path: string;
}

/**
 * Answer the same-origin `.json` reads (research R20 item 4) from fixtures: `routes` maps a path
 * (no query) to a body or to a function of the URL. Call it AFTER `serveRedditPage` (the later
 * route wins). Every request is logged, so a test can assert what REScue asked for, and with which
 * method. A `.json` path with no route answers 404 and is still logged.
 */
export async function serveRedditJson(
  ctx: BrowserContext,
  routes: Record<string, JsonReply | ((url: URL) => JsonReply)>,
): Promise<JsonRequest[]> {
  const log: JsonRequest[] = [];
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\/[^#]*\.json(\?|$)/, (route) => {
    const req = route.request();
    const url = new URL(req.url());
    log.push({ method: req.method(), path: url.pathname + url.search });
    const entry = routes[url.pathname];
    if (entry === undefined) return route.fulfill({ status: 404, body: 'no fixture' });
    const reply = typeof entry === 'function' ? (entry as (u: URL) => JsonReply)(url) : entry;
    if (reply && typeof reply === 'object' && (reply as RawJsonReply).raw === true) {
      const r = reply as RawJsonReply;
      return route.fulfill({ status: r.status, contentType: r.contentType, body: r.body ?? '' });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(reply),
    });
  });
  return log;
}
