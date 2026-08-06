import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const data = JSON.parse(
  await readFile(new URL("../data/funding-data.json", import.meta.url), "utf8"),
);
const pageManifest = JSON.parse(
  await readFile(new URL("../data/pages/manifest.json", import.meta.url), "utf8"),
);
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

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

test("precomputes first-paint aggregates without bundling every detail row", () => {
  const aggregate = data.aggregates.byFiscalYear["2024"];
  assert.ok(aggregate.recipientPaymentAmount > 0);
  assert.ok(aggregate.recipientCommitmentAmount > 0);
  assert.ok(aggregate.executionAmount > 0);
  assert.ok(aggregate.nedoRecipientCount > 0);
});

test("publishes detail rows in series-and-year chunks", async () => {
  assert.deepEqual(Object.keys(pageManifest.payments), ["2023", "2024"]);
  assert.deepEqual(Object.keys(pageManifest.commitments), data.coverage.gbiz.fiscalYears.map(String));
  assert.deepEqual(Object.keys(pageManifest.programs), ["2023", "2024", "unclassified"]);
  const paymentGroups = await Promise.all(Object.values(pageManifest.payments).map(async (filename) =>
    JSON.parse(await readFile(new URL(`../data/pages/${filename}`, import.meta.url), "utf8")),
  ));
  const commitmentGroups = await Promise.all(Object.values(pageManifest.commitments).map(async (filename) =>
    JSON.parse(await readFile(new URL(`../data/pages/${filename}`, import.meta.url), "utf8")),
  ));
  const programGroups = await Promise.all(Object.values(pageManifest.programs).map(async (filename) =>
    JSON.parse(await readFile(new URL(`../data/pages/${filename}`, import.meta.url), "utf8")),
  ));
  assert.equal(paymentGroups.flat().length, data.reviewPayments.length);
  assert.equal(commitmentGroups.flat().length, data.records.length);
  assert.equal(programGroups.flat().length, data.reviewPrograms.length);
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

test("presents a GビズINFO-only recipient search without migration instructions", () => {
  assert.match(pageSource, /受取先別の契約・補助金/);
  assert.match(pageSource, /データ出典：GビズINFO/);
  assert.match(pageSource, /GビズINFOに掲載された、経済産業省と所管法人による契約・補助金/);
  assert.match(pageSource, /row\.ingestSource !== "nedo-monthly-csv"/);
  assert.doesNotMatch(pageSource, /GビズINFO＋NEDO公表契約/);
  assert.doesNotMatch(pageSource, /行政事業レビュー|レビューシート掲載支出額|事業別の予算・執行額|reviewPayments|reviewPrograms/);
  assert.doesNotMatch(pageSource, /Power Automate|Dataverse|Power Apps|SharePoint|SPFx|Entra|Azure|GitHub|METI内への移植イメージ|移植後の構成|移植構成を見る|移植手順書/);
  assert.doesNotMatch(pageSource, /METI_POWER_APPS_MIGRATION_GUIDE/);
  assert.doesNotMatch(pageSource, /データごとの更新状況|className="metrics"/);
  assert.doesNotMatch(pageSource, /この画面で確認できること|className="flow-card"|2 VIEWS/);
  assert.doesNotMatch(pageSource, /庁内版 画面イメージ|className="prototype-banner"/);
  assert.doesNotMatch(pageSource, /違う段階の金額を、足さない。|className="about-section"/);
  assert.doesNotMatch(pageSource, />公式CSV ↗<\/a>/);
  assert.doesNotMatch(pageSource, /受取先別の実支出|支出先別実支出|公式CSV/);
  assert.match(pageSource, /includesQuery\(\[row\.organization, row\.corporateNumber\], normalizedQuery\)/);
});
