import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc, waitForRescue } from './harness';
import { POSTS, postHtml } from '../fixtures/pages';

/**
 * Comment tools (RES commentTools): a REScue bar before Reddit's comment box with a macros list
 * (inserted at the caret), "commenting as u/<you>", and the big editor that writes back into
 * Reddit's box after switching it to Markdown with Reddit's own button. The fixture composer has
 * the live shape (2026-10-21): `comment-composer-host` > `shreddit-composer[mode]` whose open
 * shadow root holds the toolbar ("Switch to Markdown") and the editor; Markdown mode swaps the
 * editor for a textarea.
 */
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';

const SCRIPT = `<script>
for (const host of document.querySelectorAll('comment-composer-host')) {
  const composer = host.querySelector('shreddit-composer');
  const root = composer.attachShadow({ mode: 'open' });
  const sw = document.createElement('button');
  sw.setAttribute('aria-label', 'Switch to Markdown');
  sw.textContent = 'Switch to Markdown';
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('data-lexical-editor', 'true');
  editor.setAttribute('name', 'body');
  editor.id = 'fx-editor';
  editor.style.minHeight = '40px';
  root.append(sw, editor);
  sw.addEventListener('click', () => {
    const box = document.createElement('textarea');
    box.id = 'fx-textarea';
    box.value = editor.textContent;
    editor.replaceWith(box);
    composer.setAttribute('mode', 'markdown');
  });
}
</script>`;

const page = () =>
  htmlDoc(
    `<shreddit-app user-logged-in="true"><after-login-toast-dispatcher username="me_the_reader"></after-login-toast-dispatcher>` +
      `<div id="main-content">${postHtml(POSTS[0]!).replace(/^<article>|<\/article>$/g, '')}` +
      `<comment-composer-host post-id="t3_text1"><shreddit-composer mode="richText"></shreddit-composer></comment-composer-host>` +
      `</div></shreddit-app>${SCRIPT}`,
  );

let ctx: BrowserContext;
test.beforeEach(async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, THREAD, page());
});
test.afterEach(async () => {
  await ctx.close();
});

type Area = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };
async function open(options: Record<string, unknown> = {}): Promise<Page> {
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  await sw.evaluate(
    async (v) => (globalThis as unknown as Area).chrome.storage.local.set({ settings: v }),
    { modules: { commentTools: { enabled: true, options } } },
  );
  const p = await ctx.newPage();
  await p.goto(THREAD);
  await waitForRescue(p);
  return p;
}
const editorText = (p: Page) =>
  p.evaluate(() => {
    const root = document.querySelector('shreddit-composer')!.shadowRoot!;
    const box = root.querySelector('textarea') as HTMLTextAreaElement | null;
    return box ? box.value : (root.querySelector('#fx-editor')?.textContent ?? '');
  });
const editor = (p: Page) => p.locator('shreddit-composer #fx-editor');

test('one bar sits before Reddit’s comment box, saying who you comment as', async () => {
  const p = await open();
  const bar = p.locator('.rescue-ct-bar');
  await expect(bar).toHaveCount(1);
  await expect(bar).toContainText('commenting as u/me_the_reader');
  expect(
    await p.evaluate(() => document.querySelector('.rescue-ct-bar')!.nextElementSibling?.localName),
  ).toBe('comment-composer-host');
  await p.waitForTimeout(600); // a later observer pass must not add a second bar
  await expect(bar).toHaveCount(1);
});

test('a macro goes into the comment box at the caret, placeholders filled in', async () => {
  const p = await open({ macros: [{ label: 'thanks', text: 'Thanks from {{my_username}}!' }] });
  await editor(p).click();
  await p.keyboard.type('Hi. ');
  await p.locator('.rescue-ct-macros-btn').click();
  await p.locator('.rescue-ct-macro', { hasText: 'thanks' }).click();
  await expect.poll(() => editorText(p)).toBe('Hi. Thanks from me_the_reader!');
});

test('the big editor previews Markdown and writes back in Markdown mode; cancel changes nothing', async () => {
  const p = await open();
  await editor(p).click();
  await p.keyboard.type('start');
  await p.locator('.rescue-ct-big').click();
  const box = p.locator('.rescue-big-editor-text');
  await expect(box).toHaveValue('start');
  await box.fill('**bold** and <img src=x onerror=alert(1)>');
  await expect(p.locator('.rescue-big-editor-preview strong')).toHaveText('bold');
  await expect(p.locator('.rescue-big-editor-preview img')).toHaveCount(0);
  await p.locator('.rescue-big-editor-cancel').click();
  await expect(box).toHaveCount(0);
  expect(await editorText(p)).toBe('start');

  await p.locator('.rescue-ct-big').click();
  await p.locator('.rescue-big-editor-text').fill('# Title\n\nbody');
  await p.locator('.rescue-big-editor-save').click();
  await expect
    .poll(() => p.evaluate(() => document.querySelector('shreddit-composer')!.getAttribute('mode')))
    .toBe('markdown');
  await expect.poll(() => editorText(p)).toBe('# Title\n\nbody');
});
