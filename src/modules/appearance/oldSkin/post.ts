/**
 * Old Reddit look: one post's replacement rows. A feed row and the post at the top of a thread get
 * the same pieces, appended to the post element (light DOM, Reddit's own element stays and keeps
 * working underneath, hidden by the stylesheet only while `data-rescue-ov` is set):
 *
 * - the vote column (vote.ts);
 * - the body block: title line (title link, flair, "(domain)"), the tagline "submitted 2 hours ago
 *   by user to r/sub" (REScue's tag / ignore / filter words are placed after the author and after
 *   the end of it, through the adapter's `data-rescue-anchor` marks) and the flat link row
 *   "N comments share save hide report";
 * - a placeholder thumbnail for posts that have none (shown by the stylesheet only when Reddit's
 *   own thumbnail is absent).
 *
 * Every word acts through Reddit's own controls: comments / title are plain links (a click on a
 * feed row's comments link is passed to Reddit's own full-card link so the page changes without a
 * reload), share / save / hide / report go through `ctx.actions`, which presses Reddit's own
 * buttons and menu rows.
 */
import { C } from '../../../contracts/reddit';
import { h, ownQueryAll } from '../../../core/dom';
import { parsePost } from '../../../model/post';
import { agoText, commentsText, domainText } from '../../../model/oldSkinText';
import type { Post } from '../../../model/types';
import type { ActionResult } from '../../../core/actions';
import type { Route } from '../../../core/types';
import {
  ANCHOR_ATTR,
  failureText,
  MOUNT_ATTR,
  onActivate,
  say,
  setAttr,
  setText,
  slotPieces,
  type Ctx,
} from './shared';
import { nativeVote, VoteBox } from './vote';

/** Listings that mix subreddits show "to r/sub"; a subreddit's own feed and a thread do not. */
export const showsSub = (route: Route): boolean =>
  route.kind !== 'subreddit' && route.kind !== 'thread';

export class PostView {
  private readonly vote: VoteBox;
  private readonly body: HTMLElement;
  private readonly title: HTMLAnchorElement;
  private readonly flair: HTMLElement;
  private readonly nsfw: HTMLElement;
  private readonly domain: HTMLElement;
  private readonly when: HTMLElement;
  private readonly byWord: HTMLElement;
  private readonly author: HTMLAnchorElement;
  private readonly toWord: HTMLElement;
  private readonly sub: HTMLAnchorElement;
  private readonly comments: HTMLAnchorElement;
  private readonly save: HTMLButtonElement;
  private readonly thumb: HTMLElement;
  private saved = false;
  private post: Post | null = null;

  /** Null (nothing mounted) unless Reddit's own vote buttons are readable: never a post without votes. */
  static mount(host: Element, ctx: Ctx, route: () => Route): PostView | null {
    if (nativeVote(host, 'post') === null) return null;
    const post = parsePost(host);
    return post ? new PostView(host, ctx, route, post) : null;
  }

