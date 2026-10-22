/**
 * Module registry: lifecycle, dependency resolution, per-module error boundaries and health
 * (contracts/module-api.md; constitution Principle III — one module failing never breaks others).
 */
import type { SettingsProfile } from './settings';
import type { ItemBatch, ModuleContext, ModuleDefinition, ModuleStatus, Route } from './types';

export interface RegistryDeps {
  isEnabled(def: ModuleDefinition): boolean;
  notify(message: string): void;
  makeContext(def: ModuleDefinition): ModuleContext;
  /**
   * A module without `onSettings` was switched on or off while the page is open. Its marks on the
   * page cannot be withdrawn live, so the reader is asked to reload.
   */
  reloadNeeded?(def: ModuleDefinition, enabled: boolean): void;
}

/**
 * Modules whose items depend on another module's settings (read through ctx.settings.profile()):
 * a change there re-runs them too. commentNavigator and filteReddit match on the friends and
 * highlighted users of userHighlight and on the custom toggles.
 */
export const READS_SETTINGS_OF: Readonly<Record<string, readonly string[]>> = {
  commentNavigator: ['userHighlight', 'customToggles'],
  filteReddit: ['userHighlight', 'customToggles'],
};

/**
 * The modules whose own settings differ between two profiles, or null when something outside the
 * modules changed (key bindings, sync), after which every module is re-run to be safe.
 */
export function changedModules(a: SettingsProfile, b: SettingsProfile): Set<string> | null {
  const { modules: am, ...aRest } = a;
  const { modules: bm, ...bRest } = b;
  if (JSON.stringify(aRest) !== JSON.stringify(bRest)) return null;
  const out = new Set<string>();
  for (const id of new Set([...Object.keys(am), ...Object.keys(bm)])) {
    if (JSON.stringify(am[id]) !== JSON.stringify(bm[id])) out.add(id);
  }
  return out;
}

/**
 * Which modules decorate the page's items again after a settings change: the ones the registry
 * named (switched on, or options changed), and the readers of any module whose settings changed.
 * Null (every module) when the change was outside the modules.
 */
export function rerunSet(
  fromRegistry: ReadonlySet<string>,
  changed: ReadonlySet<string> | null,
): Set<string> | null {
  if (changed === null) return null;
  const out = new Set(fromRegistry);
  for (const [reader, sources] of Object.entries(READS_SETTINGS_OF)) {
    if (sources.some((id) => changed.has(id))) out.add(reader);
  }
  return out;
}

/**
 * Runs `follow` once a burst of `poke()` calls has been quiet for `ms` (every tab hears each save
 * of a settings burst), never two runs at once: a poke during a run starts another after it.
 */
export function settled(
  follow: () => Promise<void>,
  ms: number,
  onError: (err: unknown) => void,
): { poke(): void; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let chain = Promise.resolve();
  return {
    poke() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        chain = chain.then(follow).catch(onError);
      }, ms);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

const MAX_ERRORS_PER_PAGE = 3;

/** A module's resolved options as one comparable string (undefined without a context). */
const optionsKey = (ctx: ModuleContext | undefined): string | undefined =>
  ctx ? JSON.stringify(ctx.options) : undefined;

interface Entry {
  def: ModuleDefinition;
  status: ModuleStatus;
  errors: number;
  ctx?: ModuleContext;
  failingContracts: string[];
}

export interface Registry {
  register(def: ModuleDefinition): void;
  start(): Promise<void>;
  /** Hand a batch to every running module's onItems, or only to the modules in `only`. */
  items(batch: ItemBatch, only?: ReadonlySet<string>): void;
  route(route: Route): void;
  /**
   * Re-resolve options and follow the on/off switch, for modules that declare `onSettings`.
   * Resolves the ids of the running modules whose items need decorating again: the ones just
   * switched on, and the ones whose options came out different.
   */
  settingsChanged(): Promise<Set<string>>;
  checkHealth(): void;
  status(id: string): ModuleStatus | undefined;
  definitions(): ModuleDefinition[];
  report(): Array<{ id: string; status: ModuleStatus; failingContracts: string[] }>;
  stop(): void;
}

