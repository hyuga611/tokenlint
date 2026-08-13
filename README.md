# tokenlint

[![npm version](https://img.shields.io/npm/v/@hyuga/tokenlint.svg)](https://www.npmjs.com/package/@hyuga/tokenlint)
[![license](https://img.shields.io/npm/l/@hyuga/tokenlint.svg)](./LICENSE)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)](./package.json)

> Part of a set of zero-dependency CI tools for AI-agent repos — start with **[reflint](https://github.com/hyuga611/reflint)**.

**Count hardcoded colors, measure design-token coverage, and gate PRs.** A zero-config, zero-dependency GitHub Action + CLI that understands both **CSS custom properties** and **Tailwind arbitrary values** (`text-[#3b82f6]`).

> デザイントークンを使わずベタ書きされた色を毎PRで数え、トークン網羅率をスコアカード＋動的バッジにする。設定ファイル不要・依存ゼロ。

---

## Why

Your design system has tokens. Colors still get hardcoded anyway — in a rushed PR, in a pasted component, in a `text-[#3b82f6]`. Existing linters (`stylelint-declaration-strict-value`) only pass/fail; they don't give you a **number you can watch**.

tokenlint makes the debt **visible**:

- a **coverage badge** on your README that moves every time someone touches styling,
- a **scorecard** (color-chip grid) you can paste into a PR,
- and a **nearest-token suggestion** for every hardcoded color.

**Zero-config**: it reads your `--color-*` custom properties as the token palette. No config file, no token file, no Figma. Point it at a folder and get a number in 3 seconds.

## Install & use

```bash
npx @hyuga/tokenlint            # scan ./ and print a scorecard
npx @hyuga/tokenlint src        # scan a folder
npx @hyuga/tokenlint --report   # write tokenlint-report.html (the shareable scorecard)
```

### As a GitHub Action (the PR gate)

Gate on **new debt only** — don't punish the whole team for the colors that were already there, just fail when a PR *adds* hardcoded colors:

```yaml
# .github/workflows/tokenlint.yml
name: tokenlint
on: [pull_request]
jobs:
  tokens:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0        # tokenlint diffs against the PR base
      - uses: hyuga611/tokenlint@v0
        with:
          paths: src
          max-new: 0            # fail only if this PR ADDS hardcoded colors
```

`--since`/`base` defaults to the PR base commit, so **"new in this PR"** works with zero extra config. Prefer `max-new` (net new) over `max` (total) unless you're at zero and want to stay there.

`paths: src` is a promise that `src` exists. From 0.3.0, if it does not — renamed, moved, a typo — tokenlint **exits 2 instead of passing**. Before that it scanned nothing, counted zero, found zero ≤ `max`, and printed a green `✓ pass`; the gate went on reporting success for as long as the path stayed wrong. Exit 2 means *could not evaluate*, as distinct from 1 for *the gate failed*.

### As a README badge

```bash
npx @hyuga/tokenlint --badge > coverage.json   # shields.io endpoint JSON
```

Publish `coverage.json` (e.g. via a Gist with [Schneegans/dynamic-badges-action](https://github.com/marketplace/actions/dynamic-badges)) and point a shields endpoint badge at it:

```md
![token coverage](https://img.shields.io/endpoint?url=<raw-url-of-coverage.json>)
```

## What it detects

| | |
| --- | --- |
| **Hardcoded** | `#hex`, `rgb()/rgba()`, `hsl()/hsla()` in CSS color properties · Tailwind arbitrary colors (`text-[#..]`, `bg-[rgb(..)]`) |
| **Tokens** | `--color-*` (any custom property whose value is a color) |
| **Tokenized usage** | `var(--token)` in a color property |
| **Coverage** | `tokenized / (tokenized + hardcoded)` |
| **Suggestion** | nearest defined token by perceptual color distance |

## Honest v0 scope

tokenlint is dependency-zero and regex-based on purpose. Not yet handled (planned):

- named colors (`red`, `white`) are **not** flagged;
- SCSS `$variables` are not treated as tokens (only CSS custom properties);
- Tailwind **semantic** classes (`text-primary`) are not yet counted as tokenized — only arbitrary values are flagged.

The **"new in this PR"** delta (`--since` / `--max-new`) uses the **net count change** (base → head), like size-limit's byte delta: robust and hard to game.

## Options

```
tokenlint [paths...] [options]

  --max <n>          fail (exit 1) if TOTAL hardcoded colors > n
  --since <ref>      diff against a git ref (e.g. the PR base) for "new this PR"
  --max-new <n>      fail (exit 1) if this PR ADDS more than n hardcoded colors
  --report[=file]    write an HTML scorecard (default: tokenlint-report.html)
  --badge[=kind]     shields.io endpoint JSON (kind: coverage | hardcoded | new)
  --format <fmt>     text (default) | json
  --no-color         disable ANSI color
  -h, --help / -v, --version
```


## Related tools

Zero-dependency CI linters for repos where AI agents do the work. Each one fails the PR on something that breaks quietly.

| | Catches |
| --- | --- |
| [reflint](https://github.com/hyuga611/reflint) | `AGENTS.md` / `llms.txt` / `CLAUDE.md` pointing at commands, scripts, or paths that no longer exist |
| [skills-lint](https://github.com/hyuga611/skills-lint) | `SKILL.md` broken references + `name`/trigger collisions between skills |
| [carrylint](https://github.com/hyuga611/carrylint) | Skills with the author's machine or model baked in — absolute paths, undeclared CLIs, unresolved placeholders |
| [genchi](https://github.com/hyuga611/genchi) | Agents reporting "done" without re-fetching real-world state |
| [tracklint](https://github.com/hyuga611/tracklint) | Forms and CTAs that quietly stopped being wired for conversion tracking |
| **tokenlint** ← you are here | Hardcoded colors that bypass your design tokens |
| [reflint for VS Code](https://github.com/hyuga611/reflint-vscode) | The same reflint checks, inline in the editor as you save |
| [orogami](https://github.com/hyuga611/orogami) | Not a linter — natural Japanese/CJK line breaking for OGP images (BudouX + font subsetting) |

MIT © [hyuga611](https://github.com/hyuga611)
