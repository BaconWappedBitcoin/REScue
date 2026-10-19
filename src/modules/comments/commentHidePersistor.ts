/**
 * commentHidePersistor (RES commentHidePersistor, US6): remember the comments you collapsed and
 * collapse them again next time. Reddit collapses a comment with the `open` state of a light-DOM
 * <details> that belongs to it (contracts: comment.details, verified live 2026-10-15), so REScue
 * listens for that element's `toggle` event to learn what you collapse and re-open. On a revisit
 * it sets `details.open = false`; if the comment is not collapsed a frame later it clicks Reddit's
 * own <summary> instead (comment.collapseApply, unproven). FAIL-SAFE: if neither works nothing
 * breaks and the remembered collapse is kept; a change in the first seconds after REScue's own
 * attempt is never taken for the reader re-opening the comment. Ported in spirit from RES
 * lib/modules/commentHidePersistor.js (GPL-3.0, the RES contributors, commit 4defffc); the code
 * is new.
 */
import { defineModule, type ModuleContext, type SharedData } from '../../core/types';
import { collapseComment, isNativeCollapsed, watchCollapseToggles } from '../../model/access';

/** Remembered collapses, newest last (storage-schema.md: `collapsed`). */
export type CollapsedMap = Record<string, 1>;

export const COLLAPSED_MAX = 20_000;
/** A change this soon after REScue set the marker is Reddit reacting to it, not the reader. */
export const APPLY_GRACE_MS = 2000;

export function sanitizeCollapsed(raw: unknown): CollapsedMap {
  const out: CollapsedMap = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const id of Object.keys(raw)) if (/^t1_[A-Za-z0-9_]+$/.test(id)) out[id] = 1;
  return out;
}

/** The map with one comment added or removed; the oldest entries go beyond the cap. */
export function withCollapsed(
  map: CollapsedMap,
  id: string,
  on: boolean,
  max = COLLAPSED_MAX,
): CollapsedMap {
  const { [id]: _drop, ...rest } = map;
  if (!on) return rest;
  const entries = Object.keys(rest);
  const kept = entries.length >= max ? entries.slice(entries.length - max + 1) : entries;
  const out: CollapsedMap = {};
  for (const k of kept) out[k] = 1;
  out[id] = 1;
  return out;
}

interface State {
  data: SharedData;
  stored: CollapsedMap;
  appliedAt: Map<string, number>;
  stop: () => void;
  chain: Promise<void>;
}

let state: State | null = null;

function persist(s: State, id: string, on: boolean): void {
  s.stored = withCollapsed(s.stored, id, on);
  s.chain = s.chain.then(async () => {
    const fresh = sanitizeCollapsed(await s.data.get<unknown>('collapsed'));
    s.data.set('collapsed', withCollapsed(fresh, id, on));
  });
}

/** The reader (or Reddit) collapsed / re-opened a comment. */
function onToggle(s: State, id: string, collapsed: boolean): void {
  const sinceApply = Date.now() - (s.appliedAt.get(id) ?? -Infinity);
  if (sinceApply < APPLY_GRACE_MS) return;
  if (collapsed !== (s.stored[id] === 1)) persist(s, id, collapsed);
}

/** Collapse a remembered comment that is open. Retries once when Reddit has not rendered it yet. */
function reapply(s: State, id: string, el: Element, retry = true): void {
  if (s.stored[id] !== 1 || isNativeCollapsed(el) !== false) {
    if (retry && isNativeCollapsed(el) === null && s.stored[id] === 1)
      setTimeout(() => state === s && reapply(s, id, el, false), 300);
    return;
  }
  void collapseComment(el, () => s.appliedAt.set(id, Date.now()));
}

function reset(s: State): void {
  s.appliedAt.clear();
}

export const commentHidePersistor = defineModule({
  id: 'commentHidePersistor',
  resId: 'commentHidePersistor',
  category: 'comments',
  title: 'Remember collapsed comments',
  description:
    'Remembers, on this device, the comments you collapse and collapses them again when you come back. It watches Reddit’s own collapse control and, on a revisit, closes it again (by clicking Reddit’s collapse bar if closing it directly does not work). Re-collapsing on a revisit has not been confirmed on the live site; if it does not work, the comment simply stays open.',
  enabledByDefault: true,
  options: {},

  async init(ctx: ModuleContext) {
    const s: State = {
      data: ctx.data,
      stored: sanitizeCollapsed(await ctx.data.get<unknown>('collapsed')),
      appliedAt: new Map(),
      stop: () => {},
      chain: Promise.resolve(),
    };
    s.stop = watchCollapseToggles((id, collapsed) => onToggle(s, id, collapsed));
    state = s;
  },

  onItems(batch) {
    const s = state;
    if (!s) return;
    for (const c of batch.comments) reapply(s, c.id, c.source);
  },

  onRoute() {
    if (state) reset(state);
  },

  dispose() {
    state?.stop();
    state = null;
  },
});
