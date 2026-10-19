import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc, waitForRescue } from './harness';
import { postHtml, type FixturePost } from '../fixtures/pages';

/**
 * inlineMedia: the "hide inline media" feature on Reddit's own layout. The fixture follows the live
 * structure (research R20): all of a post's inline media is in a light-DOM
 * `div[slot=post-media-container]` that is a child of the post. Nothing here touches live Reddit.
 */
const LISTING = 'https://www.reddit.com/r/pics/';
const STYLE = `<style>
  article { margin: 8px 0 }
  shreddit-post { display: block; min-height: 140px; border: 1px solid #ccc }
  [slot="post-media-container"] { display: block; height: 60px }
</style>`;

const base = (id: string, over: Partial<FixturePost>): FixturePost => ({
  id,
  type: 'image',
  title: `Post ${id}`,
  permalink: `/r/pics/comments/${id.slice(3)}/x/`,
  domain: 'i.redd.it',
  score: '10',
  comments: '1',
  author: 'someone',
  sub: 'pics',
  ...over,
});

const MEDIA: Array<{ post: FixturePost; inner?: string }> = [
  { post: base('t3_img1', {}), inner: '<img src="https://i.redd.it/a.jpg" alt="a">' },
  {
    post: base('t3_gal1', { type: 'gallery' }),
    inner:
      '<gallery-carousel><img src="https://preview.redd.it/g1.jpg"><img src="https://preview.redd.it/g2.jpg"></gallery-carousel>',
  },
  {
    post: base('t3_vid1', { type: 'video', contentHref: 'https://v.redd.it/abc' }),
    inner:
      '<shreddit-player><video id="fixture-video" autoplay muted loop></video></shreddit-player>',
  },
  { post: base('t3_txt1', { type: 'text', domain: 'self.pics' }) },
];

function page(): string {
  const posts = MEDIA.map(({ post, inner }) =>
    postHtml({ ...post, imgs: [] }).replace(
      '</shreddit-post>',
      `${inner ? `<div slot="post-media-container">${inner}</div>` : ''}</shreddit-post>`,
    ),
  );
  return htmlDoc(
    `<shreddit-app><div id="main-content"><shreddit-feed>${posts.join('')}</shreddit-feed></div></shreddit-app>`,
    STYLE,
  );
}

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, LISTING, page());
});
test.afterEach(async () => {
  await ctx.close();
});

/** The few extension APIs the background worker is asked about from the tests. */
interface WorkerChrome {
  tabs: {
    query(q: object): Promise<Array<{ id?: number }>>;
    sendMessage(id: number, m: object): Promise<unknown>;
  };
  declarativeNetRequest?: { getDynamicRules(): Promise<unknown[]> };
}
type Chrome = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };
async function configure(options: Record<string, unknown>) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(async (v) => (globalThis as unknown as Chrome).chrome.storage.local.set(v), {
    settings: { modules: { inlineMedia: { enabled: true, options } } },
  });
}

const open = async (): Promise<Page> => {
  const p = await ctx.newPage();
  await p.goto(LISTING);
  await waitForRescue(p);
  await expect(p.locator('#rescue-gear')).toBeVisible();
  return p;
};

const container = (p: Page, id: string) =>
  p.locator(`shreddit-post#${id} > div[slot="post-media-container"]`);
const word = (p: Page, id: string) => p.locator(`shreddit-post#${id} .rescue-media-toggle`);

test('nothing is hidden and no word appears while the option is off (the default)', async () => {
  const p = await open();
  for (const id of ['t3_img1', 't3_gal1', 't3_vid1']) {
    await expect(container(p, id)).toBeVisible();
    await expect(word(p, id)).toBeHidden();
  }
});

test('with the option on, media starts hidden and each post says what it would show', async () => {
  await configure({ collapseMedia: true, collapsePostMedia: true });
  const p = await open();
  for (const id of ['t3_img1', 't3_gal1', 't3_vid1']) await expect(container(p, id)).toBeHidden();
  await expect(word(p, 't3_img1')).toHaveText('show image');
  await expect(word(p, 't3_gal1')).toHaveText('show gallery (2)');
  await expect(word(p, 't3_vid1')).toHaveText('show video');
  await expect(p.locator('shreddit-post#t3_txt1 .rescue-media-toggle')).toHaveCount(0);
  // Reddit's own markup is untouched inside the container.
  await expect(
    p.locator('shreddit-post#t3_img1 > div[slot="post-media-container"] img'),
  ).toHaveCount(1);
});

test('"show image" expands only that post, and "hide image" puts it away', async () => {
  await configure({ collapseMedia: true, collapsePostMedia: true, rememberExpanded: false });
  const p = await open();
  await word(p, 't3_img1').click();
  await expect(container(p, 't3_img1')).toBeVisible();
  await expect(word(p, 't3_img1')).toHaveText('hide image');
  await expect(container(p, 't3_gal1')).toBeHidden();
  await expect(container(p, 't3_vid1')).toBeHidden();
  await word(p, 't3_img1').click();
  await expect(container(p, 't3_img1')).toBeHidden();
});

