import { describe, expect, it, vi } from 'vitest';
import {
  createSettingsSave,
  defaultProfile,
  moduleOn,
  optionOf,
  resolveOptions,
  saveOrNotify,
  type SettingsProfile,
} from '../../src/core/settings';
import { defineModule, type ModuleDefinition } from '../../src/core/types';
import {
  compileCommentRules,
  type CommentRule,
} from '../../src/modules/listings/filteReddit/commentRules';
import { isFiltered } from '../../src/modules/listings/filteReddit/inline';
import {
  compileRules,
  ruleOn,
  type FilterRule,
} from '../../src/modules/listings/filteReddit/rules';

const withModules = (modules: SettingsProfile['modules']): SettingsProfile => ({
  ...defaultProfile(),
  modules,
});

describe('settings save', () => {
  it('rolls the in-memory profile back when the write fails', async () => {
    const before = defaultProfile();
    let profile = before;
    const save = createSettingsSave({
      profile: () => profile,
      setProfile: (p) => {
        profile = p;
      },
      read: async () => before,
      write: async () => {
        throw new Error('quota exceeded');
      },
    });
    const next = withModules({ a: { enabled: false } });
    await expect(save(next)).rejects.toThrow('quota exceeded');
    expect(profile).toBe(before);
  });

  it('keeps the merged profile after a successful write', async () => {
    let profile = defaultProfile();
    const written: SettingsProfile[] = [];
    const onSaved = vi.fn();
    const save = createSettingsSave({
      profile: () => profile,
      setProfile: (p) => {
        profile = p;
      },
      read: async () => withModules({ other: { enabled: true } }),
      write: async (p) => {
        written.push(p);
      },
      onSaved,
    });
    await save(withModules({ a: { enabled: false } }));
    expect(written[0]!.modules).toEqual({ other: { enabled: true }, a: { enabled: false } });
    expect(profile.modules).toEqual(written[0]!.modules);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('saveOrNotify shows an error notice when saving fails', async () => {
    const show = vi.fn();
    const ok = await saveOrNotify(
      {
        settings: { save: async () => Promise.reject(new Error('disk full')) },
        notices: { show },
      },
      defaultProfile(),
    );
    expect(ok).toBe(false);
    expect(show).toHaveBeenCalledWith(
      'REScue could not save your settings: disk full',
      expect.objectContaining({ kind: 'error' }),
    );
  });
});

const demo = defineModule({
  id: 'demo',
  category: 'core',
  title: 'Demo',
  description: 'demo',
  enabledByDefault: true,
  options: {
    flag: { type: 'boolean', default: true, title: 'Flag' },
    rows: {
      type: 'table',
      default: [],
      title: 'Rows',
      columns: [
        { key: 'name', title: 'Name', type: 'text' },
        { key: 'on', title: 'On', type: 'boolean' },
        { key: 'kind', title: 'Kind', type: 'enum', values: ['a', 'b'] },
        { key: 'tint', title: 'Tint', type: 'color' },
      ],
      validateRow: (row) => (row.name === 'bad' ? 'bad name' : null),
    },
  },
});
const off = defineModule({
  id: 'off',
  category: 'core',
  title: 'Off',
  description: 'off',
  enabledByDefault: false,
  options: {},
});
const view = (profile: SettingsProfile) => ({
  profile: () => profile,
  definitions: (): ModuleDefinition[] => [demo as ModuleDefinition, off],
});

describe('moduleOn / optionOf', () => {
  it('follows enabledByDefault and the stored switch', () => {
    expect(moduleOn(view(defaultProfile()), 'demo')).toBe(true);
    expect(moduleOn(view(defaultProfile()), 'off')).toBe(false);
    expect(moduleOn(view(withModules({ off: { enabled: true } })), 'off')).toBe(true);
    expect(moduleOn(view(withModules({ demo: { enabled: false } })), 'demo')).toBe(false);
    expect(moduleOn(view(defaultProfile()), 'missing')).toBe(false);
  });

  it('resolves an option with its default and validation', () => {
    expect(optionOf(view(defaultProfile()), 'demo', 'flag')).toBe(true);
    expect(
      optionOf(view(withModules({ demo: { options: { flag: false } } })), 'demo', 'flag'),
    ).toBe(false);
    expect(optionOf(view(withModules({ demo: { options: { flag: 'x' } } })), 'demo', 'flag')).toBe(
      true,
    );
    expect(optionOf(view(defaultProfile()), 'missing', 'flag')).toBeUndefined();
  });
});

describe('table options are validated per column', () => {
  it('drops rows whose cells have the wrong type, and keeps rows its validateRow refuses (the module reports those)', () => {
    const rows = [
      { name: 'ok', on: true, kind: 'a', tint: '#fff' },
      { name: 3 },
      { name: 'x', on: 'yes' },
      { name: 'x', kind: 'zzz' },
      { name: 'x', tint: 'red; background:url(x)' },
      { name: 'bad' },
      { name: 'partial' },
    ];
    const got = resolveOptions(demo, withModules({ demo: { options: { rows } } })).rows;
    expect(got).toEqual([
      { name: 'ok', on: true, kind: 'a', tint: '#fff' },
      { name: 'bad' },
      { name: 'partial' },
    ]);
  });
});

describe('ruleOn', () => {
  it('treats a missing enabled as on, everywhere', () => {
    expect(ruleOn({})).toBe(true);
    expect(ruleOn({ enabled: undefined })).toBe(true);
    expect(ruleOn({ enabled: false })).toBe(false);
    const post = {
      type: 'keyword',
      pattern: 'cats',
      scope: 'everywhere',
      subreddits: '',
      toggle: '',
    } as unknown as FilterRule;
    expect(compileRules([post]).rules).toHaveLength(1);
    const comment = { type: 'keyword', pattern: 'cats', action: 'hide' } as unknown as CommentRule;
    expect(compileCommentRules([comment]).rules).toHaveLength(1);
    expect(isFiltered([{ ...post }], post)).toBe(true);
  });
});
