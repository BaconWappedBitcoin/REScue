/**
 * localDate (RES localDate, US8): the absolute date and time, in your time zone, beside Reddit's
 * relative time ("3h ago"). Ported in spirit from RES lib/modules/localDate.js (GPL-3.0, the RES
 * contributors, commit 4defffc); the code is new.
 *
 * RES set the full date as a tooltip on the time element while the mouse was over it. That is the
 * default here too ("tooltip"): a `title` on Reddit's own time element, put back when the module
 * is disposed. "inline" instead adds a small label after the time through the tagline decoration
 * slot (post: after the time in the credit bar; comment: inside the meta line), and "both" does
 * both. The instant comes from the time element (`ts`, else a <time datetime>); when the page has
 * no such element the item's own created timestamp is used, and the tooltip is skipped.
 *
 * Changing the options takes effect on the next page load (items already on the page are not
 * revisited).
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import { moduleOn, resolveOptions } from '../../core/settings';
import { defineModule, type ModuleContext } from '../../core/types';
import { ownTimeElement, timeElementDate } from '../../model/appearance';

type Format = 'locale' | 'iso';
const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-15 06:30:05" in the reader's time zone, or the browser's own locale format. */
export function formatLocalDate(date: Date, format: Format): string {
  if (format === 'iso') {
    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    );
  }
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}

interface Titled {
  el: Element;
  label: string;
  previous: string | null;
}

let titled: Titled[] = [];
let labels: HTMLElement[] = [];
const seen = new Set<string>();

function restore(): void {
  for (const t of titled) {
    // Only undo our own title; if Reddit changed it meanwhile, leave Reddit's value.
    if (t.el.getAttribute('title') !== t.label) continue;
    if (t.previous === null) t.el.removeAttribute('title');
    else t.el.setAttribute('title', t.previous);
  }
  titled = [];
  for (const n of labels) {
    n.remove();
    n.style.display = 'none'; // the decoration registry may still hold it
  }
  labels = [];
  seen.clear();
}

export const localDate = defineModule({
  id: 'localDate',
  resId: 'localDate',
  category: 'appearance',
  title: 'Local date and time',
  description:
    'Show the exact date and time, in your time zone, for posts and comments. By default it appears as a tooltip when you point at Reddit’s “3h ago”; you can also add it as a small label after the time. Reddit may already show a date tooltip of its own. Changes apply the next time a page loads.',
  enabledByDefault: false,
  options: {
    display: {
      type: 'enum',
      default: 'tooltip',
      title: 'Show the date as',
      values: [
        { value: 'tooltip', label: 'Tooltip on the time' },
        { value: 'inline', label: 'Label after the time' },
        { value: 'both', label: 'Both' },
      ],
    },
    format: {
      type: 'enum',
      default: 'locale',
      title: 'Format',
      values: [
        { value: 'locale', label: 'My browser’s format' },
        { value: 'iso', label: 'YYYY-MM-DD HH:MM:SS' },
      ],
    },
    showLastEditedTimestamp: {
      type: 'boolean',
      default: true,
      title: 'Show when a comment was last edited',
      description:
        'In the Old Reddit look, an edited comment always gets old Reddit’s “*” after its age (point at it for when it was edited). With this on, it says “(last edited 5 days ago)” instead. Reddit’s normal layout already shows “Edited” by itself.',
    },
  },

  onItems(batch, ctx) {
    const { display, format } = ctx.options;
    const items = [...batch.posts, ...batch.comments];
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const el = ownTimeElement(item.source);
      const date = (el && timeElementDate(el)) ?? item.created;
      if (!date) continue;
      const label = formatLocalDate(date, format as Format);
      if (el && display !== 'inline') {
        // `label` here is the title text REScue sets, so restore() can tell it from Reddit's own.
        titled.push({ el, label: hint.localDate(label), previous: el.getAttribute('title') });
        el.setAttribute('title', hint.localDate(label));
      }
      if (display !== 'tooltip') {
        const node = h(
          'span',
          { class: 'rescue-local-date rescue-label', title: hint.localDate(label) },
          label,
        );
        labels.push(node);
        ctx.ui.decorate(item, 'tagline', node);
      }
    }
  },

  onRoute() {
    // The registry's items are new on a route change; forget ids so they are labelled again.
    seen.clear();
  },

  dispose: restore,
});

/**
 * RES betteReddit's showLastEditedTimestamp, for the Old Reddit look (oldSkin/comment.ts): true
 * while this module is on and the option is on. Read from the profile, so it follows the settings.
 */
export function showLastEdited(ctx: ModuleContext): boolean {
  if (!moduleOn(ctx.settings, localDate.id)) return false;
  return resolveOptions(localDate, ctx.settings.profile()).showLastEditedTimestamp === true;
}
