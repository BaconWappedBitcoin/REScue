// REScue's light/dark choice follows the host page: Reddit's `theme-dark` class on <html>, then the
// page's computed color-scheme, then the system setting; and it follows live switches.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  detectTheme,
  ensureTheme,
  THEME_ATTR,
  THEME_ID,
  unwatchTheme,
  watchTheme,
} from '../../src/core/theme';
import { tick } from './module-harness';

const html = document.documentElement;

function systemPrefersDark(dark: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: dark,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  // happy-dom reads window.matchMedia through the document's view
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (globalThis as { matchMedia: unknown }).matchMedia,
  });
}

function pageColorScheme(value: string): void {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
    const style = real(el, pseudo);
    return new Proxy(style, {
      get: (t, p, r) => (p === 'colorScheme' ? value : Reflect.get(t, p, r)),
    });
  });
}

afterEach(() => {
  unwatchTheme();
  html.className = '';
  html.removeAttribute(THEME_ATTR);
  document.getElementById(THEME_ID)?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('detectTheme', () => {
  it('is dark when <html> has Reddit’s theme-dark class, even if the system is light', () => {
    systemPrefersDark(false);
    html.className = 'theme-beta theme-dark';
    expect(detectTheme()).toBe('dark');
  });

  it('is light on Reddit’s light mode even if the system is dark', () => {
    systemPrefersDark(true);
    html.className = 'theme-beta';
    pageColorScheme('light');
    expect(detectTheme()).toBe('light');
  });

  it('falls back to the page’s computed color-scheme when there is no theme class', () => {
    systemPrefersDark(false);
    pageColorScheme('dark');
    expect(detectTheme()).toBe('dark');
  });

  it('ignores a page that allows both schemes and uses the system setting', () => {
    pageColorScheme('light dark');
    systemPrefersDark(true);
    expect(detectTheme()).toBe('dark');
    systemPrefersDark(false);
    expect(detectTheme()).toBe('light');
  });

  it('uses prefers-color-scheme when the page says nothing', () => {
    pageColorScheme('normal');
    systemPrefersDark(true);
    expect(detectTheme()).toBe('dark');
  });
});

describe('the theme attribute', () => {
  it('is written to <html> and follows a live class switch', async () => {
    systemPrefersDark(false);
    pageColorScheme('normal');
    ensureTheme();
    expect(html.getAttribute(THEME_ATTR)).toBe('light');
    html.classList.add('theme-dark');
    await tick();
    expect(html.getAttribute(THEME_ATTR)).toBe('dark');
    html.classList.remove('theme-dark');
    await tick();
    expect(html.getAttribute(THEME_ATTR)).toBe('light');
  });

  it('adds the variables once, with a dark set keyed on the attribute', () => {
    ensureTheme();
    ensureTheme();
    expect(document.querySelectorAll(`#${THEME_ID}`)).toHaveLength(1);
    const css = document.getElementById(THEME_ID)!.textContent!;
    expect(css).toContain(`[${THEME_ATTR}="dark"]`);
    expect(css).toContain('--rescue-bg: #0e1113');
  });

  it('does not touch the DOM when nothing changed, and watching twice is harmless', () => {
    html.className = 'theme-dark';
    watchTheme();
    watchTheme();
    const set = vi.spyOn(html, 'setAttribute');
    applyTheme();
    expect(set).not.toHaveBeenCalled();
  });
});
