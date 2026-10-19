import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMenu, MENU_ID } from '../../src/layout/native/menu';
import { createToolbar } from '../../src/layout/native/toolbar';
import { quickToggles } from '../../src/modules/core/quickToggles';
import { customToggles } from '../../src/modules/core/presets';
import { settingsLinkTarget } from '../../src/modules/core/settingsConsole';
import { defaultProfile, type SettingsProfile } from '../../src/core/settings';
import type { MenuItem, ModuleContext, ModuleDefinition } from '../../src/core/types';

afterEach(() => {
  document.body.innerHTML = '';
  document.getElementById('rescue-theme')?.remove();
  document.getElementById('rescue-menu-css')?.remove();
});

const gear = (): HTMLButtonElement => {
  const b = document.createElement('button');
  document.body.appendChild(b);
  return b;
};
const item = (id: string, order: number, extra: Partial<MenuItem> = {}): MenuItem => ({
  id,
  label: id,
  order,
  onClick: () => {},
  ...extra,
});
const rows = () => [...document.querySelectorAll<HTMLElement>(`#${MENU_ID} [data-menu-id]`)];
const key = (k: string) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

describe('gear menu', () => {
  it('lists items in order, ties by registration, and replaces by id', () => {
    const menu = createMenu();
    menu.add(item('b', 20));
    menu.add(item('a', 10));
    menu.add(item('c', 20));
    menu.add(item('a', 30, { label: 'A2' }));
    menu.open(gear());
    expect(rows().map((r) => r.getAttribute('data-menu-id'))).toEqual(['b', 'c', 'a']);
    expect(rows()[2]!.textContent).toBe('A2');
  });

  it('remove function takes the row away', () => {
    const menu = createMenu();
    const off = menu.add(item('a', 1));
    menu.add(item('b', 2));
    off();
    expect(menu.items().map((i) => i.id)).toEqual(['b']);
  });

  it('runs onClick and closes; the secondary icon has its own action', () => {
    const menu = createMenu();
    const onClick = vi.fn();
    const sec = vi.fn();
    menu.add(item('a', 1, { onClick, secondary: { label: 'Search', icon: '?', onClick: sec } }));
    menu.open(gear());
    document.querySelector<HTMLElement>('[aria-label="Search"]')!.click();
    expect(sec).toHaveBeenCalledTimes(1);
    expect(menu.isOpen()).toBe(false);
    menu.open(gear());
    rows()[0]!.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(menu.isOpen()).toBe(false);
  });

  it('a toggle row flips its switch and keeps the menu open', () => {
    const menu = createMenu();
    let on = false;
    menu.add(item('t', 1, { toggle: { get: () => on, set: (v) => void (on = v) } }));
    menu.open(gear());
    const row = rows()[0]!;
    expect(row.getAttribute('role')).toBe('menuitemcheckbox');
    expect(row.getAttribute('aria-checked')).toBe('false');
    row.click();
    expect(on).toBe(true);
    expect(row.getAttribute('aria-checked')).toBe('true');
    expect(row.querySelector('[data-on]')).not.toBeNull();
    expect(menu.isOpen()).toBe(true);
  });

  it('is keyboard accessible: arrows wrap, Home/End jump, Escape closes and refocuses the gear', () => {
    const menu = createMenu();
    for (const [i, id] of ['a', 'b', 'c'].entries()) menu.add(item(id, i));
    const g = gear();
    menu.open(g);
    expect(document.activeElement).toBe(rows()[0]);
    key('ArrowDown');
    expect(document.activeElement).toBe(rows()[1]);
    key('End');
    expect(document.activeElement).toBe(rows()[2]);
    key('ArrowDown');
    expect(document.activeElement).toBe(rows()[0]);
    key('ArrowUp');
    expect(document.activeElement).toBe(rows()[2]);
    key('Escape');
    expect(menu.isOpen()).toBe(false);
    expect(document.getElementById(MENU_ID)).toBeNull();
    expect(document.activeElement).toBe(g);
  });

  it('closes on an outside click, stays open for inside clicks, and the gear toggles it', () => {
    const menu = createMenu();
    menu.add(item('t', 1, { toggle: { get: () => false, set: () => {} } }));
    const g = gear();
    const elsewhere = document.createElement('p');
    document.body.appendChild(elsewhere);
    menu.open(g);
    rows()[0]!.click();
    expect(menu.isOpen()).toBe(true);
    elsewhere.click();
    expect(menu.isOpen()).toBe(false);
    menu.open(g);
    menu.open(g);
    expect(menu.isOpen()).toBe(false);
  });

  it('writes labels as text, never markup', () => {
    const menu = createMenu();
    menu.add(item('x', 1, { label: '<img src=x onerror=alert(1)>' }));
    menu.open(gear());
    expect(document.querySelector(`#${MENU_ID} img`)).toBeNull();
    expect(rows()[0]!.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('is exposed on the tool strip', () => {
    const bar = createToolbar();
    const g = gear();
    bar.addMenuItem(item('a', 1));
    bar.openMenu(g);
    expect(rows()).toHaveLength(1);
  });

  it('defines the theme variables once, with a dark scheme', () => {
    createToolbar().addHeaderTool(gear());
    createToolbar().addHeaderTool(gear());
    const styles = document.querySelectorAll('#rescue-theme');
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toContain('--rescue-bg');
    expect(styles[0]!.textContent).toContain('prefers-color-scheme: dark');
  });
});

function fakeCtx(profile: SettingsProfile, defs: ModuleDefinition[]) {
  const menu = createMenu();
  const state = { profile };
  const ctx = {
    ui: { addMenuItem: (i: MenuItem) => menu.add(i) },
    settings: {
      profile: () => state.profile,
      definitions: () => defs,
      save: vi.fn(async (next: SettingsProfile) => void (state.profile = next)),
    },
    notices: { show: vi.fn() },
  } as unknown as ModuleContext;
  return { ctx, menu, state };
}

describe('menu items from modules', () => {
  const filteDef = {
    id: 'filteReddit',
    options: { hideNsfw: { type: 'boolean', default: false, title: 'x' } },
  } as unknown as ModuleDefinition;

  it('Hide NSFW writes filteReddit’s option and says so in a notice', async () => {
    const { ctx, menu, state } = fakeCtx(defaultProfile(), [filteDef]);
    quickToggles.init!(ctx as never);
    const it = menu.items().find((i) => i.id === 'quick:hideNsfw')!;
    expect(it.toggle!.get()).toBe(false);
    it.toggle!.set(true);
    expect(state.profile.modules.filteReddit?.options?.hideNsfw).toBe(true);
    expect(it.toggle!.get()).toBe(true);
    await Promise.resolve();
    expect(ctx.notices.show).toHaveBeenCalledWith(
      expect.stringContaining('on'),
      expect.objectContaining({ moduleId: 'filteReddit' }),
    );
    it.toggle!.set(false);
    expect(state.profile.modules.filteReddit?.options?.hideNsfw).toBeUndefined();
    quickToggles.dispose!();
    expect(menu.items()).toHaveLength(0);
  });

  it('shows one switch per custom toggle and writes the profile', () => {
    const profile = defaultProfile();
    profile.modules.customToggles = {
      options: {
        toggles: [
          { name: 'Politics', enabled: true },
          { name: 'Memes', enabled: false },
        ],
      },
    };
    const def = {
      id: 'customToggles',
      options: { toggles: { type: 'table', default: [], title: 't', columns: [] } },
    } as unknown as ModuleDefinition;
    const { ctx, menu, state } = fakeCtx(profile, [def]);
    customToggles.init!(ctx as never);
    const items = menu.items().filter((i) => i.id.startsWith('customToggle:'));
    expect(items.map((i) => [i.label, i.toggle!.get()])).toEqual([
      ['Politics', true],
      ['Memes', false],
    ]);
    items[1]!.toggle!.set(true);
    const rowsNow = state.profile.modules.customToggles!.options!.toggles as Array<{
      name: string;
      enabled: boolean;
    }>;
    expect(rowsNow.find((r) => r.name === 'Memes')!.enabled).toBe(true);
    expect(rowsNow.find((r) => r.name === 'Politics')!.enabled).toBe(true);
    customToggles.dispose!();
  });
});

describe('settings deep links', () => {
  const clickOn = (a: HTMLAnchorElement): Event => {
    const e = new MouseEvent('click', { bubbles: true, composed: true });
    a.dispatchEvent(e);
    return e;
  };

  it('finds a #rescue:settings link, with or without a module', () => {
    const seen: Array<{ module?: string } | null> = [];
    document.addEventListener('click', (e) => seen.push(settingsLinkTarget(e)), { once: false });
    const a = document.createElement('a');
    a.href = '#rescue:settings/filteReddit';
    document.body.appendChild(a);
    clickOn(a);
    a.href = '#rescue:settings';
    clickOn(a);
    a.href = '#other';
    clickOn(a);
    expect(seen.slice(-3)).toEqual([{ module: 'filteReddit' }, { module: undefined }, null]);
  });
});
