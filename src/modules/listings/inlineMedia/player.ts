/**
 * Plain video player (RES hosts vreddit.forceReplaceNativeExpando): while it is on for a post,
 * Reddit's own `shreddit-player` is hidden and a REScue `<video controls>` plays the post's
 * packaged mp4 (read from the post's packaged-media JSON by model/media.ts, signed *.redd.it URL
 * with sound). It does not autoplay and a word under it brings Reddit's player back. RES's
 * minimumVideoBandwidth chose a DASH rendition; there is a single mp4 here, so it has no use.
 */
import { C } from '../../../contracts/reddit';
import { h } from '../../../core/dom';
import { hint } from '../../../core/hints';
import { expired } from '../../../model/media';
import type { Post } from '../../../model/types';

export const PLAYER_ATTR = 'data-rescue-player';
export const PLAYER_ON = 'on';
export const PLAYER_CLASS = 'rescue-player';

export function playerCss(): string {
  return `${C.post}[${PLAYER_ATTR}="${PLAYER_ON}"] > ${C.mediaContainer} ${C.mediaInner.video} { display: none !important; }`;
}

/** The mp4 to play: https, on a *.redd.it host, not expired; else null (Reddit's player stays). */
export function playableMp4(post: Post, now = Date.now()): string | null {
  const url = post.media?.mp4Url;
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/(^|\.)redd\.it$/i.test(u.hostname)) return null;
  } catch {
    return null;
  }
  return expired(url, now) ? null : url;
}

export function buildPlayer(mp4: string, onBack: () => void): HTMLElement {
  const video = h('video', {
    src: mp4,
    controls: true,
    playsinline: true,
    loop: true,
    preload: 'metadata',
    class: 'rescue-player-video',
  });
  video.style.cssText = 'display:block;max-width:100%;max-height:80vh;background:#000';
  const back = h('button', {
    type: 'button',
    class: 'rescue-film-word rescue-btn',
    title: hint.playerBack,
  });
  back.textContent = 'show Reddit’s player';
  back.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onBack();
  });
  return h('div', { class: PLAYER_CLASS }, video, back);
}
