/**
 * The command-line registry (RES commandLine `registerCommand`). A command is a name (plus
 * aliases) and a resolver that turns the arguments into what to do; the command line performs it.
 * Other modules add commands with `registerCommand` while they initialise.
 */
import type { ModuleContext } from '../../core/types';

/** What a command resolved to. `go` targets may be relative or absolute URLs. */
export interface Parsed {
  kind: 'go' | 'settings' | 'toggle' | 'command' | 'action' | 'message' | 'unknown';
  target: string;
  description: string;
  /** For kind 'action': what to do when Enter is pressed. */
  action?: (ctx: ModuleContext) => void;
  /** Extra lines for the tip area (the `?` command lists every command here). */
  lines?: string[];
}

export type CommandEnv = Pick<ModuleContext, 'route' | 'settings' | 'keys'> & {
  session?: ModuleContext['session'];
};

export interface CommandDef {
  /** The word typed first, e.g. "search". Matched case-insensitively, together with `aliases`. */
  name: string;
  aliases?: string[];
  /** Shown by `?`. */
  description: string;
  /**
   * For commands typed as a shape rather than a word (`r/rust`, `/t week`): tested against the
   * whole input (trimmed) instead of `name`. The match is passed to `run`.
   */
  pattern?: RegExp;
  /** `args` is the text after the first word (the whole input for a `pattern` command). */
  run(args: string, env: CommandEnv, match?: RegExpExecArray): Parsed;
}

const commands: CommandDef[] = [];

/** Adds a command (replacing one with the same name). Returns a function that removes it. */
export function registerCommand(def: CommandDef): () => void {
  const at = commands.findIndex((c) => c.name === def.name);
  if (at >= 0) commands.splice(at, 1, def);
  else commands.push(def);
  return () => {
    const i = commands.indexOf(def);
    if (i >= 0) commands.splice(i, 1);
  };
}

export function listCommands(): CommandDef[] {
  return [...commands];
}

export const go = (target: string, description: string): Parsed => ({
  kind: 'go',
  target,
  description,
});
export const act = (description: string, action: (ctx: ModuleContext) => void): Parsed => ({
  kind: 'action',
  target: '',
  description,
  action,
});
export const message = (description: string, lines?: string[]): Parsed => ({
  kind: 'message',
  target: '',
  description,
  ...(lines ? { lines } : {}),
});

/** Resolves typed text against the registry, then against keyboard shortcut names. */
export function resolveCommand(input: string, env: CommandEnv): Parsed {
  const text = input.trim();
  const [head = '', ...rest] = text.split(/\s+/);
  const args = rest.join(' ');
  const lower = head.toLowerCase();
  for (const c of commands) {
    if (c.pattern) {
      const match = c.pattern.exec(text);
      if (match) return c.run(text, env, match);
    } else if (
      c.name.toLowerCase() === lower ||
      c.aliases?.some((a) => a.toLowerCase() === lower)
    ) {
      return c.run(args, env);
    }
  }
  const cmd = env.keys
    .list()
    .find((k) => k.id.toLowerCase() === lower || k.title.toLowerCase() === text.toLowerCase());
  if (cmd) return { kind: 'command', target: cmd.id, description: cmd.title };
  return { kind: 'unknown', target: '', description: text ? `Unknown command “${text}”` : '' };
}
