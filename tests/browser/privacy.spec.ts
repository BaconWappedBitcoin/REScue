import { test, expect, type BrowserContext } from '@playwright/test';
import { htmlDoc, launchWithExtension, launchWithout } from './harness';
import {
  listingHtml,
  nestedThreadHtml,
  POSTS,
  profileCommentsHtml,
  sessionHtml,
} from '../fixtures/pages';

// T115 / SC-006: with default settings REScue itself contacts no host that Reddit's own page does
// not. The same five pages are opened without the extension (the baseline) and with it; any host
// seen only in the second run fails the test. Requests from the extension's service worker are
// recorded too (Playwright reports them on the context), and aborted requests still count.
const PAGES: Record<string, { url: string; html: () => string }> = {
  listing: {
    url: 'https://www.reddit.com/r/programming/',
    html: () => htmlDoc(listingHtml()),
  },
  thread: {
    url: 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/',
    html: () => htmlDoc(nestedThreadHtml()),
  },
  profile: {
    url: 'https://www.reddit.com/user/someone/comments/',
    html: () => htmlDoc(profileCommentsHtml('someone')),
  },
  search: {
    url: 'https://www.reddit.com/search/?q=dog',
    html: () => htmlDoc(listingHtml(POSTS.slice(0, 3))),
  },
  customFeed: {
    url: 'https://www.reddit.com/user/someone/m/favourites/',
    html: () => htmlDoc(sessionHtml(true, 'someone') + listingHtml()),
  },
};

interface Seen {
  /** host -> number of requests, from pages and workers alike. */
  hosts: Map<string, number>;
  /** Hosts requested by a service worker (the extension's background). */
  workerHosts: Set<string>;
  /** Same-origin hover-card requests (the one request REScue's network layer allows). */
  hoverCards: number;
}

const NETWORK = /^(https?|wss?):$/;

/** Opens every fixture page in a fresh context and returns the hosts that were requested. */
async function browse(ctx: BrowserContext, withExtension: boolean): Promise<Seen> {
  const seen: Seen = { hosts: new Map(), workerHosts: new Set(), hoverCards: 0 };
  ctx.on('request', (req) => {
    let u: URL;
    try {
      u = new URL(req.url());
    } catch {
      return;
    }
    if (!NETWORK.test(u.protocol)) return; // data:, blob:, about:, chrome-extension: are not network
    seen.hosts.set(u.host, (seen.hosts.get(u.host) ?? 0) + 1);
    if (req.serviceWorker()) seen.workerHosts.add(u.host);
    if (u.pathname.startsWith('/svc/shreddit/user-hover-card/')) seen.hoverCards++;
  });

  // Nothing leaves the machine: Reddit pages come from fixtures, everything else is refused (but
  // was still recorded above). Registered first, so the Reddit route below takes precedence.
  await ctx.route('**/*', (route) => route.abort());
  const byUrl = new Map(Object.values(PAGES).map((p) => [p.url, p.html()]));
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) => {
    const body = byUrl.get(route.request().url());
    return body === undefined
      ? route.abort()
      : route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
  });

  for (const { url } of Object.values(PAGES)) {
    const page = await ctx.newPage();
    await page.goto(url);
    if (withExtension) await expect(page.locator('#rescue-gear')).toBeVisible();
    // Use the page the way a reader does: hover a username (the hover card is REScue's one
    // request), move the keyboard selection, and give anything deferred time to fire.
    const author = page.locator('a[href^="/user/"]').first();
    if (await author.count()) await author.hover();
    await page.keyboard.press('j');
    await page.waitForTimeout(1200);
    await page.close();
  }
  return seen;
}

test('REScue contacts no host that Reddit’s own page does not (SC-006)', async () => {
  test.setTimeout(120_000);

  const baselineCtx = await launchWithout();
  const baseline = await browse(baselineCtx, false);
  await baselineCtx.close();

  const ctx = await launchWithExtension();
  // The extension is really running: its background worker is up.
  const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  expect(worker.url()).toMatch(/^chrome-extension:\/\//);
  const enabled = await browse(ctx, true);
  await ctx.close();

  const hosts = (s: Seen) => [...s.hosts.keys()].sort();
  console.log(`[privacy] baseline hosts: ${hosts(baseline).join(', ')}`);
  console.log(`[privacy] enabled hosts:  ${hosts(enabled).join(', ')}`);
  console.log(
    `[privacy] worker hosts:   ${[...enabled.workerHosts].sort().join(', ') || '(none)'}`,
  );

  // Nothing in the shipped build fetches hover cards yet; if that changes, they stay same-origin.
  expect(enabled.hoverCards).toBe(baseline.hoverCards);

  // The baseline is not empty and includes third-party hosts, so the comparison means something.
  expect(hosts(baseline)).toContain('www.reddit.com');
  expect(hosts(baseline)).toContain('i.redd.it');

  const onlyEnabled = hosts(enabled).filter((h) => !baseline.hosts.has(h));
  expect(onlyEnabled, `hosts contacted only with REScue enabled: ${onlyEnabled}`).toEqual([]);

  // The background worker has no business on the network at all with default settings.
  expect([...enabled.workerHosts]).toEqual([]);
});

test('the recorder sees requests made by the extension’s service worker', async () => {
  // A control for the test above: if worker requests were invisible, "none" would prove nothing.
  const ctx = await launchWithExtension();
  const urls: string[] = [];
  ctx.on('request', (r) => {
    if (r.serviceWorker()) urls.push(r.url());
  });
  await ctx.route('**/*', (route) => route.abort());
  const worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await worker.evaluate(() => fetch('https://tracker.example.test/ping').catch(() => null));
  await expect.poll(() => urls).toContain('https://tracker.example.test/ping');
  await ctx.close();
});
