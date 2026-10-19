/**
 * Builds src/data/neutrality-scores.json for the neutralityFilter module.
 *
 *   node --experimental-strip-types scripts/build-neutrality-data.ts [bias_scores.tab] [News_Domain_Media_Scores.csv]
 *
 * With no paths the files are downloaded (a build-time step on a developer machine; the extension
 * itself never makes these requests).
 *
 * Source 1 (the long tail, ~19k domains): Robertson, Jiang, Joseph, Friedland, Lazer & Wilson (2018),
 * "Partisan Bias Scores for Web Domains", Harvard Dataverse, doi:10.7910/DVN/QAN5VX, CC0 1.0, file
 * 3316961. Only `domain` and `score` are read: -1 = shared mostly by Democrats, +1 = mostly by
 * Republicans, from a 2017 Twitter panel. The other columns are not shipped (some derive from
 * third-party raters).
 *
 * Source 2 (~180 major outlets, newer): Eady, Bonneau, Tucker & Nagler (2025), "News Sharing on
 * Social Media: Mapping the Ideology of News Media, Politicians, and the Mass Public", Political
 * Analysis 33(2), doi:10.1017/pan.2024.19; replication data doi:10.7910/DVN/1QMLOV, CC0 1.0, file
 * News_Domain_Media_Scores.csv (domain, zeta, ...). zeta is an ideal point (roughly -2..+2.2) from
 * politicians' 2017-2020 news sharing, on a different scale. It is mapped onto Robertson's scale by
 * an ordinary least-squares fit of Robertson on zeta over the domains in both, computed here at
 * build time (nothing hard-coded), then clamped to [-1, 1]. A mapped Eady score REPLACES the
 * Robertson score for that domain; Eady-only domains are added. Every scored domain is
 * kept, including those near 0: the lean chip needs them (a domain Eady moves to the centre shows
 * as "neutral"), and hiding is decided by the reader's thresholds at run time, not by this file.
 *
 * Output shape: { meta, scores: { domain: -1..1 } }. meta.eady lists the domains whose score came
 * from Eady (all others come from Robertson). Domains are lower-case without `www.`; scores are
 * rounded to 3 decimals.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROBERTSON_URL = 'https://dataverse.harvard.edu/api/access/datafile/3316961';
export const EADY_URL = 'https://gregoryeady.com/Data/News_Domain_Media_Scores.csv';

export interface SourceMeta {
  id: 'robertson' | 'eady';
  title: string;
  authors: string;
  /** Short citation shown next to a score, e.g. "Eady et al. 2025". */
  cite: string;
  year: number;
  doi: string;
  licence: string;
  url: string;
  period: string;
}

export interface Fit {
  /** robertson ~= a * zeta + b */
  a: number;
  b: number;
  /** Pearson correlation over the overlap. */
  r: number;
  n: number;
}

export interface NeutralityMeta {
  sources: SourceMeta[];
  fit: Fit;
  built: string;
  counts: { total: number; robertson: number; eady: number };
  /** Domains whose score came from Eady; every other domain's came from Robertson. */
  eady: string[];
  note: string;
}

export interface NeutralityData {
  meta: NeutralityMeta;
  scores: Record<string, number>;
}

const unquote = (s: string): string => s.trim().replace(/^"(.*)"$/, '$1');

/** Lower-case, no `www.`; null for junk keys (a port, a path, or a `.ln.is` redirect host). */
export function normaliseDomain(raw: string): string | null {
  const d = unquote(raw)
    .toLowerCase()
    .replace(/^www\./, '');
  if (!d || d.includes(':') || d.includes('/') || d.endsWith('.ln.is')) return null;
  return d;
}

/** Read the `domain` and `score` columns of a Dataverse .tab file into { domain: score }. */
export function parseScores(tab: string): Record<string, number> {
  const lines = tab.split(/\r?\n/).filter((l) => l.trim());
  const header = (lines.shift() ?? '').split('\t').map((c) => unquote(c).toLowerCase());
  const iDomain = header.indexOf('domain');
  const iScore = header.indexOf('score');
  if (iDomain < 0 || iScore < 0) throw new Error('bias_scores.tab: no domain/score columns');
  const out: Record<string, number> = {};
  for (const line of lines) {
    const cols = line.split('\t');
    const domain = normaliseDomain(cols[iDomain] ?? '');
    const score = Number(unquote(cols[iScore] ?? ''));
    if (!domain || !Number.isFinite(score) || Math.abs(score) > 1) continue;
    const rounded = Math.round(score * 1000) / 1000;
    // After www. is stripped two rows can share a key: keep the more partisan, deterministically.
    const was = out[domain];
    if (was === undefined || Math.abs(rounded) > Math.abs(was)) out[domain] = rounded;
  }
  return out;
}

