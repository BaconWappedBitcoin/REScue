import { describe, expect, it } from 'vitest';
import {
  compileRules,
  matchPost,
  parsePattern,
  validateRule,
  type FilterRule,
  type MatchContext,
} from '../../src/modules/listings/filteReddit/rules';
import type { Post } from '../../src/model/types';

const post = (over: Partial<Post> = {}): Post =>
  ({
    kind: 'post',
    id: 't3_x',
    title: 'Rust 2.0 released',
    permalink: '/r/programming/comments/x/rust/',
    url: 'https://blog.rust-lang.org/x',
    type: 'link',
    domain: 'blog.rust-lang.org',
    author: 'ferris',
    subreddit: 'programming',
    score: 1,
    upvoteRatio: 1,
    commentCount: 0,
    created: null,
    flair: { text: 'News' },
    nsfw: false,
    spoiler: false,
    thumbnail: null,
    media: null,
    feedIndex: null,
    bodyHtml: null,
    source: document.createElement('div'),
    ...over,
  }) as Post;

const rule = (over: Partial<FilterRule>): FilterRule => ({
  type: 'keyword',
  pattern: '',
  scope: 'everywhere',
  subreddits: '',
  enabled: true,
  toggle: '',
  ...over,
});

const page: MatchContext = { subreddit: 'programming', toggleOn: () => true };
const match = (r: FilterRule, p: Post = post(), ctx: MatchContext = page) => {
  const { rules, errors } = compileRules([r]);
  expect(errors).toEqual([]);
  return matchPost(p, rules, ctx);
};

describe('pattern parsing', () => {
  it('detects /body/flags regexes and compiles them', () => {
    expect(parsePattern('/^rust\\b/i', false)).toMatchObject({ ok: true, isRegex: true });
    expect(parsePattern('/(a|b)/gimsu', false)).toMatchObject({ ok: true, isRegex: true });
  });

  it('reports a regex that does not compile', () => {
    const r = parsePattern('/(unclosed/i', false);
    expect(r.ok).toBe(false);
  });

  it('treats everything else as plain text, escaped', () => {
    const r = parsePattern('c++ (lang)', false);
    expect(r).toMatchObject({ ok: true, isRegex: false });
    if (r.ok) expect(r.regex.test('I like C++ (LANG)')).toBe(true);
  });
});

describe('rule types', () => {
  it('keyword: case-insensitive substring of the title', () => {
    expect(match(rule({ type: 'keyword', pattern: 'RUST' }))?.type).toBe('keyword');
    expect(match(rule({ type: 'keyword', pattern: 'golang' }))).toBeNull();
  });

  it('keyword regex', () => {
    expect(match(rule({ type: 'keyword', pattern: '/\\d\\.\\d/' }))).not.toBeNull();
  });

  it('subreddit: exact, case-insensitive', () => {
    expect(match(rule({ type: 'subreddit', pattern: 'Programming' }))).not.toBeNull();
    expect(match(rule({ type: 'subreddit', pattern: 'program' }))).toBeNull();
  });

  it('domain: exact, case-insensitive', () => {
    expect(match(rule({ type: 'domain', pattern: 'blog.rust-lang.org' }))).not.toBeNull();
    expect(match(rule({ type: 'domain', pattern: 'rust-lang.org' }))).toBeNull();
    expect(match(rule({ type: 'domain', pattern: '/(^|\\.)rust-lang\\.org$/' }))).not.toBeNull();
  });

  it('user: exact, case-insensitive; deleted authors never match', () => {
    expect(match(rule({ type: 'user', pattern: 'FERRIS' }))).not.toBeNull();
    expect(match(rule({ type: 'user', pattern: 'ferris' }), post({ author: null }))).toBeNull();
  });

  it('flair: substring of link flair', () => {
    expect(match(rule({ type: 'flair', pattern: 'new' }))).not.toBeNull();
    expect(match(rule({ type: 'flair', pattern: 'new' }), post({ flair: null }))).toBeNull();
  });

  it('nsfw: matches NSFW posts regardless of pattern', () => {
    expect(match(rule({ type: 'nsfw' }), post({ nsfw: true }))).not.toBeNull();
    expect(match(rule({ type: 'nsfw' }))).toBeNull();
  });

  it('disabled rules never match', () => {
    expect(match(rule({ pattern: 'rust', enabled: false }))).toBeNull();
  });
});

describe('scope', () => {
  const pics = post({ subreddit: 'pics', title: 'rust on a bridge' });

  it('everywhere applies everywhere', () => {
    expect(match(rule({ pattern: 'rust' }), pics, { ...page, subreddit: 'pics' })).not.toBeNull();
  });

  it('only: applies on /r/all but not when visiting the subreddit directly', () => {
    const r = rule({ type: 'subreddit', pattern: 'pics', scope: 'only', subreddits: 'all' });
    expect(match(r, pics, { ...page, subreddit: 'all' })).not.toBeNull();
    expect(match(r, pics, { ...page, subreddit: 'pics' })).toBeNull();
  });

  it('only: also matches by the post’s own subreddit', () => {
    const r = rule({ pattern: 'rust', scope: 'only', subreddits: 'pics, aww' });
    expect(match(r, pics, { ...page, subreddit: undefined })).not.toBeNull();
    expect(match(r, post(), { ...page, subreddit: undefined })).toBeNull();
  });

  it('except: applies everywhere but the listed subreddits', () => {
    const r = rule({ pattern: 'rust', scope: 'except', subreddits: 'pics' });
    expect(match(r, pics, { ...page, subreddit: 'all' })).toBeNull();
    expect(match(r, post(), { ...page, subreddit: 'all' })).not.toBeNull();
  });

  it('a rule tied to a custom toggle applies only while the toggle is on', () => {
    const r = rule({ pattern: 'rust', toggle: 'work' });
    expect(match(r, post(), { ...page, toggleOn: (n) => n !== 'work' })).toBeNull();
    expect(match(r, post(), { ...page, toggleOn: () => true })).not.toBeNull();
  });
});

describe('validation', () => {
  it('rejects at input: invalid regex, empty pattern, scoped rule without subreddits', () => {
    expect(validateRule(rule({ pattern: '/(x/' }))).toMatch(/regular expression/i);
    expect(validateRule(rule({ pattern: '  ' }))).toMatch(/pattern/i);
    expect(validateRule(rule({ type: 'nsfw', pattern: '' }))).toBeNull();
    expect(validateRule(rule({ pattern: 'x', scope: 'only', subreddits: '' }))).toMatch(
      /subreddit/i,
    );
    expect(validateRule(rule({ pattern: 'x' }))).toBeNull();
  });

  it('disables invalid stored rules at load and reports them', () => {
    const { rules, errors } = compileRules([rule({ pattern: 'ok' }), rule({ pattern: '/(bad/' })]);
    expect(rules).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/bad/);
  });
});
