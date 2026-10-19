import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, htmlDoc, menuClick, menuRowText, openRescueMenu } from './harness';
import { listingHtml, nestedThreadHtml, threadComments } from '../fixtures/pages';

// UI polish: a minimal corner strip, the menu that holds the moved tools, a navigator that is
// closed until opened, REScue following Reddit's light or dark class, popups that stay on screen,
// and the reason-chip wording.
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
const LISTING = 'https://www.reddit.com/r/programming/';

let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  const pages: Record<string, string> = {
    [THREAD]: htmlDoc(nestedThreadHtml(threadComments(), false, true)),
    [LISTING]: htmlDoc(listingHtml()),
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

type Chrome = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };
async function seed(items: Record<string, unknown>) {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Chrome).chrome.storage.local.set(v),
    items,
  );
}
async function configure(modules: Record<string, Record<string, unknown>>) {
  await seed({
    settings: {
      modules: Object.fromEntries(
        Object.entries(modules).map(([id, options]) => [id, { enabled: true, options }]),
      ),
    },
  });
}

/** Relative luminance (0 dark .. 1 light) of the element's own opaque background colour. */
async function luminanceOf(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = sel.startsWith('shadow:')
      ? document.getElementById('rescue-settings')!.shadowRoot!.querySelector(sel.slice(7))!
      : document.querySelector(sel)!;
    const m = getComputedStyle(el)
      .backgroundColor.match(/[\d.]+/g)!
      .map(Number);
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(m[0]!) + 0.7152 * lin(m[1]!) + 0.0722 * lin(m[2]!);
  }, selector);
}

/** WCAG contrast of an element's text colour against the opaque colour `bg` (an rgb() string). */
async function contrastOf(page: Page, selector: string, bg?: string): Promise<number> {
  return page.evaluate(
    ([sel, back]) => {
      const lum = (css: string) => {
        const m = css.match(/[\d.]+/g)!.map(Number);
        const lin = (v: number) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * lin(m[0]!) + 0.7152 * lin(m[1]!) + 0.0722 * lin(m[2]!);
      };
      const el = document.querySelector(sel!)!;
      const fg = lum(getComputedStyle(el).color);
      const bgc = lum(back || getComputedStyle(el).backgroundColor);
      return (Math.max(fg, bgc) + 0.05) / (Math.min(fg, bgc) + 0.05);
    },
    [selector, bg] as const,
  );
}

/** Is the topmost thing at the element's centre the element itself (or inside it)? */
async function reachable(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (el === top || el.contains(top));
  }, selector);
}

const inViewport = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const r = document.querySelector(sel)!.getBoundingClientRect();
    return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  }, selector);

test('the corner strip shows only the REScue button, on threads too', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  await expect(page.locator('#rescue-tools button:visible')).toHaveCount(1);
  for (const gone of [
    '.rescue-hide-all-replies',
    '.rescue-saved-opener',
    '.rescue-back-to-top',
    '.rescue-filter-sub-toggle',
  ])
    await expect(page.locator(`#rescue-tools ${gone}`)).toHaveCount(0);
  await expect(page.locator('.rescue-comment-nav')).toBeHidden();
});

