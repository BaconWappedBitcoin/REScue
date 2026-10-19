import { describe, expect, it, beforeEach } from 'vitest';
import { listingHtml, mount } from '../fixtures/pages';
import { parsePost } from '../../src/model/post';
import { galleryImages, imageOf, pickRendition, pictureKey, expired } from '../../src/model/media';

const postEl = (id: string) => document.getElementById(id)!;

describe('Reddit-hosted media descriptors', () => {
  beforeEach(() => mount(listingHtml()));

  it('lists each gallery image once, even when Reddit repeats one at another size', () => {
    const imgs = galleryImages(postEl('t3_gallery1'));
    expect(imgs).toEqual([
      'https://preview.redd.it/bubble-1-1280.jpg',
      'https://preview.redd.it/bubble-2-1280.jpg',
    ]);
    expect(pictureKey('https://preview.redd.it/a.jpg?width=640')).toBe(
      pictureKey('https://i.redd.it/a.jpg'),
    );
  });

  it('ignores community icons and emoji that sit beside the post images', () => {
    expect(galleryImages(postEl('t3_gallery1')).some((u) => u.includes('styles.redditmedia'))).toBe(
      false,
    );
  });

  it('prefers the original i.redd.it image over preview sizes', () => {
    expect(imageOf(postEl('t3_image1'))).toBe('https://i.redd.it/gooddog.jpg');
  });

  it('builds image and gallery descriptors from the post model', () => {
    const img = parsePost(postEl('t3_image1'))!;
    expect(img.media).toMatchObject({
      kind: 'image',
      items: [{ src: 'https://i.redd.it/gooddog.jpg' }],
    });
    const gal = parsePost(postEl('t3_gallery1'))!;
    expect(gal.media?.kind).toBe('gallery');
    expect(gal.media?.items).toHaveLength(2);
    expect(parsePost(postEl('t3_text1'))!.media).toBeNull();
  });

  it('treats a signed URL past its expiry as dead', () => {
    expect(expired('https://packaged-media.redd.it/x.mp4?e=1000', 2_000_000)).toBe(true);
    expect(expired('https://packaged-media.redd.it/x.mp4?e=99999999999', Date.now())).toBe(false);
    expect(expired('https://i.redd.it/x.jpg')).toBe(false);
  });
});

describe('DASH manifest', () => {
  const MPD = `<?xml version="1.0"?><MPD><Period>
    <AdaptationSet contentType="video">
      <Representation height="240" width="426"><BaseURL>DASH_240.mp4</BaseURL></Representation>
      <Representation height="720" width="1280"><BaseURL>DASH_720.mp4</BaseURL></Representation>
      <Representation height="480" width="854"><BaseURL>DASH_480.mp4</BaseURL></Representation>
    </AdaptationSet>
    <AdaptationSet contentType="audio">
      <Representation><BaseURL>DASH_AUDIO_64.mp4</BaseURL></Representation>
      <Representation><BaseURL>DASH_AUDIO_128.mp4</BaseURL></Representation>
    </AdaptationSet></Period></MPD>`;

  it('picks the smallest rendition at least 640 wide, plus the best audio', () => {
    expect(pickRendition(MPD, 'https://v.redd.it/abc')).toEqual({
      url: 'https://v.redd.it/abc/DASH_480.mp4',
      width: 854,
      height: 480,
      audioUrl: 'https://v.redd.it/abc/DASH_AUDIO_128.mp4',
    });
  });

  it('returns null for a manifest with no video', () => {
    expect(pickRendition('<MPD></MPD>', 'https://v.redd.it/x')).toBeNull();
    expect(pickRendition('not xml <', 'https://v.redd.it/x')).toBeNull();
  });
});
