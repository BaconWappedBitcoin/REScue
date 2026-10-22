/**
 * Keyboard dispatcher and command registry (research R11). One capture-phase listener on window:
 *  - keys typed into any editable element (including inside shadow roots) are never commands;
 *  - a handled key is stopped so Reddit's own shortcut handler never also acts on it;
 *  - keys typed inside REScue's own inputs are stopped from reaching Reddit's handlers at all.
 * Commands share keys across contexts (RES: `k` is "previous post" on listings and "previous
 * comment" in threads); the first command whose enabled() is true handles the key. Bindings may be
 * two-key sequences ("g f", RES go mode).
 */
export interface Command {
  id: string;
  title: string;
  /** Chords or sequences, e.g. "j", "shift+j", "g f". */
  defaultKeys: string[];
  /** Conflict group: two commands only conflict when they share a context. */
  context?: string;
  /** Heading the help list files this command under ("Move", "Open", ...). */
  section?: string;
  /** Whether the command applies right now (page type, selection...). */
  enabled?(): boolean;
  /** Return false to decline, letting the key through. */
  run(e: KeyboardEvent): void | boolean;
}

const NAMED: Record<string, string> = {
  ' ': 'space',
  escape: 'escape',
  esc: 'escape',
  return: 'enter',
};

/**
 * With Alt held, some layouts (macOS) type a different character ("alt+y" gives "¥"), so the
 * physical key is used for letters, digits and "/" instead.
 */
function altKeyOf(code: string): string | null {
  const m = /^(?:Key([A-Z])|Digit(\d))$/.exec(code);
  if (m) return (m[1] ?? m[2])!.toLowerCase();
  return code === 'Slash' ? '/' : null;
}

/** Canonical chord: modifiers in fixed order, then the key, e.g. "shift+j", "ctrl+alt+k", "?". */
export function chordOf(e: KeyboardEvent): string {
  const raw = e.key.toLowerCase();
  const key = NAMED[raw] ?? (e.altKey ? (altKeyOf(e.code) ?? raw) : raw);
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.metaKey) mods.push('meta');
  // Shift is implied by printable symbols like "?" — only record it for letters and named keys.
  if (e.shiftKey && (/^[a-z]$/.test(key) || key.length > 1)) mods.push('shift');
  return [...mods, key].join('+');
}

const MOD_ORDER = ['ctrl', 'alt', 'meta', 'shift'];

/** Parse "Shift+J", "alt+shift+k" or "g f" into canonical chords. */
export function parseChord(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      const bits = part.toLowerCase().split('+');
      const key = bits.pop() ?? '';
      const mods = MOD_ORDER.filter((m) => bits.includes(m));
      return [...mods, NAMED[key] ?? key].join('+');
    });
}

export function isEditableTarget(e: Event): boolean {
  for (const node of e.composedPath()) {
    if (!(node instanceof Element)) continue;
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if ((node as HTMLElement).isContentEditable) return true;
    const ce = node.getAttribute('contenteditable');
    if (ce === '' || ce === 'true' || ce === 'plaintext-only') return true;
    if (node.getAttribute('role') === 'textbox') return true;
  }
  return false;
}

/** Marker attribute REScue puts on its own text inputs / roots. */
export const REScue_INPUT_ATTR = 'data-rescue-input';

const SEQUENCE_TIMEOUT_MS = 2000;

export class KeyDispatcher {
  private readonly commands = new Map<string, Command>();
  private bindings = new Map<string, string[]>(); // key sequence ("g f") -> command ids
  private prefixes = new Set<string>(); // first chords of multi-key sequences
  private overrides: Record<string, string[]> = {};
  private pending: { chord: string; timer: ReturnType<typeof setTimeout> } | null = null;
  private readonly onKey = (e: KeyboardEvent) => this.handle(e);

