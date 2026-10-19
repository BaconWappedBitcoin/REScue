import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc, waitForRescue } from './harness';
import {
  listingHtml,
  nestedThreadHtml,
  POSTS,
  sessionHtml,
  threadComments,
} from '../fixtures/pages';

// RES parity batch 2: the user tagger's editor (colour presets, preview, preset tags, Enter/Escape,
// source link), separate up/down counts with counting of the reader's clicks on Reddit's own post
// arrows, the tagged-users manager, and no tag button on the reader's own name.
const THREAD_URL = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
const LISTING_URL = 'https://www.reddit.com/r/programming/';

const AUTHORS: Record<number, string> = { 2: 'repeater', 6: 'repeater', 7: 'ignoreme' };
const THREAD = nestedThreadHtml(
  threadComments().map((c, i) => ({ ...c, ...(AUTHORS[i] ? { author: AUTHORS[i]! } : {}) })),
);
const threadPage = (me: string | null) => htmlDoc((me ? sessionHtml(true, me) : '') + THREAD);

const STYLE = `<style>
  article { margin: 8px 0 }
  shreddit-post { display: block; min-height: 200px; border: 1px solid #ccc }
</style>`;
// Stands in for Reddit's post vote arrows: hydrate late into each post's open shadow root, carry
// aria-pressed, and flip it 300 ms after a click (Reddit's network round trip).
const VOTE_SCRIPT = `<script>
window.__voteClicks = 0;
setTimeout(() => {
  for (const post of document.querySelectorAll('shreddit-post')) {
    const root = post.attachShadow({ mode: 'open' });
    root.innerHTML = '<slot></slot><button upvote aria-pressed="false">up</button><button downvote aria-pressed="false">down</button>';
    for (const b of root.querySelectorAll('button')) {
      b.addEventListener('click', () => {
        window.__voteClicks++;
        setTimeout(() => {
          const on = b.getAttribute('aria-pressed') !== 'true';
          for (const other of root.querySelectorAll('button')) other.setAttribute('aria-pressed', 'false');
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        }, 300);
      });
    }
  }
}, 400);
</script>`;
const listingPage = (me: string | null) =>
  htmlDoc((me ? sessionHtml(true, me) : '') + listingHtml() + VOTE_SCRIPT, STYLE);

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
});
test.afterEach(async () => {
  await ctx.close();
});

async function open(url: string, html: string): Promise<Page> {
  await serveRedditPage(ctx, url, html);
  const page = await ctx.newPage();
  await page.goto(url);
  await waitForRescue(page);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  return page;
}
const settle = (page: Page) => page.waitForTimeout(500);
const editor = (page: Page) => page.locator('.rescue-tag-editor');
const tagButton = (page: Page, user: string) =>
  page.locator(`button[aria-label="Tag ${user}"]`).first();

test('the editor shows 21 swatches and a live preview of the tag', async () => {
  const page = await open(THREAD_URL, threadPage(null));
  await tagButton(page, 'repeater').click();
  await expect(editor(page).locator('.rescue-swatch')).toHaveCount(21);
  await editor(page).locator('input[name=text]').fill('regular');
  await editor(page).locator('.rescue-swatch[data-color="orangered"]').click();
  const preview = editor(page).locator('.rescue-tag-preview .rescue-user-tag');
  await expect(preview).toHaveText('regular');
  await expect(preview).toHaveCSS('background-color', 'rgb(255, 69, 0)');
  await expect(preview).toHaveCSS('color', 'rgb(0, 0, 0)'); // contrast over RES's white pairing (3.4:1)
  await expect(editor(page).locator('input[name=color]')).toHaveValue('#ff4500');

  await editor(page).getByRole('button', { name: 'Save' }).click();
  const chip = page.locator('.rescue-user-tag[data-user="repeater"]').first();
  await expect(chip).toHaveText('regular');
  await expect(chip).toHaveCSS('background-color', 'rgb(255, 69, 0)');
});

