/**
 * Original picture sizes for displayOriginalResolution. Reddit only ever loads a resized preview
 * into the page (the i.redd.it original stays unloaded) and neither the post nor its media box
 * carries pixel sizes (live 2026-10-16: only an aspect ratio), so the size is read the one other
 * way the constitution allows: Reddit's own read-only thread JSON,
 * `/comments/<post>.json?limit=1&depth=0`, whose post lists `preview.images[0].source.width/height`.
 * One small request per post (paced by redditJson.ts, one a second), and only while the option is
 * on; REScue downloads no image to measure it. (It was one batched /api/info.json call until
 * Reddit stopped serving that, live 2026-10-21: HTTP 403 while signed in.)
 */
import type { BoundGetJson } from '../../../core/redditJson';

export type PixelSize = readonly [number, number];

export class OriginalSizes {
  /** id -> size, or null when Reddit lists none (or could not be asked): never asked twice. */
  private readonly known = new Map<string, PixelSize | null>();
  private readonly queue = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly getJson: BoundGetJson,
    private readonly onKnown: () => void,
    private readonly delayMs = 300,
  ) {}

  /** The size if it has been read, null if Reddit has none, undefined if not asked yet. */
  get(id: string): PixelSize | null | undefined {
    return this.known.get(id);
  }

  /** Ask for this post's size (asked with the others wanted in the same moment, one by one). */
  want(id: string): void {
    if (this.stopped || this.known.has(id) || this.queue.has(id)) return;
    this.queue.add(id);
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  async flush(): Promise<void> {
    this.timer = null;
    const ids = [...this.queue];
    this.queue.clear();
    for (const id of ids) {
      const res = await this.getJson('comments', { id, limit: 1, depth: 0 });
      if (this.stopped) return;
      // A failed read counts as "no size": the label just stays without one, as before.
      const same = res.ok && res.data.post.id.toLowerCase() === id.toLowerCase();
      this.known.set(id, same ? (res.data.post.sourceSize ?? null) : null);
      this.onKnown();
    }
  }

  dispose(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue.clear();
  }
}
