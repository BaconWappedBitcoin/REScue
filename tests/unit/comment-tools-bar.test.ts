import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeRequest, BridgeResponse } from '../../src/core/bridge-protocol';
import type { OptionValue } from '../../src/core/types';
import { commentTools } from '../../src/modules/comments/commentTools';
import { EDITOR_ID } from '../../src/modules/comments/commentTools/bigEditor';
import { bootModules } from './module-harness';

const route = { kind: 'thread', path: '/r/Layoffs/comments/x/y', subreddit: 'Layoffs' };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A comment by `author` whose Reply opened Reddit's composer host (light DOM, open shadow root). */
function commentWithComposer(author = 'alice'): { comment: Element; host: Element } {
  const comment = document.createElement('shreddit-comment');
  comment.setAttribute('author', author);
  comment.setAttribute('thingid', `t1_${author}`);
  const row = document.createElement('div');
  const host = document.createElement('comment-composer-host');
  const composer = document.createElement('shreddit-composer');
  const editor = document.createElement('div');
  editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('data-lexical-editor', 'true');
  composer.attachShadow({ mode: 'open' }).append(editor);
  host.append(composer);
  row.append(host);
  comment.append(row);
  document.body.append(comment);
  return { comment, host };
}

/** A stand-in bridge: records every request and answers from `answer`. */
function stubBridge(answer: (req: BridgeRequest) => BridgeResponse = () => ({ ok: true })) {
  const requests: BridgeRequest[] = [];
  let seq = 0;
  return {
    requests,
    bridge: {
      ref: (el: Element) => {
        if (!el.getAttribute('data-rescue-ref')) el.setAttribute('data-rescue-ref', `r${++seq}`);
        return el.getAttribute('data-rescue-ref')!;
      },
      request: async (req: unknown) => {
        requests.push(req as BridgeRequest);
        return answer(req as BridgeRequest);
      },
    },
  };
}

const boot = (
  options: Record<string, OptionValue> = {},
  bridge = stubBridge().bridge,
  username: string | null = 'me',
) =>
  bootModules([commentTools], {
    route,
    username,
    bridge,
    options: { commentTools: options },
  });

const bars = () => [...document.querySelectorAll('.rescue-ct-bar')];

afterEach(() => {
  commentTools.dispose?.();
  document.body.innerHTML = '';
  document.querySelectorAll('.rescue-ct-macros').forEach((n) => n.remove());
});

describe('comment tools bar', () => {
  it('puts exactly one bar directly before each composer, never inside it', async () => {
    const { host } = commentWithComposer();
    await boot();
    expect(bars()).toHaveLength(1);
    expect(host.previousElementSibling).toBe(bars()[0]);
    expect(host.querySelector('.rescue-ct-bar')).toBeNull();

    // Further page changes (and the bar's own insertion) never add a second bar.
    document.body.append(document.createElement('div'));
    await wait(150);
    document.body.append(document.createElement('div'));
    await wait(150);
    expect(bars()).toHaveLength(1);

    const second = commentWithComposer('bob').host;
    await wait(150);
    expect(bars()).toHaveLength(2);
    expect(second.previousElementSibling?.classList.contains('rescue-ct-bar')).toBe(true);
  });

  it('drops the bar when Reddit removes its composer', async () => {
    const { host } = commentWithComposer();
    await boot();
    host.remove();
    await wait(150);
    expect(bars()).toHaveLength(0);
  });

  /** Wrap the host in `tag` (live: `shreddit-async-loader`), optionally with an open shadow root. */
  const wrapHost = (host: Element, tag: string, shadowHtml: string | null, slot?: string) => {
    const wrap = document.createElement(tag);
    if (slot) wrap.setAttribute('slot', slot);
    if (shadowHtml !== null) wrap.attachShadow({ mode: 'open' }).innerHTML = shadowHtml;
    host.replaceWith(wrap);
    wrap.append(host);
    return wrap;
  };

  it('goes before a wrapper whose shadow root has no default slot (live async loader)', async () => {
    const { comment, host } = commentWithComposer();
    const loader = wrapHost(host, 'shreddit-async-loader', '<div>loaded</div>', 'composer');
    await boot();
    expect(bars()).toHaveLength(1);
    const bar = bars()[0]!;
    expect(loader.previousElementSibling).toBe(bar); // not beside the host, where it is never drawn
    expect(host.previousElementSibling).toBeNull();
    expect(bar.getAttribute('slot')).toBe('composer'); // same slot of the comment as the loader
    expect(comment.contains(bar)).toBe(true);

    document.body.append(document.createElement('div'));
    await wait(150);
    expect(bars()).toHaveLength(1); // still one bar per composer

    host.remove(); // the composer closes, the loader stays
    await wait(150);
    expect(bars()).toHaveLength(0);
  });

  it('stays beside the host when the wrapper shows its children, and is removed on dispose', async () => {
    const { host } = commentWithComposer();
    wrapHost(host, 'shreddit-async-loader', '<slot></slot>');
    await boot();
    expect(host.previousElementSibling).toBe(bars()[0]);
    commentTools.dispose?.();
    expect(bars()).toHaveLength(0);
  });

  it('climbs over a wrapper it cannot see into only while the bar is not drawn', async () => {
    const { host } = commentWithComposer();
    const wrap = wrapHost(host, 'x-closed-wrap', null); // closed root: shadowRoot is null
    await boot(); // happy-dom draws nothing (0×0), as Reddit's closed wrapper would
    expect(wrap.previousElementSibling).toBe(bars()[0]);
    commentTools.dispose?.();

    const size = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 300, height: 20 } as DOMRect);
    await boot();
    expect(host.previousElementSibling).toBe(bars()[0]); // drawn beside the host: stays there
    size.mockRestore();
  });

  it('never climbs out of the comment', async () => {
    const comment = document.createElement('shreddit-comment');
    comment.attachShadow({ mode: 'open' }).innerHTML = '<slot name="other"></slot>';
    const host = document.createElement('comment-composer-host');
    comment.append(host);
    document.body.append(comment);
    await boot();
    expect(host.previousElementSibling).toBe(bars()[0]);
  });

  it('shows “commenting as u/name” only when signed in and switched on', async () => {
    commentWithComposer();
    await boot();
    expect(document.querySelector('.rescue-ct-as')?.textContent).toBe('commenting as u/me');
    commentTools.dispose?.();

    await boot({}, stubBridge().bridge, null);
    expect(document.querySelector('.rescue-ct-as')).toBeNull();
    commentTools.dispose?.();

    await boot({ commentingAs: false });
    expect(document.querySelector('.rescue-ct-as')).toBeNull();
  });

  it('leaves out the macros and big editor buttons when they are switched off', async () => {
    commentWithComposer();
    await boot({ macroButtons: false, enableBigEditor: false });
    expect(document.querySelector('.rescue-ct-macros-btn')).toBeNull();
    expect(document.querySelector('.rescue-ct-big')).toBeNull();
  });
});

