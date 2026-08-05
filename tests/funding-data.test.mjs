import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const data = JSON.parse(
  await readFile(new URL("../data/funding-data.json", import.meta.url), "utf8"),
);

test("keeps review-sheet programs, payments, and commitments as separate series", () => {
  assert.ok(Array.isArray(data.reviewPrograms));
  assert.ok(Array.isArray(data.reviewPayments));
  assert.ok(Array.isArray(data.records));
  assert.ok(data.reviewPrograms.length > 0);
  assert.ok(data.reviewPayments.length > 0);
});

test("loads every official review-sheet CSV year and records source coverage", () => {
  assert.deepEqual(data.coverage.reviewPayments.reviewSheetYears, [2024, 2025]);
  assert.deepEqual(data.coverage.reviewPayments.fiscalYears, [2023, 2024]);
  assert.deepEqual(data.coverage.commonFiscalYears, [2023, 2024]);
  assert.deepEqual(data.coverage.migratedReviewSheetYears, [2021, 2022, 2023]);
  assert.ok(data.reviewPayments.some((row) => row.reviewSheetYear === 2024));
  assert.ok(data.reviewPayments.some((row) => row.reviewSheetYear === 2025));
  assert.ok(data.reviewPayments.every((row) => row.fiscalYear === row.reviewSheetYear - 1));
});

test("classifies every record into exactly one flow layer", () => {
  const levels = new Set(["recipient", "intermediary", "unclassified"]);
  for (const row of [...data.reviewPayments, ...data.records]) {
    assert.ok(levels.has(row.flowLevel), `${row.id}: ${row.flowLevel}`);
  }
});

test("identifies NEDO as an intermediary and preserves its downstream recipients", () => {
  const nedoNumber = "2020005008480";
  const nedoRows = data.reviewPayments.filter((row) => row.corporateNumber === nedoNumber);
  assert.ok(nedoRows.length > 0);
  assert.ok(nedoRows.every((row) => row.flowLevel === "intermediary"));

  const downstream = data.reviewPayments.filter((row) =>
    row.flowLevel === "recipient" &&
    row.route.slice(0, -1).some((node) => /NEDO|新エネルギー・産業技術総合開発機構/.test(node)),
  );
  assert.ok(downstream.length > 0);
});
