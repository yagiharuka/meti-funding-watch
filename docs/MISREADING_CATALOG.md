# 誤読カタログ

この文書は、当サイトの監査で最初に確認する一次成果物です。コード上の注記一覧ではなく、**利用者が画面から何を誤って結論づけ得るか**を先に列挙します。

新しい問題提起・修正案・レビューは、コードを直す前にまずこの表へ行を追加または更新してください。対応順は指摘順ではなく、誤読した場合の被害と発生可能性で決めます。

## 運用ルール

1. 新しい指摘は、実装に着手する前にこのカタログへ登録する。
2. `OPEN` の行では、「現在の対策」「所在」「テスト」を無理に埋めない。`—` は未対策を意味する。
3. コード修正で対策したら、同じPRで所在とテストを記録して `MITIGATED` にする。
4. 原資料の制約で解消不能なものは `INHERENT` とし、画面上の読み違い防止だけを評価する。
5. レビュー依頼は「実装を見てください」ではなく、まず **このカタログの網羅性を批判してください** と依頼する。

## 監査の入口

レビュー時は、少なくとも次の8観点を順番に確認します。思いつき順で監査しません。

- 検索・名寄せ：別法人の併合、同一法人の分断、旧商号、連名、法人番号なし
- 0件・欠落：検索0件を不存在と誤読しないか、収録外を否定推論していないか
- 金額・集計：同一資金の再掲、状態違い、階層違い、共同受注、系列間合算
- 時点・年度：レビュー年度、認定日年度、年度不明、時系列に見える表示
- 受取主体・資金経路：執行団体、事務局、中間主体、最終受益者の混同
- 系列間比較：GビズINFO、行政事業レビュー、公式資料の定義差
- 出典・鮮度：取得日時、更新頻度、原典への到達、raw dataと表示の整合
- UI失敗時：契約変更やJS失敗時に誤った値を見せるか、見せない側へ倒れるか

## カタログ

