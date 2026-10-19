import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc, waitForRescue } from './harness';
import { COMMENT_IMAGE_FIGURE, commentMediaComments, nestedThreadHtml } from '../fixtures/pages';

/**
 * inlineMedia in comments: "Hide inline media" hides the pictures, GIFs and videos inside comment
 * bodies (`figure.rte-media` in `div[slot=comment]`, observed live 2026-10-16) behind a word in
 * their place; the post's own media is a separate option. Nothing here touches live Reddit.
 */
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
const STYLE = `<style>
  [slot="post-media-container"] { display: block; height: 60px }
  figure.rte-media { display: block; margin: 4px 0 }
</style>`;

function threadPage(): string {
  const html = nestedThreadHtml(commentMediaComments(), false, true).replace(
    '</shreddit-post>',
    '<div slot="post-media-container"><img id="post-pic" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="50" height="50" alt="p"></div></shreddit-post>',
  );
  return htmlDoc(html, STYLE);
}

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, THREAD, threadPage());
});
test.afterEach(async () => {
  await ctx.close();
});

type Chrome = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };
async function configure(options: Record<string, unknown>) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(async (v) => (globalThis as unknown as Chrome).chrome.storage.local.set(v), {
    settings: { modules: { inlineMedia: { enabled: true, options } } },
  });
}

const open = async (): Promise<Page> => {
  const p = await ctx.newPage();
  await p.goto(THREAD);
  await expect(p.locator('#rescue-gear')).toBeVisible();
  await waitForRescue(p);
  return p;
};

const comment = (p: Page, id: string) => p.locator(`shreddit-comment[thingid="${id}"]`);
/** The comment's own figures (not those of replies nested in it). */
const figures = (p: Page, id: string) =>
  comment(p, id).locator('> details > div[slot="comment"] figure.rte-media');
const words = (p: Page, id: string) =>
  comment(p, id).locator('> details > div[slot="comment"] .rescue-cm-toggle');
const IDS = ['t1_img', 't1_gif', 't1_vid', 't1_two', 't1_reply'];

test('nothing is hidden and no word appears while the option is off (the default)', async () => {
  const p = await open();
  for (const id of IDS) await expect(figures(p, id).first()).toBeVisible();
  await expect(p.locator('.rescue-cm-toggle')).toHaveCount(0);
});

test('with the option on, every media in a comment is hidden and a word says what it is', async () => {
  await configure({ collapseMedia: true });
  const p = await open();
  for (const id of IDS) for (const f of await figures(p, id).all()) await expect(f).toBeHidden();
  await expect(words(p, 't1_img')).toHaveText('show image');
  await expect(words(p, 't1_gif')).toHaveText('show GIF');
  await expect(words(p, 't1_vid')).toHaveText('show video');
  await expect(words(p, 't1_two')).toHaveText(['show image', 'show video']);
  await expect(words(p, 't1_reply')).toHaveText('show image');
  await expect(words(p, 't1_none')).toHaveCount(0);
  // Reddit's own markup is untouched inside the figure.
  await expect(figures(p, 't1_img').locator('img')).toHaveCount(1);
});

test('the word shows that media only, and the same word puts it away again', async () => {
  await configure({ collapseMedia: true });
  const p = await open();
  await words(p, 't1_img').click();
  await expect(figures(p, 't1_img')).toBeVisible();
  await expect(words(p, 't1_img')).toHaveText('hide image');
  await expect(figures(p, 't1_gif')).toBeHidden();
  await expect(figures(p, 't1_two').first()).toBeHidden();
  await words(p, 't1_img').click();
  await expect(figures(p, 't1_img')).toBeHidden();
  await expect(words(p, 't1_img')).toHaveText('show image');
  // The click did not follow the picture's link.
  expect(p.url()).toBe(THREAD);
});

