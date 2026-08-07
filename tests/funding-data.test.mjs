import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fiscalYear, parseAmount, parseJapaneseDate } from "../scripts/gbiz-values.mjs";
import {
  assertGbizRecordContinuity,
  assertGbizSnapshotContinuity,
  auditGbizImport,
  normalizeGbizAgency,
  parseDashboardRow,
  toGbizBulkRecords,
} from "../scripts/gbiz-csv.mjs";

const data = JSON.parse(
  await readFile(new URL("../data/funding-data.json", import.meta.url), "utf8"),
);
const pageManifest = JSON.parse(
  await readFile(new URL("../data/pages/manifest.json", import.meta.url), "utf8"),
);
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const styleSource = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const updateSource = await readFile(new URL("../scripts/update-data.mjs", import.meta.url), "utf8");
const updateWorkflow = await readFile(new URL("../.github/workflows/update-data.yml", import.meta.url), "utf8");

function fiscalYearForDate(value) {
  const [year, month] = value.split("-").map(Number);
  return month <= 3 ? year - 1 : year;
}

function isRealIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

function hasValidCorporateNumberCheckDigit(value) {
  if (!/^\d{13}$/.test(value)) return false;
  const baseDigits = value.slice(1).split("").map(Number);
  const weightedSum = baseDigits.reduce(
    (sum, digit, index) => sum + digit * (index % 2 === 0 ? 2 : 1),
    0,
  );
  return Number(value[0]) === 9 - (weightedSum % 9);
}

test("publishes only Gbiz commitment chunks", async () => {
  assert.deepEqual(Object.keys(pageManifest).sort(), ["commitments", "generatedAt"]);
  assert.equal(typeof pageManifest.generatedAt, "string");
  assert.ok(pageManifest.commitments && typeof pageManifest.commitments === "object");
  assert.ok(!("payments" in pageManifest));
  assert.ok(!("programs" in pageManifest));

  const groups = await Promise.all(
    Object.entries(pageManifest.commitments).map(async ([year, filename]) => {
      assert.match(filename, /^commitments-(?:\d{4}|unclassified)\.json$/);
      const rows = JSON.parse(
        await readFile(new URL(`../data/pages/${filename}`, import.meta.url), "utf8"),
      );
      assert.ok(Array.isArray(rows));
      for (const row of rows) {
        if (year === "unclassified") {
          assert.equal(row.fiscalYear, null);
        } else {
          assert.equal(String(row.fiscalYear), year);
        }
        assert.equal(row.ingestSource, "gbiz-bulk-csv");
        assert.match(row.sourceName, /^GビズINFO/);
        assert.ok(!("route" in row), `${row.id}: route must not be published`);
        assert.ok(!("flowLevel" in row), `${row.id}: flowLevel must not be published`);
        assert.ok(!("flowDepth" in row), `${row.id}: flowDepth must not be published`);
      }
      return rows;
    }),
  );

  const publishedRows = groups.flat();
  assert.equal(publishedRows.length, data.records.length);
  assert.equal(new Set(publishedRows.map((row) => row.id)).size, publishedRows.length);
  assert.deepEqual(
    publishedRows.map((row) => row.id).sort(),
    data.records.map((row) => row.id).sort(),
  );
});

test("preserves rows whose source date or amount is zero", () => {
  assert.equal(parseAmount("0"), 0);
  assert.equal(parseAmount("-6,528,000"), -6_528_000);
  assert.equal(parseAmount("△151,706,000円"), -151_706_000);
  assert.equal(parseAmount(""), null);
  assert.equal(parseJapaneseDate(""), null);
  assert.equal(parseJapaneseDate("2026年4月1日"), "2026-04-01");
  assert.equal(fiscalYear("2026-03-31"), 2025);
  assert.equal(fiscalYear("2026-04-01"), 2026);

  for (const row of data.records) {
    assert.ok(
      row.amount === null || Number.isSafeInteger(row.amount),
      `${row.id}: invalid amount ${row.amount}`,
    );
    if (row.date === null) {
      assert.equal(row.fiscalYear, null, `${row.id}: an undated row cannot have a derived fiscal year`);
      continue;
    }
    assert.ok(isRealIsoDate(row.date), `${row.id}: invalid date ${row.date}`);
    assert.equal(row.fiscalYear, fiscalYearForDate(row.date), `${row.id}: fiscal year mismatch`);
  }

  assert.doesNotMatch(updateSource, /amount\s*>\s*0\s*\?\s*amount\s*:\s*null/);
  assert.doesNotMatch(updateSource, /record\.amount\s*<=\s*0/);
});

