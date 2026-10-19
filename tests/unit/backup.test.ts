import { describe, expect, it } from 'vitest';
import { buildBackup, parseBackup, BACKUP_MAX_BYTES } from '../../src/core/backup';
import { CURRENT_SCHEMA_VERSION } from '../../src/core/storage/migrations';

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
