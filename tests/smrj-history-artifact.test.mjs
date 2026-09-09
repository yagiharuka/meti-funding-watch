import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("committed SMRJ HQ supplement accounts for every discovered PDF and printed row", async () => {
  const data = JSON.parse(await readFile("data/official-supplement-smrj.json", "utf8"));
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.id, "smrj");
  assert.equal(data.collectionStatus, "complete");
  assert.equal(data.minFiscalYear, 2015);
  assert.ok(data.maxFiscalYear >= 2026);
  assert.equal(data.documentCount, data.parsedDocumentCount);
  assert.ok(data.documentCount >= 158);
  assert.equal(data.parseFailureCount, 0);
  assert.equal(data.records.length, data.totalRows);
  assert.equal(
    data.publishedRowCount + data.amountUnavailableRowCount + data.nonTotalAmountRowCount,
    data.totalRows,
  );
  assert.ok(data.totalRows > 1_000, "a full headquarters history must not collapse back to the former sample");
  assert.ok(data.records.some((row) => row.fiscalYear === 2015));
  assert.ok(data.records.some((row) => row.fiscalYear === 2026));
  assert.ok(data.records.some((row) => row.contractType === "competitive"));
  assert.ok(data.records.some((row) => row.contractType === "discretionary"));
  assert.ok(data.records.some((row) => Array.isArray(row.organizations) && row.organizations.length > 1));
  assert.ok(data.records.some((row) => row.amount === null && row.amountStage === "契約金額の記載なし"));
  assert.ok(data.records.some((row) => row.amount === null && row.amountStage === "単価・変動額（契約総額の記載なし）"));
  for (const document of data.documents) {
    assert.equal(document.totalRows, document.publishedRows + document.unavailableRows + document.nonTotalRows, document.url);
    assert.match(document.sha256, /^[0-9a-f]{64}$/u);
    assert.ok(document.pageCount >= 1);
  }
});
