/**
 * The cloud file: `{ format: "rescue-sync", formatVersion: 1, schemaVersion, updatedAt, device,
 * settings, tags? }`. `schemaVersion` is the storage schema the writer used, so the reader runs
 * the same migrations a backup import would. A cloud file is untrusted input: reading it goes
 * through parseBackup (src/core/backup.ts) and normalizeProfile, exactly like an imported backup.
 */
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, parseBackup } from '../backup';
import { normalizeProfile, type SettingsProfile } from '../settings';
import { CURRENT_SCHEMA_VERSION } from '../storage/migrations';
import { fnv1a } from '../storage/sync';
import { CLOUD_MAX_BYTES } from './config';

export const CLOUD_FORMAT = 'rescue-sync';
export const CLOUD_FORMAT_VERSION = 1;

export interface CloudContent {
  settings: SettingsProfile;
  /** userTags; absent when the writer did not sync tags. */
  tags?: Record<string, unknown>;
}

export interface CloudFile extends CloudContent {
  updatedAt: number;
  device: string;
}

export type ParsedCloudFile = { ok: true; file: CloudFile } | { ok: false; error: string };

export const byteLength = (s: string): number => new TextEncoder().encode(s).length;

export class CloudTooLargeError extends Error {
  constructor(bytes: number) {
    super(
      `The sync file would be ${Math.ceil(bytes / 1024)} KB, more than the ${CLOUD_MAX_BYTES / 1024} KB limit. Cloud sync is paused; try turning off "also sync user tags".`,
    );
    this.name = 'CloudTooLargeError';
  }
}

/**
 * Hash of what is synced. `syncEnabled` (this browser's own sync switch) is not part of it: it is
 * a per-browser choice and is never taken from the cloud copy.
 */
export function contentHash(content: CloudContent, includeTags: boolean): string {
  const settings = { ...content.settings, syncEnabled: false };
  return fnv1a(JSON.stringify({ settings, tags: includeTags ? (content.tags ?? null) : null }));
}

export function buildCloudFile(file: CloudFile, includeTags: boolean): string {
  const text = JSON.stringify({
    format: CLOUD_FORMAT,
    formatVersion: CLOUD_FORMAT_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: file.updatedAt,
    device: file.device,
    settings: { ...file.settings, syncEnabled: false },
    ...(includeTags && file.tags ? { tags: file.tags } : {}),
  });
  const bytes = byteLength(text);
  if (bytes > CLOUD_MAX_BYTES) throw new CloudTooLargeError(bytes);
  return text;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const DAMAGED = 'The sync file in your cloud storage is damaged, so it was not used.';

export function parseCloudFile(text: string): ParsedCloudFile {
  if (byteLength(text) > CLOUD_MAX_BYTES)
    return {
      ok: false,
      error: `The sync file in your cloud storage is larger than ${CLOUD_MAX_BYTES / 1024} KB, so it was not used.`,
    };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: DAMAGED };
  }
  if (!isRecord(raw) || raw.format !== CLOUD_FORMAT) return { ok: false, error: DAMAGED };
  if (raw.formatVersion !== CLOUD_FORMAT_VERSION)
    return {
      ok: false,
      error:
        typeof raw.formatVersion === 'number' && raw.formatVersion > CLOUD_FORMAT_VERSION
          ? 'The sync file was written by a newer REScue. Update REScue on this browser.'
          : DAMAGED,
    };
  const { updatedAt, device } = raw;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0)
    return { ok: false, error: DAMAGED };
  if (typeof device !== 'string' || !/^[\w-]{1,64}$/.test(device))
    return { ok: false, error: DAMAGED };
  if (!isRecord(raw.settings)) return { ok: false, error: DAMAGED };
  if ('tags' in raw && !isRecord(raw.tags)) return { ok: false, error: DAMAGED };

  // The same checks and migrations as importing a backup file that holds these two keys.
  const asBackup = JSON.stringify({
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: raw.schemaVersion ?? 1,
    exportedAt: new Date(updatedAt).toISOString(),
    app: { name: 'REScue', version: 'cloud' },
    data: { settings: raw.settings, ...('tags' in raw ? { userTags: raw.tags } : {}) },
  });
  const r = parseBackup(asBackup, {}, 'replace');
  if (!r.ok) return { ok: false, error: `The sync file was not used: ${r.error}` };
  const tags = r.data.userTags;
  return {
    ok: true,
    file: {
      updatedAt,
      device,
      settings: normalizeProfile(r.data.settings),
      ...(isRecord(tags) ? { tags } : {}),
    },
  };
}
