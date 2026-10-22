/**
 * nightMode (RES nightMode, US8): switch the page between light and dark on a schedule.
 * Ported in spirit from RES lib/modules/nightMode.js (GPL-3.0, the RES contributors, commit
 * 4defffc); the code is new. RES flipped the theme in the reader's Reddit account; REScue never
 * writes to the account (principle V), so it adds or removes Reddit's own `theme-dark` class on
 * <html> instead — the same switch Reddit's user menu makes, so Reddit's own stylesheet does the
 * recolouring and only this tab is affected.
 *
 * Reddit puts its own value back when it re-renders, so a MutationObserver on <html class> puts
 * the schedule's theme back, and only when the class really differs from it, so REScue never
 * fights its own write. When the class changes to something REScue did not put there, and it did
 * so right after a click or a keypress, the reader pressed Reddit's own switch: Reddit's choice
 * then wins for `nightModeOverrideHours` hours, which is the window RES gave the reader.
 *
 * Turning the module off, or setting the mode to "Never (Reddit's own setting decides)", puts back
 * exactly the class state Reddit had before REScue first changed it.
 */
import { C } from '../../contracts/reddit';
import { applyTheme } from '../../core/theme';
import { defineModule, type ScopedStore } from '../../core/types';
import { DEFAULT_END, DEFAULT_START, wantedTheme, type NightModeMode } from '../../model/nightMode';

/** The schedule is re-read every minute; an hour or two of drift is not worth an event for. */
const TICK_MS = 60_000;
const HOUR_MS = 3_600_000;
/** A class change this soon after a click or key on Reddit's Display Mode switch is the reader's. */
const GESTURE_MS = 2_000;
/** Until when Reddit's own theme wins, in this module's own storage (kept across tabs). */
const OVERRIDE_KEY = 'overrideUntil';

export interface NightModeOptions {
  automaticNightMode: string;
  nightModeStart: string;
  nightModeEnd: string;
  nightModeOverrideHours: number;
}

let options: NightModeOptions = {
  automaticNightMode: 'none',
  nightModeStart: DEFAULT_START,
  nightModeEnd: DEFAULT_END,
  nightModeOverrideHours: 8,
};
let store: ScopedStore | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let observer: MutationObserver | null = null;
let media: MediaQueryList | null = null;
/** The state REScue last put on <html>; null while Reddit's own setting is in charge. */
let applied: boolean | null = null;
/** Whether <html> was dark before REScue first changed it, so that state can be put back. */
let wasDark: boolean | null = null;
let overrideUntil = 0;
let lastGesture = -Infinity;
/** Bumped by dispose, so an init still waiting on storage does not start after the module stopped. */
let generation = 0;

const isDark = (): boolean => document.documentElement.classList.contains(C.themeDarkClass);

/** A click or key on Reddit's own Display Mode switch (anywhere in the event's path, shadow roots too). */
const noteGesture = (e: Event): void => {
  const onSwitch = e.composedPath().some((n) => n instanceof Element && n.matches(C.themeSwitch));
  if (onSwitch) lastGesture = Date.now();
};

/** Hours the reader asked Reddit's own theme to be left alone for; 0 means never. */
function overrideHours(): number {
  const hours = Number(options.nightModeOverrideHours);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

/** Reddit's choice wins for `hours` hours, remembered so a new tab waits for it too. */
function leaveToReddit(hours: number): void {
  // The reader's choice is now the state to keep: turning the module off must not undo it.
  wasDark = null;
  overrideUntil = Date.now() + hours * HOUR_MS;
  void store?.set(OVERRIDE_KEY, overrideUntil);
}

/** Put back the class state Reddit had before REScue first changed it. */
function restore(): void {
  applied = null;
  if (wasDark === null) return;
  const back = wasDark;
  wasDark = null;
  document.documentElement.classList.toggle(C.themeDarkClass, back);
  applyTheme();
}

/** Put the schedule's theme on <html>, unless Reddit's own setting decides ('none'). */
function apply(): void {
  if (Date.now() < overrideUntil) return;
  const want = wantedTheme(
    options.automaticNightMode as NightModeMode,
    new Date(),
    options.nightModeStart,
    options.nightModeEnd,
    media?.matches ?? false,
  );
  if (want === null) {
    restore();
    return;
  }
  const dark = want === 'dark';
  if (isDark() !== dark) {
    if (wasDark === null) wasDark = !dark;
    document.documentElement.classList.toggle(C.themeDarkClass, dark);
  }
  applied = dark;
  applyTheme();
}

/** <html class> changed: put the schedule back after a Reddit re-render, or stand down. */
function onClassChange(): void {
  if (applied === null) return;
  const dark = isDark();
  if (dark === applied) return; // REScue's own write: nothing to answer, nothing to fight
  applied = dark;
  const hours = Date.now() - lastGesture <= GESTURE_MS ? overrideHours() : 0;
  if (hours) leaveToReddit(hours);
  else apply();
}

export const nightMode = defineModule({
  id: 'nightMode',
  resId: 'nightMode',
  category: 'appearance',
  title: 'Night mode',
  description:
    'Switch Reddit between light and dark on a schedule — by your computer’s own dark mode, or between two times of day — without changing the setting in your Reddit account. Reddit’s own switch wins for a few hours after you use it. Only the tabs you have open are affected.',
  enabledByDefault: false,
  options: {
    automaticNightMode: {
      type: 'enum',
      default: 'none',
      title: 'Turn night mode on',
      values: [
        { value: 'none', label: 'Off — Reddit’s own setting decides' },
        { value: 'system', label: 'When my computer is in dark mode' },
        { value: 'time', label: 'Between two times of day' },
        { value: 'always', label: 'Always dark' },
        { value: 'never', label: 'Never dark' },
      ],
    },
    nightModeStart: {
      type: 'text',
      default: DEFAULT_START,
      title: 'Dark from',
      description:
        'Time of day in HH:MM (24-hour), in your own time zone, e.g. 20:00. Used by “Between two times of day”; anything that is not a time falls back to 20:00.',
    },
    nightModeEnd: {
      type: 'text',
      default: DEFAULT_END,
      title: 'Dark until',
      description:
        'Time of day in HH:MM (24-hour), e.g. 06:00. It may be earlier than “Dark from”, which means the dark part runs over midnight; the same time twice means never dark.',
    },
    nightModeOverrideHours: {
      type: 'number',
      default: 8,
      min: 0,
      max: 168,
      title: 'After you use Reddit’s own theme switch',
      description:
        'Hours to leave Reddit’s choice alone before REScue takes over again. 0 means the schedule always wins.',
    },
  },

  async init(ctx) {
    options = ctx.options;
    store = ctx.store;
    const started = ++generation;
    lastGesture = -Infinity;
    const until = await ctx.store.get<number>(OVERRIDE_KEY);
    if (started !== generation) return; // switched off while waiting
    overrideUntil = typeof until === 'number' && until > Date.now() ? until : 0;
    timer = setInterval(apply, TICK_MS);
    observer = new MutationObserver(onClassChange);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media?.addEventListener?.('change', apply);
    document.addEventListener('pointerdown', noteGesture, true);
    document.addEventListener('keydown', noteGesture, true);
    apply();
  },

  onSettings(ctx) {
    options = ctx.options;
    apply();
  },

  dispose() {
    generation++;
    if (timer) clearInterval(timer);
    timer = null;
    observer?.disconnect();
    observer = null;
    media?.removeEventListener?.('change', apply);
    media = null;
    document.removeEventListener('pointerdown', noteGesture, true);
    document.removeEventListener('keydown', noteGesture, true);
    store = null;
    restore();
  },
});