describe('comment macros', () => {
  const macros = [
    { label: 'Thanks', text: 'Thanks u/{{author}} from r/{{subreddit}} {{nope}}' },
    { label: '', text: 'Plain' },
    { label: 'Empty', text: '   ' },
  ];
  const open = () => document.querySelector<HTMLElement>('.rescue-ct-macros-btn')!.click();
  const items = () => [...document.querySelectorAll<HTMLElement>('.rescue-ct-macro')];

  it('lists the macros that have text and inserts one at the caret through the bridge', async () => {
    const { host } = commentWithComposer('alice');
    const stub = stubBridge(() => ({ ok: true, accepted: true }));
    await boot({ macros }, stub.bridge);
    open();
    expect(items().map((i) => i.textContent)).toEqual(['Thanks', 'Plain']);
    items()[0]!.click();
    await wait(0);
    expect(stub.requests).toEqual([
      {
        op: 'composer.insertAt',
        ref: host.getAttribute('data-rescue-ref'),
        text: 'Thanks u/alice from r/Layoffs {{nope}}',
      },
    ]);
    expect(document.querySelector('.rescue-ct-macros')).toBeNull();
  });

  it('keeps the list open when asked, and inserts the raw text without placeholders', async () => {
    commentWithComposer('alice');
    const stub = stubBridge(() => ({ ok: true, accepted: true }));
    await boot({ macros, keepMacroListOpen: true, macroPlaceholders: false }, stub.bridge);
    open();
    items()[0]!.click();
    await wait(0);
    expect((stub.requests[0] as { text: string }).text).toBe(macros[0]!.text);
    expect(document.querySelector('.rescue-ct-macros')).not.toBeNull();
  });

  it('says so when Reddit’s box does not take the text', async () => {
    commentWithComposer();
    const stub = stubBridge(() => ({ ok: true, accepted: false }));
    const m = await boot({ macros }, stub.bridge);
    open();
    items()[1]!.click();
    await wait(0);
    expect(m.notices.map((n) => n.message)).toEqual([
      'Comment tools: Reddit’s comment box did not take the macro text.',
    ]);
  });

  it('says the box did not take the focus when the bridge answers not-focused', async () => {
    commentWithComposer();
    const stub = stubBridge(() => ({ ok: false, error: 'not-focused' }));
    const m = await boot({ macros }, stub.bridge);
    open();
    items()[1]!.click();
    await wait(0);
    expect(m.notices.map((n) => n.message)).toEqual([
      'Comment tools: Reddit’s comment box did not take the macro text. Reddit’s comment box did not take the focus, so nothing was typed (no other box was changed).',
    ]);
  });

  it('toggles the list with its button and offers a hint when there are no macros', async () => {
    commentWithComposer();
    await boot();
    open();
    expect(document.querySelector('.rescue-ct-empty')).not.toBeNull();
    open();
    expect(document.querySelector('.rescue-ct-macros')).toBeNull();
  });
});

