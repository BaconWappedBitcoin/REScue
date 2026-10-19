/**
 * Counts the reader's own clicks on Reddit's post and comment vote arrows for the user tagger (RES
 * userTagger.js attachVoteHandler / handleVoteClick, GPL-3.0). Reddit's arrows are
 * `button[upvote]` / `button[downvote]` in the post's open shadow root, or in the open shadow root
 * of a comment's own action row (contracts C.native, C.commentActions). The
 * click is seen in the capture phase, before Reddit's own handler runs, so the pressed state read
 * then is the state BEFORE the vote; the vote is counted only once the state is seen to change and
 * hold, which is the same "confirm through aria-pressed" rule ActionApi uses.
 *
 * Clicks that REScue itself makes (the keyboard vote path) are synthetic, not trusted, so
 * they are ignored here; that path adjusts the tally itself, and nothing is counted twice.
 */
import { C } from '../../contracts/reddit';
import type { VoteState } from '../../core/actions';

export interface VotedItem {
  id: string;
  author: string | null;
}

export interface VoteCounterDeps {
  /** The post or comment this host element is, or undefined for any other element. */
  itemFor(host: Element): VotedItem | undefined;
  /** The signed-in user's name, or null when signed out. */
  me(): string | null;
  /** Reads the post's confirmed vote state (ActionApi.voteState). */
  voteState(target: { id: string; source: Element }): Promise<VoteState>;
  /** Called once per confirmed vote change with the change in up and down counts. */
  apply(author: string, deltaUp: number, deltaDown: number): void;
  /** Count clicks that are not trusted too (tests only; a page script can forge clicks). */
  acceptUntrusted?: boolean;
  confirmMs?: number;
  pollMs?: number;
  sleep?(ms: number): Promise<void>;
}

/** Change in (upvotes, downvotes) when a post goes from vote state `before` to `after`. */
export function voteDeltas(before: -1 | 0 | 1, after: -1 | 0 | 1): { up: number; down: number } {
  return {
    up: Number(after === 1) - Number(before === 1),
    down: Number(after === -1) - Number(before === -1),
  };
}

const isPressed = (el: Element): boolean | null => {
  const v = el.getAttribute(C.native.voteState);
  return v === 'true' ? true : v === 'false' ? false : null;
};

/** Which arrow, the post element it belongs to, and the vote state before this click. */
function readClick(
  e: MouseEvent,
  itemFor: VoteCounterDeps['itemFor'],
): { dir: 1 | -1; host: Element; item: VotedItem; before: -1 | 0 | 1 } | null {
  const path = e.composedPath();
  const button = path.find(
    (n): n is Element =>
      n instanceof Element && (n.matches(C.native.upvote) || n.matches(C.native.downvote)),
  );
  if (!button) return null;
  const dir: 1 | -1 = button.matches(C.native.upvote) ? 1 : -1;
  const host = path.find((n): n is Element => n instanceof Element && itemFor(n) !== undefined);
  const item = host && itemFor(host);
  if (!host || !item) return null;
  const root = button.getRootNode();
  if (!(root instanceof ShadowRoot)) return null;
  // A post's arrows are in its own root; a comment's are in the root of its OWN action row.
  const ownsRoot =
    root.host === host ||
    (root.host.matches(C.commentActions.row) && root.host.closest(C.comment) === host);
  if (!ownsRoot) return null;
  const other = root.querySelector(dir === 1 ? C.native.downvote : C.native.upvote);
  const mine = isPressed(button);
  const theirs = other ? isPressed(other) : null;
  // Both arrows must be readable, or the starting state is a guess.
  if (mine === null || theirs === null) return null;
  const up = dir === 1 ? mine : theirs;
  const down = dir === 1 ? theirs : mine;
  return { dir, host, item, before: up ? 1 : down ? -1 : 0 };
}

/** Start counting. Returns the function that stops it. */
export function attachVoteCounter(deps: VoteCounterDeps, doc: Document = document): () => void {
  const confirmMs = deps.confirmMs ?? 4000;
  const pollMs = deps.pollMs ?? 150;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const busy = new Set<string>();

  /** The new state once it differs from `before` and reads the same twice in a row. */
  async function settled(target: { id: string; source: Element }, before: VoteState) {
    let candidate: VoteState = null;
    for (let waited = 0; waited < confirmMs; waited += pollMs) {
      await sleep(pollMs);
      const now = await deps.voteState(target);
      if (now === null || now === before) {
        candidate = null;
      } else if (now === candidate) {
        return now;
      } else {
        candidate = now;
      }
    }
    return null;
  }

  async function count(click: NonNullable<ReturnType<typeof readClick>>): Promise<void> {
    const { host, item, before } = click;
    const author = item.author;
    const me = deps.me();
    if (!author || !me || author.toLowerCase() === me.toLowerCase()) return;
    if (busy.has(item.id)) return;
    busy.add(item.id);
    try {
      const after = await settled({ id: item.id, source: host }, before);
      if (after === null) return; // Reddit never showed a change: nothing was counted.
      const { up, down } = voteDeltas(before, after);
      if (up || down) deps.apply(author, up, down);
    } finally {
      busy.delete(item.id);
    }
  }

  const onClick = (e: MouseEvent) => {
    if (e.button !== 0 || (!e.isTrusted && !deps.acceptUntrusted)) return;
    const click = readClick(e, deps.itemFor);
    if (click) void count(click);
  };
  doc.addEventListener('click', onClick, true);
  return () => doc.removeEventListener('click', onClick, true);
}
