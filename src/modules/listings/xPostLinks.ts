/**
 * xPostLinks (RES xPostLinks): when a post title says it was cross-posted ("x-post from r/foo",
 * "xpost r/foo", "crosspost (r/foo)"), add a link to that subreddit after the title. Reddit's own
 * crosspost card only covers real crossposts; this reads the title text. The link is a REScue node
 * in the title slot decoration. Matching follows RES lib/modules/xPostLinks.js (GPL-3.0, the RES
 * contributors, commit 4defffc); the code is new.
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import { defineModule } from '../../core/types';

const XPOST = /(?:x|cross)[\s-]?post\S*(.+)/i;
const FROM_WORD = /^(?:\s+\S+)?\s+\/?(\w{2,20}\b)(?:[)\]}]|\S*$)/i;
const SUBREDDIT = /r\/(\w{2,20}\b)/i;

/** The subreddit a title says it was cross-posted from, or null. */
export function parseXPostSubreddit(title: string): string | null {
  const rest = XPOST.exec(title)?.[1];
  if (!rest) return null;
  return (SUBREDDIT.exec(rest) ?? FROM_WORD.exec(rest))?.[1] ?? null;
}

export const xPostLinks = defineModule({
  id: 'xPostLinks',
  resId: 'xPostLinks',
  category: 'listings',
  title: 'Cross-post links',
  description:
    'When a post’s title says it was cross-posted (“x-post from r/foo”, “xpost r/foo”, “crosspost (r/foo)”), adds a link to that subreddit after the title. Reddit’s own crosspost card only appears for real crossposts.',
  enabledByDefault: true,
  options: {},

  onItems(batch, ctx) {
    for (const p of batch.posts) {
      const sub = parseXPostSubreddit(p.title);
      if (!sub || sub.toLowerCase() === p.subreddit.toLowerCase()) continue;
      const link = h(
        'a',
        {
          class: 'rescue-xpost-link rescue-btn',
          href: `/r/${sub}/`,
          title: hint.xPostLink(sub),
        },
        `x-posted from r/${sub}`,
      );
      ctx.ui.decorate(p, 'title', link);
    }
  },
});
