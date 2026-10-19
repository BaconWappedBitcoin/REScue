import { describe, expect, it } from 'vitest';
import { MODULES } from '../../src/modules';
import {
  CONSOLE_CATEGORIES,
  categoryFromTarget,
  consoleCategoryOf,
  groupByCategory,
  hasExplicitCategory,
  type ConsoleCategory,
} from '../../src/ui/settings-console/categories';

/** Module id -> the RES-style category it is listed under (see categories.ts). */
const EXPECTED: Record<string, ConsoleCategory> = {
  about: 'about',
  troubleshooter: 'about',
  backupAndRestore: 'about',
  resImport: 'about',
  localDate: 'myAccount',
  usernameHider: 'myAccount',
  showKarma: 'myAccount',
  showParent: 'myAccount',
  userTagger: 'users',
  userHighlight: 'users',
  redditUserInfo: 'users',
  profileRedirect: 'users',
  hoverCardActions: 'users',
  importBlocked: 'users',
  commentHidePersistor: 'comments',
  commentNavigator: 'comments',
  commentQuickCollapse: 'comments',
  commentSortBy: 'comments',
  hideChildComments: 'comments',
  readComments: 'comments',
  saveComments: 'comments',
  linksNewTab: 'comments',
  threadSubscriptions: 'comments',
  newCommentCount: 'submissions',
  xPostLinks: 'submissions',
  filteReddit: 'subreddits',
  subredditTagger: 'subreddits',
  subredditManager: 'subreddits',
  neutralityFilter: 'subreddits',
  voteEnhancements: 'appearance',
  stylesheet: 'appearance',
  styleTweaks: 'appearance',
  commentStyle: 'appearance',
  quarantineHide: 'appearance',
  hidePromoted: 'appearance',
  easterEgg: 'appearance',
  keyboardNav: 'browsing',
  keyboardNavExtras: 'browsing',
  keyboardActions: 'browsing',
  logoLink: 'browsing',
  pageNavigator: 'browsing',
  searchHelper: 'browsing',
  autoHide: 'browsing',
  wheelBrowse: 'browsing',
  singleClick: 'browsing',
  feedPause: 'browsing',
  interstitials: 'browsing',
  oldRedditRedirect: 'browsing',
  profileNavigator: 'browsing',
  disableChat: 'productivity',
  tableTools: 'productivity',
  mediaViewer: 'productivity',
  dashboard: 'productivity',
  commandLine: 'core',
  presets: 'core',
  customToggles: 'core',
  settingsConsole: 'core',
  penaltyBox: 'core',
  headerButton: 'core',
  hover: 'core',
  noticeSettings: 'core',
  quickToggles: 'core',
};

describe('settings console categories', () => {
  it('places every registered module in a RES-style category', () => {
    const valid = new Set(CONSOLE_CATEGORIES.map((c) => c.id));
    for (const d of MODULES) expect(valid.has(consoleCategoryOf(d)), d.id).toBe(true);
    const grouped = groupByCategory(MODULES);
    expect([...grouped.values()].reduce((n, l) => n + l.length, 0)).toBe(MODULES.length);
  });

  it('gives every module an explicit place, matching the table', () => {
    for (const d of MODULES) {
      // The inline media module shares RES's "showImages" with the viewer.
      if (d.resId === 'showImages') {
        expect(consoleCategoryOf(d), d.id).toBe('productivity');
        continue;
      }
      expect(hasExplicitCategory(d), `${d.id} needs an entry in categories.ts`).toBe(true);
      if (EXPECTED[d.id]) expect(consoleCategoryOf(d), d.id).toBe(EXPECTED[d.id]);
    }
  });

  it('keeps RES’s category order and understands old and new deep-link names', () => {
    expect(CONSOLE_CATEGORIES.map((c) => c.title)).toEqual([
      'About REScue',
      'My account',
      'Users',
      'Comments',
      'Submissions',
      'Subreddits',
      'Appearance',
      'Browsing',
      'Productivity',
      'Core',
    ]);
    expect(categoryFromTarget('listings')).toBe('browsing');
    expect(categoryFromTarget('comments')).toBe('comments');
    expect(categoryFromTarget('My account')).toBe('myAccount');
    expect(categoryFromTarget('nope')).toBeUndefined();
  });
});
