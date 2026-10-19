/** One schema-generated option control (module-api.md OptionSchema). No per-module UI code. */
import { chordOf } from '../../core/keys';
import { validateOption } from '../../core/settings';
import type { OptionSpec, OptionValue } from '../../core/types';
import { TableField } from './TableField';

interface Props {
  name: string;
  spec: OptionSpec;
  value: OptionValue;
  onChange(value: OptionValue): void;
  testId?: string;
}

const target = <T extends EventTarget>(e: Event) => e.currentTarget as unknown as T;

export function OptionField({ name, spec, value, onChange, testId }: Props) {
  const emit = (v: OptionValue) => {
    if (validateOption(spec, v)) onChange(v);
  };
  const common = { id: `opt-${name}`, 'data-option': testId ?? name, 'aria-label': spec.title };

  switch (spec.type) {
    case 'boolean':
      return (
        <input
          {...common}
          type="checkbox"
          checked={value as boolean}
          onChange={(e) => emit(target<HTMLInputElement>(e).checked)}
        />
      );
    case 'enum':
      return (
        <select
          {...common}
          value={value as string}
          onChange={(e) => emit(target<HTMLSelectElement>(e).value)}
        >
          {spec.values.map((v) => (
            <option value={v.value}>{v.label}</option>
          ))}
        </select>
      );
    case 'text':
      if (spec.multiline)
        return (
          <textarea
            {...common}
            rows={10}
            spellcheck={false}
            data-rescue-input=""
            value={value as string}
            onChange={(e) => emit(target<HTMLTextAreaElement>(e).value)}
          />
        );
      return (
        <input
          {...common}
          type="text"
          data-rescue-input=""
          value={value as string}
          onChange={(e) => emit(target<HTMLInputElement>(e).value)}
        />
      );
    case 'number':
      return (
        <input
          {...common}
          type="number"
          data-rescue-input=""
          min={spec.min}
          max={spec.max}
          value={String(value)}
          onChange={(e) => emit(Number(target<HTMLInputElement>(e).value))}
        />
      );
    case 'color':
      return (
        <input
          {...common}
          type="color"
          value={(value as string) || '#000000'}
          onChange={(e) => emit(target<HTMLInputElement>(e).value)}
        />
      );
    case 'keybinding':
      return (
        <input
          {...common}
          type="text"
          readOnly
          data-kind="keybinding"
          data-rescue-input=""
          value={value as string}
          placeholder="press a key"
          onKeyDown={(e) => {
            if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
            e.preventDefault();
            e.stopPropagation();
            emit(chordOf(e));
          }}
        />
      );
    case 'list':
      return (
        <textarea
          {...common}
          rows={4}
          data-rescue-input=""
          value={(value as string[]).join('\n')}
          onChange={(e) =>
            emit(
              target<HTMLTextAreaElement>(e)
                .value.split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      );
    case 'table':
      return (
        <TableField
          spec={spec}
          value={value as Array<Record<string, unknown>>}
          onChange={emit}
          common={common}
        />
      );
  }
}
