/**
 * "My subreddits" for the shortcut bar (RES subredditManager's dropdown of your subscriptions):
 * reads your subscriptions from Reddit's own read-only /subreddits/mine.json (same origin, your
 * session, only when you press the control; see PRIVACY.md), lists them with a search box, and
 * can add the ones you tick to the bar. The list is kept for about an hour. Signed out, the
 * control is disabled with a sign-in hint. All text is placed with the DOM builder.
 */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import type { BoundGetJson, MineSub } from '../../core/redditJson';
import { placeAbove } from './shortcutControls';
import { addRow, shortcutHref, shortcutItems, type RawRow } from './shortcutModel';

export const MINE_PAGE_LIMIT = 100;
export const MINE_MAX_PAGES = 25;
export const MINE_TTL_MS = 60 * 60_000;
const MINE_ID = 'rescue-mine-popup';

export type MineList = { ok: true; subs: MineSub[] } | { ok: false; message: string };

export interface MineHost {
  signedIn: boolean;
  list(force?: boolean): Promise<MineList>;
}

let cache: { at: number; subs: MineSub[] } | null = null;

/** Forget the kept list (settings changed, or the module was turned off). */
export function forgetMine(): void {
  cache = null;
}

/** Every subscription, page by page (at most 25 pages of 100), kept for an hour. */
export async function fetchSubscriptions(
  getJson: BoundGetJson,
  force = false,
  now: () => number = Date.now,
): Promise<MineList> {
  if (cache && !force && now() - cache.at < MINE_TTL_MS) return { ok: true, subs: cache.subs };
  const subs: MineSub[] = [];
  let after: string | undefined;
  for (let page = 0; page < MINE_MAX_PAGES; page++) {
    const res = await getJson(
      'mine',
      { limit: MINE_PAGE_LIMIT, ...(after ? { after } : {}) },
      { ttlMs: force ? 0 : MINE_TTL_MS, fresh: force },
    );
    if (!res.ok) return { ok: false, message: res.message };
    subs.push(...res.data.subs);
    if (!res.data.after) break;
    after = res.data.after;
  }
  const seen = new Set<string>();
  const unique = subs.filter(
    (s) => !seen.has(s.name.toLowerCase()) && !!seen.add(s.name.toLowerCase()),
  );
  unique.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  cache = { at: now(), subs: unique };
  return { ok: true, subs: unique };
}

/** The subscriptions whose name contains `query` (case-insensitive; "r/" is ignored). */
export function filterSubs(subs: readonly MineSub[], query: string): MineSub[] {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/^\/?r\//, '');
  return q ? subs.filter((s) => s.name.toLowerCase().includes(q)) : [...subs];
}

/** The shortcut target for a subscription: its name, or `u/name` for a profile. */
export const targetOf = (s: MineSub): string =>
  s.prefixed.toLowerCase().startsWith('u/') ? s.prefixed : s.name;

/**
 * Where a subscription's link goes: the `url` from Reddit's answer, but only as a path on this
 * site (shortcutHref). Anything else (a full address, `javascript:`, `//host`) gets no link.
 */
export const mineHref = (s: MineSub): string | null => shortcutHref(s.url);

/** Add the picked subscriptions that the bar does not have yet, keeping the order they are in. */
export function importRows(
  rows: readonly RawRow[],
  picked: readonly MineSub[],
  now: number,
): { rows: RawRow[]; added: number; skipped: number } {
  const have = new Set(shortcutItems(rows).map((i) => i.href.toLowerCase()));
  let out = [...rows];
  let added = 0;
  picked.forEach((s, n) => {
    const t = targetOf(s);
    const href = (t.startsWith('u/') ? `/user/${t.slice(2)}/` : `/r/${t}/`).toLowerCase();
    if (have.has(href)) return;
    have.add(href);
    out = addRow(out, t, '', now + n);
    added++;
  });
  return { rows: out, added, skipped: picked.length - added };
}

export function closeMine(): void {
  document.getElementById(MINE_ID)?.remove();
}

const PANEL =
  'position:fixed;z-index:2147483640;width:300px;max-width:calc(100vw - 24px);box-sizing:border-box;padding:8px 10px;background:Canvas;color:CanvasText;border:1px solid GrayText;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.25);font:12px/1.6 system-ui,sans-serif';
const WORD =
  'background:none;border:0;padding:0 4px;font:inherit;cursor:pointer;text-decoration:underline;color:inherit';

function word(text: string, title: string): HTMLButtonElement {
  const b = h('button', { type: 'button', title }, text);
  b.style.cssText = WORD;
  return b;
}

export interface MineUi {
  host: MineHost;
  rows(): RawRow[];
  save(rows: RawRow[]): Promise<void>;
}

