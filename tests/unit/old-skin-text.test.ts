import { describe, expect, it } from 'vitest';
import {
  agoText,
  commentsText,
  compactScore,
  domainText,
  pathSort,
  pointsText,
  sortTabs,
} from '../../src/model/oldSkinText';
import type { Route } from '../../src/core/types';

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const ago = (ms: number) => agoText(new Date(NOW - ms), NOW);

describe('old Reddit wording', () => {
  it('says how long ago like old Reddit', () => {
    expect(ago(10_000)).toBe('just now');
    expect(ago(60_000)).toBe('1 minute ago');
    expect(ago(22 * 60_000)).toBe('22 minutes ago');
    expect(ago(3_600_000)).toBe('an hour ago');
    expect(ago(2 * 3_600_000)).toBe('2 hours ago');
    expect(ago(26 * 3_600_000)).toBe('1 day ago');
    expect(ago(40 * 86_400_000)).toBe('1 month ago');
    expect(ago(800 * 86_400_000)).toBe('2 years ago');
    expect(agoText(null, NOW)).toBe('');
  });

  it('shortens big scores and counts points and comments', () => {
    expect(compactScore(9517)).toBe('9517');
    expect(compactScore(12900)).toBe('12.9k');
    expect(compactScore(20000)).toBe('20k');
    expect(compactScore(-3)).toBe('-3');
    expect(pointsText(1)).toBe('1 point');
    expect(pointsText(196)).toBe('196 points');
    expect(commentsText(0)).toBe('comment');
    expect(commentsText(1)).toBe('1 comment');
    expect(commentsText(137)).toBe('137 comments');
  });

  it('shows the domain, or self.sub for a text post', () => {
    expect(domainText('autoblog.com', 'cars', false)).toBe('(autoblog.com)');
    expect(domainText('', 'cars', true)).toBe('(self.cars)');
    expect(domainText('', '', false)).toBe('');
  });
});

describe('sort tabs', () => {
  const home: Route = { kind: 'front', path: '/' };
  const sub: Route = { kind: 'subreddit', path: '/r/cars', subreddit: 'cars' };

  it('reads the sort a path names', () => {
    expect(pathSort('/r/cars/top/')).toBe('top');
    expect(pathSort('/r/cars')).toBeNull();
  });

  it('uses Reddit’s own links first and computes the rest for a subreddit', () => {
    const tabs = sortTabs(sub, [
      { key: 'hot', href: '/r/cars/hot/?x=1', selected: true },
      { key: 'new', href: '/r/cars/new/', selected: false },
    ]);
    expect(tabs.map((t) => t.key)).toEqual(['hot', 'new', 'rising', 'controversial', 'top']);
    expect(tabs[0]).toMatchObject({ href: '/r/cars/hot/?x=1', active: true });
    expect(tabs[3]!.href).toBe('/r/cars/controversial/');
    expect(tabs.filter((t) => t.active)).toHaveLength(1);
  });

  it('offers best only on the home feed and defaults to it', () => {
    const tabs = sortTabs(home, []);
    expect(tabs.map((t) => t.key)).toEqual(['best', 'hot', 'new', 'rising', 'controversial', 'top']);
    expect(tabs[0]).toMatchObject({ href: '/best/', active: true });
    expect(sortTabs(sub, []).some((t) => t.key === 'best')).toBe(false);
  });

  it('never invents a link for a listing it cannot compute', () => {
    const feed: Route = { kind: 'customFeed', path: '/user/a/m/b', username: 'a' };
    expect(sortTabs(feed, [])).toEqual([]);
    expect(sortTabs(feed, [{ key: 'hot', href: '/user/a/m/b/hot/', selected: false }])).toHaveLength(1);
  });
});
