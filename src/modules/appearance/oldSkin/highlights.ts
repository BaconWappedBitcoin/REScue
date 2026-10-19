/**
 * Old Reddit look: a subreddit's "Community highlights" (its pinned posts) drawn as old Reddit drew
 * stickied posts: one green row each at the top of the listing, with the score, "submitted by
 * u/name", an "announcement" word and the comment count. Everything is read from Reddit's own
 * cards (light DOM); the links are the cards' own links. Reddit's carousel is only hidden by the
 * stylesheet while the rows are shown (`data-rescue-hl` on it), and comes back when they go.
 */
import { C } from '../../../contracts/reddit';
import { h } from '../../../core/dom';
import { commentsText, compactScore } from '../../../model/oldSkinText';
import { setAttr } from './shared';

const K = C.skin.highlights;

export interface Highlight {
  href: string;
  title: string;
  author: string | null;
  score: number | null;
  comments: number | null;
}

/** The pinned posts a highlight carousel shows, in order. */
export function readHighlights(carousel: Element): Highlight[] {
  const out: Highlight[] = [];
  for (const card of carousel.querySelectorAll(K.card)) {
    const href = card.closest('a[href]')?.getAttribute('href');
    const title = card.querySelector(K.title)?.textContent?.trim();
    if (!href || !title || !/^\/r\/[^/]+\/comments\//.test(href)) continue;
    const label = card.querySelector(K.label)?.textContent?.trim() ?? '';
    const nums = [...card.querySelectorAll(K.counts)].map((n) => Number(n.getAttribute(K.countAttr)));
    out.push({
      href,
      title,
      author: /u\/([\w-]+)/.exec(label)?.[1] ?? null,
      score: Number.isFinite(nums[0]) ? nums[0]! : null,
      comments: Number.isFinite(nums[1]) ? nums[1]! : null,
    });
  }
  return out;
}

function row(x: Highlight): HTMLElement {
  return h(
    'div',
    { class: 'rescue-ostick' },
    h('span', { class: 'rescue-ostick-score' }, x.score === null ? '•' : compactScore(x.score)),
    h(
      'div',
      { class: 'rescue-ostick-body' },
      h('a', { class: 'rescue-otitle rescue-ostick-title', href: x.href }, x.title),
      h(
        'div',
        { class: 'rescue-otag' },
        'submitted',
        ...(x.author ? [' by ', h('a', { class: 'rescue-oauthor', href: `/user/${x.author}/` }, x.author)] : []),
        ' - ',
        h('span', { class: 'rescue-ostick-word' }, 'announcement'),
      ),
      h(
        'a',
        { class: 'rescue-ocomments', href: x.href },
        x.comments === null ? 'comments' : commentsText(x.comments),
      ),
    ),
  );
}

export class HighlightRows {
  private box: HTMLElement | null = null;
  private signature = '';

  /** Draw (or refresh) the rows for the page's carousel; take them away when there is none. */
  sync(doc: Document = document): void {
    const carousel = doc.querySelector(`${C.main} ${K.carousel}`);
    const items = carousel ? readHighlights(carousel) : [];
    if (!carousel || !items.length) {
      this.clear(doc);
      return;
    }
    const sig = JSON.stringify(items);
    if (!this.box || this.signature !== sig) {
      const next = h('div', { class: 'rescue-osticky', 'aria-label': 'pinned posts' }, ...items.map(row));
      this.box?.remove();
      this.box = next;
      this.signature = sig;
    }
    if (this.box.nextElementSibling !== carousel) carousel.before(this.box);
    setAttr(carousel, K.shownAttr, '1');
  }

  clear(doc: Document = document): void {
    this.box?.remove();
    this.box = null;
    this.signature = '';
    for (const c of doc.querySelectorAll(`[${K.shownAttr}]`)) c.removeAttribute(K.shownAttr);
  }
}
