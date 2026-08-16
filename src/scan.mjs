// tokenlint — pure, zero-dependency scanner.
// scan(inputs) takes [{ path, text }] and returns a report:
//   - hardcoded color literals (the "debt") with file/line + nearest token suggestion
//   - tokenized color usages (var(--token) in color properties)
//   - coverage% = tokenized / (tokenized + hardcoded)
// Detection is intentionally regex-based (no PostCSS) to stay dependency-zero and zero-config.

import { parseColor, distance } from './color.mjs';

// Canonical ignore set, shared by the CLI file walk (head) and the git base scan so scopes match.
export const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', '.svelte-kit', '.astro', 'vendor']);
/** True if any DIRECTORY segment (not the basename) of a posix path is ignored or hidden. */
export function isIgnoredPath(path) {
  return path.split('/').slice(0, -1).some((seg) => IGNORE_DIRS.has(seg) || seg.startsWith('.'));
}

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
// 色関数の名前。ここ1箇所から下の4つの正規表現を組む。以前は各所に `rgba?|hsla?` を
// 直書きしていて、片方だけ直し忘れる形の欠陥を実際に出している（0.3.1 の maskUrls）。
//
// rgb/hsl しか見ていなかったので、Tailwind v4 が既定で吐く oklch() を1件も数えていなかった。
// 見逃しは誤検知より質が悪い：債務が0件に見え、網羅率は実態より良く出て、
// 「トークン化が進んでいる」と読める数字だけが残る。
//
// 後読みは `border-color(...)` のような `-` 区切りの末尾一致で `color(` を拾わないため
// （\b はハイフンの直後で成立してしまう）。
const FN = '(?<![-\\w])(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb|color)';
const FN_CALL = `${FN}\\((?:[^()]|\\([^()]*\\)){0,200}\\)`;
// Nesting-aware (one level) so hsl(var(--x)) / rgb(a / .2) capture cleanly instead of truncating.
// 分岐は「括弧以外の1文字」か「1段だけの括弧組」で重ならず、繰り返しにも上限を置く。
// `(?:[^()]+|\(...\))*` の形だと、閉じ括弧の無い rgba( があった瞬間に指数爆発する
// （実データ監査 2026-07: 公開CSS 90KB でスキャンが返らなくなった）。色リテラルは短いので上限で足りる。
const FUNC = new RegExp(FN_CALL, 'gi');
const VAR = /var\(\s*(--[A-Za-z0-9_-]+)/g;
// Tailwind arbitrary color: color may appear anywhere in the brackets (shadow-[0_2px_#000]).
// Lookahead + single greedy [^\]]* keeps it linear (no catastrophic backtracking).
const TW_ARB = new RegExp(
  `\\b(?:text|bg|border|ring|ring-offset|fill|stroke|from|via|to|decoration|outline|shadow|drop-shadow|accent|caret|divide|placeholder)-\\[(?=[^\\]]*(?:#[0-9a-fA-F]{3,8}|${FN}\\([^)\\]]*\\)))[^\\]]*\\]`,
  'gi',
);
// Arbitrary property form: [color:#fff], [background-color:rgb(...)] — same lookahead shape.
const TW_PROP = new RegExp(
  `\\[\\s*(?:color|background|background-color|border-color|fill|stroke|outline-color|text-decoration-color)\\s*:\\s*(?=[^\\]]*(?:#[0-9a-fA-F]{3,8}|${FN}\\([^)\\]]*\\)))[^\\]]*\\]`,
  'gi',
);
// Extract the actual color literal from a matched Tailwind utility (non-global; exec from start).
const COLOR_LITERAL = new RegExp(`#[0-9a-fA-F]{3,8}|${FN_CALL}`, 'i');

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
  const fn = (/^[a-z]+/i.exec(raw)?.[0] ?? '').toLowerCase();
  if (fn === 'rgb' || fn === 'rgba') return 'rgb'; // 既存の JSON 出力の値は変えない
  if (fn === 'hsl' || fn === 'hsla') return 'hsl';
  return fn; // oklch / oklab / lch / lab / hwb / color
}

