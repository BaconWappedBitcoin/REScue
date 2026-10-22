import { afterEach, describe, expect, it, vi } from 'vitest';
import { BridgeClient } from '../../src/core/bridge-client';
import { createActionApi, hasGallery, hasVideo, type ActionTarget } from '../../src/core/actions';
import type { BridgeApi } from '../../src/core/types';
import type { BridgeRequest, BridgeResponse } from '../../src/core/bridge-protocol';
import { KeyDispatcher } from '../../src/core/keys';
import bridge from '../../src/entrypoints/bridge.content';
import { parsePost } from '../../src/model/post';
import {
  registerMediaKeys,
  setMediaStepHost,
  type MediaStepHost,
} from '../../src/modules/listings/inlineMedia/mediaKeys';
import { mediaStepHost } from '../../src/modules/listings/inlineMedia/mediaSteps';
import type { ModuleContext } from '../../src/core/types';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

// ---- the MAIN-world bridge: Reddit's own gallery arrows and mute button ------------------------

/** Every control the fixture pressed, in order, as "<post id> <aria-label>". */
let pressed: string[] = [];

/**
 * Reddit as it was verified live (2026-10-21): a `gallery-carousel` in the post's light DOM whose
 * OPEN shadow root holds the two arrow buttons, and a `shreddit-player` whose controls sit in a
 * nested open shadow root.
 */
function galleryPost(id: string): Element {
  const post = document.createElement('shreddit-post');
  post.id = id;
  const box = document.createElement('div');
  box.setAttribute('slot', 'post-media-container');
  const carousel = document.createElement('gallery-carousel');
  carousel.attachShadow({ mode: 'open' }).innerHTML =
    '<button aria-label="Previous page">‹</button><button aria-label="Next page">›</button>';
  box.append(carousel);
  post.append(box);
  document.body.append(post);
  return post;
}

function videoPost(id: string): Element {
  const post = document.createElement('shreddit-post');
  post.id = id;
  const player = document.createElement('shreddit-player');
  const controls = document.createElement('div');
  const inner = controls.attachShadow({ mode: 'open' });
  inner.innerHTML =
    '<button aria-label="Toggle playback">▶</button><button aria-label="Toggle volume">🔊</button>';
  player.attachShadow({ mode: 'open' }).append(controls);
  post.append(player);
  document.body.append(post);
  return post;
}

/** Note every control pressed inside the page's shadow roots, as "<post id>:<aria-label>". */
function watch(): void {
  pressed = [];
  for (const host of document.querySelectorAll('gallery-carousel, shreddit-player')) {
    const id = host.closest('shreddit-post')!.id;
    const roots = [
      host.shadowRoot,
      ...[...(host.shadowRoot?.querySelectorAll('*') ?? [])].map((e) => e.shadowRoot),
    ];
    for (const root of roots) {
      if (!root) continue;
      for (const b of root.querySelectorAll('button')) {
        b.addEventListener('click', () => pressed.push(`${id}:${b.getAttribute('aria-label')}`));
      }
    }
  }
}

