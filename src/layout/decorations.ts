/**
 * Per-item decorations modules attach during onItems, consumed by whichever layout renders the
 * item (module-api.md ItemBatch). Keyed by thing id so a re-parsed item keeps its decorations.
 */
import { stamp } from '../core/instance';

export type Slot = 'author' | 'title' | 'tagline';

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

  hide(item: ItemLike, reason: string): void {
    this.entry(item.id).hidden.add(reason);
    this.changed(item.id);
  }

  /** Withdraw one reason (the caller's own), or every reason when none is given. */
  unhide(item: ItemLike, reason?: string): void {
    const e = this.items.get(item.id);
    if (e) {
      if (reason === undefined) e.hidden.clear();
      else e.hidden.delete(reason);
    }
    this.changed(item.id);
  }

  /** Collapse only the item's own body (a comment's replies stay visible). */
  collapseBody(item: ItemLike, on: boolean): void {
    this.entry(item.id).collapsed = on;
    this.changed(item.id);
  }

  /** Add a class to the item's own author link. */
  markAuthor(item: ItemLike, cls: string): void {
    this.entry(item.id).authorClasses.add(cls);
    this.changed(item.id);
  }

  unmarkAuthor(item: ItemLike, cls: string): void {
    this.entry(item.id).authorClasses.delete(cls);
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
      this.retired.set(item.id, keep);
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

  addClass(item: ItemLike, cls: string): void {
    this.entry(item.id).classes.add(cls);
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
      this.retired.set(id, kept);
    }
    this.items.clear();
  }

  private changed(id: string): void {
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
  addClass(item: ItemLike, cls: string): void;
  setRevealHidden(on: boolean): void;
}
