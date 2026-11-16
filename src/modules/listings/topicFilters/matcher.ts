/**
 * Which subreddit belongs to which switched-on topic. Pure: no page access, no settings access.
 * The index is a Map built once per settings change, so asking about a post is one lookup.
 */
import { SUBREDDIT_NAME, TOPICS, TOPIC_IDS, bareSub, topicOption } from './topics';

type Row = Record<string, unknown>;

/** The topics switched on in these options, in the order they are listed. */
export function enabledTopics(options: Readonly<Record<string, unknown>>): string[] {
  return TOPIC_IDS.filter((id) => options[topicOption(id)] === true);
}

/** The reader's own additions as [topic, subreddit] pairs; blank or invalid rows are skipped. */
export function extraPairs(rows: unknown): Array<[string, string]> {
  if (!Array.isArray(rows)) return [];
  const out: Array<[string, string]> = [];
  for (const row of rows as Row[]) {
    const topic = String(row?.topic ?? '');
    const sub = bareSub(row?.subreddit);
    if (topic in TOPICS && SUBREDDIT_NAME.test(sub)) out.push([topic, sub]);
  }
  return out;
}

/** The subreddit names typed into the allow-list, lowercase and without "r/". */
export function allowSet(rows: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(rows)) return out;
  for (const row of rows as Row[]) {
    const sub = bareSub(row?.subreddit);
    if (SUBREDDIT_NAME.test(sub)) out.add(sub);
  }
  return out;
}

/**
 * subreddit -> topic id for every switched-on topic (data plus the reader's additions). A
 * subreddit in two switched-on topics is reported under the first one in listing order.
 */
export function buildIndex(
  enabled: readonly string[],
  extra: ReadonlyArray<[string, string]>,
): Map<string, string> {
  const on = new Set(enabled);
  const index = new Map<string, string>();
  for (const id of TOPIC_IDS) {
    if (!on.has(id)) continue;
    for (const sub of TOPICS[id]!.subreddits) if (!index.has(sub)) index.set(sub, id);
    for (const [topic, sub] of extra) if (topic === id && !index.has(sub)) index.set(sub, id);
  }
  return index;
}

/** How many distinct subreddits a topic covers, including the reader's additions. */
export function topicSize(id: string, extra: ReadonlyArray<[string, string]>): number {
  const subs = new Set(TOPICS[id]?.subreddits ?? []);
  for (const [topic, sub] of extra) if (topic === id) subs.add(sub);
  return subs.size;
}

/** The REScue menu row's label: what is on, at most three names. */
export function menuLabel(enabled: readonly string[]): string {
  if (!enabled.length) return 'Topic filters: none';
  const names = enabled.slice(0, 3).map((id) => TOPICS[id]?.label ?? id);
  const more = enabled.length - names.length;
  return `Topic filters: ${names.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
}

/** Why a post is hidden: the short reason and the longer explanation for its hover. */
export function reasonText(sub: string, topicId: string): { reason: string; detail: string } {
  const label = TOPICS[topicId]?.label ?? topicId;
  return {
    reason: `topic: ${label}`,
    detail: `r/${sub} is in the ${label} topic filter (settings › Topic filters).`,
  };
}
