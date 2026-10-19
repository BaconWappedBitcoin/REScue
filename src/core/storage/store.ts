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
} as const;

/** A top-level storage key (contracts/storage-schema.md) a module may read and write. */
export type SharedKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export const moduleKey = (moduleId: string) => `mod:${moduleId}`;

type Setter = (items: Record<string, unknown>) => Promise<void>;

export class DebouncedWriter {
  private pending: Record<string, unknown> = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> = Promise.resolve();

  constructor(
    private readonly set: Setter,
    private readonly delayMs = 250,
  ) {}

  write(key: string, value: unknown): void {
    this.pending[key] = value;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Read-your-writes: a pending value shadows what storage holds. */
  peek(key: string): { has: boolean; value?: unknown } {
    return key in this.pending ? { has: true, value: this.pending[key] } : { has: false };
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.pending;
    this.pending = {};
    if (!Object.keys(batch).length) return this.inflight;
    this.inflight = this.inflight.then(() => this.set(batch));
    return this.inflight;
  }
}

export class LocalStore {
  readonly writer = new DebouncedWriter((items) => browser.storage.local.set(items));

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
      get: async <T>(key: string): Promise<T | undefined> =>
        (await this.get<Record<string, T>>(ns))?.[key],
      set: (key: string, value: unknown) => {
        void this.get<Record<string, unknown>>(ns).then((cur) =>
          this.set(ns, { ...(cur ?? {}), [key]: value }),
        );
      },
    };
  }
}
