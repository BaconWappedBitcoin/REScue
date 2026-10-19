import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc, waitForRescue } from './harness';
import { listingHtml, POSTS, sessionHtml } from '../fixtures/pages';

// US7 / T100 / quickstart scenarios 12–13: keyboard voting presses Reddit's own vote buttons and
// counts a vote only once Reddit's state shows it.
const LISTING = 'https://www.reddit.com/r/programming/';

const STYLE = `<style>
  article { margin: 8px 0 }
  shreddit-post { display: block; min-height: 200px; border: 1px solid #ccc }
</style>`;

/**
 * Stands in for Reddit's vote buttons: they hydrate late (400 ms) inside each post's open shadow
 * root and carry aria-pressed. In "confirm" mode a click flips the pressed state after 300 ms (the
 * network round trip); in "ignore" mode Reddit never applies it.
 */
const SCRIPT = `<script>
window.__voteMode = 'confirm';
window.__voteClicks = 0;
setTimeout(() => {
  for (const post of document.querySelectorAll('shreddit-post')) {
    const root = post.attachShadow({ mode: 'open' });
    root.innerHTML = '<slot></slot><button upvote aria-pressed="false">up</button><button downvote aria-pressed="false">down</button>';
    for (const b of root.querySelectorAll('button')) {
      b.addEventListener('click', () => {
        window.__voteClicks++;
        if (window.__voteMode !== 'confirm') return;
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

const page_ = (signedIn: boolean) => htmlDoc(sessionHtml(signedIn) + listingHtml() + SCRIPT, STYLE);

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
});
test.afterEach(async () => {
  await ctx.close();
});

async function open(signedIn: boolean): Promise<Page> {
  await serveRedditPage(ctx, LISTING, page_(signedIn));
  const page = await ctx.newPage();
  await page.goto(LISTING);
  await waitForRescue(page);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  // Reddit's vote buttons hydrate late (400 ms), so wait for them before a vote key can act.
  await expect(page.locator(`shreddit-post#${POSTS[0]!.id} button[upvote]`)).toBeAttached();
  await page.keyboard.press('j');
  await expect(page.locator(`shreddit-post#${POSTS[0]!.id}[data-rescue-selected]`)).toHaveCount(1);
  return page;
}

const pressed = (page: Page, which: 'upvote' | 'downvote') =>
  page.locator(`shreddit-post#${POSTS[0]!.id} button[${which}]`).getAttribute('aria-pressed');
const clicks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __voteClicks: number }).__voteClicks);
/** The tally appears only once REScue has confirmed the vote, so it also means the item is free. */
const confirmedTally = (page: Page, text: string) =>
  expect(page.locator(`shreddit-post#${POSTS[0]!.id} .rescue-vote-tally`)).toHaveText(text, {
    timeout: 6000,
  });

test('signed out: the vote key says sign-in is required and presses nothing', async () => {
  const page = await open(false);
  await page.keyboard.press('a');
  await expect(page.getByText('Sign in to Reddit to vote.')).toBeVisible();
  expect(await clicks(page)).toBe(0);
  expect(await pressed(page, 'upvote')).toBe('false');
});

test('signed in: a votes up via Reddit’s button, a again clears it; no failure notice', async () => {
  const page = await open(true);
  await page.keyboard.press('a');
  await expect.poll(() => pressed(page, 'upvote'), { timeout: 6000 }).toBe('true');
  await confirmedTally(page, '+1 −0');
  expect(await clicks(page)).toBe(1);
  await page.keyboard.press('a');
  await expect.poll(() => pressed(page, 'upvote'), { timeout: 6000 }).toBe('false');
  expect(await clicks(page)).toBe(2);
  await expect(page.getByText(/did not confirm|could not find/)).toHaveCount(0);
});

test('signed in: z after an upvote switches to a downvote with one click', async () => {
  const page = await open(true);
  await page.keyboard.press('a');
  await expect.poll(() => pressed(page, 'upvote'), { timeout: 6000 }).toBe('true');
  await confirmedTally(page, '+1 −0');
  await page.keyboard.press('z');
  await expect.poll(() => pressed(page, 'downvote'), { timeout: 6000 }).toBe('true');
  expect(await pressed(page, 'upvote')).toBe('false');
  expect(await clicks(page)).toBe(2);
});

test('signed in: when Reddit never applies the vote, REScue says it may not have gone through', async () => {
  const page = await open(true);
  await page.evaluate(() => {
    (window as unknown as { __voteMode: string }).__voteMode = 'ignore';
  });
  await page.keyboard.press('a');
  await expect(page.getByText(/did not confirm the vote/)).toBeVisible({ timeout: 8000 });
  expect(await pressed(page, 'upvote')).toBe('false');
  expect(await clicks(page)).toBe(1);
});
