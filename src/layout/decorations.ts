/**
 * Per-item decorations modules attach during onItems, consumed by whichever layout renders the
 * item (module-api.md ItemBatch). Keyed by thing id so a re-parsed item keeps its decorations.
 */
import { stamp } from '../core/instance';

/** `domain`: right after a link post's "(domain)" where a layout shows one (the old look), else as `tagline`. */
export type Slot = 'author' | 'title' | 'tagline' | 'domain';

/**
 * What kind of control a node is: its first `rescue-*` class. A second decoration of the same
 * kind in the same slot of the same item replaces the first (a re-parsed or re-evaluated item
 * must never end up with two "filter" buttons).
 */
function kindOf(node: Node): string | null {
  if (!(node instanceof Element)) return null;
  for (const c of node.classList) {
    if (c.startsWith('rescue-') && c !== 'rescue-btn' && c !== 'rescue-label') return c;
  }
  return null;
}

interface ItemLike {
  id: string;
}

interface Entry {
  /** Every reason that currently hides the item; any one keeps it hidden. */
  hidden: Set<string>;
  collapsed: boolean;
  classes: Set<string>;
  authorClasses: Set<string>;
  slots: Map<Slot, Node[]>;
}

export class Decorations {
  private readonly items = new Map<string, Entry>();
  /**
   * Nodes of cleared decorations, by item id. Held weakly and regardless of whether they are on
   * the page right now: Reddit detaches a page's DOM on a route change and re-attaches the very
   * same elements, old REScue nodes included, when the reader comes back (back/forward). Dropping
   * the nodes that were detached at clear time left those unknown, so the item got a second set.
   */
  private readonly retired = new Map<string, Array<WeakRef<Node>>>();
  private readonly listeners = new Set<(id: string) => void>();
  private reveal = false;
  /** Open `batch()` calls; while above zero, changes are collected in `pending` instead of sent. */
  private batching = 0;
  /** Items changed during the current batch, each told to the listeners once when it ends. */
  private readonly pending = new Set<string>();

  /**
   * Run `fn` and tell the listeners about each changed item once, after it returns. A pipeline
   * batch has every module decorate the same comment several times; layouts re-placing the item
   * after each of those calls was most of a batch's cost on a long thread.
   */
  batch<T>(fn: () => T): T {
    this.batching++;
    try {
      return fn();
    } finally {
      if (--this.batching === 0 && this.pending.size) {
        const ids = [...this.pending];
        this.pending.clear();
        for (const id of ids) this.notify(id);
      }
    }
  }

  /** Show hidden items marked as hidden (with their reason) instead of hiding them. */
  setReveal(on: boolean): void {
    if (this.reveal === on) return;
    this.reveal = on;
    for (const [id, e] of this.items) if (e.hidden.size) this.changed(id);
  }

  revealing(): boolean {
    return this.reveal;
  }

  hiddenCount(): number {
    let n = 0;
    for (const e of this.items.values()) if (e.hidden.size) n++;
    return n;
  }

  private entry(id: string): Entry {
    let e = this.items.get(id);
    if (!e) {
      e = {
        hidden: new Set(),
        collapsed: false,
        classes: new Set(),
        authorClasses: new Set(),
        slots: new Map(),
      };
      this.items.set(id, e);
    }
    return e;
  }

  // Calls that change nothing (the same reason again, an item that was never collapsed, ...) tell
  // no one: every module repeats them for every item of every batch.
  hide(item: ItemLike, reason: string): void {
    const hidden = this.entry(item.id).hidden;
    if (hidden.has(reason)) return;
    hidden.add(reason);
    this.changed(item.id);
  }

  /** Withdraw one reason (the caller's own), or every reason when none is given. */
  unhide(item: ItemLike, reason?: string): void {
    const hidden = this.items.get(item.id)?.hidden;
    if (!hidden?.size || (reason !== undefined && !hidden.has(reason))) return;
    if (reason === undefined) hidden.clear();
    else hidden.delete(reason);
    this.changed(item.id);
  }

  /** Collapse only the item's own body (a comment's replies stay visible). */
  collapseBody(item: ItemLike, on: boolean): void {
    if ((this.items.get(item.id)?.collapsed === true) === on) return;
    this.entry(item.id).collapsed = on;
    this.changed(item.id);
  }

  /** Add a class to the item's own author link. */
  markAuthor(item: ItemLike, cls: string): void {
    const classes = this.entry(item.id).authorClasses;
    if (classes.has(cls)) return;
    classes.add(cls);
    this.changed(item.id);
  }

  unmarkAuthor(item: ItemLike, cls: string): void {
    if (this.items.get(item.id)?.authorClasses.delete(cls) !== true) return;
    this.changed(item.id);
  }

  bodyCollapsed(id: string): boolean {
    return this.items.get(id)?.collapsed === true;
  }

