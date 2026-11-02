/**
 * The card userInfo shows over a username: who they are, since when, their karma, and the
 * tag / ignore / highlight / profile words. It is one REScue-owned node on `document.body`
 * (`position: fixed`, themed with REScue's own colour variables like the other popups). All text
 * is set with textContent; the data comes from Reddit's user card (core/hovercards.ts).
 */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import type { HoverResult, UserCard } from '../../core/hovercards';

export const USER_INFO_CARD_CLASS = 'rescue-userinfo';
/** On every link and button, so the hover-text audit (tests/browser/hover-hints.spec.ts) checks them. */
const WORD_CLASS = 'rescue-userinfo-word';

const GAP = 6;
const MARGIN = 8;
const CARD_CSS =
  'position:fixed;z-index:2147483646;box-sizing:border-box;width:280px;max-width:calc(100vw - 16px);display:flex;flex-direction:column;gap:6px;padding:10px 12px;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);border-radius:6px;box-shadow:0 4px 14px var(--rescue-shadow,rgba(0,0,0,.25));font:13px/1.4 system-ui,sans-serif;left:0;top:0';
const WORD_CSS =
  'background:none;border:0;padding:0;font:inherit;color:inherit;cursor:pointer;text-decoration:underline';
const ROW_CSS = 'display:flex;flex-wrap:wrap;gap:4px 12px;font-size:12px';

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Where the card goes: left-aligned with the link, below it, or above it when there is no room
 * below; always inside the viewport (`size` is 0 until the card has been laid out).
 */
export function placeCard(
  anchor: Box,
  size: { w: number; h: number },
  viewport: { w: number; h: number },
): { left: number; top: number } {
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - size.h;
  const top = below + size.h + MARGIN > viewport.h && above >= MARGIN ? above : below;
  return {
    left: Math.max(MARGIN, Math.min(anchor.left, viewport.w - size.w - MARGIN)),
    top: Math.max(MARGIN, Math.min(top, viewport.h - size.h - MARGIN)),
  };
}

/** Whole years from `from` to `now` (UTC dates), never negative. */
export function yearsSince(from: Date, now: Date): number {
  let years = now.getUTCFullYear() - from.getUTCFullYear();
  const before =
    now.getUTCMonth() < from.getUTCMonth() ||
    (now.getUTCMonth() === from.getUTCMonth() && now.getUTCDate() < from.getUTCDate());
  if (before) years--;
  return Math.max(0, years);
}

/** "redditor since Jan 19, 2021 (4 years)". */
export function sinceText(cakeDay: Date, now: Date): string {
  const date = cakeDay.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const n = yearsSince(cakeDay, now);
  const age = n === 0 ? 'less than a year' : n === 1 ? '1 year' : `${n} years`;
  return `redditor since ${date} (${age})`;
}

const count = (n: number): string => n.toLocaleString('en-US');

/** "308 post karma · 184 comment karma"; a missing number is left out, nothing at all if both are. */
export function karmaText(card: Pick<UserCard, 'postKarma' | 'commentKarma'>): string {
  const parts: string[] = [];
  if (card.postKarma !== undefined) parts.push(`${count(card.postKarma)} post karma`);
  if (card.commentKarma !== undefined) parts.push(`${count(card.commentKarma)} comment karma`);
  return parts.join(' · ');
}

export const NOT_FOUND_TEXT = 'Reddit has no user by that name.';
export const UNAVAILABLE_TEXT = 'Reddit didn’t send this user’s card right now.';

/** A word the reader can flip: on/off is read again after every click. */
export interface ToggleControl {
  on(): boolean;
  toggle(): Promise<void>;
}

/** Which words the card offers; a missing one is not shown. */
export interface CardControls {
  tag?: (card: HTMLElement) => void;
  ignore?: ToggleControl;
  highlight?: ToggleControl;
}

export class UserInfoCard {
  readonly root: HTMLElement;

