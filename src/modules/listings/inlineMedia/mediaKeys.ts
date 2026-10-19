/**
 * Keys that size and move the selected post's media (RES keyboardNav imageSizeUp, imageSizeDown,
 * imageSizeUpFine, imageSizeDownFine, imageSizeAnyHeight, imageMoveUp, imageMoveDown,
 * imageMoveLeft, imageMoveRight). They act on REScue's CSS for Reddit's media container (see
 * sizing.ts), never on anything inside Reddit's components, and decline (so Reddit's own handler or
 * the page scroll keeps the key) when the selected post has no visible media.
 *
 * Registered once per page: the dispatcher lives as long as the page, the handlers follow the
 * module's current host.
 */
import type { KeysApi } from '../../../core/types';
import { MOVE_PX, STEP } from './sizing';

/** What the viewer offers the keys; null while the module is off. */
export interface MediaKeyHost {
  /** Is there a selected post with visible media to act on? */
  ready(): boolean;
  resize(factor: number): void;
  fit(): void;
  move(dx: number, dy: number): void;
}

let keysOn: KeysApi | null = null;
let current: MediaKeyHost | null = null;

export const setMediaKeyHost = (host: MediaKeyHost | null): void => {
  current = host;
};

interface Spec {
  id: string;
  title: string;
  keys: string[];
  run(host: MediaKeyHost): void;
}

const SPECS: Spec[] = [
  {
    id: 'imageSizeUp',
    title: 'Make the selected post’s media larger',
    keys: ['='],
    run: (h) => h.resize(STEP.coarse),
  },
  {
    id: 'imageSizeDown',
    title: 'Make the selected post’s media smaller',
    keys: ['-'],
    run: (h) => h.resize(1 / STEP.coarse),
  },
  {
    id: 'imageSizeUpFine',
    title: 'Make the selected post’s media a little larger',
    // Shift is not part of a symbol key's name, so Shift+= arrives as "+".
    keys: ['+'],
    run: (h) => h.resize(STEP.fine),
  },
  {
    id: 'imageSizeDownFine',
    title: 'Make the selected post’s media a little smaller',
    keys: ['_'],
    run: (h) => h.resize(1 / STEP.fine),
  },
  {
    id: 'imageSizeAnyHeight',
    title:
      'Fit the selected post’s media to the full width, ignoring any height limit (again to undo)',
    keys: ['shift+arrowright'],
    run: (h) => h.fit(),
  },
  {
    id: 'imageMoveUp',
    title: 'Move the selected post’s media up',
    keys: ['ctrl+arrowup'],
    run: (h) => h.move(0, -MOVE_PX),
  },
  {
    id: 'imageMoveDown',
    title: 'Move the selected post’s media down',
    keys: ['ctrl+arrowdown'],
    run: (h) => h.move(0, MOVE_PX),
  },
  {
    id: 'imageMoveLeft',
    title: 'Move the selected post’s media left',
    keys: ['ctrl+arrowleft'],
    run: (h) => h.move(-MOVE_PX, 0),
  },
  {
    id: 'imageMoveRight',
    title: 'Move the selected post’s media right',
    keys: ['ctrl+arrowright'],
    run: (h) => h.move(MOVE_PX, 0),
  },
];

export function registerMediaKeys(keys: KeysApi): void {
  if (keysOn === keys) return;
  keysOn = keys;
  for (const spec of SPECS) {
    keys.register({
      id: spec.id,
      title: spec.title,
      defaultKeys: spec.keys,
      section: 'Media',
      enabled: () => !!current?.ready(),
      run: () => {
        if (!current?.ready()) return false;
        spec.run(current);
      },
    });
  }
}
