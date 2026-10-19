/**
 * autoHide (RES autoHide, US6): hide posts you have already seen from the feeds you browse. Off by
 * default. Two modes, switchable. "Opened" means readComments holds a ReadRecord for the thread, so
 * only threads opened on this device while Read comments was on count. "Seen" (RES
 * mustBeVisibleDuration) hides posts that were ON SCREEN for at least N ms in an earlier page view:
 * an IntersectionObserver times each post and the ids are kept in this module's local store; they
 * are used from the next page view on, never while you are still reading the page. Hidden posts are
 * listed in a small notice with a way to show them again. Ported in spirit from RES
 * lib/modules/autoHide.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import { defineModule, type ModuleContext } from '../../core/types';
import { onClick, panel } from '../comments/commentUi';
import { sharedReadStore } from '../comments/readTracking';

export const AUTO_HIDE_REASON = 'autoHide';
const SEEN_KEY = 'seen';
const MAX_SEEN = 3000;
const ID_ATTR = 'data-rescue-post-id';
const FEEDS = new Set(['front', 'all', 'popular', 'subreddit', 'customFeed']);

interface Banner {
  el: HTMLElement;
  text: HTMLElement;
  toggle: HTMLButtonElement;
  added: boolean;
}

let banner: Banner | null = null;
let hidden = new Set<string>();
let revealing = false;
/** Posts seen on screen long enough before this page view (hidden), and during it (kept). */
let known: Record<string, number> = {};
let fresh: Record<string, number> = {};
let observer: IntersectionObserver | null = null;
let timers = new Map<Element, ReturnType<typeof setTimeout>>();

const mode = (ctx: ModuleContext): string => String(ctx.options.mode);
const usesOpened = (ctx: ModuleContext): boolean => mode(ctx) !== 'seen';
const usesSeen = (ctx: ModuleContext): boolean => mode(ctx) !== 'opened';

function stopWatching(): void {
  observer?.disconnect();
  observer = null;
  for (const t of timers.values()) clearTimeout(t);
  timers = new Map();
}

/**
 * Also hide the post through Reddit's own menu (the account-side hide). Failures are reported once
 * under one notice id, never per post; a signed-out reader is not nagged (the local hide stands).
 */
async function hideOnReddit(
  ctx: ModuleContext,
  post: { id: string; source: Element },
): Promise<void> {
  // Pressing Reddit's menu is a click inside the post, which would select it; keep the reader's own.
  const keep = ctx.ui.selection().current();
  const r = await ctx.actions.hide({ id: post.id, source: post.source }, true);
  if (keep && keep.host.isConnected) ctx.ui.selection().select(keep.id, { scroll: false });
  else if (!keep) ctx.ui.selection().clear();
  if (!r.ok && r.reason !== 'signed-out') {
    ctx.notices.show('REScue could not hide one of these posts on Reddit.', {
      id: 'autohide-reddit',
      kind: 'warning',
      timeoutMs: 6000,
    });
  }
}

/** Keep the newest ids only, so the local store stays small. */
function trimSeen(map: Record<string, number>): Record<string, number> {
  const entries = Object.entries(map);
  if (entries.length <= MAX_SEEN) return map;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_SEEN));
}

/** Time posts on screen; one seen for the set duration is recorded for later visits. */
function watchPosts(ctx: ModuleContext, posts: Array<{ id: string; source: Element }>): void {
  if (typeof IntersectionObserver === 'undefined') return;
  const duration = Math.max(0, Number(ctx.options.mustBeVisibleDuration) || 0);
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const { target, isIntersecting } of entries) {
        const pending = timers.get(target);
        if (!isIntersecting) {
          if (pending) clearTimeout(pending);
          timers.delete(target);
        } else if (!pending) {
          timers.set(
            target,
            setTimeout(() => {
              timers.delete(target);
              const id = target.getAttribute(ID_ATTR);
              if (!id) return;
              fresh = trimSeen({ ...fresh, [id]: Date.now() });
              ctx.store.set(SEEN_KEY, trimSeen({ ...known, ...fresh }));
              observer?.unobserve(target);
            }, duration),
          );
        }
      }
    },
    { threshold: [0], rootMargin: '0px 0px -30px 0px' },
  );
  for (const p of posts) {
    p.source.setAttribute(ID_ATTR, p.id);
    observer.observe(p.source);
  }
}