test('Enter in a field saves the tag and Escape closes the editor without saving', async () => {
  const page = await open(THREAD_URL, threadPage(null));
  await tagButton(page, 'repeater').click();
  await editor(page).locator('input[name=text]').fill('typed');
  await page.keyboard.press('Escape');
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('.rescue-user-tag[data-user="repeater"]')).toHaveCount(0);

  await tagButton(page, 'repeater').click();
  await editor(page).locator('input[name=text]').fill('entered');
  await page.keyboard.press('Enter');
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('.rescue-user-tag[data-user="repeater"]').first()).toHaveText(
    'entered',
  );
  // Enter in the link field saves too.
  await tagButton(page, 'repeater').click();
  await editor(page).locator('input[name=text]').fill('again');
  await editor(page).locator('input[name=link]').press('Enter');
  await expect(editor(page)).toHaveCount(0);
  await expect(page.locator('.rescue-user-tag[data-user="repeater"]').first()).toHaveText('again');
});

test('the link is filled with the item’s permalink, with an open link, and survives saving', async () => {
  const page = await open(THREAD_URL, threadPage(null));
  await page
    .locator('shreddit-comment[thingid="t1_c2"]')
    .locator('button[aria-label="Tag repeater"]')
    .click();
  const link = editor(page).locator('input[name=link]');
  const value = await link.inputValue();
  expect(value).toMatch(/^https:\/\/www\.reddit\.com\//);
  await expect(editor(page).locator('a.rescue-tag-open')).toHaveAttribute('href', value);
  await expect(editor(page).locator('a.rescue-tag-open')).toHaveAttribute('target', '_blank');
  await editor(page).locator('input[name=text]').fill('linked');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.rescue-user-tag[data-user="repeater"] a').first()).toHaveAttribute(
    'href',
    value,
  );
});

test('preset tags: save one from the editor, then apply it with one click, also after a reload', async () => {
  const page = await open(THREAD_URL, threadPage(null));
  await tagButton(page, 'repeater').click();
  await editor(page).locator('input[name=text]').fill('regular');
  await editor(page).locator('.rescue-swatch[data-color="green"]').click();
  await editor(page).getByRole('button', { name: 'Add as preset' }).click();
  await expect(editor(page).locator('.rescue-tag-preset')).toHaveCount(1);
  await editor(page).getByRole('button', { name: 'Cancel' }).click();
  await settle(page);

  await page.reload();
  await expect(page.locator('#rescue-gear')).toBeVisible();
  await tagButton(page, 'ignoreme').click();
  const preset = editor(page).locator('.rescue-tag-preset');
  await expect(preset).toHaveCount(1);
  await preset.click();
  await expect(editor(page).locator('input[name=text]')).toHaveValue('regular');
  await expect(editor(page).locator('input[name=color]')).toHaveValue('#008000');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  const chip = page.locator('.rescue-user-tag[data-user="ignoreme"]').first();
  await expect(chip).toHaveText('regular');
  await expect(chip).toHaveCSS('background-color', 'rgb(0, 128, 0)');
});

test('there is no tag button on the signed-in user’s own name', async () => {
  const page = await open(THREAD_URL, threadPage('repeater'));
  await expect(page.locator('button[aria-label="Tag ignoreme"]').first()).toBeVisible();
  await expect(page.locator('button[aria-label="Tag repeater"]')).toHaveCount(0);
  await expect(page.locator('.rescue-author-extras').first()).toBeAttached();
});

test('counts clicks on a post’s own arrows as separate up and down votes', async () => {
  const page = await open(LISTING_URL, listingPage('me_the_reader'));
  const post = page.locator(`shreddit-post#${POSTS[0]!.id}`);
  const pill = post.locator('.rescue-vote-tally');
  await expect(pill).toHaveCount(0);

  await post.locator('button[upvote]').click();
  await expect(pill).toHaveText('+1 −0', { timeout: 6000 });
  // Switching to a downvote: one upvote less, one downvote more.
  await page.waitForTimeout(500);
  await post.locator('button[downvote]').click();
  await expect(pill).toHaveText('+0 −1', { timeout: 6000 });
  // Clicking the pressed arrow clears the vote and takes the count back.
  await page.waitForTimeout(500);
  await post.locator('button[downvote]').click();
  await expect(pill).toHaveCount(0, { timeout: 6000 });
  // Voting on a different user's post counts for that user only.
  await page.locator(`shreddit-post#${POSTS[1]!.id} button[upvote]`).click();
  await expect(page.locator(`shreddit-post#${POSTS[1]!.id} .rescue-vote-tally`)).toHaveText(
    '+1 −0',
    { timeout: 6000 },
  );
  await expect(pill).toHaveCount(0);
});

