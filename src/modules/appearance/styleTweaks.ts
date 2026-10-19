/**
 * styleTweaks (RES styleTweaks, US8): the few RES tweaks that are honest on Reddit's own layout,
 * as one REScue stylesheet. Ported in spirit from RES lib/modules/styleTweaks.js (GPL-3.0, the RES
 * contributors, commit 4defffc); the code is new.
 *
 * Built: a colour for post links you have visited, a separator above top-level comments, and
 * switching off animations. The rest of RES's list has no counterpart or is Reddit's own now
 * (see feature-matrix.md). Colour and size are validated before they reach the stylesheet.
 *
 * Honest limits: Reddit's own components keep their insides sealed, so "visited" colouring only
 * applies to links in the light DOM, and turning animations off only reaches the light DOM.
 */
import { C } from '../../contracts/reddit';
import { defineModule } from '../../core/types';
import {
  bodyLinks,
  postTitleSelector,
  topLevelCommentSelector,
  visitedLinkSelector,
} from '../../model/appearance';
import { validColor } from '../users/tagStore';
import { removeStyle, setStyle } from './injectedStyle';

const STYLE_ID = 'rescue-style-tweaks';

export interface TweakOptions {
  visitedLinks: boolean;
  visitedColor: string;
  topLevelSeparator: boolean;
  separatorColor: string;
  separatorSize: number;
  reduceMotion: boolean;
  /** Always show the page scrollbar track so the layout does not jump (betteReddit). */
  permanentVerticalScrollbar?: boolean;
  /** Shorten very long link addresses written out in posts and comments (betteReddit). */
  truncateLongLinks?: boolean;
  postTitleCapitalization?: string;
  /** Hide Reddit's "Suggested communities" blocks on every page. */
  hideSuggestedCommunities?: boolean;
}

export const TRUNCATE_ATTR = 'data-rescue-truncate';
/** Link text longer than this that reads as an address is shortened with an ellipsis. */
export const TRUNCATE_OVER = 40;

/** Does link text look like a web address long enough to shorten? (Pure; used by the marker.) */
export function isLongAddress(text: string): boolean {
  const t = text.trim();
  return t.length > TRUNCATE_OVER && /^(?:https?:\/\/|www\.)\S+$/i.test(t);
}

/** The stylesheet for the chosen tweaks; an invalid colour or size falls back to its default. */
export function tweaksCss(o: TweakOptions): string {
  const css: string[] = [];
  if (o.visitedLinks) {
    css.push(
      `${visitedLinkSelector()} { color: ${validColor(o.visitedColor) ?? '#8a5fb3'} !important; }`,
    );
  }
  if (o.topLevelSeparator) {
    const size = Number.isFinite(o.separatorSize)
      ? Math.min(8, Math.max(1, Math.round(o.separatorSize)))
      : 2;
    css.push(
      `${topLevelCommentSelector()} { border-top: ${size}px solid ${validColor(o.separatorColor) ?? '#8b0000'}; }`,
    );
  }
  if (o.reduceMotion) {
    css.push(
      '*, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }',
    );
  }
  if (o.permanentVerticalScrollbar) css.push('html { overflow-y: scroll; }');
  if (o.truncateLongLinks) {
    css.push(
      `a[${TRUNCATE_ATTR}] { display: inline-block; max-width: min(100%, 32em); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }`,
    );
  }
  if (o.hideSuggestedCommunities) css.push(`${C.suggestedCommunities} { display: none !important; }`);
  const transform = TITLE_TRANSFORM[o.postTitleCapitalization ?? 'none'];
  if (transform) css.push(`${postTitleSelector()} { text-transform: ${transform}; }`);
  return css.join('\n');
}

/** RES postTitleCapitalization: CSS can do lower case and Title Case; it cannot do sentence case. */
const TITLE_TRANSFORM: Record<string, string | undefined> = {
  lowercase: 'lowercase',
  titlecase: 'capitalize',
};

