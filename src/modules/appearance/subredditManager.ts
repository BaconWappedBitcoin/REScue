/**
 * subredditManager (RES subredditManager, shortcut bar, US8): a slim REScue bar with the
 * subreddits and links you chose, in your order, that you manage in the bar itself. Ported in
 * spirit from RES lib/modules/subredditManager.js (GPL-3.0, the RES contributors, commit 4defffc);
 * the code is new.
 *
 * Placement: a small fixed bar in the bottom-left corner. It is REScue's own element, so it never
 * covers Reddit's header and never shifts Reddit's layout; REScue's tool strip keeps the
 * bottom-right corner. Every link goes to a path on Reddit itself (never to another site).
 *
 * The files: shortcutModel.ts (rows and edits, no DOM), shortcutBar.ts (the bar), shortcutPopup.ts
 * (the add/edit popup) and shortcutStyle.ts. Every change in the bar writes the same `subreddits`
 * table option as the settings console, so the console stays the full editor and both follow
 * each other live.
 *
 * "my subreddits" (shortcutMine.ts): a dropdown of your subscriptions with a search box and an
 * "import" action, read from Reddit's own same-origin /subreddits/mine.json (read-only, your
 * session, only when you press it; PRIVACY.md). Signed out it is disabled with a sign-in hint.
 * Also here (shortcutVisits.ts): a separate list per account (shortcutsPerAccount), the last
 * visit to each subreddit kept on this device for a "Last visited" sort (storeSubredditVisit), the
 * group-menu and edit-word delays, capital letters (allowLowercase) and the RandNSFW link.
 * The "mail ▾" and "feeds ▾" words (barMenus.ts) are RES messageMenu and multiredditNavbar, moved
 * from Reddit's header (not reachable) into this bar; the feeds come from /api/multi/mine.json.
 * Not built: RES's subscribe buttons and the MyRandom/Users links, which are Reddit's own features
 * now.
 */
import { jsonFor } from '../../core/redditJson';
import { moduleOn, optionOf, setOption } from '../../core/settings';
import { defineModule, type ModuleContext, type Route } from '../../core/types';
import {
  DEFAULT_MAIL_LINKS,
  DEFAULT_SECTION_LINKS,
  forgetMenus,
  mailHref,
  sectionPath,
  type MailLink,
  type MenuHost,
  type SectionLink,
} from './barMenus';
import { removeBar, renderBar, type BarCtx } from './shortcutBar';
import { fetchSubscriptions, forgetMine } from './shortcutMine';
import { FORMAT_HELP, migrateRows, shortcutHref, type RawRow, type Visits } from './shortcutModel';
import {
  accountKey,
  inIncognito,
  mayRecordVisit,
  recordVisit,
  releaseAccounts,
  sanitizeAccounts,
  sanitizeVisits,
  switchAccount,
  type AccountLists,
} from './shortcutVisits';
import { STYLE, STYLE_ID } from './shortcutStyle';
import { removeStyle, setStyle } from './injectedStyle';

export { shortcutHref, shortcutLabel } from './shortcutModel';

/** The slice of the module context this file uses (named in full to keep the types non-circular). */
interface Ctx extends BarCtx {
  route: Route;
  settings: ModuleContext['settings'];
  notices: ModuleContext['notices'];
  store: ModuleContext['store'];
  moduleId: string;
  options: BarCtx['options'] & {
    shortcutsPerAccount?: boolean;
    storeSubredditVisitIncognito?: boolean;
    linkMail?: boolean;
    mailLinks?: MailLink[];
    mailHoverDelay?: number;
    linkFeeds?: boolean;
    feedSectionLinks?: SectionLink[];
    feedsHoverDelay?: number;
  };
}

/** What the module remembers on this device between pages (its scoped storage). */
let visits: Visits = {};
let accounts: AccountLists = { lists: {} };
/** True once the remembered data has been read; until then nothing is written back over it. */
let loaded = false;
/** The undated rows last saved back with dates, so drawing them again does not save them again. */
let migratedFrom: readonly RawRow[] | null = null;
let migratedVia: unknown = null;
/** The newest context the module was given, for the read that finishes after the first draw. */
let latest: Ctx | null = null;
/** Changes on every init and dispose, so a read that finishes late does not draw a removed bar. */
let epoch = 0;

