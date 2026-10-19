/**
 * REScue settings console (RES gear menu + settings). Schema-driven; see OptionField.
 * Layout follows RES: a sidebar of categories that open to their modules, one page per module, and
 * a search box that lists matching options across every module.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { hint, label } from '../../core/hints';
import { isModuleEnabled, type SettingsProfile } from '../../core/settings';
import type { ModuleAction, ModuleDefinition, SettingsApi } from '../../core/types';
import { loadShowAdvanced, saveShowAdvanced } from './advancedPref';
import {
  categoryFromTarget,
  CONSOLE_CATEGORIES,
  consoleCategoryOf,
  groupByCategory,
  type ConsoleCategory,
} from './categories';
import { ModuleSection } from './ModuleSection';
import { CategoryOverview, SearchResults, type ExtraHit } from './Overview';
import { matchModule, searchModules, textMatches } from './search';
import { Sidebar, type Entry, type View } from './Sidebar';

interface Props {
  settings: SettingsApi;
  runAction(def: ModuleDefinition, action: ModuleAction, file?: File): Promise<void>;
  target?: string;
  onClose(): void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** The Sync switch lives in Core as a page of its own (it is not a module). */
const SYNC_ID = 'sync';
const SYNC_TITLE = 'Sync';
const SYNC_TEXT = 'Sync settings through my browser account (tags and filters stay on this device)';

const SAVE_TEXT: Record<SaveState, string> = {
  idle: '',
  saving: 'saving…',
  saved: 'saved',
  error: 'could not save',
};

/** Keys typed into a field must stay in the field: `/` only jumps to search from elsewhere. */
function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el?.tagName) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return true;
  return (
    el.tagName === 'INPUT' && !/^(checkbox|radio|button|file)$/.test((el as HTMLInputElement).type)
  );
}

