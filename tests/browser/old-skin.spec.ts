import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc, waitForRescue } from './harness';
import { POSTS, postHtml, nestedCommentsHtml, threadComments } from '../fixtures/pages';

// oldRedditSkin (a REScue extra): off by default; on, feeds, search results and threads get the old
// Reddit look. The second pass draws REScue's own vote column, title / tagline / link row and a
// comment's points and links; every one of them ACTS through Reddit's own controls (the fixture
// below has the live shapes: a post's open shadow root with vote buttons, a share button and the
// overflow menu; a comment's action row with vote buttons, a reply button and a menu), and Reddit's
// own rows are only hidden while REScue's are mounted.
const LISTING = 'https://www.reddit.com/r/science/';
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
/** The same thread, where the reader (me_the_reader) wrote some of the comments. */
const MY_THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/?mine=1';
const PROFILE = 'https://www.reddit.com/user/alice/';
let ctx: BrowserContext;

const SORT = `<div class="sortrow"><shreddit-sort-dropdown sort-event="feed-sort-change"><div slot="dropdown-items">
  <data value="BEST"><li rpl-selected=""><a href="/r/science/best/">Best</a></li></data>
  <data value="HOT"><li><a href="/r/science/hot/">Hot</a></li></data>
  <data value="NEW"><li><a href="/r/science/new/">New</a></li></data>
  <data value="TOP"><li><a href="/r/science/top/">Top</a></li></data></div></shreddit-sort-dropdown></div>`;

// Reddit's feed posts: a full-card link over the post, and an open shadow root holding the action
// row (vote buttons that flip aria-pressed, a comments link, a share button) and, in the light DOM,
// the overflow menu with the Save / Hide / Report rows. A post given `data-novote` has no vote
// buttons at all (a shape REScue does not know).
const POST_SCRIPT = `<script>
window.__clicks = [];
for (const p of document.querySelectorAll('shreddit-post')) {
  const id = p.getAttribute('id');
  p.style.position = 'relative';
  const link = document.createElement('a');
  link.slot = 'full-post-link';
  link.href = p.getAttribute('permalink') || '#';
  link.style.cssText = 'position:absolute;inset:0;display:block';
  link.addEventListener('click', (e) => { e.preventDefault(); window.__clicks.push(id + ':open'); });
  p.prepend(link);
  const sr = p.attachShadow({ mode: 'open' });
  const votes = p.hasAttribute('data-novote') ? '' : '<button id="vote" upvote aria-pressed="false">Upvote</button><button downvote aria-pressed="false">Downvote</button>';
  sr.innerHTML = '<slot name="full-post-link"></slot><slot name="credit-bar"></slot><slot name="title"></slot><slot></slot><div id="row">' + votes + '<button part="share-button">Share</button></div>';
  for (const b of sr.querySelectorAll('button[upvote], button[downvote]')) {
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      window.__clicks.push(id + ':vote-' + (b.hasAttribute('upvote') ? 'up' : 'down') + '-' + (on ? 'on' : 'off'));
      setTimeout(() => {
        for (const o of sr.querySelectorAll('button[upvote], button[downvote]')) o.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-pressed', String(on));
      }, 60);
    });
  }
  sr.querySelector('[part=share-button]').addEventListener('click', () => window.__clicks.push(id + ':share'));
  const menu = document.createElement('shreddit-post-overflow-menu');
  const root = menu.attachShadow({ mode: 'open' });
  root.innerHTML = '<button id="overflow-trigger" aria-expanded="false">…</button><ul class="items" hidden><li role="presentation">Save</li><li role="presentation">Hide</li><li role="presentation">Report</li></ul>';
  const trigger = root.querySelector('#overflow-trigger');
  const items = root.querySelector('.items');
  trigger.addEventListener('click', () => { items.hidden = !items.hidden; trigger.setAttribute('aria-expanded', String(!items.hidden)); });
  for (const item of root.querySelectorAll('li')) {
    item.addEventListener('click', () => {
      const text = item.textContent;
      window.__clicks.push(id + ':item-' + text);
      items.hidden = true; trigger.setAttribute('aria-expanded', 'false');
      if (text === 'Save') item.textContent = 'Unsave';
      else if (text === 'Hide') (p.closest('article') || p).remove();
    });
  }
  const credit = p.querySelector('[slot=credit-bar]');
  (credit || p).appendChild(menu);
}
</script>`;

