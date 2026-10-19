/**
 * Shared ignore/unignore button used by comments and posts. Kept separate so userTagger.ts stays
 * under the 500-line project limit and so both item kinds reuse the same control class/hint.
 */
import { rescueButton } from '../../core/buttons';
import { hint, label } from '../../core/hints';

/** Build an ignore/unignore button for `author`. The caller decides when it appears. */
export function ignoreButton(
  author: string,
  ignored: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const btn = rescueButton(
    'rescue-ignore-user',
    ignored ? label.unignore : label.ignore,
    hint.ignoreUser(author, ignored),
  );
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return btn;
}
