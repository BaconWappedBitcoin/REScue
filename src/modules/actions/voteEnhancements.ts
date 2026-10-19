/**
 * voteEnhancements (RES voteEnhancements, US7 / T103): the upvote ratio after a post's time
 * ("97% upvoted") and RES's score colouring.
 *
 * Upvote ratio: the post's own `upvote-ratio` attribute (C.postAttr.upvoteRatio, read by the Post
 * model as `upvoteRatio`). The attribute name is inherited from Sheddit's list and appears in the
 * test fixtures; it has not been captured on a live listing (no `verifiedAt` in the contract).
 * Where Reddit leaves it off a post, REScue shows nothing for that post and never estimates a value.
 *
 * Score colouring (colorLinkScore / colorCommentScore, off by default): a small coloured score label
 * REScue draws itself in the credit bar / comment meta line, coloured by the reader's own table of
 * thresholds (userDefinedLinkColoration / userDefinedCommentColoration, interpolateScoreColor).
 * Reddit's own number is never recoloured. A post's score is its `score` attribute; a comment's
 * score counts only once its action row has hydrated and says it is not hidden (model/commentRow.ts,
 * research R20), so a hidden or not-yet-known score shows nothing.
 *
 * Ported in spirit from RES lib/modules/voteEnhancements.js (GPL-3.0, the RES contributors, commit
 * 4defffc); the code is new.
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import {
  defineModule,
  type ModuleContext,
  type OptionSchema,
  type OptionSpec,
} from '../../core/types';
import { commentScoreOf, commentThingId, watchCommentRows } from '../../model/commentRow';
import type { Comment } from '../../model/types';
import { removeStyle, setStyle } from '../appearance/injectedStyle';
import { parseStops, scoreColor, validateStopRow } from './scoreColor';

const HIGHLIGHT_STYLE_ID = 'rescue-highlight-scores';

/** "97% upvoted", or null when the model has no usable ratio (a number from 0 to 1). */
export function ratioLabel(ratio: number | null | undefined): string | null {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) return null;
  return `${Math.round(ratio * 100)}% upvoted`;
}

/** "1 pt" / "42 pts": the text of a score chip. */
export const scoreLabel = (score: number): string => `${score} ${score === 1 ? 'pt' : 'pts'}`;

/**
 * RES's highlightScores bolded/coloured `span.score`. Reddit draws its own score inside a closed
 * vote component / comment shadow root, so REScue instead bolds the score label it draws itself
 * (the chip the colouring options add). Empty when off. `:root` outranks `:root .rescue-label`.
 */
export function highlightScoresCss(on: boolean): string {
  return on ? ':root span.rescue-score-chip { font-weight: 700; }' : '';
}

const LINK_STOPS = [
  { score: '1', color: '#6b7280' },
  { score: '100', color: '#2f855a' },
  { score: '1000', color: '#d97706' },
  { score: '10000', color: '#7c3aed' },
];
const COMMENT_STOPS = [
  { score: '-1', color: '#c53030' },
  { score: '1', color: '#6b7280' },
  { score: '10', color: '#2f855a' },
  { score: '100', color: '#d97706' },
  { score: '1000', color: '#7c3aed' },
];

const stopTable = (title: string, dependsOn: string, rows: typeof LINK_STOPS): OptionSpec => ({
  type: 'table',
  default: rows,
  title,
  description:
    'Each row gives the colour for scores at or above it (up to the next row). Scores below the lowest row get no colour.',
  dependsOn,
  columns: [
    { key: 'score', title: 'Score', type: 'text' },
    { key: 'color', title: 'Colour', type: 'color' },
  ],
  validateRow: validateStopRow,
});

const options: OptionSchema = {
  highlightScores: {
    type: 'boolean',
    default: false,
    title: 'Highlight scores',
    description:
      'Make scores bold. Reddit draws its own score inside a shadow root, so this styles the score label REScue draws itself, which appears when a score colouring option is on.',
  },
  colorLinkScore: {
    type: 'boolean',
    default: false,
    title: 'Colour post scores',
    description:
      'Show each post’s score as a small coloured label after its time. Reddit’s own number is not changed.',
  },
  userDefinedLinkColoration: stopTable('Post score colours', 'colorLinkScore', LINK_STOPS),
  colorCommentScore: {
    type: 'boolean',
    default: false,
    title: 'Colour comment scores',
    description:
      'Show each comment’s score as a small coloured label in its header once Reddit has loaded it. Comments with a hidden score show nothing.',
  },
  userDefinedCommentColoration: stopTable(
    'Comment score colours',
    'colorCommentScore',
    COMMENT_STOPS,
  ),
  interpolateScoreColor: {
    type: 'boolean',
    default: false,
    title: 'Blend colours between rows',
    description: 'A score between two rows gets a mix of their colours instead of the lower row’s.',
  },
};