/** Mark (or unmark) the long address links under `root`; returns how many are marked. */
export function markLongLinks(root: ParentNode, on: boolean): number {
  let n = 0;
  for (const a of bodyLinks(root)) {
    if (on && isLongAddress(a.textContent ?? '')) {
      a.setAttribute(TRUNCATE_ATTR, '');
      n++;
    } else if (a.hasAttribute(TRUNCATE_ATTR)) {
      a.removeAttribute(TRUNCATE_ATTR);
    }
  }
  return n;
}

export const styleTweaks = defineModule({
  id: 'styleTweaks',
  resId: 'styleTweaks',
  category: 'appearance',
  title: 'Style tweaks',
  description:
    'Small visual changes on Reddit’s own layout: colour the post links you have visited, draw a line above top-level comments, switch animations off, and hide Reddit’s “Suggested communities”. They only reach what is visible in the page itself; Reddit’s sealed components are left as they are.',
  enabledByDefault: true,
  options: {
    visitedLinks: {
      type: 'boolean',
      default: false,
      title: 'Colour visited post links',
      description:
        'Post titles you have already opened, where the browser reports them as visited.',
    },
    visitedColor: {
      type: 'color',
      default: '#8a5fb3',
      title: 'Visited link colour',
      dependsOn: 'visitedLinks',
    },
    topLevelSeparator: {
      type: 'boolean',
      default: false,
      title: 'Line above top-level comments',
    },
    separatorColor: {
      type: 'color',
      default: '#8b0000',
      title: 'Line colour',
      dependsOn: 'topLevelSeparator',
    },
    separatorSize: {
      type: 'number',
      default: 2,
      min: 1,
      max: 8,
      title: 'Line thickness (pixels)',
      dependsOn: 'topLevelSeparator',
    },
    reduceMotion: {
      type: 'boolean',
      default: false,
      title: 'Turn off animations',
      description:
        'Stops transitions and animations on the page itself, not inside Reddit’s sealed components.',
    },
    permanentVerticalScrollbar: {
      type: 'boolean',
      default: false,
      title: 'Always show the page scrollbar',
      description:
        'Keeps the scrollbar track in place so the page does not shift sideways when it grows past one screen. (RES had this on; here it is off until you choose it.)',
    },
    truncateLongLinks: {
      type: 'boolean',
      default: false,
      title: 'Shorten long addresses in posts and comments',
      description:
        'A link whose text is a long web address is cut short with “…”. The link still goes to the full address.',
    },
    postTitleCapitalization: {
      type: 'enum',
      default: 'none',
      title: 'Post title capitalisation',
      values: [
        { value: 'none', label: 'Leave titles as written' },
        { value: 'lowercase', label: 'all lowercase' },
        { value: 'titlecase', label: 'Title Case' },
      ],
      description:
        'Changes how titles look only (the text is not rewritten). RES’s “Sentence case” needs the text rewritten, so it is not offered.',
    },
    hideSuggestedCommunities: {
      type: 'boolean',
      default: false,
      title: 'Hide suggested communities',
      description:
        'Removes Reddit’s “Suggested communities” blocks from feeds, subreddits and thread pages. Turning this off brings them back at once.',
    },
  },

  init(ctx) {
    setStyle(STYLE_ID, tweaksCss(ctx.options));
    if (ctx.options.truncateLongLinks) markLongLinks(document, true);
  },

  onItems(batch, ctx) {
    if (!ctx.options.truncateLongLinks) return;
    for (const p of batch.posts) markLongLinks(p.source, true);
    for (const c of batch.comments) markLongLinks(c.source, true);
  },

  onSettings(ctx) {
    setStyle(STYLE_ID, tweaksCss(ctx.options));
    markLongLinks(document, Boolean(ctx.options.truncateLongLinks));
  },

  dispose() {
    removeStyle(STYLE_ID);
    markLongLinks(document, false);
  },
});
