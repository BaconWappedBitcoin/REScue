/**
 * commentTools (RES commentTools macros / commentingAs and RES commentPreview's big editor): a small
 * REScue bar directly before each of Reddit's comment boxes with your macros (inserted at the
 * cursor, with placeholders), "commenting as u/name" and a big two-pane Markdown editor (also on
 * Ctrl+E while a comment box has the focus). Text goes into Reddit's own box through the bridge;
 * REScue never posts the comment. Ideas from RES lib/modules/commentTools.js and
 * commentPreview.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import { C } from '../../contracts/reddit';
import { burstTouches } from '../../core/dom';
import { chordOf } from '../../core/keys';
import { defineModule, type ModuleContext } from '../../core/types';
import { MACRO_PLACEHOLDERS } from '../../model/macroText';
import { BAR_CLASS, buildBar, closeMacroList, macrosFrom, type BarDeps } from './commentTools/bar';
import { closeBigEditor, openBigEditor } from './commentTools/bigEditor';

const HOST = C.composerTools.host;
const DEBOUNCE_MS = 100;
export const OPEN_EDITOR_ID = 'openBigEditor';

let current: ModuleContext | null = null;
let observer: MutationObserver | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let teardown: Array<() => void> = [];
/** The composer whose box last had the focus (Ctrl+E from outside it opens this one). */
let lastHost: Element | null = null;
const bars = new WeakMap<Element, HTMLElement>();

const options = (ctx: ModuleContext) => {
  const o = ctx.options as Record<string, unknown>;
  return {
    macroButtons: o.macroButtons !== false,
    macros: macrosFrom(o.macros),
    keepMacroListOpen: o.keepMacroListOpen === true,
    macroPlaceholders: o.macroPlaceholders !== false,
    commentingAs: o.commentingAs !== false,
    enableBigEditor: o.enableBigEditor !== false,
    swapBigEditorLayout: o.swapBigEditorLayout === true,
  };
};

const openEditor = (host: Element, opener?: HTMLElement): void => {
  if (!current || !host.isConnected) return;
  void openBigEditor(host, { ctx: current, swap: options(current).swapBigEditorLayout, opener });
};

const deps: BarDeps = {
  ctx: () => current!,
  options: () => options(current!),
  openEditor,
};

/** The composer host an event happened in (through open shadow roots), if any. */
const hostIn = (e: Event): Element | null =>
  (e.composedPath().find((n) => n instanceof Element && n.matches(HOST)) as Element) ?? null;

/** The composer host each bar was built for (the bar may sit before one of its wrappers). */
const hostOf = new WeakMap<Element, Element>();

/** How many wrappers above the composer host the bar may climb to find one that shows it. */
const MAX_CLIMB = 4;
/** The bar never climbs out of the comment, the post or the comment tree. */
const BOUNDARY = `${C.comment}, ${C.post}, ${C.commentTree}, main, body`;

/**
 * Does `parent` show its light child `child` (and so a bar beside it carrying the same `slot`)?
 * An open shadow root shows it only through a slot of that name (or the default slot for none).
 * `null` means REScue cannot tell: a custom element with a closed or not yet attached root.
 */
function showsChild(parent: Element, child: Element): boolean | null {
  const root = parent.shadowRoot;
  const name = child.getAttribute('slot');
  if (root)
    return !!root.querySelector(name ? `slot[name="${CSS.escape(name)}"]` : 'slot:not([name])');
  return parent.localName.includes('-') ? null : true;
}

const drawn = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width > 0 || r.height > 0;
};

/** Put `bar` directly before `anchor`, in the same slot of the parent's shadow root. */
function putBefore(bar: HTMLElement, anchor: Element): void {
  const slot = anchor.getAttribute('slot');
  if (slot) bar.setAttribute('slot', slot);
  else bar.removeAttribute('slot');
  if (bar.nextElementSibling !== anchor) anchor.before(bar);
}

/**
 * Place a composer's bar. Live (2026-10-21) Reddit wraps `comment-composer-host` in a
 * `shreddit-async-loader` whose shadow root has no default slot, so a bar beside the host is never
 * drawn (0×0). The bar goes before the outermost such wrapper that is still inside the comment;
 * a wrapper whose root REScue cannot see is climbed only when the bar beside it measured 0×0.
 */
function placeBar(bar: HTMLElement, host: Element): void {
  let anchor = host;
  for (let up = 0; up < MAX_CLIMB; up++) {
    const parent = anchor.parentElement;
    if (!parent || parent.matches(BOUNDARY) || !parent.parentElement) break;
    const shows = showsChild(parent, anchor);
    if (shows === true) break;
    if (shows === null) {
      putBefore(bar, anchor);
      if (drawn(bar)) return;
    }
    anchor = parent;
  }
  putBefore(bar, anchor);
}

/** Is `bar` still directly before its host or the wrapper holding it? */
const inPlace = (bar: Element, host: Element): boolean => {
  const next = bar.nextElementSibling;
  return !!next && (next === host || next.contains(host));
};

/** Put one bar before every composer host that has none; drop bars whose host is gone. */
export function scanComposers(doc: Document = document): void {
  if (!current) return;
  for (const bar of doc.querySelectorAll(`.${BAR_CLASS}`)) {
    const host = hostOf.get(bar);
    if (!host || !host.isConnected || bars.get(host) !== bar || !inPlace(bar, host)) bar.remove();
  }
  for (const host of doc.querySelectorAll(HOST)) {
    const have = bars.get(host);
    if (have && have.isConnected && inPlace(have, host)) continue;
    have?.remove();
    const bar = buildBar(host, deps);
    placeBar(bar, host);
    bars.set(host, bar);
    hostOf.set(bar, host);
  }
}

