/** Module API types (specs/001-rescue-foundation/contracts/module-api.md). */
import type { LayoutHooks } from '../layout/decorations';
import type { Selection } from '../layout/native/selection';
import type { Comment, Post, ProfileComment, Session } from '../model/types';
import type { BridgeRequest, BridgeResponse } from './bridge-protocol';
import type { ActionApi } from './actions';
import type { Command } from './keys';
import type { SharedKey } from './storage/store';
import type { SettingsProfile } from './settings';

export type ModuleCategory = 'core' | 'listings' | 'comments' | 'users' | 'actions' | 'appearance';

export type OptionValue = boolean | string | number | string[] | Array<Record<string, unknown>>;

interface OptionBase<T extends OptionValue> {
  default: T;
  title: string;
  description?: string;
  advanced?: boolean;
  /** Show only when another option of this module is truthy. */
  dependsOn?: string;
}

export type OptionSpec =
  | ({ type: 'boolean' } & OptionBase<boolean>)
  | ({ type: 'enum'; values: Array<{ value: string; label: string }> } & OptionBase<string>)
  | ({
      type: 'text';
      /** Edit in a multi-line box (e.g. a stylesheet). */ multiline?: boolean;
    } & OptionBase<string>)
  | ({ type: 'number'; min?: number; max?: number } & OptionBase<number>)
  | ({ type: 'color' } & OptionBase<string>)
  | ({ type: 'keybinding' } & OptionBase<string>)
  | ({ type: 'list' } & OptionBase<string[]>)
  | ({
      type: 'table';
      columns: Array<{
        key: string;
        title: string;
        type: 'text' | 'boolean' | 'color' | 'enum';
        values?: string[];
        /** Value for this cell in a newly added row. */
        default?: string | boolean;
      }>;
      /** Rejects an edited row at input with a message (blank new rows are always allowed). */
      validateRow?: (row: Record<string, unknown>) => string | null;
    } & OptionBase<Array<Record<string, unknown>>>);

export type OptionSchema = Record<string, OptionSpec>;

export type ResolvedOptions<O extends OptionSchema> = { [K in keyof O]: O[K]['default'] };

export interface Route {
  kind:
    | 'front'
    | 'all'
    | 'popular'
    | 'subreddit'
    | 'customFeed'
    | 'profile'
    | 'thread'
    | 'search'
    | 'other';
  path: string;
  subreddit?: string;
  username?: string;
  postId?: string;
}

export interface ItemBatch {
  posts: Post[];
  comments: Comment[];
  profileComments: ProfileComment[];
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'disabled';
  failingContracts: string[];
}

export type ModuleStatus = 'inactive' | 'ok' | 'degraded' | 'disabled';

export interface NoticeAction {
  label: string;
  /** Hover text for the button (src/core/hints.ts). */
  hint?: string;
  run(): void;
}

export interface NoticeOptions {
  kind?: 'info' | 'warning' | 'error';
  id?: string;
  /** Close after this long; paused while the pointer is over the notice. */
  timeoutMs?: number;
  actions?: NoticeAction[];
  /** Adds a header with this module's title and a link to its settings (RES notifications). */
  moduleId?: string;
  /** Notice type, for the "don't show again" mute. Defaults to `id`; none means no mute box. */
  type?: string;
  /** Do not show this type again within this many ms of its last showing. */
  cooldownMs?: number;
}

export interface NoticeApi {
  show(message: string, opts?: NoticeOptions): void;
  dismiss(id: string): void;
}

/** One row of the gear dropdown menu (RES menu). */
export interface MenuItem {
  id: string;
  label: string;
  /** Ascending; ties keep registration order. */
  order: number;
  onClick(): void;
  /** Return false to leave the row out of the menu (asked each time the menu opens). */
  visible?: () => boolean;
  /** Hover text for the row, asked again whenever a switch is flipped (src/core/hints.ts). */
  hint?: () => string;
  /** Renders an on/off switch; the menu stays open when it is flipped. */
  toggle?: { get(): boolean; set(on: boolean): void };
  /** A small extra icon button at the end of the row. */
  secondary?: { label: string; icon: string; onClick(): void; hint?: string };
}

export interface ScopedStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): void;
}

/** Access to the shared top-level storage keys (e.g. `userTags`); writes are debounced. */
export interface SharedData {
  get<T>(key: SharedKey): Promise<T | undefined>;
  set(key: SharedKey, value: unknown): void;
}

