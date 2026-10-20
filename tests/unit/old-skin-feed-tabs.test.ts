import { describe, expect, it } from 'vitest';
import { classify } from '../../src/core/route';
import { feedTabs } from '../../src/model/oldSkinText';
import { skinApplies } from '../../src/model/oldSkinBase';

const tabs = (url: string, shown: string[]) =>
  feedTabs(classify(url), new Set(shown as never)).map((t) => (t.active ? `[${t.key}]` : t.key));

describe('old look feed tabs', () => {
  it('shows nothing until a feed tab is turned on', () => {
    expect(tabs('https://www.reddit.com/', [])).toEqual([]);
  });
  it('lists home and the chosen feeds, marking the current one', () => {
    expect(tabs('https://www.reddit.com/', ['popular', 'news'])).toEqual([
      '[home]',
      'popular',
      'news',
    ]);
    expect(tabs('https://www.reddit.com/r/popular/', ['popular'])).toEqual(['home', '[popular]']);
    expect(tabs('https://www.reddit.com/news/', ['news'])).toEqual(['home', '[news]']);
  });
  it('stays off subreddits and threads', () => {
    expect(tabs('https://www.reddit.com/r/pics/', ['popular'])).toEqual([]);
    expect(tabs('https://www.reddit.com/r/pics/comments/abc/x/', ['popular'])).toEqual([]);
  });
  it('skins the News feed like the other listings', () => {
    expect(skinApplies(classify('https://www.reddit.com/news/'))).toBe(true);
    expect(skinApplies(classify('https://www.reddit.com/settings/'))).toBe(false);
  });
});