describe('the bridge finds Reddit’s own media controls', () => {
  /** Start the MAIN-world bridge; it guards itself against a second start. */
  const start = (): void => bridge.main(undefined as never);

  const click = async (post: Element, control: 'galleryPrev' | 'galleryNext' | 'muteToggle') => {
    start();
    const client = new BridgeClient(window);
    const ref = client.ref(post);
    const res: BridgeResponse = await client.request({ op: 'native.click', ref, control }, 3000);
    return res;
  };

  it('presses the post’s own previous and next gallery arrow', async () => {
    const post = galleryPost('t3_a');
    watch();
    expect(await click(post, 'galleryPrev')).toEqual({ ok: true });
    expect(await click(post, 'galleryNext')).toEqual({ ok: true });
    expect(pressed).toEqual(['t3_a:Previous page', 't3_a:Next page']);
  });

  it('presses the mute button inside the player’s nested shadow root', async () => {
    const post = videoPost('t3_v');
    watch();
    expect(await click(post, 'muteToggle')).toEqual({ ok: true });
    expect(pressed).toEqual(['t3_v:Toggle volume']);
  });

  it('never presses another post’s gallery', async () => {
    const first = galleryPost('t3_1');
    const second = galleryPost('t3_2');
    watch();
    expect(await click(second, 'galleryNext')).toEqual({ ok: true });
    expect(pressed).toEqual(['t3_2:Next page']);
    expect(await click(first, 'galleryPrev')).toEqual({ ok: true });
    expect(pressed).toEqual(['t3_2:Next page', 't3_1:Previous page']);
  });

  it('never presses another post’s player', async () => {
    videoPost('t3_1');
    const second = videoPost('t3_2');
    watch();
    expect(await click(second, 'muteToggle')).toEqual({ ok: true });
    expect(pressed).toEqual(['t3_2:Toggle volume']);
  });

  it('answers not-found for a post with no gallery (fake timers for the hydration wait)', async () => {
    const post = document.createElement('shreddit-post');
    document.body.append(post);
    watch();
    vi.useFakeTimers();
    try {
      start();
      const client = new BridgeClient(window);
      const ref = client.ref(post);
      const pending = client.request({ op: 'native.click', ref, control: 'galleryNext' }, 30_000);
      await vi.advanceTimersByTimeAsync(1500);
      expect(await pending).toEqual({ ok: false, error: 'not-found' });
      expect(pressed).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---- ActionApi: galleryStep / toggleMute ------------------------------------------------------

function fakeBridge(o: { clickError?: string } = {}) {
  const clicks: Array<{ ref: string; control: string }> = [];
  const bridge: BridgeApi = {
    ref: (el) => el.getAttribute('data-ref') ?? 'r1',
    async request(body: BridgeRequest): Promise<BridgeResponse> {
      if (body.op !== 'native.click') return { ok: false, error: 'unsupported' };
      clicks.push({ ref: body.ref, control: body.control });
      return o.clickError ? { ok: false, error: o.clickError } : { ok: true };
    },
  };
  return { bridge, clicks };
}

const session = { signedIn: false, username: null };

describe('ActionApi.galleryStep / toggleMute', () => {
  it('presses the arrow for the direction, signed out as well (not an account action)', async () => {
    const post = galleryPost('t3_a');
    post.setAttribute('data-ref', 'r1');
    const f = fakeBridge();
    const api = createActionApi({ bridge: f.bridge, session: () => session });
    const target: ActionTarget = { id: 't3_a', source: post };
    expect(await api.galleryStep(target, 1)).toEqual({ ok: true });
    expect(await api.galleryStep(target, -1)).toEqual({ ok: true });
    expect(f.clicks).toEqual([
      { ref: 'r1', control: 'galleryNext' },
      { ref: 'r1', control: 'galleryPrev' },
    ]);
  });

  it('declines a post with no gallery without asking Reddit', async () => {
    const post = document.createElement('shreddit-post');
    document.body.append(post);
    const f = fakeBridge();
    const api = createActionApi({ bridge: f.bridge, session: () => session });
    expect(await api.galleryStep({ id: 't3_x', source: post }, 1)).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
    expect(f.clicks).toEqual([]);
  });

  it('presses the mute button of a video post, and answers not-found for a post without one', async () => {
    const post = videoPost('t3_v');
    const f = fakeBridge();
    const api = createActionApi({ bridge: f.bridge, session: () => session });
    expect(await api.toggleMute({ id: 't3_v', source: post })).toEqual({ ok: true });
    expect(f.clicks.map((c) => c.control)).toEqual(['muteToggle']);
    const plain = document.createElement('shreddit-post');
    document.body.append(plain);
    expect(await api.toggleMute({ id: 't3_p', source: plain })).toMatchObject({
      ok: false,
      reason: 'not-found',
    });
    expect(f.clicks).toHaveLength(1);
  });

  it('reports the bridge’s own failure', async () => {
    const post = videoPost('t3_v');
    const api = createActionApi({
      bridge: fakeBridge({ clickError: 'timeout' }).bridge,
      session: () => session,
    });
    expect(await api.toggleMute({ id: 't3_v', source: post })).toMatchObject({
      ok: false,
      reason: 'timeout',
    });
  });
});

describe('hasGallery / hasVideo', () => {
  it('answer for the light DOM of the post they are given, and nothing else', () => {
    const gallery = galleryPost('t3_a');
    const video = videoPost('t3_v');
    expect(hasGallery(gallery)).toBe(true);
    expect(hasVideo(gallery)).toBe(false);
    expect(hasVideo(video)).toBe(true);
    expect(hasGallery(video)).toBe(false);
    expect(hasGallery(document.body)).toBe(true); // both hosts are in the body
    expect(hasGallery(document.createElement('div'))).toBe(false);
  });
});

// ---- the keys: [ ] m ---------------------------------------------------------------------------

/** A step host that records what it was asked to do. */
function recordingSteps(there: { gallery: boolean; video: boolean }): {
  steps: MediaStepHost;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    steps: {
      hasGallery: () => there.gallery,
      hasVideo: () => there.video,
      gallery: (dir) => calls.push(`gallery${dir === 1 ? 'Next' : 'Prev'}`),
      toggleMute: () => calls.push('mute'),
    },
  };
}

describe('the gallery and mute keys', () => {
  const keys = new KeyDispatcher();

  it('are registered in the Media section with RES’s keys', () => {
    registerMediaKeys(keys);
    const byId = new Map(keys.list().map((c) => [c.id, c]));
    expect(byId.get('previousGalleryImage')).toMatchObject({ keys: ['['], section: 'Media' });
    expect(byId.get('nextGalleryImage')).toMatchObject({ keys: [']'], section: 'Media' });
    expect(byId.get('toggleMuteVideo')).toMatchObject({ keys: ['m'], section: 'Media' });
  });

  it('step the gallery and mute the video of the selected post', () => {
    const { steps, calls } = recordingSteps({ gallery: true, video: true });
    setMediaStepHost(steps);
    const press = (key: string) => {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      keys.handle(e);
      return e.defaultPrevented;
    };
    expect(press('[')).toBe(true);
    expect(press(']')).toBe(true);
    expect(press('m')).toBe(true);
    expect(calls).toEqual(['galleryPrev', 'galleryNext', 'mute']);
  });

  it('decline (and keep their normal meaning) without a gallery or a video', () => {
    const { steps, calls } = recordingSteps({ gallery: false, video: false });
    setMediaStepHost(steps);
    const press = (key: string) => {
      const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      keys.handle(e);
      return e.defaultPrevented;
    };
    expect(press('[')).toBe(false);
    expect(press(']')).toBe(false);
    expect(press('m')).toBe(false);
    expect(calls).toEqual([]);
    expect(keys.run('nextGalleryImage')).toBe(false);
    expect(keys.run('toggleMuteVideo')).toBe(false);
  });
});

// ---- the module's own wiring: the selected post, the actions and the scroll option -------------

function stepCtx(there: { gallery: boolean; video: boolean }, scroll = true) {
  const post = document.createElement('shreddit-post');
  post.id = 't3_s';
  if (there.gallery) {
    const box = document.createElement('div');
    box.setAttribute('slot', 'post-media-container');
    box.append(document.createElement('gallery-carousel'));
    post.append(box);
  }
  if (there.video) post.append(document.createElement('shreddit-player'));
  document.body.append(post);
  post.setAttribute('post-title', 'a gallery');
  post.setAttribute('permalink', '/r/pics/comments/t3_s/a_gallery/');
  const model = parsePost(post)!;
  const calls: Array<{ id: string; dir?: number }> = [];
  const shown: string[] = [];
  const ctx = {
    options: { scrollOnGalleryNavigate: scroll },
    ui: {
      selection: () => ({
        current: () => ({ kind: 'post', id: 't3_s', model, host: post }),
      }),
    },
    actions: {
      galleryStep: async (t: ActionTarget, dir: number) => {
        calls.push({ id: t.id, dir });
        return { ok: true as const };
      },
      toggleMute: async (t: ActionTarget) => {
        calls.push({ id: t.id });
        return { ok: true as const };
      },
    },
    notices: { show: (m: string) => void shown.push(m) },
  };
  return { ctx: ctx as unknown as ModuleContext, post, calls, shown };
}

describe('mediaStepHost', () => {
  it('presses the selected post’s own gallery arrow, through the actions', async () => {
    const t = stepCtx({ gallery: true, video: false });
    const steps = mediaStepHost(() => t.ctx);
    expect(steps.hasGallery()).toBe(true);
    expect(steps.hasVideo()).toBe(false);
    steps.gallery(1);
    steps.gallery(-1);
    await vi.waitFor(() => expect(t.calls).toHaveLength(2));
    expect(t.calls).toEqual([
      { id: 't3_s', dir: 1 },
      { id: 't3_s', dir: -1 },
    ]);
  });

  it('mutes the selected post’s video', async () => {
    const t = stepCtx({ gallery: false, video: true });
    const steps = mediaStepHost(() => t.ctx);
    expect(steps.hasGallery()).toBe(false);
    expect(steps.hasVideo()).toBe(true);
    steps.toggleMute();
    await vi.waitFor(() => expect(t.calls).toEqual([{ id: 't3_s' }]));
  });

  it('does nothing at all for a post with neither', async () => {
    const t = stepCtx({ gallery: false, video: false });
    const steps = mediaStepHost(() => t.ctx);
    steps.gallery(1);
    steps.toggleMute();
    await Promise.resolve();
    expect(t.calls).toEqual([]);
  });

  it('scrolls the gallery into view after a step, clear of Reddit’s sticky header, unless off', async () => {
    const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const on = stepCtx({ gallery: true, video: false }, true);
    const gallery = on.post.querySelector('gallery-carousel')!;
    // The gallery's top is at y=10: under the header, so the page scrolls it down to y=72.
    vi.spyOn(gallery, 'getBoundingClientRect').mockReturnValue({ top: 10, bottom: 300 } as DOMRect);
    mediaStepHost(() => on.ctx).gallery(1);
    await vi.waitFor(() =>
      expect(scroll).toHaveBeenCalledWith({ top: 10 - 72, behavior: 'instant' }),
    );

    scroll.mockClear();
    const off = stepCtx({ gallery: true, video: false }, false);
    vi.spyOn(off.post.querySelector('gallery-carousel')!, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 300,
    } as DOMRect);
    mediaStepHost(() => off.ctx).gallery(1);
    await vi.waitFor(() => expect(off.calls).toHaveLength(1));
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it('follows the module’s live context: a settings change takes effect, and off means no-op', async () => {
    const on = stepCtx({ gallery: true, video: false }, true);
    const off = stepCtx({ gallery: true, video: false }, false);
    let live: ModuleContext | null = on.ctx;
    const steps = mediaStepHost(() => live);
    const quiet = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    live = off.ctx; // the reader turned scrollOnGalleryNavigate off
    steps.gallery(1);
    await vi.waitFor(() => expect(off.calls).toHaveLength(1));
    expect(quiet).not.toHaveBeenCalled();
    live = null; // the module was switched off
    expect(steps.hasGallery()).toBe(false);
    steps.gallery(1);
    steps.toggleMute();
    await new Promise((r) => setTimeout(r, 20));
    expect(off.calls).toHaveLength(1);
    expect(on.calls).toHaveLength(0);
  });

  it('says so when Reddit’s control is not where the contracts say it is', async () => {
    const t = stepCtx({ gallery: true, video: false });
    const ctx = {
      ...t.ctx,
      actions: { galleryStep: async () => ({ ok: false as const, reason: 'not-found' as const }) },
    } as unknown as ModuleContext;
    mediaStepHost(() => ctx).gallery(1);
    await vi.waitFor(() => expect(t.shown).toHaveLength(1));
    expect(t.shown[0]).toContain('gallery arrows');
  });
});
