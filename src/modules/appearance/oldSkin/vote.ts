/**
 * Old Reddit look: the vote column (up arrow, score, down arrow), for a post or a comment.
 *
 * State comes from Reddit's own vote buttons (their `aria-pressed`, read in the open shadow root of
 * the post or of the comment's action row); the number is the item's `score` attribute, which is
 * stale until a reload, so it is moved by the change in the reader's own vote since that number was
 * read ("optimistic" after a vote REScue confirmed, or one cast by a key). A vote is cast through
 * `ctx.actions.vote`, which presses Reddit's button and reports success only once the button reads
 * back as requested; signed out it presses nothing and the arrows say so.
 *
 * The arrows are labelled "vote up" / "vote down" on purpose: the bridge also finds Reddit's own
 * buttons by `[aria-label*="upvote"]` (light DOM first), and must never take REScue's arrow for one.
 */
import { C } from '../../../contracts/reddit';
import { h } from '../../../core/dom';
import { compactScore } from '../../../model/oldSkinText';
import { ownActionRow } from '../../../model/commentRow';
import { failureText, onActivate, say, setAttr, setText, type Ctx } from './shared';

export type Kind = 'post' | 'comment';
export type VoteDir = -1 | 0 | 1;

/** The open shadow root that holds the item's own vote buttons, or null while it is not there. */
export function voteRoot(host: Element, kind: Kind): ShadowRoot | null {
  return kind === 'post' ? host.shadowRoot : (ownActionRow(host)?.shadowRoot ?? null);
}

/** The reader's vote as Reddit's own buttons show it; null when they are not readable. */
export function nativeVote(host: Element, kind: Kind): VoteDir | null {
  const root = voteRoot(host, kind);
  const up = root?.querySelector(C.native.upvote);
  const down = root?.querySelector(C.native.downvote);
  if (!up || !down) return null;
  const pu = up.getAttribute(C.native.voteState);
  const pd = down.getAttribute(C.native.voteState);
  if (pu === null || pd === null) return null;
  return pu === 'true' ? 1 : pd === 'true' ? -1 : 0;
}

export interface VoteBoxOptions {
  host: Element;
  kind: Kind;
  id: string;
  ctx: Ctx;
  /** The item's score as the page knows it, or null (a hidden or unknown score). */
  readScore(): number | null;
}

export class VoteBox {
  readonly el: HTMLElement;
  private readonly up: HTMLButtonElement;
  private readonly down: HTMLButtonElement;
  private readonly num: HTMLElement;
  private baseScore: number | null | undefined;
  private baseVote: VoteDir = 0;
  /** The number on show (the score moved by the reader's own vote), or null when none is known. */
  shown: number | null = null;
  private watched: ShadowRoot | null = null;
  private observer: MutationObserver | null = null;

  constructor(private readonly o: VoteBoxOptions) {
    const arrow = (cls: string, label: string): HTMLButtonElement =>
      h('button', {
        type: 'button',
        class: `rescue-oarrow ${cls}`,
        'aria-label': label,
        'aria-pressed': 'false',
        title: label,
      });
    this.up = arrow('rescue-oup', 'vote up');
    this.down = arrow('rescue-odown', 'vote down');
    this.num = h('div', { class: 'rescue-onum' }, '•');
    const cls = o.kind === 'post' ? 'rescue-opv' : 'rescue-ocv';
    this.el = h(
      'div',
      { class: `rescue-ovote ${cls}`, role: 'group', 'aria-label': 'vote' },
      this.up,
      this.num,
      this.down,
    );
    onActivate(this.up, () => void this.cast(1));
    onActivate(this.down, () => void this.cast(-1));
    this.el.addEventListener('click', (e) => e.stopPropagation());
    this.update();
  }

  /** Follow Reddit's own buttons (a key press or Reddit's own click changes them too). */
  private watch(): void {
    const root = voteRoot(this.o.host, this.o.kind);
    if (root === this.watched) return;
    this.observer?.disconnect();
    this.watched = root;
    if (!root) return;
    this.observer ??= new MutationObserver(() => this.update());
    this.observer.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: [C.native.voteState],
    });
  }

  /** Redraw from Reddit's state. Cheap; called on every relevant change. */
  update(): void {
    this.watch();
    const vote = nativeVote(this.o.host, this.o.kind);
    const score = this.o.readScore();
    if ((this.baseScore === undefined || score !== this.baseScore) && (score === null || vote !== null)) {
      // The number was (re)read from the page: it is true for the vote the buttons show now. (While
      // the buttons are not readable yet the number is shown as it is and the base waits for them.)
      this.baseScore = score;
      this.baseVote = vote ?? 0;
    }
    const shown = (this.shown = score === null ? null : score + ((vote ?? 0) - this.baseVote));
    setText(this.num, shown === null ? '•' : compactScore(shown));
    setAttr(this.num, 'title', shown === null ? 'score hidden or not loaded yet' : `${shown} points`);
    setAttr(this.el, 'data-vote', vote === 1 ? 'up' : vote === -1 ? 'down' : 'none');
    setAttr(this.up, 'aria-pressed', String(vote === 1));
    setAttr(this.down, 'aria-pressed', String(vote === -1));
  }

  private async cast(dir: 1 | -1): Promise<void> {
    if (this.el.getAttribute('aria-busy') === 'true') return;
    const now = nativeVote(this.o.host, this.o.kind);
    const want: VoteDir = now === dir ? 0 : dir;
    setAttr(this.el, 'aria-busy', 'true');
    try {
      const r = await this.o.ctx.actions.vote({ id: this.o.id, source: this.o.host }, want);
      if (!r.ok) say(this.o.ctx, failureText('vote', r));
    } finally {
      setAttr(this.el, 'aria-busy', null);
      this.update();
    }
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.el.remove();
  }
}