const COMMENT_SCRIPT = `<script>
window.__clicks = [];
for (const c of document.querySelectorAll('shreddit-comment')) {
  const id = c.getAttribute('thingid');
  const row = document.createElement('shreddit-comment-action-row');
  row.setAttribute('slot', 'actionRow'); row.setAttribute('comment-id', id); row.setAttribute('score', c.getAttribute('score'));
  const root = row.attachShadow({ mode: 'open' });
  root.innerHTML = '<button upvote aria-pressed="false">up</button><button downvote aria-pressed="false">down</button>';
  for (const b of root.querySelectorAll('button')) b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    window.__clicks.push(id + ':vote-' + (b.hasAttribute('upvote') ? 'up' : 'down') + '-' + (on ? 'on' : 'off'));
    setTimeout(() => { for (const o of root.querySelectorAll('button')) o.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', String(on)); }, 60);
  });
  const tracker = document.createElement('faceplate-tracker');
  tracker.setAttribute('slot', 'comment-reply');
  const reply = document.createElement('button'); reply.textContent = 'Reply';
  reply.addEventListener('click', () => { window.__clicks.push(id + ':reply'); const box = document.createElement('textarea'); box.id = 'reply-box-' + id; c.appendChild(box); });
  tracker.appendChild(reply); row.appendChild(tracker);
  const menu = document.createElement('shreddit-overflow-menu'); menu.setAttribute('slot', 'overflow'); if (c.getAttribute('author') === 'me_the_reader') menu.setAttribute('is-send-replies', '');
  const mr = menu.attachShadow({ mode: 'open' });
  mr.innerHTML = '<button id="overflow-trigger" aria-expanded="false">…</button><div class="items" hidden><div role="menuitem">Save</div><div role="menuitem">Report</div>' + (c.getAttribute('author') === 'me_the_reader' ? '<div role="menuitem">Disable inbox replies</div><div role="menuitem">Delete</div>' : '') + '</div>';
  const t = mr.querySelector('#overflow-trigger'); const items = mr.querySelector('.items');
  t.addEventListener('click', () => { items.hidden = !items.hidden; t.setAttribute('aria-expanded', String(!items.hidden)); });
  for (const it of mr.querySelectorAll('[role=menuitem]')) it.addEventListener('click', () => { window.__clicks.push(id + ':item-' + it.textContent); items.hidden = true; t.setAttribute('aria-expanded', 'false'); if (it.textContent === 'Save') it.textContent = 'Unsave'; else if (it.textContent === 'Disable inbox replies') { it.textContent = 'Enable inbox replies'; menu.removeAttribute('is-send-replies'); } else if (it.textContent === 'Enable inbox replies') { it.textContent = 'Disable inbox replies'; menu.setAttribute('is-send-replies', ''); } });
  row.appendChild(menu);
  const grid = document.createElement('div'); grid.className = 'grid';
  const box = document.createElement('div'); box.appendChild(row); grid.appendChild(box);
  (c.querySelector(':scope > details') || c).appendChild(grid);
}
</script>`;

const shell = (inner: string, signedIn: boolean) =>
  `<shreddit-app${signedIn ? ' user-logged-in="true"' : ''}>${signedIn ? '<after-login-toast-dispatcher username="me_the_reader"></after-login-toast-dispatcher>' : ''}<div class="grid-container"><div id="left-sidebar-container">nav</div><div id="subgrid-container">` +
  `<div class="main-container"><main id="main-content">${inner}</main>` +
  `<div id="right-sidebar-container"><aside>sidebar</aside></div></div></div></div></shreddit-app>`;

const listing = (signedIn = true, extra = '') =>
  htmlDoc(
    shell(
      `${SORT}<shreddit-feed>${POSTS.slice(0, 3).map(postHtml).join('')}</shreddit-feed>`,
      signedIn,
    ) +
      extra +
      POST_SCRIPT,
    '<style>shreddit-post { display: block }</style>',
  );
