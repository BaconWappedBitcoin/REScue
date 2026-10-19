import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, render } from 'preact';
import { defaultProfile, type SettingsProfile } from '../../src/core/settings';
import type { ModuleDefinition, OptionSpec, SettingsApi } from '../../src/core/types';
import { SettingsConsole } from '../../src/ui/settings-console/SettingsConsole';
import { OptionField } from '../../src/ui/settings-console/OptionField';
import {
  filterModules,
  matchModule,
  searchModules,
  snippet,
} from '../../src/ui/settings-console/search';
import { about } from '../../src/modules/core/troubleshooter';

const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const fire = (el: Element, type: string) => el.dispatchEvent(new Event(type, { bubbles: true }));

/** happy-dom lacks ondrag* properties, so Preact listens under the camel-case name there. */
const drag = (el: Element, name: 'dragstart' | 'dragover' | 'drop') => {
  const camel = { dragstart: 'DragStart', dragover: 'DragOver', drop: 'Drop' }[name];
  for (const n of [name, camel])
    el.dispatchEvent(new Event(n, { bubbles: true, cancelable: true }));
};

const mod = (over: Partial<ModuleDefinition> = {}): ModuleDefinition => ({
  id: 'demo',
  category: 'core',
  title: 'Demo module',
  description: 'Does demo things.',
  enabledByDefault: true,
  options: {
    size: { type: 'number', default: 5, min: 0, max: 99, title: 'Size' },
    secret: {
      type: 'text',
      default: 'abc',
      title: 'Secret knob',
      description: 'Handle with care.',
      advanced: true,
    },
    on: { type: 'boolean', default: true, title: 'Enabled thing' },
  },
  ...over,
});

let host: HTMLElement;
let saved: SettingsProfile[];

function mount(
  defs: ModuleDefinition[],
  profile: SettingsProfile = defaultProfile(),
  target: string | undefined = defs[0]?.id,
) {
  saved = [];
  let current = profile;
  const settings: SettingsApi = {
    profile: () => current,
    save: async (next) => {
      current = next;
      saved.push(next);
    },
    definitions: () => defs,
    status: () => undefined,
    runAction: async () => undefined,
    report: () => [],
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  render(
    h(SettingsConsole, {
      settings,
      runAction: async () => undefined,
      onClose: () => undefined,
      target,
    }),
    host,
  );
  return host;
}

beforeEach(async () => {
  await browser.storage.local.clear();
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('show advanced options', () => {
  it('hides advanced options until the box is checked, and remembers the choice', async () => {
    const el = mount([mod()]);
    await tick();
    expect(el.querySelector('[data-option="demo.secret"]')).toBeNull();
    expect(el.querySelector('[data-advanced-hidden="demo"]')!.textContent).toContain('1 advanced');
    const box = el.querySelector<HTMLInputElement>('input[data-setting=showAdvanced]')!;
    box.checked = true;
    fire(box, 'change');
    await tick();
    expect(el.querySelector('[data-option="demo.secret"]')).not.toBeNull();
    expect((await browser.storage.local.get('consoleShowAdvanced')).consoleShowAdvanced).toBe(true);

    render(null, host);
    host.remove();
    const again = mount([mod()]);
    await tick();
    expect(again.querySelector('[data-option="demo.secret"]')).not.toBeNull();
    expect(again.querySelector<HTMLInputElement>('input[data-setting=showAdvanced]')!.checked).toBe(
      true,
    );
  });
});

describe('defaults and reset', () => {
  it('shows each default and a reset control only when the value differs', async () => {
    const profile = { ...defaultProfile(), modules: { demo: { options: { size: 9 } } } };
    const el = mount([mod()], profile);
    await tick();
    expect(el.querySelector('[data-default="demo.size"]')!.textContent).toBe('default: 5');
    expect(el.querySelector('[data-default="demo.on"]')!.textContent).toBe('default: on');
    expect(el.querySelector('[data-reset="demo.size"]')).not.toBeNull();
    expect(el.querySelector('[data-reset="demo.on"]')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-reset="demo.size"]')!.click();
    await tick();
    expect(saved.at(-1)!.modules.demo?.options?.size).toBeUndefined();
    expect(el.querySelector('[data-reset="demo.size"]')).toBeNull();
  });

  it('resets a whole module after confirmation, and not when declined', async () => {
    const profile = {
      ...defaultProfile(),
      modules: { demo: { enabled: false, options: { size: 9 } }, other: { enabled: false } },
    };
    const el = mount([mod()], profile);
    await tick();
    const ask = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', ask);
    const btn = el.querySelector<HTMLButtonElement>('[data-reset-module="demo"]')!;
    btn.click();
    await tick();
    expect(ask).toHaveBeenCalledOnce();
    expect(saved).toHaveLength(0);
    ask.mockReturnValue(true);
    btn.click();
    await tick();
    expect(saved.at(-1)!.modules.demo).toBeUndefined();
    expect(saved.at(-1)!.modules.other).toEqual({ enabled: false });
  });
});

describe('option keys', () => {
  it('shows moduleId.optionKey and copies the module deep link', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    });
    const el = mount([mod()]);
    await tick();
    const key = el.querySelector<HTMLButtonElement>('[data-key-copy="demo.size"]')!;
    expect(key.textContent).toBe('demo.size');
    key.click();
    expect(write).toHaveBeenCalledWith('#rescue:settings/demo');
  });
});

