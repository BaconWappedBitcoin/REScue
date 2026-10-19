import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Pipeline } from '../../src/core/pipeline';
import { Decorations } from '../../src/layout/decorations';
import { NativeAdapter } from '../../src/layout/native/adapter';
import { ownTimeElement } from '../../src/model/appearance';
import { parseSearchPost } from '../../src/model/search-post';
import { ContractTally } from '../../src/model/tally';
import type { Post } from '../../src/model/types';
import { localDate } from '../../src/modules/appearance/localDate';
import { filteReddit } from '../../src/modules/listings/filteReddit';
import { userTagger } from '../../src/modules/users/userTagger';
import {
  mount,
  SEARCH_ITEMS,
  searchItemHtml,
  searchPageHtml,
  type FixtureSearchItem,
} from '../fixtures/pages';
import { bootModules, tick } from './module-harness';

const HOST = 'search-telemetry-tracker[view-events="search/view/post"]';
const hosts = (): Element[] => [...document.querySelectorAll(HOST)];
const hostOf = (id: string): HTMLElement =>
  hosts().find((h) =>
    h.getAttribute('data-faceplate-tracking-context')?.includes(`"${id}"`),
  ) as HTMLElement;
const postOf = (id: string): Post => parseSearchPost(hostOf(id))!;
const P = (id: string): { id: string } => ({ id });
const route = { kind: 'search', path: '/search' };

afterEach(() => {
  document.body.innerHTML = '';
});

describe('search result model', () => {
  beforeEach(() => mount(searchPageHtml()));

  it('parses id, title, permalink, author, subreddit and counts from a result', () => {
    expect(postOf('t3_srch1')).toMatchObject({
      kind: 'post',
      id: 't3_srch1',
      title: 'Creatine and sleep',
      permalink: '/r/science/comments/srch1/slug/',
      author: 'sci_fan',
      subreddit: 'science',
      score: 18689,
      commentCount: 1646,
      upvoteRatio: null,
      type: 'other',
      url: null,
      nsfw: false,
      spoiler: false,
      feedIndex: 0,
      bodyHtml: null,
      media: null,
    });
    expect(postOf('t3_srch1').created?.toISOString()).toBe('2026-10-13T10:08:12.362Z');
    expect(postOf('t3_srch2').feedIndex).toBe(1);
    expect(postOf('t3_srch1').source).toBe(hostOf('t3_srch1'));
  });

  it('reads the nsfw and spoiler flags and tolerates a missing profile', () => {
    mount(
      searchItemHtml({ id: 't3_flag1', title: 'Flags', nsfw: true, spoiler: true }) +
        searchItemHtml({ id: 't3_noauth', title: 'Deleted user' }),
    );
    expect(postOf('t3_flag1')).toMatchObject({ nsfw: true, spoiler: true, author: null });
    expect(postOf('t3_noauth').author).toBeNull();
  });

  it('counts a hit on a result and a miss when the context is malformed', () => {
    const tally = new ContractTally();
    expect(parseSearchPost(hostOf('t3_srch1'), tally)).not.toBeNull();
    const broken = hostOf('t3_srch2');
    broken.setAttribute('data-faceplate-tracking-context', '{not json');
    expect(parseSearchPost(broken, tally)).toBeNull();
    broken.setAttribute('data-faceplate-tracking-context', '"a string"');
    expect(parseSearchPost(broken, tally)).toBeNull();
    broken.setAttribute('data-faceplate-tracking-context', '{"post":{"id":7,"title":"x"}}');
    expect(parseSearchPost(broken, tally)).toBeNull();
    expect(tally.hits('search.post')).toBe(1);
    expect(tally.misses('search.post')).toBe(3);
  });

  it('falls back to the title link for the title and misses without a permalink', () => {
    const el = hostOf('t3_srch1');
    const ctx = JSON.parse(el.getAttribute('data-faceplate-tracking-context')!);
    delete ctx.post.title;
    el.setAttribute('data-faceplate-tracking-context', JSON.stringify(ctx));
    expect(parseSearchPost(el)!.title).toBe('Creatine and sleep');
    el.querySelector('a[data-testid="post-title"]')!.removeAttribute('href');
    expect(parseSearchPost(el)).toBeNull();
  });

  it('does not treat the nested click trackers as results', () => {
    expect(hosts()).toHaveLength(SEARCH_ITEMS.length);
    expect(document.querySelectorAll('search-telemetry-tracker').length).toBeGreaterThan(
      hosts().length,
    );
  });
});

