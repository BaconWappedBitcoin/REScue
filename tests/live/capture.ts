/**
 * Page-structure capture (T041). Opens real Reddit pages in a visible browser and saves their
 * DOM STRUCTURE — tags and attribute names, with text and attribute values reduced to
 * placeholders except for a short allowlist — into tests/fixtures/captured/. Used to decide
 * candidate contracts: search.*, customFeed.feed, ageGate.confirm, loginWall.overlay.
 *
 * It never solves bot challenges or CAPTCHAs; a blocked page is recorded as blocked. Pages that
 * need a signed-in session use a persistent profile the user signs into by hand.
 *
 *   npm run capture:live -- search "https://www.reddit.com/search/?q=rust"
 *   npm run capture:live -- customFeed "https://www.reddit.com/user/<name>/m/<feed>/"
 *   npm run capture:live -- ageGate "https://www.reddit.com/r/<18+ subreddit>/"
 *   npm run capture:live -- loginWall "https://www.reddit.com/r/<sub>/"   (scroll until it shows)
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [name, url] = process.argv.slice(2);
if (
  !name ||
  !url ||
  !/^[a-zA-Z]+$/.test(name) ||
  !/^https:\/\/(www\.|sh\.)?reddit\.com\//.test(url)
) {
  console.error('usage: capture.ts <name> <https://www.reddit.com/...>');
  process.exit(2);
}

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = resolve(here, '../fixtures/captured');
mkdirSync(outDir, { recursive: true });

const ctx = await chromium.launchPersistentContext(join(homedir(), '.rescue-capture-profile'), {
  headless: false,
  viewport: { width: 1280, height: 900 },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(url, { waitUntil: 'domcontentloaded' });
console.log(
  'Interact with the page if needed (scroll, open the overlay), then press Enter here to capture.',
);
await new Promise<void>((r) => process.stdin.once('data', () => r()));

const structure = await page.evaluate(() => {
  // Attribute VALUES kept verbatim only for these names; everything else becomes "…".
  const KEEP = new Set([
    'id',
    'slot',
    'role',
    'type',
    'loading',
    'post-type',
    'depth',
    'data-testid',
    'name',
    'aria-label',
    'href',
    'src',
    'nsfw',
  ]);
  const blocked =
    !!document.querySelector('form input[name="solution"], iframe[src*="captcha" i]') ||
    /blocked/i.test(document.title);
  const walk = (node: Element, depth: number): string => {
    if (depth > 40) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'svg') return `<${tag}/>`;
    const attrs = [...node.attributes]
      .map((a) => {
        const keep = KEEP.has(a.name) ? a.value.replace(/[?#].*$/, '').slice(0, 120) : '…';
        return ` ${a.name}="${keep.replace(/"/g, '&quot;')}"`;
      })
      .join('');
    const shadow = (node as HTMLElement).shadowRoot
      ? `<#shadow>${[...(node as HTMLElement).shadowRoot!.children].map((c) => walk(c, depth + 1)).join('')}</#shadow>`
      : '';
    const kids = [...node.children].map((c) => walk(c, depth + 1)).join('');
    const text = [...node.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())
      ? 'T'
      : '';
    return `<${tag}${attrs}>${text}${shadow}${kids}</${tag}>`;
  };
  return { blocked, title: document.title, html: walk(document.body, 0) };
});

const file = join(outDir, `${name}.html`);
writeFileSync(
  file,
  `<!-- captured ${new Date().toISOString()} from ${new URL(url).pathname} | blocked=${structure.blocked} -->\n${structure.html}\n`,
);
console.log(`${structure.blocked ? 'BLOCKED — nothing useful captured. ' : ''}Saved ${file}`);
await ctx.close();
