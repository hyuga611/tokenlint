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
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseColor('#000000'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0 });
  assert.equal(distance({ r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }), 0);
  assert.equal(parseColor('not-a-color'), null);
});
