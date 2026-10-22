// Automatic night mode: which theme the schedule wants (src/model/nightMode.ts) and the module that
// puts it on <html> for this tab only — re-applying after a Reddit re-render, standing down after the
// reader uses Reddit's own switch, and putting Reddit's own class state back on dispose.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOptions } from '../../src/core/settings';
import { THEME_ATTR } from '../../src/core/theme';
import type { ModuleContext, ModuleDefinition, OptionValue } from '../../src/core/types';
import { nightMode } from '../../src/modules/appearance/nightMode';
import {
  DEFAULT_END,
  DEFAULT_START,
  isNightAt,
  parseHm,
  wantedTheme,
} from '../../src/model/nightMode';
import { bootModules } from './module-harness';

const html = document.documentElement;
/** Only the clock and the re-check timer are faked, so awaiting a real tick still works. */
const fakeTimers = () => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });

/** The system's dark-mode setting, and whoever is listening for it changing. */
const system = { dark: false, listeners: new Set<() => void>() };

beforeEach(() => {
  system.dark = false;
  system.listeners.clear();
  vi.spyOn(window, 'matchMedia').mockReturnValue({
    get matches() {
      return system.dark;
    },
    addEventListener: (_type: string, fn: () => void) => void system.listeners.add(fn),
    removeEventListener: (_type: string, fn: () => void) => void system.listeners.delete(fn),
  } as unknown as MediaQueryList);
});

