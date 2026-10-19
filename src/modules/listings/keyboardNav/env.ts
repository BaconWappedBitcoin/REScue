/**
 * What the keyboard command tables need from the keyboardNav module: the selection, the route and
 * the module's options, passed in so the tables stay testable without a live page. Default keys
 * are RES's (lib/modules/keyboardNav.js, GPL-3.0, Copyright (C) the Reddit Enhancement Suite
 * contributors, commit 4defffc).
 */
import { webUrl } from '../../../core/tabs';
import type { ModuleContext, Route } from '../../../core/types';
import type { Comment, Post } from '../../../model/types';
import type { SelectableItem, Selection } from '../../../layout/native/selection';

export interface LinkNumberPrefs {
  enabled: boolean;
  /** 'digit': 1-9,0 (Alt+digit does the opposite of the new-tab setting); 'alt': Alt+digit only. */
  keys: 'digit' | 'alt';
  /** Open numbered links in a new tab. */
  newTab: boolean;
}

export interface NavEnv {
  ctx: ModuleContext;
  sel: () => Selection;
  route: () => Route;
  /** The "open in new tab" option. */
  inNewTab: () => boolean;
  linkNumbers: () => LinkNumberPrefs;
  openTabs(urls: string[], active: boolean): void;
  toggleHelp(): void;
  helpOpen(): boolean;
  closeHelp(): void;
}

/** Where the selected item's own link leads: a post's external URL (else its page); comments have none. */
export function linkOf(it: SelectableItem | null): string | null {
  if (it?.kind !== 'post') return null;
  const p = it.model as Post;
  return webUrl(p.url ?? p.permalink);
}

/** The selected post's comments page, or the selected comment's permalink. */
export function commentsOf(it: SelectableItem | null): string | null {
  if (!it) return null;
  return webUrl((it.model as Post | Comment).permalink);
}

/** The helpers every command table shares. */
export function navHelpers(env: NavEnv) {
  const cur = (): SelectableItem | null => env.sel().current();
  /** Leave this page for `url`. */
  const go = (url: string | null): boolean => {
    if (!url) return false;
    location.assign(url);
    return true;
  };
  /** Open `url` in a new tab (focused unless `active` is false). */
  const newTab = (url: string | null, active = true): boolean => {
    if (!url) return false;
    env.openTabs([url], active);
    return true;
  };
  /** Follow in this tab, or in a new one when the option says so. */
  const follow = (url: string | null): boolean => (env.inNewTab() ? newTab(url) : go(url));
  const thread = (): boolean => env.route().kind === 'thread';
  return { cur, go, newTab, follow, thread, listing: (): boolean => !thread() };
}