function makeChip(what: 'post' | 'comment', id: string): HTMLElement {
  const node = h(
    'span',
    { class: `rescue-score-chip rescue-score-${what} rescue-label`, 'data-item': id },
    '',
  );
  node.style.cssText = 'border:1px solid currentColor';
  return node;
}

/** Paint a chip for `score` (hidden when there is nothing to show). */
function paint(
  node: HTMLElement,
  what: 'post' | 'comment',
  score: number | null,
  color: string | null,
): boolean {
  const show = score !== null && color !== null;
  node.hidden = !show;
  if (!show) return false;
  node.textContent = scoreLabel(score);
  node.style.color = color;
  node.title = hint.scoreChip(what, score);
  return true;
}

let current: ModuleContext | null = null;
let stopRows: (() => void) | null = null;
const seen = new Map<string, Comment>();
const chips = new Map<string, HTMLElement>();

function commentColor(ctx: ModuleContext, score: number | null): string | null {
  return scoreColor(
    score,
    parseStops(ctx.options.userDefinedCommentColoration),
    ctx.options.interpolateScoreColor === true,
  );
}

/** Make, update or hide the chip of one comment; it is added to the page the first time it shows. */
function refreshComment(ctx: ModuleContext, comment: Comment): void {
  const score = commentScoreOf(comment.source);
  const color = commentColor(ctx, score);
  let node = chips.get(comment.id);
  if (!node) {
    if (score === null || color === null) return;
    node = makeChip('comment', comment.id);
    chips.set(comment.id, node);
    ctx.ui.decorate(comment, 'tagline', node);
  }
  paint(node, 'comment', score, color);
}

export const voteEnhancements = defineModule({
  id: 'voteEnhancements',
  resId: 'voteEnhancements',
  category: 'actions',
  title: 'Scores and upvote ratio',
  description:
    'Shows the share of votes that are upvotes ("97% upvoted") after the time on a post. It reads the ratio from the post itself, so a post that does not carry one shows nothing; Reddit’s listings may not carry it, and this has not been confirmed live. Optionally shows post and comment scores as small coloured labels (off by default), coloured by thresholds you set. A comment’s score appears once Reddit has loaded it, and a hidden score shows nothing. “Highlight scores” makes those REScue-drawn labels bold (Reddit’s own score is inside a shadow root and cannot be reached).',
  enabledByDefault: true,
  options,

  init(ctx) {
    current = ctx;
    setStyle(HIGHLIGHT_STYLE_ID, highlightScoresCss(ctx.options.highlightScores === true));
    if (ctx.options.colorCommentScore) {
      stopRows = watchCommentRows((host) => {
        const id = commentThingId(host);
        const comment = id ? seen.get(id) : undefined;
        if (comment && current) refreshComment(current, comment);
      });
    }
  },

  onSettings(ctx) {
    current = ctx;
    setStyle(HIGHLIGHT_STYLE_ID, highlightScoresCss(ctx.options.highlightScores === true));
  },

  onItems(batch, ctx) {
    current = ctx;
    for (const p of batch.posts) {
      const label = ratioLabel(p.upvoteRatio);
      if (label) {
        const node = h(
          'span',
          { class: 'rescue-upvote-ratio rescue-label', 'data-post': p.id },
          label,
        );
        node.title = hint.upvoteRatio(label);
        ctx.ui.decorate(p, 'tagline', node);
      }
      if (ctx.options.colorLinkScore) {
        const color = scoreColor(
          p.score,
          parseStops(ctx.options.userDefinedLinkColoration),
          ctx.options.interpolateScoreColor === true,
        );
        const chip = makeChip('post', p.id);
        if (paint(chip, 'post', p.score, color)) ctx.ui.decorate(p, 'tagline', chip);
      }
    }
    if (!ctx.options.colorCommentScore) return;
    for (const c of batch.comments) {
      seen.set(c.id, c);
      refreshComment(ctx, c);
    }
  },

  onRoute() {
    seen.clear();
    chips.clear();
  },

  dispose() {
    stopRows?.();
    stopRows = null;
    removeStyle(HIGHLIGHT_STYLE_ID);
    seen.clear();
    chips.clear();
    current = null;
  },
});
