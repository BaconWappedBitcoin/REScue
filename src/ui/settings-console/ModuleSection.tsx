/** One module's page in the settings console: toggle, options, defaults/reset, actions, links. */
import { hint } from '../../core/hints';
import {
  isModuleEnabled,
  resolveOptions,
  setOption,
  type SettingsProfile,
} from '../../core/settings';
import type { ModuleAction, ModuleDefinition, OptionSpec, OptionValue } from '../../core/types';
import { Highlight } from './Highlight';
import { OptionField } from './OptionField';
import type { ModuleMatch } from './search';

export interface SectionProps {
  def: ModuleDefinition;
  profile: SettingsProfile;
  status?: string;
  query: string;
  match: ModuleMatch | null;
  /** The option row a search result pointed at: shown even if advanced, and pulsed. */
  focusOption?: string;
  showAdvanced: boolean;
  commit(next: SettingsProfile): void;
  runAction(def: ModuleDefinition, action: ModuleAction, file?: File): Promise<void>;
  afterAction(): void;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A short human form of an option's default, as RES prints "default: X". */
export function describeDefault(spec: OptionSpec): string {
  const d = spec.default;
  if (spec.type === 'enum') return spec.values.find((v) => v.value === d)?.label ?? String(d);
  if (spec.type === 'table') return `${(d as unknown[]).length} rows`;
  if (spec.type === 'list') return (d as string[]).length ? (d as string[]).join(', ') : '(empty)';
  if (typeof d === 'boolean') return d ? 'on' : 'off';
  const s = String(d);
  if (!s) return '(empty)';
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

const optionKey = (id: string, name: string) => `${id}.${name}`;

/** Copy `#rescue:settings/<moduleId>`, the deep link to this module's page. */
export function copyDeepLink(moduleId: string): void {
  void navigator.clipboard?.writeText(`#rescue:settings/${moduleId}`).catch(() => undefined);
}

export function ModuleSection(p: SectionProps) {
  const { def: d, profile, query, match } = p;
  const enabled = d.locked || isModuleEnabled(d, profile);
  const opts = resolveOptions(d, profile);
  const entries = Object.entries(d.options);
  const shown = entries.filter(
    ([name, spec]) =>
      !spec.advanced ||
      p.showAdvanced ||
      match?.options.has(name) ||
      p.focusOption === optionKey(d.id, name),
  );
  const hiddenCount = entries.length - shown.length;
  const links = d.links?.() ?? [];

  const resetModule = () => {
    if (!confirm(`Reset “${d.title}” to its defaults? Its on/off switch and every option go back.`))
      return;
    const modules = { ...profile.modules };
    delete modules[d.id];
    p.commit({ ...profile, modules });
  };

  return (
    <section
      class={`module ${enabled ? '' : 'off'} ${match?.module ? 'match' : ''}`}
      id={`mod-${d.id}`}
    >
      <h2>
        <label>
          <input
            type="checkbox"
            data-module-toggle={d.id}
            checked={enabled}
            disabled={d.locked}
            onChange={(e) =>
              p.commit({
                ...profile,
                modules: {
                  ...profile.modules,
                  [d.id]: {
                    ...(profile.modules[d.id] ?? {}),
                    enabled: (e.currentTarget as HTMLInputElement).checked,
                  },
                },
              })
            }
          />{' '}
          <Highlight text={d.title} query={query} />
        </label>
        {p.status === 'disabled' && (
          <span class="badge warn">turned off on this page: Reddit changed something</span>
        )}
      </h2>
      <p class="desc">
        <Highlight text={d.description} query={query} />
      </p>
      {shown.map(([name, spec]) => {
        const key = optionKey(d.id, name);
        const value = opts[name] as OptionValue;
        const isMatch = match?.options.has(name);
        return (
          <div
            class={`option ${isMatch ? 'match' : ''} ${p.focusOption === key ? 'flash' : ''}`}
            data-option-row={key}
          >
            <div class="label">
              <label for={`opt-${key}`}>
                <Highlight text={spec.title} query={query} />
              </label>{' '}
              <button
                type="button"
                class="key"
                data-key-copy={key}
                title={hint.copyKey}
                onClick={() => copyDeepLink(d.id)}
              >
                <Highlight text={key} query={query} />
              </button>
              {spec.advanced && <span class="badge">advanced</span>}
            </div>
            <div class="control">
              <OptionField
                name={key}
                testId={key}
                spec={spec}
                value={value}
                onChange={(v) => p.commit(setOption(profile, d, name, v))}
              />
              <span class="default" data-default={key}>
                default: {describeDefault(spec)}
              </span>
              {!same(value, spec.default) && (
                <button
                  type="button"
                  class="reset"
                  data-reset={key}
                  aria-label={`Reset ${spec.title} to default`}
                  title={hint.resetOption(spec.title)}
                  onClick={() => p.commit(setOption(profile, d, name, spec.default))}
                >
                  reset
                </button>
              )}
            </div>
            {spec.description && (
              <p class="hint">
                <Highlight text={spec.description} query={query} />
              </p>
            )}
          </div>
        );
      })}
      {hiddenCount > 0 && (
        <p class="hint" data-advanced-hidden={d.id}>
          {hiddenCount} advanced option{hiddenCount === 1 ? '' : 's'} hidden. Tick “Show advanced
          options” to see {hiddenCount === 1 ? 'it' : 'them'}.
        </p>
      )}
      <div class="actions">
        {d.actions?.map((a) =>
          a.kind === 'file' ? (
            <label class="file">
              {a.label}
              <input
                type="file"
                accept="application/json,.json"
                data-action={`${d.id}.${a.id}`}
                onChange={(e) => {
                  const f = (e.currentTarget as HTMLInputElement).files?.[0];
                  if (f && (!a.confirm || confirm(a.confirm)))
                    void p.runAction(d, a, f).then(p.afterAction);
                }}
              />
            </label>
          ) : (
            <button
              type="button"
              data-action={`${d.id}.${a.id}`}
              onClick={() => {
                if (!a.confirm || confirm(a.confirm)) void p.runAction(d, a).then(p.afterAction);
              }}
            >
              {a.label}
            </button>
          ),
        )}
        <button type="button" class="reset-module" data-reset-module={d.id} onClick={resetModule}>
          Reset module to defaults
        </button>
      </div>
      {links.length > 0 && (
        <ul class="links" data-links={d.id}>
          {links.map((l) => (
            <li>
              {l.href ? (
                <a href={l.href} target="_blank" rel="noopener noreferrer">
                  {l.label}
                </a>
              ) : l.text ? (
                <details>
                  <summary>{l.label}</summary>
                  <pre>{l.text}</pre>
                </details>
              ) : (
                <span>{l.label}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
