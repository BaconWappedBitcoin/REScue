/**
 * Mutation spot-check (T117). Reintroduces known bug patterns one at a time, runs the unit test
 * files that should catch each, and requires them to FAIL. The source is restored afterwards, even
 * on errors, and compared with the working tree as it was when the script started.
 *
 *   npm run test:mutate
 *
 * A mutation whose target text is missing is an error, never a silent pass: the code moved and
 * this script must be updated with it.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VITEST = resolve(ROOT, 'node_modules/vitest/vitest.mjs');

interface Mutation {
  name: string;
  file: string;
  /** Exact text that must occur exactly once in `file`. */
  find: string;
  replace: string;
  /** Unit test files that must fail with the bug in place. */
  tests: string[];
}

const MUTATIONS: Mutation[] = [
  {
    name: 'comment body not scoped to its own comment (ownQueryAll)',
    file: 'src/core/dom.ts',
    find: '.filter((n) => n.closest(ownerSel) === root)',
    replace: '.filter(() => true)',
    tests: ['tests/unit/model.test.ts'],
  },
  {
    name: 'comment details not scoped to its own comment (ownDetails)',
    file: 'src/model/access.ts',
    find: 'if (d.closest(C.comment) !== host || !(d instanceof HTMLDetailsElement)) continue;',
    replace: 'if (!(d instanceof HTMLDetailsElement)) continue;',
    tests: ['tests/unit/model.test.ts', 'tests/unit/comment-tools.test.ts'],
  },
  {
    // The paginator that once drove hover-card partials is gone and has no tests; the equivalent
    // invariant today is that a hover-card failure must not make REScue hammer Reddit.
    name: 'hover-card service keeps requesting after a 429 (no backoff)',
    file: 'src/core/hovercards.ts',
    find: 'if (res.status === 429 || res.status >= 500) this.backoffUntil = this.now() + BACKOFF_MS;',
    replace: '',
    tests: ['tests/unit/hovercards.test.ts'],
  },
  {
    name: 'unconfirmed vote treated as success',
    file: 'src/core/actions.ts',
    find: '        for (let waited = 0; waited < confirmMs; waited += pollMs) {',
    replace:
      '        if (click.ok) return { ok: true };\n        for (let waited = 0; waited < confirmMs; waited += pollMs) {',
    tests: ['tests/unit/actions.test.ts'],
  },
  {
    name: 'decorations slotted onto the post host instead of Reddit’s own credit bar',
    file: 'src/layout/native/adapter.ts',
    find: 'const own = this.ownSlotElement(host, slotName);\n    if (own) {',
    replace: 'const own = null as Element | null;\n    if (own) {',
    tests: ['tests/unit/native-decorations.test.ts'],
  },
];

function git(...args: string[]): string {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function runTests(files: string[]): { passed: boolean; output: string } {
  const r = spawnSync(process.execPath, [VITEST, 'run', ...files], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
  });
  return { passed: r.status === 0, output: `${r.stdout}\n${r.stderr}` };
}

function summary(output: string): string {
  // eslint-disable-next-line no-control-regex
  const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
  const failed = /Failed Tests (\d+)/.exec(plain);
  return failed ? `${failed[1]} test(s) failed` : 'tests passed';
}

const files = [...new Set(MUTATIONS.map((m) => m.file))];
const originals = new Map(files.map((f) => [f, readFileSync(resolve(ROOT, f), 'utf8')]));
// The tree may carry uncommitted work; "restored" means identical to how it started.
const diffBefore = git('diff', '--', ...files);

const results: Array<{ name: string; killed: boolean; detail: string }> = [];
let error: unknown = null;

try {
  for (const m of MUTATIONS) {
    const original = originals.get(m.file)!;
    const occurrences = original.split(m.find).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `Mutation "${m.name}": expected exactly one match for its target in ${m.file}, found ${occurrences}. The code moved; update tests/mutate.ts.`,
      );
    }
    // The unmutated tests must pass, or "fails" would prove nothing.
    const clean = runTests(m.tests);
    if (!clean.passed) {
      throw new Error(`Baseline for "${m.name}" is already failing:\n${clean.output}`);
    }
    writeFileSync(
      resolve(ROOT, m.file),
      original.replace(m.find, () => m.replace),
    );
    try {
      const mutated = runTests(m.tests);
      results.push({ name: m.name, killed: !mutated.passed, detail: summary(mutated.output) });
    } finally {
      writeFileSync(resolve(ROOT, m.file), original);
    }
  }
} catch (e) {
  error = e;
} finally {
  for (const [f, text] of originals) writeFileSync(resolve(ROOT, f), text);
}

const diffAfter = git('diff', '--', ...files);
const restored = diffAfter === diffBefore;

for (const r of results) {
  console.log(`${r.killed ? 'KILLED  ' : 'SURVIVED'}  ${r.name}  (${r.detail})`);
}
if (error) console.error(error instanceof Error ? error.message : error);
if (!restored) console.error('SOURCE NOT RESTORED: git diff of the mutated files changed.');

const survivors = results.filter((r) => !r.killed);
if (error || !restored || survivors.length || results.length !== MUTATIONS.length) {
  if (survivors.length)
    console.error(`${survivors.length} mutation(s) survived: the tests miss them.`);
  process.exit(1);
}
console.log(`All ${results.length} mutations were caught; source restored.`);
