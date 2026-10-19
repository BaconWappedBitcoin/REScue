# Contract: Module API

Every feature module is a `ModuleDefinition` registered with `src/core/registry.ts`. Modules never
import from `src/contracts/`. They receive typed models and layout hooks (Principle I).

## ModuleDefinition

```ts
interface ModuleDefinition<O extends OptionSchema = OptionSchema> {
  id: ModuleId;                 // stable, camelCase, matches RES id where one exists (e.g. 'filteReddit')
  category: 'core' | 'listings' | 'comments' | 'users' | 'actions' | 'appearance';
  title: string;
  description: string;          // Markdown, shown in the settings console
  resId?: string;               // RES module id, for feature-matrix traceability
  requiresSignIn?: boolean;
  enabledByDefault: boolean;
  options: O;                   // declarative schema → settings UI + validation
  dependsOn?: ModuleId[];       // e.g. autoHide → readComments
  init?(ctx: ModuleContext<O>): void | Promise<void>;   // once per page load
  onItems?(batch: ItemBatch, ctx: ModuleContext<O>): void; // each pipeline batch, before render commit
  onRoute?(route: Route, ctx: ModuleContext<O>): void;
  dispose?(): void;             // module disabled at runtime
  health?(ctx: ModuleContext<O>): HealthReport;           // contract self-check for this page
}
```

## OptionSchema

The option types are `boolean`, `enum`, `text`, `number` (min, max), `color`, `keybinding`, `list`
(of text), and `table` (rows with typed columns, used for filters and tags). Each option has
`{ type, default, title, description, advanced?, dependsOn? }`. The settings console is generated
entirely from schemas, so there is no per-module settings UI code.

## ModuleContext

```ts
interface ModuleContext<O> {
  options: Readonly<ResolvedOptions<O>>;
  route: Route;
  session: Session;
  store: ScopedStore;           // namespaced to the module id
  notices: NoticeApi;
  keys: KeyApi;                 // register commands, never raw listeners
  hover: HoverApi;              // shared popup framework (RES 'hover')
  hovercards: HovercardApi;     // user/community data (R4/R5)
  actions: ActionApi;           // delegated signed-in actions
  ui: LayoutHooks;              // decorate post row / comment header / tagline / toolbar slots
}
```

## ItemBatch

`{ posts: Post[], comments: Comment[], profileComments: …[] }`. Modules may mark items with
`hide(reason)`, `decorate(slot, node)`, or `addClass(name)`. They must not mutate model fields. The
pipeline commits all decorations in one rAF frame (performance budget: ≤100 ms per batch in total).

## ActionApi (Principle V)

```ts
type ActionResult =
  | { ok: true }
  | { ok: false; reason: 'signed-out' | 'not-found' | 'timeout' | 'rejected'; detail?: string };

actions.vote(target, dir: 1 | 0 | -1): Promise<ActionResult>;
actions.save(target, on: boolean): Promise<ActionResult>;
actions.hide(target, on: boolean): Promise<ActionResult>;
actions.reply(target, markdown: string): Promise<ActionResult>; // draft kept unless ok
```

`ok: true` is returned only after the confirming page state is observed. UI must not show success
before the promise resolves `ok`.

## Lifecycle and isolation (Principle III)

1. The registry loads settings and resolves `dependsOn` (missing dependency → module disabled with a
   notice).
2. For each enabled module, it calls `init` inside a
   try/catch. A throw sets health to `disabled` for this page, raises a notice, and other modules
   continue.
3. `onItems`/`onRoute` errors are caught per module and per call. Three errors in one page disable
   the module for that page.
4. `health()` runs after the first batch. `degraded` modules keep running, and `disabled` ones are
   disposed.

## Commands (RES commandLine / keyboardNav)

Modules register `{ id, title, defaultKeys, run(ctx) }` through `keys.register`. The command line
lists every registered command, and the keybinding editor reads the same registry.