const thread = (signedIn = true, author?: string) =>
  htmlDoc(
    shell(
      postHtml(POSTS[0]!).replace(/^<article>|<\/article>$/g, '') +
        nestedCommentsHtml(threadComments(author), false, true),
      signedIn,
    ) +
      POST_SCRIPT +
      COMMENT_SCRIPT,
  );
const profile = () =>
  htmlDoc(
    `<shreddit-app><main id="main-content"><shreddit-profile-comment></shreddit-profile-comment></main></shreddit-app>`,
  );

let pages: Record<string, string> = {};
test.beforeEach(async () => {
  ctx = await launchWithExtension();
  pages = {
    [LISTING]: listing(),
    [THREAD]: thread(),
    [MY_THREAD]: thread(true, 'me_the_reader'),
    [PROFILE]: profile(),
  };
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) => {
    const body = pages[route.request().url().split('#')[0]!];
    return body
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
      : route.abort();
  });
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };

async function configure(options: Record<string, unknown> | null) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules: options ? { oldRedditSkin: { enabled: true, options } } : {} },
  );
}

async function open(url: string, options: Record<string, unknown> | null): Promise<Page> {
  await configure(options);
  const page = await ctx.newPage();
  await page.goto(url);
  await waitForRescue(page);
  return page;
}

const skin = (page: Page) => page.locator('html').getAttribute('data-rescue-skin');
const post = (page: Page, n = 0) => page.locator('shreddit-post').nth(n);
const clicks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __clicks: string[] }).__clicks);

/** Is `el` what a click at its centre would reach (not covered by Reddit's full-card link)? */
const reachable = (el: import('@playwright/test').Locator) =>
  el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const root = node.getRootNode() as Document | ShadowRoot;
    const top = root.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return top === node || node.contains(top);
  });

test('is off by default: no attribute, no stylesheet, no REScue rows, Reddit’s own layout', async () => {
  const page = await open(LISTING, null);
  expect(await skin(page)).toBeNull();
  await expect(page.locator('#rescue-old-skin')).toHaveCount(0);
  await expect(page.locator('.rescue-ovote, .rescue-obody, .rescue-otabs')).toHaveCount(0);
  expect(await post(page).evaluate((e) => getComputedStyle(e).display)).not.toBe('grid');
});

test('on: a feed row is the old row: rank, vote column, title line, tagline, flat links', async () => {
  const page = await open(LISTING, {});
  await expect(page.locator('html')).toHaveAttribute('data-rescue-skin', 'old');
  await page.setViewportSize({ width: 1280, height: 900 });
  const p = post(page);
  await expect(p).toHaveAttribute('data-rescue-ov', '1');
  expect(await p.evaluate((e) => getComputedStyle(e).display)).toBe('grid');
  expect(await p.evaluate((e) => getComputedStyle(e, '::before').content)).toBe('counter(osrank)');
  await expect(page.locator('#left-sidebar-container')).toBeHidden();
  await expect(p.locator('.rescue-otitle')).toHaveText(POSTS[0]!.title!);
  expect(await p.locator('.rescue-otitle').evaluate((e) => getComputedStyle(e).color)).toBe(
    'rgb(0, 0, 255)',
  );
  await expect(p.locator('.rescue-otag')).toContainText(/^submitted .+ by rockpaperblr/);
  await expect(p.locator('.rescue-olinks')).toContainText('comments');
  for (const word of ['share', 'save', 'hide', 'report']) {
    await expect(p.locator('.rescue-olinks').getByText(word, { exact: true })).toBeVisible();
  }
  await expect(p.locator('.rescue-olinks')).not.toContainText('embed');
  await expect(p.locator('.rescue-olinks')).not.toContainText('crosspost');
  // The vote column sits left of the body, and Reddit's own action row is parked below the post.
  const col = await p.locator('.rescue-ovote').boundingBox();
  const body = await p.locator('.rescue-obody').boundingBox();
  expect(col!.x).toBeLessThan(body!.x);
  const hostBox = await p.boundingBox();
  const parked = await p.locator('#row').boundingBox();
  expect(parked!.y).toBeGreaterThanOrEqual(hostBox!.y + hostBox!.height - 1);
  // REScue's own controls are reachable above Reddit's full-card link.
  expect(await reachable(p.locator('.rescue-oup'))).toBe(true);
  expect(await reachable(p.locator('.rescue-ocomments'))).toBe(true);
  await expect(page.locator('#rescue-gear')).toBeVisible();
});