export function createRegistry(deps: RegistryDeps): Registry {
  const entries = new Map<string, Entry>();
  const asked = new Set<string>();

  const disable = (e: Entry, reason: string) => {
    if (e.status === 'disabled') return;
    e.status = 'disabled';
    try {
      e.def.dispose?.();
    } catch {
      /* a failing dispose must not mask the original failure */
    }
    deps.notify(`REScue: "${e.def.title}" (${e.def.id}) was turned off for this page: ${reason}`);
  };

  const guard = (e: Entry, what: string, fn: () => void) => {
    if (e.status !== 'ok' && e.status !== 'degraded') return;
    try {
      fn();
    } catch (err) {
      e.errors++;
      console.error(`[REScue] ${e.def.id}.${what} failed`, err);
      if (e.errors >= MAX_ERRORS_PER_PAGE) disable(e, `${MAX_ERRORS_PER_PAGE} errors`);
    }
  };

  const isLive = (e: Entry) => e.status === 'ok' || e.status === 'degraded';

  /** Switched on, and so is everything it depends on (a dependency that failed counts as off). */
  const wanted = (e: Entry, path = new Set<string>()): boolean => {
    if (!deps.isEnabled(e.def) || path.has(e.def.id)) return false;
    path.add(e.def.id);
    const ok = (e.def.dependsOn ?? []).every((id) => {
      const d = entries.get(id);
      return !!d && d.status !== 'disabled' && wanted(d, path);
    });
    path.delete(e.def.id);
    return ok;
  };

  /** Every entry after the entries it depends on (registration order otherwise). */
  const dependencyOrder = (): Entry[] => {
    const out: Entry[] = [];
    const seen = new Set<string>();
    const visit = (e: Entry) => {
      if (seen.has(e.def.id)) return;
      seen.add(e.def.id);
      for (const id of e.def.dependsOn ?? []) {
        const d = entries.get(id);
        if (d) visit(d);
      }
      out.push(e);
    };
    for (const e of entries.values()) visit(e);
    return out;
  };

  return {
    register(def) {
      if (entries.has(def.id)) throw new Error(`Duplicate module id: ${def.id}`);
      entries.set(def.id, { def, status: 'inactive', errors: 0, failingContracts: [] });
    },

    async start() {
      const active = (id: string) => {
        const e = entries.get(id);
        return !!e && deps.isEnabled(e.def);
      };
      // Every init starts in order, but none waits for the one before it to finish its storage
      // reads: run one after another they held the page back (the old look keeps posts hidden
      // until this is done) by up to a second on a busy thread.
      const pending: Array<Promise<void>> = [];
      for (const e of entries.values()) {
        if (!deps.isEnabled(e.def)) continue;
        const missing = (e.def.dependsOn ?? []).filter((d) => !active(d));
        if (missing.length) {
          e.status = 'ok'; // so disable() reports it
          disable(e, `requires ${missing.join(', ')}`);
          continue;
        }
        e.status = 'ok';
        e.ctx = deps.makeContext(e.def);
        const failed = (err: unknown) => {
          console.error(`[REScue] ${e.def.id}.init failed`, err);
          disable(e, 'it failed to start');
        };
        try {
          pending.push(Promise.resolve(e.def.init?.(e.ctx)).catch(failed));
        } catch (err) {
          failed(err);
        }
      }
      await Promise.all(pending);
    },

    items(batch, only) {
      for (const e of entries.values()) {
        if (only && !only.has(e.def.id)) continue;
        if (e.def.onItems && e.ctx) guard(e, 'onItems', () => e.def.onItems!(batch, e.ctx!));
      }
    },

    route(route) {
      for (const e of entries.values()) {
        if (e.ctx) e.ctx = { ...e.ctx, route };
        if (e.def.onRoute && e.ctx) guard(e, 'onRoute', () => e.def.onRoute!(route, e.ctx!));
      }
    },

    async settingsChanged() {
      const rerun = new Set<string>();
      // Dependents go off before what they depend on, and come back on after it (dependsOn).
      const order = dependencyOrder();
      for (const e of [...order].reverse()) {
        if (!e.def.onSettings || !isLive(e) || wanted(e)) continue;
        try {
          e.def.dispose?.();
        } catch {
          /* ignore */
        }
        e.status = 'inactive';
        e.errors = 0;
        delete e.ctx;
      }
      for (const e of order) {
        const live = isLive(e);
        if (!e.def.onSettings) {
          const on = deps.isEnabled(e.def);
          const changed = live ? !on : e.status === 'inactive' && on;
          if (changed && !asked.has(e.def.id)) {
            asked.add(e.def.id);
            deps.reloadNeeded?.(e.def, on);
          } else if (!changed) asked.delete(e.def.id);
          continue;
        }
        if (live) {
          const before = optionsKey(e.ctx);
          e.ctx = deps.makeContext(e.def);
          if (optionsKey(e.ctx) !== before) rerun.add(e.def.id);
          guard(e, 'onSettings', () => e.def.onSettings!(e.ctx!));
        } else if (e.status === 'inactive' && wanted(e)) {
          e.status = 'ok';
          e.ctx = deps.makeContext(e.def);
          rerun.add(e.def.id);
          try {
            await e.def.init?.(e.ctx);
          } catch (err) {
            console.error(`[REScue] ${e.def.id}.init failed`, err);
            disable(e, 'it failed to start');
          }
        }
      }
      for (const id of rerun) if (!isLive(entries.get(id)!)) rerun.delete(id);
      return rerun;
    },

    checkHealth() {
      for (const e of entries.values()) {
        if (!e.def.health || !e.ctx || e.status === 'disabled' || e.status === 'inactive') continue;
        guard(e, 'health', () => {
          const h = e.def.health!(e.ctx!);
          e.failingContracts = h.failingContracts;
          if (h.status === 'disabled')
            disable(e, `page no longer matches (${h.failingContracts.join(', ')})`);
          else e.status = h.status;
        });
      }
    },

    status: (id) => entries.get(id)?.status,
    definitions: () => [...entries.values()].map((e) => e.def),
    report: () =>
      [...entries.values()].map((e) => ({
        id: e.def.id,
        status: e.status,
        failingContracts: e.failingContracts,
      })),

    stop() {
      for (const e of entries.values()) {
        if (e.status === 'ok' || e.status === 'degraded') {
          try {
            e.def.dispose?.();
          } catch {
            /* ignore */
          }
        }
        e.status = 'inactive';
        e.errors = 0;
        delete e.ctx;
      }
    },
  };
}
