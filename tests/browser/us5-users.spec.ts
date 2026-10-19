import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc } from './harness';
import { nestedThreadHtml, threadComments } from '../fixtures/pages';

// US5 / quickstart scenario 9: tags, ignore and the moderator highlight on Reddit's own layout.
const PAGE = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';

// repeater: c2 + c6, ignoreme: c7 (has the reply c8), modguy: c10 (moderator); OP rockpaperblr:
// the post and c1 c5 c9.
const AUTHORS: Record<number, string> = {
  2: 'repeater',
  6: 'repeater',
  7: 'ignoreme',
  10: 'modguy',
};
const THREAD = nestedThreadHtml(
  threadComments().map((c, i) => ({
    ...c,
    ...(AUTHORS[i] ? { author: AUTHORS[i]! } : {}),
    ...(i === 10 ? { distinguished: 'moderator' as const } : {}),
  })),
);

let ctx: BrowserContext;

test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, PAGE, htmlDoc(THREAD));
});
test.afterEach(async () => {
  await ctx.close();
});

const comment = (page: Page, id: string) => page.locator(`shreddit-comment[thingid="${id}"]`);
/** Let the debounced storage write land before the page is reloaded. */
const settle = (page: Page) => page.waitForTimeout(500);

async function saveTag(page: Page, user: string, fields: Record<string, string>, ignore = false) {
  await page.locator(`button[aria-label="Tag ${user}"]`).first().click();
  const editor = page.locator('.rescue-tag-editor');
  await expect(editor).toBeVisible();
  for (const [name, value] of Object.entries(fields))
    await editor.locator(`input[name=${name}]`).fill(value);
  if (ignore) await editor.locator('input[name=ignore]').check();
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toHaveCount(0);
}

test('a tag shows beside the author on a comment and a post, updates everywhere, and persists', async () => {
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await saveTag(page, 'rockpaperblr', { text: 'op friend', color: '#ffd700' });

  const tags = page.locator('.rescue-user-tag[data-user="rockpaperblr"]');
  await expect(tags).toHaveCount(4); // the post and three comments
  await expect(tags.first()).toHaveText('op friend');
  await expect(tags.first()).toHaveCSS('background-color', 'rgb(255, 215, 0)');
  // Post: right after Reddit's authorName wrapper (the link sits in a block-level tracker on live
  // listings, so a node after the link itself would wrap). Comment: right after the author link.
  await expect(
    page.locator(
      'shreddit-post [slot="authorName"]:has(a[href="/user/rockpaperblr/"]) + .rescue-author-extras .rescue-user-tag',
    ),
  ).toHaveCount(1);
  await expect(
    comment(page, 't1_c1').locator('a[href="/user/rockpaperblr/"] + .rescue-author-extras'),
  ).toHaveCount(1);

  // Editing again changes every instance in place; nothing is duplicated.
  await saveTag(page, 'rockpaperblr', { text: 'renamed' });
  await expect(tags).toHaveCount(4);
  await expect(tags.first()).toHaveText('renamed');
  await expect(tags.last()).toHaveText('renamed');
  await expect(page.locator('.rescue-author-extras')).toHaveCount(13); // post + 12 comments

  await settle(page);
  await page.reload();
  await expect(page.locator('.rescue-user-tag[data-user="rockpaperblr"]')).toHaveCount(4);
});

test('a tag link must be http(s) and opens safely', async () => {
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await page.locator('button[aria-label="Tag repeater"]').first().click();
  const editor = page.locator('.rescue-tag-editor');
  await editor.locator('input[name=text]').fill('linked');
  await editor.locator('input[name=link]').fill('javascript:alert(1)');
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor.locator('.rescue-tag-error')).toBeVisible();
  await editor.locator('input[name=link]').fill('https://example.com/who');
  await editor.getByRole('button', { name: 'Save' }).click();
  const link = page.locator('.rescue-user-tag[data-user="repeater"] a').first();
  await expect(link).toHaveAttribute('href', 'https://example.com/who');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
});

test('ignoring a user collapses only that comment’s body, never its replies', async () => {
  const page = await ctx.newPage();
  await page.goto(PAGE);
  await saveTag(page, 'ignoreme', {}, true);

  const ignored = comment(page, 't1_c7');
  const ownBody = ignored.locator('> [slot="comment"]');
  const reply = comment(page, 't1_c8');
  await expect(ownBody).toBeHidden();
  await expect(ignored).toBeVisible();
  await expect(reply).toBeVisible();
  await expect(reply.locator('> [slot="comment"]')).toBeVisible();

  await ignored.getByRole('button', { name: /ignored user - show/ }).click();
  await expect(ownBody).toBeVisible();
  await ignored.getByRole('button', { name: /ignored user - hide/ }).click();
  await expect(ownBody).toBeHidden();

  // Un-ignoring through the editor restores it for good.
  await ignored.locator('button[aria-label="Tag ignoreme"]').click();
  await page.locator('.rescue-tag-editor input[name=ignore]').uncheck();
  await page.locator('.rescue-tag-editor').getByRole('button', { name: 'Save' }).click();
  await expect(ownBody).toBeVisible();
  await expect(ignored.getByRole('button', { name: /ignored user/ })).toHaveCount(0);
});

test('a moderator’s author link gets the highlight class, an ordinary one does not', async () => {
  const page = await ctx.newPage();
  await page.goto(PAGE);
  const modLink = comment(page, 't1_c10').locator('a[href="/user/modguy/"]');
  await expect(modLink).toHaveClass(/rescue-mod-author/);
  await expect(modLink).toHaveCSS('background-color', 'rgb(34, 136, 34)');
  await expect(page.locator('.rescue-mod-author')).toHaveCount(1);
  await expect(comment(page, 't1_c2').locator('a[href="/user/repeater/"]')).not.toHaveClass(
    /rescue-mod-author/,
  );
});
