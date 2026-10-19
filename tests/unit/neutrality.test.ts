import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveOptions } from '../../src/core/settings';
import type { ModuleContext, ModuleDefinition, OptionValue } from '../../src/core/types';
import { filteReddit } from '../../src/modules/listings/filteReddit';
import { FALLBACK_CREDITS, neutralityFilter } from '../../src/modules/listings/neutralityFilter';
import {
  IGNORED_DOMAINS,
  SOURCE_CITE,
  THRESHOLDS,
  allowSet,
  hides,
  isAllowed,
  leanReason,
  linkDomain,
  lookup,
  type Lean,
  type Level,
} from '../../src/modules/listings/neutralityFilter/scoring';
import {
  buildData,
  linearFit,
  normaliseDomain,
  parseEady,
  parseScores,
  type NeutralityData,
} from '../../scripts/build-neutrality-data';
import { listingHtml, mount, type FixturePost } from '../fixtures/pages';
import { bootModules, tick } from './module-harness';

const loadSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/modules/listings/neutralityFilter/data', () => ({
  loadNeutralityData: loadSpy,
}));

const DATA_PATH = resolve(__dirname, '../../src/data/neutrality-scores.json');
const data = JSON.parse(readFileSync(DATA_PATH, 'utf8')) as NeutralityData;
const meta = data.meta;

const lean = (score: number, domain = 'example.com'): Lean => ({
  domain,
  matched: domain,
  score,
  side: score < 0 ? 'left' : 'right',
});

describe('thresholds', () => {
  const LEVELS: Level[] = ['off', 'min', 'mid', 'max'];

  it('each level hides at its own cut-off and above, on its own side only', () => {
    for (const [level, cut] of Object.entries(THRESHOLDS) as Array<[Level, number]>) {
      // right side uses positive scores, left side the same magnitudes negated
      expect(hides(lean(cut), 'off', level)).toBe(true);
      expect(hides(lean(cut - 0.001), 'off', level)).toBe(false);
      expect(hides(lean(-cut), level, 'off')).toBe(true);
      expect(hides(lean(-(cut - 0.001)), level, 'off')).toBe(false);
      // the other side's setting never hides this side
      expect(hides(lean(cut), level, 'off')).toBe(false);
      expect(hides(lean(-cut), 'off', level)).toBe(false);
    }
  });

  it('is symmetric and nested: every level hides what a stricter one hides', () => {
    for (const score of [0.3, 0.45, 0.5, 0.61, 0.7, 0.742, 1]) {
      for (const sign of [1, -1]) {
        const l = lean(sign * score);
        const results = LEVELS.map((lv) => (sign < 0 ? hides(l, lv, 'off') : hides(l, 'off', lv)));
        // off, min, mid, max: once a level hides, every later (looser net) level hides too
        expect(results).toEqual([...results].sort((a, b) => Number(a) - Number(b)));
        expect(results[0]).toBe(false);
      }
    }
    expect(hides(lean(0.69), 'off', 'min')).toBe(false);
    expect(hides(lean(0.69), 'off', 'mid')).toBe(true);
    expect(hides(lean(-0.697), 'min', 'off')).toBe(false);
    expect(hides(lean(-0.697), 'mid', 'off')).toBe(true);
  });

  it('off hides nothing on either side', () => {
    expect(hides(lean(1), 'off', 'off')).toBe(false);
    expect(hides(lean(-1), 'off', 'off')).toBe(false);
  });
});

