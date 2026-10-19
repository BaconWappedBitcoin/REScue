import { describe, expect, it } from 'vitest';
import {
  checkExpression,
  compileExpression,
} from '../../src/modules/listings/filteReddit/conditions';
import {
  browseConditions,
  compileBrowse,
  type BrowseEnv,
} from '../../src/modules/listings/filteReddit/browseConditions';
import {
  compilePostCondition,
  postConditions,
  type PostEnv,
} from '../../src/modules/listings/filteReddit/postConditions';
import {
  compileCommentCondition,
  type CommentEnv,
} from '../../src/modules/listings/filteReddit/commentConditions';
import {
  compileCommentRules,
  matchComment,
  validateCommentRule,
} from '../../src/modules/listings/filteReddit/commentRules';
import {
  compileRules,
  matchPost,
  validateRule,
  type FilterRule,
} from '../../src/modules/listings/filteReddit/rules';
import { navCategory, submitTarget } from '../../src/modules/core/commandBuiltins';
import { matchesCategory, type NavSets } from '../../src/modules/comments/navigatorFilters';
import type { Comment, Post } from '../../src/model/types';

const NOW = new Date('2026-03-07T22:30:00').getTime(); // a Saturday

const browse = (over: Partial<BrowseEnv> = {}): BrowseEnv => ({
  route: { kind: 'front', path: '/' },
  location: '/',
  me: 'joel',
  now: NOW,
  toggleOn: (n) => n === 'work',
  ...over,
});

const postEnv = (over: Partial<PostEnv> = {}): PostEnv => ({
  ...browse(),
  userTag: (a) => (a === 'ferris' ? 'crab' : undefined),
  votes: (a) => (a === 'ferris' ? { up: 1, down: 4 } : undefined),
  friends: new Set(['pal']),
  ignored: () => false,
  readPrior: () => null,
  ...over,
});

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
    score: 7,
    upvoteRatio: 1,
    commentCount: 40,
    created: new Date(NOW - 3 * 3600e3),
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

const holds = (text: string, p: Post = post(), env: PostEnv = postEnv()): boolean => {
  const c = compilePostCondition(text);
  if (!c.ok) throw new Error(c.error);
  return c.test(p, env);
};

describe('condition expressions', () => {
  it('joins with and / or / not and parentheses', () => {
    expect(holds('score<10 and comments>30')).toBe(true);
    expect(holds('score>10 or comments>30')).toBe(true);
    expect(holds('not nsfw and not spoiler')).toBe(true);
    expect(holds('nsfw or (score<10 and domain:blog.rust-lang.org)')).toBe(true);
    expect(holds('not (score<10 and comments>30)')).toBe(false);
  });

  it('binds and tighter than or', () => {
    expect(holds('nsfw and spoiler or score<10')).toBe(true);
    expect(holds('nsfw and (spoiler or score<10)')).toBe(false);
  });

  it('quotes values with spaces and parentheses', () => {
    expect(
      holds('keyword:"rust 2.0 (released)"', post({ title: 'Rust 2.0 (released) today' })),
    ).toBe(true);
    expect(checkExpression('keyword:/^rust \\d/i', postConditions)).toMatch(/Join/); // a space ends the token
    expect(holds('keyword:"/^rust \\d/i"')).toBe(true);
  });

  it('explains mistakes', () => {
    expect(checkExpression('', postConditions)).toMatch(/Enter a condition/);
    expect(checkExpression('score<5 and', postConditions)).toMatch(/ends too soon/);
    expect(checkExpression('(score<5', postConditions)).toMatch(/matching/);
    expect(checkExpression('score<5)', postConditions)).toMatch(/matching|Join/);
    expect(checkExpression('score<5 nsfw', postConditions)).toMatch(/Join conditions/);
    expect(checkExpression('flavour:x', postConditions)).toMatch(/Unknown condition/);
    expect(checkExpression('score', postConditions)).toMatch(/comparison/);
    expect(checkExpression('nsfw:yes', postConditions)).toMatch(/no value/);
    expect(checkExpression('keyword:"oops', postConditions)).toMatch(/quote/);
    expect(checkExpression('keyword:"/(/"', postConditions)).toMatch(/regular expression/);
    expect(checkExpression('type:bogus', postConditions)).toMatch(/choose one/);
    expect(checkExpression('selector:"[[["', postConditions)).toMatch(/CSS/);
    expect(checkExpression('attr:mod', postConditions)).toMatch(/not shown on posts/);
  });

  it('is generic over its table', () => {
    const r = compileExpression<number, null>('even', {
      even: { help: '', check: () => null, build: () => (n) => n % 2 === 0 },
    });
    expect(r.ok && r.test(4, null)).toBe(true);
  });
});

