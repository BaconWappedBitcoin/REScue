/**
 * keyboardNav + selectedEntry (RES): move through Reddit's posts and comments from the keyboard.
 * The selected item is outlined by REScue's own overlay (layout/native/selection.ts) and its links
 * are numbered by another (linkNumbers.ts); Reddit's elements are not restyled or edited.
 * selectedEntry's options (select on scroll, scroll on load, outline) are folded in here.
 * Ported in spirit from RES lib/modules/keyboardNav.js and selectedEntry.js (GPL-3.0, the RES
 * contributors, commit 4defffc).
 */
import { parseChord } from '../../../core/keys';
import { openTabs } from '../../../core/tabs';
import {
  defineModule,
  type ModuleContext,
  type OptionSchema,
  type Route,
} from '../../../core/types';
import { OUTLINE_STYLES, safeColor, type ScrollStyle } from '../../../layout/native/selectionView';
import { buildCommands } from './commands';
import { closeHelp, helpOpen, toggleHelp } from './help';
import { LinkNumberOverlay, numberedLinks } from './linkNumbers';

let route: Route | null = null;
let cur: ModuleContext | null = null;
let stops: Array<() => void> = [];
/** Removes the registered commands (dispose), so switching the module back on can add them again. */
let unregister: Array<() => void> = [];
let onLoadDone = false;
const overlay = new LinkNumberOverlay();

/** Rebind table rows ({command, keys: "j, k"}) as dispatcher overrides. */
export function overridesFrom(rows: Array<{ command?: string; keys?: string }>) {
  const overrides: Record<string, string[]> = {};
  for (const r of rows) {
    if (!r.command || !r.keys) continue;
    overrides[r.command] = r.keys
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean);
  }
  return overrides;
}

const SCROLL_STYLES = [
  { value: 'directional', label: 'Directional (scroll only as far as needed)' },
  { value: 'top', label: 'Lock to top (selected item at the top of the page)' },
  { value: 'middle', label: 'In the middle of the page' },
  { value: 'page', label: 'Page by page (scroll only when the item is off screen)' },
  {
    value: 'legacy',
    label: 'Legacy (scroll only when the item is not fully on screen, item to the top)',
  },
  { value: 'adopt', label: 'Adopt (the item takes the place on screen of the one before it)' },
];

const JUMP_STYLES = [
  { value: 'same', label: 'Same as above' },
  ...SCROLL_STYLES,
  { value: 'none', label: 'Do not scroll' },
];

