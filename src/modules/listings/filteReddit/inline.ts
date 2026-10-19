/**
 * filteReddit inline controls (RES parity: filter a subreddit, user or domain straight from a
 * post). Pure rule helpers (menu entries, equivalence, add/remove plans) plus the small popup menu.
 * The menu text is only ever written with textContent, never as markup.
 *
 * The subreddit default follows RES's `filterSubredditsFrom` = "everywhere except subreddit": the
 * posts disappear everywhere except while browsing that subreddit itself. The rule table has no
 * such global switch, so the rule says it per entry: scope "except", list = the same subreddit
 * (see inScope in rules.ts: a subreddit rule's list is matched against the page being browsed).
 */
import { h } from '../../../core/dom';
import { hint, label } from '../../../core/hints';
import { placePopup } from '../../../core/popup';
import type { Post } from '../../../model/types';
import type { FilterRule } from './rules';

export type MenuKind = 'subreddit' | 'user' | 'domain';

export interface MenuEntry {
  kind: MenuKind;
  label: string;
  rule: FilterRule;
  /** What the notice says after the rule is added ("Filtered r/funny."). */
  done: string;
}

export type Row = Record<string, unknown>;

const bare = (s: string) =>
  s
    .trim()
    .replace(/^\/?(r|u|user)\//i, '')
    .toLowerCase();

const baseRule = (type: FilterRule['type'], pattern: string): FilterRule => ({
  type,
  pattern,
  scope: 'everywhere',
  subreddits: '',
  enabled: true,
  toggle: '',
});

/** RES default: hide the subreddit everywhere except on its own page. */
export const subredditRule = (sub: string): FilterRule => ({
  ...baseRule('subreddit', sub),
  scope: 'except',
  subreddits: sub,
});
export const userRule = (user: string): FilterRule => baseRule('user', user);
export const domainRule = (domain: string): FilterRule => baseRule('domain', domain);

const REDDIT_DOMAIN = /(^|\.)reddit\.com$|^self\./i;

/** The entries the ⊘ menu offers for `post`; a user/domain entry only when there is one to filter. */
export function menuEntries(post: Post): MenuEntry[] {
  const out: MenuEntry[] = [];
  if (post.subreddit) {
    out.push({
      kind: 'subreddit',
      label: `Filter r/${post.subreddit}`,
      rule: subredditRule(post.subreddit),
      done: `Filtered r/${post.subreddit}.`,
    });
  }
  if (post.author && post.author !== '[deleted]') {
    out.push({
      kind: 'user',
      label: `Filter u/${post.author}`,
      rule: userRule(post.author),
      done: `Filtered u/${post.author}.`,
    });
  }
  if (post.type !== 'text' && post.domain && !REDDIT_DOMAIN.test(post.domain)) {
    out.push({
      kind: 'domain',
      label: `Filter ${post.domain}`,
      rule: domainRule(post.domain),
      done: `Filtered ${post.domain}.`,
    });
  }
  return out;
}

/** Same filter, ignoring case, a u/ r/ prefix, list order and the on/off state. */
export function sameRule(row: Row, rule: FilterRule): boolean {
  const list = (s: unknown) =>
    String(s ?? '')
      .split(',')
      .map(bare)
      .filter(Boolean)
      .sort()
      .join(',');
  return (
    row.type === rule.type &&
    bare(String(row.pattern ?? '')) === bare(rule.pattern) &&
    (row.scope ?? 'everywhere') === rule.scope &&
    list(row.subreddits) === list(rule.subreddits) &&
    String(row.toggle ?? '') === rule.toggle
  );
}

export const isFiltered = (rows: Row[], rule: FilterRule) =>
  rows.some((r) => r.enabled !== false && sameRule(r, rule));

export interface Plan {
  rows: Row[];
  /** Reverses exactly this change against the rows as they are by then. */
  undo(rows: Row[]): Row[];
}

const without = (rows: Row[], i: number) => rows.filter((_, j) => j !== i);
const lastMatch = (rows: Row[], rule: FilterRule, enabled: boolean) => {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (sameRule(rows[i]!, rule) && (rows[i]!.enabled !== false) === enabled) return i;
  }
  return -1;
};

