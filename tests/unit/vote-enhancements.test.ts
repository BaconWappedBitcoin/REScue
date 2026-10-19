import { afterEach, describe, expect, it } from 'vitest';
import { ratioLabel, voteEnhancements } from '../../src/modules/actions/voteEnhancements';
import { listingHtml, mount } from '../fixtures/pages';
import { bootModules } from './module-harness';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('voteEnhancements', () => {
  it('formats a ratio as a whole percentage and rejects anything that is not 0 to 1', () => {
    expect(ratioLabel(0.97)).toBe('97% upvoted');
    expect(ratioLabel(0.5)).toBe('50% upvoted');
    expect(ratioLabel(0)).toBe('0% upvoted');
    for (const bad of [null, undefined, NaN, Infinity, -0.1, 1.2])
      expect(ratioLabel(bad)).toBeNull();
  });

  it('adds the ratio after the time of each post that has one, as text', async () => {
    mount(listingHtml());
    const posts = [...document.querySelectorAll('shreddit-post')];
    expect(posts.length).toBeGreaterThan(1);
    posts[0]!.setAttribute('upvote-ratio', '0.42');
    posts[1]!.removeAttribute('upvote-ratio');
    const m = await bootModules([voteEnhancements], { route: { kind: 'all', path: '/r/all' } });
    m.flush();
    const nodes = [...document.querySelectorAll<HTMLElement>('.rescue-upvote-ratio')];
    expect(nodes.length).toBe(posts.length - 1);
    const first = posts[0]!.querySelector('.rescue-upvote-ratio')!;
    expect(first.textContent).toBe('42% upvoted');
    expect(posts[0]!.querySelector('faceplate-timeago')!.nextElementSibling).toBe(first);
    expect(posts[1]!.querySelector('.rescue-upvote-ratio')).toBeNull();
    m.dispose();
  });
});