  private constructor(
    private readonly host: Element,
    private readonly ctx: Ctx,
    private readonly route: () => Route,
    first: Post,
  ) {
    const target = { id: first.id, source: host };
    // Reddit's in-feed ads have a post's shape; the row says it is one, as old Reddit did.
    const ad = host.matches(C.adPost);
    this.vote = new VoteBox({
      host,
      kind: 'post',
      id: first.id,
      ctx,
      readScore: () => this.post?.score ?? null,
    });
    this.title = h('a', { class: 'rescue-otitle', [ANCHOR_ATTR]: 'title' });
    this.flair = h('span', { class: 'rescue-oflair', hidden: true });
    this.nsfw = h('span', { class: 'rescue-onsfw', hidden: true }, 'NSFW');
    this.domain = h('span', { class: 'rescue-odomain', [ANCHOR_ATTR]: 'domain' });
    this.when = h('span', { class: 'rescue-owhen' });
    this.byWord = h('span', { class: 'rescue-oword' }, 'by');
    this.author = h('a', { class: 'rescue-oauthor', [ANCHOR_ATTR]: 'author' });
    this.toWord = h('span', { class: 'rescue-oword' }, 'to');
    this.sub = h('a', { class: 'rescue-osub' });
    this.comments = h('a', { class: 'rescue-ocomments' });
    this.save = h('button', { type: 'button', class: 'rescue-olink' }, 'save');
    const words = h(
      'ul',
      { class: 'rescue-olinks' },
      h('li', null, this.comments),
      this.item('share', 'share', () => ctx.actions.share(target)),
      h('li', null, this.save),
      this.item('hide', 'hide', () => ctx.actions.hide(target, true)),
      this.item('report', 'report', () => ctx.actions.report(target)),
    );
    onActivate(this.save, () => void this.toggleSave(target));
    this.body = h(
      'div',
      { class: 'rescue-obody' },
      h('div', { class: 'rescue-oline' }, this.title, ' ', this.flair, this.nsfw, ' ', this.domain),
      h(
        'div',
        { class: 'rescue-otag' },
        h('span', { class: 'rescue-oword' }, ad ? 'promoted' : 'submitted'),
        ' ',
        this.when,
        ' ',
        this.byWord,
        ' ',
        this.author,
        ' ',
        this.toWord,
        ' ',
        this.sub,
        ...(ad ? [h('span', { class: 'rescue-oad' }, 'sponsored link')] : []),
        h('i', { class: 'rescue-oend', [ANCHOR_ATTR]: 'end' }),
      ),
      words,
    );
    this.thumb = h('div', { class: 'rescue-oth' });
    // The comments link goes where Reddit's own full-card link goes: through Reddit's own router.
    onActivate(this.comments, (e) => this.openPost(e));
    onActivate(this.title, (e) => {
      if (this.title.getAttribute('href') === this.post?.permalink) this.openPost(e);
    });
    // The thumbnail opens what the title opens, as on old Reddit: under the skin Reddit's own
    // whole-card link is switched off, so a click on the picture would otherwise do nothing.
    host.addEventListener('click', (e) => this.openFromThumb(e as MouseEvent), true);
    host.addEventListener('auxclick', (e) => this.openFromThumb(e as MouseEvent), true);
    host.append(this.vote.el, this.thumb, this.body);
    slotPieces(host, [this.vote.el, this.thumb, this.body]);
    this.render(first);
    setAttr(host, MOUNT_ATTR, '1');
  }

  /** A word of the flat link row: a button that runs one delegated action. */
  private item(cls: string, text: string, run: () => Promise<ActionResult>): HTMLElement {
    const b = h('button', { type: 'button', class: `rescue-olink rescue-o-${cls}` }, text);
    onActivate(b, () => {
      if (b.getAttribute('aria-busy') === 'true') return;
      setAttr(b, 'aria-busy', 'true');
      void run()
        .then((r) => {
          if (!r.ok) say(this.ctx, failureText(text, r));
        })
        .finally(() => setAttr(b, 'aria-busy', null));
    });
    return h('li', null, b);
  }

  private async toggleSave(target: { id: string; source: Element }): Promise<void> {
    if (this.save.getAttribute('aria-busy') === 'true') return;
    setAttr(this.save, 'aria-busy', 'true');
    try {
      const on = !this.saved;
      const r = await this.ctx.actions.save(target, on);
      if (r.ok) {
        this.saved = on;
        setText(this.save, on ? 'unsave' : 'save');
      } else say(this.ctx, failureText('save', r));
    } finally {
      setAttr(this.save, 'aria-busy', null);
    }
  }

