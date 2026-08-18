# Changelog

## 0.5.0

### React のインラインスタイルを丸ごと見落としていた

    <div style={{ color: "#ff0000" }}>

React で色を直書きする一番普通の書き方がこれなのに、マークアップの CSS 射影は
引用符つきの HTML 属性（style="..."）しか見ていなかったので、1件も拾えていなかった。

カバレッジ率は tokenized / (tokenized + hardcoded) なので、この見逃しは
この工具の看板の数字を実態より良く見せる方向に効く。直書きだけのファイルが
「ハードコード0件」と出ていた。

- style={{ ... }} を CSS 宣言列に射影する。引用符は外し（"#f00" の中身を残すため）、
  カンマは ; にする。オフセットと改行は保つので行番号はそのまま。
- backgroundColor のような camelCase プロパティを kebab に正規化してから
  色プロパティか判定する。CSS 側に camelCase は無いので CSS の解釈は変わらない。
- style={{ color: "var(--color-text)" }} は従来どおりトークン利用として数える。

敵対的入力監査（2026-08）で発見。// 行コメント内の Tailwind クラスを拾う件は既知で、
https:// と区別できず URL を含む行を丸ごと隠して見逃しに転ぶため、意図的に対象外のまま。

## 0.4.0

### oklch() を1件も数えていなかった

色関数の正規表現が `rgb|rgba|hsl|hsla` だけだった。`oklch()` `oklab()` `lab()` `lch()`
`hwb()` `color()` は全部素通り。**Tailwind v4 は既定の色空間が oklch** なので、
新しく書かれたコードほど見えなくなる。

同じプロジェクトを新旧で測った結果：

```
0.3.1   Coverage 66.7%   hardcoded 1   Palette 0 tokens defined
0.4.0   Coverage 22.2%   hardcoded 7   Palette 1 tokens defined
```

**実態の3倍良い数字を出していた。** しかも `parseColor()` が oklch を読めないので、
`--color-brand: oklch(…)` のようなトークン定義もパレットに入らない。つまり
「デザインシステムが1つも見つからない」状態で、それを異常と扱わずに網羅率だけ報告していた。
見逃しは誤検知より質が悪い。誤検知は消されるが、見逃しは「うまくいっている」と読まれる。

検出は6つの関数すべてに広げた。変換（＝近いトークンの提案と色チップ）は **oklch / oklab /
hwb** に対応した。Tailwind v4 と最近のデザイントークンが実際に吐くのがこの3つだから。
`lab()` `lch()` `color()` は**数えるが提案はしない**（`→ no token nearby` になる）。
D50 の色順応や色空間ごとの行列が要る割に、デザインシステムでの実用例が薄いので後回しにした。

関数名は1箇所（`FN`）にまとめ、4つの正規表現をそこから組むようにした。0.3.1 で直した
`maskUrls` の抜けは、同じ判定が2箇所に直書きされていて片方だけ古い、という形の欠陥だった。

### 影響

検出が増える方向なので、oklch を使っているプロジェクトでは**網羅率が下がって見える**。
下がったのではなく、これまで測れていなかった分が出てきた。数え方が変わるので minor を上げた。

## 0.3.1

別のモデル（GPT-5.4）に「この検出器を壊す入力を作れ」と投げ、返ってきた16件を実際に走らせたら
6件が再現した。自分で書いたテストは自分の想定の外に出られない、という話。

### ドキュメントに載せたコード例が、そのまま「債務」に数えられていた

```
$ cat docs.html
<pre><code>class="text-[#3b82f6]"</code></pre>

$ tokenlint docs.html
  Hardcoded   1 colors across 1 files
```

`<pre><code>` の中身も、`<!-- -->` のコメントも、`{/* … */}` でコメントアウトした JSX も、
すべて生テキストのまま Tailwind 走査に掛かっていた。**スタイルガイドや解説ページを持つ
リポジトリほど、実際には存在しない債務でスコアが下がる。** 説明用に色を書けば書くほど
網羅率が落ちるので、指標として逆を向いていた。

### `bg-[url(/icons.svg#abcdef)]` の SVG フラグメントを色と誤認していた

CSS 側（`scanCssUsages`）は `maskUrls()` を通していたのに、Tailwind 側（`scanMarkup`）だけ
素通しだった。同じ「url() は参照であって色ではない」という判断が、片方の経路にしか
入っていなかった非対称。

あわせて、CSS 値の文字列リテラル（`background: "ticket #abcdef"`）も色として数えていたのを修正。

検出が減る方向の変更なので、既存利用者の網羅率は**上がる**ことがある（債務が減るため）。
実際に効いている色の検出は変えていない（マスクのやり過ぎを防ぐ対のテストを追加済み）。

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
