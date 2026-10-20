/**
 * Shared pieces of the old Reddit look (oldRedditSkin): the attribute every rule is scoped by, the
 * option shape, and which routes the look covers. See oldSkin.ts.
 */
import { THEME_ATTR } from '../core/theme';
import type { Route } from '../core/types';

export const SKIN_ATTR = 'data-rescue-skin';
export const SKIN_VALUE = 'old';
/** Every rule starts here, so the stylesheet is inert while the attribute is absent. */
export const ROOT = `html[${SKIN_ATTR}="${SKIN_VALUE}"]`;
/** The same, while Reddit is in dark mode (REScue mirrors the page's theme in this attribute). */
export const DARK = `${ROOT}[${THEME_ATTR}="dark"]`;

export type ThumbnailSize = 'none' | 'small' | 'normal' | 'large';

export interface OldSkinOptions {
  thumbnails: ThumbnailSize | string;
  rankNumbers: boolean;
  hideLeftNav: boolean;
  hideBanner: boolean;
  /** Dark mode on pure black (OLED) instead of dark grey; on unless set to false. */
  darkBlack?: boolean;
}

export const THUMB_PX: Record<ThumbnailSize, number> = {
  none: 0,
  small: 50,
  normal: 70,
  large: 100,
};

/** Thumbnail width in pixels for an option value (an unknown value falls back to "normal"). */
export function thumbPx(size: string): number {
  return THUMB_PX[size as ThumbnailSize] ?? THUMB_PX.normal;
}

/** Feeds, search results and comment threads; profiles, settings and every other page are left alone. */
export function skinApplies(route: Route): boolean {
  switch (route.kind) {
    case 'front':
    case 'all':
    case 'popular':
    case 'subreddit':
    case 'customFeed':
    case 'search':
    case 'thread':
      return true;
    default:
      // Reddit's News feed is a listing like the others (a feed tab can lead there).
      return /^\/news\/?$/i.test(route.path);
  }
}

/**
 * Reddit's own vote, comment and share pills, made flat and small. They live in shadow roots, so the
 * only way in is the custom properties Reddit exposes: they inherit from the host element.
 */
export const PILL_VARS = `
  --size-button-sm-h: 20px;
  --color-button-secondary-background: transparent; --color-button-secondary-background-hover: transparent;
  --color-button-secondary-border: transparent; --color-button-secondary-text: var(--os-meta);
  --color-upvote-background: transparent; --color-upvote-background-hover: transparent; --color-upvote-onBackground: var(--os-up);
  --color-downvote-background: transparent; --color-downvote-background-hover: transparent; --color-downvote-onBackground: var(--os-down);
  --color-secondary-plain: var(--os-meta);`;

/** Prefixes every selector of a comma-separated list (`a, b` becomes `P a, P b`), with an optional suffix on each. */
export const scoped = (prefix: string, list: string, suffix = ''): string =>
  list
    .split(', ')
    .map((x) => `${prefix} ${x}${suffix}`)
    .join(', ');
