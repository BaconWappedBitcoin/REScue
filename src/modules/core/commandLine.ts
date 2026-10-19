/**
 * commandLine (RES): press "." and type a command. Navigation (r/sub, u/name, me/*, m/feed, sorts),
 * search, settings, toggling features, and any keyboard command by name; `?` lists them all.
 * Commands live in a registry (commandRegistry.ts) that other modules can add to.
 * Shift+Enter opens the result in a new tab, Alt+Enter in a background tab.
 */
import { h } from '../../core/dom';
import { hint } from '../../core/hints';
import { openTabs } from '../../core/tabs';
import { ensureTheme } from '../../core/theme';
import { defineModule, type ModuleContext } from '../../core/types';
import { registerBuiltinCommands } from './commandBuiltins';
import { resolveCommand, type CommandEnv, type Parsed } from './commandRegistry';

export { listCommands, registerCommand } from './commandRegistry';
export type { CommandDef, CommandEnv, Parsed } from './commandRegistry';

const ID = 'rescue-cmdline';

registerBuiltinCommands();

export function parseCommand(input: string, ctx: CommandEnv): Parsed {
  return resolveCommand(input, ctx);
}

const HINTS = [
  'r/subreddit',
  'u/username',
  'me/saved',
  'all · popular · front',
  'hot · new · top · rising',
  '/t week',
  'search <words>',
  'nav <category>',
  'tag <text>',
  'post <sub> <title> <url>',
  'settings <feature>',
  'toggle <feature>',
  '? lists every command',
];

/** Performs a resolved command. Returns false when it only produced a message to keep showing. */
function perform(p: Parsed, ctx: ModuleContext, newTab: 'front' | 'back' | null): boolean {
  if (p.kind === 'message' || p.kind === 'unknown') return false;
  if (p.kind === 'go') {
    if (newTab) openTabs([p.target], newTab === 'front');
    else location.assign(p.target);
  } else if (p.kind === 'settings') {
    location.hash = `#rescue:settings${p.target ? '/' + p.target : ''}`;
  } else if (p.kind === 'action') {
    p.action?.(ctx);
  } else if (p.kind === 'command') {
    ctx.keys.run(p.target);
  } else if (p.kind === 'toggle') {
    const profile = ctx.settings.profile();
    const def = ctx.settings.definitions().find((d) => d.id === p.target)!;
    const on = profile.modules[def.id]?.enabled ?? def.enabledByDefault;
    void ctx.settings
      .save({
        ...profile,
        modules: {
          ...profile.modules,
          [def.id]: { ...(profile.modules[def.id] ?? {}), enabled: !on },
        },
      })
      .then(() =>
        ctx.notices.show(`${def.title} turned ${on ? 'off' : 'on'}. Reload to apply.`, {
          timeoutMs: 5000,
        }),
      );
  }
  return true;
}

export function openCommandLine(ctx: ModuleContext): void {
  document.getElementById(ID)?.remove();
  ensureTheme();
  const input = h('input', {
    type: 'text',
    'data-rescue-input': '',
    'aria-label': 'REScue command',
    title: hint.cmdInput,
    placeholder: 'r/sub, u/name, me/saved, search …, settings …, ? for help',
  });
  const tip = h(
    'div',
    { class: 'rescue-cmdline-tip', role: 'status', title: hint.cmdTip },
    HINTS.join('  ·  '),
  );
  const list = h('ul', { class: 'rescue-cmdline-list', title: hint.cmdList });
  const box = h(
    'div',
    { id: ID, class: 'rescue-overlay', role: 'dialog', 'aria-label': 'Command line' },
    input,
    tip,
    list,
  );
  box.style.cssText =
    'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483646;width:min(640px,96vw);max-height:80vh;overflow:auto;box-sizing:border-box;padding:8px;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc);border-top:0;box-shadow:0 6px 20px rgba(0,0,0,.25);font:13px Verdana,Arial,sans-serif';
  input.style.cssText =
    'width:100%;box-sizing:border-box;padding:6px;font:inherit;background:var(--rescue-bg,#fff);color:var(--rescue-fg,#1a1a1b);border:1px solid var(--rescue-border,#ccc)';
  tip.style.cssText = 'margin-top:4px;color:var(--rescue-meta,#888);font-size:11px';
  list.style.cssText =
    'margin:4px 0 0;padding-left:18px;font-size:11px;color:var(--rescue-meta,#888)';
  for (const t of ['keydown', 'keyup', 'keypress'])
    box.addEventListener(t, (e) => e.stopPropagation());

  const show = (p: Parsed | null): void => {
    tip.textContent = p?.description || HINTS.join('  ·  ');
    list.replaceChildren(...(p?.lines ?? []).map((l) => h('li', null, l)));
  };
  input.addEventListener('input', () =>
    show(input.value.trim() ? parseCommand(input.value, ctx) : null),
  );
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') return box.remove();
    if (e.key !== 'Enter') return;
    const p = parseCommand(input.value, ctx);
    const newTab = e.altKey ? 'back' : e.shiftKey ? 'front' : null;
    if (!perform(p, ctx, newTab)) return show(p);
    box.remove();
  };
  input.addEventListener('keydown', onKey);
  active = { box, onKey };
  document.body.appendChild(box);
  input.focus();
}

/** The open command line, so Enter and Escape can be handled before the key dispatcher. */
let active: { box: HTMLElement; onKey(e: KeyboardEvent): void } | null = null;

/**
 * The key dispatcher swallows every keydown typed into a REScue input (so Reddit's shortcuts do
 * not fire), which also keeps the box's own listener from seeing it. This listener is added
 * before the dispatcher's, on the same capture phase, and takes Enter and Escape first.
 */
function onWindowKey(e: KeyboardEvent): void {
  if (!active?.box.isConnected || (e.key !== 'Enter' && e.key !== 'Escape')) return;
  if (!e.composedPath().includes(active.box)) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  active.onKey(e);
}

export const commandLine = defineModule({
  id: 'commandLine',
  resId: 'commandLine',
  category: 'core',
  title: 'Command line',
  description:
    'Press "." and type a command: r/sub, u/name, me/saved, search …, settings …, toggle …, or any keyboard shortcut by name. Type ? for the full list. Shift+Enter opens in a new tab.',
  enabledByDefault: true,
  options: {},
  init(ctx) {
    window.addEventListener('keydown', onWindowKey, true);
    ctx.keys.register({
      id: 'toggleCmdLine',
      title: 'Open the command line',
      defaultKeys: ['.'],
      run: () => (openCommandLine(ctx), true),
    });
    ctx.ui.addMenuItem({
      id: 'commandLine',
      label: 'Command line',
      order: 20,
      hint: () => hint.menuCommandLine,
      onClick: () => openCommandLine(ctx),
    });
  },
  dispose() {
    window.removeEventListener('keydown', onWindowKey, true);
  },
});
