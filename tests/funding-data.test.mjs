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
import {
  buildMirasapoSourceUrl,
  normalizeMirasapoSearchParams,
  parseMirasapoSearchHtml,
} from "../scripts/mirasapo-search.mjs";

const data = JSON.parse(
  await readFile(new URL("../data/funding-data.json", import.meta.url), "utf8"),
);
const pageManifest = JSON.parse(
  await readFile(new URL("../data/pages/manifest.json", import.meta.url), "utf8"),
);
const pageSource = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const fundingWorkerSource = await readFile(new URL("../app/funding-search.worker.ts", import.meta.url), "utf8");
const adoptionPageSource = await readFile(new URL("../app/adoptions/page.tsx", import.meta.url), "utf8");
const adoptionSearchSource = await readFile(new URL("../app/adoptions/AdoptionSearch.tsx", import.meta.url), "utf8");
const adoptionApiSource = await readFile(new URL("../app/api/adoptions/route.ts", import.meta.url), "utf8");
const officialPageSource = await readFile(new URL("../app/official/page.tsx", import.meta.url), "utf8");
const viewTabsSource = await readFile(new URL("../app/ViewTabs.tsx", import.meta.url), "utf8");
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

  assert.doesNotThrow(
    () => assertGbizSnapshotContinuity(previous, {
      ...complete,
      csvSubsidyFileBytes: previous.csvSubsidyFileBytes - 114,
    }, dashboard),
    "文言訂正などによる軽微なバイト数減少だけでは完全性エラーにしない",
  );

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
      csvSubsidyFileBytes: previous.csvSubsidyFileBytes,
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

