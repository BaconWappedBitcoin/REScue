/**
 * Runs feature modules the way content.ts does, against fixture HTML: real Decorations,
 * NativeAdapter, Selection, Pipeline and tool strip, with an in-memory stand-in for storage.
 */
import { KeyDispatcher } from '../../src/core/keys';
import { Pipeline } from '../../src/core/pipeline';
import { resolveOptions } from '../../src/core/settings';
import type {
  ItemBatch,
  ModuleContext,
  ModuleDefinition,
  ModuleUi,
  OptionValue,
  Route,
} from '../../src/core/types';
import { Decorations } from '../../src/layout/decorations';
import { NativeAdapter } from '../../src/layout/native/adapter';
import { Selection } from '../../src/layout/native/selection';
import { createToolbar } from '../../src/layout/native/toolbar';

export interface BootOptions {
  route?: Partial<Omit<Route, 'kind'>> & { kind?: string };
  /** Initial top-level storage keys (`read`, `userTags`, ...). */
  stored?: Record<string, unknown>;
  /** Initial per-module stored values (a module's own `ctx.store`). */
  moduleStored?: Record<string, Record<string, unknown>>;
  /** Option overrides per module id. */
  options?: Record<string, Record<string, OptionValue>>;
  username?: string | null;
  /** Settings profile modules (for modules that read another module's options). */
  profileModules?: Record<string, { options?: Record<string, OptionValue> }>;
  /** Stand-in for the MAIN-world bridge (feed loading). */
  bridge?: { request(body: unknown): Promise<unknown>; ref(el: Element): string };
}

export async function bootModules(defs: ModuleDefinition[], opts: BootOptions = {}) {
  const deco = new Decorations();
  const adapter = new NativeAdapter(deco);
  const selection = new Selection();
  const toolbar = createToolbar();
  const store: Record<string, unknown> = { ...opts.stored };
  let route: Route = { kind: 'thread', path: '/', ...opts.route } as Route;
  const profile = {
    schemaVersion: 1,
    keybindings: {},
    syncEnabled: false,
    modules: {
      ...Object.fromEntries(
        Object.entries(opts.options ?? {}).map(([id, o]) => [id, { options: o }]),
      ),
      ...opts.profileModules,
    },
  };

  const ui = {
    hide: (i, r) => deco.hide(i, r),
    unhide: (i, r) => deco.unhide(i, r),
    collapseBody: (i, on) => deco.collapseBody(i, on),
    markAuthor: (i, c) => deco.markAuthor(i, c),
    unmarkAuthor: (i, c) => deco.unmarkAuthor(i, c),
    decorate: (i, s, n) => deco.decorate(i, s, n),
    addClass: (i, c) => deco.addClass(i, c),
    setRevealHidden: (on) => deco.setReveal(on),
    addHeaderTool: (n) => toolbar.addHeaderTool(n),
    addBanner: (n) => toolbar.addBanner(n),
    addMenuItem: (item) => toolbar.addMenuItem(item),
    openMenu: (anchor) => toolbar.openMenu(anchor),
    selection: () => selection,
  } as ModuleUi;

  const keys = new KeyDispatcher();
  const notices: Array<{
    message: string;
    opts?: Parameters<ModuleContext['notices']['show']>[1];
  }> = [];
  const moduleStore: Record<string, Record<string, unknown>> = { ...opts.moduleStored };
  const ctxs = new Map<string, ModuleContext>();
  for (const def of defs) {
    ctxs.set(def.id, {
      moduleId: def.id,
      options: resolveOptions(def, profile as never),
      route,
      session: { signedIn: !!opts.username, username: opts.username ?? null },
      data: {
        get: async (k: string) => store[k],
        set: (k: string, v: unknown) => void (store[k] = v),
      },
      store: {
        get: async (k: string) => moduleStore[def.id]?.[k],
        set: (k: string, v: unknown) => void ((moduleStore[def.id] ??= {})[k] = v),
      },
      keys,
      notices: {
        show: (message: string, opts?: never) => void notices.push({ message, opts }),
        dismiss: () => {},
      },
      ui,
      bridge: opts.bridge,
      settings: {
        profile: () => profile,
        definitions: () => defs,
        save: async (next: typeof profile) => {
          Object.assign(profile, next);
        },
      },
    } as unknown as ModuleContext);
  }
  for (const def of defs) await def.init?.(ctxs.get(def.id)! as never);

  const deliver = (batch: ItemBatch) => {
    for (const def of defs) def.onItems?.(batch, ctxs.get(def.id)! as never);
    adapter.track(batch);
    selection.track(batch);
  };
  const pipeline = new Pipeline({ onBatch: deliver });
  const flush = () => pipeline.flush();

  const goTo = (next: BootOptions['route']) => {
    route = { kind: 'thread', path: '/', ...next } as Route;
    pipeline.reset();
    adapter.reset();
    selection.reset();
    deco.clear();
    for (const def of defs) {
      const ctx = { ...ctxs.get(def.id)!, route } as ModuleContext;
      ctxs.set(def.id, ctx);
      def.onRoute?.(route, ctx as never);
    }
  };

  const tick = () => new Promise((r) => setTimeout(r, 0));
  const dispose = () => {
    for (const def of defs) def.dispose?.();
    selection.reset();
  };
  /** Opens REScue's menu and clicks the row with this id; returns false when it is not listed. */
  const menu = (id: string): boolean => {
    toolbar.openMenu(document.body);
    const row = document.querySelector<HTMLElement>(`#rescue-menu [data-menu-id="${id}"]`);
    row?.click();
    if (document.getElementById('rescue-menu')) toolbar.openMenu(document.body); // close it
    return !!row;
  };
  /** The label of a menu row (null when the row is not listed on this page). */
  const menuText = (id: string): string | null => {
    toolbar.openMenu(document.body);
    const text =
      document.querySelector(`#rescue-menu [data-menu-id="${id}"]`)?.firstElementChild
        ?.textContent ?? null;
    toolbar.openMenu(document.body); // close it
    return text;
  };
  return {
    menu,
    menuText,
    deco,
    store,
    selection,
    pipeline,
    flush,
    goTo,
    tick,
    dispose,
    ctxs,
    keys,
    notices,
    moduleStore,
  };
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
export const own = (host: Element, sel: string): Element | null =>
  [...host.querySelectorAll(sel)].find((e) => e.closest('shreddit-comment') === host) ?? null;
