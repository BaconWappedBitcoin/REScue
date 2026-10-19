import { describe, expect, it, vi, afterEach } from 'vitest';
import { runMigrations, type Migration } from '../../src/core/storage/migrations';
import { chunkForSync, unchunkFromSync, SYNC_CHUNK_BYTES } from '../../src/core/storage/sync';
import { DebouncedWriter } from '../../src/core/storage/store';
import { pruneRead, READ_MAX_THREADS, READ_MAX_AGE_MS } from '../../src/core/storage/prune';

describe('migrations', () => {
  const m = (
    from: number,
    fn: (d: Record<string, unknown>) => Record<string, unknown>,
  ): Migration => ({ from, up: fn });

  it('runs pending migrations in order on a copy', () => {
    const original = { schema: { version: 1 }, a: 1 };
    const result = runMigrations(original, [
      m(2, (d) => ({ ...d, c: (d.b as number) * 10 })),
      m(1, (d) => ({ ...d, b: 2 })),
    ]);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ a: 1, b: 2, c: 20, schema: { version: 3 } });
    expect(original).toEqual({ schema: { version: 1 }, a: 1 });
  });

  it('skips migrations already applied', () => {
    const up = vi.fn((d) => d);
    runMigrations({ schema: { version: 5 } }, [m(1, up), m(4, up)]);
    expect(up).not.toHaveBeenCalled();
  });

  it('leaves data untouched when a migration throws', () => {
    const original = { schema: { version: 1 }, keep: true };
    const result = runMigrations(original, [
      m(1, () => {
        throw new Error('bad');
      }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.data).toBe(original);
    expect(result.error).toMatch(/bad/);
  });
});

describe('sync chunking', () => {
  const big = {
    modules: Object.fromEntries(
      Array.from({ length: 400 }, (_, i) => [
        `m${i}`,
        { enabled: true, options: { text: 'x'.repeat(40) } },
      ]),
    ),
  };

  it('splits into chunks of at most 7 KB each, plus meta', () => {
    const items = chunkForSync(big);
    const chunks = Object.keys(items).filter(
      (k) => k.startsWith('settings.') && k !== 'settings.meta',
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const k of chunks)
      expect(new TextEncoder().encode(items[k] as string).length).toBeLessThanOrEqual(
        SYNC_CHUNK_BYTES,
      );
    expect(SYNC_CHUNK_BYTES).toBeLessThanOrEqual(7 * 1024);
  });

  it('round-trips', () => {
    expect(unchunkFromSync(chunkForSync(big))).toEqual(big);
  });

  it('rejects a chunk set whose hash does not match', () => {
    const items = chunkForSync(big);
    items['settings.0'] = (items['settings.0'] as string).replace('x', 'y');
    expect(unchunkFromSync(items)).toBeNull();
  });

  it('rejects a missing chunk', () => {
    const items = chunkForSync(big);
    delete items['settings.1'];
    expect(unchunkFromSync(items)).toBeNull();
  });
});

describe('debounced writer', () => {
  afterEach(() => vi.useRealTimers());

  it('batches writes within 250 ms into one set call', async () => {
    vi.useFakeTimers();
    const set = vi.fn(async () => {});
    const w = new DebouncedWriter(set, 250);
    w.write('a', 1);
    w.write('b', 2);
    await vi.advanceTimersByTimeAsync(200);
    w.write('a', 3);
    expect(set).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith({ a: 3, b: 2 });
  });

  it('flush() writes immediately', async () => {
    const set = vi.fn(async () => {});
    const w = new DebouncedWriter(set, 250);
    w.write('a', 1);
    await w.flush();
    expect(set).toHaveBeenCalledWith({ a: 1 });
  });
});

describe('read-history pruning', () => {
  const now = Date.UTC(2026, 9, 15);
  const rec = (ageDays: number) => ({
    lastVisit: now - ageDays * 86_400_000,
    commentCountAtVisit: 1,
  });

  it('drops records older than 90 days', () => {
    const out = pruneRead({ a: rec(1), b: rec(91) }, now);
    expect(Object.keys(out)).toEqual(['a']);
    expect(READ_MAX_AGE_MS).toBe(90 * 86_400_000);
  });

  it('keeps only the most recent 50,000 threads', () => {
    expect(READ_MAX_THREADS).toBe(50_000);
    const many = Object.fromEntries(
      Array.from({ length: 50_010 }, (_, i) => [
        `t${i}`,
        { lastVisit: now - i * 1000, commentCountAtVisit: 0 },
      ]),
    );
    const out = pruneRead(many, now);
    expect(Object.keys(out)).toHaveLength(50_000);
    expect(out.t0).toBeDefined();
    expect(out.t50009).toBeUndefined();
  });
});
