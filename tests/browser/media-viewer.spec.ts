import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc, waitForRescue } from './harness';
import { postHtml, type FixturePost } from '../fixtures/pages';

/**
 * mediaViewer (T145): sizes, keys, gallery filmstrip, plain video player, link expandos and the
 * "f" filter key, on the live structure (research R20): media lives in a light-DOM
 * `div[slot=post-media-container]` that is a child of the post. Nothing here touches live Reddit.
 */
const LISTING = 'https://www.reddit.com/r/pics/';
const STYLE = `<style>
  article { margin: 8px 0 }
  shreddit-post { display: block; min-height: 100px; border: 1px solid #ccc; width: 800px }
  [slot="post-media-container"] { display: block }
  [slot="post-media-container"] img { display: block; width: 100% }
</style>`;
// A 400 x 200 picture, served for every picture request so natural sizes are known.
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"></svg>';

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

const MP4 = 'https://packaged-media.redd.it/abc/pb/m2-res_720p.mp4';
const MEDIA: Array<{ post: FixturePost; inner?: string }> = [
  { post: base('t3_img1', {}), inner: '<img src="https://i.redd.it/a.png" alt="a">' },
  {
    post: base('t3_gal1', { type: 'gallery' }),
    inner:
      '<gallery-carousel><img src="https://preview.redd.it/g1.jpg"><img src="https://preview.redd.it/g2.jpg"><img src="https://preview.redd.it/g3.jpg"></gallery-carousel>',
  },
  {
    post: base('t3_vid1', { type: 'video', contentHref: 'https://v.redd.it/abc' }),
    inner: `<shreddit-player packaged-media-json='{"playbackMp4s":{"permutations":[{"source":{"url":"${MP4}","dimensions":{"height":720}}}]}}'><video id="fixture-video" muted></video></shreddit-player>`,
  },
  {
    post: base('t3_nsfw1', { nsfw: true }),
    inner: '<img src="https://i.redd.it/n.png" alt="n">',
  },
  {
    post: base('t3_txt1', {
      type: 'text',
      domain: 'self.pics',
      body: '<p>Look <a href="https://i.redd.it/pic.png">this</a> and <a href="https://i.imgur.com/x.png">that</a></p><p style="height:300px">tall</p>',
    }),
  },
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
  await ctx.route(/^https:\/\/(i|preview)\.redd\.it\//, (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SVG }),
  );
  await serveRedditPage(ctx, LISTING, page());
});
test.afterEach(async () => {
  await ctx.close();
});

type Chrome = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };
async function configure(
  viewer: Record<string, unknown>,
  inlineMedia: Record<string, unknown> = {},
) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(async (v) => (globalThis as unknown as Chrome).chrome.storage.local.set(v), {
    settings: {
      modules: {
        mediaViewer: { enabled: true, options: viewer },
        inlineMedia: { enabled: true, options: inlineMedia },
      },
    },
  });
}

const open = async (): Promise<Page> => {
  const p = await ctx.newPage();
  await p.goto(LISTING);
  await expect(p.locator('#rescue-gear')).toBeVisible();
  await waitForRescue(p);
  return p;
};

const box = (p: Page, id: string) =>
  p.locator(`shreddit-post#${id} > div[slot="post-media-container"]`);
/** Select the first post; the modules start a moment after the gear shows, so press until it is. */
const selectFirst = async (p: Page): Promise<void> => {
  const sel = p.locator('shreddit-post[data-rescue-selected]');
  await expect
    .poll(async () => {
      if (!(await sel.count())) await p.keyboard.press('j');
      return sel.count();
    })
    .toBe(1);
};
const widthOf = async (p: Page, id: string): Promise<number> =>
  (await box(p, id).boundingBox())?.width ?? 0;

test('nothing changes by default: no limits, no filmstrip, no player, no words', async () => {
  const p = await open();
  expect(await widthOf(p, 't3_img1')).toBeGreaterThan(700);
  await expect(p.locator('.rescue-filmstrip, .rescue-player, .rescue-linkmedia')).toHaveCount(0);
  await expect(box(p, 't3_gal1').locator('gallery-carousel')).toBeVisible();
  await expect(p.locator('.rescue-media-resolution').first()).toBeHidden();
});

test('widest media limits the container width', async () => {
  await configure({ maxWidth: '300' });
  const p = await open();
  await expect.poll(() => widthOf(p, 't3_img1')).toBeLessThanOrEqual(300);
  expect(await widthOf(p, 't3_img1')).toBeGreaterThan(250);
});

test('tallest media becomes a width limit once the picture size is known', async () => {
  await configure({ maxHeight: '100px' }); // a 2:1 picture can be at most 200 px wide
  const p = await open();
  await expect.poll(() => widthOf(p, 't3_img1')).toBeLessThanOrEqual(201);
  expect(await widthOf(p, 't3_img1')).toBeGreaterThan(150);
});

test('size and move keys act on the selected post and decline without one', async () => {
  const p = await open();
  await p.keyboard.press('=');
  expect(await widthOf(p, 't3_img1')).toBeGreaterThan(700); // no selection: nothing happened
  await selectFirst(p);
  const before = await widthOf(p, 't3_img1');
  await p.keyboard.press('-');
  const smaller = await widthOf(p, 't3_img1');
  expect(smaller).toBeLessThan(before);
  await p.keyboard.press('=');
  await p.keyboard.press('=');
  expect(await widthOf(p, 't3_img1')).toBeGreaterThan(smaller);
  await p.keyboard.press('Shift+_'); // a little smaller
  await p.keyboard.press('Control+ArrowRight');
  await expect(box(p, 't3_img1')).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 40, 0\)/);
  await p.keyboard.press('Control+ArrowDown');
  await expect(box(p, 't3_img1')).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 40, 40\)/);
  // Fit to width, then again to undo everything.
  await p.keyboard.press('Shift+ArrowRight');
  await expect(box(p, 't3_img1')).toHaveCSS('transform', /matrix\(1, 0, 0, 1, 0, 0\)|none/);
  await p.keyboard.press('Shift+ArrowRight');
  expect(await widthOf(p, 't3_img1')).toBeGreaterThan(700);
});

