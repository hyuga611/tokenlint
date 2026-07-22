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

/** Parse a CSS color literal (#hex, rgb()/rgba(), hsl()/hsla()) to {r,g,b}, or null. */
export function parseColor(input) {
  if (!input) return null;
  const s = String(input).trim().toLowerCase();
  let m;
  if ((m = /^#([0-9a-f]{3,8})$/.exec(s))) {
    const h = m[1];
    const at = (a, b) => parseInt(h.slice(a, b), 16);
    if (h.length === 3 || h.length === 4) {
      return { r: at(0, 1) * 17, g: at(1, 2) * 17, b: at(2, 3) * 17 };
    }
    if (h.length === 6 || h.length === 8) {
      return { r: at(0, 2), g: at(2, 4), b: at(4, 6) };
    }
    return null; // 5 or 7 hex digits: not a valid color
  }
  if ((m = /^rgba?\(([^)]+)\)$/.exec(s))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const r = channel(p[0]), g = channel(p[1]), b = channel(p[2]);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null; // e.g. rgb(none 0 0), relative-color syntax
    return { r, g, b };
  }
  if ((m = /^hsla?\(([^)]+)\)$/.exec(s))) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean);
    if (p.length < 3) return null;
    const h = hueToDeg(p[0]);
    const sat = parseFloat(p[1]) / 100;
    const l = parseFloat(p[2]) / 100;
    if ([h, sat, l].some((v) => Number.isNaN(v))) return null;
    return hslToRgb(h, sat, l);
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
