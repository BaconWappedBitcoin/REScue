import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc } from './harness';
import { nestedThreadHtml, sessionHtml, threadComments } from '../fixtures/pages';

// Comment actions (research R20): a / z vote on the selected comment through the buttons in its
// action row's open shadow root, r opens Reddit's reply box, e opens the editor on your own
// comment via the row's overflow menu, and score filters / chips wait for the row to hydrate.
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';

/**
 * Stands in for Reddit's lazy hydration: every comment gets its action row some time after load
 * (t1_c0 at 600 ms, t1_c2 late at 1800 ms, the rest at 400 ms). The row carries vote-state / score
 * attributes and an open root with vote buttons whose aria-pressed flips 200 ms after a click; the
 * reply button is light DOM; the overflow menu has an open root with an "Edit comment" item for
 * the user's own comment (t1_c0) only. Reply and Edit open a contenteditable box inside the comment.
 * t1_c4 has a hidden score (Reddit reads "1" there).
 */
const SCRIPT = `<script>
window.__clicks = [];
const HIDDEN = new Set(['t1_c4']);
const LATE = { t1_c0: 600, t1_c2: 1800 };
function openBox(c, why) {
  setTimeout(() => {
    const box = document.createElement('div');
    box.className = 'fixture-composer';
    box.setAttribute('contenteditable', 'true');
    box.setAttribute('data-why', why);
    c.appendChild(box);
  }, 150);
}
function hydrate(c) {
  const id = c.getAttribute('thingid');
  const row = document.createElement('shreddit-comment-action-row');
  row.setAttribute('slot', 'actionRow');
  row.setAttribute('comment-id', id);
  row.setAttribute('vote-state', 'NONE');
  row.setAttribute('score', c.getAttribute('score'));
  if (HIDDEN.has(id)) row.setAttribute('is-score-hidden', '');
  const root = row.attachShadow({ mode: 'open' });
  root.innerHTML = '<button upvote aria-pressed="false">up</button><button downvote aria-pressed="false">down</button>';
  for (const b of root.querySelectorAll('button')) {
    b.addEventListener('click', () => {
      const dir = b.hasAttribute('upvote') ? 'up' : 'down';
      window.__clicks.push(id + ':' + dir);
      setTimeout(() => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        for (const o of root.querySelectorAll('button')) o.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        row.setAttribute('vote-state', on ? dir.toUpperCase() : 'NONE');
      }, 200);
    });
  }
  const tracker = document.createElement('faceplate-tracker');
  tracker.setAttribute('slot', 'comment-reply');
  const reply = document.createElement('button');
  reply.textContent = 'Reply';
  reply.addEventListener('click', () => { window.__clicks.push(id + ':reply'); openBox(c, 'reply'); });
  tracker.appendChild(reply);
  row.appendChild(tracker);
  const menu = document.createElement('shreddit-overflow-menu');
  menu.setAttribute('slot', 'overflow');
  const own = id === 't1_c0';
  if (own) { menu.setAttribute('editable-comment', ''); menu.setAttribute('is-comment-author', ''); }
  const mroot = menu.attachShadow({ mode: 'open' });
  mroot.innerHTML = '<button id="overflow-trigger" aria-label="Open user actions" aria-expanded="false">...</button>'
    + '<div class="items" hidden><div role="menuitem">Copy link</div>' + (own ? '<div role="menuitem">Edit comment</div>' : '')
    + '<div role="menuitem">Report</div></div>';
  const trigger = mroot.querySelector('#overflow-trigger');
  const items = mroot.querySelector('.items');
  trigger.addEventListener('click', () => {
    const open = items.hidden;
    items.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    window.__clicks.push(id + ':menu-' + (open ? 'open' : 'close'));
  });
  for (const item of mroot.querySelectorAll('[role=menuitem]')) {
    item.addEventListener('click', () => {
      window.__clicks.push(id + ':item-' + item.textContent);
      items.hidden = true;
      if (/^Edit/.test(item.textContent)) openBox(c, 'edit');
    });
  }
  row.appendChild(menu);
  c.appendChild(row);
}
for (const c of document.querySelectorAll('shreddit-comment')) {
  setTimeout(() => hydrate(c), LATE[c.getAttribute('thingid')] ?? 400);
}
</script>`;

