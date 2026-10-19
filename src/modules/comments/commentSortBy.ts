/**
 * commentSortBy (RES commentSortBy, US6): open threads sorted the way you like. Links to threads
 * that do not already choose a sort get `?sort=` added (a sort you pick in the URL or in Reddit's
 * menu always wins), with optional per-subreddit exceptions. Only links are changed; no page is
 * reloaded. Ported in spirit from RES lib/modules/commentSortBy.js (GPL-3.0, the RES contributors,
 * commit 4defffc); the code is new.
 */
import { defineModule } from '../../core/types';
import { removeThreadLinkRule, rewritePosts, setThreadLinkRule } from './threadLinks';
import { COMMENT_SORTS, isCommentSort, subredditOfLink, withThreadParams } from './threadUrl';

const SORT_VALUES = [
  { value: '', label: 'Reddit’s default' },
  { value: 'confidence', label: 'Best' },
  { value: 'top', label: 'Top' },
  { value: 'new', label: 'New' },
  { value: 'controversial', label: 'Controversial' },
  { value: 'old', label: 'Old' },
  { value: 'qa', label: 'Q&A' },
];

/** The sort for a link: the subreddit's own row if it has one, else the default. */
export function sortFor(
  href: string,
  defaultSort: string,
  rows: Array<Record<string, unknown>>,
): string {
  const sub = subredditOfLink(href).toLowerCase();
  const own = sub
    ? rows.find(
        (r) =>
          String(r.subreddit ?? '')
            .replace(/^\/?r\//i, '')
            .trim()
            .toLowerCase() === sub,
      )
    : undefined;
  const sort = own ? String(own.sort ?? '') : defaultSort;
  return isCommentSort(sort) ? sort : '';
}

export const commentSortBy = defineModule({
  id: 'commentSortBy',
  resId: 'commentSortBy',
  category: 'comments',
  title: 'Default comment sort',
  description:
    'Adds your preferred comment sort to links that open a thread, unless the link already has one. Leave it on “Reddit’s default” to change nothing. Reddit honours the sort in the link (checked on the live site).',
  enabledByDefault: true,
  options: {
    defaultSort: {
      type: 'enum',
      default: '',
      title: 'Default sort',
      values: SORT_VALUES,
    },
    perSubreddit: {
      type: 'table',
      default: [],
      title: 'Per-subreddit sort',
      description: 'A subreddit listed here uses its own sort instead of the default.',
      columns: [
        { key: 'subreddit', title: 'Subreddit', type: 'text' },
        { key: 'sort', title: 'Sort', type: 'enum', values: [...COMMENT_SORTS], default: 'top' },
      ],
    },
  },

  init(ctx) {
    const rows = ctx.options.perSubreddit as Array<Record<string, unknown>>;
    const def = ctx.options.defaultSort as string;
    if (!def && !rows.length) return;
    setThreadLinkRule('commentSortBy', (href) => {
      const sort = sortFor(href, def, rows);
      return sort ? withThreadParams(href, { sort }) : null;
    });
  },

  onItems(batch) {
    rewritePosts(batch.posts);
  },

  dispose() {
    removeThreadLinkRule('commentSortBy');
  },
});
