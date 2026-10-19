/**
 * Is the reader signed in, and as whom? The username is read from the attribute Reddit stamps on
 * the page from the first byte; header links are a fallback (Sheddit src/core/session.js,
 * GPL-3.0, kookaburrabarrel, cff40d7).
 */
import { C } from '../contracts/reddit';
import type { Session } from './types';

const USERNAME = /^[A-Za-z0-9_-]{3,20}$/;

/**
 * Is enough of the page there to start REScue before Reddit has finished sending it? The header,
 * the signed-in state (and, signed in, the name) and the first post or feed must all be in.
 */
export function pageStartable(doc: Document = document): boolean {
  const S = C.session;
  const app = doc.querySelector(C.app);
  const state = app?.getAttribute(S.loggedInAttr);
  if (!doc.body || !doc.querySelector(C.header) || (state !== 'true' && state !== 'false'))
    return false;
  if (
    state === 'true' &&
    !doc.querySelector(S.currentUser) &&
    !doc.querySelector(S.usernameAttrSel)
  )
    return false;
  return !!doc.querySelector(`${C.feed}, ${C.post}, ${C.comment}`);
}

export function readSession(doc: Document = document): Session {
  const S = C.session;
  let username =
    doc.querySelector(S.usernameAttrSel)?.getAttribute(S.usernameAttr) ??
    doc.querySelector(S.currentUser)?.getAttribute(S.currentUserAttr) ??
    null;
  if (!username) {
    for (const a of doc.querySelectorAll(S.usernameLinks)) {
      const m = /\/user\/([^/?#]+)/.exec(a.getAttribute('href') ?? '');
      if (m) {
        username = decodeURIComponent(m[1]!);
        break;
      }
    }
  }
  if (username && !USERNAME.test(username)) username = null;
  const signedIn =
    !!username || (!!doc.querySelector(S.loggedIn) && !doc.querySelector(S.loggedOut));
  return { signedIn, username: signedIn ? username : null };
}

const CONTENT_ITEM = `${C.post}, ${C.comment}, ${C.search.post}`;
/** REScue's own overlays (tools row, gear, notices): they change on every batch and are never the header. */
const OWN_UI = '[id^="rescue-"], .rescue-overlay';

/**
 * A childList change that only adds or removes posts and comments cannot flip the session. Endless
 * pages produce one of these per batch, and re-reading the session scans the whole page.
 */
function isContentOnly(r: MutationRecord): boolean {
  if (r.type !== 'childList') return false;
  // Anything changing inside a post or comment (REScue's own chips and toggles, Reddit's vote
  // updates) is not the header: the session lives outside the content items.
  if (r.target instanceof Element && r.target.closest(`${CONTENT_ITEM}, ${OWN_UI}`)) return true;
  const nodes = [...r.addedNodes, ...r.removedNodes];
  return nodes.length > 0 && nodes.every((n) => n instanceof Element && n.matches(CONTENT_ITEM));
}

/** Calls `onChange` when the session flips (e.g. sign-out in another tab re-renders the header). */
export function watchSession(onChange: (s: Session) => void, doc: Document = document): () => void {
  let last = readSession(doc);
  const mo = new MutationObserver((records) => {
    if (records.every(isContentOnly)) return;
    const next = readSession(doc);
    if (next.signedIn !== last.signedIn || next.username !== last.username) {
      last = next;
      onChange(next);
    }
  });
  mo.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [C.session.loggedInAttr, C.session.usernameAttr],
  });
  return () => mo.disconnect();
}
