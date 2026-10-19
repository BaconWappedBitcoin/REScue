/**
 * Inline media of a post (inlineMedia): finding the container, naming its type, and the CSS that
 * collapses it. The container is Reddit's `div[slot=post-media-container]`, a light-DOM child of
 * the post on listings and thread pages alike (research R20). REScue only ever hides the container
 * as a whole, through an attribute on the post and its own stylesheet; nothing inside it is read
 * for anything but a tag name and nothing inside it is changed.
 */
import { C } from '../contracts/reddit';
import type { Post } from './types';

export type MediaKind = 'image' | 'gallery' | 'video' | 'embed' | 'media';

/** Set on the post element while its media is collapsed; the stylesheet below keys on it. */
export const MEDIA_ATTR = 'data-rescue-media';
export const MEDIA_COLLAPSED = 'collapsed';

/** The post's own media container (a direct child), or null. */
export function mediaContainerOf(host: Element): Element | null {
  for (const child of host.children) if (child.matches(C.mediaContainer)) return child;
  return null;
}

/** The stylesheet that hides the container of every post marked collapsed. */
export function collapseCss(): string {
  return `${C.post}[${MEDIA_ATTR}="${MEDIA_COLLAPSED}"] > ${C.mediaContainer} { display: none !important; }`;
}

const FROM_MODEL: Record<string, MediaKind> = {
  image: 'image',
  gallery: 'gallery',
  video: 'video',
  gif: 'video',
  embed: 'embed',
};

/** What the container holds, from the tags Reddit puts in it (a tag name is all that is read). */
function kindFromContainer(container: Element): MediaKind {
  const inner = C.mediaInner;
  if (container.querySelector(inner.gallery)) return 'gallery';
  if (container.querySelector(inner.video)) return 'video';
  if (container.querySelector(inner.embed)) return 'embed';
  if (container.querySelector('img')) return 'image';
  return 'media';
}

/**
 * The media type of a post, or null when it has no inline media. The post model answers first
 * (`post-type` and the images it found); a link post with an embed falls back to the container.
 */
export function mediaKindOf(post: Post, container: Element | null): MediaKind | null {
  const fromMedia = post.media ? FROM_MODEL[post.media.kind] : undefined;
  if (fromMedia) return fromMedia;
  if (post.type === 'image' || post.type === 'gallery' || post.type === 'video') return post.type;
  return container ? kindFromContainer(container) : null;
}

/** How many pictures a gallery shows so far, or 0 when unknown or a single picture. */
export function galleryCount(post: Post): number {
  const n = post.media?.kind === 'gallery' ? post.media.items.length : 0;
  return n >= 2 ? n : 0;
}
