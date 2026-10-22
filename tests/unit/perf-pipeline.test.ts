import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pipeline, sliceBatch } from '../../src/core/pipeline';
import { changedModules, createRegistry, rerunSet, settled } from '../../src/core/registry';
import { defaultProfile, type SettingsProfile } from '../../src/core/settings';
import type { ItemBatch, ModuleDefinition } from '../../src/core/types';
import type { Comment } from '../../src/model/types';
import { mount } from '../fixtures/pages';

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** Flat comment markup: `depth` alone says who replies to whom. */
const flat = (specs: Array<[id: string, depth: number]>): string =>
  specs
    .map(
      ([id, depth]) =>
        `<shreddit-comment thingid="${id}" postid="t3_p" author="u${id}" score="1" depth="${depth}" permalink="/r/x/comments/p/t/${id}/"><div slot="comment">${id}</div></shreddit-comment>`,
    )
    .join('');

const ids = (b: ItemBatch): string[] => [
  ...b.posts.map((p) => p.id),
  ...b.comments.map((c) => c.id),
];

/** A pipeline whose waits between slices are run by hand. */
function sliced(sliceSize: number) {
  const waits: Array<() => void> = [];
  const batches: ItemBatch[] = [];
  const timings: number[] = [];
  const pipeline = new Pipeline({
    onBatch: (b) => batches.push(b),
    schedule: () => undefined,
    yieldTo: (cb) => void waits.push(cb),
    onTiming: (_ms, b) => timings.push(b.comments.length),
    sliceSize,
  });
  const next = () => waits.shift()?.();
  return { pipeline, waits, batches, timings, next };
}

const SEVEN: Array<[string, number]> = [
  ['c0', 0],
  ['c1', 1],
  ['c2', 2],
  ['c3', 0],
  ['c4', 1],
  ['c5', 0],
  ['c6', 1],
];

