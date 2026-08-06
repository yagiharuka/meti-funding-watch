import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fiscalYear, parseAmount, parseJapaneseDate } from "../scripts/gbiz-values.mjs";
import { parseDashboardRow, toGbizBulkRecords } from "../scripts/gbiz-csv.mjs";

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

  const dashboardHtml = "<tr><th>経済産業省 (小計)</th><td>68,281</td><td>51,358</td><td>16,923</td><td>0</td></tr>";
  assert.deepEqual(parseDashboardRow(dashboardHtml, "経済産業省 (小計)"), {
    subsidies: 51_358,
    procurements: 16_923,
  });
});

test("reports included and official Gbiz counts without hiding the gap", () => {
  const gbizSource = data.sources.find((source) => source.id === "gbiz");
  assert.ok(gbizSource, "Gbiz source metadata is required");
  assert.equal(gbizSource.recordCount, data.records.length);
  assert.ok(Number.isSafeInteger(gbizSource.officialRecordCount));
  assert.equal(
    gbizSource.recordCountGap,
    gbizSource.officialRecordCount - gbizSource.recordCount,
  );
  assert.equal(
    gbizSource.officialRecordCount,
    gbizSource.officialSubsidyCount + gbizSource.officialProcurementCount,
  );
  assert.equal(
    gbizSource.officialRecordCount,
    gbizSource.officialMetiSubtotalCount + gbizSource.officialPatentCount,
  );
  if (gbizSource.recordCountGap !== 0) assert.equal(gbizSource.status, "watch");
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

test("validates every published corporate number including its check digit", () => {
  for (const row of data.records) {
    assert.ok(
      hasValidCorporateNumberCheckDigit(row.corporateNumber),
      `${row.id}: invalid corporate number ${row.corporateNumber}`,
    );
  }
});

test("presents a Gbiz-only record search without unsupported claims", () => {
  assert.match(pageSource, /法人等/);
  assert.match(pageSource, /データ出典：GビズINFO/);
  assert.match(pageSource, /includesQuery\(\[row\.organization, row\.corporateNumber\], normalizedQuery\)/);

  assert.doesNotMatch(pageSource, /行政事業レビュー|レビューシート|reviewPayments|reviewPrograms/);
  assert.doesNotMatch(pageSource, /受取先|支出元・実施機関|契約額/);
  assert.doesNotMatch(pageSource, /\broute\b/);
  assert.doesNotMatch(pageSource, /合計|交付金額|期間指定API/);
  assert.doesNotMatch(pageSource, /Power Automate|Dataverse|Power Apps|SharePoint|SPFx|Entra|Azure/);
  assert.doesNotMatch(styleSource, /\.route\b|award_decision|\.finalized\b|\.paid\b/);
});

test("fails closed before replacing records when source counts cannot be reconciled", () => {
  assert.match(updateSource, /全件CSVによる明細置換を中止/);
  assert.match(updateSource, /公式画面との件数照合に失敗/);
  assert.match(updateSource, /assertUniqueRecordIds\(newRecords\)/);
  assert.match(updateSource, /process\.env\.CI === "true"/);
  assert.match(updateWorkflow, /- "scripts\/\*\*"/);
  assert.match(updateWorkflow, /npm run update:data/);
  assert.match(updateWorkflow, /npm test/);
  assert.match(updateWorkflow, /actions\/upload-pages-artifact@v4/);
  assert.match(updateWorkflow, /needs: update/);
  assert.match(updateWorkflow, /actions\/deploy-pages@v4/);
  assert.doesNotMatch(updateWorkflow, /workflow_run/);
});