  authorClasses(id: string): string[] {
    return [...(this.items.get(id)?.authorClasses ?? [])];
  }

  decorate(item: ItemLike, slot: Slot, node: Node): void {
    const e = this.entry(item.id);
    const list = e.slots.get(slot) ?? [];
    if (list.includes(node)) {
      this.changed(item.id);
      return;
    }
    const kind = kindOf(node);
    const gone = this.retired.get(item.id);
    if (kind && gone) {
      const keep: Array<WeakRef<Node>> = [];
      for (const ref of gone) {
        const old = ref.deref();
        if (!old) continue;
        if (old !== node && kindOf(old) === kind) {
          if (old instanceof Element) old.remove();
        } else keep.push(ref);
      }
      this.keepRetired(item.id, keep);
    }
    if (kind) {
      const at = list.findIndex((n) => kindOf(n) === kind);
      if (at >= 0) {
        const old = list[at]!;
        if (old instanceof Element) old.remove();
        list.splice(at, 1);
      }
    }
    if (node instanceof Element) stamp(node);
    list.push(node);
    e.slots.set(slot, list);
    this.changed(item.id);
  }

  /**
   * Take every decoration of one kind (its first `rescue-*` class) off every item and off the
   * page, including those remembered from before a route change: a module switched off live.
   */
  removeKind(kind: string): void {
    for (const [id, e] of this.items) {
      let touched = false;
      for (const [slot, nodes] of e.slots) {
        const keep = nodes.filter((n) => kindOf(n) !== kind);
        if (keep.length === nodes.length) continue;
        for (const n of nodes) if (kindOf(n) === kind && n instanceof Element) n.remove();
        e.slots.set(slot, keep);
        touched = true;
      }
      if (touched) this.changed(id);
    }
    for (const [id, refs] of this.retired) {
      const keep: Array<WeakRef<Node>> = [];
      for (const ref of refs) {
        const n = ref.deref();
        if (!n) continue;
        if (kindOf(n) === kind && n instanceof Element) n.remove();
        else keep.push(ref);
      }
      this.keepRetired(id, keep);
    }
  }

  addClass(item: ItemLike, cls: string): void {
    const classes = this.entry(item.id).classes;
    if (classes.has(cls)) return;
    classes.add(cls);
    this.changed(item.id);
  }

  hiddenReason(id: string): string | undefined {
    return this.items.get(id)?.hidden.values().next().value;
  }

  classes(id: string): string[] {
    return [...(this.items.get(id)?.classes ?? [])];
  }

  slot(id: string, slot: Slot): Node[] {
    return this.items.get(id)?.slots.get(slot) ?? [];
  }

  /** Layouts subscribe so a decoration added after render still shows. */
  onChange(fn: (id: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  clear(): void {
    // The nodes stay on the page (Reddit may keep the same post elements), but are remembered so
    // that decorating the same item again replaces them instead of adding a second set.
    for (const [id, e] of this.items) {
      const kept = (this.retired.get(id) ?? []).filter((r) => r.deref() !== undefined);
      for (const nodes of e.slots.values()) for (const n of nodes) kept.push(new WeakRef(n));
      this.keepRetired(id, kept);
    }
    // Items of earlier page views that never came back: drop the references the browser has
    // already collected, and the ids left with none (the map grew with every page view).
    for (const [id, refs] of this.retired) {
      if (this.items.has(id)) continue;
      this.keepRetired(
        id,
        refs.filter((r) => r.deref() !== undefined),
      );
    }
    this.items.clear();
    this.pending.clear();
  }

  /** How many items have nodes remembered from before a route change (tests). */
  retiredCount(): number {
    return this.retired.size;
  }

  private keepRetired(id: string, refs: Array<WeakRef<Node>>): void {
    if (refs.length) this.retired.set(id, refs);
    else this.retired.delete(id);
  }

  private changed(id: string): void {
    if (this.batching) this.pending.add(id);
    else this.notify(id);
  }

  private notify(id: string): void {
    for (const fn of this.listeners) fn(id);
  }
}

/** The subset handed to modules through ModuleContext.ui. */
export interface LayoutHooks {
  hide(item: ItemLike, reason: string): void;
  /** Withdraw `reason` only (an item another module hid stays hidden); all reasons if omitted. */
  unhide(item: ItemLike, reason?: string): void;
  /** Collapse or expand the item's OWN body; a comment's replies are not touched. */
  collapseBody(item: ItemLike, on: boolean): void;
  /** Add / remove a class on the item's own author link. */
  markAuthor(item: ItemLike, cls: string): void;
  unmarkAuthor(item: ItemLike, cls: string): void;
  decorate(item: ItemLike, slot: Slot, node: Node): void;
  /** Remove every decoration of this kind (first `rescue-*` class) from the page (dispose). */
  removeDecorations(kind: string): void;
  addClass(item: ItemLike, cls: string): void;
  setRevealHidden(on: boolean): void;
}
