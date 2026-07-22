// tokenlint — the "visible wow": a self-contained HTML scorecard with a color-chip grid.
// This is the shareable/screenshot artifact. No external assets, opens in any browser.

import { parseColor, rgbToHex } from './color.mjs';

/** shields.io-style color name for a coverage value (0-100 or null). */
export function coverageColor(cov) {
  if (cov == null) return 'lightgrey';
  if (cov >= 90) return 'brightgreen';
  if (cov >= 75) return 'green';
  if (cov >= 50) return 'yellowgreen';
  if (cov >= 25) return 'orange';
  return 'red';
}

function hex(cov) {
  return { brightgreen: '#3fb950', green: '#4ac26b', yellowgreen: '#c9b458', orange: '#d29922', red: '#f0663c', lightgrey: '#8b949e' }[coverageColor(cov)];
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function readableOn(rgb) {
  if (!rgb) return '#000';
  const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return lum > 0.6 ? '#111' : '#fff';
}

/** @param {ReturnType<import('./scan.mjs').scan>} result */
export function renderReport(result, opts = {}) {
  const title = opts.title || 'tokenlint · color token coverage';
  const cov = result.coverage;
  const covText = cov == null ? 'n/a' : `${cov}%`;
  const accent = hex(cov);

  const chips = result.hardcoded.map((h) => {
    const rgb = parseColor(h.value);
    const swatch = rgb ? rgbToHex(rgb) : 'transparent';
    const fg = readableOn(rgb);
    const near = h.nearest ? `→ <code>${esc(h.nearest.name)}</code> <span class="d">Δ${h.nearest.distance}</span>` : '<span class="d">no token nearby</span>';
    return `<figure class="chip">
      <div class="sw" style="background:${swatch};color:${fg}">${esc(h.value)}</div>
      <figcaption><span class="loc">${esc(h.file)}:${h.line}</span><span class="near">${near}</span></figcaption>
    </figure>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='1' y='1' width='14' height='14' rx='3' fill='%233b82f6'/%3E%3Crect x='17' y='1' width='14' height='14' rx='3' fill='%23ef4444'/%3E%3Crect x='1' y='17' width='14' height='14' rx='3' fill='%234ac26b'/%3E%3Crect x='17' y='17' width='14' height='14' rx='3' fill='%23d29922'/%3E%3C/svg%3E">
<meta name="generator" content="tokenlint">
<meta property="og:title" content="tokenlint — color token coverage">
<meta property="og:description" content="${result.hardcodedCount} hardcoded colors · ${result.coverage == null ? 'n/a' : result.coverage + '%'} token coverage">

<style>
  :root { --acc:${accent}; --bg:#0d1117; --card:#161b22; --line:#21262d; --ink:#e6edf3; --mut:#8b949e;
    --mono:"SF Mono","Cascadia Code","JetBrains Mono",ui-monospace,Consolas,monospace; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font-family:system-ui,-apple-system,"Segoe UI","Yu Gothic UI",sans-serif; padding:40px 24px; }
  .wrap { max-width:960px; margin:0 auto; }
  header { display:flex; align-items:baseline; gap:16px; flex-wrap:wrap; margin-bottom:6px; }
  h1 { font-family:var(--mono); font-size:1.15rem; font-weight:600; margin:0; letter-spacing:-.01em; }
  h1 b { color:var(--acc); }
  .sub { color:var(--mut); font-size:.85rem; }
  .stats { display:flex; gap:14px; flex-wrap:wrap; margin:22px 0 28px; }
  .stat { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px 20px; min-width:150px; }
  .stat .n { font-family:var(--mono); font-size:2rem; font-weight:700; font-variant-numeric:tabular-nums; line-height:1; }
  .stat .n.cov { color:var(--acc); }
  .stat .k { color:var(--mut); font-size:.75rem; margin-top:8px; letter-spacing:.02em; text-transform:uppercase; }
  .bar { height:8px; border-radius:99px; background:var(--line); overflow:hidden; margin-top:12px; }
  .bar > i { display:block; height:100%; background:var(--acc); width:${cov == null ? 0 : cov}%; }
  h2 { font-family:var(--mono); font-size:.82rem; font-weight:600; color:var(--mut); text-transform:uppercase;
    letter-spacing:.06em; margin:0 0 14px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
  .chip { margin:0; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  .sw { height:66px; display:flex; align-items:center; justify-content:center; font-family:var(--mono);
    font-size:.8rem; font-weight:600; }
  figcaption { padding:9px 11px; display:flex; flex-direction:column; gap:3px; }
  .loc { font-family:var(--mono); font-size:.68rem; color:var(--mut); word-break:break-all; }
  .near { font-size:.72rem; color:var(--ink); }
  .near code { font-family:var(--mono); color:var(--acc); font-size:.7rem; }
  .near .d { color:var(--mut); }
  .empty { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:28px; text-align:center; color:var(--mut); }
  footer { margin-top:34px; color:var(--mut); font-size:.72rem; font-family:var(--mono); }
  footer a { color:var(--acc); text-decoration:none; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <h1><b>token</b>lint</h1>
      <span class="sub">color token coverage scorecard</span>
    </header>
    <div class="stats">
      <div class="stat"><div class="n cov">${covText}</div><div class="k">coverage</div><div class="bar"><i></i></div></div>
      <div class="stat"><div class="n">${result.hardcodedCount}</div><div class="k">hardcoded colors</div></div>
      <div class="stat"><div class="n">${result.tokenizedCount}</div><div class="k">token usages</div></div>
      <div class="stat"><div class="n">${result.palette.length}</div><div class="k">tokens defined</div></div>
    </div>
    <h2>Hardcoded colors — ${result.hardcodedCount} to tokenize</h2>
    ${result.hardcoded.length ? `<div class="grid">\n${chips}\n</div>` : '<div class="empty">No hardcoded colors found. Every color goes through a token. ✓</div>'}
    <footer>generated by <a href="https://github.com/hyuga611/tokenlint">tokenlint</a> · ${esc(new Date().toISOString().slice(0, 10))}</footer>
  </div>
</body>
</html>`;
}
