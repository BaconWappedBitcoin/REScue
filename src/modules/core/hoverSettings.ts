/**
 * Hover popups (RES hover): how long REScue's popups (the show-parent popup, and any later ones)
 * wait before opening, how long they stay after the pointer leaves, how fast they fade, how wide
 * they are, and whether they close when the pointer leaves. The popup framework itself is
 * src/core/hover.ts; this module only hands it these numbers. "Popups with their own settings"
 * overrides them for one popup by name. Ideas from RES lib/modules/hover.js (GPL-3.0, the RES
 * contributors, commit 4defffc); the code is new.
 */
import { setHoverConfig, type HoverConfig, type HoverOptions } from '../../core/hover';
import { defineModule } from '../../core/types';

/** Names a popup identifies itself by (HoverOptions.name). */
export const HOVER_POPUPS = ['showParent'];

type Row = Record<string, unknown>;

const FIELDS = [
  ['openDelay', 'openDelayMs', 0, 5000],
  ['fadeDelay', 'fadeDelayMs', 0, 10_000],
  ['fadeSpeed', 'fadeSpeedMs', 0, 5000],
  ['width', 'width', 200, 1200],
] as const;

/** A whole number from a text cell within the range, or undefined when blank or out of range. */
function whole(v: unknown, lo: number, hi: number): number | undefined {
  if (typeof v !== 'string' || v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined;
}

/** The overrides one table row stands for (blank cells inherit). */
export function rowOverrides(row: Row): Partial<HoverOptions> {
  const out: Partial<HoverOptions> = {};
  for (const [col, key, lo, hi] of FIELDS) {
    const n = whole(row[col], lo, hi);
    if (n !== undefined) out[key] = n;
  }
  if (row.closeOnMouseOut === 'yes') out.closeOnMouseOut = true;
  if (row.closeOnMouseOut === 'no') out.closeOnMouseOut = false;
  return out;
}

export function validateRow(row: Row): string | null {
  for (const [col, , lo, hi] of FIELDS) {
    const v = row[col];
    if (typeof v === 'string' && v.trim() !== '' && whole(v, lo, hi) === undefined)
      return `${col} must be a whole number from ${lo} to ${hi}, or blank to use the default.`;
  }
  return null;
}

export function hoverConfigFrom(o: {
  openDelay: number;
  fadeDelay: number;
  fadeSpeed: number;
  width: number;
  closeOnMouseOut: boolean;
  instances: Row[];
}): HoverConfig {
  const instances: HoverConfig['instances'] = {};
  for (const row of o.instances) {
    const name = typeof row.popup === 'string' ? row.popup.trim() : '';
    if (name) instances[name] = rowOverrides(row);
  }
  return {
    defaults: {
      openDelayMs: o.openDelay,
      fadeDelayMs: o.fadeDelay,
      fadeSpeedMs: o.fadeSpeed,
      width: o.width,
      closeOnMouseOut: o.closeOnMouseOut,
    },
    instances,
  };
}

const apply = (o: Parameters<typeof hoverConfigFrom>[0]): void =>
  setHoverConfig(hoverConfigFrom(o));

export const hoverSettings = defineModule({
  id: 'hover',
  category: 'core',
  title: 'Hover popups',
  description:
    'How REScue’s hover popups behave: the wait before they open, the wait before they fade after the pointer leaves, the fade time, the width, and whether they close on mouse-out. At the moment the show-parent popup uses these; a popup can have its own numbers in the table below.',
  enabledByDefault: true,
  options: {
    openDelay: {
      type: 'number',
      default: 500,
      min: 0,
      max: 5000,
      title: 'Wait before a popup opens (milliseconds)',
    },
    fadeDelay: {
      type: 'number',
      default: 500,
      min: 0,
      max: 10_000,
      title: 'Wait before a popup fades after the pointer leaves (milliseconds)',
    },
    fadeSpeed: {
      type: 'number',
      default: 200,
      min: 0,
      max: 5000,
      title: 'Fade time (milliseconds)',
      description: 'RES counted this in seconds (0.7); here it is milliseconds.',
    },
    width: {
      type: 'number',
      default: 512,
      min: 200,
      max: 1200,
      title: 'Widest a popup may be (pixels)',
    },
    closeOnMouseOut: {
      type: 'boolean',
      default: true,
      title: 'Close a popup when the pointer leaves it',
      description: 'Off: a popup stays until you press its “close” word.',
    },
    instances: {
      type: 'table',
      default: [],
      title: 'Popups with their own numbers',
      description: `Name a popup (${HOVER_POPUPS.join(', ')}) and fill in only what should differ; blank cells use the numbers above.`,
      columns: [
        { key: 'popup', title: 'Popup', type: 'enum', values: HOVER_POPUPS, default: 'showParent' },
        { key: 'openDelay', title: 'Open wait (ms)', type: 'text' },
        { key: 'fadeDelay', title: 'Fade wait (ms)', type: 'text' },
        { key: 'fadeSpeed', title: 'Fade time (ms)', type: 'text' },
        { key: 'width', title: 'Width (px)', type: 'text' },
        {
          key: 'closeOnMouseOut',
          title: 'Close on mouse-out',
          type: 'enum',
          values: ['default', 'yes', 'no'],
          default: 'default',
        },
      ],
      validateRow,
    },
  },

  init(ctx) {
    apply(ctx.options as Parameters<typeof hoverConfigFrom>[0]);
  },

  onSettings(ctx) {
    apply(ctx.options as Parameters<typeof hoverConfigFrom>[0]);
  },

  dispose() {
    setHoverConfig({ defaults: {}, instances: {} });
  },
});
