# 沖縄総合事務局（経済産業部）公式資料監査

基準日: 2026-08-12

## 結論

- 明細検索に追加するのは、経済産業部の公式索引からリンクされた FY2020～FY2024 の「補助金等の交付決定」上期・下期PDF（10資料、194掲載行）だけです。
- 契約結果は追加しません。公式契約XLSXは沖縄総合事務局全体の資料で、行の「契約担当官等」欄は総務部長または農業水利事業所等を示し、経済産業部を識別する公式の行単位項目がありません。
- 契約件名のキーワードから経済産業部案件を推測したり、庁舎・情報システム等の共通調達を経済産業部に配賦したりしません。
- PDFは位置付き文字だけを用い、OCR・曖昧な列推定・欠損値補完を行いません。原資料に法人番号欄がないため、法人番号は空のままです。
- 金額は交付決定額欄の掲載値であり、額の確定・実支払・返納・間接補助先を示しません。

## 公式入口と対象範囲

### 補助金等の交付決定

公式索引: <https://www.ogb.go.jp/keisan/3842/saitaku/f_03/014671>

索引は経済産業部配下にあり、各PDFの表題にも「沖縄総合事務局経済産業部」と明記されています。この二重の明示を機関帰属の条件にしました。

| 年度 | 上期 | 下期 | 掲載行 |
|---|---:|---:|---:|
| FY2020 | 28 | 5 | 33 |
| FY2021 | 31 | 6 | 37 |
| FY2022 | 25 | 7 | 32 |
| FY2023 | 33 | 4 | 37 |
| FY2024 | 50 | 5 | 55 |
| 合計 | 167 | 27 | 194 |

| 年度・期 | 公式原本 | バイト | SHA-256 | ページ | 掲載行 |
|---|---|---:|---|---:|---:|
| FY2020 上期 | [PDF](https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R2FY_firsthojokin.pdf) | 108,326 | `c182f5cf85254d2424747f91cd69d7a3c88a893373fb49e0537b2dc5a654cd5d` | 2 | 28 |
| FY2020 下期 | [PDF](https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R2FY_secondhojokin.pdf) | 53,923 | `dc24e2fff65eaded675c7aba2b7ffd578c44fc172f62003adadc66e633a5bb96` | 1 | 5 |
| FY2021 上期 | [PDF](https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R3FY_firsthojokin.pdf) | 110,618 | `74971b12885357a571388830d94db67468689ed1a17103d9d6ba28adaa9f4c4e` | 2 | 31 |
| FY2021 下期 | [PDF](https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R3FY_secondhojokin.pdf) | 63,004 | `7f55f283f65afc032aefca9117df4909fff3d24d2d40e653e72f0a2f39ac4a26` | 1 | 6 |
| FY2022 上期 | [PDF](https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R4FY_firsthojokin.pdf) | 104,738 | `b79cd33aa2bf522a1e2f5ad37a8a357495568b6184d06d41760a9dc4bef97a4c` | 2 | 25 |
| FY2022 下期 | [PDF](https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R4FY_secondhojokin.pdf) | 64,538 | `32e3590adc88633dd2e3552941741ab73b33e390018cc53de2fd189806f284df` | 1 | 7 |
| FY2023 上期 | [PDF](https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R5FY_firsthojokin.pdf) | 117,264 | `5e1ed7c256f4f57f9db8322e1c6a9992f9c1f55ded9b2f809172bba7eda57182` | 2 | 33 |
| FY2023 下期 | [PDF](https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R5FY_secondhojokin.pdf) | 64,242 | `562de00f1a444a5c52ff29871d7e7f7d1f3ad00663e94dbd4ec47a43ceb9b596` | 1 | 4 |
| FY2024 上期 | [PDF](https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/hojyokin/R6FY_firsthojokin.pdf) | 123,539 | `f3fe7a90bcaebede65918f5a4b78fe0cdd076e06459450f112b79c87217b1282` | 3 | 50 |
| FY2024 下期 | [PDF](https://www.ogb.go.jp/-/media/Files/OGB/Keisan/move/kobo/250514_01/R6FY_secondhojokin.pdf) | 64,198 | `9b398d26392853946c6ffe00ecc9e8754a3f9a6e1ec0b9769575a3c27ce2b815` | 1 | 5 |

各資料はURL、PDF magic、バイト数、SHA-256、ページ数、ページ別掲載行数、位置付き文字要素数、掲載番号の連続範囲を固定しています。いずれかが変われば、その資料だけを明示的な失敗として隔離します。

### 契約結果

公式索引: <https://www.ogb.go.jp/soumu/soumu_tyouta.html>

索引本文は「沖縄総合事務局総務部契約に係る情報」として公表しています。リンクされたXLSXは公共工事・物品役務等を含む総合事務局全体の4シートです。

| 索引表示 | URL末尾 | バイト | SHA-256 | 実データ年度 | 明細行 | 担当官欄に「経済産業部」 |
|---|---|---:|---|---|---:|---:|
| 令和4年度 | [`kouhyou0331.xlsx`](https://www.ogb.go.jp/-/media/Files/OGB/Soumu/choutatu/futan1/kouhyou0331.xlsx) | 59,335 | `3086a74788802391c7af1eaf2da2b2a80b41f08ac7d6bd5576948075b4666703` | FY2022 | 235 | 0 |
| 令和5年度 | [`01kouhyou0415.xlsx`](https://www.ogb.go.jp/-/media/Files/OGB/Soumu/choutatu/futan2/01kouhyou0415.xlsx) | 59,788 | `9b5a93755059640f39dabf341f037636edd4ac73cc62762f03fee5b3e796f6f7` | FY2023 | 200 | 0 |
| 令和6年度 | [`kouhyou0331-e.xlsx`](https://www.ogb.go.jp/-/media/Files/OGB/Soumu/choutatu/futan1/kouhyou0331-e.xlsx) | 61,744 | `cf88069d4ce507687b3a99372776bf7f4fe1e47c9dfaf573edfe8f619d716ef2` | FY2024 | 220 | 0 |
| 令和7年度 | [`xlsxkouhyouR80607.xlsx`](https://www.ogb.go.jp/-/media/Files/OGB/Soumu/choutatu/shinsa/xlsxkouhyouR80607.xlsx) | 44,883 | `98a0cc6359b0f8d8e2cd719bb3a0c07590c33c1745cdace02dc0fe40a91f949e` | FY2026 | 137 | 0 |

契約件名に「経済産業部」と明記された少数行はありますが、同じ担当官欄を持つ経済産業施策らしい別行が多数あります。件名文字列の有無を分類器にすると偽陰性・偽陽性を避けられないため採用しません。

## 令和7年度の反証

- 交付決定の公式索引は基準日時点で令和6年度までです。FY2025（令和7年度）の統合上期・下期資料は索引にリンクされていません。予測URLは公式発見根拠にしません。
- 契約索引には「令和7年度」リンクがありますが、リンク先XLSXの契約日はすべてFY2026で、FY2025行はありません。索引ラベルだけを根拠にFY2025資料として扱うと年度誤分類になります。
- 個別の公募・採択・契約公表ページが存在しても、統合表と同じ分母・金額段階・重複関係を検証できないため、この統合明細には混ぜません。

## 共通調達

総合庁舎、ネットワーク、Microsoft 365、新聞、清掃等は複数部門に利用され得ますが、原資料に部門別負担額や配賦キーがありません。したがって、経済産業部の契約・支出として全額または按分額を計上しません。これは0件の主張ではなく、「行単位に帰属を証明できないため未収録」です。