describe('post conditions (RES post cases)', () => {
  it('score, comments, flair, user, subreddit, domain, post type', () => {
    expect(holds('score<=7 and score>=7')).toBe(true);
    expect(holds('flair:new')).toBe(true);
    expect(holds('user:ferris and subreddit:programming')).toBe(true);
    expect(holds('user:fer')).toBe(false); // exact
    expect(holds('type:link and expando:link')).toBe(true);
    expect(holds('score>0', post({ score: null }))).toBe(false);
  });

  it('PostAge / PostAfter', () => {
    expect(holds('age<4h')).toBe(true);
    expect(holds('age>4')).toBe(false);
    expect(holds('age>1d')).toBe(false);
    expect(holds('after:2026-03-07')).toBe(true);
    expect(holds('after:2026-03-08')).toBe(false);
    expect(holds('before:2026-03-08')).toBe(true);
    expect(holds('age<1d', post({ created: null }))).toBe(false);
  });

  it('UserTag, UserVoteWeight, UserAttr', () => {
    expect(holds('usertag')).toBe(true);
    expect(holds('usertag:crab')).toBe(true);
    expect(holds('usertag:dog')).toBe(false);
    expect(holds('voteweight<-2')).toBe(true);
    expect(holds('attr:tagged and not attr:friend')).toBe(true);
    expect(holds('attr:friend', post({ author: 'pal' }))).toBe(true);
    expect(holds('attr:me', post({ author: 'Joel' }))).toBe(true);
  });

  it('CommentsOpened / NewCommentCount need read tracking', () => {
    expect(holds('opened')).toBe(false);
    expect(holds('newcomments>0')).toBe(false);
    const seen = postEnv({ readPrior: () => ({ lastVisit: 1, commentCountAtVisit: 30 }) });
    expect(holds('opened', post(), seen)).toBe(true);
    expect(holds('newcomments>=10', post(), seen)).toBe(true);
    expect(holds('newcomments>10', post(), seen)).toBe(false);
  });

  it('Selector matches the post element', () => {
    const el = document.createElement('div');
    el.className = 'promoted';
    expect(holds('selector:".promoted"', post({ source: el }))).toBe(true);
    expect(holds('selector:".other"', post({ source: el }))).toBe(false);
  });

  it('VoteType reads the buttons in the open shadow root', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      '<button upvote aria-pressed="true"></button><button downvote aria-pressed="false"></button>';
    expect(holds('vote:up', post({ source: host }))).toBe(true);
    expect(holds('vote:none', post({ source: host }))).toBe(false);
    expect(holds('vote:up')).toBe(false); // no shadow root: unknown, never matches
    expect(holds('vote:none')).toBe(false);
  });
});

