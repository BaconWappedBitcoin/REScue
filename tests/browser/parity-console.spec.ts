import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc } from './harness';
import { listingHtml } from '../fixtures/pages';

// UI parity batch 6: the settings console polish (advanced options, defaults and reset, option
// keys, table row order, About links, search highlighting).
const URL = 'https://www.reddit.com/r/programming/';
let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, URL, htmlDoc(listingHtml()));
});
test.afterEach(async () => {
  await ctx.close();
});

const consoleOf = (page: Page): Locator => page.locator('#rescue-settings');

/** Opens the console on a module's own page through its deep link. */
const openConsole = async (page: Page, moduleId: string): Promise<Locator> => {
  await page.goto(`${URL}#rescue:settings/${moduleId}`);
  const root = consoleOf(page);
  await expect(root.locator(`#mod-${moduleId}`)).toBeVisible();
  return root;
};

test('advanced options are hidden until the box is ticked, and the box is remembered', async () => {
  const root = await openConsole(await ctx.newPage(), 'showParent');
  const delay = root.locator('[data-option="showParent.hoverDelay"]');
  await expect(delay).toHaveCount(0);
  await expect(root.locator('[data-advanced-hidden="showParent"]')).toBeVisible();
  await root.locator('input[data-setting="showAdvanced"]').check();
  await expect(delay).toBeVisible();

  const again = await ctx.newPage();
  const root2 = await openConsole(again, 'showParent');
  await expect(root2.locator('input[data-setting="showAdvanced"]')).toBeChecked();
  await expect(root2.locator('[data-option="showParent.hoverDelay"]')).toBeVisible();
});

test('each option shows its default, offers reset when changed, and shows its key', async () => {
  const root = await openConsole(await ctx.newPage(), 'showParent');
  await root.locator('input[data-setting="showAdvanced"]').check();
  const key = 'showParent.hoverDelay';
  await expect(root.locator(`[data-default="${key}"]`)).toHaveText('default: 300');
  await expect(root.locator(`[data-key-copy="${key}"]`)).toHaveText(key);
  await expect(root.locator(`[data-reset="${key}"]`)).toHaveCount(0);

  const box = root.locator(`[data-option="${key}"]`);
  await box.fill('750');
  await box.blur();
  await expect(root.locator(`[data-reset="${key}"]`)).toBeVisible();
  await root.locator(`[data-reset="${key}"]`).click();
  await expect(box).toHaveValue('300');
  await expect(root.locator(`[data-reset="${key}"]`)).toHaveCount(0);
});

test('reset module to defaults asks first, then restores the module', async () => {
  const root = await openConsole(await ctx.newPage(), 'showParent');
  await root.locator('input[data-setting="showAdvanced"]').check();
  const box = root.locator('[data-option="showParent.hoverDelay"]');
  await box.fill('900');
  await box.blur();
  const page = root.page();
  let asked = 0;
  page.once('dialog', (d) => {
    asked++;
    void d.dismiss();
  });
  await root.locator('[data-reset-module="showParent"]').click();
  await expect(box).toHaveValue('900');
  page.once('dialog', (d) => {
    asked++;
    void d.accept();
  });
  await root.locator('[data-reset-module="showParent"]').click();
  await expect(box).toHaveValue('300');
  expect(asked).toBe(2);
});

test('table rows can be moved with the buttons and the keyboard', async () => {
  const root = await openConsole(await ctx.newPage(), 'filteReddit');
  const table = root.locator('[data-option="filteReddit.rules"]');
  await table.locator('button[data-action="add"]').click();
  await table.locator('button[data-action="add"]').click();
  const patterns = table.locator('tbody input[data-col="pattern"]');
  await patterns.nth(0).fill('first');
  await patterns.nth(0).blur();
  await patterns.nth(1).fill('second');
  await patterns.nth(1).blur();

  await table.locator('tbody tr').nth(0).locator('button[data-action="move-down"]').click();
  await expect(patterns.nth(0)).toHaveValue('second');
  await expect(patterns.nth(1)).toHaveValue('first');
  // Focus follows the moved row, so the keyboard user can keep going.
  await expect(
    table.locator('tbody tr').nth(1).locator('button[data-action^="move"]:focus'),
  ).toHaveCount(1);

  const handle = table.locator('tbody tr').nth(1).locator('button[data-action="drag"]');
  await handle.focus();
  await root.page().keyboard.press('Alt+ArrowUp');
  await expect(patterns.nth(0)).toHaveValue('first');
  await expect(patterns.nth(1)).toHaveValue('second');
});

