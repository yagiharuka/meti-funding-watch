# 地方経済産業局・公式資料の取込監査

最終確認日: 2026-08-12

## 結論

中国経済産業局・北海道経済産業局・四国経済産業局について、公式目次から直接リンクされる機械処理可能な HTML/XLSX を146資料定義として列挙した。定義URLは、保存した6つの公式目次の `href` と146/146件で完全一致する。加えて、関東経済産業局の保存済み公式目次にあるPDF hrefを監査し、令和7年度の補助金等交付決定8資料・284掲載行をstrict parserへ接続した。

ただし、短時間の連続取得では各局サイトが HTTP 202 の AWS WAF challenge またはCloudFront 403を返す。HTML/XLSXはFull GET・SHA-256・bytes・strict parse・行数を検証できた18資料だけを `REGIONAL_OFFICIAL_DOCUMENTS` として接続し、残る128資料は `REGIONAL_CANDIDATE_DOCUMENTS` として分離する。PDFは東北2資料と関東8資料だけを `REGIONAL_PDF_DOCUMENTS` として接続する。いずれも、段階導入を地方局・全年度・全公表区分の「網羅」とは表示しない。

## 公式目次から確認できる範囲

| 執行機関 | 契約結果 | 補助金等の交付決定 | 候補資料数 | 明示的ギャップ |
|---|---:|---:|---:|---|
| 中国経済産業局 | FY2020–FY2026、31 XLSX | FY2020–FY2025、10 XLSX | 41 | FY2026交付決定なし。FY2020は4–12月、FY2021・FY2022は4–12月のリンクのみ |
| 北海道経済産業局 | FY2023–FY2026、17 HTML | FY2022–FY2025、4 HTML | 21 | 現行目次に契約FY2020–22、交付FY2020–21、交付FY2026のリンクなし |
| 四国経済産業局 | FY2020–FY2026、72月別HTML | FY2020–FY2025、12半期HTML | 84 | 契約は目次にリンクのある月だけ。リンクのない月を0件とはみなさない。交付FY2026なし |

FY2026は年度途中であり、完了年度の件数として扱わない。

## 実ファイルで通過した監査

WAFがchallengeへ切り替わる前に取得できた18資料・388行をstrict parseし、`data/official-regional-evidence-map.json` に資料ID・原本URL・bytes・SHA-256・rowCountを固定した。

- 中国局: 2 XLSX・38行（FY2020/FY2024競争・物品役務等）
- 北海道局: 8 HTML・213行（FY2023契約4区分、FY2024競争2区分、FY2025競争物品、FY2025交付決定）
- 四国局: 8 HTML・137行（FY2024–FY2026の契約各区分、FY2025交付決定上期）

この388行は初回検証時のevidence件数である。ライブ資料の更新で行が追加されうるため、公開件数は毎回のmanifestを正とする。

## 関東局PDFの調査inventoryと最小安全wave

WARPに保存された関東局の公式目次を調査し、PDF hrefを年度・区分ごとに数えた結果は次のとおりである。ただし、この目次HTML自体のbyte/SHA・全href集合は公開manifestの検証対象ではないため、下表は調査時点の参考inventoryであり、サイトが保証する完全母集団ではない。本番の公開ゲートは、取り込んだ8 PDFそれぞれの原本byte・SHA-256・ページ・掲載行を個別に検証する。

| 区分 | 調査時点で確認した範囲 | PDF href | 本番取込 | 未取込候補 |
|---|---|---:|---:|---:|
| 補助金等の交付決定 | 令和3～7年度 | 41 | 令和7年度8 | 令和3～6年度33 |
| 契約締結状況 | 令和4～7年度、競争/随意×物品役務/委託 | 16 | 0 | 16 |
| 合計 | 調査で確認したhrefのみ（推測URLなし） | 57 | 8 | 49 |

調査時点の令和7年度交付決定欄で確認した上期5・下期3 PDFを取り込んだ。ほかのファイル名を推測して0件扱いしたり収録したりしない一方、これを令和7年度の全資料収録とは表示しない。

