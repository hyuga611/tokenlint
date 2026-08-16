import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, isSupported, diffHardcoded } from '../src/scan.mjs';
import { parseColor, distance } from '../src/color.mjs';

const css = (text) => ({ path: 'x.css', text });
const jsx = (text) => ({ path: 'x.jsx', text });

test('detects hex in a color property', () => {
  const r = scan([css('.a { color: #ff0000; }')]);
  assert.equal(r.hardcodedCount, 1);
  assert.equal(r.hardcoded[0].value, '#ff0000');
  assert.equal(r.hardcoded[0].kind, 'hex');
  assert.equal(r.hardcoded[0].line, 1);
});

test('detects rgb() and hsl() literals', () => {
  const r = scan([css('.a { color: rgb(1, 2, 3); background: hsl(200, 50%, 40%); }')]);
  assert.equal(r.hardcodedCount, 2);
  assert.deepEqual(r.hardcoded.map((h) => h.kind).sort(), ['hsl', 'rgb']);
});

test('token definitions are the palette, not debt', () => {
  const r = scan([css(':root { --color-primary: #3b82f6; --space: 8px; }')]);
  assert.equal(r.hardcodedCount, 0);
  assert.equal(r.palette.length, 1);
  assert.equal(r.palette[0].name, '--color-primary');
});

test('var() usages count as tokenized and drive coverage', () => {
  const r = scan([css('.a { color: var(--c); background: var(--b); border-color: #000; }')]);
  assert.equal(r.tokenizedCount, 2);
  assert.equal(r.hardcodedCount, 1);
  assert.equal(r.coverage, 66.7); // 2 / 3
});

test('detects Tailwind arbitrary color values in markup', () => {
  const r = scan([jsx('<div className="text-[#3b82f6] bg-[rgb(0,0,0)] p-4" />')]);
  assert.equal(r.hardcodedCount, 2);
  assert.ok(r.hardcoded.every((h) => h.kind === 'tw-arbitrary'));
});

test('suggests the nearest existing token', () => {
  const r = scan([
    css(':root { --color-primary: #3b82f6; --color-danger: #ef4444; }'),
    css('.x { background: #3b82f5; }'),
  ]);
  const off = r.hardcoded.find((h) => h.value === '#3b82f5');
  assert.equal(off.nearest.name, '--color-primary');
  assert.ok(off.nearest.distance < 5);
});

test('coverage is null when there are no color usages', () => {
  const r = scan([css('.a { padding: 8px; margin: 0; }')]);
  assert.equal(r.coverage, null);
  assert.equal(r.hardcodedCount, 0);
});

test('named colors and selector hashes are not flagged (v0 scope)', () => {
  const r = scan([css('#fff-box { color: red; background: white; }')]);
  assert.equal(r.hardcodedCount, 0);
});

test('hex inside a token definition is not double-counted', () => {
  const r = scan([css(':root { --brand: #123456; } .a { color: var(--brand); }')]);
  assert.equal(r.hardcodedCount, 0);
  assert.equal(r.tokenizedCount, 1);
  assert.equal(r.coverage, 100);
});

test('isSupported recognizes css and markup, rejects others', () => {
  assert.ok(isSupported('a/b.css') && isSupported('c.tsx') && isSupported('d.vue'));
  assert.ok(!isSupported('e.py') && !isSupported('f.json'));
});

test('diffHardcoded: net new count and increased values', () => {
  const base = scan([css('.a { color: #111111; }')]);
  const head = scan([css('.a { color: #111111; } .b { color: #222222; background: #333333; }')]);
  const d = diffHardcoded(base, head);
  assert.equal(d.baseCount, 1);
  assert.equal(d.headCount, 3);
  assert.equal(d.newHardcoded, 2);
  assert.deepEqual(d.newColors.map((c) => c.value).sort(), ['#222222', '#333333']);
});

test('diffHardcoded: removing colors yields a negative delta', () => {
  const base = scan([css('.a { color: #111111; border-color: #222222; }')]);
  const head = scan([css('.a { color: var(--ink); border-color: #222222; }')]);
  const d = diffHardcoded(base, head);
  assert.equal(d.newHardcoded, -1);
  assert.equal(d.newColors.length, 0);
});

// --- regression tests for the pre-publish adversarial review ---

test('color function referencing a token is NOT hardcoded (hsl(var(--x)))', () => {
  const r = scan([css('.a { color: hsl(var(--bg)); background: rgb(var(--p) / 0.2); }')]);
  assert.equal(r.hardcodedCount, 0);
  assert.equal(r.tokenizedCount, 2);
  assert.equal(r.coverage, 100);
});

