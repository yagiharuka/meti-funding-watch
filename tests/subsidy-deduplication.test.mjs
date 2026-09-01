import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SUBSIDY_DUPLICATE_AMOUNT_TOLERANCE,
  classifySubsidyDuplicates,
  normalizeSubsidyProgram,
  subsidyAggregationValue,
} from "../scripts/subsidy-deduplication.mjs";

const corporation = "3010405016868";
const subsidy = (id, fiscalYear, program, amount, date = `${fiscalYear}-04-01`) => ({
  id,
  corporateNumber: corporation,
  stage: "subsidy_published",
  fiscalYear,
  date,
  program,
  amount,
});

test("program normalization preserves appropriation year and absorbs known title variants", () => {
  assert.deepEqual(normalizeSubsidyProgram("平成３１年度キャッシュレス・消費者還元事業費補助金"), {
    core: "キャッシュレス消費者還元",
    fiscalYear: 2019,
  });
  assert.equal(
    normalizeSubsidyProgram("中小企業等事業再構築促進補助金").core,
    normalizeSubsidyProgram("中小企業等事業再構築促進事業").core,
  );
  assert.notEqual(
    normalizeSubsidyProgram("平成３１年度キャッシュレス・消費者還元事業費補助金").fiscalYear,
    normalizeSubsidyProgram("令和２年度キャッシュレス・消費者還元事業費補助金").fiscalYear,
  );
});

test("same-corporation duplicate subsidy rows are excluded from aggregation but retained as evidence", () => {
  const rows = [
    subsidy("cashless-rounded", 2020, "平成３１年度キャッシュレス・消費者還元事業費補助金", 429_551_000_000),
    subsidy("cashless-precise", 2019, "平成３１年度キャッシュレス・消費者還元事業費補助金", 429_550_867_000),
    subsidy("rebuild-grant", 2020, "中小企業等事業再構築促進補助金", 1_148_530_000_000),
    subsidy("rebuild-project", 2020, "中小企業等事業再構築促進事業", 1_148_530_000_000),
  ];
  const classification = classifySubsidyDuplicates(rows);

  assert.equal(SUBSIDY_DUPLICATE_AMOUNT_TOLERANCE, 0.001);
  assert.equal(classification.duplicateExcludedCount, 2);
  assert.equal(classification.groups.length, 2);
  assert.equal(classification.groups[0].canonicalId, "cashless-precise", "the less-rounded amount is retained");
  assert.equal(rows.length, 4, "raw evidence rows are not removed");
  assert.equal(
    rows.reduce((sum, row) => sum + subsidyAggregationValue(row, classification).amount, 0),
    429_550_867_000 + 1_148_530_000_000,
  );
});

test("different corporations, different appropriation years, and zero amounts are not collapsed", () => {
  const title = "キャッシュレス・消費者還元事業費補助金";
  const rows = [
    subsidy("h31", 2019, `平成３１年度${title}`, 100_000_000),
    subsidy("r2", 2020, `令和２年度${title}`, 100_000_000),
    { ...subsidy("other-corp", 2019, `平成３１年度${title}`, 100_000_000), corporateNumber: "2010405004147" },
    subsidy("zero-a", 2019, "同一事業", 0),
    subsidy("zero-b", 2020, "同一事業", 0),
  ];
  assert.equal(classifySubsidyDuplicates(rows).duplicateExcludedCount, 0);
});

test("the committed Gbiz rows reproduce the three reported duplicate cases", async () => {
  const years = [2019, 2020, 2021, 2022, 2023];
  const rows = (await Promise.all(years.map(async (year) => JSON.parse(await readFile(
    new URL(`../data/pages/commitments-${year}.json`, import.meta.url),
    "utf8",
  ))))).flat();

  const cashless = rows.filter((row) => row.corporateNumber === "3010405016868" && row.stage === "subsidy_published");
  const cashlessClassification = classifySubsidyDuplicates(cashless);
  assert.equal(cashless.length, 8);
  assert.equal(cashlessClassification.duplicateExcludedCount, 4);
  assert.equal(
    cashless.reduce((sum, row) => sum + subsidyAggregationValue(row, cashlessClassification).amount, 0),
    1_046_161_267_000,
  );

  const smrjPrograms = new Set([
    "中小企業等事業再構築促進補助金",
    "中小企業等事業再構築促進事業",
    "平成３０年度小規模事業者持続的発展支援事業費補助金",
    "小規模事業者持続的発展支援事業費補助金",
  ]);
  const smrj = rows.filter((row) => row.corporateNumber === "2010405004147" && smrjPrograms.has(row.program));
  assert.equal(classifySubsidyDuplicates(smrj).duplicateExcludedCount, 2);

  const hakuhodo = rows.filter((row) => row.corporateNumber === "8010401024011"
    && row.program === "令和４年度電気利用効率化促進対策事業費補助金");
  assert.equal(classifySubsidyDuplicates(hakuhodo).duplicateExcludedCount, 1);
});