test('media is hidden before it can be seen, and again after a refresh', async () => {
  await configure({ collapseMedia: true });
  const p = await ctx.newPage();
  // Count the frames in which any comment media is on screen while a page loads.
  await p.addInitScript(() => {
    const w = window as unknown as { __visibleFrames: number };
    w.__visibleFrames = 0;
    const tick = () => {
      for (const f of document.querySelectorAll('figure.rte-media'))
        if ((f as HTMLElement).offsetParent !== null) w.__visibleFrames++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await p.goto(THREAD);
  await expect(words(p, 't1_img')).toHaveText('show image');
  await words(p, 't1_img').click();
  await expect(figures(p, 't1_img')).toBeVisible();
  // Refresh: the choice is not kept, and nothing is on screen even for one frame while it loads.
  await p.reload();
  await expect(words(p, 't1_img')).toHaveText('show image');
  await expect(figures(p, 't1_img')).toBeHidden();
  await p.waitForTimeout(300);
  const frames = await p.evaluate(
    () => (window as unknown as { __visibleFrames: number }).__visibleFrames,
  );
  expect(frames).toBe(0);
});

test('the post’s own media is untouched unless the post option is on', async () => {
  await configure({ collapseMedia: true, scope: 'both' });
  const p = await open();
  await expect(figures(p, 't1_img')).toBeHidden();
  await expect(p.locator('#post-pic')).toBeVisible();
  await expect(p.locator('shreddit-post .rescue-media-toggle')).toBeHidden();
  await configure({ collapseMedia: true, collapsePostMedia: true, scope: 'both' });
  await p.reload();
  await expect(p.locator('#post-pic')).toBeHidden();
  await expect(p.locator('shreddit-post .rescue-media-toggle')).toHaveText('show image');
  await expect(figures(p, 't1_img')).toBeHidden();
});

test('the menu switch hides and shows comment media at once', async () => {
  const p = await open();
  await p.locator('#rescue-gear').click();
  const row = p.locator('#rescue-menu [data-menu-id="inlineMedia:collapse"]');
  await expect(row).toHaveAttribute('aria-checked', 'false');
  await expect(row).toHaveAttribute('title', /^REScue: media in comments is shown/);
  await row.click();
  await expect(row).toHaveAttribute('aria-checked', 'true');
  await expect(figures(p, 't1_img')).toBeHidden(); // no reload
  await expect(words(p, 't1_vid')).toHaveText('show video');
  await expect(p.locator('#post-pic')).toBeVisible();
  await words(p, 't1_gif').click();
  await expect(figures(p, 't1_gif')).toBeVisible();
  await p.locator('#rescue-gear').click(); // the click above closed the menu
  await row.click();
  for (const id of IDS) await expect(figures(p, id).first()).toBeVisible();
  await expect(p.locator('.rescue-cm-toggle')).toHaveCount(0);
  await row.click();
  // Switching it on again starts from the rule, not from the earlier choice.
  await expect(figures(p, 't1_gif')).toBeHidden();
});

test('comments that load later, and bodies Reddit draws again, are hidden too', async () => {
  await configure({ collapseMedia: true });
  const p = await open();
  await words(p, 't1_img').click();
  await expect(figures(p, 't1_img')).toBeVisible();
  await p.evaluate((figure) => {
    // "More replies": a new comment arrives in the tree, its media with it.
    const tree = document.querySelector('shreddit-comment-tree')!;
    tree.insertAdjacentHTML(
      'beforeend',
      `<shreddit-comment thingid="t1_late" depth="0" author="x" comment-position="9"><div slot="comment"><p>late</p>${figure}</div></shreddit-comment>`,
    );
    // Reddit redraws a body: the old nodes go and equal ones take their place.
    const body = document.querySelector('shreddit-comment[thingid="t1_img"] div[slot="comment"]')!;
    body.innerHTML = body.innerHTML.replace(/<button[^>]*rescue-cm-toggle[^>]*>.*?<\/button>/, '');
    const inner = body.firstElementChild!;
    inner.replaceWith(inner.cloneNode(true));
    const vid = document.querySelector('shreddit-comment[thingid="t1_vid"] div[slot="comment"]')!;
    const html = vid.innerHTML;
    vid.innerHTML = html;
  }, COMMENT_IMAGE_FIGURE);
  await expect(comment(p, 't1_late').locator('figure.rte-media')).toBeHidden();
  await expect(comment(p, 't1_late').locator('.rescue-cm-toggle')).toHaveText('show image');
  // The redrawn body keeps the choice you made (shown), and a redrawn hidden one stays hidden.
  await expect(figures(p, 't1_img')).toBeVisible();
  await expect(words(p, 't1_img')).toHaveText('hide image');
  await expect(figures(p, 't1_vid')).toBeHidden();
  await expect(words(p, 't1_vid')).toHaveCount(1);
});

test('a video stops while it is hidden, and its link is not followed', async () => {
  await configure({ collapseMedia: true });
  const p = await open();
  const playing = () =>
    p.evaluate(() => {
      const v = document.querySelector(
        'shreddit-comment[thingid="t1_vid"] video',
      ) as HTMLVideoElement;
      return !v.paused;
    });
  await words(p, 't1_vid').click();
  await expect(figures(p, 't1_vid')).toBeVisible();
  await p.evaluate(() => {
    // A real, silent stream: the video is playing for real until REScue pauses it.
    const v = document.querySelector('shreddit-comment[thingid="t1_vid"] video') as HTMLVideoElement;
    v.srcObject = document.createElement('canvas').captureStream();
    v.muted = true;
    void v.play().catch(() => {}); // `paused` is false from this call on
  });
  expect(await playing()).toBe(true);
  await words(p, 't1_vid').click();
  await expect(figures(p, 't1_vid')).toBeHidden();
  expect(await playing()).toBe(false);
});

test('X on a selected comment toggles its media; Shift+X toggles every comment', async () => {
  await configure({ collapseMedia: true });
  const p = await open();
  await p.keyboard.press('j'); // the post
  await expect(p.locator('shreddit-post[data-rescue-selected]')).toHaveCount(1);
  await p.keyboard.press('j'); // the first comment (t1_img)
  await expect(comment(p, 't1_img')).toHaveAttribute('data-rescue-selected', /.*/);
  await p.keyboard.press('x');
  await expect(figures(p, 't1_img')).toBeVisible();
  await expect(figures(p, 't1_gif')).toBeHidden();
  await p.keyboard.press('x');
  await expect(figures(p, 't1_img')).toBeHidden();
  // Some are hidden, so Shift+X shows every comment's media; again hides them all.
  await p.keyboard.press('Shift+X');
  for (const id of IDS) await expect(figures(p, id).first()).toBeVisible();
  await p.keyboard.press('Shift+X');
  for (const id of IDS) await expect(figures(p, id).first()).toBeHidden();
});

test('a subreddit row can always show or always hide the media of its comments', async () => {
  await configure({
    collapseMedia: true,
    perSubreddit: [{ subreddit: 'Layoffs', action: 'always show' }],
  });
  let p = await open();
  await expect(figures(p, 't1_img')).toBeVisible();
  await p.close();
  await configure({
    collapseMedia: false,
    perSubreddit: [{ subreddit: 'layoffs', action: 'always collapse' }],
  });
  p = await open();
  await expect(figures(p, 't1_img')).toBeHidden();
});

test('every control has hover text that starts with REScue:', async () => {
  await configure({ collapseMedia: true });
  const p = await open();
  await expect(words(p, 't1_img')).toHaveAttribute('title', /^REScue: show this comment's image/);
  await words(p, 't1_img').click();
  await expect(words(p, 't1_img')).toHaveAttribute('title', /^REScue: hide this comment's image/);
});
