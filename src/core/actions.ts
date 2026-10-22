/**
 * ActionApi (contracts/module-api.md, research R10, constitution Principle V): signed-in actions are
 * delegated to Reddit's OWN controls through the MAIN-world bridge, and `ok: true` is returned only
 * after the confirming page state is observed. REScue never holds credentials and never calls
 * Reddit's APIs directly.
 *
 * Votes: the target state (up / none / down) is read from the native buttons' pressed state; the
 * matching button is pressed; success is reported only once the state reads back as requested.
 * Signed out, nothing is clicked at all (clicking would only open Reddit's sign-in prompt).
 *
 * Comments vote the same way (R20): the bridge looks only inside the comment's OWN action row, and a
 * vote is confirmed from the buttons' aria-pressed only: the row's `vote-state` attribute is stale
 * until a reload (seen live). A comment's row hydrates lazily, so the bridge scrolls it into view and
 * waits.
 *
 * startReply / startEdit press Reddit's own Reply button (or the Edit item of the comment's overflow
 * menu) and succeed only once Reddit's reply box exists and holds the focus. REScue never types in it.
 *
 * save / hide (this lane): the reader's own Save and Hide controls live in the item's overflow menu,
 * so the bridge opens that menu, finds the row by its TEXT and presses it. The row's text is read
 * first (Save vs Unsave, Hide vs Unhide) so a key press toggles rather than guessing, and success is
 * confirmed by re-reading that text. Hide leaves the post (Reddit removes it or marks it hidden), so
 * a hide is confirmed by the post leaving the page instead. FAILS SAFE: no matching text, no click.
 *
 * reply(markdown) is not delegated yet: Reddit's composer has not been exercised with typed text on
 * a fixture page. It answers `not-found` honestly rather than guessing (Principle II).
 *
 * Media keys (this lane): galleryStep / toggleMute press the SELECTED POST's own gallery arrows and
 * video mute button — Reddit's own controls, never a re-implementation of the carousel or player
 * (verified live 2026-10-21; the bridge scopes them to that post's own carousel / player). They are
 * not account actions, so they are pressed signed out as well, and `ok` means only that Reddit's
 * own control was pressed and found where the contracts say it lives.
 */
import { C } from '../contracts/reddit';
import type { BridgeApi } from './types';
import {
  NOT_FOCUSED,
  type MenuItemKind,
  type MenuKind,
  type NativeControl,
} from './bridge-protocol';
import type { Session } from '../model/types';

export type ActionFailure = 'signed-out' | 'not-found' | 'timeout' | 'rejected';
export type ActionResult = { ok: true } | { ok: false; reason: ActionFailure; detail?: string };

/** -1 down, 0 none, 1 up; null when Reddit's controls do not expose a readable state. */
export type VoteState = -1 | 0 | 1 | null;

/** Whether Reddit's own menu row reads as already saved / hidden, or null when unreadable. */
export type MenuState = 'on' | 'off' | null;

/**
 * Why a composer op (composer.insert / insertAt) wrote nothing, in plain words for the warning the
 * caller shows; '' when there is nothing more specific to say than "it did not take the text".
 */
export function composerProblem(error: string | undefined): string {
  if (error === NOT_FOCUSED) {
    return 'Reddit’s comment box did not take the focus, so nothing was typed (no other box was changed).';
  }
  if (error === 'bad-request') return 'The text is too long for REScue to put in.';
  return '';
}

export interface ActionTarget {
  id: string;
  /** The item's host element (shreddit-post / shreddit-comment). */
  source: Element;
}

/**
 * Fast local checks for the media keys, so a key can decline without a bridge round trip: does the
 * post's light DOM hold a gallery carousel / a video player to act on (C.mediaControls, verified
 * live 2026-10-21)? A post without one keeps the key's normal meaning.
 */
export const hasGallery = (el: Element): boolean => !!el.querySelector(C.mediaControls.gallery);
export const hasVideo = (el: Element): boolean => !!el.querySelector(C.mediaControls.player);

