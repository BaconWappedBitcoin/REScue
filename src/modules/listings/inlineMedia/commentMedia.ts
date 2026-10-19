/**
 * Media inside comments for inlineMedia (RES showImages, collapse): each picture, GIF and video
 * in a comment body is hidden behind a word placed in its spot ("show image", "show GIF", "show
 * video"). The hiding itself is a stylesheet keyed on the contract selector (src/model/
 * comment-media.ts), so media is hidden before it can be seen after a refresh and when Reddit
 * builds a comment body late; this controller only adds the words, keeps your choices, and pauses
 * players that were put away. A MutationObserver of its own watches for figures because a comment
 * body is built after the comment itself and can be replaced again. It never writes into Reddit's
 * players or shadow roots.
 */
import { h } from '../../../core/dom';
import { commentMediaLabel, hint } from '../../../core/hints';
import {
  CM_ATTR,
  CM_BUTTON_CLASS,
  CM_HIDDEN,
  CM_SHOWN,
  commentOf,
  figuresOf,
  FIGURE_SELECTOR,
  kindOfFigure,
  pausePlayers,
  playGifs,
} from '../../../model/comment-media';
import { C } from '../../../contracts/reddit';
import { onClick } from '../../comments/commentUi';

/** A GIF you just chose to show starts at once (after the frame that shows it). */
const startGifs = (figure: HTMLElement): void => {
  requestAnimationFrame(() => playGifs(figure));
};

const BUTTON_STYLE =
  'display:inline-block;background:none;border:0;padding:0 4px;margin:2px 0;cursor:pointer;font:inherit;font-size:12px;color:var(--rescue-meta,#666);text-decoration:underline';

interface Entry {
  button: HTMLButtonElement;
  /** Stable across Reddit drawing the body again: comment id plus the figure's place in it. */
  key: string | null;
  choice?: boolean; // true = shown, false = put away; used when there is no key
}

export class CommentMedia {
  private active = false;
  private readonly entries = new WeakMap<HTMLElement, Entry>();
  private readonly buttons = new WeakSet<HTMLButtonElement>();
  /** Your choice per figure key (true = shown), for figures Reddit draws again. */
  private readonly choices = new Map<string, boolean>();
  private observer: MutationObserver | null = null;
  private onShown: () => void = () => {};

  /** `onShown` runs when you show something (the blocked-downloads note hangs on it). */
  start(onShown: () => void): void {
    this.onShown = onShown;
    this.observer = new MutationObserver((records) => this.onMutations(records));
    this.observer.observe(document.documentElement, { childList: true, subtree: true });
    this.scan(document);
  }

  /** The switch (or a subreddit rule) says comment media is hidden now. */
  setActive(on: boolean): void {
    this.active = on;
    this.scan(document);
  }

  /** New page view: forget the choices. */
  reset(): void {
    this.choices.clear();
  }

  dispose(): void {
    this.observer?.disconnect();
    this.observer = null;
    for (const f of document.querySelectorAll<HTMLElement>(FIGURE_SELECTOR)) {
      f.removeAttribute(CM_ATTR);
      this.entries.get(f)?.button.remove();
      this.entries.delete(f);
    }
    document.querySelectorAll(`.${CM_BUTTON_CLASS}`).forEach((b) => b.remove());
    this.choices.clear();
  }

  // --- what you can ask ------------------------------------------------------------------------

  hasMedia(host: Element): boolean {
    return figuresOf(host).length > 0;
  }

  /** Is there any comment media on the page at all? */
  hasAny(): boolean {
    return document.querySelector(FIGURE_SELECTOR) !== null;
  }

  /** Is any comment media on the page hidden now? */
  anyHidden(): boolean {
    for (const f of document.querySelectorAll<HTMLElement>(FIGURE_SELECTOR))
      if (this.isHidden(f)) return true;
    return false;
  }

  /** X on a selected comment: show its media if any is hidden, else hide it. */
  toggleComment(host: Element): boolean {
    const figures = figuresOf(host);
    if (!figures.length) return false;
    this.setAll(figures, figures.some((f) => this.isHidden(f)));
    return true;
  }

  /** Shift+X: show (true) or hide (false) the media of every comment on the page. */
  setEvery(show: boolean): void {
    this.setAll([...document.querySelectorAll<HTMLElement>(FIGURE_SELECTOR)], show);
  }

