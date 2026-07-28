# Changelog

## 0.2.0

Driven by a real-world audit of **1,200 public CSS / SCSS / TSX files** (700 tuning + 500 hold-out,
collected 2026-07). Detection of hardcoded colors was accurate — every sampled hit was a genuine
literal in a real declaration — but the *suggestions* were not, and one real file hung the scanner.

- **Fixed a hang (catastrophic backtracking).** `scan()` never returned on
  `zuzumi-f/Discord-11/base.css` (90 KB of real CSS). The color-function regex used the classic
  exponential shape `(?:[^()]+|\(…\))*`, which explodes as soon as an `rgba(` in the file is never
  closed. In CI this is a job that spins forever, not an error you can see. The alternation branches
  are now disjoint and the repetition is bounded: the same file scans in **5 ms**.
- **Alpha is now parsed and respected.** `parseColor()` returns `a` (8-digit hex, 4-digit hex,
  `rgba()`, `hsla()`, `/ 50%` syntax). v0.1.0 discarded it, so `rgba(0,0,0,0)` — fully transparent —
  was reported as an exact (Δ0) match for a solid black token. 47% of all suggestions were for
  semi-transparent colors that the suggested token could not replace.
- **Suggestions are now limited to colors you can actually swap in**: same alpha (±0.02) and within
  a redmean distance of 40. 38% of v0.1.0's suggestions pointed at visibly different colors — one
  offered `--neon-green` for a purple. Suggestions dropped 2,257 → 604 on the same corpus; the
  hardcoded counts and the coverage metric are unchanged.
- Regression tests distilled from the audit: the ReDoS shape, alpha parsing, and the suggestion
  cutoffs.

## 0.1.0

Initial release. Color-token coverage linter: hardcoded color debt with nearest-token suggestions,
HTML scorecard, dynamic shields badge, and a `--since` / `--max-new` PR diff gate. Zero-dependency,
CSS + Tailwind.
