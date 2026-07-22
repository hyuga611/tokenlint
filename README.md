# tokenlint

[![npm version](https://img.shields.io/npm/v/@hyuga/tokenlint.svg)](https://www.npmjs.com/package/@hyuga/tokenlint)
[![license](https://img.shields.io/npm/l/@hyuga/tokenlint.svg)](./LICENSE)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)](./package.json)

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

```yaml
# .github/workflows/tokenlint.yml
name: tokenlint
on: [pull_request]
jobs:
  tokens:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hyuga611/tokenlint@v0
        with:
          paths: src
          max: 0        # fail the PR if any hardcoded color is introduced
```

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
- Tailwind **semantic** classes (`text-primary`) are not yet counted as tokenized — only arbitrary values are flagged;
- the CI gate uses `--max <total>`. **PR-delta** ("new hardcoded colors *in this PR*") lands next.

## Options

```
tokenlint [paths...] [options]

  --max <n>          fail (exit 1) if hardcoded colors > n   (CI gate)
  --report[=file]    write an HTML scorecard (default: tokenlint-report.html)
  --badge[=kind]     shields.io endpoint JSON (kind: coverage | hardcoded)
  --format <fmt>     text (default) | json
  --no-color         disable ANSI color
  -h, --help / -v, --version
```

## Part of the hyuga611 lint family

Zero-dependency CI linters that fail your PR on things that quietly break:

- [reflint](https://github.com/hyuga611/reflint) — broken references in AGENTS.md / llms.txt / CLAUDE.md
- [skills-lint](https://github.com/hyuga611/skills-lint) — SKILL.md references & skill collisions
- [tracklint](https://github.com/hyuga611/tracklint) — broken conversion tracking
- [carrylint](https://github.com/hyuga611/carrylint) — non-portable, author-environment-baked skills

MIT © [hyuga611](https://github.com/hyuga611)
