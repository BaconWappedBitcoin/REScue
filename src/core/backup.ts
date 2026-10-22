/** Backup file format (contracts/storage-schema.md). Pure functions; I/O lives in background.ts. */
import { MIGRATIONS, runMigrations, type StoredData } from './storage/migrations';
import { CURRENT_SCHEMA_VERSION } from './storage/migrations';

export const BACKUP_FORMAT = 'rescue-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
export const BACKUP_KEYS = [
  'settings',
  'userTags',
  'filters',
  'subredditTags',
  'savedComments',
  'read',
  'threadSubscriptions',
] as const;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  app: { name: 'REScue'; version: string };
  data: Partial<Record<(typeof BACKUP_KEYS)[number], unknown>>;
}

export function buildBackup(
  all: StoredData,
  appVersion: string,
  includeRead: boolean,
  now = new Date(),
): BackupFile {
  const data: BackupFile['data'] = {};
  for (const k of BACKUP_KEYS) {
    if (k === 'read' && !includeRead) continue;
    if (all[k] !== undefined) data[k] = all[k];
  }
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    app: { name: 'REScue', version: appVersion },
    data,
  };
}

/** A plain JSON object (not null, not a list). */
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export type ImportResult = { ok: true; data: StoredData } | { ok: false; error: string };

/** Validate and migrate a backup; returns the storage items to write. Never executes content. */
export function parseBackup(
  json: string,
  current: StoredData,
  mode: 'replace' | 'merge',
): ImportResult {
  if (new TextEncoder().encode(json).length > BACKUP_MAX_BYTES)
    return { ok: false, error: 'File is larger than 50 MB.' };
  let file: Partial<BackupFile>;
  try {
    file = JSON.parse(json);
  } catch {
    return { ok: false, error: 'Not a valid backup file (invalid JSON).' };
  }
  if (!isRecord(file) || file.format !== BACKUP_FORMAT)
    return { ok: false, error: 'Not a REScue backup file.' };
  if (file.formatVersion !== BACKUP_FORMAT_VERSION)
    return { ok: false, error: `Unsupported backup format version ${String(file.formatVersion)}.` };
  if (!isRecord(file.data)) return { ok: false, error: 'Backup has no data.' };
  const schemaVersion = file.schemaVersion ?? 1;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1)
    return { ok: false, error: `Backup has an invalid schema version ${String(schemaVersion)}.` };
  // A newer REScue wrote it: this version cannot know what its data means, so it is not written.
  if (schemaVersion > CURRENT_SCHEMA_VERSION)
    return {
      ok: false,
      error: `This backup comes from a newer version of REScue (data version ${schemaVersion}; this version reads up to ${CURRENT_SCHEMA_VERSION}). Update REScue, then import it again.`,
    };
  const imported: StoredData = { schema: { version: schemaVersion } };
  for (const k of BACKUP_KEYS) {
    if (!(k in file.data)) continue;
    const v = file.data[k];
    if (k === 'filters' ? !Array.isArray(v) : !isRecord(v))
      return {
        ok: false,
        error: `Backup is damaged: “${k}” is not ${k === 'filters' ? 'a list' : 'a set of entries'}.`,
      };
    imported[k] = v;
  }
  const migrated = runMigrations(imported, MIGRATIONS);
  if (!migrated.ok) return { ok: false, error: `Could not upgrade backup: ${migrated.error}` };
  if (mode === 'replace') return { ok: true, data: migrated.data };
  const merged: StoredData = { ...current };
  for (const [k, v] of Object.entries(migrated.data)) {
    const cur = current[k];
    if (Array.isArray(v) && Array.isArray(cur))
      merged[k] = [
        ...cur,
        ...v.filter((x) => !cur.some((c) => JSON.stringify(c) === JSON.stringify(x))),
      ];
    else if (v && typeof v === 'object' && cur && typeof cur === 'object' && !Array.isArray(v))
      merged[k] = { ...cur, ...v };
    else merged[k] = v;
  }
  return { ok: true, data: merged };
}
