import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNotices, muteKey, type NoticeHost } from '../../src/core/notices';
import { defaultProfile } from '../../src/core/settings';
import { readNoticePrefs, withMutedTypes } from '../../src/modules/core/noticeSettings';

let notices: NoticeHost;
const root = (): ShadowRoot => document.getElementById('rescue-notices')!.shadowRoot!;
const all = (): HTMLElement[] => [...root().querySelectorAll<HTMLElement>('.n')];

beforeEach(() => {
  vi.useFakeTimers();
  notices = createNotices();
});
afterEach(() => {
  vi.useRealTimers();
  document.getElementById('rescue-notices')?.remove();
});

describe('notice stack above the settings console', () => {
  it('sits at a higher z-index than the console, so notices opened over it stay visible', () => {
    notices.show('Over the console');
    const style = root().querySelector('style')!.textContent!;
    const notice = Number(/z-index:\s*(\d+)/.exec(style)![1]);
    const css = readFileSync(resolve(process.cwd(), 'src/ui/settings-console/console.css'), 'utf8');
    const consoleZ = Number(/\.console\s*\{[^}]*?z-index:\s*(\d+)/s.exec(css)![1]);
    expect(notice).toBeGreaterThan(consoleZ);
  });
});

describe('notices', () => {
  it('shows a header with the module title and a link to its settings', () => {
    notices.configure({ moduleTitle: (id) => (id === 'filteReddit' ? 'filteReddit' : undefined) });
    notices.show('Done', { moduleId: 'filteReddit' });
    const n = all()[0]!;
    expect(n.querySelector('.head')!.textContent).toContain('filteReddit');
    expect(n.querySelector('a')!.getAttribute('href')).toBe('#rescue:settings/filteReddit');
    expect(n.querySelector('.msg')!.textContent).toBe('Done');
  });

  it('ignores a module id that is not a plain id, and writes text only', () => {
    notices.show('<b>hi</b>', { moduleId: '"><script>' });
    expect(root().querySelector('.head')).toBeNull();
    expect(root().querySelector('b')).toBeNull();
  });

  it('mute checkbox stores the type, and a muted type is not shown again', () => {
    let muted: string[] = [];
    notices.configure({ muted: () => muted, setMuted: (next) => (muted = next) });
    notices.show('Tip', { id: 'tip', moduleId: 'about' });
    const box = root().querySelector<HTMLInputElement>('.mute-box')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(muted).toEqual(['about:tip']);
    all()[0]!.remove();
    notices.show('Tip', { id: 'tip', moduleId: 'about' });
    expect(all()).toHaveLength(0);
    // Other types and modules are unaffected.
    notices.show('Other', { id: 'other', moduleId: 'about' });
    expect(all()).toHaveLength(1);
  });

  it('unticking the box unmutes, and errors have no mute box', () => {
    let muted = ['--:x'];
    notices.configure({ muted: () => muted, setMuted: (next) => (muted = next) });
    notices.show('Boom', { id: 'e', kind: 'error' });
    expect(root().querySelector('.mute-box')).toBeNull();
    expect(muteKey({ id: 'x' })).toBe('--:x');
    expect(muteKey({})).toBeUndefined();
  });

  it('cooldown suppresses the same type until it passes', () => {
    notices.show('Hello', { id: 'c', cooldownMs: 1000 });
    all()[0]!.remove();
    notices.show('Hello', { id: 'c', cooldownMs: 1000 });
    expect(all()).toHaveLength(0);
    vi.advanceTimersByTime(1001);
    notices.show('Hello', { id: 'c', cooldownMs: 1000 });
    expect(all()).toHaveLength(1);
  });

  it('closes after the timeout, but not while the pointer is over it', () => {
    notices.show('Hover me', { timeoutMs: 1000 });
    const n = all()[0]!;
    vi.advanceTimersByTime(600);
    n.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(5000);
    expect(all()).toHaveLength(1);
    n.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(999);
    expect(all()).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(all()).toHaveLength(0);
  });

  it('applies the global close delay to info notices only, and 0 keeps them open', () => {
    let delay = 0;
    notices.configure({ closeDelayMs: () => delay });
    notices.show('Stays', {});
    vi.advanceTimersByTime(100000);
    expect(all()).toHaveLength(1);
    delay = 2000;
    notices.show('Goes', {});
    notices.show('Warning stays', { kind: 'warning' });
    notices.show('Own timeout wins', { timeoutMs: 500 });
    vi.advanceTimersByTime(600);
    expect(all().map((n) => n.dataset.message)).toEqual(['Stays', 'Goes', 'Warning stays']);
    vi.advanceTimersByTime(1500);
    expect(all().map((n) => n.dataset.message)).toEqual(['Stays', 'Warning stays']);
  });

  it('fades a closing notice out over the fade length, and the pointer brings it back (RES fadeOutLength)', () => {
    notices.configure({ fadeOutMs: () => 2000 });
    notices.show('Fading', { timeoutMs: 1000 });
    const n = all()[0]!;
    vi.advanceTimersByTime(1001);
    expect(all()).toHaveLength(1);
    expect(n.style.opacity).toBe('0');
    expect(n.style.transition).toContain('2000ms');
    n.dispatchEvent(new Event('mouseenter'));
    expect(n.style.opacity).toBe('');
    vi.advanceTimersByTime(5000);
    expect(all()).toHaveLength(1);
    n.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(1001);
    vi.advanceTimersByTime(2001);
    expect(all()).toHaveLength(0);
  });

  it('shows identical messages once, and the repeat restarts its timer', () => {
    notices.show('Same', { timeoutMs: 1000 });
    vi.advanceTimersByTime(800);
    notices.show('Same', { timeoutMs: 1000 });
    expect(all()).toHaveLength(1);
    vi.advanceTimersByTime(800);
    expect(all()).toHaveLength(1);
    vi.advanceTimersByTime(300);
    expect(all()).toHaveLength(0);
    notices.show('Same', { kind: 'warning' });
    notices.show('Same', {});
    expect(all()).toHaveLength(2);
  });

  it('a notice with the same id replaces the old one, and dismiss removes it', () => {
    notices.show('One', { id: 'a' });
    notices.show('Two', { id: 'a' });
    expect(all().map((n) => n.dataset.message)).toEqual(['Two']);
    notices.dismiss('a');
    expect(all()).toHaveLength(0);
  });

  it('uses the theme variables and defines them on the page', () => {
    notices.show('x', {});
    expect(document.getElementById('rescue-theme')).not.toBeNull();
    expect(root().querySelector('style')!.textContent).toContain('var(--rescue-bg');
  });
});

describe('notice settings', () => {
  it('reads and writes the muted list through the profile', () => {
    const p = withMutedTypes(defaultProfile(), ['about:tip']);
    expect(readNoticePrefs(p).mutedTypes).toEqual(['about:tip']);
    expect(readNoticePrefs(withMutedTypes(p, [])).mutedTypes).toEqual([]);
    expect(readNoticePrefs(defaultProfile())).toEqual({
      closeDelaySeconds: 0,
      fadeOutSeconds: 1,
      mutedTypes: [],
    });
  });
});
