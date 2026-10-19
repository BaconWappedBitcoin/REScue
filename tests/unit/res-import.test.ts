import { describe, expect, it, vi } from 'vitest';
import { defaultProfile } from '../../src/core/settings';
import type { ModuleContext } from '../../src/core/types';
import {
  MAX_IMPORT_BYTES,
  convertFilters,
  convertTags,
  describeReport,
  mergeRules,
  mergeTags,
  parseResBackup,
  planImport,
  resImport,
} from '../../src/modules/core/resImport';
import type { FilterRule } from '../../src/modules/listings/filteReddit/rules';

// Synthetic data in the shapes RES writes (userTagger.js tagStorage, filteReddit.js options).
const modernStorage = () => ({
  'tag.alice': {
    text: 'friend',
    color: 'orange',
    link: 'https://example.com/a',
    votesUp: 5,
    votesDown: 2,
  },
  'tag.bob_the_user': { text: 'spammer', color: '#F00', link: 'javascript:alert(1)' },
  'tag.carol': { votesUp: 1 },
  'tag.dave': { color: 'red' },
  'tag.eve': { text: 'x'.repeat(300), color: 'chartreuse' },
  'tag.__proto__': { text: 'pwned' },
  'tag.not valid!': { text: 'bad' },
  'tag.frank': {},
  'RESoptions.filteReddit': {
    NSFWfilter: { value: true },
    keywords: {
      value: [
        ['spoiler', 'everywhere', '', ''],
        ['/lawsuit|trial/i', 'exclude', 'law,/r/LegalAdvice', ''],
        ['/broken(/', 'everywhere', '', ''],
        ['politics', 'everywhere', '', 'sports'],
        ['only here', 'include', '', ''],
        ['', 'everywhere', '', ''],
      ],
    },
    subreddits: { value: [['/r/Funny'], ['askreddit']] },
    domains: { value: [['example.com', 'everywhere', '']] },
    flair: { value: [['Meme', 'include', 'pics']] },
    users: { value: [['Troll_One'], ['bad name']] },
    comments: { value: [['nope', 'everywhere', '']] },
    customFiltersP: { value: [{ opts: { name: 'My filter' }, body: {} }] },
    allowNSFW: { value: [['gonewild', 'everywhere']] },
  },
});

const wrap = (data: object) => JSON.stringify({ SCHEMA_VERSION: 2, data });

