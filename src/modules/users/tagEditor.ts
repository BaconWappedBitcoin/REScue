/**
 * The tag editor popup (userTagger): a small REScue overlay under the tag button. Pure UI: it
 * validates the fields and hands the result to the caller, which owns storage. Tag text is only
 * ever written with textContent / value, never as markup.
 *
 * Modelled on RES's tag dialog (lib/modules/userTagger.js populateDialog, GPL-3.0): text, 21 colour
 * presets, a live preview, the source link with an "open" link, separate up/down vote counts and
 * clickable preset tags. Enter saves (the form's default button), Escape closes.
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import { placePopup } from '../../core/popup';
import { ensureTheme } from '../../core/theme';
import { buildTagChip } from './tagChip';
import type { PresetTag } from './tagColors';
import { buildPresetRow, buildSwatches } from './tagEditorParts';
import { validColor, validLink, type UserTag } from './tagStore';

export interface TagEdit {
  text: string;
  color: string;
  link: string;
  ignored: boolean;
  votesUp: number;
  votesDown: number;
}

export interface EditorRequest {
  username: string;
  current: UserTag | undefined;
  anchor: Element;
  /** Pre-fills the link when the user has none yet (the permalink of the item being tagged). */
  defaultLink?: string;
  presets?: PresetTag[];
  onSave(edit: TagEdit): void;
  onDelete(): void;
  /** "Save as preset": the caller stores it. */
  onSavePreset?(preset: PresetTag): void;
  /** "Tagged users": the caller opens the manager. */
  onManage?(): void;
}

const BOX_CSS =
  'position:absolute;z-index:2147483647;width:300px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:10px;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,.25);font:13px Verdana,Arial,sans-serif';
const FIELD_CSS = 'display:flex;gap:6px;align-items:center;margin:4px 0';
const BARE_BUTTON =
  'background:none;border:0;padding:0;cursor:pointer;text-decoration:underline;color:inherit;font:inherit';

let current: { box: HTMLElement; close(): void } | null = null;

export function closeTagEditor(): void {
  current?.close();
}

function field(label: string, ...inputs: Node[]): HTMLElement {
  // Two columns: a fixed-width label (so “Color” never wraps) and compact inputs beside it.
  const name = h('span', null, label);
  name.style.cssText = 'flex:none;width:72px';
  for (const input of inputs) {
    if (!(input instanceof HTMLInputElement)) continue;
    if (input.type === 'text') {
      input.style.cssText =
        'flex:1 1 auto;min-width:0;width:100%;box-sizing:border-box;height:auto;margin:0;padding:2px 4px;font:inherit;' +
        'background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);border-radius:3px';
    } else if (input.type === 'color')
      input.style.cssText = 'flex:none;width:28px;height:22px;padding:0;margin:0';
    else if (input.type === 'number')
      input.style.cssText = 'width:60px;height:auto;margin:0;padding:2px 4px;font:inherit';
    else input.style.margin = '0';
  }
  const row = h('label', { class: 'rescue-tag-field' }, name, ...inputs);
  row.style.cssText = FIELD_CSS;
  return row;
}

const wholeNumber = (v: string): number => Math.max(0, Math.trunc(Number.parseInt(v, 10)) || 0);

/** A text input that REScue's key dispatcher keeps away from Reddit's shortcuts. */
const textInput = (name: string, value: string, extra: Record<string, string | number> = {}) =>
  h('input', { type: 'text', name, 'data-rescue-input': '', value, ...extra });

/** A field label with its hover text on the whole row (the label, its text and its inputs). */
const hinted = (row: HTMLElement, text: string): HTMLElement => {
  row.title = text;
  return row;
};

