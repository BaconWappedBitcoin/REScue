/**
 * userInfo (RES userInfo): hover a username for a moment and a small card shows who they are, when
 * they joined, their karma, and tag / ignore / highlight words. Reddit shows its own card only
 * for a post's author, and only on click; comment authors get none, and the Old Reddit look's post
 * author link gets none either. REScue asks Reddit's own same-origin user card for that name
 * (core/hovercards.ts, the request showKarma uses, cached half an hour) only after the pointer has
 * rested on the name for `hoverDelay` ms; nothing else is sent. Mouse only (touch and pen are
 * ignored), never over a comment or post body, Reddit's own card or a REScue popup. Ideas from RES
 * lib/modules/userInfo.js (GPL-3.0, the RES contributors, commit 4defffc); the code is new.
 */
import { HovercardService } from '../../core/hovercards';
import { isModuleEnabled } from '../../core/settings';
import { defineModule, type ModuleContext } from '../../core/types';
import { userInfoTarget, type UserLinkTarget } from '../../model/userInfoTarget';
import { isHighlighted, toggleHighlight } from './highlightList';
import { taggerApi } from './taggerApi';
import { userHighlight } from './userHighlight';
import { UserInfoCard, type CardControls } from './userInfoCard';

export const DEFAULT_HOVER_DELAY = 800;
export const DEFAULT_FADE_DELAY = 200;
const MAX_MS = 5000;

/** A delay in whole milliseconds, 0 to 5000; anything that is not a number gives `fallback`. */
export function cleanDelay(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  return Math.min(MAX_MS, Math.max(0, Math.round(n)));
}

interface Runtime {
  ctx: ModuleContext;
  service: HovercardService;
  hoverMs: number;
  fadeMs: number;
  highlightButton: boolean;
  postAuthors: boolean;
  card: UserInfoCard | null;
  pending: UserLinkTarget | null;
  showTimer: ReturnType<typeof setTimeout> | null;
  hideTimer: ReturnType<typeof setTimeout> | null;
  /** Bumped whenever the card changes, so a late answer for an old card is dropped. */
  token: number;
  stops: Array<() => void>;
}

let run: Runtime | null = null;

function readOptions(r: Runtime, ctx: ModuleContext): void {
  const o = ctx.options;
  r.ctx = ctx;
  r.hoverMs = cleanDelay(o.hoverDelay, DEFAULT_HOVER_DELAY);
  r.fadeMs = cleanDelay(o.fadeDelay, DEFAULT_FADE_DELAY);
  r.highlightButton = o.highlightButton !== false;
  r.postAuthors = o.postAuthors !== false;
}

const isMouse = (e: Event): boolean => (e as PointerEvent).pointerType === 'mouse';

function clearShow(r: Runtime): void {
  if (r.showTimer) clearTimeout(r.showTimer);
  r.showTimer = null;
  r.pending = null;
}

function cancelHide(r: Runtime): void {
  if (r.hideTimer) clearTimeout(r.hideTimer);
  r.hideTimer = null;
}

function closeCard(r: Runtime): void {
  cancelHide(r);
  r.token++;
  r.card?.remove();
  r.card = null;
}

/** Hide the card and forget a hover that has not fired yet. */
function closeAll(r: Runtime): void {
  clearShow(r);
  closeCard(r);
}

function scheduleHide(r: Runtime): void {
  cancelHide(r);
  r.hideTimer = setTimeout(() => closeCard(r), r.fadeMs);
}

function controlsFor(r: Runtime, user: string): CardControls {
  const { ctx } = r;
  const out: CardControls = {};
  if (taggerApi() && ctx.session?.username?.toLowerCase() !== user.toLowerCase()) {
    out.tag = (card) => {
      taggerApi()?.edit(user, card);
      closeAll(r);
    };
    out.ignore = {
      on: () => taggerApi()?.isIgnored(user) === true,
      toggle: () => taggerApi()?.toggleIgnore(user) ?? Promise.resolve(),
    };
  }
  if (r.highlightButton && isModuleEnabled(userHighlight, ctx.settings.profile())) {
    out.highlight = {
      on: () => isHighlighted(ctx, user),
      toggle: () => toggleHighlight(ctx, user),
    };
  }
  return out;
}