describe('table row order', () => {
  const spec: OptionSpec = {
    type: 'table',
    default: [],
    title: 'T',
    columns: [{ key: 'a', title: 'A', type: 'text' }],
  };
  const rows = [{ a: 'one' }, { a: 'two' }, { a: 'three' }];
  const mountTable = () => {
    const onChange = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    render(h(OptionField, { name: 't', spec, value: rows as never, onChange }), host);
    return onChange;
  };
  const btn = (row: number, action: string) => {
    const tr = host.querySelectorAll('tbody tr')[row]!;
    return tr.querySelector<HTMLButtonElement>(`button[data-action=${action}]`)!;
  };

  it('moves rows with the up and down buttons; the ends are disabled', () => {
    const onChange = mountTable();
    expect(btn(0, 'move-up').disabled).toBe(true);
    expect(btn(2, 'move-down').disabled).toBe(true);
    btn(1, 'move-up').click();
    expect(onChange).toHaveBeenLastCalledWith([{ a: 'two' }, { a: 'one' }, { a: 'three' }]);
  });

  it('reorders with Alt+Arrow on the handle', () => {
    const onChange = mountTable();
    btn(0, 'drag').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true }),
    );
    expect(onChange).toHaveBeenLastCalledWith([{ a: 'two' }, { a: 'one' }, { a: 'three' }]);
  });

  it('reorders by dragging a handle onto another row', () => {
    const onChange = mountTable();
    drag(btn(0, 'drag'), 'dragstart');
    const target = host.querySelectorAll('tbody tr')[2]!;
    drag(target, 'dragover');
    drag(target, 'drop');
    expect(onChange).toHaveBeenLastCalledWith([{ a: 'two' }, { a: 'three' }, { a: 'one' }]);
  });

  it('keeps an unsaved cell draft with its row when the row moves', async () => {
    const { useState } = await import('preact/hooks');
    function Parent() {
      const [v, setV] = useState<Array<Record<string, unknown>>>([{ a: 'x' }, { a: 'y' }]);
      return h(OptionField, {
        name: 't',
        spec,
        value: v as never,
        onChange: (n) => setV(n as never),
      });
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    render(h(Parent, {}), host);
    const cells = () => [...host.querySelectorAll<HTMLInputElement>('input[data-col=a]')];
    cells()[0]!.value = 'draft';
    fire(cells()[0]!, 'input');
    btn(0, 'move-down').click();
    await tick();
    expect(cells().map((c) => c.value)).toEqual(['y', 'draft']);
  });
});

