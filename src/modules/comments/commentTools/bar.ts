/**
 * The comment-tools bar REScue puts directly before each of Reddit's comment boxes (a sibling of
 * the `comment-composer-host`, never inside it): a "macros" list, "commenting as u/name" and a
 * "big editor" button. A macro goes in at the caret through the bridge (composer.insertAt).
 */
import { C } from '../../../contracts/reddit';
import { composerProblem } from '../../../core/actions';
import { h } from '../../../core/dom';
import { placePopup } from '../../../core/popup';
import type { ModuleContext } from '../../../core/types';
import { expandMacro, type MacroVars } from '../../../model/macroText';

export const BAR_CLASS = 'rescue-ct-bar';
export const LIST_CLASS = 'rescue-ct-macros';

export interface Macro {
  label: string;
  text: string;
}

export interface BarOptions {
  macroButtons: boolean;
  macros: Macro[];
  keepMacroListOpen: boolean;
  macroPlaceholders: boolean;
  commentingAs: boolean;
  enableBigEditor: boolean;
}

export interface BarDeps {
  ctx: () => Pick<ModuleContext, 'bridge' | 'notices' | 'session' | 'route'>;
  options: () => BarOptions;
  /** `opener`: the button that asked, which gets the focus back when the editor closes. */
  openEditor(host: Element, opener?: HTMLElement): void;
}

/** The macro table's rows that have text, with a label to show (blank labels use the text). */
export function macrosFrom(rows: unknown): Macro[] {
  if (!Array.isArray(rows)) return [];
  const out: Macro[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const text = typeof r.text === 'string' ? r.text : '';
    if (!text.trim()) continue;
    const label = typeof r.label === 'string' && r.label.trim() ? r.label.trim() : text.trim();
    out.push({ label: label.length > 40 ? `${label.slice(0, 39)}…` : label, text });
  }
  return out;
}

/** The placeholder values for a macro inserted into `host`'s composer. */
export function varsFor(
  host: Element,
  ctx: Pick<ModuleContext, 'session' | 'route'>,
  selected: string,
): MacroVars {
  const comment = host.closest(C.comment);
  const post = host.closest(C.post) ?? document.querySelector(C.post);
  const author = comment
    ? comment.getAttribute(C.commentAttr.author)
    : (post?.getAttribute(C.postAttr.author) ?? null);
  return {
    author,
    subreddit: ctx.route.subreddit ?? post?.getAttribute(C.postAttr.subreddit) ?? null,
    myUsername: ctx.session.username,
    url: location.href,
    selected,
  };
}

let openList: { node: HTMLElement; close(): void } | null = null;

/** Close the macro list if one is open. */
export function closeMacroList(): void {
  openList?.close();
}

function showMacroList(host: Element, anchor: HTMLElement, deps: BarDeps, selected: string): void {
  if (openList) {
    const same = openList.node.dataset.for === anchor.dataset.for;
    openList.close();
    if (same) return; // the button toggles its own list
  }
  const opts = deps.options();
  const list = h('div', {
    class: `${LIST_CLASS} rescue-overlay`,
    role: 'menu',
    'aria-label': 'Comment macros',
  });
  list.dataset.for = anchor.dataset.for ?? '';
  list.style.cssText =
    'position:absolute;z-index:2147483645;min-width:160px;max-width:320px;padding:4px;display:flex;flex-direction:column;gap:2px;' +
    'background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);' +
    'border-radius:4px;box-shadow:0 4px 14px var(--rescue-shadow,rgba(0,0,0,.25));font:12px/1.4 system-ui,sans-serif';
  if (!opts.macros.length) {
    list.append(
      h(
        'span',
        { class: 'rescue-ct-empty' },
        'No macros yet. Add some in REScue settings → Comment tools.',
      ),
    );
  }
  for (const macro of opts.macros) {
    const item = h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: 'rescue-ct-macro',
        title: `REScue: put this text into the comment box at the cursor`,
      },
      macro.label,
    );
    item.style.cssText =
      'all:unset;cursor:pointer;padding:3px 6px;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    // Keep the focus (and caret) in Reddit's box while the list is clicked.
    item.addEventListener('mousedown', (e) => e.preventDefault());
    item.addEventListener('click', () => void insertMacro(host, macro, deps, selected));
    list.append(item);
  }
  const onDoc = (e: Event): void => {
    const path = e.composedPath();
    if (!path.includes(list) && !path.includes(anchor)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  const close = (): void => {
    list.remove();
    document.removeEventListener('mousedown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
    anchor.setAttribute('aria-expanded', 'false');
    if (openList?.node === list) openList = null;
  };
  (document.body ?? document.documentElement).appendChild(list);
  placePopup(list, anchor);
  document.addEventListener('mousedown', onDoc, true);
  document.addEventListener('keydown', onKey, true);
  anchor.setAttribute('aria-expanded', 'true');
  openList = { node: list, close };
}

/** Insert one macro at the caret of `host`'s composer; closes the list unless asked not to. */
export async function insertMacro(
  host: Element,
  macro: Macro,
  deps: BarDeps,
  selected = '',
): Promise<boolean> {
  const ctx = deps.ctx();
  const opts = deps.options();
  const text = opts.macroPlaceholders
    ? expandMacro(macro.text, varsFor(host, ctx, selected))
    : macro.text;
  if (!opts.keepMacroListOpen) closeMacroList();
  const res = await ctx.bridge.request({
    op: 'composer.insertAt',
    ref: ctx.bridge.ref(host),
    text,
  });
  if (!res.ok || !res.accepted) {
    const why = res.ok ? '' : composerProblem(res.error);
    ctx.notices.show(
      `Comment tools: Reddit’s comment box did not take the macro text.${why ? ` ${why}` : ''}`,
      { kind: 'warning', id: 'comment-macro' },
    );
    return false;
  }
  return true;
}

let barSeq = 0;

/** Build the bar for one composer host. */
export function buildBar(host: Element, deps: BarDeps): HTMLElement {
  const opts = deps.options();
  const ctx = deps.ctx();
  const bar = h('div', { class: `${BAR_CLASS} rescue-overlay` });
  bar.style.cssText =
    'display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:4px 0;font:12px/1.4 system-ui,sans-serif;color:var(--rescue-meta,#666)';
  if (opts.macroButtons) {
    const btn = h(
      'button',
      {
        type: 'button',
        class: 'rescue-btn rescue-ct-macros-btn',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
        title: 'REScue: your comment macros (set them in REScue settings → Comment tools)',
      },
      'macros ▾',
    );
    btn.dataset.for = `ct${++barSeq}`;
    let selected = '';
    btn.addEventListener('mousedown', (e) => {
      // Read the page's selection before the click can change it, and keep the caret where it is.
      selected = document.getSelection()?.toString() ?? '';
      e.preventDefault();
    });
    btn.addEventListener('click', () => showMacroList(host, btn, deps, selected));
    bar.append(btn);
  }
  if (opts.enableBigEditor) {
    const big = h(
      'button',
      {
        type: 'button',
        class: 'rescue-btn rescue-ct-big',
        title: 'REScue: edit this comment in a large Markdown box with a preview (Ctrl+E)',
      },
      'big editor',
    );
    big.addEventListener('click', () => deps.openEditor(host, big));
    bar.append(big);
  }
  const name = ctx.session.username;
  if (opts.commentingAs && name) {
    bar.append(h('span', { class: 'rescue-ct-as' }, `commenting as u/${name}`));
  }
  return bar;
}
