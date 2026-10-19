/**
 * stylesheet (RES stylesheet, US8): your own CSS, injected as one <style id="rescue-user-css"> in
 * the page. It follows the settings live and is gone when the module is turned off. Ported in
 * spirit from RES lib/modules/stylesheet.js (GPL-3.0, the RES contributors, commit 4defffc); the
 * code is new. RES also loaded other subreddits' stylesheets: modern Reddit has no subreddit CSS.
 * Hooks for your own CSS are added too: classes on <html> and <body> (res-r-<sub>, res-m-<feed>,
 * res-u-<profile user>, res-user-<me>, plus classes you list by subreddit) and named snippets that
 * can be tied to a custom toggle (see cssHooks.ts).
 *
 * The CSS is yours: REScue does not review it. It is written as text (never as HTML) and applies to
 * the light DOM only; Reddit's own components keep their closed shadow DOM, so selectors cannot
 * reach inside them and REScue does not try to. Reddit's content-security policy still limits what
 * `url()` and `@import` can load.
 */
import { defineModule, type ModuleContext } from '../../core/types';
import {
  APPLY_TO,
  classTokens,
  routeClasses,
  rowApplies,
  type HookFlags,
  type HookRow,
} from './cssHooks';
import { removeStyle, setStyle } from './injectedStyle';

export const USER_CSS_ID = 'rescue-user-css';
export const SNIPPETS_ID = 'rescue-user-snippets';

const rowColumns = (first: { key: string; title: string }) => [
  { ...first, type: 'text' as const },
  {
    key: 'applyTo',
    title: 'Applies',
    type: 'enum' as const,
    values: APPLY_TO.map((a) => a.value) as string[],
    default: 'everywhere',
  },
  { key: 'subreddits', title: 'Subreddits (for “but” / “only”)', type: 'text' as const },
  { key: 'customToggle', title: 'Only while this custom toggle is on', type: 'text' as const },
];

let applied: string[] = [];

/** Put the route's hook classes (and the listed body classes) on <html> and <body>. */
function syncClasses(ctx: ModuleContext): void {
  const o = ctx.options as unknown as HookFlags & { bodyClasses: HookRow[] };
  const profile = ctx.settings.profile();
  const want = new Set([
    ...routeClasses(ctx.route, ctx.session?.username ?? null, o),
    ...o.bodyClasses
      .filter((r) => rowApplies(r, ctx.route, profile))
      .flatMap((r) => classTokens(r.classes)),
  ]);
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    for (const c of applied) if (!want.has(c)) el.classList.remove(c);
    for (const c of want) el.classList.add(c);
  }
  applied = [...want];
}

function sync(ctx: ModuleContext): void {
  setStyle(USER_CSS_ID, ctx.options.css as string);
  const o = ctx.options as unknown as { snippets: HookRow[] };
  const profile = ctx.settings.profile();
  setStyle(
    SNIPPETS_ID,
    o.snippets
      .filter((r) => rowApplies(r, ctx.route, profile))
      .map((r) => (typeof r.snippet === 'string' ? r.snippet : ''))
      .join('\n'),
  );
  syncClasses(ctx);
}

export const customCss = defineModule({
  id: 'stylesheet',
  resId: 'stylesheet',
  category: 'appearance',
  title: 'Custom CSS',
  description:
    'Add your own CSS to Reddit’s pages. It is applied as soon as you save and removed when this feature is turned off. It can only style what is visible in the page itself; Reddit’s own components keep their insides sealed, so selectors cannot reach into them. Reddit’s content-security policy still limits what the CSS may load. Subreddit stylesheets no longer exist on modern Reddit. Hooks for your CSS: classes on the page (res-r-<subreddit>, res-m-<feed>, res-u-<profile>, res-user-<you>), extra classes you list by subreddit, and named snippets you can tie to a custom toggle.',
  enabledByDefault: true,
  options: {
    css: {
      type: 'text',
      multiline: true,
      default: '',
      title: 'Your CSS',
      description: 'Plain CSS, for example: body { font-size: 15px; }',
    },
    snippets: {
      type: 'table',
      default: [],
      title: 'CSS snippets',
      description:
        'Pieces of CSS that apply everywhere or on chosen subreddits, and only while a custom toggle (Custom toggles) is on. Flip the toggle from the REScue menu.',
      columns: rowColumns({ key: 'snippet', title: 'CSS' }),
    },
    bodyClasses: {
      type: 'table',
      default: [],
      title: 'Page classes',
      description:
        'Classes added to <html> and <body> everywhere or on chosen subreddits (and while a custom toggle is on), so your CSS can target them.',
      columns: rowColumns({ key: 'classes', title: 'Classes' }),
    },
    subredditClass: {
      type: 'boolean',
      default: true,
      title: 'Add res-r-<subreddit> on subreddit pages',
    },
    multiredditClass: {
      type: 'boolean',
      default: true,
      title: 'Add res-m-<feed> on custom feed pages',
    },
    usernameClass: {
      type: 'boolean',
      default: true,
      title: 'Add res-u-<name> on a user’s profile pages',
    },
    loggedInUserClass: {
      type: 'boolean',
      default: false,
      title: 'Add res-user-<you> when you are signed in',
    },
  },

  init: sync,
  onSettings: sync,
  onRoute(_route, ctx) {
    sync(ctx);
  },

  dispose() {
    removeStyle(USER_CSS_ID);
    removeStyle(SNIPPETS_ID);
    for (const el of [document.documentElement, document.body]) el?.classList.remove(...applied);
    applied = [];
  },
});
