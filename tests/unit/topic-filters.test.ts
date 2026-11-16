import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveOptions } from '../../src/core/settings';
import type { ModuleContext, OptionValue } from '../../src/core/types';
import type { Post } from '../../src/model/types';
import {
  externalDetail,
  externalReason,
  onExternalReasonsChanged,
} from '../../src/modules/listings/filteReddit/external';
import { topicFilters } from '../../src/modules/listings/topicFilters';
import { buildIndex, menuLabel, topicSize } from '../../src/modules/listings/topicFilters/matcher';
import {
  SUBREDDIT_NAME,
  TOPICS,
  TOPIC_IDS,
  sampleText,
  topicOption,
} from '../../src/modules/listings/topicFilters/topics';
import { bootModules, tick } from './module-harness';

const post = (subreddit: string): Post => ({ id: `t3_${subreddit}`, subreddit }) as unknown as Post;

type Booted = Awaited<ReturnType<typeof bootModules>>;
let booted: Booted | null = null;
afterEach(() => {
  booted?.dispose();
  booted = null;
  document.body.replaceChildren();
});

async function boot(options: Record<string, OptionValue> = {}, route = {}): Promise<Booted> {
  booted = await bootModules([topicFilters], {
    options: { topicFilters: options },
    route: { kind: 'front', path: '/', ...route },
  });
  return booted;
}
const ctxOf = (b: Booted): ModuleContext => b.ctxs.get('topicFilters')!;
const asked = (b: Booted, sub: string): string | undefined => externalReason(post(sub), ctxOf(b));

describe('topic data', () => {
  it('has the topics, each non-empty with valid, unique names', () => {
    expect(TOPIC_IDS).toEqual([
      'sports',
      'anime',
      'politics',
      'news',
      'gaming',
      'celebrities',
      'crypto',
      'memes',
      'tvmovies',
      'music',
      'kpop',
      'drama',
      'religion',
      'cars',
    ]);
    for (const [id, topic] of Object.entries(TOPICS)) {
      expect(topic.label, id).toBeTruthy();
      expect(topic.description, id).toBeTruthy();
      expect(topic.subreddits.length, id).toBeGreaterThanOrEqual(20);
      for (const name of topic.subreddits) expect(name, `${id}/${name}`).toMatch(SUBREDDIT_NAME);
      expect(new Set(topic.subreddits).size, `${id} has duplicates`).toBe(topic.subreddits.length);
      expect(topic.sample.length, id).toBe(3);
      for (const name of topic.sample) expect(topic.subreddits, `${id} sample`).toContain(name);
    }
  });

  it('sports is the biggest topic and holds the leagues and teams', () => {
    const sizes = TOPIC_IDS.map((id) => TOPICS[id]!.subreddits.length);
    expect(Math.max(...sizes)).toBe(TOPICS.sports!.subreddits.length);
    for (const sub of ['nba', 'nfl', 'soccer', 'formula1', 'ufc', 'lakers', 'fantasyfootball'])
      expect(TOPICS.sports!.subreddits, sub).toContain(sub);
  });

  it('describes each topic option with a sample and a count', () => {
    expect(sampleText('sports')).toBe(
      `e.g. r/nba, r/nfl, r/soccer and ${TOPICS.sports!.subreddits.length - 3} more`,
    );
    const opts = topicFilters.options;
    for (const id of TOPIC_IDS) {
      const spec = opts[topicOption(id)]!;
      expect(spec).toMatchObject({ type: 'boolean', default: false, title: TOPICS[id]!.label });
      expect(spec.description).toContain(sampleText(id));
    }
    expect(topicFilters.enabledByDefault).toBe(true);
  });

  it('every topic is off by default', () => {
    const resolved = resolveOptions(topicFilters, {
      schemaVersion: 1,
      keybindings: {},
      syncEnabled: false,
      modules: {},
    } as never);
    for (const id of TOPIC_IDS) expect(resolved[topicOption(id)]).toBe(false);
  });
});

