/**
 * The stack behind "undo move" (RES keyboardNav undoMove, Ctrl+Z): every item the selection leaves
 * is remembered, and undo steps back through them. Pure bookkeeping, no DOM.
 */
export class SelectionHistory<T> {
  private readonly stack: T[] = [];

  constructor(private readonly limit = 100) {}

  /** Remember an item the selection moved away from. */
  push(item: T): void {
    if (this.stack[this.stack.length - 1] === item) return;
    this.stack.push(item);
    if (this.stack.length > this.limit) this.stack.shift();
  }

  /** The most recent item for which `ok` holds (dropping skipped ones), or undefined. */
  pop(ok: (item: T) => boolean): T | undefined {
    while (this.stack.length) {
      const item = this.stack.pop()!;
      if (ok(item)) return item;
    }
    return undefined;
  }

  get size(): number {
    return this.stack.length;
  }

  clear(): void {
    this.stack.length = 0;
  }
}