/** Open (or close, when already open) the dropdown above `anchor`. */
export function openMine(ui: MineUi, anchor: HTMLElement): void {
  if (document.getElementById(MINE_ID)) return closeMine();
  const picked = new Set<string>();
  let all: MineSub[] = [];

  const search = h('input', {
    type: 'search',
    name: 'mine-search',
    autocomplete: 'off',
    placeholder: 'Search your subreddits',
    'aria-label': 'Search your subreddits',
    title: hint.mineSearch,
    'data-rescue-input': '',
  });
  search.style.cssText = 'box-sizing:border-box;width:100%;font:inherit';
  const status = h('div', { 'aria-live': 'polite', title: hint.mineList }, 'Loading…');
  status.style.cssText = 'margin:4px 0;opacity:.8';
  const list = h('div', { class: 'rescue-mine-list', title: hint.mineList });
  list.style.cssText = 'max-height:40vh;overflow:auto';
  const importBtn = word(label.importSubs, hint.mineImport(0));
  const allBtn = word(label.selectAll, hint.mineAll);
  const noneBtn = word(label.noColor, hint.mineNone);
  const refresh = word(label.refresh, hint.mineRefresh);
  const close = word(label.close, hint.mineClose);
  const foot = h('div', null, allBtn, noneBtn, importBtn, refresh, close);
  foot.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px';
  const box = h(
    'div',
    { id: MINE_ID, class: 'rescue-overlay', role: 'dialog', 'aria-label': 'My subreddits' },
    search,
    status,
    list,
    foot,
  );
  box.style.cssText = PANEL;

  function row(s: MineSub): HTMLElement {
    const check = h('input', {
      type: 'checkbox',
      name: 'pick',
      title: hint.minePick(s.prefixed, picked.has(s.name)),
      'aria-label': `Select ${s.prefixed}`,
    });
    check.checked = picked.has(s.name);
    check.addEventListener('change', () => {
      if (check.checked) picked.add(s.name);
      else picked.delete(s.name);
      sync();
    });
    const href = mineHref(s);
    const go = href
      ? h('a', { href, title: hint.mineGo(s.prefixed) }, s.prefixed)
      : h('span', null, s.prefixed);
    go.style.cssText = 'color:inherit';
    const extra = [
      s.over18 ? ' 18+' : '',
      s.subscribers !== null ? ` · ${s.subscribers.toLocaleString()}` : '',
    ].join('');
    const meta = h('span', null, extra);
    meta.style.cssText = 'opacity:.6;font-size:11px';
    return h('label', { class: 'rescue-mine-row', 'data-sub': s.name }, check, ' ', go, meta);
  }

  function draw(): void {
    const shown = filterSubs(all, search.value);
    list.replaceChildren(...shown.map(row));
    status.textContent =
      shown.length === all.length
        ? `${all.length} subscribed ${all.length === 1 ? 'subreddit' : 'subreddits'}`
        : `${shown.length} of ${all.length} match`;
    sync();
  }
  function sync(): void {
    importBtn.title = hint.mineImport(picked.size);
    importBtn.disabled = picked.size === 0;
    importBtn.textContent = picked.size ? `${label.importSubs} (${picked.size})` : label.importSubs;
  }
  function load(force = false): void {
    status.textContent = 'Loading…';
    void ui.host.list(force).then((res) => {
      if (!box.isConnected) return;
      if (!res.ok) {
        status.textContent = res.message;
        return;
      }
      all = res.subs;
      draw();
    });
  }

  search.addEventListener('input', draw);
  allBtn.addEventListener('click', () => {
    for (const s of filterSubs(all, search.value)) picked.add(s.name);
    draw();
  });
  noneBtn.addEventListener('click', () => {
    picked.clear();
    draw();
  });
  refresh.addEventListener('click', () => load(true));
  close.addEventListener('click', closeMine);
  importBtn.addEventListener('click', () => {
    const chosen = all.filter((s) => picked.has(s.name));
    const res = importRows(ui.rows(), chosen, Date.now());
    picked.clear();
    void ui.save(res.rows).then(
      () => {
        draw();
        status.textContent = `Added ${res.added}${res.skipped ? `, ${res.skipped} already in the bar` : ''}.`;
      },
      () => (status.textContent = 'The shortcuts could not be saved.'),
    );
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMine();
    e.stopPropagation(); // typing here must not trigger REScue's or Reddit's key commands
  });
  const outside = (e: Event) => {
    const t = e.target as Node | null;
    if (!box.isConnected) return document.removeEventListener('mousedown', outside, true);
    if (t && !box.contains(t) && t !== anchor) {
      closeMine();
      document.removeEventListener('mousedown', outside, true);
    }
  };
  document.addEventListener('mousedown', outside, true);
  (document.body ?? document.documentElement).appendChild(box);
  placeAbove(box, anchor); // above the bar, or below it when the bar is at the top of the page
  sync();
  load();
  search.focus();
}
