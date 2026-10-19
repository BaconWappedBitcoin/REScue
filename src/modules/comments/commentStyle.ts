/**
 * commentStyle (RES commentStyle, gap build H1): draw each comment as a box, round its corners and
 * mark the box the pointer is over. One REScue stylesheet on Reddit's own comment element (a
 * light-DOM host with no shadow root of its own, so a border on it also wraps its replies, which
 * is how RES's nested boxes looked). Ported in spirit from RES lib/modules/commentStyle.js
 * (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 *
 * Reddit already draws thread lines, so RES's `continuity` is native. `commentIndent` adds to (or
 * takes from) Reddit's own indent for nested replies through one CSS rule keyed on `depth`.
 */
import { commentDepthAttr, commentHostSelector } from '../../model/appearance';
import { removeStyle, setStyle } from '../appearance/injectedStyle';
import { validColor } from '../users/tagStore';
import { defineModule } from '../../core/types';

const STYLE_ID = 'rescue-comment-style';

export interface CommentStyleOptions {
  commentBoxes: boolean;
  commentRounded: boolean;
  commentHoverBorder: boolean;
  /** Colour of the border when the pointer is over a comment. */
  hoverBorderColor?: string;
  /** Extra left indent (pixels) added to nested replies; 0 keeps Reddit's own. */
  commentIndent?: number;
}

/** The stylesheet for the chosen options; empty when everything is off. */
export function commentStyleCss(o: CommentStyleOptions): string {
  const host = commentHostSelector();
  const css: string[] = [];
  const border = 'rgba(128, 128, 128, 0.45)';
  if (o.commentBoxes) {
    css.push(`${host} { display: block; border: 1px solid ${border}; margin-block: 2px; }`);
  } else if (o.commentHoverBorder) {
    // No box, but the hover mark still needs a border to colour; keep it invisible until hovered.
    css.push(`${host} { display: block; border: 1px solid transparent; }`);
  }
  if (o.commentRounded && (o.commentBoxes || o.commentHoverBorder)) {
    css.push(`${host} { border-radius: 4px; }`);
  }
  if (o.commentHoverBorder) {
    const colour = validColor(o.hoverBorderColor) ?? '#ff4500';
    // Replies sit inside their parent, so a parent is under the pointer whenever a reply is: only
    // the innermost comment under the pointer gets the colour.
    css.push(`${host}:hover:not(:has(${host}:hover)) { border-color: ${colour}; }`);
  }
  const indent = o.commentIndent;
  if (typeof indent === 'number' && Number.isFinite(indent) && indent !== 0) {
    // Reddit's own depth decides the indent; only nested comments (a non-"0" depth) are moved.
    const depth = commentDepthAttr();
    css.push(`${host}[${depth}]:not([${depth}="0"]) { margin-left: ${indent}px; }`);
  }
  return css.join('\n');
}

export const commentStyle = defineModule({
  id: 'commentStyle',
  resId: 'commentStyle',
  category: 'comments',
  title: 'Comment boxes',
  description:
    'Draw each comment in a box (replies sit in boxes inside it), round the corners, and mark the box under the pointer with a coloured border. Reddit already draws thread lines. The comment’s own layout is Reddit’s, so how the box lines up needs a look on the live site.',
  enabledByDefault: false,
  options: {
    commentBoxes: {
      type: 'boolean',
      default: true,
      title: 'Draw comments in boxes',
    },
    commentRounded: {
      type: 'boolean',
      default: true,
      title: 'Round the corners',
    },
    commentHoverBorder: {
      type: 'boolean',
      default: false,
      title: 'Mark the comment under the pointer',
      description: 'The border of the box around the pointer changes colour.',
    },
    hoverBorderColor: {
      type: 'color',
      default: '#ff4500',
      title: 'Hover border colour',
      dependsOn: 'commentHoverBorder',
    },
    commentIndent: {
      type: 'number',
      default: 0,
      min: -40,
      max: 60,
      title: 'Extra indent for replies (pixels)',
      description:
        'Added to (or, with a negative value, taken from) Reddit’s own indent for nested replies. 0 keeps Reddit’s layout.',
    },
  },

  init(ctx) {
    setStyle(STYLE_ID, commentStyleCss(ctx.options));
  },

  onSettings(ctx) {
    setStyle(STYLE_ID, commentStyleCss(ctx.options));
  },

  dispose() {
    removeStyle(STYLE_ID);
  },
});
