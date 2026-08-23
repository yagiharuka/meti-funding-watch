import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { filterCompanyEntities, filterCompanyRecords } from "../scripts/company-search.mjs";

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const text = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Pagesの企業検索は軽量索引と32分割明細を公開する", async () => {
  const release = await json("../dist-pages/release.json");
  const index = await json("../dist-pages/data/gbiz-company-search-index.json");
  assert.equal(release.companySearch.schemaVersion, 1);
  assert.equal(index.entityCount, release.companySearch.index.entities);
  assert.equal(index.recordCount, release.recordCount);
  assert.equal(index.bucketCount, 32);
  assert.equal(Object.keys(release.companySearch.files).length, 32);
  assert.ok((await stat(new URL("../dist-pages/data/gbiz-company-search-index.json", import.meta.url))).size < 6_000_000);
  for (const [filename, metadata] of Object.entries(release.companySearch.files)) {
    assert.match(filename, /^gbiz-company-records-[0-9a-f]{2}\.json$/);
    assert.ok(metadata.bytes < 2_000_000, `${filename}は検索時の部分読込として大きすぎます`);
  }
});

test("軽量索引から選んだ法人の明細は従来の全件検索と一致する", async () => {
  const manifest = await json("../dist-pages/data/manifest.json");
  const index = await json("../dist-pages/data/gbiz-company-search-index.json");
  const allRows = (await Promise.all(Object.values(manifest.commitments).map((filename) => json(`../dist-pages/data/${filename}`)))).flat();
  for (const query of ["日本電気", "7010401022916", "トヨタ自動車"]) {
    const entities = filterCompanyEntities(index.entities, query);
    const buckets = [...new Set(entities.map((entity) => entity.bucket))];
    const bucketRows = (await Promise.all(buckets.map((bucket) => json(`../dist-pages/data/gbiz-company-records-${bucket}.json`)))).flat();
    const numbers = new Set(entities.map((entity) => entity.corporateNumber));
    const actual = bucketRows.filter((row) => numbers.has(row.corporateNumber)).map((row) => row.id).sort();
    const expected = filterCompanyRecords(allRows, { query }).map((row) => row.id).sort();
    assert.deepEqual(actual, expected, query);
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
