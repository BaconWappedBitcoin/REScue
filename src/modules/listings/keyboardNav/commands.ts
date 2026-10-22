/**
 * Keyboard command table. Default keys are RES's (lib/modules/keyboardNav.js, GPL-3.0, Copyright
 * (C) the Reddit Enhancement Suite contributors, commit 4defffc), translated from RES's
 * [keyCode, alt, ctrl, shift, meta] arrays and re-targeted to Reddit's own posts and comments.
 * Voting, replying (r) and editing (e) are bound with the signed-in actions
 * (modules/actions/keyboardActions.ts); saving and hiding are not bound until their Reddit controls
 * are verified (constitution Principle II). New commands are added by appending to a table; go
 * mode and link keys have their own files.
 *
 * Where RES and REScue differ, REScue's binding is kept: `c` works on both listings and threads
 * (RES uses `c` for child comments in threads), so RES's thread-only meaning of shift+C (show all
 * child comments) is not bound here. `r` is RES's: "go to subreddit" everywhere except with a
 * comment selected, where it replies; followSubreddit steps aside for comments for that reason.
 */
import { webUrl } from '../../../core/tabs';
import type { Command } from '../../../core/keys';
import { focusSearchBox, ownDetails, toggleCommentCollapse } from '../../../model/access';
import type { Post } from '../../../model/types';
import { commentsOf, linkOf, navHelpers, type NavEnv } from './env';
import { goCommands } from './goCommands';
import { linkCommands } from './linkCommands';

/** A REScue popup or menu that is open (each closes itself on Escape). */
const OPEN_POPUP =
  '.rescue-overlay[role="dialog"]:not([hidden]), .rescue-overlay[role="menu"]:not([hidden]), ' +
  '.rescue-sc-menu[role="menu"]:not([hidden]), .rescue-tag-editor, .rescue-tags-manager';

export { commentsOf, linkOf, type NavEnv };

export function scrollToBottom(): void {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
}