describe('domains', () => {
  const scores = { 'cnn.com': -0.4, 'edition.cnn.com': -0.9, 'example.com': 0.8 };

  it('matches the longest suffix present in the data', () => {
    expect(lookup(scores, 'edition.cnn.com')?.matched).toBe('edition.cnn.com');
    expect(lookup(scores, 'money.cnn.com')?.matched).toBe('cnn.com');
    expect(lookup({ 'cnn.com': -0.4 }, 'edition.cnn.com')?.matched).toBe('cnn.com');
    expect(lookup(scores, 'a.b.example.com')?.score).toBe(0.8);
  });

  it('does not match a different domain that merely ends with the same letters', () => {
    expect(lookup(scores, 'notcnn.com')).toBeNull();
    expect(lookup(scores, 'cnn.com.evil.org')).toBeNull();
    expect(lookup(scores, 'nowhere.org')).toBeNull();
  });

  it('cleans www., case and a trailing dot', () => {
    expect(linkDomain({ type: 'link', domain: 'WWW.Breitbart.com.' })).toBe('breitbart.com');
  });

  it('never scores text posts, self posts, Reddit-hosted media or the ignored platforms', () => {
    expect(linkDomain({ type: 'text', domain: 'self.politics' })).toBeNull();
    expect(linkDomain({ type: 'link', domain: 'self.politics' })).toBeNull();
    for (const domain of ['i.redd.it', 'v.redd.it', 'reddit.com', 'np.reddit.com']) {
      expect(linkDomain({ type: 'image', domain }), domain).toBeNull();
    }
    for (const domain of [
      'youtube.com',
      'm.youtube.com',
      'twitter.com',
      'x.com',
      'imgur.com',
      'i.imgur.com',
      'medium.com',
      'blog.medium.com',
      'substack.com',
      'someone.substack.com',
      'github.com',
      'gist.github.com',
    ]) {
      expect(linkDomain({ type: 'link', domain }), domain).toBeNull();
    }
    expect(IGNORED_DOMAINS).toContain('youtube.com');
    expect(linkDomain({ type: 'link', domain: 'nytimes.com' })).toBe('nytimes.com');
  });

  it('allow-list entries cover the domain and its subdomains, however they were typed', () => {
    const allow = allowSet(['Example.com', 'https://www.news.org/some/page', '', '  ']);
    expect(isAllowed(allow, 'example.com')).toBe(true);
    expect(isAllowed(allow, 'sub.example.com')).toBe(true);
    expect(isAllowed(allow, 'news.org')).toBe(true);
    expect(isAllowed(allow, 'other.com')).toBe(false);
    expect(isAllowed(allow, 'notexample.com')).toBe(false);
  });

  it('words for the reason', () => {
    expect(leanReason(lean(0.612), true)).toBe('audience lean right 0.61');
    expect(leanReason(lean(0.612), false)).toBe('neutrality');
  });

  it('lookup marks a score Eady only when the matched key is in the Eady set', () => {
    const scores = { 'cnn.com': -0.4, 'edition.cnn.com': -0.9, 'example.com': 0.8 };
    const fromEady = new Set(['cnn.com', 'example.com']);
    expect(lookup(scores, 'money.cnn.com', fromEady)?.source).toBe('eady');
    expect(lookup(scores, 'edition.cnn.com', fromEady)?.source).toBe('robertson');
    expect(lookup(scores, 'example.com', fromEady)?.source).toBe('eady');
    expect(lookup(scores, 'example.com')?.source).toBe('robertson');
  });
});

