import { describe, expect, it } from 'vitest';
import { RedditJsonClient } from '../../src/core/redditJson';
import {
  buildFilmstrip,
  allowedPicture,
  positiveInt,
  wantsFilmstrip,
} from '../../src/modules/listings/inlineMedia/filmstrip';
import {
  decorateLinks,
  pictureHref,
  removeLinkMedia,
} from '../../src/modules/listings/inlineMedia/linkMedia';
import { OriginalSizes } from '../../src/modules/listings/inlineMedia/originalSizes';
import { playableMp4 } from '../../src/modules/listings/inlineMedia/player';
import {
  parseLimit,
  ratioOf,
  resolutionOf,
  sizingCss,
  steppedWidth,
  textCap,
} from '../../src/modules/listings/inlineMedia/sizing';
import { highlightCss, sensitiveOf } from '../../src/modules/listings/inlineMedia/highlight';
import type { Post } from '../../src/model/types';

const post = (media: Post['media']): Post => ({ media }) as Post;

describe('parseLimit', () => {
  it('reads px, bare numbers and percentages by axis', () => {
    expect(parseLimit('600', 'w')).toBe('600px');
    expect(parseLimit('600px', 'w')).toBe('600px');
    expect(parseLimit('50%', 'w')).toBe('50%');
    expect(parseLimit('80%', 'h')).toBe('80vh');
    expect(parseLimit('250%', 'h')).toBe('100vh');
  });
  it('treats 0, empty and junk as no limit', () => {
    for (const v of ['0', '', '  ', 'abc', '-5', '99999999', undefined, null])
      expect(parseLimit(v, 'h')).toBeNull();
  });
  it('textCap falls back to 80vh only with auto on', () => {
    expect(textCap('0', true)).toBe('80vh');
    expect(textCap('0', false)).toBeNull();
    expect(textCap('300', true)).toBe('300px');
  });
});

describe('sizingCss', () => {
  const base = {
    maxWidth: '100%',
    maxHeight: '0',
    selfTextMaxHeight: '0',
    commentMaxHeight: '0',
    autoMaxHeight: false,
  };
  it('only has the key-driven rule when every option is neutral', () => {
    const css = sizingCss(base);
    expect(css.split('\n')).toHaveLength(1);
    expect(css).toContain('data-rescue-msize');
  });
  it('turns a height limit into a width limit through the ratio', () => {
    const css = sizingCss({ ...base, maxHeight: '80%', maxWidth: '600' });
    expect(css).toContain('min(600px, calc(80vh * var(--rescue-media-ar)))');
    expect(css).toContain('max-width: 600px');
  });
  it('caps text bodies', () => {
    const css = sizingCss({ ...base, selfTextMaxHeight: '300', commentMaxHeight: '50%' });
    expect(css).toContain('max-height: 300px');
    expect(css).toContain('max-height: 50vh');
    expect(sizingCss({ ...base, autoMaxHeight: true })).toContain('80vh');
  });
});

describe('sizes and resolution', () => {
  it('steps and never shrinks below 80 px', () => {
    expect(steppedWidth(500, 1.2)).toBe(600);
    expect(steppedWidth(85, 1 / 1.2)).toBe(80);
  });

  const picture = (src: string, w: number, h: number): HTMLElement => {
    const box = document.createElement('div');
    const img = document.createElement('img');
    img.src = src;
    Object.defineProperty(img, 'naturalWidth', { value: w });
    Object.defineProperty(img, 'naturalHeight', { value: h });
    box.append(img);
    return box;
  };
  const single = post({ kind: 'image', host: 'i.redd.it', items: [{ src: 'x' }] });

  it('takes the ratio from the model, else from the loaded picture', () => {
    const sized = post({
      kind: 'image',
      host: 'i.redd.it',
      items: [{ src: 'x', width: 1920, height: 1080 }],
    });
    expect(ratioOf(sized)).toBeCloseTo(16 / 9);
    expect(ratioOf(single)).toBeNull();
    expect(ratioOf(single, picture('https://i.redd.it/a.png', 400, 200))).toBe(2);
    expect(ratioOf(single, picture('https://i.redd.it/a.png', 0, 0))).toBeNull();
    const gal = post({ kind: 'gallery', host: 'x', items: [{ src: 'x' }] });
    expect(ratioOf(gal, picture('https://i.redd.it/a.png', 400, 200))).toBeNull();
  });

  it('shows the size only for original files, never for resized previews', () => {
    expect(resolutionOf(single, picture('https://i.redd.it/a.png', 1920, 1080))).toBe(
      '1920 × 1080',
    );
    expect(resolutionOf(single, picture('https://preview.redd.it/a.png', 640, 360))).toBeNull();
    expect(resolutionOf(single, picture('https://i.redd.it/a.png', 0, 0))).toBeNull();
    expect(resolutionOf(single, null)).toBeNull();
  });

  it('uses the original size Reddit lists when the original picture was never loaded', () => {
    const preview = picture('https://preview.redd.it/a.png', 640, 360);
    expect(resolutionOf(single, preview, [3024, 4032])).toBe('3024 × 4032');
    expect(resolutionOf(single, null, [1168, 659])).toBe('1168 × 659');
    expect(resolutionOf(single, preview, null)).toBeNull();
    // A loaded original still wins: its own pixels are the truth.
    expect(resolutionOf(single, picture('https://i.redd.it/a.png', 1920, 1080), [1, 1])).toBe(
      '1920 × 1080',
    );
    // Only single pictures.
    const gal = post({ kind: 'gallery', host: 'x', items: [{ src: 'x' }] });
    expect(resolutionOf(gal, null, [10, 10])).toBeNull();
  });
});