  constructor(
    readonly user: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.root = h('div', {
      class: `${USER_INFO_CARD_CLASS} rescue-overlay`,
      role: 'region',
      'aria-label': `REScue user info: ${user}`,
    });
    this.root.style.cssText = CARD_CSS;
    this.root.append(this.nameLine(null), this.line('status', label.loading));
  }

  contains(node: Node | null): boolean {
    return !!node && this.root.contains(node);
  }

  /** Put the card where `anchor` is (call again after the content changes size). */
  place(anchor: Box, viewport = { w: innerWidth, h: innerHeight }): void {
    const size = { w: this.root.offsetWidth, h: this.root.offsetHeight };
    const pos = placeCard(anchor, size, viewport);
    this.root.style.left = `${pos.left}px`;
    this.root.style.top = `${pos.top}px`;
  }

  /** Replace "loading…" with what Reddit said. */
  show(result: HoverResult<UserCard>, controls: CardControls): void {
    const card = result.state === 'unavailable' ? null : result.card;
    const parts: HTMLElement[] = [this.nameLine(card?.found ? (card.displayName ?? null) : null)];
    if (result.state === 'notFound') {
      parts.push(this.line('status', NOT_FOUND_TEXT));
    } else if (result.state === 'unavailable') {
      parts.push(this.line('status', UNAVAILABLE_TEXT));
    } else {
      if (card!.cakeDay) parts.push(this.line('since', sinceText(card!.cakeDay, this.now())));
      const karma = karmaText(card!);
      if (karma) parts.push(this.line('karma', karma));
    }
    if (result.state !== 'notFound') parts.push(this.controlRow(controls));
    this.root.replaceChildren(...parts);
  }

  remove(): void {
    this.root.remove();
  }

  private line(part: string, text: string): HTMLElement {
    return h('div', { 'data-part': part }, text);
  }

  private nameLine(displayName: string | null): HTMLElement {
    const name = h(
      'a',
      {
        class: WORD_CLASS,
        href: `/user/${this.user}/`,
        title: hint.userInfoName(this.user),
        'data-part': 'name',
      },
      `u/${this.user}`,
    );
    name.style.cssText = 'font-weight:700;color:inherit';
    const shown = displayName?.replace(/^u\//i, '').trim();
    const extra = shown && shown.toLowerCase() !== this.user.toLowerCase() ? ` (${shown})` : '';
    return h('div', { 'data-part': 'who' }, name, extra);
  }

  private controlRow(c: CardControls): HTMLElement {
    const row = h('div', { 'data-part': 'actions' });
    row.style.cssText = ROW_CSS;
    if (c.tag) {
      const tag = this.word(label.tag, hint.hoverTag(this.user), () => c.tag!(this.root));
      tag.dataset.action = 'tag';
      row.append(tag);
    }
    if (c.ignore) {
      row.append(
        this.toggleWord('ignore', c.ignore, label.ignore, label.unignore, hint.hoverIgnore),
      );
    }
    if (c.highlight) {
      row.append(
        this.toggleWord(
          'highlight',
          c.highlight,
          label.highlight,
          label.unhighlight,
          hint.hoverHighlight,
        ),
      );
    }
    const profile = h(
      'a',
      {
        class: WORD_CLASS,
        href: `/user/${this.user}/`,
        title: hint.userInfoProfile(this.user),
        'data-action': 'profile',
      },
      label.profile,
    );
    profile.style.cssText = 'color:inherit';
    row.append(profile);
    return row;
  }

  private word(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = h('button', { type: 'button', class: WORD_CLASS, title }, text);
    b.style.cssText = WORD_CSS;
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  private toggleWord(
    action: string,
    control: ToggleControl,
    offText: string,
    onText: string,
    title: (user: string, on: boolean) => string,
  ): HTMLButtonElement {
    const paint = (): void => {
      const on = control.on();
      b.textContent = on ? onText : offText;
      b.title = title(this.user, on);
    };
    const b = this.word(offText, '', () => void control.toggle().then(paint, paint));
    b.dataset.action = action;
    paint();
    return b;
  }
}
