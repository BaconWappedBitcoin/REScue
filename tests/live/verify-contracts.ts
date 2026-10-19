/**
 * Live-contract runner (constitution Principle VI). Visits real www. and sh.reddit.com pages in a
 * real browser and reports, per contract, how many matched elements satisfied it — plus which
 * modules each drifted contract affects.
 *
 * It never solves bot challenges or CAPTCHAs: if Reddit serves one, the page is reported
 * `blocked` and its contracts are not judged.
 *
 *   npm run verify:live
 *   LIVE_THREAD=/r/x/comments/y/z/ npm run verify:live
 *   LIVE_PROFILE=<profile dir> npm run verify:live
 */
import { test as base, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { C, CONTRACTS } from '../../src/contracts/reddit';
import { PROBES, type LiveProbe, type ProbePage } from '../../src/contracts/probes';

/**
 * LIVE_PROFILE=<dir> runs in an existing browser profile (e.g. one where a person passed Reddit's
 * challenge and signed in by hand). The runner itself never solves challenges or handles
 * credentials; without LIVE_PROFILE it uses a fresh browser as before.
 */
const PROFILE = process.env.LIVE_PROFILE;
const test = PROFILE
  ? base.extend<{ context: BrowserContext; page: Page }>({
      // Playwright requires the destructuring form for fixture arguments.
      // eslint-disable-next-line no-empty-pattern
      context: async ({}, use) => {
        const ctx = await chromium.launchPersistentContext(PROFILE, {
          headless: false,
          viewport: { width: 1280, height: 900 },
        });
        await use(ctx);
        await ctx.close();
      },
      page: async ({ context }, use) => {
        await use(context.pages()[0] ?? (await context.newPage()));
      },
    })
  : base;

const HOSTS = ['https://www.reddit.com', 'https://sh.reddit.com'];
const PAGES: Record<Exclude<ProbePage, 'hover-user' | 'hover-community'>, string> = {
  listing: '/r/programming/',
  thread: process.env.LIVE_THREAD ?? '/r/AskReddit/top/?t=day',
  profile: '/user/spez/',
};

interface Row {
  host: string;
  key: string;
  page: ProbePage;
  hits: number;
  total: number;
  rate: number;
  pass: boolean | 'blocked' | 'n/a';
}

const rows: Row[] = [];

async function isBlocked(page: Page): Promise<boolean> {
  return page.evaluate(
    () =>
      // Blocked = Reddit's app never arrived AND a challenge/CAPTCHA is what's on screen. Reddit's
      // normal page contains captcha-related markup (sign-up widgets), so presence alone is not a
      // block; and its interstitial JS challenge is passed by the browser itself and navigates on.
      !document.querySelector('shreddit-app') &&
      (!!document.querySelector('form input[name="solution"], iframe[src*="captcha" i]') ||
        /blocked|whoa there/i.test(document.title)),
  );
}

async function measure(page: Page, probe: LiveProbe): Promise<{ hits: number; total: number }> {
  return page.evaluate(
    ({ selector, attrs }) => {
      const els = [...document.querySelectorAll(selector)];
      const hits = attrs?.length
        ? els.filter((e) => attrs.some((a) => e.hasAttribute(a))).length
        : els.length;
      return { hits, total: attrs?.length ? els.length : Math.max(els.length, 1) };
    },
    { selector: probe.selector, attrs: probe.attrs ? [...probe.attrs] : undefined },
  );
}

async function threadUrl(page: Page, host: string): Promise<string> {
  if (/\/comments\//.test(PAGES.thread)) return host + PAGES.thread;
  await page.goto(host + PAGES.thread, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector(C.post, { timeout: 20_000 }).catch(() => {});
  const permalink = await page.locator(C.post).first().getAttribute(C.postAttr.permalink);
  return host + (permalink ?? PAGES.thread);
}

for (const host of HOSTS) {
  test(`contracts on ${host}`, async ({ page, request }) => {
    test.setTimeout(120_000);
    for (const kind of ['listing', 'thread', 'profile'] as const) {
      const url = kind === 'thread' ? await threadUrl(page, host) : host + PAGES[kind];
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('shreddit-app', { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(2000);
      const blocked = await isBlocked(page);
      for (const probe of PROBES.filter((p) => p.page === kind)) {
        if (blocked) {
          rows.push({
            host,
            key: probe.key,
            page: kind,
            hits: 0,
            total: 0,
            rate: 0,
            pass: 'blocked',
          });
          continue;
        }
        const { hits, total } = await measure(page, probe);
        const rate = total ? hits / total : 0;
        rows.push({
          host,
          key: probe.key,
          page: kind,
          hits,
          total,
          rate,
          pass: probe.minRate === 0 ? 'n/a' : rate >= probe.minRate,
        });
      }
    }
    for (const kind of ['hover-user', 'hover-community'] as const) {
      const path =
        kind === 'hover-user'
          ? `${C.hover.userEndpoint}spez`
          : `${C.hover.communityEndpoint}programming`;
      const res = await request.get(host + path, { headers: { Accept: C.hover.accept } });
      const html = await res.text();
      await page.setContent(html);
      for (const probe of PROBES.filter((p) => p.page === kind)) {
        const { hits, total } = await measure(page, probe);
        const rate = total ? hits / total : 0;
        rows.push({
          host,
          key: probe.key,
          page: kind,
          hits,
          total,
          rate,
          pass: rate >= probe.minRate,
        });
      }
      rows.push({
        host,
        key: `${kind}.fragmentSize`,
        page: kind,
        hits: html.length,
        total: 100_000,
        rate: html.length / 100_000,
        pass: html.length < 100_000,
      });
    }
  });
}

test.afterAll(() => {
  const usedBy = (key: string) => {
    const c = CONTRACTS.find((x) => x.key === key);
    return !c ? '' : c.usedBy === 'core' ? 'core' : c.usedBy.join(', ');
  };
  console.log('\nhost | contract | page | hits/total | result | affects');
  for (const r of rows) {
    const result = typeof r.pass === 'string' ? r.pass : r.pass ? 'ok' : 'DRIFTED';
    console.log(
      `${r.host} | ${r.key} | ${r.page} | ${r.hits}/${r.total} | ${result} | ${usedBy(r.key)}`,
    );
  }
  const drifted = rows.filter((r) => r.pass === false);
  if (drifted.length)
    console.log(
      `\n${drifted.length} contract check(s) DRIFTED. Update src/contracts/reddit.ts and fixtures.`,
    );
  expect(drifted.map((r) => `${r.host} ${r.key}`)).toEqual([]);
});
