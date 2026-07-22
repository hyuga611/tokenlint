#!/usr/bin/env node
// tokenlint — CLI. Zero dependencies, zero config.
//   npx @hyuga/tokenlint                 scan ./ and print a scorecard
//   npx @hyuga/tokenlint src --max 0     fail (exit 1) if any hardcoded color is found
//   npx @hyuga/tokenlint --report        write tokenlint-report.html (the shareable scorecard)
//   npx @hyuga/tokenlint --badge         print a shields.io endpoint JSON (coverage badge)
//   npx @hyuga/tokenlint --format json   machine-readable output

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, isSupported } from './scan.mjs';
import { parseColor } from './color.mjs';
import { renderReport, coverageColor } from './report.mjs';

const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.svelte-kit', '.astro', 'vendor']);

function version() {
  try {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    return pkg.version || '0.0.0';
  } catch { return '0.0.0'; }
}

function parseArgs(argv) {
  const o = { paths: [], format: 'text', report: null, badge: null, max: null, color: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--version' || a === '-v') o.version = true;
    else if (a === '--json') o.format = 'json';
    else if (a === '--format') o.format = argv[++i];
    else if (a.startsWith('--format=')) o.format = a.slice(9);
    else if (a === '--report') o.report = 'tokenlint-report.html';
    else if (a.startsWith('--report=')) o.report = a.slice(9);
    else if (a === '--badge') o.badge = 'coverage';
    else if (a.startsWith('--badge=')) o.badge = a.slice(8);
    else if (a === '--max') o.max = Number(argv[++i]);
    else if (a.startsWith('--max=')) o.max = Number(a.slice(6));
    else if (a === '--no-color') o.color = false;
    else if (a.startsWith('-')) { console.error(`tokenlint: unknown option ${a}`); process.exit(2); }
    else o.paths.push(a);
  }
  if (!o.paths.length) o.paths = ['.'];
  return o;
}

function collectFiles(paths) {
  const out = [];
  const seen = new Set();
  const walk = (p) => {
    let st;
    try { st = statSync(p); } catch { return; }
    if (st.isDirectory()) {
      for (const d of readdirSync(p, { withFileTypes: true })) {
        if (d.isDirectory() && IGNORE.has(d.name)) continue;
        if (d.name.startsWith('.') && d.isDirectory() && d.name !== '.') continue;
        walk(join(p, d.name));
      }
    } else if (isSupported(p) && !seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  };
  for (const p of paths) walk(p);
  return out;
}

function badgeJson(result, kind) {
  if (kind === 'hardcoded') {
    return { schemaVersion: 1, label: 'hardcoded colors', message: String(result.hardcodedCount), color: result.hardcodedCount === 0 ? 'brightgreen' : 'red' };
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

function printText(result, o) {
  const cov = result.coverage;
  const covText = cov == null ? 'n/a' : `${cov}%`;
  const nFiles = Object.keys(result.byFile).length;
  const lines = [];
  lines.push('');
  lines.push(`  ${bold('tokenlint', o.color)}  ${dim('· color token coverage', o.color)}`);
  lines.push('');
  lines.push(`  Coverage    ${bold(covText, o.color)}   ${dim(`· tokenized ${result.tokenizedCount} / hardcoded ${result.hardcodedCount}`, o.color)}`);
  lines.push(`  Hardcoded   ${result.hardcodedCount} colors across ${nFiles} file${nFiles === 1 ? '' : 's'}`);
  lines.push(`  Palette     ${result.palette.length} tokens defined`);
  if (result.hardcoded.length) {
    lines.push('');
    const show = result.hardcoded.slice(0, 25);
    for (const h of show) {
      const near = h.nearest ? dim(`→ ${h.nearest.name} (Δ${h.nearest.distance})`, o.color) : dim('→ no token nearby', o.color);
      lines.push(`   ${block(h.value, o.color)} ${h.value.padEnd(22)} ${dim(`${h.file}:${h.line}`, o.color)}  ${near}`);
    }
    if (result.hardcoded.length > show.length) lines.push(dim(`   … and ${result.hardcoded.length - show.length} more`, o.color));
  }
  lines.push('');
  if (o.max != null) {
    const ok = result.hardcodedCount <= o.max;
    lines.push(ok
      ? `  ${o.color ? '\x1b[32m' : ''}✓ pass${o.color ? '\x1b[0m' : ''}  ${result.hardcodedCount} hardcoded ≤ max ${o.max}`
      : `  ${o.color ? '\x1b[31m' : ''}✗ fail${o.color ? '\x1b[0m' : ''}  ${result.hardcodedCount} hardcoded > max ${o.max}`);
    lines.push('');
  }
  process.stdout.write(lines.join('\n') + '\n');
}

const HELP = `tokenlint — count hardcoded colors, measure design-token coverage, gate PRs.

Usage
  tokenlint [paths...] [options]

Options
  --max <n>          fail (exit 1) if hardcoded colors > n   (CI gate)
  --report[=file]    write an HTML scorecard (default: tokenlint-report.html)
  --badge[=kind]     print a shields.io endpoint JSON (kind: coverage | hardcoded)
  --format <fmt>     text (default) | json
  --no-color         disable ANSI color in text output
  -h, --help         show this help
  -v, --version      print version

Examples
  npx @hyuga/tokenlint
  npx @hyuga/tokenlint src --max 0
  npx @hyuga/tokenlint --report && open tokenlint-report.html
  npx @hyuga/tokenlint --badge > coverage.json
`;

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { process.stdout.write(HELP); return 0; }
  if (o.version) { process.stdout.write(version() + '\n'); return 0; }
  if (o.format !== 'text' && o.format !== 'json') { console.error(`tokenlint: unknown format ${o.format}`); return 2; }

  const files = collectFiles(o.paths);
  const inputs = files.map((path) => ({ path: relative('.', path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));
  const result = scan(inputs);

  if (o.report) { writeFileSync(o.report, renderReport(result)); }

  if (o.badge) {
    process.stdout.write(JSON.stringify(badgeJson(result, o.badge)) + '\n');
  } else if (o.format === 'json') {
    process.stdout.write(JSON.stringify({
      coverage: result.coverage,
      hardcodedCount: result.hardcodedCount,
      tokenizedCount: result.tokenizedCount,
      fileCount: result.fileCount,
      palette: result.palette.length,
      offenders: result.hardcoded.map((h) => ({ file: h.file, line: h.line, value: h.value, kind: h.kind, nearest: h.nearest && h.nearest.name })),
    }, null, 2) + '\n');
  } else {
    printText(result, o);
    if (o.report) process.stdout.write(`  → wrote ${o.report}\n\n`);
  }

  if (o.max != null && result.hardcodedCount > o.max) return 1;
  return 0;
}

process.exit(main());
