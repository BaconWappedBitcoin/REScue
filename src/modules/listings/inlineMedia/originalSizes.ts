/**
 * Original picture sizes for displayOriginalResolution. Reddit only ever loads a resized preview
 * into the page (the i.redd.it original stays unloaded) and neither the post nor its media box
 * carries pixel sizes (live 2026-10-16: only an aspect ratio), so the size is read the one other
 * way the constitution allows: Reddit's own read-only `/api/info.json`, which lists
 * `preview.images[0].source.width/height` for a post. One batched request per burst of posts, and
 * only while the option is on; REScue downloads no image to measure it.
 */
import { INFO_MAX_IDS, type BoundGetJson } from '../../../core/redditJson';

export type PixelSize = readonly [number, number];

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

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

  /** Ask for this post's size (batched with the others asked for in the same moment). */
  want(id: string): void {
    if (this.stopped || this.known.has(id) || this.queue.has(id)) return;
    this.queue.add(id);
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  async flush(): Promise<void> {
    this.timer = null;
    const ids = [...this.queue];
    this.queue.clear();
    for (const batch of chunks(ids, INFO_MAX_IDS)) {
      const res = await this.getJson('info', { id: batch });
      if (this.stopped) return;
      const got = new Map(res.ok ? res.data.posts.map((p) => [p.id, p.sourceSize ?? null]) : []);
      for (const id of batch) this.known.set(id, got.get(id) ?? null);
    }
    this.onKnown();
  }

  dispose(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.queue.clear();
  }
}