| 資料 | pages | rows/page | rows | bytes | SHA-256 |
|---|---:|---|---:|---:|---|
| `7fy_kamihanki_ene_kofukin.pdf` | 2 | 17, 2 | 19 | 243,447 | `ce74862587c7e1d2739117b1e9ddd9b5b9f0cf9792b6b11384562ff17418c00f` |
| `7fy_kamihanki_ene_hojyokin.pdf` | 1 | 7 | 7 | 328,524 | `180418f0fb261b099fcb2e1ecfcd85a824f67dc02296383c446fa61fbc653aea` |
| `7fy_kamihanki_ippan_hojyokin.pdf` | 9 | 16, 18, 18, 18, 18, 18, 18, 18, 8 | 150 | 1,254,376 | `c2a41fa686221930adf7b29d8a22ab88ffe7964d3f07c2c3c5378814081c1d44` |
| `7fy_kamihanki_dengen_kofukin.pdf` | 5 | 20, 21, 21, 21, 1 | 84 | 634,457 | `baf620845a34e7ee07eafeee85d72f95bff81f0b52c2ecce1b827b21082f5977` |
| `7fy_kamihanki_tokkyo_hojyokin.pdf` | 1 | 13 | 13 | 309,920 | `27bb2321a06c2207e3e211d7d7e4d3b23d4e49570a357489a40e7e816c2ce3bb` |
| `7fy_shimohanki_ene_kofukin.pdf` | 1 | 1 | 1 | 126,011 | `325696d4f8c12a251479b1a26556c9bb4e5a5d976dffb2bf40d3d6301ea280c4` |
| `7fy_shimohanki_ippan_hojyokin.pdf` | 1 | 8 | 8 | 151,174 | `61fe23dcb1a7bb69b58f6e0c1874a584adce6c4f3073054981f39f5519142014` |
| `7fy_shimohanki_dengen_kofukin.pdf` | 1 | 2 | 2 | 136,087 | `e6f1cd81a624122b3ba82feb4fa7d12cb438277579ab72e87882aa935a463e69` |
| 合計 | 21 | — | 284 | 3,183,996 | 資料別receiptを使用 |

8原本はすべて文字PDFであり、OCRは使用していない。PDF magic、bytes、SHA-256、ページ寸法、全ページの位置付き文字要素数、ページ別掲載行数、1から末尾までの掲載番号、見出しの一意座標、令和日付の対象期間、金額文字列を同時に検証する。複数ページ資料は初頁にしか見出しがないため、資料定義が `headersOnFirstPageOnly: true` の場合だけ、初頁で検証した固定列境界を後続ページに再利用する。別レイアウト、OCR画像、行数変化、列ずれはfail closedとなる。

## 関東以外の残るPDF局

次の公式目次起点は確認したが、このwaveでは資料ごとのindex href inventory、Full GET receipt、座標schemaの三点が揃っていないため本番定義を追加していない。

| 局 | 確認した公式目次起点 | 本番取込しない理由 |
|---|---|---|
| 中部経済産業局 | `https://www.chubu.meti.go.jp/a41kaikei/kouhyou/index.html` | WARP再生の連続取得が403となり、全href inventoryと資料別receiptが未完了 |
| 近畿経済産業局 | `https://www.kansai.meti.go.jp/nyuusatu.html`、`https://www.kansai.meti.go.jp/8kaikei/hojokin/koukai.html` | 契約は区分別子目次の走査が必要で、全href inventoryと資料別receiptが未完了 |
| 九州経済産業局 | `https://www.kyushu.meti.go.jp/under/chotatu/chotatu.html`、`https://www.kyushu.meti.go.jp/support2/hojokin_kaizi.html` | 年度別子目次の走査と資料別receiptが未完了 |

未完了資料は「0件」でも「収録済み」でもない。公式index hrefが得られていないURLを命名規則から補完せず、OCRや列位置の推測で行を作らない。

## Fail-closed 条件

候補パーサーは次を満たさない資料を公開行に変換しない。

- UTF-8/Shift_JIS の明示と厳密復号
- HTML文書シグネチャとWAF/エラーページ除外
- 執行機関・年度・契約区分を示す見出し
- 資料ごとに固定した列数、列位置、必須見出し
- `rowspan`/`colspan` を解決した後の内部欠損なし
- 事業名、相手方、日付、掲載額文字列の必須値
- 契約日/交付決定日が資料の年度内（月別資料は対象月内）
- 公式原本URLを用いた安定ID（保存・配信URLへの変更でIDを変えない）
- PDFについては、原本bytes/SHA-256、ページ寸法・ページ数、位置付き文字要素数、ページ別行数、掲載番号範囲の完全一致

## 意味上の境界

この系列は公式資料に掲載された「契約金額欄の掲載値」と「交付決定額欄の掲載値」であり、GビズINFO系列とは合算しない。実支払、額の確定、返納、再委託・下請、基金や所管法人からの下流支出、間接補助先・最終受益者は網羅しない。

## 残る128候補の公開ゲート

次を完了するまで残る128候補を本番取込へ接続しない。

1. 候補ごとのFull GETとSHA-256・bytes receiptの保存
2. 候補ごとのstrict parseと資料別行数receipt
3. WAF challenge時に更新時間を長大化させない、間隔・再試行・前回検証済み資料継続の設計
4. 初回候補行の重複、年度、法人番号、金額raw/null、ID集合の全件検証
5. FY2026年度途中と、目次にリンクのない年度・月をUIで明示
