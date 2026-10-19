import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveOptions } from '../../src/core/settings';
import { neutralityShowLean, runMigrations, MIGRATIONS } from '../../src/core/storage/migrations';
import type { ModuleContext, ModuleDefinition, OptionValue } from '../../src/core/types';
import { hint } from '../../src/core/hints';
import { filteReddit } from '../../src/modules/listings/filteReddit';
import { neutralityFilter } from '../../src/modules/listings/neutralityFilter';
import {
  LEAN_COLORS,
  MIN_CONTRAST,
  chipDetail,
  chipStyle,
  chipText,
  leanColor,
  leanWord,
} from '../../src/modules/listings/neutralityFilter/chip';
import { lookup } from '../../src/modules/listings/neutralityFilter/scoring';
import type { NeutralityData } from '../../scripts/build-neutrality-data';
import { listingHtml, mount, type FixturePost } from '../fixtures/pages';
import { bootModules, tick } from './module-harness';

const loadSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/modules/listings/neutralityFilter/data', () => ({
  loadNeutralityData: loadSpy,
}));

const data = JSON.parse(
  readFileSync(resolve(__dirname, '../../src/data/neutrality-scores.json'), 'utf8'),
) as NeutralityData;

describe('lean words', () => {
  it('use the hiding cut-offs, boundaries included', () => {
    const cases: Array<[number, string]> = [
      [-1, 'far left'],
      [-0.7, 'far left'],
      [-0.699, 'left'],
      [-0.5, 'left'],
      [-0.499, 'lean left'],
      [-0.3, 'lean left'],
      [-0.299, 'neutral'],
      [0, 'neutral'],
      [0.299, 'neutral'],
      [0.3, 'lean right'],
      [0.499, 'lean right'],
      [0.5, 'right'],
      [0.699, 'right'],
      [0.7, 'far right'],
      [1, 'far right'],
    ];
    for (const [score, word] of cases) expect(leanWord(score), String(score)).toBe(word);
  });
});