test('var() fallback literal is not counted as hardcoded', () => {
  const r = scan([css('.a { background: var(--bg, #ffffff); border-color: var(--c, rgb(0,0,0)); }')]);
  assert.equal(r.hardcodedCount, 0);
  assert.equal(r.tokenizedCount, 2);
});

test('genuine color functions are still detected', () => {
  const r = scan([css('.a { color: hsl(210 40% 96%); background: rgb(255, 0, 0); }')]);
  assert.equal(r.hardcodedCount, 2);
});

test('SVG url(#id) paint reference is not a color', () => {
  const r = scan([css('.i { fill: url(#e5e5e5); stroke: url(#grad) #ff0000; }')]);
  assert.equal(r.hardcodedCount, 1); // only the real #ff0000 fallback
  assert.equal(r.hardcoded[0].value, '#ff0000');
});

test('Tailwind arbitrary color anywhere in the bracket is detected', () => {
  const r = scan([jsx('<div className="shadow-[0_2px_4px_#00000033] ring-[3px_#ff0000]" />')]);
  assert.equal(r.hardcodedCount, 2);
  assert.deepEqual(r.hardcoded.map((h) => h.value).sort(), ['#00000033', '#ff0000']);
});

test('markup <style> blocks and inline style= colors are scanned', () => {
  const r = scan([{ path: 'p.html', text: '<style>.b{color:#3b82f6}</style><div style="color:#ff0000">x</div>' }]);
  assert.equal(r.hardcodedCount, 2);
});

test('SFC <style> token defs feed the palette', () => {
  const r = scan([{ path: 'C.vue', text: '<template><b/></template>\n<style>:root{--brand:#3b82f6}\n.a{border-color:#000000}</style>' }]);
  assert.equal(r.palette.length, 1);
  assert.equal(r.hardcodedCount, 1);
});

test('rgb() with a non-numeric channel parses to null (no NaN swatch)', () => {
  assert.equal(parseColor('rgb(none 0 0)'), null);
  assert.equal(parseColor('rgb(from #fff r g b)'), null);
});

test('hsl() honors turn/rad/grad hue units', () => {
  const cyan = parseColor('hsl(0.5turn 100% 50%)'); // 0.5turn = 180deg
  assert.equal(cyan.r, 0);
  assert.equal(cyan.g, 255);
  assert.equal(cyan.b, 255);
});

test('diff gate counts ADDED occurrences, not the net (removals must not mask additions)', () => {
  const base = scan([css('.a { color: #111111; border-color: #222222; background: #333333; }')]);
  const head = scan([css('.b { color: #444444; border-color: #555555; background: #666666; }')]);
  const d = diffHardcoded(base, head);
  assert.equal(d.newHardcoded, 0); // net is zero (3 removed, 3 added)
  assert.equal(d.added, 3);        // but 3 were genuinely added
});

test('diff normalizes color spelling — reformatting is not a new color', () => {
  const base = scan([css('.a { color: rgb(0,0,0); }')]);
  const head = scan([css('.a { color: rgb(0, 0, 0); }')]);
  const d = diffHardcoded(base, head);
  assert.equal(d.added, 0);
  assert.equal(d.newColors.length, 0);
});

test('color parsing: shorthand hex, rgb, hsl', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#000000'), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.equal(distance({ r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }), 0);
  assert.equal(parseColor('not-a-color'), null);
});

// 透明度（実データ監査 2026-07 由来）。v0.1.0 は alpha を捨てていたので、
// rgba(0,0,0,0) と黒トークンを「完全一致(Δ0)」と報告していた。
test('color parsing: alpha を保持する（8桁hex / 4桁hex / rgba / hsla / %表記）', () => {
  assert.equal(parseColor('#00000080').a, 128 / 255);
  assert.equal(parseColor('#0008').a, 136 / 255);
  assert.equal(parseColor('rgba(0, 0, 0, 0.5)').a, 0.5);
  assert.equal(parseColor('rgba(0 0 0 / 50%)').a, 0.5);
  assert.equal(parseColor('hsla(0, 0%, 0%, 0.25)').a, 0.25);
  assert.equal(parseColor('rgb(1, 2, 3)').a, 1);
});

// --- 近傍トークン提案の条件（実データ監査 2026-07・公開CSS 700ファイル 由来） ---
// v0.1.0 は「置き換えられない色」まで提案していた: 半透明に不透明トークン(47%)、
// 見た目に別の色(38%)。提案は「そのまま置き換えられる」ものだけに絞る。

