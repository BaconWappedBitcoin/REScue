/**
 * The command line's built-in commands. The command set follows RES lib/modules/commandLine.js
 * (GPL-3.0, Copyright (C) the RES contributors): r/, u/, m/, me/*, m and mm, sort shorthands
 * with a time period, s/search, sr and ?. The code is new, and the URLs are modern Reddit's.
 */
import { sendCommand } from '../../core/commandEvents';
import type { ModuleDefinition } from '../../core/types';
import { NAV_CATEGORIES } from '../comments/navigatorFilters';
import { taggerApi } from '../users/taggerApi';
import {
  act,
  go,
  listCommands,
  message,
  registerCommand,
  type CommandEnv,
  type Parsed,
} from './commandRegistry';

const PERIODS = ['hour', 'day', 'week', 'month', 'year', 'all'];
const SORT_WORDS = ['hot', 'new', 'top', 'rising', 'controversial'];
const SHORT_SORTS: Record<string, string> = {
  n: 'new',
  t: 'top',
  h: 'hot',
  r: 'rising',
  c: 'controversial',
};
const NEEDS_PERIOD = new Set(['top', 'controversial']);

/** me/<what>, with RES's short forms and Reddit's current names for liked and disliked. */
const ME_PAGES: Record<string, { path: string; label: string }> = {
  '': { path: '', label: 'your profile' },
  saved: { path: 'saved/', label: 'your saved posts' },
  s: { path: 'saved/', label: 'your saved posts' },
  submitted: { path: 'submitted/', label: 'your posts' },
  sub: { path: 'submitted/', label: 'your posts' },
  comments: { path: 'comments/', label: 'your comments' },
  c: { path: 'comments/', label: 'your comments' },
  upvoted: { path: 'upvoted/', label: 'your upvoted posts' },
  u: { path: 'upvoted/', label: 'your upvoted posts' },
  l: { path: 'upvoted/', label: 'your upvoted posts' },
  liked: { path: 'upvoted/', label: 'your upvoted posts' },
  downvoted: { path: 'downvoted/', label: 'your downvoted posts' },
  d: { path: 'downvoted/', label: 'your downvoted posts' },
  hidden: { path: 'hidden/', label: 'your hidden posts' },
  h: { path: 'hidden/', label: 'your hidden posts' },
};

const signedOut = (what: string): Parsed => message(`Sign in to Reddit to open ${what}.`);

function period(arg: string | undefined): string | undefined {
  const a = arg?.toLowerCase();
  return a ? PERIODS.find((p) => p.startsWith(a)) : undefined;
}

/** The sort page of wherever the user is: subreddit, custom feed, profile, or the front page. */
export function sortTarget(sort: string, arg: string | undefined, env: CommandEnv): Parsed {
  const t = period(arg);
  if (arg && !t && NEEDS_PERIOD.has(sort))
    return message(`Unknown time period “${arg}”. Use ${PERIODS.join(', ')}.`);
  const query = NEEDS_PERIOD.has(sort) && t ? `t=${t}` : '';
  const { route } = env;
  const label = `Sort by ${sort}${t && query ? ` (${t})` : ''}`;
  if (route.kind === 'profile' && route.username) {
    const q = [`sort=${sort}`, query].filter(Boolean).join('&');
    return go(`/user/${route.username}/?${q}`, label);
  }
  let base = '/';
  if (route.subreddit) base = `/r/${route.subreddit}/`;
  else if (route.kind === 'customFeed')
    base = route.path.endsWith('/') ? route.path : `${route.path}/`;
  return go(`${base}${sort === 'hot' ? '' : sort + '/'}${query ? '?' + query : ''}`, label);
}

function searchScope(env: CommandEnv): string {
  const sub = env.route.subreddit;
  return sub && !['all', 'popular'].includes(sub) ? `/r/${sub}` : '';
}

function search(query: string, env: CommandEnv, wholeSite = false): Parsed {
  if (!query) return message('Type what to search for, e.g. search async traits');
  const scope = wholeSite ? '' : searchScope(env);
  return go(
    `${scope}/search/?q=${encodeURIComponent(query)}`,
    `Search ${scope ? scope.slice(1) : 'all of Reddit'} for “${query}”`,
  );
}

function findModule(arg: string, env: CommandEnv): ModuleDefinition | undefined {
  const wanted = arg.toLowerCase();
  return env.settings
    .definitions()
    .find((m) => m.id.toLowerCase() === wanted || m.title.toLowerCase() === wanted);
}

/** The navigator category a typed word means: its value or the start of its label. */
export function navCategory(word: string): string | undefined {
  const w = word.trim().toLowerCase();
  if (!w) return undefined;
  const hit =
    NAV_CATEGORIES.find((c) => c.value === w) ??
    NAV_CATEGORIES.find((c) => c.label.toLowerCase().startsWith(w)) ??
    NAV_CATEGORIES.find((c) => c.value.startsWith(w));
  return hit?.value;
}