export const autoHide = defineModule({
  id: 'autoHide',
  resId: 'autoHide',
  category: 'listings',
  title: 'Auto-hide read posts',
  description:
    'Hides posts you have already dealt with from feeds (front page, subreddits, /r/all, custom feeds): posts you opened, using the history kept by “Read comments”, and/or posts that stayed on screen for a while in an earlier visit. Posts are only hidden on this device and can be shown again from the notice. Threads you opened before turning Read comments on are not known.',
  enabledByDefault: false,
  dependsOn: ['readComments'],
  options: {
    mode: {
      type: 'enum',
      default: 'opened',
      title: 'Hide posts that I have…',
      values: [
        { value: 'opened', label: 'opened (read the comments)' },
        { value: 'seen', label: 'seen on screen for a while (on a later visit)' },
        { value: 'both', label: 'opened or seen' },
      ],
    },
    mustBeVisibleDuration: {
      type: 'number',
      default: 2000,
      min: 0,
      max: 60000,
      title: 'Milliseconds on screen before a post counts as seen',
      dependsOn: 'mode',
    },
    showNotice: { type: 'boolean', default: true, title: 'Show how many posts were hidden' },
    hideOnReddit: {
      type: 'boolean',
      default: false,
      title: 'Also hide on Reddit (your account, syncs across devices)',
      description:
        'Hides each auto-hidden post through Reddit’s own Hide, so it stays hidden everywhere you sign in, not just on this device. Needs you to be signed in to Reddit.',
    },
  },

  async init(ctx) {
    hidden = new Set();
    revealing = false;
    stopWatching();
    fresh = {};
    known = usesSeen(ctx) ? ((await ctx.store.get<Record<string, number>>(SEEN_KEY)) ?? {}) : {};
    if (!ctx.options.showNotice) {
      banner = null;
      return;
    }
    const text = h('span', { class: 'rescue-autohide-count', title: hint.autoHideCount });
    const toggle = h(
      'button',
      {
        type: 'button',
        class: 'rescue-autohide-toggle rescue-btn',
        title: hint.autoHideToggle(false),
      },
      'show',
    );
    const el = panel(
      h(
        'div',
        { class: 'rescue-autohide-banner', role: 'status', hidden: true },
        text,
        ' · ',
        toggle,
      ),
    );
    banner = { el, text, toggle, added: false };
    onClick(toggle, () => {
      revealing = !revealing;
      ctx.ui.setRevealHidden(revealing);
      toggle.textContent = revealing ? 'hide' : 'show';
      toggle.title = hint.autoHideToggle(revealing);
    });
  },

  onItems(batch, ctx) {
    const store = usesOpened(ctx) ? sharedReadStore() : null;
    if ((usesOpened(ctx) && !store) || !FEEDS.has(ctx.route.kind)) return;
    if (usesSeen(ctx)) watchPosts(ctx, batch.posts);
    for (const p of batch.posts) {
      if (!(store?.hasRead(p.id) || (usesSeen(ctx) && p.id in known))) continue;
      ctx.ui.hide(p, AUTO_HIDE_REASON);
      hidden.add(p.id);
      if (ctx.options.hideOnReddit) void hideOnReddit(ctx, p);
    }
    if (!banner) return;
    banner.text.textContent =
      hidden.size === 1 ? '1 read post hidden' : `${hidden.size} read posts hidden`;
    banner.el.hidden = hidden.size === 0;
    if (hidden.size && !banner.added) {
      banner.added = true;
      ctx.ui.addBanner(banner.el);
    }
  },

  onRoute() {
    // Posts seen during this visit count as seen from the next page on.
    known = { ...known, ...fresh };
    fresh = {};
    stopWatching();
    hidden = new Set();
    if (banner) banner.el.hidden = true;
  },

  dispose() {
    stopWatching();
    banner?.el.remove();
    banner = null;
    hidden = new Set();
  },
});
