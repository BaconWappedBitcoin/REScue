import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  launchWithExtension,
  serveRedditJson,
  serveRedditPage,
  htmlDoc,
  rawReply,
  type JsonRequest,
} from './harness';
import { listingHtml, nestedThreadHtml, sessionHtml, threadComments } from '../fixtures/pages';
import { blockedList, infoListing, minePage } from '../fixtures/redditJson';

// Features built on same-origin, read-only JSON reads (research R20 item 4): thread subscriptions,
// "my subreddits" on the shortcut bar, and the blocked-users import. Reddit is never contacted:
// the `.json` routes are answered from fixtures by tests/browser/harness.ts.
const ME = 'rockpaperblr';
const THREAD_URL = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
const LISTING_URL = 'https://www.reddit.com/r/programming/';

const AUTHORS: Record<number, string> = { 2: 'repeater', 6: 'repeater', 7: 'ignoreme' };
const THREAD = nestedThreadHtml(
  threadComments().map((c, i) => ({ ...c, ...(AUTHORS[i] ? { author: AUTHORS[i]! } : {}) })),
);
const threadPage = (signedIn: boolean) => htmlDoc((signedIn ? sessionHtml(true, ME) : '') + THREAD);
const listingPage = (signedIn: boolean) =>
  htmlDoc((signedIn ? sessionHtml(true, ME) : '') + listingHtml());

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
});
test.afterEach(async () => {
  await ctx.close();
});

async function open(url: string, html: string, json: Parameters<typeof serveRedditJson>[1]) {
  await serveRedditPage(ctx, url, html);
  const requests = await serveRedditJson(ctx, json);
  const page = await ctx.newPage();
  await page.goto(url);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  return { page, requests };
}

const notice = (page: Page) => page.locator('#rescue-notices .n');
const reads = (requests: JsonRequest[], path: string) =>
  requests.filter((r) => r.path.startsWith(path));

type Area = {
  chrome: {
    storage: {
      local: { set(v: object): Promise<void>; get(k: string): Promise<Record<string, unknown>> };
    };
  };
};
const worker = async () => ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));

test.describe('thread subscriptions', () => {
  test.setTimeout(60_000);

  test('subscribe, get told about new comments, see the badge in the panel, unsubscribe', async () => {
    const { page, requests } = await open(THREAD_URL, threadPage(true), {
      '/api/info.json': infoListing([{ id: 't3_text1', comments: 1120, title: 'Got laid off' }]),
    });
    const btn = page.locator('.rescue-subscribe');
    await expect(btn).toHaveText('subscribe');
    await expect(btn).toHaveAttribute('title', /^REScue: watch this thread for new comments/);
    await btn.click();
    await expect(btn).toHaveText('unsubscribe');
    // Nothing is requested until a thread is watched; then one batched read about 8 seconds on.
    await expect(notice(page).filter({ hasText: '5 new comments in Got laid off' })).toBeVisible({
      timeout: 25_000,
    });
    await expect(notice(page).getByRole('button', { name: 'Open' })).toBeVisible();
    const info = reads(requests, '/api/info.json');
    expect(info).toEqual([{ method: 'GET', path: '/api/info.json?raw_json=1&id=t3_text1' }]);

    await page.locator('#rescue-gear').click();
    const row = page.locator('#rescue-menu [data-menu-id="threadSubscriptions"]');
    await expect(row).toContainText('Subscriptions (5 new)');
    await row.click();
    const panel = page.locator('#rescue-subscriptions');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.rescue-subs-badge')).toHaveText('5 new comments');
    await expect(panel.locator('a')).toHaveAttribute(
      'href',
      '/r/Layoffs/comments/text1/got_laid_off/',
    );
    await panel.getByRole('button', { name: 'unsubscribe' }).click();
    await expect(panel).toContainText('not subscribed to any thread');
    await expect(btn).toHaveText('subscribe');
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });

  test('Reddit answering 429 pauses the reads, says so, and changes nothing else', async () => {
    const { page, requests } = await open(THREAD_URL, threadPage(true), {
      '/api/info.json': rawReply(429, 'slow down'),
    });
    await page.locator('.rescue-subscribe').click();
    await expect(
      notice(page).filter({ hasText: 'stops asking Reddit for 10 minutes' }),
    ).toBeVisible({
      timeout: 25_000,
    });
    expect(reads(requests, '/api/info.json')).toHaveLength(1);
    await expect(page.locator('.rescue-subscribe')).toHaveText('unsubscribe');
  });

  test('a changed answer shape is a visible warning, not a silent empty result', async () => {
    const { page } = await open(THREAD_URL, threadPage(true), {
      '/api/info.json': { surprise: 'different format' },
    });
    await page.locator('.rescue-subscribe').click();
    await expect(notice(page).filter({ hasText: 'not in the expected format' })).toBeVisible({
      timeout: 25_000,
    });
  });

  test('signed out: disabled with a sign-in hint, and nothing is requested', async () => {
    const { page, requests } = await open(THREAD_URL, threadPage(false), {});
    const btn = page.locator('.rescue-subscribe');
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveAttribute('title', /sign in/i);
    await page.locator('#rescue-gear').click();
    await expect(page.locator('#rescue-menu [data-menu-id="threadSubscriptions"]')).toContainText(
      'sign in',
    );
    await page.waitForTimeout(1500);
    expect(requests).toHaveLength(0);
  });
});