describe('search', () => {
  it('matches option keys and descriptions, and reports what matched', () => {
    const d = mod();
    expect(filterModules([d], 'demo.secret')).toHaveLength(1);
    expect(filterModules([d], 'handle with care')).toHaveLength(1);
    expect(filterModules([d], 'zzz')).toHaveLength(0);
    const m = matchModule(d, 'with care')!;
    expect(m.module).toBe(false);
    expect([...m.options]).toEqual(['secret']);
  });

  it('returns module and option matches, modules whose own text matched first', () => {
    const a = mod({ id: 'a', title: 'Alpha', description: 'about knobs' });
    const b = mod({ id: 'b', title: 'Knob keeper', description: 'plain' });
    const hits = searchModules([a, b], 'knob');
    expect(hits.map((x) => x.def.id)).toEqual(['a', 'b']);
    expect(hits[0]!.match.module).toBe(true);
    expect([...hits[0]!.match.options]).toEqual(['secret']);
    expect(searchModules([a], '  ')).toEqual([]);
    expect(snippet('x'.repeat(300) + ' needle ' + 'y'.repeat(300), 'needle')).toContain('needle');
  });

  it('lists matches grouped by module with highlights, and a result opens that module at the option', async () => {
    const el = mount(
      [mod(), mod({ id: 'other', title: 'Other', options: {} })],
      undefined,
      'other',
    );
    await tick();
    const search = el.querySelector<HTMLInputElement>('input.search')!;
    search.value = 'care';
    fire(search, 'input');
    await tick();
    const results = el.querySelector('[data-search-results]')!;
    expect(results.querySelectorAll('[data-result-group]')).toHaveLength(1);
    expect(results.querySelector('[data-result-module="demo"]')!.textContent).toContain(
      'Demo module',
    );
    const opt = results.querySelector<HTMLButtonElement>('[data-result-option="demo.secret"]')!;
    expect(opt.querySelector('mark')!.textContent).toBe('care');
    opt.click();
    await tick();
    expect(el.querySelector('[data-search-results]')).toBeNull();
    // The advanced option is shown (even though advanced options are off) and flagged.
    const row = el.querySelector('[data-option-row="demo.secret"]')!;
    expect(row.classList.contains('flash')).toBe(true);
    expect(row.classList.contains('match')).toBe(true);
    expect(el.querySelector('[data-option-row="demo.size"]')!.classList.contains('match')).toBe(
      false,
    );
    expect(el.querySelector('#mod-other')).toBeNull();
  });

  it('says so when nothing matches, and the / key jumps to the search box', async () => {
    const el = mount([mod()]);
    await tick();
    const search = el.querySelector<HTMLInputElement>('input.search')!;
    search.value = 'zzz';
    fire(search, 'input');
    await tick();
    expect(el.querySelector('[data-search-results] h2')!.textContent).toContain(
      'No settings match',
    );
    (document.activeElement as HTMLElement | null)?.blur();
    const nav = el.querySelector<HTMLElement>('.sidebar')!;
    nav.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
    await tick();
    expect(el.querySelector('.console')).not.toBeNull();
    expect(document.activeElement).toBe(search);
  });
});

describe('categories and module pages', () => {
  const a = mod({ id: 'a', title: 'Alpha', resId: 'userTagger' });
  const b = mod({ id: 'b', title: 'Beta', resId: 'userTagger', enabledByDefault: false });
  const c = mod({ id: 'c', title: 'Gamma', resId: 'commentNavigator' });

  it('opens on a category overview that lists its modules with on/off words', async () => {
    const el = mount([a, b, c], undefined, 'users');
    await tick();
    const rows = [...el.querySelectorAll('[data-overview-module]')];
    expect(rows.map((r) => r.getAttribute('data-overview-module'))).toEqual(['a', 'b']);
    expect(rows[0]!.textContent).toContain('on');
    expect(rows[1]!.querySelector('.pill')!.textContent).toBe('off');
    expect(el.querySelector('section.module')).toBeNull();
  });

  it('shows only the chosen module, and the sidebar lists the open category’s modules', async () => {
    const el = mount([a, b, c], undefined, 'users');
    await tick();
    const links = [...el.querySelectorAll('[data-module-link]')].map((x) =>
      x.getAttribute('data-module-link'),
    );
    expect(links).toEqual(['a', 'b']);
    el.querySelector<HTMLButtonElement>('[data-module-link="b"]')!.click();
    await tick();
    expect(el.querySelectorAll('section.module')).toHaveLength(1);
    expect(el.querySelector('#mod-b')).not.toBeNull();
    // A different category collapses this one and opens that one's overview.
    el.querySelector<HTMLButtonElement>('[data-category="comments"]')!.click();
    await tick();
    expect(el.querySelector('[data-overview="comments"]')).not.toBeNull();
    expect(el.querySelector('[data-module-link="b"]')).toBeNull();
  });

  it('opens a module deep link on its own page and the Sync page from the Core list', async () => {
    const el = mount([a, c], undefined, 'c');
    await tick();
    expect(el.querySelector('#mod-c')).not.toBeNull();
    expect(el.querySelector('#mod-a')).toBeNull();
    el.querySelector<HTMLButtonElement>('[data-category="core"]')!.click();
    await tick();
    el.querySelector<HTMLButtonElement>('[data-overview-module="sync"]')!.click();
    await tick();
    expect(el.querySelector('input[data-setting="syncEnabled"]')).not.toBeNull();
  });
});

