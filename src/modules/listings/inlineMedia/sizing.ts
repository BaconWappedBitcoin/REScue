/**
 * Media sizing (RES showImages maxWidth, maxHeight, selfTextMaxHeight, commentMaxHeight,
 * autoMaxHeight, displayOriginalResolution; keyboardNav imageSizeUp / imageMoveUp ...): pure
 * functions for the sizes and the stylesheet. Everything is applied to Reddit's own light-DOM media
 * container (`div[slot=post-media-container]`) and to the post and comment body slots by REScue's
 * stylesheet keyed on attributes REScue puts on the post; nothing inside a shadow root is touched.
 */
import { C } from '../../../contracts/reddit';
import type { Post } from '../../../model/types';

/** Set on a post whose media size or position you changed with the keys. */
export const SIZE_ATTR = 'data-rescue-msize';
/** Set on a post whose media width/height ratio is known (so a height limit can become a width). */
export const RATIO_ATTR = 'data-rescue-mratio';

export const VAR_W = '--rescue-media-w';
export const VAR_DX = '--rescue-media-dx';
export const VAR_DY = '--rescue-media-dy';
export const VAR_RATIO = '--rescue-media-ar';

const LIMIT = /^(\d+(?:\.\d+)?)\s*(px|%|vh)?$/i;
const MAX_LIMIT = 20000;

/**
 * A size limit as a CSS length, or null for “no limit”. Accepts `600`, `600px`, `80%`, `80vh`; a
 * percentage means a share of the page width for widths and of the window height for heights
 * (as in RES). 0, empty or anything unreadable means no limit.
 */
export function parseLimit(raw: unknown, axis: 'w' | 'h'): string | null {
  const m = LIMIT.exec(String(raw ?? '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n > 0) || n > MAX_LIMIT) return null;
  const unit = (m[2] ?? 'px').toLowerCase();
  if (unit === '%') return axis === 'w' ? `${n}%` : `${Math.min(n, 100)}vh`;
  return `${n}${unit}`;
}

export interface SizingOptions {
  maxWidth: string;
  maxHeight: string;
  selfTextMaxHeight: string;
  commentMaxHeight: string;
  autoMaxHeight: boolean;
}

/** The cap for a text body: the setting, else (with “auto”) most of the window, else none. */
export function textCap(raw: string, auto: boolean): string | null {
  return parseLimit(raw, 'h') ?? (auto ? '80vh' : null);
}

export function sizingCss(o: SizingOptions): string {
  const post = C.post;
  const box = C.mediaContainer;
  const rules: string[] = [];
  const w = parseLimit(o.maxWidth, 'w');
  const h = parseLimit(o.maxHeight, 'h');
  if (w && w !== '100%')
    rules.push(`${post} > ${box} { max-width: ${w}; box-sizing: border-box; }`);
  if (h) {
    const byHeight = `calc(${h} * var(${VAR_RATIO}))`;
    const cap = w && w !== '100%' ? `min(${w}, ${byHeight})` : byHeight;
    rules.push(`${post}[${RATIO_ATTR}] > ${box} { max-width: ${cap}; box-sizing: border-box; }`);
  }
  // Sizes and moves you made with the keys win over the limits above.
  rules.push(
    `${post}[${SIZE_ATTR}] > ${box} { width: var(${VAR_W}, auto) !important; max-width: none !important; max-height: none !important; transform: translate(var(${VAR_DX}, 0px), var(${VAR_DY}, 0px)); position: relative; z-index: 2; }`,
  );
  const body = textCap(o.selfTextMaxHeight, o.autoMaxHeight);
  if (body) rules.push(`${C.postBody} { max-height: ${body}; overflow-y: auto; }`);
  const comment = textCap(o.commentMaxHeight, o.autoMaxHeight);
  if (comment) rules.push(`${C.commentBody} { max-height: ${comment}; overflow-y: auto; }`);
  return rules.join('\n');
}

/** The pictures Reddit drew in a post's media container (light DOM), in order. */
export const pictureElements = (box: Element | null): HTMLImageElement[] =>
  box ? [...box.querySelectorAll('img')] : [];

const loaded = (img: HTMLImageElement): boolean => img.naturalWidth > 0 && img.naturalHeight > 0;

/**
 * Width over height of a post's single picture, from the model when Reddit gave both sizes, else
 * from the first picture in the container once it has loaded. Galleries and embeds have none.
 */
export function ratioOf(post: Post, box: Element | null = null): number | null {
  const m = post.media;
  if (m && (m.kind === 'gallery' || m.kind === 'embed')) return null;
  const item = m?.items[0];
  if (item?.width && item.height) return item.width / item.height;
  const img = pictureElements(box).find(loaded);
  return img ? img.naturalWidth / img.naturalHeight : null;
}

/**
 * “1920 × 1080” for a single picture: the pixels of a loaded original-file picture (i.redd.it),
 * else the original size Reddit lists for the post (`known`, from the thread JSON; see
 * originalSizes.ts). Resized previews would show the wrong size, so they are never measured.
 */
export function resolutionOf(
  post: Post,
  box: Element | null,
  known: readonly [number, number] | null = null,
): string | null {
  if (post.media?.kind !== 'image') return null;
  const img = pictureElements(box).find(
    (i) => loaded(i) && C.originalHost.test(hostOf(i.currentSrc || i.src)),
  );
  if (img) return `${img.naturalWidth} × ${img.naturalHeight}`;
  return known ? `${known[0]} × ${known[1]}` : null;
}

function hostOf(src: string): string {
  try {
    return new URL(src).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** What the size keys do to a post's media. */
export interface SizeState {
  /** Width in px, or 'fit' for the full width of the column ignoring any height limit. */
  width: number | 'fit';
  dx: number;
  dy: number;
}

export const STEP = { coarse: 1.2, fine: 1.05 } as const;
export const MOVE_PX = 40;
const MIN_W = 80;

/** The width after one size step (px). `factor` > 1 grows, < 1 shrinks. Never below 80 px. */
export function steppedWidth(current: number, factor: number): number {
  return Math.max(MIN_W, Math.round(current * factor));
}
