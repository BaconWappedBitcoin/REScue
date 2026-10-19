/**
 * Live smoke test of the BUILT extension on real Reddit (manual; never in CI).
 * Records, per page: posts/comments on the native page, notices, console errors; saves
 * screenshots to test-results/live-smoke/. Never solves bot challenges: a challenged page is
 * reported as blocked.
 *
 *   npm run build && npx playwright test --config tests/live/playwright.live.config.ts smoke
 */
import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshProfileDir } from '../chromium-profile';

const here = fileURLToPath(new URL('.', import.meta.url));
const EXT = resolve(here, '../../.output/chrome-mv3');
const OUT = resolve(here, '../../test-results/live-smoke');

interface Report {
  page: string;
  blocked: boolean;
  htmlClass: string;
  rows: number;
  comments: number;
  notices: string[];
  errors: string[];
}
const reports: Report[] = [];
let ctx: BrowserContext;

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  ctx = await chromium.launchPersistentContext(await freshProfileDir('rescue-live-'), {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
});
test.afterAll(async () => {
  await ctx?.close();
  console.log('\n=== REScue live smoke ===');
  for (const r of reports) console.log(JSON.stringify(r));
});

async function visit(url: string, name: string): Promise<{ page: Page; report: Report }> {
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /REScue|rescue/i.test(m.text()))
      errors.push(m.text().slice(0, 200));
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // Reddit may serve an interstitial the browser passes by itself; wait for the real app.
  await page.waitForSelector('shreddit-app', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const state = await page.evaluate(() => ({
    blocked:
      !document.querySelector('shreddit-app') &&
      !!document.querySelector('form input[name="solution"], iframe[src*="captcha" i]'),
    htmlClass: document.documentElement.className,
    rows: document.querySelectorAll('shreddit-post').length,
    comments: document.querySelectorAll('shreddit-comment').length,
    notices: [
      ...(document.getElementById('rescue-notices')?.shadowRoot?.querySelectorAll('.n') ?? []),
    ].map((n) => (n.textContent ?? '').slice(0, 160)),
  }));
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  const report = { page: name, ...state, errors };
  reports.push(report);
  return { page, report };
}

test('listing, thread, profile, r/all and sh.reddit.com', async () => {
  test.setTimeout(240_000);
  const { page: listing, report: l } = await visit(
    'https://www.reddit.com/r/programming/',
    'listing-www',
  );
  if (!l.blocked) expect(l.rows, 'native posts on /r/programming').toBeGreaterThan(0);

  // Thread: follow the first post's comments link from REScue's own listing.
  const href = await listing
    .locator('shreddit-post a[slot="title"]')
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (href) {
    const { report: t } = await visit(`https://www.reddit.com${href}`, 'thread-www');
    if (!t.blocked) expect(t.comments, 'native comments on a thread').toBeGreaterThan(0);
  }
  await visit('https://www.reddit.com/user/spez/', 'profile-www');
  await visit('https://www.reddit.com/r/all/', 'all-www');
  await visit('https://sh.reddit.com/r/programming/', 'listing-sh');
  await visit('https://www.reddit.com/', 'front-www');
});

test('a subreddit filter hides every live post on that subreddit', async () => {
  test.setTimeout(120_000);
  // Deterministic: logged-out "hot" order shuffles between loads, so a keyword from one load may
  // not be on the next page. A subreddit filter on its own subreddit must hide every post.
  const { page } = await visit('https://www.reddit.com/r/programming/', 'filter-before');
  await page.goto('https://www.reddit.com/r/programming/#rescue:settings/filteReddit');
  const table = page.locator('#rescue-settings [data-option="filteReddit.rules"]');
  await table.locator('button[data-action=add]').click();
  const row = table.locator('tbody tr').first();
  await row.locator('select[data-col=type]').selectOption('subreddit');
  await row.locator('input[data-col=pattern]').fill('programming');
  await row.locator('input[data-col=pattern]').press('Tab');
  await expect(page.locator('#rescue-settings [data-save-state="saved"]')).toHaveCount(1);
  const { page: after, report } = await visit(
    'https://www.reddit.com/r/programming/',
    'filter-after',
  );
  const banner = await after
    .locator('#rescue-tools .rescue-filter-banner')
    .textContent()
    .catch(() => null);
  const visible = await after.locator('article:has(shreddit-post):visible').count();
  reports.push({
    ...report,
    page: 'filter subreddit:programming',
    notices: [...report.notices, `banner: ${banner}`, `visible rows: ${visible}`],
  });
  expect(banner ?? '').toMatch(/[0-9]+ posts? filtered/);
  expect(visible).toBe(0);
});
