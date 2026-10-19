/**
 * showParent (RES showParent, US6): an "↑ parent" control on every reply. Hovering it opens a REScue
 * popup with the whole chain of parent comments (author, a copy of each parent's own body, and a
 * "goto comment" link on each; a copy of the element Reddit rendered, never markup built from page
 * text); clicking the control jumps to the immediate parent. Shift+P opens the popup for the
 * selected comment. The popup opens below the control or, by option, above it.
 * Ported in spirit from RES lib/modules/showParent.js (GPL-3.0, the RES contributors, commit
 * 4defffc); the code is new.
 */
import { h } from '../../core/dom';
import { hint, parentArrowText } from '../../core/hints';
import { DEFAULT_HOVER, HoverManager } from '../../core/hover';
import { defineModule } from '../../core/types';
import { ownBody } from '../../model/access';
import type { Comment } from '../../model/types';
import { linkButton, onClick } from './commentUi';

interface State {
  hover: HoverManager;
  comments: Map<string, Comment>;
  buttons: Map<string, HTMLElement>;
  unbind: Array<() => void>;
  direction: 'up' | 'down';
  thread: boolean;
  jump: (id: string) => void;
  decorate: (c: Comment, n: HTMLElement) => void;
}

let state: State | null = null;

/** The popup content for one parent: who wrote it and a copy of what they wrote. */
export function parentPreview(parent: Comment, goto?: (id: string) => void): HTMLElement | null {
  const body = ownBody(parent.source);
  if (!body) return null;
  const copy = body.cloneNode(true) as Element;
  copy.removeAttribute('slot');
  const box = h(
    'div',
    { class: 'rescue-parent-preview', title: hint.parentPreview },
    h('strong', null, parent.author ? `u/${parent.author}` : '[deleted]'),
  );
  if (goto) {
    const link = linkButton('rescue-parent-goto', 'goto comment', hint.gotoParent);
    onClick(link, () => goto(parent.id));
    box.append(' ', link);
  }
  box.append(copy);
  return box;
}

/** The comment's ancestors that are on the page, nearest first. */
export function parentChain(c: Comment, all: ReadonlyMap<string, Comment>): Comment[] {
  const chain: Comment[] = [];
  const seen = new Set<string>([c.id]);
  for (let p = c.parentId ? all.get(c.parentId) : undefined; p && !seen.has(p.id);) {
    chain.push(p);
    seen.add(p.id);
    p = p.parentId ? all.get(p.parentId) : undefined;
  }
  return chain;
}

/**
 * The popup content for a whole chain, with a line naming who replies to whom between entries. Below the control the
 * nearest parent comes first; above it the topmost does, so the chain reads down toward the reply.
 */
export function parentChainView(
  chain: readonly Comment[],
  direction: 'up' | 'down',
  goto: (id: string) => void,
): HTMLElement | null {
  const ordered = direction === 'up' ? [...chain].reverse() : [...chain];
  const box = h('div', { class: 'rescue-parent-chain' });
  box.style.cssText = 'max-height:60vh;overflow:auto;overflow-wrap:anywhere';
  for (const parent of ordered) {
    const preview = parentPreview(parent, goto);
    if (!preview) continue;
    if (box.childElementCount) {
      const arrow = h(
        'div',
        { class: 'rescue-parent-arrow', title: hint.parentArrow(direction) },
        parentArrowText(direction),
      );
      arrow.style.cssText = 'font-size:11px;color:var(--rescue-meta,#666);margin:4px 0';
      box.append(arrow);
    }
    box.append(preview);
  }
  return box.childElementCount ? box : null;
}

function content(s: State, c: Comment): () => Promise<HTMLElement | null> {
  return async () =>
    parentChainView(parentChain(c, s.comments), s.direction, (id) => {
      s.hover.close();
      s.jump(id);
    });
}

function attach(s: State, c: Comment): void {
  const parent = c.parentId ? s.comments.get(c.parentId) : undefined;
  if (c.depth === 0 || !parent) return;
  const btn = linkButton('rescue-show-parent', '↑ parent', hint.showParent);
  s.buttons.set(c.id, btn);
  s.unbind.push(s.hover.bind(btn, content(s, c)));
  onClick(btn, () => s.jump(parent.id));
  s.decorate(c, btn);
}

export const showParent = defineModule({
  id: 'showParent',
  resId: 'showParent',
  category: 'comments',
  title: 'Show parent',
  description:
    'Adds an “↑ parent” link to every reply. Hover it (or press Shift+P on the selected comment) to read the whole chain of comments being replied to, each with a “goto comment” link; click it to jump to the parent.',
  enabledByDefault: true,
  options: {
    hoverDelay: {
      type: 'number',
      default: 300,
      min: 0,
      max: 3000,
      title: 'Hover delay (ms)',
      advanced: true,
      description: 'How long to hover before the parent comment appears.',
    },
    fadeDelay: {
      type: 'number',
      default: 200,
      min: 0,
      max: 5000,
      title: 'Fade delay (ms)',
      advanced: true,
      description: 'How long the parent popup stays after the pointer leaves it, before it fades.',
    },
    fadeSpeed: {
      type: 'number',
      default: 700,
      min: 0,
      max: 5000,
      title: 'Fade speed (ms)',
      advanced: true,
      description: 'How long the fade-out takes.',
    },
    direction: {
      type: 'enum',
      default: 'down',
      title: 'Open the popup',
      values: [
        { value: 'down', label: 'Below the link' },
        { value: 'up', label: 'Above the link' },
      ],
    },
  },

  init(ctx) {
    const direction = ctx.options.direction === 'up' ? 'up' : 'down';
    const s: State = {
      hover: new HoverManager({
        ...DEFAULT_HOVER,
        name: 'showParent',
        openDelayMs: ctx.options.hoverDelay as number,
        fadeDelayMs: Math.max(0, Number(ctx.options.fadeDelay)),
        fadeSpeedMs: Math.max(0, Number(ctx.options.fadeSpeed)),
        width: 560,
        placement: direction === 'up' ? 'above' : 'below',
      }),
      comments: new Map(),
      buttons: new Map(),
      unbind: [],
      direction,
      thread: ctx.route.kind === 'thread',
      jump: (id) => void ctx.ui.selection().select(id),
      decorate: (c, n) => ctx.ui.decorate(c, 'tagline', n),
    };
    state = s;
    const selected = (): Comment | null => {
      const m = ctx.ui.selection().current();
      const c = m?.kind === 'comment' ? (m.model as Comment) : null;
      return c && c.depth > 0 && c.parentId && s.comments.has(c.parentId) ? c : null;
    };
    ctx.keys.register({
      id: 'showParent',
      title: 'Show the parent comments of the selected comment',
      defaultKeys: ['shift+p'],
      context: 'comments',
      enabled: () => state === s && s.thread && selected() !== null,
      run: () => {
        const c = selected();
        if (!c) return false;
        const anchor = s.buttons.get(c.id);
        void s.hover.open(anchor?.isConnected ? anchor : c.source, content(s, c));
      },
    });
  },

  onItems(batch) {
    const s = state;
    if (!s) return;
    for (const c of batch.comments) {
      s.comments.set(c.id, c);
      attach(s, c);
    }
  },

  onRoute(route) {
    const s = state;
    if (!s) return;
    s.thread = route.kind === 'thread';
    for (const stop of s.unbind) stop();
    s.unbind = [];
    s.comments.clear();
    s.buttons.clear();
    s.hover.close();
  },

  dispose() {
    if (state) {
      for (const stop of state.unbind) stop();
      state.hover.close();
    }
    state = null;
  },
});