/** Add `rule`, or null when an equivalent enabled rule exists (a disabled twin is switched on). */
export function planAdd(rows: Row[], rule: FilterRule): Plan | null {
  if (isFiltered(rows, rule)) return null;
  const off = lastMatch(rows, rule, false);
  if (off >= 0) {
    return {
      rows: rows.map((r, i) => (i === off ? { ...r, enabled: true } : r)),
      undo: (now) => {
        const i = lastMatch(now, rule, true);
        return i < 0 ? now : now.map((r, j) => (j === i ? { ...r, enabled: false } : r));
      },
    };
  }
  return {
    rows: [...rows, { ...rule }],
    undo: (now) => {
      const i = lastMatch(now, rule, true);
      return i < 0 ? now : without(now, i);
    },
  };
}

/** Remove every equivalent row; null when there is none. Undo adds the rule back. */
export function planRemove(rows: Row[], rule: FilterRule): Plan | null {
  const next = rows.filter((r) => !sameRule(r, rule));
  if (next.length === rows.length) return null;
  return { rows: next, undo: (now) => planAdd(now, rule)?.rows ?? now };
}

// --- the popup menu ---------------------------------------------------------------------------

const BOX_CSS =
  'position:absolute;z-index:2147483646;min-width:160px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:4px;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,.25);font:13px Verdana,Arial,sans-serif;display:flex;flex-direction:column';
const ITEM_CSS =
  'display:block;width:100%;text-align:left;background:none;border:0;padding:5px 8px;cursor:pointer;color:inherit;font:inherit;border-radius:3px';

let open: { box: HTMLElement; anchor: Element; close(): void } | null = null;

export function closeFilterMenu(): void {
  open?.close();
}

export function openFilterMenu(
  anchor: Element,
  entries: MenuEntry[],
  onPick: (entry: MenuEntry) => void,
): void {
  const same = open?.anchor === anchor;
  closeFilterMenu();
  if (same || !entries.length) return; // a second click on the button closes the menu

  const items = entries.map((entry) => {
    const b = h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: 'rescue-filter-item',
        'data-kind': entry.kind,
        title: hint.filterMenuItem(entry.kind, entry.rule.pattern),
      },
      entry.label,
    );
    b.style.cssText = ITEM_CSS;
    b.addEventListener('focus', () => (b.style.background = 'rgba(128,128,128,.25)'));
    b.addEventListener('blur', () => (b.style.background = 'none'));
    b.addEventListener('mouseenter', () => b.focus());
    b.addEventListener('click', (e) => {
      // Reddit's post card navigates on click; this control must not.
      e.preventDefault();
      e.stopPropagation();
      close(false);
      onPick(entry);
    });
    return b;
  });
  const box = h(
    'div',
    { class: 'rescue-filter-menu rescue-overlay', role: 'menu', 'aria-label': 'Filter this post' },
    ...items,
  );
  box.style.cssText = BOX_CSS;

  const outside = (e: Event) => {
    if (!box.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(false);
  };
  function close(refocus = true) {
    document.removeEventListener('mousedown', outside, true);
    box.remove();
    if (open?.box === box) open = null;
    if (refocus && anchor instanceof HTMLElement && anchor.isConnected) anchor.focus();
  }
  const move = (delta: number) => {
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + delta + items.length) % items.length]!.focus();
  };
  for (const t of ['keydown', 'keyup', 'keypress']) {
    box.addEventListener(t, (e) => {
      const key = (e as KeyboardEvent).key;
      e.stopPropagation();
      // Escape is also read on keyup: a selected post makes the key dispatcher take its keydown.
      if (key === 'Escape' && t !== 'keypress') close();
      else if (t === 'keydown' && (key === 'ArrowDown' || key === 'ArrowUp')) {
        e.preventDefault();
        move(key === 'ArrowDown' ? 1 : -1);
      } else if (t === 'keydown' && key === 'Tab') close();
    });
  }
  document.body.append(box);
  placePopup(box, anchor);
  document.addEventListener('mousedown', outside, true);
  open = { box, anchor, close };
  items[0]!.focus();
}

/** The ⊘ button; the caller wires what a click does. */
export function filterButton(onClick: (btn: HTMLButtonElement) => void): HTMLButtonElement {
  const btn = h(
    'button',
    {
      type: 'button',
      class: 'rescue-filter-btn rescue-btn',
      'aria-label': 'Filter this post',
      'aria-haspopup': 'menu',
      title: hint.filterButton,
    },
    label.filter,
  );
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick(btn);
  });
  return btn;
}
