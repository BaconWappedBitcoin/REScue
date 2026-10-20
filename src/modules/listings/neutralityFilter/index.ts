/**
 * Neutrality filter (a REScue extra, not part of RES): hide link posts whose domain is shared mostly
 * by one side of the political divide, with separate left and right strictness.
 *
 * The score is audience partisanship, not a verdict on the site: it says who tends to SHARE a
 * domain (-1 mostly Democrats, +1 mostly Republicans). 0 is not "neutral". The bundled data is
 * Eady et al. 2025 for ~180 major outlets and Robertson et al. 2018 for the rest (both CC0 1.0); see the module description and the About page.
 *
 * Hiding goes through filteReddit (../filteReddit/external.ts), so the "N posts filtered · show"
 * banner, the reason chip, the placeholder row and the power switch work exactly as for the reader's
 * own filters. Turning filteReddit off stops the hiding (the chips do not depend on it). The data file is
 * a plain bundled file, fetched from the extension itself (no network) only when a side is not off
 * or showLean is on. showLean adds a lean chip (chip.ts) to every scored link post, hidden or not.
 * Domains are matched by longest suffix (scoring.ts); platforms in IGNORED_DOMAINS are never scored.
 */
import { h } from '../../../core/dom';
import { hint } from '../../../core/hints';
import { defineModule, type ModuleContext, type ModuleLink } from '../../../core/types';
import type { Post } from '../../../model/types';
import { changed, registerPostReasons } from '../filteReddit/external';
import { chipDetail, chipStyle, chipText } from './chip';
import { loadNeutralityData, type DataMeta, type SourceInfo } from './data';
import {
  allowSet,
  hides,
  isAllowed,
  leanReason,
  linkDomain,
  lookup,
  type Lean,
  type Level,
  type Scores,
} from './scoring';

/** Shown until the data is loaded; tests/unit/neutrality.test.ts checks it against the data's meta. */
export const FALLBACK_CREDITS: readonly ModuleLink[] = [
  {
    label:
      'Newer scores for about 180 major outlets: Eady, Bonneau, Tucker & Nagler (2025), News Sharing on Social Media, Political Analysis 33(2), doi:10.1017/pan.2024.19, data doi:10.7910/DVN/1QMLOV, licence CC0 1.0',
    href: 'https://doi.org/10.7910/DVN/1QMLOV',
  },
  {
    label:
      'All other domains (2017 data): Robertson, Jiang, Joseph, Friedland, Lazer & Wilson (2018), Partisan Bias Scores for Web Domains, Harvard Dataverse, doi:10.7910/DVN/QAN5VX, licence CC0 1.0',
    href: 'https://doi.org/10.7910/DVN/QAN5VX',
  },
];

const levels = (side: string) =>
  [
    { value: 'off', label: 'off: do not hide anything' },
    { value: 'min', label: `min: only the most one-sided ${side} audiences (≥0.7)` },
    { value: 'mid', label: `mid: clearly one-sided ${side} audiences (≥0.5)` },
    { value: 'max', label: `max: any noticeably one-sided ${side} audience (≥0.3)` },
  ] as const;

interface Seen {
  post: Post;
  el: HTMLElement | null;
}

let ctx: ModuleContext | null = null;
let scores: Scores | null = null;
let fromEady: ReadonlySet<string> = new Set();
let meta: DataMeta | null = null;
let loading = false;
let failed = false;
let allow = new Set<string>();
let unregister: (() => void) | null = null;
/** Quiet retries after a failed data request, then the module stays without data until re-init. */
const RETRY_MS: readonly number[] = [2000, 8000, 30000];
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const seen = new Map<string, Seen>();

/** True once the data chunk has been fetched (tests, and nothing else, ask). */
export const dataLoaded = (): boolean => scores !== null;

const side = (key: 'left' | 'right'): Level => (ctx?.options[key] as Level | undefined) ?? 'off';
/** A side is set, so posts can be hidden (and only while filteReddit is on). */
const hiding = (): boolean => side('left') !== 'off' || side('right') !== 'off';
const showLean = (): boolean => !!ctx?.options.showLean;
/** The score data is needed for hiding and for chips, and for nothing else. */
const wantData = (): boolean => hiding() || showLean();

