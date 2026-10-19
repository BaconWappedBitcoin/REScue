import { describe, expect, it } from 'vitest';
import { playGifs } from '../../src/model/comment-media';

describe('showing a hidden comment GIF starts it', () => {
  it('calls play() on GIF players only, never on videos with sound, and survives a failing player', () => {
    document.body.innerHTML = `<figure class="rte-media"><shreddit-player gif id="g"></shreddit-player></figure>
      <figure class="rte-media"><shreddit-player id="v"></shreddit-player></figure>
      <figure class="rte-media"><shreddit-player gif id="bad"></shreddit-player></figure>`;
    const played: string[] = [];
    for (const id of ['g', 'v']) {
      (document.getElementById(id) as HTMLElement & { play: () => Promise<void> }).play = () => {
        played.push(id);
        return Promise.resolve();
      };
    }
    (document.getElementById('bad') as HTMLElement & { play: () => Promise<void> }).play = () =>
      Promise.reject(new Error('not ready'));
    const [gif, video, bad] = [...document.querySelectorAll('figure')];
    playGifs(gif!);
    playGifs(video!);
    expect(() => playGifs(bad!)).not.toThrow();
    expect(played).toEqual(['g']);
  });
});
