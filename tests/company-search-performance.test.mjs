import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { INTERNAL_PARTIAL_SEARCH_PREFIX, filterCompanyEntities, filterCompanyRecords, normalizeCompanyIdentity } from "../scripts/company-search.mjs";

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const text = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Pagesの企業検索は軽量索引と32分割明細を公開する", async () => {
  const release = await json("../dist-pages/release.json");
  const index = await json("../dist-pages/data/gbiz-company-search-index.json");
  assert.equal(release.companySearch.schemaVersion, 2);
  assert.equal(index.schemaVersion, 2);
  assert.equal(index.entityCount, release.companySearch.index.entities);
  assert.equal(index.recordCount, release.recordCount);
  assert.equal(index.bucketCount, 32);
  assert.equal(Object.keys(release.companySearch.files).length, 32);
  assert.equal(index.filterPartitionCount, index.filterPartitions.length);
  assert.equal(Object.keys(release.companySearch.filterFiles).length, index.filterPartitionCount);
  assert.ok((await stat(new URL("../dist-pages/data/gbiz-company-search-index.json", import.meta.url))).size < 9_000_000);
  for (const [filename, metadata] of Object.entries(release.companySearch.files)) {
    assert.match(filename, /^gbiz-company-records-[0-9a-f]{2}\.json$/);
    assert.ok(metadata.bytes < 2_000_000, `${filename}は検索時の部分読込として大きすぎます`);
  }
  for (const entity of index.entities) {
    assert.equal(entity.identity, normalizeCompanyIdentity(entity.organization));
    assert.deepEqual(entity.aliasIdentities, [...new Set(entity.aliases.map(normalizeCompanyIdentity))]
      .filter((identity) => identity && identity !== entity.identity).sort((a, b) => a.localeCompare(b, "ja")));
  }
});

test("軽量索引から選んだ法人の明細は従来の全件検索と一致する", async () => {
  const manifest = await json("../dist-pages/data/manifest.json");
  const index = await json("../dist-pages/data/gbiz-company-search-index.json");
  const allRows = (await Promise.all(Object.values(manifest.commitments).map((filename) => json(`../dist-pages/data/${filename}`)))).flat();
  for (const query of [
    "日本電気",
    "7010401022916",
    "トヨタ自動車",
    "NTT",
    "日本電",
    "東",
    "日本電信電話",
    `${INTERNAL_PARTIAL_SEARCH_PREFIX}NTT`,
  ]) {
    const entities = filterCompanyEntities(index.entities, query);
    const buckets = [...new Set(entities.map((entity) => entity.bucket))];
    const bucketRows = (await Promise.all(buckets.map((bucket) => json(`../dist-pages/data/gbiz-company-records-${bucket}.json`)))).flat();
    const numbers = new Set(entities.map((entity) => entity.corporateNumber));
    const actual = bucketRows.filter((row) => numbers.has(row.corporateNumber)).map((row) => row.id).sort();
    const expected = filterCompanyRecords(allRows, { query }).map((row) => row.id).sort();
    assert.deepEqual(actual, expected, query);
  }
});

test("正規化済み法人identityの照合は索引全体でも再正規化コストを払わない", async () => {
  const index = await json("../dist-pages/data/gbiz-company-search-index.json");
  filterCompanyEntities(index.entities, "日本電");
  const startedAt = performance.now();
  const matches = filterCompanyEntities(index.entities, "日本電");
  const elapsed = performance.now() - startedAt;
  assert.ok(matches.length > 0);
  assert.ok(elapsed < 500, `pre-normalized index lookup took ${elapsed.toFixed(1)}ms`);

  const precomputedOnly = {
    corporateNumber: "1111111111111",
    identity: "日本電気",
    aliases: [],
    aliasIdentities: [],
    get organization() { throw new Error("検索時に生の法人名を読み直してはいけません"); },
  };
  assert.equal(filterCompanyEntities([precomputedOnly], "日本電気")[0], precomputedOnly);
});

test("空クエリの年度・機関・区分検索は対応する検証済みpartitionだけで全件結果と一致する", async () => {
  const manifest = await json("../dist-pages/data/manifest.json");
  const index = await json("../dist-pages/data/gbiz-company-search-index.json");
  const allRows = (await Promise.all(Object.values(manifest.commitments).map((filename) => json(`../dist-pages/data/${filename}`)))).flat();
  const cases = [
    { agency: "all", stage: "all", year: "2022" },
    { agency: "経済産業省", stage: "all", year: "all" },
    { agency: "all", stage: "subsidy_published", year: "all" },
    { agency: "経済産業省", stage: "contracted", year: "2023" },
    { agency: "all", stage: "all", year: "unclassified" },
  ];
  for (const parameters of cases) {
    const selected = index.filterPartitions.filter((partition) => (parameters.agency === "all" || partition.sourceAgency === parameters.agency)
      && (parameters.stage === "all" || partition.stage === parameters.stage)
      && (parameters.year !== "unclassified" || partition.fiscalYear === null)
      && (!/^\d{4}$/.test(parameters.year) || String(partition.fiscalYear) === parameters.year));
    assert.ok(selected.length > 0, JSON.stringify(parameters));
    assert.ok(selected.length < index.filterPartitions.length, JSON.stringify(parameters));
    const actual = (await Promise.all(selected.map((partition) => json(`../dist-pages/data/${partition.filename}`))))
      .flat().map((row) => row.id).sort();
    const expected = filterCompanyRecords(allRows, parameters).map((row) => row.id).sort();
    assert.deepEqual(actual, expected, JSON.stringify(parameters));
  }
});

test("初期表示と系列タブは大容量データを先読みしない", async () => {
  const [bridge, worker, combined, evidence, page, programSearch] = await Promise.all([
    text("../pages-site/funding-search-bridge.ts"),
    text("../app/funding-search.worker.ts"),
    text("../app/CombinedCompanyResults.tsx"),
    text("../pages-site/company-evidence-ui.ts"),
    text("../app/page.tsx"),
    text("../app/HomeProgramSearch.tsx"),
  ]);
  assert.doesNotMatch(bridge, /funding-search-enhanced\.worker/);
  assert.match(bridge, /new NativeWorker\(scriptURL, options\)/);
  assert.match(worker, /gbiz-company-search-index\.json/);
  assert.match(worker, /postIndexOnlyAlternatives/);
  assert.match(worker, /matchIndexedCompanyEntities/);
  assert.match(worker, /loadFilterPartition/);
  assert.match(worker, /companySearch\.filterFiles/);
  assert.doesNotMatch(worker, /loadAllLegacyRecords/);
  assert.match(worker, /cache: "force-cache"/);
  assert.doesNotMatch(combined, /import officialSupplementData/);
  assert.match(combined, /activeSeries !== "review"/);
  assert.match(combined, /activeSeries !== "official"/);
  assert.doesNotMatch(evidence, /Promise\.all\(\[getReviewIndex\(\), getOfficialIndex\(\)\]\)/);
  assert.match(evidence, /meti-company-series-change/);
  assert.match(page, /searchTarget === "program"[\s\S]*<HomeProgramSearch/);
  assert.doesNotMatch(page, /fetch\([^\n]*data\/review\/programs\.json/);
  assert.match(programSearch, /useEffect\(\(\) => \{/);
  assert.match(programSearch, /data\/review\/\$\{manifest\.programsFile\}/);
  assert.doesNotMatch(programSearch, /payments-/);
});
