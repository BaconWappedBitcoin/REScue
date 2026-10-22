import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc, waitForRescue } from './harness';
import { postHtml, type FixturePost } from '../fixtures/pages';

/**
 * The gallery and mute keys (RES keyboardNav previousGalleryImage / nextGalleryImage /
 * toggleMuteVideo): [ ] and m press the SELECTED post's own gallery arrows and video mute button
 * (live shapes, 2026-10-21: arrows in `gallery-carousel`'s open shadow root, labelled "Previous
 * page" / "Next page"; "Toggle volume" in `shreddit-player`, inside a nested open root). Every
 * press is recorded, so a press on the wrong post shows up.
 */
const LISTING = 'https://www.reddit.com/r/pics/';
const STYLE = `<style>
  shreddit-post { display: block; min-height: 120px; border: 1px solid #ccc; margin: 8px 0 }
  [slot="post-media-container"] { display: block; height: 60px }
</style>`;

const base = (id: string, over: Partial<FixturePost>): FixturePost => ({
  id,
  type: 'gallery',
  title: `Post ${id}`,
  permalink: `/r/pics/comments/${id.slice(3)}/x/`,
  domain: 'reddit.com',
  score: '10',
  comments: '1',
  author: 'someone',
  sub: 'pics',
  ...over,
});

const POSTS: Array<{ post: FixturePost; inner?: string }> = [
  { post: base('t3_gal1', {}), inner: '<gallery-carousel><img alt="1"></gallery-carousel>' },
  { post: base('t3_gal2', {}), inner: '<gallery-carousel><img alt="2"></gallery-carousel>' },
  {
    post: base('t3_vid1', { type: 'video', contentHref: 'https://v.redd.it/abc' }),
    inner: '<shreddit-player><video muted></video></shreddit-player>',
  },
  { post: base('t3_txt1', { type: 'text', domain: 'self.pics' }) },
];

const SCRIPT = `<script>
window.__clicks = [];
for (const g of document.querySelectorAll('gallery-carousel')) {
  const id = g.closest('shreddit-post').id;
  const r = g.attachShadow({ mode: 'open' });
  r.innerHTML = '<button aria-label="Previous page">&lt;</button><slot></slot><button aria-label="Next page">&gt;</button>';
  for (const b of r.querySelectorAll('button'))
    b.addEventListener('click', () => window.__clicks.push(id + ':' + b.getAttribute('aria-label')));
}
for (const p of document.querySelectorAll('shreddit-player')) {
  const id = p.closest('shreddit-post').id;
  const r = p.attachShadow({ mode: 'open' });
  r.innerHTML = '<slot></slot><div class="controls"></div>';
  const inner = r.querySelector('.controls').appendChild(document.createElement('div'));
  const r2 = inner.attachShadow({ mode: 'open' });
  r2.innerHTML = '<button aria-label="Play">play</button><button aria-label="Toggle volume">vol</button>';
  for (const b of r2.querySelectorAll('button'))
    b.addEventListener('click', () => window.__clicks.push(id + ':' + b.getAttribute('aria-label')));
}
</script>`;

function page(): string {
  const posts = POSTS.map(({ post, inner }) =>
    postHtml({ ...post, imgs: [] }).replace(
      '</shreddit-post>',
      `${inner ? `<div slot="post-media-container">${inner}</div>` : ''}</shreddit-post>`,
    ),
  );
  return htmlDoc(
    `<shreddit-app><div id="main-content"><input id="typing" aria-label="typing">` +
      `<shreddit-feed>${posts.join('')}</shreddit-feed></div></shreddit-app>${SCRIPT}`,
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

const open = async (): Promise<Page> => {
  const p = await ctx.newPage();
  await p.goto(LISTING);
  await waitForRescue(p);
  return p;
};
const clicks = (p: Page) =>
  p.evaluate(() => (window as unknown as { __clicks: string[] }).__clicks);

test('] and [ press only the selected post’s own gallery arrows', async () => {
  const p = await open();
  await p.keyboard.press('j'); // t3_gal1
  await p.keyboard.press(']');
  await expect.poll(() => clicks(p)).toEqual(['t3_gal1:Next page']);
  await p.keyboard.press('j'); // t3_gal2
  await p.keyboard.press('[');
  await expect.poll(() => clicks(p)).toEqual(['t3_gal1:Next page', 't3_gal2:Previous page']);
});

test('m presses only the selected post’s own mute button; the gallery keys pass on a video', async () => {
  const p = await open();
  for (let i = 0; i < 3; i++) await p.keyboard.press('j'); // t3_vid1
  await p.keyboard.press('m');
  await expect.poll(() => clicks(p)).toEqual(['t3_vid1:Toggle volume']);
  await p.keyboard.press(']');
  await p.waitForTimeout(400);
  expect(await clicks(p)).toEqual(['t3_vid1:Toggle volume']);
});

test('on a text post, and while typing, the keys press nothing', async () => {
  const p = await open();
  for (let i = 0; i < 4; i++) await p.keyboard.press('j'); // t3_txt1
  for (const k of ['[', ']', 'm']) await p.keyboard.press(k);
  await p.keyboard.press('k'); // back to t3_vid1
  await p.locator('#typing').focus();
  for (const k of ['[', ']', 'm']) await p.keyboard.press(k);
  await p.waitForTimeout(400);
  expect(await clicks(p)).toEqual([]);
  await expect(p.locator('#typing')).toHaveValue('[]m');
});
