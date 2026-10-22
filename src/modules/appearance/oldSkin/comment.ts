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
 *   reply opens Reddit's own reply box through `startReply`. "source" (after report) is there
 *   only while the showSource module is on and opens its popup;
 * - an edited comment's age is followed by old Reddit's "*" (hover: "last edited 5 days ago"), or
 *   by "(last edited 5 days ago)" as text when localDate's showLastEditedTimestamp is on.
 *
 * Reddit's own action row (vote pill, reply, award, share, "…") stays in the page, sealed and
 * hidden by the stylesheet only while `data-rescue-ov` is set; the bridge keeps pressing its buttons.
 */
import { h, parseDate } from '../../../core/dom';
import {
  childMatching,
  commentScoreOf,
  ownActionRow,
  ownMatches,
  ownMoreRepliesControl,
} from '../../../model/commentRow';
import { editedAtOf, editedText } from '../../../model/edited';
import { agoText, pointsText } from '../../../model/oldSkinText';
import type { ActionResult } from '../../../core/actions';
import { C } from '../../../contracts/reddit';
import { openSourcePopup, sourceEnabled } from '../../comments/showSource';
import { showLastEdited } from '../localDate';
import { failureText, MOUNT_ATTR, say, setAttr, setText, type Ctx } from './shared';
import { VoteBox } from './vote';

const META = C.skin.comment.meta;
const A = C.commentAttr;
/** The times an "Edited" marker can carry (see lastEdited). */
const EDITED_TIMES = `${C.edited.span} ${C.edited.timeago}`;

/** What other modules' settings change in a comment's rows; read once per settings change. */
export interface CommentPrefs {
  /** localDate's showLastEditedTimestamp: "(last edited …)" as text instead of "*". */
  lastEdited: boolean;
  /** showSource is on: the "source" word is shown. */
  source: boolean;
}

export const commentPrefs = (ctx: Ctx): CommentPrefs => ({
  lastEdited: showLastEdited(ctx),
  source: sourceEnabled(ctx),
});

const child = childMatching;

export class CommentView {
  private readonly vote: VoteBox;
  private readonly pts: HTMLElement;
  private readonly score: HTMLElement;
  private readonly when: HTMLElement;
  private readonly edited: HTMLElement;
  private readonly links: HTMLElement;
  private readonly permalink: HTMLAnchorElement;
  private readonly save: HTMLButtonElement;
  private readonly sourceBtn: HTMLButtonElement;
  private inboxBtn: HTMLButtonElement | null = null;
  /** The state REScue last set; Reddit's attribute only catches up on the next page load (live). */
  private inboxSet: boolean | null = null;
  private saved = false;
  private id: string;
  private readonly details: HTMLDetailsElement | null;
  /** The words of the link row and what each does (one listener on the row runs them). */
  private readonly acts = new Map<Element, () => void>();
  /** The comment's own action row as last found; undefined: look again (see row()). */
  private rowEl: Element | null | undefined;
  /** editedAtOf reads the comment's whole subtree, so it is only read again when the head's times change. */
  private editedSig: string | null = null;
  private editedAt: Date | null = null;
  /**
   * Opening a collapsed comment ([+]) whose replies Reddit has not loaded yet shows only its own
   * "N more replies" button, so a second click was needed; press that button for the reader.
   */
  private readonly onToggle = (): void => {
    if (!this.details?.open || this.host.querySelector(C.comment)) return;
    ownMoreRepliesControl(this.host)?.click();
  };

  static mount(
    host: Element,
    ctx: Ctx,
    prefs: () => CommentPrefs = () => commentPrefs(ctx),
  ): CommentView | null {
    const id = host.getAttribute(A.id);
    if (!id) return null;
    const me = ctx.session.username?.toLowerCase();
    const author = host.getAttribute(A.author) || null;
    return new CommentView(host, ctx, prefs, id, !!me && author?.toLowerCase() === me);
  }