export function SettingsConsole({ settings, runAction, target, onClose }: Props) {
  const defs = settings.definitions();
  const [profile, setProfile] = useState<SettingsProfile>(settings.profile());
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [focusOption, setFocusOption] = useState<string | undefined>();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [save, setSave] = useState<SaveState>('idle');
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  const groups = useMemo(() => {
    const byCat = groupByCategory(defs);
    const out = new Map<ConsoleCategory, Entry[]>();
    for (const [cat, list] of byCat) {
      const entries: Entry[] = list.map((d) => ({
        id: d.id,
        title: d.title,
        description: d.description,
        enabled: !!d.locked || isModuleEnabled(d, profile),
      }));
      if (cat === 'core')
        entries.unshift({
          id: SYNC_ID,
          title: SYNC_TITLE,
          description: SYNC_TEXT,
          enabled: profile.syncEnabled,
        });
      out.set(cat, entries);
    }
    return out;
  }, [defs, profile]);

  const resolveTarget = (): View => {
    if (target === SYNC_ID) return { kind: 'module', id: SYNC_ID };
    if (target && defs.some((d) => d.id === target)) return { kind: 'module', id: target };
    const cat = categoryFromTarget(target);
    if (cat) return { kind: 'category', id: cat };
    const first = CONSOLE_CATEGORIES.find((c) => (groups.get(c.id) ?? []).length > 0);
    return { kind: 'category', id: first?.id ?? 'core' };
  };
  const [view, setView] = useState<View>(resolveTarget);

  const categoryOfView = (v: View): ConsoleCategory => {
    if (v.kind === 'category') return v.id;
    const d = defs.find((x) => x.id === v.id);
    return d ? consoleCategoryOf(d) : 'core';
  };

  useEffect(() => {
    void loadShowAdvanced().then(setShowAdvanced);
  }, []);

  // A new deep link (`#rescue:settings/<name>`) while the console is open.
  useEffect(() => {
    setView(resolveTarget());
    setQuery('');
    setShowResults(false);
    setFocusOption(undefined);
  }, [target]);

  // Bring the chosen option (from a search result) or the top of the page into view.
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const row = focusOption
      ? [...main.querySelectorAll<HTMLElement>('[data-option-row]')].find(
          (el) => el.getAttribute('data-option-row') === focusOption,
        )
      : undefined;
    if (row?.scrollIntoView) row.scrollIntoView({ block: 'center' });
    else main.scrollTop = 0;
  }, [view, focusOption, showResults]);

  const commit = async (next: SettingsProfile) => {
    const base = profile; // what this change was built from, possibly older than what is stored
    setProfile(next);
    setSave('saving');
    try {
      await settings.save(next, base);
      setProfile(settings.profile()); // now includes whatever other tabs saved meanwhile
      setSave('saved');
    } catch {
      setSave('error');
    }
  };

  const go = (v: View, option?: string, keepQuery = false) => {
    setView(v);
    setFocusOption(option);
    setShowResults(false);
    if (!keepQuery) setQuery('');
  };

  const searching = showResults && query.trim() !== '';
  const hits = useMemo(
    () => (searching ? searchModules(defs, query) : []),
    [defs, query, searching],
  );
  const extra: ExtraHit[] = useMemo(
    () =>
      searching && (textMatches(SYNC_TITLE, query) || textMatches(SYNC_TEXT, query))
        ? [{ id: SYNC_ID, title: SYNC_TITLE, text: SYNC_TEXT }]
        : [],
    [query, searching],
  );

  const onKeyDown = (e: KeyboardEvent) => {
    const search = searchRef.current;
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
      e.preventDefault();
      search?.focus();
      search?.select();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      // Only inside the console: the page's own find is untouched elsewhere.
      e.preventDefault();
      search?.focus();
      search?.select();
    }
    if (e.key === 'Escape') {
      // REScue's key handler lets Escape through from its own inputs for this: it clears the search
      // box first, and from an empty box (or any other field) it closes the console.
      e.preventDefault();
      e.stopPropagation();
      if (e.target === search && query !== '') go({ kind: 'category', id: openCategory });
      else onClose();
    }
  };

  const openCategory = categoryOfView(view);
  const def = view.kind === 'module' ? defs.find((d) => d.id === view.id) : undefined;
  const catTitle = CONSOLE_CATEGORIES.find((c) => c.id === openCategory)?.title ?? '';

  return (
    <div
      class="console"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rescue-settings-title"
      data-save-state={save}
      onKeyDown={onKeyDown}
    >
      <header>
        <h1 id="rescue-settings-title">REScue settings</h1>
        <div class="autosave-wrap">
          <span class="autosave" data-autosave="">
            Changes save automatically
          </span>
          <span class={`save ${save}`} role="status" aria-live="polite" data-save-status="">
            {SAVE_TEXT[save]}
          </span>
        </div>
        <button
          type="button"
          class="close"
          aria-label="Close settings"
          title={hint.consoleClose}
          onClick={onClose}
        >
          {label.close}
        </button>
      </header>
      <div class="body">
        <Sidebar
          groups={groups}
          view={view}
          query={query}
          searching={searching}
          searchRef={searchRef}
          showAdvanced={showAdvanced}
          openCategory={openCategory}
          onQuery={(q) => {
            setQuery(q);
            setShowResults(q.trim() !== '');
          }}
          onSearchFocus={() => query.trim() !== '' && setShowResults(true)}
          onCategory={(id) => go({ kind: 'category', id })}
          onModule={(id) => go({ kind: 'module', id })}
          onAdvanced={(on) => {
            setShowAdvanced(on);
            saveShowAdvanced(on);
          }}
        />
        <main ref={mainRef}>
          {searching ? (
            <SearchResults
              query={query}
              hits={hits}
              extra={extra}
              onOpen={(id, option) =>
                go({ kind: 'module', id }, option ? `${id}.${option}` : undefined, true)
              }
            />
          ) : view.kind === 'category' ? (
            <CategoryOverview
              category={view.id}
              entries={groups.get(view.id) ?? []}
              onModule={(id) => go({ kind: 'module', id })}
            />
          ) : (
            <>
              <button
                type="button"
                class="back"
                data-back={openCategory}
                title={hint.consoleBack(catTitle)}
                onClick={() => go({ kind: 'category', id: openCategory })}
              >
                ‹ {catTitle}
              </button>
              {view.id === SYNC_ID ? (
                <section class="module" id="mod-sync">
                  <h2>{SYNC_TITLE}</h2>
                  <label>
                    <input
                      type="checkbox"
                      data-setting="syncEnabled"
                      checked={profile.syncEnabled}
                      onChange={(e) =>
                        void commit({
                          ...profile,
                          syncEnabled: (e.currentTarget as HTMLInputElement).checked,
                        })
                      }
                    />{' '}
                    {SYNC_TEXT}
                  </label>
                </section>
              ) : def ? (
                <ModuleSection
                  key={def.id}
                  def={def}
                  profile={profile}
                  status={settings.status(def.id)}
                  query={query}
                  match={query ? matchModule(def, query) : null}
                  focusOption={focusOption}
                  showAdvanced={showAdvanced}
                  commit={(next) => void commit(next)}
                  runAction={runAction}
                  afterAction={() => setProfile(settings.profile())}
                />
              ) : (
                <p class="empty">That feature is not available.</p>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