test("converts blank dates, blank names, zero and negative CSV values without dropping rows", () => {
  const subsidyCsv = [
    "法人番号,商号または名称,証明日,名称,金額,発行元,キー情報",
    "5250005003274,協同組合唐戸商店会,,,0,中小企業庁,key-zero",
    '3000020141003,横浜市,2026-04-01,制度,"-6,528,000",経済産業省,key-negative',
  ].join("\n");
  const subsidy = toGbizBulkRecords(subsidyCsv, "subsidy");
  assert.equal(subsidy.records.length, 2);
  assert.equal(subsidy.stats.missingDateRows, 1);
  assert.equal(subsidy.stats.missingProgramRows, 1);
  assert.deepEqual(
    subsidy.records.map((row) => ({ date: row.date, fiscalYear: row.fiscalYear, amount: row.amount })),
    [
      { date: null, fiscalYear: null, amount: 0 },
      { date: "2026-04-01", fiscalYear: 2026, amount: -6_528_000 },
    ],
  );

  const procurementCsv = [
    "法人番号,商号または名称,受注日,件名,落札価格,組織名,キー情報,備考",
    "2120001092320,テスト法人,2026/04/02,用紙,1,特許庁,key-one,単価",
  ].join("\n");
  const procurement = toGbizBulkRecords(procurementCsv, "procurement");
  assert.equal(procurement.records.length, 1);
  assert.equal(procurement.records[0].amount, 1);
  assert.equal(procurement.records[0].notes, "単価");
  assert.match(procurement.records[0].sourceRecordHash, /^[0-9a-f]{64}$/);

  const dashboardHtml = "<tr><th>経済産業省 (小計)</th><td>68,281</td><td>51,358</td><td>16,923</td><td>0</td></tr>";
  assert.deepEqual(parseDashboardRow(dashboardHtml, "経済産業省 (小計)"), {
    subsidies: 51_358,
    procurements: 16_923,
  });
  assert.throws(
    () => parseDashboardRow(
      "<tr><th>経済産業省 (小計)</th><td>999,999</td><td>51,358</td><td>16,923</td><td>0</td></tr>",
      "経済産業省 (小計)",
    ),
    /合計と内訳が一致しません/,
  );
});

test("separates CSV import completeness from the dashboard comparison", () => {
  const subsidy = toGbizBulkRecords([
    "法人番号,商号または名称,証明日,名称,金額,発行元,キー情報",
    "6010001030403,テスト法人,,補助事業,100,経済産業省,sub-1",
  ].join("\n"), "subsidy");
  const procurement = toGbizBulkRecords([
    "法人番号,商号または名称,受注日,件名,落札価格,組織名,キー情報,備考",
    "6010001030403,テスト法人,2026-04-01,調達事業,1,特許庁,proc-1,単価",
  ].join("\n"), "procurement");
  const audit = auditGbizImport(subsidy, procurement, {
    dashboardRecordCount: 16,
    dashboardSubsidyCount: 6,
    dashboardProcurementCount: 10,
  });
  assert.equal(audit.csvEligibleRecordCount, 2);
  assert.equal(audit.csvImportedRecordCount, 2);
  assert.equal(audit.csvImportGap, 0);
  assert.equal(audit.dashboardMinusCsvEligibleCount, 14);
  assert.equal(audit.dashboardComparisonStatus, "different");

  const withoutDashboard = auditGbizImport(subsidy, procurement, null);
  assert.equal(withoutDashboard.csvImportGap, 0);
  assert.equal(withoutDashboard.dashboardComparisonStatus, "unavailable");

  const incomplete = structuredClone(subsidy);
  incomplete.stats.eligibleRows += 1;
  assert.throws(
    () => auditGbizImport(incomplete, procurement, null),
    /CSV対象行との件数照合に失敗/,
  );
});

