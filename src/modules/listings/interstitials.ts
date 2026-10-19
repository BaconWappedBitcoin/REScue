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
    let ageHandled = false;
    const scan = () => {
      if (!ageHandled && findAgeGate()) {
        ageHandled = true;
        if (ctx.options.autoConfirmAgeGate) void confirmAge(ctx);
        else
          ctx.notices.show(
            'This community is marked 18+. Reddit asks you to confirm your age before showing it.',
            {
              id: 'age-gate',
              actions: [
                { label: 'Continue', hint: hint.ageContinue, run: () => void confirmAge(ctx) },
              ],
            },
          );
      }
      if (ctx.options.removeLoginWall) removeLoginWalls();
    };
    const mo = new MutationObserver(scan);
    const start = () => {
      scan();
      mo.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => mo.disconnect(), 60_000); // interstitials appear early; stop watching after a minute
    };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  },
});