export interface ActionApi {
  voteState(target: ActionTarget): Promise<VoteState>;
  vote(target: ActionTarget, dir: -1 | 0 | 1): Promise<ActionResult>;
  save(target: ActionTarget, on: boolean): Promise<ActionResult>;
  hide(target: ActionTarget, on: boolean): Promise<ActionResult>;
  /** Whether Reddit's own Save row reads as already applied (null when unreadable). */
  saveState(target: ActionTarget): Promise<MenuState>;
  /** Your own post's or comment's reply notifications on or off, through Reddit's own menu row. */
  inboxReplies(target: ActionTarget, on: boolean): Promise<ActionResult>;
  /** Whether Reddit's menu says reply notifications are on; null when the row cannot be read. */
  inboxRepliesState(target: ActionTarget): Promise<MenuState>;
  /** Press the Delete row of your own item's menu; Reddit then asks for confirmation itself. */
  delete(target: ActionTarget): Promise<ActionResult>;
  /** Whether Reddit's own Hide row reads as already applied (null when unreadable). */
  hideState(target: ActionTarget): Promise<MenuState>;
  reply(target: ActionTarget, markdown: string): Promise<ActionResult>;
  /** Open Reddit's reply box under a comment and focus it. */
  startReply(target: ActionTarget): Promise<ActionResult>;
  /** Open Reddit's editor on one of the user's own comments and focus it. */
  startEdit(target: ActionTarget): Promise<ActionResult>;
  /**
   * Press the Report row of the item's own overflow menu. Success means only that Reddit's menu row
   * was pressed (Reddit then opens its own report dialog); nothing is sent by REScue.
   */
  report(target: ActionTarget): Promise<ActionResult>;
  /** Press a post's own Share button (Reddit opens its own share menu). Posts only. */
  share(target: ActionTarget): Promise<ActionResult>;
  /**
   * Press the post's own previous (-1) / next (1) gallery arrow; Reddit's carousel does the rest.
   * Not an account action: pressed signed out as well.
   */
  galleryStep(target: ActionTarget, dir: 1 | -1): Promise<ActionResult>;
  /** Press the post's own video mute button (Reddit's player mutes or unmutes its video). */
  toggleMute(target: ActionTarget): Promise<ActionResult>;
}

export interface ActionDeps {
  bridge: BridgeApi;
  session(): Session;
  /** Confirmation window (default 4 s) and poll interval (default 150 ms). */
  confirmMs?: number;
  pollMs?: number;
  sleep?(ms: number): Promise<void>;
}

const NOT_DELEGATED: ActionResult = {
  ok: false,
  reason: 'not-found',
  detail: 'not available yet: this control has not been verified on Reddit signed in',
};

