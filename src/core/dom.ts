/** Tiny DOM builder, escaping, body-HTML sanitizer, and formatting helpers. */
import { OWNER_ATTR, stamp } from './instance';

type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;

/** h('a', { href: '/x', class: 'title' }, 'text') — attributes set via setAttribute; on* as listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  // Owned by this instance, so a newer one (after an add-on reload) sweeps it up (instance.ts).
  return stamp(el);
}

const ESC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]!);

const ALLOWED_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'details',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
]);
const ALLOWED_ATTRS = new Set([
  'href',
  'src',
  'alt',
  'title',
  'colspan',
  'rowspan',
  'align',
  'width',
  'height',
]);
/** A path on this site (never `//host` or `/\host`, which browsers read as another host). */
const SAFE_URL = /^(https?:|\/(?![/\\])|#|mailto:)/i;

/** Browsers drop tabs and newlines inside an address, so they are dropped before checking too. */
const safeUrl = (value: string): boolean => SAFE_URL.test(value.replace(/[\t\n\r]/g, '').trim());

let inertDoc: Document | null = null;
/**
 * The copies are built in a document that is not shown and runs nothing: an <img> made there
 * never loads its picture (one made with the page's own document starts loading at once).
 */
const inert = (): Document => (inertDoc ??= document.implementation.createHTMLDocument(''));

/**
 * Allowlist sanitizer for user-authored bodies copied out of Reddit's DOM. Unknown elements are
 * unwrapped (children kept); script-like elements are dropped with their content. The fragment
 * belongs to an inert document; appending it to the page adopts it.
 */
export function sanitizeNode(src: Node): DocumentFragment {
  const doc = inert();
  const out = doc.createDocumentFragment();
  const walk = (node: Node, parent: Node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        parent.appendChild(doc.createTextNode(child.textContent ?? ''));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (
        /^(script|style|iframe|object|embed|noscript|template|form|input|button|textarea|select|svg|math|link|meta)$/.test(
          tag,
        )
      ) {
        continue;
      }
      if (!ALLOWED_TAGS.has(tag)) {
        walk(el, parent);
        continue;
      }
      const copy = doc.createElement(tag);
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        if (!ALLOWED_ATTRS.has(name)) continue;
        if ((name === 'href' || name === 'src') && !safeUrl(attr.value)) continue;
        copy.setAttribute(name, attr.value);
      }
      if (tag === 'a') copy.setAttribute('rel', 'noopener noreferrer nofollow');
      walk(el, copy);
      parent.appendChild(copy);
    }
  };
  walk(src, out);
  return out;
}

export function sanitizeHtml(html: string): string {
  const tpl = inert().createElement('template');
  tpl.innerHTML = html;
  const wrap = inert().createElement('div');
  wrap.appendChild(sanitizeNode(tpl.content));
  return wrap.innerHTML;
}

/** Sanitized innerHTML of an element (empty string for null). */
export const sanitizedInner = (el: Element | null): string => {
  if (!el) return '';
  const wrap = inert().createElement('div');
  wrap.appendChild(sanitizeNode(el));
  return wrap.innerHTML;
};

const UNITS: Array<[number, string]> = [
  [365 * 86400, 'year'],
  [30 * 86400, 'month'],
  [86400, 'day'],
  [3600, 'hour'],
  [60, 'minute'],
];

/** "3 hours ago", in old-reddit style. */
export function relativeTime(date: Date | null, now: number = Date.now()): string {
  if (!date) return '';
  const secs = Math.max(0, Math.round((now - date.getTime()) / 1000));
  for (const [size, unit] of UNITS) {
    if (secs >= size) {
      const n = Math.floor(secs / size);
      return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

/** 1234 -> "1.2k", 1500000 -> "1.5m". */
export function compactNumber(n: number | null): string {
  if (n === null) return '•';
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}m`;
  if (abs >= 1e4) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

export const parseNumber = (v: string | null | undefined): number | null => {
  if (v === null || v === undefined || v.trim() === '') return null;
  const n = Number(v.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

export const parseDate = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Closest-owner scoping: query within `root` but only nodes whose nearest `ownerSel` is `root`.
 * With no nested owner (a comment without replies) this is one query. Otherwise the walk stops at
 * each nested owner instead of listing (and then discarding) everything inside the replies: a top
 * comment of a long thread holds thousands of them.
 */
export function ownQueryAll(root: Element, sel: string, ownerSel: string): Element[] {
  if (!root.matches(ownerSel)) {
    return [...root.querySelectorAll(sel)].filter((n) => n.closest(ownerSel) === root);
  }
  if (!root.querySelector(ownerSel)) return [...root.querySelectorAll(sel)];
  const out: Element[] = [];
  const visit = (parent: Element): void => {
    for (let el = parent.firstElementChild; el; el = el.nextElementSibling) {
      if (el.matches(ownerSel)) continue; // a nested item and everything in it belongs to it
      if (el.matches(sel)) out.push(el);
      if (el.firstElementChild) visit(el);
    }
  };
  visit(root);
  return out;
}

/**
 * An element that is not one of REScue's own (stamped by core/instance). REScue's controls never
 * hold Reddit's elements, and they are most of what a decorated batch adds.
 */
const foreign = (n: Node): n is Element => n instanceof Element && !n.hasAttribute(OWNER_ATTR);

/**
 * The elements matching `sel` that a burst of mutations added (an added element itself, or inside
 * it), in record order. Observers use it to look only at what arrived instead of querying the
 * whole document after every burst.
 */
export function addedMatching(records: readonly MutationRecord[], sel: string): Element[] {
  const out: Element[] = [];
  for (const r of records) {
    for (const n of r.addedNodes) {
      if (!foreign(n)) continue;
      if (n.matches(sel)) out.push(n);
      out.push(...n.querySelectorAll(sel));
    }
  }
  return out;
}

/** Did a burst add, or remove, an element matching `sel` (itself or inside an added/removed one)? */
export function burstTouches(records: readonly MutationRecord[], sel: string): boolean {
  for (const r of records) {
    for (const list of [r.addedNodes, r.removedNodes]) {
      for (const n of list) {
        if (foreign(n) && (n.matches(sel) || n.querySelector(sel))) return true;
      }
    }
  }
  return false;
}

/** The first of ownQueryAll(root, sel, ownerSel) without listing the rest, or null. */
export function ownQueryFirst(root: Element, sel: string, ownerSel: string): Element | null {
  // Document order puts an item's own parts before its replies: the first match usually answers.
  const first = root.querySelector(sel);
  if (!first || first.closest(ownerSel) === root) return first;
  return ownQueryAll(root, sel, ownerSel)[0] ?? null;
}
