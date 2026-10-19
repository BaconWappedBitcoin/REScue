/** quarantineHide, profileRedirect and oldRedditRedirect (US1, T058). */
import { defineModule, type Route } from '../../core/types';
import { isQuarantinePrompt } from '../../model/interstitials';

export const quarantineHide = defineModule({
  id: 'quarantineHide',
  resId: 'quarantineHide',
  category: 'listings',
  title: 'Quarantine notice',
  description:
    'When a community is quarantined, Reddit asks you to confirm before showing it. REScue explains what happened and leaves the choice to you; it never confirms for you.',
  enabledByDefault: true,
  options: {},
  init(ctx) {
    const check = () => {
      if (isQuarantinePrompt())
        ctx.notices.show(
          'This community is quarantined. Use Reddit’s own prompt to choose whether to view it.',
          { id: 'quarantine' },
        );
    };
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', check, { once: true });
    else check();
  },
});

type Tab = 'overview' | 'submitted' | 'comments' | 'custom';

/** A custom landing page: letters, digits and - _ . in slash-separated parts, nothing else. */
const CUSTOM_PATH = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/;

/** The custom page as a clean path ("saved", "upvoted"), or null when it is blank or not safe. */
export function customLandingPath(raw: string): string | null {
  const t = raw.trim().replace(/^\/+|\/+$/g, '');
  return CUSTOM_PATH.test(t) && !t.includes('..') ? t : null;
}

export function profileRedirectTarget(route: Route, tab: Tab, custom = ''): string | null {
  if (route.kind !== 'profile' || !route.username || tab === 'overview') return null;
  const parts = route.path.split('/').filter(Boolean);
  if (parts.length > 2) return null; // the reader chose a tab explicitly
  const page = tab === 'custom' ? customLandingPath(custom) : tab;
  return page ? `/user/${route.username}/${page}/` : null;
}

export const profileRedirect = defineModule({
  id: 'profileRedirect',
  resId: 'profileRedirect',
  category: 'listings',
  title: 'Default profile tab',
  description: 'Open user profiles on the tab you prefer.',
  enabledByDefault: true,
  options: {
    tab: {
      type: 'enum',
      default: 'overview',
      title: 'Open profiles on',
      values: [
        { value: 'overview', label: 'Overview' },
        { value: 'submitted', label: 'Posts' },
        { value: 'comments', label: 'Comments' },
        { value: 'custom', label: 'Another page (set below)' },
      ],
    },
    customFromLandingPage: {
      type: 'text',
      default: '',
      dependsOn: 'tab',
      title: 'Another page to open profiles on',
      description:
        'Used when “Another page” is chosen: the part after the user name, such as saved, upvoted, downvoted, hidden or comments. Letters, digits and - _ only.',
    },
  },
  init(ctx) {
    const to = profileRedirectTarget(
      ctx.route,
      ctx.options.tab as Tab,
      ctx.options.customFromLandingPage,
    );
    if (to) location.replace(to + location.search);
  },
  onRoute(route, ctx) {
    const to = profileRedirectTarget(
      route,
      ctx.options.tab as Tab,
      ctx.options.customFromLandingPage,
    );
    if (to) location.replace(to + location.search);
  },
});

/** Settings switch for src/entrypoints/oldreddit.content.ts (which reads it from storage). */
export const oldRedditRedirect = defineModule({
  id: 'oldRedditRedirect',
  category: 'listings',
  title: 'Open old.reddit links here',
  description:
    'old.reddit now asks for an account on most pages. Links to it open the same page on Reddit’s current site instead, where REScue shows it. Turn off if you still use old.reddit while signed in.',
  enabledByDefault: true,
  options: {},
});