export function buildCommands(env: NavEnv): Command[] {
  const { cur, go, newTab, follow, thread, listing } = navHelpers(env);
  const sel = () => env.sel();
  const both = (active: boolean): boolean => {
    const urls = [...new Set([linkOf(cur()), commentsOf(cur())].filter((u): u is string => !!u))];
    if (!urls.length) return false;
    env.openTabs(urls, active);
    return true;
  };
  const authorUrl = (): string | null => {
    const author = cur()?.model.author;
    return author ? webUrl(`/user/${encodeURIComponent(author)}/`) : null;
  };
  const subredditUrl = (): string | null => {
    const it = cur();
    const sub = it?.kind === 'post' ? (it.model as Post).subreddit : '';
    return sub ? webUrl(`/r/${encodeURIComponent(sub)}/`) : null;
  };
  /** Enter on a focused link or button belongs to that control, not to the selection. */
  const onControl = (e: KeyboardEvent): boolean => {
    const t = e.composedPath()[0];
    return (
      e.key === 'Enter' &&
      t instanceof Element &&
      !!t.closest('a[href], button, summary, [role="button"], [role="link"]')
    );
  };

  const movement: Command[] = [
    {
      id: 'moveDown',
      title: 'Move down',
      defaultKeys: ['j'],
      section: 'Move',
      run: () => {
        const s = sel();
        if (s.move(1)) return true;
        // On the last loaded item: scroll to the bottom so Reddit loads more; the next j continues.
        if (!s.current()) return false;
        scrollToBottom();
        return true;
      },
    },
    {
      id: 'moveUp',
      title: 'Move up',
      defaultKeys: ['k'],
      section: 'Move',
      run: () => sel().move(-1),
    },
    {
      id: 'moveTop',
      title: 'Move to the first post',
      defaultKeys: ['shift+k'],
      context: 'listing',
      section: 'Move',
      enabled: listing,
      run: () => sel().edge('first'),
    },
    {
      id: 'moveBottom',
      title: 'Move to the last loaded post',
      defaultKeys: ['shift+j'],
      context: 'listing',
      section: 'Move',
      enabled: listing,
      run: () => sel().edge('last'),
    },
    {
      id: 'moveUpSibling',
      title: 'Previous comment at this level (previous thread for a top-level comment)',
      defaultKeys: ['shift+k'],
      context: 'comments',
      section: 'Move',
      enabled: thread,
      run: () => sel().moveSibling(-1),
    },
    {
      id: 'moveDownSibling',
      title: 'Next comment at this level (next thread for a top-level comment)',
      defaultKeys: ['shift+j'],
      context: 'comments',
      section: 'Move',
      enabled: thread,
      run: () => sel().moveSibling(1),
    },
    {
      id: 'moveDownParentSibling',
      title: 'Next comment at the parent’s level (skips the parent’s other replies)',
      defaultKeys: ['alt+j'],
      context: 'comments',
      section: 'Move',
      enabled: thread,
      run: () => sel().moveParentSibling(),
    },
    {
      id: 'moveUpThread',
      title: 'Previous comment thread',
      defaultKeys: ['alt+shift+k'],
      context: 'comments',
      section: 'Move',
      enabled: thread,
      run: () => sel().moveThread(-1),
    },
    {
      id: 'moveDownThread',
      title: 'Next comment thread',
      defaultKeys: ['alt+shift+j'],
      context: 'comments',
      section: 'Move',
      enabled: thread,
      run: () => sel().moveThread(1),
    },
    {
      id: 'moveToTopComment',
      title: 'Top of this comment thread',
      defaultKeys: ['t'],
      context: 'comments',
      section: 'Move',
      enabled: thread,
      run: () => sel().toTop(),
    },
    {
      id: 'moveToParent',
      title: 'Parent comment',
      defaultKeys: ['p'],
      context: 'comments',
      section: 'Move',
      enabled: thread,
      run: () => sel().parent(),
    },
    {
      id: 'undoMove',
      title: 'Go back to the previously selected item',
      defaultKeys: ['ctrl+z'],
      section: 'Move',
      run: () => sel().undo(),
    },
  ];

  const opening: Command[] = [
    {
      id: 'followLink',
      title: 'Open the post’s link',
      defaultKeys: ['enter', 'o'],
      section: 'Open',
      run: (e) => !onControl(e) && follow(linkOf(cur())),
    },
    {
      id: 'toggleComment',
      title: 'Collapse or expand the selected comment',
      defaultKeys: ['enter'],
      context: 'comments',
      section: 'Open',
      enabled: () => cur()?.kind === 'comment',
      run: (e) => {
        const it = cur();
        if (!it || onControl(e) || !ownDetails(it.host)) return false;
        void toggleCommentCollapse(it.host).then(() => sel().refresh());
        return true;
      },
    },
    {
      id: 'followComments',
      title: 'Open comments',
      defaultKeys: ['c'],
      section: 'Open',
      run: () => follow(commentsOf(cur())),
    },
    {
      id: 'followCommentsNewTab',
      title: 'Open comments in a new tab',
      defaultKeys: ['shift+c'],
      section: 'Open',
      run: () => newTab(commentsOf(cur())),
    },
    {
      id: 'followLinkAndCommentsNewTab',
      title: 'Open link and comments in new tabs',
      defaultKeys: ['shift+enter', 'shift+o', 'l'],
      section: 'Open',
      run: (e) => !onControl(e) && both(true),
    },
    {
      id: 'followLinkAndCommentsBackground',
      title: 'Open link and comments in background tabs',
      defaultKeys: ['shift+l'],
      section: 'Open',
      run: () => both(false),
    },
    {
      id: 'followSubreddit',
      title: 'Go to the post’s subreddit',
      defaultKeys: ['r'],
      section: 'Open',
      // With a comment selected `r` is "reply" (keyboardActions, as in RES on threads).
      enabled: () => cur()?.kind !== 'comment',
      run: () => go(subredditUrl()),
    },
    {
      id: 'followSubredditNewTab',
      title: 'Open the post’s subreddit in a new tab',
      defaultKeys: ['shift+r'],
      section: 'Open',
      run: () => newTab(subredditUrl()),
    },
    {
      id: 'followProfile',
      title: 'Go to the author’s profile',
      defaultKeys: ['u'],
      section: 'Open',
      run: () => go(authorUrl()),
    },
    {
      id: 'followProfileNewTab',
      title: 'Open the author’s profile in a new tab',
      defaultKeys: ['shift+u'],
      section: 'Open',
      run: () => newTab(authorUrl()),
    },
  ];

  const general: Command[] = [
    {
      id: 'focusSearch',
      title: 'Focus Reddit’s search box',
      defaultKeys: ['alt+/'],
      section: 'General',
      run: () => {
        const miss = () =>
          env.ctx.notices.show('REScue could not find Reddit’s search box on this page.', {
            id: 'search-missing',
            kind: 'warning',
            timeoutMs: 4000,
          });
        const handled = focusSearchBox((ok) => ok || miss());
        if (!handled) miss();
        return handled;
      },
    },
    {
      id: 'toggleHelp',
      title: 'Show or hide this list of shortcuts',
      defaultKeys: ['?'],
      section: 'General',
      run: () => (env.toggleHelp(), true),
    },
    {
      id: 'dismiss',
      title: 'Close the list / clear the selection',
      defaultKeys: ['escape'],
      section: 'General',
      // Any open REScue popup or menu (tag editor, shortcut-bar menus, big editor, source, …)
      // closes itself on Escape; the selection clear must not swallow that key first (this
      // dispatcher runs in the window's capture phase). Live 2026-10-21 the first Escape only
      // cleared the selection while the sort menu stayed open.
      enabled: () => env.helpOpen() || (!!sel().current() && !document.querySelector(OPEN_POPUP)),
      run: () => {
        if (env.helpOpen()) env.closeHelp();
        else sel().clear();
        return true;
      },
    },
  ];

  return [...movement, ...opening, ...linkCommands(env), ...goCommands(env), ...general];
}
