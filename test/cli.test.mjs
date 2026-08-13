/**
 * The CLI had no tests, and the bug that motivated these lived only in the CLI.
 *
 * `tokenlint src --max 0`, run against a repo where `src/` had been renamed, printed
 *
 *     ✓ pass  0 hardcoded ≤ max 0
 *
 * and exited 0. Every count is zero when nothing is scanned, and zero satisfies any
 * `--max` you could name — so a gate that measured nothing reported itself as a gate
 * that passed. In CI that is the worst available failure: the check stays green, and
 * green is the reason nobody looks again.
 *
 * Found by running the published package against a path that does not exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, '..', 'src', 'cli.mjs');

function run(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, '--no-color', ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out: stdout, err: '' };
  } catch (e) {
    return { code: e.status, out: e.stdout ?? '', err: e.stderr ?? '' };
  }
}

function fixture(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tokenlint-cli-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  return dir;
}

test('a path that does not exist is an error, not a pass', () => {
  const dir = fixture();
  try {
    const r = run(['./src-that-moved', '--max', '0'], dir);
    assert.equal(r.code, 2, 'must not exit 0');
    assert.match(r.err, /does not exist/);
    assert.doesNotMatch(r.out, /✓ pass/, 'nothing scanned must never print a pass');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a scope with no supported file does not satisfy --max', () => {
  const dir = fixture({ 'assets/logo.png': 'not a stylesheet' });
  try {
    const r = run(['assets', '--max', '0'], dir);
    assert.equal(r.code, 2);
    assert.match(r.out, /Nothing scanned/);
    assert.match(r.out, /not evaluated/);
    assert.doesNotMatch(r.out, /✓ pass/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('with no gate asked for, an empty scope reports plainly and exits 0', () => {
  const dir = fixture({ 'assets/logo.png': 'not a stylesheet' });
  try {
    const r = run(['assets'], dir);
    assert.equal(r.code, 0, 'nothing was asked of it, so nothing failed');
    assert.match(r.out, /Nothing scanned/);
    assert.match(r.out, /not because it is clean/, 'the zeros must be explained, not left to be read as clean');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The other half. A gate that fires when there is nothing wrong gets taken out of
 * CI, and then the real refusal above never happens either.
 */
test('a real file that is clean still passes', () => {
  const dir = fixture({ 'a.css': ':root { --c-brand: #00aaff; }\n.a { color: var(--c-brand); }\n' });
  try {
    const r = run(['.', '--max', '0'], dir);
    assert.equal(r.code, 0);
    assert.match(r.out, /✓ pass/);
    assert.doesNotMatch(r.out, /Nothing scanned/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a real file with a hardcoded color still fails', () => {
  const dir = fixture({ 'a.css': '.a { color: #ff0000; }\n' });
  try {
    const r = run(['.', '--max', '0'], dir);
    assert.equal(r.code, 1, 'exit 1 is the gate failing, distinct from 2 for could-not-evaluate');
    assert.match(r.out, /✗ fail/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a file below the requested path that cannot be read does not stop the run', () => {
  const dir = fixture({ 'a.css': '.a { color: #ff0000; }\n' });
  try {
    const r = run(['.', '--max', '5'], dir);
    assert.equal(r.code, 0, 'only the paths the caller named are required to exist');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('json output carries fileCount, so a consumer can see an empty scan', () => {
  const dir = fixture({ 'assets/logo.png': 'x' });
  try {
    const r = run(['assets', '--format', 'json'], dir);
    assert.equal(r.code, 0);
    assert.equal(JSON.parse(r.out).fileCount, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
