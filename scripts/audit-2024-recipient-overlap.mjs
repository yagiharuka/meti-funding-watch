import { mkdir, readFile, writeFile } from "node:fs/promises";
import { hasValidCorporateNumber } from "./gbiz-values.mjs";

const funding = JSON.parse(await readFile("data/funding-data.json", "utf8"));
const reviewManifest = JSON.parse(await readFile("data/review-cache/manifest.json", "utf8"));
const reviewAll = (await Promise.all(
  reviewManifest.paymentFiles.map(async (filename) =>
    JSON.parse(await readFile(`data/review-cache/${filename}`, "utf8")),
  ),
)).flat();

const validCorp = (value) => {
  const v = String(value ?? "").replace(/\D/g, "");
  return v !== "9999999999999" && hasValidCorporateNumber(v);
};
const corp = (row) => String(row.corporateNumber ?? "").replace(/\D/g, "");
const positive = (value) => Number.isFinite(value) && value > 0 ? value : 0;

// GビズINFOの fiscalYear は認定日/受注日から日本の年度（4月〜翌3月）へ変換済み。
const gbizAllRows = (funding.records ?? []).filter((row) => validCorp(row.corporateNumber));
const gbiz2024Rows = gbizAllRows.filter((row) => row.fiscalYear === 2024);
const gbizUndatedRows = gbizAllRows.filter((row) => row.fiscalYear == null);

// 2025年度レビューシートは前年度（2024年度）の執行・支出先を収録。
const review2024Rows = reviewAll.filter(
  (row) => row.reviewSheetYear === 2025 && validCorp(row.corporateNumber),
);
const review2024TerminalRows = review2024Rows.filter(
  (row) => row.flowLevel === "terminal_in_disclosed_graph",
);

const setOf = (rows) => new Set(rows.map(corp));
const gbiz2024 = setOf(gbiz2024Rows);
const gbizAll = setOf(gbizAllRows);
const gbizUndated = setOf(gbizUndatedRows);
const review2024 = setOf(review2024Rows);
const reviewTerminal = setOf(review2024TerminalRows);

function compare(a, b) {
  const onlyA = [...a].filter((key) => !b.has(key));
  const onlyB = [...b].filter((key) => !a.has(key));
  const both = [...a].filter((key) => b.has(key));
  const union = new Set([...a, ...b]);
  return {
    onlyA,
    onlyB,
    both,
    counts: {
      onlyA: onlyA.length,
      onlyB: onlyB.length,
      both: both.length,
      union: union.size,
      a: a.size,
      b: b.size,
      overlapRateOfA: a.size ? both.length / a.size : null,
      overlapRateOfB: b.size ? both.length / b.size : null,
      jaccard: union.size ? both.length / union.size : null,
    },
  };
}

function namesByCorp(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = corp(row);
    if (!map.has(key) && row.organization) map.set(key, row.organization);
  }
  return map;
}

function amountsByCorp(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = corp(row);
    map.set(key, (map.get(key) ?? 0) + positive(row.amount));
  }
  return map;
}

const gbizNames = namesByCorp(gbizAllRows);
const reviewNames = namesByCorp(review2024Rows);
const gbizAmounts2024 = amountsByCorp(gbiz2024Rows);
const reviewAmounts2024 = amountsByCorp(review2024Rows);

function ranked(keys, amountMap, preferredNames, fallbackNames, n = 30) {
  return keys
    .map((key) => ({
      corporateNumber: key,
      organization: preferredNames.get(key) ?? fallbackNames.get(key) ?? "",
      amountSum: amountMap.get(key) ?? 0,
    }))
    .sort((a, b) => b.amountSum - a.amountSum || a.organization.localeCompare(b.organization, "ja"))
    .slice(0, n);
}

const allComparison = compare(gbiz2024, review2024);
const terminalComparison = compare(gbiz2024, reviewTerminal);

const reviewOnly = allComparison.onlyB;
const reviewOnlyBreakdown = {
  total: reviewOnly.length,
  existsSomewhereInGbizAllYears: reviewOnly.filter((key) => gbizAll.has(key)).length,
  hasUndatedGbizRecord: reviewOnly.filter((key) => gbizUndated.has(key)).length,
  absentFromGbizDatasetEntirely: reviewOnly.filter((key) => !gbizAll.has(key)).length,
};

const output = {
  generatedAt: new Date().toISOString(),
  basis: {
    gbiz: "GビズINFO収録レコードのうち、認定日/受注日から算出したfiscalYear=2024かつ有効な法人番号あり",
    review: "行政事業レビュー2025年度シート（2024年度執行）の支出先行のうち有効な法人番号あり",
    note: "GビズINFOの日付欠落レコードは2024年度集合に入らないため、レビューのみ法人についてGビズ全期間・年度不明の存在も別集計",
  },
  sourceRows: {
    gbiz2024Rows: gbiz2024Rows.length,
    gbiz2024UniqueCorporations: gbiz2024.size,
    gbizUndatedRowsWithValidCorporateNumber: gbizUndatedRows.length,
    gbizUndatedUniqueCorporations: gbizUndated.size,
    review2024RowsWithValidCorporateNumber: review2024Rows.length,
    review2024UniqueCorporations: review2024.size,
    review2024TerminalRowsWithValidCorporateNumber: review2024TerminalRows.length,
    review2024TerminalUniqueCorporations: reviewTerminal.size,
  },
  allReviewRecipientsComparison: allComparison.counts,
  terminalReviewRecipientsComparison: terminalComparison.counts,
  reviewOnlyBreakdown,
  topReviewOnlyBy2024ReviewAmount: ranked(reviewOnly, reviewAmounts2024, reviewNames, gbizNames),
  topGbizOnlyBy2024GbizAmount: ranked(allComparison.onlyA, gbizAmounts2024, gbizNames, reviewNames),
  topBothBy2024ReviewAmount: ranked(allComparison.both, reviewAmounts2024, reviewNames, gbizNames),
};

await mkdir("data/audits", { recursive: true });
await writeFile("data/audits/recipient-overlap-2024.json", `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