test('the original size of a picture shows after the time when asked for', async () => {
  await configure({ displayOriginalResolution: true });
  const p = await open();
  const label = p.locator('shreddit-post#t3_img1 .rescue-media-resolution');
  await expect(label).toHaveText('400 × 200');
  await expect(label).toHaveAttribute('title', /^REScue: /);
});

test('post text and comments get a scroll cap', async () => {
  await configure({ selfTextMaxHeight: '120' });
  const p = await open();
  const body = p.locator('shreddit-post#t3_txt1 [slot="text-body"]');
  await expect(body).toHaveCSS('max-height', '120px');
  await expect(body).toHaveCSS('overflow-y', 'auto');
});

test('a gallery stacks as a filmstrip, loads in steps, and the slideshow comes back', async () => {
  await configure({ galleryAsFilmstrip: true, filmstripLoadIncrement: '2' });
  const p = await open();
  const film = box(p, 't3_gal1').locator('.rescue-filmstrip');
  await expect(film.locator('img')).toHaveCount(2);
  await expect(box(p, 't3_gal1').locator('gallery-carousel')).toBeHidden();
  await film.getByText('load 1 more').click();
  await expect(film.locator('img')).toHaveCount(3);
  await expect(film.locator('.rescue-film-word').first()).toHaveAttribute('title', /^REScue: /);
  await film.getByText('show slideshow').click();
  await expect(film).toHaveCount(0);
  await expect(box(p, 't3_gal1').locator('gallery-carousel')).toBeVisible();
});

test('a long gallery keeps the slideshow when it is over the limit', async () => {
  await configure({ galleryAsFilmstrip: true, useSlideshowWhenLargerThan: '2' });
  const p = await open();
  await expect(box(p, 't3_gal1').locator('gallery-carousel')).toBeVisible();
  await expect(p.locator('.rescue-filmstrip')).toHaveCount(0);
});

test('the menu switch stacks galleries at once', async () => {
  const p = await open();
  await p.locator('#rescue-gear').click();
  const row = p.locator('#rescue-menu [data-menu-id="mediaViewer:filmstrip"]');
  await row.click();
  await expect(box(p, 't3_gal1').locator('.rescue-filmstrip')).toHaveCount(1);
  await row.click();
  await expect(box(p, 't3_gal1').locator('.rescue-filmstrip')).toHaveCount(0);
  await expect(box(p, 't3_gal1').locator('gallery-carousel')).toBeVisible();
});

test('the plain video player replaces Reddit’s and can be put back', async () => {
  await configure({ replaceVideoPlayer: true });
  const p = await open();
  const player = box(p, 't3_vid1').locator('.rescue-player');
  await expect(player.locator('video')).toHaveAttribute('src', MP4);
  await expect(player.locator('video')).toHaveJSProperty('controls', true);
  await expect(box(p, 't3_vid1').locator('shreddit-player')).toBeHidden();
  await player.getByText('show Reddit’s player').click();
  await expect(player).toHaveCount(0);
  await expect(box(p, 't3_vid1').locator('shreddit-player')).toBeVisible();
});

test('picture links in post text get a word; other hosts stay plain', async () => {
  await configure({ expandLinkMedia: true });
  const p = await open();
  const body = p.locator('shreddit-post#t3_txt1 [slot="text-body"]');
  await expect(body.locator('.rescue-linkmedia-toggle')).toHaveCount(1);
  await expect(body.locator('img')).toHaveCount(0);
  const word = body.locator('.rescue-linkmedia-toggle');
  await expect(word).toHaveAttribute('title', /^REScue: /);
  await word.click();
  await expect(body.locator('img')).toHaveAttribute('src', 'https://i.redd.it/pic.png');
  await word.click();
  await expect(body.locator('img')).toHaveCount(0);
});

test('F opens the command line with the filter command typed', async () => {
  const p = await open();
  const input = p.locator('#rescue-cmdline input');
  // The page's modules start a moment after the gear shows; press until the box opens.
  await expect
    .poll(async () => {
      if (!(await input.count())) await p.keyboard.press('f');
      return input.count();
    })
    .toBe(1);
  await expect(input).toHaveValue('filter ');
});

test('the word on an NSFW post is highlighted', async () => {
  await configure({}, { collapseMedia: true, collapsePostMedia: true });
  const p = await open();
  const word = p.locator('shreddit-post#t3_nsfw1 .rescue-media-toggle');
  await expect(word).toHaveCSS('color', 'rgb(217, 58, 0)');
  await expect(p.locator('shreddit-post#t3_img1 .rescue-media-toggle')).not.toHaveCSS(
    'color',
    'rgb(217, 58, 0)',
  );
});

test('moving to the next post hides the media you showed and shows the next one', async () => {
  await configure({}, { collapseMedia: true, collapsePostMedia: true, rememberExpanded: false });
  const p = await open();
  await selectFirst(p);
  await p.keyboard.press('x');
  await expect(box(p, 't3_img1')).toBeVisible();
  await p.keyboard.press('j');
  await expect(box(p, 't3_img1')).toBeHidden();
  await expect(box(p, 't3_gal1')).toBeVisible();
});
