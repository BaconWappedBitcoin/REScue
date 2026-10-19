/** Per-contract hit/miss counts for one page; feeds module health (Principle III). */
export class ContractTally {
  private readonly counts = new Map<string, { hits: number; misses: number }>();

  private entry(key: string) {
    let e = this.counts.get(key);
    if (!e) {
      e = { hits: 0, misses: 0 };
      this.counts.set(key, e);
    }
    return e;
  }

  hit(key: string): void {
    this.entry(key).hits++;
  }

  miss(key: string): void {
    this.entry(key).misses++;
  }

  hits(key: string): number {
    return this.counts.get(key)?.hits ?? 0;
  }

  misses(key: string): number {
    return this.counts.get(key)?.misses ?? 0;
  }

  /** Keys whose miss rate exceeds `threshold` (0..1) with at least one observation. */
  failing(threshold = 0.5): string[] {
    const out: string[] = [];
    for (const [key, { hits, misses }] of this.counts) {
      const total = hits + misses;
      if (total > 0 && misses / total > threshold) out.push(key);
    }
    return out;
  }

  snapshot(): Record<string, { hits: number; misses: number }> {
    return Object.fromEntries([...this.counts].map(([k, v]) => [k, { ...v }]));
  }
}