async function load(): Promise<void> {
  if (scores || loading || failed || !wantData()) return;
  loading = true;
  try {
    const data = await loadNeutralityData();
    retries = 0;
    scores = data.scores;
    meta = data.meta;
    fromEady = new Set(data.meta.eady ?? []);
  } catch (err) {
    failed = true;
    console.error('[REScue] neutralityFilter could not load its data', err);
    if (retries === 0)
      ctx?.notices.show('REScue: the neutrality filter could not load its data.', {
        kind: 'error',
      });
    // The request can fail only because the background was still waking up (Firefox event page).
    // A permanent failed flag would leave the chips off for the whole page view, so try again.
    const delay = RETRY_MS[retries++];
    if (delay !== undefined && ctx && !retryTimer) {
      retryTimer = setTimeout(() => {
        retryTimer = null;
        failed = false;
        void load();
      }, delay);
    }
  }
  loading = false;
  if (!ctx) return; // switched off while loading
  changed();
  refreshLabels();
}

function leanOf(post: Post): Lean | null {
  if (!scores) return null;
  const domain = linkDomain(post);
  return domain ? lookup(scores, domain, fromEady) : null;
}

/** filteReddit asks this for every post it has not already filtered. */
function reasonFor(
  post: Post,
  host: ModuleContext,
): string | { reason: string; detail: string } | undefined {
  if (!ctx || !hiding() || host.route.kind === 'thread') return undefined;
  const lean = leanOf(post);
  if (!lean || !hides(lean, side('left'), side('right')) || isAllowed(allow, lean.domain))
    return undefined;
  const detailed = !!ctx.options.showReason;
  const reason = leanReason(lean, detailed);
  return detailed ? { reason, detail: `neutrality filter, ${chipDetail(lean)}` } : reason;
}

/** The chip on a post: every scored link post when showLean is on, except one hidden right now. */
function refreshLabel(entry: Seen): void {
  const lean = ctx && showLean() ? leanOf(entry.post) : null;
  const hiddenHere = !!lean && !!ctx && !!reasonFor(entry.post, ctx) && ctx.route.kind !== 'thread';
  if (!lean || !ctx || hiddenHere) {
    if (entry.el) {
      entry.el.hidden = true;
      entry.el.style.display = 'none'; // an inline display would override [hidden]
    }
    return;
  }
  if (!entry.el) {
    entry.el = h('span', { class: 'rescue-lean-chip rescue-label' });
    entry.el.style.cssText = 'border:1px solid rgba(127,127,127,.5)';
    ctx.ui.decorate(entry.post, 'domain', entry.el);
  }
  const { background, color } = chipStyle(lean.score);
  const text = chipText(lean, !!ctx.options.showLeanScore);
  if (entry.el.textContent !== text) entry.el.textContent = text;
  entry.el.style.background = background;
  entry.el.style.color = color;
  entry.el.title = hint.neutralityChip(chipDetail(lean));
  entry.el.dataset.lean = String(lean.score);
  entry.el.hidden = false;
  entry.el.style.display = 'inline-block';
}

function refreshLabels(): void {
  for (const entry of seen.values()) refreshLabel(entry);
}

function sync(next: ModuleContext): void {
  ctx = next;
  allow = allowSet((next.options.allowDomains as string[] | undefined) ?? []);
  void load();
  changed();
  refreshLabels();
}

function credit(): ModuleLink[] {
  if (!meta) return [...FALLBACK_CREDITS];
  const line = (s: SourceInfo): ModuleLink => ({
    label: `${s.id === 'eady' ? 'Newer scores for about 180 major outlets' : 'All other domains'}: ${s.authors} (${s.year}), ${s.title}, doi:${s.doi}, ${s.period}, licence ${s.licence}`,
    href: s.url,
  });
  return meta.sources.map(line);
}

