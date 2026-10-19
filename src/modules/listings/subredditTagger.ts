/**
 * subredditTagger (RES subredditTagger, US2/T130): give a subreddit a short tag (text and colour)
 * that shows after the time on every post from it in listings, so r/all and mixed feeds are easier
 * to scan. Tags are edited in this module's table in the settings console. Ported in spirit from
 * RES lib/modules/subredditTagger.js (GPL-3.0, the RES contributors, commit 4defffc); the code is
 * new.
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import { defineModule } from '../../core/types';
import { readableText, validColor } from '../users/tagStore';

export interface SubTag {
  text: string;
  color?: string;
}

const SUBREDDIT = /^[A-Za-z0-9_]{2,21}$/;
export const TAG_MAX = 40;

export const subKey = (name: unknown): string =>
  String(name ?? '')
    .trim()
    .replace(/^\/?r\//i, '')
    .toLowerCase();

/** Rejects a row at input. Incomplete rows pass: each cell is saved on its own. */
export function validateTagRow(row: Record<string, unknown>): string | null {
  const sub = subKey(row.subreddit);
  if (sub && !SUBREDDIT.test(sub)) return 'A subreddit name has 2 to 21 letters, digits or _.';
  if (String(row.tag ?? '').trim().length > TAG_MAX)
    return `A tag can have at most ${TAG_MAX} characters.`;
  const color = String(row.color ?? '').trim();
  if (color && !validColor(color)) return 'A colour is written #rrggbb.';
  return null;
}

/** Tags by lower-cased subreddit; rows without a valid subreddit or tag are skipped. */
export function tagTable(rows: Array<Record<string, unknown>>): Map<string, SubTag> {
  const out = new Map<string, SubTag>();
  for (const r of rows) {
    const key = subKey(r.subreddit);
    const text = String(r.tag ?? '')
      .trim()
      .slice(0, TAG_MAX);
    if (!SUBREDDIT.test(key) || !text) continue;
    out.set(key, { text, color: validColor(String(r.color ?? '')) });
  }
  return out;
}

function tagNode(subreddit: string, tag: SubTag): HTMLElement {
  const el = h(
    'span',
    { class: 'rescue-sub-tag rescue-label', 'data-sub': subKey(subreddit) },
    tag.text,
  );
  el.style.backgroundColor = tag.color ?? '#e0e0e0';
  el.style.color = readableText(tag.color ?? '#e0e0e0');
  el.title = hint.subredditTag(subreddit);
  return el;
}

let table = new Map<string, SubTag>();

export const subredditTagger = defineModule({
  id: 'subredditTagger',
  resId: 'subredditTagger',
  category: 'listings',
  title: 'Subreddit tagger',
  description:
    'Tag a subreddit with a short label and a colour. The tag appears after the time on every post from that subreddit in feeds and search, not inside the thread itself. Add rows below; a row needs a subreddit and a tag.',
  enabledByDefault: true,
  options: {
    tags: {
      type: 'table',
      default: [],
      title: 'Tags',
      columns: [
        { key: 'subreddit', title: 'Subreddit', type: 'text' },
        { key: 'tag', title: 'Tag', type: 'text' },
        { key: 'color', title: 'Colour', type: 'color', default: '#e0e0e0' },
      ],
      validateRow: validateTagRow,
    },
  },

  init(ctx) {
    table = tagTable(ctx.options.tags as Array<Record<string, unknown>>);
  },

  onItems(batch, ctx) {
    if (!table.size || ctx.route.kind === 'thread') return;
    for (const p of batch.posts) {
      const tag = table.get(subKey(p.subreddit));
      if (tag) ctx.ui.decorate(p, 'tagline', tagNode(p.subreddit, tag));
    }
  },

  dispose() {
    table = new Map();
  },
});
