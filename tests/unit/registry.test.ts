import { describe, expect, it, vi } from 'vitest';
import { createRegistry, type RegistryDeps } from '../../src/core/registry';
import type { ModuleDefinition, ItemBatch } from '../../src/core/types';

const emptyBatch = (): ItemBatch => ({ posts: [], comments: [], profileComments: [] });

function deps(enabled: Record<string, boolean> = {}): RegistryDeps & { notices: string[] } {
  const notices: string[] = [];
  return {
    notices,
    isEnabled: (def) => enabled[def.id] ?? def.enabledByDefault,
    notify: (msg) => notices.push(msg),
    makeContext: (def) => ({ moduleId: def.id }) as never,
  };
}

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

describe('module registry', () => {
  it('inits enabled modules', async () => {
    const a = vi.fn();
    const reg = createRegistry(deps());
    reg.register(mod('a', { init: a }));
    await reg.start();
    expect(a).toHaveBeenCalledOnce();
    expect(reg.status('a')).toBe('ok');
  });

  it('skips disabled modules', async () => {
    const a = vi.fn();
    const reg = createRegistry(deps({ a: false }));
    reg.register(mod('a', { init: a }));
    await reg.start();
    expect(a).not.toHaveBeenCalled();
    expect(reg.status('a')).toBe('inactive');
  });

  it('disables a module whose dependency is missing or disabled, with a notice', async () => {
    const d = deps({ base: false });
    const reg = createRegistry(d);
    reg.register(mod('base'));
    reg.register(mod('child', { dependsOn: ['base'] }));
    reg.register(mod('orphan', { dependsOn: ['nope'] }));
    await reg.start();
    expect(reg.status('child')).toBe('disabled');
    expect(reg.status('orphan')).toBe('disabled');
    expect(d.notices.length).toBe(2);
  });

  it('isolates an init that throws: module disabled, others continue', async () => {
    const d = deps();
    const ok = vi.fn();
    const reg = createRegistry(d);
    reg.register(
      mod('bad', {
        init: () => {
          throw new Error('boom');
        },
      }),
    );
    reg.register(mod('good', { init: ok }));
    await reg.start();
    expect(reg.status('bad')).toBe('disabled');
    expect(reg.status('good')).toBe('ok');
    expect(ok).toHaveBeenCalledOnce();
    expect(d.notices.some((n) => n.includes('bad'))).toBe(true);
  });

  it('disables a module after 3 onItems errors in one page', async () => {
    const onItems = vi.fn(() => {
      throw new Error('x');
    });
    const other = vi.fn();
    const reg = createRegistry(deps());
    reg.register(mod('flaky', { onItems }));
    reg.register(mod('steady', { onItems: other }));
    await reg.start();
    for (let i = 0; i < 5; i++) reg.items(emptyBatch());
    expect(onItems).toHaveBeenCalledTimes(3);
    expect(reg.status('flaky')).toBe('disabled');
    expect(other).toHaveBeenCalledTimes(5);
  });

  it('applies health(): degraded keeps running, disabled stops', async () => {
    const onItems = vi.fn();
    const reg = createRegistry(deps());
    reg.register(
      mod('deg', { onItems, health: () => ({ status: 'degraded', failingContracts: ['x'] }) }),
    );
    reg.register(
      mod('dead', { onItems, health: () => ({ status: 'disabled', failingContracts: ['y'] }) }),
    );
    await reg.start();
    reg.items(emptyBatch());
    reg.checkHealth();
    reg.items(emptyBatch());
    expect(reg.status('deg')).toBe('degraded');
    expect(reg.status('dead')).toBe('disabled');
    expect(onItems).toHaveBeenCalledTimes(3);
  });

  it('rejects duplicate module ids', () => {
    const reg = createRegistry(deps());
    reg.register(mod('a'));
    expect(() => reg.register(mod('a'))).toThrow();
  });
});

describe('registry.settingsChanged', () => {
  it('calls onSettings for a running module and follows the switch off and on', async () => {
    const enabled = { live: true };
    const init = vi.fn();
    const onSettings = vi.fn();
    const dispose = vi.fn();
    const reg = createRegistry(deps(enabled));
    reg.register(mod('live', { init, onSettings, dispose }));
    await reg.start();
    await reg.settingsChanged();
    expect(onSettings).toHaveBeenCalledTimes(1);

    enabled.live = false;
    await reg.settingsChanged();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(reg.status('live')).toBe('inactive');
    await reg.settingsChanged();
    expect(onSettings).toHaveBeenCalledTimes(1);

    enabled.live = true;
    await reg.settingsChanged();
    expect(init).toHaveBeenCalledTimes(2);
    expect(reg.status('live')).toBe('ok');
  });

  it('leaves a module without onSettings alone', async () => {
    const dispose = vi.fn();
    const enabled = { live: true };
    const reg = createRegistry(deps(enabled));
    reg.register(mod('live', { dispose }));
    await reg.start();
    enabled.live = false;
    await reg.settingsChanged();
    expect(dispose).not.toHaveBeenCalled();
    expect(reg.status('live')).toBe('ok');
  });
});
