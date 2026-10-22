import { describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, BACKUP_MAX_BYTES } from '../../src/core/backup';
import {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  runMigrations,
} from '../../src/core/storage/migrations';

const all = {
  schema: { version: 1 },
  settings: { schemaVersion: 1, syncEnabled: false },
  userTags: { spez: { text: 'ceo' } },
  filters: [{ id: 'f1', type: 'keyword', pattern: 'foo' }],
  read: { t3_a: { lastVisit: 1, commentCountAtVisit: 2 } },
  'mod:x': { private: true },
};

describe('backup export', () => {
  it('writes the rescue-backup format, version 1, without module-private keys', () => {
    const file = buildBackup(all, '1.2.3', false, new Date('2026-10-15T12:00:00Z'));
    expect(file).toMatchObject({
      format: 'rescue-backup',
      formatVersion: 1,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: '2026-10-15T12:00:00.000Z',
      app: { name: 'REScue', version: '1.2.3' },
    });
    expect(Object.keys(file.data).sort()).toEqual(['filters', 'settings', 'userTags']);
  });

  it('includes read history only when asked', () => {
    expect(buildBackup(all, '1', true).data.read).toEqual(all.read);
  });
});

describe('backup import', () => {
  const file = (extra: object = {}) => JSON.stringify({ ...buildBackup(all, '1', true), ...extra });

  it('replace returns exactly the backup data', () => {
    const r = parseBackup(file(), { userTags: { other: {} } }, 'replace');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.userTags).toEqual(all.userTags);
      expect(r.data).not.toHaveProperty('mod:x');
    }
  });

  it('merge keeps current entries and adds imported ones without duplicating list items', () => {
    const current = {
      userTags: { other: { text: 'x' } },
      filters: [{ id: 'f1', type: 'keyword', pattern: 'foo' }],
    };
    const r = parseBackup(file(), current, 'merge');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.userTags).toEqual({ other: { text: 'x' }, spez: { text: 'ceo' } });
      expect(r.data.filters).toHaveLength(1);
    }
  });

  it('accepts a backup from an older schema version (migrations run)', () => {
    const r = parseBackup(file({ schemaVersion: 1 }), {}, 'replace');
    expect(r.ok).toBe(true);
  });

  it.each([
    ['invalid JSON', '{nope', /invalid JSON/],
    [
      'wrong format',
      JSON.stringify({ format: 'res-backup', formatVersion: 1, data: {} }),
      /Not a REScue backup/,
    ],
    [
      'future format version',
      JSON.stringify({ format: 'rescue-backup', formatVersion: 2, data: {} }),
      /Unsupported/,
    ],
    ['no data', JSON.stringify({ format: 'rescue-backup', formatVersion: 1 }), /no data/],
  ])('rejects %s', (_n, json, msg) => {
    const r = parseBackup(json, {}, 'replace');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(msg);
  });

  it('rejects files over 50 MB', () => {
    const big = 'x'.repeat(BACKUP_MAX_BYTES + 1);
    const r = parseBackup(big, {}, 'replace');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/50 MB/);
  });
});

describe('backup import checks the file before anything is written', () => {
  const base = (over: Record<string, unknown> = {}, data: Record<string, unknown> = {}) =>
    JSON.stringify({ ...buildBackup({}, '1', true), ...over, data });

  it('rejects a backup from a newer REScue instead of writing its version', () => {
    const r = parseBackup(base({ schemaVersion: 9 }, { userTags: {} }), {}, 'replace');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer version of REScue.*9/);
  });

  it('accepts the current schema version and keeps it', () => {
    const r = parseBackup(base({ schemaVersion: CURRENT_SCHEMA_VERSION }), {}, 'replace');
    expect(r).toEqual({ ok: true, data: { schema: { version: CURRENT_SCHEMA_VERSION } } });
  });

  it('treats a missing schema version as the first one (and upgrades it)', () => {
    const r = parseBackup(base({ schemaVersion: undefined }), {}, 'replace');
    expect(r).toEqual({ ok: true, data: { schema: { version: CURRENT_SCHEMA_VERSION } } });
  });

  it.each([['2'], [0], [1.5], [-3]])('rejects schema version %j', (v) => {
    const r = parseBackup(base({ schemaVersion: v }), {}, 'replace');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid schema version/);
  });

  it.each([
    ['settings', 'x'],
    ['settings', []],
    ['userTags', null],
    ['read', 5],
    ['savedComments', 'y'],
    ['threadSubscriptions', [1]],
    ['filters', {}],
  ])('rejects %s of the wrong type (%j)', (key, value) => {
    const r = parseBackup(base({}, { [key]: value }), {}, 'merge');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(`“${key}”`);
  });

  it.each([['null'], ['[]'], ['"text"'], ['7']])(
    'rejects a file that is not an object (%s)',
    (j) => {
      const r = parseBackup(j, {}, 'replace');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Not a REScue backup/);
    },
  );

  it('rejects data that is a list', () => {
    const r = parseBackup(base({}, [] as never), {}, 'replace');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no data/);
  });

  it('ignores keys the backup format does not own', () => {
    const r = parseBackup(base({}, { 'mod:x': { a: 1 }, syncState: {} }), {}, 'replace');
    expect(r).toEqual({ ok: true, data: { schema: { version: CURRENT_SCHEMA_VERSION } } });
  });
});

describe('runMigrations at the edges', () => {
  it('leaves data from a newer version untouched (never lowers its version)', () => {
    const data = { schema: { version: 9 }, settings: { a: 1 } };
    const r = runMigrations(data, MIGRATIONS);
    expect(r).toEqual({ ok: true, data });
    expect(r.data).toBe(data);
  });

  it('reports a gap in the registered migrations and returns the original', () => {
    const data = { schema: { version: 1 }, settings: {} };
    const r = runMigrations(data, [
      { from: 1, up: (d) => d },
      { from: 3, up: (d) => d },
    ]);
    expect(r).toEqual({
      ok: false,
      data,
      error: 'migration gap: at v2, next migration is from v3',
    });
  });

  it('returns the original when a migration throws, so it can still be exported', () => {
    const data = { schema: { version: 1 }, settings: { x: 1 } };
    const r = runMigrations(data, [
      {
        from: 1,
        up: (d) => {
          (d.settings as { x: number }).x = 2;
          throw new Error('bad');
        },
      },
    ]);
    expect(r).toEqual({
      ok: false,
      data: { schema: { version: 1 }, settings: { x: 1 } },
      error: 'bad',
    });
  });
});