export const neutralityFilter = defineModule({
  id: 'neutralityFilter',
  category: 'listings',
  title: 'Neutrality filter',
  description:
    'Show each link post’s audience lean as a small chip (far left, left, lean left, neutral, lean right, right, far right), and optionally hide link posts whose domain is shared mostly by one side of the political divide, with a separate strictness for the left and the right. The chip is coloured on a scale from blue (audience leans left) through grey (balanced) to red (audience leans right); hover it for the exact score and its source. The score measures who SHARES a domain (its audience, from -1 mostly Democrats to +1 mostly Republicans), not whether the site is accurate or biased; a score near 0 does not mean a site is neutral or reliable. Two datasets are bundled: Eady et al. (2025, politicians’ news sharing 2017-2020) covers about 180 major outlets with newer data, mapped onto the same -1 to +1 scale; every other domain comes from Robertson et al. (2018, a 2017 Twitter panel), so those sites may have changed since. The hover text and the reason name the source of each score. Posts on domains not in the data, text posts, Reddit-hosted media and big platforms (YouTube, X/Twitter, Imgur, Medium, Substack, GitHub) get no chip and are never hidden. A post is never hidden on its own page, but its chip shows there. Hidden posts are counted in the filter bar, where “show” reveals them with the reason. Data: Eady, Bonneau, Tucker & Nagler (2025), News Sharing on Social Media, Political Analysis 33(2), doi:10.1017/pan.2024.19, data doi:10.7910/DVN/1QMLOV (CC0 1.0); and Robertson, Jiang, Joseph, Friedland, Lazer & Wilson (2018), Partisan Bias Scores for Web Domains, Harvard Dataverse, doi:10.7910/DVN/QAN5VX (CC0 1.0). They are bundled with REScue and makes no network requests. The chips work on their own; hiding goes through filteReddit and does nothing while filteReddit is off.',
  enabledByDefault: false,
  options: {
    showLean: {
      type: 'boolean',
      default: false,
      title: 'Show each post’s audience lean',
      description:
        'Adds a chip after the domain of every link post whose domain is in the data, in listings, search results and on the post’s own page. Words use the same cut-offs as the hiding levels: far left (-0.7 or lower), left (-0.5), lean left (-0.3), neutral (between), lean right (0.3), right (0.5), far right (0.7 or higher). Colour runs from blue (-1, left) through grey (0) to red (+1, right). It is who SHARES the domain, not a rating of its content: neutral means a mixed audience, not an unbiased site. Eady et al. scores date from 2017-2020 and Robertson et al. scores from 2017, so some have changed since. Works with both hiding sides off. Domains not in the data get no chip.',
    },
    showLeanScore: {
      type: 'boolean',
      default: false,
      title: 'Put the number in the chip',
      description: 'Adds the score, such as “right +0.62”, to the chip text.',
      dependsOn: 'showLean',
    },
    left: {
      type: 'enum',
      default: 'off',
      title: 'Hide domains with a left-leaning audience',
      description:
        'min hides only domains scoring -0.7 or lower, mid -0.5 or lower, max -0.3 or lower. A higher setting hides more.',
      values: [...levels('left')],
    },
    right: {
      type: 'enum',
      default: 'off',
      title: 'Hide domains with a right-leaning audience',
      description:
        'min hides only domains scoring 0.7 or higher, mid 0.5 or higher, max 0.3 or higher. A higher setting hides more.',
      values: [...levels('right')],
    },
    allowDomains: {
      type: 'list',
      default: [],
      title: 'Never hide these domains',
      description:
        'One domain per line, such as example.com. Covers its subdomains too (news.example.com).',
    },
    showReason: {
      type: 'boolean',
      default: true,
      title: 'Name the domain and score in the reason',
      description:
        'Off shows only “neutrality” as the reason in the filter bar and on revealed posts.',
    },
  },

  links: credit,

  init(host) {
    unregister = registerPostReasons('neutralityFilter', reasonFor);
    failed = false;
    sync(host);
  },

  onItems(batch, host) {
    ctx = host;
    for (const post of batch.posts) {
      const known = seen.get(post.id);
      const entry = known ?? { post, el: null };
      entry.post = post;
      seen.set(post.id, entry);
      refreshLabel(entry);
    }
  },

  onRoute(_route, host) {
    seen.clear();
    ctx = host;
  },

  onSettings(host) {
    sync(host);
  },

  dispose() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    retries = 0;
    unregister?.();
    unregister = null;
    for (const entry of seen.values()) entry.el?.remove();
    seen.clear();
    ctx = null;
    scores = null;
    fromEady = new Set();
    meta = null;
    loading = false;
    allow = new Set();
  },
});