describe('pipeline: large batches go over in slices', () => {
  it('hands the first slice over at once and the rest after a wait each, timing each slice', () => {
    mount(`<div>${flat(SEVEN)}</div>`);
    const { pipeline, waits, batches, timings, next } = sliced(3);
    const all = pipeline.flush();
    expect(all.comments).toHaveLength(7); // flush still answers the whole batch
    expect(batches.map(ids)).toEqual([['c0', 'c1', 'c2']]);
    expect(waits).toHaveLength(1);
    next();
    next();
    expect(batches.map(ids)).toEqual([['c0', 'c1', 'c2'], ['c3', 'c4', 'c5'], ['c6']]);
    expect(timings).toEqual([3, 3, 1]);
    expect(pipeline.pending()).toBe(0);
  });

  it('keeps a small batch in one synchronous delivery', () => {
    mount(`<div>${flat(SEVEN)}</div>`);
    const { pipeline, waits, batches } = sliced(200);
    pipeline.flush();
    expect(batches).toHaveLength(1);
    expect(waits).toHaveLength(0);
  });

  it('drops the slices still waiting when the page changes', () => {
    mount(`<div>${flat(SEVEN)}</div>`);
    const { pipeline, batches, next } = sliced(3);
    pipeline.flush();
    pipeline.reset();
    next(); // the wait that was already running finds nothing to do
    expect(batches).toHaveLength(1);
    expect(pipeline.pending()).toBe(0);
  });

  it('puts on-screen items first, with their ancestors, and the rest in document order', () => {
    mount(`<div>${flat(SEVEN)}</div>`);
    const pipeline = new Pipeline({ onBatch: () => {}, schedule: () => undefined });
    const batch = pipeline.flush();
    // c4 is the first comment whose top is on screen: c3 (just above it) starts the window.
    const tops: Record<string, number> = { c0: -500, c1: -400, c2: -300, c3: -100, c4: 20 };
    for (const c of batch.comments) {
      const top = tops[c.id] ?? 200 + Number(c.id.slice(1));
      c.source.getBoundingClientRect = () => ({ top }) as DOMRect;
    }
    const slices = sliceBatch(batch, 2);
    expect(slices.map(ids)).toEqual([['c3', 'c4'], ['c0', 'c1'], ['c2', 'c5'], ['c6']]);
    // A window inside a reply chain pulls its ancestors forward: c1's parent c0 comes with it.
    for (const c of batch.comments)
      c.source.getBoundingClientRect = () => ({ top: c.id >= 'c2' ? 10 : -10 }) as DOMRect;
    const deep = sliceBatch(batch, 2);
    expect(deep[0]!.comments.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
    const order = deep.flatMap((b) => b.comments.map((c) => c.id));
    const at = (id: string) => order.indexOf(id);
    for (const c of batch.comments as Comment[])
      if (c.parentId) expect(at(c.parentId)).toBeLessThan(at(c.id));
  });
});

describe('pipeline.replay', () => {
  it('hands the items already emitted to the sink only, without the ones that left the page', () => {
    mount(`<div id="t">${flat(SEVEN)}</div>`);
    const { pipeline, batches, next } = sliced(4);
    pipeline.flush();
    next();
    expect(batches).toHaveLength(2);
    document.querySelector('[thingid="c6"]')!.remove();
    const seen: ItemBatch[] = [];
    const all = pipeline.replay((b) => seen.push(b));
    expect(all.comments.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
    next();
    expect(seen.map(ids)).toEqual([
      ['c0', 'c1', 'c2', 'c3'],
      ['c4', 'c5'],
    ]);
    expect(batches).toHaveLength(2); // nothing went to onBatch again
    // Nothing is stamped again either: a flush finds nothing new.
    expect(pipeline.flush().comments).toHaveLength(0);
  });

  it('forgets everything on a route change', () => {
    mount(`<div>${flat(SEVEN)}</div>`);
    const { pipeline } = sliced(200);
    pipeline.flush();
    pipeline.reset();
    const sink = vi.fn();
    expect(pipeline.replay(sink).comments).toHaveLength(0);
    expect(sink).not.toHaveBeenCalled();
  });
});

function mod(id: string, extra: Partial<ModuleDefinition> = {}): ModuleDefinition {
  return {
    id,
    category: 'core',
    title: id,
    description: '',
    enabledByDefault: true,
    options: {},
    ...extra,
  };
}

describe('registry: which modules a settings change re-runs', () => {
  it('names modules switched on and modules whose options changed, and delivers to them only', async () => {
    const enabled: Record<string, boolean> = { a: true, b: true, c: false };
    const opts: Record<string, Record<string, unknown>> = { a: { x: 1 }, b: { y: 1 }, c: {} };
    const reg = createRegistry({
      isEnabled: (def) => enabled[def.id] ?? true,
      notify: () => {},
      makeContext: (def) => ({ moduleId: def.id, options: { ...opts[def.id] } }) as never,
    });
    const got: string[] = [];
    for (const id of ['a', 'b', 'c'])
      reg.register(mod(id, { onSettings: () => {}, onItems: () => void got.push(id) }));
    await reg.start();
    expect([...(await reg.settingsChanged())]).toEqual([]);
    opts.a = { x: 2 };
    enabled.c = true;
    const rerun = await reg.settingsChanged();
    expect([...rerun].sort()).toEqual(['a', 'c']);
    reg.items({ posts: [], comments: [], profileComments: [] }, rerun);
    expect(got.sort()).toEqual(['a', 'c']);
  });

  it('compares profiles per module, and adds the modules that read a changed one', () => {
    const a: SettingsProfile = defaultProfile();
    const b: SettingsProfile = {
      ...a,
      modules: { userHighlight: { enabled: true, options: { friends: ['x'] } } },
    };
    const changed = changedModules(a, b);
    expect([...changed!]).toEqual(['userHighlight']);
    expect([...rerunSet(new Set(['userHighlight']), changed)!].sort()).toEqual([
      'commentNavigator',
      'filteReddit',
      'userHighlight',
    ]);
    // A change outside the modules (key bindings) re-runs every module.
    expect(changedModules(a, { ...a, keybindings: { x: ['y'] } })).toBeNull();
    expect(rerunSet(new Set(), null)).toBeNull();
  });
});

describe('settled: one run per burst of settings messages', () => {
  it('waits for the burst to end and never runs twice at once', async () => {
    vi.useFakeTimers();
    let running = 0;
    let most = 0;
    let runs = 0;
    const follow = async () => {
      running++;
      most = Math.max(most, running);
      runs++;
      await new Promise((r) => setTimeout(r, 500));
      running--;
    };
    const s = settled(follow, 150, () => {});
    s.poke();
    await vi.advanceTimersByTimeAsync(100);
    s.poke();
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(0); // still settling
    await vi.advanceTimersByTimeAsync(60);
    expect(runs).toBe(1);
    s.poke(); // during the run: a second run follows the first
    await vi.advanceTimersByTimeAsync(200);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(runs).toBe(2);
    expect(most).toBe(1);
    s.poke();
    s.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(2);
  });
});