const palette = ':root { --ink: #263126; --ink-18: rgba(38, 49, 38, 0.18); --brand: #2563eb; }\n';

function nearestOf(css) {
  const r = scan([
    { path: 'tokens.css', text: palette },
    { path: 'app.css', text: css },
  ]);
  return r.hardcoded[0]?.nearest || null;
}

test('半透明の色に、不透明トークンを提案しない', () => {
  assert.equal(nearestOf('.a { box-shadow: 0 1px 2px rgba(38, 49, 38, 0.18); }')?.name, '--ink-18');
  assert.equal(nearestOf('.b { color: rgba(38, 49, 38, 0.5); }'), null);
});

test('完全に透明な色にはトークンを提案しない', () => {
  assert.equal(nearestOf('.c { background-color: rgba(0, 0, 0, 0); }'), null);
});

test('見た目に別の色は提案しない（redmean 距離のしきい値）', () => {
  assert.equal(nearestOf('.d { color: rgb(139, 92, 246); }'), null); // 紫 vs 緑系トークン
  assert.equal(nearestOf('.e { color: #2563eb; }')?.name, '--brand'); // 完全一致は出す
  assert.equal(nearestOf('.f { color: #2563ec; }')?.name, '--brand'); // ほぼ同色も出す
});

test('提案が無くてもベタ書きとしては数える（網羅率の指標は変えない）', () => {
  const r = scan([
    { path: 'tokens.css', text: palette },
    { path: 'app.css', text: '.g { color: rgb(139, 92, 246); }' },
  ]);
  assert.equal(r.hardcoded.length, 1);
  assert.equal(r.hardcoded[0].nearest, null);
});

// --- 破滅的バックトラッキング（実データ監査 2026-07 由来） ---
// zuzumi-f/Discord-11 の base.css（90KB）でスキャンが返らなくなった。原因は色関数の
// 正規表現 `(?:[^()]+|\(...\))*` で、閉じ括弧の無い rgba( があると指数時間になる。
// CI に入れていたらジョブが永久に回り続ける種類の不具合。

test('閉じ括弧の無い色関数があってもスキャンが返る（ReDoS ガード）', { timeout: 5000 }, () => {
  const text = '.a { color: rgba(' + 'var(--x), '.repeat(400) + ' /* 閉じない */\n';
  const r = scan([css(text)]);
  assert.ok(Array.isArray(r.hardcoded));
});

test('壊れた括弧の直後の正しい色は取りこぼさない', { timeout: 5000 }, () => {
  const text = '.a { color: rgba(0,0,0 ; }\n.b { color: #ff0000; }\n';
  const r = scan([css(text)]);
  assert.ok(r.hardcoded.some((h) => h.value === '#ff0000'));
});

test('入れ子1段の色関数は従来どおり丸ごと取れる', () => {
  const r = scan([css('.a { color: rgb(var(--r) 0 0 / 0.5); background: hsl(210 40% 96%); }')]);
  assert.equal(r.hardcodedCount, 1); // rgb(var(--r)…) はトークン参照なので債務ではない
  assert.equal(r.hardcoded[0].kind, 'hsl');
});

// --- 最近の CSS 色関数（2026-08） ---
// 色関数の正規表現が rgb/hsl だけだったので、oklch() を1件も数えていなかった。
// Tailwind v4 の既定色空間が oklch なので、モダンな構成ほど債務が見えなくなる。
// 実測：oklch で書いたプロジェクトで coverage 66.7%（実際は 22.2%）、
// トークン定義も oklch だと parseColor が null を返してパレットが 0 件になっていた。

test('oklch / oklab / hwb / lab / color() をベタ書きとして数える', () => {
  const r = scan([css([
    '.a { color: oklch(0.7 0.15 250); }',
    '.b { background: oklab(0.5 0.1 -0.1); }',
    '.c { border-color: hwb(200 10% 20%); }',
    '.d { fill: lab(50% 40 30); }',
    '.e { color: color(display-p3 1 0 0); }',
  ].join('\n'))]);
  assert.equal(r.hardcodedCount, 5);
  assert.deepEqual(r.hardcoded.map((h) => h.kind), ['oklch', 'oklab', 'hwb', 'lab', 'color']);
});

