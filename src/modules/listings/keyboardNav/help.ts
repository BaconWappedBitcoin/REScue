/**
 * Keyboard shortcut help overlay (RES keyboardNav toggleHelp; GPL-3.0, Copyright (C) the Reddit
 * Enhancement Suite contributors, commit 4defffc). Lists whatever is registered with the key
 * dispatcher, grouped by section, so rebinds and other modules' commands show up. The ten
 * link-number commands are shown as one row.
 */
import { h } from '../../../core/dom';
import { hint, label } from '../../../core/hints';
import { ensureTheme } from '../../../core/theme';
import type { KeysApi } from '../../../core/types';

const ID = 'rescue-keyhelp';
const LINK_ID = /^openLink(\d+)$/;
const SECTION_ORDER = ['Move', 'Open', 'Save', 'Link numbers', 'Go to', 'Vote', 'General'];

type Listed = ReturnType<KeysApi['list']>[number];

export interface HelpRow {
  keys: string;
  title: string;
}
export interface HelpSection {
  name: string;
  rows: HelpRow[];
}

export interface HelpOptions {
  onComments: boolean;
  /** Link numbers on, and which keys open them. */
  linkNumbers?: { enabled: boolean; keys: 'digit' | 'alt' };
}

const pretty = (keys: string): string =>
  keys
    .split(' ')
    .map((k) => k.replace(/\+/g, ' + '))
    .join(' then ');

/** "1" and "alt+1" become "1 – 9, 0" and "alt + 1 – 9, 0". */
const digitRange = (key: string): string => key.replace(/\d$/, '1 – 9, 0').replace(/\+/g, ' + ');

/** The rows the overlay shows, grouped and ordered by section. */
export function helpSections(list: Listed[], opts: HelpOptions): HelpSection[] {
  const context = opts.onComments ? 'comments' : 'listing';
  const sections = new Map<string, HelpRow[]>();
  const add = (name: string, row: HelpRow) =>
    sections.set(name, [...(sections.get(name) ?? []), row]);
  let linkRowDone = false;
  for (const c of list) {
    if (!c.keys.length || (c.context && c.context !== context)) continue;
    if (LINK_ID.test(c.id)) {
      if (linkRowDone || opts.linkNumbers?.enabled === false) continue;
      linkRowDone = true;
      const keys =
        opts.linkNumbers?.keys === 'alt' ? c.keys.filter((k) => k.startsWith('alt+')) : c.keys;
      add('Link numbers', {
        keys: keys.map(digitRange).join(', '),
        title: 'Open that numbered link in the selected item (shown as [1] … [0] beside each link)',
      });
      continue;
    }
    add(c.section ?? 'General', { keys: c.keys.map(pretty).join(', '), title: c.title });
  }
  const rank = (n: string): number => {
    const i = SECTION_ORDER.indexOf(n);
    return i < 0 ? SECTION_ORDER.length : i;
  };
  return [...sections]
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([name, rows]) => ({ name, rows }));
}

export function helpOpen(): boolean {
  return !!document.getElementById(ID);
}

export function closeHelp(): void {
  document.getElementById(ID)?.remove();
}

export function toggleHelp(keys: KeysApi, opts: HelpOptions): void {
  if (helpOpen()) return closeHelp();
  const body = helpSections(keys.list(), opts).flatMap((s) => [
    h('tr', null, h('th', { colspan: 2, style: 'text-align:left;padding-top:8px' }, s.name)),
    ...s.rows.map((r) =>
      h(
        'tr',
        { title: hint.helpRow(r.keys, r.title) },
        h('td', null, h('kbd', null, r.keys)),
        h('td', null, r.title),
      ),
    ),
  ]);
  const close = h(
    'button',
    { type: 'button', 'aria-label': 'Close shortcuts', title: hint.helpClose },
    label.close,
  );
  close.addEventListener('click', closeHelp);
  const dialog = h(
    'div',
    { id: ID, class: 'rescue-overlay', role: 'dialog', 'aria-label': 'Keyboard shortcuts' },
    h('div', null, h('strong', null, 'Keyboard shortcuts'), close),
    h('table', null, h('tbody', null, ...body)),
    h('p', null, 'Rebind keys in settings › Keyboard navigation. Esc closes this list.'),
  );
  dialog.style.cssText = [
    'position:fixed;top:6vh;left:50%;transform:translateX(-50%);z-index:2147483646',
    'max-height:80vh;overflow:auto;min-width:320px;padding:10px 14px;border-radius:6px',
    'background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc)',
    'box-shadow:0 8px 30px var(--rescue-shadow,rgba(0,0,0,.3));font:13px/1.5 system-ui,sans-serif',
  ].join(';');
  ensureTheme();
  document.body.appendChild(dialog);
}
