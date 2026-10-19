/**
 * Commands that act on the selected item's links: the numbered links (RES keyboardNav link
 * numbers, keys 1-9 and 0) and copying the permalink or link URL. Ported in spirit from RES
 * lib/modules/keyboardNav.js (GPL-3.0, commit 4defffc).
 */
import type { Command } from '../../../core/keys';
import { webUrl } from '../../../core/tabs';
import type { Comment } from '../../../model/types';
import { toggleSavedComment } from '../../comments/saveComments';
import { commentsOf, linkOf, navHelpers, type NavEnv } from './env';
import { digitOf, MAX_LINK_NUMBERS, numberedLinks } from './linkNumbers';

/** Copy `text` to the clipboard and say so (or say it failed). */
export async function copyText(env: NavEnv, text: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    env.ctx.notices.show(`Copied the ${what}.`, { id: 'copy-result', timeoutMs: 2500 });
    return true;
  } catch {
    env.ctx.notices.show(`REScue could not copy the ${what}.`, {
      id: 'copy-result',
      kind: 'warning',
      timeoutMs: 4000,
    });
    return false;
  }
}

export function linkCommands(env: NavEnv): Command[] {
  const { cur, go, newTab } = navHelpers(env);

  const openNumbered =
    (index: number) =>
    (e: KeyboardEvent): boolean => {
      const prefs = env.linkNumbers();
      // Run by id (no key) counts as a plain press.
      const alt = e.altKey;
      if (!prefs.enabled || (prefs.keys === 'alt' && !alt && e.key)) return false;
      const url = webUrl(numberedLinks(cur())[index]?.href);
      if (!url) return false;
      // In digit mode Alt+digit is RES's "other way": new tab when the option says same tab.
      const inNewTab = prefs.keys === 'digit' && alt ? !prefs.newTab : prefs.newTab;
      return inNewTab ? newTab(url) : go(url);
    };

  const numbers: Command[] = Array.from({ length: MAX_LINK_NUMBERS }, (_, i) => ({
    id: `openLink${i + 1}`,
    title: `Open link number ${digitOf(i)} in the selected item`,
    defaultKeys: [digitOf(i), `alt+${digitOf(i)}`],
    section: 'Link numbers',
    enabled: () => env.linkNumbers().enabled && !!cur(),
    run: openNumbered(i),
  }));

  const copy = (url: string | null, what: string): boolean => {
    if (!url) return false;
    void copyText(env, url, what);
    return true;
  };

  return [
    ...numbers,
    {
      id: 'copyPermalink',
      title: 'Copy the permalink',
      defaultKeys: ['y'],
      section: 'Open',
      enabled: () => !!cur(),
      run: () => copy(commentsOf(cur()), 'permalink'),
    },
    // REScue's `y` copies the permalink (RES's Ctrl+Y opens it), so opening it is bound to Ctrl+Y.
    {
      id: 'followPermalink',
      title: 'Open the permalink (the post’s comments page, or the comment’s own page)',
      defaultKeys: ['ctrl+y'],
      section: 'Open',
      enabled: () => !!cur(),
      run: () => go(commentsOf(cur())),
    },
    {
      id: 'followPermalinkNewTab',
      title: 'Open the permalink in a new tab',
      defaultKeys: ['ctrl+shift+y'],
      section: 'Open',
      enabled: () => !!cur(),
      run: () => newTab(commentsOf(cur())),
    },
    {
      id: 'followLinkNewTab',
      title: 'Open only the post’s link in a new tab (no comments)',
      defaultKeys: ['alt+o'],
      section: 'Open',
      enabled: () => cur()?.kind === 'post',
      run: () => newTab(linkOf(cur())),
    },
    {
      id: 'saveRES',
      title: 'Save the selected comment with save-RES (again to unsave)',
      defaultKeys: ['shift+s'],
      context: 'comments',
      section: 'Open',
      enabled: () => cur()?.kind === 'comment',
      run: () => {
        const it = cur();
        return it?.kind === 'comment' && toggleSavedComment(it.model as Comment);
      },
    },
    {
      id: 'copyLink',
      title: 'Copy the post’s link',
      defaultKeys: ['shift+y'],
      section: 'Open',
      enabled: () => !!cur(),
      run: () => copy(linkOf(cur()), 'link'),
    },
  ];
}
