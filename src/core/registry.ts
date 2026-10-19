/**
 * Module registry: lifecycle, dependency resolution, per-module error boundaries and health
 * (contracts/module-api.md; constitution Principle III — one module failing never breaks others).
 */
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

const MAX_ERRORS_PER_PAGE = 3;

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
  items(batch: ItemBatch): void;
  route(route: Route): void;
  /** Re-resolve options and follow the on/off switch, for modules that declare `onSettings`. */
  settingsChanged(): Promise<void>;
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
        try {
          await e.def.init?.(e.ctx);
        } catch (err) {
          console.error(`[REScue] ${e.def.id}.init failed`, err);
          disable(e, 'it failed to start');
        }
      }
    },

    items(batch) {
      for (const e of entries.values()) {
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
      for (const e of entries.values()) {
        const on = deps.isEnabled(e.def);
        const live = e.status === 'ok' || e.status === 'degraded';
        if (!e.def.onSettings) {
          const changed = live ? !on : e.status === 'inactive' && on;
          if (changed && !asked.has(e.def.id)) {
            asked.add(e.def.id);
            deps.reloadNeeded?.(e.def, on);
          } else if (!changed) asked.delete(e.def.id);
          continue;
        }
        if (live && !on) {
          try {
            e.def.dispose?.();
          } catch {
            /* ignore */
          }
          e.status = 'inactive';
          e.errors = 0;
          delete e.ctx;
        } else if (live) {
          e.ctx = deps.makeContext(e.def);
          guard(e, 'onSettings', () => e.def.onSettings!(e.ctx!));
        } else if (on && e.status === 'inactive') {
          e.status = 'ok';
          e.ctx = deps.makeContext(e.def);
          try {
            await e.def.init?.(e.ctx);
          } catch (err) {
            console.error(`[REScue] ${e.def.id}.init failed`, err);
            disable(e, 'it failed to start');
          }
        }
      }
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