test('the tagline keeps REScue’s tag / ignore buttons right after the author', async () => {
  const page = await open(LISTING, {});
  const tag = post(page).locator('.rescue-otag');
  await expect(tag.locator('.rescue-oauthor + *')).toBeVisible();
  const kinds = await tag.locator('.rescue-btn').count();
  expect(kinds).toBeGreaterThan(0);
  for (let i = 0; i < kinds; i++)
    expect(await reachable(tag.locator('.rescue-btn').nth(i))).toBe(true);
});

test('dark: follows Reddit’s dark mode with the dark classic palette', async () => {
  const page = await open(LISTING, {});
  await page.evaluate(() => document.documentElement.classList.add('theme-dark'));
  await expect(page.locator('html')).toHaveAttribute('data-rescue-theme', 'dark');
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(0, 0, 0)');
});

test('the vote column votes through Reddit’s own buttons and shows what they show', async () => {
  const page = await open(LISTING, {});
  const p = post(page);
  const score = p.locator('.rescue-onum');
  await expect(score).toHaveText('8479');
  await p.locator('.rescue-oup').click();
  await expect.poll(() => clicks(page)).toContain(`${POSTS[0]!.id}:vote-up-on`);
  await expect(p.locator('.rescue-ovote')).toHaveAttribute('data-vote', 'up');
  await expect(score).toHaveText('8480'); // moved by the confirmed vote; the page's number is stale
  expect(
    await p.evaluate((e) =>
      e.shadowRoot!.querySelector('button[upvote]')!.getAttribute('aria-pressed'),
    ),
  ).toBe('true');
  await p.locator('.rescue-oup').click(); // the same arrow clears it
  await expect.poll(() => clicks(page)).toContain(`${POSTS[0]!.id}:vote-up-off`);
  await expect(score).toHaveText('8479');
  await p.locator('.rescue-odown').click();
  await expect(p.locator('.rescue-ovote')).toHaveAttribute('data-vote', 'down');
  await expect(score).toHaveText('8478');
  // A vote cast by Reddit's own button (or a key) shows too.
  await p.evaluate((e) => (e.shadowRoot!.querySelector('button[upvote]') as HTMLElement).click());
  await expect(p.locator('.rescue-ovote')).toHaveAttribute('data-vote', 'up');
});

test('signed out: the arrows say to sign in and press nothing', async () => {
  pages[LISTING] = listing(false);
  const page = await open(LISTING, {});
  await post(page).locator('.rescue-oup').click();
  await expect(page.getByText('Sign in to vote.')).toBeVisible();
  expect(await clicks(page)).toEqual([]);
});

test('the flat links act through Reddit’s own controls: share, save, report, hide, comments', async () => {
  const page = await open(LISTING, {});
  const p = post(page);
  const links = p.locator('.rescue-olinks');
  await links.getByText('share', { exact: true }).click();
  await expect.poll(() => clicks(page)).toContain(`${POSTS[0]!.id}:share`);
  await links.getByText('save', { exact: true }).click();
  await expect.poll(() => clicks(page)).toContain(`${POSTS[0]!.id}:item-Save`);
  await expect(links.getByText('unsave', { exact: true })).toBeVisible();
  await links.getByText('report', { exact: true }).click();
  await expect.poll(() => clicks(page)).toContain(`${POSTS[0]!.id}:item-Report`);
  await p.locator('.rescue-ocomments').click(); // goes through Reddit's own full-card link
  await expect.poll(() => clicks(page)).toContain(`${POSTS[0]!.id}:open`);
  await links.getByText('hide', { exact: true }).click();
  await expect(page.locator(`shreddit-post#${POSTS[0]!.id}`)).toHaveCount(0);
  expect(await clicks(page)).toContain(`${POSTS[0]!.id}:item-Hide`);
});