const STYLE = `<style>shreddit-comment { display: block; border-left: 1px solid #ccc; padding-left: 8px; margin: 4px 0 }</style>`;
const thread = (signedIn: boolean) =>
  htmlDoc(sessionHtml(signedIn) + nestedThreadHtml(threadComments(), false, true) + SCRIPT, STYLE);

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };

async function configure(modules: Record<string, unknown>) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules },
  );
}

async function open(signedIn: boolean, modules?: Record<string, unknown>): Promise<Page> {
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) =>
    route.request().url() === THREAD
      ? route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: thread(signedIn),
        })
      : route.abort(),
  );
  if (modules) await configure(modules);
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  return page;
}

/** Select a comment by clicking its own body text (Reddit's own handlers are not involved). */
async function select(page: Page, id: string): Promise<void> {
  await page.locator(`shreddit-comment[thingid="${id}"] [slot="comment"]`).first().click();
  await expect(page.locator(`shreddit-comment[thingid="${id}"][data-rescue-selected]`)).toHaveCount(
    1,
  );
}

const clicks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __clicks: string[] }).__clicks);
const rowOf = (page: Page, id: string) =>
  page.locator(`shreddit-comment[thingid="${id}"] > shreddit-comment-action-row`);
const pressed = (page: Page, id: string, which: 'upvote' | 'downvote') =>
  rowOf(page, id).evaluate(
    (row, w) => row.shadowRoot!.querySelector(`button[${w}]`)!.getAttribute('aria-pressed'),
    which,
  );
const active = (page: Page) =>
  page.evaluate(() => ({
    cls: document.activeElement?.className ?? '',
    owner: document.activeElement?.closest('shreddit-comment')?.getAttribute('thingid') ?? null,
    why: document.activeElement?.getAttribute('data-why') ?? null,
  }));

test('a and z vote on the selected comment, waiting for its row to hydrate; vote-state follows', async () => {
  const page = await open(true);
  await select(page, 't1_c0'); // its row only appears at 600 ms
  await page.keyboard.press('a');
  await expect.poll(() => pressed(page, 't1_c0', 'upvote'), { timeout: 8000 }).toBe('true');
  await expect(rowOf(page, 't1_c0')).toHaveAttribute('vote-state', 'UP');
  await page.waitForTimeout(500);
  await page.keyboard.press('z');
  await expect.poll(() => pressed(page, 't1_c0', 'downvote'), { timeout: 8000 }).toBe('true');
  expect(await pressed(page, 't1_c0', 'upvote')).toBe('false');
  await page.waitForTimeout(500);
  await page.keyboard.press('z'); // the same key again clears it
  await expect.poll(() => pressed(page, 't1_c0', 'downvote'), { timeout: 8000 }).toBe('false');
  await expect(rowOf(page, 't1_c0')).toHaveAttribute('vote-state', 'NONE');
  expect(await clicks(page)).toEqual(['t1_c0:up', 't1_c0:down', 't1_c0:down']);
  await expect(page.getByText(/did not confirm|could not find|isn.t possible/)).toHaveCount(0);
});

test('a vote lands on the selected comment only, not on its parent or a reply', async () => {
  const page = await open(true);
  await select(page, 't1_c4');
  await page.keyboard.press('a');
  await expect.poll(() => pressed(page, 't1_c4', 'upvote'), { timeout: 8000 }).toBe('true');
  expect(await clicks(page)).toEqual(['t1_c4:up']);
});

