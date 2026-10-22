/**
 * Typed access to browser.storage.local with debounced, batched writes (contracts/storage-schema.md).
 * All writes go through one DebouncedWriter so a burst of tag edits becomes one storage call.
 */
import { browser } from 'wxt/browser';

export const STORAGE_KEYS = {
  schema: 'schema',
  settings: 'settings',
  userTags: 'userTags',
  filters: 'filters',
  subredditTags: 'subredditTags',
  savedComments: 'savedComments',
  read: 'read',
  collapsed: 'collapsed',
  hiddenPosts: 'hiddenPosts',
  threadSubscriptions: 'threadSubscriptions',
} as const;

/** A top-level storage key (contracts/storage-schema.md) a module may read and write. */
export type SharedKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export const moduleKey = (moduleId: string) => `mod:${moduleId}`;

type Setter = (items: Record<string, unknown>) => Promise<void>;

export class DebouncedWriter {
  private pending: Record<string, unknown> = {};
  /** The batch being written right now; still read back until the write has landed. */
  private flushing: Record<string, unknown> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> = Promise.resolve();
  /** True after a failed write until one succeeds, so a failure streak is reported once. */
  private failing = false;

  constructor(
    private readonly set: Setter,
    private readonly delayMs = 250,
    private readonly onError?: (err: unknown) => void,
  ) {}

  write(key: string, value: unknown): void {
    this.pending[key] = value;
    if (this.timer) clearTimeout(this.timer);
    // A failed timer flush is already reported through onError and kept for the next flush.
    this.timer = setTimeout(() => void this.flush().catch(() => {}), this.delayMs);
  }

  /** Read-your-writes: a pending (or in-flight) value shadows what storage holds. */
  peek(key: string): { has: boolean; value?: unknown } {
    if (key in this.pending) return { has: true, value: this.pending[key] };
    if (key in this.flushing) return { has: true, value: this.flushing[key] };
    return { has: false };
  }

  /** Forget pending values for these keys (they are about to be removed from storage). */
  discard(keys: readonly string[]): void {
    for (const k of keys) delete this.pending[k];
  }

  /**
   * Write what is pending now. A failed write keeps its values for the next flush (values written
   * since win) and rejects; later writes are not blocked by it.
   */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.pending;
    this.pending = {};
    if (!Object.keys(batch).length) return this.inflight;
    this.flushing = { ...this.flushing, ...batch };
    const run = this.inflight.then(async () => {
      try {
        await this.set(batch);
        this.failing = false;
      } catch (err) {
        this.pending = { ...batch, ...this.pending };
        if (!this.failing) this.onError?.(err);
        this.failing = true;
        throw err;
      } finally {
        for (const k of Object.keys(batch))
          if (this.flushing[k] === batch[k]) delete this.flushing[k];
      }
    });
    this.inflight = run.catch(() => undefined);
    return run;
  }
}

/** Stores alive in this page, so removeStored can drop their pending writes first. */
const live = new Set<LocalStore>();

export class LocalStore {
  readonly writer: DebouncedWriter;
  /** Per-namespace queue for scoped read-modify-write, so two quick sets never lose a key. */
  private readonly nsQueue = new Map<string, Promise<void>>();

  /** `onWriteError` hears about a failed write once per failure streak (the owner shows it). */
  constructor(onWriteError?: (err: unknown) => void) {
    this.writer = new DebouncedWriter(
      (items) => browser.storage.local.set(items),
      250,
      onWriteError,
    );
    live.add(this);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const p = this.writer.peek(key);
    if (p.has) return p.value as T;
    const got = await browser.storage.local.get(key);
    return got[key] as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.writer.write(key, value);
  }

  flush(): Promise<void> {
    return this.writer.flush();
  }

  scoped(moduleId: string) {
    const ns = moduleKey(moduleId);
    return {
      get: async <T>(key: string): Promise<T | undefined> => {
        await this.nsQueue.get(ns);
        return (await this.get<Record<string, T>>(ns))?.[key];
      },
      set: (key: string, value: unknown) => {
        const run = (this.nsQueue.get(ns) ?? Promise.resolve()).then(async () => {
          const cur = await this.get<Record<string, unknown>>(ns);
          this.set(ns, { ...(cur ?? {}), [key]: value });
        });
        this.nsQueue.set(
          ns,
          run.catch((err) => console.error('[REScue] storage', err)),
        );
      },
    };
  }
}

/**
 * Remove top-level keys from storage. Pending debounced writes to them are dropped first and the
 * write in flight is waited for, so a write queued before the removal cannot bring the data back.
 */
export async function removeStored(keys: readonly string[]): Promise<void> {
  for (const store of live) {
    store.writer.discard(keys);
    await store.flush().catch(() => {});
  }
  await browser.storage.local.remove([...keys]);
}
