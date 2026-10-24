import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { launchWithExtension, serveRedditPage, htmlDoc, menuClick } from './harness';
import { listingHtml, nestedThreadHtml, searchPageHtml, threadComments } from '../fixtures/pages';

/**
 * Hover-text guard. Every REScue control a reader can see must say what it does in a native tooltip
 * that starts with "REScue: ", so REScue's controls can be told from Reddit's own. The scenarios
 * open the popups, menus and notices, then audit everything REScue has put on the page (including
 * the notices and the settings console, which live in shadow roots).
 */
const LISTING = 'https://www.reddit.com/r/programming/';
const THREAD = 'https://www.reddit.com/r/Layoffs/comments/text1/got_laid_off/';
const SEARCH = 'https://www.reddit.com/search/?q=thing&type=posts';
const HOUR = 3_600_000;

let ctx: BrowserContext;

test.afterEach(async () => {
  await ctx.close();
});

type Chrome = { chrome: { storage: { local: { set(v: object): Promise<void> } } } };
const worker = async () => ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
async function seed(items: Record<string, unknown>) {
  const sw = await worker();
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

/**
 * The audit, run inside the page. Returns one line per problem:
 *  - a REScue element with no tooltip of its own or from a titled REScue ancestor;
 *  - a tooltip that does not start with "REScue: " or is too long;
 *  - a control whose visible text is only a symbol.
 */
function audit(): string[] {
  // Containers that only hold titled controls (or are drawn without any pointer interaction).
  const WRAPPER_IDS = new Set([
    'rescue-tools', // the corner strip
    'rescue-menu', // the gear menu (its rows carry the tooltips)
    'rescue-notices', // shadow host of the notices
    'rescue-settings', // shadow host of the settings console
    'rescue-cmdline', // the command line box
    'rescue-keyhelp', // the shortcut list box
    'rescue-link-numbers', // pointer-less layer holding the [n] badges
    'rescue-selection', // the outline around the selected item (no text, no pointer)
    'rescue-subreddit-bar', // the shortcut bar
    'rescue-shortcut-popup', // the add / edit shortcut box
    'rescue-wheelbrowse-wrapper',
  ]);
  const WRAPPER_CLASSES = new Set([
    'rescue-overlay', // generic REScue box
    'rescue-banners',
    'rescue-tool-row',
    'rescue-menu-row',
    'rescue-filter-banner', // holds the count, show/hide, power and rules controls
    'rescue-autohide-banner',
    'rescue-sc-viewport',
    'rescue-sc', // one shortcut: its link and edit button carry the tooltips
    'rescue-sc-group',
    'rescue-sc-menu',
    'rescue-tag-editor',
    'rescue-tag-field',
    'rescue-tag-actions',
    'rescue-sc-actions', // the Save / Cancel row of the shortcut popup
    'rescue-author-extras', // holds the tag chip, vote tally and tag button
    'rescue-parent-chain',
    'rescue-hover',
    'rescue-sortable', // a Reddit table; its column headings carry the tooltip
    'rescue-tags-manager',
    'rescue-filter-menu',
    'rescue-switch', // the drawn on/off switch inside a menu row
  ]);
  // Marks that are single glyph-free dividers rather than controls or labels.
  const NO_TEXT_RULE = new Set(['rescue-bar-sep']);

  const problems: string[] = [];
  const describe = (el: Element): string => {
    const cls = el.getAttribute('class');
    return `<${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls ? '.' + cls.trim().split(/\s+/).join('.') : ''}> "${(el.textContent ?? '').trim().slice(0, 30)}"`;
  };
  const visible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const isRescue = (el: Element, inShadow: boolean): boolean =>
    inShadow ||
    // rescue-fx-* are the fixtures' stand-ins for Reddit's own credit-bar groups, not REScue nodes.
    /(^|\s)rescue-(?!fx-)/.test(el.getAttribute('class') ?? '') ||
    el.id.startsWith('rescue-');
  const isWrapper = (el: Element): boolean =>
    WRAPPER_IDS.has(el.id) || [...el.classList].some((c) => WRAPPER_CLASSES.has(c));
  const titleOf = (el: Element): string => (el.getAttribute('title') ?? '').trim();

  /** Own title, else the nearest titled REScue ancestor (never one of the bare containers). */
  const tooltipFor = (el: Element, inShadow: boolean): string => {
    for (let n: Node | null = el; n;) {
      if (n instanceof Element) {
        const t = titleOf(n);
        if (t && (n === el || (isRescue(n, inShadow) && !WRAPPER_IDS.has(n.id)))) return t;
      }
      const p: Node | null = n.parentNode;
      if (p instanceof ShadowRoot) {
        if (!inShadow) break;
        n = p.host;
        inShadow = false;
        // A titled shadow host is a container, not a tooltip for what is inside.
        const host = n as Element;
        if (WRAPPER_IDS.has(host.id)) return '';
        continue;
      }
      n = p;
    }
    return '';
  };

  const ICON_BUTTONS = '.close, .reset, .drag-handle, .row-tools button, [data-action="add"], .key';
  const INTERACTIVE = 'button, a[href], input, select, textarea, summary, [role="menuitem"]';
  const check = (el: Element, inShadow: boolean, settingsConsole: boolean): void => {
    if (!visible(el) || /^(style|script|option|optgroup|br|svg|path)$/i.test(el.tagName)) return;
    const interactive = el.matches(INTERACTIVE);
    const text = (el.textContent ?? '').trim();
    const classes = [...el.classList];

    // The settings console is labelled option by option; only its icon-like buttons need a tooltip.
    if (settingsConsole) {
      if (el.matches(ICON_BUTTONS) && !titleOf(el)) {
        problems.push(`console button without a tooltip: ${describe(el)}`);
      }
      if (el.matches('button') && text && !/[\p{L}\p{N}]/u.test(text)) {
        problems.push(`console button shows only a symbol: ${describe(el)}`);
      }
      return;
    }

    if (!isWrapper(el) || interactive) {
      const tip = tooltipFor(el, inShadow);
      if (!tip) problems.push(`no tooltip: ${describe(el)}`);
      else if (!tip.startsWith('REScue: ') || tip.length > 130) {
        problems.push(`bad tooltip "${tip}": ${describe(el)}`);
      }
    }
    // A colour swatch is a drawn colour (named by its aria-label), not a symbol.
    const isSwatch = classes.includes('rescue-swatch') && !text;
    if (text && !isSwatch && !isWrapper(el) && !classes.some((c) => NO_TEXT_RULE.has(c))) {
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (own && !/[\p{L}\p{N}]/u.test(own)) problems.push(`shows only a symbol: ${describe(el)}`);
    }
  };

  const walk = (root: Document | ShadowRoot, inShadow: boolean, settingsConsole: boolean) => {
    const all = root.querySelectorAll('*');
    for (const el of all) {
      if (inShadow || isRescue(el, false)) check(el, inShadow, settingsConsole);
      if (!inShadow && el.shadowRoot && el.id.startsWith('rescue-')) {
        walk(el.shadowRoot, true, el.id === 'rescue-settings');
      }
    }
  };
  walk(document, false, false);
  return [...new Set(problems)];
}

async function expectAudited(page: Page, label: string): Promise<void> {
  const problems = await page.evaluate(audit);
  expect(problems, `hover hints missing on ${label}`).toEqual([]);
}

test('listing: strip, gear menu, filter menu, tag editor, manager, notices, banner, settings', async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, LISTING, htmlDoc(listingHtml()));
  await configure({
    filteReddit: {
      showFilterline: true,
      filteredDisplay: 'placeholder',
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
    userHighlight: { friends: ['kleudorian'] },
    subredditTagger: { tags: [{ subreddit: 'aww', tag: 'cute', color: '#e0e0e0' }] },
    singleClick: { hideLEC: false },
    localDate: { display: 'both' },
    wheelBrowse: {},
    subredditManager: {
      showDefaults: true,
      subreddits: [
        { target: 'programming', label: '', addedAt: 1 },
        { target: 'aww+pics', label: 'cute', addedAt: 2 },
      ],
    },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  await page.goto(LISTING);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  await expect(page.locator('.rescue-filter-btn').first()).toBeVisible();
  await expect(page.locator('.rescue-filter-placeholder').first()).toBeVisible();
  await expect(page.locator('#rescue-subreddit-bar a').first()).toBeVisible();
  await expectAudited(page, 'the listing');

  // The shortcut bar: sort menu, a group's member list, and the add popup.
  await page.locator('#rescue-subreddit-bar [data-rescue-sort]').click();
  await expect(page.locator('[data-rescue-sort-menu]')).toBeVisible();
  await expectAudited(page, 'the shortcut sort menu');
  await page.keyboard.press('Escape');
  await page.locator('#rescue-subreddit-bar .rescue-sc-group').hover();
  await expect(page.locator('#rescue-subreddit-bar .rescue-sc-menu a').first()).toBeVisible();
  await expectAudited(page, 'the shortcut group menu');
  await page.locator('#rescue-subreddit-bar [data-rescue-new]').click();
  await expect(page.locator('#rescue-shortcut-popup')).toBeVisible();
  await expectAudited(page, 'the add-shortcut popup');
  await page.locator('#rescue-shortcut-popup [data-rescue-cancel]').click();

  // The gear menu, including a switch.
  await page.locator('#rescue-gear').click();
  await expect(page.locator('#rescue-menu')).toBeVisible();
  await expectAudited(page, 'the gear menu');
  await page.locator('#rescue-menu [data-menu-id="quick:hideNsfw"]').click();
  await expectAudited(page, 'the gear menu after a switch');
  await page.keyboard.press('Escape');

  // The filter banner (revealed), then the filter button's menu and its Undo notice.
  await page.locator('.rescue-filter-toggle').click();
  await expect(page.locator('.rescue-filter-toggle')).toHaveText('hide');
  await expectAudited(page, 'the revealed filter banner');
  await page.locator('.rescue-filter-btn').first().click();
  await expect(page.locator('.rescue-filter-menu')).toBeVisible();
  await expectAudited(page, 'the filter menu');
  await page.locator('.rescue-filter-item').first().click();
  await expect(page.locator('#rescue-notices .n').first()).toBeVisible();
  await expectAudited(page, 'a notice with an action');

  // The tag editor and the tagged-users manager.
  await page.locator('.rescue-tag-btn').first().click();
  await expect(page.locator('.rescue-tag-editor')).toBeVisible();
  await page.locator('.rescue-tag-editor input[name=text]').fill('friend');
  await page.locator('.rescue-tag-editor .rescue-tag-save-preset').click();
  await expectAudited(page, 'the tag editor');
  await page.locator('.rescue-tag-editor .rescue-tag-manage').click();
  await expect(page.locator('.rescue-tags-manager')).toBeVisible();
  await expectAudited(page, 'the tagged users list');
  await page.locator('.rescue-tags-close').click();
  await page.locator('.rescue-tag-btn').first().click();
  await page.locator('.rescue-tag-editor input[name=text]').fill('tagged');
  await page.locator('.rescue-tag-editor .rescue-tag-save').click();
  await expect(page.locator('.rescue-user-tag').first()).toBeVisible();
  await expectAudited(page, 'a saved tag');

  // The settings console: only icon-like buttons are held to the rule there.
  await page.goto(`${LISTING}#rescue:settings/filteReddit`);
  await expect(page.locator('#rescue-settings [data-option="filteReddit.rules"]')).toBeVisible();
  await expectAudited(page, 'the settings console');
});

test('thread: navigator, reply controls, hover popup, saved list, help, command line', async () => {
  ctx = await launchWithExtension();
  const now = Date.now();
  const comments = threadComments().map((c, i) => ({
    ...c,
    created: new Date(now - (i === 0 || i === 4 ? HOUR / 2 : 3 * HOUR)).toISOString(),
  }));
  await serveRedditPage(ctx, THREAD, htmlDoc(nestedThreadHtml(comments, false, true)));
  await seed({ read: { t3_text1: { lastVisit: Date.now() - HOUR, commentCountAtVisit: 1100 } } });
  await configure({ localDate: { display: 'both' } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  await page.goto(THREAD);
  const nav = page.locator('.rescue-comment-nav');
  await menuClick(page, 'commentNavigator');
  await expect(nav).toBeVisible();
  await expect(page.locator('.rescue-new-comment').first()).toBeVisible();
  await expect(
    page.locator('#rescue-notices [data-rescue-notice="readComments-hide"]'),
  ).toBeVisible();
  await expectAudited(page, 'the thread');

  await nav.locator('.rescue-nav-next').click();
  await expectAudited(page, 'the navigator after a step');
  await page.locator('.rescue-show-parent').first().hover();
  await expect(page.locator('.rescue-hover .rescue-parent-preview').first()).toBeVisible();
  await expectAudited(page, 'the parent popup');
  await page.mouse.move(2, 2);

  await page.locator('.rescue-save-comment').first().click();
  await expect(
    page.locator('#rescue-notices [data-rescue-notice="saveRES-explainer"]'),
  ).toBeVisible();
  await menuClick(page, 'savedComments');
  await expect(page.locator('#rescue-saved-comments')).toBeVisible();
  await expectAudited(page, 'the saved comments list');
  await menuClick(page, 'savedComments');

  await page.locator('shreddit-comment').first().locator('[slot="comment"]').first().click();
  await page.keyboard.press('Shift+?');
  await expect(page.locator('#rescue-keyhelp')).toBeVisible();
  await expectAudited(page, 'the shortcut list');
  await page.keyboard.press('Escape');

  await page.keyboard.press('.');
  await expect(page.locator('#rescue-cmdline input')).toBeFocused();
  await page.keyboard.type('?');
  await page.keyboard.press('Enter');
  await expect(page.locator('#rescue-cmdline li').first()).toBeVisible();
  await expectAudited(page, 'the command line');
  // The command line stays open over the page (on Linux it covers the comment's controls).
  await page.keyboard.press('Escape');
  await expect(page.locator('#rescue-cmdline')).toHaveCount(0);

  await page.locator('.rescue-hide-children').first().click();
  await expectAudited(page, 'a collapsed reply branch');
  await menuClick(page, 'hideAllReplies');
  await expectAudited(page, 'the hide-all-replies toggle');
});

test('listing: reason chips on revealed filtered posts', async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, LISTING, htmlDoc(listingHtml()));
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
  page.setDefaultTimeout(6000);
  await page.goto(LISTING);
  await page.locator('.rescue-filter-toggle').click();
  await expect(
    page.locator('article:has(shreddit-post#t3_link1) .rescue-filter-reason'),
  ).toBeVisible();
  await expectAudited(page, 'a reason chip');
});

test('search results: filter and tag buttons', async () => {
  ctx = await launchWithExtension();
  await serveRedditPage(ctx, SEARCH, htmlDoc(searchPageHtml()));
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  await page.goto(SEARCH);
  await expect(page.locator('#rescue-gear')).toBeVisible();
  await expect(page.locator('.rescue-tag-btn').first()).toBeVisible();
  await expectAudited(page, 'search results');
});
