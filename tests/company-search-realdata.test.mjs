import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  filterCompanyRecords,
  groupCompanyRecords,
  summarizeCompanyRows,
} from "../scripts/company-search.mjs";

async function loadAllRows() {
  const manifest = JSON.parse(await readFile(new URL("../data/pages/manifest.json", import.meta.url), "utf8"));
  const files = Object.values(manifest.commitments);
  const chunks = await Promise.all(files.map(async (filename) =>
    JSON.parse(await readFile(new URL(`../data/pages/${filename}`, import.meta.url), "utf8"))));
  return chunks.flat();
}

function summarizeGroups(rows) {
  return [...groupCompanyRecords(rows)].map(([corporateNumber, companyRows]) => {
    const summary = summarizeCompanyRows(companyRows);
    const stage = Object.fromEntries(summary.byStage.map((item) => [item.stage, {
      records: item.records,
      amountKnownCount: item.amountKnownCount,
      amount: item.amount,
    }]));
    return {
      corporateNumber,
      names: [...new Set(companyRows.map((row) => row.organization))].sort((a, b) => a.localeCompare(b, "ja")),
      records: summary.records,
      amountKnownCount: summary.amountKnownCount,
      amountUnknownCount: summary.amountUnknownCount,
      contracted: stage.contracted ?? { records: 0, amountKnownCount: 0, amount: 0 },
      subsidy_published: stage.subsidy_published ?? { records: 0, amountKnownCount: 0, amount: 0 },
    };
  }).sort((a, b) => b.records - a.records || a.corporateNumber.localeCompare(b.corporateNumber));
}

const rows = await loadAllRows();

test("exact company identities resolve to the expected corporate number in all published Gbiz years", () => {
  const cases = [
    ["日本電気", "7010401022916"],
    ["富士通", "1020001071491"],
    ["富士", "8040002102378"],
    ["三菱総合研究所", "6010001030403"],
    ["NTTデータ", "6010601062093"],
    ["NTT", "7010001065142"],
    ["デロイトトーマツ", "3010001076738"],
    ["みずほ銀行", "6010001008845"],
  ];

  for (const [query, expectedCorporateNumber] of cases) {
    const results = filterCompanyRecords(rows, { query });
    assert.ok(results.length > 0, `${query}: published Gbiz rows must exist`);
    assert.deepEqual(
      [...new Set(results.map((row) => row.corporateNumber))],
      [expectedCorporateNumber],
      `${query}: exact identity must not mix another corporation`,
    );
    const summary = summarizeCompanyRows(results);
    assert.equal(summary.amountKnownCount + summary.amountUnknownCount, summary.records, `${query}: amount row counts must reconcile`);
    assert.equal("amount" in summary, false, `${query}: no cross-category monetary total may exist`);
  }
});

test("ambiguous company terms remain separate corporate-number groups on real data", () => {
  const cases = [
    ["日本電", 2],
    ["三菱", 3],
    ["デロイト", 2],
    ["みずほ", 2],
  ];

  for (const [query, minimumGroups] of cases) {
    const results = filterCompanyRecords(rows, { query });
    const groups = groupCompanyRecords(results);
    assert.ok(groups.size >= minimumGroups, `${query}: expected at least ${minimumGroups} separate corporations, got ${groups.size}`);
    for (const companyRows of groups.values()) {
      assert.ok(companyRows.length > 0);
      assert.equal(new Set(companyRows.map((row) => row.corporateNumber)).size, 1, `${query}: one group must contain one corporate number`);
      const summary = summarizeCompanyRows(companyRows);
      assert.equal(summary.amountKnownCount + summary.amountUnknownCount, summary.records, `${query}: grouped amount row counts must reconcile`);
      assert.equal("amount" in summary, false, `${query}: grouped summary must not create a cross-category total`);
    }
  }
});

test("real-data corporate-number searches are exact", () => {
  for (const corporateNumber of [
    "7010401022916",
    "1020001071491",
    "8040002102378",
    "6010001030403",
    "6010601062093",
    "7010001065142",
    "3010001076738",
    "6010001008845",
  ]) {
    const results = filterCompanyRecords(rows, { query: corporateNumber });
    assert.ok(results.length > 0, `${corporateNumber}: published rows must exist`);
    assert.ok(results.every((row) => row.corporateNumber === corporateNumber));
  }
});

test("emit a cross-company audit summary for the publication log", () => {
  const queries = [
    "日本電気", "日本電", "富士通", "富士", "三菱総合研究所", "三菱",
    "NTTデータ", "NTT", "デロイトトーマツ", "デロイト", "みずほ銀行", "みずほ",
  ];
  const audit = Object.fromEntries(queries.map((query) => [query, summarizeGroups(filterCompanyRecords(rows, { query }))]));
  console.log(`COMPANY_SEARCH_REALDATA_AUDIT=${JSON.stringify(audit)}`);
});
