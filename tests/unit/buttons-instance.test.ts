// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Decorations } from '../../src/layout/decorations';
import {
  INSTANCE_ATTR,
  OWNER_ATTR,
  sweepForeign,
  sweepOwn,
  takeOver,
} from '../../src/core/instance';
import { rescueButton, rescueLink } from '../../src/core/buttons';
import { BUTTON_CSS } from '../../src/core/buttonStyle';
import { THEME_CSS } from '../../src/core/theme';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  document.documentElement.removeAttribute(INSTANCE_ATTR);
  document.body.replaceChildren();
});

describe('single live instance per page', () => {
  it('lets the newest instance win: the older one tears down and its nodes go', async () => {
    const oldGone = vi.fn();
    const first = takeOver(oldGone);
    const deco1 = new Decorations();
    const a = rescueButton('rescue-filter-btn', 'filter…', 'REScue: x');
    deco1.decorate({ id: 't3_a' }, 'tagline', a);
    document.body.append(a);
    expect(a.getAttribute(OWNER_ATTR)).toBe(first.token);

    const secondGone = vi.fn();
    const second = takeOver(secondGone);
    await tick();
    expect(second.token).not.toBe(first.token);
    expect(oldGone).toHaveBeenCalledTimes(1);
    expect(first.alive()).toBe(false);
    expect(secondGone).not.toHaveBeenCalled();
    // The newest instance swept the older one's leftovers when it took over.
    expect(document.querySelector('.rescue-filter-btn')).toBeNull();
    expect(document.documentElement.getAttribute(INSTANCE_ATTR)).toBe(second.token);
  });

  it('a third reload supersedes the second and leaves one owner', async () => {
    const gone: string[] = [];
    takeOver(() => gone.push('1'));
    takeOver(() => gone.push('2'));
    const third = takeOver(() => gone.push('3'));
    await tick();
    expect(gone).toEqual(['1', '2']);
    expect(third.alive()).toBe(true);
  });

  it('clears the marks an older instance left on Reddit’s own elements', () => {
    const post = document.createElement('div');
    post.setAttribute('data-rescue-seen', '');
    post.setAttribute('data-rescue-hidden', 'filter');
    document.body.append(post);
    takeOver(() => {});
    expect(post.hasAttribute('data-rescue-seen')).toBe(false);
    expect(post.hasAttribute('data-rescue-hidden')).toBe(false);
  });

  it('sweeps nodes of dead instances and keeps its own', () => {
    const mine = takeOver(() => {});
    const orphan = document.createElement('span');
    orphan.setAttribute(OWNER_ATTR, 'someone-else');
    const own = document.createElement('span');
    own.setAttribute(OWNER_ATTR, mine.token);
    document.body.append(orphan, own);
    expect(sweepForeign(mine.token)).toBe(1);
    expect(document.body.contains(orphan)).toBe(false);
    sweepOwn(mine.token);
    expect(document.body.contains(own)).toBe(false);
  });
});