test('a post without readable vote buttons keeps Reddit’s own look and controls', async () => {
  pages[LISTING] = listing().replace('<shreddit-post ', '<shreddit-post data-novote="" ');
  const page = await open(LISTING, {});
  await expect(post(page, 0)).not.toHaveAttribute('data-rescue-ov', '1');
  await expect(post(page, 0).locator('.rescue-ovote')).toHaveCount(0);
  expect(await post(page, 0).evaluate((e) => getComputedStyle(e).display)).not.toBe('grid');
  await expect(post(page, 1)).toHaveAttribute('data-rescue-ov', '1'); // the others are unaffected
});

test('sort tabs link to the listing’s sort URLs and stand in for Reddit’s dropdown', async () => {
  const page = await open(LISTING, {});
  const tabs = page.locator('.rescue-otabs a');
  await expect(tabs).toHaveText(['best', 'hot', 'new', 'rising', 'controversial', 'top']);
  const hrefs = await tabs.evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  expect(hrefs).toEqual([
    '/r/science/best/',
    '/r/science/hot/',
    '/r/science/new/',
    '/r/science/rising/',
    '/r/science/controversial/',
    '/r/science/top/',
  ]);
  await expect(page.locator('.rescue-otab.rescue-oon')).toHaveText('best');
  await expect(page.locator('shreddit-sort-dropdown')).toBeHidden();
  await expect(page.locator('.rescue-otabs')).toBeVisible();
});

test('on a thread: the post and every comment get the vote column and flat links', async () => {
  const page = await open(THREAD, {});
  await page.setViewportSize({ width: 1280, height: 900 });
  const first = page.locator('shreddit-comment[thingid="t1_c11"]');
  await expect(first).toHaveAttribute('data-rescue-ov', '1');
  await expect(post(page)).toHaveAttribute('data-rescue-ov', '1');
  await expect(post(page).locator('.rescue-olinks')).toContainText('comments');
  await expect(first.locator('.rescue-ovote').first()).toBeVisible();
  await expect(first.locator('.rescue-opts').first()).toContainText(/points|score/);
  const row = first.locator('.rescue-ocl').first();
  for (const word of ['permalink', 'save', 'report', 'reply']) {
    await expect(row.getByText(word, { exact: true })).toBeVisible();
  }
  await expect(row).not.toContainText('embed');
  // Reddit's own comment action row is still in the page, but not seen.
  const own = first.locator('shreddit-comment-action-row').first().locator('xpath=..'); // Reddit's row box
  const box = await own.boundingBox();
  expect(!box || box.width <= 1 || box.height <= 1).toBe(true);
});

test('comment votes, save, report and reply go through Reddit’s own comment controls', async () => {
  const page = await open(THREAD, {});
  const first = page.locator('shreddit-comment[thingid="t1_c11"]');
  await first.locator(':scope > .rescue-ovote .rescue-oup').click();
  await expect.poll(() => clicks(page)).toContain('t1_c11:vote-up-on');
  await expect(first.locator(':scope > .rescue-ovote')).toHaveAttribute('data-vote', 'up');
  const row = first.locator('.rescue-ocl').first();
  await row.getByText('save', { exact: true }).click();
  await expect.poll(() => clicks(page)).toContain('t1_c11:item-Save');
  await row.getByText('report', { exact: true }).click();
  await expect.poll(() => clicks(page)).toContain('t1_c11:item-Report');
  await row.getByText('reply', { exact: true }).click();
  await expect.poll(() => clicks(page)).toContain('t1_c11:reply');
});

test('on a profile the look does not apply; leaving a feed for a profile takes it off live', async () => {
  const prof = await open(PROFILE, {});
  expect(await skin(prof)).toBeNull();
  await expect(prof.locator('#rescue-old-skin')).toHaveCount(1); // injected, but inert without the attribute
  const page = await open(LISTING, {});
  await expect(page.locator('html')).toHaveAttribute('data-rescue-skin', 'old');
  await expect(post(page)).toHaveAttribute('data-rescue-ov', '1');
  await page.evaluate(() => history.pushState({}, '', '/user/alice/'));
  await expect(page.locator('html')).not.toHaveAttribute('data-rescue-skin', 'old');
  await expect(page.locator('.rescue-ovote')).toHaveCount(0);
  await page.evaluate(() => history.pushState({}, '', '/r/science/comments/abc/x/'));
  await expect(page.locator('html')).toHaveAttribute('data-rescue-skin', 'old');
  await expect(post(page)).toHaveAttribute('data-rescue-ov', '1');
});