export function openTagEditor(req: EditorRequest): void {
  closeTagEditor();
  ensureTheme();
  const { username, current: cur, anchor } = req;

  const text = textInput('text', cur?.text ?? '', { maxlength: 100, title: hint.tagText });
  const color = textInput('color', cur?.color ?? '', {
    placeholder: '#rrggbb',
    title: hint.tagColor,
  });
  const picker = h('input', {
    type: 'color',
    name: 'colorpicker',
    'aria-label': 'Pick a colour',
    title: hint.tagPicker,
    value: cur?.color ?? '#ffd700',
  });
  const link = textInput('link', cur?.link ?? req.defaultLink ?? '', {
    placeholder: 'https://…',
    title: hint.tagLinkField,
  });
  const open = h(
    'a',
    { class: 'rescue-tag-open', target: '_blank', rel: 'noopener noreferrer', title: hint.tagOpen },
    'open',
  );
  const ignore = h('input', { type: 'checkbox', name: 'ignore', title: hint.tagIgnore });
  ignore.checked = cur?.ignored === true;
  const count = (name: string, value: number, title: string) =>
    h('input', {
      type: 'number',
      name,
      'data-rescue-input': '',
      min: 0,
      step: 1,
      value: String(value),
      title,
      style: 'width:60px',
    });
  const votesUp = count('votesUp', cur?.votesUp ?? 0, hint.tagVotesUp);
  const votesDown = count('votesDown', cur?.votesDown ?? 0, hint.tagVotesDown);

  const preview = h('span', {
    class: 'rescue-tag-preview',
    'aria-live': 'polite',
    title: hint.tagPreview,
  });
  const refresh = () => {
    const c = color.value.trim();
    const swatchColor = validColor(c) ?? '';
    swatches.sync(c === '' ? '' : swatchColor || c);
    preview.replaceChildren(buildTagChip({ text: text.value.trim() || ' ', color: validColor(c) }));
    const l = validLink(link.value);
    if (l) open.setAttribute('href', l);
    else open.removeAttribute('href');
    open.hidden = !l;
  };
  const swatches = buildSwatches((hex) => {
    color.value = hex;
    if (hex) picker.value = hex;
    refresh();
  });
  const presets = buildPresetRow(req.presets ?? [], (p) => {
    text.value = p.text;
    color.value = p.color ?? '';
    if (p.color) picker.value = p.color;
    refresh();
  });
  presets.el.hidden = !(req.presets ?? []).length;
  picker.addEventListener('input', () => {
    color.value = picker.value;
    refresh();
  });
  for (const el of [text, color, link]) el.addEventListener('input', refresh);

  const error = h('p', {
    class: 'rescue-tag-error',
    role: 'alert',
    hidden: true,
    title: hint.tagError,
  });
  error.style.cssText = 'color:var(--rescue-danger,#c33333);margin:4px 0';
  const fail = (msg: string) => {
    error.textContent = msg;
    error.hidden = false;
  };
  const save = h(
    'button',
    { type: 'submit', class: 'rescue-tag-save', title: hint.tagSave },
    'Save',
  );
  const del = h(
    'button',
    { type: 'button', class: 'rescue-tag-delete', title: hint.tagDelete },
    'Delete',
  );
  const cancel = h(
    'button',
    { type: 'button', class: 'rescue-tag-cancel', title: hint.tagCancel },
    'Cancel',
  );
  // Named "Add as preset" (not "Save ...") so it never reads as a second Save button.
  const asPreset = h(
    'button',
    {
      type: 'button',
      class: 'rescue-tag-save-preset',
      'aria-label': 'Add as preset',
      title: hint.tagAddPreset,
    },
    '+ preset',
  );
  asPreset.style.cssText = BARE_BUTTON;
  const manage = h(
    'button',
    { type: 'button', class: 'rescue-tag-manage', title: hint.tagManage },
    'Tagged users',
  );
  manage.style.cssText = BARE_BUTTON;
  const actions = h('div', { class: 'rescue-tag-actions' }, save, del, cancel);
  actions.style.cssText = 'display:flex;gap:6px;margin-top:8px;align-items:center';
  if (req.onManage) actions.append(manage);
  const title = h('div', { class: 'rescue-tag-title', title: hint.tagTitle }, `Tag u/${username}`);
  title.style.cssText = 'font-weight:bold';

  const previewRow = hinted(
    h('div', { class: 'rescue-tag-field' }, h('span', null, 'Preview'), preview),
    hint.tagPreview,
  );
  previewRow.style.cssText = FIELD_CSS;
  if (req.onSavePreset) previewRow.append(asPreset);
  const linkRow = hinted(field('Link', link, open), hint.tagLinkField);
  const form = h(
    'form',
    { novalidate: true },
    hinted(field('Tag', text), hint.tagText),
    hinted(field('Color', color, picker), hint.tagColor),
    swatches.el,
    previewRow,
    presets.el,
    linkRow,
    hinted(field('Upvotes', votesUp), hint.tagVotesUp),
    hinted(field('Downvotes', votesDown), hint.tagVotesDown),
    hinted(field('Ignore', ignore), hint.tagIgnore),
    error,
    actions,
  );
  const box = h(
    'div',
    { class: 'rescue-tag-editor rescue-overlay', role: 'dialog', 'aria-label': `Tag ${username}` },
    title,
    form,
  );
  box.style.cssText = BOX_CSS;

  const outside = (e: Event) => {
    if (!box.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  function close() {
    document.removeEventListener('mousedown', outside, true);
    box.remove();
    if (current?.box === box) current = null;
    if (anchor instanceof HTMLElement && anchor.isConnected) anchor.focus();
  }
  for (const t of ['keydown', 'keyup', 'keypress']) {
    box.addEventListener(t, (e) => {
      e.stopPropagation();
      // The key dispatcher swallows keydown from our inputs, so Escape is read on keyup too.
      if ((t === 'keyup' || t === 'keydown') && (e as KeyboardEvent).key === 'Escape') close();
    });
  }
  const submit = () => {
    const c = color.value.trim();
    const l = link.value.trim();
    if (c && !validColor(c)) return fail('Colour must look like #ff8800.');
    if (l && !validLink(l)) return fail('Link must start with http:// or https://.');
    req.onSave({
      text: text.value,
      color: c,
      link: l,
      ignored: ignore.checked,
      votesUp: wholeNumber(votesUp.value),
      votesDown: wholeNumber(votesDown.value),
    });
    close();
  };
  // Enter in a field makes the browser click the form's default (Save) button.
  save.addEventListener('click', (e) => {
    e.preventDefault();
    submit();
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  del.addEventListener('click', () => {
    req.onDelete();
    close();
  });
  cancel.addEventListener('click', close);
  asPreset.addEventListener('click', () => {
    const c = color.value.trim();
    const t = text.value.trim();
    if (!t) return fail('Enter the tag text first to save it as a preset.');
    if (c && !validColor(c)) return fail('Colour must look like #ff8800.');
    const preset: PresetTag = c ? { text: t, color: validColor(c)! } : { text: t };
    req.onSavePreset?.(preset);
    presets.add(preset);
    presets.el.hidden = false;
    error.hidden = true;
  });
  manage.addEventListener('click', () => {
    close();
    req.onManage?.();
  });

  refresh();
  document.body.append(box);
  placePopup(box, anchor);
  document.addEventListener('mousedown', outside, true);
  current = { box, close };
  text.focus({ preventScroll: true });
}
