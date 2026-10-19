import { describe, expect, it } from 'vitest';
import { frontRedirect, logoTarget } from '../../src/modules/appearance/logoLink';
import { LOAD_AHEAD_PX, loadAheadCss } from '../../src/modules/listings/feedPause';

describe('loading the next page sooner', () => {
  it('stretches only the unheld loader upward by the chosen distance', () => {
    const css = loadAheadCss('sooner');
    expect(css).toContain(`margin-top: -${LOAD_AHEAD_PX.sooner}px`);
    expect(css).toContain(`padding-top: ${LOAD_AHEAD_PX.sooner}px`);
    expect(css).toContain(':not([data-rescue-held])');
    expect(css).toContain('> * { pointer-events: auto; }');
    expect(loadAheadCss('early')).toContain('3000px');
  });

  it('leaves Reddit’s own timing alone when asked, or for an unknown value', () => {
    expect(loadAheadCss('reddit')).toBe('');
    expect(loadAheadCss('bogus; } body {')).toBe('');
  });
});

describe('front page sort', () => {
  it('sends only a bare front page to the chosen sort, keeping the query', () => {
    expect(frontRedirect('https://www.reddit.com/', 'hot')).toBe('/hot/');
    expect(frontRedirect('https://www.reddit.com/?feed=home', 'new')).toBe('/new/?feed=home');
    expect(frontRedirect('https://www.reddit.com/best/', 'hot')).toBeNull();
    expect(frontRedirect('https://www.reddit.com/r/news/', 'hot')).toBeNull();
    expect(frontRedirect('https://www.reddit.com/', 'best')).toBeNull();
    expect(frontRedirect('https://www.reddit.com/', '../evil')).toBeNull();
  });

  it('points the front-page logo at the sort, or leaves Reddit’s own link', () => {
    const route = { kind: 'front' } as never;
    expect(logoTarget({ destination: 'frontpage', customDestination: '/', frontpageSort: 'hot' }, route, null)).toBe('/hot/');
    expect(logoTarget({ destination: 'frontpage', customDestination: '/', frontpageSort: 'best' }, route, null)).toBeNull();
  });
});