describe('lean colours', () => {
  it('end on blue (-1) and red (+1), sit on grey at 0 and blend in between', () => {
    expect(leanColor(-1)).toBe(LEAN_COLORS.left);
    expect(leanColor(1)).toBe(LEAN_COLORS.right);
    expect(leanColor(0)).toBe(LEAN_COLORS.centre);
    expect(leanColor(-5)).toBe(LEAN_COLORS.left); // clamped
    expect(leanColor(Number.NaN)).toBe(LEAN_COLORS.centre);
    // halfway between grey #9ca3af and red #dc2626 is (188, 101, 107)
    expect(leanColor(0.5)).toBe('#bc656b');
    // halfway between grey and blue #2563eb is (97, 131, 205)
    expect(leanColor(-0.5)).toBe('#6183cd');
  });

  it('moves steadily: the blue channel falls and red rises from left to right', () => {
    const red = (s: number) => parseInt(leanColor(s).slice(1, 3), 16);
    let prev = -1;
    for (let s = -1; s <= 1.0001; s += 0.1) {
      const v = red(s);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('keeps text readable (>= 4.5:1) at every sampled score, on the chip’s own background', () => {
    for (let s = -1; s <= 1.0001; s += 0.01) {
      const { contrast, color } = chipStyle(Number(s.toFixed(2)));
      expect(contrast, String(s)).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(['#000000', '#ffffff']).toContain(color);
    }
    // the chip paints its own background and text, so Reddit's light and dark themes see the same pair
    for (const s of [data.scores['breitbart.com']!, data.scores['vox.com']!, 0])
      expect(chipStyle(s).contrast).toBeGreaterThanOrEqual(MIN_CONTRAST);
  });
});

describe('chip text and hover', () => {
  const eady = { ...lookup({ 'example.com': 0.62 }, 'example.com')!, source: 'eady' as const };

  it('is the word, with the signed number only when asked', () => {
    expect(chipText({ score: 0.62 }, false)).toBe('right');
    expect(chipText({ score: 0.62 }, true)).toBe('right +0.62');
    expect(chipText({ score: -0.61 }, true)).toBe('left -0.61');
    expect(chipText({ score: 0 }, true)).toBe('neutral 0.00');
  });

  it('hover names the domain, matched key, side, score, what it measures and the source', () => {
    expect(hint.neutralityChip(chipDetail(eady))).toBe(
      'REScue: example.com audience lean right 0.62 — who shares it on social media, not a rating of its content (Eady et al. 2025)',
    );
    const rob = { ...lookup({ 'a.com': -0.4 }, 'b.a.com')!, source: 'robertson' as const };
    expect(chipDetail(rob)).toMatch(
      /^b\.a\.com audience lean left 0\.40 .* \(Robertson et al\. 2018, matched a\.com\)$/,
    );
  });

  it('a score of exactly 0 is known (neutral), not missing', () => {
    expect(lookup({ 'even.com': 0 }, 'even.com')?.score).toBe(0);
    expect(chipDetail(lookup({ 'even.com': 0 }, 'even.com')!)).toContain('audience lean 0.00');
  });
});

describe('option migration', () => {
  const settings = (options: Record<string, unknown>) => ({
    schema: { version: 1 },
    settings: { modules: { neutralityFilter: { enabled: true, options } } },
  });
  const run = (options: Record<string, unknown>) => {
    const r = runMigrations(settings(options), MIGRATIONS);
    expect(r.ok).toBe(true);
    return (r.data.settings as { modules: { neutralityFilter: { options: object } } }).modules
      .neutralityFilter.options;
  };

  it('turns showLean on for anyone who had either label on, and drops the old keys', () => {
    expect(run({ labelInListings: true })).toEqual({ showLean: true });
    expect(run({ labelOnThread: true, right: 'mid' })).toEqual({ showLean: true, right: 'mid' });
    expect(run({ labelOnThread: false, labelInListings: false })).toEqual({});
  });

  it('leaves other data alone and is a no-op without the module', () => {
    const plain = { schema: { version: 1 }, settings: { modules: {} }, other: 1 };
    const r = runMigrations(plain, MIGRATIONS);
    expect(r.data).toMatchObject({ other: 1, settings: { modules: {} } });
    expect(neutralityShowLean({ x: 1 })).toEqual({ x: 1 });
    expect(MIGRATIONS.map((m) => m.from)).toEqual([1, 2]);
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
    post('t3_mid', 'apnews.com'),
    post('t3_unknown', 'nowhere-in-data.example'),
    post('t3_yt', 'youtube.com'),
    post('t3_img', 'i.redd.it', { type: 'image' }),
    post('t3_self', 'self.politics', { type: 'text' }),
  ];

  type Booted = Awaited<ReturnType<typeof bootModules>>;
  let booted: Booted | null = null;

  async function boot(
    options: Record<string, OptionValue> = {},
    defs: ModuleDefinition[] = [filteReddit, neutralityFilter],
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

  const chip = (id: string) => document.querySelector<HTMLElement>(`#${id} .rescue-lean-chip`);
  const visibleChip = (id: string) => {
    const c = chip(id);
    return c && !c.hidden ? c : null;
  };

  beforeEach(() => {
    loadSpy.mockReset();
    loadSpy.mockImplementation(async () => data);
  });
  afterEach(() => {
    booted?.dispose();
    booted = null;
    document.body.innerHTML = '';
  });

  it('is off by default: no chips and no data load', async () => {
    expect(neutralityFilter.options.showLean).toMatchObject({ type: 'boolean', default: false });
    expect(neutralityFilter.options.showLeanScore).toMatchObject({ default: false });
    await boot();
    expect(document.querySelector('.rescue-lean-chip')).toBeNull();
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('labels every scored link post, with both hiding sides off', async () => {
    await boot({ showLean: true });
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(chip('t3_right')?.textContent).toBe('far right');
    expect(chip('t3_left')?.textContent).toBe('left'); // -0.61
    expect(chip('t3_mid')?.textContent).toBe('neutral'); // apnews.com -0.072
    expect(chip('t3_right')!.style.background).not.toBe('');
    expect(chip('t3_right')!.title).toBe(
      'REScue: breitbart.com audience lean right 0.73 — who shares it on social media, not a rating of its content (Eady et al. 2025)',
    );
  });

  it('retries a failed data request, so the chips come back without a page reload', async () => {
    // The first request fails (the background was still waking up). Capture the long retry timer
    // instead of waiting for it; short timers (the harness's tick) run as usual.
    const real = globalThis.setTimeout;
    const retry: Array<() => void> = [];
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if ((ms ?? 0) >= 1000) {
        retry.push(fn);
        return 0 as never;
      }
      return real(fn, ms);
    }) as typeof setTimeout);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    loadSpy.mockRejectedValueOnce(new Error('background asleep'));
    await boot({ showLean: true });
    expect(chip('t3_right')).toBeNull();
    expect(retry.length).toBeGreaterThan(0);
    for (const fn of retry.splice(0)) fn();
    await tick();
    expect(chip('t3_right')?.textContent).toBe('far right');
    expect(loadSpy).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
  it('gives no chip to unknown domains, platforms, Reddit media or text posts', async () => {
    await boot({ showLean: true });
    for (const id of ['t3_unknown', 't3_yt', 't3_img', 't3_self'])
      expect(document.querySelector(`#${id} .rescue-lean-chip`), id).toBeNull();
  });

  it('works without filteReddit, and loads the data only because showLean is on', async () => {
    await boot({ showLean: true }, [neutralityFilter]);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(visibleChip('t3_left')).not.toBeNull();
  });

  it('toggles live: on, number on, off, back on, with a single data load', async () => {
    const m = await boot({});
    expect(document.querySelector('.rescue-lean-chip')).toBeNull();
    await change(m, { showLean: true });
    expect(visibleChip('t3_right')?.textContent).toBe('far right');
    await change(m, { showLeanScore: true });
    expect(visibleChip('t3_right')?.textContent).toBe('far right +0.73');
    await change(m, { showLean: false });
    expect(visibleChip('t3_right')).toBeNull();
    await change(m, { showLean: true });
    expect(visibleChip('t3_right')).not.toBeNull();
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it('is independent of hiding: a hidden post carries no chip, a visible one does', async () => {
    const m = await boot({ right: 'mid', showLean: true });
    expect(m.deco.hiddenReason('t3_right')).toBe('audience lean right 0.73');
    expect(visibleChip('t3_right')).toBeNull();
    expect(visibleChip('t3_left')).not.toBeNull();
    await change(m, { right: 'off' });
    expect(m.deco.hiddenReason('t3_right')).toBeUndefined();
    expect(visibleChip('t3_right')).not.toBeNull();
  });

  it('hiding thresholds are unchanged by showLean (and a centrist domain is never hidden)', async () => {
    const m = await boot({ left: 'max', right: 'max', showLean: true });
    expect(m.deco.hiddenReason('t3_mid')).toBeUndefined(); // apnews.com -0.072
    expect(m.deco.hiddenReason('t3_left')).toBeDefined();
    expect(m.deco.hiddenReason('t3_unknown')).toBeUndefined();
  });

  it('shows the chip on the post’s own page', async () => {
    await boot(
      { showLean: true },
      [filteReddit, neutralityFilter],
      {
        kind: 'thread',
        path: '/r/politics/comments/right/x/',
      },
      [POSTS[0]!],
    );
    expect(visibleChip('t3_right')?.textContent).toBe('far right');
  });

  it('the description explains the scale, the colours, the source and the data age', () => {
    const d = neutralityFilter.description + String(neutralityFilter.options.showLean!.description);
    for (const part of [
      /blue/,
      /grey/,
      /red/,
      /SHARES/,
      /not a rating/,
      /2017/,
      /Eady/,
      /Robertson/,
    ])
      expect(d).toMatch(part);
    expect(neutralityFilter.dependsOn).toBeUndefined();
    expect((neutralityFilter.options as Record<string, unknown>).labelOnThread).toBeUndefined();
    expect((neutralityFilter.options as Record<string, unknown>).labelInListings).toBeUndefined();
  });
});
