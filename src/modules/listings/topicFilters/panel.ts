/**
 * The small "Topic filters" panel: one checkbox per topic, opened from the REScue menu row. It
 * follows the filteReddit ⊘ menu's pattern (inline.ts): a box placed next to an anchor by
 * placePopup, closed by a click outside or Escape, with its keys kept away from the page's key
 * dispatcher. All text is set with textContent, never as markup.
 */
import { h } from '../../../core/dom';
import { placePopup } from '../../../core/popup';
import { text } from './hints';
import { TOPICS, TOPIC_IDS } from './topics';

export const SETTINGS_HREF = '#rescue:settings/topicFilters';

export interface PanelApi {
  isOn(id: string): boolean;
  size(id: string): number;
  /** The reader ticked or cleared a box. */
  toggle(id: string, on: boolean): void;
}

const BOX_CSS =
  'position:absolute;z-index:2147483646;min-width:240px;max-width:calc(100vw - 16px);box-sizing:border-box;padding:6px 8px;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,.25);font:13px Verdana,Arial,sans-serif;display:flex;flex-direction:column;gap:2px';
const ROW_CSS = 'display:flex;align-items:center;gap:6px;padding:3px 2px;cursor:pointer';
const MUTED_CSS = 'margin-left:auto;padding-left:12px;opacity:.65;font-size:11px';

let current: { box: HTMLElement; anchor: Element; close(): void } | null = null;

export function closeTopicPanel(): void {
  current?.close();
}

/** The "gear" the reader clicked: the header button if it is showing, else the corner word. */
export function menuAnchor(doc: Document = document): Element {
  const ids = ['rescue-header-button', 'rescue-gear'];
  const found = ids.map((id) => doc.getElementById(id)).filter((e): e is HTMLElement => !!e);
  return found.find((e) => e.getClientRects().length > 0) ?? found[0] ?? doc.body;
}

export function openTopicPanel(anchor: Element, api: PanelApi): void {
  closeTopicPanel();

  const boxes = new Map<string, HTMLInputElement>();
  const rows = TOPIC_IDS.map((id) => {
    const topic = TOPICS[id]!;
    const box = h('input', { type: 'checkbox', 'data-topic': id });
    box.checked = api.isOn(id);
    box.addEventListener('change', () => api.toggle(id, box.checked));
    boxes.set(id, box);
    const row = h(
      'label',
      { class: 'rescue-topic-row', title: text.checkbox(topic.label, topic.description) },
      box,
      h('span', null, topic.label),
      h('span', { class: 'rescue-topic-count' }, `${api.size(id)} subreddits`),
    );
    row.style.cssText = ROW_CSS;
    (row.lastElementChild as HTMLElement).style.cssText = MUTED_CSS;
    return row;
  });
  const more = h(
    'a',
    { class: 'rescue-topic-more', href: SETTINGS_HREF, title: text.more },
    'More settings',
  );
  more.style.cssText = 'margin-top:4px;padding:3px 2px;color:var(--rescue-accent,#336699)';
  const box = h(
    'div',
    {
      class: 'rescue-topic-panel rescue-overlay',
      role: 'group',
      'aria-label': 'Topic filters',
      title: text.panel,
    },
    ...rows,
    more,
  );
  box.style.cssText = BOX_CSS;

  const outside = (e: Event): void => {
    const path = e.composedPath();
    if (!path.includes(box) && !path.includes(anchor)) close(false);
  };
  function close(refocus = true): void {
    document.removeEventListener('mousedown', outside, true);
    box.remove();
    if (current?.box === box) current = null;
    if (refocus && anchor instanceof HTMLElement && anchor.isConnected) anchor.focus();
  }
  for (const type of ['keydown', 'keyup', 'keypress']) {
    box.addEventListener(type, (e) => {
      e.stopPropagation();
      // Escape is also read on keyup: a selected post makes the key dispatcher take its keydown.
      if ((e as KeyboardEvent).key === 'Escape' && type !== 'keypress') close();
    });
  }
  more.addEventListener('click', () => close(false)); // the settings console opens from the link

  document.body.append(box);
  placePopup(box, anchor);
  document.addEventListener('mousedown', outside, true);
  current = { box, anchor, close };
  [...boxes.values()][0]?.focus();
}