describe('OriginalSizes', () => {
  const thread = (id: string, sourceSize: [number, number] | undefined) => ({
    ok: true as const,
    cached: false,
    data: {
      post: {
        id,
        title: null,
        numComments: 0,
        locked: false,
        saved: false,
        hidden: false,
        likes: null,
        score: null,
        ...(sourceSize ? { sourceSize } : {}),
      },
      comments: [],
    },
  });

  it('asks once per post, through the thread JSON, and remembers sizes (and posts with none)', async () => {
    const calls: Array<[string, unknown]> = [];
    let known = 0;
    const sizes = new OriginalSizes(
      (async (e: string, p: { id: string }) => {
        calls.push([e, p]);
        return thread(p.id, p.id === 't3_a' ? [100, 50] : undefined);
      }) as never,
      () => known++,
      1,
    );
    sizes.want('t3_a');
    sizes.want('t3_b');
    sizes.want('t3_a');
    expect(sizes.get('t3_a')).toBeUndefined();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([
      ['comments', { id: 't3_a', limit: 1, depth: 0 }],
      ['comments', { id: 't3_b', limit: 1, depth: 0 }],
    ]);
    expect(sizes.get('t3_a')).toEqual([100, 50]);
    expect(sizes.get('t3_b')).toBeNull();
    expect(known).toBe(2);
    sizes.want('t3_a');
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(2);
  });

  it('treats a failed read as no size, without asking again', async () => {
    let n = 0;
    const sizes = new OriginalSizes(
      (async () => (n++, { ok: false, reason: 'http', message: 'Reddit answered 403.' })) as never,
      () => {},
      1,
    );
    sizes.want('t3_a');
    await new Promise((r) => setTimeout(r, 20));
    expect(sizes.get('t3_a')).toBeNull();
    sizes.want('t3_a');
    await new Promise((r) => setTimeout(r, 20));
    expect(n).toBe(1);
  });

  it('never asks /api/info.json (a real client, stubbed fetch)', async () => {
    const urls: string[] = [];
    const c = new RedditJsonClient({
      fetchJson: async (url) => {
        urls.push(url);
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          text: async () =>
            JSON.stringify([
              {
                kind: 'Listing',
                data: {
                  children: [
                    {
                      kind: 't3',
                      data: {
                        name: 't3_a',
                        num_comments: 0,
                        preview: { images: [{ source: { width: 640, height: 480 } }] },
                      },
                    },
                  ],
                },
              },
              { kind: 'Listing', data: { children: [] } },
            ]),
        };
      },
      sleep: async () => {},
    });
    const sizes = new OriginalSizes(
      (e, p, o) => c.get(e, p, o),
      () => {},
      1,
    );
    sizes.want('t3_a');
    await new Promise((r) => setTimeout(r, 20));
    expect(urls).toEqual(['/comments/a.json?raw_json=1&limit=1&depth=0']);
    expect(sizes.get('t3_a')).toEqual([640, 480]);
  });
});

