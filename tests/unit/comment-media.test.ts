// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  inlineMediaPostOption,
  MIGRATIONS,
  runMigrations,
} from '../../src/core/storage/migrations';
import {
  CM_ATTR,
  commentMediaCss,
  figuresOf,
  kindOfFigure,
} from '../../src/model/comment-media';
import { CommentMedia } from '../../src/modules/listings/inlineMedia/commentMedia';
import { inlineMedia } from '../../src/modules/listings/inlineMedia';
import {
  commentMediaHidden,
  policyKey,
  type Policy,
} from '../../src/modules/listings/inlineMedia/policy';
import {
  COMMENT_GIF_FIGURE,
  COMMENT_IMAGE_FIGURE,
  COMMENT_VIDEO_FIGURE,
} from '../fixtures/pages';

const comment = (id: string, body: string, nested = ''): string =>
  `<shreddit-comment thingid="${id}" depth="0"><details open><summary>meta</summary><div slot="comment"><div class="py-0"><p>text</p>${body}</div></div>${nested}</details></shreddit-comment>`;

const hostOf = (id: string): Element => document.querySelector(`shreddit-comment[thingid="${id}"]`)!;
const wordsOf = (id: string): string[] =>
  [...hostOf(id).querySelectorAll('.rescue-cm-toggle')].map((b) => b.textContent ?? '');
/** Let the MutationObserver deliver. */
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('migration: Hide inline media moves to comments, posts get their own option', () => {
  const settings = (options: Record<string, unknown>, version = 2) => ({
    schema: { version },
    settings: { modules: { inlineMedia: { enabled: true, options } } },
  });
  const optionsOf = (d: Record<string, unknown>) =>
    (d.settings as { modules: { inlineMedia: { options: Record<string, unknown> } } }).modules
      .inlineMedia.options;

  it('keeps the post hiding of anyone who had the switch on (and the switch on)', () => {
    const r = runMigrations(settings({ collapseMedia: true, scope: 'both' }), MIGRATIONS);
    expect(r.ok).toBe(true);
    expect(optionsOf(r.data)).toEqual({
      collapseMedia: true,
      collapsePostMedia: true,
      scope: 'both',
    });
    expect((r.data.schema as { version: number }).version).toBe(3);
  });

  it('leaves everyone else alone', () => {
    for (const options of [{}, { collapseMedia: false, scope: 'both' }, { onlyTypes: 'video' }]) {
      const r = runMigrations(settings(options), MIGRATIONS);
      expect(optionsOf(r.data)).toEqual(options);
    }
    expect(inlineMediaPostOption({ x: 1 })).toEqual({ x: 1 });
    expect(inlineMediaPostOption({ settings: { modules: {} } })).toEqual({ settings: { modules: {} } });
  });

  it('never overrides a value that is already there, and runs on a copy', () => {
    const original = settings({ collapseMedia: true, collapsePostMedia: false });
    const r = runMigrations(original, MIGRATIONS);
    expect(optionsOf(r.data).collapsePostMedia).toBe(false);
    const fresh = settings({ collapseMedia: true });
    const out = runMigrations(fresh, MIGRATIONS);
    expect(optionsOf(fresh).collapsePostMedia).toBeUndefined();
    expect(optionsOf(out.data).collapsePostMedia).toBe(true);
  });

  it('chains after the earlier migration from schema version 1', () => {
    const r = runMigrations(settings({ collapseMedia: true }, 1), MIGRATIONS);
    expect(optionsOf(r.data).collapsePostMedia).toBe(true);
  });
});