  private constructor(
    private readonly host: Element,
    private readonly ctx: Ctx,
    private readonly prefs: () => CommentPrefs,
    id: string,
    own: boolean,
  ) {
    this.id = id;
    const target = { id, source: host };
    this.vote = new VoteBox({
      host,
      kind: 'comment',
      id,
      ctx,
      readScore: () => commentScoreOf(host, this.row()),
      root: () => this.row()?.shadowRoot ?? null,
    });
    this.score = h('span', { class: 'rescue-oscore' });
    this.when = h('span', { class: 'rescue-owhen' });
    this.edited = h('span', { class: 'rescue-oedited', hidden: true }, '*');
    this.pts = h('span', { class: 'rescue-opts' }, this.score, ' ', this.when, this.edited);
    this.permalink = h('a', { class: 'rescue-olink' }, 'permalink');
    this.save = h('button', { type: 'button', class: 'rescue-olink' }, 'save');
    this.acts.set(this.save, () => void this.toggleSave(target));
    this.sourceBtn = h('button', { type: 'button', class: 'rescue-olink' }, 'source');
    this.acts.set(this.sourceBtn, () => void openSourcePopup(this.id, ctx, null, this.sourceBtn));
    this.links = h(
      'ul',
      { class: 'rescue-olinks rescue-ocl' },
      h('li', null, this.permalink),
      h('li', null, this.save),
      // Your own comment: old Reddit's edit, inbox-replies and delete words, each pressing the row
      // of Reddit's own menu (Reddit asks before deleting).
      ...(own
        ? [
            this.item('edit', () => ctx.actions.startEdit(target)),
            h('li', null, this.inboxToggle(target)),
            this.item('delete', () => ctx.actions.delete(target)),
          ]
        : []),
      this.item('report', () => ctx.actions.report(target)),
      h('li', null, this.sourceBtn),
      this.item('reply', () => ctx.actions.startReply(target)),
    );
    // A click on a word never reaches Reddit's card; a plain click runs the word.
    this.links.addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('button') : null;
      const run = b && this.acts.get(b);
      if (!run) return;
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      run();
    });
    this.details = child(host, 'details') as HTMLDetailsElement | null;
    this.details?.addEventListener('toggle', this.onToggle);
    // The words are filled in before the pieces go into the page.
    this.fill();
    host.append(this.vote.el);
    this.place();
    setAttr(host, MOUNT_ATTR, '1');
  }

  private item(text: string, run: () => Promise<ActionResult>): HTMLElement {
    const b = h('button', { type: 'button', class: 'rescue-olink' }, text);
    this.acts.set(b, () => {
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

  /** "disable inbox replies" / "enable inbox replies": reads Reddit's row, flips it, shows the result. */
  private inboxToggle(target: { id: string; source: Element }): HTMLButtonElement {
    const b = h('button', { type: 'button', class: 'rescue-olink' }, this.inboxWord());
    this.inboxBtn = b;
    this.acts.set(b, () => {
      if (b.getAttribute('aria-busy') === 'true') return;
      setAttr(b, 'aria-busy', 'true');
      void (async () => {
        // Reddit's menu element says it (no need to open the menu); its row is the fallback.
        const attr = this.inboxOn();
        const now =
          attr === null ? await this.ctx.actions.inboxRepliesState(target) : attr ? 'on' : 'off';
        if (now === null) {
          say(
            this.ctx,
            'REScue could not find the inbox-replies item in Reddit’s menu for this comment.',
          );
          return;
        }
        const on = now === 'off';
        const r = await this.ctx.actions.inboxReplies(target, on);
        if (r.ok) {
          this.inboxSet = on;
          setText(b, this.inboxWord());
        } else say(this.ctx, failureText('inbox replies', r));
      })().finally(() => setAttr(b, 'aria-busy', null));
    });
    return b;
  }

  /** Whether replies go to your inbox, from Reddit's own menu element; null before it is there. */
  private inboxOn(): boolean | null {
    if (this.inboxSet !== null) return this.inboxSet;
    const menu = this.row()?.querySelector(C.commentActions.overflowMenu);
    return menu ? menu.hasAttribute(C.commentActions.sendRepliesAttr) : null;
  }

  private inboxWord(): string {
    return this.inboxOn() === false ? 'enable inbox replies' : 'disable inbox replies';
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

  /**
   * The comment's own action row, kept while it is still the comment's (finding it walks the
   * comment's own part). Not there yet: looked for again on the next render, which follows the row
   * appearing (watchCommentRows).
   */
  private row(): Element | null {
    const r = this.rowEl;
    if (r === undefined || (r && !(r.isConnected && r.closest(C.comment) === this.host)))
      this.rowEl = ownActionRow(this.host);
    return this.rowEl ?? null;
  }

  /** The comment's own head line (never a reply's). */
  private meta(): Element | null {
    return child(child(child(this.host, 'details'), 'summary'), META);
  }

  /**
   * When the comment was last edited (editedAtOf, which reads the comment's whole subtree), read
   * again only when the times in its head's spans change. editedAtOf only finds an edit in a time
   * inside a span of the comment's own head, so with no such time it is not edited.
   */
  private lastEdited(): Date | null {
    const sig = ownMatches(this.host, C.edited.meta)
      .map((m) =>
        [...m.querySelectorAll(EDITED_TIMES)].map((t) => t.getAttribute(C.time.tsAttr)).join(','),
      )
      .join('|');
    if (sig !== this.editedSig) {
      this.editedSig = sig;
      this.editedAt = sig.replace(/\|/g, '') ? editedAtOf(this.host) : null;
    }
    return this.editedAt;
  }

  /** Put the points text after Reddit's author group and the link row under the body. */
  private place(): void {
    const meta = this.meta();
    const group = meta?.firstElementChild;
    if (meta && group && this.pts.previousElementSibling !== group) group.after(this.pts);
    // Reddit's grid under the head; a comment shaped differently still gets its link row (at its end).
    const grid = child(child(this.host, 'details'), 'div.grid') ?? this.host;
    const actions = child(grid, 'div:has(> [slot="actionRow"])');
    if (this.links.parentElement !== grid) {
      if (actions) actions.before(this.links);
      else grid.append(this.links);
    }
  }

  render(): void {
    if (this.fill()) this.place();
  }

  /** Sets every word from the page; false when the comment has no id (left as it is). */
  private fill(): boolean {
    const id = this.host.getAttribute(A.id);
    if (!id) return false;
    this.id = id;
    if (this.rowEl === null) this.rowEl = undefined;
    this.vote.update();
    // Reddit's menu element arrives after the row: keep the inbox word in step with it.
    if (this.inboxBtn && this.inboxBtn.getAttribute('aria-busy') !== 'true')
      setText(this.inboxBtn, this.inboxWord());
    const score = this.vote.shown;
    setText(this.score, score === null ? '[score hidden]' : pointsText(score));
    setText(this.when, agoText(parseDate(this.host.getAttribute(A.created))));
    const prefs = this.prefs();
    const edited = editedText(this.lastEdited(), prefs.lastEdited);
    setAttr(this.edited, 'hidden', edited ? null : '');
    setText(this.edited, edited?.text ?? '');
    setAttr(this.edited, 'title', edited?.title ?? null);
    setAttr(this.permalink, 'href', this.host.getAttribute(A.permalink));
    const item = this.sourceBtn.parentElement;
    if (item) setAttr(item, 'hidden', prefs.source ? null : '');
    return true;
  }

  /**
   * The pieces are all still in place. A comment without the head line (no author group in a
   * `details > summary` meta) never gets the points text, only the vote column and the link row,
   * so it is intact without it (otherwise every check would remount it, forever).
   */
  intact(): boolean {
    return (
      this.vote.el.parentElement === this.host &&
      this.links.parentElement !== null &&
      (this.pts.parentElement !== null || !this.meta()?.firstElementChild)
    );
  }

  dispose(): void {
    this.details?.removeEventListener('toggle', this.onToggle);
    this.vote.dispose();
    this.pts.remove();
    this.links.remove();
    this.host.removeAttribute(MOUNT_ATTR);
  }
}
