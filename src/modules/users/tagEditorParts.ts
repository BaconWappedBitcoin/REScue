/** Pieces of the tag editor: the colour swatch row and the preset-tag chips. */
import { h } from '../../core/dom';
import { hint, label } from '../../core/hints';
import { buildTagChip } from './tagChip';
import { COLOR_PRESETS, presetForHex, type PresetTag } from './tagColors';
import { validColor } from './tagStore';

export interface Swatches {
  el: HTMLElement;
  /** Mark the swatch that matches this colour (or none). */
  sync(color: string): void;
}

/** RES's 21 named colours as a row of buttons; "none" clears the colour. */
export function buildSwatches(onPick: (hex: string) => void): Swatches {
  const el = h('div', {
    class: 'rescue-tag-swatches',
    role: 'group',
    'aria-label': 'Colour presets',
    title: hint.tagSwatches,
  });
  el.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;margin:6px 0';
  const buttons = new Map<string, HTMLButtonElement>();
  for (const p of COLOR_PRESETS) {
    const b = h(
      'button',
      {
        type: 'button',
        class: 'rescue-swatch',
        'data-color': p.name,
        'aria-label': p.name,
        'aria-pressed': 'false',
        title: p.hex ? hint.tagSwatch(p.name) : hint.tagSwatchNone,
      },
      p.hex ? null : label.noColor,
    );
    // The "none" swatch carries a word, so it is wider than the colour squares.
    b.style.cssText =
      `${p.hex ? 'width:18px;padding:0' : 'padding:0 4px'};height:18px;border:1px solid var(--rescue-meta,#666);border-radius:3px;cursor:pointer;` +
      `font:${p.hex ? 12 : 10}px/1 sans-serif;color:inherit;background:${p.hex ?? 'transparent'}`;
    b.addEventListener('click', () => onPick(p.hex ?? ''));
    buttons.set(p.hex ?? '', b);
    el.append(b);
  }
  return {
    el,
    sync(color) {
      const key = validColor(color) ?? '';
      for (const [hex, b] of buttons) {
        const on = hex === key && (hex !== '' || color.trim() === '');
        b.setAttribute('aria-pressed', String(on));
        b.style.outline = on ? '2px solid var(--rescue-accent, #336699)' : '';
      }
    },
  };
}

export interface PresetRow {
  el: HTMLElement;
  add(p: PresetTag): void;
}

/** Clickable chips for the user's preset tags; a click hands the preset to `onPick`. */
export function buildPresetRow(presets: PresetTag[], onPick: (p: PresetTag) => void): PresetRow {
  const el = h('div', {
    class: 'rescue-tag-presets',
    role: 'group',
    'aria-label': 'Preset tags',
    title: hint.tagPresets,
  });
  el.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin:6px 0';
  const have = new Set<string>();
  const add = (p: PresetTag) => {
    const id = `${p.text}\u0000${p.color ?? ''}`;
    if (have.has(id)) return;
    have.add(id);
    const b = h('button', {
      type: 'button',
      class: 'rescue-tag-preset',
      title: hint.tagPreset(p.text, p.color ? (presetForHex(p.color)?.name ?? p.color) : undefined),
    });
    b.style.cssText = 'background:none;border:0;padding:0;cursor:pointer;font:inherit';
    b.append(buildTagChip(p, { truncate: true }));
    b.addEventListener('click', () => onPick(p));
    el.append(b);
  };
  presets.forEach(add);
  return { el, add };
}