describe('policy for comment media', () => {
  const subs = new Map([
    ['layoffs', 'always show' as const],
    ['pics', 'always collapse' as const],
  ]);

  it('follows the switch, and a subreddit row decides for its own comments', () => {
    expect(commentMediaHidden(false, subs, undefined)).toBe(false);
    expect(commentMediaHidden(true, subs, undefined)).toBe(true);
    expect(commentMediaHidden(true, subs, 'Layoffs')).toBe(false);
    expect(commentMediaHidden(false, subs, 'r/pics')).toBe(true);
    expect(commentMediaHidden(true, subs, 'other')).toBe(true);
  });

  it('is part of the key that resets earlier choices', () => {
    const p: Policy = { collapseMedia: false, scope: 'listings', onlyTypes: 'all', subs: new Map() };
    expect(policyKey({ ...p, hideCommentMedia: true })).not.toBe(policyKey(p));
  });

  it('declares the new option off by default and the switch off by default', () => {
    expect(inlineMedia.options.collapsePostMedia).toMatchObject({ default: false });
    expect(inlineMedia.options.collapseMedia).toMatchObject({ default: false });
    expect(inlineMedia.options.collapsePostMedia.dependsOn).toBe('collapseMedia');
  });
});

describe('comment media in the model', () => {
  it('hides every figure unless shown while active, only chosen ones otherwise', () => {
    expect(commentMediaCss(true)).toContain(`:not([${CM_ATTR}="shown"])`);
    expect(commentMediaCss(true)).toContain(`[${CM_ATTR}="hidden"]`);
    expect(commentMediaCss(false)).not.toContain(':not(');
    expect(commentMediaCss(false)).toContain(`[${CM_ATTR}="hidden"]`);
  });

  it('names the type of a figure and leaves replies’ figures to the replies', () => {
    document.body.innerHTML = comment(
      't1_a',
      COMMENT_IMAGE_FIGURE + COMMENT_GIF_FIGURE + COMMENT_VIDEO_FIGURE,
      comment('t1_b', COMMENT_IMAGE_FIGURE),
    );
    const figs = figuresOf(hostOf('t1_a'));
    expect(figs).toHaveLength(3);
    expect(figs.map(kindOfFigure)).toEqual(['image', 'GIF', 'video']);
    expect(figuresOf(hostOf('t1_b'))).toHaveLength(1);
    expect(kindOfFigure(document.createElement('figure'))).toBe('media');
  });
});

