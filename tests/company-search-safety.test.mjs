import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  entityHasExactCompanyIdentity,
  filterCompanyEntities,
  filterCompanyRecords,
  groupCompanyRecords,
  normalizeCompanyIdentity,
  normalizeCompanySearchTerm,
  resolveCompanyNumbers,
  summarizeCompanyRows,
} from "../scripts/company-search.mjs";
import { toGbizBulkRecords } from "../scripts/gbiz-csv.mjs";

function row({
  id,
  organization,
  corporateNumber,
  stage = "contracted",
  amount = 100,
  sourceAgency = "経済産業省",
  fiscalYear = 2026,
  program = "テスト事業",
}) {
  return {
    id,
    organization,
    corporateNumber,
    stage,
    amount,
    sourceAgency,
    fiscalYear,
    program,
  };
}

const fixture = [
  row({ id: "nec-1", organization: "日本電気株式会社", corporateNumber: "7010401022916", amount: 300 }),
  row({ id: "nec-2", organization: "日本電気株式会社", corporateNumber: "7010401022916", stage: "subsidy_published", amount: 200 }),
  row({ id: "nec-3", organization: "日本電気株式会社", corporateNumber: "7010401022916", amount: null, fiscalYear: null }),
  row({ id: "glass-1", organization: "日本電気硝子株式会社", corporateNumber: "5160001001877", amount: 700 }),
  row({ id: "assoc-1", organization: "一般社団法人日本電気協会", corporateNumber: "8010005004319", amount: 900 }),
  row({ id: "old-1", organization: "旧テスト株式会社", corporateNumber: "1111111111111", amount: 10, fiscalYear: 2025 }),
  row({ id: "new-1", organization: "新テスト株式会社", corporateNumber: "1111111111111", amount: 20, fiscalYear: 2026 }),
  row({ id: "other-1", organization: "株式会社別会社", corporateNumber: "2222222222222", amount: 30 }),
];

test("Gbiz category comes from the source CSV kind, never from program-name wording", () => {
  const procurementCsv = [
    "法人番号,商号または名称,キー情報,受注日,件名,落札価格,組織名",
    "7010401022916,日本電気株式会社,p-1,2026-04-01,補助金交付申請等に関する業務,100,経済産業省",
  ].join("\n");
  const subsidyCsv = [
    "法人番号,商号または名称,キー情報,証明日,名称,金額,発行元",
    "7010401022916,日本電気株式会社,s-1,2026-04-01,委託契約に関する支援,200,経済産業省",
  ].join("\n");

  const procurement = toGbizBulkRecords(procurementCsv, "procurement").records;
  const subsidy = toGbizBulkRecords(subsidyCsv, "subsidy").records;

  assert.equal(procurement[0].program, "補助金交付申請等に関する業務");
  assert.equal(procurement[0].stage, "contracted");
  assert.equal(subsidy[0].program, "委託契約に関する支援");
  assert.equal(subsidy[0].stage, "subsidy_published");
});

test("an exact normalized company identity wins over broader partial-name matches", () => {
  const results = filterCompanyRecords(fixture, { query: "日本電気" });
  assert.equal(results.length, 3);
  assert.ok(results.every((item) => item.corporateNumber === "7010401022916"));
});

test("an ambiguous partial name keeps each matched corporation separate", () => {
  const results = filterCompanyRecords(fixture, { query: "日本電" });
  const groups = groupCompanyRecords(results);

  assert.deepEqual([...groups.keys()].sort(), [
    "5160001001877",
    "7010401022916",
    "8010005004319",
  ]);
  assert.equal(groups.get("7010401022916").length, 3);
  assert.equal(groups.get("5160001001877").length, 1);
  assert.equal(groups.get("8010005004319").length, 1);

  const nec = summarizeCompanyRows(groups.get("7010401022916"));
  const glass = summarizeCompanyRows(groups.get("5160001001877"));
  const association = summarizeCompanyRows(groups.get("8010005004319"));

  assert.equal(nec.records, 3);
  assert.equal(glass.records, 1);
  assert.equal(association.records, 1);
  assert.equal(nec.byStage.find((item) => item.stage === "contracted").amount, 300);
  assert.equal(glass.byStage[0].amount, 700);
  assert.equal(association.byStage[0].amount, 900);
  assert.notEqual(nec.byStage.find((item) => item.stage === "contracted").amount, 1_900);
});

test("13-digit corporate number search is exact", () => {
  const results = filterCompanyRecords(fixture, { query: "7010401022916" });
  assert.equal(results.length, 3);
  assert.ok(results.every((item) => item.corporateNumber === "7010401022916"));
  assert.equal(filterCompanyRecords(fixture, { query: "701040102291" }).length, 0);
});

test("name normalization handles Japanese corporate designators and width differences", () => {
  assert.equal(normalizeCompanySearchTerm("㈱ 日本 電気"), "株式会社日本電気");
  assert.equal(normalizeCompanyIdentity("㈱ 日本 電気"), "日本電気");
  assert.equal(normalizeCompanyIdentity("日本電気株式会社"), "日本電気");
  assert.equal(normalizeCompanyIdentity("(有) テスト"), "テスト");
  assert.deepEqual(
    [...resolveCompanyNumbers(fixture, "㈱日本電気")],
    ["7010401022916"],
  );
});

