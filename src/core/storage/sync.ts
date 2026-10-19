/**
 * storage.sync chunking for the settings profile (contracts/storage-schema.md). Chrome's sync quota
 * is ~8 KB per item; chunks stay at or under 7 KB of UTF-8 including JSON string quoting.
 */
export const SYNC_CHUNK_BYTES = 7 * 1024;
const PREFIX = 'settings.';
const META = 'settings.meta';

interface Meta {
  chunks: number;
  hash: string;
  version: 1;
}

/** FNV-1a 32-bit over the serialized profile; detects torn or mixed chunk sets, not tampering. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const bytes = (s: string) => new TextEncoder().encode(JSON.stringify(s)).length;

export function chunkForSync(profile: unknown): Record<string, unknown> {
  const json = JSON.stringify(profile);
  const chunks: string[] = [];
  let start = 0;
  while (start < json.length) {
    // Grow greedily, then back off until the JSON-encoded chunk fits the byte budget.
    let end = Math.min(json.length, start + SYNC_CHUNK_BYTES);
    while (end > start + 1 && bytes(json.slice(start, end)) > SYNC_CHUNK_BYTES) end -= 64;
    while (end > start + 1 && bytes(json.slice(start, end)) > SYNC_CHUNK_BYTES) end--;
    chunks.push(json.slice(start, end));
    start = end;
  }
  const items: Record<string, unknown> = {};
  chunks.forEach((c, i) => (items[`${PREFIX}${i}`] = c));
  const meta: Meta = { chunks: chunks.length, hash: fnv1a(json), version: 1 };
  items[META] = meta;
  return items;
}

/** Reassemble; null when the set is incomplete or its hash does not match (local profile wins). */
export function unchunkFromSync(items: Record<string, unknown>): unknown | null {
  const meta = items[META] as Meta | undefined;
  if (!meta || typeof meta.chunks !== 'number') return null;
  let json = '';
  for (let i = 0; i < meta.chunks; i++) {
    const part = items[`${PREFIX}${i}`];
    if (typeof part !== 'string') return null;
    json += part;
  }
  if (fnv1a(json) !== meta.hash) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export type SyncRestoreDecision = 'ignore' | 'apply' | 'ask';

/**
 * What to do when the synced settings changed (RES automaticRestore / warnBeforeAutomaticRestore).
 * Nothing happens unless sync is on and the synced copy differs from this device's settings. A copy
 * REScue wrote itself, or one the reader already declined, has the `knownHash` and is ignored.
 * Otherwise the copy is applied at once, or the reader is asked first (the default).
 */
export function decideSyncRestore(input: {
  syncEnabled: boolean;
  /** Hash of this device's settings profile; null when the synced set is incomplete or damaged. */
  localHash: string;
  remoteHash: string | null;
  knownHash?: string | undefined;
  warn: boolean;
}): SyncRestoreDecision {
  if (!input.syncEnabled || input.remoteHash === null) return 'ignore';
  if (input.remoteHash === input.localHash || input.remoteHash === input.knownHash) return 'ignore';
  return input.warn ? 'ask' : 'apply';
}

/** Keys a previous, longer chunk set may have left behind. */
export function staleChunkKeys(
  existing: Record<string, unknown>,
  current: Record<string, unknown>,
): string[] {
  return Object.keys(existing).filter((k) => k.startsWith(PREFIX) && k !== META && !(k in current));
}