describe('parseResBackup', () => {
  it('reads schema 2, schema 1 and schema 0 wrappers like RES serialization.js', () => {
    expect(parseResBackup(wrap({ a: 1 }))).toEqual({ ok: true, storage: { a: 1 } });
    expect(parseResBackup(JSON.stringify({ SCHEMA_VERSION: 1, a: { b: 2 } }))).toEqual({
      ok: true,
      storage: { a: { b: 2 } },
    });
    const v0 = parseResBackup(JSON.stringify({ a: '{"b":2}', c: 'not json' }));
    expect(v0).toEqual({ ok: true, storage: { a: { b: 2 }, c: 'not json' } });
  });

  it('rejects bad JSON, non-objects, a missing data block and REScue backups', () => {
    for (const text of ['{nope', '[1,2]', '"x"', JSON.stringify({ SCHEMA_VERSION: 2 })]) {
      expect(parseResBackup(text).ok).toBe(false);
    }
    const r = parseResBackup(JSON.stringify({ format: 'rescue-backup', data: {} }));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/REScue backup/) });
  });

  it('refuses text over the size cap without parsing it', () => {
    const r = parseResBackup(' '.repeat(MAX_IMPORT_BYTES + 1));
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/20 MB/) });
  });

  it('does not let a __proto__ key reach Object.prototype', () => {
    const r = parseResBackup('{"SCHEMA_VERSION":1,"__proto__":{"polluted":true},"x":1}');
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('convertTags', () => {
  const { tags, skipped, found } = convertTags(modernStorage(), 1000);

  it('maps text, colour names and hex, links and the vote tally', () => {
    expect(tags.alice).toEqual({
      username: 'alice',
      text: 'friend',
      color: '#ffa500',
      link: 'https://example.com/a',
      votesUp: 5,
      votesDown: 2,
      voteTally: 3,
      ignored: false,
      updatedAt: 1000,
    });
    expect(tags.bob_the_user).toMatchObject({ text: 'spammer', color: '#ff0000' });
  });

  it('drops non-http(s) links, unknown colours and over-long text, and says so', () => {
    expect(tags.bob_the_user!.link).toBeUndefined();
    expect(tags.eve!.color).toBeUndefined();
    expect(tags.eve!.text).toHaveLength(100);
    expect(skipped.join('\n')).toMatch(/bob_the_user.*link is not http\(s\)/);
    expect(skipped.join('\n')).toMatch(/eve.*chartreuse/);
  });

  it('keeps a vote-only entry and skips colour-only, empty and invalid ones', () => {
    expect(tags.carol).toMatchObject({ votesUp: 1, votesDown: 0, voteTally: 1, ignored: false });
    expect(tags.carol!.text).toBeUndefined();
    expect(tags.dave).toBeUndefined();
    expect(tags.frank).toBeUndefined();
    expect(Object.keys(tags).sort()).toEqual(['alice', 'bob_the_user', 'carol', 'eve']);
    expect(skipped.join('\n')).toMatch(/dave.*nothing to keep/);
    expect(skipped.join('\n')).toMatch(/not a valid Reddit username/);
    expect(found).toBe(8);
  });

  it('never creates a __proto__ entry', () => {
    expect(Object.getPrototypeOf(tags)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(tags, '__proto__')).toBe(false);
  });

  it('reads the older single-object format, lower-casing keys', () => {
    const legacy = convertTags(
      {
        'RESmodules.userTagger.tags': {
          Zed: {
            tag: 'old',
            color: 'navy',
            link: 'http://a.test/x http://b.test/',
            votes: '4',
            ignore: true,
          },
          Quiet: { ignore: true },
        },
      },
      5,
    );
    expect(legacy.tags.zed).toMatchObject({
      text: 'old',
      color: '#000080',
      link: 'http://a.test/x',
      votesUp: 4,
      votesDown: 0,
      voteTally: 4,
      ignored: true,
    });
    expect(legacy.tags.quiet).toMatchObject({ ignored: true, voteTally: 0 });
  });

  it('keeps RES up and down counts separately, even when they cancel out', () => {
    const split = convertTags(
      { 'tag.even': { votesUp: 4, votesDown: 4 }, 'tag.neg': { votesDown: 2 } },
      5,
    );
    expect(split.tags.even).toMatchObject({ votesUp: 4, votesDown: 4, voteTally: 0 });
    expect(split.tags.neg).toMatchObject({ votesUp: 0, votesDown: 2, voteTally: -2 });
    const legacyNeg = convertTags(
      { 'RESmodules.userTagger.tags': { Neg: { tag: 'x', votes: '-3' } } },
      5,
    );
    expect(legacyNeg.tags.neg).toMatchObject({ votesUp: 0, votesDown: 3, voteTally: -3 });
  });
});

describe('convertFilters', () => {
  const f = convertFilters(modernStorage());

  it('maps each table to a rule type with scope and subreddits', () => {
    const key = (r: FilterRule) => `${r.type}|${r.pattern}|${r.scope}|${r.subreddits}`;
    expect(f.rules.map(key)).toEqual([
      'keyword|spoiler|everywhere|',
      'keyword|/lawsuit|trial/i|except|law,LegalAdvice',
      'subreddit|Funny|everywhere|',
      'subreddit|askreddit|everywhere|',
      'domain|example.com|everywhere|',
      'flair|Meme|only|pics',
      'user|Troll_One|everywhere|',
      'user|bad name|everywhere|',
    ]);
    expect(f.rules.every((r) => r.enabled && r.toggle === '')).toBe(true);
  });

  it('skips and lists a regex that does not compile, an "unless" keyword and a scope without subreddits', () => {
    const text = f.skipped.join('\n');
    expect(text).toMatch(/keyword filter “\/broken\(\/”.*regular expression/);
    expect(text).toMatch(/keyword filter “politics”.*unless/);
    expect(text).toMatch(/keyword filter “only here”.*at least one subreddit/);
    expect(f.rules.some((r) => r.pattern === '/broken(/')).toBe(false);
  });

  it('lists the options with no equivalent', () => {
    const text = f.skipped.join('\n');
    expect(text).toMatch(/comment filter “nope”/);
    expect(text).toMatch(/custom filter “My filter”/);
    expect(text).toMatch(/NSFW exception for “gonewild”/);
  });

  it('reads the NSFW switch and ignores blank rows', () => {
    expect(f.hideNsfw).toBe(true);
    expect(f.rules.some((r) => r.pattern === '')).toBe(false);
    expect(convertFilters({}).hideNsfw).toBeUndefined();
    expect(convertFilters({ 'RESoptions.filteReddit': 'junk' }).rules).toEqual([]);
  });

  it('tolerates malformed rows', () => {
    const r = convertFilters({
      'RESoptions.filteReddit': {
        keywords: { value: [null, 5, 'x', [1, 2], ['ok', 'weird', '', '']] },
      },
    });
    expect(r.rules).toEqual([]);
    expect(r.skipped.join('\n')).toMatch(/unknown scope “weird”/);
  });
});

describe('merging', () => {
  const mine = {
    alice: {
      username: 'Alice',
      text: 'mine',
      votesUp: 0,
      votesDown: 0,
      voteTally: 0,
      ignored: false,
      updatedAt: 1,
    },
    zoe: {
      username: 'zoe',
      text: 'z',
      votesUp: 0,
      votesDown: 0,
      voteTally: 0,
      ignored: false,
      updatedAt: 1,
    },
  };
  const { tags } = convertTags(modernStorage(), 9);

  it('merge keeps existing tags and adds new users', () => {
    const m = mergeTags(mine, tags, 'merge');
    expect(m.tags.alice!.text).toBe('mine');
    expect(m.tags.zoe).toBeDefined();
    expect(m).toMatchObject({ added: 3, replaced: 0, kept: 1 });
  });

  it('replace overwrites matching users only', () => {
    const m = mergeTags(mine, tags, 'replace');
    expect(m.tags.alice!.text).toBe('friend');
    expect(m.tags.zoe!.text).toBe('z');
    expect(m).toMatchObject({ added: 3, replaced: 1, kept: 0 });
  });

  const rule = (pattern: string, type: FilterRule['type'] = 'keyword'): FilterRule => ({
    type,
    pattern,
    scope: 'everywhere',
    subreddits: '',
    enabled: true,
    toggle: '',
  });

  it('merge appends rules not already present and counts duplicates', () => {
    const m = mergeRules([rule('Spoiler')], [rule('spoiler'), rule('new'), rule('new')], 'merge');
    expect(m.rules.map((r) => r.pattern)).toEqual(['Spoiler', 'new']);
    expect(m).toMatchObject({ added: 1, duplicates: 2 });
  });

  it('replace swaps the list, but an empty import leaves it alone', () => {
    expect(mergeRules([rule('a')], [rule('b')], 'replace').rules.map((r) => r.pattern)).toEqual([
      'b',
    ]);
    expect(mergeRules([rule('a')], [], 'replace').rules.map((r) => r.pattern)).toEqual(['a']);
  });
});

describe('planImport and describeReport', () => {
  const current = { tags: {}, rules: [], hideNsfw: false };

  it('summarises what came in and what was skipped', () => {
    const plan = planImport(modernStorage(), current, 'merge', 1);
    expect(plan.hideNsfw).toBe(true);
    expect(plan.report).toMatchObject({ tagsAdded: 4, rulesAdded: 8, nsfwChanged: true });
    const text = describeReport(plan.report);
    expect(text).toMatch(/^Imported 4 user tags and 8 filters and the NSFW filter switch\./);
    expect(text).toMatch(/Skipped or changed \d+:/);
    expect(text).toMatch(/more \(listed in the browser console\)/);
  });

  it('merge never turns the NSFW filter off; replace follows the file', () => {
    const off = { 'RESoptions.filteReddit': { NSFWfilter: { value: false } } };
    const on = { ...current, hideNsfw: true };
    expect(planImport(off, on, 'merge', 1).hideNsfw).toBeUndefined();
    expect(planImport(off, on, 'replace', 1).hideNsfw).toBe(false);
  });

  it('says so when the file has nothing for REScue', () => {
    const plan = planImport({ 'RESoptions.keyboardNav': {} }, current, 'merge', 1);
    expect(describeReport(plan.report)).toMatch(/Nothing to import/);
  });
});

describe('resImport action', () => {
  const action = resImport.actions![0]!;

  function setup(over: Record<string, unknown> = {}) {
    let profile = defaultProfile();
    let tags: unknown = {};
    const notices: Array<{ msg: string; kind?: string }> = [];
    const ctx = {
      moduleId: 'resImport',
      options: { importMode: 'merge', ...over },
      notices: {
        show: (msg: string, o?: { kind?: string }) => notices.push({ msg, kind: o?.kind }),
      },
      data: {
        get: async () => tags,
        set: (_k: string, v: unknown) => void (tags = v),
      },
      settings: {
        profile: () => profile,
        save: async (p: typeof profile) => void (profile = p),
      },
    } as unknown as ModuleContext;
    return { ctx, notices, get: () => ({ profile, tags }) };
  }
  const file = (text: string) => new File([text], 'res.json', { type: 'application/json' });

  it('is a file action in the settings console', () => {
    expect(action.kind).toBe('file');
    expect(resImport.resId).toBe('backupAndRestore');
  });

  it('writes tags to userTags and rules to the filteReddit option, then reports', async () => {
    const s = setup();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    await action.run(s.ctx, file(wrap(modernStorage())));
    const { profile, tags } = s.get();
    expect(Object.keys(tags as object).sort()).toEqual(['alice', 'bob_the_user', 'carol', 'eve']);
    const opts = profile.modules.filteReddit!.options!;
    expect((opts.rules as unknown[]).length).toBe(8);
    expect(opts.hideNsfw).toBe(true);
    expect(s.notices[0]!.msg).toMatch(/Imported 4 user tags and 8 filters/);
    expect(s.notices[0]!.kind).toBe('warning');
  });

  it('writes nothing for a file that is not an RES backup', async () => {
    const s = setup();
    await action.run(s.ctx, file('{broken'));
    expect(s.get().tags).toEqual({});
    expect(s.get().profile.modules.filteReddit).toBeUndefined();
    expect(s.notices[0]).toMatchObject({
      kind: 'error',
      msg: expect.stringMatching(/not valid JSON/),
    });
  });

  it('refuses a file over the size cap before reading it', async () => {
    const s = setup();
    const big = file('{}');
    Object.defineProperty(big, 'size', { value: MAX_IMPORT_BYTES + 1 });
    const text = vi.spyOn(big, 'text');
    await action.run(s.ctx, big);
    expect(text).not.toHaveBeenCalled();
    expect(s.notices[0]!.kind).toBe('error');
  });
});
