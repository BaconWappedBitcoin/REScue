/**
 * easterEgg (RES easterEgg): the Konami code (up up down down left right left right B A) makes a
 * short shower of bacon fall down the page. Harmless and entirely local: it adds one overlay for
 * four seconds that ignores the pointer, loads nothing, stores nothing, and with "reduce motion"
 * on it only shows a notice. Off by default. Idea from RES lib/modules/easterEgg.js (GPL-3.0, the
 * RES contributors, commit 4defffc); the code is new.
 */
import { defineModule, type ModuleContext } from '../../core/types';
import { removeStyle, setStyle } from './injectedStyle';

export const KONAMI = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
];

/** The new progress after `key`: one step further, back to one when the key restarts the code, else 0. */
export function konamiStep(progress: number, key: string): number {
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === KONAMI[progress]) return progress + 1;
  return k === KONAMI[0] ? 1 : 0;
}

const OVERLAY_ID = 'rescue-bacon';
const STYLE_ID = 'rescue-bacon-style';
const STYLE =
  `#${OVERLAY_ID}{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:2147483645}` +
  `#${OVERLAY_ID} span{position:absolute;top:-2em;font-size:28px;animation:rescue-bacon-fall linear forwards}` +
  '@keyframes rescue-bacon-fall{to{transform:translateY(110vh) rotate(360deg)}}';
const SHOWER_MS = 4000;
const PIECES = 24;

let progress = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let ctxRef: ModuleContext | null = null;

const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

function shower(): void {
  if (matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  stopShower();
  setStyle(STYLE_ID, STYLE);
  const box = document.createElement('div');
  box.id = OVERLAY_ID;
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < PIECES; i++) {
    const s = document.createElement('span');
    s.textContent = '🥓';
    s.style.left = `${Math.round(Math.random() * 96)}%`;
    s.style.animationDuration = `${1500 + Math.round(Math.random() * 2000)}ms`;
    s.style.animationDelay = `${Math.round(Math.random() * 1000)}ms`;
    box.appendChild(s);
  }
  (document.body ?? document.documentElement).appendChild(box);
  timer = setTimeout(stopShower, SHOWER_MS + 1000);
}

function stopShower(): void {
  clearTimeout(timer);
  document.getElementById(OVERLAY_ID)?.remove();
  removeStyle(STYLE_ID);
}

function onKey(e: KeyboardEvent): void {
  if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
  progress = konamiStep(progress, e.key);
  if (progress < KONAMI.length) return;
  progress = 0;
  ctxRef?.notices.show('Bacon!', { id: 'konami', timeoutMs: 3000 });
  shower();
}

export const easterEgg = defineModule({
  id: 'easterEgg',
  category: 'appearance',
  title: 'Konami code',
  description:
    'Type up, up, down, down, left, right, left, right, B, A on a page and a little bacon falls for a few seconds. Nothing is loaded or saved; with “reduce motion” on, you only get a notice.',
  enabledByDefault: false,
  options: {},
  init(ctx) {
    ctxRef = ctx;
    progress = 0;
    document.addEventListener('keydown', onKey);
  },
  dispose() {
    document.removeEventListener('keydown', onKey);
    stopShower();
    ctxRef = null;
    progress = 0;
  },
});