test('r opens Reddit’s reply box under the selected comment and focuses it', async () => {
  const page = await open(true);
  await select(page, 't1_c4');
  await page.keyboard.press('r');
  await expect
    .poll(() => active(page), { timeout: 8000 })
    .toMatchObject({
      cls: 'fixture-composer',
      owner: 't1_c4',
      why: 'reply',
    });
  expect(await clicks(page)).toEqual(['t1_c4:reply']);
  expect(page.url()).toBe(THREAD); // r replied; it did not go to a subreddit
});

test('e edits your own comment through the overflow menu’s “Edit comment” item', async () => {
  const page = await open(true);
  await select(page, 't1_c0');
  await page.keyboard.press('e');
  await expect
    .poll(() => active(page), { timeout: 8000 })
    .toMatchObject({
      cls: 'fixture-composer',
      owner: 't1_c0',
      why: 'edit',
    });
  expect(await clicks(page)).toEqual(['t1_c0:menu-open', 't1_c0:item-Edit comment']);
});

test('e on someone else’s comment says so and opens nothing', async () => {
  const page = await open(true);
  await select(page, 't1_c4');
  await page.waitForTimeout(500);
  await page.keyboard.press('e');
  await expect(page.getByText('You can only edit your own comments.')).toBeVisible();
  expect(await clicks(page)).toEqual([]);
});

test('signed out: a, r and e say to sign in and press nothing', async () => {
  const page = await open(false);
  await select(page, 't1_c4');
  await page.keyboard.press('a');
  await expect(page.getByText('Sign in to Reddit to vote.')).toBeVisible();
  await page.keyboard.press('r');
  await expect(page.getByText('Sign in to Reddit to reply.')).toBeVisible();
  await page.keyboard.press('e');
  await expect(page.getByText('Sign in to Reddit to edit.')).toBeVisible();
  await page.waitForTimeout(800);
  expect(await clicks(page)).toEqual([]);
});

test('score filter: hides low scores once rows load; a hidden score is never filtered', async () => {
  const rows = [{ type: 'score-below', pattern: '20', action: 'hide', enabled: true }];
  const page = await open(true, {
    filteReddit: { enabled: true, options: { commentRules: rows } },
  });
  const c = (id: string) => page.locator(`shreddit-comment[thingid="${id}"]`);
  // Before any row has hydrated every score is unknown, so nothing is filtered yet.
  await expect(c('t1_c4')).toBeVisible();
  // t1_c0 (10) hydrates at 600 ms and is hidden along with its replies; t1_c6 (16) and t1_c7 (17) too.
  await expect(c('t1_c0')).toBeHidden({ timeout: 8000 });
  await expect(c('t1_c6')).toBeHidden();
  await expect(c('t1_c7')).toBeHidden();
  // t1_c4 would be 14 (< 20), but its score is hidden, so it stays; t1_c11 (21) is above the limit.
  await expect(c('t1_c4')).toBeVisible();
  await expect(c('t1_c11')).toBeVisible();
});

test('score chips: REScue-drawn label per shown score, none for a hidden or unloaded one', async () => {
  const page = await open(true, {
    voteEnhancements: { enabled: true, options: { colorCommentScore: true } },
  });
  const chip = (id: string) =>
    page.locator(`shreddit-comment[thingid="${id}"] .rescue-score-chip[data-item="${id}"]`);
  await expect(chip('t1_c0')).toHaveText('10 pts', { timeout: 8000 });
  await expect(chip('t1_c0')).toHaveCSS('color', 'rgb(47, 133, 90)');
  await expect(chip('t1_c0')).toHaveAttribute('title', /^REScue: /);
  await expect(chip('t1_c6')).toHaveText('16 pts');
  // Hidden score: Reddit's attribute reads 1, REScue shows nothing.
  await expect(chip('t1_c4')).toHaveCount(0);
  // t1_c2's row only appears at 1800 ms: its chip arrives then, not before.
  await expect(chip('t1_c2')).toHaveText('12 pts', { timeout: 8000 });
  // Reddit's own number (the comment's score attribute) is untouched.
  await expect(page.locator('shreddit-comment[thingid="t1_c0"]')).toHaveAttribute('score', '10');
});
