/**
 * The "everything is filtered" notice (RES Filterline.checkEmptyState, Filterline.js ~634-669 —
 * GPL-3.0, Copyright (C) the Reddit Enhancement Suite contributors, commit 4defffc). RES waits
 * three seconds before it speaks, so a feed that is still loading does not flash it; this waits
 * EMPTY_DELAY_MS and checks again. It stays until dismissed or acted on, and is not repeated for
 * the same state.
 */
import { hint } from '../../../core/hints';
import type { ModuleContext } from '../../../core/types';

const EMPTY_ID = 'filter-all-hidden';
/** How long a page must stay entirely filtered before the notice appears. */
export const EMPTY_DELAY_MS = 1000;

export interface EmptyActions {
  /** Reveal the filtered posts. */
  showFiltered(): void;
  /** Keep them out of view, but list each as a one-line placeholder naming its rule. */
  showReasons(): void;
}

export class EmptyNotice {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private shown = false;

  /** Look again shortly: `isAll` says whether every post on the page is hidden right now. */
  schedule(ctx: () => ModuleContext | null, isAll: () => boolean, actions: EmptyActions): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const c = ctx();
      if (!c) return;
      if (!isAll()) {
        this.dismiss(c);
        return;
      }
      if (this.shown) return;
      this.shown = true;
      c.notices.show('Every post on this page is filtered.', {
        id: EMPTY_ID,
        actions: [
          {
            label: 'Show filtered',
            hint: hint.showFiltered,
            run: () => {
              this.shown = false;
              actions.showFiltered();
            },
          },
          {
            label: 'Show reasons',
            hint: hint.showReasons,
            run: () => {
              this.shown = false;
              actions.showReasons();
            },
          },
        ],
      });
    }, EMPTY_DELAY_MS);
  }

  dismiss(ctx: ModuleContext | null): void {
    if (this.shown) ctx?.notices.dismiss(EMPTY_ID);
    this.shown = false;
  }

  clear(ctx: ModuleContext | null): void {
    clearTimeout(this.timer);
    this.dismiss(ctx);
  }
}