/**
 * Per-account lists (RES shortcutsPerAccount): put this account's list into the option when the
 * signed-in account changed since the bar was last drawn. Returns the rows to draw.
 */
async function applyAccount(ctx: Ctx): Promise<RawRow[]> {
  if (!ctx.options.shortcutsPerAccount) {
    if (accounts.current !== undefined) {
      accounts = releaseAccounts(accounts);
      ctx.store.set('accounts', accounts);
    }
    return ctx.options.subreddits;
  }
  const out = switchAccount(accounts, accountKey(ctx.session), ctx.options.subreddits);
  accounts = out.state;
  ctx.store.set('accounts', accounts);
  if (!out.rows) return ctx.options.subreddits;
  await ctx.settings.save(
    setOption(ctx.settings.profile(), subredditManager, 'subreddits', out.rows as never),
  );
  return out.rows;
}

/** Remember that the subreddit on this page was opened (RES storeSubredditVisit). */
function noteVisit(ctx: Ctx, route: Route): void {
  const o = {
    storeSubredditVisit: ctx.options.storeSubredditVisit !== false,
    storeSubredditVisitIncognito: ctx.options.storeSubredditVisitIncognito === true,
  };
  if (route.kind !== 'subreddit' || !mayRecordVisit(o, inIncognito())) return;
  const next = recordVisit(visits, route.subreddit, Date.now());
  if (next === visits) return;
  visits = next;
  ctx.store.set('visits', visits);
}

/**
 * Draw the bar. Rows saved before the date column existed get a date first: the bar shows them
 * dated at once, and the dated rows are saved back so "date added" keeps their order.
 */
function sync(ctx: Ctx, rows: RawRow[] = ctx.options.subreddits): void {
  const migrated = migrateRows(rows, Date.now());
  // The dashboard module owns the choice to put its word in the bar; the bar only follows it.
  const linkDashboard =
    moduleOn(ctx.settings, 'dashboard') &&
    optionOf(ctx.settings, 'dashboard', 'dashboardShortcut') === true;
  const view: Ctx = {
    ...ctx,
    visits,
    options: { ...ctx.options, subreddits: migrated.rows, linkDashboard },
  };
  const save = async (next: RawRow[]): Promise<void> => {
    if (loaded && ctx.options.shortcutsPerAccount) {
      accounts = { ...accounts, lists: { ...accounts.lists, [accountKey(ctx.session)]: next } };
      ctx.store.set('accounts', accounts);
    }
    await ctx.settings.save(
      setOption(ctx.settings.profile(), subredditManager, 'subreddits', next as never),
    );
  };
  const getJson = jsonFor(ctx.notices, ctx.moduleId);
  const mine = ctx.options.showMySubreddits
    ? {
        signedIn: ctx.session.signedIn,
        list: (force?: boolean) => fetchSubscriptions(getJson, force),
      }
    : undefined;
  renderBar(view, save, mine, menuHost(ctx, getJson));
  // Dated rows are saved back once per set of rows, however often the bar is drawn meanwhile.
  if (migrated.changed && (migratedFrom !== rows || migratedVia !== ctx.settings)) {
    migratedFrom = rows;
    migratedVia = ctx.settings;
    save(migrated.rows).catch(() => {});
  }
}

/** The mail and feeds words (barMenus.ts); the feeds are read only when that menu is opened. */
function menuHost(ctx: Ctx, getJson: ReturnType<typeof jsonFor>): MenuHost {
  const o = ctx.options;
  return {
    signedIn: ctx.session.signedIn,
    mail:
      o.linkMail !== false
        ? { links: o.mailLinks ?? DEFAULT_MAIL_LINKS, hoverDelay: o.mailHoverDelay ?? 1000 }
        : undefined,
    feeds:
      o.linkFeeds !== false
        ? {
            sections: o.feedSectionLinks ?? DEFAULT_SECTION_LINKS,
            hoverDelay: o.feedsHoverDelay ?? 1000,
            load: async () => {
              const res = await getJson('multis', {});
              return res.ok ? res.data : null;
            },
          }
        : undefined,
  };
}