  private openFromThumb(e: MouseEvent): void {
    const t = e.target instanceof Element ? e.target : null;
    if (!t || (t !== this.thumb && t.closest(C.mediaContainer)?.parentElement !== this.host))
      return;
    if (e.button > 1) return;
    const href = this.title.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.button === 1 || e.ctrlKey || e.metaKey || e.shiftKey)
      window.open(href, '_blank', 'noopener');
    else if (
      href === this.post?.permalink &&
      this.host.querySelector(':scope > a[slot="full-post-link"]')
    )
      this.openPost(e);
    else location.assign(href);
  }

  private openPost(e: MouseEvent): void {
    const link = this.host.querySelector<HTMLElement>(':scope > a[slot="full-post-link"]');
    if (!link) return; // no Reddit link to go through: the plain link navigates by itself
    e.preventDefault();
    link.click();
  }

  /** The flair's own colours, read from Reddit's flair element, so a coloured flair stays coloured. */
  private flairColors(): { bg: string; fg: string } | null {
    const el = ownQueryAll(this.host, C.postFlair, C.post)[0];
    if (!el) return null;
    for (const n of [el, ...el.querySelectorAll('*')]) {
      const cs = getComputedStyle(n);
      const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(cs.backgroundColor);
      if (m && (m[4] === undefined || Number(m[4]) > 0.2)) {
        return { bg: cs.backgroundColor, fg: cs.color };
      }
    }
    return null;
  }

  /** Redraw every word from Reddit's attributes. Quiet when nothing changed. */
  render(parsed?: Post | null): void {
    const p = parsed ?? parsePost(this.host);
    if (!p) return;
    this.post = p;
    const isSelf = p.type === 'text' || /^self\./.test(p.domain);
    const external = (p.type === 'link' || p.type === 'image') && p.url ? p.url : null;
    setText(this.title, p.title);
    setAttr(this.title, 'href', external ?? p.permalink);
    setAttr(this.title, 'rel', external ? 'noopener noreferrer' : null);
    setAttr(this.title, 'data-kind', external ? 'link' : 'self');
    const flair = p.flair?.text ?? '';
    this.flair.hidden = !flair;
    setText(this.flair, flair);
    if (flair) {
      const c = this.flairColors();
      if (c) {
        this.flair.style.setProperty('--os-flair-bg', c.bg);
        this.flair.style.setProperty('--os-flair-fg', c.fg);
      }
    }
    this.nsfw.hidden = !p.nsfw;
    setText(this.domain, domainText(p.domain, p.subreddit, isSelf));
    setText(this.when, agoText(p.created));
    setAttr(this.when, 'title', p.created ? p.created.toString() : null);
    const who = p.author ?? '[deleted]';
    setText(this.author, who);
    setAttr(this.author, 'href', p.author ? `/user/${p.author}/` : null);
    const showSub = showsSub(this.route()) && !!p.subreddit;
    this.toWord.hidden = !showSub;
    this.sub.hidden = !showSub;
    setText(this.sub, `r/${p.subreddit}`);
    setAttr(this.sub, 'href', `/r/${p.subreddit}/`);
    setText(this.comments, commentsText(p.commentCount));
    setAttr(this.comments, 'href', p.permalink);
    const video = this.host.querySelector(C.skin.videoPlayer);
    const pic = this.thumb.hasAttribute('slot') || video ? this.picture() : null;
    setAttr(this.thumb, 'data-kind', pic ? 'img' : isSelf ? 'self' : 'link');
    if (pic) this.thumb.style.setProperty('--os-thumb', pic);
    else this.thumb.style.removeProperty('--os-thumb');
    this.vote.update();
  }

  /**
   * Where the post's own thumbnail cannot be shown (its pieces are drawn through a slot, see
   * slotPieces), the placeholder shows the same picture: Reddit's thumbnail or preview image, as a
   * CSS url() of an https address only.
   */
  private picture(): string | null {
    const img = this.host.querySelector<HTMLImageElement>(
      `${C.skin.postSlots.thumbnail} img[src], ${C.mediaContainer} img[src]`,
    );
    const poster = this.host.querySelector(C.skin.videoPlayer)?.getAttribute(C.skin.videoPoster);
    const src = img?.currentSrc || img?.getAttribute('src') || poster || '';
    if (!/^https:\/\//i.test(src)) return null;
    return `url("${src.replace(/["\\\n\r]/g, encodeURIComponent)}")`;
  }

  dispose(): void {
    this.vote.dispose();
    this.body.remove();
    this.thumb.remove();
    this.host.removeAttribute(MOUNT_ATTR);
  }

  /** Is everything still attached (Reddit may have re-rendered the post's children)? */
  intact(): boolean {
    return (
      this.body.parentElement === this.host &&
      this.vote.el.parentElement === this.host &&
      this.thumb.parentElement === this.host
    );
  }

  /** Put the pieces back after Reddit's re-render threw them away. */
  repair(): void {
    for (const n of [this.vote.el, this.thumb, this.body]) {
      if (n.parentElement !== this.host) this.host.append(n);
    }
    slotPieces(this.host, [this.vote.el, this.thumb, this.body]);
    setAttr(this.host, MOUNT_ATTR, '1');
  }
}