test('the menu holds the moved tools with hover text, and they work', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  await openRescueMenu(page);
  for (const id of ['hideAllReplies', 'savedComments', 'backToTop', 'commentNavigator']) {
    const row = page.locator(`#rescue-menu [data-menu-id="${id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('title', /^REScue: .{12,}/);
  }
  await page.keyboard.press('Escape');

  await menuClick(page, 'hideAllReplies');
  await expect(page.locator('shreddit-comment[thingid="t1_c1"]')).toBeHidden();
  expect(await menuRowText(page, 'hideAllReplies')).toBe('Show all replies');
  await menuClick(page, 'hideAllReplies');
  await expect(page.locator('shreddit-comment[thingid="t1_c1"]')).toBeVisible();

  await menuClick(page, 'savedComments');
  await expect(page.locator('#rescue-saved-comments')).toBeVisible();
  expect(await inViewport(page, '#rescue-saved-comments')).toBe(true);
  expect(await reachable(page, '#rescue-gear')).toBe(true); // the list does not cover the button
  await page
    .locator('#rescue-saved-comments .rescue-saved-opener, #rescue-saved-comments button')
    .first()
    .click();

  await page.evaluate(() => window.scrollTo(0, 3000));
  await menuClick(page, 'backToTop');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('the comment navigator is closed until opened, compact, and clear of the button', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  const nav = page.locator('.rescue-comment-nav');
  await expect(page.locator('#rescue-gear')).toBeVisible();
  await expect(nav).toBeHidden();

  await menuClick(page, 'commentNavigator');
  await expect(nav).toBeVisible();
  const select = nav.locator('select');
  const size = (await select.boundingBox())!;
  expect(size.height).toBeLessThan(32); // a normal-size select, not an oversized one
  expect(size.width).toBeLessThan(200);
  const box = (await nav.boundingBox())!;
  expect(box.height).toBeLessThan(90);
  const gear = (await page.locator('#rescue-gear').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(gear.y); // docked above the REScue button
  expect(await reachable(page, '#rescue-gear')).toBe(true);
  expect(await inViewport(page, '.rescue-comment-nav')).toBe(true);

  await nav.locator('.rescue-nav-close').click();
  await expect(nav).toBeHidden();
  await page.keyboard.press('Shift+N');
  await expect(nav).toBeVisible();
  await page.keyboard.press('Shift+N');
  await expect(nav).toBeHidden();
});

test('notices stack above the button instead of covering it or the navigator', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await menuClick(page, 'commentNavigator');
  await page.locator('.rescue-save-comment').first().click(); // first save shows an explainer notice
  await expect(
    page.locator('#rescue-notices [data-rescue-notice="saveRES-explainer"]'),
  ).toBeVisible();
  expect(await reachable(page, '#rescue-gear')).toBe(true);
  expect(await reachable(page, '.rescue-comment-nav select')).toBe(true);
  expect(await reachable(page, '.rescue-nav-next')).toBe(true);
});

test('REScue follows the page’s theme class, live, on every surface', async () => {
  const page = await ctx.newPage();
  await page.goto(`${LISTING}#rescue:settings/filteReddit`);
  await expect(page.locator('#rescue-settings [data-option="filteReddit.rules"]')).toBeVisible();
  const html = page.locator('html');

  // Light first (the OS may be dark: the page decides).
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => {
    document.documentElement.style.colorScheme = 'light'; // what Reddit's own CSS computes
    document.documentElement.className = 'theme-beta';
  });
  await expect(html).toHaveAttribute('data-rescue-theme', 'light');
  expect(await luminanceOf(page, 'shadow:.console')).toBeGreaterThan(0.8);

  await page.evaluate(() => {
    document.documentElement.style.colorScheme = 'dark';
    document.documentElement.classList.add('theme-dark');
  });
  await expect(html).toHaveAttribute('data-rescue-theme', 'dark');
  expect(await luminanceOf(page, 'shadow:.console')).toBeLessThan(0.05);
  await page.locator('#rescue-settings .close').click();
  await expect(page.locator('#rescue-settings')).toHaveCount(0);

  await openRescueMenu(page);
  expect(await luminanceOf(page, '#rescue-menu')).toBeLessThan(0.05);
  expect(await contrastOf(page, '#rescue-menu')).toBeGreaterThanOrEqual(4.5);
  await page.keyboard.press('Escape');

  // A popup opened while dark, then switched to light underneath it.
  await page.locator('.rescue-tag-btn').first().click();
  await expect(page.locator('.rescue-tag-editor')).toBeVisible();
  expect(await luminanceOf(page, '.rescue-tag-editor')).toBeLessThan(0.05);
  await page.evaluate(() => {
    document.documentElement.style.colorScheme = 'light';
    document.documentElement.classList.remove('theme-dark');
  });
  await expect(html).toHaveAttribute('data-rescue-theme', 'light');
  expect(await luminanceOf(page, '.rescue-tag-editor')).toBeGreaterThan(0.8);
  expect(await contrastOf(page, '.rescue-tag-editor')).toBeGreaterThanOrEqual(4.5);
});

