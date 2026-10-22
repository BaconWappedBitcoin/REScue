/**
 * Keys that work on the SELECTED post's media (RES keyboardNav imageSizeUp, imageSizeDown,
 * imageSizeUpFine, imageSizeDownFine, imageSizeAnyHeight, imageMoveUp, imageMoveDown,
 * imageMoveLeft, imageMoveRight, previousGalleryImage, nextGalleryImage, toggleMuteVideo,
 * scrollOnGalleryNavigate).
 *
 * The size and move keys act on REScue's CSS for Reddit's media container (see sizing.ts), never on
 * anything inside Reddit's components, and decline (so Reddit's own handler or the page scroll keeps
 * the key) when the selected post has no visible media.
 *
 * The gallery and mute keys press Reddit's OWN controls instead: [ and ] step the post's gallery
 * carousel and m presses its player's mute button, through the bridge, the way a vote presses
 * Reddit's vote buttons. REScue never re-implements a carousel or a player. Each declines when the
 * selected post has no gallery or no video (mediaSteps.ts).
 *
 * Registered once per page: the dispatcher lives as long as the page, the handlers follow the
 * modules' current hosts.
 */
import type { KeysApi } from '../../../core/types';
import { MOVE_PX, STEP } from './sizing';

/** What the size and move keys work on; null while that module is off. */
export interface MediaKeyHost {
  /** Is there a selected post with visible media to act on? */
  ready(): boolean;
  resize(factor: number): void;
  fit(): void;
  move(dx: number, dy: number): void;
}

/** What the gallery and mute keys work on; null until a module supplies it (mediaSteps.ts). */
export interface MediaStepHost {
  /** Is the selected post's own gallery there to step through? */
  hasGallery(): boolean;
  /** Is the selected post's own video player there to mute? */
  hasVideo(): boolean;
  /** Press the selected post's own previous (-1) / next (1) gallery arrow. */
  gallery(dir: 1 | -1): void;
  /** Press the selected post's own mute button. */
  toggleMute(): void;
}

let keysOn: KeysApi | null = null;
let current: MediaKeyHost | null = null;
let steps: MediaStepHost | null = null;

export const setMediaKeyHost = (host: MediaKeyHost | null): void => {
  current = host;
};

export const setMediaStepHost = (host: MediaStepHost | null): void => {
  steps = host;
};

interface Spec {
  id: string;
  title: string;
  keys: string[];
  /** Whether the command applies now; without one, the selected post's visible media decides. */
  ready?(): boolean;
  /** false declines the key, letting Reddit's own handler or the page have it. */
  run(): void | boolean;
}

const SPECS: Spec[] = [
  {
    id: 'imageSizeUp',
    title: 'Make the selected post’s media larger',
    keys: ['='],
    run: () => current?.resize(STEP.coarse),
  },
  {
    id: 'imageSizeDown',
    title: 'Make the selected post’s media smaller',
    keys: ['-'],
    run: () => current?.resize(1 / STEP.coarse),
  },
  {
    id: 'imageSizeUpFine',
    title: 'Make the selected post’s media a little larger',
    // Shift is not part of a symbol key's name, so Shift+= arrives as "+".
    keys: ['+'],
    run: () => current?.resize(STEP.fine),
  },
  {
    id: 'imageSizeDownFine',
    title: 'Make the selected post’s media a little smaller',
    keys: ['_'],
    run: () => current?.resize(1 / STEP.fine),
  },
  {
    id: 'imageSizeAnyHeight',
    title:
      'Fit the selected post’s media to the full width, ignoring any height limit (again to undo)',
    keys: ['shift+arrowright'],
    run: () => current?.fit(),
  },
  {
    id: 'imageMoveUp',
    title: 'Move the selected post’s media up',
    keys: ['ctrl+arrowup'],
    run: () => current?.move(0, -MOVE_PX),
  },
  {
    id: 'imageMoveDown',
    title: 'Move the selected post’s media down',
    keys: ['ctrl+arrowdown'],
    run: () => current?.move(0, MOVE_PX),
  },
  {
    id: 'imageMoveLeft',
    title: 'Move the selected post’s media left',
    keys: ['ctrl+arrowleft'],
    run: () => current?.move(-MOVE_PX, 0),
  },
  {
    id: 'imageMoveRight',
    title: 'Move the selected post’s media right',
    keys: ['ctrl+arrowright'],
    run: () => current?.move(MOVE_PX, 0),
  },
  {
    id: 'previousGalleryImage',
    title: 'Show the previous picture of the selected post’s gallery',
    keys: ['['],
    ready: () => !!steps?.hasGallery(),
    run: () => {
      if (!steps?.hasGallery()) return false;
      steps.gallery(-1);
    },
  },
  {
    id: 'nextGalleryImage',
    title: 'Show the next picture of the selected post’s gallery',
    keys: [']'],
    ready: () => !!steps?.hasGallery(),
    run: () => {
      if (!steps?.hasGallery()) return false;
      steps.gallery(1);
    },
  },
  {
    id: 'toggleMuteVideo',
    title: 'Mute or unmute the selected post’s video',
    keys: ['m'],
    ready: () => !!steps?.hasVideo(),
    run: () => {
      if (!steps?.hasVideo()) return false;
      steps.toggleMute();
    },
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
      enabled: () => (spec.ready ?? (() => !!current?.ready()))(),
      run: () => spec.run() !== false,
    });
  }
}
