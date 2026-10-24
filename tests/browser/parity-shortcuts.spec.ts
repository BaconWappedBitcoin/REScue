import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc } from './harness';
import { listingHtml, sessionHtml } from '../fixtures/pages';

// UI parity batch 5a: the shortcut bar is managed in the bar itself (edit, add, drag to reorder,
// delete, sort, group menu, scroll arrows, more static links, add/remove toggle). Every change is
// written to the same `subreddits` table option the settings console edits.
const LISTING = 'https://www.reddit.com/r/programming/';
const ME = 'rockpaperblr';

let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const body = htmlDoc(sessionHtml(true, ME) + listingHtml());
  await ctx.route(/^https:\/\/(www|sh)\.reddit\.com\//, (route) =>
    route.request().url().split('#')[0] === LISTING
      ? route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
      : route.abort(),
  );
});
test.afterEach(async () => {
  await ctx.close();
});

type Row = { target: string; label?: string; addedAt?: number };
type Area = {
  chrome: {
    storage: {
      local: {
        set(v: object): Promise<void>;
        get(k: string): Promise<Record<string, unknown>>;
      };
    };
  };
};

const worker = async () => ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));

const dated = (...targets: string[]): Row[] =>
  targets.map((target, i) => ({ target, label: '', addedAt: 1000 + i }));

async function configure(options: Record<string, unknown>) {
  const sw = await worker();
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    {
      modules: {
        subredditManager: { enabled: true, options: { showDefaults: false, ...options } },
      },
    },
  );
}

async function stored(): Promise<Row[]> {
  const sw = await worker();
  return sw.evaluate(async () => {
    const got = await (globalThis as unknown as Area).chrome.storage.local.get('settings');
    const s = got.settings as {
      modules?: { subredditManager?: { options?: { subreddits?: unknown[] } } };
    };
    return (s?.modules?.subredditManager?.options?.subreddits ?? []) as never;
  });
}

const targets = async () => (await stored()).map((r) => r.target);
const bar = (page: Page) => page.locator('#rescue-subreddit-bar');
const links = (page: Page) => bar(page).locator('.rescue-sc a');
const popup = (page: Page) => page.locator('#rescue-shortcut-popup');
const item = (page: Page, i: number) => bar(page).locator(`.rescue-sc[data-index="${i}"]`);

async function open(rows: Row[], extra: Record<string, unknown> = {}): Promise<Page> {
  await configure({ subreddits: rows, ...extra });
  const page = await ctx.newPage();
  await page.goto(LISTING);
  await expect(bar(page)).toBeVisible();
  return page;
}

