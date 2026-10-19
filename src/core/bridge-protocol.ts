/**
 * Isolated world <-> MAIN-world bridge protocol (contracts/messaging.md). Payloads are JSON
 * strings carried in CustomEvent.detail — strings cross extension worlds in Chrome and Firefox,
 * objects do not reliably. Elements are addressed by a REScue-stamped attribute in the shared DOM.
 */
export const REQUEST_EVENT = 'rescue:bridge-request';
export const RESPONSE_EVENT = 'rescue:bridge-response';
export const CHANNEL_ATTR = 'data-rescue-channel';
export const REF_ATTR = 'data-rescue-ref';
export const NAVIGATED_EVENT = 'rescue:navigated';

export type NativeControl =
  'upvote' | 'downvote' | 'save' | 'hide' | 'reply' | 'edit' | 'join' | 'over18' | 'share';

/** Which item's own overflow menu a menu op opens (a post's or a comment's). */
export type MenuKind = 'post' | 'comment';
/** Which row of that menu the op looks for, by its text. */
/** `report` only opens Reddit's own report dialog; it is never confirmed or toggled. */
export type MenuItemKind = 'save' | 'hide' | 'report' | 'inbox' | 'delete';

export type BridgeRequest =
  | { op: 'partial.load'; ref: string }
  | { op: 'native.click'; ref: string; control: NativeControl }
  /** Read a native toggle control's pressed state without touching it (US7 confirmation). */
  | { op: 'native.state'; ref: string; control: NativeControl }
  /** Focus the item's own reply / edit box once it has appeared (comment actions). */
  | { op: 'composer.focus'; ref: string }
  | { op: 'composer.insert'; ref: string; text: string }
  | { op: 'composer.submit'; ref: string }
  /**
   * Open the item's own overflow menu, find its Save / Hide row by text, report the row's current
   * text, and click it (save / hide actions). Nothing is clicked when no row matches.
   */
  | { op: 'menu.item'; ref: string; menu: MenuKind; item: MenuItemKind }
  /** Read the Save / Hide row's current text only; the menu is closed again (no click). */
  | { op: 'menu.state'; ref: string; menu: MenuKind; item: MenuItemKind };

export interface BridgeResponse {
  ok: boolean;
  error?: string;
  accepted?: boolean;
  /** native.state: true/false from the control's pressed state; null when it carries none. */
  pressed?: boolean | null;
  /** native.state on a comment: the action row's vote-state as -1 / 0 / 1, null when unknown. */
  voteState?: -1 | 0 | 1 | null;
  /** composer.focus: the box exists AND now holds the focus. */
  focused?: boolean;
  /** menu.item / menu.state: 'on' when the row already reads Unsave / Unhide, else 'off'. */
  itemState?: 'on' | 'off';
  /** menu.item / menu.state: the matched row's own text, for diagnostics. */
  itemText?: string;
}

export interface Envelope<T> {
  token: string;
  id: number;
  body: T;
}
