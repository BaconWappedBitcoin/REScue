/**
 * commentQuickCollapse (RES commentQuickCollapse, gap build H1): Reddit collapses a comment when
 * its header is clicked; RES's extra, "scroll on collapse", is built here. After a comment is
 * collapsed, if its top has scrolled above the top of the window (you collapsed a long comment
 * from its far end, or from a nested reply) the page scrolls back so the collapsed comment is
 * on screen and you do not lose your place. Only the scroll position changes.
 *
 * The left edge (RES leftEdgeColor / leftEdgeHoverColor / leftEdgeCollapsedColor / leftEdgeWidth):
 * Reddit's thread line is a light-DOM `div.threadline-strip` inside the comment, so a REScue
 * stylesheet can colour and widen it (unlike RES's old reddit, which restyled its own DOM). Every
 * option defaults to empty, which leaves Reddit's own look alone; the collapsed colour needs the
 * candidate `collapsed` attribute, so it simply does nothing where Reddit does not set one.
 * Ported in spirit from RES lib/modules/commentQuickCollapse.js (GPL-3.0, the RES contributors,
 * commit 4defffc); the code is new.
 */
import { defineModule } from '../../core/types';
import { watchCollapseToggles } from '../../model/access';
import {
  commentCollapsedAttr,
  commentHostSelector,
  commentHostById,
  commentThreadlineSelector,
} from '../../model/appearance';
import { removeStyle, setStyle } from '../appearance/injectedStyle';
import { validColor } from '../users/tagStore';

/** Space kept above a comment brought back into view, clear of Reddit's sticky header. */
const TOP_MARGIN = 72;

const STYLE_ID = 'rescue-comment-quick-collapse';

/** How far to scroll (negative = up) to bring a collapsed comment's top into view; 0 if it is. */
export function scrollBackBy(top: number, margin = TOP_MARGIN): number {
  return top < margin ? top - margin : 0;
}

export interface QuickCollapseOptions {
  /** Colour of the thread line; empty leaves Reddit's own. */
  leftEdgeColor?: string;
  /** Colour of the thread line under the pointer; empty leaves Reddit's own. */
  leftEdgeHoverColor?: string;
  /** Colour of the thread line of a collapsed comment; empty leaves Reddit's own. */
  leftEdgeCollapsedColor?: string;
  /** Width in pixels of the thread line; 0 leaves Reddit's own. */
  leftEdgeWidth?: number;
}

/** The stylesheet for the left-edge options; empty when none of them is set. */
export function quickCollapseCss(o: QuickCollapseOptions): string {
  const host = commentHostSelector();
  const line = `${host} ${commentThreadlineSelector()}`;
  const css: string[] = [];
  const color = validColor(o.leftEdgeColor);
  if (color) css.push(`${line} { background-color: ${color}; }`);
  const hover = validColor(o.leftEdgeHoverColor);
  if (hover) css.push(`${line}:hover { background-color: ${hover}; }`);
  const collapsed = validColor(o.leftEdgeCollapsedColor);
  if (collapsed) {
    css.push(
      `${host}[${commentCollapsedAttr()}] ${commentThreadlineSelector()} { background-color: ${collapsed}; }`,
    );
  }
  const width = o.leftEdgeWidth;
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
    css.push(`${line} { width: ${width}px; }`);
  }
  return css.join('\n');
}

let stop: (() => void) | null = null;
/** The options as they are now (a settings change swaps this; the watcher reads it each time). */
let scrollOnCollapse = true;

export const commentQuickCollapse = defineModule({
  id: 'commentQuickCollapse',
  resId: 'commentQuickCollapse',
  category: 'comments',
  title: 'Collapse comments (scroll on collapse, thread line)',
  description:
    'Reddit collapses a comment when you click its header. This adds RES’s “scroll on collapse”: when you collapse a comment whose top is above the window, the page scrolls back up to it. The left-edge options recolour and widen Reddit’s thread line (empty keeps Reddit’s own look); collapsed comments can use their own colour.',
  enabledByDefault: false,
  options: {
    scrollOnCollapse: {
      type: 'boolean',
      default: true,
      title: 'Scroll back to a comment after collapsing it',
      description: 'Only when its top has scrolled out of view above the window.',
    },
    leftEdgeColor: {
      type: 'color',
      default: '',
      title: 'Thread line colour',
      description: 'Empty keeps Reddit’s own colour.',
    },
    leftEdgeHoverColor: {
      type: 'color',
      default: '',
      title: 'Thread line colour under the pointer',
      description: 'Empty keeps Reddit’s own colour.',
    },
    leftEdgeCollapsedColor: {
      type: 'color',
      default: '',
      title: 'Thread line colour of a collapsed comment',
      description: 'Empty keeps Reddit’s own colour.',
    },
    leftEdgeWidth: {
      type: 'number',
      default: 0,
      min: 0,
      max: 40,
      title: 'Thread line width (pixels)',
      description: '0 keeps Reddit’s own width.',
    },
  },

  init(ctx) {
    scrollOnCollapse = ctx.options.scrollOnCollapse === true;
    setStyle(STYLE_ID, quickCollapseCss(ctx.options));
    stop = watchCollapseToggles((id, collapsed) => {
      if (!collapsed || !scrollOnCollapse) return;
      const host = commentHostById(id);
      if (!host) return;
      // Let Reddit finish collapsing before measuring.
      requestAnimationFrame(() => {
        const by = scrollBackBy(host.getBoundingClientRect().top);
        if (by !== 0) window.scrollBy?.({ top: by, behavior: 'instant' });
      });
    });
  },

  onSettings(ctx) {
    scrollOnCollapse = ctx.options.scrollOnCollapse === true;
    setStyle(STYLE_ID, quickCollapseCss(ctx.options));
  },

  dispose() {
    stop?.();
    stop = null;
    removeStyle(STYLE_ID);
  },
});
