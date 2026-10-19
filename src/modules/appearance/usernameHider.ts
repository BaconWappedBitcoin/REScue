/**
 * usernameHider (RES usernameHider, "screenshot mode", US8): replaces your username, and any other
 * names you list, with a mask wherever the name is shown in Reddit's light DOM: the author links
 * on posts and comments, links to a profile anywhere in the page, and the header / user menu text
 * when it is reachable. Ported in spirit from RES lib/modules/usernameHider.js (GPL-3.0, the RES
 * contributors, commit 4defffc); RES hid names with CSS font tricks, this swaps text nodes so the
 * page text itself changes, and every swap is recorded so it can be fully reverted.
 *
 * What it does not do: it never reaches into Reddit's closed shadow DOM, so a name shown only
 * inside a shadow root stays visible; link addresses, tooltips and the browser's address bar still
 * contain the real name.
 */
import { defineModule } from '../../core/types';
import { profileLinks, userMenuRoots, userOfHref } from '../../model/appearance';

export const DEFAULT_MASK = '~anon~';
const MAX_MASK = 40;
const OWN_UI = '#rescue-tools, .rescue-overlay';
const NAME = /^[A-Za-z0-9_-]{1,40}$/;

interface Swap {
  original: string;
  masked: string;
}
const swaps = new Map<Text, Swap>();
let names = new Set<string>();
let mask = DEFAULT_MASK;
let observer: MutationObserver | null = null;
let pending = new Set<Node>();
let frame = 0;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Clean a configured mask: trimmed, no longer than 40 characters, never empty. */
export function cleanMask(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().slice(0, MAX_MASK) : '';
  return s || DEFAULT_MASK;
}