test("rejects a partial CSV snapshot before it can replace the last successful data", () => {
  const previous = {
    recordCount: 69_491,
    lastSuccessfulImportAt: "2026-08-06T15:42:24.531Z",
    csvTotalSubsidyRows: 545_877,
    csvTotalProcurementRows: 308_125,
    csvEligibleSubsidyCount: 51_375,
    csvEligibleProcurementCount: 18_116,
    csvSubsidyFileBytes: 175_574_914,
    csvProcurementFileBytes: 102_217_942,
    dashboardMinusCsvEligibleCount: 14,
    dashboardSubsidyCount: 51_380,
    dashboardProcurementCount: 18_125,
    dashboardMinusCsvEligibleSubsidyCount: 5,
    dashboardMinusCsvEligibleProcurementCount: 9,
  };
  const complete = {
    csvTotalSubsidyRows: 545_877,
    csvTotalProcurementRows: 308_125,
    csvEligibleRecordCount: 69_491,
    csvEligibleSubsidyCount: 51_375,
    csvEligibleProcurementCount: 18_116,
    csvSubsidyFileBytes: 175_574_914,
    csvProcurementFileBytes: 102_217_942,
    missingSourceKeyRows: 0,
    suspiciousUnmatchedAgencyRows: 0,
    suspiciousUnmatchedAgencies: [],
  };
  const dashboard = {
    dashboardRecordCount: 69_505,
    dashboardSubsidyCount: 51_380,
    dashboardProcurementCount: 18_125,
  };
  assert.doesNotThrow(() => assertGbizSnapshotContinuity(previous, complete, dashboard));

  assert.throws(
    () => assertGbizSnapshotContinuity(previous, {
      ...complete,
      csvTotalSubsidyRows: 1,
      csvEligibleRecordCount: 18_117,
      csvEligibleSubsidyCount: 1,
      csvSubsidyFileBytes: 200,
    }, dashboard),
    /前回成功時から減少しました/,
  );
  assert.throws(
    () => assertGbizSnapshotContinuity(previous, { ...complete, missingSourceKeyRows: 1 }, dashboard),
    /キー情報がない対象行/,
  );
  assert.throws(
    () => assertGbizSnapshotContinuity(null, complete, dashboard),
    /前回成功スナップショットがありません/,
  );
  assert.throws(
    () => assertGbizSnapshotContinuity(previous, complete, null),
    /公式画面の区分別件数を確認できない/,
  );
  assert.throws(
    () => assertGbizSnapshotContinuity(previous, {
      ...complete,
      csvTotalSubsidyRows: previous.csvTotalSubsidyRows + 100_000,
      csvEligibleRecordCount: complete.csvEligibleRecordCount + 100_000,
      csvEligibleSubsidyCount: complete.csvEligibleSubsidyCount + 100_000,
      csvSubsidyFileBytes: previous.csvSubsidyFileBytes + 30_000_000,
    }, {
      ...dashboard,
      dashboardRecordCount: dashboard.dashboardRecordCount + 100_000,
      dashboardSubsidyCount: dashboard.dashboardSubsidyCount + 100_000,
    }),
    /増加が自動公開の上限を超えました/,
  );
  assert.throws(
    () => assertGbizSnapshotContinuity(previous, complete, {
      ...dashboard,
      dashboardSubsidyCount: dashboard.dashboardSubsidyCount + 1,
      dashboardProcurementCount: dashboard.dashboardProcurementCount - 1,
    }),
    /補助金の公式画面との差が前回成功時より拡大しました/,
  );
  assert.throws(
    () => assertGbizSnapshotContinuity(previous, complete, {
      ...dashboard,
      dashboardRecordCount: complete.csvEligibleRecordCount - 1,
      dashboardSubsidyCount: complete.csvEligibleSubsidyCount - 1,
      dashboardProcurementCount: complete.csvEligibleProcurementCount,
    }),
    /補助金CSV対象行が公式画面の件数を超えました/,
  );
  assert.throws(
    () => assertGbizSnapshotContinuity(previous, {
      ...complete,
      suspiciousUnmatchedAgencyRows: 1,
      suspiciousUnmatchedAgencies: [["経済産業省を含む別組織", 1]],
    }, dashboard),
    /未承認の公表組織名/,
  );

  const same = assertGbizRecordContinuity(data.records, data.records);
  assert.equal(same.continuityBaselineRecordCount, data.records.length);
  assert.equal(same.continuityRemovedRecordCount, 0);
  assert.throws(
    () => assertGbizRecordContinuity(data.records, data.records.slice(0, -1)),
    /前回成功データのキーが1件欠落しています/,
  );
  assert.throws(
    () => assertGbizRecordContinuity([], [data.records[0]]),
    /前回成功データがありません/,
  );
  for (const [field, value] of [
    ["amount", (data.records[0].amount ?? 0) + 1],
    ["corporateNumber", "6010001030402"],
    ["organization", `${data.records[0].organization}（変更）`],
    ["date", "2026-08-07"],
    ["sourceAgency", "特許庁"],
  ]) {
    const changedRow = { ...structuredClone(data.records[0]), [field]: value };
    const changed = [changedRow, ...data.records.slice(1)];
    assert.throws(
      () => assertGbizRecordContinuity(data.records, changed),
      /既存キーの内容が1件変更されています/,
      `changing ${field} must stop publication`,
    );
  }
  const added = {
    ...structuredClone(data.records[0]),
    id: "gbiz-new-record",
    sourceKey: "new-source-key",
  };
  const withAddition = assertGbizRecordContinuity(data.records, [...data.records, added]);
  assert.equal(withAddition.continuityAddedRecordCount, 1);
  assert.equal(withAddition.continuityChangedRecordCount, 0);
  assert.equal(normalizeGbizAgency("経済産業省"), "経済産業省");
  assert.equal(normalizeGbizAgency("経済産業省を含む別組織"), null);
});