test("starts with all periods and verifies the company index before loading matching chunks", () => {
  assert.match(pageSource, /const defaultYear = ["']all["'];/);
  assert.doesNotMatch(pageSource, /const initialYear\b/);
  assert.match(pageSource, /new Worker\(new URL\("\.\/funding-search\.worker\.ts"/);
  assert.match(fundingWorkerSource, /await sha256\(bytes\) !== metadata\.sha256/);
  assert.match(fundingWorkerSource, /rows\.length !== metadata\.rows/);
  assert.match(fundingWorkerSource, /gbiz-company-search-index\.json/);
  assert.match(fundingWorkerSource, /buckets\.map\(loadCompanyBucket\)/);
  assert.match(fundingWorkerSource, /rows\.length !== message\.release\.recordCount/);
  assert.match(fundingWorkerSource, /await sha256\(idSetBytes\.buffer\) !== message\.release\.idSetSha256/);
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
  assert.match(pageSource, /q: debouncedQuery\.trim\(\)/);
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
  assert.match(adoptionPageSource, /交付決定額・確定額・実支払額を示しません/);
  assert.match(adoptionPageSource, /金額は掲載されていない/);
  assert.match(adoptionPageSource, /GビズINFOの掲載情報とは合算しません/);
  assert.match(adoptionPageSource, /公開に同意した採択者のみ/);
  assert.match(adoptionPageSource, /掲載事業者と国から直接補助金を受ける事業管理機関が異なる場合/);
  assert.match(adoptionPageSource, /<AdoptionSearch/);
  assert.match(adoptionSearchSource, /事業者名・事業計画名/);
  assert.match(adoptionSearchSource, /すべての補助金/);
  assert.match(adoptionSearchSource, /すべての都道府県/);
  assert.match(adoptionSearchSource, /採択掲載行/);
  assert.match(adoptionSearchSource, /掲載事業者名/);
  assert.match(adoptionSearchSource, /事業計画名/);
  assert.match(adoptionSearchSource, /申請年度・公募回/);
  assert.match(adoptionSearchSource, /公式検索取得/);
  assert.match(adoptionSearchSource, /0件とは扱っていません/);
  assert.match(adoptionSearchSource, /meti-funding-watch\.haru620328\.chatgpt\.site\/api\/adoptions/);
  assert.match(adoptionApiSource, /https:\/\/yagiharuka\.github\.io/);
  assert.match(adoptionApiSource, /parseMirasapoSearchHtml/);
  assert.match(adoptionApiSource, /content-type/);
  assert.match(adoptionApiSource, /AbortSignal\.timeout\(15_000\)/);
  assert.match(adoptionApiSource, /maximumBytes = 1_000_000/);
  assert.doesNotMatch(adoptionSearchSource, /補助金採択者検索を開く/);
  assert.doesNotMatch(adoptionSearchSource, /法人番号|交付先|受取先|金額列/);
  assert.match(viewTabsSource, /企業検索/);
  assert.match(viewTabsSource, /GビズINFO＋行政事業レビューを同時表示/);
  assert.doesNotMatch(viewTabsSource, /補助金採択者情報（中小企業庁のみ）|href=.*adoptions\//);
  assert.doesNotMatch(viewTabsSource, /active === "official"|機関公表資料との比較/);
  assert.match(officialPageSource, /<ViewTabs active="official"/);
  assert.match(viewTabsSource, /aria-current/);
  assert.doesNotMatch(`${adoptionPageSource}\n${adoptionSearchSource}\n${adoptionApiSource}\n${viewTabsSource}`, /_next\/data|217,?9\d{2}/);
});

test("parses only the documented fields exposed by the public Mirasapo search page", () => {
  const payload = {
    props: {
      pageProps: {
        listView: [
          {
            id: "GT-test",
            name: " テスト株式会社 ",
            address: "東京都 ",
            subsidy: "Go-Tech事業",
            year: "2025年",
            times: "1",
            plan: "研究開発",
          },
        ],
        total: 1,
        count: "1",
      },
    },
  };
  const parsed = parseMirasapoSearchHtml(
    `<html><script type="application/json" id="__NEXT_DATA__">${JSON.stringify(payload)}</script></html>`,
  );
  assert.deepEqual(parsed, {
    totalRecords: 1,
    totalPages: 1,
    records: [{
      id: "GT-test",
      name: "テスト株式会社",
      prefecture: "東京都",
      subsidy: "Go-Tech事業",
      year: "2025年",
      round: "1",
      plan: "研究開発",
      sourceUrl: "https://mirasapo-connect.go.jp/chusho-subsidies/GT-test",
    }],
  });
  assert.throws(() => parseMirasapoSearchHtml("<html></html>"), /応答形式が変わりました/);
  assert.throws(
    () => parseMirasapoSearchHtml(`<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { listView: [], total: 0, count: "1" } } })}</script>`),
    /件数とページ数が整合しません/,
  );
});

test("allows only bounded Mirasapo search parameters and a fixed upstream origin", () => {
  const params = new URLSearchParams({
    page: "2",
    keyword: "三菱",
    prefCode: "13",
    subsidyCode: "GO_TECH",
  });
  const criteria = normalizeMirasapoSearchParams(params);
  assert.deepEqual(criteria, { page: 2, keyword: "三菱", prefCode: "13", subsidyCode: "GO_TECH" });
  assert.equal(
    buildMirasapoSourceUrl(criteria).toString(),
    "https://mirasapo-connect.go.jp/chusho-subsidies?page=2&keyword=%E4%B8%89%E8%8F%B1&prefCode=13&subsidyCodes=GO_TECH",
  );
  assert.throws(() => normalizeMirasapoSearchParams(new URLSearchParams({ page: "0" })), /範囲外/);
  assert.throws(() => normalizeMirasapoSearchParams(new URLSearchParams({ prefCode: "99" })), /都道府県コード/);
  assert.throws(() => normalizeMirasapoSearchParams(new URLSearchParams({ subsidyCode: "UNKNOWN" })), /補助金コード/);
  assert.throws(() => normalizeMirasapoSearchParams(new URLSearchParams({ keyword: "あ".repeat(21) })), /20文字以内/);
});

test("fails closed before replacing records when source counts cannot be reconciled", () => {
  assert.match(updateSource, /auditGbizImport/);
  assert.match(updateSource, /csvImportGap/);
  assert.match(updateSource, /CSVの対象行と取込行が一致しません/);
  assert.match(updateSource, /assertUniqueRecordIds\(newRecords\)/);
  assert.match(updateSource, /process\.env\.CI === "true"/);
  assert.match(updateWorkflow, /- "scripts\/\*\*"/);
  assert.doesNotMatch(updateWorkflow, /npm run update:(?:data|official|review)/);
  assert.match(updateWorkflow, /npm run test:pages/);
  assert.doesNotMatch(updateWorkflow, /run: npm test/);
  assert.match(updateWorkflow, /Rebuild the artifact from the commit that will be published/);
  assert.match(updateWorkflow, /node --test tests\/rendered-html\.test\.mjs/);
  assert.match(updateWorkflow, /node scripts\/verify-live-pages\.mjs/);
  assert.match(updateWorkflow, /actions\/upload-pages-artifact@[0-9a-f]{40} # v4/);
  assert.match(updateWorkflow, /needs: publish/);
  assert.match(updateWorkflow, /actions\/deploy-pages@[0-9a-f]{40} # v4/);
  assert.doesNotMatch(updateWorkflow, /workflow_run/);
});