/**
 * Reddit's submit page for `post [sub] [title] [url]`: a link when the last word is a web address,
 * else a text post. Only the address is built here; nothing is submitted (Reddit's own form is).
 * The title and url query names are the ones Reddit's submit page has long read; if Reddit stops
 * honouring them the form simply opens empty.
 */
export function submitTarget(args: string): { path: string; label: string } {
  const words = args.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.replace(/^\/?r\//i, '');
  const sub = first && /^[A-Za-z0-9_]{2,21}$/.test(first) ? first : undefined;
  if (sub) words.shift();
  const last = words[words.length - 1];
  const url = last && /^https?:\/\/\S+$/i.test(last) ? last : undefined;
  if (url) words.pop();
  const title = words.join(' ');
  const q: string[] = [];
  if (title) q.push(`title=${encodeURIComponent(title)}`);
  if (url) q.push(`url=${encodeURIComponent(url)}`);
  const path = `${sub ? `/r/${sub}` : ''}/submit${q.length ? '?' + q.join('&') : ''}`;
  return {
    path,
    label: `Open Reddit’s submit page${sub ? ` for r/${sub}` : ''}${url ? ' (link)' : title ? ' (text)' : ''}`,
  };
}

let registered = false;

/** Registers the built-ins once (they stay registered for the page's lifetime). */
export function registerBuiltinCommands(): void {
  if (registered) return;
  registered = true;

  registerCommand({
    name: 'r/<subreddit>',
    description: 'r/<subreddit> - go to a subreddit',
    pattern: /^\/?r\/([A-Za-z0-9_]{2,21})\/?$/,
    run: (_a, _e, m) => go(`/r/${m![1]}/`, `Go to r/${m![1]}`),
  });
  registerCommand({
    name: 'u/<user>/m/<feed>',
    description: 'u/<user>/m/<feed> - go to a custom feed that user made',
    pattern: /^\/?u(?:ser)?\/([A-Za-z0-9_-]{3,20})\/m\/([A-Za-z0-9_]{1,50})\/?$/,
    run: (_a, _e, m) => go(`/user/${m![1]}/m/${m![2]}/`, `Go to ${m![1]}’s feed ${m![2]}`),
  });
  registerCommand({
    name: 'u/<user>',
    description: 'u/<user> - go to a user’s profile',
    pattern: /^\/?u(?:ser)?\/([A-Za-z0-9_-]{3,20})\/?$/,
    run: (_a, _e, m) => go(`/user/${m![1]}/`, `Go to u/${m![1]}`),
  });
  registerCommand({
    name: 'm/<feed>',
    description: 'm/<feed> - go to one of your custom feeds',
    pattern: /^\/?m\/([A-Za-z0-9_]{1,50})\/?$/,
    run: (_a, env, m) => {
      const user = env.session?.username;
      return user
        ? go(`/user/${user}/m/${m![1]}/`, `Go to your feed ${m![1]}`)
        : signedOut('your custom feeds');
    },
  });
  registerCommand({
    name: 'me/<page>',
    description:
      'me, me/saved, me/submitted, me/comments, me/upvoted, me/hidden - your own pages (short: s, sub, c, u, h)',
    pattern: /^\/?me(?:\/([A-Za-z]*))?\/?$/,
    run: (_a, env, m) => {
      const page = ME_PAGES[(m![1] ?? '').toLowerCase()];
      if (!page)
        return message('me/ goes to saved, submitted, comments, upvoted, downvoted, hidden');
      const user = env.session?.username;
      return user ? go(`/user/${user}/${page.path}`, `Go to ${page.label}`) : signedOut(page.label);
    },
  });
  registerCommand({
    name: '[number]',
    description:
      '1 to 9, or 0 - open that numbered link in the selected post or comment (also written [3])',
    pattern: /^\[?(\d)\]?$/,
    run: (_a, _e, m) => {
      const digit = Number(m![1]);
      const n = digit === 0 ? 10 : digit;
      return { kind: 'command', target: `openLink${n}`, description: `Open link number ${digit}` };
    },
  });
  registerCommand({
    name: 'm',
    description: 'm - go to your inbox',
    run: () => go('/message/inbox/', 'Go to your inbox'),
  });
  registerCommand({
    name: 'mm',
    description: 'mm - go to moderator mail',
    run: () => go('https://mod.reddit.com/mail/all', 'Go to moderator mail'),
  });
  registerCommand({
    name: 'popular',
    description: 'popular - go to r/popular',
    run: () => go('/r/popular/', 'Go to r/popular'),
  });
  registerCommand({
    name: 'front',
    description: 'front - go to the front page',
    run: () => go('/', 'Go to the front page'),
  });
  registerCommand({
    name: '/',
    description: '',
    pattern: /^\/$/,
    run: () => go('/', 'Go to the front page'),
  });
  registerCommand({
    name: '/n /t /h /r /c',
    description:
      '/n /t /h /r /c [period] - new, top, hot, rising or controversial here; top and controversial take hour, day, week, month, year or all',
    pattern: /^\/([nthrc])(?:\s+(\S+))?$/i,
    run: (_a, env, m) => sortTarget(SHORT_SORTS[m![1]!.toLowerCase()]!, m![2], env),
  });
  registerCommand({
    name: 'hot | new | top | rising | controversial',
    description: 'hot, new, top, rising, controversial - sort this page (top [period])',
    pattern: new RegExp(`^(${SORT_WORDS.join('|')})(?:\\s+(\\S+))?$`, 'i'),
    run: (_a, env, m) => sortTarget(m![1]!.toLowerCase(), m![2], env),
  });
  registerCommand({
    name: 'search',
    aliases: ['s'],
    description: 's, search <words> - search this subreddit, or all of Reddit',
    run: (args, env) => search(args, env),
  });
  registerCommand({
    name: 'sr',
    description: 'sr <words> - search all of Reddit',
    run: (args, env) => search(args, env, true),
  });
  registerCommand({
    name: 'nav',
    description:
      'nav [category] - open the comment navigator (all, op, me, friend, tagged, popular, new, custom, highlighted ...)',
    run: (args) => {
      const category = args ? navCategory(args) : undefined;
      if (args && !category) {
        return message(
          `Unknown category “${args}”.`,
          NAV_CATEGORIES.map((c) => `${c.value} - ${c.label}`),
        );
      }
      return act(
        category ? `Open the comment navigator on “${category}”` : 'Open the comment navigator',
        (ctx) => {
          const r = sendCommand('nav', category);
          if (!r.handled || r.message)
            ctx.notices.show(r.message ?? 'REScue: the comment navigator is turned off.', {
              timeoutMs: 5000,
            });
        },
      );
    },
  });
  registerCommand({
    name: 'tag',
    description:
      'tag [text] - tag the author of the selected post or comment (no text: open the tag editor)',
    run: (args) =>
      act(args ? `Tag the selected user “${args}”` : 'Edit the tag of the selected user', (ctx) => {
        const item = ctx.ui.selection().current();
        const author = item?.model.author;
        const say = (m: string) => ctx.notices.show(m, { timeoutMs: 5000 });
        if (!item) return say('REScue: select a post or comment first (j / k), then use tag.');
        if (!author) return say('REScue: the selected item has no author to tag.');
        const api = taggerApi();
        if (!api) return say('REScue: the user tagger is turned off.');
        if (args) void api.setText(author, args).then(() => say(`Tagged ${author}: ${args}`));
        else api.edit(author, item.host);
      }),
  });
  registerCommand({
    name: 'fl',
    description: 'fl - show or hide the filter bar for this page',
    run: () =>
      act('Show or hide the filter bar', (ctx) => {
        if (!sendCommand('fl').handled)
          ctx.notices.show('REScue: filteReddit is turned off.', { timeoutMs: 5000 });
      }),
  });
  registerCommand({
    name: 'fp',
    description: 'fp - switch the filters off or on for this page view',
    run: () =>
      act('Switch the filters off or on for this page view', (ctx) => {
        if (!sendCommand('fp').handled)
          ctx.notices.show('REScue: filteReddit is turned off.', { timeoutMs: 5000 });
      }),
  });
  registerCommand({
    name: 'post',
    description:
      'post [sub] [title] [url] - open Reddit’s submit page, filled in (nothing is posted until you submit it there)',
    run: (args) => {
      const t = submitTarget(args);
      return go(t.path, t.label);
    },
  });
  registerCommand({
    name: 'settings',
    description: 'settings [feature] - open the settings console',
    run: (args, env) => {
      const d = findModule(args, env);
      return {
        kind: 'settings',
        target: d?.id ?? '',
        description: d ? `Open settings for ${d.title}` : 'Open settings',
      };
    },
  });
  registerCommand({
    name: 'toggle',
    description: 'toggle <feature> - turn a feature on or off',
    run: (args, env) => {
      const d = args ? findModule(args, env) : undefined;
      return d && !d.locked
        ? { kind: 'toggle', target: d.id, description: `Turn ${d.title} on or off` }
        : { kind: 'unknown', target: '', description: `Unknown command “toggle ${args}”` };
    },
  });
  registerCommand({
    name: '?',
    description: '? - list every command',
    run: (args, env) => {
      // `? words` searched before the list existed; keep it working.
      if (args) return search(args, env);
      const lines = listCommands()
        .map((c) => c.description)
        .filter(Boolean);
      return message('Commands (Shift+Enter: new tab, Alt+Enter: background tab)', lines);
    },
  });
}
