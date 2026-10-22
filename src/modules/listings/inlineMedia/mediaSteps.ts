/**
 * What the gallery and mute keys act on (mediaKeys.ts): the SELECTED post's own gallery carousel
 * and video player. REScue presses Reddit's own arrows and mute button through the bridge, the way
 * a vote presses Reddit's vote buttons, so the carousel and the player stay Reddit's (constitution
 * Principle II: press Reddit, never re-implement it).
 *
 * A key that has nothing to press declines before anything is asked of Reddit, so [ ] and m keep
 * their normal meaning on a post without a gallery or without a video. scrollOnGalleryNavigate
 * (RES keyboardNav, on by default) brings the gallery on screen after a step, because the selected
 * post is often only half in view.
 */
import { hasVideo, type ActionResult, type ActionTarget } from '../../../core/actions';
import { C } from '../../../contracts/reddit';
import type { ModuleContext } from '../../../core/types';
import { TOP_MARGIN } from '../../../layout/native/selectionView';
import type { Post } from '../../../model/types';
import type { MediaStepHost } from './mediaKeys';

/**
 * Scroll only when the gallery is not fully on screen, and then keep it clear of Reddit's sticky
 * header (`nearest` alone left its top under the header: live 2026-10-21).
 */
function bringIntoView(gallery: Element): void {
  const r = gallery.getBoundingClientRect();
  if (r.top >= TOP_MARGIN && r.bottom <= window.innerHeight) return;
  window.scrollBy({ top: r.top - TOP_MARGIN, behavior: 'instant' });
}

/** The post the keys act on; null when a comment is selected or nothing is. */
const selectedPost = (ctx: ModuleContext): Post | null => {
  const item = ctx.ui.selection().current();
  return item?.kind === 'post' ? (item.model as Post) : null;
};

const targetOf = (post: Post): ActionTarget => ({ id: post.id, source: post.source });

/** The post's own gallery carousel, when the selected post has one (C.mediaControls). */
const galleryOf = (ctx: ModuleContext): { post: Post; gallery: Element } | null => {
  const post = selectedPost(ctx);
  const gallery = post ? post.source.querySelector(C.mediaControls.gallery) : null;
  return post && gallery ? { post, gallery } : null;
};

/** Reddit's control was not where the contracts say it is: say so rather than pretend it worked. */
function noteMissing(ctx: ModuleContext, what: string, r: ActionResult): void {
  if (r.ok) return;
  ctx.notices.show(`REScue could not find Reddit’s ${what} on the selected post.`, {
    id: 'media-step',
    kind: 'warning',
    timeoutMs: 6000,
  });
}

/**
 * `current` returns the module's LIVE context (null while it is off): a settings change brings a new
 * context with the new options, so the host must never keep the one it was made with.
 */
export function mediaStepHost(current: () => ModuleContext | null): MediaStepHost {
  return {
    hasGallery: () => {
      const ctx = current();
      return !!ctx && galleryOf(ctx) !== null;
    },

    hasVideo: () => {
      const ctx = current();
      const post = ctx ? selectedPost(ctx) : null;
      return !!post && hasVideo(post.source);
    },

    gallery(dir: 1 | -1) {
      const ctx = current();
      const found = ctx ? galleryOf(ctx) : null;
      if (!ctx || !found) return;
      void ctx.actions.galleryStep(targetOf(found.post), dir).then((r) => {
        noteMissing(ctx, 'gallery arrows', r);
        if (r.ok && ctx.options.scrollOnGalleryNavigate !== false) bringIntoView(found.gallery);
      });
    },

    toggleMute() {
      const ctx = current();
      const post = ctx ? selectedPost(ctx) : null;
      if (!ctx || !post || !hasVideo(post.source)) return;
      void ctx.actions.toggleMute(targetOf(post)).then((r) => noteMissing(ctx, 'mute button', r));
    },
  };
}