/** Read the `domain` and `zeta` columns of the Eady CSV; repeated rows are averaged. */
export function parseEady(csv: string): Record<string, number> {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const header = (lines.shift() ?? '').split(',').map((c) => unquote(c).toLowerCase());
  const iDomain = header.indexOf('domain');
  const iZeta = header.indexOf('zeta');
  if (iDomain < 0 || iZeta < 0)
    throw new Error('News_Domain_Media_Scores.csv: no domain/zeta columns');
  const sums = new Map<string, { sum: number; n: number }>();
  for (const line of lines) {
    const cols = line.split(',');
    const domain = normaliseDomain(cols[iDomain] ?? '');
    const zeta = Number(unquote(cols[iZeta] ?? ''));
    if (!domain || !Number.isFinite(zeta)) continue;
    const e = sums.get(domain) ?? { sum: 0, n: 0 };
    e.sum += zeta;
    e.n += 1;
    sums.set(domain, e);
  }
  const out: Record<string, number> = {};
  for (const [domain, { sum, n }] of sums) out[domain] = sum / n;
  return out;
}

/** Ordinary least squares of y on x, with Pearson r. Needs at least 3 points with varying x and y. */
export function linearFit(xs: readonly number[], ys: readonly number[]): Fit {
  const n = xs.length;
  if (n < 3 || ys.length !== n) throw new Error('fit: need at least 3 paired points');
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0 || syy === 0) throw new Error('fit: no variance');
  const a = sxy / sxx;
  return { a, b: my - a * mx, r: sxy / Math.sqrt(sxx * syy), n };
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;
const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v));

/**
 * Merge the two sources (see the header), keeping every scored domain, sorted by domain so
 * rebuilds diff cleanly.
 */
export function buildData(robertsonTab: string, eadyCsv: string, built: string): NeutralityData {
  const rob = parseScores(robertsonTab);
  const eady = parseEady(eadyCsv);
  const overlap = Object.keys(eady).filter((d) => d in rob);
  const fit = linearFit(
    overlap.map((d) => eady[d]!),
    overlap.map((d) => rob[d]!),
  );

  const merged: Record<string, { score: number; from: 'robertson' | 'eady' }> = {};
  for (const [d, s] of Object.entries(rob)) merged[d] = { score: s, from: 'robertson' };
  for (const [d, z] of Object.entries(eady))
    merged[d] = { score: round3(clamp1(fit.a * z + fit.b)), from: 'eady' };

  const scores: Record<string, number> = {};
  const fromEady: string[] = [];
  for (const domain of Object.keys(merged).sort()) {
    const { score, from } = merged[domain]!;
    scores[domain] = score;
    if (from === 'eady') fromEady.push(domain);
  }
  const total = Object.keys(scores).length;
  return {
    meta: {
      sources: [
        {
          id: 'eady',
          title:
            'News Sharing on Social Media: Mapping the Ideology of News Media, Politicians, and the Mass Public',
          authors: 'Eady, Bonneau, Tucker & Nagler',
          cite: 'Eady et al. 2025',
          year: 2025,
          doi: '10.1017/pan.2024.19',
          licence: 'CC0 1.0',
          url: 'https://doi.org/10.7910/DVN/1QMLOV',
          period: "politicians' news sharing, 2017-2020",
        },
        {
          id: 'robertson',
          title: 'Partisan Bias Scores for Web Domains',
          authors: 'Robertson, Jiang, Joseph, Friedland, Lazer & Wilson',
          cite: 'Robertson et al. 2018',
          year: 2018,
          doi: '10.7910/DVN/QAN5VX',
          licence: 'CC0 1.0',
          url: 'https://doi.org/10.7910/DVN/QAN5VX',
          period: '2017 Twitter panel',
        },
      ],
      fit: { a: round6(fit.a), b: round6(fit.b), r: round6(fit.r), n: fit.n },
      built,
      counts: { total, robertson: total - fromEady.length, eady: fromEady.length },
      eady: fromEady,
      note: 'The score measures who SHARES a domain (audience partisanship, -1 left-leaning, +1 right-leaning), not a judgement of its content. A score near 0 does not mean a domain is neutral or reliable. About 180 major outlets use the newer Eady et al. data (politicians’ news sharing 2017-2020), mapped onto the Robertson scale with a linear fit; every other domain comes from the 2017-2018 Robertson et al. data, and some have changed since. Every scored domain is included, so a score near 0 means a balanced audience, not a neutral site.',
    },
    scores,
  };
}

async function read(arg: string | undefined, url: string): Promise<string> {
  if (arg) return readFileSync(arg, 'utf8');
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download failed: HTTP ${r.status} (${url})`);
  return r.text();
}

async function main(): Promise<void> {
  const [tab, csv] = await Promise.all([
    read(process.argv[2], ROBERTSON_URL),
    read(process.argv[3], EADY_URL),
  ]);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const out = resolve(root, 'src/data/neutrality-scores.json');
  mkdirSync(dirname(out), { recursive: true });
  const data = buildData(tab, csv, '2026-10-16');
  writeFileSync(out, JSON.stringify(data) + '\n');
  const { counts, fit } = data.meta;
  console.log(
    `wrote ${out}: ${counts.total} domains (${counts.eady} Eady, ${counts.robertson} Robertson); ` +
      `fit a=${fit.a} b=${fit.b} r=${fit.r} n=${fit.n}`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