  /**
   * Adds a command; the returned function removes it again (a module's dispose, so switching the
   * module back on can register it afresh). It only removes this registration, never a later one
   * that reused the id.
   */
  register(cmd: Command): () => void {
    if (this.commands.has(cmd.id)) throw new Error(`Duplicate command: ${cmd.id}`);
    this.commands.set(cmd.id, cmd);
    this.rebuild();
    return () => {
      if (this.commands.get(cmd.id) !== cmd) return;
      this.commands.delete(cmd.id);
      this.rebuild();
    };
  }

  setOverrides(overrides: Record<string, string[]>): void {
    this.overrides = overrides;
    this.rebuild();
  }

  keysOf(cmd: Command): string[] {
    return (this.overrides[cmd.id] ?? cmd.defaultKeys)
      .map((k) => parseChord(k).join(' '))
      .filter(Boolean);
  }

  /** Keys bound to more than one command in the same context, for the keybinding editor. */
  conflicts(): Record<string, string[]> {
    const seen: Record<string, string[]> = {};
    for (const cmd of this.commands.values()) {
      for (const k of this.keysOf(cmd))
        (seen[`${cmd.context ?? ''}\u0000${k}`] ??= []).push(cmd.id);
    }
    return Object.fromEntries(
      Object.entries(seen)
        .filter(([, ids]) => ids.length > 1)
        .map(([k, ids]) => [k.split('\u0000')[1]!, ids]),
    );
  }

  list(): Array<{
    id: string;
    title: string;
    keys: string[];
    context?: string;
    section?: string;
  }> {
    return [...this.commands.values()].map((c) => ({
      id: c.id,
      title: c.title,
      keys: this.keysOf(c),
      ...(c.context ? { context: c.context } : {}),
      ...(c.section ? { section: c.section } : {}),
    }));
  }

  /** Run a command by id (command line, help overlay). */
  run(id: string): boolean {
    const cmd = this.commands.get(id);
    if (!cmd || (cmd.enabled && !cmd.enabled())) return false;
    return cmd.run(new KeyboardEvent('keydown')) !== false;
  }

  attach(win: Window = window): () => void {
    win.addEventListener('keydown', this.onKey, true);
    return () => win.removeEventListener('keydown', this.onKey, true);
  }

  private rebuild(): void {
    const b = new Map<string, string[]>();
    const prefixes = new Set<string>();
    for (const cmd of this.commands.values()) {
      for (const k of this.keysOf(cmd)) {
        const ids = b.get(k) ?? [];
        ids.push(cmd.id);
        b.set(k, ids);
        const parts = k.split(' ');
        if (parts.length > 1) prefixes.add(parts[0]!);
      }
    }
    this.bindings = b;
    this.prefixes = prefixes;
  }

  private tryRun(seq: string, e: KeyboardEvent): boolean {
    for (const id of this.bindings.get(seq) ?? []) {
      const cmd = this.commands.get(id)!;
      if (cmd.enabled && !cmd.enabled()) continue;
      if (cmd.run(e) === false) continue;
      e.preventDefault();
      e.stopImmediatePropagation();
      return true;
    }
    return false;
  }

  handle(e: KeyboardEvent): void {
    if (e.isComposing || e.defaultPrevented) return;
    if (['shift', 'control', 'alt', 'meta'].includes(e.key.toLowerCase())) return;
    if (isEditableTarget(e)) {
      // Our own inputs: keep Reddit's handlers from treating typing as shortcuts (Sheddit bug).
      // Escape is let through so a dialog around the field can clear it or close (the settings
      // console does this); every other key stays contained in the field.
      if (
        e.key !== 'Escape' &&
        e.composedPath().some((n) => n instanceof Element && n.hasAttribute(REScue_INPUT_ATTR))
      ) {
        e.stopImmediatePropagation();
      }
      return;
    }
    const chord = chordOf(e);
    if (this.pending) {
      const seq = `${this.pending.chord} ${chord}`;
      clearTimeout(this.pending.timer);
      this.pending = null;
      if (this.tryRun(seq, e)) return;
    }
    if (this.tryRun(chord, e)) return;
    if (this.prefixes.has(chord)) {
      this.pending = { chord, timer: setTimeout(() => (this.pending = null), SEQUENCE_TIMEOUT_MS) };
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }
}