test('the REScue menu switch turns it all on and off live; off leaves nothing of REScue’s rows', async () => {
  const page = await open(LISTING, null);
  expect(await skin(page)).toBeNull();
  await page.locator('#rescue-gear').click();
  const row = page.locator('#rescue-menu [data-menu-id="quick:oldLook"]');
  await expect(row).toContainText('Old Reddit look');
  await row.click();
  await expect(page.locator('html')).toHaveAttribute('data-rescue-skin', 'old');
  await expect(post(page)).toHaveAttribute('data-rescue-ov', '1');
  expect(await post(page).evaluate((e) => getComputedStyle(e).display)).toBe('grid');
  await expect(page.locator('.rescue-otabs')).toBeVisible();
  await row.click();
  await expect(page.locator('html')).not.toHaveAttribute('data-rescue-skin', 'old');
  await expect(page.locator('#rescue-old-skin')).toHaveCount(0);
  await expect(
    page.locator('.rescue-ovote, .rescue-obody, .rescue-oth, .rescue-otabs'),
  ).toHaveCount(0);
  await expect(page.locator('[data-rescue-ov], [data-rescue-tabs]')).toHaveCount(0);
  await expect(page.locator('shreddit-sort-dropdown')).toBeVisible();
  expect(await post(page).evaluate((e) => getComputedStyle(e).display)).not.toBe('grid');
  // Reddit's own vote button is back in a visible place.
  const own = await post(page).locator('#vote').boundingBox();
  expect(own && own.width > 0).toBe(true);
});

test('turning it off on a thread restores Reddit’s comment action row', async () => {
  const page = await open(THREAD, {});
  const first = page.locator('shreddit-comment[thingid="t1_c11"]');
  await expect(first).toHaveAttribute('data-rescue-ov', '1');
  await page.locator('#rescue-gear').click();
  await page.locator('#rescue-menu [data-menu-id="quick:oldLook"]').click();
  await expect(first).not.toHaveAttribute('data-rescue-ov', '1');
  await expect(page.locator('.rescue-ovote, .rescue-ocl, .rescue-opts')).toHaveCount(0);
  const own = await first
    .locator('shreddit-comment-action-row')
    .first()
    .locator('xpath=..')
    .boundingBox();
  expect(own === null || own.width > 1).toBe(true);
});

test('options apply: no thumbnail column and no rank numbers', async () => {
  const page = await open(LISTING, { thumbnails: 'none', rankNumbers: false });
  await expect(page.locator('html')).toHaveAttribute('data-rescue-skin', 'old');
  const cols = await post(page).evaluate((e) => getComputedStyle(e).gridTemplateColumns);
  expect(cols.startsWith('0px 58px 0px')).toBe(true);
  expect(await post(page).evaluate((e) => getComputedStyle(e, '::before').content)).toBe('""');
});

test('your own comments get edit, inbox replies and delete, pressing Reddit’s own menu rows', async () => {
  const page = await open(MY_THREAD, {});
  // One of the reader's comments with no replies, so its link row is the only one inside it.
  const mine = page
    .locator('shreddit-comment[author="me_the_reader"]:not(:has(shreddit-comment))')
    .first();
  const theirs = page
    .locator('shreddit-comment:not([author="me_the_reader"]):not(:has(shreddit-comment))')
    .first();
  await expect(mine).toHaveAttribute('data-rescue-ov', '1');
  const row = mine.locator('.rescue-ocl').first();
  for (const word of ['edit', 'disable inbox replies', 'delete']) {
    await expect(row.getByText(word, { exact: true })).toBeVisible();
  }
  await expect(theirs.locator('.rescue-ocl').first()).not.toContainText('inbox');
  await expect(theirs.locator('.rescue-ocl').first()).not.toContainText('delete');
  const id = await mine.getAttribute('thingid');
  await row.getByText('disable inbox replies', { exact: true }).click();
  await expect.poll(() => clicks(page)).toContain(`${id}:item-Disable inbox replies`);
  await expect(row.getByText('enable inbox replies', { exact: true })).toBeVisible();
  await row.getByText('delete', { exact: true }).click();
  await expect.poll(() => clicks(page)).toContain(`${id}:item-Delete`);
});