test('the counted votes survive a reload and show in a tooltip', async () => {
  const page = await open(LISTING_URL, listingPage('me_the_reader'));
  const post = page.locator(`shreddit-post#${POSTS[0]!.id}`);
  await post.locator('button[upvote]').click();
  await expect(post.locator('.rescue-vote-tally')).toHaveText('+1 −0', { timeout: 6000 });
  await settle(page);
  await page.reload();
  const pill = page.locator(`shreddit-post#${POSTS[0]!.id} .rescue-vote-tally`);
  await expect(pill).toHaveText('+1 −0');
  await expect(pill).toHaveAttribute('title', /your votes on u\/rockpaperblr/);
});

test('signed out: a click on the arrow counts nothing', async () => {
  const page = await open(LISTING_URL, listingPage(null));
  const post = page.locator(`shreddit-post#${POSTS[0]!.id}`);
  await post.locator('button[upvote]').click();
  await page.waitForTimeout(1200);
  await expect(post.locator('.rescue-vote-tally')).toHaveCount(0);
});

test('a keyboard vote is counted once, not twice', async () => {
  const page = await open(LISTING_URL, listingPage('me_the_reader'));
  await page.keyboard.press('j');
  const post = page.locator(`shreddit-post#${POSTS[0]!.id}`);
  await expect(post).toHaveAttribute('data-rescue-selected', /.*/);
  await page.keyboard.press('a');
  await expect(post.locator('.rescue-vote-tally')).toHaveText('+1 −0', { timeout: 6000 });
  await page.waitForTimeout(1500); // a double count would land within a second
  await expect(post.locator('.rescue-vote-tally')).toHaveText('+1 −0');
  expect(
    await page.evaluate(() => (window as unknown as { __voteClicks: number }).__voteClicks),
  ).toBe(1);
});

test('the tagged-users manager lists, searches, edits and deletes tags', async () => {
  const page = await open(THREAD_URL, threadPage(null));
  for (const [user, text] of [
    ['repeater', 'alpha'],
    ['ignoreme', 'beta'],
  ] as const) {
    await tagButton(page, user).click();
    await editor(page).locator('input[name=text]').fill(text);
    await editor(page).locator('input[name=votesUp]').fill('3');
    await editor(page).locator('input[name=votesDown]').fill('1');
    await editor(page).getByRole('button', { name: 'Save' }).click();
  }
  await expect(page.locator('.rescue-vote-tally').first()).toHaveText('+3 −1');

  await tagButton(page, 'repeater').click();
  await editor(page).getByRole('button', { name: 'Tagged users' }).click();
  const manager = page.locator('.rescue-tags-manager');
  await expect(manager).toBeVisible();
  const rows = manager.locator('tbody tr[data-user]');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('+3 −1');

  await manager.locator('input[name=search]').fill('bet');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-user', 'ignoreme');
  await manager.locator('input[name=search]').fill('');

  // Edit from the manager: the page updates too.
  await manager.locator('tr[data-user="repeater"] .rescue-tags-edit').click();
  await editor(page).locator('input[name=text]').fill('gamma');
  await editor(page).getByRole('button', { name: 'Save' }).click();
  await expect(manager.locator('tr[data-user="repeater"]')).toContainText('gamma');
  await expect(page.locator('.rescue-user-tag[data-user="repeater"]').first()).toHaveText('gamma');

  // Delete needs a second click.
  const del = manager.locator('tr[data-user="ignoreme"] .rescue-tags-delete');
  await del.click();
  await expect(del).toHaveText('Sure?');
  await del.click();
  await expect(rows).toHaveCount(1);
  await expect(page.locator('.rescue-user-tag[data-user="ignoreme"]')).toHaveCount(0);

  await manager.locator('input[name=search]').press('Escape');
  await expect(manager).toHaveCount(0);
  await settle(page);
  await page.reload();
  await expect(page.locator('.rescue-user-tag[data-user="repeater"]').first()).toHaveText('gamma');
  await expect(page.locator('.rescue-user-tag[data-user="ignoreme"]')).toHaveCount(0);
});