test.describe('my subreddits on the shortcut bar', () => {
  async function configure() {
    const sw = await worker();
    await sw.evaluate(
      async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
      {
        modules: {
          subredditManager: {
            enabled: true,
            options: {
              showDefaults: false,
              subreddits: [{ target: 'pics', label: '', addedAt: 1 }],
            },
          },
        },
      },
    );
  }
  const stored = async (): Promise<string[]> => {
    const sw = await worker();
    return sw.evaluate(async () => {
      const got = await (globalThis as unknown as Area).chrome.storage.local.get('settings');
      const s = got.settings as {
        modules?: { subredditManager?: { options?: { subreddits?: Array<{ target: string }> } } };
      };
      return (s?.modules?.subredditManager?.options?.subreddits ?? []).map((r) => r.target);
    });
  };

  test('lists subscriptions, filters them, and imports the ticked ones into the bar', async () => {
    await configure();
    const { page, requests } = await open(LISTING_URL, listingPage(true), {
      '/subreddits/mine.json': minePage([
        { name: 'aww', subscribers: 4_000_000 },
        { name: 'AskScience' },
        { name: 'pics' },
        { name: 'space' },
      ]),
    });
    const bar = page.locator('#rescue-subreddit-bar');
    await expect(bar).toBeVisible();
    expect(requests).toHaveLength(0); // nothing is read until the control is pressed
    await bar.locator('[data-rescue-mine]').click();
    const box = page.locator('#rescue-mine-popup');
    await expect(box.locator('.rescue-mine-row')).toHaveCount(4);
    expect(requests).toEqual([
      { method: 'GET', path: '/subreddits/mine.json?raw_json=1&limit=100' },
    ]);
    await box.locator('input[type=search]').fill('a');
    await expect(box.locator('.rescue-mine-row')).toHaveCount(3); // AskScience, aww, space
    await box.locator('input[type=search]').fill('');
    for (const name of ['aww', 'pics', 'space']) {
      await box.locator(`[data-sub="${name}"] input`).check();
    }
    await box.getByRole('button', { name: /^import/ }).click();
    await expect(box).toContainText('Added 2, 1 already in the bar');
    await expect.poll(stored).toEqual(['pics', 'aww', 'space']);
    await expect(bar.locator('.rescue-sc a')).toHaveText(['r/pics', 'r/aww', 'r/space']);
  });

  test('signed out the control is disabled with a sign-in hint and nothing is requested', async () => {
    await configure();
    const { page, requests } = await open(LISTING_URL, listingPage(false), {});
    const btn = page.locator('#rescue-subreddit-bar [data-rescue-mine]');
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveAttribute('title', /sign in/i);
    await page.waitForTimeout(500);
    expect(requests).toHaveLength(0);
  });
});

test.describe('blocked users import', () => {
  async function openManager(page: Page) {
    await page.locator('button[aria-label="Tag repeater"]').first().click();
    await page.locator('.rescue-tag-editor').getByRole('button', { name: 'Tagged users' }).click();
    const manager = page.locator('.rescue-tags-manager');
    await expect(manager).toBeVisible();
    return manager;
  }

  test('previews who would be ignored, and ignores them only after confirming', async () => {
    const { page, requests } = await open(THREAD_URL, threadPage(true), {
      '/prefs/blocked.json': blockedList(['repeater', 'trollbot', ME]),
    });
    const manager = await openManager(page);
    expect(requests).toHaveLength(0);
    await manager.getByRole('button', { name: 'import blocked' }).click();
    const preview = page.locator('#rescue-blocked-preview');
    await expect(preview).toContainText('You blocked 2 users');
    await expect(preview.locator('li')).toHaveText(['u/repeater', 'u/trollbot']);
    expect(requests).toEqual([{ method: 'GET', path: '/prefs/blocked.json?raw_json=1' }]);
    // Cancelling changes nothing.
    await preview.getByRole('button', { name: 'Cancel' }).click();
    await expect(preview).toHaveCount(0);
    await expect(manager.locator('tr[data-user]')).toHaveCount(0);
    await expect(page.locator('.rescue-ignore-toggle').first()).toHaveCount(0);

    await manager.getByRole('button', { name: 'import blocked' }).click();
    await preview.getByRole('button', { name: 'Ignore 2 users' }).click();
    await expect(manager.locator('tr[data-user="repeater"]')).toContainText('ignored');
    await expect(manager.locator('tr[data-user="trollbot"]')).toContainText('ignored');
    await expect(manager.locator('tr[data-user]')).toHaveCount(2); // not yourself
    // The page follows: the blocked user's comments are collapsed behind a toggle.
    await expect(page.locator('.rescue-ignore-toggle').first()).toHaveText('[ignored user - show]');
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });

  test('signed out the button is disabled with a sign-in hint and nothing is requested', async () => {
    const { page, requests } = await open(THREAD_URL, threadPage(false), {});
    const manager = await openManager(page);
    const btn = manager.getByRole('button', { name: 'import blocked' });
    await expect(btn).toBeDisabled();
    await expect(btn).toHaveAttribute('title', /sign in/i);
    expect(requests).toHaveLength(0);
  });
});