test('About lists version, source, license, issue and privacy links', async () => {
  const root = await openConsole(await ctx.newPage(), 'about');
  const links = root.locator('[data-links="about"]');
  await expect(links).toContainText(/Version \d/);
  await expect(links.getByRole('link', { name: 'Source code' })).toHaveAttribute(
    'target',
    '_blank',
  );
  await expect(links.getByRole('link', { name: /GPL-3\.0/ })).toBeVisible();
  await expect(links.getByRole('link', { name: 'Report an issue' })).toBeVisible();
  await links.locator('summary').click();
  await expect(links.locator('pre')).toContainText('REScue Privacy Policy');
  // The donation addresses: plain text with a Copy button, never a link.
  const codes = links.locator('[data-copy-text]');
  await expect(codes).toHaveText([
    'bc1que3qguxlvg0gkp4yqn6dju82rvqq5rmdaylj27',
    '0x23c46670511FfF3497A11f3ebbcdAc244b91F794',
  ]);
  await expect(links.locator('a[href*="bc1"], a[href*="0x23c4"]')).toHaveCount(0);
  const copy = links.locator('.copy-btn').first();
  await copy.click();
  await expect(links.getByText(/^Copied$|Ctrl+C/).first()).toBeVisible();
});

test('search lists matching options grouped by module, and a result opens the option', async () => {
  const root = await openConsole(await ctx.newPage(), 'about');
  const search = root.locator('input.search');
  await expect(search).toHaveAttribute('placeholder', 'Search all settings');
  await search.fill('showParent.hover');
  const results = root.locator('[data-search-results]');
  const hit = results.locator('[data-result-option="showParent.hoverDelay"]');
  await expect(hit).toBeVisible();
  await expect(hit.locator('mark').first()).toHaveText('showParent.hover');
  await expect(results.locator('[data-result-module="showParent"]')).toBeVisible();

  await search.fill('before the parent comment appears');
  await expect(results.locator('[data-result-option="showParent.hoverDelay"]')).toBeVisible();

  // The option is advanced and advanced options are off: opening the result still shows it.
  await results.locator('[data-result-option="showParent.hoverDelay"]').click();
  const row = root.locator('[data-option-row="showParent.hoverDelay"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/match/);
  await expect(root.locator('[data-search-results]')).toHaveCount(0);
  await expect(root.locator('section.module')).toHaveCount(1);
});

test('the / key and Ctrl+F focus the search box, and a search field clears with Escape', async () => {
  const page = await ctx.newPage();
  const root = await openConsole(page, 'about');
  const search = root.locator('input.search');
  await root.locator('[data-category="core"]').focus();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
  await page.keyboard.type('hover');
  await expect(search).toHaveValue('hover');
  await expect(root.locator('[data-search-results]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect(root.locator('[data-search-results]')).toHaveCount(0);
  await root.locator('[data-category="core"]').focus();
  await page.keyboard.press('Control+f');
  await expect(search).toBeFocused();
  // Escape from a button (not a text field) closes the console.
  await root.locator('[data-category="core"]').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#rescue-settings')).toHaveCount(0);
});

test('categories expand to their modules and a module shows only its own page', async () => {
  const page = await ctx.newPage();
  const root = await openConsole(page, 'about');
  await root.locator('[data-category="users"]').click();
  await expect(root.locator('[data-overview="users"]')).toBeVisible();
  await expect(root.locator('[data-module-link="userTagger"]')).toBeVisible();
  await expect(root.locator('[data-module-link="about"]')).toHaveCount(0);
  await root.locator('[data-module-link="userTagger"]').click();
  await expect(root.locator('section.module')).toHaveCount(1);
  await expect(root.locator('#mod-userTagger')).toBeVisible();
  await expect(root.locator('[data-module-link="userTagger"] .pill')).toHaveText('on');
  await root.locator('[data-module-toggle="userTagger"]').uncheck();
  await expect(root.locator('[data-module-link="userTagger"] .pill')).toHaveText('off');
  await root.locator('[data-back="users"]').click();
  await expect(root.locator('[data-overview="users"]')).toBeVisible();
});

test('the header says changes save automatically, with a status that follows each save', async () => {
  const page = await ctx.newPage();
  const root = await openConsole(page, 'quarantineHide');
  await expect(root.locator('[data-autosave]')).toHaveText('Changes save automatically');
  await expect(root.getByRole('status')).toHaveText('');
  await expect(root.getByRole('button', { name: /^save/i })).toHaveCount(0);
  await root.locator('[data-module-toggle="quarantineHide"]').uncheck();
  await expect(root.getByRole('status')).toHaveText('saved');
});

test('at 820px wide no category or module page makes the main pane scroll sideways', async () => {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 805, height: 900 });
  const root = await openConsole(page, 'about');
  await root.locator('input[data-setting="showAdvanced"]').check();
  const cats = await root
    .locator('[data-category]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-category')!));
  expect(cats.length).toBeGreaterThan(6);
  const overflow = () =>
    page.evaluate(() => {
      const main = document.getElementById('rescue-settings')?.shadowRoot?.querySelector('main');
      return { scroll: main?.scrollWidth ?? 0, client: main?.clientWidth ?? 0 };
    });
  for (const cat of cats) {
    await root.locator(`[data-category="${cat}"]`).click();
    const mods = await root
      .locator('[data-module-link]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-module-link')!));
    for (const id of mods) {
      await root.locator(`[data-module-link="${id}"]`).click();
      const m = await overflow();
      expect(m.client, id).toBeGreaterThan(0);
      expect(m.scroll, id).toBeLessThanOrEqual(m.client + 1);
    }
  }
});
