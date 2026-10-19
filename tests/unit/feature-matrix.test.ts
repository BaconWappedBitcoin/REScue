/**
 * T118: feature-matrix.md must agree with the modules registered in src/modules/index.ts.
 * The matrix is the user-facing promise; this test fails when a registered module is missing from
 * it or marked as not built, when a row claims "built" with nothing behind it, and when the
 * Summary counts drift from the rows.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODULES } from '../../src/modules';

const STATUSES = ['Ported', 'Adapted', 'Built-in', 'Deferred', 'Infeasible'] as const;
type Status = (typeof STATUSES)[number];

interface Row {
  /** The cell as written, e.g. "version / announcements / about / RESTips / onboarding". */
  raw: string;
  /** RES module names in the cell. Merged rows count once per module. */
  modules: string[];
  status: string;
  built: string;
  line: number;
}

const MATRIX = resolve(process.cwd(), 'specs/001-rescue-foundation/feature-matrix.md');
const text = readFileSync(MATRIX, 'utf8');

/**
 * "version / announcements / about" is three RES modules; "stylesheet (custom CSS)" is one, and a
 * parenthetical is a note. A row that starts with "(" is not an RES module at all (the
 * "(vote / save / hide / reply)" row), so it names none.
 */
function modulesIn(cell: string): string[] {
  if (cell.startsWith('(')) return [];
  return cell
    .replace(/\([^)]*\)/g, '')
    .split(' / ')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parse(source: string): { rows: Row[]; summary: Map<string, number> } {
  const rows: Row[] = [];
  const summary = new Map<string, number>();
  let inSummary = false;
  source.split(/\r?\n/).forEach((line, i) => {
    if (line.startsWith('## ')) inSummary = line.trim() === '## Summary';
    if (!line.startsWith('|') || /^\|\s*-/.test(line)) return;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (inSummary) {
      const n = Number(cells[1]?.replace(/\*/g, ''));
      if (cells[0] && cells[0] !== 'Status' && Number.isFinite(n))
        summary.set(cells[0].replace(/\*/g, ''), n);
      return;
    }
    if (cells[0] === 'RES module') return;
    rows.push({
      raw: cells[0] ?? '',
      modules: modulesIn(cells[0] ?? ''),
      status: cells[1] ?? '',
      built: cells[2] ?? '',
      line: i + 1,
    });
  });
  return { rows, summary };
}

const { rows, summary } = parse(text);
const byModule = new Map<string, Row>();
for (const r of rows) for (const m of r.modules) byModule.set(m, r);

/**
 * Rows marked Built that no registered module names with that `resId`, and why that is right.
 * Anything not listed here must have a module; add an entry only with a reason.
 */
const NOT_A_MODULE: Record<string, string> = {
  settingsNavigation:
    'part of the settings console framework (src/ui/settings-console), module "menu"',
  hover: 'popup framework used by the tag editor (src/modules/users/tagEditor.ts), not a module',
  notifications:
    'notice framework in src/core/notices.ts, available to every module as ctx.notices',
  selectedEntry:
    'the selection outline is part of the keyboardNav module (src/layout/native/selection.ts)',
  version: 'merged into the "about" module (one About panel)',
  announcements: 'merged into the "about" module (one About panel)',
  RESTips: 'merged into the "about" module (one About panel)',
  onboarding: 'merged into the "about" module (one About panel)',
  contribute: 'a link in the "about" module panel',
  submitIssue: 'the troubleshooter module’s diagnostic report',
};

describe('feature-matrix.md vs registered modules', () => {
  it('parses the matrix', () => {
    expect(rows.length).toBeGreaterThan(70);
    for (const r of rows) {
      expect(STATUSES as readonly string[], `status of "${r.raw}" (line ${r.line})`).toContain(
        r.status,
      );
      expect(['✓', '◐', '—'], `Built mark of "${r.raw}" (line ${r.line})`).toContain(r.built);
    }
  });

  it('has no module named twice', () => {
    const seen = new Set<string>();
    for (const m of rows.flatMap((r) => r.modules)) {
      expect(seen.has(m), `"${m}" appears in two rows`).toBe(false);
      seen.add(m);
    }
  });

  it('lists every registered module’s resId as a row', () => {
    for (const def of MODULES) {
      if (!def.resId) continue;
      expect(byModule.has(def.resId), `${def.id}: no matrix row for resId "${def.resId}"`).toBe(
        true,
      );
    }
  });

  it('marks every registered module’s row as built, never Built-in, Deferred or Infeasible', () => {
    for (const def of MODULES) {
      if (!def.resId) continue;
      const row = byModule.get(def.resId);
      if (!row) continue; // reported by the test above
      const where = `${def.id} -> "${row.raw}" (line ${row.line})`;
      expect(['Ported', 'Adapted'], `${where}: status is ${row.status}`).toContain(row.status);
      expect(['✓', '◐'], `${where}: Built column is "${row.built}"`).toContain(row.built);
    }
  });

  it('has a registered module behind every row marked built (✓ or ◐)', () => {
    const registered = new Set(MODULES.map((d) => d.resId).filter(Boolean));
    for (const r of rows) {
      if (r.built !== '✓' && r.built !== '◐') continue;
      for (const m of r.modules) {
        if (registered.has(m)) continue;
        expect(
          NOT_A_MODULE[m],
          `"${m}" is marked built (line ${r.line}) but no module has resId "${m}"`,
        ).toBeTruthy();
      }
    }
  });

  it('keeps the allow-list honest: no entry for a registered module or an unbuilt row', () => {
    const registered = new Set(MODULES.map((d) => d.resId).filter(Boolean));
    for (const m of Object.keys(NOT_A_MODULE)) {
      expect(registered.has(m), `"${m}" now has a module; remove it from NOT_A_MODULE`).toBe(false);
      const row = byModule.get(m);
      expect(row, `"${m}" is not in the matrix; remove it from NOT_A_MODULE`).toBeDefined();
      expect(['✓', '◐'], `"${m}" is not marked built; remove it from NOT_A_MODULE`).toContain(
        row?.built,
      );
    }
  });

  it('has Summary counts that match the rows, counting each RES module once', () => {
    const counts = new Map<string, number>(STATUSES.map((s) => [s, 0]));
    for (const r of rows) {
      counts.set(r.status as Status, (counts.get(r.status as Status) ?? 0) + r.modules.length);
    }
    for (const s of STATUSES) {
      expect(summary.get(s), `Summary count for ${s}`).toBe(counts.get(s));
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(summary.get('Total'), 'Summary total').toBe(total);
  });
});