describe('search results in the pipeline', () => {
  it('emits every result once, dedups, and picks up later results', () => {
    mount(searchPageHtml());
    const batches: Post[][] = [];
    const pipeline = new Pipeline({ onBatch: (b) => batches.push(b.posts) });
    expect(pipeline.flush().posts.map((p) => p.id)).toEqual(['t3_srch1', 't3_srch2', 't3_srch3']);
    expect(pipeline.flush().posts).toHaveLength(0);

    // Infinite scroll: a new result, and a re-rendered copy of one already seen.
    document
      .querySelector('#search-results')!
      .insertAdjacentHTML(
        'beforeend',
        searchItemHtml({ id: 't3_srch4', title: 'Later result' }, 3) +
          searchItemHtml(SEARCH_ITEMS[0]!),
      );
    expect(pipeline.flush().posts.map((p) => p.id)).toEqual(['t3_srch4']);
    expect(batches).toHaveLength(2);
    expect(pipeline.tally.hits('search.post')).toBe(5);
  });
});

describe('search results in the native adapter', () => {
  const span = (text: string): HTMLElement => {
    const s = document.createElement('span');
    s.className = 'deco-test';
    s.textContent = text;
    return s;
  };
  function setup() {
    mount(searchPageHtml());
    const deco = new Decorations();
    const adapter = new NativeAdapter(deco);
    const posts = hosts().map((h) => parseSearchPost(h)!);
    adapter.track({ posts, comments: [], profileComments: [] });
    return { deco, posts };
  }

  it('treats the result as its own wrapper', () => {
    mount(searchPageHtml());
    const h = hosts()[0]!;
    expect(NativeAdapter.wrapperOf(h)).toBe(h);
  });

  it('places author and tagline nodes in order after the result’s own time, in its credit row', () => {
    const { deco } = setup();
    const a = span('a');
    const t = span('t');
    deco.decorate(P('t3_srch1'), 'tagline', t);
    deco.decorate(P('t3_srch1'), 'author', a);
    const time = hostOf('t3_srch1').querySelector('faceplate-timeago')!;
    expect(time.nextElementSibling).toBe(a); // author is placed before tagline
    expect(a.nextElementSibling).toBe(t);
    expect(time.closest('.post-credit-row')!.contains(t)).toBe(true);
    expect(a.hasAttribute('slot')).toBe(false);
    // Idempotent, and a detached node is put back.
    t.remove();
    deco.decorate(P('t3_srch1'), 'tagline', t);
    expect(a.nextElementSibling).toBe(t);
    expect(document.querySelectorAll('.deco-test')).toHaveLength(2);
  });

  it('places title nodes after the title text and never slots onto the host', () => {
    const { deco } = setup();
    const n1 = span('1');
    const n2 = span('2');
    deco.decorate(P('t3_srch2'), 'title', n1);
    deco.decorate(P('t3_srch2'), 'title', n2);
    const text = hostOf('t3_srch2').querySelector('a[data-testid="post-title-text"]')!;
    expect(text.nextElementSibling).toBe(n1);
    expect(n1.nextElementSibling).toBe(n2);
    expect(n1.hasAttribute('slot')).toBe(false);
  });

  it('skips placement when the anchor is missing', () => {
    const { deco } = setup();
    const host = hostOf('t3_srch1');
    host.querySelector('faceplate-timeago')!.remove();
    host.querySelector('a[data-testid="post-title-text"]')!.remove();
    const n = span('x');
    deco.decorate(P('t3_srch1'), 'tagline', n);
    deco.decorate(P('t3_srch1'), 'title', span('y'));
    expect(n.isConnected).toBe(false);
    expect(host.querySelector('.deco-test')).toBeNull();
    expect(host.querySelector('[slot]')).toBeNull();
  });

  it('hides the result element itself, reveals it, and ignores author marks', () => {
    const { deco } = setup();
    const host = hostOf('t3_srch3');
    deco.hide(P('t3_srch3'), 'keyword');
    expect(host.style.display).toBe('none');
    expect(hostOf('t3_srch1').style.display).not.toBe('none');
    deco.setReveal(true);
    expect(host.style.display).toBe('');
    expect(host.getAttribute('data-rescue-hidden')).toBe('keyword');
    deco.setReveal(false);
    deco.unhide(P('t3_srch3'), 'keyword');
    expect(host.hasAttribute('data-rescue-hidden')).toBe(false);
    expect(() => deco.markAuthor(P('t3_srch3'), 'x')).not.toThrow();
    expect(document.querySelector('.x')).toBeNull();
  });
});