/** Decorations and page chrome available to modules (layout-agnostic). */
export interface ModuleUi extends LayoutHooks {
  addHeaderTool(node: HTMLElement): void;
  /** A notice banner stacked above REScue's floating tool strip. */
  addBanner(node: HTMLElement): void;
  /** Adds (or replaces, by id) a gear-menu row. Returns a function that removes it. */
  addMenuItem(item: MenuItem): () => void;
  /** Opens the gear menu under `anchor` (closes it when already open from that anchor). */
  openMenu(anchor: HTMLElement): void;
  /** The selected post/comment that keyboard commands act on (layout/native/selection.ts). */
  selection(): Selection;
}

/** Keyboard commands (src/core/keys.ts). */
export interface KeysApi {
  register(cmd: Command): void;
  list(): Array<{
    id: string;
    title: string;
    keys: string[];
    context?: string;
    section?: string;
  }>;
  run(id: string): boolean;
  setOverrides(overrides: Record<string, string[]>): void;
}

/** MAIN-world bridge, for delegating to Reddit's own controls (contracts/messaging.md). */
export interface BridgeApi {
  request(body: BridgeRequest, timeoutMs?: number): Promise<BridgeResponse>;
  ref(el: Element): string;
}

/** Settings access for core modules (console, presets, backup, troubleshooter). */
export interface SettingsApi {
  profile(): SettingsProfile;
  /**
   * Save the changes from `base` (the profile `next` was built from; default: this tab's current
   * one) to `next`, merged onto what is stored right now, so a stale tab never undoes another's.
   */
  save(next: SettingsProfile, base?: SettingsProfile): Promise<void>;
  definitions(): ModuleDefinition[];
  status(id: string): ModuleStatus | undefined;
  runAction(moduleId: string, actionId: string, file?: File): Promise<void>;
  /** Per-module health on this page, for the troubleshooter. */
  report(): Array<{ id: string; status: ModuleStatus; failingContracts: string[] }>;
}

export interface ModuleContext<O extends OptionSchema = OptionSchema> {
  moduleId: string;
  options: Readonly<ResolvedOptions<O>>;
  route: Route;
  session: Session;
  store: ScopedStore;
  /** Shared top-level storage keys (e.g. `userTags`). */
  data: SharedData;
  notices: NoticeApi;
  ui: ModuleUi;
  keys: KeysApi;
  bridge: BridgeApi;
  /** Delegated signed-in actions, confirmed against Reddit's own state (src/core/actions.ts). */
  actions: ActionApi;
  settings: SettingsApi;
}

/** A button (or file picker) the settings console renders on the module's page. */
export interface ModuleAction {
  id: string;
  label: string;
  kind?: 'button' | 'file';
  /** Ask for confirmation first, with this text. */
  confirm?: string;
  run(ctx: ModuleContext, file?: File): void | Promise<void>;
}

/** A line the settings console shows on a module's page: a link, a note, or a collapsible text. */
export interface ModuleLink {
  label: string;
  /** Opens in a new tab. */
  href?: string;
  /** Shown in a collapsible block (e.g. the bundled privacy policy). */
  text?: string;
}

export interface ModuleDefinition<O extends OptionSchema = OptionSchema> {
  id: string;
  category: ModuleCategory;
  title: string;
  description: string;
  resId?: string;
  requiresSignIn?: boolean;
  enabledByDefault: boolean;
  /** Cannot be turned off (e.g. the settings console itself). */
  locked?: boolean;
  options: O;
  actions?: ModuleAction[];
  /** Links and notes the console renders under the options (read when the page opens). */
  links?(): ModuleLink[];
  dependsOn?: string[];
  init?(ctx: ModuleContext<O>): void | Promise<void>;
  onItems?(batch: ItemBatch, ctx: ModuleContext<O>): void;
  onRoute?(route: Route, ctx: ModuleContext<O>): void;
  /**
   * The settings changed while the page is open; `ctx.options` holds the new values. A module that
   * declares this also follows its on/off switch live (dispose when turned off, init when turned
   * on); one that does not keeps its options until the page is reloaded.
   */
  onSettings?(ctx: ModuleContext<O>): void;
  dispose?(): void;
  health?(ctx: ModuleContext<O>): HealthReport;
}

export function defineModule<O extends OptionSchema>(
  def: ModuleDefinition<O>,
): ModuleDefinition<O> {
  return def;
}