export function createActionApi(deps: ActionDeps): ActionApi {
  const confirmMs = deps.confirmMs ?? 4000;
  const pollMs = deps.pollMs ?? 150;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  /** One action in flight per item: a second key press while waiting is refused, not queued. */
  const busy = new Set<string>();

  const pressed = async (ref: string, control: NativeControl): Promise<boolean | null> => {
    const r = await deps.bridge.request({ op: 'native.state', ref, control }, 2000);
    return r.ok ? (r.pressed ?? null) : null;
  };

  /** The state Reddit's own vote buttons show; null when either is unreadable. */
  const readState = async (ref: string): Promise<VoteState> => {
    const [up, down] = await Promise.all([pressed(ref, 'upvote'), pressed(ref, 'downvote')]);
    if (up === null || down === null) return null;
    return up ? 1 : down ? -1 : 0;
  };

  /**
   * Confirmed: the buttons read `dir`. The row's `vote-state` attribute is NOT required to agree:
   * live (2026-10-16) it kept its page-load value until a reload while the buttons flipped at once,
   * so requiring it made every comment vote time out and refused the clearing key press as busy.
   */
  const confirmed = async (ref: string, dir: -1 | 0 | 1): Promise<boolean> =>
    (await readState(ref)) === dir;

  const failure = (error: string | undefined): ActionResult => ({
    ok: false,
    reason:
      error === 'timeout'
        ? 'timeout'
        : error === 'not-editable' || error === NOT_FOCUSED
          ? 'rejected'
          : 'not-found',
    detail: error,
  });

  /** After Reddit's reply / edit box was opened: success only once it has the focus. */
  const focusComposer = async (ref: string): Promise<ActionResult> => {
    const r = await deps.bridge.request({ op: 'composer.focus', ref }, 6000);
    if (!r.ok) return failure(r.error);
    return r.focused
      ? { ok: true }
      : { ok: false, reason: 'timeout', detail: 'Reddit’s reply box did not take the focus' };
  };

  /** Press a native control, then focus the box it opens. One such action per item at a time. */
  const compose = async (target: ActionTarget, control: NativeControl): Promise<ActionResult> => {
    if (!deps.session().signedIn) return { ok: false, reason: 'signed-out' };
    const key = `${target.id}:compose`;
    if (busy.has(key)) return { ok: false, reason: 'rejected', detail: 'busy' };
    busy.add(key);
    try {
      const ref = deps.bridge.ref(target.source);
      const click = await deps.bridge.request({ op: 'native.click', ref, control });
      return click.ok ? await focusComposer(ref) : failure(click.error);
    } finally {
      busy.delete(key);
    }
  };

  /** A comment is saved; a post is saved and hidden too. */
  const menuOf = (el: Element): MenuKind => (el.matches(C.comment) ? 'comment' : 'post');

  const menuRequest = (ref: string, menu: MenuKind, item: MenuItemKind, click: boolean) =>
    deps.bridge.request({ op: click ? 'menu.item' : 'menu.state', ref, menu, item }, 8000);

  /** The saved / hidden state Reddit's own menu row shows; null when it cannot be read. */
  const readMenu = async (ref: string, menu: MenuKind, item: MenuItemKind): Promise<MenuState> => {
    const r = await menuRequest(ref, menu, item, false);
    return r.ok && r.itemState ? r.itemState : null;
  };

  /** A post is gone once Reddit removes it (or marks it hidden) after a Hide. */
  const gone = (el: Element): boolean => !el.isConnected || el.hasAttribute('hidden');

  /** Save / Hide through the item's own menu: read the row, click only when it must change, confirm. */
  const toggleMenu = async (
    target: ActionTarget,
    menu: MenuKind,
    item: MenuItemKind,
    on: boolean,
  ): Promise<ActionResult> => {
    const ref = deps.bridge.ref(target.source);
    const want: 'on' | 'off' = on ? 'on' : 'off';
    const before = await readMenu(ref, menu, item);
    if (before === null) {
      return { ok: false, reason: 'not-found', detail: `Reddit’s ${item} row is not readable` };
    }
    if (before === want) return { ok: true };
    const click = await menuRequest(ref, menu, item, true);
    if (!click.ok) return failure(click.error);
    for (let waited = 0; waited < confirmMs; waited += pollMs) {
      await sleep(pollMs);
      // Hide removes the post, so that click is confirmed by the post leaving the page; a Save
      // comes back as Unsave on the reopened row.
      if (item === 'hide' && on && gone(target.source)) return { ok: true };
      if ((await readMenu(ref, menu, item)) === want) return { ok: true };
    }
    return {
      ok: false,
      reason: 'timeout',
      detail: `Reddit did not confirm the ${item === 'inbox' ? 'change to inbox replies' : item}`,
    };
  };

  return {
    async voteState(target) {
      return readState(deps.bridge.ref(target.source));
    },

    async vote(target, dir) {
      if (!deps.session().signedIn) return { ok: false, reason: 'signed-out' };
      if (busy.has(target.id)) return { ok: false, reason: 'rejected', detail: 'busy' };
      busy.add(target.id);
      try {
        const ref = deps.bridge.ref(target.source);
        const before = await readState(ref);
        if (before === null) {
          // Without a readable state there is no way to confirm, so nothing is pressed.
          return { ok: false, reason: 'not-found', detail: 'vote state unreadable' };
        }
        if (before === dir) return { ok: true };
        // To clear a vote, press the button that is currently on; otherwise press the wanted one.
        const control: NativeControl =
          dir === 1 ? 'upvote' : dir === -1 ? 'downvote' : before === 1 ? 'upvote' : 'downvote';
        const click = await deps.bridge.request({ op: 'native.click', ref, control });
        if (!click.ok) return failure(click.error);
        for (let waited = 0; waited < confirmMs; waited += pollMs) {
          await sleep(pollMs);
          if (await confirmed(ref, dir)) return { ok: true };
        }
        return { ok: false, reason: 'timeout', detail: 'Reddit did not confirm the vote' };
      } finally {
        busy.delete(target.id);
      }
    },

    async save(target, on) {
      if (!deps.session().signedIn) return { ok: false, reason: 'signed-out' };
      const key = `${target.id}:menu`;
      if (busy.has(key)) return { ok: false, reason: 'rejected', detail: 'busy' };
      busy.add(key);
      try {
        return await toggleMenu(target, menuOf(target.source), 'save', on);
      } finally {
        busy.delete(key);
      }
    },
    async hide(target, on) {
      if (!deps.session().signedIn) return { ok: false, reason: 'signed-out' };
      if (menuOf(target.source) !== 'post') {
        return { ok: false, reason: 'not-found', detail: 'only posts can be hidden' };
      }
      const key = `${target.id}:menu`;
      if (busy.has(key)) return { ok: false, reason: 'rejected', detail: 'busy' };
      busy.add(key);
      try {
        return await toggleMenu(target, 'post', 'hide', on);
      } finally {
        busy.delete(key);
      }
    },
    async saveState(target) {
      // Signed out there is no menu to read; answer without touching Reddit's controls.
      if (!deps.session().signedIn) return null;
      return readMenu(deps.bridge.ref(target.source), menuOf(target.source), 'save');
    },
    async hideState(target) {
      if (!deps.session().signedIn) return null;
      const el = target.source;
      return menuOf(el) === 'post' ? readMenu(deps.bridge.ref(el), 'post', 'hide') : null;
    },
    async inboxReplies(target, on) {
      if (!deps.session().signedIn) return { ok: false, reason: 'signed-out' };
      const key = `${target.id}:menu`;
      if (busy.has(key)) return { ok: false, reason: 'rejected', detail: 'busy' };
      busy.add(key);
      try {
        return await toggleMenu(target, menuOf(target.source), 'inbox', on);
      } finally {
        busy.delete(key);
      }
    },
    async inboxRepliesState(target) {
      if (!deps.session().signedIn) return null;
      return readMenu(deps.bridge.ref(target.source), menuOf(target.source), 'inbox');
    },
    async delete(target) {
      if (!deps.session().signedIn) return { ok: false, reason: 'signed-out' };
      const r = await menuRequest(
        deps.bridge.ref(target.source),
        menuOf(target.source),
        'delete',
        true,
      );
      return r.ok ? { ok: true } : failure(r.error);
    },
    async reply() {
      return deps.session().signedIn ? NOT_DELEGATED : { ok: false, reason: 'signed-out' };
    },
    async report(target) {
      if (!deps.session().signedIn) return { ok: false, reason: 'signed-out' };
      const ref = deps.bridge.ref(target.source);
      const r = await menuRequest(ref, menuOf(target.source), 'report', true);
      return r.ok ? { ok: true } : failure(r.error);
    },
    async share(target) {
      if (menuOf(target.source) !== 'post') {
        return { ok: false, reason: 'not-found', detail: 'only posts can be shared' };
      }
      const ref = deps.bridge.ref(target.source);
      const r = await deps.bridge.request({ op: 'native.click', ref, control: 'share' });
      return r.ok ? { ok: true } : failure(r.error);
    },
    async galleryStep(target, dir) {
      // Reddit's carousel answers for anyone, so this is pressed signed out as well, and it exposes
      // no readable state to confirm against: a press is all there is, as for a share.
      if (!hasGallery(target.source)) {
        return { ok: false, reason: 'not-found', detail: 'this post has no gallery' };
      }
      const ref = deps.bridge.ref(target.source);
      const r = await deps.bridge.request({
        op: 'native.click',
        ref,
        control: dir === 1 ? 'galleryNext' : 'galleryPrev',
      });
      return r.ok ? { ok: true } : failure(r.error);
    },
    async toggleMute(target) {
      if (!hasVideo(target.source)) {
        return { ok: false, reason: 'not-found', detail: 'this post has no video' };
      }
      const ref = deps.bridge.ref(target.source);
      const r = await deps.bridge.request({ op: 'native.click', ref, control: 'muteToggle' });
      return r.ok ? { ok: true } : failure(r.error);
    },
    startReply: (target) => compose(target, 'reply'),
    startEdit: (target) => compose(target, 'edit'),
  };
}
