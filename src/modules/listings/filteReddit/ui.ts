/**
 * filteReddit page chrome: the filter banner (counts, power switch, show/hide, link to the rules),
 * the match-reason chip, and the one-line placeholder row. All text is written with textContent.
 *
 * Power switch: RES keeps this switch in its filterline (Filterline.js togglePowered, class
 * res-filters-disabled) — GPL-3.0, Copyright (C) the Reddit Enhancement Suite contributors,
 * commit 4defffc. Here it lasts for the current page view only: it is not saved, and it resets
 * when you move to another page or reload.
 */
import { h } from '../../../core/dom';
import { hint, IGNORED_USER } from '../../../core/hints';
import { NativeAdapter } from '../../../layout/native/adapter';

const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

export interface BannerView {
  /** Posts and comments the filters are hiding or collapsing right now. */
  posts: number;
  comments: number;
  /** Items that match a rule but are left alone because the switch is off. */
  held: number;
  powered: boolean;
  /** Keep the banner even when nothing is filtered (showFilterline). */
  always: boolean;
  /** The "show how many were filtered" option. */
  counts: boolean;
}

export interface Banner {
  update(view: BannerView): void;
  setRevealing(on: boolean): void;
  /** Back to the start-of-page state: filters on, nothing revealed. */
  reset(): void;
  /** The `fp` command: press the power switch. */
  togglePower(): void;
  /** The `fl` command: keep the bar on show (or let it hide again) for this page view. */
  togglePinned(): void;
  remove(): void;
}

export interface BannerHandlers {
  addBanner(el: HTMLElement): void;
  onPower(on: boolean): void;
  onReveal(on: boolean): void;
}

export const RULES_HREF = '#rescue:settings/filteReddit';

export function createBanner(handlers: BannerHandlers): Banner {
  const text = h('span', { class: 'rescue-filter-count', title: hint.filterCount });
  const power = h(
    'button',
    {
      type: 'button',
      class: 'rescue-filter-power rescue-btn',
      'aria-pressed': 'true',
      title: hint.filterPower(true),
    },
    'Filters on',
  );
  const toggle = h(
    'button',
    { type: 'button', class: 'rescue-filter-toggle rescue-btn', title: hint.filterReveal(false) },
    'show',
  );
  const rules = h(
    'a',
    { class: 'rescue-filter-rules rescue-btn', href: RULES_HREF, title: hint.filterRules },
    'rules',
  );
  const el = h(
    'div',
    { class: 'rescue-filter-banner infobar', role: 'status', hidden: true },
    text,
    ' · ',
    toggle,
    ' · ',
    power,
    ' · ',
    rules,
  );
  let on = true;
  let revealing = false;
  let added = false;
  let pinned = false;
  let last: BannerView | null = null;
  power.addEventListener('click', () => {
    on = !on;
    power.setAttribute('aria-pressed', String(on));
    power.textContent = on ? 'Filters on' : 'Filters off';
    power.title = hint.filterPower(on);
    // Anything revealed is plain again once the filters are off; the toggle starts over.
    revealing = false;
    showToggle(false);
    handlers.onPower(on);
  });
  toggle.addEventListener('click', () => {
    revealing = !revealing;
    showToggle(revealing);
    handlers.onReveal(revealing);
  });
  function showToggle(on: boolean): void {
    toggle.textContent = on ? 'hide' : 'show';
    toggle.title = hint.filterReveal(on);
  }

  const banner: Banner = {
    update(v) {
      last = v;
      const shown = v.posts + v.comments;
      const parts: string[] = [];
      if (v.posts || !v.comments) parts.push(count(v.posts, 'post filtered', 'posts filtered'));
      if (v.comments) parts.push(count(v.comments, 'comment filtered', 'comments filtered'));
      setText(
        text,
        v.powered
          ? shown
            ? parts.join(', ')
            : 'No posts filtered'
          : v.held
            ? `Filters off · ${count(v.held, 'item', 'items')} would be filtered`
            : 'Filters off',
      );
      toggle.hidden = !v.powered || shown === 0;
      el.hidden = !(v.always || pinned || (v.counts && shown > 0) || !v.powered);
      if (!el.hidden && !added) {
        added = true;
        handlers.addBanner(el);
      }
    },
    setRevealing(next) {
      revealing = next;
      showToggle(next);
    },
    togglePower() {
      power.click();
    },
    togglePinned() {
      pinned = !pinned;
      if (last) banner.update(last);
    },
    reset() {
      on = true;
      pinned = false;
      revealing = false;
      power.setAttribute('aria-pressed', 'true');
      power.textContent = 'Filters on';
      power.title = hint.filterPower(true);
      showToggle(false);
    },
    remove() {
      el.remove();
      added = false;
    },
  };
  return banner;
}

/** The visible "why was this filtered" label inside a revealed or collapsed item. */
export function reasonChip(): HTMLElement {
  const chip = h('span', { class: 'rescue-filter-reason rescue-label', hidden: true });
  chip.style.cssText =
    'background:var(--rescue-warn,#cc9900);color:var(--rescue-warn-fg,#000);max-width:24em;overflow:hidden;text-overflow:ellipsis';
  return chip;
}

export function setChip(
  chip: HTMLElement,
  reason: string | undefined,
  verb = 'Filtered',
  detail?: string,
): void {
  chip.hidden = !reason;
  setText(chip, reason ? (reason === IGNORED_USER ? 'Ignored user' : `${verb}: ${reason}`) : '');
  chip.title = reason
    ? detail
      ? hint.filterDetail(verb, detail)
      : hint.filterReason(verb, reason)
    : '';
}

/** Writing the same text again is still a DOM mutation, and the page watches for mutations. */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

/** One-line stand-in for a filtered post (filteredDisplay = placeholder). */
export interface Placeholder {
  row: HTMLElement;
  /** Put the row back in front of the post's wrapper if Reddit re-rendered around it. */
  place(source: Element): void;
  set(reason: string, peeking: boolean): void;
  remove(): void;
}

export function createPlaceholder(onToggle: () => void): Placeholder {
  const label = h('span', { class: 'rescue-filter-placeholder-text' });
  const button = h('button', {
    type: 'button',
    class: 'rescue-filter-placeholder-btn rescue-btn',
    title: hint.filterPlaceholderButton(false),
  });
  const row = h(
    'div',
    {
      class: 'rescue-filter-placeholder rescue-overlay',
      role: 'group',
      title: hint.filterPlaceholder,
    },
    label,
    button,
  );
  row.style.cssText =
    'padding:4px 10px;margin:2px 0;font:12px/1.4 system-ui,sans-serif;border:1px dashed var(--rescue-warn,#cc9900);border-radius:4px;color:inherit';
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggle();
  });
  return {
    row,
    place(source) {
      const wrapper = NativeAdapter.wrapperOf(source);
      if (wrapper.previousElementSibling !== row && wrapper.parentNode) wrapper.before(row);
    },
    set(reason, peeking) {
      setText(label, reason === IGNORED_USER ? 'Ignored user —' : `Filtered: ${reason} —`);
      setText(button, peeking ? 'hide' : 'show');
      button.title = hint.filterPlaceholderButton(peeking);
      button.setAttribute(
        'aria-label',
        `${peeking ? 'Hide' : 'Show'} this filtered post (${reason})`,
      );
    },
    remove() {
      row.remove();
    },
  };
}
