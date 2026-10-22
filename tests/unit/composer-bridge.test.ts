import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeClient } from '../../src/core/bridge-client';
import type { BridgeRequest } from '../../src/core/bridge-protocol';
import bridge from '../../src/entrypoints/bridge.content';

/**
 * Reddit's comment box as verified live (2026-10-21): a light-DOM `comment-composer-host` holding a
 * `shreddit-composer` (mode="richText") whose OPEN shadow root carries the toolbar ("Switch to
 * Markdown") and the Lexical editor `div[contenteditable=true][data-lexical-editor]`. The textarea
 * variant stands for Markdown mode.
 */
function richComposer(text = ''): { host: Element; composer: Element; editor: HTMLElement } {
  const host = document.createElement('comment-composer-host');
  host.setAttribute('post-id', 't3_x');
  const composer = document.createElement('shreddit-composer');
  composer.setAttribute('mode', 'richText');
  const root = composer.attachShadow({ mode: 'open' });
  const toolbar = document.createElement('div');
  const sw = document.createElement('button');
  sw.setAttribute('aria-label', 'Switch to Markdown');
  sw.append(document.createElement('span'));
  const bold = document.createElement('button');
  bold.setAttribute('aria-label', 'Bold');
  toolbar.append(bold, sw);
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('data-lexical-editor', 'true');
  editor.setAttribute('name', 'body');
  editor.textContent = text;
  root.append(toolbar, editor);
  host.append(composer);
  document.body.append(host);
  return { host, composer, editor };
}

function markdownComposer(text = ''): { host: Element; box: HTMLTextAreaElement } {
  const host = document.createElement('comment-composer-host');
  const composer = document.createElement('shreddit-composer');
  composer.setAttribute('mode', 'markdown');
  const box = document.createElement('textarea');
  box.value = text;
  composer.attachShadow({ mode: 'open' }).append(box);
  host.append(composer);
  document.body.append(host);
  return { host, box };
}

const start = (): void => bridge.main(undefined as never);
const ask = async (el: Element, body: (ref: string) => BridgeRequest) => {
  start();
  const client = new BridgeClient(window);
  return client.request(body(client.ref(el)), 3000);
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('bridge composer.read', () => {
  it('reads the rich-text editor inside the open shadow root, with the mode', async () => {
    const { host } = richComposer('hello there');
    expect(await ask(host, (ref) => ({ op: 'composer.read', ref }))).toEqual({
      ok: true,
      text: 'hello there',
      mode: 'richText',
    });
  });

  it('reads the Markdown text box', async () => {
    const { host } = markdownComposer('**md**\nline');
    expect(await ask(host, (ref) => ({ op: 'composer.read', ref }))).toEqual({
      ok: true,
      text: '**md**\nline',
      mode: 'markdown',
    });
  });

  it('refuses any element that is not a composer host', async () => {
    const div = document.createElement('div');
    div.append(document.createElement('textarea'));
    document.body.append(div);
    expect(await ask(div, (ref) => ({ op: 'composer.read', ref }))).toEqual({
      ok: false,
      error: 'not-composer',
    });
  });
});

describe('bridge composer.insertAt', () => {
  it('inserts at the textarea caret and fires input, keeping the rest', async () => {
    const { host, box } = markdownComposer('Hello world');
    box.setSelectionRange(6, 6);
    const inputs = vi.fn();
    box.addEventListener('input', inputs);
    const res = await ask(host, (ref) => ({ op: 'composer.insertAt', ref, text: 'big ' }));
    expect(res).toEqual({ ok: true, accepted: true });
    expect(box.value).toBe('Hello big world');
    expect(inputs).toHaveBeenCalled();
  });

  it('replaces only a selection inside the textarea', async () => {
    const { host, box } = markdownComposer('one two three');
    box.setSelectionRange(4, 7);
    await ask(host, (ref) => ({ op: 'composer.insertAt', ref, text: '2' }));
    expect(box.value).toBe('one 2 three');
  });

  it('uses insertText (never selectAll) on the rich-text editor', async () => {
    const { host, editor } = richComposer('kept ');
    const calls: string[] = [];
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: (cmd: string, _ui?: boolean, value?: string) => {
        calls.push(cmd);
        if (cmd === 'insertText') editor.textContent += value ?? '';
        return true;
      },
    });
    const res = await ask(host, (ref) => ({ op: 'composer.insertAt', ref, text: 'macro' }));
    expect(res).toEqual({ ok: true, accepted: true });
    expect(calls).toEqual(['insertText']);
    expect(editor.textContent).toBe('kept macro');
  });

  it('reports accepted: false when the editor drops the text', async () => {
    const { host } = richComposer('x');
    Object.defineProperty(document, 'execCommand', { configurable: true, value: () => false });
    expect(await ask(host, (ref) => ({ op: 'composer.insertAt', ref, text: 'gone' }))).toEqual({
      ok: true,
      accepted: false,
    });
  });

  it('rejects a request that is not the documented shape', async () => {
    const { host, box } = markdownComposer('safe');
    const bad = await ask(
      host,
      (ref) => ({ op: 'composer.insertAt', ref, text: { evil: 1 } }) as unknown as BridgeRequest,
    );
    expect(bad).toEqual({ ok: false, error: 'bad-request' });
    const huge = await ask(host, (ref) => ({
      op: 'composer.insertAt',
      ref,
      text: 'x'.repeat(50_000),
    }));
    expect(huge).toEqual({ ok: false, error: 'bad-request' });
    expect(box.value).toBe('safe');
  });
});

