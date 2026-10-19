/**
 * searchHelper (RES searchHelper, US8): search defaults. Ported in spirit from RES
 * lib/modules/searchHelper.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 *
 * Built:
 *  - A default sort and time range for search results: when you open a search results page whose
 *    address has no sort (or time), the module reloads it once with your default added.
 *  - "Search this subreddit by default": when the header's search form is reachable in the light
 *    DOM and you are in a subreddit, a search from it opens that subreddit's search, restricted to
 *    it. The form and the address parameters are candidates (contracts: chrome.searchForm,
 *    search.params) that REScue has not yet confirmed on the live page; if Reddit keeps the form
 *    in a sealed component the option does nothing. Reddit's own search box already offers
 *    searching the current community, so this mostly matters for people who keep it off.
 *
 * Not built: RES's search-option panel, legacy search, search tabs, flair search and "filter user
 * results by subreddit" (see feature-matrix.md).
 */
import { h } from '../../core/dom';
import { defineModule, type ModuleUi, type Route } from '../../core/types';
import { hint, label } from '../../core/hints';
import {
  hasRestrictField,
  searchForms,
  searchInput,
  searchWithDefaults,
  subredditSearchHref,
  type SearchDefaults,
} from '../../model/appearance';

interface Opts {
  defaultSort: string;
  defaultTime: string;
  searchInSubreddit: boolean;
  userFilterBySubreddit: boolean;
}

const NO_OPTS: Opts = {
  defaultSort: 'none',
  defaultTime: 'none',
  searchInSubreddit: false,
  userFilterBySubreddit: false,
};
let opts: Opts = NO_OPTS;
let ui: Pick<ModuleUi, 'addHeaderTool'> | null = null;
let userTool: HTMLElement | null = null;

const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;

/** The search that lists one user's posts in one subreddit, or null for a bad subreddit name. */
export function userInSubredditHref(
  user: string,
  subreddit: string,
  d: SearchDefaults,
): string | null {
  const sub = subreddit.trim().replace(/^\/?r\//i, '');
  return SUBREDDIT.test(sub) ? subredditSearchHref(sub, `author:${user}`, d) : null;
}

/** On a profile: "search u/name in r/[ ]" (RES userFilterBySubreddit), as a small tool in the corner strip. */
function syncUserTool(): void {
  userTool?.remove();
  userTool = null;
  const user = route?.kind === 'profile' ? route.username : undefined;
  if (!opts.userFilterBySubreddit || !user || !ui) return;
  const input = h('input', {
    type: 'text',
    name: 'subreddit',
    placeholder: 'subreddit',
    size: 12,
    'aria-label': `Subreddit to search u/${user}'s posts in`,
    title: hint.userInSubredditInput(user),
  });
  const go = h('button', { type: 'submit', title: hint.userInSubredditGo(user) }, label.search);
  const form = h('form', { class: 'rescue-user-in-sub' }, `search u/${user} in r/`, input, go);
  form.style.cssText = 'display:inline-flex;gap:4px;align-items:center;font-size:12px';
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const to = userInSubredditHref(user, input.value, {
      sort: opts.defaultSort,
      time: opts.defaultTime,
    });
    if (to) location.assign(to);
    else input.setCustomValidity('Use a subreddit name such as pics');
  });
  input.addEventListener('input', () => input.setCustomValidity(''));
  userTool = form;
  ui.addHeaderTool(form);
}
let route: Route | null = null;
let listening = false;

function applyDefaults(): void {
  const to = searchWithDefaults(location.href, { sort: opts.defaultSort, time: opts.defaultTime });
  if (to) location.replace(to);
}

function onSubmit(e: Event): void {
  const form = e.target;
  if (!opts.searchInSubreddit || !(form instanceof HTMLFormElement)) return;
  const sub = route?.subreddit;
  if (!sub || route?.kind === 'all' || route?.kind === 'popular') return;
  if (!searchForms().includes(form) || hasRestrictField(form)) return;
  const q = searchInput(form)?.value.trim();
  if (!q) return;
  e.preventDefault();
  location.assign(subredditSearchHref(sub, q, { sort: opts.defaultSort, time: opts.defaultTime }));
}

function take(o: Opts, r: Route): void {
  opts = {
    defaultSort: o.defaultSort,
    defaultTime: o.defaultTime,
    searchInSubreddit: o.searchInSubreddit,
    userFilterBySubreddit: o.userFilterBySubreddit,
  };
  route = r;
}

const timeValues = ['none', 'hour', 'day', 'week', 'month', 'year', 'all'].map((v) => ({
  value: v,
  label: v === 'none' ? 'Reddit’s choice' : v,
}));

export const searchHelper = defineModule({
  id: 'searchHelper',
  resId: 'searchHelper',
  category: 'appearance',
  title: 'Search helper',
  description:
    'Default sort and time range for search results, and an option to make the header search look only inside the subreddit you are in. The subreddit option needs the search box to be reachable by REScue, which has not been confirmed on the live page; it does nothing if Reddit keeps the box sealed. RES’s search panel, legacy search, tabs and flair search are not built.',
  enabledByDefault: true,
  options: {
    defaultSort: {
      type: 'enum',
      default: 'none',
      title: 'Default sort for search results',
      values: ['none', 'relevance', 'hot', 'top', 'new', 'comments'].map((v) => ({
        value: v,
        label: v === 'none' ? 'Reddit’s choice' : v,
      })),
    },
    defaultTime: {
      type: 'enum',
      default: 'none',
      title: 'Default time range for search results',
      values: timeValues,
    },
    searchInSubreddit: {
      type: 'boolean',
      default: false,
      title: 'Search inside the current subreddit by default',
      description: 'Applies to searches from the header search box while you are in a subreddit.',
    },
    userFilterBySubreddit: {
      type: 'boolean',
      default: false,
      title: 'On a profile, offer to search that user’s posts in a subreddit',
      description:
        'Adds a small “search u/name in r/…” box to the REScue corner strip on user pages; it opens the subreddit’s search for author:name.',
    },
  },

  init(ctx) {
    ui = ctx.ui;
    take(ctx.options, ctx.route);
    syncUserTool();
    if (!listening) {
      document.addEventListener('submit', onSubmit, true);
      listening = true;
    }
    if (ctx.route.kind === 'search') applyDefaults();
  },

  onSettings(ctx) {
    take(ctx.options, ctx.route);
    syncUserTool();
  },

  onRoute(r, ctx) {
    take(ctx.options, r);
    syncUserTool();
    if (r.kind === 'search') applyDefaults();
  },

  dispose() {
    document.removeEventListener('submit', onSubmit, true);
    listening = false;
    userTool?.remove();
    userTool = null;
    ui = null;
    opts = NO_OPTS;
    route = null;
  },
});
