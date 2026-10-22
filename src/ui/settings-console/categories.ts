/**
 * The settings console's categories, in RES's order (About RES, My account, Users, Comments,
 * Submissions, Subreddits, Appearance, Browsing, Productivity, Core), and which one each module
 * lives in. A module follows the category RES gave its `resId` (lib/modules/<resId>.js sets
 * `module.category`); REScue's own modules (no `resId`) are placed by id. This is separate from the
 * module's own `category` field, which other code still reads.
 */
import type { ModuleDefinition } from '../../core/types';

export type ConsoleCategory =
  | 'about'
  | 'myAccount'
  | 'users'
  | 'comments'
  | 'submissions'
  | 'subreddits'
  | 'appearance'
  | 'browsing'
  | 'productivity'
  | 'core';

export interface CategoryInfo {
  id: ConsoleCategory;
  title: string;
  blurb: string;
}

export const CONSOLE_CATEGORIES: CategoryInfo[] = [
  {
    id: 'about',
    title: 'About REScue',
    blurb: 'Version, links, credits, troubleshooting, and backing up or restoring your settings.',
  },
  { id: 'myAccount', title: 'My account', blurb: 'How your own name, karma and dates look.' },
  { id: 'users', title: 'Users', blurb: 'Tags, highlights and info for the people you read.' },
  {
    id: 'comments',
    title: 'Comments',
    blurb: 'Reading, sorting, collapsing and navigating comments.',
  },
  {
    id: 'submissions',
    title: 'Submissions',
    blurb: 'Posts and links in listings and on thread pages.',
  },
  { id: 'subreddits', title: 'Subreddits', blurb: 'Filters and tags that follow subreddits.' },
  {
    id: 'appearance',
    title: 'Appearance',
    blurb: 'How Reddit looks: styles, votes, chat and ads.',
  },
  {
    id: 'browsing',
    title: 'Browsing',
    blurb: 'Moving around: keys, paging, redirects and prompts.',
  },
  {
    id: 'productivity',
    title: 'Productivity',
    blurb: 'Inline media, dashboard and other helpers.',
  },
  { id: 'core', title: 'Core', blurb: 'The gear menu, commands, notices, presets and sync.' },
];

/** The category RES gave each module it has (by RES module name = a definition's `resId`). */
const BY_RES_ID: Record<string, ConsoleCategory> = {
  about: 'about',
  troubleshooter: 'about',
  backupAndRestore: 'about',
  localDate: 'myAccount',
  usernameHider: 'myAccount',
  showKarma: 'myAccount',
  showParent: 'myAccount',
  profileRedirect: 'users',
  redditUserInfo: 'users',
  userHighlight: 'users',
  userTagger: 'users',
  commentHidePersistor: 'comments',
  commentNavigator: 'comments',
  commentQuickCollapse: 'comments',
  commentSortBy: 'comments',
  hideChildComments: 'comments',
  readComments: 'comments',
  saveComments: 'comments',
  newCommentCount: 'submissions',
  xPostLinks: 'submissions',
  filteReddit: 'subreddits',
  subredditManager: 'subreddits',
  subredditTagger: 'subreddits',
  voteEnhancements: 'appearance',
  stylesheet: 'appearance',
  styleTweaks: 'appearance',
  commentStyle: 'appearance',
  quarantineHide: 'appearance',
  nightMode: 'appearance',
  keyboardNav: 'browsing',
  logoLink: 'browsing',
  pageNavigator: 'browsing',
  searchHelper: 'browsing',
  autoHide: 'browsing',
  wheelBrowse: 'browsing',
  singleClick: 'browsing',
  neverEndingReddit: 'browsing',
  disableChat: 'productivity',
  tableTools: 'productivity',
  showImages: 'productivity',
  dashboard: 'productivity',
  commandLine: 'core',
  presets: 'core',
  customToggles: 'core',
  menu: 'core',
  penaltyBox: 'core',
  notifications: 'core',
};

/** REScue's own modules (no RES counterpart), and the few that need a place other than their RES one. */
const BY_MODULE_ID: Record<string, ConsoleCategory> = {
  resImport: 'about',
  hidePromoted: 'appearance',
  headerButton: 'core',
  profileNavigator: 'browsing',
  easterEgg: 'appearance',
  oldRedditSkin: 'appearance',
  neutralityFilter: 'subreddits',
  interstitials: 'browsing',
  oldRedditRedirect: 'browsing',
  linksNewTab: 'comments',
  commentTools: 'comments',
  threadSubscriptions: 'comments',
  // RES sourceSnudown's "source" button (feature-matrix row still Deferred, so no resId).
  showSource: 'comments',
  hideLinks: 'submissions',
  hoverCardActions: 'users',
  importBlocked: 'users',
  hover: 'core',
  noticeSettings: 'core',
  quickToggles: 'core',
  dashboard: 'productivity',
};

/** Used only for a module that is in neither table above (a newly added one). */
const BY_LEGACY: Record<ModuleDefinition['category'], ConsoleCategory> = {
  core: 'core',
  listings: 'browsing',
  comments: 'comments',
  users: 'users',
  actions: 'browsing',
  appearance: 'appearance',
};

/** True when the module has an explicit place (rather than the fallback from its old category). */
export function hasExplicitCategory(d: ModuleDefinition): boolean {
  return d.id in BY_MODULE_ID || (!!d.resId && d.resId in BY_RES_ID);
}

export function consoleCategoryOf(d: ModuleDefinition): ConsoleCategory {
  return BY_MODULE_ID[d.id] ?? (d.resId ? BY_RES_ID[d.resId] : undefined) ?? BY_LEGACY[d.category];
}

/** Old deep-link / category names from before the RES-style categories. */
const LEGACY_TARGETS: Record<string, ConsoleCategory> = {
  listings: 'browsing',
  actions: 'browsing',
};

/** The category a `#rescue:settings/<name>` target names (new id, old id or title), if any. */
export function categoryFromTarget(target: string | undefined): ConsoleCategory | undefined {
  if (!target) return undefined;
  const t = target.toLowerCase();
  const hit = CONSOLE_CATEGORIES.find(
    (c) => c.id.toLowerCase() === t || c.title.toLowerCase() === t,
  );
  return hit?.id ?? LEGACY_TARGETS[t];
}

/** Modules grouped by console category, each group in registry order. */
export function groupByCategory(
  defs: ModuleDefinition[],
): Map<ConsoleCategory, ModuleDefinition[]> {
  const out = new Map<ConsoleCategory, ModuleDefinition[]>(
    CONSOLE_CATEGORIES.map((c) => [c.id, []]),
  );
  for (const d of defs) out.get(consoleCategoryOf(d))!.push(d);
  return out;
}
