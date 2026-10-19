/**
 * SettingsProfile: load/save, defaults, and option validation against each module's schema
 * (data-model.md). Only non-default values are stored; unknown module ids are preserved so a
 * downgrade never loses settings.
 */
import type { LocalStore } from './storage/store';
import { STORAGE_KEYS } from './storage/store';
import { CURRENT_SCHEMA_VERSION } from './storage/migrations';
import type {
  ModuleDefinition,
  OptionSchema,
  OptionSpec,
  OptionValue,
  ResolvedOptions,
} from './types';

export interface ModuleSettings {
  enabled?: boolean;
  options?: Record<string, OptionValue>;
}

export interface SettingsProfile {
  schemaVersion: number;
  modules: Record<string, ModuleSettings>;
  keybindings: Record<string, string[]>;
  syncEnabled: boolean;
}

export function defaultProfile(): SettingsProfile {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    modules: {},
    keybindings: {},
    syncEnabled: false,
  };
}

/** Fill gaps in a stored profile with defaults; fields removed in 2.0 (layout, theme, mediaHosts) are ignored. */
export function normalizeProfile(raw: unknown): SettingsProfile {
  const d = defaultProfile();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SettingsProfile>;
  return {
    schemaVersion: typeof r.schemaVersion === 'number' ? r.schemaVersion : d.schemaVersion,
    modules: r.modules && typeof r.modules === 'object' ? r.modules : {},
    keybindings: r.keybindings && typeof r.keybindings === 'object' ? r.keybindings : {},
    syncEnabled: r.syncEnabled === true,
  };
}

export function validateOption(spec: OptionSpec, value: unknown): boolean {
  switch (spec.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return typeof value === 'string' && spec.values.some((v) => v.value === value);
    case 'text':
    case 'keybinding':
      return typeof value === 'string';
    case 'color':
      return typeof value === 'string' && /^(#[0-9a-f]{3,8}|)$/i.test(value);
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (spec.min === undefined || value >= spec.min) &&
        (spec.max === undefined || value <= spec.max)
      );
    case 'list':
      return Array.isArray(value) && value.every((v) => typeof v === 'string');
    case 'table':
      return (
        Array.isArray(value) &&
        value.every((v) => v !== null && typeof v === 'object' && !Array.isArray(v))
      );
  }
}

/** Resolve a module's options; invalid stored values fall back to defaults and are reported. */
export function resolveOptions<O extends OptionSchema>(
  def: ModuleDefinition<O>,
  profile: SettingsProfile,
  onInvalid?: (moduleId: string, option: string) => void,
): ResolvedOptions<O> {
  const stored = profile.modules[def.id]?.options ?? {};
  const out: Record<string, OptionValue> = {};
  for (const [name, spec] of Object.entries(def.options)) {
    const v = stored[name];
    if (v === undefined) out[name] = spec.default;
    else if (validateOption(spec, v)) out[name] = v;
    else {
      out[name] = spec.default;
      onInvalid?.(def.id, name);
    }
  }
  return out as ResolvedOptions<O>;
}

export function isModuleEnabled(def: ModuleDefinition, profile: SettingsProfile): boolean {
  return profile.modules[def.id]?.enabled ?? def.enabledByDefault;
}

export async function loadProfile(store: LocalStore): Promise<SettingsProfile> {
  return normalizeProfile(await store.get(STORAGE_KEYS.settings));
}

export function saveProfile(store: LocalStore, profile: SettingsProfile): void {
  store.set(STORAGE_KEYS.settings, profile);
}

/** Store only non-default option values. */
export function setOption(
  profile: SettingsProfile,
  def: ModuleDefinition,
  name: string,
  value: OptionValue,
): SettingsProfile {
  const spec = def.options[name];
  if (!spec || !validateOption(spec, value)) throw new Error(`Invalid value for ${def.id}.${name}`);
  const mod = { ...(profile.modules[def.id] ?? {}) };
  const options = { ...(mod.options ?? {}) };
  if (JSON.stringify(value) === JSON.stringify(spec.default)) delete options[name];
  else options[name] = value;
  mod.options = options;
  return { ...profile, modules: { ...profile.modules, [def.id]: mod } };
}

/** The profile with one module switched on or off (its stored options are kept). */
export function setModuleEnabled(
  profile: SettingsProfile,
  def: ModuleDefinition,
  on: boolean,
): SettingsProfile {
  const mod: ModuleSettings = { ...(profile.modules[def.id] ?? {}), enabled: on };
  return { ...profile, modules: { ...profile.modules, [def.id]: mod } };
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Read-modify-write for settings: apply only what changed between `base` (the profile the caller
 * started from) and `next` (what it wants) onto `current` (what is stored right now). Another tab's
 * saves that this tab never saw are kept. Option values, keybinding lists and the other fields of a
 * module entry are each treated as one unit; a module or key missing from `next` is removed.
 */
export function mergeProfileChange(
  current: SettingsProfile,
  base: SettingsProfile,
  next: SettingsProfile,
): SettingsProfile {
  const out: SettingsProfile = {
    ...current,
    modules: { ...current.modules },
    keybindings: { ...current.keybindings },
  };
  if (next.schemaVersion !== base.schemaVersion) out.schemaVersion = next.schemaVersion;
  if (next.syncEnabled !== base.syncEnabled) out.syncEnabled = next.syncEnabled;

  for (const key of new Set([...Object.keys(base.keybindings), ...Object.keys(next.keybindings)])) {
    if (sameJson(base.keybindings[key], next.keybindings[key])) continue;
    if (key in next.keybindings) out.keybindings[key] = next.keybindings[key]!;
    else delete out.keybindings[key];
  }

  for (const id of new Set([...Object.keys(base.modules), ...Object.keys(next.modules)])) {
    const was = base.modules[id];
    const now = next.modules[id];
    if (sameJson(was, now)) continue;
    if (!now) {
      delete out.modules[id];
      continue;
    }
    const mod: ModuleSettings = { ...(out.modules[id] ?? {}) };
    for (const field of new Set([...Object.keys(was ?? {}), ...Object.keys(now)])) {
      if (field === 'options' || sameJson(was?.[field as 'enabled'], now[field as 'enabled']))
        continue;
      if (field in now)
        (mod as Record<string, unknown>)[field] = (now as Record<string, unknown>)[field];
      else delete (mod as Record<string, unknown>)[field];
    }
    const options = { ...(mod.options ?? {}) };
    const wasOpts = was?.options ?? {};
    const nowOpts = now.options ?? {};
    for (const name of new Set([...Object.keys(wasOpts), ...Object.keys(nowOpts)])) {
      if (sameJson(wasOpts[name], nowOpts[name])) continue;
      if (name in nowOpts) options[name] = nowOpts[name]!;
      else delete options[name];
    }
    if (mod.options || Object.keys(options).length) mod.options = options;
    out.modules[id] = mod;
  }
  return out;
}
