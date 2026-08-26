import { readFile, writeFile } from "node:fs/promises";

const path = "docs/MISREADING_CATALOG.md";
let source = await readFile(path, "utf8");

function replaceOnce(search, replacement, label) {
  const index = source.indexOf(search);
  if (index < 0) throw new Error(`${label}: target not found`);
  if (source.indexOf(search, index + search.length) >= 0) throw new Error(`${label}: target is not unique`);
  source = `${source.slice(0, index)}${replacement}${source.slice(index + search.length)}`;
}

replaceOnce(
  "| M-003 | 金額・集計 | GビズINFOの補助金掲載額は行をまたいで足せる | 高 | 企業カード、年度別、事業別、検索サマリー | 補助金は合計を表示せず、個別明細だけ表示 | `pages-site/company-search-ui.ts`, `pages-site/subsidy-semantics-ui.ts` | `tests/subsidy-semantics-ui.test.mjs`, `tests/company-search-runtime.test.mjs` | MITIGATED |",
  "| M-003 | 金額・集計 | GビズINFOの補助金掲載額を、同一交付の再掲候補を含んだまま行間合算してよい | 高 | 企業カード、年度別、事業別、検索サマリー | 同一法人番号・同一公表組織内で、同一または近似した事業名、掲載額差±0.1%、事業年度表記または認定日の整合を満たす行を重複掲載候補としてグループ化し、代表1行だけを重複除外後掲載額へ算入する。除外件数・除外額を数字の直下に表示し、全明細は削除せず保持する | `scripts/gbiz-subsidy-dedup.mjs`, `scripts/company-search.mjs`, `app/funding-search.worker.ts`, `app/page.tsx`, `pages-site/company-search-ui.ts`, `pages-site/subsidy-semantics-ui.ts`, `app/DataReadingGuide.tsx` | `tests/gbiz-subsidy-dedup.test.mjs`, `tests/company-search-realdata.test.mjs`, `tests/company-search-runtime.test.mjs`, `tests/subsidy-semantics-ui.test.mjs`, `tests/misreading-catalog.test.mjs` | MITIGATED |",
  "M-003",
);

replaceOnce(
  "| M-005 | 時点・年度 | 年度別件数＝実際の補助金額・採択件数の推移 | 高 | GビズINFO年度フィルタ・年度別表示 | 年度指定時に認定日空欄の除外件数を警告し、補助金額は年度別合計しない | `pages-site/subsidy-semantics-ui.ts`, `pages-site/company-search-ui.ts` | `tests/subsidy-semantics-ui.test.mjs` | MITIGATED |",
  "| M-005 | 時点・年度 | 年度別件数・重複除外後掲載額＝実際の補助金額・採択件数の推移 | 高 | GビズINFO年度フィルタ・年度別表示 | 年度指定時に認定日空欄の除外件数を警告する。重複掲載候補グループの金額は代表行の認定日年度にだけ算入し、年度別表示が実際の資金額・採択件数の推移ではないことをその場で示す | `pages-site/subsidy-semantics-ui.ts`, `pages-site/company-search-ui.ts`, `scripts/gbiz-subsidy-dedup.mjs` | `tests/subsidy-semantics-ui.test.mjs`, `tests/gbiz-subsidy-dedup.test.mjs` | MITIGATED |",
  "M-005",
);

replaceOnce(
  "| M-018 | UI失敗時 | 補助金サマリーの互換ガードが壊れたとき、未修正の合計値がそのまま見える | 高 | GビズINFO検索サマリー | 契約検証が完了するまでサマリー行を非表示にし、成功時だけ表示するfail-closed設計 | `pages-site/subsidy-semantics-ui.ts`, `pages-site/subsidy-semantics-ui.css` | `tests/subsidy-semantics-ui.test.mjs` | MITIGATED |",
  "| M-018 | UI失敗時 | 補助金サマリーの互換ガードが壊れたとき、重複未除外の合計値がそのまま見える | 高 | GビズINFO検索サマリー | 「重複除外後の掲載値」という表示契約を検証できるまでサマリー行を非表示にし、重複除外件数・金額を含む契約が成立した場合だけ表示するfail-closed設計 | `pages-site/subsidy-semantics-ui.ts`, `pages-site/subsidy-semantics-ui.css` | `tests/subsidy-semantics-ui.test.mjs` | MITIGATED |",
  "M-018",
);

const m028 = "| M-028 | 0件・欠落 | 「GビズINFO欠落補足」として収録した公式行が、実際にはGビズINFOにも同一案件として存在する | 高 | 企業検索の公式補足（欠落補足を宣言するソース） | 欠落を収録条件にするソースは `gbizAbsenceRequired: true` を宣言し、その全レコードを法人番号・年度・正規化した案件名でGビズINFO同年度と年度不明収録に照合する。法人番号等がなく検証不能な行、または同一案件候補がある更新はfail-closedで公開しない | `scripts/official-gbiz-gap-audit.mjs`, `scripts/rieti-official-supplement.mjs`, `data/official-supplement-rieti.json` | `tests/official-supplement.test.mjs` | MITIGATED |";
replaceOnce(
  m028,
  m028 + "\n| M-029 | 金額・集計 | 自動判定で重複掲載候補になった行は、必ず同一の交付・決定なので確定的に削除できる | 高 | GビズINFO企業カード、年度別、事業別、明細 | GビズINFO全件CSVには安定した交付ID・状態遷移IDがないため重複判定は確定ではない。判定条件、除外件数・除外額をその場で表示し、原明細を削除せず「重複掲載候補として集計から除外」と明示して全行を確認できるようにする | `scripts/gbiz-subsidy-dedup.mjs`, `pages-site/company-search-ui.ts`, `app/DataReadingGuide.tsx` | `tests/gbiz-subsidy-dedup.test.mjs`, `tests/company-search-runtime.test.mjs`, `tests/subsidy-semantics-ui.test.mjs` | INHERENT |",
  "M-029 insertion",
);

replaceOnce(
  "- **その場に残す**：数字の代わりに表示する `合計しません`、年度指定時の警告、候補展開時の非合算表示など、操作と不可分な表示。",
  "- **その場に残す**：重複候補除外後の数字と対になる除外件数・除外額、年度指定時の警告、候補展開時の非合算表示など、操作と不可分な表示。",
  "annotation placement",
);

await writeFile(path, source);
console.log("Updated M-003, M-005, M-018 and added M-029 before implementation.");