describe('search results with feature modules', () => {
  beforeEach(() => mount(searchPageHtml()));

  it('localDate finds the result’s own time element', async () => {
    const time = hostOf('t3_srch1').querySelector('faceplate-timeago')!;
    expect(ownTimeElement(hostOf('t3_srch1'))).toBe(time);
    const m = await bootModules([localDate], { route, options: { localDate: { format: 'iso' } } });
    m.flush();
    expect(time.getAttribute('title')).toMatch(/^REScue: posted 2026-10-1[34] /);
    m.dispose();
    expect(time.hasAttribute('title')).toBe(false);
  });

  it('localDate inline label goes after the time in the credit row', async () => {
    const m = await bootModules([localDate], {
      route,
      options: { localDate: { display: 'inline' } },
    });
    m.flush();
    const time = hostOf('t3_srch2').querySelector('faceplate-timeago')!;
    expect(time.nextElementSibling?.className).toBe('rescue-local-date rescue-label');
    m.dispose();
  });

  it('filteReddit hides a result by subreddit and by title keyword', async () => {
    const rule = (type: string, pattern: string) => ({
      type,
      pattern,
      scope: 'everywhere',
      subreddits: '',
      enabled: true,
      toggle: '',
    });
    const rules = [rule('subreddit', 'rust'), rule('keyword', 'spoiler')];
    const m = await bootModules([filteReddit], { route, options: { filteReddit: { rules } } });
    m.flush();
    expect(hostOf('t3_srch1').style.display).not.toBe('none');
    expect(hostOf('t3_srch2').style.display).toBe('none');
    expect(hostOf('t3_srch3').style.display).toBe('none');
    // A later batch is filtered too.
    document
      .querySelector('#search-results')!
      .insertAdjacentHTML(
        'beforeend',
        searchItemHtml({ id: 't3_late', title: 'Spoiler part two' }, 5),
      );
    m.flush();
    expect(hostOf('t3_late').style.display).toBe('none');
    m.dispose();
  });

  it('userTagger shows a tag after the result’s time', async () => {
    const userTags = {
      sci_fan: {
        username: 'sci_fan',
        text: 'friend',
        color: '#ffd700',
        voteTally: 0,
        ignored: false,
        updatedAt: 1,
      },
    };
    const m = await bootModules([userTagger], { route, stored: { userTags }, username: 'me' });
    m.flush();
    await tick();
    const time = hostOf('t3_srch1').querySelector('faceplate-timeago')!;
    expect(time.nextElementSibling!.querySelector('.rescue-user-tag')?.textContent).toBe('friend');
    expect(hostOf('t3_srch2').querySelector('.rescue-user-tag')).toBeNull();
    m.dispose();
  });

  it('j/k selection walks the results in order', async () => {
    const m = await bootModules([], { route });
    m.flush();
    const sel = m.selection;
    expect(sel.list().map((i) => i.id)).toEqual(['t3_srch1', 't3_srch2', 't3_srch3']);
    expect(sel.move(1)).toBe(true);
    expect(sel.current()!.id).toBe('t3_srch1');
    expect(hostOf('t3_srch1').hasAttribute('data-rescue-selected')).toBe(true);
    sel.move(1);
    expect(sel.current()!.id).toBe('t3_srch2');
    expect(hostOf('t3_srch1').hasAttribute('data-rescue-selected')).toBe(false);
    hostOf('t3_srch3').style.setProperty('display', 'none', 'important');
    expect(sel.move(1)).toBe(false); // hidden results are skipped
    expect(sel.move(-1)).toBe(true);
    expect(sel.current()!.id).toBe('t3_srch1');
    m.dispose();
  });
});

describe('fixture variants', () => {
  it('both data-testid variants and the optional thing attributes parse', () => {
    const items: FixtureSearchItem[] = [
      { id: 't3_v1', title: 'One', variant: 'preview', thingAttrs: true },
      { id: 't3_v2', title: 'Two', variant: 'unit' },
    ];
    mount(searchPageHtml(items));
    expect(document.querySelector('[data-testid="search-post-unit"]')).not.toBeNull();
    expect(
      document.querySelector('[data-testid="search-post-with-content-preview"]'),
    ).not.toBeNull();
    expect(hosts().map((h) => parseSearchPost(h)?.id)).toEqual(['t3_v1', 't3_v2']);
  });
});
