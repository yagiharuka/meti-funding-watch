import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registry = JSON.parse(
  await readFile(new URL("../data/official-source-registry.json", import.meta.url), "utf8"),
);
const pageSource = await readFile(new URL("../app/official/page.tsx", import.meta.url), "utf8");
const searchSource = await readFile(new URL("../app/official/OfficialSearch.tsx", import.meta.url), "utf8");
const viewTabsSource = await readFile(new URL("../app/ViewTabs.tsx", import.meta.url), "utf8");
const manifest = JSON.parse(await readFile(new URL("../data/official/manifest.json", import.meta.url), "utf8"));

test("registers all 13 direct executors and both official source categories", () => {
  assert.equal(registry.schemaVersion, 2);
  assert.equal(registry.executors.length, 13);
  assert.equal(new Set(registry.executors.map((item) => item.id)).size, 13);
  assert.equal(registry.collectionStatus.registeredEndpoints, 26);
  assert.equal("searchableRecords" in registry.collectionStatus, false);
  assert.deepEqual(registry.collectionStatus.searchableExecutors, ["smea", "jpo"]);
  assert.equal(registry.collectionStatus.status, "partial_detail");

  const expected = [
    "meti", "anre", "smea", "jpo", "hokkaido", "tohoku", "kanto",
    "chubu", "kansai", "chugoku", "shikoku", "kyushu", "okinawa",
  ];
  assert.deepEqual(registry.executors.map((item) => item.id), expected);
  for (const executor of registry.executors) {
    assert.ok(executor.name);
    for (const field of ["contracts", "grantDecisions"]) {
      const url = new URL(executor[field]);
      assert.equal(url.protocol, "https:");
      assert.ok(
        url.hostname === "www.meti.go.jp"
        || url.hostname.endsWith(".meti.go.jp")
        || url.hostname === "www.jpo.go.jp"
        || url.hostname === "www.ogb.go.jp",
        `${executor.id}/${field}: unexpected official host ${url.hostname}`,
      );
    }
  }
});

test("keeps contract, grant-decision, Gbiz, and payment meanings separate", () => {
  assert.equal(registry.series.contracts.amountStage, "契約額");
  assert.equal(registry.series.grantDecisions.amountStage, "交付決定額");
  assert.match(registry.series.contracts.notIncluded, /実支払/);
  assert.match(registry.series.grantDecisions.notIncluded, /実支払/);
  assert.match(pageSource, /GビズINFOの掲載値とも合算しません/);
  assert.match(pageSource, /リンクだけの資料は収録済みと数えていません/);
  assert.match(pageSource, /明細未収録/);
  assert.match(pageSource, /再委託先、間接補助先、基金・所管法人からの下流支出/);
  assert.doesNotMatch(pageSource, /実支払額です|最終受益者です|全件収録済み/);
  assert.match(searchSource, /公式資料の明細検索/);
  assert.match(searchSource, /交付先・契約相手、法人番号、事業名で検索/);
  assert.match(searchSource, /中小企業庁の随意契約、特許庁の委託契約・公共工事、他機関・他年度は含みません/);
  assert.match(searchSource, /備考：/);
  assert.match(searchSource, /掲載値は法人別に配賦できません/);
  assert.match(searchSource, /row\.notes/);
  assert.equal(manifest.recordCount, Object.values(manifest.coverage.executors).reduce(
    (sum, executor) => sum + executor.contractResults.records + executor.grantDecisions.records,
    0,
  ));
  assert.doesNotMatch(searchSource, /合計額|総支払額|実支払額です/);
});

test("adds the official catalog as a separate visible tab without restoring Mirasapo", () => {
  assert.match(viewTabsSource, /契約結果・交付決定/);
  assert.match(viewTabsSource, /経産省・各機関の公式資料/);
  assert.doesNotMatch(viewTabsSource, /補助金採択者情報（中小企業庁のみ）|href=.*adoptions\//);
  assert.match(pageSource, /公式契約結果・補助金交付決定/);
  assert.match(pageSource, /3系列の違い/);
});
