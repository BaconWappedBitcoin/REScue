/**
 * filteReddit's console row checks (validateRow) for post filters, comment filters and the NSFW
 * allow-list: the console shows the message, and imported or synced rows that fail are dropped.
 */
import { describe, expect, it } from 'vitest';
import { filteReddit } from '../../src/modules/listings/filteReddit';

type Validate = (row: Record<string, unknown>) => string | null;
const check = (option: string): Validate => {
  const spec = (filteReddit.options as Record<string, { validateRow?: Validate }>)[option];
  if (!spec?.validateRow) throw new Error(`${option} has no validateRow`);
  return spec.validateRow;
};

describe('post filter rows', () => {
  const v = check('rules');
  const row = (r: Record<string, unknown>) => ({ scope: 'everywhere', enabled: true, ...r });

  it.each([
    ['a blank new row', row({ type: 'keyword', pattern: '' })],
    ['a row whose pattern is still missing', row({ type: 'domain' })],
    ['a keyword', row({ type: 'keyword', pattern: 'foo' })],
    ['a regular expression', row({ type: 'keyword', pattern: '/fo+|bar/i' })],
    ['a type with no pattern', row({ type: 'nsfw', pattern: '' })],
    ['a user tag with no pattern', row({ type: 'user-tag', pattern: '' })],
    ['a whole number', row({ type: 'score-below', pattern: '-5' })],
    ['a post type', row({ type: 'post-type', pattern: 'Gallery' })],
    ['a custom condition', row({ type: 'custom', pattern: 'score<10 and not vote:up' })],
    [
      'a subreddit list for “only”',
      row({ type: 'keyword', pattern: 'x', scope: 'only', subreddits: 'pics, aww' }),
    ],
    ['an “only when browsing” condition', row({ type: 'nsfw', when: 'onsub:pics or front' })],
  ])('accepts %s', (_n, r) => {
    expect(v(r)).toBeNull();
  });

  it.each([
    ['an unknown type', row({ type: 'bogus', pattern: 'x' }), /Unknown filter type “bogus”/],
    [
      'a blank pattern scoped to subreddits',
      row({ type: 'keyword', pattern: ' ', scope: 'only', subreddits: 'pics' }),
      /Enter a pattern/,
    ],
    ['a score that is not a number', row({ type: 'score-above', pattern: '1e3' }), /whole number/],
    ['an unknown post type', row({ type: 'post-type', pattern: 'meme' }), /Post type must be/],
    ['a broken regular expression', row({ type: 'keyword', pattern: '/(/' }), /./],
    ['a broken custom condition', row({ type: 'custom', pattern: 'score<' }), /./],
    [
      '“only” with no subreddits',
      row({ type: 'keyword', pattern: 'x', scope: 'only', subreddits: ' ' }),
      /List at least one subreddit for “only in”/,
    ],
    ['“except” with no subreddits', row({ type: 'nsfw', scope: 'except' }), /“everywhere except”/],
    [
      'a bad “only when browsing” condition',
      row({ type: 'nsfw', when: 'onsub:pics and nosuch:x' }),
      /^Only when browsing: /,
    ],
  ])('rejects %s', (_n, r, msg) => {
    expect(v(r)).toMatch(msg);
  });
});

describe('comment filter rows', () => {
  const v = check('commentRules');
  const row = (r: Record<string, unknown>) => ({ action: 'collapse', enabled: true, ...r });

  it.each([
    ['a blank new row', row({ type: 'keyword', pattern: '' })],
    ['deleted (no pattern)', row({ type: 'deleted' })],
    ['low-effort (no pattern)', row({ type: 'low-effort', action: 'hide' })],
    ['a user', row({ type: 'user', pattern: 'spez' })],
    ['a depth', row({ type: 'depth', pattern: '3' })],
    ['a custom condition', row({ type: 'custom', pattern: 'length<20w and score<0' })],
  ])('accepts %s', (_n, r) => {
    expect(v(r)).toBeNull();
  });

  it.each([
    ['an unknown type', row({ type: 'bogus', pattern: 'x' }), /Unknown comment filter “bogus”/],
    [
      'an unknown action',
      row({ type: 'keyword', pattern: 'x', action: 'zap' }),
      /collapse or hide/,
    ],
    ['a depth that is not a number', row({ type: 'depth', pattern: 'deep' }), /Depth must be/],
    ['a score that is not a number', row({ type: 'score-below', pattern: 'x' }), /whole number/],
    ['a broken regular expression', row({ type: 'keyword', pattern: '/[/' }), /./],
    ['a broken custom condition', row({ type: 'custom', pattern: '(' }), /./],
    [
      'a bad “only when browsing” condition',
      row({ type: 'deleted', when: 'dow:' }),
      /^Only when browsing: /,
    ],
  ])('rejects %s', (_n, r, msg) => {
    expect(v(r)).toMatch(msg);
  });
});

describe('NSFW allow-list rows', () => {
  const v = check('nsfwAllowList');

  it.each([[''], ['  '], ['nsfw_gifs'], ['/r/nsfw_gifs'], ['r/NSFW_GIFS'], [undefined]])(
    'accepts %j',
    (subreddit) => {
      expect(v({ subreddit })).toBeNull();
    },
  );

  it.each([['x'], ['two words'], ['r/a-b'], ['a'.repeat(22)], ['/u/someone']])(
    'rejects %j',
    (subreddit) => {
      expect(v({ subreddit })).toBe('Enter a subreddit name such as nsfw_gifs.');
    },
  );
});
