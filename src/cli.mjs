#!/usr/bin/env node
// tokenlint — CLI. Zero dependencies, zero config.
//   npx @hyuga/tokenlint                        scan ./ and print a scorecard
//   npx @hyuga/tokenlint src --max 0            fail if any hardcoded color exists (total gate)
//   npx @hyuga/tokenlint --since origin/main --max-new 0   fail if this PR ADDS hardcoded colors
//   npx @hyuga/tokenlint --report               write tokenlint-report.html (shareable scorecard)
//   npx @hyuga/tokenlint --badge                shields.io endpoint JSON (coverage badge)

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, isSupported, diffHardcoded, IGNORE_DIRS } from './scan.mjs';
import { parseColor } from './color.mjs';
import { renderReport, coverageColor } from './report.mjs';
import { isGitRepo, resolveRef, mergeBase, inputsAtRef } from './git.mjs';

function version() {
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

function parseArgs(argv) {
  const o = { paths: [], format: 'text', report: null, badge: null, max: null, maxNew: null, since: null, color: true };
  let i = 0;
  const val = (name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('-')) { console.error(`tokenlint: ${name} requires a value`); process.exit(2); }
    return argv[++i];
  };
  const num = (v, name) => {
    if (v === undefined || String(v).trim() === '' || !Number.isFinite(Number(v))) {
      console.error(`tokenlint: ${name} requires a numeric argument`); process.exit(2);
    }
    return Number(v);
  };
  for (; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--json') o.format = 'json';
    else if (a === '--format') o.format = val('--format');
    else if (a.startsWith('--format=')) o.format = a.slice(9);
    else if (a === '--report') o.report = 'tokenlint-report.html';
    else if (a.startsWith('--report=')) o.report = a.slice(9);
    else if (a === '--badge') o.badge = 'coverage';
    else if (a.startsWith('--badge=')) o.badge = a.slice(8);
    else if (a === '--max') o.max = num(val('--max'), '--max');
    else if (a.startsWith('--max=')) o.max = num(a.slice(6), '--max');
    else if (a === '--max-new') o.maxNew = num(val('--max-new'), '--max-new');
    else if (a.startsWith('--max-new=')) o.maxNew = num(a.slice(10), '--max-new');
    else if (a === '--since' || a === '--base') o.since = val(a);
    else if (a.startsWith('--since=')) o.since = a.slice(8);
    else if (a.startsWith('--base=')) o.since = a.slice(7);
    else if (a === '--no-color') o.color = false;
    else if (a.startsWith('-')) { console.error(`tokenlint: unknown option ${a}`); process.exit(2); }
    else o.paths.push(a);
  }
  if (!o.paths.length) o.paths = ['.'];
  return o;
}

/**
 * The files to scan, and the requested paths that are not there.
 *
 * `missing` exists because the walk used to swallow a failed `stat` and return
 * nothing — so `tokenlint src --max 0` against a repo where `src/` had been
 * renamed printed a green "✓ pass  0 hardcoded ≤ max 0" and exited 0. A gate that
 * checked nothing announced itself as a gate that passed, which is worse than no
 * gate: the CI badge stays green and nobody looks again.
 *
 * A stat that fails below the requested path is still ignored. That one is a
 * symlink or a permission on a file nobody asked about by name, and stopping the
 * run over it would be its own kind of noise.
 */
