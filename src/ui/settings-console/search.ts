import type { ModuleDefinition } from '../../core/types';

/** Which parts of a module the query matched (for highlighting). */
export interface ModuleMatch {
  /** The module's id, title, description or RES name matched. */
  module: boolean;
  /** Option names (not keys) whose key, title or description matched. */
  options: Set<string>;
}

const norm = (q: string) => q.trim().toLowerCase();
const has = (text: string | undefined, q: string) => (text ?? '').toLowerCase().includes(q);

/** Match one module against a query, or null when nothing in it matches. */
export function matchModule(d: ModuleDefinition, query: string): ModuleMatch | null {
  const q = norm(query);
  if (!q) return { module: false, options: new Set() };
  const module = [d.id, d.title, d.description, d.resId].some((t) => has(t, q));
  const options = new Set<string>();
  for (const [name, o] of Object.entries(d.options))
    if ([name, `${d.id}.${name}`, o.title, o.description].some((t) => has(t, q))) options.add(name);
  return module || options.size ? { module, options } : null;
}

/** Case-insensitive match on id, title, description, and option keys, titles and descriptions. */
export function filterModules(defs: ModuleDefinition[], query: string): ModuleDefinition[] {
  if (!norm(query)) return defs;
  return defs.filter((d) => matchModule(d, query) !== null);
}

/** One module with what matched in it, for the results list. */
export interface SearchHit {
  def: ModuleDefinition;
  match: ModuleMatch;
}

/** Every module that matches, modules whose own title/description matched first (stable otherwise). */
export function searchModules(defs: ModuleDefinition[], query: string): SearchHit[] {
  if (!norm(query)) return [];
  const hits: SearchHit[] = [];
  for (const def of defs) {
    const match = matchModule(def, query);
    if (match) hits.push({ def, match });
  }
  return [...hits.filter((h) => h.match.module), ...hits.filter((h) => !h.match.module)];
}

/** Whether free text contains the query (case-insensitive). */
export const textMatches = (text: string | undefined, query: string): boolean =>
  has(text, norm(query));

/** A short excerpt of `text` around the first match (or its start), with … where it was cut. */
export function snippet(text: string, query: string, max = 180): string {
  if (text.length <= max) return text;
  const at = Math.max(0, text.toLowerCase().indexOf(norm(query)));
  const start = Math.max(0, Math.min(at - 40, text.length - max));
  const cut = text.slice(start, start + max).trim();
  return `${start > 0 ? '…' : ''}${cut}${start + max < text.length ? '…' : ''}`;
}