test('text meets 4.5:1 in both themes on the surfaces REScue draws itself', async () => {
  const page = await ctx.newPage();
  await page.goto(THREAD);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  for (const theme of ['theme-beta', 'theme-beta theme-dark']) {
    await page.evaluate((c) => (document.documentElement.className = c), theme);
    const dark = theme.includes('dark');
    // Reddit's own page background (the fixture has no Reddit CSS), for REScue text on the page.
    const pageBg = dark ? 'rgb(14, 17, 19)' : 'rgb(255, 255, 255)';
    await page.evaluate((bg) => (document.body.style.background = bg), pageBg);
    for (const sel of ['.rescue-hide-children', '.rescue-save-comment', '.rescue-show-parent']) {
      const first = page.locator(sel).first();
      if (await first.count())
        expect(await contrastOf(page, sel, pageBg), `${sel} ${theme}`).toBeGreaterThanOrEqual(4.5);
    }
    await menuClick(page, 'commentNavigator').catch(() => {});
    expect(
      await contrastOf(page, '.rescue-comment-nav'),
      `navigator ${theme}`,
    ).toBeGreaterThanOrEqual(4.5);
    await page.keyboard.press('Escape');
  }
});

test('the tag editor stays inside a short viewport, with Save reachable', async () => {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1100, height: 520 });
  await page.goto(LISTING);
  await expect(page.locator('.rescue-tag-btn').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 600));
  // The tag button lowest on screen: the editor cannot open downwards without running off it.
  const index = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.rescue-tag-btn')];
    let best = -1;
    let bottom = -1;
    buttons.forEach((b, i) => {
      const r = b.getBoundingClientRect();
      if (r.bottom < innerHeight - 4 && r.top > 0 && r.bottom > bottom) {
        bottom = r.bottom;
        best = i;
      }
    });
    return best;
  });
  expect(index).toBeGreaterThanOrEqual(0);
  await page.locator('.rescue-tag-btn').nth(index).click();
  const editor = page.locator('.rescue-tag-editor');
  await expect(editor).toBeVisible();
  expect(await inViewport(page, '.rescue-tag-editor')).toBe(true);
  await page.locator('.rescue-tag-editor .rescue-tag-save').scrollIntoViewIfNeeded();
  expect(await reachable(page, '.rescue-tag-editor .rescue-tag-save')).toBe(true);
  // “Color” is one word, and the labels are not squeezed.
  const label = (await page.locator('.rescue-tag-field span', { hasText: 'Color' }).boundingBox())!;
  expect(label.height).toBeLessThan(24);
  const input = (await page.locator('.rescue-tag-editor input[name=text]').boundingBox())!;
  expect(input.height).toBeLessThan(30);
});

test('filter reason chip wording; the tooltip is on the chip, not the whole post', async () => {
  await configure({
    filteReddit: {
      rules: [
        {
          type: 'keyword',
          pattern: 'gravity',
          scope: 'everywhere',
          subreddits: '',
          enabled: true,
          toggle: '',
        },
      ],
    },
  });
  const page = await ctx.newPage();
  await page.goto(LISTING);
  await page.locator('.rescue-filter-toggle').click();
  const article = page.locator('article:has(shreddit-post#t3_link1)');
  const chip = article.locator('.rescue-filter-reason');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/^Filtered: keyword/);
  await expect(chip).toHaveAttribute('title', /^REScue: .*filter rule/);
  await expect(article).not.toHaveAttribute('title', /.+/);
  await expect(article.locator('shreddit-post')).not.toHaveAttribute('title', /.+/);
});