  // --- internals -------------------------------------------------------------------------------

  private onMutations(records: MutationRecord[]): void {
    const figures = new Set<HTMLElement>();
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (!(n instanceof Element)) continue;
        if (n.matches(FIGURE_SELECTOR)) figures.add(n as HTMLElement);
        else for (const f of n.querySelectorAll<HTMLElement>(FIGURE_SELECTOR)) figures.add(f);
      }
      // Reddit drew the body again around our button: put it back (only when it matters).
      if (this.active || this.choices.size)
        for (const n of r.removedNodes)
          if (n instanceof Element && n.classList.contains(CM_BUTTON_CLASS) && r.target instanceof Element)
            for (const f of r.target.querySelectorAll<HTMLElement>(FIGURE_SELECTOR)) figures.add(f);
    }
    for (const f of figures) this.apply(f);
  }

  private scan(root: ParentNode): void {
    for (const f of root.querySelectorAll<HTMLElement>(FIGURE_SELECTOR)) this.apply(f);
  }

  private keyOf(figure: HTMLElement): string | null {
    const host = commentOf(figure);
    const id = host?.getAttribute(C.commentAttr.id);
    if (!host || !id) return null;
    return `${id}#${figuresOf(host).indexOf(figure)}`;
  }

  /** Your choice for this figure, or undefined when you have made none. */
  private choiceOf(figure: HTMLElement, entry: Entry | undefined): boolean | undefined {
    const key = entry ? entry.key : this.choices.size ? this.keyOf(figure) : null;
    if (key) return this.choices.get(key);
    return entry?.choice;
  }

  private isHidden(figure: HTMLElement): boolean {
    const c = this.choiceOf(figure, this.entries.get(figure));
    return c === undefined ? this.active : !c;
  }

  private setAll(figures: HTMLElement[], show: boolean): void {
    for (const f of figures) {
      const e = this.ensure(f);
      if (e.key) this.choices.set(e.key, show);
      else e.choice = show;
      this.apply(f);
      if (show) startGifs(f);
    }
    if (show) this.onShown();
  }

  /** The entry (and button) of a figure; reuses a button that survived Reddit drawing it again. */
  private ensure(figure: HTMLElement): Entry {
    let e = this.entries.get(figure);
    if (e) return e;
    const prev = figure.previousElementSibling;
    const ours = prev instanceof HTMLButtonElement && prev.classList.contains(CM_BUTTON_CLASS);
    // A button we made survives Reddit moving its parent; a copy of one (no handler) does not.
    const reuse = ours && this.buttons.has(prev);
    if (ours && !reuse) prev.remove();
    const button = reuse ? prev : this.makeButton(figure);
    e = { button, key: this.keyOf(figure) };
    this.entries.set(figure, e);
    if (!button.isConnected) figure.before(button);
    return e;
  }

  private makeButton(figure: HTMLElement): HTMLButtonElement {
    const b = h('button', { type: 'button', class: CM_BUTTON_CLASS });
    this.buttons.add(b);
    b.style.cssText = BUTTON_STYLE;
    onClick(b, () => {
      const next = this.entries.get(figure);
      if (!next) return;
      const show = this.isHidden(figure);
      if (next.key) this.choices.set(next.key, show);
      else next.choice = show;
      this.apply(figure);
      if (show) {
        startGifs(figure);
        this.onShown();
      }
    });
    return b;
  }

  /** Bring one figure and its button in line with the switch and your choice. */
  private apply(figure: HTMLElement): void {
    const known = this.entries.get(figure);
    const chose = this.choiceOf(figure, known) !== undefined;
    if (!this.active && !chose) {
      // Nothing to hide and nothing you chose: leave the figure exactly as Reddit drew it.
      figure.removeAttribute(CM_ATTR);
      if (known) {
        known.button.remove();
        this.entries.delete(figure);
      }
      return;
    }
    const e = this.ensure(figure);
    const hidden = this.isHidden(figure);
    figure.setAttribute(CM_ATTR, hidden ? CM_HIDDEN : CM_SHOWN);
    if (hidden) pausePlayers(figure);
    const kind = kindOfFigure(figure);
    e.button.textContent = commentMediaLabel(hidden, kind);
    e.button.title = hint.commentMediaToggle(hidden, kind);
    e.button.setAttribute('aria-expanded', String(!hidden));
  }
}
