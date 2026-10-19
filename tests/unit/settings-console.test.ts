import { describe, expect, it, vi, afterEach } from 'vitest';
import { h, render } from 'preact';
import { useState } from 'preact/hooks';
import { OptionField } from '../../src/ui/settings-console/OptionField';
import { filterModules } from '../../src/ui/settings-console/search';
import type { OptionSpec, ModuleDefinition } from '../../src/core/types';

let host: HTMLElement;
function mountField(spec: OptionSpec, value: unknown, onChange = vi.fn()) {
  host = document.createElement('div');
  document.body.appendChild(host);
  render(h(OptionField, { name: 'opt', spec, value: value as never, onChange }), host);
  return { host, onChange };
}
afterEach(() => {
  render(null, host);
  host.remove();
});

const fire = (el: Element, type: string) => el.dispatchEvent(new Event(type, { bubbles: true }));

describe('settings console option fields', () => {
  it('boolean → checkbox', () => {
    const { host, onChange } = mountField({ type: 'boolean', default: false, title: 'B' }, true);
    const cb = host.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    expect(cb.checked).toBe(true);
    cb.checked = false;
    fire(cb, 'change');
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('enum → select with labelled options', () => {
    const spec: OptionSpec = {
      type: 'enum',
      default: 'a',
      title: 'E',
      values: [
        { value: 'a', label: 'Alpha' },
        { value: 'b', label: 'Beta' },
      ],
    };
    const { host, onChange } = mountField(spec, 'a');
    const sel = host.querySelector('select')!;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Alpha', 'Beta']);
    sel.value = 'b';
    fire(sel, 'change');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('text → text input', () => {
    const { host, onChange } = mountField({ type: 'text', default: '', title: 'T' }, 'hi');
    const input = host.querySelector<HTMLInputElement>('input[type=text]')!;
    expect(input.value).toBe('hi');
    input.value = 'yo';
    fire(input, 'change');
    expect(onChange).toHaveBeenCalledWith('yo');
  });

  it('number → number input respecting min/max', () => {
    const { host, onChange } = mountField(
      { type: 'number', default: 1, min: 0, max: 10, title: 'N' },
      3,
    );
    const input = host.querySelector<HTMLInputElement>('input[type=number]')!;
    expect(input.min).toBe('0');
    expect(input.max).toBe('10');
    input.value = '7';
    fire(input, 'change');
    expect(onChange).toHaveBeenCalledWith(7);
    input.value = '99';
    fire(input, 'change');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('color → color input', () => {
    const { host, onChange } = mountField(
      { type: 'color', default: '#000000', title: 'C' },
      '#ff0000',
    );
    const input = host.querySelector<HTMLInputElement>('input[type=color]')!;
    expect(input.value).toBe('#ff0000');
    input.value = '#00ff00';
    fire(input, 'change');
    expect(onChange).toHaveBeenCalledWith('#00ff00');
  });

  it('keybinding → captures the next key chord', () => {
    const { host, onChange } = mountField({ type: 'keybinding', default: 'j', title: 'K' }, 'j');
    const input = host.querySelector<HTMLInputElement>('input[data-kind=keybinding]')!;
    expect(input.value).toBe('j');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'K', shiftKey: true, bubbles: true }));
    expect(onChange).toHaveBeenCalledWith('shift+k');
  });

  it('list → one entry per line', () => {
    const { host, onChange } = mountField({ type: 'list', default: [], title: 'L' }, ['a', 'b']);
    const ta = host.querySelector('textarea')!;
    expect(ta.value).toBe('a\nb');
    ta.value = 'x\n\n y \n';
    fire(ta, 'change');
    expect(onChange).toHaveBeenCalledWith(['x', 'y']);
  });

  it('table → rows with typed columns, add and remove', () => {
    const spec: OptionSpec = {
      type: 'table',
      default: [],
      title: 'Tbl',
      columns: [
        { key: 'pattern', title: 'Pattern', type: 'text' },
        { key: 'on', title: 'On', type: 'boolean' },
      ],
    };
    const { host, onChange } = mountField(spec, [{ pattern: 'foo', on: true }]);
    const rows = host.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector<HTMLInputElement>('input[type=text]')!.value).toBe('foo');
    host.querySelector<HTMLButtonElement>('button[data-action=add]')!.click();
    expect(onChange).toHaveBeenLastCalledWith([
      { pattern: 'foo', on: true },
      { pattern: '', on: false },
    ]);
    host.querySelector<HTMLButtonElement>('button[data-action=remove]')!.click();
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('table field edit loss', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  type Row = Record<string, unknown>;
  const spec = (validateRow?: (r: Row) => string | null): OptionSpec => ({
    type: 'table',
    default: [],
    title: 'Tbl',
    validateRow,
    columns: [
      { key: 'a', title: 'A', type: 'text' },
      { key: 'b', title: 'B', type: 'text' },
    ],
  });
  /** A parent that echoes saved rows back down, as the console does. */
  function mountStateful(s: OptionSpec, initial: Row[]) {
    const saved: Row[][] = [];
    function Parent() {
      const [rows, setRows] = useState<Row[]>(initial);
      return h(OptionField, {
        name: 'opt',
        spec: s,
        value: rows as never,
        onChange: (v) => {
          saved.push(v as Row[]);
          setRows(v as Row[]);
        },
      });
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    render(h(Parent, {}), host);
    return saved;
  }
  const cell = (col: string) => host.querySelector<HTMLInputElement>(`input[data-col=${col}]`)!;
  const type = (el: HTMLInputElement, text: string) => {
    el.value = text;
    fire(el, 'input');
  };

  it('keeps text typed in one cell when another cell saves and re-renders', async () => {
    const saved = mountStateful(spec(), [{ a: '', b: '' }]);
    type(cell('a'), 'first');
    type(cell('b'), 'second'); // typed, not blurred yet
    fire(cell('a'), 'change'); // cell A blurs and saves; the parent re-renders
    await tick();
    expect(saved).toHaveLength(1);
    expect(cell('b').value).toBe('second');
    fire(cell('b'), 'change');
    await tick();
    expect(saved[1]).toEqual([{ a: 'first', b: 'second' }]);
  });

  it('still rejects an invalid edit, keeping the typed text next to the error', async () => {
    const saved = mountStateful(
      spec((r) => (r.a === 'bad' ? 'A is invalid.' : null)),
      [{ a: 'ok', b: '' }],
    );
    type(cell('a'), 'bad');
    fire(cell('a'), 'change');
    await tick();
    expect(saved).toHaveLength(0);
    expect(host.querySelector('[role=alert]')!.textContent).toContain('A is invalid.');
    expect(cell('a').value).toBe('bad');
    type(cell('a'), 'good');
    fire(cell('a'), 'change');
    await tick();
    expect(saved[0]).toEqual([{ a: 'good', b: '' }]);
    expect(host.querySelector('[role=alert]')).toBeNull();
  });
});

describe('module search', () => {
  const mod = (id: string, title: string, description: string, options = {}): ModuleDefinition => ({
    id,
    title,
    description,
    category: 'core',
    enabledByDefault: true,
    options,
  });
  const mods = [
    mod('filteReddit', 'filteReddit', 'Filter out NSFW content, or links by keyword'),
    mod('userTagger', 'User Tagger', 'Tag users', {
      hardIgnore: { type: 'boolean', default: false, title: 'Hard ignore' },
    }),
  ];

  it('matches id, title, description and option titles, case-insensitively', () => {
    expect(filterModules(mods, 'KEYWORD').map((m) => m.id)).toEqual(['filteReddit']);
    expect(filterModules(mods, 'hard ignore').map((m) => m.id)).toEqual(['userTagger']);
    expect(filterModules(mods, '').map((m) => m.id)).toEqual(['filteReddit', 'userTagger']);
  });
});
