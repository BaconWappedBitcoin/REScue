/**
 * keyboardNav additions: the “f” key opens REScue's command line with `filter ` already typed (RES
 * keyboardNav enterFilterCommandLine), and “n” clicks the selected comment's own “N more replies”
 * button (RES neverEndingComments loadChildComments; RES did this from toggleChildren on Enter, but
 * REScue's Enter on a comment collapses it). The key is registered only while a comment with such a
 * control is selected, so Reddit keeps “n” everywhere else. The command line module itself is not
 * changed; when it is switched off the “f” key does nothing and Reddit keeps it.
 */
import { defineModule, type ModuleContext } from '../../core/types';
import type { Comment } from '../../model/types';
import { ownMoreRepliesControl } from '../../model/commentRow';

const INPUT = 'input[data-rescue-input][aria-label="REScue command"]';
export const FILTER_PREFIX = 'filter ';

let registeredOn: ModuleContext['keys'] | null = null;

/** Open the command line prefilled with the filter command. False when it did not open. */
export function openFilterCommandLine(ctx: ModuleContext): boolean {
  if (!ctx.keys.run('toggleCmdLine')) return false;
  const input = document.querySelector<HTMLInputElement>(INPUT);
  if (!input) return false;
  input.value = FILTER_PREFIX;
  input.setSelectionRange(FILTER_PREFIX.length, FILTER_PREFIX.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

/** The selected comment's own “N more replies” control, or null (a post selected, or no control). */
export function selectedMoreReplies(ctx: ModuleContext): HTMLElement | null {
  const sel = ctx.ui.selection().current();
  if (!sel || sel.kind !== 'comment') return null;
  return ownMoreRepliesControl((sel.model as Comment).source);
}

export const keyboardNavExtras = defineModule({
  id: 'keyboardNavExtras',
  resId: 'keyboardNav',
  category: 'listings',
  title: 'Keyboard: filter command line, load more replies',
  description:
    'Press F to open the command line with “filter ” typed in, ready for a filter command (needs the command line module). Press N on a selected comment to load its own “more replies” (Reddit loads them lazily; RES used Enter, which REScue keeps for collapsing).',
  enabledByDefault: true,
  options: {},
  init(ctx) {
    if (registeredOn === ctx.keys) return;
    registeredOn = ctx.keys;
    ctx.keys.register({
      id: 'enterFilterCommandLine',
      title: 'Open the command line with the filter command',
      defaultKeys: ['f'],
      section: 'Open',
      run: () => openFilterCommandLine(ctx),
    });
    ctx.keys.register({
      id: 'loadChildComments',
      title: 'Load the selected comment’s more replies',
      defaultKeys: ['n'],
      context: 'comments',
      section: 'Comments',
      enabled: () => selectedMoreReplies(ctx) !== null,
      run: () => {
        const control = selectedMoreReplies(ctx);
        if (!control) return false;
        control.click();
        return true;
      },
    });
  },
});
