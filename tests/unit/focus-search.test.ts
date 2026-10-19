import { beforeEach, describe, expect, it } from 'vitest';
import { focusSearchBox } from '../../src/model/access';

const box = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0 }) as DOMRect;

function size(el: Element, w: number, h: number): void {
  el.getBoundingClientRect = () => box(w, h);
}

describe('focusSearchBox', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses the visible input, not the hidden 0x0 twin that comes first', () => {
    document.body.innerHTML =
      '<reddit-header-large><form action="/search"><input name="q" id="ghost"></form>' +
      '<reddit-search-large><input name="q" id="real"></reddit-search-large></reddit-header-large>';
    size(document.getElementById('ghost')!, 0, 0);
    size(document.getElementById('real')!, 300, 32);
    expect(focusSearchBox()).toBe(true);
    expect(document.activeElement?.id).toBe('real');
  });

  it('finds the visible input inside an open shadow root', () => {
    document.body.innerHTML = '<reddit-search-large></reddit-search-large>';
    const host = document.querySelector('reddit-search-large')!;
    const input = document.createElement('input');
    input.name = 'q';
    host.attachShadow({ mode: 'open' }).append(input);
    size(input, 200, 30);
    expect(focusSearchBox()).toBe(true);
    expect(host.shadowRoot!.activeElement).toBe(input);
  });

  it('clicks the search trigger when no input is visible, then focuses the box that appears', async () => {
    document.body.innerHTML =
      '<reddit-search-large><button id="open">search</button><input name="q" id="late"></reddit-search-large>';
    const late = document.getElementById('late')!;
    size(late, 0, 0);
    document.getElementById('open')!.addEventListener('click', () => size(late, 280, 32));
    const result = new Promise<boolean>((resolve) => {
      expect(focusSearchBox(resolve)).toBe(true);
    });
    expect(await result).toBe(true);
    expect(document.activeElement).toBe(late);
  });

  it('reports failure when the trigger never produces a visible box', async () => {
    document.body.innerHTML =
      '<reddit-search-large><button>search</button><input name="q" id="ghost"></reddit-search-large>';
    size(document.getElementById('ghost')!, 0, 0);
    const result = new Promise<boolean>((resolve) => focusSearchBox(resolve));
    expect(await result).toBe(false);
  });

  it('focuses the live header box: a textarea in faceplate-search-input inside reddit-search-large', () => {
    // Live 2026-10-15: both hosts have OPEN shadow roots; the light-DOM input[name=q] twin is 0x0.
    document.body.innerHTML = '<reddit-search-large></reddit-search-large>';
    const host = document.querySelector('reddit-search-large')!;
    const twin = document.createElement('input');
    twin.name = 'q';
    size(twin, 0, 0);
    const fs = document.createElement('faceplate-search-input');
    const area = document.createElement('textarea');
    area.setAttribute('placeholder', 'Search');
    fs.attachShadow({ mode: 'open' }).append(area);
    size(area, 406, 20);
    host.attachShadow({ mode: 'open' }).append(twin, fs);
    expect(focusSearchBox()).toBe(true);
    expect(fs.shadowRoot!.activeElement).toBe(area);
  });

  it('does not take a page textarea outside the header search for the search box', () => {
    document.body.innerHTML = '<textarea placeholder="Search notes" id="x"></textarea>';
    size(document.getElementById('x')!, 300, 40);
    expect(focusSearchBox()).toBe(false);
  });

  it('returns false with neither a visible input nor a trigger', () => {
    document.body.innerHTML = '<form action="/search"><input name="q"></form>';
    expect(focusSearchBox()).toBe(false);
  });
});
