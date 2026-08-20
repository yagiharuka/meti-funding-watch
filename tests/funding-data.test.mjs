import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import test from "node:test";

import fundingSummary from "../data/funding-summary.json" with { type: "json" };
import manifest from "../data/pages/manifest.json" with { type: "json" };
import { hasValidCorporateNumberCheckDigit } from "../scripts/corporate-number.mjs";
import { normalizeGbizAgency } from "../scripts/gbiz-agency.mjs";
import {
  validateGbizRefreshCandidate,
  compareGbizDashboardWithSnapshot,
} from "../scripts/gbiz-refresh.mjs";

const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const adoptionPageSource = await readFile(new URL("../app/adoptions/page.tsx", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const dataDirectory = new URL("../data/pages/", import.meta.url);

async function readPublishedRows() {
  const rows = [];
  for (const filename of Object.values(manifest.commitments)) {
    const chunk = JSON.parse(await readFile(new URL(filename, dataDirectory), "utf8"));
    rows.push(...chunk);
  }
  return rows;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fakeRefreshSnapshot(overrides = {}) {
  return {
    generatedAt: "2026-08-16T00:00:00.000Z",
    csvRetrievedAt: "2026-08-16T00:00:00.000Z",
    sourceFiles: {
      subsidy: { filename: "subsidy.csv", sha256: "a".repeat(64), bytes: 1234 },
      procurement: { filename: "procurement.csv", sha256: "b".repeat(64), bytes: 5678 },
    },
    rawRecordCount: 11,
    csvEligibleRecordCount: 10,
    recordCount: 10,
    csvImportedRecordCount: 10,
    csvImportGap: 0,
    csvEligibleSubsidyCount: 4,
    csvImportedSubsidyCount: 4,
    csvEligibleProcurementCount: 6,
    csvImportedProcurementCount: 6,
    duplicateCount: 0,
    sourceCounts: { subsidy: 4, procurement: 6 },
    normalizedPublisherCounts: { "経済産業省": 10 },
    excludedSourceRowCounts: { missingCorporateNumber: 1 },
    dashboardCheckedAt: "2026-08-16T00:01:00.000Z",
    dashboardRecordCount: 12,
    dashboardSubsidyCount: 5,
    dashboardProcurementCount: 7,
    dashboardMinusCsvEligibleCount: 2,
    dashboardMinusCsvEligibleSubsidyCount: 1,
    dashboardMinusCsvEligibleProcurementCount: 1,
    dashboardComparisonStatus: "different",
    ...overrides,
  };
}

test("publishes only Gbiz commitment chunks", async () => {
  assert.deepEqual(Object.keys(manifest).sort(), ["commitments", "generatedAt", "preview"]);
  assert.match(manifest.preview, /^commitments-preview\.json$/);
  assert.ok(Object.keys(manifest.commitments).length > 0);
  assert.ok(Object.keys(manifest.commitments).every((key) => key === "unclassified" || /^\d{4}$/.test(key)));
  assert.ok(Object.values(manifest.commitments).every((filename) => /^commitments-(?:\d{4}|unclassified)\.json$/.test(filename)));

  const rows = await readPublishedRows();
  assert.ok(rows.length > 0);
  assert.ok(rows.every((row) => row.id.startsWith("gbiz-")));
  assert.ok(rows.every((row) => row.stage === "contracted" || row.stage === "subsidy_published"));
  assert.ok(rows.every((row) => row.sourceName === "GビズINFO 全件CSV（調達）" || row.sourceName === "GビズINFO 全件CSV（補助金）"));
});

test("preserves rows whose source date or amount is zero", async () => {
  const rows = await readPublishedRows();
  const zeroAmount = rows.find((row) => row.amount === 0);
  assert.ok(zeroAmount, "published data should retain a 0-yen source value");
  assert.equal(zeroAmount.amountRaw, "0");
  assert.ok(zeroAmount.sourceKey);
});

test("converts blank dates, blank names, zero and negative CSV values without dropping rows", async () => {
  const { toGbizBulkRecords } = await import("../scripts/gbiz-csv.mjs");
  const csv = [
    "法人番号,商号または名称,証明日,名称,金額,発行元,キー情報",
    "7010401022916,日本電気株式会社,,テスト1,0,経済産業省,key-1",
    "7010401022916,日本電気株式会社,2026-05-01,,,-10,経済産業省,key-2",
  ].join("\n");
  const { records } = toGbizBulkRecords(csv, "subsidy");
  assert.equal(records.length, 2);
  assert.equal(records[0].date, null);
  assert.equal(records[0].amount, 0);
  assert.equal(records[0].amountRaw, "0");
  assert.equal(records[1].program, "");
});

test("separates CSV import completeness from the dashboard comparison", () => {
  const snapshot = fakeRefreshSnapshot();
  assert.doesNotThrow(() => validateGbizRefreshCandidate(snapshot));
  assert.deepEqual(compareGbizDashboardWithSnapshot(snapshot), {
    dashboardRecordCount: 12,
    dashboardSubsidyCount: 5,
    dashboardProcurementCount: 7,
    dashboardMinusCsvEligibleCount: 2,
    dashboardMinusCsvEligibleSubsidyCount: 1,
    dashboardMinusCsvEligibleProcurementCount: 1,
    dashboardComparisonStatus: "different",
  });
});

test("rejects a partial CSV snapshot before it can replace the last successful data", () => {
  assert.throws(
    () => validateGbizRefreshCandidate(fakeRefreshSnapshot({ csvImportedRecordCount: 9, csvImportGap: 1 })),
    /CSV取込差/,
  );
  assert.throws(
    () => validateGbizRefreshCandidate(fakeRefreshSnapshot({ csvImportedSubsidyCount: 3 })),
    /補助金/,
  );
});

test("reports CSV and dashboard counts without conflating their gaps", () => {
  const gbiz = fundingSummary.sources.find((source) => source.id === "gbiz");
  assert.ok(gbiz);
  assert.equal(gbiz.csvImportGap, 0);
  assert.equal(gbiz.csvEligibleRecordCount, gbiz.csvImportedRecordCount);
  assert.equal(gbiz.dashboardMinusCsvEligibleCount, gbiz.dashboardRecordCount - gbiz.csvEligibleRecordCount);
});

test("derives the year selector from declared coverage", () => {
  const years = fundingSummary.coverage.gbiz.fiscalYears;
  assert.ok(Array.isArray(years));
  assert.ok(years.length > 0);
  assert.ok(years.every(Number.isInteger));
  assert.match(pageSource, /const coverageYears = dataset\.coverage\?\.gbiz\.fiscalYears/);
});

test("starts with all periods and verifies all static chunks before searching", () => {
  assert.match(pageSource, /const defaultYear = "all"/);
  assert.match(pageSource, /loadVerifiedFundingRecords/);
  assert.match(pageSource, /idSetSha256/);
  assert.match(pageSource, /manifestSha256/);
});

test("validates every published corporate number including its check digit", async () => {
  const rows = await readPublishedRows();
  for (const row of rows) {
    assert.ok(/^\d{13}$/.test(row.corporateNumber), `${row.id}: malformed corporate number`);
    assert.equal(
      hasValidCorporateNumberCheckDigit(row.corporateNumber),
      true,
      `${row.id}: invalid corporate number ${row.corporateNumber}`,
    );
    assert.equal(
      normalizeGbizAgency(row.sourceAgency),
      row.publisherCanonical,
      `${row.id}: unapproved publisher alias ${row.sourceAgency}`,
    );
  }
});

test("presents a Gbiz-only record search without unsupported claims", () => {
  const recordsSection = pageSource.slice(
    pageSource.indexOf('<section className="records-section"'),
    pageSource.indexOf('<section className="source-section"'),
  );
  assert.match(pageSource, /法人等/);
  assert.match(pageSource, /データ出典：GビズINFO/);
  assert.match(pageSource, /全支出・実支払を示すものではありません/);
  assert.match(pageSource, /経済産業省を原資とする支出かどうかはGビズINFOだけでは判別できません/);
  assert.match(pageSource, /GビズINFO情報種別/);
  assert.match(pageSource, /調達（委託を含む）/);
  assert.match(pageSource, /subsidy_published: "補助金"/);
  assert.doesNotMatch(pageSource, /補助金掲載値の注意|法人詳細画面に表示される手続ステータス|GビズINFO画面のステータス|sourceStatusCell/);
  assert.match(pageSource, /調達（委託を含む）・補助金/);
  assert.match(pageSource, /認定日・受注日の記載がない/);
  assert.match(pageSource, /取得時CSVの抽出対象行を取込確認/);
  assert.match(pageSource, /https:\/\/yagiharuka\.github\.io\/meti-funding-watch\//);
  assert.match(pageSource, /manifestSha256|idSetSha256/);
  assert.match(pageSource, /update-chip \$\{updateChipClass\}/);
  assert.match(pageSource, /q: deferredQuery\.trim\(\)/);
  assert.match(pageSource, /funding-search\.worker\.ts/);
  assert.doesNotMatch(pageSource, /getFundingSearchUrl|haru620328\.chatgpt\.site\/api\/funding/);

  assert.doesNotMatch(recordsSection, /行政事業レビュー|レビューシート|reviewPayments|reviewPrograms/);
  assert.doesNotMatch(recordsSection, /受取先|支出元・実施機関|契約額/);
  assert.doesNotMatch(recordsSection, /\broute\b/);
  assert.doesNotMatch(recordsSection, /GビズINFO掲載値合計/);
  assert.match(recordsSection, /金額の記載なし/);
  assert.match(recordsSection, /<th>掲載値合計<\/th>/);
  assert.doesNotMatch(recordsSection, /交付金額|期間指定API|総支出額合計/);
  assert.doesNotMatch(recordsSection, /未収録行|検索結果は網羅的では/);
  assert.doesNotMatch(pageSource, /Power Automate|Dataverse|Power Apps|SharePoint|SPFx|Entra|Azure/);
  assert.doesNotMatch(styleSource, /\.route\b|award_decision|\.finalized\b|\.paid\b/);
});

test("keeps Mirasapo adoption records separate from Gbiz amounts", () => {
  assert.match(pageSource, /<ViewTabs active="gbiz"/);
  assert.doesNotMatch(pageSource, /adoption-section|中小企業庁の補助金採択者情報/);
  assert.match(adoptionPageSource, /<ViewTabs active="adoptions"/);
  assert.match(adoptionPageSource, /中小企業庁の補助金採択者情報/);
  assert.match(adoptionPageSource, /採択は補助金交付の候補者として選定された段階/);
  assert.doesNotMatch(adoptionPageSource, /交付金額|合計額|総額/);
});