describe('filmstrip', () => {
  it('decides by option, count and the slideshow limit', () => {
    expect(wantsFilmstrip(false, 5, 0)).toBe(false);
    expect(wantsFilmstrip(true, 1, 0)).toBe(false);
    expect(wantsFilmstrip(true, 5, 0)).toBe(true);
    expect(wantsFilmstrip(true, 5, 5)).toBe(true);
    expect(wantsFilmstrip(true, 6, 5)).toBe(false);
  });
  it('only draws Reddit picture hosts over https', () => {
    expect(allowedPicture('https://preview.redd.it/a.jpg')).toBe(true);
    expect(allowedPicture('https://i.imgur.com/a.jpg')).toBe(false);
    expect(allowedPicture('http://i.redd.it/a.jpg')).toBe(false);
    expect(allowedPicture('not a url')).toBe(false);
  });
  it('parses increments with a fallback', () => {
    expect(positiveInt('30', 1)).toBe(30);
    expect(positiveInt('0', 7)).toBe(7);
    expect(positiveInt('x', 7)).toBe(7);
  });
  it('draws the first batch and loads more on click', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ src: `https://i.redd.it/${i}.jpg` }));
    let back = 0;
    const el = buildFilmstrip(items, 2, () => back++);
    document.body.append(el);
    expect(el.querySelectorAll('img')).toHaveLength(2);
    const more = el.querySelector<HTMLButtonElement>('.rescue-film-word:last-child')!;
    expect(more.textContent).toBe('load 2 more');
    more.click();
    more.click();
    expect(el.querySelectorAll('img')).toHaveLength(5);
    expect(more.hidden).toBe(true);
    el.querySelector<HTMLButtonElement>('.rescue-film-word')!.click();
    expect(back).toBe(1);
  });
});

describe('player', () => {
  const vid = (mp4Url?: string): Post =>
    post({ kind: 'video', host: 'v.redd.it', items: [], ...(mp4Url ? { mp4Url } : {}) });
  it('plays only unexpired https redd.it mp4s', () => {
    expect(playableMp4(vid('https://packaged-media.redd.it/x/m.mp4'))).toBe(
      'https://packaged-media.redd.it/x/m.mp4',
    );
    expect(playableMp4(vid('https://evil.example/m.mp4'))).toBeNull();
    expect(playableMp4(vid('http://v.redd.it/m.mp4'))).toBeNull();
    expect(playableMp4(vid('https://v.redd.it/m.mp4?e=1000'))).toBeNull();
    expect(playableMp4(vid())).toBeNull();
  });
});

describe('link expandos', () => {
  it('knows which links it expands', () => {
    expect(pictureHref('https://i.redd.it/a.png')).toBe('https://i.redd.it/a.png');
    expect(pictureHref('https://preview.redd.it/a.jpg?width=640')).toContain('preview.redd.it');
    expect(pictureHref('https://i.imgur.com/a.png')).toBeNull();
    expect(pictureHref('https://i.redd.it/a.mp4')).toBeNull();
    expect(pictureHref('/r/pics')).toBeNull();
    expect(pictureHref(null)).toBeNull();
  });
  it('adds one word per link, shows the picture on click and cleans up', () => {
    document.body.innerHTML =
      '<div id="b"><p><a href="https://i.redd.it/a.png">pic</a> and <a href="https://example.com/b.png">other</a></p></div>';
    const body = document.getElementById('b')!;
    expect(decorateLinks(body, null)).toBe(1);
    expect(decorateLinks(body, null)).toBe(0);
    const btn = body.querySelector<HTMLButtonElement>('.rescue-linkmedia-toggle')!;
    expect(btn.textContent).toBe('show picture');
    expect(body.querySelector('img')).toBeNull();
    btn.click();
    expect(body.querySelector('img')?.getAttribute('src')).toBe('https://i.redd.it/a.png');
    expect(btn.textContent).toBe('hide picture');
    btn.click();
    expect(body.querySelector('img')).toBeNull();
    removeLinkMedia(body);
    expect(body.querySelector('.rescue-linkmedia')).toBeNull();
    expect(decorateLinks(body, null)).toBe(1);
  });
});

describe('highlight', () => {
  it('colours only what is switched on, NSFW before spoiler', () => {
    expect(highlightCss(false, false)).toBe('');
    expect(highlightCss(true, false)).toContain('nsfw');
    expect(highlightCss(true, false)).not.toContain('spoiler');
    expect(sensitiveOf({ nsfw: true, spoiler: true })).toBe('nsfw');
    expect(sensitiveOf({ nsfw: false, spoiler: true })).toBe('spoiler');
    expect(sensitiveOf({ nsfw: false, spoiler: false })).toBe('');
  });
});
