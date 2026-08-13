# Changelog

## 0.3.0

公開版を、存在しないパスに向けて叩いたら見つかった。

### 何も走査していないのに `✓ pass` と出して exit 0 していた

```
$ tokenlint ./src --max 0     # src/ は app/ にリネーム済み

  ✓ pass  0 hardcoded ≤ max 0
$ echo $?
0
```

パスの `stat` に失敗したときに黙って握りつぶしていたので、**存在しないディレクトリと空の
ディレクトリが区別できなかった。** 走査対象が0件なら全カウントが0で、0はどんな `--max` でも
満たす。つまり **一度も測っていないゲートが、通過したゲートとして自分を報告していた。**

CI ではこれが最悪の壊れ方になる。チェックは緑のまま残り、緑であることがもう誰も見に来ない
理由になる。README が勧めている設定がそのまま `paths: src` なので、`src/` をリネームした
瞬間から気づく手段がないまま通り続ける。

**修正:**

- 呼び出し側が名前を出したパスが存在しない → stderr にそのパス名を出して **exit 2**。
  （パスの下位で `stat` に失敗したものは従来どおり無視する。これはシンボリックリンクや
  権限の話で、止めるほうがノイズになる。）
- 走査対象が0件で、かつ `--max` / `--max-new` が指定されている → **exit 2**。
  ゲートは評価できていないので、通過とは報告しない。
- ゲート行に `✓ pass` を出さない。緑のチェックを出してから非ゼロで終了すると、ログを読む人が
  読むのは緑のほうになる。代わりに `✗ not evaluated` と出す。
- ゲート指定なしで0件のときは、`Nothing scanned` と「ゼロなのは数えるものが無かったからで、
  綺麗だからではない」を明示して exit 0。3つのゼロと `n/a` から読み取れ、では不足だった。

exit 2 は「評価できなかった」、exit 1 は「ゲートに落ちた」で、`--max-new` にベース ref が
無いときの既存の挙動と揃えてある。

`--format json` の `fileCount` と `--badge` の `n/a` は以前から正直だったので変更なし。

### テスト

CLI にテストが1本も無く、この欠陥は CLI にしか無かった。`test/cli.test.mjs` を追加した。
「何も無いときに落ちる」だけでなく「正しいファイルが綺麗なら通る／汚れていれば落ちる」も
入れてある。無害なケースで鳴るゲートは CI から外され、そうなると本来の拒否も起きなくなる。


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
