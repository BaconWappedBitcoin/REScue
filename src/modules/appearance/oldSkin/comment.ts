/**
 * Old Reddit look: one comment's replacement rows (a thread's comments have no shadow root; only
 * their action row does). Appended to the comment element, in Reddit's light DOM:
 *
 * - the vote column at the comment's left edge (vote.ts);
 * - "196 points 2 hours ago" after Reddit's own author / flair group in the head (the stylesheet
 *   hides Reddit's own bullet and relative time, and draws the old "[–]" collapse mark; the head is
 *   Reddit's own `summary`, so clicking the mark collapses the comment through Reddit's own toggle);
 * - the flat link row "permalink save report reply" under the body (embed is not offered: REScue
 *   cannot make an embed). Save and report go through `ctx.actions` (Reddit's own overflow menu),
 *   reply opens Reddit's own reply box through `startReply`.
 *
 * Reddit's own action row (vote pill, reply, award, share, "…") stays in the page, sealed and
 * hidden by the stylesheet only while `data-rescue-ov` is set; the bridge keeps pressing its buttons.
 */
import { h } from '../../../core/dom';
import { commentScoreOf } from '../../../model/commentRow';
import { parseComment } from '../../../model/comment';
import { agoText, pointsText } from '../../../model/oldSkinText';
import type { ActionResult } from '../../../core/actions';
import { C } from '../../../contracts/reddit';
import { failureText, MOUNT_ATTR, onActivate, say, setAttr, setText, type Ctx } from './shared';
import { VoteBox } from './vote';

const META = C.skin.comment.meta;

export class CommentView {
  private readonly vote: VoteBox;
  private readonly pts: HTMLElement;
  private readonly score: HTMLElement;
  private readonly when: HTMLElement;
  private readonly links: HTMLElement;
  private readonly permalink: HTMLAnchorElement;
  private readonly save: HTMLButtonElement;
  private saved = false;
  private id: string;

  static mount(host: Element, ctx: Ctx): CommentView | null {
    const c = parseComment(host, null);
    return c ? new CommentView(host, ctx, c.id) : null;
  }

  private constructor(
    private readonly host: Element,
    private readonly ctx: Ctx,
    id: string,
  ) {
    this.id = id;
    const target = { id, source: host };
    this.vote = new VoteBox({
      host,
      kind: 'comment',
      id,
      ctx,
      readScore: () => commentScoreOf(host),
    });
    this.score = h('span', { class: 'rescue-oscore' });
    this.when = h('span', { class: 'rescue-owhen' });
    this.pts = h('span', { class: 'rescue-opts' }, this.score, ' ', this.when);
    this.permalink = h('a', { class: 'rescue-olink' }, 'permalink');
    this.save = h('button', { type: 'button', class: 'rescue-olink' }, 'save');
    onActivate(this.save, () => void this.toggleSave(target));
    this.links = h(
      'ul',
      { class: 'rescue-olinks rescue-ocl' },
      h('li', null, this.permalink),
      h('li', null, this.save),
      this.item('report', () => ctx.actions.report(target)),
      this.item('reply', () => ctx.actions.startReply(target)),
    );
    host.append(this.vote.el);
    this.place();
    this.render();
    setAttr(host, MOUNT_ATTR, '1');
  }

  private item(text: string, run: () => Promise<ActionResult>): HTMLElement {
    const b = h('button', { type: 'button', class: 'rescue-olink' }, text);
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

  /** The comment's own head line (never a reply's). */
  private meta(): Element | null {
    return this.host.querySelector(`:scope > details > summary > ${META}`);
  }

  /** Put the points text after Reddit's author group and the link row under the body. */
  private place(): void {
    const meta = this.meta();
    const group = meta?.firstElementChild;
    if (meta && group && this.pts.previousElementSibling !== group) group.after(this.pts);
    // Reddit's grid under the head; a comment shaped differently still gets its link row (at its end).
    const grid = this.host.querySelector(':scope > details > div.grid') ?? this.host;
    const actions = grid.querySelector(':scope > div:has(> [slot="actionRow"])');
    if (this.links.parentElement !== grid) {
      if (actions) actions.before(this.links);
      else grid.append(this.links);
    }
  }

  render(): void {
    const c = parseComment(this.host, null);
    if (!c) return;
    this.id = c.id;
    this.vote.update();
    const score = this.vote.shown;
    setText(this.score, score === null ? '[score hidden]' : pointsText(score));
    setText(this.when, agoText(c.created));
    setAttr(this.permalink, 'href', c.permalink);
    this.place();
  }

  intact(): boolean {
    return (
      this.vote.el.parentElement === this.host &&
      this.links.parentElement !== null &&
      this.pts.parentElement !== null
    );
  }

  dispose(): void {
    this.vote.dispose();
    this.pts.remove();
    this.links.remove();
    this.host.removeAttribute(MOUNT_ATTR);
  }
}