// Same-length space mask of every var(...) interior — so token fallbacks (var(--x, #fff))
// and token-in-function (hsl(var(--x))) are not counted as hardcoded. Offsets preserved.
function maskVars(value) {
  let out = value;
  const re = /var\(/gi;
  let m;
  while ((m = re.exec(out))) {
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    for (; i < out.length && depth > 0; i++) {
      if (out[i] === '(') depth++;
      else if (out[i] === ')') depth--;
    }
    const end = depth === 0 ? i - 1 : i;
    out = out.slice(0, start) + ' '.repeat(end - start) + out.slice(end);
    re.lastIndex = m.index + m[0].length;
  }
  return out;
}
// Mask url(...) so SVG paint refs like fill: url(#e5e5e5) aren't read as colors. Offsets preserved.
function maskUrls(value) {
  return value.replace(/url\(\s*[^)]*\)/gi, (s) => ' '.repeat(s.length));
}
// Same-length blank that keeps newlines, so loc(originalText) still maps after masking.
const blank = (s) => s.replace(/[^\n]/g, ' ');
// Quoted strings in a declaration value are content, not paint (background: "ticket #abcdef").
function maskStrings(value) {
  return value.replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, blank);
}
// Markup comments and code samples are documentation, not applied styling — mask before the
// Tailwind scan. 敵対的入力監査（2026-08）で、<pre><code> 内の Tailwind 例・{/* … */} の
// コメントアウト・<!-- --> の説明文が、そのままハードコード色として数えられていた。
// 行コメント（//）は URL の https:// と区別できず、URL を含む行の class を丸ごと隠して
// 見逃しに転ぶため対象にしない。開始タグは残す（<code class="text-[#fff]"> は実際に効くため）。
function maskDocRegions(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/(<(pre|code)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (_m, open, _t, body, close) => open + blank(body) + close)
    .replace(/\/\*[\s\S]*?\*\//g, blank);
}

// Project a markup file to a same-length "CSS view": keep <style>…</style> bodies and inline
// style="…" values (quotes -> { }), blank everything else. Newlines kept so loc(originalText) maps.
function cssViewOfMarkup(text) {
  const out = new Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) === 10 ? '\n' : ' ';
  let m;
  const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = STYLE.exec(text))) {
    const start = m.index + m[0].length - m[1].length - '</style>'.length;
    for (let i = 0; i < m[1].length; i++) {
      const c = text[start + i];
      out[start + i] = c === '\n' ? '\n' : c;
    }
  }
  const INLINE = /\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi;
  while ((m = INLINE.exec(text))) {
    const q1 = m.index + m[0].indexOf(m[1]);
    const inner = m[2];
    out[q1] = '{';
    for (let i = 0; i < inner.length; i++) {
      const c = text[q1 + 1 + i];
      out[q1 + 1 + i] = c === '\n' ? '\n' : c;
    }
    out[q1 + 1 + inner.length] = '}';
  }
  return out.join('');
}

function collectPalette(text, palette) {
  const DECL = /(?:^|[;{}])\s*(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]*)/g;
  let m;
  while ((m = DECL.exec(text))) {
    const value = m[2].trim();
    const rgb = parseColor(value);
    if (rgb) palette.push({ name: m[1], value, rgb });
  }
}

// 「そのトークンに置き換えられる」と言える範囲でだけ提案する。
// 実データ監査（公開リポジトリ 700ファイル・2026-07）で、提案の 47% が半透明の色に対して
// 不透明トークンを、38% が見た目に別の色を指していた。どちらも置き換えられないので出さない。
const NEAR_MAX = 40;       // redmean 距離。Δ0=完全一致、Δ40 あたりから肉眼で違う色になる
const ALPHA_EPS = 0.02;    // 透明度がこれ以上違えば別物（色は同じでも置き換えできない）

