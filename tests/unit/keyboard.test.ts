import { describe, expect, it, vi, beforeEach } from 'vitest';
import { KeyDispatcher, chordOf, parseChord } from '../../src/core/keys';

const key = (
  k: string,
  mods: Partial<KeyboardEventInit> = {},
  target: EventTarget = document.body,
) => {
  const e = new KeyboardEvent('keydown', {
    key: k,
    bubbles: true,
    cancelable: true,
    composed: true,
    ...mods,
  });
  target.dispatchEvent(e);
  return e;
};

describe('chords', () => {
  it('canonicalizes modifier order and case', () => {
    expect(chordOf(new KeyboardEvent('keydown', { key: 'J', shiftKey: true }))).toBe('shift+j');
    expect(chordOf(new KeyboardEvent('keydown', { key: 'k', altKey: true, ctrlKey: true }))).toBe(
      'ctrl+alt+k',
    );
    expect(chordOf(new KeyboardEvent('keydown', { key: '?', shiftKey: true }))).toBe('?');
    expect(chordOf(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true }))).toBe(
      'shift+enter',
    );
  });

  it('parses user-entered chords, including sequences', () => {
    expect(parseChord('Shift+J')).toEqual(['shift+j']);
    expect(parseChord('alt+shift+k')).toEqual(['alt+shift+k']);
    expect(parseChord('g f')).toEqual(['g', 'f']);
    expect(parseChord('  ')).toEqual([]);
  });
});

describe('dispatcher', () => {
  let d: KeyDispatcher;
  let detach: () => void;
  beforeEach(() => {
    detach?.();
    d = new KeyDispatcher();
    detach = d.attach(window);
  });

  it('runs the bound command and stops the event from reaching page handlers', () => {
    const run = vi.fn();
    d.register({ id: 'moveDown', title: 'Down', defaultKeys: ['j'], run });
    const pageHandler = vi.fn();
    document.body.addEventListener('keydown', pageHandler);
    const e = key('j');
    expect(run).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
    expect(pageHandler).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', pageHandler);
  });

  it('picks the command whose context is active for a shared key', () => {
    let onComments = false;
    const listing = vi.fn();
    const comments = vi.fn();
    d.register({
      id: 'followLink',
      title: 'Follow',
      defaultKeys: ['enter'],
      enabled: () => !onComments,
      run: listing,
    });
    d.register({
      id: 'toggleChildren',
      title: 'Toggle',
      defaultKeys: ['enter'],
      enabled: () => onComments,
      run: comments,
    });
    key('Enter');
    onComments = true;
    key('Enter');
    expect(listing).toHaveBeenCalledOnce();
    expect(comments).toHaveBeenCalledOnce();
  });

  it('lets a declining command pass the key through', () => {
    d.register({ id: 'x', title: 'x', defaultKeys: ['x'], run: () => false });
    expect(key('x').defaultPrevented).toBe(false);
  });

  it('honours rebinding overrides and reports conflicts only between commands in one context', () => {
    const a = vi.fn();
    d.register({ id: 'a', title: 'A', defaultKeys: ['a'], run: a, context: 'listing' });
    d.register({ id: 'b', title: 'B', defaultKeys: ['b'], run: vi.fn(), context: 'listing' });
    d.register({ id: 'c', title: 'C', defaultKeys: ['b'], run: vi.fn(), context: 'comments' });
    expect(d.conflicts()).toEqual({});
    d.setOverrides({ a: ['b'] });
    expect(d.conflicts()).toEqual({ b: ['a', 'b'] });
    d.setOverrides({ a: ['q'] });
    key('q');
    expect(a).toHaveBeenCalledOnce();
  });

  it('runs two-key sequences (go mode) and times them out', () => {
    vi.useFakeTimers();
    const front = vi.fn();
    d.register({ id: 'frontPage', title: 'Front page', defaultKeys: ['g f'], run: front });
    key('g');
    key('f');
    expect(front).toHaveBeenCalledOnce();
    key('g');
    vi.advanceTimersByTime(2500);
    key('f');
    expect(front).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('never fires inside text fields, including contenteditable inside a shadow root', () => {
    const run = vi.fn();
    d.register({ id: 'moveDown', title: 'Down', defaultKeys: ['j'], run });
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    key('j', {}, ta);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    host.attachShadow({ mode: 'open' }).appendChild(editor);
    key('j', {}, editor);
    expect(run).not.toHaveBeenCalled();
    ta.remove();
    host.remove();
  });

  it('lets Escape out of a REScue field so the dialog can close, but contains other keys', () => {
    const run = vi.fn();
    d.register({ id: 'moveDown', title: 'Down', defaultKeys: ['j'], run });
    const input = document.createElement('input');
    input.setAttribute('data-rescue-input', '');
    document.body.appendChild(input);
    const pageHandler = vi.fn();
    document.body.addEventListener('keydown', pageHandler);

    key('j', {}, input);
    expect(run).not.toHaveBeenCalled();
    expect(pageHandler).not.toHaveBeenCalled();

    const esc = key('Escape', {}, input);
    expect(run).not.toHaveBeenCalled();
    expect(esc.defaultPrevented).toBe(false);
    expect(pageHandler).toHaveBeenCalledOnce();

    document.body.removeEventListener('keydown', pageHandler);
    input.remove();
  });
});
