/**
 * Native adapter: REScue decorates Reddit's own layout and never replaces it. Hiding acts on the
 * item's wrapper (the feed's <article> for posts); decorations are placed on the item element
 * itself, either inline after the author link or in one of Reddit's own slots (contracts: the
 * credit bar and title area for posts, the meta line for comments). Placement is idempotent: a node
 * already in place is left alone, a detached one (Reddit re-rendered) is put back.
 */
import { C } from '../../contracts/reddit';
import { hint } from '../../core/hints';
import { OWNER_ATTR } from '../../core/instance';
import type { ItemBatch } from '../../core/types';
import { isSearchPost, searchTimeElement, searchTitleAnchor } from '../../model/search-post';
import type { Decorations, Slot } from '../decorations';

const HIDDEN_ATTR = 'data-rescue-hidden';
const COLLAPSED_ATTR = 'data-rescue-collapsed';
const SLOT_ATTR = C.slotAttr;
const PLACEMENT_ORDER: Slot[] = ['author', 'tagline', 'domain', 'title'];
const ITEM_SELECTOR = [C.post, C.search.post, C.comment, C.profileComment].join(',');
/** Below this many tracked items nothing is pruned. */
const PRUNE_MIN = 1000;

type ItemKind = 'post' | 'comment' | 'profileComment';

interface Tracked {
  kind: ItemKind;
  /** What gets hidden: the feed <article> for posts, else the item element. */
  wrapper: Element;
  /** What gets decorated: the shreddit-post / shreddit-comment element itself. */
  host: Element;
}

const bySlot = (name: string): string => `[${SLOT_ATTR}="${name}"]`;
const ANCHOR_ATTR = C.skin.anchorAttr;
type SkinAnchor = 'author' | 'title' | 'end' | 'domain';

export class NativeAdapter {
  private readonly items = new Map<string, Tracked>();
  /** Nodes we placed, so anchor lookups never mistake our own slot content for Reddit's. */
  private readonly placed = new WeakSet<Node>();
  /** Author-link classes applied per item, so an unmark can withdraw them. */
  private readonly marked = new Map<string, Set<string>>();
  /** Comments whose own body this adapter collapsed. */
  private readonly collapsedIds = new Set<string>();
  /** Which tracked item an element is the host of (the repair observer's way in). */
  private readonly hostIds = new WeakMap<Element, string>();
  private observer: MutationObserver | null = null;
  /** Tracked items after the last pruning; pruned again once the count has doubled. */
  private sizeAtPrune = 0;
  private readonly dirty = new Set<string>();
  private healQueued = false;

  constructor(private readonly deco: Decorations) {
    deco.onChange((id) => this.apply(id));
  }

  /** The element to hide for an item: the feed's <article> for posts, else the item. */
  static wrapperOf(source: Element): Element {
    if (isSearchPost(source)) return source; // a search result is its own card
    return source.closest(C.postWrapper) ?? source;
  }

  track(batch: ItemBatch): void {
    const ids: string[] = [];
    for (const p of batch.posts) {
      this.items.set(p.id, {
        kind: 'post',
        wrapper: NativeAdapter.wrapperOf(p.source),
        host: p.source,
      });
      this.hostIds.set(p.source, p.id);
      ids.push(p.id);
    }
    for (const c of batch.comments) {
      this.items.set(c.id, { kind: 'comment', wrapper: c.source, host: c.source });
      this.hostIds.set(c.source, c.id);
      ids.push(c.id);
    }
    for (const pc of batch.profileComments) {
      this.items.set(pc.id, { kind: 'profileComment', wrapper: pc.source, host: pc.source });
      this.hostIds.set(pc.source, pc.id);
      ids.push(pc.id);
    }
    for (const id of ids) this.apply(id); // later decoration changes arrive via onChange
    if (this.items.size > Math.max(PRUNE_MIN, this.sizeAtPrune * 2)) this.prune();
    this.watch();
  }

  /**
   * Forget items no longer on the page. An endless feed or a long thread otherwise keeps every
   * element it ever showed until the route changes (filteReddit's session prunes the same way).
   */
  private prune(): void {
    for (const [id, item] of this.items) {
      if (item.host.isConnected) continue;
      this.items.delete(id);
      this.marked.delete(id);
      this.collapsedIds.delete(id);
    }
    this.sizeAtPrune = this.items.size;
  }

  /** How many items are tracked (tests). */
  trackedCount(): number {
    return this.items.size;
  }

