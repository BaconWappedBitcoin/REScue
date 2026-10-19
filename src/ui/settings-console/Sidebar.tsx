/** The console's left column: search box, categories that expand to their modules, advanced toggle. */
import type { Ref } from 'preact';
import { hint } from '../../core/hints';
import { CONSOLE_CATEGORIES, type ConsoleCategory } from './categories';

/** One module (or the Sync page) in the sidebar and category overview. */
export interface Entry {
  id: string;
  title: string;
  description: string;
  /** On/off; absent for entries without a switch. */
  enabled: boolean;
}

export type View = { kind: 'category'; id: ConsoleCategory } | { kind: 'module'; id: string };

interface Props {
  groups: Map<ConsoleCategory, Entry[]>;
  view: View;
  query: string;
  /** The main pane shows search results (so no category or module is current). */
  searching: boolean;
  searchRef: Ref<HTMLInputElement>;
  showAdvanced: boolean;
  onQuery(q: string): void;
  onSearchFocus(): void;
  onCategory(id: ConsoleCategory): void;
  onModule(id: string): void;
  onAdvanced(on: boolean): void;
  /** The category the current view belongs to (a module page keeps its category open). */
  openCategory: ConsoleCategory;
}

export function Sidebar(p: Props) {
  const searching = p.searching;
  return (
    <nav class="sidebar" aria-label="Settings">
      <div class="search-box">
        <input
          type="search"
          class="search"
          placeholder="Search all settings"
          aria-label="Search all settings"
          aria-keyshortcuts="/"
          title={hint.consoleSearch}
          data-rescue-input=""
          ref={p.searchRef}
          value={p.query}
          onFocus={p.onSearchFocus}
          onInput={(e) => p.onQuery((e.currentTarget as HTMLInputElement).value)}
        />
        <span class="search-tip">
          Press <kbd>/</kbd> to search
        </span>
      </div>
      <div class="tree">
        {CONSOLE_CATEGORIES.map((c) => {
          const entries = p.groups.get(c.id) ?? [];
          if (entries.length === 0) return null;
          const open = !searching && c.id === p.openCategory;
          const current = !searching && p.view.kind === 'category' && p.view.id === c.id;
          return (
            <div class="cat" data-category-group={c.id}>
              <button
                type="button"
                class={`cat-button ${current ? 'selected' : ''}`}
                data-category={c.id}
                aria-expanded={open}
                aria-current={current ? 'page' : undefined}
                title={hint.consoleCategory(c.title)}
                onClick={() => p.onCategory(c.id)}
              >
                {c.title}
                <span class="count" aria-hidden="true">
                  {entries.length}
                </span>
              </button>
              {open && (
                <ul class="mods">
                  {entries.map((e) => {
                    const sel = p.view.kind === 'module' && p.view.id === e.id;
                    return (
                      <li>
                        <button
                          type="button"
                          class={`mod-button ${sel ? 'selected' : ''} ${e.enabled ? '' : 'is-off'}`}
                          data-module-link={e.id}
                          aria-current={sel ? 'page' : undefined}
                          onClick={() => p.onModule(e.id)}
                        >
                          <span class="mod-title">{e.title}</span>
                          <span class={`pill ${e.enabled ? 'on' : 'off'}`}>
                            {e.enabled ? 'on' : 'off'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <label class="advanced-toggle">
        <input
          type="checkbox"
          data-setting="showAdvanced"
          checked={p.showAdvanced}
          onChange={(e) => p.onAdvanced((e.currentTarget as HTMLInputElement).checked)}
        />{' '}
        Show advanced options
      </label>
    </nav>
  );
}