/** The names to hide, lower-cased: your own (when signed in and wanted) plus the listed ones. */
export function namesToHide(own: string | null, hideOwn: boolean, listed: string[]): Set<string> {
  const out = new Set<string>();
  if (hideOwn && own) out.add(own.toLowerCase());
  for (const raw of listed) {
    const n = raw.trim().replace(/^\/?(?:u|user)\//i, '');
    if (NAME.test(n)) out.add(n.toLowerCase());
  }
  return out;
}

/** `text` with every hidden name (as a whole name, any case) replaced by `by`. */
export function maskText(text: string, hide: Set<string>, by: string): string {
  if (!hide.size) return text;
  const alt = [...hide].map(escapeRe).join('|');
  const re = new RegExp(`(?<![A-Za-z0-9_-])(?:${alt})(?![A-Za-z0-9_-])`, 'gi');
  return text.replace(re, () => by);
}

function swapNode(node: Text): void {
  const known = swaps.get(node);
  // Our own swap is still in place: nothing to do. Reddit rewrote the node: look at it afresh.
  if (known && node.data === known.masked) return;
  swaps.delete(node);
  const original = node.data;
  const masked = maskText(original, names, mask);
  if (masked === original) return;
  swaps.set(node, { original, masked });
  node.data = masked;
}

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

function maskLink(a: HTMLAnchorElement, user: string | null = userOfHref(a.getAttribute('href'))) {
  if (!user || !names.has(user) || a.closest(OWN_UI)) return;
  for (const t of textNodes(a)) swapNode(t);
}

/** Mask the links under `root` that name a hidden user. */
function scan(root: ParentNode): void {
  for (const [a, user] of profileLinks(root)) maskLink(a, user);
}

function scanMenus(): void {
  for (const menu of userMenuRoots()) {
    if (menu.closest(OWN_UI)) continue;
    for (const t of textNodes(menu)) {
      if (t.parentElement?.closest('script, style')) continue;
      swapNode(t);
    }
  }
}

function flush(): void {
  frame = 0;
  const nodes = pending;
  pending = new Set();
  if (!names.size) return;
  for (const n of nodes) {
    if (!n.isConnected) continue;
    const el = n instanceof Element ? n : n.parentElement;
    if (!el) continue;
    const link = el.closest('a[href]');
    if (link instanceof HTMLAnchorElement) maskLink(link);
    scan(el);
  }
  scanMenus();
}

function queue(node: Node): void {
  pending.add(node);
  if (!frame) frame = requestAnimationFrame(flush);
}

/** Put every swapped text node back (unless Reddit has changed it since). */
export function revertAll(): void {
  for (const [node, { original, masked }] of swaps) {
    if (node.data === masked) node.data = original;
  }
  swaps.clear();
}

interface Applicable {
  options: { mask: string; hideOwn: boolean; hideUsers: string[]; showUsernameOnHover?: boolean };
  session: { username: string | null };
}

let hoverBound = false;

/** Show (`true`) or hide (`false`) the real text of the masked names inside one link. */
export function setRevealed(root: Element, revealed: boolean): void {
  for (const t of textNodes(root)) {
    const s = swaps.get(t);
    if (!s) continue;
    if (revealed && t.data === s.masked) t.data = s.original;
    else if (!revealed && t.data === s.original) t.data = s.masked;
  }
}

const linkOf = (e: Event): Element | null =>
  e.target instanceof Element ? e.target.closest('a[href]') : null;

const onOver = (e: Event): void => {
  const a = linkOf(e);
  if (a && !a.closest(OWN_UI)) setRevealed(a, true);
};
const onOut = (e: Event): void => {
  const a = linkOf(e);
  const to = (e as MouseEvent).relatedTarget;
  if (a && !(to instanceof Node && a.contains(to))) setRevealed(a, false);
};

function bindHover(on: boolean): void {
  if (on === hoverBound) return;
  hoverBound = on;
  const op = on ? 'addEventListener' : 'removeEventListener';
  document[op]('mouseover', onOver, true);
  document[op]('mouseout', onOut, true);
}

function apply(ctx: Applicable): void {
  revertAll();
  const o = ctx.options;
  names = namesToHide(ctx.session.username, o.hideOwn, o.hideUsers);
  mask = cleanMask(o.mask);
  bindHover(Boolean(o.showUsernameOnHover) && names.size > 0);
  if (!names.size) return;
  scan(document);
  scanMenus();
}

export const usernameHider = defineModule({
  id: 'usernameHider',
  resId: 'usernameHider',
  category: 'appearance',
  title: 'Username hider (screenshot mode)',
  description:
    'Replace your username, and any others you list, with a mask wherever Reddit shows it as text: author names on posts and comments, links to a profile, and the header or user menu when REScue can reach it. Reddit’s sealed components cannot be reached, and link addresses and tooltips still contain the real name, so check a screenshot before sharing it.',
  enabledByDefault: false,
  options: {
    mask: {
      type: 'text',
      default: DEFAULT_MASK,
      title: 'Display text',
      description: 'What is shown instead of a hidden name.',
    },
    hideOwn: {
      type: 'boolean',
      default: true,
      title: 'Hide my own username',
      description: 'The account you are signed in as. Does nothing when you are signed out.',
    },
    hideUsers: {
      type: 'list',
      default: [],
      title: 'Also hide these usernames',
      description: 'One username per line.',
    },
    showUsernameOnHover: {
      type: 'boolean',
      default: false,
      title: 'Show the real name while the pointer is over it',
      description:
        'The name comes back as text under the pointer and is masked again when it leaves.',
    },
  },

  init(ctx) {
    apply(ctx);
    observer = new MutationObserver((records) => {
      if (!names.size) return;
      for (const r of records) for (const n of r.addedNodes) queue(n);
    });
    observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  },

  onSettings(ctx) {
    apply(ctx);
  },

  onRoute() {
    // Reddit swaps the page's content on navigation; masks already applied to gone nodes are moot.
    for (const [node] of swaps) if (!node.isConnected) swaps.delete(node);
    if (names.size) queue(document.body ?? document.documentElement);
  },

  dispose() {
    observer?.disconnect();
    observer = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    pending = new Set();
    bindHover(false);
    revertAll();
    names = new Set();
  },
});
