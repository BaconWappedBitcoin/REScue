import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeClient } from '../../src/core/bridge-client';
import {
  CHANNEL_ATTR,
  REQUEST_EVENT,
  RESPONSE_EVENT,
  type BridgeRequest,
  type BridgeResponse,
} from '../../src/core/bridge-protocol';
import bridge from '../../src/entrypoints/bridge.content';

/**
 * The MAIN-world bridge's native-control, menu, edit, partial and age-gate ops, against fixtures
 * shaped as Reddit was verified live (see C in src/contracts/reddit.ts). Its waits for lazily
 * hydrated controls run on fake timers.
 */

/** Every element pressed (the click target), in order, by its data-name. */
let clicks: string[] = [];
const named = (tag: string, name: string, attrs: Record<string, string> = {}): HTMLElement => {
  const el = document.createElement(tag);
  el.dataset.name = name;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.addEventListener('click', (e) => {
    if (e.target === el) clicks.push(name); // the element pressed, not one it bubbled to
  });
  return el;
};

/** A menu trigger that opens and closes like Reddit's (aria-expanded). */
const trigger = (attrs: Record<string, string>): HTMLElement => {
  const t = named('button', 'trigger', { 'aria-expanded': 'false', ...attrs });
  t.addEventListener('click', () =>
    t.setAttribute('aria-expanded', t.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'),
  );
  return t;
};

/** A post whose vote buttons sit in its open shadow root, with its light-DOM overflow menu. */
function post(rows: string[] = ['Follow post', 'Save', 'Hide'], pressed = 'true'): Element {
  const p = document.createElement('shreddit-post');
  p.attachShadow({ mode: 'open' }).append(
    named('button', 'upvote', { upvote: '', 'aria-pressed': pressed }),
    named('button', 'downvote', { downvote: '' }),
  );
  const menu = document.createElement('shreddit-post-overflow-menu');
  const root = menu.attachShadow({ mode: 'open' });
  root.append(trigger({ 'aria-haspopup': 'true' }));
  for (const text of rows) {
    // A post-menu row: li[role=presentation] around the div[role=menuitem] that acts.
    const li = named('li', `li:${text}`, { role: 'presentation' });
    const item = named('div', `item:${text}`, { role: 'menuitem' });
    item.textContent = text;
    li.append(item);
    root.append(li);
  }
  p.append(menu);
  document.body.append(p);
  return p;
}

/** A comment with its own action row (vote buttons in its open root) and overflow menu. */
function comment(
  opts: { voteState?: string; menuAttrs?: string[]; rows?: string[]; rowsLater?: number } = {},
  parent: Element = document.body,
): { host: Element; menu: Element } {
  const host = document.createElement('shreddit-comment');
  const row = document.createElement('shreddit-comment-action-row');
  row.setAttribute('slot', 'actionRow');
  if (opts.voteState !== undefined) row.setAttribute('vote-state', opts.voteState);
  row
    .attachShadow({ mode: 'open' })
    .append(named('button', 'c-upvote', { upvote: '', 'aria-pressed': 'false' }));
  const menu = document.createElement('shreddit-overflow-menu');
  menu.setAttribute('slot', 'overflow');
  for (const a of opts.menuAttrs ?? []) menu.setAttribute(a, '');
  const root = menu.attachShadow({ mode: 'open' });
  const t = trigger({ id: 'overflow-trigger' });
  root.append(t);
  const fill = () => {
    for (const text of opts.rows ?? []) {
      // A comment-menu row: li[role=menuitem] around the clickable div.
      const li = named('li', `li:${text}`, { role: 'menuitem' });
      const div = named('div', `div:${text}`);
      div.textContent = text;
      li.append(div);
      root.append(li);
    }
  };
  if (opts.rowsLater === undefined) fill();
  else t.addEventListener('click', () => setTimeout(fill, opts.rowsLater), { once: true });
  row.append(menu);
  host.append(row);
  parent.append(host);
  return { host, menu };
}

const start = (): void => bridge.main(undefined as never);
/** Send one request and let the bridge's waits run out on the fake clock. */
const ask = async (el: Element | null, body: (ref: string) => BridgeRequest) => {
  start();
  const client = new BridgeClient(window);
  const res = client.request(body(el ? client.ref(el) : 'r0'), 60_000);
  await vi.advanceTimersByTimeAsync(10_000);
  return res;
};

beforeEach(() => {
  clicks = [];
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('bridge native.state (read only)', () => {
  it('reports a post’s pressed state and clicks nothing', async () => {
    const p = post();
    const res = await ask(p, (ref) => ({ op: 'native.state', ref, control: 'upvote' }));
    expect(res).toEqual({ ok: true, pressed: true });
    expect(clicks).toEqual([]);
  });

  it('reports null for a control without a pressed state', async () => {
    const p = post();
    expect(await ask(p, (ref) => ({ op: 'native.state', ref, control: 'downvote' }))).toEqual({
      ok: true,
      pressed: null,
    });
  });

  it.each([
    ['UP', 1],
    ['downvoted', -1],
    ['NONE', 0],
    ['sideways', null],
  ])('reads a comment’s own row vote-state %s as %j', async (state, want) => {
    const { host } = comment({ voteState: state });
    expect(await ask(host, (ref) => ({ op: 'native.state', ref, control: 'upvote' }))).toEqual({
      ok: true,
      pressed: false,
      voteState: want,
    });
  });

  it('never takes a nested reply’s row for the parent’s', async () => {
    const parent = document.createElement('shreddit-comment');
    document.body.append(parent);
    comment({ voteState: 'UP' }, parent);
    expect(await ask(parent, (ref) => ({ op: 'native.state', ref, control: 'upvote' }))).toEqual({
      ok: false,
      error: 'not-found',
    });
  });

  it('refuses a control it does not read', async () => {
    const p = post();
    expect(await ask(p, (ref) => ({ op: 'native.state', ref, control: 'save' }))).toEqual({
      ok: false,
      error: 'unsupported',
    });
  });
});

describe('bridge menu.item / menu.state', () => {
  it('menu.item presses the inner menuitem of the matching post row', async () => {
    const p = post();
    expect(await ask(p, (ref) => ({ op: 'menu.item', ref, menu: 'post', item: 'save' }))).toEqual({
      ok: true,
      itemState: 'off',
      itemText: 'Save',
    });
    expect(clicks).toEqual(['trigger', 'item:Save']);
  });

  it('menu.state reads an applied row and closes the menu again, pressing no row', async () => {
    const p = post(['Remove from saved', 'Remove from hidden']);
    const res = await ask(p, (ref) => ({ op: 'menu.state', ref, menu: 'post', item: 'hide' }));
    expect(res).toEqual({ ok: true, itemState: 'on', itemText: 'Remove from hidden' });
    expect(clicks).toEqual(['trigger', 'trigger']);
    const t = p.querySelector('shreddit-post-overflow-menu')!.shadowRoot!.querySelector('button')!;
    expect(t.getAttribute('aria-expanded')).toBe('false');
  });

  it('fails safe when no row matches: the menu is closed and nothing else is pressed', async () => {
    const p = post(['Follow post', 'Report']);
    expect(await ask(p, (ref) => ({ op: 'menu.item', ref, menu: 'post', item: 'save' }))).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(clicks).toEqual(['trigger', 'trigger']);
  });

  it('waits for a comment menu that fills its rows in late, then presses the div', async () => {
    const { host } = comment({ rows: ['Save', 'Turn off reply notifications'], rowsLater: 1500 });
    const res = await ask(host, (ref) => ({
      op: 'menu.item',
      ref,
      menu: 'comment',
      item: 'inbox',
    }));
    expect(res).toEqual({
      ok: true,
      itemState: 'on',
      itemText: 'Turn off reply notifications',
    });
    expect(clicks).toEqual(['trigger', 'div:Turn off reply notifications']);
  });

  it('says not-found for an item with no menu', async () => {
    const div = document.createElement('div');
    document.body.append(div);
    expect(
      await ask(div, (ref) => ({ op: 'menu.state', ref, menu: 'post', item: 'save' })),
    ).toEqual({ ok: false, error: 'not-found' });
  });
});

describe('bridge native.click edit', () => {
  it('opens the comment’s own menu and presses “Edit comment”', async () => {
    const { host } = comment({ menuAttrs: ['is-comment-author'], rows: ['Save', 'Edit comment'] });
    expect(await ask(host, (ref) => ({ op: 'native.click', ref, control: 'edit' }))).toEqual({
      ok: true,
    });
    expect(clicks).toEqual(['trigger', 'div:Edit comment']);
  });

  it('answers not-editable for someone else’s comment and opens nothing', async () => {
    const { host } = comment({ rows: ['Edit comment'] });
    expect(await ask(host, (ref) => ({ op: 'native.click', ref, control: 'edit' }))).toEqual({
      ok: false,
      error: 'not-editable',
    });
    expect(clicks).toEqual([]);
  });

  it('closes the menu again when it has no Edit row', async () => {
    const { host, menu } = comment({ menuAttrs: ['editable-comment'], rows: ['Save'] });
    expect(await ask(host, (ref) => ({ op: 'native.click', ref, control: 'edit' }))).toEqual({
      ok: false,
      error: 'not-found',
    });
    expect(clicks).toEqual(['trigger', 'trigger']);
    expect(menu.shadowRoot!.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('refuses edit on anything that is not a comment', async () => {
    const p = post();
    expect(await ask(p, (ref) => ({ op: 'native.click', ref, control: 'edit' }))).toEqual({
      ok: false,
      error: 'unsupported',
    });
  });
});

describe('bridge partial.load and the age gate', () => {
  it('calls the element’s own loadContent', async () => {
    const el = document.createElement('faceplate-partial');
    const load = vi.fn();
    Object.assign(el, { loadContent: load });
    document.body.append(el);
    expect(await ask(el, (ref) => ({ op: 'partial.load', ref }))).toEqual({ ok: true });
    expect(load).toHaveBeenCalledOnce();
  });

  it('answers no-method when there is nothing to load', async () => {
    const el = document.createElement('faceplate-partial');
    document.body.append(el);
    expect(await ask(el, (ref) => ({ op: 'partial.load', ref }))).toEqual({
      ok: false,
      error: 'no-method',
    });
  });

  it('presses the “over 18” button and never the decline one', async () => {
    const gate = document.createElement('div');
    gate.className = 'configured-xpromo-modal';
    const no = named('button', 'no');
    no.textContent = 'No, I’m not over 18';
    const yes = named('button', 'yes');
    yes.textContent = 'Yes, I’m over 18';
    gate.attachShadow({ mode: 'open' }).append(no, yes);
    document.body.append(gate);
    expect(await ask(null, (ref) => ({ op: 'native.click', ref, control: 'over18' }))).toEqual({
      ok: true,
    });
    expect(clicks).toEqual(['yes']);
  });

  it('answers not-found without an age gate', async () => {
    expect(await ask(null, (ref) => ({ op: 'native.click', ref, control: 'over18' }))).toEqual({
      ok: false,
      error: 'not-found',
    });
  });
});

describe('bridge envelope', () => {
  const responses: string[] = [];
  const listen = (e: Event) => responses.push(String((e as CustomEvent).detail));
  beforeEach(() => {
    responses.length = 0;
    addEventListener(RESPONSE_EVENT, listen);
  });
  afterEach(() => removeEventListener(RESPONSE_EVENT, listen));

  const raw = async (detail: string) => {
    dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail }));
    await vi.advanceTimersByTimeAsync(10);
  };

  it('ignores a request that is not JSON or carries the wrong token', async () => {
    start();
    document.documentElement.setAttribute(CHANNEL_ATTR, 'right');
    const el = document.createElement('faceplate-partial');
    el.setAttribute('data-rescue-ref', 'r1');
    const load = vi.fn();
    Object.assign(el, { loadContent: load });
    document.body.append(el);
    await raw('{not json');
    await raw(JSON.stringify({ token: 'wrong', id: 1, body: { op: 'partial.load', ref: 'r1' } }));
    expect(load).not.toHaveBeenCalled();
    expect(responses).toEqual([]);
    // The same request with the page's token is answered.
    await raw(JSON.stringify({ token: 'right', id: 2, body: { op: 'partial.load', ref: 'r1' } }));
    expect(load).toHaveBeenCalledOnce();
    expect(responses.map((r) => JSON.parse(r) as { id: number; body: BridgeResponse })).toEqual([
      { token: 'right', id: 2, body: { ok: true } },
    ]);
  });

  it('answers a handler that throws with the error instead of going silent', async () => {
    const el = document.createElement('faceplate-partial');
    Object.assign(el, {
      loadContent: () => {
        throw new Error('boom');
      },
    });
    document.body.append(el);
    expect(await ask(el, (ref) => ({ op: 'partial.load', ref }))).toEqual({
      ok: false,
      error: 'threw: Error: boom',
    });
  });
});