test('oklch で定義したトークンをパレットとして読める', () => {
  const r = scan([css(':root { --color-brand: oklch(0.628 0.2577 29.23); } .a { color: #ff0000; }')]);
  assert.equal(r.palette.length, 1);
  assert.equal(r.hardcoded[0].nearest.name, '--color-brand'); // oklch の赤 = #ff0000
});

test('oklch(var(--x) …) はトークン参照なので債務ではない', () => {
  const r = scan([css('.a { color: oklch(var(--l) 0.1 200); }')]);
  assert.equal(r.hardcodedCount, 0);
});

test('Tailwind 任意値の oklch も拾う', () => {
  const r = scan([jsx('<div className="text-[oklch(0.7_0.15_250)]" />')]);
  assert.equal(r.hardcodedCount, 1);
});

test('ハイフン区切りの末尾一致で color( を拾わない', () => {
  // \b はハイフンの直後で成立するので、後読みが無いと foo-color(...) が色になる。
  const r = scan([css('.a { background: foo-color(1 2 3); }')]);
  assert.equal(r.hardcodedCount, 0);
});

test('oklch / oklab / hwb を sRGB に変換できる', () => {
  assert.deepEqual(parseColor('oklch(0.628 0.2577 29.23)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('oklch(1 0 0)'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('hwb(0 50% 0%)'), { r: 255, g: 128, b: 128, a: 1 });
  assert.deepEqual(parseColor('hwb(0 30% 70%)'), { r: 77, g: 77, b: 77, a: 1 }); // w+b>=1 は無彩色
});

test('相対色構文と未対応の色空間は、数えるが提案はしない', () => {
  assert.equal(parseColor('oklch(from var(--x) l c h)'), null);
  assert.equal(parseColor('lab(50% 40 30)'), null); // 検出はする・変換はまだ
  const r = scan([css('.a { color: lab(50% 40 30); }')]);
  assert.equal(r.hardcodedCount, 1);
  assert.equal(r.hardcoded[0].nearest, null);
});

// --- 誤検知（敵対的入力監査 2026-08 由来） ---
// 別モデル（GPT-5.4）に「この検出器を壊す入力」を作らせ、実際に走らせて再現したもの。
// 共通の原因は「markup 側の走査が生テキストをそのまま見ていた」こと。CSS 側は maskUrls/
// maskVars を通していたのに、Tailwind 走査だけ素通しだった。
// ドキュメントサイトやスタイルガイドを掛けると、説明用のコード例が全部債務に数えられる。

const html = (text) => ({ path: 'x.html', text });

test('Tailwind の url() フラグメントを色と誤認しない', () => {
  const r = scan([jsx('export default () => <div className="bg-[url(/icons.svg#abcdef)]" />;')]);
  assert.equal(r.hardcodedCount, 0);
});

test('<pre><code> 内の Tailwind 例は債務に数えない', () => {
  const r = scan([html('<pre><code>class="text-[#3b82f6]"</code></pre>')]);
  assert.equal(r.hardcodedCount, 0);
});

test('JSX のコメントアウトされた class は債務に数えない', () => {
  const r = scan([jsx('export default () => <div>{/* className="border-[#ABCD]" */}</div>;')]);
  assert.equal(r.hardcodedCount, 0);
});

test('HTML コメント内の class は債務に数えない（非ASCII混在）', () => {
  const r = scan([html('<!-- 日本語メモ: class="text-[#abcdef]" は説明用 -->\n<p>通常の文章</p>')]);
  assert.equal(r.hardcodedCount, 0);
});

test('CSS 値の文字列リテラル内の hex は色ではない', () => {
  const r = scan([css('.note { background: "ticket #abcdef"; }')]);
  assert.equal(r.hardcodedCount, 0);
});

// マスクのやり過ぎ＝見逃しへの転落を防ぐ。上の5件と対で維持すること。

test('<code> の開始タグに付いた class は実際に効くので数える', () => {
  const r = scan([html('<code class="text-[#3b82f6]">sample</code>')]);
  assert.equal(r.hardcodedCount, 1);
});

test('同じ行に URL があっても Tailwind の色は取りこぼさない', () => {
  const r = scan([jsx('<a href="https://example.com/#anchor" className="text-[#3b82f6]">x</a>')]);
  assert.equal(r.hardcodedCount, 1);
  assert.equal(r.hardcoded[0].value, '#3b82f6');
});

test('通常の Tailwind 任意値は従来どおり検出する', () => {
  const r = scan([jsx('<div className="text-[#3b82f6] bg-[rgb(0,0,0)]" />')]);
  assert.equal(r.hardcodedCount, 2);
});
