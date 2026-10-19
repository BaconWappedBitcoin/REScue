/**
 * The small REScue popup for adding or editing one shortcut: the subreddit or path, a display name,
 * and (when editing) a delete button. Built with the DOM builder only; typed text is read from the
 * inputs and never put into markup.
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import { FORMAT_HELP, shortcutHref } from './shortcutModel';
import { POPUP_ID } from './shortcutStyle';

export interface PopupSpec {
  heading: string;
  target: string;
  label: string;
  /** Present when editing an existing shortcut: shows the delete button. */
  onDelete?: () => void;
  /** Receives the entered values; returns an error message to keep the popup open, else null. */
  onSave: (target: string, label: string) => string | null;
  /** Gets the focus back when the popup closes. */
  returnFocus?: HTMLElement | null;
}

let cleanup: (() => void) | null = null;

export function closePopup(): void {
  cleanup?.();
  cleanup = null;
  document.getElementById(POPUP_ID)?.remove();
}

export function openPopup(spec: PopupSpec): void {
  closePopup();
  const target = h('input', {
    type: 'text',
    name: 'target',
    id: `${POPUP_ID}-target`,
    value: spec.target,
    autocomplete: 'off',
    spellcheck: 'false',
    title: hint.shortcutTarget,
    'data-rescue-input': '',
  });
  const label = h('input', {
    type: 'text',
    name: 'label',
    id: `${POPUP_ID}-label`,
    value: spec.label,
    maxlength: 40,
    autocomplete: 'off',
    title: hint.shortcutLabel,
    'data-rescue-input': '',
  });
  const error = h('p', {
    class: 'rescue-sc-error',
    role: 'alert',
    hidden: true,
    title: hint.shortcutError,
  });
  const fail = (message: string) => {
    error.textContent = message;
    error.hidden = false;
  };

  const actions = h(
    'div',
    { class: 'rescue-sc-actions' },
    h('button', { type: 'submit', 'data-rescue-save': '', title: hint.shortcutSave }, 'Save'),
  );
  if (spec.onDelete) {
    const del = h(
      'button',
      { type: 'button', 'data-rescue-delete': '', title: hint.shortcutDelete },
      'Delete',
    );
    del.addEventListener('click', () => {
      const run = spec.onDelete!;
      close();
      run();
    });
    actions.append(del);
  }
  const cancel = h(
    'button',
    { type: 'button', 'data-rescue-cancel': '', title: hint.shortcutCancel },
    'Cancel',
  );
  cancel.addEventListener('click', () => close());
  actions.append(cancel);

  const form = h(
    'form',
    { novalidate: true },
    h('h2', null, spec.heading),
    h('label', { for: target.id }, 'Subreddit or path'),
    target,
    h('label', { for: label.id }, 'Display name (optional)'),
    label,
    error,
    actions,
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = target.value.trim();
    if (!shortcutHref(t)) return fail(FORMAT_HELP);
    const problem = spec.onSave(t, label.value.trim());
    if (problem) return fail(problem);
    close();
  });

  const popup = h(
    'div',
    { id: POPUP_ID, class: 'rescue-overlay', role: 'dialog', 'aria-label': spec.heading },
    form,
  );
  popup.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    e.stopPropagation(); // typing here must not trigger REScue's or Reddit's key commands
  });
  const outside = (e: Event) => {
    const t = e.target as Node | null;
    if (t && !popup.contains(t)) close();
  };
  document.addEventListener('mousedown', outside, true);
  cleanup = () => document.removeEventListener('mousedown', outside, true);

  function close(): void {
    closePopup();
    if (spec.returnFocus?.isConnected) spec.returnFocus.focus();
  }

  (document.body ?? document.documentElement).appendChild(popup);
  target.focus();
  target.select();
}
