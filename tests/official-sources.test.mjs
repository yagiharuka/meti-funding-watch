import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { OFFICIAL_SOURCE_REGISTRY } from "../scripts/official-sources.mjs";
import { OFFICIAL_DOCUMENTS } from "../scripts/update-official-data.mjs";

const registry = OFFICIAL_SOURCE_REGISTRY;
const manifest = JSON.parse(await readFile(new URL("../data/official/manifest.json", import.meta.url), "utf8"));
const pageSource = await readFile(new URL("../app/official/page.tsx", import.meta.url), "utf8");
const searchSource = await readFile(new URL("../app/official/OfficialSearch.tsx", import.meta.url), "utf8");
const viewTabsSource = await readFile(new URL("../app/ViewTabs.tsx", import.meta.url), "utf8");

test("registers all 13 direct executors and both official source categories", () => {
  assert.equal(registry.executors.length, 13);
  assert.equal(new Set(registry.executors.map((item) => item.id)).size, 13);
  assert.ok(registry.executors.every((item) => item.contracts.startsWith("https://")));
  assert.ok(registry.executors.every((item) => item.grantDecisions.startsWith("https://")));
  assert.equal(registry.collectionStatus.registeredEndpoints, 26);
  assert.equal(registry.collectionStatus.fullyReconciledCells, 0);
  assert.ok(OFFICIAL_DOCUMENTS.length >= manifest.coverage.sourceDocumentCount);
  assert.ok(OFFICIAL_DOCUMENTS.every((document) => ["contract_result", "grant_decision"].includes(document.category)));
});

test("keeps contract, grant-decision, Gbiz, and payment meanings separate", () => {
  assert.match(registry.series.contracts.amountStage, /契約/);
  assert.match(registry.series.grantDecisions.amountStage, /交付決定/);
  assert.match(registry.series.contracts.notIncluded, /支払|再委託|下請/);
  assert.match(registry.series.grantDecisions.notIncluded, /支払|間接補助/);
  assert.notEqual(registry.series.contracts.amountStage, registry.series.grantDecisions.amountStage);
  assert.doesNotMatch(pageSource, /契約額[^\n]{0,40}交付決定額[^\n]{0,40}(?:合計|総額)/);
  assert.match(pageSource, /GビズINFOの掲載値とも合算しません/);
  assert.match(pageSource, /行政事業レビュー/);
  assert.match(pageSource, /別タブで検索/);
});

test("published coverage matches manifest source documents and never implies full population coverage", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(Number.isSafeInteger(manifest.recordCount) && manifest.recordCount > 0);
  assert.ok(Number.isSafeInteger(manifest.coverage.sourceDocumentCount));
  assert.equal(manifest.coverage.sourceDocumentCount, manifest.sourceDocuments.length);
  assert.equal(manifest.coverage.attemptedSourceDocumentCount, manifest.coverage.sourceDocumentCount + manifest.coverage.failedSourceDocumentCount);
  assert.equal(manifest.coverage.executorCount, 13);
  assert.ok(Object.keys(manifest.coverage.executors).length <= 13);
  assert.equal(manifest.seriesCounts.contract_result + manifest.seriesCounts.grant_decision, manifest.recordCount);
  assert.equal(
    Object.values(manifest.coverage.executors).reduce((sum, item) => sum + item.contractResults.records + item.grantDecisions.records, 0),
    manifest.recordCount,
  );
  const fallbackSources = (manifest.sourceDocuments ?? []).filter((source) => source.fallbackUsed);
  assert.equal(manifest.coverage.fallbackSourceDocumentCount ?? fallbackSources.length, fallbackSources.length);
  const carryForwardSources = (manifest.sourceDocuments ?? []).filter((source) => source.carryForwardUsed);
  assert.equal(manifest.coverage.carryForwardSourceDocumentCount ?? carryForwardSources.length, carryForwardSources.length);
  if (manifest.coverage.fiscalYears) {
    assert.ok(manifest.coverage.fiscalYears.length > 1);
    assert.match(pageSource, /manifest\.coverage|coverage\.fiscalYears/);
  }
  assert.doesNotMatch(searchSource, /合計額|総支払額|実支払額です/);
});

test("adds official and review catalogs as separate visible tabs without restoring Mirasapo", () => {
  assert.match(viewTabsSource, /契約結果・交付決定/);
  assert.match(viewTabsSource, /経産省・各機関の公式資料/);
  assert.match(viewTabsSource, /行政事業レビュー/);
  assert.match(viewTabsSource, /事業・予算執行・支出先/);
  assert.doesNotMatch(viewTabsSource, /補助金採択者情報（中小企業庁のみ）|href=.*adoptions\//);
  assert.match(pageSource, /公式契約結果・補助金交付決定/);
  assert.match(pageSource, /4系列の違い/);
  assert.match(pageSource, /機関×年度×系列の検索収録/);
});
