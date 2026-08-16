// tokenlint — zero-dependency color parsing + perceptual distance.
// Used to suggest the nearest existing design token for a hardcoded color.

function clamp(n, lo, hi) { return n < lo ? lo : n > hi ? hi : n; }

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  s = clamp(s, 0, 1); l = clamp(l, 0, 1);
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

function channel(str) {
  str = str.trim();
  if (str.endsWith('%')) return clamp(Math.round((parseFloat(str) * 255) / 100), 0, 255);
  return clamp(Math.round(parseFloat(str)), 0, 255);
}

// アルファ値（省略時は 1）。`50%` 表記も受ける。
function alphaOf(str) {
  if (str == null) return 1;
  const s = String(str).trim();
  const v = s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s);
  return Number.isNaN(v) ? 1 : clamp(v, 0, 1);
}

// 0..1 の線形値を sRGB の 0..255 へ。域外は端に寄せる（負数を Math.pow に渡すと NaN）。
function encodeSrgb(c) {
  const x = clamp(c, 0, 1);
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return clamp(Math.round(v * 255), 0, 255);
}

// OKLab → sRGB。係数は Björn Ottosson の定義（bottosson.github.io/posts/oklab/）。
// Tailwind v4 の既定色空間が oklch なので、これが無いと「近いトークン」を一切提案できない。
function oklabToRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return {
    r: encodeSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: encodeSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: encodeSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

// oklch/oklab の L は 0..1（`62%` 表記も可）、C と a/b は 0..0.4 相当（100% = 0.4）。
function okNum(str, pctScale) {
  const v = parseFloat(str);
  if (Number.isNaN(v)) return NaN;
  return String(str).trim().endsWith('%') ? (v / 100) * pctScale : v;
}

/** Parse a CSS color literal (#hex, rgb()/rgba(), hsl()/hsla(), oklch()/oklab()/hwb()) to {r,g,b,a}, or null. */
export function parseColor(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  let m;
  if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
    const h = m[1];
    const at = (a, b) => parseInt(h.slice(a, b), 16);
    if (h.length === 3 || h.length === 4) {
      return { r: at(0, 1) * 17, g: at(1, 2) * 17, b: at(2, 3) * 17, a: h.length === 4 ? (at(3, 4) * 17) / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return { r: at(0, 2), g: at(2, 4), b: at(4, 6), a: h.length === 8 ? at(6, 8) / 255 : 1 };
    }
    return null; // 5 or 7 hex digits: not a valid color
  }
  if ((m = /^rgba?\(([^)]+)\)$/.exec(s))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const r = channel(p[0]), g = channel(p[1]), b = channel(p[2]);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null; // e.g. rgb(none 0 0), relative-color syntax
    return { r, g, b, a: alphaOf(p[3]) };
  }
  if ((m = /^hsla?\(([^)]+)\)$/.exec(s))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const h = hueToDeg(p[0]);
    const sat = parseFloat(p[1]) / 100;
    const l = parseFloat(p[2]) / 100;
    if ([h, sat, l].some((v) => Number.isNaN(v))) return null;
    return { ...hslToRgb(h, sat, l), a: alphaOf(p[3]) };
  }
  if ((m = /^oklch\(([^)]+)\)$/.exec(s))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const L = okNum(p[0], 1), C = okNum(p[1], 0.4), H = hueToDeg(p[2]);
    if ([L, C, H].some(Number.isNaN)) return null; // `none` / relative color syntax
    const rad = (H * Math.PI) / 180;
    return { ...oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad)), a: alphaOf(p[3]) };
  }
  if ((m = /^oklab\(([^)]+)\)$/.exec(s))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const L = okNum(p[0], 1), a = okNum(p[1], 0.4), b = okNum(p[2], 0.4);
    if ([L, a, b].some(Number.isNaN)) return null;
    return { ...oklabToRgb(L, a, b), a: alphaOf(p[3]) };
  }
  if ((m = /^hwb\(([^)]+)\)$/.exec(s))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const h = hueToDeg(p[0]), w = parseFloat(p[1]) / 100, bl = parseFloat(p[2]) / 100;
    if ([h, w, bl].some(Number.isNaN)) return null;
    const alpha = alphaOf(p[3]);
    if (w + bl >= 1) { const g = clamp(Math.round((w / (w + bl)) * 255), 0, 255); return { r: g, g, b: g, a: alpha }; }
    const base = hslToRgb(h, 1, 0.5);
    const mix = (c) => clamp(Math.round(c * (1 - w - bl) + w * 255), 0, 255);
    return { r: mix(base.r), g: mix(base.g), b: mix(base.b), a: alpha };
  }
  return null;
}

// CSS hue may carry an angle unit (deg default). Convert to degrees; hslToRgb normalizes mod 360.
function hueToDeg(str) {
  const v = parseFloat(str);
  if (Number.isNaN(v)) return NaN;
  if (str.endsWith('grad')) return v * 0.9;        // 400grad = 360deg  (test before 'rad')
  if (str.endsWith('rad')) return (v * 180) / Math.PI;
  if (str.endsWith('turn')) return v * 360;
  return v;                                         // deg or unitless
}

/** Perceptual "redmean" color distance (compuphase.com/cmetric.htm). Lower = closer. */
export function distance(a, b) {
  if (!a || !b) return Infinity;
  const rmean = (a.r + b.r) / 2;
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return Math.sqrt((2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db);
}

export function rgbToHex({ r, g, b }) {
  const h = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
