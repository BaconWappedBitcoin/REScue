import { afterEach, describe, expect, it } from 'vitest';
import { BridgeClient } from '../../src/core/bridge-client';
import { REF_ATTR } from '../../src/core/bridge-protocol';
import { INSTANCE_ATTR, takeOver } from '../../src/core/instance';
import bridge from '../../src/entrypoints/bridge.content';

/** A Markdown comment box (see composer-bridge.test.ts): something the bridge looks up by ref. */
function markdownComposer(text: string): Element {
  const host = document.createElement('comment-composer-host');
  const composer = document.createElement('shreddit-composer');
  composer.setAttribute('mode', 'markdown');
  const box = document.createElement('textarea');
  box.value = text;
  composer.attachShadow({ mode: 'open' }).append(box);
  host.append(composer);
  document.body.append(host);
  return host;
}

afterEach(() => {
  document.documentElement.removeAttribute(INSTANCE_ATTR);
  document.body.innerHTML = '';
});

describe('bridge element references', () => {
  it('never repeat across an add-on reload in an open tab', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    const first = takeOver(() => {});
    const refA = new BridgeClient(window).ref(a);
    expect(refA.startsWith(first.token)).toBe(true);
    // The add-on is reloaded: a new instance with its own client numbers its refs afresh.
    const second = takeOver(() => {});
    const refB = new BridgeClient(window).ref(b);
    expect(refB.startsWith(second.token)).toBe(true);
    expect(refB).not.toBe(refA);
  });

  it('are swept when a new instance takes over, and an old one is never reused', () => {
    const el = document.createElement('div');
    el.setAttribute(REF_ATTR, 'r1'); // left by an older REScue
    document.body.append(el);
    const mine = takeOver(() => {});
    expect(el.hasAttribute(REF_ATTR)).toBe(false);
    el.setAttribute(REF_ATTR, 'r1');
    const client = new BridgeClient(window);
    const ref = client.ref(el);
    expect(ref.startsWith(mine.token)).toBe(true);
    expect(client.ref(el)).toBe(ref);
  });

  it('are found by the MAIN world, which still refuses anything that is not a plain ref', async () => {
    bridge.main(undefined as never);
    takeOver(() => {});
    const host = markdownComposer('hello');
    const client = new BridgeClient(window);
    expect(await client.request({ op: 'composer.read', ref: client.ref(host) }, 3000)).toEqual({
      ok: true,
      text: 'hello',
      mode: 'markdown',
    });
    for (const ref of ['x"],comment-composer-host,[a="', '*', '', 'a b'])
      expect(await client.request({ op: 'composer.read', ref }, 3000)).toEqual({
        ok: false,
        error: 'not-found',
      });
  });
});
