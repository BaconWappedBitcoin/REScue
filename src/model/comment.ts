/**
 * shreddit-comment elements -> Comment models, threaded from `depth`, never from DOM shape:
 * Reddit has shipped comments both flat and nested, and `depth` was truthful in both.
 *
 * Ported from Sheddit src/core/model.js comment() — GPL-3.0, kookaburrabarrel, commit cff40d7.
 */
import { C, contractUsable } from '../contracts/reddit';
import { ownQueryAll, parseDate, parseNumber, sanitizedInner } from '../core/dom';
import { ContractTally } from './tally';
import type { Comment, CommentNode } from './types';

function distinguishedOf(el: Element): Comment['distinguished'] {
  // Presence attributes (research R7, verified live 2026-10-15 for moderators).
  if (!contractUsable('comment.distinguished')) return null;
  if (el.hasAttribute(C.commentDistinguished.admin)) return 'admin';
  if (el.hasAttribute(C.commentDistinguished.moderator)) return 'moderator';
  return null;
}

export function parseComment(
  el: Element,
  postAuthor: string | null,
  tally?: ContractTally,
): Comment | null {
  const A = C.commentAttr;
  const id = el.getAttribute(A.id);
  if (!id) {
    tally?.miss('comment.attrs');
    return null;
  }
  tally?.hit('comment.attrs');
  // The first body in document order is almost always the comment's own; only a comment that
  // renders its replies before its body needs the scoped search over its whole subtree.
  const first = el.querySelector(C.commentBody);
  const body =
    first && first.closest(C.comment) === el
      ? first
      : (ownQueryAll(el, C.commentBody, C.comment)[0] ?? null);
  if (body) tally?.hit('comment.body');
  else tally?.miss('comment.body');
  const author = el.getAttribute(A.author) || null;
  const hidden = el.hasAttribute(C.commentScoreHidden);
  // Sanitizing a body copies its whole subtree and few features read it, so it happens on first use.
  let bodyHtml: string | undefined;
  return {
    kind: 'comment',
    id,
    postId: el.getAttribute(A.postId),
    parentId: null,
    depth: Math.max(0, parseNumber(el.getAttribute(A.depth)) ?? 0),
    author,
    isOp: !!author && !!postAuthor && author === postAuthor,
    distinguished: distinguishedOf(el),
    score: hidden ? null : parseNumber(el.getAttribute(A.score)),
    created: parseDate(el.getAttribute(A.created)),
    get bodyHtml(): string {
      return (bodyHtml ??= sanitizedInner(body));
    },
    permalink: el.getAttribute(A.permalink),
    source: el,
  };
}

/** What threading needs to remember about a parsed comment element. */
export interface ThreadInfo {
  id: string;
  /** Depth as Reddit reports it. */
  depth: number;
  /** Depth after clamping to the threading stack. */
  level: number;
}
export type ThreadCache = WeakMap<Element, ThreadInfo>;

/** Where threading stopped: the open-ancestor stack and the last comment element it covered. */
export interface ThreadTail {
  stack: string[];
  last: Element | null;
}

/** Thread `els` (document order) onto `stack`, parsing the ones the cache has not seen. */
function threadInto(
  els: ArrayLike<Element>,
  stack: string[],
  postAuthor: string | null,
  tally: ContractTally | undefined,
  cache: ThreadCache | undefined,
): Comment[] {
  const out: Comment[] = [];
  for (let i = 0; i < els.length; i++) {
    const el = els[i]!;
    const prior = cache?.get(el);
    let c: Comment | null = null;
    let id: string;
    let depth: number;
    if (prior) {
      id = prior.id;
      depth = prior.depth;
    } else {
      c = parseComment(el, postAuthor, tally);
      if (!c) continue;
      id = c.id;
      depth = c.depth;
    }
    // A depth jump of more than one (a gap from collapsed/unloaded replies) clamps to the stack.
    const level = Math.min(depth, stack.length);
    stack.length = level;
    stack[level] = id;
    if (c) {
      c.parentId = level === 0 ? null : (stack[level - 1] ?? null);
      cache?.set(el, { id, depth, level });
      out.push(c);
    }
  }
  return out;
}

/**
 * Thread comment elements that arrived after `tail.last` in document order, without walking the
 * page: the cost follows the batch, not the thread. Returns null when the elements cannot be
 * appended safely (one was parsed before, or the thread was not threaded up to the end yet), so
 * the caller falls back to a full `parseComments`.
 */
export function parseAppendedComments(
  added: Element[],
  tail: ThreadTail,
  postAuthor: string | null,
  tally: ContractTally,
  cache: ThreadCache,
): Comment[] | null {
  const last = tail.last;
  if (!last || !last.isConnected || added.length === 0) return null;
  const els = added.length > 1 ? sortedByPosition(added) : added;
  if (!(last.compareDocumentPosition(els[0]!) & Node.DOCUMENT_POSITION_FOLLOWING)) return null;
  if (els.some((el) => !el.isConnected || cache.has(el))) return null;
  const out = threadInto(els, tail.stack, postAuthor, tally, cache);
  tail.last = els[els.length - 1]!;
  return out;
}

/** Elements in document order (sorts only when they are not already). */
export function sortedByPosition(els: Element[]): Element[] {
  let sorted = true;
  for (let i = 1; i < els.length && sorted; i++) {
    if (!(els[i - 1]!.compareDocumentPosition(els[i]!) & Node.DOCUMENT_POSITION_FOLLOWING)) {
      sorted = false;
    }
  }
  if (sorted) return els;
  return [...els].sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
}

/**
 * Parse every comment under `root` in document order and assign parentId via a depth stack.
 *
 * With a `cache`, comments parsed before are not parsed or returned again: an endless thread
 * re-threads on every batch, so threading restarts at the first element not in the cache, with the
 * stack rebuilt from the cached levels before it. The cache is filled as comments are parsed.
 */
export function parseComments(
  root: ParentNode,
  postAuthor: string | null,
  tally?: ContractTally,
  cache?: ThreadCache,
  tail?: ThreadTail,
): Comment[] {
  const all = root.querySelectorAll(C.comment);
  let lo = 0;
  if (cache) while (lo < all.length && cache.has(all[lo]!)) lo++;
  const stack: string[] = [];
  if (cache) {
    let need = Infinity;
    for (let j = lo - 1; j >= 0 && need > 0; j--) {
      const prior = cache.get(all[j]!);
      if (prior && prior.level < need) {
        stack[prior.level] = prior.id;
        need = prior.level;
      }
    }
  }
  const rest: Element[] = [];
  for (let i = lo; i < all.length; i++) rest.push(all[i]!);
  const out = threadInto(rest, stack, postAuthor, tally, cache);
  if (tail) {
    tail.stack = stack;
    tail.last = all.length ? all[all.length - 1]! : null;
  }
  return out;
}

export function buildTree(comments: Comment[]): CommentNode[] {
  const nodes = new Map<string, CommentNode>();
  const roots: CommentNode[] = [];
  for (const c of comments) {
    const node: CommentNode = { comment: c, children: [] };
    nodes.set(c.id, node);
    const parent = c.parentId ? nodes.get(c.parentId) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}
