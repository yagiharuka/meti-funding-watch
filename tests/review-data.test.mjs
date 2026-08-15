import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../data/review-cache/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));

test("publishes administrative review as an isolated verified series", async () => {
  assert.equal(manifest.schemaVersion, 3);
  assert.match(manifest.sourceUrl, /^https:\/\//);
  assert.ok(Array.isArray(manifest.reviewSheetYears) && manifest.reviewSheetYears.length > 0);
  assert.ok(Array.isArray(manifest.sourceReceipts) && manifest.sourceReceipts.length >= manifest.reviewSheetYears.length * 4);
  assert.equal(manifest.programsFile, "programs.json");
  assert.ok(manifest.paymentFiles.every((name) => /^payments-[0-9a-f]\.json$/.test(name)));
  const programs = JSON.parse(await readFile(new URL(manifest.programsFile, root), "utf8"));
  const payments = (await Promise.all(manifest.paymentFiles.map(async (name) => JSON.parse(await readFile(new URL(name, root), "utf8"))))).flat();
  assert.equal(programs.length, manifest.programCount);
  assert.equal(payments.length, manifest.paymentCount);
  assert.equal(new Set(programs.map((row) => row.id)).size, programs.length);
  assert.equal(new Set(payments.map((row) => row.id)).size, payments.length);
  for (const row of payments) {
    assert.ok(Number.isSafeInteger(row.amount) && row.amount > 0);
    assert.ok(["recipient", "intermediary", "unclassified"].includes(row.flowLevel));
    assert.ok(Array.isArray(row.route) && row.route.length >= 2);
    assert.match(row.sourceUrl, /^https:\/\//);
    if (row.corporateNumber) assert.match(row.corporateNumber, /^\d{13}$/);
  }
  for (const receipt of manifest.sourceReceipts) {
    assert.match(receipt.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(receipt.bytes) && receipt.bytes > 0);
  }
});

test("review semantics prohibit cross-series aggregation and negative inference", () => {
  assert.match(manifest.semantics.paymentAmount, /支出先の合計支出額/);
  assert.match(manifest.semantics.aggregationWarning, /合算しない/);
  assert.match(manifest.semantics.negativeSearchWarning, /0件.*受給なし/);
});