describe('big editor', () => {
  /** A bridge whose composer holds `text`; the Markdown switch and the write can be made to fail. */
  const composerBridge = (text: string, opts: { switchOk?: boolean; readOk?: boolean } = {}) =>
    stubBridge((req) => {
      if (req.op === 'composer.read')
        return opts.readOk === false ? { ok: false, error: 'not-found' } : { ok: true, text };
      if (req.op === 'composer.markdownMode')
        return opts.switchOk === false
          ? { ok: false, error: 'not-found' }
          : { ok: true, accepted: true };
      if (req.op === 'composer.insert') return { ok: true, accepted: true };
      return { ok: false };
    });
  const panel = () => document.getElementById(EDITOR_ID);
  const textBox = () => panel()!.querySelector<HTMLTextAreaElement>('textarea')!;
  const openFromBar = async () => {
    document.querySelector<HTMLElement>('.rescue-ct-big')!.click();
    await wait(0);
  };

  it('loads the composer’s text, previews it live, and Save writes it back in Markdown mode', async () => {
    const { host } = commentWithComposer();
    const stub = composerBridge('**old**');
    await boot({}, stub.bridge);
    await openFromBar();
    expect(textBox().value).toBe('**old**');
    const preview = panel()!.querySelector('.rescue-big-editor-preview')!;
    expect(preview.querySelector('strong')?.textContent).toBe('old');

    textBox().value = 'new *text*';
    textBox().dispatchEvent(new Event('input'));
    await wait(120); // the preview follows once typing pauses (100 ms)
    expect(preview.querySelector('em')?.textContent).toBe('text');

    panel()!.querySelector<HTMLElement>('.rescue-big-editor-save')!.click();
    await wait(0);
    const ref = host.getAttribute('data-rescue-ref');
    expect(stub.requests).toEqual([
      { op: 'composer.read', ref },
      { op: 'composer.markdownMode', ref },
      { op: 'composer.insert', ref, text: 'new *text*' },
    ]);
    expect(panel()).toBeNull();
  });

  it('Cancel and Escape close without writing anything', async () => {
    commentWithComposer();
    const stub = composerBridge('keep');
    await boot({}, stub.bridge);
    await openFromBar();
    panel()!.querySelector<HTMLElement>('.rescue-big-editor-cancel')!.click();
    expect(panel()).toBeNull();

    await openFromBar();
    textBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel()).toBeNull();
    expect(stub.requests.map((r) => r.op)).toEqual(['composer.read', 'composer.read']);
  });

  it('writes nothing when Reddit’s box cannot be switched to Markdown', async () => {
    commentWithComposer();
    const stub = composerBridge('x', { switchOk: false });
    const m = await boot({}, stub.bridge);
    await openFromBar();
    panel()!.querySelector<HTMLElement>('.rescue-big-editor-save')!.click();
    await wait(0);
    expect(stub.requests.map((r) => r.op)).toEqual(['composer.read', 'composer.markdownMode']);
    expect(panel()).not.toBeNull();
    expect(m.notices[0]?.message).toMatch(/could not switch .* Markdown, so nothing was written/);
  });

  it('does not open when the composer’s text cannot be read', async () => {
    commentWithComposer();
    const m = await boot({}, composerBridge('x', { readOk: false }).bridge);
    await openFromBar();
    expect(panel()).toBeNull();
    expect(m.notices).toHaveLength(1);
  });

  it('keeps Tab inside while open and gives the focus back to its button on close', async () => {
    commentWithComposer();
    await boot({}, composerBridge('x').bridge);
    const big = document.querySelector<HTMLElement>('.rescue-ct-big')!;
    await openFromBar();
    const save = panel()!.querySelector<HTMLElement>('.rescue-big-editor-save')!;
    expect(document.activeElement).toBe(textBox());
    const tab = (shiftKey = false) => {
      const e = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      document.activeElement!.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(tab(true)).toBe(true); // Shift+Tab from the text goes round to Save
    expect(document.activeElement).toBe(save);
    expect(tab()).toBe(true); // Tab from Save goes round to the text, never to the page
    expect(document.activeElement).toBe(textBox());
    textBox().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(big);
  });

  it('puts the preview first when the layout is swapped', async () => {
    commentWithComposer();
    await boot({ swapBigEditorLayout: true }, composerBridge('x').bridge);
    await openFromBar();
    const panes = panel()!.querySelector('.rescue-big-editor-panes')!;
    expect(panes.firstElementChild?.classList.contains('rescue-big-editor-preview')).toBe(true);
  });

  it('opens on Ctrl+E typed inside Reddit’s comment box, and lists the key', async () => {
    const { host } = commentWithComposer();
    const m = await boot({}, composerBridge('typed').bridge);
    expect(m.keys.list().find((k) => k.id === 'openBigEditor')?.keys).toEqual(['ctrl+e']);
    const editor = host.querySelector('shreddit-composer')!.shadowRoot!.firstElementChild!;
    const e = new KeyboardEvent('keydown', {
      key: 'e',
      ctrlKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    editor.dispatchEvent(e);
    await wait(0);
    expect(e.defaultPrevented).toBe(true);
    expect(textBox().value).toBe('typed');
  });

  it('ignores Ctrl+E typed outside any comment box', async () => {
    commentWithComposer();
    await boot({}, composerBridge('x').bridge);
    const input = document.createElement('input');
    document.body.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', ctrlKey: true, bubbles: true }));
    await wait(0);
    expect(panel()).toBeNull();
  });
});
