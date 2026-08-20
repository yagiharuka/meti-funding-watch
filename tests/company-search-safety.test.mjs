import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  filterCompanyRecords,
  groupCompanyRecords,
  normalizeCompanySearchTerm,
  resolveCompanyNumbers,
  summarizeCompanyRows,
} from "../scripts/company-search.mjs";

function row({
  id,
  organization,
  corporateNumber,
  stage = "contracted",
  amount = 100,
  sourceAgency = "経済産業省",
  fiscalYear = 2026,
  program = "テスト事業",
}) {
  return {
    id,
    organization,
    corporateNumber,
    stage,
    amount,
    sourceAgency,
    fiscalYear,
    program,
  };
}

const fixture = [
  row({ id: "nec-1", organization: "日本電気株式会社", corporateNumber: "7010401022916", amount: 300 }),
  row({ id: "nec-2", organization: "日本電気株式会社", corporateNumber: "7010401022916", stage: "subsidy_published", amount: 200 }),
  row({ id: "nec-3", organization: "日本電気株式会社", corporateNumber: "7010401022916", amount: null, fiscalYear: null }),
  row({ id: "glass-1", organization: "日本電気硝子株式会社", corporateNumber: "5160001001877", amount: 700 }),
  row({ id: "assoc-1", organization: "一般社団法人日本電気協会", corporateNumber: "8010005004319", amount: 900 }),
  row({ id: "old-1", organization: "旧テスト株式会社", corporateNumber: "1111111111111", amount: 10, fiscalYear: 2025 }),
  row({ id: "new-1", organization: "新テスト株式会社", corporateNumber: "1111111111111", amount: 20, fiscalYear: 2026 }),
  row({ id: "other-1", organization: "株式会社別会社", corporateNumber: "2222222222222", amount: 30 }),
];

test("name search resolves matching corporations first and never merges their money", () => {
  const results = filterCompanyRecords(fixture, { query: "日本電気" });
  const groups = groupCompanyRecords(results);

  assert.deepEqual([...groups.keys()].sort(), [
    "5160001001877",
    "7010401022916",
    "8010005004319",
  ]);
  assert.equal(groups.get("7010401022916").length, 3);
  assert.equal(groups.get("5160001001877").length, 1);
  assert.equal(groups.get("8010005004319").length, 1);

  const nec = summarizeCompanyRows(groups.get("7010401022916"));
  const glass = summarizeCompanyRows(groups.get("5160001001877"));
  const association = summarizeCompanyRows(groups.get("8010005004319"));

  assert.equal(nec.records, 3);
  assert.equal(glass.records, 1);
  assert.equal(association.records, 1);
  assert.equal(nec.byStage.find((item) => item.stage === "contracted").amount, 300);
  assert.equal(glass.byStage[0].amount, 700);
  assert.equal(association.byStage[0].amount, 900);
  assert.notEqual(nec.byStage.find((item) => item.stage === "contracted").amount, 1_900);
});

test("13-digit corporate number search is exact", () => {
  const results = filterCompanyRecords(fixture, { query: "7010401022916" });
  assert.equal(results.length, 3);
  assert.ok(results.every((item) => item.corporateNumber === "7010401022916"));
  assert.equal(filterCompanyRecords(fixture, { query: "701040102291" }).length, 0);
});

test("name normalization handles Japanese corporate designators and width differences", () => {
  assert.equal(normalizeCompanySearchTerm("㈱ 日本 電気"), "株式会社日本電気");
  assert.equal(normalizeCompanySearchTerm("(有) テスト"), "有限会社テスト");
  assert.deepEqual(
    [...resolveCompanyNumbers(fixture, "㈱日本電気")],
    ["7010401022916"],
  );
});

test("once a corporate number is identified, old/new names for that number stay together", () => {
  const oldNameResults = filterCompanyRecords(fixture, { query: "旧テスト" });
  assert.deepEqual(oldNameResults.map((item) => item.id).sort(), ["new-1", "old-1"]);
  assert.ok(oldNameResults.every((item) => item.corporateNumber === "1111111111111"));
});

test("agency, category, and year filters are applied after corporate identification", () => {
  const filtered = filterCompanyRecords(fixture, {
    query: "日本電気",
    stage: "subsidy_published",
    year: "2026",
    agency: "経済産業省",
  });
  assert.deepEqual(filtered.map((item) => item.id), ["nec-2"]);
});

test("known plus unknown amount rows always equals the corporation record count", () => {
  const necRows = filterCompanyRecords(fixture, { query: "7010401022916" });
  const summary = summarizeCompanyRows(necRows);
  assert.equal(summary.amountKnownCount + summary.amountUnknownCount, summary.records);
  assert.equal(summary.amountKnownCount, 2);
  assert.equal(summary.amountUnknownCount, 1);
  assert.equal(summary.byStage.find((item) => item.stage === "contracted").amount, 300);
  assert.equal(summary.byStage.find((item) => item.stage === "subsidy_published").amount, 200);
});

test("a zero Gbiz match is a finite empty result, not a special failure", () => {
  const results = filterCompanyRecords(fixture, { query: "Gビズに存在しない法人" });
  assert.deepEqual(results, []);
});

test("all three runtime search paths import the same shared matcher", async () => {
  const [page, worker, enhancedWorker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/funding-search.worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../pages-site/funding-search-enhanced.worker.js", import.meta.url), "utf8"),
  ]);
  for (const source of [page, worker, enhancedWorker]) {
    assert.match(source, /filterCompanyRecords/);
    assert.doesNotMatch(source, /row\.id} \$\{row\.sourceKey/);
  }
});

test("Pages build contains the stable company-search mount and no mixed Gbiz total label", async () => {
  const { readdir } = await import("node:fs/promises");
  const assets = (await readdir(new URL("../dist-pages/assets/", import.meta.url)))
    .filter((name) => name.endsWith(".js"));
  const javascript = (await Promise.all(assets.map((name) =>
    readFile(new URL(`../dist-pages/assets/${name}`, import.meta.url), "utf8")))).join("\n");
  assert.match(javascript, /company-search-mount/);
  assert.match(javascript, /GビズINFOでは一致する法人を確認できませんでした/);
  assert.doesNotMatch(javascript, /GビズINFO掲載値合計/);
});