describe('autosave line', () => {
  it('always says changes save automatically, with a polite status that follows the save', async () => {
    const el = mount([mod()]);
    await tick();
    expect(el.querySelector('[data-autosave]')!.textContent).toBe('Changes save automatically');
    expect(el.querySelector('button[type=submit], [data-save-button]')).toBeNull();
    const status = el.querySelector('[role=status]')!;
    expect(status.textContent).toBe('');
    const box = el.querySelector<HTMLInputElement>('[data-module-toggle="demo"]')!;
    box.checked = false;
    fire(box, 'change');
    await tick();
    expect(status.textContent).toBe('saved');
    expect(el.querySelector('.console')!.getAttribute('data-save-state')).toBe('saved');
  });
});

describe('about links', () => {
  it('lists version, source, license, issues, the two dataset credits and the bundled privacy policy', async () => {
    vi.spyOn(browser.runtime, 'getManifest').mockReturnValue({ version: '1.2.3' } as never);
    const el = mount([about]);
    await tick();
    const ul = el.querySelector('[data-links="about"]')!;
    const hrefs = [...ul.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs).toHaveLength(5);
    expect(ul.textContent).toContain('Version 1.2.3');
    expect(ul.textContent).toContain('GPL-3.0');
    expect(hrefs.some((u) => u.endsWith('/issues/new'))).toBe(true);
    expect(hrefs).toContain('https://doi.org/10.7910/DVN/QAN5VX');
    expect(hrefs).toContain('https://doi.org/10.7910/DVN/1QMLOV');
    expect(ul.querySelector('a')!.getAttribute('rel')).toContain('noopener');
    expect(ul.querySelector('details pre')!.textContent).toContain('REScue Privacy Policy');
  });
});

describe('escape from the console fields', () => {
  const mountWith = (onClose: () => void) => {
    const defs = [mod()];
    let current = defaultProfile();
    const settings: SettingsApi = {
      profile: () => current,
      save: async (next) => {
        current = next;
      },
      definitions: () => defs,
      status: () => undefined,
      runAction: async () => undefined,
      report: () => [],
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    render(
      h(SettingsConsole, {
        settings,
        runAction: async () => undefined,
        onClose,
        target: 'demo',
      }),
      host,
    );
    return host;
  };
  const pressEscape = (el: Element) =>
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

  it('clears the search first, then closes when it is already empty', async () => {
    const onClose = vi.fn();
    const el = mountWith(onClose);
    await tick();
    const search = el.querySelector<HTMLInputElement>('input.search')!;
    search.value = 'care';
    fire(search, 'input');
    await tick();
    expect(el.querySelector('[data-search-results]')).not.toBeNull();

    pressEscape(search);
    await tick();
    expect(search.value).toBe('');
    expect(el.querySelector('[data-search-results]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    pressEscape(search);
    await tick();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from any other field', async () => {
    const onClose = vi.fn();
    const el = mountWith(onClose);
    await tick();
    const field = el.querySelector<HTMLInputElement>('[data-option="demo.size"]')!;
    pressEscape(field);
    await tick();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
