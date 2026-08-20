import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reconciliation = JSON.parse(
  await readFile(new URL("../data/official-reconciliation.json", import.meta.url), "utf8"),
);
const officialRows = JSON.parse(
  await readFile(new URL("../data/official/records-2022.json", import.meta.url), "utf8"),
);
const gbizRows = JSON.parse(
  await readFile(new URL("../data/pages/commitments-2022.json", import.meta.url), "utf8"),
);
const pageSource = await readFile(new URL("../app/official/page.tsx", import.meta.url), "utf8");
const fundingPageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const workerSource = await readFile(new URL("../app/funding-search.worker.ts", import.meta.url), "utf8");
const sourceRegistry = JSON.parse(
  await readFile(new URL("../data/official-source-registry.json", import.meta.url), "utf8"),
);

test("publishes the reviewed Chubu FY2022 first-50 and last-50 reconciliations", () => {
  assert.equal(reconciliation.schemaVersion, 1);
  assert.equal(reconciliation.comparisons.length, 2);
  const first = reconciliation.comparisons.find(({ id }) => id === "chubu-2022-h1-first-50");
  const last = reconciliation.comparisons.find(({ id }) => id === "chubu-2022-h1-last-50");
  assert.ok(first);
  assert.ok(last);
  assert.equal(first.executorName, "中部経済産業局");
  assert.equal(first.periodLabel, "令和4年度上期");
  assert.equal(first.sampleDefinition, "機関公表資料の掲載順先頭50行");
  assert.equal(first.attemptedCount, 50);
  assert.deepEqual(first.counts, {
    matched: 44,
    amountMismatch: 4,
    oneSided: 2,
    unresolvable: 0,
  });
  assert.equal(last.executorName, "中部経済産業局");
  assert.equal(last.periodLabel, "令和4年度上期");
  assert.equal(last.sampleDefinition, "機関公表資料の掲載順末尾50行（全165行の116〜165行）");
  assert.equal(last.attemptedCount, 50);
  assert.deepEqual(last.counts, {
    matched: 48,
    amountMismatch: 0,
    oneSided: 2,
    unresolvable: 0,
  });
  for (const comparison of reconciliation.comparisons) {
    assert.equal(comparison.items.length, comparison.attemptedCount);
    assert.equal(
      Object.values(comparison.counts).reduce((sum, value) => sum + value, 0),
      comparison.attemptedCount,
    );
  }
  assert.match(last.items.find(({ sequence }) => sequence === 160)?.note ?? "", /原典記載の法人番号/);
});

test("ties every reconciliation item to retained source data", () => {
  const officialById = new Map(officialRows.map((row) => [row.id, row]));
  const gbizById = new Map(gbizRows.map((row) => [row.id, row]));
  const officialIds = new Set();
  const gbizIds = new Set();

  for (const comparison of reconciliation.comparisons) {
    for (const item of comparison.items) {
      const official = officialById.get(item.officialRecordId);
      assert.ok(official, `missing official row: ${item.officialRecordId}`);
      assert.equal(official.sourceKey, item.officialSourceKey);
      assert.equal(official.amount, item.officialAmount);
      assert.equal(official.sourceDocumentUrl, comparison.sourceDocumentUrl);
      assert.equal(item.sequence, official.sourceRowNumber);
      assert.equal(officialIds.has(item.officialRecordId), false);
      officialIds.add(item.officialRecordId);

      if (item.gbizRecordId === null) {
        assert.equal(item.status, "one_sided");
        assert.equal(item.gbizAmount, null);
        continue;
      }
      const gbiz = gbizById.get(item.gbizRecordId);
      assert.ok(gbiz, `missing Gbiz row: ${item.gbizRecordId}`);
      assert.equal(gbiz.amount, item.gbizAmount);
      assert.equal(gbiz.fiscalYear, comparison.fiscalYear);
      assert.equal(gbizIds.has(item.gbizRecordId), false);
      gbizIds.add(item.gbizRecordId);
      if (item.status === "matched") assert.equal(item.officialAmount, item.gbizAmount);
      if (item.status === "amount_mismatch") assert.notEqual(item.officialAmount, item.gbizAmount);
    }
  }
});

test("labels the denominator, unreviewed scope, and row-level evidence without amount totals", () => {
  for (const required of [
    "機関公表資料との照合の記録",
    "照合を試みた件数",
    "一致",
    "額が不一致",
    "片側のみ",
    "照合不能",
    "未照合",
    "原典PDF",
    "GビズINFO掲載行",
  ]) assert.match(pageSource, new RegExp(required));

  assert.doesNotMatch(pageSource, /収録率|網羅|カバレッジ/);
  assert.doesNotMatch(pageSource, /合計額|金額合計|総額/);
  assert.match(pageSource, /comparison\.sourceDocumentUrl/);
  assert.match(pageSource, /#\$\{item\.gbizRecordId\}/);
  assert.match(fundingPageSource, /<tr key=\{row\.id\} id=\{row\.id\}>/);
  assert.match(fundingPageSource, /row\.id/);
  assert.match(fundingPageSource, /row\.sourceKey/);
  assert.match(workerSource, /row\.id.*row\.sourceKey/);
});

test("renders an explicit institution-by-year review plan with every other cell unreviewed", () => {
  assert.deepEqual(reconciliation.reviewPlan.fiscalYears, [2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026]);
  assert.match(reconciliation.reviewPlan.note, /母集団や収録対象範囲を表すものではない/);
  assert.match(pageSource, /sourceRegistry\.executors\.map/);
  assert.match(pageSource, /reviewPlanYears\.map/);
  assert.match(pageSource, /一部照合/);
  assert.match(pageSource, /未照合/);
  assert.equal(sourceRegistry.executors.length * reconciliation.reviewPlan.fiscalYears.length, 96);
  assert.equal(reconciliation.comparisons.length, 2);
});

test("keeps the Gbiz partiality and corporate-number limitation visible", () => {
  assert.match(fundingPageSource, /GビズINFOに法人番号付きで掲載された/);
  assert.match(fundingPageSource, /経済産業省の全支出・実支払を示すものではありません/);
  assert.match(fundingPageSource, /正確性・完全性・最新性を保証しません/);
});
