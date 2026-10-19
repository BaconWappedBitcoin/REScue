import { describe, expect, it } from 'vitest';
import { defaultProfile, mergeProfileChange, type SettingsProfile } from '../../src/core/settings';

const profile = (p: Partial<SettingsProfile> = {}): SettingsProfile => ({
  ...defaultProfile(),
  ...p,
});

describe('mergeProfileChange (read-modify-write of only the changed keys)', () => {
  it('keeps an option another tab saved while applying this tab’s unrelated change', () => {
    const base = profile({ modules: { neutralityFilter: { enabled: true } } });
    const current = profile({
      modules: { neutralityFilter: { enabled: true, options: { showLeanScore: true } } },
    });
    const next = profile({
      modules: { neutralityFilter: { enabled: true, options: { showLean: true } } },
    });
    expect(mergeProfileChange(current, base, next).modules.neutralityFilter).toEqual({
      enabled: true,
      options: { showLeanScore: true, showLean: true },
    });
  });

  it('removes a key this tab reset, and only that key', () => {
    const base = profile({ modules: { m: { options: { a: true, b: 2 } } } });
    const next = profile({ modules: { m: { options: { b: 2 } } } });
    const current = profile({ modules: { m: { options: { a: true, b: 2, c: 'x' } } } });
    expect(mergeProfileChange(current, base, next).modules.m?.options).toEqual({ b: 2, c: 'x' });
  });

  it('leaves modules, keybindings and flags this tab did not touch as stored', () => {
    const base = profile();
    const current = profile({
      modules: { other: { enabled: true } },
      keybindings: { go: ['g'] },
      syncEnabled: true,
    });
    const next = profile({ modules: { m: { enabled: true } } });
    const out = mergeProfileChange(current, base, next);
    expect(out.modules).toEqual({ other: { enabled: true }, m: { enabled: true } });
    expect(out.keybindings).toEqual({ go: ['g'] });
    expect(out.syncEnabled).toBe(true);
  });

  it('applies a reset of a whole module and a changed keybinding or sync flag', () => {
    const base = profile({ modules: { m: { enabled: true } }, keybindings: { go: ['g'] } });
    const next = profile({ modules: {}, keybindings: { go: ['h'] }, syncEnabled: true });
    const current = profile({ modules: { m: { enabled: true }, k: { enabled: false } } });
    const out = mergeProfileChange(current, base, next);
    expect(out.modules).toEqual({ k: { enabled: false } });
    expect(out.keybindings).toEqual({ go: ['h'] });
    expect(out.syncEnabled).toBe(true);
  });

  it('is the identity change when nothing differs, and does not mutate its inputs', () => {
    const current = profile({ modules: { m: { options: { a: 1 } } } });
    const snapshot = JSON.stringify(current);
    expect(mergeProfileChange(current, profile(), profile())).toEqual(current);
    expect(JSON.stringify(current)).toBe(snapshot);
  });
});
