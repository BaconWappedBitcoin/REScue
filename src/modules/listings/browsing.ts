/**
 * wheelBrowse and singleClick (US3). neverEndingReddit is Built-in: Reddit loads more posts itself.
 * Ported in spirit from RES lib/modules/wheelBrowse.js and singleClick.js (GPL-3.0, the RES
 * contributors, commit 4defffc); the code is new.
 */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import { openTabs, webUrl } from '../../core/tabs';
import { defineModule } from '../../core/types';
import type { Post } from '../../model/types';

const PAD_ID = 'rescue-wheelbrowse';
/** One step per wheel notch, not per pixel of a trackpad swipe. */
const WHEEL_STEP_MS = 120;

/**
 * wheelBrowse (RES): scroll the mouse wheel over a small REScue control to move the selection.
 * Only the control reacts; scrolling anywhere else on the page is left to the browser.
 */
export const wheelBrowse = defineModule({
  id: 'wheelBrowse',
  resId: 'wheelBrowse',
  category: 'listings',
  title: 'Wheel browse',
  description:
    'A small control in the corner of the page: scroll the mouse wheel over it to move to the next or previous post or comment. Scrolling anywhere else is unchanged.',
  enabledByDefault: false,
  options: {},
  init(ctx) {
    const pad = h(
      'div',
      {
        id: PAD_ID,
        class: 'rescue-overlay',
        title: hint.wheelPad,
        role: 'presentation',
      },
      label.wheel,
    );
    pad.style.cssText =
      'position:fixed;right:12px;top:50%;margin-top:-32px;z-index:2147483640;width:40px;height:64px;display:flex;align-items:center;justify-content:center;border:1px solid var(--rescue-border,#ccc);border-radius:20px;background:var(--rescue-bg,#fff);color:var(--rescue-meta,#666);cursor:ns-resize;user-select:none;font-size:11px';
    let last = -Infinity;
    pad.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const now = performance.now();
        if (now - last < WHEEL_STEP_MS) return;
        last = now;
        if (e.deltaY !== 0) ctx.ui.selection().move(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );
    document.body.appendChild(pad);
  },
  dispose() {
    document.getElementById(PAD_ID)?.remove();
  },
});

/**
 * The URLs a post's [l+c] control opens, in order: its link and its comments (comments first by
 * option). A text post's "link" is its comments page, so it has the comments only ("[l=c]"), plus
 * the subreddit's front page when asked. Null when nothing would open or the control is hidden
 * (RES hides [l=c] unless hideLEC is off).
 */
export function singleClickTargets(
  p: Post,
  opts: { commentsFirst: boolean; hideLEC: boolean; openFrontpage: boolean },
): { urls: string[]; label: string } | null {
  const comments = webUrl(p.permalink);
  if (!comments) return null;
  const link = p.url ? webUrl(p.url) : null;
  if (p.url && !link) return null;
  const urls = new Set<string>();
  if (link) urls.add(link);
  urls.add(comments);
  if (!link && !opts.hideLEC && opts.openFrontpage) {
    const front = webUrl(`/r/${encodeURIComponent(p.subreddit)}/`);
    if (front && p.subreddit) urls.add(front);
  }
  const ordered = [...urls];
  if (opts.commentsFirst) ordered.reverse();
  // The comments page is what the control links to, whichever order the tabs open in.
  if (ordered.length === 1 && opts.hideLEC) return null;
  return { urls: ordered.slice(0, 2), label: ordered.length === 1 ? '[l=c]' : '[l+c]' };
}

/** singleClick (RES): an "[l+c]" control that opens a post's link and its comments together. */
export const singleClick = defineModule({
  id: 'singleClick',
  resId: 'singleClick',
  category: 'listings',
  title: 'Single click opener',
  description:
    'Adds an [l+c] control to link posts, in the post’s credit bar, that opens the link and its comments in new tabs at once. Middle-click or Ctrl-click opens both in background tabs. Text posts get an [l=c] control (comments only) when “Hide [l=c]” is turned off.',
  enabledByDefault: true,
  options: {
    commentsFirst: {
      type: 'boolean',
      default: true,
      title: 'Open the comments first, then the link',
      description: 'Off opens the link first. The first tab opened is the one that is focused.',
    },
    background: { type: 'boolean', default: false, title: 'Open them in background tabs' },
    hideLEC: {
      type: 'boolean',
      default: true,
      title: 'Hide [l=c] on text posts',
      description:
        'Off adds [l=c] to text posts, where the link and the comments are the same page.',
      advanced: true,
    },
    openFrontpage: {
      type: 'boolean',
      default: false,
      title: 'Open the subreddit’s front page too',
      description:
        'On text posts, [l=c] becomes [l+c] and also opens the subreddit. Needs [l=c] to be shown.',
      advanced: true,
    },
  },
  onItems(batch, ctx) {
    // On a post's own page the comments are already open.
    if (ctx.route.kind === 'thread') return;
    const opts = {
      commentsFirst: Boolean(ctx.options.commentsFirst),
      hideLEC: Boolean(ctx.options.hideLEC),
      openFrontpage: Boolean(ctx.options.openFrontpage),
    };
    for (const p of batch.posts) {
      const target = singleClickTargets(p, opts);
      if (!target) continue;
      const comments = webUrl(p.permalink)!;
      const btn = h(
        'a',
        {
          href: comments,
          class: 'rescue-single-click rescue-btn',
          title: hint.singleClick(target.urls.length !== 1),
        },
        target.label,
      );
      const open = (e: MouseEvent, background: boolean) => {
        // Reddit's post card navigates on click; this control must not (nor open a stray tab).
        e.preventDefault();
        e.stopPropagation();
        openTabs(target.urls, !background);
      };
      btn.addEventListener('click', (e) => {
        if (e.button !== 0) return;
        open(e, Boolean(ctx.options.background) || e.ctrlKey || e.metaKey);
      });
      btn.addEventListener('auxclick', (e) => {
        if (e.button === 1) open(e, true);
        else e.preventDefault();
      });
      ctx.ui.decorate(p, 'tagline', btn);
    }
  },
});
