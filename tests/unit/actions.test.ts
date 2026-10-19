import { describe, expect, it } from 'vitest';
import { createActionApi, type ActionTarget } from '../../src/core/actions';
import type { BridgeRequest, BridgeResponse } from '../../src/core/bridge-protocol';
import type { BridgeApi } from '../../src/core/types';

/**
 * A fake of Reddit's vote buttons behind the bridge: `state` is what aria-pressed reads back,
 * `confirmAfter` how many state reads pass before a click shows up (lazy hydration / network),
 * `ignoreClicks` simulates Reddit rejecting the vote, `pressedAttr: false` a control with no state.
 */
function fakeBridge(opts: {
  state?: -1 | 0 | 1;
  confirmAfter?: number;
  ignoreClicks?: boolean;
  pressedAttr?: boolean;
  clickError?: string;
}) {
  let state = opts.state ?? 0;
  let pending: { to: -1 | 0 | 1; reads: number } | null = null;
  const clicks: string[] = [];
  const bridge: BridgeApi = {
    ref: () => 'r1',
    async request(body: BridgeRequest): Promise<BridgeResponse> {
      if (body.op === 'native.click') {
        if (opts.clickError) return { ok: false, error: opts.clickError };
        clicks.push(body.control);
        if (opts.ignoreClicks) return { ok: true };
        const want = body.control === 'upvote' ? (state === 1 ? 0 : 1) : state === -1 ? 0 : -1;
        pending = { to: want, reads: 0 };
        return { ok: true };
      }
      if (body.op === 'native.state') {
        if (pending && ++pending.reads > (opts.confirmAfter ?? 0) * 2) {
          state = pending.to;
          pending = null;
        }
        if (opts.pressedAttr === false) return { ok: true, pressed: null };
        const pressed = body.control === 'upvote' ? state === 1 : state === -1;
        return { ok: true, pressed };
      }
      return { ok: false, error: 'unsupported' };
    },
  };
  return { bridge, clicks, state: () => state };
}

const target: ActionTarget = { id: 't3_x', source: document.createElement('div') };
const signedIn = () => ({ signedIn: true, username: 'me' });
const signedOut = () => ({ signedIn: false, username: null });
const fast = { sleep: () => Promise.resolve(), pollMs: 10, confirmMs: 100 };

describe('ActionApi.vote', () => {
  it('signed out: reports signed-out and presses nothing', async () => {
    const f = fakeBridge({});
    const api = createActionApi({ bridge: f.bridge, session: signedOut, ...fast });
    expect(await api.vote(target, 1)).toEqual({ ok: false, reason: 'signed-out' });
    expect(f.clicks).toEqual([]);
  });

  it('is ok only after Reddit’s state reads back as requested', async () => {
    const f = fakeBridge({ confirmAfter: 3 });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.vote(target, 1)).toEqual({ ok: true });
    expect(f.clicks).toEqual(['upvote']);
    expect(f.state()).toBe(1);
  });

  it('times out (not ok) when Reddit never confirms', async () => {
    const f = fakeBridge({ ignoreClicks: true });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    const r = await api.vote(target, 1);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: 'timeout' });
  });

  it('does not press anything when the state cannot be read', async () => {
    const f = fakeBridge({ pressedAttr: false });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.vote(target, 1)).toMatchObject({ ok: false, reason: 'not-found' });
    expect(f.clicks).toEqual([]);
  });

  it('already in the requested state: ok without a click', async () => {
    const f = fakeBridge({ state: 1 });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.vote(target, 1)).toEqual({ ok: true });
    expect(f.clicks).toEqual([]);
  });

  it('clearing a vote presses the button that is on', async () => {
    const up = fakeBridge({ state: 1 });
    await createActionApi({ bridge: up.bridge, session: signedIn, ...fast }).vote(target, 0);
    expect(up.clicks).toEqual(['upvote']);
    expect(up.state()).toBe(0);
    const down = fakeBridge({ state: -1 });
    await createActionApi({ bridge: down.bridge, session: signedIn, ...fast }).vote(target, 0);
    expect(down.clicks).toEqual(['downvote']);
    expect(down.state()).toBe(0);
  });

  it('switching from up to down presses downvote once and confirms -1', async () => {
    const f = fakeBridge({ state: 1, confirmAfter: 1 });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.vote(target, -1)).toEqual({ ok: true });
    expect(f.clicks).toEqual(['downvote']);
  });

  it('a click the bridge cannot perform is not ok', async () => {
    const f = fakeBridge({ clickError: 'not-found' });
    const api = createActionApi({ bridge: f.bridge, session: signedIn, ...fast });
    expect(await api.vote(target, 1)).toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('refuses a second vote on the same item while one is in flight', async () => {
    const f = fakeBridge({ confirmAfter: 2 });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const api = createActionApi({
      bridge: f.bridge,
      session: signedIn,
      pollMs: 10,
      confirmMs: 100,
      sleep: () => gate,
    });
    const first = api.vote(target, 1);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(await api.vote(target, 1)).toEqual({ ok: false, reason: 'rejected', detail: 'busy' });
    release();
    expect((await first).ok).toBe(true);
  });
});

describe('ActionApi.voteState', () => {
  it('reads up / none / down, and null when unreadable', async () => {
    for (const s of [1, 0, -1] as const) {
      const api = createActionApi({ bridge: fakeBridge({ state: s }).bridge, session: signedIn });
      expect(await api.voteState(target)).toBe(s);
    }
    const blind = createActionApi({
      bridge: fakeBridge({ pressedAttr: false }).bridge,
      session: signedIn,
    });
    expect(await blind.voteState(target)).toBeNull();
  });
});

describe('save / hide / reply', () => {
  it('are honestly not available yet when signed in, and signed-out when not', async () => {
    const f = fakeBridge({});
    const inApi = createActionApi({ bridge: f.bridge, session: signedIn });
    for (const r of [
      await inApi.save(target, true),
      await inApi.hide(target, true),
      await inApi.reply(target, 'x'),
    ]) {
      expect(r).toMatchObject({ ok: false, reason: 'not-found' });
    }
    const outApi = createActionApi({ bridge: f.bridge, session: signedOut });
    expect(await outApi.save(target, true)).toEqual({ ok: false, reason: 'signed-out' });
    expect(f.clicks).toEqual([]);
  });
});