describe('the provider', () => {
  it('hides a post from an enabled topic, with the reason and detail', async () => {
    const b = await boot({ [topicOption('sports')]: true });
    expect(asked(b, 'nba')).toBe('topic: Sports');
    expect(externalDetail('t3_nba', 'topic: Sports')).toBe(
      'r/nba is in the Sports topic filter (settings › Topic filters).',
    );
  });

  it('matches the subreddit whatever its case', async () => {
    const b = await boot({ [topicOption('sports')]: true });
    expect(asked(b, 'NBA')).toBe('topic: Sports');
    expect(asked(b, 'Formula1')).toBe('topic: Sports');
  });

  it('leaves posts from a disabled topic and from unlisted subreddits alone', async () => {
    const b = await boot({ [topicOption('sports')]: true });
    expect(asked(b, 'anime')).toBeUndefined();
    expect(asked(b, 'askreddit')).toBeUndefined();
    const none = await boot({});
    expect(asked(none, 'nba')).toBeUndefined();
  });

  it('never hides an allow-listed subreddit', async () => {
    const b = await boot({
      [topicOption('sports')]: true,
      allowList: [{ subreddit: 'r/NBA' }, { subreddit: ' ' }],
    });
    expect(asked(b, 'nba')).toBeUndefined();
    expect(asked(b, 'nfl')).toBe('topic: Sports');
  });

  it('does not hide a post while its own subreddit is being browsed', async () => {
    const b = await boot(
      { [topicOption('sports')]: true },
      { kind: 'subreddit', path: '/r/NBA/', subreddit: 'NBA' },
    );
    expect(asked(b, 'nba')).toBeUndefined();
    expect(asked(b, 'nfl')).toBe('topic: Sports');
  });

  it('honours the reader’s extra subreddits, only while their topic is on', async () => {
    const extra = [
      { topic: 'sports', subreddit: 'r/PickleBall' },
      { topic: 'anime', subreddit: 'myweirdanime' },
      { topic: 'nonsense', subreddit: 'ignored_one' },
      { topic: 'sports', subreddit: 'bad name!' },
    ];
    const b = await boot({ [topicOption('sports')]: true, extra });
    expect(asked(b, 'pickleball')).toBe('topic: Sports');
    expect(asked(b, 'myweirdanime')).toBeUndefined();
    expect(asked(b, 'ignored_one')).toBeUndefined();
    const anime = await boot({ [topicOption('anime')]: true, extra });
    expect(asked(anime, 'myweirdanime')).toBe('topic: Anime & manga');
    expect(asked(anime, 'pickleball')).toBeUndefined();
  });

  it('is a single lookup in a map built once', () => {
    const index = buildIndex(['sports', 'memes'], [['memes', 'mine']]);
    expect(index.get('nba')).toBe('sports');
    expect(index.get('dankmemes')).toBe('memes');
    expect(index.get('mine')).toBe('memes');
    expect(index.get('askreddit')).toBeUndefined();
    expect(topicSize('memes', [['memes', 'mine']])).toBe(TOPICS.memes!.subreddits.length + 1);
  });

  it('asks filteReddit to look again when the settings change, with no reload', async () => {
    const b = await boot({});
    const seen = vi.fn();
    const stop = onExternalReasonsChanged(seen);
    expect(asked(b, 'nba')).toBeUndefined();
    const next = {
      ...ctxOf(b),
      options: { ...ctxOf(b).options, [topicOption('sports')]: true },
    } as ModuleContext;
    topicFilters.onSettings!(next);
    expect(seen).toHaveBeenCalled();
    expect(asked(b, 'nba')).toBe('topic: Sports');
    stop();
  });

  it('stops hiding when the module is switched off', async () => {
    const b = await boot({ [topicOption('sports')]: true });
    expect(asked(b, 'nba')).toBe('topic: Sports');
    topicFilters.dispose!();
    expect(asked(b, 'nba')).toBeUndefined();
  });
});

describe('the REScue menu row', () => {
  it('names what is on, or none', async () => {
    expect(menuLabel([])).toBe('Topic filters: none');
    expect(menuLabel(['sports', 'politics'])).toBe('Topic filters: Sports, Politics');
    expect(menuLabel(['sports', 'anime', 'politics', 'news'])).toBe(
      'Topic filters: Sports, Anime & manga, Politics and 1 more',
    );
    const b = await boot({});
    expect(b.menuText('topicFilters')).toBe('Topic filters: none');
    const on = await boot({ [topicOption('sports')]: true, [topicOption('politics')]: true });
    expect(on.menuText('topicFilters')).toBe('Topic filters: Sports, Politics');
  });

  it('opens a panel with a checkbox per topic and a link to the settings', async () => {
    const b = await boot({ [topicOption('anime')]: true });
    expect(b.menu('topicFilters')).toBe(true);
    const panel = document.querySelector('.rescue-topic-panel')!;
    const boxes = [...panel.querySelectorAll<HTMLInputElement>('input[type=checkbox]')];
    expect(boxes.map((x) => x.dataset.topic)).toEqual([...TOPIC_IDS]);
    expect(boxes.filter((x) => x.checked).map((x) => x.dataset.topic)).toEqual(['anime']);
    expect(panel.querySelector('a')?.getAttribute('href')).toBe('#rescue:settings/topicFilters');
    expect(panel.textContent).toContain('Sports');
  });

  it('ticking a box hides at once, saves, and says so with an Undo', async () => {
    const b = await boot({});
    b.menu('topicFilters');
    const box = document.querySelector<HTMLInputElement>(
      '.rescue-topic-panel [data-topic=sports]',
    )!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(asked(b, 'nba')).toBe('topic: Sports'); // before the save has even finished
    await tick();
    const profile = ctxOf(b).settings.profile() as unknown as {
      modules: Record<string, { options: Record<string, unknown> }>;
    };
    expect(profile.modules.topicFilters!.options.topic_sports).toBe(true);
    const note = b.notices.at(-1)!;
    expect(note.message).toBe(
      `Hiding the Sports topic (${TOPICS.sports!.subreddits.length} subreddits).`,
    );
    note.opts!.actions![0]!.run();
    await tick();
    expect(asked(b, 'nba')).toBeUndefined();
  });

  it('Escape closes the panel', async () => {
    const b = await boot({});
    b.menu('topicFilters');
    const panel = document.querySelector('.rescue-topic-panel')!;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.rescue-topic-panel')).toBeNull();
  });
});
