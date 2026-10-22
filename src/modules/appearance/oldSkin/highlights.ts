/**
 * Old Reddit look: a subreddit's "Community highlights" (its pinned posts) drawn as old Reddit drew
 * stickied posts: rows laid out exactly like the feed's (rank, vote and thumbnail columns, the same
 * title line, tagline and link row), with a green title and an "announcement" word. Everything is
 * read from Reddit's own cards (light DOM); the links are the cards' own links. The cards have no
 * vote buttons and no posting time, so the vote column shows the score only and the tagline has
 * no age. Reddit's carousel is only hidden by the stylesheet while the rows are shown
 * (`data-rescue-hl` on it), and comes back when they go.
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
  /** A flair or tag shown on the card instead of an author, with its colour when it has one. */
  label: { text: string; bg: string | null } | null;
  image: string | null;
  score: number | null;
  comments: number | null;
}

const SAFE_IMAGE = /^https:\/\/[a-z0-9.-]+\.(?:redd\.it|redditmedia\.com|redditstatic\.com)\//i;
const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;

/** The pinned posts a highlight carousel shows, in order. */
export function readHighlights(carousel: Element): Highlight[] {
  const out: Highlight[] = [];
  for (const card of carousel.querySelectorAll(K.card)) {
    const href = card.closest('a[href]')?.getAttribute('href');
    const title = card.querySelector(K.title)?.textContent?.trim();
    if (!href || !title || !/^\/r\/[^/]+\/comments\//.test(href)) continue;
    const labelEl = card.querySelector(K.label);
    const labelText = labelEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const author = /^u\/([\w-]+)/.exec(labelText)?.[1] ?? null;
    const flairEl = labelEl?.querySelector(K.flair);
    const bg = (flairEl?.parentElement as HTMLElement | null)?.style.backgroundColor || null;
    const nums = [...card.querySelectorAll(K.counts)].map((n) =>
      Number(n.getAttribute(K.countAttr)),
    );
    const image = card.getAttribute(K.imageAttr);
    out.push({
      href,
      title,
      author,
      label:
        !author && labelText
          ? { text: labelText, bg: bg && SAFE_COLOR.test(bg) ? bg : null }
          : null,
      image: image && SAFE_IMAGE.test(image) ? image : null,
      score: Number.isFinite(nums[0]) ? nums[0]! : null,
      comments: Number.isFinite(nums[1]) ? nums[1]! : null,
    });
  }
  return out;
}

function row(x: Highlight): HTMLElement {
  const flair = x.label ? h('span', { class: 'rescue-oflair' }, x.label.text) : null;
  if (flair && x.label?.bg) flair.style.setProperty('--os-flair-bg', x.label.bg);
  if (flair && x.label?.bg) flair.style.setProperty('--os-flair-fg', '#fff');
  const thumb = h('div', { class: 'rescue-oth', 'data-kind': x.image ? 'img' : 'self' });
  if (x.image)
    thumb.style.setProperty(
      '--os-thumb',
      `url("${x.image.replace(/["\\\n\r]/g, encodeURIComponent)}")`,
    );
  return h(
    'div',
    { class: 'rescue-ostick' },
    h(
      'div',
      { class: 'rescue-ostick-vote' },
      h('span', { class: 'rescue-onum' }, x.score === null ? '•' : compactScore(x.score)),
    ),
    thumb,
    h(
      'div',
      { class: 'rescue-obody' },
      h(
        'div',
        { class: 'rescue-oline' },
        h('a', { class: 'rescue-otitle rescue-ostick-title', href: x.href }, x.title),
        ...(flair ? [' ', flair] : []),
      ),
      h(
        'div',
        { class: 'rescue-otag' },
        h('span', { class: 'rescue-oword' }, 'submitted'),
        ...(x.author
          ? [
              ' ',
              h('span', { class: 'rescue-oword' }, 'by'),
              ' ',
              h('a', { class: 'rescue-oauthor', href: `/user/${x.author}/` }, x.author),
            ]
          : []),
        ' - ',
        h('span', { class: 'rescue-ostick-word' }, 'announcement'),
      ),
      h(
        'ul',
        { class: 'rescue-olinks' },
        h(
          'li',
          null,
          h(
            'a',
            { class: 'rescue-ocomments', href: x.href },
            x.comments === null ? 'comments' : commentsText(x.comments),
          ),
        ),
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
      const next = h(
        'div',
        { class: 'rescue-osticky', 'aria-label': 'pinned posts' },
        ...items.map(row),
      );
      this.box?.remove();
      this.box = next;
      this.signature = sig;
    }
    if (this.box.nextElementSibling !== carousel) carousel.before(this.box);
    setAttr(carousel, K.shownAttr, '1');
  }

  /** REScue's rows were drawn and has since been taken out of the page (Reddit re-rendered there). */
  gone(): boolean {
    return !!this.box && !this.box.isConnected;
  }

  clear(doc: Document = document): void {
    this.box?.remove();
    this.box = null;
    this.signature = '';
    for (const c of doc.querySelectorAll(`[${K.shownAttr}]`)) c.removeAttribute(K.shownAttr);
  }
}