describe('the data file', () => {
  it('has the meta, the licence and nothing outside the range', () => {
    expect(meta.built).toBe('2026-10-16');
    expect(meta.sources.map((s) => s.id).sort()).toEqual(['eady', 'robertson']);
    const byId = Object.fromEntries(meta.sources.map((s) => [s.id, s]));
    expect(byId.eady).toMatchObject({ doi: '10.1017/pan.2024.19', licence: 'CC0 1.0' });
    expect(byId.robertson).toMatchObject({ doi: '10.7910/DVN/QAN5VX', licence: 'CC0 1.0' });
    for (const s of meta.sources)
      for (const key of ['title', 'authors', 'cite', 'url', 'period', 'year'] as const)
        expect(s[key], `${s.id}.${key}`).toBeTruthy();
    expect(meta.note).toMatch(/SHARES/);
    expect(meta.note).toMatch(/not .*neutral/);
    expect(meta.fit.n).toBeGreaterThan(100);
    expect(meta.fit.r).toBeGreaterThan(0.9);
    expect(meta.fit.a).toBeGreaterThan(0.3);
    expect(meta.fit.a).toBeLessThan(0.5);
    const total = Object.keys(data.scores).length;
    expect(meta.counts).toEqual({
      total,
      eady: meta.eady.length,
      robertson: total - meta.eady.length,
    });
    expect(total).toBeGreaterThan(1000);
    expect(meta.eady.length).toBeGreaterThan(50);
    for (const d of meta.eady) expect(data.scores[d], d).toBeDefined();
    expect(new Set(meta.eady).size).toBe(meta.eady.length);
    for (const s of meta.sources) expect(Object.values(SOURCE_CITE)).toContain(s.cite);
    for (const [domain, score] of Object.entries(data.scores)) {
      expect(Number.isFinite(score), domain).toBe(true);
      expect(Math.abs(score), domain).toBeLessThanOrEqual(1);
      expect(domain, domain).toBe(domain.toLowerCase());
      expect(domain, domain).not.toMatch(/^www\.|[:/]|\.ln\.is$/);
    }
  });

  it('holds the scores the browser specs rely on', () => {
    expect(data.scores['breitbart.com']).toBe(0.733);
    expect(data.scores['vox.com']).toBe(-0.61);
    expect(data.scores['infowars.com']).toBe(0.782);
    expect(meta.eady).toContain('breitbart.com');
    expect(meta.eady).toContain('vox.com');
    expect(meta.eady).not.toContain('infowars.com');
  });

  it('keeps every scored domain, centrist ones included, and moves outlets the newer data centres', () => {
    // Robertson had apnews.com at -0.328; mapped Eady is about -0.07: kept, and a "neutral" chip.
    expect(data.scores['apnews.com']).toBe(-0.072);
    expect(data.scores['reuters.com']).toBe(-0.046);
    expect(meta.eady).toContain('apnews.com');
    const faint = Object.values(data.scores).filter((s) => Math.abs(s) < 0.3).length;
    expect(faint).toBeGreaterThan(1000);
    expect(meta.counts.total).toBeGreaterThan(18000);
  });

  it('is described by the credits shown before it loads', () => {
    const text = FALLBACK_CREDITS.map((c) => c.label).join('\n');
    for (const s of meta.sources) {
      expect(text).toContain(s.doi);
      expect(text).toContain(s.licence);
    }
    expect(text).toContain('Eady');
    expect(text).toContain('Robertson');
    expect(FALLBACK_CREDITS.map((c) => c.href)).toEqual([
      'https://doi.org/10.7910/DVN/1QMLOV',
      'https://doi.org/10.7910/DVN/QAN5VX',
    ]);
  });
});