async function dragTo(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 8, a.y + a.height / 2 + 4, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('the hover edit control opens a popup that renames a shortcut, saved live and kept on reload', async () => {
  const page = await open(dated('askscience', 'aww', 'pics'));
  await expect(links(page)).toHaveText(['askscience', 'aww', 'pics']);

  await item(page, 1).hover();
  await item(page, 1).locator('.rescue-sc-edit').click();
  await expect(popup(page)).toBeVisible();
  await expect(popup(page).locator('input[name="target"]')).toHaveValue('aww');
  await popup(page).locator('input[name="target"]').fill('r/cats');
  await popup(page).locator('input[name="label"]').fill('Cats!');
  await popup(page).getByRole('button', { name: 'Save' }).click();

  await expect(popup(page)).toHaveCount(0);
  await expect(links(page)).toHaveText(['askscience', 'Cats!', 'pics']);
  await expect(links(page).nth(1)).toHaveAttribute('href', '/r/cats/');
  await expect.poll(targets).toEqual(['askscience', 'r/cats', 'pics']);
  expect((await stored())[1]).toMatchObject({ label: 'Cats!', addedAt: 1001 });

  await page.reload();
  await expect(links(page)).toHaveText(['askscience', 'Cats!', 'pics']);
});

test('right-click opens the editor, and a bad address is refused in the popup', async () => {
  const page = await open(dated('aww'));
  await links(page).first().click({ button: 'right' });
  await expect(popup(page)).toBeVisible();
  await popup(page).locator('input[name="target"]').fill('https://evil.example');
  await popup(page).getByRole('button', { name: 'Save' }).click();
  await expect(popup(page).getByRole('alert')).toContainText('subreddit name');
  expect(await targets()).toEqual(['aww']);
  await popup(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(popup(page)).toHaveCount(0);
});

test('the + control adds a new shortcut through the same popup', async () => {
  const page = await open(dated('aww'));
  await bar(page).getByRole('button', { name: 'Add a shortcut' }).click();
  await expect(popup(page).locator('input[name="target"]')).toHaveValue('');
  await expect(popup(page).getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await popup(page).locator('input[name="target"]').fill('pics+cats');
  await popup(page).locator('input[name="label"]').fill('Pets');
  await popup(page).getByRole('button', { name: 'Save' }).click();

  await expect(links(page)).toHaveText(['aww', 'Pets']);
  await expect.poll(targets).toEqual(['aww', 'pics+cats']);
  const added = (await stored())[1]!;
  expect(added.label).toBe('Pets');
  expect(typeof added.addedAt).toBe('number');
});

test('dragging a link reorders the bar and the stored list', async () => {
  const page = await open(dated('aa', 'bb', 'cc'));
  await dragTo(page, item(page, 0), item(page, 2));
  await expect(links(page)).toHaveText(['bb', 'cc', 'aa']);
  await expect.poll(targets).toEqual(['bb', 'cc', 'aa']);
});

test('Alt+arrow moves the focused link and keeps the focus on it', async () => {
  const page = await open(dated('aa', 'bb', 'cc'));
  await links(page).nth(0).focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(links(page)).toHaveText(['bb', 'aa', 'cc']);
  await expect(links(page).nth(1)).toBeFocused();
  await page.keyboard.press('Alt+ArrowRight');
  await expect(links(page)).toHaveText(['bb', 'cc', 'aa']);
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(links(page)).toHaveText(['bb', 'aa', 'cc']);
  await expect.poll(targets).toEqual(['bb', 'aa', 'cc']);
});

test('dragging onto the delete zone removes a shortcut; the editor popup can too', async () => {
  const page = await open(dated('aa', 'bb', 'cc'));
  const trash = bar(page).locator('[data-rescue-trash]');
  await expect(trash).toBeHidden();

  const from = (await item(page, 1).boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y - 4, { steps: 3 });
  await expect(trash).toBeVisible(); // shown only while dragging
  const t = (await trash.boundingBox())!;
  await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(links(page)).toHaveText(['aa', 'cc']);
  await expect(trash).toBeHidden();
  await expect.poll(targets).toEqual(['aa', 'cc']);

  await item(page, 0).hover();
  await item(page, 0).locator('.rescue-sc-edit').click();
  await popup(page).getByRole('button', { name: 'Delete' }).click();
  await expect(links(page)).toHaveText(['cc']);
  await expect.poll(targets).toEqual(['cc']);
});

test('the + r/name button on a subreddit page is a toggle', async () => {
  const page = await open(dated('aww'));
  const toggle = bar(page).locator('[data-rescue-toggle]');
  await expect(toggle).toHaveText('+shortcut');
  await toggle.click();
  await expect(links(page)).toHaveText(['aww', 'programming']);
  await expect(toggle).toHaveText('−shortcut');
  await expect.poll(targets).toEqual(['aww', 'r/programming']);

  await toggle.click();
  await expect(links(page)).toHaveText(['aww']);
  await expect(toggle).toHaveText('+shortcut');
  await expect.poll(targets).toEqual(['aww']);
});

test('the sort menu orders by name either way, or by date added', async () => {
  const page = await open([
    { target: 'cc', label: '', addedAt: 5 },
    { target: 'aa', label: '', addedAt: 9 },
    { target: 'bb', label: '', addedAt: 1 },
  ]);
  const sort = async (name: string) => {
    await bar(page).getByRole('button', { name: 'Sort shortcuts' }).click();
    await bar(page).getByRole('menuitem', { name }).click();
  };
  await sort('Name A–Z');
  await expect(links(page)).toHaveText(['aa', 'bb', 'cc']);
  await sort('Name Z–A');
  await expect(links(page)).toHaveText(['cc', 'bb', 'aa']);
  await sort('Date added');
  await expect(links(page)).toHaveText(['bb', 'cc', 'aa']);
  await expect.poll(targets).toEqual(['bb', 'cc', 'aa']);
});

test('rows saved before there were dates get one, and stay in order', async () => {
  const page = await open([{ target: 'aa' }, { target: 'bb' }]);
  await expect(links(page)).toHaveText(['aa', 'bb']);
  await expect
    .poll(async () => (await stored()).every((r) => typeof r.addedAt === 'number'))
    .toBe(true);
  expect(await targets()).toEqual(['aa', 'bb']);
});

test('a group link lists its subreddits when hovered', async () => {
  const page = await open(dated('pics+aww+cats'));
  const menu = bar(page).locator(
    '.rescue-sc-menu[role="menu"]:not([data-rescue-sort-menu]):not([data-rescue-mail-menu]):not([data-rescue-feeds-menu]):not([data-rescue-feed-sections])',
  );
  await expect(menu).toBeHidden();
  await links(page).first().hover();
  await expect(menu.locator('a')).toHaveText(['r/pics', 'r/aww', 'r/cats']);
  await expect(menu.locator('a').nth(1)).toHaveAttribute('href', '/r/aww/');
  await page.mouse.move(600, 100);
  await expect(menu).toBeHidden();
});

test('the optional static links are shown, with Saved from the signed-in name', async () => {
  const page = await open(dated('aww'), {
    showDefaults: true,
    linkRandom: true,
    linkFriends: true,
    linkMod: true,
    linkModqueue: true,
    linkSaved: true,
  });
  const statics = bar(page).locator('.rescue-sc-viewport > a');
  await expect(statics).toHaveText([
    'Home',
    'popular',
    'Random',
    'Friends',
    'Mod',
    'Modqueue',
    'Saved',
  ]);
  await expect(statics.nth(2)).toHaveAttribute('href', '/r/random/');
  await expect(statics.nth(5)).toHaveAttribute('href', '/r/mod/about/modqueue/');
  await expect(statics.nth(6)).toHaveAttribute('href', `/user/${ME}/saved/`);
});

test('scroll arrows appear when the bar overflows and scroll it', async () => {
  const many = dated(...Array.from({ length: 40 }, (_, i) => `subreddit${i}`));
  const page = await open(many);
  const left = bar(page).locator('[data-dir="left"]');
  const right = bar(page).locator('[data-dir="right"]');
  await expect(right).toBeVisible();
  await expect(left).toBeHidden();
  await right.click();
  await expect(left).toBeVisible();
  const scrolled = await bar(page)
    .locator('.rescue-sc-viewport')
    .evaluate((el) => el.scrollLeft);
  expect(scrolled).toBeGreaterThan(0);
  // The bar stays at the bottom-left and does not grow past its limit.
  const box = (await bar(page).boundingBox())!;
  expect(box.x).toBeLessThan(300); // clear of Reddit's left navigation
  expect(box.width).toBeLessThan(760); // 720 plus padding
});

test('turning the module off in the console removes the bar', async () => {
  const page = await open(dated('aww'));
  await page.locator('#rescue-gear').click();
  await page.locator('#rescue-menu [data-menu-id="settings"]').click();
  await page
    .locator('#rescue-settings')
    .getByRole('button', { name: 'Subreddits', exact: true })
    .click();
  await page.locator('#rescue-settings [data-module-link="subredditManager"]').click();
  await page.locator('#rescue-settings [data-module-toggle="subredditManager"]').uncheck();
  await expect(bar(page)).toHaveCount(0);
});

test('at 820px wide the bar and its menus stay inside the viewport, and a drag to the last visible link reorders', async () => {
  const names = Array.from(
    { length: 24 },
    (_, i) => `sub${String.fromCharCode(97 + (i % 26))}${i}`,
  );
  await configure({ subreddits: dated(...names, 'pics+aww+cats') });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 805, height: 900 });
  await page.goto(LISTING);
  await expect(bar(page)).toBeVisible();
  const inside = async (loc: Locator) => {
    const b = (await loc.boundingBox())!;
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(vw);
  };
  await inside(bar(page));

  // Drag the first link onto the last one that is fully visible in the scrolling strip.
  const strip = (await bar(page).locator('.rescue-sc-viewport').boundingBox())!;
  const count = await bar(page).locator('.rescue-sc').count();
  let last = 0;
  for (let i = 0; i < count; i++) {
    const b = await item(page, i).boundingBox();
    if (b && b.x + b.width <= strip.x + strip.width) last = i;
  }
  expect(last).toBeGreaterThan(2);
  await dragTo(page, item(page, 0), item(page, last));
  await expect.poll(async () => (await targets())[last]).toBe(names[0]);

  // The group menu of a link at the strip's right end is clamped into the viewport.
  await bar(page)
    .locator('.rescue-sc-viewport')
    .evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await links(page).last().hover();
  const menu = bar(page).locator(
    '.rescue-sc-menu[role="menu"]:not([data-rescue-sort-menu]):not([data-rescue-mail-menu]):not([data-rescue-feeds-menu]):not([data-rescue-feed-sections])',
  );
  await expect(menu).toBeVisible();
  await inside(menu);
  await inside(bar(page));
});
