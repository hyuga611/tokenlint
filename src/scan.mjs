// tokenlint — pure, zero-dependency scanner.
// scan(inputs) takes [{ path, text }] and returns a report:
//   - hardcoded color literals (the "debt") with file/line + nearest token suggestion
//   - tokenized color usages (var(--token) in color properties)
//   - coverage% = tokenized / (tokenized + hardcoded)
// Detection is intentionally regex-based (no PostCSS) to stay dependency-zero and zero-config.

import { parseColor, distance } from './color.mjs';

// CSS properties whose values carry colors (shorthands included — we scan inside them).
const COLOR_PROPS = new Set([
  'color', 'background', 'background-color', 'background-image',
  'border', 'border-color', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline', 'outline-color', 'box-shadow', 'text-shadow', 'fill', 'stroke',
  'caret-color', 'accent-color', 'text-decoration', 'text-decoration-color',
  'column-rule', 'column-rule-color', 'stop-color', 'flood-color', 'lighting-color',
  'scrollbar-color', '-webkit-text-fill-color', '-webkit-text-stroke-color',
]);

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b/g;
const FUNC = /\b(?:rgba?|hsla?)\([^)]*\)/gi;
const VAR = /var\(\s*(--[A-Za-z0-9_-]+)/g;
// Tailwind arbitrary color utilities: text-[#3b82f6], bg-[rgb(0,0,0)], border-[#fff]…
const TW_ARB = /\b(?:text|bg|border|ring|ring-offset|fill|stroke|from|via|to|decoration|outline|shadow|accent|caret|divide|placeholder)-\[\s*(#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^\]]*\))\s*\]/gi;
// Arbitrary property form: [color:#fff], [background-color:rgb(...)]
const TW_PROP = /\[\s*(?:color|background|background-color|border-color|fill|stroke|outline-color|text-decoration-color)\s*:\s*([^\]]*?(?:#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^\]]*\))[^\]]*?)\s*\]/gi;

const CSS_EXT = new Set(['css', 'scss', 'sass', 'less']);
const MARKUP_EXT = new Set(['html', 'htm', 'jsx', 'tsx', 'vue', 'svelte', 'astro', 'mdx']);

function extOf(path) {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i + 1).toLowerCase();
}
export function isSupported(path) {
  const e = extOf(path);
  return CSS_EXT.has(e) || MARKUP_EXT.has(e);
}

// index -> { line, col } via precomputed newline offsets
function makeLoc(text) {
  const nl = [];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) nl.push(i);
  return (index) => {
    let lo = 0, hi = nl.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (nl[mid] < index) lo = mid + 1; else hi = mid; }
    return { line: lo + 1, col: index - (lo > 0 ? nl[lo - 1] : -1) };
  };
}

function kindOf(raw) {
  if (raw[0] === '#') return 'hex';
  return /^hsl/i.test(raw) ? 'hsl' : 'rgb';
}

// Pass 1: collect --token: <color> definitions across all CSS (the palette).
function collectPalette(text, palette) {
  const DECL = /(?:^|[;{}])\s*(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]*)/g;
  let m;
  while ((m = DECL.exec(text))) {
    const value = m[2].trim();
    const rgb = parseColor(value);
    if (rgb) palette.push({ name: m[1], value, rgb });
  }
}

function nearestToken(rgb, palette) {
  if (!rgb || !palette.length) return null;
  let best = null;
  for (const t of palette) {
    const d = distance(rgb, t.rgb);
    if (!best || d < best.distance) best = { name: t.name, value: t.value, distance: Math.round(d) };
  }
  return best;
}

function bump(ctx, path, key) {
  const f = (ctx.byFile[path] = ctx.byFile[path] || { hardcoded: 0, tokenized: 0 });
  f[key]++;
}

function pushHardcoded(ctx, path, loc, index, value, kind, prop) {
  const { line, col } = loc(index);
  ctx.hardcoded.push({ file: path, line, col, value, kind, prop, nearest: nearestToken(parseColor(value), ctx.palette) });
  bump(ctx, path, 'hardcoded');
}

function scanCssUsages(path, text, loc, ctx) {
  const DECL = /(?:^|[;{}])\s*(-{0,2}[A-Za-z][A-Za-z0-9-]*)\s*:\s*([^;{}]*)/g;
  let m;
  while ((m = DECL.exec(text))) {
    const prop = m[1].toLowerCase();
    const value = m[2];
    if (!value || prop.startsWith('--')) continue; // token defs handled in pass 1
    if (!COLOR_PROPS.has(prop)) continue;
    const colon = m[0].indexOf(':');
    const valueStart = m.index + m[0].indexOf(value, colon + 1);
    for (const re of [HEX, FUNC]) {
      re.lastIndex = 0;
      let lm;
      while ((lm = re.exec(value))) {
        pushHardcoded(ctx, path, loc, valueStart + lm.index, lm[0], kindOf(lm[0]), prop);
      }
    }
    VAR.lastIndex = 0;
    while (VAR.exec(value)) { ctx.tokenized++; bump(ctx, path, 'tokenized'); }
  }
}

function scanMarkup(path, text, loc, ctx) {
  for (const re of [TW_ARB, TW_PROP]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const captured = m[1];
      const cm = /#[0-9a-fA-F]{3,8}|(?:rgba?|hsla?)\([^)]*\)/i.exec(captured);
      const raw = cm ? cm[0] : captured;
      pushHardcoded(ctx, path, loc, m.index + m[0].indexOf(captured), raw, 'tw-arbitrary', '(tailwind)');
    }
  }
}

/**
 * @param {{path:string,text:string}[]} inputs
 * @returns {{fileCount:number,palette:object[],hardcoded:object[],hardcodedCount:number,tokenizedCount:number,coverage:(number|null),byFile:object}}
 */
export function scan(inputs) {
  const ctx = { palette: [], hardcoded: [], tokenized: 0, byFile: {} };
  for (const { path, text } of inputs) {
    if (CSS_EXT.has(extOf(path))) collectPalette(text, ctx.palette);
  }
  for (const { path, text } of inputs) {
    const e = extOf(path);
    if (!CSS_EXT.has(e) && !MARKUP_EXT.has(e)) continue;
    const loc = makeLoc(text);
    if (CSS_EXT.has(e)) scanCssUsages(path, text, loc, ctx);
    else scanMarkup(path, text, loc, ctx);
  }
  const hardcodedCount = ctx.hardcoded.length;
  const total = hardcodedCount + ctx.tokenized;
  const coverage = total ? Math.round((ctx.tokenized / total) * 1000) / 10 : null;
  return {
    fileCount: inputs.length,
    palette: ctx.palette,
    hardcoded: ctx.hardcoded,
    hardcodedCount,
    tokenizedCount: ctx.tokenized,
    coverage,
    byFile: ctx.byFile,
  };
}
