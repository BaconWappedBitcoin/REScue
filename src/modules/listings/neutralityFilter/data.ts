/**
 * Where the neutrality scores come from. The file (src/data/neutrality-scores.json) is NOT part of
 * the page script: it is copied into the extension as a plain data file (wxt.config.ts) and the
 * background reads it only when asked (core/net.ts readBundledJson). A content script cannot split
 * its code into lazy chunks, and 220 KB of scores must not weigh down every Reddit page.
 */
import type { Scores } from './scoring';

export interface SourceInfo {
  id: 'robertson' | 'eady';
  title: string;
  authors: string;
  cite: string;
  year: number;
  doi: string;
  licence: string;
  url: string;
  period: string;
}
export interface DataMeta {
  sources: SourceInfo[];
  fit: { a: number; b: number; r: number; n: number };
  counts: { total: number; robertson: number; eady: number };
  /** Domains whose score came from the Eady source; all others are from Robertson. */
  eady: string[];
  note: string;
}
export interface NeutralityData {
  meta: DataMeta;
  scores: Scores;
}

/** Ask the background for the score file. Rejects when it cannot be read or is not the right shape. */
export async function loadNeutralityData(): Promise<NeutralityData> {
  const reply = (await browser.runtime.sendMessage({ type: 'neutrality.data' })) as
    { ok: true; data: NeutralityData } | { ok: false } | undefined;
  if (!reply || !reply.ok || !reply.data?.scores || !reply.data.meta)
    throw new Error('neutrality data unavailable');
  return reply.data;
}