  /**
   * Reddit renders parts of a post lazily: the credit bar starts as a loader placeholder and is
   * swapped for the real markup later (live 2026-10-18: every post of a feed's first batch was
   * re-rendered within a second of being decorated). The decorations are still known, but their
   * nodes can be thrown away with the old markup and nothing asked for them to be placed again.
   * Watch the items for foreign DOM changes and re-apply the item's decorations (idempotent).
   */
  private watch(): void {
    if (this.observer || typeof MutationObserver === 'undefined') return;
    this.observer = new MutationObserver((records) => this.onMutations(records));
    this.observer.observe(document, { childList: true, subtree: true });
  }

  /** Stop watching (the instance was superseded or torn down). */
  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.dirty.clear();
  }

  private onMutations(records: MutationRecord[]): void {
    for (const r of records) {
      if (this.ownChange(r)) continue;
      const at = r.target instanceof Element ? r.target : r.target.parentElement;
      const host = at?.closest(ITEM_SELECTOR);
      const id = host ? this.hostIds.get(host) : undefined;
      if (id !== undefined) this.dirty.add(id);
    }
    if (!this.dirty.size || this.healQueued) return;
    this.healQueued = true;
    const run = (): void => {
      this.healQueued = false;
      const ids = [...this.dirty];
      this.dirty.clear();
      for (const id of ids) this.apply(id);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  /**
   * REScue's own placement (only nodes it placed were added), which must not trigger a repair.
   * A removal is never ignored: Reddit's renderer also drops nodes it does not know, ours
   * included, and that is exactly what needs repairing.
   */
  private ownChange(r: MutationRecord): boolean {
    if (r.removedNodes.length !== 0 || r.addedNodes.length === 0) return false;
    // Nodes this adapter placed, and any other node REScue made (stamped by core/instance: a
    // module's own controls, the old look's rows), are never Reddit re-rendering the item.
    for (const n of r.addedNodes) {
      if (this.placed.has(n) || (n instanceof Element && n.hasAttribute(OWNER_ATTR))) continue;
      return false;
    }
    return true;
  }

  apply(id: string): void {
    const item = this.items.get(id);
    if (!item) return;
    this.applyHidden(id, item.wrapper as HTMLElement);
    this.applyCollapse(id, item);
    this.applyDecorations(id, item);
    this.applyAuthorMarks(id, item);
  }

  /** Collapse only the comment's own body: its replies live in the same element and stay shown. */
  private applyCollapse(id: string, { kind, host }: Tracked): void {
    if (kind !== 'comment') return;
    const on = this.deco.bodyCollapsed(id);
    // Nothing to withdraw for a comment that was never collapsed: skip the subtree query.
    if (!on && !this.collapsedIds.has(id)) return;
    if (on) this.collapsedIds.add(id);
    else this.collapsedIds.delete(id);
    for (const el of host.querySelectorAll<HTMLElement>(C.commentBody)) {
      if (el.closest(C.comment) !== host) continue;
      if (on) {
        el.setAttribute(COLLAPSED_ATTR, '');
        el.style.setProperty('display', 'none', 'important');
      } else if (el.hasAttribute(COLLAPSED_ATTR)) {
        el.removeAttribute(COLLAPSED_ATTR);
        el.style.removeProperty('display');
      }
    }
  }

  /** Classes on the item's own author link (set, and withdrawn when a module unmarks). */
  private applyAuthorMarks(id: string, { kind, host }: Tracked): void {
    if (!this.marked.get(id)?.size && !this.deco.authorClasses(id).length) return;
    const anchor = this.authorAnchor(kind, host);
    const want = new Set(this.deco.authorClasses(id));
    for (const cls of this.marked.get(id) ?? []) if (!want.has(cls)) anchor?.classList.remove(cls);
    for (const cls of want) anchor?.classList.add(cls);
    if (anchor instanceof HTMLElement) this.explainMarks(anchor, want);
    this.marked.set(id, want);
  }

  /** Say what the highlight means, unless Reddit's own link already carries a tooltip. */
  private explainMarks(anchor: HTMLElement, want: ReadonlySet<string>): void {
    const own = anchor.title !== '' && !anchor.title.startsWith('REScue:');
    if (own) return;
    for (const cls of want) {
      const note = hint.authorMark(cls);
      if (note) {
        if (anchor.title !== note) anchor.title = note;
        return;
      }
    }
    if (anchor.title) anchor.removeAttribute('title');
  }

  private applyHidden(id: string, el: HTMLElement): void {
    const reason = this.deco.hiddenReason(id);
    if (reason && !this.deco.revealing()) {
      el.setAttribute(HIDDEN_ATTR, reason);
      el.style.setProperty('display', 'none', 'important');
      el.style.removeProperty('outline');
    } else if (reason) {
      // Revealed: shown and outlined. The reason is the chip's tooltip, never the whole item's.
      el.setAttribute(HIDDEN_ATTR, reason);
      el.style.removeProperty('display');
      el.style.setProperty('outline', '2px dashed var(--rescue-warn, #c90)');
    } else if (el.hasAttribute(HIDDEN_ATTR)) {
      el.removeAttribute(HIDDEN_ATTR);
      el.style.removeProperty('display');
      el.style.removeProperty('outline');
    }
    for (const cls of this.deco.classes(id)) el.classList.add(cls);
  }

  /**
   * Reddit's comment meta line is a non-wrapping flex row; the words REScue adds after the author
   * and time (tag, vote tally, save-RES, parent link, ...) run past its end on a narrow page and
   * are clipped. Let the row wrap so they drop to the next line instead (light DOM, inline style).
   * The same goes for a post's credit-bar row that holds the time (a thread's header at 820px).
   */
  private wrapMeta(authorLink: Element | null): void {
    this.wrapRow(authorLink?.closest(bySlot(C.slots.commentMeta)) ?? null);
  }

  private wrapRow(row: Element | null): void {
    if (row instanceof HTMLElement && row.style.flexWrap !== 'wrap') row.style.flexWrap = 'wrap';
  }

  /**
   * The old Reddit look draws its own author link, title link and end-of-tagline mark in the post
   * (marked with `data-rescue-anchor`); decorations go after those while they exist, because
   * Reddit's own credit bar and title are hidden then. Null when the skin has not mounted them.
   */
  private skinAnchor(host: Element, which: SkinAnchor): Element | null {
    return host.querySelector(`[${ANCHOR_ATTR}="${which}"]`);
  }

  private applyDecorations(id: string, { kind, host }: Tracked): void {
    const skinAuthor = kind === 'post' ? this.skinAnchor(host, 'author') : null;
    const link = skinAuthor ?? this.authorAnchor(kind, host);
    if (kind === 'comment') this.wrapMeta(link);
    // Posts: after the authorName wrapper (or inside the author's list item), not after the link,
    // which sits in a block-level tracker (see the C.postAuthorLink notes).
    const wrapper =
      kind === 'post' && !skinAuthor ? link?.closest(bySlot(C.slots.postAuthorName)) : null;
    const li =
      kind === 'post' && link && !wrapper && !skinAuthor ? link.closest(C.postAuthorItem) : null;
    const authorItem = li && li.closest(C.post) === host ? li : null;
    // Each anchor trails the nodes placed after it, so several nodes keep their order.
    let after: Element | null = wrapper ?? (authorItem ? null : link);
    let titleAfter: Element | null = null;
    const search = kind === 'post' && isSearchPost(host);
    const skinEnd = kind === 'post' ? this.skinAnchor(host, 'end') : null;
    let timeAfter: Element | null =
      kind === 'post' ? (skinEnd ?? this.postTime(host, search)) : null;
    let domainAfter = kind === 'post' ? this.skinAnchor(host, 'domain') : null;
    for (const slot of PLACEMENT_ORDER) {
      for (const node of this.deco.slot(id, slot)) {
        this.placed.add(node);
        if (slot === 'domain' && domainAfter) {
          this.placeAfter(node, domainAfter);
          if (node instanceof Element) domainAfter = node;
          continue;
        }
        if (search) {
          // A search result has no shadow slots to fall back on: no anchor, no placement.
          if (slot === 'title') titleAfter = this.placeAfterSearchTitle(node, host, titleAfter);
          else if (timeAfter) {
            this.placeAfter(node, timeAfter);
            if (node instanceof Element) timeAfter = node;
          }
          continue;
        }
        if (slot === 'author' && authorItem) {
          // Signed-in listing design: inline at the end of the author's own list item.
          if (node instanceof Element) node.removeAttribute(SLOT_ATTR);
          if (node.parentNode !== authorItem) authorItem.appendChild(node);
        } else if (slot === 'author' && after) {
          this.placeAfter(node, after);
          if (node instanceof Element) after = node;
        } else if (slot === 'title' && kind === 'post') {
          titleAfter = this.placeAfterTitle(node, host, titleAfter);
        } else if (kind === 'post' && timeAfter) {
          // Tagline and author fallback: inline after the time, inside the credit bar's left group.
          this.placeAfter(node, timeAfter);
          this.wrapRow(node.parentElement);
          if (node instanceof Element) timeAfter = node;
        } else this.placeInSlot(node, host, this.slotName(kind, slot), kind);
      }
    }
  }

  /** The post's own relative-time element inside its own credit bar, or null. */
  private postTime(host: Element, search: boolean): Element | null {
    if (search) return searchTimeElement(host);
    const bar = this.ownSlotElement(host, C.slots.postCredit);
    if (!bar) return null;
    for (const el of bar.querySelectorAll(C.postTime)) if (!this.placed.has(el)) return el;
    return null;
  }

  /**
   * Title decorations go right after Reddit's own title element. Verified live 2026-10-15: on
   * listings the title sits inside a wrapper (the post's shadow root has no `title` slot there), on
   * thread pages it is a direct child slotted into `title`; a sibling renders in both cases as long
   * as it carries the same slot when it is a direct child of the post.
   */
  private placeAfterTitle(node: Node, host: Element, prev: Element | null): Element | null {
    const own =
      prev ?? this.skinAnchor(host, 'title') ?? this.ownSlotElement(host, C.slots.postTitle);
    if (!own) {
      this.placeInSlot(node, host, C.slots.postTitle, 'post');
      return prev;
    }
    if (node instanceof Element) {
      if (own.parentElement === host) node.setAttribute(SLOT_ATTR, C.slots.postTitle);
      else node.removeAttribute(SLOT_ATTR);
    }
    if (own.nextSibling !== node) own.after(node);
    return node instanceof Element ? node : prev;
  }

  /** Search results: title decorations go right after the result's own title text anchor. */
  private placeAfterSearchTitle(node: Node, host: Element, prev: Element | null): Element | null {
    const own = prev ?? searchTitleAnchor(host);
    if (!own) return prev;
    this.placeAfter(node, own);
    return node instanceof Element ? node : prev;
  }

  /** The slot a decoration goes into; comments have a single meta line for tagline and title. */
  private slotName(kind: ItemKind, slot: Slot): string {
    if (kind === 'post' && slot === 'title') return C.slots.postTitle;
    return kind === 'post' ? C.slots.postCredit : C.slots.commentMeta;
  }

  private placeAfter(node: Node, anchor: Element): void {
    if (node instanceof Element) node.removeAttribute(SLOT_ATTR);
    if (anchor.nextSibling !== node) anchor.after(node);
  }

  /**
   * Slot decorations go INSIDE Reddit's own slot element (its credit bar / meta line). Verified
   * live 2026-10-15: on listings the post's shadow root has no `credit-bar` slot, so an element
   * slotted onto the post itself never renders, while a child of Reddit's own credit-bar element
   * renders on listings, threads and comments alike. Slotting onto the host is only the fallback
   * when Reddit's element is missing.
   */
  private placeInSlot(node: Node, host: Element, slotName: string, kind: ItemKind): void {
    const own = this.ownSlotElement(host, slotName);
    if (own) {
      if (node instanceof Element) node.removeAttribute(SLOT_ATTR);
      if (node.parentNode !== own) own.appendChild(node);
      return;
    }
    // A profile comment only has a meta line when Reddit rendered one.
    if (kind === 'profileComment') return;
    if (node instanceof Element) node.setAttribute(SLOT_ATTR, slotName);
    if (node.parentNode !== host) host.appendChild(node);
  }

  /** Reddit's own `[slot=name]` element belonging to this item (not to an item nested inside it). */
  private ownSlotElement(host: Element, slotName: string): Element | null {
    // Document order puts the item's own slot elements before those of replies nested inside it,
    // so the first match almost always answers without listing the whole subtree.
    const first = host.querySelector(bySlot(slotName));
    if (!first) return null;
    if (!this.placed.has(first) && first.parentElement?.closest(ITEM_SELECTOR) === host)
      return first;
    for (const el of host.querySelectorAll(bySlot(slotName))) {
      if (this.placed.has(el)) continue;
      const item = el.parentElement?.closest(ITEM_SELECTOR);
      if (item === host) return el;
    }
    return null;
  }

  /** The item's own author link, or null (profile comments have none). */
  private authorAnchor(kind: ItemKind, host: Element): Element | null {
    if (kind === 'post') {
      const skin = this.skinAnchor(host, 'author');
      if (skin) return skin;
      if (isSearchPost(host)) return null; // results show no author link (the name is only in JSON)
      // The first of the post's own credit-bar /user/ links that shows text: signed-in listings
      // put an avatar link (no text) first.
      for (const el of host.querySelectorAll(C.postAuthorLink))
        if (!this.placed.has(el) && el.closest(C.post) === host && el.textContent?.trim())
          return el;
      return null;
    }
    if (kind !== 'comment') return null;
    const first = host.querySelector(bySlot(C.slots.commentMeta));
    if (!first) return null;
    if (!this.placed.has(first) && first.closest(C.comment) === host) {
      const link = first.querySelector(C.commentAuthorLink);
      if (link) return link;
    }
    for (const meta of host.querySelectorAll(bySlot(C.slots.commentMeta))) {
      if (this.placed.has(meta) || meta.closest(C.comment) !== host) continue;
      const link = meta.querySelector(C.commentAuthorLink);
      if (link) return link;
    }
    return null;
  }

  reset(): void {
    this.items.clear();
    this.marked.clear();
    this.collapsedIds.clear();
    this.sizeAtPrune = 0;
  }
}
