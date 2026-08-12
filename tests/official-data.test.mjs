import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ExcelJS from "exceljs";

import {
  OFFICIAL_DOCUMENTS,
  assertOfficialContinuity,
  parseOfficialWorkbook,
} from "../scripts/update-official-data.mjs";

const manifest = JSON.parse(await readFile(new URL("../data/official/manifest.json", import.meta.url), "utf8"));
const records = (await Promise.all(Object.values(manifest.files).map(async (filename) =>
  JSON.parse(await readFile(new URL(`../data/official/${filename}`, import.meta.url), "utf8"))))).flat();

test("publishes a reconciled set of verified 2025 official rows without mixing amount stages", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(records.length, manifest.recordCount);
  assert.equal(new Set(records.map((row) => row.id)).size, records.length);
  assert.equal(new Set(records.map((row) => row.sourceKey)).size, records.length);
  assert.deepEqual(manifest.seriesCounts, countBy(records, (row) => row.category));
  assert.equal(manifest.sourceDocuments.reduce((sum, source) => sum + source.records, 0), records.length);
  const executorCounts = countBy(records, (row) => row.executorId);
  for (const [executorId, coverage] of Object.entries(manifest.coverage.executors)) {
    assert.equal(
      coverage.contractResults.records + coverage.grantDecisions.records,
      executorCounts[executorId],
      `${executorId} coverage must be derived from published rows`,
    );
  }
  assert.ok(records.every((row) => row.fiscalYear === 2025));
  assert.ok(records.every((row) => row.amountStage.includes(row.category === "contract_result" ? "契約" : "交付決定")));
  assert.ok(records.every((row) => row.program !== "事業名" && !row.program.includes("物品役務等の 名称及び数量")));
  assert.ok(records.every((row) => row.program !== "交付決定なし"));
  assert.ok(records.some((row) => row.corporateNumber === null && row.corporateNumberRaw));
  assert.ok(records.some((row) => row.notes.includes("単価")), "amount semantics in official notes must be preserved");
  assert.ok(records.some((row) => row.multiplePartyListing && row.corporateNumbers.length > 1));
  assert.equal(
    records.find((row) => row.datasetId === "jpo-2025-grant-decisions-h1" && row.dateRaw === "45757")?.date,
    "2025-04-10",
    "Excel serial dates must be converted to their displayed calendar date",
  );
});

test("binds every source workbook to a SHA, row count, and exact official URL", () => {
  assert.equal(OFFICIAL_DOCUMENTS.length, 7);
  assert.equal(manifest.sourceDocuments.length, 7);
  const receipts = new Map(manifest.sourceDocuments.map((item) => [item.id, item]));
  for (const document of OFFICIAL_DOCUMENTS) {
    const receipt = receipts.get(document.id);
    assert.ok(receipt, document.id);
    assert.equal(receipt.url, document.url);
    assert.match(receipt.sha256, /^[0-9a-f]{64}$/);
    assert.ok(receipt.bytes > 1_000);
    assert.ok(Number.isSafeInteger(receipt.records));
  }
  assert.equal(receipts.get("jpo-2025-grant-decisions-h2").records, 0);
  assert.equal(receipts.get("jpo-2025-grant-decisions-h2").emptySentinelFound, true);
});

test("parses an official contract sheet and preserves null, zero, raw, and provenance", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("4月競争（物品等）");
  sheet.addRow(["表題"]);
  sheet.addRow([]);
  sheet.addRow([
    "物品役務等の\n名称及び数量", "契約担当官等", "契約を締結\nした日",
    "契約の相手方の\n商号又は名称", "契約の相手方の\n法人番号", "住所",
    "一般競争入札・\n指名競争入札の別\n（総合評価の実施）", "予定価格\n（円）", "契約金額\n（円）", "落札率", "契約方式", "備考",
  ]);
  sheet.addRow(["案件A", "担当", "2025年4月1日", "法人A\n法人B", "1234567890123\n9876543210987", "住所", "一般競争", "非公表", 0, "", "総価", "注記"]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await parseOfficialWorkbook(buffer, {
    id: "fixture", executorId: "smea", executorName: "中小企業庁", fiscalYear: 2025,
    category: "contract_result", kind: "競争入札", amountStage: "契約額", sourcePageUrl: "https://example.test/", url: "https://example.test/a.xlsx",
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].amount, 0);
  assert.equal(parsed[0].corporateNumber, null);
  assert.match(parsed[0].corporateNumberRaw, /1234567890123/);
  assert.equal(parsed[0].sourceSheet, "4月競争（物品等）");
  assert.equal(parsed[0].sourceRowNumber, 4);
});

test("converts an unformatted Excel serial date without changing the raw evidence", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("7fy 4月-9月");
  sheet.addRow(["事業名", "交付先名", "法人番号", "交付決定額", "交付決定日"]);
  sheet.addRow(["補助事業", "法人A", "6010001030403", "2,940,000", 45_757]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const parsed = await parseOfficialWorkbook(buffer, {
    id: "fixture-grant", executorId: "jpo", executorName: "特許庁", fiscalYear: 2025,
    category: "grant_decision", kind: "補助金等の交付決定", amountStage: "交付決定額", sourcePageUrl: "https://example.test/", url: "https://example.test/a.xlsx",
  });
  assert.equal(parsed[0].date, "2025-04-10");
  assert.equal(parsed[0].dateRaw, "45757");
});

test("fails closed when a previously published official row disappears", () => {
  assert.throws(() => assertOfficialContinuity(records, records.slice(1)), /前回明細が消えました/);
  assert.doesNotThrow(() => assertOfficialContinuity(records, records));
});

test("tolerates row insertion and reordering only when prior semantics remain intact", () => {
  const moved = records.map((record, index) => ({
    ...record,
    id: `moved-${index}`,
    sourceKey: `${record.datasetId}:${record.sourceSheet}:${record.sourceRowNumber + 10}`,
    sourceRowNumber: record.sourceRowNumber + 10,
  })).reverse();
  const result = assertOfficialContinuity(records, moved);
  assert.equal(result.retained, records.length);
  assert.equal(result.added, 0);
  assert.equal(result.changed.length, 0);

  const identityChange = moved.map((record, index) => index === 0 ? { ...record, organization: "別法人" } : record);
  assert.throws(() => assertOfficialContinuity(records, identityChange), /前回明細が消えました|識別項目/);
});

function countBy(items, key) {
  return items.reduce((result, item) => {
    const value = key(item);
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
}