| ID | 誤読 | 被害 | 起きる画面 | 現在の対策 | 所在 | テスト | 状態 |
|---|---|---|---|---|---|---|---|
| M-001 | 0件＝その法人は経産省関係の資金を受けていない | 高 | GビズINFO企業検索タブ | 0件のときだけ「資金を受けていないことを意味しない」と表示。1件以上では表示しない | `pages-site/company-search-ui.ts` | `tests/company-search-runtime.test.mjs`, `tests/misreading-catalog.test.mjs` | MITIGATED |
| M-002 | 0件＝行政事業レビュー／公式資料にも該当資金が存在しない | 高 | レビュー・公式資料 | 収録範囲外や未掲載を否定推論に使えない旨を表示 | `app/review/ReviewSearch.tsx`, `app/CombinedCompanyResults.tsx`, `pages-site/company-evidence-ui.ts` | `tests/review-ui-semantics.test.mjs`, `tests/company-evidence-ui.test.mjs` | MITIGATED |
| M-003 | GビズINFOの補助金掲載額は行をまたいで足せる | 高 | 企業カード、年度別、事業別、検索サマリー | 補助金は合計を表示せず、個別明細だけ表示。詳しい説明は末尾の「このデータの読み方」へ集約 | `pages-site/company-search-ui.ts`, `pages-site/subsidy-semantics-ui.ts` | `tests/subsidy-semantics-ui.test.mjs`, `tests/company-search-runtime.test.mjs` | MITIGATED |
| M-004 | 行政事業レビューの別シート年度再掲を別支出として足せる | 高 | 同じ企業の行政事業レビュー表示 | レビュー掲載行をまたぐ金額合計を表示しない | `app/CombinedCompanyResults.tsx`, `scripts/build-review-company-index.mjs` | `tests/review-company-index-semantics.test.mjs` | MITIGATED |
| M-005 | 年度別件数＝実際の補助金額・採択件数の推移 | 高 | GビズINFO年度フィルタ・年度別表示 | 年度指定時に認定日空欄の除外件数を警告し、補助金額は年度別合計しない | `pages-site/subsidy-semantics-ui.ts`, `pages-site/company-search-ui.ts` | `tests/subsidy-semantics-ui.test.mjs` | MITIGATED |
| M-006 | 共同受注・連名行の公表金額＝各社それぞれの受領額 | 高 | 公式資料明細 | 共同当事者を展開し、公表行全体の金額で各社配分額ではない旨を表示 | `pages-site/company-evidence-ui.ts`, `scripts/company-search.mjs` | `tests/company-evidence-ui.test.mjs`, `tests/company-search-numberless.test.mjs` | MITIGATED |
| M-007 | 正規化された「完全一致」1件＝自分が探していた法人で確定 | 中 | GビズINFO企業検索 | 完全一致を主結果にしつつ、同じ検索語を含む別法人候補を別表示し合算しない | `pages-site/company-search-alternatives.ts` | `tests/company-search-alternatives.test.mjs` | MITIGATED |
| M-008 | 旧商号を入力すれば現在の同一法人を必ず検索できる | 高 | 全企業検索 | — | — | — | OPEN |
| M-009 | GビズINFOの掲載法人＝資金の最終受益者・その法人自身の収益 | 高 | GビズINFO企業カード | 執行団体・事務局等への交付原資を含み得る旨を末尾の「このデータの読み方」に表示 | `pages-site/company-search-ui.ts`, `pages-site/subsidy-semantics-ui.ts` | `tests/subsidy-semantics-ui.test.mjs`, `tests/company-search-runtime.test.mjs` | MITIGATED |
| M-010 | GビズINFO・行政事業レビュー・公式資料の金額は同じ定義で相互に足せる | 高 | 複数系列を同時表示する画面 | 系列間合算を禁止し、各系列を別表示。定義差は末尾の「このデータの読み方」に集約 | `app/CombinedCompanyResults.tsx`, `app/review/ReviewSearch.tsx`, `pages-site/company-search-ui.ts` | `tests/review-ui-semantics.test.mjs`, `tests/review-company-index-semantics.test.mjs`, `tests/company-search-runtime.test.mjs` | MITIGATED |
| M-011 | 法人番号がない同名行は同一法人なのでまとめてよい | 高 | 公式資料など法人番号なしデータ | 同名でも行単位に分け、確認済み法人件数と番号なし行数を分離 | `scripts/company-search.mjs` | `tests/company-search-numberless.test.mjs` | MITIGATED |
| M-012 | GビズINFO検索に法人番号なし行も混在し得る | 中 | GビズINFO公開検索 | GビズINFO公開スキーマは13桁法人番号を必須のまま維持。番号なし対応はevidence layerに限定 | `app/funding-search.worker.ts`, `app/page.tsx`, `pages-site/funding-search-enhanced.worker.js` | `tests/company-search-numberless.test.mjs` | MITIGATED |
| M-013 | 公式資料で同額が複数年度にあれば重複なので1件に消してよい | 中 | 公式資料 | 自動dedupeせず行単位の証拠として保持し、法人合計を表示しない | `app/CombinedCompanyResults.tsx`, `data/official/` | `tests/review-company-index-semantics.test.mjs` の公式資料非集計契約 | MITIGATED |
| M-014 | 行政事業レビューの匿名集約枠（「その他」等）も企業単位に追跡できる | 中 | 行政事業レビュー | 原資料が企業を特定していない行は法人番号なしの原文表示に留める | `app/review/ReviewSearch.tsx` | — | INHERENT |

## OPEN項目

`OPEN` は修正漏れではなく、次の監査・修正対象を明示するための状態です。現在の優先順位は被害の大きさから次のとおりです。

1. **M-008** 旧商号検索を必ず保証できるように見える問題。

M-008は、旧商号履歴の根拠データをどこまで保持できるかを確認するまで「対応済み」としません。

## 注記配置の原則

- **上に置く**：読み違えると人が損をする一文。原則として、その誤読が発生する条件のときだけ表示する。
- **その場に残す**：数字の代わりに表示する `合計しません`、年度指定時の警告、候補展開時の非合算表示など、操作と不可分な表示。
- **下へ畳む**：定義、背景、系列間の違い、資金経路、補助金の状態違いなど、読めば理解できる説明。

判断基準は、**「読み違えると人が損をする一文」だけを上に置き、「読めば分かることの説明」は下げる**、です。
