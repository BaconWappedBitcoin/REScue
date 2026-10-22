/**
 * Native selection (RES selectedEntry): the post or comment keyboard commands act on, over
 * Reddit's own layout. The selectable items are the page's posts (a listing) or the thread's post
 * followed by its comments, in DOCUMENT order, tracked from the same batches NativeAdapter
 * receives so items Reddit loads later are appended. Items hidden by filters or ignore are
 * skipped. Reddit's elements are never restyled: the selected host only gets `data-rescue-selected`
 * and a REScue-owned outline box is drawn over its own area (selectionView.ts).
 */
import type { ItemBatch } from '../../core/types';
import type { Comment, Post } from '../../model/types';
import { NativeAdapter } from './adapter';
import { SelectionHistory } from './selectionHistory';
import {
  isShown,
  isShownCached,
  SELECTED_ATTR,
  SelectionView,
  TOP_MARGIN,
  areaOf,
  type SelectionConfig,
} from './selectionView';

export interface SelectableItem {
  id: string;
  kind: 'post' | 'comment';
  model: Post | Comment;
  /** The shreddit-post / shreddit-comment element. */
  host: Element;
  /** What filters hide: the feed card for a post, else the host. */
  wrapper: Element;
}

export interface SelectOptions {
  /** Bring the item into view (default true). */
  scroll?: boolean;
}

const depthOf = (it: SelectableItem): number =>
  it.kind === 'comment' ? (it.model as Comment).depth : -1;

