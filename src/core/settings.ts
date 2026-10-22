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
  NoticeApi,
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

const COLOR = /^(#[0-9a-f]{3,8}|)$/i;

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
      return typeof value === 'string' && COLOR.test(value);
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

type TableSpec = Extract<OptionSpec, { type: 'table' }>;

/** Does one cell hold its column's type? A missing (or null) cell is fine: rows may omit columns. */
function cellOk(col: TableSpec['columns'][number], v: unknown): boolean {
  if (v === undefined || v === null) return true;
  switch (col.type) {
    case 'boolean':
      return typeof v === 'boolean';
    case 'text':
      return typeof v === 'string';
    case 'color':
      return typeof v === 'string' && COLOR.test(v);
    case 'enum':
      return typeof v === 'string' && (!col.values || col.values.includes(v));
  }
}

/**
 * The rows of a table option that match its columns (each declared cell has its column's type);
 * the others are dropped, so imported or synced rows can be trusted as the module's row type.
 * A row that is well typed but fails the option's own validateRow is KEPT: the module reports it
 * and leaves it off (filteReddit's "turned off because they are invalid" notice), where dropping
 * it here made a typo vanish without a word. Keys outside the columns are kept: some modules keep
 * bookkeeping there (the shortcut bar's `addedAt`), and dropping it would lose that data.
 */
export function validTableRows(
  spec: TableSpec,
  rows: ReadonlyArray<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return rows.filter((row) => spec.columns.every((col) => cellOk(col, row[col.key])));
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
    else if (spec.type === 'table' && validateOption(spec, v))
      out[name] = validTableRows(spec, v as Array<Record<string, unknown>>);
    else if (validateOption(spec, v)) out[name] = v;
    else {
      out[name] = spec.default;
      onInvalid?.(def.id, name);
    }
  }
  return out as ResolvedOptions<O>;
}

export function isModuleEnabled(
  def: Pick<ModuleDefinition, 'id' | 'enabledByDefault'>,
  profile: SettingsProfile,
): boolean {
  return profile.modules[def.id]?.enabled ?? def.enabledByDefault;
}

/** What a module sees of the settings (ctx.settings fits). */
export interface SettingsView {
  profile(): SettingsProfile;
  definitions(): ReadonlyArray<ModuleDefinition>;
}

/** Is module `id` switched on (its stored switch, else its default)? An unknown id is off. */
export function moduleOn(view: SettingsView, id: string): boolean {
  const def = view.definitions().find((d) => d.id === id);
  return !!def && isModuleEnabled(def, view.profile());
}

/** Option `name` of module `id`, resolved (default when unset or invalid); undefined if unknown. */
export function optionOf(view: SettingsView, id: string, name: string): OptionValue | undefined {
  const def = view.definitions().find((d) => d.id === id);
  if (!def || !(name in def.options)) return undefined;
  return (resolveOptions(def, view.profile()) as Record<string, OptionValue>)[name];
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

export interface SettingsSaveDeps {
  profile(): SettingsProfile;
  setProfile(p: SettingsProfile): void;
  /** What storage holds right now (raw). */
  read(): Promise<unknown>;
  write(p: SettingsProfile): Promise<void>;
  /** After a successful write (e.g. tell the other tabs). */
  onSaved?(): void;
}

/**
 * The settings save behind ctx.settings.save: the in-memory profile becomes `next` at once (later
 * callers build on it), saves run one at a time, each merged onto what is stored right then
 * (mergeProfileChange). A failed write rolls the in-memory profile back to what it was before
 * this save, unless a later save has started since, and rejects.
 */
export function createSettingsSave(
  deps: SettingsSaveDeps,
): (next: SettingsProfile, base?: SettingsProfile) => Promise<void> {
  let seq = 0;
  let queue: Promise<void> = Promise.resolve();
  return (next, base = deps.profile()) => {
    const before = deps.profile();
    deps.setProfile(next);
    const mine = ++seq;
    const run = async (): Promise<void> => {
      try {
        // Re-read storage right before writing: only this change is applied to it.
        const stored = normalizeProfile(await deps.read());
        const merged = mergeProfileChange(stored, normalizeProfile(base), next);
        await deps.write(merged);
        if (mine === seq) deps.setProfile(merged);
      } catch (err) {
        if (mine === seq) deps.setProfile(before);
        throw err;
      }
      deps.onSaved?.();
    };
    const turn = queue.then(run, run);
    queue = turn.catch(() => undefined);
    return turn;
  };
}

/**
 * Save settings and, if that fails, say so in an error notice. For callers that do not wait for
 * the save (menu toggles, notice buttons). Resolves to whether the save worked.
 */
export async function saveOrNotify(
  ctx: {
    settings: { save(next: SettingsProfile, base?: SettingsProfile): Promise<void> };
    notices: Pick<NoticeApi, 'show'>;
  },
  next: SettingsProfile,
  base?: SettingsProfile,
): Promise<boolean> {
  try {
    await ctx.settings.save(next, base);
    return true;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    ctx.notices.show(`REScue could not save your settings: ${why}`, { kind: 'error' });
    return false;
  }
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
