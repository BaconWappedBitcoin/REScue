/**
 * Storage migrations (contracts/storage-schema.md). Each migration upgrades data from schema
 * version `from` to `from + 1`. They run in order on a deep copy; any failure leaves the original
 * untouched so the user can still export it.
 */
export type StoredData = Record<string, unknown>;

export interface Migration {
  from: number;
  up(data: StoredData): StoredData;
}

export interface MigrationResult {
  ok: boolean;
  data: StoredData;
  error?: string;
}

export const versionOf = (data: StoredData): number => {
  const v = (data.schema as { version?: unknown } | undefined)?.version;
  return typeof v === 'number' && v >= 1 ? v : 1;
};

export function runMigrations(original: StoredData, migrations: Migration[]): MigrationResult {
  const pending = [...migrations]
    .sort((a, b) => a.from - b.from)
    .filter((m) => m.from >= versionOf(original));
  if (!pending.length) return { ok: true, data: original };
  try {
    let data = structuredClone(original);
    let version = versionOf(data);
    for (const m of pending) {
      if (m.from !== version)
        throw new Error(`migration gap: at v${version}, next migration is from v${m.from}`);
      data = m.up(data);
      version = m.from + 1;
      data.schema = { version };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, data: original, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * v1 -> v2: neutralityFilter's two label options (labelOnThread, labelInListings) became one
 * option, showLean. A reader who had switched either label on keeps lean chips on; the old keys go.
 */
export function neutralityShowLean(data: StoredData): StoredData {
  const modules = (data.settings as { modules?: Record<string, { options?: unknown }> } | undefined)
    ?.modules;
  const opts = modules?.neutralityFilter?.options as Record<string, unknown> | undefined;
  if (!opts || !('labelOnThread' in opts || 'labelInListings' in opts)) return data;
  if (opts.labelOnThread === true || opts.labelInListings === true) opts.showLean = true;
  delete opts.labelOnThread;
  delete opts.labelInListings;
  return data;
}

/**
 * v2 -> v3: inlineMedia's switch "Hide inline media" (collapseMedia) used to hide a POST's own
 * media; it now hides the media in COMMENTS, and hiding the post's media is a separate option,
 * collapsePostMedia. A reader who had the switch on keeps their post hiding (collapsePostMedia
 * on) and gains comment hiding with the same switch; anyone else is unchanged.
 */
export function inlineMediaPostOption(data: StoredData): StoredData {
  const modules = (data.settings as { modules?: Record<string, { options?: unknown }> } | undefined)
    ?.modules;
  const opts = modules?.inlineMedia?.options as Record<string, unknown> | undefined;
  if (!opts || opts.collapseMedia !== true || 'collapsePostMedia' in opts) return data;
  opts.collapsePostMedia = true;
  return data;
}

/** Registered migrations, in order. */
export const MIGRATIONS: Migration[] = [
  { from: 1, up: neutralityShowLean },
  { from: 2, up: inlineMediaPostOption },
];
export const CURRENT_SCHEMA_VERSION = 1 + MIGRATIONS.length;
