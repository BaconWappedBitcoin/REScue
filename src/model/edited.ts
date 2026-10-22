/**
 * Edited-timestamp reader for comments. Reddit draws an "Edited N ago" marker in a comment's own
 * meta slot (verified live 2026-10-21); the comment element has no edited attribute, so the marker
 * is the only source. This only reads the comment's OWN meta, never a reply's.
 */
import { C } from '../contracts/reddit';
import { ownQueryAll } from '../core/dom';
import { agoText } from './oldSkinText';

function ownTextBeforeTimeago(span: Element): string {
  const timeago = span.querySelector(C.edited.timeago);
  if (!timeago) return span.textContent ?? '';
  const out: string[] = [];
  for (const node of span.childNodes) {
    if (node === timeago || node.contains(timeago)) break;
    if (node.nodeType === Node.TEXT_NODE) out.push(node.textContent ?? '');
  }
  return out.join('');
}

/** The last-edited time of a comment, read only from its own meta slot. Null when not edited. */
export function editedAtOf(comment: Element): Date | null {
  if (!comment.matches(C.comment)) return null;
  for (const meta of ownQueryAll(comment, C.edited.meta, C.comment)) {
    for (const span of meta.querySelectorAll(C.edited.span)) {
      if (!C.edited.spanText.test(ownTextBeforeTimeago(span))) continue;
      const ts = span.querySelector(C.edited.timeago)?.getAttribute(C.time.tsAttr);
      if (!ts) continue;
      const d = new Date(ts);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}

/**
 * What the Old Reddit look shows after an edited comment's age: old Reddit's "*" with "last edited
 * 5 days ago" on hover, or (showLastEditedTimestamp) the same words as text. Null when not edited.
 */
export function editedText(
  edited: Date | null,
  spelled: boolean,
  now: number = Date.now(),
): { text: string; title: string } | null {
  const ago = agoText(edited, now);
  if (!ago) return null;
  const title = `last edited ${ago}`;
  return { text: spelled ? ` (${title})` : '*', title };
}