/** Another reply box on the page that holds the focus, and an editor whose focus() does nothing. */
function stealFocus(editor: HTMLElement): HTMLTextAreaElement {
  const other = document.createElement('textarea');
  other.value = 'someone else’s draft';
  document.body.append(other);
  other.focus();
  editor.focus = () => undefined;
  return other;
}

describe('bridge composer ops refuse to type when the focus did not move', () => {
  const recordExec = (): string[] => {
    const calls: string[] = [];
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: (cmd: string) => {
        calls.push(cmd);
        return true;
      },
    });
    return calls;
  };

  it('composer.insertAt answers not-focused and types nothing', async () => {
    const { host, editor } = richComposer('mine');
    const other = stealFocus(editor);
    const calls = recordExec();
    const res = await ask(host, (ref) => ({ op: 'composer.insertAt', ref, text: 'macro' }));
    expect(res).toEqual({ ok: false, error: 'not-focused' });
    expect(calls).toEqual([]);
    expect(other.value).toBe('someone else’s draft');
  });

  it('composer.insert answers not-focused and never selects all', async () => {
    const { host, editor } = richComposer('mine');
    const other = stealFocus(editor);
    const calls = recordExec();
    const res = await ask(host, (ref) => ({ op: 'composer.insert', ref, text: 'big text' }));
    expect(res).toEqual({ ok: false, error: 'not-focused' });
    expect(calls).toEqual([]);
    expect(other.value).toBe('someone else’s draft');
  });

  it('composer.insert still fills a focused Markdown box', async () => {
    const { host, box } = markdownComposer('old');
    const res = await ask(host, (ref) => ({ op: 'composer.insert', ref, text: 'new text' }));
    expect(res).toEqual({ ok: true, accepted: true });
    expect(box.value).toBe('new text');
  });

  it('composer.insert writes the Markdown box, not the hidden rich-text editor kept before it', async () => {
    // Live 2026-10-21: after "Switch to Markdown" Reddit keeps the Lexical editor (zero width) in
    // the composer, BEFORE the textarea; the big editor's Save wrote into it and the text was lost.
    const { host, box } = markdownComposer('old');
    const root = host.querySelector('shreddit-composer')!.shadowRoot!;
    const lexical = document.createElement('div');
    lexical.setAttribute('contenteditable', 'true');
    lexical.setAttribute('data-lexical-editor', 'true');
    lexical.textContent = 'old';
    root.prepend(lexical);
    const res = await ask(host, (ref) => ({ op: 'composer.insert', ref, text: 'new text' }));
    expect(res).toEqual({ ok: true, accepted: true });
    expect(box.value).toBe('new text');
    expect(lexical.textContent).toBe('old');
  });

  it('composer.insert and composer.submit refuse an element that is not a composer host', async () => {
    const div = document.createElement('div');
    const box = document.createElement('textarea');
    const submit = document.createElement('button');
    submit.type = 'submit';
    const clicked = vi.fn();
    submit.addEventListener('click', clicked);
    div.append(box, submit);
    document.body.append(div);
    expect(await ask(div, (ref) => ({ op: 'composer.insert', ref, text: 'x' }))).toEqual({
      ok: false,
      error: 'not-composer',
    });
    expect(await ask(div, (ref) => ({ op: 'composer.submit', ref }))).toEqual({
      ok: false,
      error: 'not-composer',
    });
    expect(box.value).toBe('');
    expect(clicked).not.toHaveBeenCalled();
  });

  it('composer.insert refuses text over the cap or not a string', async () => {
    const { host, box } = markdownComposer('safe');
    const huge = await ask(host, (ref) => ({
      op: 'composer.insert',
      ref,
      text: 'x'.repeat(50_000),
    }));
    expect(huge).toEqual({ ok: false, error: 'bad-request' });
    const bad = await ask(
      host,
      (ref) => ({ op: 'composer.insert', ref, text: 7 }) as unknown as BridgeRequest,
    );
    expect(bad).toEqual({ ok: false, error: 'bad-request' });
    expect(box.value).toBe('safe');
  });
});

