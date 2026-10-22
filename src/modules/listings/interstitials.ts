/**
 * Interstitials (FR-008). Age gate: REScue explains and offers Continue; Continue presses Reddit's
 * own confirmation, so it is the reader's action. Auto-confirm is opt-in. Login wall: optionally
 * removed; REScue never clicks log-in or sign-up controls.
 */
import { hint } from '../../core/hints';
import { defineModule, type ModuleContext } from '../../core/types';
import { findAgeGate, removeLoginWalls } from '../../model/interstitials';

async function confirmAge(ctx: ModuleContext): Promise<void> {
  const res = await ctx.bridge.request({ op: 'native.click', ref: '', control: 'over18' });
  if (!res.ok)
    ctx.notices.show(
      'REScue could not reach Reddit’s confirmation button. Use Reddit’s own prompt.',
      { kind: 'warning', id: 'age-gate-failed' },
    );
}

let cur: ModuleContext | null = null;
let ageHandled = false;
let mo: MutationObserver | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;
/** Looks at the page at most this often while it is busy (a thread loading thousands of comments). */
const SCAN_MS = 100;

/** Nothing left to look for: the age gate was answered and login walls are left alone. */
const done = (): boolean => ageHandled && cur?.options.removeLoginWall !== true;

/** After a burst of page changes, look once (the page is queried, not each change). */
function soon(): void {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    scan();
    if (done()) stop();
  }, SCAN_MS);
}

function scan(): void {
  const ctx = cur;
  if (!ctx) return;
  if (!ageHandled && findAgeGate()) {
    ageHandled = true;
    if (ctx.options.autoConfirmAgeGate) void confirmAge(ctx);
    else
      ctx.notices.show(
        'This community is marked 18+. Reddit asks you to confirm your age before showing it.',
        {
          id: 'age-gate',
          actions: [{ label: 'Continue', hint: hint.ageContinue, run: () => void confirmAge(ctx) }],
        },
      );
  }
  if (ctx.options.removeLoginWall) removeLoginWalls();
}

function stop(): void {
  mo?.disconnect();
  mo = null;
  if (timer) clearTimeout(timer);
  timer = null;
  if (pending) clearTimeout(pending);
  pending = null;
  document.removeEventListener('DOMContentLoaded', start);
}

/** Watch the page for a minute: interstitials appear early in a page view (or a route change). */
function start(): void {
  scan();
  if (done()) return;
  mo ??= new MutationObserver(soon);
  mo.observe(document.body, { childList: true, subtree: true });
  timer = setTimeout(stop, 60_000);
}

/** A new page view: look again from the start, for a prompt not yet explained. */
function watch(): void {
  stop();
  ageHandled = false;
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
}

export const interstitials = defineModule({
  id: 'interstitials',
  category: 'listings',
  title: 'Age gate & login wall',
  description:
    'Explains Reddit’s 18+ prompt and lets you continue in one click. Can also remove the login pop-up that blocks reading. REScue never logs you in or signs you up.',
  enabledByDefault: true,
  options: {
    autoConfirmAgeGate: {
      type: 'boolean',
      default: false,
      title: 'Confirm Reddit’s 18+ prompt automatically',
      description:
        'Only turn this on if you are 18 or older and want REScue to answer that prompt for you.',
    },
    removeLoginWall: {
      type: 'boolean',
      default: false,
      title: 'Remove the login pop-up that blocks reading',
    },
  },
  init(ctx) {
    cur = ctx;
    watch();
  },
  onRoute(_route, ctx) {
    // In-page navigation can reach another 18+ community: explain its prompt too.
    cur = ctx;
    watch();
  },
  dispose() {
    stop();
    cur = null;
  },
});