describe('build script', () => {
  const TAB = [
    'domain\tscore\tfb_score\tmturk_score',
    '"WWW.Right.com"\t0.7421\t0.5\t',
    '"left.org"\t-0.6974\t\t0.1',
    '"weak.com"\t0.299\t\t',
    '"edge.com"\t0.3\t\t',
    '"right.com"\t0.2\t\t',
    '"host.com:8080"\t0.9\t\t',
    '"a.com/path"\t0.9\t\t',
    '"tracker.ln.is"\t0.9\t\t',
    '"bad.com"\tNA\t\t',
    '"far.com"\t1.5\t\t',
    '"zed.com"\t-1\t\t',
    '',
  ].join('\r\n');

  it('normalises, drops junk keys and keeps the more partisan duplicate', () => {
    expect(normaliseDomain('"WWW.Example.COM"')).toBe('example.com');
    expect(normaliseDomain('a.com:80')).toBeNull();
    expect(normaliseDomain('a.com/x')).toBeNull();
    expect(normaliseDomain('x.ln.is')).toBeNull();
    const all = parseScores(TAB);
    expect(all['right.com']).toBe(0.742); // www. stripped, 0.742 beats the other row's 0.2
    expect(all['left.org']).toBe(-0.697);
    expect(all['host.com:8080']).toBeUndefined();
    expect(all['bad.com']).toBeUndefined();
    expect(all['far.com']).toBeUndefined();
  });

  // Overlap with TAB below: robertson = 0.4 * zeta - 0.08 for a..e, plus moved.com, which Eady
  // places at the centre although Robertson had it at -0.5.
  const OVERLAP_TAB = [
    '"a.com"\t-0.88',
    '"b.com"\t-0.48',
    '"c.com"\t-0.08',
    '"d.com"\t0.32',
    '"e.com"\t0.72',
    '"moved.com"\t-0.5',
    '"only.org"\t0.55',
    '"faint.org"\t0.29',
  ];
  const EADY = [
    'domain,zeta,zeta_lower90,zeta_upper90',
    'A.COM,-2,-2.1,-1.9',
    'A.COM,-2,-2.1,-1.9',
    'B.COM,-1,-1.1,-0.9',
    'C.COM,0,-0.1,0.1',
    'WWW.D.COM,1,0.9,1.1',
    'E.COM,2,1.9,2.1',
    'MOVED.COM,0,-0.1,0.1',
    'NEW.COM,2.5,2.4,2.6',
    'HUGE.COM,10,9,11',
    'NEG.COM,-10,-11,-9',
    'YAHOO.COM/NEWS,1,0,2',
    '',
  ].join('\n');
  const merged = (): NeutralityData =>
    buildData([TAB.split('\r\n')[0], ...OVERLAP_TAB].join('\r\n'), EADY, '2026-10-16');

  it('parses the Eady csv: upper-case domains, repeated rows averaged, paths dropped', () => {
    const z = parseEady(EADY);
    expect(z['a.com']).toBe(-2);
    expect(z['d.com']).toBe(1); // www. stripped
    expect(z['yahoo.com/news']).toBeUndefined();
    expect(Object.keys(z)).toHaveLength(9);
    expect(parseEady('domain,zeta\nX.COM,1\nX.COM,3')['x.com']).toBe(2);
    expect(() => parseEady('a,b\nx,1')).toThrow(/domain\/zeta/);
  });

  it('computes an ordinary least-squares fit with Pearson r', () => {
    expect(linearFit([0, 1, 2], [1, 3, 5])).toEqual({ a: 2, b: 1, r: 1, n: 3 });
    const down = linearFit([0, 1, 2, 3], [3, 1, 2, 0]);
    expect(down.a).toBeCloseTo(-0.8, 10);
    expect(down.r).toBeLessThan(0);
    expect(() => linearFit([1, 2], [1, 2])).toThrow(/at least 3/);
    expect(() => linearFit([1, 1, 1], [1, 2, 3])).toThrow(/variance/);
  });

  it('fits Robertson on Eady over the overlap at build time and records it', () => {
    const { fit } = merged().meta;
    expect(fit.n).toBe(6); // a, b, c, d, e, moved
    expect(fit.r).toBeGreaterThan(0.9);
    // the five exact points pin the slope near 0.4; moved.com pulls it a little
    expect(fit.a).toBeGreaterThan(0.3);
    expect(fit.a).toBeLessThan(0.45);
    expect(fit.b).toBeLessThan(0);
    const direct = linearFit([-2, -1, 0, 1, 2, 0], [-0.88, -0.48, -0.08, 0.32, 0.72, -0.5]);
    expect(fit.a).toBeCloseTo(direct.a, 5);
    expect(fit.b).toBeCloseTo(direct.b, 5);
    expect(fit.r).toBeCloseTo(direct.r, 5);
  });

  it('Eady overrides Robertson, adds Eady-only domains and clamps to [-1, 1]', () => {
    const { scores, meta: m } = merged();
    const map = (z: number): number =>
      Math.round(Math.max(-1, Math.min(1, m.fit.a * z + m.fit.b)) * 1000) / 1000;
    expect(scores['a.com']).toBe(map(-2));
    expect(scores['a.com']).not.toBe(-0.88); // replaced, not kept
    expect(scores['e.com']).toBe(map(2));
    expect(scores['new.com']).toBe(map(2.5)); // Eady only
    expect(scores['huge.com']).toBe(1);
    expect(scores['neg.com']).toBe(-1);
    expect(scores['only.org']).toBe(0.55); // Robertson only, untouched
  });

  it('keeps domains near the centre, with Eady replacing Robertson', () => {
    const { scores, meta: m } = merged();
    expect(Math.abs(scores['moved.com']!)).toBeLessThan(0.3); // Robertson -0.5, Eady about -0.1
    expect(m.eady).toContain('moved.com');
    expect(scores['c.com']).toBeDefined();
    expect(scores['faint.org']).toBe(0.29); // Robertson only, below the old 0.3 cut
    expect(m.eady).not.toContain('faint.org');
  });

  it('records which domains came from Eady, the counts, and both sources', () => {
    const { scores, meta: m } = merged();
    expect(m.eady).toEqual([...m.eady].sort());
    expect(m.eady).toEqual(expect.arrayContaining(['a.com', 'e.com', 'new.com', 'huge.com']));
    expect(m.eady).not.toContain('only.org');
    expect(m.counts).toEqual({
      total: Object.keys(scores).length,
      eady: m.eady.length,
      robertson: Object.keys(scores).length - m.eady.length,
    });
    expect(m.counts.robertson).toBe(Object.keys(scores).filter((d) => !m.eady.includes(d)).length);
    expect(m.sources.map((s) => [s.id, s.licence, s.doi])).toEqual([
      ['eady', 'CC0 1.0', '10.1017/pan.2024.19'],
      ['robertson', 'CC0 1.0', '10.7910/DVN/QAN5VX'],
    ]);
    expect(m.built).toBe('2026-10-16');
    expect(Object.keys(scores)).toEqual(Object.keys(scores).sort());
    expect(JSON.stringify(merged())).not.toMatch(/fb_score|mturk|zeta/);
  });

  it('refuses a file without the columns', () => {
    expect(() => parseScores('a\tb\nx\t1')).toThrow(/domain\/score/);
  });
});