test("joint official recipients match every named participant", () => {
  const solo = {
    id: "hitachi-solo",
    organization: "株式会社日立製作所",
    organizations: ["株式会社日立製作所"],
    corporateNumber: "7010001008844",
  };
  const joint = {
    id: "hitachi-jecc-joint",
    organization: "株式会社日立製作所 株式会社ＪＥＣＣ",
    organizations: ["株式会社日立製作所", "株式会社ＪＥＣＣ"],
    corporateNumber: "",
  };

  assert.deepEqual(
    filterCompanyEntities([solo, joint], "日立製作所").map((item) => item.id).sort(),
    ["hitachi-jecc-joint", "hitachi-solo"],
  );
  assert.deepEqual(
    filterCompanyEntities([solo, joint], "ＪＥＣＣ").map((item) => item.id),
    ["hitachi-jecc-joint"],
  );
  assert.equal(entityHasExactCompanyIdentity(joint, "日立製作所"), true);
  assert.equal(entityHasExactCompanyIdentity(joint, "JECC"), true);
});

test("once a corporate number is identified, old/new names for that number stay together", () => {
  const oldNameResults = filterCompanyRecords(fixture, { query: "旧テスト" });
  assert.deepEqual(oldNameResults.map((item) => item.id).sort(), ["new-1", "old-1"]);
  assert.ok(oldNameResults.every((item) => item.corporateNumber === "1111111111111"));
});

test("review aliases use the same exact-first identity rule without a new alias dictionary", () => {
  const recipients = [
    {
      organization: "新テスト株式会社",
      corporateNumber: "1111111111111",
      aliases: ["旧テスト株式会社", "新テスト株式会社"],
    },
    {
      organization: "新テスト研究株式会社",
      corporateNumber: "3333333333333",
      aliases: ["新テスト研究株式会社"],
    },
  ];
  const exact = filterCompanyEntities(recipients, "旧テスト");
  assert.deepEqual(exact.map((item) => item.corporateNumber), ["1111111111111"]);
  const partial = filterCompanyEntities(recipients, "テスト");
  assert.deepEqual(partial.map((item) => item.corporateNumber).sort(), ["1111111111111", "3333333333333"]);
});

test("agency, category, and year filters are applied after corporate identification", () => {
  const filtered = filterCompanyRecords(fixture, {
    query: "日本電気",
    stage: "subsidy_published",
    year: "2026",
    agency: "経済産業省",
  });
  assert.deepEqual(filtered.map((item) => item.id), ["nec-2"]);
});

test("known plus unknown amount rows always equals the corporation record count", () => {
  const necRows = filterCompanyRecords(fixture, { query: "7010401022916" });
  const summary = summarizeCompanyRows(necRows);
  assert.equal(summary.amountKnownCount + summary.amountUnknownCount, summary.records);
  assert.equal(summary.amountKnownCount, 2);
  assert.equal(summary.amountUnknownCount, 1);
  assert.equal(summary.byStage.find((item) => item.stage === "contracted").amount, 300);
  assert.equal(summary.byStage.find((item) => item.stage === "subsidy_published").amount, 200);
});

test("a zero Gbiz match is a finite empty result, not a special failure", () => {
  const results = filterCompanyRecords(fixture, { query: "Gビズに存在しない法人" });
  assert.deepEqual(results, []);
});

test("all three runtime search paths use the shared company-search matcher", async () => {
  const [page, worker, enhancedWorker] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/funding-search.worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../pages-site/funding-search-enhanced.worker.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /filterCompanyRecords/);
  assert.match(worker, /matchCompanyEntities/);
  assert.match(enhancedWorker, /filterCompanyRecords/);
  for (const source of [page, worker, enhancedWorker]) assert.doesNotMatch(source, /row\.id} \$\{row\.sourceKey/);
});

test("Pages build contains the stable company-search mount and current zero-result guardrail", async () => {
  const { readdir } = await import("node:fs/promises");
  const assets = (await readdir(new URL("../dist-pages/assets/", import.meta.url)))
    .filter((name) => name.endsWith(".js"));
  const javascript = (await Promise.all(assets.map((name) =>
    readFile(new URL(`../dist-pages/assets/${name}`, import.meta.url), "utf8")))).join("\n");
  assert.match(javascript, /company-search-mount/);
  assert.match(javascript, /検索0件は、この法人が経産省関係の資金を受けていないことを意味しません/);
  assert.match(javascript, /行政事業レビュー・照合記録のタブも確認してください/);
  assert.doesNotMatch(javascript, /GビズINFOでは一致する法人を確認できませんでした/);
  assert.match(javascript, /このデータの読み方/);
  assert.doesNotMatch(javascript, /GビズINFO掲載値合計/);
});


test("same-corporation subsidy amounts are deduplicated and the excluded count is visible", async () => {
  const source = await readFile(new URL("../pages-site/company-search-ui.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /合計しません/);
  assert.doesNotMatch(source, /個別の掲載額は明細で確認/);
  assert.match(source, /補助金（掲載行／重複候補除外後）/);
  assert.match(source, /y\.subsidy_published\.amountIncludedCount/);
  assert.match(source, /重複掲載とみなして除外/);
  assert.match(source, /掲載額差±0\.1%/);
});