test('X toggles the selected post and Shift+X toggles all', async () => {
  await configure({ collapseMedia: true, collapsePostMedia: true, rememberExpanded: false });
  const p = await open();
  await p.keyboard.press('j'); // selects the first post
  await p.keyboard.press('x');
  await expect(container(p, 't3_img1')).toBeVisible();
  await expect(container(p, 't3_gal1')).toBeHidden();
  await p.keyboard.press('x');
  await expect(container(p, 't3_img1')).toBeHidden();
  // Some are collapsed, so Shift+X shows every post's media; again hides them all.
  await p.keyboard.press('Shift+X');
  for (const id of ['t3_img1', 't3_gal1', 't3_vid1']) await expect(container(p, id)).toBeVisible();
  await p.keyboard.press('Shift+X');
  for (const id of ['t3_img1', 't3_gal1', 't3_vid1']) await expect(container(p, id)).toBeHidden();
});

test('the menu switch hides and shows media at once, and is the same option as in settings', async () => {
  await configure({ collapsePostMedia: true });
  const p = await open();
  await p.locator('#rescue-gear').click();
  const row = p.locator('#rescue-menu [data-menu-id="inlineMedia:collapse"]');
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await row.click();
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await expect(container(p, 't3_img1')).toBeHidden(); // no reload
  await expect(word(p, 't3_img1')).toHaveText('show image');
  await row.click();
  await expect(container(p, 't3_img1')).toBeVisible();
  await expect(word(p, 't3_img1')).toBeHidden();
  await row.click();

  // It is the module's own option, so it survives a reload.
  await p.reload();
  await expect(container(p, 't3_img1')).toBeHidden();
  await p.locator('#rescue-gear').click();
  await expect(p.locator('#rescue-menu [data-menu-id="inlineMedia:collapse"]')).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('every control has hover text that starts with REScue:', async () => {
  await configure({ collapseMedia: true, collapsePostMedia: true });
  const p = await open();
  for (const id of ['t3_img1', 't3_gal1', 't3_vid1'])
    await expect(word(p, id)).toHaveAttribute('title', /^REScue: show this post's /);
  await word(p, 't3_img1').click();
  await expect(word(p, 't3_img1')).toHaveAttribute('title', /^REScue: hide this post's image/);
  await p.locator('#rescue-gear').click();
  await expect(p.locator('#rescue-menu [data-menu-id="inlineMedia:collapse"]')).toHaveAttribute(
    'title',
    /^REScue: media in comments is hidden/,
  );
});

test('a fixture video is not rendered, and not playing, while its post is collapsed', async () => {
  await configure({ collapseMedia: true, collapsePostMedia: true, rememberExpanded: false });
  const p = await open();
  const state = () =>
    p.evaluate(() => {
      const v = document.getElementById('fixture-video') as HTMLVideoElement;
      return { rendered: v.offsetParent !== null, paused: v.paused };
    });
  expect(await state()).toEqual({ rendered: false, paused: true });
  await word(p, 't3_vid1').click();
  expect((await state()).rendered).toBe(true);
  await word(p, 't3_vid1').click();
  expect(await state()).toEqual({ rendered: false, paused: true });
});

test('a post you showed stays shown on the next visit', async () => {
  await configure({ collapseMedia: true, collapsePostMedia: true });
  const p = await open();
  await word(p, 't3_gal1').click();
  await expect(container(p, 't3_gal1')).toBeVisible();
  await p.reload();
  await expect(container(p, 't3_gal1')).toBeVisible();
  await expect(word(p, 't3_gal1')).toHaveText('hide gallery (2)');
  await expect(container(p, 't3_img1')).toBeHidden();
});

test('type and subreddit rules choose what starts hidden', async () => {
  await configure({ collapseMedia: true, collapsePostMedia: true, onlyTypes: 'video' });
  const p = await open();
  await expect(container(p, 't3_vid1')).toBeHidden();
  await expect(container(p, 't3_img1')).toBeVisible();
  await configure({
    collapseMedia: true,
    collapsePostMedia: true,
    onlyTypes: 'video',
    perSubreddit: [{ subreddit: 'pics', action: 'always collapse' }],
  });
  await p.reload();
  await expect(container(p, 't3_img1')).toBeHidden();
});

test('turning on blocking opens the permission page; nothing is blocked before it is granted', async () => {
  await configure({ collapseMedia: true, collapsePostMedia: true });
  const p = await open();
  const popup = ctx.waitForEvent('page', { timeout: 10_000 });
  await configure({ collapseMedia: true, collapsePostMedia: true, blockDownloads: true });
  // The settings change reaches the page through the background, as it does from the console.
  const sw = ctx.serviceWorkers()[0]!;
  await sw.evaluate(async () => {
    const c = (globalThis as unknown as { chrome: WorkerChrome }).chrome;
    const tabs = await c.tabs.query({ url: '*://www.reddit.com/*' });
    for (const t of tabs)
      if (t.id !== undefined) await c.tabs.sendMessage(t.id, { type: 'settings.changed' });
  });
  const permission = await popup;
  await permission.waitForLoadState();
  expect(permission.url()).toMatch(/\/media-permission\.html$/);
  await expect(permission.getByRole('button', { name: 'Allow' })).toHaveAttribute(
    'title',
    /^REScue: /,
  );
  const rules = await sw.evaluate(async () => {
    const dnr = (globalThis as unknown as { chrome: WorkerChrome }).chrome.declarativeNetRequest;
    return dnr ? (await dnr.getDynamicRules()).length : 0;
  });
  expect(rules).toBe(0);
  await expect(container(p, 't3_img1')).toBeHidden();
});
