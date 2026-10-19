/**
 * Gap build H1 (T146): comment and appearance tweaks. Pure helpers plus a few module boots.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODULES } from '../../src/modules';
import { commentSortBy } from '../../src/modules/comments/commentSortBy';
import { normalizeProfile, resolveOptions } from '../../src/core/settings';
import { scrollBackBy } from '../../src/modules/comments/commentQuickCollapse';
import { commentStyle, commentStyleCss } from '../../src/modules/comments/commentStyle';
import { showParent } from '../../src/modules/comments/showParent';
import {
  isLongAddress,
  markLongLinks,
  tweaksCss,
  TRUNCATE_ATTR,
} from '../../src/modules/appearance/styleTweaks';
import { usernameHider } from '../../src/modules/appearance/usernameHider';
import { asAutoMode, autoColorCss, pillCss } from '../../src/modules/users/highlightExtras';
import { cleanSeparator, formatKarma } from '../../src/modules/users/showKarma';
import { highlightCss } from '../../src/modules/users/userHighlight';
import { fillCss } from '../../src/layout/native/selectionView';
import { mount, nestedThreadHtml, sessionHtml } from '../fixtures/pages';
import { bootModules, tick } from './module-harness';

afterEach(() => {
  document.body.innerHTML = '';
  document.head.querySelectorAll('style').forEach((s) => s.remove());
});

const BASE = {
  visitedLinks: false,
  visitedColor: '#112233',
  topLevelSeparator: false,
  separatorColor: '#445566',
  separatorSize: 3,
  reduceMotion: false,
};

describe('styleTweaks additions', () => {
  it('writes the scrollbar, truncation and capitalisation rules only when asked', () => {
    expect(tweaksCss({ ...BASE, postTitleCapitalization: 'none' })).toBe('');
    const css = tweaksCss({
      ...BASE,
      permanentVerticalScrollbar: true,
      truncateLongLinks: true,
      postTitleCapitalization: 'titlecase',
    });
    expect(css).toContain('overflow-y: scroll');
    expect(css).toContain(`a[${TRUNCATE_ATTR}]`);
    expect(css).toContain('text-transform: capitalize');
    expect(tweaksCss({ ...BASE, postTitleCapitalization: 'lowercase' })).toContain(
      'text-transform: lowercase',
    );
    // An unknown value (a hand-edited profile) is ignored rather than written into the sheet.
    expect(tweaksCss({ ...BASE, postTitleCapitalization: 'x;}body{display:none' })).toBe('');
  });

  it('marks only long addresses written out as link text, and unmarks them', () => {
    const long = 'https://example.com/' + 'a'.repeat(60);
    expect(isLongAddress(long)).toBe(true);
    expect(isLongAddress('https://example.com/short')).toBe(false);
    expect(isLongAddress('a long sentence about a thing ' + 'x'.repeat(40))).toBe(false);
    document.body.innerHTML = `<shreddit-comment><div slot="comment"><a id="a" href="${long}">${long}</a><a id="b" href="/x">${'word '.repeat(20)}</a></div></shreddit-comment>`;
    expect(markLongLinks(document, true)).toBe(1);
    expect(document.getElementById('a')!.hasAttribute(TRUNCATE_ATTR)).toBe(true);
    expect(document.getElementById('b')!.hasAttribute(TRUNCATE_ATTR)).toBe(false);
    markLongLinks(document, false);
    expect(document.getElementById('a')!.hasAttribute(TRUNCATE_ATTR)).toBe(false);
  });
});

describe('commentStyle', () => {
  const on = { commentBoxes: true, commentRounded: true, commentHoverBorder: false };
  it('is empty when everything is off and draws boxes, corners and a hover border on request', () => {
    expect(
      commentStyleCss({ commentBoxes: false, commentRounded: true, commentHoverBorder: false }),
    ).toBe('');
    const css = commentStyleCss({ ...on, commentHoverBorder: true, hoverBorderColor: '#123456' });
    expect(css).toContain('shreddit-comment');
    expect(css).toContain('border-radius');
    expect(css).toContain(
      'shreddit-comment:hover:not(:has(shreddit-comment:hover)) { border-color: #123456; }',
    );
    expect(
      commentStyleCss({ ...on, commentHoverBorder: true, hoverBorderColor: 'red;}x{' }),
    ).toContain('#ff4500');
  });

  it('adds one stylesheet and removes it on dispose', async () => {
    const m = await bootModules([commentStyle], {});
    expect(document.getElementById('rescue-comment-style')).not.toBeNull();
    m.dispose();
    expect(document.getElementById('rescue-comment-style')).toBeNull();
  });
});

describe('comment permalinks (Reddit ignores ?depth= and ?context=, live 2026-10-16)', () => {
  const profileHtml = `<shreddit-app><shreddit-profile-comment comment-id="t1_p1" href="/r/aww/comments/image1/dog/p1/?context=3">
      <a id="perma" href="/r/aww/comments/image1/dog/p1/?context=3">link</a>
      <time datetime="2026-10-14T09:00:00.000Z"></time><div slot="comment"><p>hi</p></div>
    </shreddit-profile-comment></shreddit-app>`;

  it('never adds ?depth= or ?context=, even with the retired module still stored', async () => {
    mount(profileHtml);
    const m = await bootModules([commentSortBy], {
      route: { kind: 'profile', path: '/user/x/comments/' },
      options: {
        commentDepth: { depth: 4, commentPermalinks: true, commentPermalinksContext: true },
        commentSortBy: { defaultSort: 'top' },
      },
    });
    m.flush();
    expect(document.getElementById('perma')!.getAttribute('href')).toBe(
      '/r/aww/comments/image1/dog/p1/?context=3',
    );
    m.dispose();
  });

  it('has dropped the commentDepth and context modules; stale stored settings are harmless', () => {
    expect(MODULES.some((d) => d.id === 'commentDepth')).toBe(false);
    expect(MODULES.some((d) => d.id === 'context')).toBe(false);
    const profile = normalizeProfile({
      schemaVersion: 1,
      modules: { commentDepth: { enabled: true, options: { depth: 4 } }, context: { enabled: true } },
    });
    for (const def of MODULES) expect(() => resolveOptions(def, profile)).not.toThrow();
  });
});

describe('scroll on collapse', () => {
  it('scrolls back only when the collapsed comment’s top is above the margin', () => {
    expect(scrollBackBy(200)).toBe(0);
    expect(scrollBackBy(72)).toBe(0);
    expect(scrollBackBy(-300)).toBe(-372);
  });
});

describe('selected entry fill', () => {
  it('turns a hex colour into a soft rgba fill and refuses anything else', () => {
    expect(fillCss('#f0f3fc')).toBe('rgba(240, 243, 252, 0.35)');
    expect(fillCss('#fff')).toBe('rgba(255, 255, 255, 0.35)');
    expect(fillCss('red;}x{')).toBe('');
    expect(fillCss('')).toBe('');
    expect(fillCss(undefined)).toBe('');
  });
});

describe('show parent fade options', () => {
  it('exposes the RES defaults for the popup fade', () => {
    expect(showParent.options.fadeDelay.default).toBe(200);
    expect(showParent.options.fadeSpeed.default).toBe(700);
  });
});

describe('user highlight additions', () => {
  it('auto colours come in a muted and a bright flavour', () => {
    expect(autoColorCss('hash-notbright')).toContain('60% 45%');
    expect(autoColorCss('hash-bright')).toContain('90% 55%');
    expect(asAutoMode('nonsense')).toBe('hash-notbright');
  });

  it('a chosen hover colour always applies; otherwise the shared switch decides', () => {
    expect(pillCss('x', '#112233', undefined, false, '#445566')).toContain(
      'a.x:hover{background:#445566}',
    );
    expect(pillCss('x', '#112233', undefined, false)).not.toContain(':hover');
    expect(pillCss('x', '#112233', undefined, false, 'bad;}')).not.toContain(':hover');
  });

  it('styles the hand-highlighted users with their own colours', () => {
    const css = highlightCss({
      mod: '#228822',
      admin: '#ff0011',
      friend: '#ff4500',
      tagged: '#b8860b',
      highlighted: '#5544cc',
      highlightedHover: '#6677aa',
    });
    expect(css).toContain('a.rescue-highlighted-author{background:#5544cc');
    expect(css).toContain('a.rescue-highlighted-author:hover{background:#6677aa}');
  });
});

describe('showKarma formatting', () => {
  const f = { showCommentKarma: true, separator: '·', useCommas: true };
  it('formats post then comment karma with the chosen separator and commas', () => {
    expect(formatKarma(12345, 678, f)).toBe('Karma 12,345 · 678');
    expect(formatKarma(12345, 678, { ...f, useCommas: false, separator: '/' })).toBe(
      'Karma 12345 / 678',
    );
    expect(formatKarma(12345, 678, { ...f, showCommentKarma: false })).toBe('Karma 12,345');
    expect(formatKarma(5, undefined, f)).toBe('Karma 5');
  });
  it('keeps the separator short and never empty', () => {
    expect(cleanSeparator('   ')).toBe('·');
    expect(cleanSeparator('abcdefghij')).toHaveLength(5);
  });
});

describe('usernameHider reveal on hover', () => {
  it('shows the real name under the pointer and masks it again when it leaves', async () => {
    mount(sessionHtml(true, 'rockpaperblr') + nestedThreadHtml());
    const m = await bootModules([usernameHider], {
      username: 'rockpaperblr',
      options: { usernameHider: { showUsernameOnHover: true } },
    });
    const a = document.querySelector('shreddit-comment a[href="/user/rockpaperblr/"]')!;
    expect(a.textContent).toBe('u/~anon~');
    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(a.textContent).toBe('u/rockpaperblr');
    a.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    expect(a.textContent).toBe('u/~anon~');
    await tick();
    m.dispose();
    expect(a.textContent).toBe('u/rockpaperblr');
  });

  it('keeps names masked on hover when the option is off', async () => {
    mount(sessionHtml(true, 'rockpaperblr') + nestedThreadHtml());
    const m = await bootModules([usernameHider], { username: 'rockpaperblr' });
    const a = document.querySelector('shreddit-comment a[href="/user/rockpaperblr/"]')!;
    a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(a.textContent).toBe('u/~anon~');
    m.dispose();
  });
});
