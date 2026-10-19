/** The two list pages of the console: a category's modules, and the results of a search. */
import type { ModuleDefinition } from '../../core/types';
import { CONSOLE_CATEGORIES, consoleCategoryOf } from './categories';
import { Highlight } from './Highlight';
import { snippet, type SearchHit } from './search';
import type { Entry } from './Sidebar';
import type { ConsoleCategory } from './categories';

export function CategoryOverview(p: {
  category: ConsoleCategory;
  entries: Entry[];
  onModule(id: string): void;
}) {
  const info = CONSOLE_CATEGORIES.find((c) => c.id === p.category)!;
  return (
    <section class="overview" data-overview={p.category}>
      <h2>{info.title}</h2>
      <p class="desc">{info.blurb}</p>
      <ul class="overview-list">
        {p.entries.map((e) => (
          <li>
            <button type="button" data-overview-module={e.id} onClick={() => p.onModule(e.id)}>
              <span class="row-title">
                {e.title}
                <span class={`pill ${e.enabled ? 'on' : 'off'}`}>{e.enabled ? 'on' : 'off'}</span>
              </span>
              <span class="row-desc">{e.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A result for text that is not a module definition (the Sync switch). */
export interface ExtraHit {
  id: string;
  title: string;
  text: string;
}

export function SearchResults(p: {
  query: string;
  hits: SearchHit[];
  extra: ExtraHit[];
  onOpen(moduleId: string, option?: string): void;
}) {
  const none = p.hits.length === 0 && p.extra.length === 0;
  const catTitle = (d: ModuleDefinition) =>
    CONSOLE_CATEGORIES.find((c) => c.id === consoleCategoryOf(d))?.title ?? '';
  return (
    <section class="results" data-search-results="">
      <h2>
        {none
          ? `No settings match “${p.query.trim()}”.`
          : `${p.hits.length + p.extra.length} feature${p.hits.length + p.extra.length === 1 ? '' : 's'} match “${p.query.trim()}”`}
      </h2>
      {p.extra.map((x) => (
        <div class="result-group">
          <button
            type="button"
            class="result-module"
            data-result-module={x.id}
            onClick={() => p.onOpen(x.id)}
          >
            <Highlight text={x.title} query={p.query} />
            <span class="crumb">Core</span>
          </button>
          <p class="hint">
            <Highlight text={snippet(x.text, p.query)} query={p.query} />
          </p>
        </div>
      ))}
      {p.hits.map(({ def: d, match }) => (
        <div class="result-group" data-result-group={d.id}>
          <button
            type="button"
            class="result-module"
            data-result-module={d.id}
            onClick={() => p.onOpen(d.id)}
          >
            <Highlight text={d.title} query={p.query} />
            <span class="crumb">{catTitle(d)}</span>
          </button>
          {match.module && (
            <p class="hint">
              <Highlight text={snippet(d.description, p.query)} query={p.query} />
            </p>
          )}
          <ul class="result-options">
            {[...match.options].map((name) => {
              const spec = d.options[name]!;
              return (
                <li>
                  <button
                    type="button"
                    data-result-option={`${d.id}.${name}`}
                    onClick={() => p.onOpen(d.id, name)}
                  >
                    <span class="row-title">
                      <Highlight text={spec.title} query={p.query} />
                      <span class="key-text">
                        <Highlight text={`${d.id}.${name}`} query={p.query} />
                      </span>
                    </span>
                    {spec.description && (
                      <span class="row-desc">
                        <Highlight text={snippet(spec.description, p.query)} query={p.query} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
