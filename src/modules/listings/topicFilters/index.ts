/**
 * Topic filters (a REScue extra, not part of RES): hide every post from the subreddits of a whole
 * topic (sports, anime, politics …) with one switch.
 *
 * The topic lists are bundled (topics.ts); nothing is looked up online. Hiding goes through
 * filteReddit (../filteReddit/external.ts), so the "N posts filtered · show" banner, the reason
 * chip, the placeholder row, the power switch and the reveal work as for the reader's own filters,
 * and turning filteReddit off stops the hiding. A subreddit's own pages are never affected: if you
 * are looking at r/nba you wanted it. The REScue menu has one "Topic filters" row that opens a
 * small panel of checkboxes (panel.ts); ticking one saves it at once, with an Undo.
 */
import { hint } from '../../../core/hints';
import { setOption } from '../../../core/settings';
import {
  defineModule,
  type ModuleContext,
  type ModuleDefinition,
  type OptionSchema,
  type OptionSpec,
} from '../../../core/types';
import type { Post } from '../../../model/types';
import { changed, registerPostReasons } from '../filteReddit/external';
import { text } from './hints';
import {
  allowSet,
  buildIndex,
  enabledTopics,
  extraPairs,
  menuLabel,
  reasonText,
  topicSize,
} from './matcher';
import { closeTopicPanel, menuAnchor, openTopicPanel } from './panel';
import { SUBREDDIT_NAME, TOPICS, TOPIC_IDS, bareSub, sampleText, topicOption } from './topics';

let ctx: ModuleContext | null = null;
let enabled: string[] = [];
let extra: Array<[string, string]> = [];
let allow = new Set<string>();
let index = new Map<string, string>();
let unregister: (() => void) | null = null;
let removeMenu: (() => void) | null = null;

/** Rebuild the sub -> topic map from the switched-on topics and the reader's additions. */
function rebuild(): void {
  index = buildIndex(enabled, extra);
}

function sync(next: ModuleContext): void {
  ctx = next;
  enabled = enabledTopics(next.options);
  extra = extraPairs(next.options.extra);
  allow = allowSet(next.options.allowList);
  rebuild();
  changed();
}

/** filteReddit asks this for every post it has not already filtered. Cheap and synchronous. */
function reasonFor(
  post: Post,
  host: ModuleContext,
): { reason: string; detail: string } | undefined {
  if (!index.size) return undefined;
  const sub = post.subreddit?.toLowerCase();
  const topic = sub ? index.get(sub) : undefined;
  if (!sub || !topic || allow.has(sub)) return undefined;
  if (host.route.subreddit?.toLowerCase() === sub) return undefined; // browsing it on purpose
  return reasonText(sub, topic);
}

/** Switch one topic on or off at once, then save it; the notice has an Undo that reverses it. */
async function setTopic(id: string, on: boolean, announce = true): Promise<void> {
  const c = ctx;
  if (!c) return;
  const before = enabled;
  enabled = TOPIC_IDS.filter((t) => (t === id ? on : before.includes(t)));
  rebuild();
  changed();
  try {
    await c.settings.save(
      setOption(c.settings.profile(), topicFilters as ModuleDefinition, topicOption(id), on),
    );
  } catch (err) {
    console.error('[REScue] topicFilters could not save the topic', err);
    enabled = before;
    rebuild();
    changed();
    closeTopicPanel();
    c.notices.show('REScue: the topic filter could not be saved.', { kind: 'error' });
    return;
  }
  if (!announce) return;
  const label = TOPICS[id]?.label ?? id;
  c.notices.show(
    on
      ? `Hiding the ${label} topic (${topicSize(id, extra)} subreddits).`
      : `Showing the ${label} topic again.`,
    {
      id: 'topic-filter',
      timeoutMs: 10000,
      actions: [{ label: 'Undo', hint: hint.undo, run: () => void setTopic(id, !on, false) }],
    },
  );
}

const topicOptions = (): Record<string, OptionSpec> =>
  Object.fromEntries(
    TOPIC_IDS.map((id) => [
      topicOption(id),
      {
        type: 'boolean',
        default: false,
        title: TOPICS[id]!.label,
        description: `Hide every post from ${TOPICS[id]!.description}; ${sampleText(id)}.`,
      } satisfies OptionSpec,
    ]),
  );

const nameProblem = (value: unknown): string | null => {
  const name = bareSub(value);
  return !name || SUBREDDIT_NAME.test(name) ? null : 'Enter a subreddit name such as nba.';
};

export const topicFilters = defineModule<OptionSchema>({
  id: 'topicFilters',
  category: 'listings',
  title: 'Topic filters',
  description:
    'Hide every post from a whole topic’s subreddits with one switch: sports, anime and manga, politics, news, video games, celebrities, crypto and trading, memes, TV and movies, music, K-pop, relationship and drama stories, religion or cars. Each topic is a bundled list of active subreddits (the big general ones and their popular team, show and game communities); nothing is looked up online. Nothing is hidden until you switch a topic on, here or from the Topic filters row in the REScue menu. Hidden posts are counted in the filter bar, where “show” reveals them with the reason (topic: Sports). A post is never hidden on its own subreddit’s page: opening r/nba shows r/nba. Add a subreddit to a topic in “Add subreddits to a topic”, or exempt one in “Never hide these subreddits”. Hiding goes through filteReddit and does nothing while filteReddit is off.',
  enabledByDefault: true,
  options: {
    ...topicOptions(),
    allowList: {
      type: 'table',
      default: [],
      title: 'Never hide these subreddits',
      description:
        'Subreddits that topic filters never hide, such as r/formula1 while the Sports topic is on. Your own filteReddit filters still apply.',
      columns: [{ key: 'subreddit', title: 'Subreddit', type: 'text' }],
      validateRow: (row) => nameProblem(row.subreddit),
    },
    extra: {
      type: 'table',
      default: [],
      title: 'Add subreddits to a topic',
      description:
        'A subreddit the bundled list misses. It is hidden whenever the topic you pick is switched on. Topics: ' +
        TOPIC_IDS.join(', ') +
        '.',
      columns: [
        { key: 'topic', title: 'Topic', type: 'enum', values: [...TOPIC_IDS], default: 'sports' },
        { key: 'subreddit', title: 'Subreddit', type: 'text' },
      ],
      validateRow: (row) => nameProblem(row.subreddit),
    },
  },

  init(host) {
    unregister = registerPostReasons('topicFilters', reasonFor);
    removeMenu = host.ui.addMenuItem({
      id: 'topicFilters',
      get label() {
        return menuLabel(enabled);
      },
      order: 37,
      hint: () => text.menu(enabled.map((id) => TOPICS[id]?.label ?? id)),
      onClick: () =>
        openTopicPanel(menuAnchor(), {
          isOn: (id) => enabled.includes(id),
          size: (id) => topicSize(id, extra),
          toggle: (id, on) => void setTopic(id, on),
        }),
    });
    sync(host);
  },

  onRoute(_route, host) {
    ctx = host;
    closeTopicPanel();
  },

  onSettings(host) {
    sync(host);
  },

  dispose() {
    closeTopicPanel();
    unregister?.();
    unregister = null;
    removeMenu?.();
    removeMenu = null;
    ctx = null;
    enabled = [];
    extra = [];
    allow = new Set();
    index = new Map();
  },
});
