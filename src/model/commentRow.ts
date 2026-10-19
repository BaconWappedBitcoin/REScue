/**
 * A comment's action row (`shreddit-comment-action-row`, contracts: commentActions; research R20):
 * the light-DOM child that carries a comment's live `score`, `is-score-hidden` and `vote-state`.
 * The row hydrates lazily as the comment nears the viewport, and `shreddit-comment[score]` reads "1"
 * for a hidden score, so a comment's score is only KNOWN once its row is there and says it is not
 * hidden. Until then it is unknown, and score filters and colours leave the comment alone.
 */
import { C } from '../contracts/reddit';
import { ownQueryAll, parseNumber } from '../core/dom';

/** The comment's OWN action row (never a nested reply's), or null while it has not appeared. */
export function ownActionRow(host: Element): Element | null {
  for (const row of host.querySelectorAll(C.commentActions.row)) {
    if (row.closest(C.comment) === host) return row;
  }
  return null;
}

/**
 * Whether the reader's vote on this comment is an upvote, read from the upvote button in the action
 * row's OPEN shadow root (never written to). Null when the row, its root, the button or its
 * `aria-pressed` is not there yet. The row's own stale `vote-state` attribute is deliberately not
 * used (research R20; see bridge.content.ts).
 */
export function commentUpvoted(host: Element): boolean | null {
  const root = ownActionRow(host)?.shadowRoot ?? null;
  const pressed = root?.querySelector(C.native.upvote)?.getAttribute(C.native.voteState);
  return pressed == null ? null : pressed !== 'false';
}

/**
 * The comment's OWN "N more replies" control (contracts: comment.moreReplies), found in its own
 * subtree by its words. Null when there is none, so the caller does nothing.
 */
export function ownMoreRepliesControl(host: Element): HTMLElement | null {
  for (const el of ownQueryAll(host, C.moreRepliesControl, C.comment)) {
    if (el instanceof HTMLElement && C.moreRepliesLabel.test(el.textContent ?? '')) return el;
  }
  return null;
}

const A = C.commentActions;

/** The comment's thing id (t1_…), as the models carry it. */
export const commentThingId = (host: Element): string | null => host.getAttribute(C.commentAttr.id);

/** A row that has taken Reddit's data: its attributes are filled in. */
const hydrated = (row: Element): boolean =>
  row.hasAttribute(A.scoreAttr) ||
  row.hasAttribute(A.idAttr) ||
  row.hasAttribute(A.voteStateAttr) ||
  row.hasAttribute(A.scoreHiddenAttr);

const isOn = (v: string | null): boolean => {
  if (v === null) return false;
  const s = v.trim().toLowerCase();
  return s !== 'false' && s !== '0';
};

/**
 * The comment's score, or null when unknown: no hydrated row yet, a hidden score, or no number.
 * Never the comment's own `score` attribute alone, because that reads "1" when the score is hidden.
 */
export function commentScoreOf(host: Element): number | null {
  const row = ownActionRow(host);
  if (!row || !hydrated(row) || isOn(row.getAttribute(A.scoreHiddenAttr))) return null;
  return parseNumber(row.getAttribute(A.scoreAttr) ?? host.getAttribute(C.commentAttr.score));
}

/**
 * Call `cb(host)` with the comment whose action row appeared or changed its score. Calls are
 * batched, so a burst of rows hydrating costs one callback per comment. Returns a disposer.
 */
export function watchCommentRows(
  cb: (host: Element) => void,
  doc: Document = document,
): () => void {
  const pending = new Set<Element>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const hosts = [...pending];
    pending.clear();
    for (const host of hosts) if (host.isConnected) cb(host);
  };
  const queue = (node: Node | null) => {
    const el = node instanceof Element ? node : (node?.parentElement ?? null);
    const row = el?.closest(A.row);
    const host = row?.closest(C.comment);
    if (!row || !host || ownActionRow(host) !== row) return;
    pending.add(host);
    timer ??= setTimeout(flush, 50);
  };
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') queue(r.target);
      else
        for (const n of r.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (n.matches(A.row)) queue(n);
          else if (n.parentElement?.matches(A.row)) queue(n.parentElement);
        }
    }
  });
  mo.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [A.scoreAttr, A.scoreHiddenAttr, A.idAttr],
  });
  return () => {
    mo.disconnect();
    if (timer) clearTimeout(timer);
    pending.clear();
  };
}
