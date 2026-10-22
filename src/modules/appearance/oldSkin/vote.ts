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
import { failureText, say, setAttr, setText, type Ctx } from './shared';

export type Kind = 'post' | 'comment';
export type VoteDir = -1 | 0 | 1;

/** The open shadow root that holds the item's own vote buttons, or null while it is not there. */
export function voteRoot(host: Element, kind: Kind): ShadowRoot | null {
  return kind === 'post' ? host.shadowRoot : (ownActionRow(host)?.shadowRoot ?? null);
}

/** The reader's vote as Reddit's own buttons show it; null when they are not readable. */
export function nativeVote(host: Element, kind: Kind): VoteDir | null {
  return voteIn(voteRoot(host, kind));
}

/** The vote Reddit's buttons in this shadow root show; null when they are not readable. */
function voteIn(root: ShadowRoot | null): VoteDir | null {
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
  /** The shadow root with Reddit's vote buttons, when the caller keeps it (default: voteRoot). */
  root?(): ShadowRoot | null;
}

/**
 * Every vote box follows Reddit's buttons through ONE observer (a big thread has thousands of
 * boxes): each box's shadow root is observed on it, and a change goes to the boxes of that root.
 */
const following = new Map<Node, Set<VoteBox>>();
let follower: MutationObserver | null = null;

function onVoteChanges(records: MutationRecord[]): void {
  const roots = new Set<Node>();
  for (const r of records) roots.add(r.target.getRootNode());
  for (const root of roots) for (const box of [...(following.get(root) ?? [])]) box.update();
}

function follow(root: ShadowRoot, box: VoteBox): void {
  let boxes = following.get(root);
  if (!boxes) {
    following.set(root, (boxes = new Set()));
    follower ??= new MutationObserver(onVoteChanges);
    follower.observe(root, {
      subtree: true,
      attributes: true,
      attributeFilter: [C.native.voteState],
    });
  }
  boxes.add(box);
}

/** An observer cannot stop watching one node: a root nobody follows is ignored, and with no box left the observer goes. */
function unfollow(root: ShadowRoot, box: VoteBox): void {
  const boxes = following.get(root);
  if (!boxes) return;
  boxes.delete(box);
  if (boxes.size) return;
  following.delete(root);
  if (following.size) return;
  follower?.disconnect();
  follower = null;
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
  /** A click made while a vote was in flight, run once that one is settled (the last one wins). */
  private queued: 1 | -1 | null = null;
  private disposed = false;

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
    // One listener for the column: no click on it reaches Reddit's card; a plain click on an arrow votes.
    this.el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      const t = e.target instanceof Node ? e.target : null;
      if (t && this.up.contains(t)) void this.cast(1);
      else if (t && this.down.contains(t)) void this.cast(-1);
    });
    this.update();
  }

  private root(): ShadowRoot | null {
    return this.o.root ? this.o.root() : voteRoot(this.o.host, this.o.kind);
  }

  /** Follow Reddit's own buttons (a key press or Reddit's own click changes them too). */
  private watch(root: ShadowRoot | null): void {
    if (root === this.watched) return;
    if (this.watched) unfollow(this.watched, this);
    this.watched = root;
    if (root) follow(root, this);
  }

  /** Redraw from Reddit's state. Cheap; called on every relevant change. */
  update(): void {
    const root = this.root();
    this.watch(root);
    const vote = voteIn(root);
    const score = this.o.readScore();
    if (
      (this.baseScore === undefined || score !== this.baseScore) &&
      (score === null || vote !== null)
    ) {
      // The number was (re)read from the page: it is true for the vote the buttons show now. (While
      // the buttons are not readable yet the number is shown as it is and the base waits for them.)
      this.baseScore = score;
      this.baseVote = vote ?? 0;
    }
    const shown = (this.shown = score === null ? null : score + ((vote ?? 0) - this.baseVote));
    setText(this.num, shown === null ? '•' : compactScore(shown));
    setAttr(
      this.num,
      'title',
      shown === null ? 'score hidden or not loaded yet' : `${shown} points`,
    );
    setAttr(this.el, 'data-vote', vote === 1 ? 'up' : vote === -1 ? 'down' : 'none');
    setAttr(this.up, 'aria-pressed', String(vote === 1));
    setAttr(this.down, 'aria-pressed', String(vote === -1));
  }

  /**
   * Cast a vote. Reddit's buttons flip within ~60 ms but the vote counts as confirmed only at the
   * next read-back (150 ms on), so a second click in between found the column busy and was dropped
   * without a word (the arrows already showed the new state). It now waits its turn: the last
   * click made while busy runs once the vote before it is settled, against the state then shown.
   */
  private async cast(dir: 1 | -1): Promise<void> {
    if (this.disposed) return;
    if (this.el.getAttribute('aria-busy') === 'true') {
      this.queued = dir;
      return;
    }
    const now = voteIn(this.root());
    const want: VoteDir = now === dir ? 0 : dir;
    setAttr(this.el, 'aria-busy', 'true');
    try {
      const r = await this.o.ctx.actions.vote({ id: this.o.id, source: this.o.host }, want);
      if (!r.ok) say(this.o.ctx, failureText('vote', r));
    } finally {
      setAttr(this.el, 'aria-busy', null);
      this.update();
      const next = this.queued;
      this.queued = null;
      if (next) void this.cast(next);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.queued = null;
    this.watch(null);
    this.el.remove();
  }
}