describe('browse conditions (RES browse cases)', () => {
  const on = (text: string, env: Partial<BrowseEnv> = {}): boolean => {
    const c = compileBrowse(text);
    if (!c.ok) throw new Error(c.error);
    return c.test(undefined, browse(env));
  };

  it('front page, subreddit, multireddit, profile', () => {
    expect(on('front')).toBe(true);
    expect(on('front', { route: { kind: 'subreddit', path: '/r/rust', subreddit: 'rust' } })).toBe(
      false,
    );
    const sub = { route: { kind: 'subreddit' as const, path: '/r/rust', subreddit: 'Rust' } };
    expect(on('onsub:rust,go', sub)).toBe(true);
    expect(on('onsub:go', sub)).toBe(false);
    expect(on('onsub', sub)).toBe(true);
    const multi = {
      route: { kind: 'customFeed' as const, path: '/user/a/m/News/', username: 'a' },
    };
    expect(on('onmulti:news', multi)).toBe(true);
    expect(on('onmulti', multi)).toBe(true);
    expect(on('onmulti:other', multi)).toBe(false);
    const prof = { route: { kind: 'profile' as const, path: '/user/bob/', username: 'bob' } };
    expect(on('onuser:bob', prof)).toBe(true);
    expect(on('onuser:al', prof)).toBe(false);
  });

  it('location, login, toggle', () => {
    expect(on('location:"/r/rust/top"', { location: '/r/rust/top/?t=week' })).toBe(true);
    expect(on('location:"/^\\/search/"', { location: '/search/?q=a' })).toBe(true);
    expect(on('loggedin:joel')).toBe(true);
    expect(on('loggedin:other')).toBe(false);
    expect(on('loggedin', { me: null })).toBe(false);
    expect(on('toggle:work')).toBe(true);
    expect(on('toggle:play')).toBe(false);
  });

  it('date, weekday and hour', () => {
    expect(on('date:2026-03-01..2026-03-31')).toBe(true);
    expect(on('date:2026-04-01..')).toBe(false);
    expect(on('date:..2026-03-07T22:00')).toBe(false);
    expect(on('dow:sat,sun')).toBe(true);
    expect(on('dow:mon')).toBe(false);
    expect(on('hour:22..6')).toBe(true);
    expect(on('hour:9..17')).toBe(false);
    expect(checkExpression('hour:25..1', browseConditions)).toMatch(/hour/);
    expect(checkExpression('dow:funday', browseConditions)).toMatch(/day names/);
  });
});

describe('custom post rules', () => {
  const rule = (over: Partial<FilterRule>): FilterRule => ({
    type: 'custom',
    pattern: '',
    scope: 'everywhere',
    subreddits: '',
    enabled: true,
    toggle: '',
    ...over,
  });
  const run = (r: FilterRule, p = post(), env = postEnv()) => {
    const { rules, errors } = compileRules([r]);
    return {
      errors,
      hit: matchPost(p, rules, { subreddit: undefined, toggleOn: () => true, env }),
    };
  };

  it('hides when the expression holds', () => {
    expect(run(rule({ pattern: 'score<10 and flair:news' })).hit).not.toBeNull();
    expect(run(rule({ pattern: 'score>10' })).hit).toBeNull();
  });

  it('validates at input time', () => {
    expect(validateRule(rule({ pattern: 'score<' }))).toMatch(/comparison/);
    expect(validateRule(rule({ pattern: 'score<5' }))).toBeNull();
    expect(validateRule(rule({ pattern: 'nsfw', when: 'front and bogus' }))).toMatch(
      /Only when browsing/,
    );
  });

  it('"only when browsing" limits any rule type', () => {
    const r = { type: 'keyword' as const, pattern: 'rust', when: 'dow:sat' };
    expect(run(rule(r)).hit).not.toBeNull();
    expect(run(rule({ ...r, when: 'dow:mon' })).hit).toBeNull();
    expect(run(rule({ ...r, when: 'front or onuser' })).hit).not.toBeNull();
  });

  it('a rule with conditions never matches without the browsing environment', () => {
    const { rules } = compileRules([rule({ type: 'keyword', pattern: 'rust', when: 'front' })]);
    expect(matchPost(post(), rules, { subreddit: undefined, toggleOn: () => true })).toBeNull();
  });
});

const comment = (over: Partial<Comment> = {}): Comment => ({
  kind: 'comment',
  id: 't1_a',
  postId: 't3_x',
  parentId: null,
  depth: 0,
  author: 'ferris',
  isOp: false,
  distinguished: null,
  score: 3,
  created: new Date(1000),
  bodyHtml: '<p>hello world</p>',
  permalink: null,
  source: document.createElement('div'),
  ...over,
});

const commentEnv = (over: Partial<CommentEnv> = {}): CommentEnv => ({
  ...browse(),
  friends: new Set(['pal']),
  userTag: () => undefined,
  ignored: () => false,
  readPrior: { lastVisit: 2000, commentCountAtVisit: 1 },
  ...over,
});

