/**
 * The visible tag chip, shared by the page decoration, the editor's live preview, preset chips and
 * the tagged-users manager. Text only ever goes in through textContent / attributes, never markup.
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import { tagTextColor } from './tagColors';
import { tagKey, validColor, validLink } from './tagStore';

export interface ChipOptions {
  /** Add data-user (page decorations only). */
  user?: string;
  /** Cut long text with an ellipsis; the full text stays in the title. */
  truncate?: boolean;
  /** Render the text as a link (page decorations only). */
  link?: string;
}

export const CHIP_CSS = [
  '.rescue-user-tag{display:inline-block;vertical-align:baseline;padding:0 4px;border-radius:3px;background:var(--rescue-tag-bg,#e0e0e0);color:var(--rescue-tag-fg,#000);box-sizing:border-box}',
  '.rescue-user-tag a{text-decoration:underline}',
  '.rescue-user-tag.rescue-truncate{max-width:14em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
].join('\n');

export function buildTagChip(
  tag: { text?: string; color?: string },
  opts: ChipOptions = {},
): HTMLElement {
  const text = tag.text ?? '';
  // The full text stays in the tooltip, so a tag cut short with "…" can still be read.
  const span = h('span', {
    class: 'rescue-user-tag',
    title: text ? hint.tagChip(text, opts.user) : null,
  });
  if (opts.user) span.setAttribute('data-user', tagKey(opts.user));
  if (opts.truncate) span.classList.add('rescue-truncate');
  const color = validColor(tag.color);
  if (color) {
    span.style.backgroundColor = color;
    span.style.color = tagTextColor(color);
  }
  const link = validLink(opts.link);
  if (link) {
    const a = h(
      'a',
      { href: link, rel: 'noopener noreferrer nofollow', target: '_blank', title: hint.tagLink },
      text,
    );
    if (color) a.style.color = 'inherit';
    span.append(a);
  } else span.textContent = text;
  return span;
}