describe('CommentMedia', () => {
  const onShown = vi.fn();
  let cm: CommentMedia;
  beforeEach(() => {
    onShown.mockClear();
    cm = new CommentMedia();
    document.body.innerHTML =
      comment('t1_a', COMMENT_IMAGE_FIGURE + COMMENT_VIDEO_FIGURE, comment('t1_n', COMMENT_GIF_FIGURE)) +
      comment('t1_plain', '');
    cm.start(onShown);
  });

  it('adds nothing while the switch is off', () => {
    cm.setActive(false);
    expect(document.querySelectorAll('.rescue-cm-toggle')).toHaveLength(0);
    expect(document.querySelectorAll(`[${CM_ATTR}]`)).toHaveLength(0);
  });

  it('hides each figure with a word naming it, and the word toggles that figure only', () => {
    cm.setActive(true);
    expect(wordsOf('t1_a').slice(0, 2)).toEqual(['show image', 'show video']);
    expect(wordsOf('t1_plain')).toEqual([]);
    const [img, vid] = figuresOf(hostOf('t1_a'));
    expect(img!.getAttribute(CM_ATTR)).toBe('hidden');
    const word = img!.previousElementSibling as HTMLButtonElement;
    expect(word.title).toMatch(/^REScue: show this comment's image/);
    word.click();
    expect(img!.getAttribute(CM_ATTR)).toBe('shown');
    expect(vid!.getAttribute(CM_ATTR)).toBe('hidden');
    expect(word.textContent).toBe('hide image');
    expect(word.getAttribute('aria-expanded')).toBe('true');
    expect(onShown).toHaveBeenCalledTimes(1);
    word.click();
    expect(img!.getAttribute(CM_ATTR)).toBe('hidden');
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it('pauses a player when it is put away', () => {
    const video = hostOf('t1_a').querySelector('video')!;
    const pause = vi.fn();
    video.pause = pause;
    cm.setActive(true);
    expect(pause).toHaveBeenCalled();
    pause.mockClear();
    const [, vid] = figuresOf(hostOf('t1_a'));
    (vid!.previousElementSibling as HTMLButtonElement).click(); // shown: not paused again
    expect(pause).not.toHaveBeenCalled();
    (vid!.previousElementSibling as HTMLButtonElement).click(); // put away
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('hides comments that arrive later and bodies drawn again, keeping what you chose', async () => {
    cm.setActive(true);
    const [img] = figuresOf(hostOf('t1_a'));
    (img!.previousElementSibling as HTMLButtonElement).click(); // you showed it
    document.body.insertAdjacentHTML('beforeend', comment('t1_late', COMMENT_VIDEO_FIGURE));
    await tick();
    expect(wordsOf('t1_late')).toEqual(['show video']);
    expect(figuresOf(hostOf('t1_late'))[0]!.getAttribute(CM_ATTR)).toBe('hidden');
    // Reddit draws the first comment's body again: new nodes, no buttons of ours.
    const body = hostOf('t1_a').querySelector('[slot="comment"]')!;
    body.innerHTML = `<div class="py-0"><p>text</p>${COMMENT_IMAGE_FIGURE}${COMMENT_VIDEO_FIGURE}</div>`;
    await tick();
    const [img2, vid2] = figuresOf(hostOf('t1_a'));
    expect(img2).not.toBe(img);
    expect(img2!.getAttribute(CM_ATTR)).toBe('shown');
    expect(vid2!.getAttribute(CM_ATTR)).toBe('hidden');
    expect(hostOf('t1_a').querySelectorAll(':scope > details > [slot="comment"] .rescue-cm-toggle')).toHaveLength(2);
  });

  it('puts a missing word back and drops a copy that has no handler', async () => {
    cm.setActive(true);
    const [img] = figuresOf(hostOf('t1_a'));
    img!.previousElementSibling!.remove();
    // Reddit moves nothing back, but a later pass over the figure restores the way back.
    document.body.insertAdjacentHTML('beforeend', comment('t1_x', ''));
    hostOf('t1_x').querySelector('[slot="comment"]')!.append(img!.cloneNode(true));
    await tick();
    expect(wordsOf('t1_x')).toEqual(['show image']);
  });

  it('X and Shift+X: toggle one comment’s media, then every comment’s', () => {
    cm.setActive(true);
    expect(cm.hasMedia(hostOf('t1_a'))).toBe(true);
    expect(cm.hasMedia(hostOf('t1_plain'))).toBe(false);
    expect(cm.toggleComment(hostOf('t1_plain'))).toBe(false);
    cm.toggleComment(hostOf('t1_a')); // some hidden: show them all
    expect(figuresOf(hostOf('t1_a')).map((f) => f.getAttribute(CM_ATTR))).toEqual(['shown', 'shown']);
    expect(figuresOf(hostOf('t1_n'))[0]!.getAttribute(CM_ATTR)).toBe('hidden');
    expect(cm.anyHidden()).toBe(true);
    cm.setEvery(true);
    expect(cm.anyHidden()).toBe(false);
    cm.toggleComment(hostOf('t1_a')); // none hidden: hide them
    expect(figuresOf(hostOf('t1_a')).map((f) => f.getAttribute(CM_ATTR))).toEqual(['hidden', 'hidden']);
    cm.setEvery(false);
    expect(cm.hasAny()).toBe(true);
    expect(cm.anyHidden()).toBe(true);
  });

  it('can put media away by hand while the switch is off, and a reset forgets that', () => {
    cm.setActive(false);
    cm.setEvery(false);
    expect(wordsOf('t1_a').slice(0, 2)).toEqual(['show image', 'show video']);
    cm.reset();
    cm.setActive(false);
    expect(document.querySelectorAll('.rescue-cm-toggle')).toHaveLength(0);
    expect(document.querySelectorAll(`[${CM_ATTR}]`)).toHaveLength(0);
  });

  it('turning the switch off shows everything again and removes the words', () => {
    cm.setActive(true);
    cm.setActive(false);
    expect(document.querySelectorAll('.rescue-cm-toggle')).toHaveLength(0);
    expect(document.querySelectorAll(`[${CM_ATTR}]`)).toHaveLength(0);
  });

  it('removes everything it added when disposed', () => {
    cm.setActive(true);
    cm.dispose();
    expect(document.querySelectorAll('.rescue-cm-toggle')).toHaveLength(0);
    expect(document.querySelectorAll(`[${CM_ATTR}]`)).toHaveLength(0);
  });
});
