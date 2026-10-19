/**
 * hidePromoted (a REScue extra: Reddit Enhancement Suite never had it): hide Reddit's promoted posts
 * and ad slots on the page, as a basic cosmetic fallback for a browser with no ad blocker. It is NOT
 * an ad blocker: Reddit still loads every ad, and nothing is blocked, stored or sent anywhere.
 * Off by default. A banner ("3 promoted hidden · show") brings them back for the current page; it
 * counts only the slots REScue itself hid, never ones another tool had already removed.
 *
 * The scanning, stylesheet and banner live in hider.ts.
 */
import { defineModule } from '../../../core/types';
import { PromotedHider } from './hider';

let hider: PromotedHider | null = null;

export const hidePromoted = defineModule({
  id: 'hidePromoted',
  category: 'listings',
  title: 'Hide promoted posts',
  description:
    'Hides the promoted posts and ad slots Reddit puts in feeds, comment pages and the sidebar. This only hides them on the page: Reddit still loads each ad, so it is a basic fallback, not an ad blocker. A real ad blocker such as uBlock Origin does more (it stops the ads loading at all). A bar at the bottom right shows how many were hidden, with a "show" link to bring them back for this page. Ads that another tool already removed are not counted.',
  enabledByDefault: false,
  options: {
    posts: { type: 'boolean', default: true, title: 'Promoted posts in feeds' },
    comments: { type: 'boolean', default: true, title: 'Ads in comment pages' },
    sidebar: { type: 'boolean', default: true, title: 'Ads in the sidebar' },
    showBanner: {
      type: 'boolean',
      default: true,
      title: 'Show how many were hidden',
      description:
        'The bar with the count and the “show” link. With it off, the only way to see them again is to turn this module off.',
    },
  },

  init(ctx) {
    hider?.stop();
    hider = new PromotedHider(ctx);
    hider.start();
  },

  onItems(batch) {
    hider?.items(batch.posts.map((p) => p.source));
  },

  onRoute(route, ctx) {
    hider?.route({ ...ctx, route });
  },

  onSettings(ctx) {
    hider?.settings(ctx);
  },

  dispose() {
    hider?.stop();
    hider = null;
  },
});