function open(r: Runtime, target: UserLinkTarget): void {
  clearShow(r);
  closeCard(r);
  if (!target.link.isConnected) return;
  const card = new UserInfoCard(target.user);
  r.card = card;
  document.body.append(card.root);
  const where = (): void => card.place(target.link.getBoundingClientRect());
  where();
  const mine = r.token;
  void r.service.user(target.user).then((result) => {
    if (mine !== r.token) return;
    card.show(result, controlsFor(r, target.user));
    where();
  });
}

function onOver(r: Runtime, e: Event): void {
  if (!isMouse(e) || !(e.target instanceof Element)) return;
  if (r.card?.contains(e.target)) return cancelHide(r);
  const target = userInfoTarget(e.target, r.postAuthors);
  if (!target) return;
  cancelHide(r);
  if (r.card?.user.toLowerCase() === target.user.toLowerCase()) return;
  if (r.pending?.link === target.link) return;
  clearShow(r);
  r.pending = target;
  r.showTimer = setTimeout(() => open(r, target), r.hoverMs);
}

function onOut(r: Runtime, e: Event): void {
  if (!isMouse(e) || !(e.target instanceof Element)) return;
  const to = (e as MouseEvent).relatedTarget;
  const into = to instanceof Node ? to : null;
  if (r.card?.contains(e.target)) {
    if (!r.card.contains(into)) scheduleHide(r);
    return;
  }
  const target = userInfoTarget(e.target, r.postAuthors);
  if (!target || (into && target.link.contains(into))) return;
  if (r.pending?.link === target.link) clearShow(r);
  if (r.card && !r.card.contains(into)) scheduleHide(r);
}

function start(ctx: ModuleContext): void {
  stop();
  const r: Runtime = {
    ctx,
    service: new HovercardService(),
    hoverMs: DEFAULT_HOVER_DELAY,
    fadeMs: DEFAULT_FADE_DELAY,
    highlightButton: true,
    postAuthors: true,
    card: null,
    pending: null,
    showTimer: null,
    hideTimer: null,
    token: 0,
    stops: [],
  };
  readOptions(r, ctx);
  const listen = (target: EventTarget, type: string, fn: (e: Event) => void): void => {
    target.addEventListener(type, fn, { capture: true, passive: true });
    r.stops.push(() => target.removeEventListener(type, fn, { capture: true }));
  };
  listen(document, 'pointerover', (e) => onOver(r, e));
  listen(document, 'pointerout', (e) => onOut(r, e));
  listen(document, 'keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape' && (r.card || r.pending)) closeAll(r);
  });
  // Any scroll (the page or a scrolling box) moves the link out from under the card.
  listen(window, 'scroll', () => {
    if (r.card || r.pending) closeAll(r);
  });
  run = r;
}

function stop(): void {
  const r = run;
  run = null;
  if (!r) return;
  closeAll(r);
  for (const s of r.stops) s();
}

export const userInfo = defineModule({
  id: 'userInfo',
  resId: 'userInfo',
  category: 'users',
  title: 'User info card',
  description:
    'Hover a username on a comment (or, in the Old Reddit look, on a post) for a moment and a small card shows when they joined, their post and comment karma, and “tag”, “ignore” and “highlight” words. The card is Reddit’s own user card for that name, asked for only after you have rested on the name long enough; nothing else is sent. Mouse only. Press Escape to close it.',
  enabledByDefault: true,
  options: {
    hoverDelay: {
      type: 'number',
      default: DEFAULT_HOVER_DELAY,
      min: 0,
      max: MAX_MS,
      title: 'Delay before the card opens (milliseconds)',
    },
    fadeDelay: {
      type: 'number',
      default: DEFAULT_FADE_DELAY,
      min: 0,
      max: MAX_MS,
      title: 'Delay before the card closes after the pointer leaves (milliseconds)',
    },
    highlightButton: {
      type: 'boolean',
      default: true,
      title: 'Show the “highlight” word',
      description:
        'Adds the user to (or removes them from) the highlighted users of User highlighting, which gives their name its own colour.',
    },
    postAuthors: {
      type: 'boolean',
      default: true,
      title: 'Also on post authors in the Old Reddit look',
      description:
        'Reddit’s own card does not open there. In Reddit’s normal layout a post author keeps Reddit’s card.',
    },
  },

  init(ctx) {
    start(ctx);
  },

  onSettings(ctx) {
    if (run) readOptions(run, ctx);
  },

  onRoute() {
    if (run) closeAll(run);
  },

  dispose() {
    stop();
  },
});
