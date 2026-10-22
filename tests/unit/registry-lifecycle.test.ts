/**
 * The module registry through createRegistry (not the module harness): routes, stop, the reload
 * notice, failures inside settingsChanged and the three-strike rule across hooks.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRegistry, type RegistryDeps } from '../../src/core/registry';
import type { ItemBatch, ModuleContext, ModuleDefinition, Route } from '../../src/core/types';

const batch = (): ItemBatch => ({ posts: [], comments: [], profileComments: [] });
const route = (kind: Route['kind']): Route => ({ kind }) as Route;

function deps(enabled: Record<string, boolean> = {}) {
  const notices: string[] = [];
  const reloads: Array<[string, boolean]> = [];
  let made = 0;
  const d: RegistryDeps = {
    isEnabled: (def) => enabled[def.id] ?? def.enabledByDefault,
    notify: (msg) => notices.push(msg),
    makeContext: (def) => ({ moduleId: def.id, n: ++made, route: route('front') }) as never,
    reloadNeeded: (def, on) => reloads.push([def.id, on]),
  };
  return { d, notices, reloads, enabled };
}

const mod = (id: string, extra: Partial<ModuleDefinition> = {}): ModuleDefinition => ({
  id,
  category: 'core',
  title: id,
  description: '',
  enabledByDefault: true,
  options: {},
  ...extra,
});

const boom = () => {
  throw new Error('boom');
};

describe('registry.route', () => {
  it('gives every running module the new route, in its context and through onRoute', async () => {
    const { d } = deps();
    const seen: string[] = [];
    const onRoute = vi.fn((r: Route, ctx: ModuleContext) =>
      seen.push(`${r.kind}/${ctx.route.kind}`),
    );
    const onItems = vi.fn((_b: ItemBatch, ctx: ModuleContext) =>
      seen.push(`items@${ctx.route.kind}`),
    );
    const reg = createRegistry(d);
    reg.register(mod('a', { onRoute, onItems }));
    reg.register(mod('off', { enabledByDefault: false, onRoute }));
    await reg.start();
    reg.route(route('thread'));
    reg.items(batch());
    expect(seen).toEqual(['thread/thread', 'items@thread']);
    expect(onRoute).toHaveBeenCalledOnce();
  });

  it('counts onRoute and onItems failures together: the third turns the module off', async () => {
    const { d, notices } = deps();
    const onRoute = vi.fn(boom);
    const onItems = vi.fn(boom);
    const reg = createRegistry(d);
    reg.register(mod('flaky', { onRoute, onItems }));
    await reg.start();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    reg.route(route('thread'));
    reg.items(batch());
    expect(reg.status('flaky')).toBe('ok');
    reg.route(route('front'));
    expect(reg.status('flaky')).toBe('disabled');
    expect(notices).toEqual([
      expect.stringContaining('"flaky" (flaky) was turned off for this page: 3 errors'),
    ]);
    reg.route(route('all'));
    reg.items(batch());
    expect(onRoute).toHaveBeenCalledTimes(2);
    expect(onItems).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it('disposes a module that strikes out, and a failing dispose stops nothing else', async () => {
    const { d } = deps();
    const dispose = vi.fn(boom);
    const steady = vi.fn();
    const reg = createRegistry(d);
    reg.register(mod('flaky', { onItems: boom, dispose }));
    reg.register(mod('steady', { onItems: steady }));
    await reg.start();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let i = 0; i < 4; i++) reg.items(batch());
    expect(dispose).toHaveBeenCalledOnce();
    expect(steady).toHaveBeenCalledTimes(4);
    vi.restoreAllMocks();
  });
});

describe('registry.stop', () => {
  it('disposes running modules only, and they get nothing after', async () => {
    const { d } = deps({ off: false });
    const live = vi.fn();
    const off = vi.fn();
    const failed = vi.fn();
    const onItems = vi.fn();
    const reg = createRegistry(d);
    reg.register(mod('live', { dispose: live, onItems }));
    reg.register(mod('off', { dispose: off }));
    reg.register(mod('failed', { init: boom, dispose: failed }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await reg.start();
    expect(failed).toHaveBeenCalledOnce(); // disposed when it was turned off
    reg.stop();
    expect(live).toHaveBeenCalledOnce();
    expect(off).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledOnce();
    reg.items(batch());
    reg.route(route('thread'));
    expect(onItems).not.toHaveBeenCalled();
    expect(reg.report().map((r) => r.status)).toEqual(['inactive', 'inactive', 'inactive']);
    vi.restoreAllMocks();
  });

  it('keeps going past a dispose that throws, and a restart starts the strike count afresh', async () => {
    const { d } = deps();
    const second = vi.fn();
    const onItems = vi.fn(boom);
    const reg = createRegistry(d);
    reg.register(mod('a', { dispose: boom, onItems }));
    reg.register(mod('b', { dispose: second }));
    await reg.start();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    reg.items(batch());
    reg.items(batch());
    expect(() => reg.stop()).not.toThrow();
    expect(second).toHaveBeenCalledOnce();
    await reg.start();
    reg.items(batch());
    reg.items(batch());
    expect(reg.status('a')).toBe('ok'); // two strikes on this page, not four
    vi.restoreAllMocks();
  });
});

describe('registry reload notice (modules without onSettings)', () => {
  it('asks once per switch, and again after the reader switches back and forth', async () => {
    const { d, reloads, enabled } = deps({ a: true, b: false });
    const reg = createRegistry(d);
    reg.register(mod('a'));
    reg.register(mod('b'));
    await reg.start();
    enabled.a = false;
    await reg.settingsChanged();
    await reg.settingsChanged();
    expect(reloads).toEqual([['a', false]]);
    // Switched back on before a reload: nothing to reload for, and the next switch asks again.
    enabled.a = true;
    await reg.settingsChanged();
    expect(reloads).toEqual([['a', false]]);
    enabled.a = false;
    await reg.settingsChanged();
    expect(reloads).toEqual([
      ['a', false],
      ['a', false],
    ]);
    // A module that was off when the page started asks to be loaded.
    enabled.b = true;
    await reg.settingsChanged();
    await reg.settingsChanged();
    expect(reloads.slice(2)).toEqual([['b', true]]);
    expect(reg.status('b')).toBe('inactive');
  });

  it('never asks for a module that failed on this page', async () => {
    const { d, reloads, enabled } = deps();
    const reg = createRegistry(d);
    reg.register(mod('bad', { init: boom }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await reg.start();
    enabled.bad = false;
    await reg.settingsChanged();
    enabled.bad = true;
    await reg.settingsChanged();
    expect(reloads).toEqual([]);
    vi.restoreAllMocks();
  });
});

describe('registry.settingsChanged failures', () => {
  it('an init that throws when switched on turns that module off; the rest carry on', async () => {
    const { d, notices, enabled } = deps({ bad: false, slow: false });
    const later = vi.fn();
    const reg = createRegistry(d);
    reg.register(mod('bad', { init: boom, onSettings: () => {} }));
    reg.register(
      mod('slow', {
        init: async () => Promise.reject(new Error('async boom')),
        onSettings: () => {},
      }),
    );
    reg.register(mod('good', { init: later, onSettings: () => {} }));
    await reg.start();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    enabled.bad = true;
    enabled.slow = true;
    await reg.settingsChanged(); // does not throw: the failures are contained
    expect(reg.status('bad')).toBe('disabled');
    expect(reg.status('slow')).toBe('disabled');
    expect(reg.status('good')).toBe('ok');
    expect(notices).toEqual([
      expect.stringContaining('"bad" (bad) was turned off for this page: it failed to start'),
      expect.stringContaining('"slow" (slow) was turned off for this page: it failed to start'),
    ]);
    // Turned off for the page: switching it again does not retry it.
    await reg.settingsChanged();
    expect(reg.status('bad')).toBe('disabled');
    vi.restoreAllMocks();
  });

  it('onSettings failures count as strikes, with a fresh context each time', async () => {
    const { d } = deps();
    const ctxs: number[] = [];
    const reg = createRegistry(d);
    reg.register(
      mod('s', {
        onSettings: (ctx) => {
          ctxs.push((ctx as unknown as { n: number }).n);
          throw new Error('x');
        },
      }),
    );
    await reg.start();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (let i = 0; i < 4; i++) await reg.settingsChanged();
    expect(ctxs).toEqual([2, 3, 4]);
    expect(reg.status('s')).toBe('disabled');
    vi.restoreAllMocks();
  });
});
