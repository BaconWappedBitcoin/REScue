/**
 * oldRedditSkin (a REScue extra: RES had no skin like it): feeds, search results and comment threads
 * on modern Reddit restyled to look like old Reddit. It is CSS on Reddit's own page, so Reddit's
 * elements stay where they are and every REScue feature keeps working. It only changes the look
 * (constitution: opt-in for anything that changes Reddit's look), so it is off until you switch it
 * on, here or with the "Old Reddit look" row in the REScue menu, and it follows the switch live.
 *
 * The stylesheet (src/model/oldSkin.ts) is keyed on one attribute on <html>. This module sets that
 * attribute only while the page is a feed, search or thread, so profiles, settings and every other
 * page stay as Reddit draws them.
 */
import { defineModule } from '../../core/types';
import {
  oldSkinCss,
  SKIN_ATTR,
  SKIN_VALUE,
  skinApplies,
  type OldSkinOptions,
} from '../../model/oldSkin';
import type { Route } from '../../core/types';
import { removeStyle, setStyle } from './injectedStyle';
import { writeSkinMirror } from './oldSkin/early';
import { SkinMount } from './oldSkin/mount';
import type { Ctx } from './oldSkin/shared';

export const SKIN_STYLE_ID = 'rescue-old-skin';
export const MODULE_ID = 'oldRedditSkin';

/** Puts the skin attribute on <html> for a route the skin covers and takes it off for any other. */
export function applySkinAttribute(route: Route, doc: Document = document): boolean {
  const on = skinApplies(route);
  const html = doc.documentElement;
  if (on) {
    if (html.getAttribute(SKIN_ATTR) !== SKIN_VALUE) html.setAttribute(SKIN_ATTR, SKIN_VALUE);
  } else html.removeAttribute(SKIN_ATTR);
  return on;
}

let mount: SkinMount | null = null;

/** Starts REScue's own rows while the page is one the skin covers, and stops them anywhere else. */
function syncMount(ctx: Ctx, route: Route): void {
  if (!skinApplies(route)) {
    mount?.stop();
    mount = null;
    return;
  }
  if (!mount) {
    mount = new SkinMount(ctx, route);
    mount.start();
  } else mount.setRoute(route);
}

export const oldRedditSkin = defineModule({
  id: MODULE_ID,
  category: 'appearance',
  title: 'Old Reddit look',
  description:
    'Restyles feeds (home, subreddits, r/popular, r/all), search results and comment threads to look like old Reddit: a left vote column (up arrow, score, down arrow) with the rank number, a small thumbnail, a blue title with its flair and (domain), the tagline “submitted 2 hours ago by user to r/sub” with REScue’s tag and ignore words after it, the flat grey link row (comments, share, save, hide, report), old-style sort tabs, REScue’s subreddit bar as the thin strip at the very top, thread comments with their own arrows, “[–] author 196 points 2 hours ago”, permalink / save / report / reply words and a narrow indent, and the classic colours (a dark version when Reddit is dark). Every one of these is drawn by REScue but acts through Reddit’s own controls: votes press Reddit’s own vote buttons (signed out they say to sign in), save, hide, report, share and reply press Reddit’s own menu rows and buttons, and the vote state shown is what Reddit’s buttons show. A post or comment whose own controls REScue cannot read keeps Reddit’s own look and vote buttons. Profiles, settings and other pages are left alone, and turning this off returns Reddit’s own rows at once. Also in the REScue menu as “Old Reddit look”. Off by default.',
  enabledByDefault: false,
  options: {
    thumbnails: {
      type: 'enum',
      default: 'normal',
      title: 'Thumbnails',
      values: [
        { value: 'none', label: 'None (text rows only)' },
        { value: 'small', label: 'Small (50 pixels)' },
        { value: 'normal', label: 'Normal (70 pixels, like old Reddit)' },
        { value: 'large', label: 'Large (100 pixels)' },
      ],
      description:
        'The picture beside each title. Posts with a large picture or video are shown as a thumbnail too.',
    },
    rankNumbers: {
      type: 'boolean',
      default: true,
      title: 'Rank numbers',
      description: 'Number the rows 1, 2, 3 … on the left, as old Reddit does.',
    },
    hideLeftNav: {
      type: 'boolean',
      default: true,
      title: 'Hide the left navigation',
      description:
        'Removes Reddit’s navigation column on wide screens so the posts use the width (the header, search and REScue’s shortcut bar stay).',
    },
    hideBanner: {
      type: 'boolean',
      default: true,
      title: 'Hide the subreddit banner',
      description: 'Drops the large banner picture and icon at the top of a subreddit.',
    },
  },

  init(ctx) {
    writeSkinMirror(ctx.options as OldSkinOptions);
    setStyle(SKIN_STYLE_ID, oldSkinCss(ctx.options as OldSkinOptions));
    applySkinAttribute(ctx.route);
    syncMount(ctx as unknown as Ctx, ctx.route);
  },

  onItems(batch) {
    mount?.items([...batch.posts, ...batch.comments].map((i) => i.source));
  },

  onRoute(route, ctx) {
    applySkinAttribute(route);
    syncMount(ctx as unknown as Ctx, route);
  },

  onSettings(ctx) {
    writeSkinMirror(ctx.options as OldSkinOptions);
    setStyle(SKIN_STYLE_ID, oldSkinCss(ctx.options as OldSkinOptions));
    applySkinAttribute(ctx.route);
    syncMount(ctx as unknown as Ctx, ctx.route);
  },

  dispose() {
    // Off (or replaced by a newer REScue, which writes it again): no early look on the next load.
    writeSkinMirror(null);
    mount?.stop();
    mount = null;
    document.documentElement.removeAttribute(SKIN_ATTR);
    removeStyle(SKIN_STYLE_ID);
  },
});
