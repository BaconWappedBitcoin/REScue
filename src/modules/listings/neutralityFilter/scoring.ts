/**
 * Pure scoring for the neutrality filter: which domain a post links to, what the data says about
 * its audience, and whether the reader's left/right strictness hides it. No page access, no I/O.
 *
 * The data is generic: { domain: score } with score in [-1, 1] (negative = audience leans left,
 * positive = right). Nothing here knows where the numbers come from.
 */
import type { Post } from '../../../model/types';

export type Level = 'off' | 'min' | 'mid' | 'max';
export type Side = 'left' | 'right';
export type Scores = Readonly<Record<string, number>>;

/** Smallest |score| each level hides. `max` is the loosest net (most posts hidden). */
export const THRESHOLDS: Readonly<Record<Exclude<Level, 'off'>, number>> = {
  min: 0.7,
  mid: 0.5,
  max: 0.3,
};

/**
 * Platforms whose domain (and every subdomain) is never scored. A platform's aggregate score says
 * nothing about an individual creator on it, so it must never hide that creator's posts. Reddit's
 * own hosts are here too: reddit-hosted media is not a link to an outside site.
 */
export const IGNORED_DOMAINS: readonly string[] = [
  'reddit.com',
  'redd.it',
  'redditmedia.com',
  'youtube.com',
  'youtu.be',
  'twitter.com',
  'x.com',
  't.co',
  'imgur.com',
  'medium.com',
  'substack.com',
  'github.com',
];

/** Which dataset a domain's score came from; named next to the score so the reader can tell. */
export type Source = 'eady' | 'robertson';
export const SOURCE_CITE: Readonly<Record<Source, string>> = {
  eady: 'Eady et al. 2025',
  robertson: 'Robertson et al. 2018',
};

export interface Lean {
  domain: string;
  /** The key that matched in the data (a parent of `domain`, or `domain` itself). */
  matched: string;
  score: number;
  side: Side;
  /** Absent only when the caller did not say (the text then carries no source). */
  source?: Source;
}

/** "WWW.Example.com." to "example.com". */
export function cleanDomain(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

/** Every suffix of at least two labels, longest first: a.b.c gives a.b.c, b.c. */
function suffixes(domain: string): string[] {
  const labels = domain.split('.');
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join('.'));
  return out;
}

export function isIgnored(domain: string): boolean {
  return suffixes(domain).some((s) => IGNORED_DOMAINS.includes(s));
}

/**
 * The link domain a post can be scored by, or null for text posts, reddit-hosted media and
 * anything else with no outside domain.
 */
export function linkDomain(post: Pick<Post, 'type' | 'domain'>): string | null {
  if (post.type === 'text') return null;
  const domain = cleanDomain(post.domain ?? '');
  if (!domain.includes('.') || domain.startsWith('self.') || isIgnored(domain)) return null;
  return domain;
}

/**
 * The longest suffix of `domain` listed in `scores` (edition.cnn.com before cnn.com). `fromEady` is
 * the set of keys whose score came from the newer source; every other key came from Robertson.
 */
export function lookup(
  scores: Scores,
  domain: string,
  fromEady: ReadonlySet<string> = new Set(),
): Lean | null {
  for (const key of suffixes(domain)) {
    const score = scores[key];
    if (typeof score === 'number' && Number.isFinite(score)) {
      return {
        domain,
        matched: key,
        score,
        side: score < 0 ? 'left' : 'right',
        source: fromEady.has(key) ? 'eady' : 'robertson',
      };
    }
  }
  return null;
}

/** Does `level` on this lean's own side hide a domain with this score? */
export function hides(lean: Lean, left: Level, right: Level): boolean {
  const level = lean.side === 'left' ? left : right;
  return level !== 'off' && Math.abs(lean.score) >= THRESHOLDS[level];
}

const fmt = (score: number): string => Math.abs(score).toFixed(2);

/**
 * The reason shown in the filter chip and banner. Short, because the chip truncates: "audience lean
 * right 0.61". The domain, source and what the score means go in the tooltip (chip.ts chipDetail).
 */
export function leanReason(lean: Lean, detailed: boolean): string {
  return detailed ? `audience lean ${lean.side} ${fmt(lean.score)}` : 'neutrality';
}

/** Domains the reader never wants hidden, as typed (any case, with or without www., or a URL). */
export function allowSet(list: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of list) {
    const d = cleanDomain(raw.replace(/^[a-z]+:\/\//i, '').replace(/[/?#].*$/, ''));
    if (d) out.add(d);
  }
  return out;
}

/** True when `domain` or any parent of it is on the allow-list. */
export function isAllowed(allow: ReadonlySet<string>, domain: string): boolean {
  return suffixes(domain).some((s) => allow.has(s));
}