/** Draw the bar; first switch the list to this account's own when the account changed. */
async function refresh(ctx: Ctx): Promise<void> {
  if (!loaded) return sync(ctx);
  const mine = epoch;
  const own = ctx.options.shortcutsPerAccount
    ? accounts.current === accountKey(ctx.session)
    : accounts.current === undefined;
  const rows = own ? ctx.options.subreddits : await applyAccount(ctx);
  if (mine !== epoch) return; // the module was turned off meanwhile
  // A newer context may have drawn while this waited: draw with that one, not over it.
  const cur = latest ?? ctx;
  sync(cur, rows === ctx.options.subreddits ? cur.options.subreddits : rows);
}

async function loadSaved(ctx: Ctx, mine: number): Promise<void> {
  const [v, a] = await Promise.all([ctx.store.get('visits'), ctx.store.get('accounts')]);
  if (mine !== epoch) return;
  visits = sanitizeVisits(v);
  accounts = sanitizeAccounts(a);
  loaded = true;
  // The settings or the page may have changed while this was being read: use the latest.
  const now = latest ?? ctx;
  noteVisit(now, now.route);
  await refresh(now);
}

export const subredditManager = defineModule({
  id: 'subredditManager',
  resId: 'subredditManager',
  category: 'appearance',
  title: 'Subreddit shortcut bar',
  description:
    'A slim bar in the bottom-left corner with your chosen subreddits and links, in your order. Hover a link to edit or delete it (or right-click it), press + to add one, drag links to reorder them or onto the delete zone, or sort them. A group such as a+b lists its subreddits when you hover it. On a subreddit page a “+shortcut” button adds it, and “−shortcut” removes it. The “my subreddits” word lists your subscriptions, with a search box, and can add the ones you tick to the bar. It reads them from Reddit (one read-only request per page of 100, only when you press it, kept for about an hour); signed out it is disabled. Signed in, “mail ▾” lists your mail pages and “feeds ▾” your custom feeds with their hot, new and top pages.',
  enabledByDefault: false,
  options: {
    subreddits: {
      type: 'table',
      default: [],
      title: 'Shortcuts, in order',
      description: FORMAT_HELP,
      columns: [
        { key: 'target', title: 'Subreddit or path', type: 'text' },
        { key: 'label', title: 'Label (optional)', type: 'text' },
      ],
      validateRow: (row) =>
        typeof row.target === 'string' && row.target.trim() !== '' && !shortcutHref(row.target)
          ? FORMAT_HELP
          : null,
    },
    showDefaults: {
      type: 'boolean',
      default: true,
      title: 'Start with Home and r/popular',
    },
    linkRandom: { type: 'boolean', default: false, title: 'Show a Random link (r/random)' },
    linkFriends: {
      type: 'boolean',
      default: false,
      title: 'Show a Friends link (signed in)',
    },
    linkMod: { type: 'boolean', default: false, title: 'Show a Mod link (signed in)' },
    linkModqueue: {
      type: 'boolean',
      default: false,
      title: 'Show a Modqueue link (signed in)',
    },
    linkRandNSFW: { type: 'boolean', default: false, title: 'Show a RandNSFW link (r/randnsfw)' },
    linkSaved: {
      type: 'boolean',
      default: false,
      title: 'Show a Saved link to your saved posts and comments (signed in)',
    },
    showMySubreddits: {
      type: 'boolean',
      default: true,
      title: 'Show a “my subreddits” control (signed in)',
      description: 'Lists the subreddits you subscribe to and can add them to this bar.',
    },
    linkMail: {
      type: 'boolean',
      default: true,
      title: 'Show a mail menu',
      description:
        'A “mail ▾” word (signed in) that lists your inbox, unread, sent and other mail pages. RES put this menu on Reddit’s mail icon; REScue keeps it in this bar.',
    },
    mailLinks: {
      type: 'table',
      default: DEFAULT_MAIL_LINKS.map((l) => ({ ...l })),
      dependsOn: 'linkMail',
      title: 'Links in the mail menu',
      description:
        'Each address is a path on Reddit (such as /message/unread/) or on https://mod.reddit.com.',
      columns: [
        { key: 'text', title: 'Text', type: 'text' },
        { key: 'url', title: 'Address', type: 'text' },
      ],
      validateRow: (row) =>
        typeof row.url === 'string' && row.url.trim() !== '' && !mailHref(row.url)
          ? 'Use a path on Reddit, such as /message/inbox/, or an address on https://mod.reddit.com.'
          : null,
    },
    mailHoverDelay: {
      type: 'number',
      default: 1000,
      min: 0,
      max: 5000,
      dependsOn: 'linkMail',
      title: 'Delay before the mail menu opens on hover (milliseconds)',
      description:
        'A click, or Enter, opens it at once. It closes a moment after the pointer leaves.',
    },
    linkFeeds: {
      type: 'boolean',
      default: true,
      title: 'Show a custom-feeds menu',
      description:
        'A “feeds ▾” word (signed in) that lists your custom feeds; hover one (or press →) for its hot, new, top and other pages. The list is read from Reddit (one read-only request, only when you open the menu, kept for about an hour).',
    },
    feedSectionLinks: {
      type: 'table',
      default: DEFAULT_SECTION_LINKS.map((l) => ({ ...l })),
      dependsOn: 'linkFeeds',
      title: 'Pages listed for each custom feed',
      description:
        'Added to the end of the feed’s address: empty for hot, new/ for new, top/?t=week for the week’s top.',
      columns: [
        { key: 'text', title: 'Text', type: 'text' },
        { key: 'path', title: 'Added to the address', type: 'text' },
      ],
      validateRow: (row) =>
        typeof row.path === 'string' && sectionPath(row.path) === null
          ? 'Use letters, digits and slashes only, such as new/ or top/?t=week.'
          : null,
    },
    feedsHoverDelay: {
      type: 'number',
      default: 1000,
      min: 0,
      max: 5000,
      dependsOn: 'linkFeeds',
      title: 'Delay before the custom-feeds menu opens on hover (milliseconds)',
    },
    showAddCurrent: {
      type: 'boolean',
      default: true,
      title: 'Show a “+shortcut” / “−shortcut” button on subreddit pages',
    },
    shortcutsPerAccount: {
      type: 'boolean',
      default: true,
      title: 'Keep a separate shortcut list for each account',
      description:
        'Signing in as another account (or signing out) shows that account’s own list; the list above is always the one for the account on this page. Off: one list for everyone.',
    },
    shortcutDropdownDelay: {
      type: 'number',
      default: 200,
      min: 0,
      max: 5000,
      title: 'Delay before a group’s subreddit list opens (milliseconds)',
      description: 'Hovering a group such as a+b waits this long. The keyboard opens it at once.',
    },
    shortcutEditDropdownDelay: {
      type: 'number',
      default: 0,
      min: 0,
      max: 10000,
      title: 'Delay before the “edit” word appears on hover (milliseconds)',
      description:
        'RES waited 3000 ms; 0 shows it at once, as before. Right-clicking a link edits it without waiting.',
    },
    allowLowercase: {
      type: 'boolean',
      default: true,
      title: 'Show shortcut names as written (off: capital letters)',
      description:
        'Off shows every shortcut in capitals, as old Reddit’s bar did. The text itself is not changed.',
    },
    storeSubredditVisit: {
      type: 'boolean',
      default: true,
      advanced: true,
      title: 'Remember when I last visited each subreddit',
      description:
        'Kept on this device only, and used for the “Last visited” sort of the bar. Off: nothing is recorded.',
    },
    storeSubredditVisitIncognito: {
      type: 'boolean',
      default: false,
      advanced: true,
      dependsOn: 'storeSubredditVisit',
      title: 'Also remember visits made in private windows',
    },
  },

  init(ctx) {
    setStyle(STYLE_ID, STYLE);
    visits = {};
    accounts = { lists: {} };
    loaded = false;
    latest = ctx;
    const mine = ++epoch;
    // What was remembered is read after the first draw, so the bar never holds up the other
    // features' start; it is drawn again as soon as it is known (a per-account list may replace it).
    sync(ctx);
    void loadSaved(ctx, mine);
  },

  onSettings(ctx) {
    latest = ctx;
    void refresh(ctx);
  },

  onRoute(route, ctx) {
    latest = { ...ctx, route };
    if (loaded) noteVisit(ctx, route);
    void refresh(ctx);
  },

  dispose() {
    epoch++;
    latest = null;
    forgetMine();
    forgetMenus();
    removeBar();
    removeStyle(STYLE_ID);
  },
});
