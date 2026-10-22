/**
 * Keyboard focus for REScue's small dialogs (the big editor, the source popup): Tab and Shift+Tab
 * go round the dialog's own controls instead of leaving it for the page underneath, and the focus
 * goes back to the control that opened the dialog when it closes.
 */

const FOCUSABLE =
  'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** The focused element, looking into open shadow roots (Reddit's comment box lives in one). */
export function deepActive(doc: Document = document): HTMLElement | null {
  let el: Element | null = doc.activeElement;
  while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
  return el instanceof HTMLElement && el !== doc.body ? el : null;
}

/** The dialog's controls that take the focus, in order (hidden ones left out). */
const stops = (dialog: HTMLElement): HTMLElement[] =>
  [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('[hidden]'));

/**
 * Keep Tab inside `dialog` while the focus is in it. Returns `release`, which removes the trap and
 * puts the focus back on `opener` (when it is still on the page).
 */
export function trapFocus(dialog: HTMLElement, opener: HTMLElement | null): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
    const all = stops(dialog);
    const first = all[0];
    const last = all[all.length - 1];
    if (!first || !last) return;
    const at = document.activeElement;
    if (e.shiftKey ? at === first || !dialog.contains(at) : at === last || !dialog.contains(at)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  };
  dialog.addEventListener('keydown', onKey);
  return () => {
    dialog.removeEventListener('keydown', onKey);
    if (opener?.isConnected) opener.focus();
  };
}
