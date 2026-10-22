/**
 * The big editor (RES commentPreview enableBigEditor / swapBigEditorLayout): a REScue panel with
 * a large Markdown box on one side and a live preview on the other. It opens with the composer's
 * current text; Save switches Reddit's composer to Markdown with Reddit's own button and then
 * replaces the composer's text; Cancel or Escape closes it without writing. REScue never submits
 * the comment: the reader presses Reddit's own Comment / Save button.
 */
import { composerProblem } from '../../../core/actions';
import { h } from '../../../core/dom';
import { REScue_INPUT_ATTR } from '../../../core/keys';
import type { ModuleContext } from '../../../core/types';
import { PREVIEW_CSS, renderMarkdown } from '../../../model/markdownPreview';
import { deepActive, trapFocus } from './focusTrap';

export const EDITOR_ID = 'rescue-big-editor';
const STYLE_ID = 'rescue-big-editor-style';
/** The preview follows the text this long after the last key press. */
const PREVIEW_DELAY_MS = 100;

const PANEL_STYLE =
  'position:fixed;top:5vh;left:50%;transform:translateX(-50%);z-index:2147483646;box-sizing:border-box;' +
  'width:min(1100px,96vw);height:min(720px,90vh);display:flex;flex-direction:column;gap:8px;padding:10px 14px;' +
  'background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);' +
  'border-radius:6px;box-shadow:0 8px 28px var(--rescue-shadow,rgba(0,0,0,.35));font:13px/1.5 system-ui,sans-serif';
const PANE_STYLE =
  'flex:1 1 0;min-width:0;box-sizing:border-box;border:1px solid var(--rescue-border,#ccc);border-radius:4px;padding:8px;overflow:auto';

/** What the big editor needs from the module. */
export interface BigEditorDeps {
  ctx: Pick<ModuleContext, 'bridge' | 'notices'>;
  swap: boolean;
  /** The control that opened it (the bar's button); the focus goes back there on close. */
  opener?: HTMLElement | null;
}

let closeCurrent: (() => void) | null = null;

/** Close the big editor without writing (no-op when it is not open). */
export function closeBigEditor(): void {
  closeCurrent?.();
}

const warn = (deps: BigEditorDeps, message: string): void =>
  deps.ctx.notices.show(message, { kind: 'warning', id: 'big-editor' });

/**
 * Open the big editor for one `comment-composer-host`. Resolves once it is open (or once opening
 * failed: the composer's text could not be read, so nothing is shown that Save could overwrite).
 */
export async function openBigEditor(host: Element, deps: BigEditorDeps): Promise<boolean> {
  closeCurrent?.();
  // Read before the wait below: the focus goes back here (or into Reddit's box, for Ctrl+E).
  const opener = deps.opener ?? deepActive();
  const { bridge } = deps.ctx;
  const ref = bridge.ref(host);
  const read = await bridge.request({ op: 'composer.read', ref });
  if (!read.ok || typeof read.text !== 'string') {
    warn(deps, 'Big editor: REScue could not read Reddit’s comment box, so it did not open.');
    return false;
  }

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = PREVIEW_CSS;
    document.head.appendChild(style);
  }

  const box = h('textarea', {
    class: 'rescue-big-editor-text',
    'aria-label': 'Comment text (Markdown)',
    spellcheck: 'true',
    [REScue_INPUT_ATTR]: '',
  });
  box.value = read.text;
  box.style.cssText = `${PANE_STYLE};resize:none;font:13px/1.45 ui-monospace,monospace;background:var(--rescue-bg,#fff);color:inherit`;
  const preview = h('div', { class: 'rescue-md rescue-big-editor-preview', 'aria-live': 'polite' });
  preview.style.cssText = PANE_STYLE;
  const update = (): void => preview.replaceChildren(renderMarkdown(box.value));
  // Re-render once typing pauses, not on every key: a long text is re-parsed whole each time.
  let pending: ReturnType<typeof setTimeout> | undefined;
  box.addEventListener('input', () => {
    clearTimeout(pending);
    pending = setTimeout(update, PREVIEW_DELAY_MS);
  });
  update();

  const panes = h('div', { class: 'rescue-big-editor-panes' });
  panes.style.cssText = 'flex:1 1 auto;min-height:0;display:flex;gap:8px';
  if (deps.swap) panes.append(preview, box);
  else panes.append(box, preview);

  const save = h(
    'button',
    {
      type: 'button',
      class: 'rescue-btn rescue-big-editor-save',
      title: 'REScue: put this text into Reddit’s comment box (Markdown mode); you still post it',
    },
    'Save',
  );
  const cancel = h(
    'button',
    {
      type: 'button',
      class: 'rescue-btn rescue-big-editor-cancel',
      title: 'REScue: close without changing Reddit’s comment box',
    },
    'Cancel',
  );
  const note = h(
    'span',
    null,
    'Save puts the text into Reddit’s box; press Reddit’s own Comment button to post it.',
  );
  note.style.cssText = 'color:var(--rescue-meta,#666);margin-right:auto';
  const foot = h('div', null, note, cancel, save);
  foot.style.cssText = 'display:flex;align-items:center;gap:8px';

  const panel = h(
    'div',
    { id: EDITOR_ID, class: 'rescue-overlay', role: 'dialog', 'aria-label': 'REScue big editor' },
    h('strong', null, 'Big editor'),
    panes,
    foot,
  );
  panel.style.cssText = PANEL_STYLE;

  const release = trapFocus(panel, opener);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    shut();
  };
  const shut = (): void => {
    clearTimeout(pending);
    document.removeEventListener('keydown', onKey, true);
    panel.remove();
    if (closeCurrent === shut) closeCurrent = null;
    release();
  };

  let busy = false;
  save.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    save.disabled = true;
    void (async () => {
      try {
        const md = await bridge.request({ op: 'composer.markdownMode', ref });
        if (!md.ok || !md.accepted) {
          warn(
            deps,
            'Big editor: REScue could not switch Reddit’s comment box to Markdown, so nothing was written.',
          );
          return;
        }
        const put = await bridge.request({ op: 'composer.insert', ref, text: box.value });
        if (!put.ok || !put.accepted) {
          const why = put.ok ? '' : composerProblem(put.error);
          warn(
            deps,
            `Big editor: Reddit’s comment box did not take the text. It is still here.${why ? ` ${why}` : ''}`,
          );
          return;
        }
        shut();
      } finally {
        busy = false;
        save.disabled = false;
      }
    })();
  });
  cancel.addEventListener('click', shut);
  document.addEventListener('keydown', onKey, true);
  (document.body ?? document.documentElement).appendChild(panel);
  closeCurrent = shut;
  box.focus();
  return true;
}
