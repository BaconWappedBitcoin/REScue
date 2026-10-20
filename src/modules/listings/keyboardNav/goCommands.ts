/**
 * Go mode (RES keyboardNav goMode): `g` then a key jumps to a page. Keys are RES's, without RES's
 * /r/all keys (Reddit now redirects r/all to the home feed). Ported in spirit from RES lib/modules/keyboardNav.js (GPL-3.0, commit 4defffc).
 */
import type { Command } from '../../../core/keys';
import { navHelpers, type NavEnv } from './env';

/** Reddit's modmail lives on its own host. */
export const MODMAIL_URL = 'https://mod.reddit.com/mail';

export function goCommands(env: NavEnv): Command[] {
  const { go, newTab } = navHelpers(env);
  const section = 'Go to';
  const user = (): string | null => {
    const name = env.ctx.session.username;
    return name ? `/user/${encodeURIComponent(name)}/` : null;
  };
  const page = (
    id: string,
    title: string,
    keys: string[],
    target: () => string | null,
    inNewTab = false,
  ): Command => ({
    id,
    title,
    defaultKeys: keys,
    section,
    run: () => (inNewTab ? newTab(abs(target())) : go(target())),
  });

  return [
    page('frontPage', 'Front page', ['g f'], () => '/'),
    page('subredditFrontPage', 'This subreddit’s front page', ['g shift+f'], () => {
      const sub = env.route().subreddit;
      return sub ? `/r/${encodeURIComponent(sub)}/` : null;
    }),
    page('slashPopular', '/r/popular', ['g p'], () => '/r/popular/'),
    page('randomSubreddit', 'A random subreddit', ['g alt+y'], () => '/r/random/'),
    page('inbox', 'Inbox', ['g i'], () => '/message/inbox/'),
    page('inboxNewTab', 'Inbox, in a new tab', ['g shift+i'], () => '/message/inbox/', true),
    page('modmail', 'Modmail', ['g m'], () => MODMAIL_URL),
    page('modmailNewTab', 'Modmail, in a new tab', ['g shift+m'], () => MODMAIL_URL, true),
    page('profile', 'My profile', ['g u'], user),
    page('profileNewTab', 'My profile, in a new tab', ['g shift+u'], user, true),
  ];
}

/** Absolute URL for a site-relative path (new tabs are opened by the background). */
function abs(path: string | null): string | null {
  return path ? new URL(path, location.origin).href : null;
}