/** Document order of two hosts (a parent precedes the replies nested inside it). */
function byDocument(a: SelectableItem, b: SelectableItem): number {
  if (a.host === b.host) return 0;
  const p = a.host.compareDocumentPosition(b.host);
  if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

export class Selection {
  private items: SelectableItem[] = [];
  private readonly byId = new Map<string, SelectableItem>();
  private readonly byHost = new WeakMap<Element, SelectableItem>();
  private currentItem: SelectableItem | null = null;
  private outOfOrder = false;
  private readonly listeners = new Set<(item: SelectableItem | null) => void>();
  private readonly view = new SelectionView();
  private readonly history = new SelectionHistory<SelectableItem>();

  /** Scroll style and outline look (options of the keyboard navigation module). */
  configure(config: Partial<SelectionConfig>): void {
    this.view.configure(config);
  }

  /** True just after the selection scrolled the page itself. */
  scrolledRecently(): boolean {
    return this.view.scrolledRecently();
  }

  /** How many earlier selections undo() can still return to. */
  historySize(): number {
    return this.history.size;
  }

  /** Add the posts and comments of a pipeline batch (new items append, duplicates are ignored). */
  track(batch: ItemBatch): void {
    let added = false;
    this.outOfOrder = false;
    for (const p of batch.posts)
      added = this.add(p.id, 'post', p, p.source, NativeAdapter.wrapperOf(p.source)) || added;
    for (const c of batch.comments)
      added = this.add(c.id, 'comment', c, c.source, c.source) || added;
    // Endless pages append in document order; only sort when an item landed before the last one.
    if (added && this.outOfOrder) this.items.sort(byDocument);
  }

  private add(
    id: string,
    kind: SelectableItem['kind'],
    model: Post | Comment,
    host: Element,
    wrapper: Element,
  ): boolean {
    const known = this.byId.get(id);
    if (known && (known.host === host || known.host.isConnected)) return false;
    const item: SelectableItem = { id, kind, model, host, wrapper };
    if (known) {
      // Reddit re-rendered the item: the new element takes its place.
      this.items[this.items.indexOf(known)] = item;
      if (this.currentItem === known) {
        // The outline follows the new element (and watches its size instead of the old one's).
        this.currentItem = item;
        host.setAttribute(SELECTED_ATTR, '');
        this.view.show(item, false);
      }
    } else {
      const last = this.items[this.items.length - 1];
      if (last && byDocument(last, item) > 0) this.outOfOrder = true;
      this.items.push(item);
    }
    this.byId.set(id, item);
    this.byHost.set(host, item);
    return true;
  }

  /** Forget everything (route change). */
  reset(): void {
    this.clear();
    this.history.clear();
    this.items = [];
    this.byId.clear();
  }

  /** Items that can be selected now, in document order. */
  list(): SelectableItem[] {
    const cache = new Map<Element, boolean>();
    return this.items.filter((it) => it.host.isConnected && isShownCached(it.wrapper, cache));
  }

  /** The selected item while it is still on the page. */
  current(): SelectableItem | null {
    const cur = this.currentItem;
    return cur && cur.host.isConnected ? cur : null;
  }

  /** The selected item's model (Post or Comment), if any. */
  model(): Post | Comment | null {
    return this.current()?.model ?? null;
  }

  /** Select by id, or by index into list(). */
  select(target: string | number, opts: SelectOptions = {}): boolean {
    const item = typeof target === 'number' ? this.list()[target] : this.byId.get(target);
    return item && this.usable(item) ? this.set(item, opts.scroll ?? true) : false;
  }

  /** Select the item an event happened in (click), without scrolling. */
  selectFromEvent(e: Event): boolean {
    for (const node of e.composedPath()) {
      const item = node instanceof Element ? this.byHost.get(node) : undefined;
      if (item && this.byId.get(item.id) === item) return this.set(item, false);
    }
    return false;
  }

  /** Move to the next (+1) or previous (-1) item; false when there is none. */
  move(delta: 1 | -1): boolean {
    const cur = this.current();
    if (!cur) {
      const start = this.entryPoint(delta);
      return start ? this.set(start, true) : false;
    }
    return this.scan(this.items.indexOf(cur), delta, () => true);
  }

  /** First (or last) selectable item. */
  edge(which: 'first' | 'last'): boolean {
    const list = this.list();
    const item = which === 'first' ? list[0] : list[list.length - 1];
    return item ? this.set(item, true, true, true) : false;
  }

  /**
   * Next/previous comment at the same depth inside the same parent; for a top-level comment that
   * is the next/previous thread. The thread's post (or a listing's post) just moves one item.
   */
  moveSibling(delta: 1 | -1): boolean {
    const cur = this.current();
    if (!cur || cur.kind !== 'comment') return this.move(delta);
    const depth = depthOf(cur);
    return this.scan(this.items.indexOf(cur), delta, (it) => depthOf(it) === depth, depth, true);
  }

  /** Next/previous top-level comment thread, from anywhere inside a thread. */
  moveThread(delta: 1 | -1): boolean {
    const cur = this.current();
    if (!cur || cur.kind !== 'comment') return this.move(delta);
    const root = this.rootIndex(this.items.indexOf(cur));
    return this.scan(root, delta, (it) => depthOf(it) === 0, undefined, true);
  }

  /**
   * Next comment at the parent's level: skips the rest of the parent's replies (RES Alt+J). A
   * top-level comment has no parent, so it moves to the next thread.
   */
  moveParentSibling(): boolean {
    const cur = this.current();
    if (!cur || cur.kind !== 'comment') return this.move(1);
    const depth = depthOf(cur);
    if (depth === 0) return this.moveThread(1);
    for (let i = this.items.indexOf(cur) - 1; i >= 0; i--) {
      const it = this.items[i]!;
      if (it.kind === 'comment' && depthOf(it) < depth) {
        const parentDepth = depthOf(it);
        return this.scan(i, 1, (c) => depthOf(c) === parentDepth, parentDepth, true);
      }
    }
    return false;
  }

  /** Go back to the item selected before this one (RES undoMove, Ctrl+Z). */
  undo(): boolean {
    const cur = this.current();
    const back = this.history.pop((it) => it !== cur && this.usable(it));
    return back ? this.set(back, true, false, true) : false;
  }

  /**
   * Select the item nearest the top of the viewport: the first one whose top is clear of the sticky
   * header, else the first one still showing under it (a tall item). Nothing when none is on screen.
   */
  selectClosestInView(scroll = false): boolean {
    let partly: SelectableItem | null = null;
    for (const it of this.list()) {
      const area = areaOf(it);
      if (!area || area.bottom <= TOP_MARGIN || area.top >= innerHeight) continue;
      if (area.top >= TOP_MARGIN - 8) return this.current() === it || this.set(it, scroll);
      partly ??= it;
    }
    return partly ? this.current() === partly || this.set(partly, scroll) : false;
  }

  /** The top comment of the thread the selection is in. */
  toTop(): boolean {
    const cur = this.current();
    if (!cur || cur.kind !== 'comment') return false;
    const root = this.items[this.rootIndex(this.items.indexOf(cur))];
    return !!root && root !== cur && this.set(root, true, true, true);
  }

  /** The comment this one replies to. */
  parent(): boolean {
    const cur = this.current();
    if (!cur || cur.kind !== 'comment') return false;
    const depth = depthOf(cur);
    for (let i = this.items.indexOf(cur) - 1; i >= 0; i--) {
      const it = this.items[i]!;
      if (it.kind === 'comment' && depthOf(it) < depth && this.usable(it))
        return this.set(it, true, true, true);
    }
    return false;
  }

  clear(): void {
    if (this.currentItem) this.history.push(this.currentItem);
    this.currentItem?.host.removeAttribute(SELECTED_ATTR);
    const had = this.currentItem !== null;
    this.currentItem = null;
    this.view.hide();
    if (had) this.emit();
  }

  /** Redraw the outline (decorations changed what is hidden). */
  refresh(): void {
    this.view.schedule();
  }

  onChange(cb: (item: SelectableItem | null) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private usable(it: SelectableItem): boolean {
    return it.host.isConnected && isShown(it.wrapper);
  }

  /**
   * Walk from `from` in `delta` direction to the first usable item that `match`es. With `stopAbove`
   * the walk ends at the first comment shallower than that depth (leaving the parent's replies).
   */
  private scan(
    from: number,
    delta: 1 | -1,
    match: (it: SelectableItem) => boolean,
    stopAbove?: number,
    nonLinear = false,
  ): boolean {
    for (let i = from + delta; i >= 0 && i < this.items.length; i += delta) {
      const it = this.items[i]!;
      if (stopAbove !== undefined && it.kind === 'comment' && depthOf(it) < stopAbove) return false;
      if (this.usable(it) && match(it)) return this.set(it, true, true, nonLinear);
    }
    return false;
  }

  private rootIndex(from: number): number {
    let i = from;
    while (i > 0 && depthOf(this.items[i]!) > 0) i--;
    return i;
  }

  /** With nothing selected, start at the first item still on screen (else the first/last item). */
  private entryPoint(delta: 1 | -1): SelectableItem | null {
    const list = this.list();
    for (const it of list) {
      const area = areaOf(it);
      if (area && area.bottom > TOP_MARGIN) return it;
    }
    return (delta > 0 ? list[0] : list[list.length - 1]) ?? null;
  }

  /** `nonLinear`: a jump (sibling, thread, parent, first/last, undo), which has its own scroll style. */
  private set(item: SelectableItem, scroll: boolean, record = true, nonLinear = false): boolean {
    if (this.currentItem !== item) {
      if (this.currentItem && record) this.history.push(this.currentItem);
      this.currentItem?.host.removeAttribute(SELECTED_ATTR);
      this.currentItem = item;
      item.host.setAttribute(SELECTED_ATTR, '');
    }
    this.view.show(item, scroll, nonLinear);
    this.emit();
    return true;
  }

  private emit(): void {
    for (const cb of this.listeners) cb(this.current());
  }
}