const facts = (c: Comment, body = 'hello world') => ({
  author: c.author,
  depth: c.depth,
  body,
  score: c.score,
  isOp: c.isOp,
  distinguished: c.distinguished,
  created: c.created,
});

describe('custom comment rules (RES comment cases)', () => {
  const run = (text: string, c = comment(), body = 'hello world', env = commentEnv()) => {
    const r = compileCommentCondition(text);
    if (!r.ok) throw new Error(r.error);
    return r.test(facts(c, body), env);
  };

  it('CommentLength in characters and words', () => {
    expect(run('length<20')).toBe(true);
    expect(run('length>5w')).toBe(false);
    expect(run('length>=2w and length<3w')).toBe(true);
  });

  it('IsRead, depth, score, attr', () => {
    expect(run('read')).toBe(true);
    expect(run('new')).toBe(false);
    expect(run('read', comment(), 'x', commentEnv({ readPrior: null }))).toBe(false);
    expect(run('depth>=1')).toBe(false);
    expect(run('score<5 and attr:op', comment({ isOp: true }))).toBe(true);
    expect(run('attr:mod or attr:admin', comment({ distinguished: 'admin' }))).toBe(true);
    expect(run('attr:friend', comment({ author: 'pal' }))).toBe(true);
  });

  it('works through comment rules, with the browse column', () => {
    const rows = [
      {
        type: 'custom' as const,
        pattern: 'length<20 and not attr:op',
        action: 'hide' as const,
        enabled: true,
        when: 'front',
      },
    ];
    const { rules, errors } = compileCommentRules(rows);
    expect(errors).toEqual([]);
    expect(matchComment(facts(comment()), rules, commentEnv())).not.toBeNull();
    expect(matchComment(facts(comment()), rules)).toBeNull();
    expect(
      matchComment(facts(comment()), rules, commentEnv({ route: { kind: 'all', path: '/r/all' } })),
    ).toBeNull();
    expect(validateCommentRule({ ...rows[0]!, pattern: 'length<' })).toMatch(/length/);
    expect(validateCommentRule({ ...rows[0]!, when: 'nope' })).toMatch(/Only when browsing/);
  });
});

describe('comment navigator categories', () => {
  const sets = (over: Partial<NavSets> = {}): NavSets => ({
    friends: new Set(),
    tagged: new Set(),
    popularScore: 100,
    isNew: () => false,
    ...over,
  });

  it('highlighted users', () => {
    const s = sets({ highlighted: new Set(['ferris']) });
    expect(matchesCategory(comment(), 'highlighted', s)).toBe(true);
    expect(matchesCategory(comment({ author: 'x' }), 'highlighted', s)).toBe(false);
  });

  it('custom needs a condition; popular conditions replace the score test', () => {
    expect(matchesCategory(comment(), 'custom', sets())).toBe(false);
    expect(matchesCategory(comment(), 'custom', sets({ custom: () => true }))).toBe(true);
    expect(matchesCategory(comment({ score: 500 }), 'popular', sets())).toBe(true);
    expect(
      matchesCategory(comment({ score: 500 }), 'popular', sets({ isPopular: () => false })),
    ).toBe(false);
  });
});

describe('new command-line commands', () => {
  it('nav picks a category by value or label', () => {
    expect(navCategory('op')).toBe('op');
    expect(navCategory('Moder')).toBe('moderator');
    expect(navCategory('high')).toBe('highlighted');
    expect(navCategory('nonsense')).toBeUndefined();
  });

  it('post opens Reddit’s own submit page, filled in by URL', () => {
    expect(submitTarget('').path).toBe('/submit');
    expect(submitTarget('rust').path).toBe('/r/rust/submit');
    expect(submitTarget('r/rust Hello there').path).toBe('/r/rust/submit?title=Hello%20there');
    expect(submitTarget('rust Cool https://example.com/a?b=1').path).toBe(
      '/r/rust/submit?title=Cool&url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1',
    );
  });
});
