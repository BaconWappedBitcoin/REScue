/**
 * REScue's colours. Every REScue surface (menus, popups, notices, the settings console, chips,
 * badges, the selection outline) reads the `--rescue-*` variables defined here, so one switch
 * recolours all of them.
 *
 * Light or dark follows REScue's host page, not the operating system: Reddit marks dark mode with
 * the class `theme-dark` on <html> (contract C.themeDarkClass). When that class is absent the
 * page's computed `color-scheme` decides, and only if the page does not say, the system's
 * `prefers-color-scheme`. The result is written to `data-rescue-theme="light|dark"` on <html> and
 * kept current by a MutationObserver, so a switch on the page recolours REScue at once.
 */
import { C } from '../contracts/reddit';
import { BUTTON_CSS } from './buttonStyle';

export const THEME_ID = 'rescue-theme';
export const THEME_ATTR = 'data-rescue-theme';

export type ThemeName = 'light' | 'dark';

const LIGHT = `
  --rescue-scheme: light;
  --rescue-bg: #ffffff;
  --rescue-fg: #1a1a1b;
  --rescue-border: #ccc;
  --rescue-meta: #666666;
  --rescue-accent: #336699;
  --rescue-hover: #eef4fa;
  --rescue-surface: #edeff1;
  --rescue-danger: #c33333;
  --rescue-warn: #cc9900;
  --rescue-warn-fg: #000000;
  --rescue-warn-text: #8a5a00;
  --rescue-badge-bg: #c23c00;
  --rescue-badge-fg: #ffffff;
  --rescue-outline: #ff4500;
  --rescue-mark-bg: #ffe58a;
  --rescue-mark-fg: #1a1a1b;
  --rescue-tag-bg: #e0e0e0;
  --rescue-tag-fg: #000000;
  --rescue-shadow: rgba(0, 0, 0, 0.25);
  --rescue-btn-bg: #e8f0f8;
  --rescue-btn-hover: #d3e4f4;
  --rescue-btn-fg: #1d4b7a;
  --rescue-btn-border: #7ba3cc;
  --rescue-label-bg: #f0f0f1;
  --rescue-label-fg: #4a4a4c;`;

const DARK = `
  --rescue-scheme: dark;
  --rescue-bg: #0e1113;
  --rescue-fg: #d7dadc;
  --rescue-border: #343536;
  --rescue-meta: #9b9ea0;
  --rescue-accent: #6aa6e0;
  --rescue-hover: #272729;
  --rescue-surface: #1a1a1b;
  --rescue-danger: #ff7b7b;
  --rescue-warn: #e0b000;
  --rescue-warn-fg: #000000;
  --rescue-warn-text: #e6b94d;
  --rescue-badge-bg: #ff6a33;
  --rescue-badge-fg: #0e1113;
  --rescue-outline: #ff6a33;
  --rescue-mark-bg: #8a6d00;
  --rescue-mark-fg: #ffffff;
  --rescue-tag-bg: #3a3d40;
  --rescue-tag-fg: #ffffff;
  --rescue-shadow: rgba(0, 0, 0, 0.6);
  --rescue-btn-bg: #1d2c3b;
  --rescue-btn-hover: #2b4259;
  --rescue-btn-fg: #a9cff3;
  --rescue-btn-border: #4a6f95;
  --rescue-label-bg: #26282a;
  --rescue-label-fg: #b4b7b9;`;

export const THEME_CSS = `
:root, :root[${THEME_ATTR}="light"] {${LIGHT}
}
:root[${THEME_ATTR}="dark"] {${DARK}
}
@media (prefers-color-scheme: dark) {
  :root:not([${THEME_ATTR}]) {${DARK}
  }
}
.rescue-overlay { color-scheme: var(--rescue-scheme); }
${BUTTON_CSS}
`;

const hasClass = (doc: Document, name: string): boolean =>
  doc.documentElement.classList.contains(name);

/** "light" / "dark" when the page's computed colour scheme names exactly one, else null. */
function pageScheme(doc: Document): ThemeName | null {
  const view = doc.defaultView;
  if (!view) return null;
  const scheme = (view.getComputedStyle(doc.documentElement).colorScheme ?? '').toLowerCase();
  const dark = /\bdark\b/.test(scheme);
  const light = /\blight\b/.test(scheme);
  if (dark && !light) return 'dark';
  if (light && !dark) return 'light';
  return null;
}

/** Light or dark: the page's theme class, else its computed color-scheme, else the system's. */
export function detectTheme(doc: Document = document): ThemeName {
  if (hasClass(doc, C.themeDarkClass)) return 'dark';
  const scheme = pageScheme(doc);
  if (scheme) return scheme;
  const prefersDark = doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return prefersDark ? 'dark' : 'light';
}

/** Writes the detected theme to <html data-rescue-theme>. Only touches the DOM when it changed. */
export function applyTheme(doc: Document = document): ThemeName {
  const theme = detectTheme(doc);
  if (doc.documentElement.getAttribute(THEME_ATTR) !== theme) {
    doc.documentElement.setAttribute(THEME_ATTR, theme);
  }
  return theme;
}

const watchers = new WeakMap<Document, () => void>();

/** Keeps `data-rescue-theme` current: watches <html class> and the system scheme. Idempotent. */
export function watchTheme(doc: Document = document): void {
  if (watchers.has(doc)) return;
  applyTheme(doc);
  const update = (): void => void applyTheme(doc);
  const observer = new MutationObserver(update);
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
  const media = doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener?.('change', update);
  watchers.set(doc, () => {
    observer.disconnect();
    media?.removeEventListener?.('change', update);
  });
}

/** Stops watching (tests, and when the extension is torn down). */
export function unwatchTheme(doc: Document = document): void {
  watchers.get(doc)?.();
  watchers.delete(doc);
}

/** Adds the variables to the page once and starts following the page's theme. Safe to repeat. */
export function ensureTheme(doc: Document = document): void {
  if (!doc.getElementById(THEME_ID)) {
    const style = doc.createElement('style');
    style.id = THEME_ID;
    style.textContent = THEME_CSS;
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  watchTheme(doc);
}