function collectFiles(paths) {
  const out = [];
  const missing = [];
  const seen = new Set();
  const walk = (p, requested) => {
    let st;
    try {
      st = statSync(p);
    } catch {
      if (requested) missing.push(p);
      return;
    }
    if (st.isDirectory()) {
      for (const d of readdirSync(p, { withFileTypes: true })) {
        if (d.isDirectory() && (IGNORE_DIRS.has(d.name) || d.name.startsWith('.'))) continue;
        walk(join(p, d.name), false);
      }
    } else if (isSupported(p) && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  for (const p of paths) walk(p, true);
  return { files: out, missing };
}

const toPosix = (p) => p.split(sep).join('/');

// Is a repo-relative posix path within the requested scan scope?
function inScope(path, paths) {
  const req = paths.map((p) => toPosix(relative('.', p))).map((p) => p.replace(/^\.\//, '').replace(/\/$/, ''));
  if (req.includes('') || req.includes('.')) return true;
  return req.some((r) => path === r || path.startsWith(r + '/'));
}

function computeDelta(o, headResult) {
  const since = o.since || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null);
  if (!since) return { delta: null, since: null, error: null };
  if (!isGitRepo()) return { delta: null, since, error: 'not a git repository' };
  const baseTip = resolveRef(since);
  if (!baseTip) return { delta: null, since, error: `cannot resolve ref "${since}" (need git history — try fetch-depth: 0)` };
  const ref = mergeBase(baseTip, 'HEAD') || baseTip; // three-dot: diff against the common ancestor
  const baseInputs = inputsAtRef(ref).filter((f) => inScope(f.path, o.paths));
  return { delta: diffHardcoded(scan(baseInputs), headResult), since, error: null };
}

function badgeJson(result, delta, kind) {
  if (kind === 'hardcoded') {
    return { schemaVersion: 1, label: 'hardcoded colors', message: String(result.hardcodedCount), color: result.hardcodedCount === 0 ? 'brightgreen' : 'red' };
  }
  if (kind === 'new') {
    if (!delta) return { schemaVersion: 1, label: 'new colors', message: 'n/a', color: 'lightgrey' };
    return { schemaVersion: 1, label: 'new hardcoded', message: (delta.added > 0 ? '+' : '') + delta.added, color: delta.added > 0 ? 'red' : 'brightgreen' };
  }
  const c = result.coverage;
  return { schemaVersion: 1, label: 'token coverage', message: c == null ? 'n/a' : `${c}%`, color: coverageColor(c) };
}

function block(value, color) {
  const rgb = parseColor(value);
  if (!color || !rgb) return '  ';
  return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m  \x1b[0m`;
}
const dim = (s, on) => (on ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s, on) => (on ? `\x1b[1m${s}\x1b[0m` : s);
const green = (s, on) => (on ? `\x1b[32m${s}\x1b[0m` : s);
const red = (s, on) => (on ? `\x1b[31m${s}\x1b[0m` : s);

function printText(result, delta, o) {
  const cov = result.coverage;
  const covText = cov == null ? 'n/a' : `${cov}%`;
  const nFiles = Object.keys(result.byFile).length;
  const L = [];
  L.push('');
  L.push(`  ${bold('tokenlint', o.color)}  ${dim('· color token coverage', o.color)}`);
  L.push('');
  // Say it outright rather than leaving it to be inferred from three zeros and an
  // "n/a". A report of all-zeros reads as a clean result, and the one thing the
  // reader most needs to know is that nothing was looked at.
  if (result.fileCount === 0) {
    L.push(`  ${bold('Nothing scanned', o.color)}   ${dim(`· no supported file under ${o.paths.map(toPosix).join(', ')}`, o.color)}`);
    L.push(`  ${dim('The counts below are zero because there was nothing to count, not because it is clean.', o.color)}`);
    L.push('');
  }
  L.push(`  Coverage    ${bold(covText, o.color)}   ${dim(`· tokenized ${result.tokenizedCount} / hardcoded ${result.hardcodedCount}`, o.color)}`);
  L.push(`  Hardcoded   ${result.hardcodedCount} colors across ${nFiles} file${nFiles === 1 ? '' : 's'}`);
  L.push(`  Palette     ${result.palette.length} tokens defined`);
  if (delta) {
    const label = delta.added > 0 ? red(`+${delta.added}`, o.color) : green('0', o.color);
    const net = delta.newHardcoded >= 0 ? `+${delta.newHardcoded}` : `${delta.newHardcoded}`;
    L.push(`  New in PR   ${label} hardcoded added   ${dim(`· net ${net} (base ${delta.baseCount} → head ${delta.headCount})`, o.color)}`);
  }
  if (result.hardcoded.length) {
    L.push('');
    const show = result.hardcoded.slice(0, 25);
    for (const h of show) {
      const near = h.nearest ? dim(`→ ${h.nearest.name} (Δ${h.nearest.distance})`, o.color) : dim('→ no token nearby', o.color);
      L.push(`   ${block(h.value, o.color)} ${h.value.padEnd(22)} ${dim(`${h.file}:${h.line}`, o.color)}  ${near}`);
    }
    if (result.hardcoded.length > show.length) L.push(dim(`   … and ${result.hardcoded.length - show.length} more`, o.color));
  }
  L.push('');
  const gates = [];
  // A gate over nothing is not a gate that passed. Printing "✓ pass" here and then
  // exiting non-zero would put a green tick in the log of a run that failed, and the
  // tick is the part people read.
  if (result.fileCount === 0) {
    if (o.max != null || o.maxNew != null) {
      L.push(`  ${red('✗ not evaluated', o.color)}  the gate had no file to measure`);
      L.push('');
    }
  } else {
    if (o.max != null) gates.push([result.hardcodedCount <= o.max, `${result.hardcodedCount} hardcoded ${result.hardcodedCount <= o.max ? '≤' : '>'} max ${o.max}`]);
    if (o.maxNew != null && delta) gates.push([delta.added <= o.maxNew, `${delta.added} new ${delta.added <= o.maxNew ? '≤' : '>'} max-new ${o.maxNew}`]);
    for (const [ok, msg] of gates) L.push(`  ${ok ? green('✓ pass', o.color) : red('✗ fail', o.color)}  ${msg}`);
    if (gates.length) L.push('');
  }
  process.stdout.write(L.join('\n') + '\n');
}

const HELP = `tokenlint — count hardcoded colors, measure design-token coverage, gate PRs.

Usage
  tokenlint [paths...] [options]

Options
  --max <n>          fail (exit 1) if TOTAL hardcoded colors > n
  --since <ref>      diff against a git ref (e.g. the PR base) to compute "new this PR"
  --max-new <n>      fail (exit 1) if this PR ADDS more than n hardcoded colors
  --report[=file]    write an HTML scorecard (default: tokenlint-report.html)
  --badge[=kind]     shields.io endpoint JSON (kind: coverage | hardcoded | new)
  --format <fmt>     text (default) | json
  --no-color         disable ANSI color
  -h, --help  ·  -v, --version

Examples
  npx @hyuga/tokenlint
  npx @hyuga/tokenlint src --since origin/main --max-new 0
  npx @hyuga/tokenlint --report
  npx @hyuga/tokenlint --badge > coverage.json

In GitHub Actions, --since defaults to origin/$GITHUB_BASE_REF on pull_request
(check out with fetch-depth: 0 so the base is in local history).
`;

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { process.stdout.write(HELP); return 0; }
  if (o.version) { process.stdout.write(version() + '\n'); return 0; }
  if (o.format !== 'text' && o.format !== 'json') { console.error(`tokenlint: unknown format ${o.format}`); return 2; }

  const { files, missing } = collectFiles(o.paths);
  if (missing.length) {
    for (const p of missing) console.error(`tokenlint: ${toPosix(p)} does not exist`);
    console.error('tokenlint: nothing was scanned, so nothing can be reported as passing');
    return 2;
  }
  const inputs = files.flatMap((path) => {
    try { return [{ path: toPosix(relative('.', path)), text: readFileSync(path, 'utf8') }]; }
    catch (e) { console.error(`tokenlint: skipped ${toPosix(relative('.', path))} (${e.code || e.message})`); return []; }
  });
  const result = scan(inputs);

  const { delta, error } = computeDelta(o, result);
  if (error && (o.since || o.maxNew != null)) console.error(`tokenlint: ${error} — "new this PR" disabled`);

  if (o.report) writeFileSync(o.report, renderReport(result));

  if (o.badge) {
    process.stdout.write(JSON.stringify(badgeJson(result, delta, o.badge)) + '\n');
  } else if (o.format === 'json') {
    process.stdout.write(JSON.stringify({
      coverage: result.coverage,
      hardcodedCount: result.hardcodedCount,
      tokenizedCount: result.tokenizedCount,
      fileCount: result.fileCount,
      palette: result.palette.length,
      base: delta ? delta.baseCount : null,
      newHardcoded: delta ? delta.newHardcoded : null,
      added: delta ? delta.added : null,
      newColors: delta ? delta.newColors : null,
      offenders: result.hardcoded.map((h) => ({ file: h.file, line: h.line, value: h.value, kind: h.kind, nearest: h.nearest && h.nearest.name })),
    }, null, 2) + '\n');
  } else {
    printText(result, delta, o);
    if (o.report) process.stdout.write(`  → wrote ${o.report}\n\n`);
  }

  // Fail CLOSED: if --max-new was requested but the delta couldn't be computed, the gate never
  // ran — don't report success. Exit 2 distinguishes "couldn't evaluate" from 1 "gate failed".
  if (o.maxNew != null && !delta) {
    if (!error) console.error('tokenlint: --max-new set but no base ref to diff against (pass --since or run on pull_request) — failing closed');
    return 2;
  }

  // Same reasoning, one step earlier. Zero files means every count is zero, which
  // satisfies any --max you could name — so the gate reports a pass it never
  // evaluated. The paths all exist by this point, so this is a scan scope that
  // matches no supported file: a directory of images, or `--max` pointed at a
  // folder whose stylesheets moved.
  if (result.fileCount === 0 && (o.max != null || o.maxNew != null)) {
    console.error(
      `tokenlint: no supported file under ${o.paths.map(toPosix).join(', ')} — the gate had nothing to ` +
        'measure, so it is not reported as passing',
    );
    return 2;
  }

  let bad = false;
  if (o.max != null && result.hardcodedCount > o.max) bad = true;
  if (o.maxNew != null && delta && delta.added > o.maxNew) bad = true;
  return bad ? 1 : 0;
}

process.exit(main());