describe('the module', () => {
  const post = (id: string, domain: string, extra: Partial<FixturePost> = {}): FixturePost => ({
    id,
    type: 'link',
    title: `Post ${id}`,
    permalink: `/r/politics/comments/${id.slice(3)}/x/`,
    contentHref: `https://${domain}/story`,
    domain,
    score: '10',
    comments: '1',
    author: 'someone',
    sub: 'politics',
    ...extra,
  });
  const POSTS: FixturePost[] = [
    post('t3_right', 'breitbart.com'),
    post('t3_left', 'vox.com'),
    post('t3_wwwright', 'www.Breitbart.com'),
    post('t3_unknown', 'nowhere-in-data.example'),
    post('t3_yt', 'youtube.com'),
    post('t3_img', 'i.redd.it', { type: 'image' }),
    post('t3_self', 'self.politics', { type: 'text' }),
  ];

  type Booted = Awaited<ReturnType<typeof bootModules>>;
  let booted: Booted | null = null;
  const defs: ModuleDefinition[] = [filteReddit, neutralityFilter];

  async function boot(
    options: Record<string, OptionValue> = {},
    route: { kind: string; path: string; subreddit?: string } = {
      kind: 'all',
      path: '/r/all/',
      subreddit: 'all',
    },
    posts = POSTS,
  ) {
    mount(listingHtml(posts));
    const m = await bootModules(defs, { route, options: { neutralityFilter: options } });
    booted = m;
    for (const d of defs) d.onRoute!(m.ctxs.get(d.id)!.route, m.ctxs.get(d.id)! as never);
    m.flush();
    await tick();
    return m;
  }

  /** What the registry does when the console changes the settings. */
  async function change(m: Booted, patch: Record<string, OptionValue>) {
    const ctx = m.ctxs.get('neutralityFilter')! as ModuleContext;
    const profile = ctx.settings.profile() as {
      modules: Record<string, { options: Record<string, OptionValue> }>;
    };
    const next = { ...(profile.modules.neutralityFilter?.options ?? {}), ...patch };
    profile.modules.neutralityFilter = { options: next };
    (ctx as { options: unknown }).options = resolveOptions(neutralityFilter, profile as never);
    neutralityFilter.onSettings!(ctx as never);
    await tick();
  }

  const hidden = (m: Booted, id: string) => m.deco.hiddenReason(id);

  beforeEach(() => {
    loadSpy.mockReset();
    loadSpy.mockImplementation(async () => data);
  });
  afterEach(() => {
    booted?.dispose();
    booted = null;
    document.body.innerHTML = '';
  });

  it('is off by default and hides nothing, and never loads its data', async () => {
    expect(neutralityFilter.enabledByDefault).toBe(false);
    expect(neutralityFilter.resId).toBeUndefined();
    const m = await boot();
    for (const p of POSTS) expect(hidden(m, p.id), p.id).toBeUndefined();
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('loads the data once, and only when a side is not off', async () => {
    const m = await boot({ left: 'off', right: 'off' });
    expect(loadSpy).not.toHaveBeenCalled();
    await change(m, { right: 'min' });
    expect(loadSpy).toHaveBeenCalledTimes(1);
    await change(m, { right: 'mid' });
    await change(m, { left: 'max' });
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('right=mid hides a right-leaning domain with its reason and leaves a left one', async () => {
    const m = await boot({ right: 'mid' });
    expect(hidden(m, 't3_right')).toBe('audience lean right 0.73');
    expect(hidden(m, 't3_wwwright')).toBe('audience lean right 0.73');
    expect(hidden(m, 't3_left')).toBeUndefined();
  });

  it('left strictness follows the boundary: -0.61 is not hidden at min, hidden at mid', async () => {
    const m = await boot({ left: 'min' });
    expect(hidden(m, 't3_left')).toBeUndefined();
    await change(m, { left: 'mid' });
    expect(hidden(m, 't3_left')).toBe('audience lean left 0.61');
    expect(hidden(m, 't3_right')).toBeUndefined();
  });

  it('options apply live, both ways, without a reload', async () => {
    const m = await boot({ right: 'max' });
    expect(hidden(m, 't3_right')).toBeDefined();
    await change(m, { right: 'off' });
    expect(hidden(m, 't3_right')).toBeUndefined();
    await change(m, { right: 'min' });
    expect(hidden(m, 't3_right')).toBeDefined(); // 0.733 >= 0.7
  });

  it('leaves text posts, Reddit media, platforms and unknown domains alone', async () => {
    const m = await boot({ left: 'max', right: 'max' });
    for (const id of ['t3_unknown', 't3_yt', 't3_img', 't3_self'])
      expect(hidden(m, id), id).toBeUndefined();
  });

  it('the allow-list wins, subdomains included', async () => {
    const m = await boot({ right: 'max', allowDomains: ['Breitbart.com'] });
    expect(hidden(m, 't3_right')).toBeUndefined();
    await change(m, { allowDomains: [] });
    expect(hidden(m, 't3_right')).toBeDefined();
  });

  it('uses the banner and reveal of filteReddit', async () => {
    const m = await boot({ right: 'mid' });
    const banner = document.querySelector('.rescue-filter-banner')!;
    expect(banner.textContent).toContain('2 posts filtered');
    expect(banner.querySelector<HTMLElement>('.rescue-filter-toggle')!.hidden).toBe(false);
    banner.querySelector<HTMLButtonElement>('.rescue-filter-toggle')!.click();
    const chip = document.querySelector('#t3_right .rescue-filter-reason')!;
    expect(chip.textContent).toBe('Filtered: audience lean right 0.73');
    void m;
  });

  it('showReason off names only the module', async () => {
    const m = await boot({ right: 'mid', showReason: false });
    expect(hidden(m, 't3_right')).toBe('neutrality');
  });

  it('turning filteReddit’s power switch off shows the posts again', async () => {
    const m = await boot({ right: 'mid' });
    document.querySelector<HTMLButtonElement>('.rescue-filter-power')!.click();
    expect(hidden(m, 't3_right')).toBeUndefined();
  });

  it('on a post’s own page it is never hidden (its chip is covered in neutrality-lean.test.ts)', async () => {
    const m = await boot(
      { right: 'max' },
      { kind: 'thread', path: '/r/politics/comments/right/x/' },
      [POSTS[0]!],
    );
    expect(hidden(m, 't3_right')).toBeUndefined();
    expect(document.querySelector('.rescue-lean-chip')).toBeNull(); // showLean is off by default
  });

  it('a failed data load shows a notice and hides nothing', async () => {
    loadSpy.mockRejectedValue(new Error('nope'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const m = await boot({ right: 'max' });
    expect(hidden(m, 't3_right')).toBeUndefined();
    expect(m.notices.some((n) => /could not load/.test(n.message))).toBe(true);
  });

  it('the revealed chip is short; its tooltip names domain, score, source and the matched key', async () => {
    await boot({ right: 'mid' }, { kind: 'all', path: '/r/all/', subreddit: 'all' }, [
      post('t3_e', 'breitbart.com'),
      post('t3_r', 'infowars.com'),
      post('t3_sub', 'news.breitbart.com'),
    ]);
    document.querySelector<HTMLButtonElement>('.rescue-filter-toggle')!.click();
    const title = (id: string) =>
      document.querySelector<HTMLElement>(`#${id} .rescue-filter-reason`)!.title;
    expect(document.querySelector('#t3_e .rescue-filter-reason')!.textContent).toBe(
      'Filtered: audience lean right 0.73',
    );
    expect(title('t3_e')).toBe(
      'REScue: filtered: neutrality filter, breitbart.com audience lean right 0.73 — who shares it on social media, not a rating of its content (Eady et al. 2025)',
    );
    expect(title('t3_r')).toContain('(Robertson et al. 2018)');
    expect(title('t3_sub')).toContain('news.breitbart.com audience lean right');
    expect(title('t3_sub')).toContain('matched breitbart.com');
  });

  it('keeps the reason short: no domain or source (those are in the tooltip)', () => {
    const eady = { ...lean(0.733), source: 'eady' as const };
    expect(leanReason(eady, true)).toBe('audience lean right 0.73');
    expect(leanReason(eady, true).length).toBeLessThan(30);
  });

  it('the credit lines name both datasets and link to them', () => {
    const links = neutralityFilter.links!();
    expect(links).toHaveLength(2);
    expect(links[0]!.label).toMatch(/Eady/);
    expect(links[1]!.label).toMatch(/Robertson/);
    expect(links.map((l) => l.href)).toEqual([
      'https://doi.org/10.7910/DVN/1QMLOV',
      'https://doi.org/10.7910/DVN/QAN5VX',
    ]);
  });

  it('once loaded, the credits come from the data’s own meta', async () => {
    await boot({ right: 'mid' });
    const labels = neutralityFilter.links!().map((l) => l.label);
    expect(labels[0]).toContain('doi:10.1017/pan.2024.19');
    expect(labels[0]).toContain(meta.sources.find((s) => s.id === 'eady')!.title);
    expect(labels[1]).toContain('doi:10.7910/DVN/QAN5VX');
  });

  it('describes the measure, its age, that 0 is not neutral, the source and the no-network promise', () => {
    const d = neutralityFilter.description;
    for (const part of [
      /SHARES/,
      /2017/,
      /not mean a site is neutral/,
      /doi:10\.7910\/DVN\/QAN5VX/,
      /doi:10\.1017\/pan\.2024\.19/,
      /about 180 major outlets with newer data/,
      /Eady/,
      /Robertson/,
      /CC0/,
      /no network requests/,
    ])
      expect(d).toMatch(part);
    for (const side of ['left', 'right'] as const) {
      const values = (
        neutralityFilter.options[side] as { values: Array<{ value: string; label: string }> }
      ).values;
      expect(values.map((v) => v.value)).toEqual(['off', 'min', 'mid', 'max']);
      expect(values[1]!.label).toMatch(/≥0\.7/);
      expect(values[2]!.label).toMatch(/≥0\.5/);
      expect(values[3]!.label).toMatch(/≥0\.3/);
    }
  });
});
