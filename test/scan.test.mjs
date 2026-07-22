import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scan, isSupported } from '../src/scan.mjs';
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

test('color parsing: shorthand hex, rgb, hsl', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseColor('#000000'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), { r: 255, g: 0, b: 0 });
  assert.equal(distance({ r: 0, g: 0, b: 0 }, { r: 0, g: 0, b: 0 }), 0);
  assert.equal(parseColor('not-a-color'), null);
});