test("reports CSV and dashboard counts without conflating their gaps", () => {
  const gbizSource = data.sources.find((source) => source.id === "gbiz");
  assert.ok(gbizSource, "Gbiz source metadata is required");
  assert.equal(gbizSource.recordCount, data.records.length);
  if (Number.isSafeInteger(gbizSource.csvEligibleRecordCount)) {
    assert.equal(gbizSource.csvImportedRecordCount, gbizSource.recordCount);
    assert.equal(gbizSource.csvImportGap, 0);
    assert.equal(gbizSource.csvEligibleRecordCount, gbizSource.csvImportedRecordCount);
    assert.equal(
      gbizSource.csvEligibleRecordCount,
      gbizSource.csvEligibleSubsidyCount + gbizSource.csvEligibleProcurementCount,
    );
    assert.equal(gbizSource.status, "healthy");
    if (Number.isSafeInteger(gbizSource.dashboardRecordCount)) {
      assert.equal(
        gbizSource.dashboardMinusCsvEligibleCount,
        gbizSource.dashboardRecordCount - gbizSource.csvEligibleRecordCount,
      );
    }
  } else {
    assert.equal(gbizSource.status, "watch");
    assert.equal(gbizSource.lastSuccessfulImportAt, undefined);
  }
});

test("derives the year selector from declared coverage", () => {
  const coverageYears = data.coverage?.gbiz?.fiscalYears;
  assert.ok(Array.isArray(coverageYears));
  assert.deepEqual(
    coverageYears,
    [...new Set(data.records.flatMap((row) =>
      Number.isInteger(row.fiscalYear) ? [row.fiscalYear] : []))].sort((a, b) => a - b),
  );
  for (const year of coverageYears) {
    assert.ok(String(year) in pageManifest.commitments, `missing ${year} commitment chunk`);
  }
  if (data.records.some((row) => row.fiscalYear === null)) {
    assert.ok("unclassified" in pageManifest.commitments, "undated records need a public chunk");
  }

  assert.match(pageSource, /coverageYears[\s\S]{0,500}(?:fiscalYears|\.map\()/);
  assert.doesNotMatch(pageSource, /distinctYears\(commitments\.map/);
});

test("starts with all periods and clears stale rows for each chunk batch", () => {
  assert.match(pageSource, /const defaultYear = ["']all["'];/);
  assert.doesNotMatch(pageSource, /const initialYear\b/);
  const chunkEffect = pageSource.slice(
    pageSource.indexOf("let active = true"),
    pageSource.indexOf("const commitments = useMemo"),
  );
  assert.match(chunkEffect, /let active = true/);
  assert.match(chunkEffect, /if \(!active\) return/);
  assert.match(chunkEffect, /active = false;[\s\S]{0,100}controller\.abort\(\)/);
  assert.match(pageSource, /function changeYear[\s\S]{0,180}records: \[\]/);
  assert.match(pageSource, /function clearFilters[\s\S]{0,180}records: \[\]/);
});

test("validates every published corporate number including its check digit", () => {
  for (const row of data.records) {
    assert.ok(
      hasValidCorporateNumberCheckDigit(row.corporateNumber),
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
  assert.match(pageSource, /法人等/);
  assert.match(pageSource, /データ出典：GビズINFO/);
  assert.match(pageSource, /全支出・実支払を示すものではありません/);
  assert.match(pageSource, /経済産業省を原資とする支出かどうかはGビズINFOだけでは判別できません/);
  assert.match(pageSource, /GビズINFO掲載区分/);
  assert.match(pageSource, /調達CSV/);
  assert.match(pageSource, /補助金CSV/);
  assert.match(pageSource, /認定日・受注日の記載がない/);
  assert.match(pageSource, /当サイトの抽出条件に合うCSV行を全件取込済み/);
  assert.match(pageSource, /update-chip \$\{dataMode\}/);
  assert.match(pageSource, /includesQuery\(\[row\.organization, row\.corporateNumber\], normalizedQuery\)/);

  assert.doesNotMatch(pageSource, /行政事業レビュー|レビューシート|reviewPayments|reviewPrograms/);
  assert.doesNotMatch(pageSource, /受取先|支出元・実施機関|契約額/);
  assert.doesNotMatch(pageSource, /\broute\b/);
  assert.doesNotMatch(pageSource, /合計|交付金額|期間指定API/);
  assert.doesNotMatch(pageSource, /未収録行|検索結果は網羅的では/);
  assert.doesNotMatch(pageSource, /Power Automate|Dataverse|Power Apps|SharePoint|SPFx|Entra|Azure/);
  assert.doesNotMatch(styleSource, /\.route\b|award_decision|\.finalized\b|\.paid\b/);
});

test("fails closed before replacing records when source counts cannot be reconciled", () => {
  assert.match(updateSource, /auditGbizImport/);
  assert.match(updateSource, /csvImportGap/);
  assert.match(updateSource, /CSVの対象行と取込行が一致しません/);
  assert.match(updateSource, /assertUniqueRecordIds\(newRecords\)/);
  assert.match(updateSource, /process\.env\.CI === "true"/);
  assert.match(updateWorkflow, /- "scripts\/\*\*"/);
  assert.match(updateWorkflow, /npm run update:data/);
  assert.match(updateWorkflow, /continue-on-error: \$\{\{ github\.event_name == 'push' \}\}/);
  assert.match(updateWorkflow, /if: steps\.refresh\.outcome == 'success'/);
  assert.match(updateWorkflow, /npm test/);
  assert.match(updateWorkflow, /Rebuild the artifact from the commit that will be published/);
  assert.match(updateWorkflow, /node --test tests\/rendered-html\.test\.mjs/);
  assert.match(updateWorkflow, /actions\/upload-pages-artifact@v4/);
  assert.match(updateWorkflow, /needs: update/);
  assert.match(updateWorkflow, /actions\/deploy-pages@v4/);
  assert.doesNotMatch(updateWorkflow, /workflow_run/);
});