/** Rebuild every bar (the options changed). */
function rebuild(): void {
  for (const bar of document.querySelectorAll(`.${BAR_CLASS}`)) bar.remove();
  scanComposers();
}

/**
 * Does a burst of page changes concern the bars: a comment box arrived or left, something landed
 * between a bar and its box, or a bar was taken off? Anything else (a thread's comments loading)
 * is not worth listing every bar and box on the page again.
 */
function concernsBars(records: readonly MutationRecord[]): boolean {
  if (burstTouches(records, HOST)) return true;
  for (const r of records) {
    for (const n of r.addedNodes)
      if (
        n instanceof Element &&
        (n.nextElementSibling?.matches(HOST) ||
          n.previousElementSibling?.classList.contains(BAR_CLASS))
      )
        return true;
    for (const n of r.removedNodes)
      if (n instanceof Element && (n.matches(`.${BAR_CLASS}`) || n.querySelector(`.${BAR_CLASS}`)))
        return true;
  }
  return false;
}

const schedule = (): void => {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    scanComposers();
  }, DEBOUNCE_MS);
};

/** Is this key the (possibly rebound) "open big editor" key? */
const isEditorKey = (ctx: ModuleContext, e: KeyboardEvent): boolean => {
  const keys = ctx.keys.list().find((k) => k.id === OPEN_EDITOR_ID)?.keys ?? [];
  return keys.includes(chordOf(e));
};

export const commentTools = defineModule({
  id: 'commentTools',
  resId: 'commentTools',
  category: 'comments',
  title: 'Comment tools',
  description:
    'A small bar above Reddit’s comment box: your text macros (put in at the cursor), “commenting as u/you”, and a big editor with a Markdown preview (Ctrl+E). Text goes into Reddit’s own box; you still press Reddit’s Comment button to post.',
  enabledByDefault: true,
  options: {
    macroButtons: { type: 'boolean', default: true, title: 'Show the “macros” button' },
    macros: {
      type: 'table',
      default: [],
      title: 'Macros',
      description:
        'Each macro is a label and the text it puts into the comment box at the cursor. The label is optional (the text is shown instead).',
      dependsOn: 'macroButtons',
      columns: [
        { key: 'label', title: 'Label', type: 'text' },
        { key: 'text', title: 'Text', type: 'text' },
      ],
    },
    keepMacroListOpen: {
      type: 'boolean',
      default: false,
      title: 'Keep the macro list open after picking a macro',
      dependsOn: 'macroButtons',
    },
    macroPlaceholders: {
      type: 'boolean',
      default: true,
      title: 'Fill in placeholders in macros',
      description: `In a macro’s text these are replaced when it is put in: ${MACRO_PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}. {{author}} is who you are replying to, {{selected}} the text selected on the page and {{escaped}} the same with Markdown symbols escaped. Any other {{name}} stays as typed.`,
      dependsOn: 'macroButtons',
    },
    commentingAs: {
      type: 'boolean',
      default: true,
      title: 'Show “commenting as u/you” by the comment box',
    },
    enableBigEditor: {
      type: 'boolean',
      default: true,
      title: 'Show the “big editor” button',
      description:
        'A large Markdown box with a live preview. Save switches Reddit’s comment box to Markdown mode and puts the text in; Cancel or Escape changes nothing. In rich-text mode only the plain text is loaded.',
    },
    swapBigEditorLayout: {
      type: 'boolean',
      default: false,
      title: 'Big editor: preview on the left, text on the right',
      dependsOn: 'enableBigEditor',
    },
  },

  init(ctx) {
    current = ctx;
    // Registered once per page: switched off and on again, the command is only disabled meanwhile.
    if (!ctx.keys.list().some((k) => k.id === OPEN_EDITOR_ID)) {
      ctx.keys.register({
        id: OPEN_EDITOR_ID,
        title: 'Open the big editor for the comment box',
        defaultKeys: ['ctrl+e'],
        context: 'composer',
        section: 'Comments',
        enabled: () =>
          !!current && options(current).enableBigEditor && !!lastHost && lastHost.isConnected,
        run: () => {
          if (lastHost) openEditor(lastHost);
        },
      });
    }
    // The key dispatcher never acts on keys typed into a text box, so the key is caught here
    // while the focus is inside one of Reddit's comment boxes.
    const onKey = (e: KeyboardEvent): void => {
      if (!current || e.defaultPrevented || !options(current).enableBigEditor) return;
      const host = hostIn(e);
      if (!host || !isEditorKey(current, e)) return;
      e.preventDefault();
      e.stopPropagation();
      lastHost = host;
      openEditor(host);
    };
    const onFocus = (e: FocusEvent): void => {
      const host = hostIn(e);
      if (host) lastHost = host;
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus, true);
    observer = new MutationObserver((records) => {
      if (concernsBars(records)) schedule();
    });
    observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
    teardown = [
      () => window.removeEventListener('keydown', onKey, true),
      () => document.removeEventListener('focusin', onFocus, true),
    ];
    scanComposers();
  },

  onRoute(_route, ctx) {
    current = ctx;
    closeMacroList();
    schedule();
  },

  onSettings(ctx) {
    current = ctx;
    closeMacroList();
    rebuild();
  },

  dispose() {
    observer?.disconnect();
    observer = null;
    if (timer) clearTimeout(timer);
    timer = null;
    for (const f of teardown) f();
    teardown = [];
    closeMacroList();
    closeBigEditor();
    for (const bar of document.querySelectorAll(`.${BAR_CLASS}`)) bar.remove();
    current = null;
    lastHost = null;
  },
});