afterEach(() => {
  nightMode.dispose?.();
  html.className = '';
  html.removeAttribute(THEME_ATTR);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** An instant at a wall-clock time today, in the reader's own time zone. */
const at = (hours: number, minutes = 0): Date => new Date(2026, 9, 21, hours, minutes);

const dark = (): boolean => html.classList.contains('theme-dark');

/** The module booted with `options`, and the context the settings change comes back through. */
async function boot(
  options: Record<string, OptionValue>,
  moduleStored?: Record<string, Record<string, unknown>>,
) {
  const m = await bootModules([nightMode], { options: { nightMode: options }, moduleStored });
  return { m, ctx: m.ctxs.get('nightMode')! };
}

/** The module's context after the settings changed to `options`. */
function changed(ctx: ModuleContext, options: Record<string, OptionValue>): ModuleContext {
  const profile = { modules: { nightMode: { enabled: true, options } } } as never;
  return { ...ctx, options: resolveOptions(nightMode as ModuleDefinition, profile) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * The reader pressed Reddit's own Display Mode switch (live shape 2026-10-21: the menu row
 * `li#darkmode-list-item` holding a `shreddit-theme-switcher`), or, with `elsewhere`, anything else.
 */
function press(elsewhere = false): void {
  const row = document.createElement(elsewhere ? 'a' : 'li');
  if (!elsewhere) row.id = 'darkmode-list-item';
  const target = row.appendChild(
    document.createElement(elsewhere ? 'span' : 'shreddit-theme-switcher'),
  );
  document.body.appendChild(row);
  target.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
  row.remove();
}

describe('parseHm', () => {
  it('reads HH:MM, with or without a leading zero on the hour', () => {
    expect(parseHm('20:00')).toBe(1200);
    expect(parseHm('6:00')).toBe(360);
    expect(parseHm(' 07:05 ')).toBe(425);
    expect(parseHm('00:00')).toBe(0);
  });

  it('is null for anything that is not a time of day', () => {
    for (const bad of ['', '7:5', '24:00', '12:60', 'oops', '20', '20:00:00', 1200, null]) {
      expect(parseHm(bad), String(bad)).toBeNull();
    }
  });
});

describe('isNightAt', () => {
  const start = 20 * 60;
  const end = 6 * 60;

  it('covers the evening and the small hours when it crosses midnight', () => {
    expect(isNightAt(at(20, 0), start, end)).toBe(true);
    expect(isNightAt(at(23, 30), start, end)).toBe(true);
    expect(isNightAt(at(0, 0), start, end)).toBe(true);
    expect(isNightAt(at(5, 59), start, end)).toBe(true);
    expect(isNightAt(at(6, 0), start, end)).toBe(false);
    expect(isNightAt(at(12, 0), start, end)).toBe(false);
    expect(isNightAt(at(19, 59), start, end)).toBe(false);
  });

  it('is plain between and after the two times when it does not cross midnight', () => {
    expect(isNightAt(at(22, 0), 21 * 60, 23 * 60)).toBe(true);
    expect(isNightAt(at(23, 0), 21 * 60, 23 * 60)).toBe(false);
    expect(isNightAt(at(21, 0), 21 * 60, 23 * 60)).toBe(true);
  });

  it('is never night when the start and the end are the same time', () => {
    expect(isNightAt(at(20, 0), start, start)).toBe(false);
    expect(isNightAt(at(3, 0), start, start)).toBe(false);
  });
});

describe('wantedTheme', () => {
  it('leaves Reddit\'s own setting alone in "none"', () => {
    expect(wantedTheme('none', at(22, 0), DEFAULT_START, DEFAULT_END, true)).toBeNull();
    expect(wantedTheme('none', at(22, 0), DEFAULT_START, DEFAULT_END, false)).toBeNull();
  });

  it('follows the operating system in "system" and is fixed in "always" / "never"', () => {
    expect(wantedTheme('system', at(12, 0), DEFAULT_START, DEFAULT_END, true)).toBe('dark');
    expect(wantedTheme('system', at(12, 0), DEFAULT_START, DEFAULT_END, false)).toBe('light');
    expect(wantedTheme('always', at(12, 0), DEFAULT_START, DEFAULT_END, false)).toBe('dark');
    expect(wantedTheme('never', at(22, 0), DEFAULT_START, DEFAULT_END, true)).toBe('light');
  });

  it('follows the clock in "time", including over midnight', () => {
    expect(wantedTheme('time', at(21, 0), DEFAULT_START, DEFAULT_END, false)).toBe('dark');
    expect(wantedTheme('time', at(3, 0), DEFAULT_START, DEFAULT_END, false)).toBe('dark');
    expect(wantedTheme('time', at(12, 0), DEFAULT_START, DEFAULT_END, false)).toBe('light');
  });

  it('falls back to the default times when an option is not a time', () => {
    expect(wantedTheme('time', at(21, 0), 'half past eight', '6', false)).toBe('dark');
    expect(wantedTheme('time', at(5, 0), 'half past eight', 'nonsense', false)).toBe('dark');
    expect(wantedTheme('time', at(12, 0), '', '', false)).toBe('light');
  });
});

describe('the nightMode module', () => {
  it('does nothing at all while its own switch is off', async () => {
    fakeTimers();
    await boot({ automaticNightMode: 'none', nightModeOverrideHours: 8 });
    expect(dark()).toBe(false);
    expect(html.hasAttribute(THEME_ATTR)).toBe(false);
  });

  it("puts the schedule on <html> and mirrors it into REScue's own colours", async () => {
    fakeTimers();
    const { ctx } = await boot({ automaticNightMode: 'always', nightModeOverrideHours: 8 });
    expect(dark()).toBe(true);
    expect(html.getAttribute(THEME_ATTR)).toBe('dark');

    // A settings change is followed at once, without waiting for the next minute.
    nightMode.onSettings!(
      changed(ctx, {
        automaticNightMode: 'never',
        nightModeStart: DEFAULT_START,
        nightModeEnd: DEFAULT_END,
        nightModeOverrideHours: 8,
      }) as never,
    );
    expect(dark()).toBe(false);
    expect(html.getAttribute(THEME_ATTR)).toBe('light');
  });

  it('follows the operating system, live, in system mode', async () => {
    fakeTimers();
    system.dark = true;
    await boot({ automaticNightMode: 'system', nightModeOverrideHours: 8 });
    expect(dark()).toBe(true);
    expect(system.listeners.size).toBe(1);
    system.dark = false;
    for (const fn of system.listeners) fn();
    expect(dark()).toBe(false);
  });

  it('re-applies the schedule when Reddit puts its own class back', async () => {
    fakeTimers();
    await boot({ automaticNightMode: 'always', nightModeOverrideHours: 8 });
    expect(dark()).toBe(true);

    // A re-render, not a click: Reddit puts its light class back and REScue answers.
    html.classList.remove('theme-dark');
    await tick();
    expect(dark()).toBe(true);
  });

  it("leaves the page alone for the override hours after the reader's own switch", async () => {
    fakeTimers();
    const { m } = await boot({ automaticNightMode: 'always', nightModeOverrideHours: 8 });
    expect(dark()).toBe(true);

    press();
    html.classList.remove('theme-dark');
    await tick();
    expect(dark()).toBe(false);
    const until = m.moduleStore.nightMode?.overrideUntil as number;
    expect(until - Date.now()).toBeGreaterThan(7 * 3_600_000);

    // ... and takes the schedule back over when the window is over.
    vi.advanceTimersByTime(8 * 3_600_000);
    expect(dark()).toBe(true);
  });

  it('a click anywhere else (a post, a link) is not the reader choosing a theme', async () => {
    fakeTimers();
    const { m } = await boot({ automaticNightMode: 'always', nightModeOverrideHours: 8 });
    press(true);
    html.classList.remove('theme-dark'); // Reddit re-renders after a navigation
    await tick();
    expect(dark()).toBe(true);
    expect(m.moduleStore.nightMode?.overrideUntil).toBeUndefined();
  });

  it('after the reader takes over, turning the module off keeps the reader’s choice', async () => {
    fakeTimers();
    const { m } = await boot({ automaticNightMode: 'always', nightModeOverrideHours: 8 });
    press();
    html.classList.remove('theme-dark');
    await tick();
    html.classList.add('theme-dark'); // ...then the reader switched back to dark by hand
    await tick();
    m.dispose();
    expect(dark()).toBe(true);
  });

  it('waits out an override window another tab already started', async () => {
    fakeTimers();
    const until = Date.now() + 3_600_000;
    await boot(
      { automaticNightMode: 'always', nightModeOverrideHours: 8 },
      { nightMode: { overrideUntil: until } },
    );
    expect(dark()).toBe(false);
    vi.advanceTimersByTime(3_600_000);
    expect(dark()).toBe(true);
  });

  it('never stands down when the override is 0 hours', async () => {
    fakeTimers();
    await boot({ automaticNightMode: 'always', nightModeOverrideHours: 0 });
    press();
    html.classList.remove('theme-dark');
    await tick();
    expect(dark()).toBe(true);
  });

  it('turns dark again when the clock crosses the start time', async () => {
    fakeTimers();
    vi.setSystemTime(at(19, 59));
    await boot({
      automaticNightMode: 'time',
      nightModeStart: DEFAULT_START,
      nightModeEnd: DEFAULT_END,
      nightModeOverrideHours: 8,
    });
    expect(dark()).toBe(false);
    vi.advanceTimersByTime(2 * 60_000);
    expect(dark()).toBe(true);
  });

  it('puts back exactly the class state Reddit had, on dispose and on "none"', async () => {
    fakeTimers();
    html.classList.add('theme-dark'); // the reader is on Reddit's dark mode
    const { m, ctx } = await boot({ automaticNightMode: 'never', nightModeOverrideHours: 8 });
    expect(dark()).toBe(false);

    m.dispose();
    expect(dark()).toBe(true);
    expect(html.getAttribute(THEME_ATTR)).toBe('dark');

    // Turning the mode back to "none" is the same promise.
    html.classList.remove('theme-dark');
    await boot({ automaticNightMode: 'always', nightModeOverrideHours: 8 });
    expect(dark()).toBe(true);
    nightMode.onSettings!(
      changed(ctx, {
        automaticNightMode: 'none',
        nightModeStart: DEFAULT_START,
        nightModeEnd: DEFAULT_END,
        nightModeOverrideHours: 8,
      }) as never,
    );
    expect(dark()).toBe(false);
  });

  it('declares the RES options, with the RES defaults', () => {
    expect(nightMode).toMatchObject({
      id: 'nightMode',
      resId: 'nightMode',
      category: 'appearance',
      enabledByDefault: false,
    });
    expect(nightMode.options.automaticNightMode).toMatchObject({
      type: 'enum',
      default: 'none',
      values: [
        { value: 'none' },
        { value: 'system' },
        { value: 'time' },
        { value: 'always' },
        { value: 'never' },
      ],
    });
    expect(nightMode.options.nightModeStart).toMatchObject({
      type: 'text',
      default: '20:00',
      description: expect.stringContaining('HH:MM'),
    });
    expect(nightMode.options.nightModeEnd).toMatchObject({ type: 'text', default: '06:00' });
    expect(nightMode.options.nightModeOverrideHours).toMatchObject({
      type: 'number',
      default: 8,
    });
  });
});
