import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, waitForRescue } from './harness';
import { THREAD, thread } from './old-skin-fixture';

/**
 * Old Reddit look extras: the "*" after an edited comment's age (Reddit's own "Edited" marker in the
 * comment's meta, live shape 2026-10-21), and "Show source": the "source" word in a comment's flat
 * link row that shows the comment's raw Markdown from the comment's own thread JSON.
 */
const EDITED_TS = '2026-10-17T02:15:56.528Z';
const RAW = 'Fish &amp; chips **bold**\n\n> quoted';

/** The thread fixture with Reddit's "Edited" marker in the FIRST comment's own meta. */
function editedThread(): { html: string; id: string } {
  const html = thread();
  const id = /<shreddit-comment thingid="(t1_[^"]+)"/.exec(html)![1]!;
  const marker = `<span class="text-neutral-content-weak text-12"> Edited <faceplate-timeago ts="${EDITED_TS}" format="narrow"><time datetime="${EDITED_TS}">5d ago</time></faceplate-timeago></span>`;
  return {
    html: html.replace('<div slot="commentMeta">', `<div slot="commentMeta">${marker}`),
    id,
  };
}

let ctx: BrowserContext;
let infoUrls: string[] = [];
let commentId = '';
test.beforeEach(async () => {
  ctx = await launchWithExtension();
  infoUrls = [];
  const { html, id } = editedThread();
  commentId = id;
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) => {
    const url = route.request().url();
    if (url.split('#')[0] === THREAD)
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    // The comment's own thread (Reddit retired /api/info.json, live 2026-10-21):
    // /comments/<post>/_/<comment>.json answers [postListing, commentListing].
    const m = /\/comments\/([a-z0-9]+)\/_\/([a-z0-9]+)\.json/i.exec(url);
    if (m) {
      infoUrls.push(url);
      const listing = (children: unknown[]) => ({ kind: 'Listing', data: { children } });
      const body = [
        listing([{ kind: 't3', data: { name: `t3_${m[1]}`, num_comments: 3, title: 't' } }]),
        listing([{ kind: 't1', data: { name: `t1_${m[2]}`, body: RAW.replace('&amp;', '&') } }]),
      ];
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    }
    return route.abort();
  });
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };
async function open(modules: Record<string, unknown>): Promise<Page> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules },
  );
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await waitForRescue(page);
  return page;
}
const comment = (p: Page, id: string) => p.locator(`shreddit-comment[thingid="${id}"]`);

test('an edited comment’s age gets old Reddit’s "*" with "last edited … ago" on hover', async () => {
  const p = await open({ oldRedditSkin: { enabled: true, options: {} } });
  const c = comment(p, commentId);
  await expect(c).toHaveAttribute('data-rescue-ov', '1');
  const star = c.locator('.rescue-oedited').first();
  await expect(star).toHaveText('*');
  await expect(star).toHaveAttribute('title', /^last edited \d+ days? ago$/);
  // Only the edited comment: the others have no marker.
  await expect(p.locator('.rescue-oedited:visible')).toHaveCount(1);
});

test('"source" in a comment’s link row shows its raw Markdown, read only on click', async () => {
  const p = await open({
    oldRedditSkin: { enabled: true, options: {} },
    showSource: { enabled: true },
  });
  const c = comment(p, commentId);
  await expect(c).toHaveAttribute('data-rescue-ov', '1');
  expect(infoUrls).toEqual([]); // nothing is asked before the click
  // The edited comment's OWN link row (its replies have rows of their own further down).
  await p.evaluate((id) => {
    const own = [...document.querySelectorAll('.rescue-ocl button')].find(
      (b) =>
        b.textContent === 'source' && b.closest('shreddit-comment')?.getAttribute('thingid') === id,
    );
    own?.setAttribute('data-fx-own-source', '');
  }, commentId);
  const word = p.locator('[data-fx-own-source]');
  await word.click();
  const box = p.locator('#rescue-source-popup textarea');
  await expect(box).toHaveValue('Fish & chips **bold**\n\n> quoted');
  expect(infoUrls).toHaveLength(1);
  expect(infoUrls[0]).toContain('raw_json=1');
  expect(infoUrls[0]).toContain(`/_/${commentId.slice(3)}.json`);
  await box.press('Escape');
  await expect(p.locator('#rescue-source-popup')).toHaveCount(0);
});

test('with Show source off, the old look draws no "source" word', async () => {
  const p = await open({ oldRedditSkin: { enabled: true, options: {} } });
  await expect(comment(p, commentId)).toHaveAttribute('data-rescue-ov', '1');
  await expect(
    p.locator('.rescue-ocl').getByText('source', { exact: true }).filter({ visible: true }),
  ).toHaveCount(0);
  await expect(
    p.locator('.rescue-ocl').getByText('permalink', { exact: true }).first(),
  ).toBeVisible();
});
