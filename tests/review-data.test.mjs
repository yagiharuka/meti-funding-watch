import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../dist-pages/data/review/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));

test("publishes administrative review as an isolated verified series", async () => {
  assert.equal(manifest.schemaVersion, 4);
  assert.match(manifest.sourceUrl, /^https:\/\//);
  assert.ok(Array.isArray(manifest.reviewSheetYears) && manifest.reviewSheetYears.length > 0);
  assert.ok(Array.isArray(manifest.sourceReceipts));
  if (manifest.sourceReceipts.length === 0) {
    assert.equal(manifest.sourceReceipts.length, 0);
    assert.match(manifest.bootstrapProvenance?.commit ?? "", /^[0-9a-f]{40}$/);
    assert.match(manifest.bootstrapProvenance?.description ?? "", /公式CSV/);
    assert.match(manifest.lastSuccessfulSourceRefresh ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(manifest.lastSuccessfulSourceRefreshAt, null);
    assert.match(manifest.lastSuccessfulSourceRefreshDate ?? "", /^\d{4}-\d{2}-\d{2}$/);
  } else {
    assert.ok(manifest.sourceReceipts.length >= manifest.reviewSheetYears.length * 4);
    assert.match(manifest.lastSuccessfulSourceRefreshAt ?? "", /^\d{4}-\d{2}T/);
  }
  assert.equal(manifest.programsFile, "programs.json");
  assert.equal(manifest.excludedRowsFile, "excluded-rows.json");
  assert.ok(manifest.paymentFiles.every((name) => /^payments-[0-9a-f]\.json$/.test(name)));
  const programs = JSON.parse(await readFile(new URL(manifest.programsFile, root), "utf8"));
  const payments = (await Promise.all(manifest.paymentFiles.map(async (name) => JSON.parse(await readFile(new URL(name, root), "utf8"))))).flat();
  const excludedRows = JSON.parse(await readFile(new URL(manifest.excludedRowsFile, root), "utf8"));
  assert.equal(programs.length, manifest.programCount);
  assert.equal(payments.length, manifest.paymentCount);
  assert.equal(excludedRows.length, manifest.excludedRowCount);
  assert.equal(new Set(programs.map((row) => row.id)).size, programs.length);
  assert.equal(new Set(payments.map((row) => row.id)).size, payments.length);
  for (const row of payments) {
    assert.ok(row.amount === null || Number.isSafeInteger(row.amount));
    assert.ok(["positive", "zero", "negative", "blank", "invalid"].includes(row.amountStatus));
    assert.ok(["disclosed_intermediary", "terminal_in_disclosed_graph", "unclassified"].includes(row.flowLevel));
    assert.ok(row.route === null || (Array.isArray(row.route) && row.route.length >= 2));
    assert.ok(Array.isArray(row.parentPaymentIds));
    assert.ok(Array.isArray(row.directUpstreamNames));
    assert.ok(row.sourceRowNumber === null || (Number.isSafeInteger(row.sourceRowNumber) && row.sourceRowNumber >= 2));
    if (row.flowDepth === null) {
      assert.equal(row.route, null);
      assert.equal(row.sourceAgency, null);
    }
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
  assert.match(manifest.semantics.routeWarning, /根拠がない経路は生成しない/);
  assert.ok(["complete", "partial_unknown_legacy_cache"].includes(manifest.rowAccounting.status));
  assert.equal(manifest.rowAccounting.totals.publishedPaymentRowCount, manifest.paymentCount);
  if (manifest.rowAccounting.status !== "complete") {
    assert.equal(manifest.rowAccounting.totals.sourcePaymentRowCount, null);
    assert.equal(manifest.rowAccounting.totals.excludedPaymentRowCount, null);
  }
});