describe('bridge composer.markdownMode', () => {
  it('treats a composer that SHOWS only a plain box as Markdown, whatever its mode attribute says', async () => {
    // Live 2026-10-21: Reddit opened a reply box in Markdown (the reader's remembered choice) while
    // shreddit-composer still said mode="richText", and there was no "Switch to Markdown" button.
    const { host, box } = markdownComposer('hello');
    const composer = host.querySelector('shreddit-composer')!;
    composer.setAttribute('mode', 'richText');
    const lexical = document.createElement('div');
    lexical.setAttribute('contenteditable', 'true');
    lexical.setAttribute('data-lexical-editor', 'true');
    composer.shadowRoot!.prepend(lexical);
    Object.defineProperty(box, 'offsetWidth', { value: 300 });
    Object.defineProperty(lexical, 'offsetWidth', { value: 0 });
    expect(await ask(host, (ref) => ({ op: 'composer.markdownMode', ref }))).toEqual({
      ok: true,
      accepted: true,
    });
    const res = await ask(host, (ref) => ({ op: 'composer.insert', ref, text: 'hello *world*' }));
    expect(res).toEqual({ ok: true, accepted: true });
    expect(box.value).toBe('hello *world*');
  });

  it('presses Reddit’s own “Switch to Markdown” button and waits for the mode', async () => {
    const { host, composer } = richComposer('text');
    const sw = composer.shadowRoot!.querySelector<HTMLElement>(
      '[aria-label="Switch to Markdown"]',
    )!;
    const bold = composer.shadowRoot!.querySelector<HTMLElement>('[aria-label="Bold"]')!;
    const boldClick = vi.fn();
    bold.addEventListener('click', boldClick);
    sw.addEventListener('click', () => composer.setAttribute('mode', 'markdown'));
    expect(await ask(host, (ref) => ({ op: 'composer.markdownMode', ref }))).toEqual({
      ok: true,
      accepted: true,
    });
    expect(boldClick).not.toHaveBeenCalled();
  });

  it('presses nothing when the composer is already in Markdown mode', async () => {
    const { host } = markdownComposer('x');
    expect(await ask(host, (ref) => ({ op: 'composer.markdownMode', ref }))).toEqual({
      ok: true,
      accepted: true,
    });
  });

  it('says not-found when there is no switch button (fail safe)', async () => {
    const { host, composer } = richComposer('x');
    composer.shadowRoot!.querySelector('[aria-label="Switch to Markdown"]')!.remove();
    expect(await ask(host, (ref) => ({ op: 'composer.markdownMode', ref }))).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('only looks inside the referenced composer', async () => {
    const other = richComposer('other');
    const otherClick = vi.fn();
    other.composer
      .shadowRoot!.querySelector('[aria-label="Switch to Markdown"]')!
      .addEventListener('click', otherClick);
    const mine = richComposer('mine');
    mine.composer.shadowRoot!.querySelector('[aria-label="Switch to Markdown"]')!.remove();
    expect(await ask(mine.host, (ref) => ({ op: 'composer.markdownMode', ref }))).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(otherClick).not.toHaveBeenCalled();
  });
});