const options: OptionSchema = {
  openInNewTab: {
    type: 'boolean',
    default: false,
    title: 'Open links and comments in a new tab (Enter, c)',
  },
  selectOnClick: {
    type: 'boolean',
    default: true,
    title: 'Clicking a post or comment selects it',
  },
  scrollStyle: {
    type: 'enum',
    values: SCROLL_STYLES,
    default: 'directional',
    title: 'How the page scrolls to the selected item',
  },
  nonLinearScrollStyle: {
    type: 'enum',
    values: JUMP_STYLES,
    default: 'same',
    title:
      'How the page scrolls for jumps (next/previous sibling or thread, parent, top, first/last, undo)',
    description:
      'RES scrolls these jumps in their own style (its default was Legacy). “Same as above” keeps one style for every move.',
  },
  autoSelectOnScroll: {
    type: 'boolean',
    default: false,
    title: 'Select the item at the top of the page while scrolling',
  },
  scrollToSelectedOnLoad: {
    type: 'boolean',
    default: false,
    title: 'On load, select the first item on screen and scroll it into place',
    description: 'REScue does not remember the selection between pages.',
    advanced: true,
  },
  outlineColor: {
    type: 'color',
    default: '#ff4500',
    title: 'Colour of the outline around the selected item',
  },
  outlineStyle: {
    type: 'enum',
    values: OUTLINE_STYLES.map((s) => ({ value: s, label: s })),
    default: 'solid',
    title: 'Style of the outline around the selected item',
  },
  addLine: {
    type: 'boolean',
    default: false,
    title: 'Add a bar down the right side of the selected item',
  },
  fillSelected: {
    type: 'boolean',
    default: false,
    title: 'Tint the selected item',
    description: 'A soft fill over the selected post or comment (RES “selected entry” background).',
  },
  backgroundColor: {
    type: 'color',
    default: '#f0f3fc',
    title: 'Tint colour of the selected item',
    dependsOn: 'fillSelected',
  },
  linkNumbers: {
    type: 'boolean',
    default: true,
    title: 'Number the links in the selected post or comment',
    description: 'Shows [1] … [0] beside the first ten links; press the number to open one.',
  },
  linkNumberPosition: {
    type: 'enum',
    values: [
      { value: 'right', label: 'After the link' },
      { value: 'left', label: 'Before the link' },
    ],
    default: 'right',
    title: 'Where the link numbers go',
    dependsOn: 'linkNumbers',
    advanced: true,
  },
  linkNumberKeys: {
    type: 'enum',
    values: [
      { value: 'digit', label: 'The number keys (Alt + number does it the other way)' },
      { value: 'alt', label: 'Alt + number only (plain number keys stay free)' },
    ],
    default: 'digit',
    title: 'Keys that open a numbered link',
    dependsOn: 'linkNumbers',
    advanced: true,
  },
  linkNewTab: {
    type: 'boolean',
    default: true,
    title: 'Open numbered links in a new tab',
    dependsOn: 'linkNumbers',
    advanced: true,
  },
  rebind: {
    type: 'table',
    default: [],
    title: 'Rebind keys',
    description:
      'Command id (from the ? list) and keys, e.g. "shift+j" or "g f". Separate alternatives with commas.',
    columns: [
      { key: 'command', title: 'Command', type: 'text' },
      { key: 'keys', title: 'Keys', type: 'text' },
    ],
    validateRow: (row) => {
      const keys = String(row.keys ?? '');
      if (!keys.trim()) return null;
      return keys.split(',').every((k) => parseChord(k).length)
        ? null
        : 'Keys look like "j", "shift+j" or "g f".';
    },
  },
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/** Push the module's options into the (shared) selection. */
function configure(ctx: ModuleContext): void {
  const o = ctx.options;
  ctx.ui.selection().configure({
    scrollStyle: oneOf(
      o.scrollStyle,
      SCROLL_STYLES.map((s) => s.value) as ScrollStyle[],
      'directional',
    ),
    nonLinearScrollStyle: oneOf(
      o.nonLinearScrollStyle,
      JUMP_STYLES.map((s) => s.value) as Array<ScrollStyle | 'same'>,
      'same',
    ),
    outlineColor: safeColor(o.outlineColor),
    outlineStyle: oneOf(o.outlineStyle, OUTLINE_STYLES, 'solid'),
    fillColor: o.fillSelected === true ? String(o.backgroundColor ?? '') : '',
    addLine: o.addLine === true,
  });
}

/** Run `fn` on the next frame at most once per burst of scroll events. */
function onScrollFrame(fn: () => void): () => void {
  let frame = 0;
  const onScroll = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      fn();
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  return () => {
    removeEventListener('scroll', onScroll);
    if (frame) cancelAnimationFrame(frame);
  };
}

/** Everything that follows the options: the outline look, key rebinds and the option-driven listeners. */
function wire(ctx: ModuleContext): void {
  for (const stop of stops) stop();
  stops = [];
  overlay.hide();
  cur = ctx;
  const sel = () => ctx.ui.selection();
  configure(ctx);
  ctx.keys.setOverrides(
    overridesFrom(ctx.options.rebind as Array<{ command?: string; keys?: string }>),
  );
  if (ctx.options.selectOnClick) {
    // Observe only: Reddit's own click handling is neither prevented nor stopped.
    const onClick = (e: MouseEvent) => void sel().selectFromEvent(e);
    document.addEventListener('click', onClick, { capture: true, passive: true });
    stops.push(() => document.removeEventListener('click', onClick, true));
  }
  if (ctx.options.linkNumbers) {
    const draw = () => {
      const position = ctx.options.linkNumberPosition === 'left' ? 'left' : 'right';
      const keys = ctx.options.linkNumberKeys === 'alt' ? 'alt' : 'digit';
      overlay.show(numberedLinks(sel().current()), position, keys);
    };
    stops.push(sel().onChange(draw));
  }
  if (ctx.options.autoSelectOnScroll) {
    // Scrolls the selection made itself (j/k) must not be taken for the user scrolling.
    stops.push(onScrollFrame(() => !sel().scrolledRecently() && sel().selectClosestInView()));
  }
}

export const keyboardNav = defineModule({
  id: 'keyboardNav',
  resId: 'keyboardNav',
  category: 'listings',
  title: 'Keyboard navigation',
  description:
    'Move through posts and comments with j/k, open links and comments, jump between comment threads, number the links in the selected item, and outline the selected item (includes RES’s selected entry). Press ? on a page for the full list. Voting from the keyboard comes with the signed-in actions.',
  enabledByDefault: true,
  options,
  init(ctx) {
    route = ctx.route;
    onLoadDone = false;
    cur = ctx;
    const sel = () => ctx.ui.selection();
    const prefs = () => ({
      enabled: !!cur!.options.linkNumbers,
      keys: cur!.options.linkNumberKeys === 'alt' ? ('alt' as const) : ('digit' as const),
      newTab: !!cur!.options.linkNewTab,
    });
    const commands = buildCommands({
      ctx,
      sel,
      route: () => route ?? ctx.route,
      inNewTab: () => !!cur!.options.openInNewTab,
      linkNumbers: prefs,
      openTabs,
      toggleHelp: () =>
        toggleHelp(ctx.keys, {
          onComments: (route ?? ctx.route).kind === 'thread',
          linkNumbers: prefs(),
        }),
      helpOpen,
      closeHelp,
    });
    unregister = commands.map((c) => ctx.keys.register(c));
    wire(ctx);
  },
  onSettings(ctx) {
    // The look of the outline, the key rebinds and the option-driven listeners follow the change.
    wire(ctx);
  },
  onItems(batch, ctx) {
    if (onLoadDone || !ctx.options.scrollToSelectedOnLoad) return;
    if (!batch.posts.length && !batch.comments.length) return;
    onLoadDone = true;
    // The selection tracks this batch right after the modules see it, and layout settles a frame later.
    setTimeout(() => ctx.ui.selection().selectClosestInView(true), 300);
  },
  onRoute(next) {
    route = next;
    onLoadDone = false;
    overlay.hide();
    closeHelp();
  },
  dispose() {
    for (const stop of stops) stop();
    stops = [];
    for (const off of unregister) off();
    unregister = [];
    overlay.hide();
    closeHelp();
  },
});