function nearestToken(color, palette) {
  if (!color || !palette.length) return null;
  const a = color.a ?? 1;
  if (a === 0) return null; // 完全に透明。どのトークンでも置き換えられない
  let best = null;
  for (const t of palette) {
    if (Math.abs((t.rgb?.a ?? 1) - a) > ALPHA_EPS) continue;
    const d = distance(color, t.rgb);
    if (!Number.isFinite(d) || d > NEAR_MAX) continue;
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
    const masked = maskStrings(maskUrls(maskVars(value))); // token fallbacks / url() refs / string content are not hardcoded
    for (const re of [HEX, FUNC]) {
      re.lastIndex = 0;
      let lm;
      while ((lm = re.exec(masked))) {
        if (re === FUNC && /var\(/i.test(lm[0])) continue; // color function referencing a token
        pushHardcoded(ctx, path, loc, valueStart + lm.index, lm[0], kindOf(lm[0]), prop);
      }
    }
    VAR.lastIndex = 0;
    while (VAR.exec(value)) { ctx.tokenized++; bump(ctx, path, 'tokenized'); }
  }
}

function scanMarkup(path, text, loc, ctx) {
  const view = maskDocRegions(text); // same length — m.index still maps to the original text
  for (const re of [TW_ARB, TW_PROP]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(view))) {
      // bg-[url(/icons.svg#abcdef)] は SVG フラグメント参照であって色ではない。
      // CSS 側（scanCssUsages）は maskUrls していたが、こちらが抜けていた。
      const cm = COLOR_LITERAL.exec(maskUrls(m[0]));
      if (!cm) continue;
      pushHardcoded(ctx, path, loc, m.index + cm.index, cm[0], 'tw-arbitrary', '(tailwind)');
    }
  }
}

/**
 * @param {{path:string,text:string}[]} inputs
 * @returns {{fileCount:number,palette:object[],hardcoded:object[],hardcodedCount:number,tokenizedCount:number,coverage:(number|null),byFile:object}}
 */
export function scan(inputs) {
  const ctx = { palette: [], hardcoded: [], tokenized: 0, byFile: {} };
  const views = new Map();
  const viewOf = (path, text) => {
    if (!views.has(path)) views.set(path, cssViewOfMarkup(text));
    return views.get(path);
  };

  for (const { path, text } of inputs) {
    const e = extOf(path);
    if (CSS_EXT.has(e)) collectPalette(text, ctx.palette);
    else if (MARKUP_EXT.has(e)) collectPalette(viewOf(path, text), ctx.palette); // :root{} in SFC <style>
  }
  for (const { path, text } of inputs) {
    const e = extOf(path);
    if (!CSS_EXT.has(e) && !MARKUP_EXT.has(e)) continue;
    const loc = makeLoc(text);
    if (CSS_EXT.has(e)) {
      scanCssUsages(path, text, loc, ctx);
    } else {
      scanCssUsages(path, viewOf(path, text), loc, ctx); // <style> + inline style= colors & var()
      scanMarkup(path, text, loc, ctx);                  // Tailwind arbitrary utilities
    }
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

/**
 * Compare two scan results for "new hardcoded colors in this PR".
 * `added` = count of newly-introduced color occurrences (the gate number, matching the
 * "fail if this PR ADDS colors" promise). `newHardcoded` = net count change (for display).
 * Values are normalized (case/whitespace) so pure reformatting doesn't invent phantom colors.
 */
export function diffHardcoded(base, head) {
  const norm = (v) => v.toLowerCase().replace(/\s+/g, '');
  const counts = (r) => {
    const m = new Map();
    for (const h of r.hardcoded) {
      const key = norm(h.value);
      const e = m.get(key) || { value: h.value, count: 0 };
      e.count++;
      m.set(key, e);
    }
    return m;
  };
  const bm = counts(base), hm = counts(head);
  const newColors = [];
  for (const [key, { value, count }] of hm) {
    const d = count - ((bm.get(key) || { count: 0 }).count);
    if (d > 0) newColors.push({ value, count: d });
  }
  newColors.sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));
  return {
    baseCount: base.hardcodedCount,
    headCount: head.hardcodedCount,
    newHardcoded: head.hardcodedCount - base.hardcodedCount,
    added: newColors.reduce((s, c) => s + c.count, 0),
    newColors,
  };
}