describe('decoration de-duplication', () => {
  it('a second control of the same kind on the same item replaces the first', () => {
    const deco = new Decorations();
    const host = document.createElement('div');
    document.body.append(host);
    const one = rescueButton('rescue-filter-btn', 'filter…', '');
    const two = rescueButton('rescue-filter-btn', 'filter…', '');
    host.append(one);
    deco.decorate({ id: 't3_a' }, 'tagline', one);
    deco.decorate({ id: 't3_a' }, 'tagline', two);
    expect(deco.slot('t3_a', 'tagline')).toEqual([two]);
    expect(host.contains(one)).toBe(false);
    // The same node twice is still one decoration.
    deco.decorate({ id: 't3_a' }, 'tagline', two);
    expect(deco.slot('t3_a', 'tagline')).toHaveLength(1);
  });

  it('after clear(), decorating the item again replaces the leftover node still on the page', () => {
    const deco = new Decorations();
    const old = rescueButton('rescue-filter-btn', 'filter…', '');
    document.body.append(old);
    deco.decorate({ id: 't3_a' }, 'tagline', old);
    deco.clear();
    expect(document.body.contains(old)).toBe(true);
    const fresh = rescueButton('rescue-filter-btn', 'filter…', '');
    document.body.append(fresh);
    deco.decorate({ id: 't3_a' }, 'tagline', fresh);
    expect(document.body.contains(old)).toBe(false);
    expect(document.querySelectorAll('.rescue-filter-btn')).toHaveLength(1);
  });

  it('different kinds, different items and different slots coexist', () => {
    const deco = new Decorations();
    deco.decorate({ id: 'a' }, 'tagline', rescueButton('rescue-filter-btn', 'filter…', ''));
    deco.decorate({ id: 'a' }, 'tagline', rescueButton('rescue-tag-btn', 'tag user', ''));
    deco.decorate({ id: 'b' }, 'tagline', rescueButton('rescue-filter-btn', 'filter…', ''));
    deco.decorate({ id: 'a' }, 'author', rescueButton('rescue-filter-btn', 'filter…', ''));
    expect(deco.slot('a', 'tagline')).toHaveLength(2);
    expect(deco.slot('b', 'tagline')).toHaveLength(1);
    expect(deco.slot('a', 'author')).toHaveLength(1);
  });
});

describe('button helper and style', () => {
  it('builds a button chip with its own class, the shared class and the hover text', () => {
    const b = rescueButton('rescue-x', 'word', 'REScue: does x');
    expect(b.className).toBe('rescue-x rescue-btn');
    expect(b.type).toBe('button');
    expect(b.title).toBe('REScue: does x');
    const a = rescueLink('rescue-y', 'go', '/r/a/', 'REScue: goes');
    expect(a.classList.contains('rescue-btn')).toBe(true);
    expect(a.getAttribute('href')).toBe('/r/a/');
  });

  it('is part of the themed stylesheet, with a focus ring and a hover state', () => {
    expect(THEME_CSS).toContain('.rescue-btn:hover');
    expect(BUTTON_CSS).toContain('.rescue-btn:focus-visible');
    expect(BUTTON_CSS).toContain('height: 20px');
  });

  const lum = (hex: string): number => {
    const c = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const ratio = (a: string, b: string): number => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };
  const vars = (block: RegExp): Record<string, string> => {
    const m = block.exec(THEME_CSS)![0];
    return Object.fromEntries(
      [...m.matchAll(/--rescue-([a-z-]+):\s*(#[0-9a-f]{6})/g)].map((x) => [x[1]!, x[2]!]),
    );
  };

  it('has text contrast of at least 4.5:1 in light and dark', () => {
    const light = vars(/:root, :root\[data-rescue-theme="light"\] \{[^}]*\}/);
    const dark = vars(/:root\[data-rescue-theme="dark"\] \{[^}]*\}/);
    for (const t of [light, dark]) {
      expect(ratio(t['btn-fg']!, t['btn-bg']!)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t['btn-fg']!, t['btn-hover']!)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t['label-fg']!, t['label-bg']!)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('a page that clears <html>’s attributes', () => {
  it('does not switch REScue off: the token is put back, and only another token supersedes', async () => {
    // Its own document, so instances left by the tests above cannot answer the same mutations.
    const doc = document.implementation.createHTMLDocument('x');
    const root = doc.documentElement;
    let superseded = 0;
    const inst = takeOver(() => superseded++, doc);
    root.removeAttribute(INSTANCE_ATTR);
    await tick();
    expect(inst.alive()).toBe(true);
    expect(root.getAttribute(INSTANCE_ATTR)).toBe(inst.token);
    expect(superseded).toBe(0);
    root.setAttribute(INSTANCE_ATTR, 'someone-newer');
    await tick();
    expect(inst.alive()).toBe(false);
    expect(superseded).toBe(1);
  });
});
