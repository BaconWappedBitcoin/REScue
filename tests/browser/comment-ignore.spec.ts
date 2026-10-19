import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc, waitForRescue } from './harness';
import { nestedThreadHtml, sessionHtml, threadComments } from '../fixtures/pages';

// Comment ignore button: quick ignore/unignore straight from a comment's author area.
const PAGE = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
const AUTHORS: Record<number, string> = { 2: 'repeater', 6: 'repeater' };
const ME = 'me_the_reader';

const COMMENTS = threadComments().map((c, i) => ({
  ...c,
  author: i === 0 ? ME : AUTHORS[i] ?? c.author,
}));

const THREAD_BODY = nestedThreadHtml(COMMENTS)
  .replace(/^<shreddit-app>/, '')
  .replace(/<\/shreddit-app>$/, '');
const THREAD_HTML = htmlDoc(
  `<shreddit-app user-logged-in="true">${sessionHtml(true, ME).replace(/^<shreddit-app[^>]*>/, '').replace(/<\/shreddit-app>$/, '')}${THREAD_BODY}</shreddit-app>`,
);

let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, PAGE, THREAD_HTML);
});
test.afterEach(async () => {
  await ctx.close();
});

const comment = (page: Page, id: string) => page.locator(`shreddit-comment[thingid="${id}"]`);
const ignoreBtn = (page: Page, id: string) =>
  comment(page, id).locator(':scope > [slot="commentMeta"] .rescue-author-extras .rescue-ignore-user');
const commentBody = (page: Page, id: string) =>
  comment(page, id).locator(':scope > [slot="comment"]');

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };

async function configure(options: Record<string, unknown> | null) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules: options ? { userTagger: { enabled: true, options } } : { userTagger: { enabled: true } } },
  );
}

type Tabs = {
  chrome: {
    tabs: {
      query(q: object): Promise<Array<{ id?: number }>>;
      sendMessage(id: number, m: object): Promise<void>;
    };
  };
};

async function change(options: Record<string, unknown>) {
  await configure(options);
  const sw = ctx.serviceWorkers()[0]!;
  await sw.evaluate(async () => {
    const c = (globalThis as unknown as Tabs).chrome;
    for (const t of await c.tabs.query({ url: '*://www.reddit.com/*' }))
      if (t.id !== undefined) await c.tabs.sendMessage(t.id, { type: 'settings.changed' });
  });
}

async function open(options: Record<string, unknown> | null = null): Promise<Page> {
  await configure(options);
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await waitForRescue(page);
  return page;
}

test('ignore button appears on others’ comments, not the reader’s own', async () => {
  const page = await open();
  await expect(ignoreBtn(page, 't1_c0')).toHaveCount(0);
  await expect(ignoreBtn(page, 't1_c2')).toBeVisible();
  await expect(ignoreBtn(page, 't1_c6')).toBeVisible();
});

test('clicking ignore collapses the author’s comments and flips the button to unignore', async () => {
  const page = await open();
  const btn = ignoreBtn(page, 't1_c2');
  await expect(btn).toHaveText('ignore');
  await btn.click();

  await expect(btn).toHaveText('unignore');
  await expect(ignoreBtn(page, 't1_c6')).toHaveText('unignore');
  await expect(commentBody(page, 't1_c2')).toBeHidden();
  await expect(commentBody(page, 't1_c6')).toBeHidden();
  await expect(comment(page, 't1_c2').getByRole('button', { name: /ignored user - show/ })).toBeVisible();
  await expect(comment(page, 't1_c6').getByRole('button', { name: /ignored user - show/ })).toBeVisible();
});

test('clicking unignore restores the author’s comments and flips the button back', async () => {
  const page = await open();
  await ignoreBtn(page, 't1_c2').click();
  await expect(ignoreBtn(page, 't1_c2')).toHaveText('unignore');
  await expect(commentBody(page, 't1_c2')).toBeHidden();

  await ignoreBtn(page, 't1_c6').click();
  await expect(ignoreBtn(page, 't1_c2')).toHaveText('ignore');
  await expect(ignoreBtn(page, 't1_c6')).toHaveText('ignore');
  await expect(commentBody(page, 't1_c2')).toBeVisible();
  await expect(commentBody(page, 't1_c6')).toBeVisible();
});

test('turning the option off removes all buttons and back on leaves one per comment', async () => {
  const page = await open();
  await expect(page.locator('shreddit-comment .rescue-ignore-user')).toHaveCount(COMMENTS.length - 1);

  await change({ ignoreButtonOnComments: false });
  await expect(page.locator('shreddit-comment .rescue-ignore-user')).toHaveCount(0);

  await change({ ignoreButtonOnComments: true });
  await expect(page.locator('shreddit-comment .rescue-ignore-user')).toHaveCount(COMMENTS.length - 1);
  for (const c of COMMENTS) {
    if (c.author === ME) {
      await expect(ignoreBtn(page, c.id)).toHaveCount(0);
    } else {
      await expect(ignoreBtn(page, c.id)).toHaveCount(1);
    }
  }
});
